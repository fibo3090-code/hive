//! Tool manifest — the JSON-schema-shaped declaration the LLM reads.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Declarative description of a tool, rendered per-provider into whatever
/// tool-use payload that LLM expects (Anthropic `tool_use`, OpenAI
/// `tools[].function`, Gemini `functionDeclarations`, Ollama `tools[]`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolManifest {
    /// Stable identifier the LLM will echo back when calling the tool.
    /// Must match the name the runtime registry looks up.
    pub name: String,
    /// Human-readable description of the tool's effect, shown to the LLM.
    pub description: String,
    /// JSON Schema for the arguments. Should be an object schema with
    /// `properties` and `required`. Leave empty (`{"type":"object"}`) for
    /// zero-argument tools.
    pub input_schema: Value,
    /// True when the tool changes state on the host (writes files, runs
    /// shell commands, modifies remote resources). Used by permission
    /// gating and auditing.
    #[serde(default)]
    pub side_effects: bool,
}
