//! In-process Restate workflow service (Cargo feature `restate`, off by default).
//!
//! When `HIVE_WORKFLOW_BACKEND=restate`, the `RestateWorkflowBackend` in `main`
//! fires a one-way send to `<endpoint>/restate/send/<Workflow>/<id>/run`.
//! Restate then invokes the matching handler defined here, in this same
//! process, with access to `AppState` — so the work runs under Restate's
//! durable runtime (exactly-once per key, automatic retry/resume) while reusing
//! the exact same execution cores as the local backend.
//!
//! Two workflows are served, one per [`crate::WorkflowJob`] family:
//! - `SpawnPipelineWorkflow` — B4 auto-MCP synthesis, keyed by spawn-request id
//!   (reuses `execute_spawn_pipeline`).
//! - `DriftRemediationWorkflow` — W3-B5 drift auto-pause, keyed by
//!   `drift_events` id (reuses `execute_drift_remediation`).
//!
//! This module is compiled only with `--features restate`, so `restate-sdk` is
//! never a mandatory dependency.

use std::net::SocketAddr;

use restate_sdk::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{execute_drift_remediation, execute_spawn_pipeline, AppState};

/// Payload HIVE's `RestateWorkflowBackend` posts to the workflow ingress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnPipelineInput {
    pub spawn_request_id: String,
}

/// Serializable projection of `PipelineOutcome` — journaled by `ctx.run` and
/// returned to Restate. (`PipelineOutcome` derives `Serialize` only, and the
/// journal needs `Deserialize` too, so we map into this local struct.)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnPipelineOutput {
    pub spawn_request_id: String,
    pub status: String,
    pub child_agent_id: Option<String>,
}

// Payloads are wrapped in `Json<T>` so restate-sdk's codec accepts our plain
// `serde` types (the SDK has its own `Serialize`/`Deserialize` traits).
#[restate_sdk::workflow]
pub trait SpawnPipelineWorkflow {
    async fn run(
        input: Json<SpawnPipelineInput>,
    ) -> Result<Json<SpawnPipelineOutput>, HandlerError>;
}

pub struct SpawnPipelineWorkflowImpl {
    state: AppState,
}

impl SpawnPipelineWorkflowImpl {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

impl SpawnPipelineWorkflow for SpawnPipelineWorkflowImpl {
    async fn run(
        &self,
        ctx: WorkflowContext<'_>,
        input: Json<SpawnPipelineInput>,
    ) -> Result<Json<SpawnPipelineOutput>, HandlerError> {
        let state = self.state.clone();
        let id = input.into_inner().spawn_request_id;
        // Durable side effect: run the pipeline once and journal its outcome, so
        // a crash *after* completion replays the recorded result instead of
        // re-running the pipeline (which would re-bill the LLM). The pipeline
        // additionally has its own resume / atomic-transition guards (B4c, ZZ52)
        // for the mid-run crash window. Failures are surfaced as terminal so
        // Restate doesn't infinitely retry a structurally-bad request.
        let outcome = ctx
            .run(|| async move {
                let o = execute_spawn_pipeline(&state, &id)
                    .await
                    .map_err(|e| HandlerError::from(TerminalError::new(e.to_string())))?;
                Ok(Json(SpawnPipelineOutput {
                    spawn_request_id: o.spawn_request_id,
                    status: o.status,
                    child_agent_id: o.child_agent_id,
                }))
            })
            .await?;
        Ok(outcome)
    }
}

/// Payload HIVE's `RestateWorkflowBackend` posts to the drift workflow ingress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftRemediationInput {
    pub drift_event_id: String,
}

/// Ack journaled by `ctx.run` and returned to Restate. The remediation's real
/// effect (pause) lands in the DB; this just records that the durable step
/// completed for the given event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftRemediationOutput {
    pub drift_event_id: String,
    pub ok: bool,
}

#[restate_sdk::workflow]
pub trait DriftRemediationWorkflow {
    async fn run(
        input: Json<DriftRemediationInput>,
    ) -> Result<Json<DriftRemediationOutput>, HandlerError>;
}

pub struct DriftRemediationWorkflowImpl {
    state: AppState,
}

impl DriftRemediationWorkflowImpl {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

impl DriftRemediationWorkflow for DriftRemediationWorkflowImpl {
    async fn run(
        &self,
        ctx: WorkflowContext<'_>,
        input: Json<DriftRemediationInput>,
    ) -> Result<Json<DriftRemediationOutput>, HandlerError> {
        let state = self.state.clone();
        let id = input.into_inner().drift_event_id;
        // Durable side effect: pause the drifted agent once and journal the
        // ack. `execute_drift_remediation` is idempotent (re-pausing is a
        // no-op), and the pipeline-side guards re-validate the event, so a
        // replay after a crash is safe. Failures are terminal so Restate
        // doesn't retry a structurally-bad event id forever.
        let outcome = ctx
            .run(|| async move {
                execute_drift_remediation(&state, &id)
                    .await
                    .map_err(|e| HandlerError::from(TerminalError::new(e.to_string())))?;
                Ok(Json(DriftRemediationOutput {
                    drift_event_id: id,
                    ok: true,
                }))
            })
            .await?;
        Ok(outcome)
    }
}

/// Build the Restate HTTP endpoint and serve it until shutdown. `main` spawns
/// this as a background task when the `restate` backend is selected. Both
/// workflow families share the one endpoint/port.
pub async fn serve(state: AppState, bind: SocketAddr) {
    let endpoint = Endpoint::builder()
        .bind(SpawnPipelineWorkflowImpl::new(state.clone()).serve())
        .bind(DriftRemediationWorkflowImpl::new(state).serve())
        .build();
    HttpServer::new(endpoint).listen_and_serve(bind).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_deserializes_the_backend_payload_shape() {
        // The wire contract: `RestateWorkflowBackend` posts
        // `{"spawnRequestId": "..."}` (see `RestateSpawnPipelineRequest`). This
        // handler's input must decode that exact camelCase shape — a rename
        // mismatch here would silently break every Restate submission.
        let parsed: SpawnPipelineInput = serde_json::from_str(r#"{"spawnRequestId":"req_123"}"#)
            .expect("decode backend payload");
        assert_eq!(parsed.spawn_request_id, "req_123");
    }

    #[test]
    fn output_round_trips() {
        let out = SpawnPipelineOutput {
            spawn_request_id: "req_123".into(),
            status: "completed".into(),
            child_agent_id: Some("agent_x".into()),
        };
        let json = serde_json::to_string(&out).unwrap();
        assert!(json.contains("\"spawnRequestId\":\"req_123\""));
        assert!(json.contains("\"childAgentId\":\"agent_x\""));
        let back: SpawnPipelineOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, "completed");
    }

    #[test]
    fn drift_input_deserializes_the_backend_payload_shape() {
        // `RestateWorkflowBackend` posts `{"driftEventId": "..."}` for the
        // drift family (see the `DriftRemediation` arm of `submit`). A rename
        // mismatch here would silently break every drift remediation submit.
        let parsed: DriftRemediationInput =
            serde_json::from_str(r#"{"driftEventId":"drift_9"}"#).expect("decode drift payload");
        assert_eq!(parsed.drift_event_id, "drift_9");
    }

    #[test]
    fn drift_output_round_trips() {
        let out = DriftRemediationOutput {
            drift_event_id: "drift_9".into(),
            ok: true,
        };
        let json = serde_json::to_string(&out).unwrap();
        assert!(json.contains("\"driftEventId\":\"drift_9\""));
        assert!(json.contains("\"ok\":true"));
        let back: DriftRemediationOutput = serde_json::from_str(&json).unwrap();
        assert!(back.ok);
    }
}
