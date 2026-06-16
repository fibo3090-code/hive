# HIVE Documentation Index

Start here. This folder holds the canonical documentation for HIVE. Each file
has **one job**; the table tells you which to open for which question.

| You want to know… | Read | Kind |
|---|---|---|
| **How do I run it?** | [`../README.md`](../README.md) → Quickstart | setup |
| **What's actually shipped vs. mocked/planned?** | [`FEATURE_STATUS.md`](FEATURE_STATUS.md) | living status matrix |
| **How does the built system work?** | [`architecture.md`](architecture.md) | design reference |
| **What's the forward plan / what's next?** | [`ROADMAP.md`](ROADMAP.md) | forward plan (features) |
| **What's broken / what bugs & debt are open?** | [`BACKLOG.md`](BACKLOG.md) | **unified audit register** |
| **What's the security posture & known holes?** | [`SECURITY.md`](SECURITY.md) | security |
| **What's tested, and how do I add tests?** | [`TESTING.md`](TESTING.md) | testing strategy |
| **Tips for running the chat runner / small models?** | [`OPERATOR_NOTES.md`](OPERATOR_NOTES.md) | operations |
| **Backend crate map & conventions** | [`../back-end/README.md`](../back-end/README.md) | dev |
| **Frontend app structure & conventions** | [`../front-end/README.md`](../front-end/README.md) | dev |
| **How do I contribute?** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | process |
| **LLM-agent atlas ("where things live")** | [`../../CLAUDE.md`](../../CLAUDE.md) | agent guide |
| **Aspirational product vision (≠ current state)** | [`../../docs/HIVE_v6_master_spec.md`](../../docs/HIVE_v6_master_spec.md) | vision |

## The one rule that prevents doc-rot

Each fact lives in **exactly one** doc. Don't restate status in the README, don't
restate bugs in FEATURE_STATUS, don't restate the plan in BACKLOG. Cross-link
instead. The 2026-06-16 consolidation existed because three overlapping issue
trackers (`HANDOFF_ISSUES.md`'s `A.x`, BACKLOG's `Z/ZZ`, and the audit's `C-IDs`)
drifted apart. They are now unified in [`BACKLOG.md`](BACKLOG.md).

## Document responsibilities

- **`FEATURE_STATUS.md`** — the feature ↔ implementation-state matrix
  (`done`/`partial`/`mock`/`planned`/`removed`) with dependency profile. Update
  when a feature ships, gets disabled, or moves between local/server scopes.
- **`architecture.md`** — topology, the 11 crates, core concepts, the chat-turn
  flow, schema, and design sketches. Update when the *design* changes.
- **`ROADMAP.md`** — what we intend to build next (features), not bugs.
- **`BACKLOG.md`** — the single register of open **defects, debt, security
  issues, and test gaps**, unified across every audit. Each finding carries a
  C-ID, legacy IDs, file:line, status, and fix. Evidence lives in
  [`../../audit-out/MASTER_AUDIT_REPORT.md`](../../audit-out/MASTER_AUDIT_REPORT.md)
  and [`../../AUDIT_VERIFICATION.md`](../../AUDIT_VERIFICATION.md).
- **`SECURITY.md`** — threat model, security defaults, and the security subset of
  the backlog (pulled from `BACKLOG.md`, not duplicated).
- **`TESTING.md`** — how testing works here and the coverage-gap subset of the
  backlog.
- **`OPERATOR_NOTES.md`** — runtime/operations tips (chat runner, small models).

## Archived / superseded

- **`../../HANDOFF_ISSUES.md`** — the original 2026-04-16 audit (`A.x` scheme),
  now an archive pointer into `BACKLOG.md`.
- **`../../docs/archive/`** — superseded plans kept for history.
- The standalone audit artifacts (`MASTER_AUDIT_REPORT.md`,
  `AUDIT_VERIFICATION.md`) are retained as the **evidence appendix** for
  `BACKLOG.md`, not as separate trackers.

*Index last updated: 2026-06-16.*
