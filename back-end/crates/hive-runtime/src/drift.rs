//! Runtime drift detectors.
//!
//! Phase 5 of the redesign exposes drift across three axes; this module
//! covers the deterministic, pure-logic half so a `DriftEvent` row can be
//! produced from a small input bundle without an LLM call.
//!
//! - [`score_task_drift`] — agent vs task. Computes a 0..1 score from
//!   how many of the spec section's expected anchors / keywords the
//!   agent has actually touched in its recent turns. Cheap to recompute;
//!   the runtime calls it after every `turn_driver` cycle and writes a
//!   `DriftEvent` only when the score crosses a configurable threshold
//!   (default 0.5 → "medium" severity, 0.8 → "high").
//!
//! - [`score_prompt_drift`] — agent vs system-prompt. Token-overlap
//!   between the system prompt's tag set and the agent's recent
//!   behaviour summary. OFF by default per the plan (the LLM-judge
//!   variant lands in a follow-up).
//!
//! - [`score_code_drift`] is the existing requirement-vs-spec check
//!   already partially wired in `SpecPlan` — promoted to this module
//!   so all three flavours speak the same scoring contract.
//!
//! Severity bands (reused across detectors): `< 0.4` low, `0.4..0.7`
//! medium, `>= 0.7` high. Tunable per-project via `settings`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Common bundle every detector returns. The runtime decides whether
/// to write a `DriftEvent` based on `score >= threshold`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftScore {
    pub score: f32,
    pub severity: DriftSeverity,
    /// Detector-specific evidence the UI can render verbatim — diff
    /// summaries, missing-tag lists, recent-turn excerpts, etc.
    pub evidence: serde_json::Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriftSeverity {
    Low,
    Medium,
    High,
}

impl DriftSeverity {
    /// Map a raw 0..1 score to a band.
    pub fn from_score(score: f32) -> Self {
        if score >= 0.7 {
            Self::High
        } else if score >= 0.4 {
            Self::Medium
        } else {
            Self::Low
        }
    }

    pub fn as_key(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

/// Default writeback threshold. Scores below this never produce a
/// `DriftEvent` row — they're noise that would just bury real signal.
pub const DEFAULT_DRIFT_THRESHOLD: f32 = 0.5;

// ─── score_task_drift ──────────────────────────────────────────────────

/// Per-detector input. Kept narrow so the runtime can build it from
/// state it already has — no extra DB roundtrips, no LLM calls.
pub struct TaskDriftInput<'a> {
    /// Anchors / file-paths / capability tags the linked spec section
    /// declared. Each entry is a string; tokenised and compared
    /// case-insensitively.
    pub expected_artifacts: &'a [String],
    /// Concrete artifacts the agent has actually touched in the recent
    /// turn window — file paths edited, tools invoked, anchor strings
    /// referenced. Same tokenisation as `expected_artifacts`.
    pub touched_artifacts: &'a [String],
}

/// Score how far an agent has drifted from its spec-section task.
///
/// Algorithm: compute the proportion of expected artifacts that *don't*
/// appear in the touched set. Drift = `1 - coverage`, where coverage is
/// `|expected ∩ touched| / |expected|`. When `expected` is empty there's
/// no contract to drift from, so the score is 0.
pub fn score_task_drift(input: TaskDriftInput<'_>) -> DriftScore {
    let expected = tokenise_set(input.expected_artifacts);
    if expected.is_empty() {
        return DriftScore {
            score: 0.0,
            severity: DriftSeverity::Low,
            evidence: serde_json::json!({ "reason": "no expected artifacts" }),
        };
    }
    let touched = tokenise_set(input.touched_artifacts);
    let covered: HashSet<_> = expected.intersection(&touched).cloned().collect();
    let missing: Vec<String> = expected.difference(&touched).cloned().collect();
    let coverage = covered.len() as f32 / expected.len() as f32;
    let score = (1.0 - coverage).clamp(0.0, 1.0);

    DriftScore {
        score,
        severity: DriftSeverity::from_score(score),
        evidence: serde_json::json!({
            "expectedCount": expected.len(),
            "touchedCount": touched.len(),
            "coverage": coverage,
            "missingArtifacts": missing,
        }),
    }
}

// ─── score_prompt_drift ───────────────────────────────────────────────

pub struct PromptDriftInput<'a> {
    /// Tags / responsibilities the system prompt declared. Typically
    /// extracted by tokenising the prompt's first paragraph; stub tests
    /// supply them directly.
    pub system_prompt_tags: &'a [String],
    /// Same shape from a windowed summary of the agent's recent turns.
    pub recent_behaviour_tags: &'a [String],
}

/// Score divergence between the system prompt and observed behaviour.
/// Token-overlap (Jaccard distance). Higher score = more drift.
pub fn score_prompt_drift(input: PromptDriftInput<'_>) -> DriftScore {
    let prompt = tokenise_set(input.system_prompt_tags);
    let behaviour = tokenise_set(input.recent_behaviour_tags);
    if prompt.is_empty() || behaviour.is_empty() {
        return DriftScore {
            score: 0.0,
            severity: DriftSeverity::Low,
            evidence: serde_json::json!({ "reason": "missing input side" }),
        };
    }
    let intersection = prompt.intersection(&behaviour).count();
    let union = prompt.union(&behaviour).count();
    let jaccard = intersection as f32 / union as f32;
    let score = (1.0 - jaccard).clamp(0.0, 1.0);
    DriftScore {
        score,
        severity: DriftSeverity::from_score(score),
        evidence: serde_json::json!({
            "promptTagCount": prompt.len(),
            "behaviourTagCount": behaviour.len(),
            "jaccard": jaccard,
        }),
    }
}

// ─── score_code_drift ─────────────────────────────────────────────────

pub struct CodeDriftInput<'a> {
    /// Hashed signature of the requirement (e.g. acceptance-criteria
    /// keywords). The detector treats them as opaque tokens.
    pub requirement_signature: &'a [String],
    /// Symbols / file paths that actually exist in the implementation.
    pub implementation_signature: &'a [String],
}

/// Score divergence between a requirement and the code that implements
/// it. Same mechanic as task drift: 1 - coverage.
pub fn score_code_drift(input: CodeDriftInput<'_>) -> DriftScore {
    score_task_drift(TaskDriftInput {
        expected_artifacts: input.requirement_signature,
        touched_artifacts: input.implementation_signature,
    })
}

// ─── helpers ───────────────────────────────────────────────────────────

fn tokenise_set(items: &[String]) -> HashSet<String> {
    let mut out = HashSet::new();
    for item in items {
        for tok in item.split(|c: char| !c.is_ascii_alphanumeric()) {
            if tok.is_empty() {
                continue;
            }
            out.insert(tok.to_ascii_lowercase());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    // ─── severity bands ────────────────────────────────────────────

    #[test]
    fn severity_bands_match_thresholds() {
        assert_eq!(DriftSeverity::from_score(0.0), DriftSeverity::Low);
        assert_eq!(DriftSeverity::from_score(0.39), DriftSeverity::Low);
        assert_eq!(DriftSeverity::from_score(0.4), DriftSeverity::Medium);
        assert_eq!(DriftSeverity::from_score(0.69), DriftSeverity::Medium);
        assert_eq!(DriftSeverity::from_score(0.7), DriftSeverity::High);
        assert_eq!(DriftSeverity::from_score(1.0), DriftSeverity::High);
    }

    // ─── task drift ────────────────────────────────────────────────

    #[test]
    fn task_drift_zero_when_all_expected_artifacts_touched() {
        let expected = vs(&["payments.rs", "auth/sso.rs"]);
        let touched = vs(&["payments.rs", "auth/sso.rs", "extra.rs"]);
        let drift = score_task_drift(TaskDriftInput {
            expected_artifacts: &expected,
            touched_artifacts: &touched,
        });
        assert_eq!(drift.score, 0.0);
        assert_eq!(drift.severity, DriftSeverity::Low);
    }

    #[test]
    fn task_drift_one_when_nothing_touched() {
        let expected = vs(&["payments.rs"]);
        let touched: Vec<String> = Vec::new();
        let drift = score_task_drift(TaskDriftInput {
            expected_artifacts: &expected,
            touched_artifacts: &touched,
        });
        assert_eq!(drift.score, 1.0);
        assert_eq!(drift.severity, DriftSeverity::High);
    }

    #[test]
    fn task_drift_partial_coverage_in_medium_band() {
        // 1 of 2 expected → coverage 0.5 → drift 0.5 → medium
        let expected = vs(&["alpha", "beta"]);
        let touched = vs(&["alpha"]);
        let drift = score_task_drift(TaskDriftInput {
            expected_artifacts: &expected,
            touched_artifacts: &touched,
        });
        assert!((drift.score - 0.5).abs() < 1e-6);
        assert_eq!(drift.severity, DriftSeverity::Medium);
        // Evidence enumerates the gap so the UI can show it.
        let missing = drift.evidence["missingArtifacts"].as_array().unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].as_str(), Some("beta"));
    }

    #[test]
    fn task_drift_no_expected_means_no_contract_means_no_drift() {
        let drift = score_task_drift(TaskDriftInput {
            expected_artifacts: &[],
            touched_artifacts: &vs(&["whatever"]),
        });
        assert_eq!(drift.score, 0.0);
        assert!(drift.evidence.get("reason").is_some());
    }

    #[test]
    fn task_drift_tokenisation_is_punctuation_aware() {
        // `auth/sso.rs` and `auth/sso.rs` should match cleanly even when
        // surrounded by different punctuation in the inputs.
        let expected = vs(&["auth/sso.rs"]);
        let touched = vs(&["auth-sso-rs"]);
        let drift = score_task_drift(TaskDriftInput {
            expected_artifacts: &expected,
            touched_artifacts: &touched,
        });
        assert_eq!(drift.score, 0.0, "token forms compare as equivalent");
    }

    // ─── prompt drift ──────────────────────────────────────────────

    #[test]
    fn prompt_drift_zero_when_behaviour_mirrors_prompt() {
        let prompt = vs(&["frontend", "react", "ui"]);
        let drift = score_prompt_drift(PromptDriftInput {
            system_prompt_tags: &prompt,
            recent_behaviour_tags: &prompt,
        });
        assert_eq!(drift.score, 0.0);
    }

    #[test]
    fn prompt_drift_one_when_nothing_in_common() {
        let prompt = vs(&["frontend"]);
        let behaviour = vs(&["backend"]);
        let drift = score_prompt_drift(PromptDriftInput {
            system_prompt_tags: &prompt,
            recent_behaviour_tags: &behaviour,
        });
        assert_eq!(drift.score, 1.0);
        assert_eq!(drift.severity, DriftSeverity::High);
    }

    #[test]
    fn prompt_drift_empty_either_side_returns_zero() {
        let drift = score_prompt_drift(PromptDriftInput {
            system_prompt_tags: &vs(&["a"]),
            recent_behaviour_tags: &[],
        });
        assert_eq!(drift.score, 0.0);
    }

    // ─── code drift ────────────────────────────────────────────────

    #[test]
    fn code_drift_uses_same_mechanic_as_task_drift() {
        let req = vs(&["UserModel", "AuthService"]);
        let impl_ = vs(&["UserModel"]);
        let task = score_task_drift(TaskDriftInput {
            expected_artifacts: &req,
            touched_artifacts: &impl_,
        });
        let code = score_code_drift(CodeDriftInput {
            requirement_signature: &req,
            implementation_signature: &impl_,
        });
        assert_eq!(task.score, code.score);
        assert_eq!(task.severity, code.severity);
    }

    #[test]
    fn drift_threshold_constant_is_stable_for_settings_payloads() {
        // Settings rows persist this; locking the literal here means a
        // future "let's tune to 0.45" change is visible at review time.
        assert_eq!(DEFAULT_DRIFT_THRESHOLD, 0.5);
    }
}
