use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "synthesis_jobs")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    pub tier: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    #[sea_orm(column_type = "Json")]
    pub manifest_json: serde_json::Value,
    #[sea_orm(column_type = "Json")]
    pub generated_files_json: serde_json::Value,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::project::Entity",
        from = "Column::ProjectId",
        to = "super::project::Column::Id"
    )]
    Project,
}

impl ActiveModelBehavior for ActiveModel {}
