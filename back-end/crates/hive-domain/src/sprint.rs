use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SprintStatus {
    Active,
    Planned,
    Completed,
}

impl std::fmt::Display for SprintStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Planned => write!(f, "planned"),
            Self::Completed => write!(f, "completed"),
        }
    }
}

impl std::str::FromStr for SprintStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "planned" => Ok(Self::Planned),
            "completed" => Ok(Self::Completed),
            _ => Err(format!("invalid sprint status: {s}")),
        }
    }
}
