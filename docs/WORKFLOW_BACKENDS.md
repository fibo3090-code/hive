# HIVE Workflow Backends

> Runtime note for the workflow backend abstraction. Last reviewed:
> 2026-06-21.

HIVE routes durable jobs through a small workflow service instead of launching
the work directly from each endpoint. The job *logic* still lives in its home
crate; the backend only decides how a job is submitted and deduplicated.

Two job families flow through the seam today (`WorkflowJob` in
`crates/hive-api/src/main.rs`):

| Family | Key | Execution core | Submitted by |
|--------|-----|----------------|--------------|
| `SpawnPipeline` | `agent_spawn_requests` id | `execute_spawn_pipeline` → `hive-runtime::spawn::driver::run_pipeline` | B4 `request_capability` tool + the create/approve spawn endpoints |
| `DriftRemediation` | `drift_events` id | `execute_drift_remediation` (pause the drifted agent) | the W3-B5 drift hook, when an agent crosses the pause band (score ≥ 0.9) |

Both families share the same submission/dedup/backend machinery — adding a
third is a new `WorkflowJob` variant plus its execution core, not a new
service. The runtime never depends on hive-api: each family hands the runtime a
bare-`String` mpsc sender (`spawn_pipeline_sender` / `drift_remediation_sender`)
and the consumer loop wraps the id into the right `WorkflowJob`.

## Drift auto-remediation

When the drift hook detects an agent at score ≥ 0.9 it used to pause the agent
inline (best-effort, lost on a crash between detection and pause). It now
submits the `drift_events` row id through the workflow seam instead; the
`DriftRemediation` job performs the same two-layer pause (DB `agents.status`
flip + in-process executor park) but **exactly-once and crash-durably**. The
core re-validates the event (agent subject, score still ≥ 0.9) before pausing,
and the pause is idempotent, so a replay is safe.

If the runtime has no workflow sender wired (test fixtures, a runtime embedding
without the API consumer) the hook falls back to the legacy inline pause — no
behavior change there. And if the **Restate** submission itself fails, the
backend runs the pause inline as a safety net: "stop a runaway agent" must not
depend on Restate being reachable.

## Backends

### Local

`local` is the default and preserves the existing behavior:

- agent tools, create-spawn, and approval paths enqueue a `spawn_request_id`;
- HIVE deduplicates in-flight ids in-process;
- the backend builds fresh pipeline dependencies;
- `run_pipeline` runs in a Tokio task;
- SSE events and DB state transitions are unchanged.

Use this for normal local development and as the rollback path.

### Restate

`restate` is experimental. HIVE submits each job to its Restate workflow
ingress endpoint:

```text
<HIVE_RESTATE_ENDPOINT>/restate/send/SpawnPipelineWorkflow/<spawn_request_id>/run
<HIVE_RESTATE_ENDPOINT>/restate/send/DriftRemediationWorkflow/<drift_event_id>/run
```

with payloads `{"spawnRequestId":"..."}` and `{"driftEventId":"..."}`
respectively.

Both handlers are **implemented in-process** in
`crates/hive-api/src/restate_service.rs`, compiled only with the optional
`restate` Cargo feature (so `restate-sdk` is never a mandatory dependency). When
the `restate` backend is selected, HIVE serves both workflows on one second
HTTP port. Each handler decodes its id and runs the **same** execution core the
local backend uses (`execute_spawn_pipeline` / `execute_drift_remediation`),
wrapped in a durable `ctx.run` so a post-completion crash replays the journaled
outcome instead of re-doing the work (re-billing the LLM, re-pausing). Because
they're Restate **workflows** keyed by the id, execution is exactly-once per
key.

To use it you still need a running Restate server with this service registered
(see *Running the Restate backend* below). With a plain `cargo build` (feature
off) the handler isn't compiled and the backend stays `local`.

## Environment

```sh
HIVE_WORKFLOW_BACKEND=local
```

Default. No other variables required.

```sh
HIVE_WORKFLOW_BACKEND=restate
HIVE_RESTATE_ENDPOINT=http://localhost:8080
HIVE_RESTATE_SERVICE_BIND=0.0.0.0:9080   # optional, default 0.0.0.0:9080
```

Enables Restate submission through the Restate HTTP ingress. `HIVE_RESTATE_ENDPOINT`
must be set and non-empty when the backend is `restate`. `HIVE_RESTATE_SERVICE_BIND`
is where HIVE serves the in-process `SpawnPipelineWorkflow` service that Restate
calls back into (it speaks HTTP/2 / h2c — that's the Restate↔SDK protocol, not a
browser-facing endpoint).

## Running the Restate backend (experimental)

1. **Build with the feature:** `cargo build -p hive-api --features restate`
   (a default build omits `restate-sdk` entirely).
2. **Start a Restate server**, e.g. via Docker:
   `docker run --name restate -p 8080:8080 -p 9070:9070 docker.restate.dev/restatedev/restate:latest`
   (8080 = ingress, 9070 = admin).
3. **Run HIVE** with the env above. On boot it serves the API and, additionally,
   the `SpawnPipelineWorkflow` + `DriftRemediationWorkflow` services on
   `HIVE_RESTATE_SERVICE_BIND`.
4. **Register the services** so Restate can route to them. The Restate server (in
   Docker) reaches the host service via `host.docker.internal`:
   `curl localhost:9070/deployments -H 'content-type: application/json' -d '{"uri":"http://host.docker.internal:9080"}'`
   The response lists both `SpawnPipelineWorkflow` and `DriftRemediationWorkflow`
   with handler `run` — that confirms discovery/wiring.
5. **Trigger** a job as usual: a spawn request (agent `request_capability` or the
   approval path), or a ≥0.9 drift breach. HIVE one-way-sends to the matching
   `<HIVE_RESTATE_ENDPOINT>/restate/send/<Workflow>/<id>/run`; Restate invokes the
   handler durably.

> **Validation status (2026-06-21): confirmed end-to-end.** Compile (default +
> `--features restate`), `clippy -D warnings` (both), and wire-contract unit
> tests pass. The live round-trip was validated against
> `docker.restate.dev/restatedev/restate:latest`:
> - **Discovery/registration** — `POST /deployments` registered the service;
>   the Restate server reached the h2c endpoint on `:9080` and listed
>   `SpawnPipelineWorkflow` (type `Workflow`) with handler `run`
>   (`restate-sdk-rust/0.8.0`, protocol v5).
> - **Invocation round-trip** — invoking
>   `POST /SpawnPipelineWorkflow/<id>/run` routed through to the handler, which
>   ran `execute_spawn_pipeline` and returned its terminal error
>   (`spawn request <id> not found`) back through Restate — proving the full
>   ingress → handler → pipeline-entry → error-propagation path.
>
> A *successful* pipeline run additionally requires a real spawn request and a
> configured LLM provider; that part is exercised by the normal product flow,
> not this wiring check.
>
> **`DriftRemediationWorkflow` (2026-06-21):** wire contract + per-family
> dispatch are unit-tested (`restate_service::tests::drift_*`,
> `workflow_job_dedup_keys_are_namespaced`, `restate_workflow_url_*`), and it is
> served/registered through the *same* `Endpoint` and durable `ctx.run` path as
> `SpawnPipelineWorkflow` — so it inherits the confirmed live ingress → handler
> → error-propagation behavior above. A drift-specific live round-trip
> (registering, then invoking `DriftRemediationWorkflow/<id>/run`) has not been
> run separately; the mechanism is identical.

## Rollback

Unset `HIVE_WORKFLOW_BACKEND`, or set it back to:

```sh
HIVE_WORKFLOW_BACKEND=local
```

No database migration is required for rollback. Existing spawn requests keep
their DB state and can be resubmitted through the local backend.

## Current Limits

- Restate is optional and not required to run HIVE.
- The local backend remains the production-safe path for now.
- Restate **spawn** submission failures mark the spawn request as `failed` and
  emit `agent_spawn_request.failed`.
- Restate **drift** submission failures fall back to an inline pause (the
  safety property must not depend on Restate reachability).
- Restate `409 Conflict` responses are treated as idempotent "already accepted"
  submissions (both families).
- Frontend routes and SSE event names are unchanged.
