//! Auto-spawn pipeline state machine and supporting modules.
//!
//! Phase 4 of the redesign. The pipeline turns a `spawn_specialist` tool
//! call into a fully-bound child agent, walking the stages:
//!
//!   queued → planning-needs → matching-existing-mcp →
//!     [researching-api → synthesizing-mcp]* →
//!       composing-prompt → [awaiting-approval] →
//!         materializing-agent → completed
//!
//! Each module here owns one stage. The matcher landed first because it's
//! pure logic — no LLM, no network — and gates how often the expensive
//! research+synth stages actually run. Aggressive matching is what keeps
//! per-spawn cost bounded at scale.

pub mod driver;
pub mod matcher;

pub use driver::{
    run_pipeline, DiscoveredApi, PipelineContext, PipelineDeps, PipelineError, PipelineOutcome,
    SynthesizedMcp,
};
pub use matcher::{
    match_capabilities, score_candidate, Candidate, CandidateKind, MatchHit, MatchPlan,
    MatcherConfig,
};
