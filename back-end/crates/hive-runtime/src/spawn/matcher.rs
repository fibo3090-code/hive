//! Capability matcher for the auto-spawn pipeline.
//!
//! Phase 4 step `matching-existing-mcp`: given a set of capabilities the
//! parent agent wants the child to have, decide which existing MCP
//! servers, skills, or connectors already cover them. Anything matched
//! short-circuits the expensive research + synthesis stages.
//!
//! ## Why pure logic first
//!
//! The plan calls for embedding-based matching down the line, but that
//! pulls in a model and a vector store. A deterministic Jaccard-token
//! matcher gives us:
//!
//!   - immediate, testable correctness for the obvious cases
//!     ("weather-fetch" capability vs. a connector tagged "weather"
//!     resolves trivially);
//!   - a stable contract — `(capability, candidate) -> Option<MatchScore>`
//!     — that an embedding implementation can drop in without
//!     renegotiating the spawn pipeline;
//!   - fail-soft semantics: a worse match still works, only at the cost
//!     of more synthesis.
//!
//! ## Match score
//!
//! [`Jaccard`] tokenises both sides on `[a-z0-9]` runs (lowercased,
//! dehyphenated) and scores `|A ∩ B| / |A ∪ B|`. The default acceptance
//! threshold is `0.6` — picked to admit `"weather-fetch" ↔ "weather"`
//! (`|{weather}| / |{weather, fetch}| = 0.5`, so we set the bar a bit
//! lower than that to actually catch it; tunable per-request).

use std::collections::HashSet;

/// A reusable surface (Skill, MCP-Connector, CustomMcpServer) that the
/// matcher can attribute capabilities to. Carrying the kind alongside
/// the id lets the planner build `AgentMcpBinding` rows directly from
/// matcher output without re-querying the DB.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub id: String,
    pub kind: CandidateKind,
    /// Human-readable name; included in match scoring as a fallback when
    /// the candidate has no explicit capability tags (typical of legacy
    /// rows imported from the seed data).
    pub name: String,
    /// Capability tags the candidate advertises. Lowercased at insert
    /// time but the matcher re-tokenises defensively.
    pub capabilities: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateKind {
    /// Reusable skill (`hive_db::entities::skill`).
    Skill,
    /// Project-shared MCP via `hive_db::entities::connector` with `kind="mcp"`.
    Connector,
    /// Generated server in `hive_db::entities::custom_mcp_server`.
    CustomMcp,
}

/// Result of matching a single capability. `Some(_)` when at least one
/// candidate clears the threshold; the best score wins (ties broken by
/// candidate order).
#[derive(Clone, Debug, PartialEq)]
pub struct MatchHit {
    pub capability: String,
    pub candidate_id: String,
    pub candidate_kind: CandidateKind,
    pub score: f32,
}

/// Aggregate matcher output: which capabilities resolved (and to what)
/// and which need synthesis.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MatchPlan {
    pub matches: Vec<MatchHit>,
    pub unmatched: Vec<String>,
}

impl MatchPlan {
    pub fn fully_matched(&self) -> bool {
        self.unmatched.is_empty() && !self.matches.is_empty()
    }
}

/// Threshold tuning. Defaults are conservative for the backstop matcher;
/// the embedding matcher will likely use higher thresholds.
#[derive(Clone, Copy, Debug)]
pub struct MatcherConfig {
    /// Minimum Jaccard score for a candidate to be considered a match.
    pub min_score: f32,
    /// Whether to score against the candidate's `name` when its
    /// `capabilities` list is empty. Off makes legacy rows invisible to
    /// the matcher; on lets us migrate without backfilling tags.
    pub fall_back_to_name: bool,
}

impl Default for MatcherConfig {
    fn default() -> Self {
        Self {
            // 0.5 admits `"weather"` ↔ `"weather-fetch"` (1/2). Below
            // that, single-token vs. compound capabilities start
            // bleeding into noise.
            min_score: 0.5,
            fall_back_to_name: true,
        }
    }
}

/// Tokenise on runs of `[a-z0-9]+`, lowercased.
fn tokenise(s: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut buf = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                buf.push(c);
            }
        } else if !buf.is_empty() {
            out.insert(std::mem::take(&mut buf));
        }
    }
    if !buf.is_empty() {
        out.insert(buf);
    }
    out
}

fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let intersection: usize = a.intersection(b).count();
    let union: usize = a.union(b).count();
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

/// Score one capability against one candidate. Considers every
/// capability tag on the candidate and takes the best individual
/// Jaccard; falls back to the candidate's name when no tags are present
/// and the config allows it. Returns `0.0` when nothing matches.
pub fn score_candidate(capability: &str, candidate: &Candidate, cfg: MatcherConfig) -> f32 {
    let cap_tokens = tokenise(capability);
    if cap_tokens.is_empty() {
        return 0.0;
    }

    let mut best: f32 = 0.0;
    for tag in &candidate.capabilities {
        let s = jaccard(&cap_tokens, &tokenise(tag));
        if s > best {
            best = s;
        }
    }

    if best == 0.0 && cfg.fall_back_to_name && candidate.capabilities.is_empty() {
        best = jaccard(&cap_tokens, &tokenise(&candidate.name));
    }

    best
}

/// Match every requested capability against a pool of candidates.
///
/// Output preserves the order of `capabilities`. Each capability either
/// produces a single `MatchHit` (the highest-scoring candidate that
/// clears `cfg.min_score`, ties broken by candidate-list order) or is
/// returned in `unmatched`. A candidate may match more than one
/// capability — re-binding is fine since the spawn pipeline collapses
/// duplicates downstream.
pub fn match_capabilities(
    capabilities: &[String],
    candidates: &[Candidate],
    cfg: MatcherConfig,
) -> MatchPlan {
    let mut matches = Vec::new();
    let mut unmatched = Vec::new();

    for cap in capabilities {
        if cap.trim().is_empty() {
            continue;
        }
        let mut best: Option<(f32, &Candidate)> = None;
        for cand in candidates {
            let score = score_candidate(cap, cand, cfg);
            if score < cfg.min_score {
                continue;
            }
            // Strictly-greater preserves the first-occurrence tiebreak.
            if best.map(|(s, _)| score > s).unwrap_or(true) {
                best = Some((score, cand));
            }
        }
        match best {
            Some((score, cand)) => matches.push(MatchHit {
                capability: cap.clone(),
                candidate_id: cand.id.clone(),
                candidate_kind: cand.kind,
                score,
            }),
            None => unmatched.push(cap.clone()),
        }
    }

    MatchPlan { matches, unmatched }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, name: &str, caps: &[&str], kind: CandidateKind) -> Candidate {
        Candidate {
            id: id.to_owned(),
            kind,
            name: name.to_owned(),
            capabilities: caps.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    #[test]
    fn tokenise_strips_punctuation_and_lowercases() {
        let toks = tokenise("Weather-Fetch_v2!");
        assert!(toks.contains("weather"));
        assert!(toks.contains("fetch"));
        assert!(toks.contains("v2"));
        assert_eq!(toks.len(), 3);
    }

    #[test]
    fn tokenise_empty_input_is_empty() {
        assert!(tokenise("").is_empty());
        assert!(tokenise("---").is_empty());
    }

    #[test]
    fn jaccard_identical_sets_score_1() {
        let a = tokenise("weather");
        assert_eq!(jaccard(&a, &a), 1.0);
    }

    #[test]
    fn jaccard_disjoint_sets_score_0() {
        let a = tokenise("weather");
        let b = tokenise("payments");
        assert_eq!(jaccard(&a, &b), 0.0);
    }

    #[test]
    fn score_compound_against_atomic_tag() {
        // "weather" tag covers "weather-fetch" capability at 0.5
        // (1 of 2 tokens overlap).
        let c = cand("c1", "Weather API", &["weather"], CandidateKind::Connector);
        let s = score_candidate("weather-fetch", &c, MatcherConfig::default());
        assert!((s - 0.5).abs() < f32::EPSILON, "got {s}");
    }

    #[test]
    fn matcher_picks_highest_scoring_candidate() {
        let caps = vec!["weather-fetch".to_owned()];
        // Loose: name-only match.
        let weak = cand("loose", "Weather Service", &[], CandidateKind::Connector);
        // Tight: exact tag.
        let strong = cand(
            "tight",
            "Other",
            &["weather-fetch"],
            CandidateKind::CustomMcp,
        );
        let plan = match_capabilities(&caps, &[weak, strong], MatcherConfig::default());
        assert_eq!(plan.matches.len(), 1);
        assert_eq!(plan.matches[0].candidate_id, "tight");
        assert_eq!(plan.matches[0].candidate_kind, CandidateKind::CustomMcp);
    }

    #[test]
    fn matcher_first_occurrence_breaks_ties() {
        let caps = vec!["weather".to_owned()];
        let a = cand("first", "first", &["weather"], CandidateKind::Skill);
        let b = cand("second", "second", &["weather"], CandidateKind::Skill);
        let plan = match_capabilities(&caps, &[a, b], MatcherConfig::default());
        assert_eq!(plan.matches.len(), 1);
        assert_eq!(plan.matches[0].candidate_id, "first");
    }

    #[test]
    fn unmatched_capabilities_surface_as_unmatched() {
        let caps = vec!["weather".to_owned(), "geocoding".to_owned()];
        let only_weather = cand("c1", "Weather", &["weather"], CandidateKind::Connector);
        let plan = match_capabilities(&caps, &[only_weather], MatcherConfig::default());
        assert_eq!(plan.matches.len(), 1);
        assert_eq!(plan.matches[0].capability, "weather");
        assert_eq!(plan.unmatched, vec!["geocoding".to_owned()]);
        assert!(!plan.fully_matched());
    }

    #[test]
    fn fully_matched_when_all_capabilities_resolve() {
        let caps = vec!["weather".to_owned(), "geo".to_owned()];
        let cands = vec![
            cand("c1", "W", &["weather"], CandidateKind::Connector),
            cand("c2", "G", &["geo"], CandidateKind::CustomMcp),
        ];
        let plan = match_capabilities(&caps, &cands, MatcherConfig::default());
        assert!(plan.fully_matched());
        assert_eq!(plan.matches.len(), 2);
        assert!(plan.unmatched.is_empty());
    }

    #[test]
    fn empty_capability_strings_are_silently_skipped() {
        let caps = vec!["".to_owned(), "  ".to_owned(), "weather".to_owned()];
        let c = cand("c1", "W", &["weather"], CandidateKind::Connector);
        let plan = match_capabilities(&caps, &[c], MatcherConfig::default());
        assert_eq!(plan.matches.len(), 1);
        assert!(plan.unmatched.is_empty());
    }

    #[test]
    fn name_fallback_can_be_disabled() {
        let cfg = MatcherConfig {
            min_score: 0.5,
            fall_back_to_name: false,
        };
        let untagged = cand("legacy", "Weather Service", &[], CandidateKind::Connector);
        let plan = match_capabilities(&["weather".to_owned()], &[untagged], cfg);
        // No tags + fallback off → no match.
        assert!(plan.matches.is_empty());
        assert_eq!(plan.unmatched, vec!["weather".to_owned()]);
    }

    #[test]
    fn name_fallback_only_applies_when_no_tags() {
        // A tagged candidate must NOT also match via its name — that
        // would let an irrelevant name nudge a low-quality candidate
        // above threshold.
        let c = cand(
            "c1",
            "Weather",      // would match "weather"
            &["geocoding"], // doesn't
            CandidateKind::Connector,
        );
        let plan = match_capabilities(&["weather".to_owned()], &[c], MatcherConfig::default());
        assert!(plan.matches.is_empty());
        assert_eq!(plan.unmatched, vec!["weather".to_owned()]);
    }

    #[test]
    fn min_score_threshold_filters_weak_matches() {
        let cfg = MatcherConfig {
            min_score: 0.9, // basically only exact matches
            fall_back_to_name: true,
        };
        let c = cand(
            "c1",
            "W",
            &["weather-data-stream"],
            CandidateKind::CustomMcp,
        );
        // 1/3 ≈ 0.33, well below 0.9.
        let plan = match_capabilities(&["weather".to_owned()], &[c], cfg);
        assert_eq!(plan.unmatched, vec!["weather".to_owned()]);
    }

    #[test]
    fn match_plan_preserves_capability_order() {
        let caps = vec!["a".to_owned(), "z".to_owned(), "m".to_owned()];
        let cands = vec![
            cand("a-id", "A", &["a"], CandidateKind::Skill),
            cand("z-id", "Z", &["z"], CandidateKind::Skill),
            cand("m-id", "M", &["m"], CandidateKind::Skill),
        ];
        let plan = match_capabilities(&caps, &cands, MatcherConfig::default());
        let ordered: Vec<&str> = plan.matches.iter().map(|m| m.capability.as_str()).collect();
        assert_eq!(ordered, vec!["a", "z", "m"]);
    }
}
