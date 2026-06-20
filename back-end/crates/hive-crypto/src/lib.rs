//! Key-at-rest encryption for HIVE secrets (LLM API keys, PATs, etc.).
//!
//! Uses ChaCha20-Poly1305 with a master key stored under the HIVE data
//! directory (`<data_dir>/master.key`, mode 600 on unix). For legacy
//! installs we still read `~/.hive/master.key` if the new path is empty,
//! so existing deployments keep working without re-encrypting secrets.
//! If neither file exists, a fresh key is generated at the new path.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;
use thiserror::Error;
use zeroize::Zeroizing;

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// All decrypt-side failures collapse to one variant. Whether the key
    /// is wrong, the ciphertext was tampered with, or the framing is
    /// broken, the caller and any leaked logs see the same message —
    /// information leaks aid offline-attack iteration. The real cause
    /// goes to `tracing::error!` for the operator.
    #[error("decrypt failed")]
    Decrypt,
    /// Encrypt-side failures from the AEAD (always internal — out-of-
    /// memory or RNG exhaustion territory). Same opacity discipline.
    #[error("encrypt failed")]
    Encrypt,
    #[error("master key has invalid length (expected {KEY_LEN} bytes, got {0})")]
    BadKeyLength(usize),
    #[error("no home directory available")]
    NoHome,
}

/// Owns the master key material and provides seal/open.
#[derive(Clone)]
pub struct Crypto {
    cipher: ChaCha20Poly1305,
}

impl Crypto {
    /// Load or create the master key. Resolution order:
    /// 1. `<data_dir>/master.key` (preferred — keeps all HIVE state in one tree).
    /// 2. `~/.hive/master.key` (legacy path, kept readable for upgrades).
    /// 3. Generate a fresh key at the preferred path.
    ///
    /// Pass `None` for `data_dir` to skip step 1 (matches the old
    /// behaviour for callers that haven't been threaded with a data dir).
    pub fn load_or_init(data_dir: Option<&Path>) -> Result<Self, CryptoError> {
        let preferred = data_dir.map(|d| d.join("master.key"));
        let legacy = legacy_master_key_path()?;

        let key_bytes = if let Some(ref path) = preferred {
            if path.exists() {
                read_key_bytes(path)?
            } else if legacy.exists() {
                tracing::info!(
                    legacy = %legacy.display(),
                    preferred = %path.display(),
                    "using legacy master key at $HOME/.hive/master.key; \
                     to consolidate, move it under your HIVE_DATA_DIR"
                );
                read_key_bytes(&legacy)?
            } else {
                let bytes = generate_key_bytes();
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                write_key_file(path, &bytes)?;
                tracing::info!(path = %path.display(), "generated new HIVE master key");
                bytes
            }
        } else if legacy.exists() {
            read_key_bytes(&legacy)?
        } else {
            let bytes = generate_key_bytes();
            if let Some(parent) = legacy.parent() {
                fs::create_dir_all(parent)?;
            }
            write_key_file(&legacy, &bytes)?;
            tracing::info!(path = %legacy.display(), "generated new HIVE master key");
            bytes
        };

        let key = Key::from_slice(&key_bytes);
        Ok(Self {
            cipher: ChaCha20Poly1305::new(key),
        })
    }

    /// Encrypt plaintext. Output layout: `nonce || ciphertext||tag`.
    pub fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = self.cipher.encrypt(nonce, plaintext).map_err(|e| {
            tracing::error!(error = %e, "crypto seal failed");
            CryptoError::Encrypt
        })?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        // Minimum sealed-payload length: nonce (12) + plausibly-aligned
        // ciphertext + tag (16). 32-byte threshold raises the bar so a
        // truncated/garbage payload gets rejected before it touches the
        // AEAD machinery.
        const MIN_SEALED_LEN: usize = NONCE_LEN + 32;
        if sealed.len() < MIN_SEALED_LEN {
            tracing::error!(
                len = sealed.len(),
                min = MIN_SEALED_LEN,
                "crypto open: sealed payload below minimum length"
            );
            return Err(CryptoError::Decrypt);
        }
        let (nonce_bytes, ct) = sealed.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher.decrypt(nonce, ct).map_err(|e| {
            tracing::error!(error = %e, "crypto open failed");
            CryptoError::Decrypt
        })
    }
}

/// Mask a secret for UI display, e.g. `sk-ant-…a3f9`.
pub fn mask_key(plaintext: &str) -> String {
    let trimmed = plaintext.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "•".repeat(chars.len());
    }
    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}…{suffix}")
}

fn legacy_master_key_path() -> Result<PathBuf, CryptoError> {
    let home = dirs::home_dir().ok_or(CryptoError::NoHome)?;
    Ok(home.join(".hive").join("master.key"))
}

/// Read the 32-byte master key. C247: the bytes are wrapped in `Zeroizing`
/// so the heap allocation is wiped on drop instead of lingering recoverable
/// (a core dump or same-uid `/proc/<pid>/mem` reader could otherwise lift the
/// key that decrypts every stored secret).
fn read_key_bytes(path: &Path) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    let bytes = Zeroizing::new(fs::read(path)?);
    if bytes.len() != KEY_LEN {
        return Err(CryptoError::BadKeyLength(bytes.len()));
    }
    Ok(bytes)
}

fn generate_key_bytes() -> Zeroizing<Vec<u8>> {
    let mut bytes = Zeroizing::new(vec![0u8; KEY_LEN]);
    OsRng.fill_bytes(&mut bytes);
    bytes
}

#[cfg(unix)]
fn write_key_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

#[cfg(windows)]
fn write_key_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    drop(file);
    // C256: a freshly-created file inherits the directory's ACL, which on a
    // shared host can be readable by other local users — and this file holds
    // the symmetric key that decrypts every stored secret. Lock the DACL down
    // to the current user before returning, and REFUSE to proceed if that
    // fails (a generated-but-unprotected key is worse than a hard error the
    // operator can act on).
    restrict_key_file_to_current_user(path)?;
    Ok(())
}

/// Restrict a file's DACL to the current user using the built-in `icacls`:
/// `/inheritance:r` strips every inherited ACE, `/grant:r user:(F)` leaves
/// exactly one ACE (current user, full control). Returns an error if `icacls`
/// can't be run or reports failure.
#[cfg(windows)]
fn restrict_key_file_to_current_user(path: &std::path::Path) -> std::io::Result<()> {
    use std::io::Error;
    use std::process::Command;

    let user = std::env::var("USERNAME")
        .map_err(|_| Error::other("cannot restrict master-key ACL: USERNAME env var is unset"))?;
    if user.trim().is_empty() {
        return Err(Error::other(
            "cannot restrict master-key ACL: USERNAME is empty",
        ));
    }
    let path_str = path
        .to_str()
        .ok_or_else(|| Error::other("master-key path is not valid UTF-8"))?;

    let output = Command::new("icacls")
        .args([
            path_str,
            "/inheritance:r",
            "/grant:r",
            &format!("{user}:(F)"),
        ])
        .output()
        .map_err(|e| Error::other(format!("failed to run icacls for master-key ACL: {e}")))?;

    if !output.status.success() {
        return Err(Error::other(format!(
            "icacls failed to restrict the master-key ACL (the key would be readable by \
             other local users): {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn write_key_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    // Exotic non-Unix, non-Windows targets: no portable ACL primitive. Surface
    // a loud warning so the operator restricts the file manually.
    tracing::warn!(
        path = %path.display(),
        "writing master key with default platform permissions; restrict the file \
         manually on a shared host."
    );
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_mem() -> Crypto {
        let mut key = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut key);
        Crypto {
            cipher: ChaCha20Poly1305::new(Key::from_slice(&key)),
        }
    }

    /// API-key-sized payload — long enough to clear the new minimum
    /// sealed-length floor (44 bytes; details in `open`).
    const SAMPLE_KEY: &[u8] = b"sk-ant-1234567890abcdef1234567890abcdef";

    #[test]
    fn roundtrip() {
        let c = in_mem();
        let sealed = c.seal(SAMPLE_KEY).unwrap();
        assert_ne!(sealed, SAMPLE_KEY);
        assert_eq!(c.open(&sealed).unwrap(), SAMPLE_KEY);
    }

    #[test]
    fn tamper_detected() {
        let c = in_mem();
        let mut sealed = c.seal(SAMPLE_KEY).unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        // Decrypt failures all collapse to the opaque `Decrypt` variant.
        assert!(matches!(c.open(&sealed), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn truncated_payload_rejected_with_opaque_error() {
        let c = in_mem();
        let result = c.open(&[0u8; 8]);
        // Opaque error: callers can't tell short-payload from wrong-key.
        assert!(matches!(result, Err(CryptoError::Decrypt)));
    }

    #[test]
    fn mask_known_shapes() {
        assert_eq!(mask_key(""), "");
        assert_eq!(mask_key("short"), "•••••");
        assert_eq!(mask_key("sk-ant-abcdefghi"), "sk-a…fghi");
    }

    #[test]
    fn generated_key_is_correct_length() {
        // C247: still produces a usable 32-byte key through the Zeroizing wrapper.
        assert_eq!(generate_key_bytes().len(), KEY_LEN);
    }

    #[cfg(windows)]
    #[test]
    fn windows_write_key_file_locks_acl_and_stays_owner_readable() {
        // C256: writing the key must succeed AND the icacls DACL restriction
        // must run cleanly on a real Windows host, leaving the owner able to
        // read it back.
        let path = std::env::temp_dir().join(format!(
            "hive-master-key-test-{}-{}.key",
            std::process::id(),
            KEY_LEN
        ));
        let _ = fs::remove_file(&path);
        let bytes = generate_key_bytes();
        write_key_file(&path, &bytes).expect("write + icacls restrict should succeed");
        let read_back = fs::read(&path).expect("owner can still read the key");
        assert_eq!(read_back.len(), KEY_LEN);
        let _ = fs::remove_file(&path);
    }
}
