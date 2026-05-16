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

fn read_key_bytes(path: &Path) -> Result<Vec<u8>, CryptoError> {
    let bytes = fs::read(path)?;
    if bytes.len() != KEY_LEN {
        return Err(CryptoError::BadKeyLength(bytes.len()));
    }
    Ok(bytes)
}

fn generate_key_bytes() -> Vec<u8> {
    let mut bytes = vec![0u8; KEY_LEN];
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

#[cfg(not(unix))]
fn write_key_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    // Non-Unix (Windows): we can't set 0o600 here. The right answer is
    // a Windows-ACL helper that locks the ACL to the current user only;
    // until that ships we surface a loud warning so operators know the
    // master key file falls back to default ACLs.
    tracing::warn!(
        path = %path.display(),
        "writing master key with default platform permissions; \
         on Windows this means the file ACL may be read-accessible to \
         other users on the machine. For shared hosts, restrict the \
         file ACL manually or run on a Unix host."
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
}
