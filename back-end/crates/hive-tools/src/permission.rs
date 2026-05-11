//! Capability-class permission matrix for tools.
//!
//! Phase 0c of the harness redesign. The matrix is a small, ordered table
//! that says, for each action class an agent could attempt, what should
//! happen: `Allow` (run), `Ask` (block until a human approves), or
//! `Deny` (refuse without asking).
//!
//! Three default profiles match the OpenCode pattern:
//! - `plan`: everything read-only, only writes inside `.hive/plans/*.md`
//! - `build`: default workshop profile — `ask` for shell.exec / writes outside `src/`
//! - `explore`: strictly read-only
//!
//! The matrix lives on `ToolContext`. Tools call
//! `ctx.permissions().decide(class, target)` before performing privileged
//! work; the runtime will lift `Ask` into the SSE-based approval flow in
//! Phase 0c-bis (the lift is intentionally deferred so the matrix can land
//! today and exercise the data model without taking on the runtime
//! plumbing in the same change).

use serde::{Deserialize, Serialize};

/// A coarse class of action a tool might perform. Per-tool overrides can
/// further narrow this — see [`PermissionMatrix::override_tool`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActionClass {
    /// Read a file from the project workspace.
    FsRead,
    /// Modify or create a file in the project workspace.
    FsWrite,
    /// Run an arbitrary shell command (host process, sandboxed by
    /// `hive-sandbox`).
    ShellExec,
    /// Outbound HTTP fetch from the runtime.
    NetFetch,
    /// Spawn a child agent.
    AgentSpawn,
    /// Call a tool exposed by an MCP server (custom or shared connector).
    McpCall,
}

impl ActionClass {
    /// Stable identifier used in serialised form and matrix keys.
    pub fn as_key(self) -> &'static str {
        match self {
            Self::FsRead => "fs.read",
            Self::FsWrite => "fs.write",
            Self::ShellExec => "shell.exec",
            Self::NetFetch => "net.fetch",
            Self::AgentSpawn => "agent.spawn",
            Self::McpCall => "mcp.call",
        }
    }
}

/// What the matrix decides for a given (class, optional target) pair.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionDecision {
    /// Tool may proceed without involving the user.
    Allow,
    /// Tool must wait for explicit human approval. Today the runtime
    /// surfaces `Ask` as a structured "blocked" tool result so the
    /// agent state machine can transition to `awaiting-authorization`;
    /// follow-up work routes it through the SSE oneshot approval channel.
    Ask,
    /// Tool must refuse without asking. The agent sees a structured
    /// error and is expected to self-correct.
    Deny,
}

/// Glob-shaped per-tool override. Matches against the tool name (e.g.
/// `"shell_exec"`, `"fs_write"`). The first override whose pattern
/// matches wins; otherwise the matrix falls back to the class default.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolOverride {
    /// Tool name (exact match for now; wildcard support is a follow-up).
    pub tool: String,
    pub class: ActionClass,
    pub decision: PermissionDecision,
}

/// Concrete decision matrix. Cheap to clone; one per `ToolContext`.
#[derive(Clone, Debug)]
pub struct PermissionMatrix {
    profile: &'static str,
    /// Class-level defaults; key by `ActionClass::as_key()`.
    defaults: Vec<(ActionClass, PermissionDecision)>,
    /// First-match-wins overrides.
    overrides: Vec<ToolOverride>,
}

impl PermissionMatrix {
    /// Profile name (`"plan"`, `"build"`, `"explore"`, or a custom string)
    /// for diagnostics.
    pub fn profile(&self) -> &'static str {
        self.profile
    }

    /// Build a matrix from a list of class defaults and overrides. Useful
    /// for constructing custom profiles in tests or per-agent settings.
    pub fn custom(
        profile: &'static str,
        defaults: Vec<(ActionClass, PermissionDecision)>,
        overrides: Vec<ToolOverride>,
    ) -> Self {
        Self {
            profile,
            defaults,
            overrides,
        }
    }

    /// Add or replace a class default after construction.
    pub fn set_default(mut self, class: ActionClass, decision: PermissionDecision) -> Self {
        if let Some(slot) = self.defaults.iter_mut().find(|(c, _)| *c == class) {
            slot.1 = decision;
        } else {
            self.defaults.push((class, decision));
        }
        self
    }

    /// Append a per-tool override. Earlier overrides win on conflict, so
    /// callers should add the most specific override first.
    pub fn override_tool(
        mut self,
        tool: impl Into<String>,
        class: ActionClass,
        decision: PermissionDecision,
    ) -> Self {
        self.overrides.push(ToolOverride {
            tool: tool.into(),
            class,
            decision,
        });
        self
    }

    /// Decide for a given tool name + class. Returns `Allow` when nothing
    /// matches — the matrix is opt-in restrictive, never opt-in
    /// permissive, but a class with no entry behaves as the most lenient
    /// reasonable default for backwards compatibility with existing tools.
    pub fn decide(&self, tool: &str, class: ActionClass) -> PermissionDecision {
        for ov in &self.overrides {
            if ov.tool == tool && ov.class == class {
                return ov.decision;
            }
        }
        for (c, d) in &self.defaults {
            if *c == class {
                return *d;
            }
        }
        PermissionDecision::Allow
    }

    /// Profile: `"plan"` — everything read-only, writes restricted to
    /// `.hive/plans/*.md`. Mirrors OpenCode's plan agent.
    pub fn plan() -> Self {
        Self::custom(
            "plan",
            vec![
                (ActionClass::FsRead, PermissionDecision::Allow),
                (ActionClass::FsWrite, PermissionDecision::Deny),
                (ActionClass::ShellExec, PermissionDecision::Deny),
                (ActionClass::NetFetch, PermissionDecision::Allow),
                (ActionClass::AgentSpawn, PermissionDecision::Deny),
                (ActionClass::McpCall, PermissionDecision::Allow),
            ],
            // The runtime has no way to glob-check the path here yet —
            // surface plans-only writes as `Ask` and let the operator
            // confirm. Tightening to path-aware allow lives with the
            // sandbox refactor in Phase 0c-bis.
            vec![],
        )
    }

    /// Profile: `"build"` — workshop default. Ask for shell + writes; the
    /// fs/net read paths are wide open.
    pub fn build() -> Self {
        Self::custom(
            "build",
            vec![
                (ActionClass::FsRead, PermissionDecision::Allow),
                (ActionClass::FsWrite, PermissionDecision::Ask),
                (ActionClass::ShellExec, PermissionDecision::Ask),
                (ActionClass::NetFetch, PermissionDecision::Allow),
                (ActionClass::AgentSpawn, PermissionDecision::Ask),
                (ActionClass::McpCall, PermissionDecision::Allow),
            ],
            vec![],
        )
    }

    /// Profile: `"explore"` — strict read-only.
    pub fn explore() -> Self {
        Self::custom(
            "explore",
            vec![
                (ActionClass::FsRead, PermissionDecision::Allow),
                (ActionClass::FsWrite, PermissionDecision::Deny),
                (ActionClass::ShellExec, PermissionDecision::Deny),
                (ActionClass::NetFetch, PermissionDecision::Allow),
                (ActionClass::AgentSpawn, PermissionDecision::Deny),
                (ActionClass::McpCall, PermissionDecision::Allow),
            ],
            vec![],
        )
    }

    /// Backwards-compat profile that allows everything. Used as the
    /// default when no profile is specified so existing agents keep
    /// working until the matrix is wired into per-agent settings.
    pub fn unrestricted() -> Self {
        Self::custom(
            "unrestricted",
            vec![
                (ActionClass::FsRead, PermissionDecision::Allow),
                (ActionClass::FsWrite, PermissionDecision::Allow),
                (ActionClass::ShellExec, PermissionDecision::Allow),
                (ActionClass::NetFetch, PermissionDecision::Allow),
                (ActionClass::AgentSpawn, PermissionDecision::Allow),
                (ActionClass::McpCall, PermissionDecision::Allow),
            ],
            vec![],
        )
    }
}

impl Default for PermissionMatrix {
    fn default() -> Self {
        Self::unrestricted()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unspecified_class_falls_back_to_allow() {
        // `unrestricted` *does* specify every class, but custom matrices
        // built without a class entry shouldn't accidentally deny.
        let m = PermissionMatrix::custom("partial", vec![], vec![]);
        assert_eq!(
            m.decide("anything", ActionClass::FsWrite),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn plan_profile_denies_writes_and_shell_but_allows_reads() {
        let m = PermissionMatrix::plan();
        assert_eq!(m.profile(), "plan");
        assert_eq!(
            m.decide("fs_read", ActionClass::FsRead),
            PermissionDecision::Allow
        );
        assert_eq!(
            m.decide("fs_write", ActionClass::FsWrite),
            PermissionDecision::Deny
        );
        assert_eq!(
            m.decide("shell_exec", ActionClass::ShellExec),
            PermissionDecision::Deny
        );
    }

    #[test]
    fn build_profile_asks_for_writes_and_shell() {
        let m = PermissionMatrix::build();
        assert_eq!(
            m.decide("shell_exec", ActionClass::ShellExec),
            PermissionDecision::Ask
        );
        assert_eq!(
            m.decide("fs_write", ActionClass::FsWrite),
            PermissionDecision::Ask
        );
        assert_eq!(
            m.decide("fs_read", ActionClass::FsRead),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn explore_profile_denies_everything_writeable() {
        let m = PermissionMatrix::explore();
        for class in [
            ActionClass::FsWrite,
            ActionClass::ShellExec,
            ActionClass::AgentSpawn,
        ] {
            assert_eq!(m.decide("any", class), PermissionDecision::Deny);
        }
    }

    #[test]
    fn per_tool_override_beats_class_default() {
        let m = PermissionMatrix::build()
            // A specific shell tool the operator has audited and trusts.
            .override_tool("shell_exec_audited", ActionClass::ShellExec, PermissionDecision::Allow);
        assert_eq!(
            m.decide("shell_exec", ActionClass::ShellExec),
            PermissionDecision::Ask
        );
        assert_eq!(
            m.decide("shell_exec_audited", ActionClass::ShellExec),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn first_override_wins_on_duplicate() {
        // Document the ordering contract — earlier overrides take
        // precedence so callers can layer specific-then-general.
        let m = PermissionMatrix::custom("test", vec![], vec![])
            .override_tool("t", ActionClass::FsRead, PermissionDecision::Allow)
            .override_tool("t", ActionClass::FsRead, PermissionDecision::Deny);
        assert_eq!(
            m.decide("t", ActionClass::FsRead),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn action_class_keys_are_stable() {
        // The keys flow into JSON / config; if these ever change we'd
        // silently break user settings. Lock them down here.
        assert_eq!(ActionClass::FsRead.as_key(), "fs.read");
        assert_eq!(ActionClass::FsWrite.as_key(), "fs.write");
        assert_eq!(ActionClass::ShellExec.as_key(), "shell.exec");
        assert_eq!(ActionClass::NetFetch.as_key(), "net.fetch");
        assert_eq!(ActionClass::AgentSpawn.as_key(), "agent.spawn");
        assert_eq!(ActionClass::McpCall.as_key(), "mcp.call");
    }
}
