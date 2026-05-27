//! Spec document → sprints/tasks decomposition pipeline.
//!
//! Phase 1 of the redesign. Two responsibilities, kept apart so each is
//! independently testable:
//!
//!   1. **Parser** ([`parse_sections`]) — turns a CEO-produced markdown
//!      blob into an ordered list of [`SectionInput`]s with deterministic
//!      slugified anchors. Anchors are produced once at write-time and
//!      stored on `spec_document_sections`; tasks reference them via the
//!      `spec_section_id` FK so the link survives spec re-renders.
//!   2. **Persistence** ([`materialize_decomposition`]) — given a
//!      [`DecomposeOutput`] (whose source is whatever generates it: an
//!      LLM call today, a deterministic script tomorrow, a human in the
//!      UI the day after), creates sprints, tasks, and section bindings
//!      atomically inside a transaction. Returns the persisted sprint
//!      and task ids so callers can invalidate their caches and surface
//!      links.
//!
//! Splitting these means we can unit-test the parser without a database
//! and integration-test the persistence with a fake `DecomposeOutput`.
//! The LLM-driven decomposition layer in `hive-llm` calls
//! `materialize_decomposition` once it's parsed the structured response.

use std::collections::HashSet;

use sea_orm::{DatabaseConnection, DbErr, TransactionTrait};
use serde::{Deserialize, Serialize};

use hive_db::repos::{
    spec_document_sections::{self, UpsertSection},
    sprints::{self, CreateSprint},
    tasks::{self, CreateTask},
};

// ─── Parser ────────────────────────────────────────────────────────────

/// One section as it should be written to `spec_document_sections`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SectionInput {
    pub anchor: String,
    pub title: String,
    pub body: String,
    pub ordinal: i32,
}

/// Parse a markdown spec document into ordered sections.
///
/// Heading levels `#` and `##` open new sections; deeper headings stay
/// inside the current section's body so the LLM still sees them. Content
/// before the first heading becomes a synthetic `"preamble"` section so
/// nothing is lost. Anchors are slugified deterministically (kebab-case,
/// ASCII-only, deduplicated with `-2`, `-3`, … suffixes) so a task that
/// links to a section keeps working even after the spec is re-rendered.
pub fn parse_sections(markdown: &str) -> Vec<SectionInput> {
    let mut out: Vec<SectionInput> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_body = String::new();
    let mut seen_anchors: HashSet<String> = HashSet::new();

    let push = |title: Option<String>,
                body: String,
                out: &mut Vec<SectionInput>,
                seen: &mut HashSet<String>| {
        let title = title.unwrap_or_else(|| "Preamble".to_owned());
        let trimmed_body = body.trim().to_owned();
        // Skip a wholly-empty preamble (no markdown at all before the
        // first heading) — preserves the simpler shape for typical specs.
        if title == "Preamble" && trimmed_body.is_empty() {
            return;
        }
        let base = slugify(&title);
        let anchor = unique_anchor(if base.is_empty() { "section" } else { &base }, seen);
        seen.insert(anchor.clone());
        let ordinal = out.len() as i32;
        out.push(SectionInput {
            anchor,
            title,
            body: trimmed_body,
            ordinal,
        });
    };

    for raw_line in markdown.lines() {
        if let Some(heading) = parse_top_level_heading(raw_line) {
            // Flush the in-progress section before starting a new one.
            push(
                current_title.take(),
                std::mem::take(&mut current_body),
                &mut out,
                &mut seen_anchors,
            );
            current_title = Some(heading.to_owned());
            continue;
        }
        if !current_body.is_empty() {
            current_body.push('\n');
        }
        current_body.push_str(raw_line);
    }
    push(current_title, current_body, &mut out, &mut seen_anchors);

    out
}

/// Recognise `# Title` or `## Title` (top-level heading levels). Deeper
/// headings (`###` and below) stay inside their parent section so we
/// don't fragment a spec into sub-sub-sub-sections the planner has to
/// traverse.
fn parse_top_level_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let rest = trimmed
        .strip_prefix("##")
        .or_else(|| trimmed.strip_prefix('#'))?;
    // Must have whitespace after the `#`/`##` to be a heading (avoids
    // matching `#tag` inline notation that some teams use).
    let body = rest.strip_prefix(' ').or_else(|| rest.strip_prefix('\t'))?;
    let title = body.trim_end_matches([' ', '#', '\t']).trim();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// Slugify into kebab-case ASCII. Strips diacritics best-effort by
/// keeping only ASCII alphanumerics; collapses runs of non-alphanumerics
/// into a single dash; trims leading/trailing dashes.
pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_dash = true; // start as dash so leading non-alnum is dropped
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    if out.ends_with('-') {
        out.pop();
    }
    out
}

/// Append a numeric suffix to make `base` unique within `seen`.
fn unique_anchor(base: &str, seen: &HashSet<String>) -> String {
    if !seen.contains(base) {
        return base.to_owned();
    }
    let mut n = 2u32;
    loop {
        let candidate = format!("{base}-{n}");
        if !seen.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Convert parser output into the upsert payload the section repo wants.
pub fn into_upserts(sections: Vec<SectionInput>) -> Vec<UpsertSection> {
    sections
        .into_iter()
        .map(|s| UpsertSection {
            anchor: s.anchor,
            title: s.title,
            body: s.body,
            ordinal: s.ordinal,
        })
        .collect()
}

// ─── Decomposition persistence ─────────────────────────────────────────

/// Output of the (LLM-driven or otherwise) decomposition step. Mirrors
/// the JSON schema we feed the LLM; staying decoupled from the LLM call
/// keeps this module testable.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeOutput {
    pub sprints: Vec<DecomposeSprint>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeSprint {
    pub name: String,
    /// Goal blurb shown alongside the sprint title in the planning view.
    /// Persisted as the sprint name suffix today; promoted to a column
    /// in a future migration when the UI splits them out.
    #[serde(default)]
    pub goal: Option<String>,
    /// Optional ISO date strings. The repo already requires both;
    /// callers default these when the LLM omits them.
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    pub tasks: Vec<DecomposeTask>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposeTask {
    pub title: String,
    /// Spec section anchor this task derives from. Resolved against the
    /// `spec_document_sections` table at materialize-time so the FK is
    /// real, not just a string.
    #[serde(default)]
    pub spec_section_anchor: Option<String>,
    /// Free-form role the LLM proposes for the assignee
    /// (e.g. `"frontend-dev"`, `"qa-sentinel"`). The matcher resolves it
    /// against existing agents in a follow-up; today we just persist the
    /// hint in `phase` so the planning view can show it.
    #[serde(default)]
    pub agent_role: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub estimated_tokens: i32,
    /// RFC3339 due date, optional.
    #[serde(default)]
    pub due_at: Option<String>,
}

fn default_priority() -> String {
    "medium".to_owned()
}

/// Result of `materialize_decomposition`. Returned to API callers so the
/// frontend can invalidate sprint/task queries and link directly to the
/// new rows.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeResult {
    pub sprint_ids: Vec<String>,
    pub task_ids: Vec<String>,
    /// Anchors the LLM referenced that didn't match any section in the
    /// document. The frontend surfaces these as warnings so the user can
    /// either edit the doc or accept that the link is missing.
    pub unmatched_anchors: Vec<String>,
}

/// Persist a `DecomposeOutput` against an existing `SpecDocument`.
///
/// Atomic: the whole creation runs inside a transaction. Resolves each
/// task's `spec_section_anchor` against `spec_document_sections` rows for
/// the given doc; unresolved anchors are returned in
/// [`MaterializeResult::unmatched_anchors`] and the task is still
/// created (without an FK) so a partial decomposition is salvageable.
pub async fn materialize_decomposition(
    db: &DatabaseConnection,
    project_id: &str,
    spec_document_id: &str,
    decomposition: DecomposeOutput,
    starting_position: i32,
) -> Result<MaterializeResult, DbErr> {
    // Resolve anchors → section ids up front so each task lookup is O(1).
    let sections = spec_document_sections::list_for_document(db, spec_document_id).await?;
    let anchor_to_id: std::collections::HashMap<String, String> =
        sections.into_iter().map(|s| (s.anchor, s.id)).collect();

    let txn = db.begin().await?;
    let mut sprint_ids = Vec::with_capacity(decomposition.sprints.len());
    let mut task_ids = Vec::new();
    let mut unmatched = HashSet::new();

    for (i, sprint) in decomposition.sprints.into_iter().enumerate() {
        let (start_date, end_date) = (
            sprint.start_date.unwrap_or_default(),
            sprint.end_date.unwrap_or_default(),
        );
        let display_name = match sprint.goal.as_deref() {
            Some(goal) if !goal.trim().is_empty() => format!("{} — {}", sprint.name, goal),
            _ => sprint.name.clone(),
        };
        let created_sprint = sprints::create(
            &txn,
            CreateSprint {
                project_id: project_id.to_owned(),
                name: display_name,
                status: "planned".to_owned(),
                start_date,
                end_date,
                velocity: None,
                points: 0,
                position: starting_position + i as i32,
                graph_level: starting_position + i as i32,
                graph_order: 0,
            },
        )
        .await?;
        let sprint_id = created_sprint.id.clone();
        sprint_ids.push(sprint_id.clone());

        for task in sprint.tasks {
            let resolved_section = task.spec_section_anchor.as_deref().and_then(|a| {
                let key = a.trim_start_matches('#').to_lowercase();
                let m = anchor_to_id.get(&key).cloned();
                if m.is_none() {
                    unmatched.insert(a.to_owned());
                }
                m
            });
            let phase = task.agent_role.clone();
            let created_task = tasks::create(
                &txn,
                CreateTask {
                    project_id: project_id.to_owned(),
                    title: task.title,
                    status: "queued".to_owned(),
                    phase,
                    priority: task.priority,
                    estimated_tokens: task.estimated_tokens,
                    agent_id: None,
                    sprint_id: Some(sprint_id.clone()),
                    spec_section_id: resolved_section,
                    due_at: task.due_at,
                    graph_level: 0,
                    graph_order: task_ids.len() as i32,
                },
            )
            .await?;
            task_ids.push(created_task.id);
        }
    }

    txn.commit().await?;

    let mut unmatched: Vec<String> = unmatched.into_iter().collect();
    unmatched.sort();

    Ok(MaterializeResult {
        sprint_ids,
        task_ids,
        unmatched_anchors: unmatched,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── slugify ───────────────────────────────────────────────────────

    #[test]
    fn slugify_basic_lowercase_kebab() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("Payments"), "payments");
        assert_eq!(slugify("ALL CAPS"), "all-caps");
    }

    #[test]
    fn slugify_collapses_runs_of_non_alnum() {
        assert_eq!(slugify("a   b___c"), "a-b-c");
        assert_eq!(slugify("--leading--"), "leading");
    }

    #[test]
    fn slugify_strips_diacritics_via_ascii_filter() {
        // Best-effort: non-ASCII chars are dropped, runs collapse.
        // "café" → "caf"; "naïve" → "na-ve".
        assert_eq!(slugify("café"), "caf");
        assert_eq!(slugify("naïve"), "na-ve");
    }

    #[test]
    fn slugify_handles_empty_and_pure_punctuation() {
        assert_eq!(slugify(""), "");
        assert_eq!(slugify("---"), "");
        assert_eq!(slugify("???"), "");
    }

    // ─── parse_sections ────────────────────────────────────────────────

    #[test]
    fn parse_sections_simple_two_headings() {
        let md = "# First\n\nbody one\n\n## Second\n\nbody two";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].anchor, "first");
        assert_eq!(sections[0].title, "First");
        assert_eq!(sections[0].body, "body one");
        assert_eq!(sections[0].ordinal, 0);
        assert_eq!(sections[1].anchor, "second");
        assert_eq!(sections[1].body, "body two");
        assert_eq!(sections[1].ordinal, 1);
    }

    #[test]
    fn parse_sections_preamble_captures_content_before_first_heading() {
        let md = "intro paragraph\n\n# Real Section\n\nbody";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "Preamble");
        assert_eq!(sections[0].anchor, "preamble");
        assert_eq!(sections[0].body, "intro paragraph");
    }

    #[test]
    fn parse_sections_skips_empty_preamble() {
        let md = "# Top\n\nbody";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "Top");
    }

    #[test]
    fn parse_sections_deeper_headings_stay_in_parent_body() {
        let md = "# Top\n\nintro\n\n### Sub\n\nsub body";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert!(sections[0].body.contains("### Sub"));
        assert!(sections[0].body.contains("sub body"));
    }

    #[test]
    fn parse_sections_dedupe_anchors_for_duplicate_titles() {
        let md = "# Same\n\nA\n\n## Same\n\nB\n\n## Same\n\nC";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].anchor, "same");
        assert_eq!(sections[1].anchor, "same-2");
        assert_eq!(sections[2].anchor, "same-3");
        // Titles preserve original casing — only anchors are normalised.
        assert_eq!(sections[0].title, "Same");
        assert_eq!(sections[1].title, "Same");
    }

    #[test]
    fn parse_sections_pure_punctuation_title_falls_back_to_section() {
        // Title that slugifies to empty must get a usable anchor.
        let md = "# ???\n\nbody";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].anchor, "section");
        assert_eq!(sections[0].title, "???");
    }

    #[test]
    fn parse_sections_is_deterministic_across_calls() {
        // Same input must produce byte-identical output every time —
        // the FK from tasks.spec_section_id to spec_document_sections
        // depends on this.
        let md = "# A\n\nbody\n\n## B\n\nmore\n\n## A\n\ndup";
        let first = parse_sections(md);
        let second = parse_sections(md);
        assert_eq!(first, second);
    }

    #[test]
    fn parse_sections_does_not_split_on_inline_hash_tag() {
        // `#tag` without space after the hash is NOT a heading.
        let md = "# Top\n\nuse the #tag inline\n\n#nope still body";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert!(sections[0].body.contains("#tag"));
        assert!(sections[0].body.contains("#nope"));
    }

    #[test]
    fn parse_sections_trims_trailing_hash_in_atx_style() {
        let md = "## Heading ##\n\nbody";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "Heading");
        assert_eq!(sections[0].anchor, "heading");
    }

    #[test]
    fn into_upserts_preserves_field_mapping() {
        let sections = vec![SectionInput {
            anchor: "a".into(),
            title: "A".into(),
            body: "body".into(),
            ordinal: 0,
        }];
        let upserts = into_upserts(sections);
        assert_eq!(upserts.len(), 1);
        assert_eq!(upserts[0].anchor, "a");
        assert_eq!(upserts[0].title, "A");
        assert_eq!(upserts[0].body, "body");
        assert_eq!(upserts[0].ordinal, 0);
    }
}
