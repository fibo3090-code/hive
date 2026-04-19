//! Key-at-rest encryption for HIVE secrets (LLM API keys, PATs, etc.).
//!
//! Uses ChaCha20-Poly1305 with a master key stored at `~/.hive/master.key`
//! (mode 600 on unix). If the file is absent it is generated on first use.

use std::{fs, io::Write, path::PathBuf};

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
    #[error("crypto failure: {0}")]
    Crypto(String),
    #[error("master key has invalid length (expected {KEY_LEN} bytes, got {0})")]
    BadKeyLength(usize),
    #[error("ciphertext too short")]
    BadCiphertext,
    #[error("no home directory available")]
    NoHome,
}

/// Owns the master key material and provides seal/open.
#[derive(Clone)]
pub struct Crypto {
    cipher: ChaCha20Poly1305,
}

impl Crypto {
    /// Load or create the master key at `~/.hive/master.key`.
    pub fn load_or_init() -> Result<Self, CryptoError> {
        let path = master_key_path()?;
        let key_bytes = if path.exists() {
            let bytes = fs::read(&path)?;
            if bytes.len() != KEY_LEN {
                return Err(CryptoError::BadKeyLength(bytes.len()));
            }
            bytes
        } else {
            let mut bytes = vec![0u8; KEY_LEN];
            OsRng.fill_bytes(&mut bytes);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            write_key_file(&path, &bytes)?;
            tracing::info!(path = %path.display(), "generated new HIVE master key");
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
        let ct = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| CryptoError::Crypto(e.to_string()))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if sealed.len() < NONCE_LEN + 16 {
            return Err(CryptoError::BadCiphertext);
        }
        let (nonce_bytes, ct) = sealed.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher
            .decrypt(nonce, ct)
            .map_err(|e| CryptoError::Crypto(e.to_string()))
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

fn master_key_path() -> Result<PathBuf, CryptoError> {
    let home = dirs::home_dir().ok_or(CryptoError::NoHome)?;
    Ok(home.join(".hive").join("master.key"))
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

    #[test]
    fn roundtrip() {
        let c = in_mem();
        let sealed = c.seal(b"hello world").unwrap();
        assert_ne!(sealed, b"hello world");
        assert_eq!(c.open(&sealed).unwrap(), b"hello world");
    }

    #[test]
    fn tamper_detected() {
        let c = in_mem();
        let mut sealed = c.seal(b"secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(c.open(&sealed).is_err());
    }

    #[test]
    fn mask_known_shapes() {
        assert_eq!(mask_key(""), "");
        assert_eq!(mask_key("short"), "•••••");
        assert_eq!(mask_key("sk-ant-abcdefghi"), "sk-a…fghi");
    }
}
