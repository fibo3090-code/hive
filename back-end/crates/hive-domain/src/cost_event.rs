use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CostEventKind {
    LlmCall,
    ToolCall,
    ManualAdjustment,
}

impl std::fmt::Display for CostEventKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LlmCall => write!(f, "llm_call"),
            Self::ToolCall => write!(f, "tool_call"),
            Self::ManualAdjustment => write!(f, "manual_adjustment"),
        }
    }
}

impl std::str::FromStr for CostEventKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "llm_call" => Ok(Self::LlmCall),
            "tool_call" => Ok(Self::ToolCall),
            "manual_adjustment" => Ok(Self::ManualAdjustment),
            _ => Err(format!("invalid cost event kind: {s}")),
        }
    }
}
