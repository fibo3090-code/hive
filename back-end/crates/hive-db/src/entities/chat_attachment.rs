use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "chat_message_attachments")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub message_id: String,
    /// `'image'` | `'text'` | `'binary'`. Drives how providers include
    /// the file in the LLM payload (image → vision content block,
    /// text → inline body append, binary → name-only metadata).
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub bytes_size: i64,
    /// Path relative to `~/.hive/attachments/{project_id}/`. Resolves
    /// to the actual file via `state.data_dir.join(...)`.
    pub storage_path: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::chat_message::Entity",
        from = "Column::MessageId",
        to = "super::chat_message::Column::Id"
    )]
    Message,
}

impl Related<super::chat_message::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Message.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
