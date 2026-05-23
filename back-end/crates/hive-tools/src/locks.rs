//! D2 — sandbox file-write lock registry.
//!
//! Each call to `fs_write` (or any future tool that mutates a sandbox
//! file) acquires a [`LockGuard`] for the duration of the I/O. The
//! [`SandboxLockRegistry`] is process-wide, shared via [`AppState`] and
//! [`ToolContext`], and lets the HiveGraph lock-overlay show which
//! agents currently hold a write on which file.
//!
//! RAII: dropping the guard removes the entry. If the write task panics
//! the guard's `Drop` still fires, so the lock can't leak.
//!
//! Memory: bounded by parallel in-flight writes — typically tiny. Each
//! entry is `(project_id, agent_id, path, taken_at)` strings.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

use serde::{Deserialize, Serialize};

/// One live file-write hold, surfaced to the frontend lock overlay.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockHandle {
    pub agent_id: String,
    /// Workspace-relative path being written.
    pub path: String,
    /// ISO-8601 timestamp the lock was taken — useful for the UI to
    /// detect "stuck" locks visually (long-running write).
    pub taken_at: String,
}

/// Process-wide registry of active sandbox file-write locks. Keyed by
/// project id so the per-project query is cheap.
#[derive(Default)]
pub struct SandboxLockRegistry {
    // Mutex (not RwLock) because acquires and releases mutate; reads are
    // small and infrequent (UI poll / endpoint hit) so a single mutex
    // is fine.
    inner: Mutex<HashMap<String, Vec<LockHandle>>>,
}

impl SandboxLockRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Take a lock. Returns a [`LockGuard`] that releases on drop.
    /// Multiple holds on the same path are allowed (the registry is a
    /// *visibility* map, not a mutual-exclusion lock — the file system
    /// itself serialises writes).
    pub fn acquire(
        self: &Arc<Self>,
        project_id: impl Into<String>,
        agent_id: impl Into<String>,
        path: impl Into<String>,
    ) -> LockGuard {
        let project_id = project_id.into();
        let handle = LockHandle {
            agent_id: agent_id.into(),
            path: path.into(),
            taken_at: chrono::Utc::now().to_rfc3339(),
        };
        let path_clone = handle.path.clone();
        let agent_clone = handle.agent_id.clone();
        if let Ok(mut map) = self.inner.lock() {
            map.entry(project_id.clone()).or_default().push(handle);
        }
        LockGuard {
            registry: Arc::downgrade(self),
            project_id,
            agent_id: agent_clone,
            path: path_clone,
        }
    }

    /// All active locks in a project, oldest first (insertion order).
    pub fn list_for_project(&self, project_id: &str) -> Vec<LockHandle> {
        self.inner
            .lock()
            .ok()
            .and_then(|m| m.get(project_id).cloned())
            .unwrap_or_default()
    }

    fn release(&self, project_id: &str, agent_id: &str, path: &str) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(list) = map.get_mut(project_id) {
                // Remove the first matching (agent, path) so two
                // concurrent locks on the same path don't leak — we
                // pop them in LIFO order.
                if let Some(pos) = list
                    .iter()
                    .rposition(|h| h.agent_id == agent_id && h.path == path)
                {
                    list.remove(pos);
                }
                if list.is_empty() {
                    map.remove(project_id);
                }
            }
        }
    }
}

/// RAII guard returned by [`SandboxLockRegistry::acquire`]. Dropping it
/// (normal return *or* panic unwind) removes the lock entry.
pub struct LockGuard {
    registry: Weak<SandboxLockRegistry>,
    project_id: String,
    agent_id: String,
    path: String,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        if let Some(reg) = self.registry.upgrade() {
            reg.release(&self.project_id, &self.agent_id, &self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release_via_drop() {
        let reg = SandboxLockRegistry::new();
        {
            let _g = reg.acquire("p1", "a1", "src/foo.rs");
            assert_eq!(reg.list_for_project("p1").len(), 1);
            let h = &reg.list_for_project("p1")[0];
            assert_eq!(h.agent_id, "a1");
            assert_eq!(h.path, "src/foo.rs");
        }
        assert!(reg.list_for_project("p1").is_empty());
    }

    #[test]
    fn parallel_holds_on_same_path_track_separately() {
        let reg = SandboxLockRegistry::new();
        let g1 = reg.acquire("p1", "a1", "x");
        let g2 = reg.acquire("p1", "a2", "x");
        assert_eq!(reg.list_for_project("p1").len(), 2);
        drop(g1);
        assert_eq!(reg.list_for_project("p1").len(), 1);
        // The remaining hold is `a2`'s.
        assert_eq!(reg.list_for_project("p1")[0].agent_id, "a2");
        drop(g2);
        assert!(reg.list_for_project("p1").is_empty());
    }

    #[test]
    fn projects_are_isolated() {
        let reg = SandboxLockRegistry::new();
        let _g1 = reg.acquire("p1", "a1", "x");
        let _g2 = reg.acquire("p2", "a1", "x");
        assert_eq!(reg.list_for_project("p1").len(), 1);
        assert_eq!(reg.list_for_project("p2").len(), 1);
        assert!(reg.list_for_project("p3").is_empty());
    }

    #[test]
    fn weak_ref_safe_when_registry_dropped() {
        // If the registry is dropped before the guard, dropping the
        // guard mustn't panic or upgrade a dangling Arc.
        let reg = SandboxLockRegistry::new();
        let g = reg.acquire("p1", "a1", "x");
        drop(reg);
        drop(g); // must not crash
    }
}
