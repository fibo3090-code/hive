use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_messages")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub from_agent_id: Option<String>,
    pub to_agent_id: String,
    pub thread_id: Option<String>,
    pub reply_to_message_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub content: String,
    #[sea_orm(column_type = "Json")]
    pub tool_calls: serde_json::Value,
    pub status: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub deleted_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::agent::Entity",
        from = "Column::ToAgentId",
        to = "super::agent::Column::Id"
    )]
    ToAgent,
    #[sea_orm(
        belongs_to = "super::project::Entity",
        from = "Column::ProjectId",
        to = "super::project::Column::Id"
    )]
    Project,
}

impl ActiveModelBehavior for ActiveModel {}
