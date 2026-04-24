use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "chat_messages")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    #[sea_orm(column_type = "Json")]
    pub tool_calls: serde_json::Value,
    pub model: Option<String>,
    pub provider_id: Option<String>,
    pub tokens_in: i32,
    pub tokens_out: i32,
    pub cost_cents: i32,
    pub parent_message_id: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::chat_thread::Entity",
        from = "Column::ThreadId",
        to = "super::chat_thread::Column::Id"
    )]
    Thread,
}

impl Related<super::chat_thread::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Thread.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
