use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "audit_log")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub actor: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub before: Option<serde_json::Value>,
    #[sea_orm(column_type = "Json", nullable)]
    pub after: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
