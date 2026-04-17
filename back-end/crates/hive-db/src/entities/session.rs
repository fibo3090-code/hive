use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "sessions")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub is_active: bool,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(belongs_to = "super::project::Entity", from = "Column::ProjectId", to = "super::project::Column::Id")]
    Project,
    #[sea_orm(has_many = "super::cost_event::Entity")]
    CostEvents,
}

impl Related<super::project::Entity> for Entity { fn to() -> RelationDef { Relation::Project.def() } }
impl Related<super::cost_event::Entity> for Entity { fn to() -> RelationDef { Relation::CostEvents.def() } }
impl ActiveModelBehavior for ActiveModel {}
