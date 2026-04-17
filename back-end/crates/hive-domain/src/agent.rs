use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Working,
    Idle,
    Blocked,
    Paused,
    Deprecated,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Working => write!(f, "working"),
            Self::Idle => write!(f, "idle"),
            Self::Blocked => write!(f, "blocked"),
            Self::Paused => write!(f, "paused"),
            Self::Deprecated => write!(f, "deprecated"),
        }
    }
}

impl std::str::FromStr for AgentStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "working" => Ok(Self::Working),
            "idle" => Ok(Self::Idle),
            "blocked" => Ok(Self::Blocked),
            "paused" => Ok(Self::Paused),
            "deprecated" => Ok(Self::Deprecated),
            _ => Err(format!("invalid agent status: {s}")),
        }
    }
}
