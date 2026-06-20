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
<HIVE_RESTATE_ENDPOINT>/SpawnPipelineWorkflow/<spawn_request_id>/run
```

The payload is:

```json
{
  "spawnRequestId": "..."
}
```

The expected workflow handler is `SpawnPipelineWorkflow/run`. It should rebuild
the same dependencies HIVE builds locally, call `run_pipeline`, and return the
serialized pipeline outcome. Until that handler is deployed and registered with
Restate, keep the backend set to `local`.

## Environment

```sh
HIVE_WORKFLOW_BACKEND=local
```

Default. No other variables required.

```sh
HIVE_WORKFLOW_BACKEND=restate
HIVE_RESTATE_ENDPOINT=http://localhost:8080
```

Enables Restate submission. `HIVE_RESTATE_ENDPOINT` must be set and non-empty
when the backend is `restate`.

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
- Restate submission failures are logged; they do not mutate the spawn request
  row by themselves.
- Frontend routes and SSE event names are unchanged.

