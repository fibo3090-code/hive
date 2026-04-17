use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agents")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub role: String,
    pub model: String,
    pub status: String,
    pub current_task: Option<String>,
    pub quality_score: Option<i32>,
    pub tokens_used: i64,
    #[sea_orm(column_type = "Json")]
    pub eval_scores: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
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

impl Related<super::project::Entity> for Entity {
    fn to() -> RelationDef { Relation::Project.def() }
}

impl ActiveModelBehavior for ActiveModel {}
