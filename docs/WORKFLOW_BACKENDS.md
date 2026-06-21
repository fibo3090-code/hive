# HIVE Workflow Backends

> Runtime note for the workflow backend abstraction. Last reviewed:
> 2026-06-20.

HIVE now routes Auto-MCP spawn pipeline submissions through a small workflow
service instead of launching `run_pipeline` directly from each endpoint. The
pipeline logic itself still lives in `hive-runtime::spawn::driver::run_pipeline`;
the backend only decides how a spawn request is submitted and deduplicated.

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

`restate` is experimental. HIVE submits the spawn request to a Restate workflow
ingress endpoint:

```text
<HIVE_RESTATE_ENDPOINT>/restate/send/SpawnPipelineWorkflow/<spawn_request_id>/run
```

The payload is:

```json
{
  "spawnRequestId": "..."
}
```

The `SpawnPipelineWorkflow/run` handler is **implemented in-process** in
`crates/hive-api/src/restate_service.rs`, compiled only with the optional
`restate` Cargo feature (so `restate-sdk` is never a mandatory dependency). When
the `restate` backend is selected, HIVE serves the workflow service on a second
HTTP port; the handler decodes `{spawnRequestId}`, runs the **same**
`execute_spawn_pipeline` core the local backend uses (wrapped in a durable
`ctx.run` so a post-completion crash replays the journaled outcome instead of
re-billing the LLM), and returns the pipeline outcome. Because it's a Restate
**workflow** keyed by `spawn_request_id`, execution is exactly-once per request.

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
   the `SpawnPipelineWorkflow` service on `HIVE_RESTATE_SERVICE_BIND`.
4. **Register the service** so Restate can route to it. The Restate server (in
   Docker) reaches the host service via `host.docker.internal`:
   `curl localhost:9070/deployments -H 'content-type: application/json' -d '{"uri":"http://host.docker.internal:9080"}'`
   The response lists `SpawnPipelineWorkflow` with handler `run` — that confirms
   discovery/wiring.
5. **Trigger** a spawn request as usual (agent `request_capability`, or the
   approval path). HIVE one-way-sends to
   `<HIVE_RESTATE_ENDPOINT>/restate/send/SpawnPipelineWorkflow/<id>/run`; Restate
   invokes the handler durably.

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
- Restate submission failures mark the spawn request as `failed` and emit
  `agent_spawn_request.failed`.
- Restate `409 Conflict` responses are treated as idempotent "already accepted"
  submissions.
- Frontend routes and SSE event names are unchanged.
