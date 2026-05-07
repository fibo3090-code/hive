# Future: workspace todo tool (design sketch)

This is **not implemented** in `hive-tools` yet. The chat system prompt refers to an internal checklist until these tools exist.

## Goals

- Give the LLM structured operational memory across long turns (pending / in_progress / completed / blocked).
- Persist todos in the project or thread store so a resumed session can reload them (exact store TBD).

## Proposed tool surface (names are illustrative)

| Tool | Purpose |
| ------ | --------- |
| `todo_create` | Add item with `title`, optional `description`, `priority`, `depends_on` ids |
| `todo_update` | Change status, title, description, priority, or dependencies |
| `todo_complete` | Mark completed (or `todo_set_status`) |
| `todo_delete` | Remove id |
| `todo_list` | List with optional status filter |

## Data shape (sketch)

```json
{
  "id": "ulid",
  "title": "string",
  "description": "string | null",
  "status": "pending | in_progress | completed | blocked",
  "priority": "low | medium | high",
  "depends_on": ["id"],
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

## Integration steps (when built)

1. Implement tools in `hive-tools` with sandbox/thread-scoped storage.
2. Register them in the same `ToolRegistry` path used for chat.
3. Extend `default_chat_system_prompt` with the real tool names and JSON contracts.
