use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "notifications")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: Option<String>,
    #[sea_orm(column_name = "type")]
    pub r#type: String,
    pub title: String,
    pub message: String,
    pub actionable: bool,
    pub action_label: Option<String>,
    #[sea_orm(column_type = "Json", nullable)]
    pub payload: Option<serde_json::Value>,
    pub read_at: Option<String>,
    pub dismissed_at: Option<String>,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
