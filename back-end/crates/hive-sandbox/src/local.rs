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

/// Per-process resource caps applied to `shell_exec` children via `setrlimit`
/// on Unix. Defends against fork-bombs / runaway memory / endless CPU before
/// the wall-clock timeout fires. (`libc::rlim_t` is `u64` on most Unix
/// targets; the cast in `apply_shell_rlimits` keeps it portable.)
///
/// Windows has no `setrlimit` equivalent — `apply_shell_rlimits` and these
/// constants are skipped there. The wall-clock timeout plus `kill_on_drop`
/// stays in force on every platform.
#[cfg(unix)]
const SHELL_RLIMIT_CPU_SECS: u64 = 300;
#[cfg(unix)]
const SHELL_RLIMIT_AS_BYTES: u64 = 1 << 30; // 1 GiB
#[cfg(unix)]
const SHELL_RLIMIT_NOFILE: u64 = 1024;
#[cfg(unix)]
const SHELL_RLIMIT_NPROC: u64 = 64;

/// Cap captured stdout/stderr so a chatty command doesn't dump megabytes back
/// into the LLM's context window.
const SHELL_STDOUT_CAP: usize = 256 * 1024;
const SHELL_STDERR_CAP: usize = 64 * 1024;

/// Hard ceiling on any single `fs_read`. Files above this are refused outright
/// (not truncated) — preventing the loader from materialising a multi-GB blob
/// in RAM. The `fs_read` tool layers its own soft cap on top.
const FS_READ_HARD_CAP: usize = 16 * 1024 * 1024; // 16 MiB

/// Hard ceiling on any single `fs_write`. Stops an agent from filling the
/// disk with one absurd write.
const FS_WRITE_HARD_CAP: usize = 32 * 1024 * 1024; // 32 MiB

#[cfg(unix)]
fn apply_shell_rlimits() -> std::io::Result<()> {
    // SAFETY: runs in the forked child between `fork()` and `execve()`; only
    // async-signal-safe libc fns are called here. Each `setrlimit` is
    // best-effort — any failure is non-fatal (the wall-clock timeout still
    // applies above). The casts let us share one helper across targets where
    // `__rlimit_resource_t` is `u32` (Linux) vs `c_int` (BSD/macOS) and where
    // `rlim_t` is `u64` vs `u32`.
    unsafe {
        let set = |what: libc::c_int, val: u64| {
            #[allow(clippy::cast_possible_truncation, clippy::useless_conversion)]
            let r = libc::rlimit {
                rlim_cur: val as libc::rlim_t,
                rlim_max: val as libc::rlim_t,
            };
            #[allow(clippy::cast_possible_truncation, clippy::useless_conversion)]
            libc::setrlimit(what as _, &r);
        };
        set(libc::RLIMIT_CPU as libc::c_int, SHELL_RLIMIT_CPU_SECS);
        set(libc::RLIMIT_AS as libc::c_int, SHELL_RLIMIT_AS_BYTES);
        set(libc::RLIMIT_NOFILE as libc::c_int, SHELL_RLIMIT_NOFILE);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        set(libc::RLIMIT_NPROC as libc::c_int, SHELL_RLIMIT_NPROC);
    }
    Ok(())
}

fn truncate_output(bytes: &[u8], cap: usize) -> (String, bool) {
    if bytes.len() <= cap {
        return (String::from_utf8_lossy(bytes).into_owned(), false);
    }
    let mut s = String::from_utf8_lossy(&bytes[..cap]).into_owned();
    s.push_str(&format!(
        "\n…[truncated; {} of {} bytes shown]\n",
        cap,
        bytes.len()
    ));
    (s, true)
}

pub struct LocalFsSandbox {
    root: PathBuf,
}

/// Subdirectory under the sandbox root that hosts HIVE-internal files
/// (todo.json, the shell_exec child process's HOME, …). The file
/// protection layer denies LLM-driven `fs_*`/`shell_exec` access into
/// here so credentials that npm/cargo/git write into HOME (.npmrc,
/// .cargo/credentials, .gitconfig) aren't readable by the agent that
/// spawned the child (ZZ7).
const HIVE_RUN_HOME_DIR: &str = ".hive/run-home";

impl LocalFsSandbox {
    /// Create a sandbox rooted at `root`. Creates the directory if missing.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, SandboxError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        // Canonicalise so path-escape checks operate on the real path
        // (resolves `..`, symlinks at root).
        let root = std::fs::canonicalize(&root)?;
        // Pre-create the per-sandbox HOME for shell_exec children. Lives
        // under `.hive/` so the file-protection layer keeps the agent
        // from reading the cached creds back via `fs_read` or
        // `shell_exec`.
        std::fs::create_dir_all(root.join(HIVE_RUN_HOME_DIR))?;
        Ok(Self { root })
    }

    /// Absolute path to the per-sandbox HOME used during `exec`.
    fn run_home(&self) -> PathBuf {
        self.root.join(HIVE_RUN_HOME_DIR)
    }

    /// Join a user-provided path to the root and verify it stays inside,
    /// even after symlinks are followed.
    ///
    /// Two layers of defence:
    ///
    /// 1. String-level: reject absolute paths and any `..` chain that
    ///    walks up past root.
    /// 2. FS-level: canonicalise the final path (or its existing
    ///    parent for not-yet-created files) and re-check that the
    ///    real path still starts with the canonical root. Catches
    ///    symlinks placed inside the workspace that point outside —
    ///    string-level normalisation alone wouldn't notice.
    ///
    /// `target_must_exist=false` is for the `write` path, where the
    /// leaf doesn't exist yet but the parent must still resolve into
    /// the workspace.
    fn resolve(&self, rel: &str, target_must_exist: bool) -> Result<PathBuf, SandboxError> {
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(SandboxError::PathEscape(p.to_path_buf()));
        }
        let joined = self.root.join(p);

        // Layer 1: string-level normalisation.
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

        // Layer 2: FS canonicalisation. `canonicalize` follows every symlink
        // in the path and resolves to the real underlying location, so we can
        // check that the real path still starts with the canonical root.
        if resolved.exists() {
            let real = std::fs::canonicalize(&resolved)?;
            if !real.starts_with(&self.root) {
                return Err(SandboxError::PathEscape(real));
            }
            return Ok(real);
        }
        if target_must_exist {
            return Err(SandboxError::NotFound(resolved));
        }
        // For not-yet-existing paths (the `write` case): walk up to the
        // deepest existing ancestor and canonicalise *that*. Without this,
        // a planted symlink at any intermediate component (e.g.
        // `workspace/foo -> /etc`, then `write("foo/bar")`) silently
        // traverses outside the sandbox — `tokio::fs::create_dir_all`
        // would happily follow the symlink and write under /etc.
        // `refuse_symlink` in `write()` only inspects the leaf, so this
        // closes the parent-symlink escape (ZZ1).
        let mut ancestor = resolved.clone();
        while !ancestor.exists() {
            match ancestor.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => {
                    ancestor = parent.to_path_buf();
                }
                _ => return Err(SandboxError::PathEscape(resolved)),
            }
        }
        let real_ancestor = std::fs::canonicalize(&ancestor)?;
        if !real_ancestor.starts_with(&self.root) {
            return Err(SandboxError::PathEscape(real_ancestor));
        }
        let tail = resolved
            .strip_prefix(&ancestor)
            .map_err(|_| SandboxError::PathEscape(resolved.clone()))?;
        let real = real_ancestor.join(tail);
        if !real.starts_with(&self.root) {
            return Err(SandboxError::PathEscape(real));
        }
        Ok(real)
    }

    /// Refuse if `path` is itself a symlink. Used by `write` so an
    /// attacker can't plant a symlink and have a later operation
    /// follow it. (Reads of existing symlinks resolve via `resolve`'s
    /// canonicalisation, which already rejects out-of-root targets.)
    /// Refuse if `path` is itself a symlink. Used to be the only
    /// symlink guard for `write`, but the leaf-symlink check was racy
    /// (ZZ11): an attacker could swap the leaf for a symlink between
    /// `symlink_metadata` and the subsequent `tokio::fs::write`. The
    /// `write` impl now opens with `O_NOFOLLOW` on Unix instead. This
    /// helper is kept for tests + non-Unix fallback.
    #[allow(dead_code)]
    fn refuse_symlink(&self, path: &Path) -> Result<(), SandboxError> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                Err(SandboxError::PathEscape(path.to_path_buf()))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(windows)]
fn is_windows_echo(cmd: &str) -> bool {
    cmd.eq_ignore_ascii_case("echo")
}

#[cfg(windows)]
fn escape_cmd_echo_arg(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len());
    for ch in arg.chars() {
        match ch {
            '\r' | '\n' => out.push(' '),
            '^' | '&' | '|' | '<' | '>' | '(' | ')' | '%' | '"' => {
                out.push('^');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(windows)]
fn windows_echo_command_line(args: &[String]) -> String {
    if args.is_empty() {
        return "echo.".to_owned();
    }
    format!(
        "echo {}",
        args.iter()
            .map(|arg| escape_cmd_echo_arg(arg))
            .collect::<Vec<_>>()
            .join(" ")
    )
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
        let resolved = self.resolve(path, false)?;
        // ZZ10: open once and bound the read at the file descriptor level.
        // The previous shape was `stat → check len ≤ cap → tokio::fs::read`,
        // which is TOCTOU: a concurrent writer (peer agent, host process)
        // could grow the file between the two syscalls, blowing past the
        // cap and OOMing the runner. `Read::take(cap + 1)` on a single
        // open handle removes that window — we then assert the final
        // length is `≤ cap`, treating a read that filled `cap + 1` as
        // proof the file overran the limit.
        let resolved_for_err = resolved.clone();
        let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, std::io::Error> {
            use std::io::Read;
            let file = std::fs::File::open(&resolved)?;
            let meta = file.metadata()?;
            if !meta.is_file() {
                return Err(std::io::Error::other("not a regular file"));
            }
            let mut buf = Vec::with_capacity(
                (meta.len() as usize).min(FS_READ_HARD_CAP).saturating_add(1),
            );
            // +1 sentinel byte: if `take` filled it, the underlying file
            // is strictly larger than the cap.
            file.take((FS_READ_HARD_CAP as u64) + 1)
                .read_to_end(&mut buf)?;
            if buf.len() > FS_READ_HARD_CAP {
                return Err(std::io::Error::other(format!(
                    "file is over {FS_READ_HARD_CAP} bytes — refused; read a smaller slice or split it"
                )));
            }
            Ok(buf)
        })
        .await
        .map_err(|join_err| SandboxError::Io(std::io::Error::other(join_err.to_string())))?;
        match bytes {
            Ok(b) => Ok(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(SandboxError::NotFound(resolved_for_err))
            }
            Err(e) => Err(SandboxError::Io(e)),
        }
    }

    async fn write(&self, path: &str, contents: &[u8]) -> Result<(), SandboxError> {
        if contents.len() > FS_WRITE_HARD_CAP {
            return Err(SandboxError::Io(std::io::Error::other(format!(
                "write of {} bytes refused (hard cap {} bytes)",
                contents.len(),
                FS_WRITE_HARD_CAP
            ))));
        }
        let resolved = self.resolve(path, false)?;
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        // ZZ11: open with `O_NOFOLLOW` (Unix) / `FILE_FLAG_OPEN_REPARSE_POINT`
        // (Windows) so the kernel refuses to traverse a symlink at the
        // leaf — closes the TOCTOU window between `refuse_symlink`
        // (lstat) and the subsequent `tokio::fs::write` (which followed
        // the path again). On Unix `O_NOFOLLOW` returns `ELOOP` when the
        // path is a symlink. Falls back to the old lstat-then-write
        // pattern on platforms without those flags.
        let contents = contents.to_vec();
        let resolved_for_blocking = resolved.clone();
        tokio::task::spawn_blocking(move || -> Result<(), std::io::Error> {
            #[cfg(unix)]
            {
                use std::io::Write;
                use std::os::unix::fs::OpenOptionsExt;
                let mut opts = std::fs::OpenOptions::new();
                opts.write(true)
                    .create(true)
                    .truncate(true)
                    .custom_flags(libc::O_NOFOLLOW);
                let mut file = opts.open(&resolved_for_blocking).map_err(|e| {
                    if matches!(e.raw_os_error(), Some(libc::ELOOP)) {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            format!(
                                "refusing to write through symlink at {}",
                                resolved_for_blocking.display()
                            ),
                        )
                    } else {
                        e
                    }
                })?;
                file.write_all(&contents)?;
                Ok(())
            }
            #[cfg(not(unix))]
            {
                // No portable `O_NOFOLLOW`: keep the lstat-then-write
                // pattern (matches the prior behaviour). The symlink
                // TOCTOU window remains on Windows; tracked separately.
                if let Ok(meta) = std::fs::symlink_metadata(&resolved_for_blocking) {
                    if meta.file_type().is_symlink() {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            format!(
                                "refusing to write through symlink at {}",
                                resolved_for_blocking.display()
                            ),
                        ));
                    }
                }
                std::fs::write(&resolved_for_blocking, &contents)
            }
        })
        .await
        .map_err(|join_err| SandboxError::Io(std::io::Error::other(join_err.to_string())))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::InvalidInput && e.to_string().contains("symlink") {
                SandboxError::PathEscape(resolved.clone())
            } else {
                SandboxError::Io(e)
            }
        })?;
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<Entry>, SandboxError> {
        let resolved = self.resolve(path, false)?;
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
        #[cfg(windows)]
        let mut command = if is_windows_echo(cmd) {
            let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_owned());
            let mut command = Command::new(shell);
            command
                .arg("/D")
                .arg("/S")
                .arg("/C")
                .arg(windows_echo_command_line(args));
            command
        } else {
            let mut command = Command::new(cmd);
            command.args(args);
            command
        };

        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new(cmd);
            command.args(args);
            command
        };

        command
            .current_dir(&self.root)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Scrub the environment. The agent process inherits the operator's
        // env which holds API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
        // GitHub PATs, AWS creds…) — none of which a shell tool should
        // see. Clear everything, then re-add a minimal allowlist so
        // common tooling still works.
        command.env_clear();
        for var in ["PATH", "LANG", "LC_ALL", "TZ", "TERM", "USER", "LOGNAME"] {
            if let Ok(value) = std::env::var(var) {
                command.env(var, value);
            }
        }
        #[cfg(windows)]
        for var in [
            "ComSpec",
            "PATHEXT",
            "SystemDrive",
            "SystemRoot",
            "TEMP",
            "TMP",
            "WINDIR",
        ] {
            if let Ok(value) = std::env::var(var) {
                command.env(var, value);
            }
        }
        // ZZ7: HOME points at `<root>/.hive/run-home/`, not the
        // workspace root. With HOME=root, every git/npm/cargo invocation
        // would scatter `.gitconfig`/`.npmrc`/`.cargo/credentials`
        // (often holding tokens) all over the project tree — readable
        // by a later `fs_read` or `fs_list`. With HOME inside the
        // file-protection-protected `.hive/` zone instead, the same
        // creds land where the LLM can't see them.
        command.env("HOME", self.run_home());

        // Apply per-process resource caps (CPU, AS, NOFILE, NPROC on Linux)
        // via `pre_exec` so a runaway agent can't fork-bomb / leak GB / open
        // a thousand fds before the wall-clock timeout fires. Best-effort:
        // any individual setrlimit failure is silent inside the child.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // SAFETY: pre_exec runs in the forked child between fork() and
            // execve(); only async-signal-safe libc calls happen here.
            unsafe {
                command.as_std_mut().pre_exec(apply_shell_rlimits);
            }
        }

        let child = command
            .spawn()
            .map_err(|e| SandboxError::Exec(format!("spawn {cmd}: {e}")))?;

        let wait = child.wait_with_output();
        match tokio::time::timeout(timeout, wait).await {
            Ok(Ok(output)) => {
                let (stdout, _truncated_out) = truncate_output(&output.stdout, SHELL_STDOUT_CAP);
                let (stderr, _truncated_err) = truncate_output(&output.stderr, SHELL_STDERR_CAP);
                Ok(ExecOutput {
                    stdout,
                    stderr,
                    exit_code: output.status.code(),
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(SandboxError::Exec(e.to_string())),
            Err(_) => Err(SandboxError::Timeout(timeout)),
        }
    }
}

#[cfg(test)]
impl LocalFsSandbox {
    /// Test-only thin wrapper so tests can call `resolve` without
    /// passing the (irrelevant for path-escape checks) existence flag.
    fn resolve_test_only(&self, rel: &str) -> Result<PathBuf, SandboxError> {
        self.resolve(rel, false)
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
            sb.resolve_test_only("/etc/passwd"),
            Err(SandboxError::PathEscape(_))
        ));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        assert!(matches!(
            sb.resolve_test_only("../../../etc/passwd"),
            Err(SandboxError::PathEscape(_))
        ));
    }

    #[test]
    fn resolve_accepts_normal_paths() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let r = sb.resolve_test_only("src/main.rs").unwrap();
        assert!(r.starts_with(sb.root()));
        assert!(r.ends_with("src/main.rs"));
    }

    #[test]
    fn resolve_normalises_dot_segments() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let r = sb.resolve_test_only("./a/./b/../c").unwrap();
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

    #[cfg(windows)]
    #[tokio::test]
    async fn exec_supports_windows_echo_builtin() {
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let out = sb
            .exec(
                "echo",
                &[String::from("Hello from the shell!")],
                Duration::from_secs(5),
            )
            .await
            .unwrap();
        assert_eq!(out.stdout.trim(), "Hello from the shell!");
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

    // --- symlink-escape battery (Unix only; Windows has its own
    // alternate-stream / NTFS-junction story that needs separate tests).

    #[cfg(unix)]
    #[tokio::test]
    async fn read_through_symlink_pointing_outside_root_rejected() {
        use std::os::unix::fs::symlink;
        let outside = std::env::temp_dir().join(format!("hive-outside-{}", rand_suffix()));
        std::fs::write(&outside, b"secret").unwrap();
        let root = tmp();
        let sb = LocalFsSandbox::new(&root).unwrap();
        // Plant a symlink inside the workspace pointing to `outside`.
        symlink(&outside, root.join("escape")).unwrap();
        let result = sb.read("escape").await;
        let _ = std::fs::remove_file(&outside);
        assert!(
            matches!(result, Err(SandboxError::PathEscape(_))),
            "expected PathEscape, got {result:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn write_target_that_is_a_symlink_rejected() {
        use std::os::unix::fs::symlink;
        let outside = std::env::temp_dir().join(format!("hive-target-{}", rand_suffix()));
        std::fs::write(&outside, b"original").unwrap();
        let root = tmp();
        let sb = LocalFsSandbox::new(&root).unwrap();
        symlink(&outside, root.join("victim")).unwrap();
        let result = sb.write("victim", b"clobbered").await;
        let after = std::fs::read(&outside).unwrap_or_default();
        let _ = std::fs::remove_file(&outside);
        assert!(
            matches!(result, Err(SandboxError::PathEscape(_))),
            "expected PathEscape, got {result:?}"
        );
        assert_eq!(after, b"original", "symlink target was clobbered");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn exec_does_not_leak_secret_env_vars() {
        // The parent process holds an "API key"; the sandbox must
        // strip it before invoking the child shell.
        std::env::set_var("HIVE_TEST_FAKE_KEY", "supersecret");
        let sb = LocalFsSandbox::new(tmp()).unwrap();
        let (cmd, args) = shell_command("echo $HIVE_TEST_FAKE_KEY");
        let out = sb.exec(&cmd, &args, Duration::from_secs(5)).await.unwrap();
        std::env::remove_var("HIVE_TEST_FAKE_KEY");
        assert!(
            !out.stdout.contains("supersecret"),
            "secret leaked into child stdout: {out:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_through_symlink_to_workspace_sibling_allowed() {
        // A symlink whose target stays inside the workspace is fine —
        // canonicalisation resolves it but it doesn't leave the root.
        use std::os::unix::fs::symlink;
        let root = tmp();
        let sb = LocalFsSandbox::new(&root).unwrap();
        sb.write("real.txt", b"ok").await.unwrap();
        symlink(root.join("real.txt"), root.join("alias")).unwrap();
        let bytes = sb.read("alias").await.unwrap();
        assert_eq!(bytes, b"ok");
    }
}
