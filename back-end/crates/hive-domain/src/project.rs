use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SovereigntyTier {
    Local,
    Hybrid,
    Cloud,
}

impl std::fmt::Display for SovereigntyTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::Hybrid => write!(f, "hybrid"),
            Self::Cloud => write!(f, "cloud"),
        }
    }
}

impl std::str::FromStr for SovereigntyTier {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "local" => Ok(Self::Local),
            "hybrid" => Ok(Self::Hybrid),
            "cloud" => Ok(Self::Cloud),
            _ => Err(format!("invalid sovereignty tier: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectStatus {
    Active,
    Paused,
    Completed,
}

impl std::fmt::Display for ProjectStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Paused => write!(f, "paused"),
            Self::Completed => write!(f, "completed"),
        }
    }
}

impl std::str::FromStr for ProjectStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            _ => Err(format!("invalid project status: {s}")),
        }
    }
}
