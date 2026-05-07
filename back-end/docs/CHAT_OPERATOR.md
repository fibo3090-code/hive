# Chat operator notes

## Tool round limits (`hive-runtime`)

Per assistant turn, the chat runner allows up to **30** LLM↔tool round-trips (`MAX_TOOL_ROUNDS` in `crates/hive-runtime/src/chat.rs`). There is also a cap on **total tool dispatches** per turn (**60**, `MAX_TOTAL_TOOL_CALLS`) and a repeat guard on identical `(tool, arguments)` fingerprints.

### Empty final answer (legacy behavior)

Previously, if the model kept emitting tool calls every round and never returned a turn with **no** tool calls, the persisted assistant message could be only the generic line: *"I exhausted the available tool rounds without producing a final answer."*

The runtime now falls back to the **last non-empty assistant `response.text`** from any tool round when that happens, so partial narration is not lost.

### Small / local models (e.g. Ollama)

Validation failures (`missing required field`, `tool not registered`) consume rounds. Mitigations: stronger system prompt (`default_chat_system_prompt` in `hive-api`), correct tool JSON (see `hive-tools` built-in manifests), and user thread settings that match enabled tools.

## Primary references (harness design)

Use these when evolving prompts or agent UX (evidence-backed patterns: tool use, verification, modular instructions):

- Anthropic — Message format and tool use: https://docs.claude.com/en/docs/build-with-claude/tool-use
- Anthropic — Agent SDK overview: https://docs.claude.com/en/api/agent-sdk/overview
- OpenAI — Structured outputs / function calling (tool-shaped APIs): https://platform.openai.com/docs/guides/function-calling
- Google Gemini — Tool use and grounding: https://ai.google.dev/gemini-api/docs/function-calling
