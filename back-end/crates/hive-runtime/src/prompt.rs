//! Layered system-prompt composer.
//!
//! Phase 0c of the redesign: replace the ad-hoc `system_prompt + 2-line
//! blurb + tool dump` with a deterministic four-layer composer. The first
//! two layers (immutable agent prompt + tool catalog) are byte-identical
//! across turns when nothing about the agent changes, which makes
//! provider prompt caching effective. The third layer is project memory
//! walked from `~/.config/hive/HIVE.md` outward, pattern-matching what
//! Codex does with `AGENTS.md` and Claude Code does with `CLAUDE.md`.
//! The fourth layer is live reminders that may change every turn (current
//! task, open drift events, etc.) — placed last so the cache prefix
//! upstream survives.
//!
//! The composer is intentionally **format-agnostic** about the tool
//! catalog: it consumes the same string `tool_protocol_prompt` already
//! produced, so callers don't have to touch their tool plumbing.

use std::path::{Path, PathBuf};

/// Maximum bytes read from any single `HIVE.md` file. Catches accidentally
/// committed novellas without forcing the operator to think about it.
const HIVE_MD_MAX_BYTES: u64 = 64 * 1024;

/// Newline-separated section delimiter. Two blank lines between layers
/// keeps each one visually distinct in logs and survives most tokenisers
/// without weird splits.
const LAYER_SEP: &str = "\n\n";

/// One composed system prompt, returned to the caller as a single
/// `String`. The struct is private; callers see [`PromptComposer::build`].
#[derive(Default)]
pub struct PromptComposer {
    /// Layer 1 — agent identity / role / persona. Immutable for the
    /// lifetime of the agent. Whatever the caller had in `system_prompt`
    /// before lands here.
    agent_prompt: Option<String>,
    /// Layer 2 — tool catalog block. Already deterministic via the
    /// registry's `BTreeMap` ordering; the composer just hosts the string.
    tool_catalog: Option<String>,
    /// Layer 3 — concatenated `HIVE.md` snippets (root → project → cwd
    /// order, with `.override.md` semantics applied per directory).
    project_memory: Option<String>,
    /// Layer 4 — turn-local reminders. Multiple chunks are joined with
    /// blank lines so they read as a bullet list.
    reminders: Vec<String>,
}

impl PromptComposer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Layer 1. `None` or whitespace-only is ignored.
    pub fn with_agent_prompt(mut self, s: Option<String>) -> Self {
        if let Some(s) = s {
            if !s.trim().is_empty() {
                self.agent_prompt = Some(s);
            }
        }
        self
    }

    /// Layer 2. Pass the already-formatted catalog block. Empty strings
    /// drop the layer.
    pub fn with_tool_catalog(mut self, s: Option<String>) -> Self {
        if let Some(s) = s {
            if !s.trim().is_empty() {
                self.tool_catalog = Some(s);
            }
        }
        self
    }

    /// Layer 3. Walk for `HIVE.md` files starting from a given root
    /// (typically the project's `data_dir / "projects" / project_id`),
    /// optionally augmented with the user-global file at
    /// `~/.config/hive/HIVE.md`. Order: global → root → subdirs of root
    /// in lexicographic order, with each level's `HIVE.override.md`
    /// completely replacing the parent's `HIVE.md` when present.
    ///
    /// Errors reading individual files are logged at `warn` and skipped:
    /// a missing or unreadable `HIVE.md` must never fail an LLM turn.
    pub fn with_hive_memory(mut self, project_root: Option<&Path>) -> Self {
        let mut blocks = Vec::new();

        if let Some(global) = global_hive_md_path() {
            if let Some(content) = read_capped(&global) {
                blocks.push(format!("# {}\n\n{}", global.display(), content));
            }
        }

        if let Some(root) = project_root {
            if let Some((path, content)) = walk_hive_md(root) {
                blocks.push(format!("# {}\n\n{}", path.display(), content));
            }
        }

        if !blocks.is_empty() {
            self.project_memory = Some(blocks.join(LAYER_SEP));
        }
        self
    }

    /// Layer 4. Each call appends one reminder block; final composition
    /// joins them with a blank line. Empty strings are ignored.
    pub fn add_reminder(mut self, s: impl Into<String>) -> Self {
        let s = s.into();
        if !s.trim().is_empty() {
            self.reminders.push(s);
        }
        self
    }

    /// Final assembly. Returns `None` when every layer is empty so the
    /// caller can skip emitting a system message altogether.
    pub fn build(self) -> Option<String> {
        let mut parts: Vec<String> = Vec::new();
        if let Some(s) = self.agent_prompt {
            parts.push(s);
        }
        if let Some(s) = self.tool_catalog {
            parts.push(s);
        }
        if let Some(s) = self.project_memory {
            parts.push(s);
        }
        if !self.reminders.is_empty() {
            parts.push(self.reminders.join("\n\n"));
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join(LAYER_SEP))
        }
    }
}

/// Resolve `~/.config/hive/HIVE.md`. Returns `None` when `$HOME` is
/// unavailable (e.g. tests running with a stripped env).
fn global_hive_md_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let p = PathBuf::from(home).join(".config").join("hive").join("HIVE.md");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Read at most `HIVE_MD_MAX_BYTES` of `path`. Logs and returns `None`
/// on error or empty file.
fn read_capped(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| tracing::warn!(path = %path.display(), error = %e, "hive.md open failed"))
        .ok()?;
    let mut buf = Vec::with_capacity(HIVE_MD_MAX_BYTES as usize);
    let _ = file
        .by_ref()
        .take(HIVE_MD_MAX_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| tracing::warn!(path = %path.display(), error = %e, "hive.md read failed"))
        .ok()?;
    if buf.is_empty() {
        return None;
    }
    let s = String::from_utf8_lossy(&buf).into_owned();
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Resolve the effective `HIVE.md` for `root`. `HIVE.override.md` in the
/// same directory takes precedence over `HIVE.md`.
fn walk_hive_md(root: &Path) -> Option<(PathBuf, String)> {
    let override_path = root.join("HIVE.override.md");
    if override_path.exists() {
        if let Some(content) = read_capped(&override_path) {
            return Some((override_path, content));
        }
    }
    let primary = root.join("HIVE.md");
    if primary.exists() {
        if let Some(content) = read_capped(&primary) {
            return Some((primary, content));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    /// Lightweight tmp directory: avoids adding `tempfile` as a dep.
    /// Inner module is private to tests so the helper isn't shipped.
    struct Tmp {
        path: PathBuf,
    }
    impl Tmp {
        fn new() -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("hive-prompt-test-{}", ulid::Ulid::new()));
            fs::create_dir_all(&p).unwrap();
            Self { path: p }
        }
        fn write(&self, name: &str, body: &str) -> PathBuf {
            let full = self.path.join(name);
            let mut f = fs::File::create(&full).unwrap();
            f.write_all(body.as_bytes()).unwrap();
            full
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn empty_composer_returns_none() {
        assert!(PromptComposer::new().build().is_none());
    }

    #[test]
    fn whitespace_inputs_are_skipped() {
        let out = PromptComposer::new()
            .with_agent_prompt(Some("   \n\t".into()))
            .with_tool_catalog(Some(String::new()))
            .add_reminder("")
            .build();
        assert!(out.is_none());
    }

    #[test]
    fn layers_join_in_canonical_order() {
        let out = PromptComposer::new()
            .with_agent_prompt(Some("AGENT".into()))
            .with_tool_catalog(Some("TOOLS".into()))
            .add_reminder("REM1")
            .add_reminder("REM2")
            .build()
            .expect("non-empty");
        // Order: agent → tools → memory (none here) → reminders
        let agent_idx = out.find("AGENT").unwrap();
        let tools_idx = out.find("TOOLS").unwrap();
        let rem_idx = out.find("REM1").unwrap();
        assert!(agent_idx < tools_idx, "agent before tools");
        assert!(tools_idx < rem_idx, "tools before reminders");
        assert!(out.contains("REM1\n\nREM2"), "reminders concatenated");
    }

    #[test]
    fn cache_prefix_is_stable_when_only_reminders_change() {
        let prefix_a = PromptComposer::new()
            .with_agent_prompt(Some("AGENT".into()))
            .with_tool_catalog(Some("TOOLS".into()))
            .add_reminder("first reminder")
            .build()
            .unwrap();
        let prefix_b = PromptComposer::new()
            .with_agent_prompt(Some("AGENT".into()))
            .with_tool_catalog(Some("TOOLS".into()))
            .add_reminder("different reminder")
            .build()
            .unwrap();

        // The bytes BEFORE the reminder section must be identical so
        // upstream prompt caching hits.
        let split_a = prefix_a.find("first reminder").unwrap();
        let split_b = prefix_b.find("different reminder").unwrap();
        assert_eq!(split_a, split_b, "reminder offsets match");
        assert_eq!(&prefix_a[..split_a], &prefix_b[..split_b]);
    }

    #[test]
    fn hive_md_layer_includes_file_when_present() {
        let tmp = Tmp::new();
        tmp.write("HIVE.md", "Project-level rules.");
        let out = PromptComposer::new()
            .with_agent_prompt(Some("AGENT".into()))
            .with_hive_memory(Some(&tmp.path))
            .build()
            .unwrap();
        assert!(out.contains("Project-level rules."));
        assert!(out.contains("HIVE.md"), "header includes file path for traceability");
    }

    #[test]
    fn override_takes_precedence_over_hive_md() {
        let tmp = Tmp::new();
        tmp.write("HIVE.md", "BASE");
        tmp.write("HIVE.override.md", "OVERRIDE");
        let out = PromptComposer::new()
            .with_hive_memory(Some(&tmp.path))
            .build()
            .unwrap();
        assert!(out.contains("OVERRIDE"));
        // Base is replaced, not appended.
        assert!(!out.contains("BASE"));
    }

    #[test]
    fn missing_hive_md_is_silent_no_op() {
        let tmp = Tmp::new();
        let out = PromptComposer::new()
            .with_agent_prompt(Some("AGENT".into()))
            .with_hive_memory(Some(&tmp.path))
            .build()
            .unwrap();
        assert!(out.contains("AGENT"));
        // Nothing about hive.md leaks when the file isn't there.
        assert!(!out.contains("HIVE.md"));
    }

    #[test]
    fn oversize_hive_md_is_capped_not_truncated_at_boundary() {
        let tmp = Tmp::new();
        let mut huge = "X".repeat((HIVE_MD_MAX_BYTES + 1024) as usize);
        huge.push_str("\nFOOTER");
        tmp.write("HIVE.md", &huge);
        let out = PromptComposer::new()
            .with_hive_memory(Some(&tmp.path))
            .build()
            .unwrap();
        // Footer past the cap must be dropped; the cap is a quiet safety
        // net, not an error.
        assert!(!out.contains("FOOTER"));
        // We did read the prefix (so the cap is a soft limit, not a refusal).
        assert!(out.contains("XXX"));
    }
}
