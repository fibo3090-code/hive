//! Local-filesystem sandbox — workspace scoped to a directory on the host.
//!
//! Used when Docker isn't available (the zero-config default). Protects
//! against path-traversal by refusing any path that, once joined to the
//! root and canonicalised, leaves the root prefix.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use async_trait::async_trait;
use tokio::process::Command;

use crate::{Entry, ExecOutput, Sandbox, SandboxError, SandboxKind};

pub struct LocalFsSandbox {
    root: PathBuf,
}

impl LocalFsSandbox {
    /// Create a sandbox rooted at `root`. Creates the directory if missing.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, SandboxError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        // Canonicalise so path-escape checks operate on the real path
        // (resolves `..`, symlinks at root).
        let root = std::fs::canonicalize(&root)?;
        Ok(Self { root })
    }

    /// Join a user-provided path to the root and verify it stays inside.
    /// Supports non-existent paths (for `write`) by checking ancestors.
    fn resolve(&self, rel: &str) -> Result<PathBuf, SandboxError> {
        // Reject absolute paths and any component that walks up past root.
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(SandboxError::PathEscape(p.to_path_buf()));
        }
        let joined = self.root.join(p);
        // Resolve to a fully-qualified path without requiring existence.
        let mut stack: Vec<std::path::Component<'_>> = Vec::new();
        for component in joined.components() {
            match component {
                std::path::Component::ParentDir => {
                    if stack.pop().is_none() {
                        return Err(SandboxError::PathEscape(joined.clone()));
                    }
                }
                std::path::Component::CurDir => {}
                other => stack.push(other),
            }
        }
        let resolved: PathBuf = stack.iter().collect();
        if !resolved.starts_with(&self.root) {
            return Err(SandboxError::PathEscape(resolved));
        }
        Ok(resolved)
    }
}

#[async_trait]
impl Sandbox for LocalFsSandbox {
    fn kind(&self) -> SandboxKind {
        SandboxKind::LocalFs
    }

    fn root(&self) -> PathBuf {
        self.root.clone()
    }

    async fn read(&self, path: &str) -> Result<Vec<u8>, SandboxError> {
        let resolved = self.resolve(path)?;
        match tokio::fs::read(&resolved).await {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(SandboxError::NotFound(resolved))
            }
            Err(e) => Err(SandboxError::Io(e)),
        }
    }

    async fn write(&self, path: &str, contents: &[u8]) -> Result<(), SandboxError> {
        let resolved = self.resolve(path)?;
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&resolved, contents).await?;
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<Entry>, SandboxError> {
        let resolved = self.resolve(path)?;
        let mut entries = match tokio::fs::read_dir(&resolved).await {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(SandboxError::NotFound(resolved));
            }
            Err(e) => return Err(SandboxError::Io(e)),
        };

        let mut out = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let metadata = entry.metadata().await?;
            let abs_path = entry.path();
            let rel = abs_path
                .strip_prefix(&self.root)
                .unwrap_or(&abs_path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(Entry {
                path: rel,
                is_dir: metadata.is_dir(),
                size: metadata.is_file().then_some(metadata.len()),
            });
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    async fn exec(
        &self,
        cmd: &str,
        args: &[String],
        timeout: Duration,
    ) -> Result<ExecOutput, SandboxError> {
        let mut command = Command::new(cmd);
        command
            .args(args)
            .current_dir(&self.root)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = command
            .spawn()
            .map_err(|e| SandboxError::Exec(format!("spawn {cmd}: {e}")))?;

        let wait = child.wait_with_output();
        match tokio::time::timeout(timeout, wait).await {
            Ok(Ok(output)) => Ok(ExecOutput {
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                exit_code: output.status.code(),
                timed_out: false,
            }),
            Ok(Err(e)) => Err(SandboxError::Exec(e.to_string())),
            Err(_) => Err(SandboxError::Timeout(timeout)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell_command(script: &str) -> (String, Vec<String>) {
        if cfg!(windows) {
            ("powershell".into(), vec!["-Command".into(), script.into()])
        } else {
            ("sh".into(), vec!["-c".into(), script.into()])
        }
    }

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hive-sandbox-test-{}", rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rand_suffix() -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        format!("{nanos:x}")
    }

    #[test]
    fn resolve_rejects_absolute_paths() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        assert!(matches!(
            sb.resolve("/etc/passwd"),
            Err(SandboxError::PathEscape(_))
        ));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        assert!(matches!(
            sb.resolve("../../../etc/passwd"),
            Err(SandboxError::PathEscape(_))
        ));
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let r = sb.resolve("src/main.rs").unwrap();
        assert!(r.starts_with(sb.root()));
        assert!(r.ends_with("src/main.rs"));
    }

    #[test]
    fn resolve_normalises_dot_segments() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let r = sb.resolve("./a/./b/../c").unwrap();
        assert!(r.ends_with("a/c"));
    }

    #[tokio::test]
    async fn write_then_read_roundtrip() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        sb.write("nested/dir/hello.txt", b"hi there").await.unwrap();
        let got = sb.read("nested/dir/hello.txt").await.unwrap();
        assert_eq!(got, b"hi there");
    }

    #[tokio::test]
    async fn list_returns_entries() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        sb.write("a.txt", b"1").await.unwrap();
        sb.write("sub/b.txt", b"22").await.unwrap();
        let entries = sb.list(".").await.unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"sub"));
    }

    #[tokio::test]
    async fn exec_captures_stdout() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let (command, args) = if cfg!(windows) {
            shell_command("Write-Output hello")
        } else {
            shell_command("echo hello")
        };
        let out = sb
            .exec(&command, &args, Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(out.stdout.trim(), "hello");
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
    }

    #[tokio::test]
    async fn exec_respects_timeout() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let (command, args) = if cfg!(windows) {
            shell_command("Start-Sleep -Seconds 10")
        } else {
            shell_command("sleep 10")
        };
        let out = sb.exec(&command, &args, Duration::from_millis(200)).await;
        assert!(matches!(out, Err(SandboxError::Timeout(_))));
    }
}
