use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "task_dependencies")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub from_task_id: String,
    pub to_task_id: String,
    pub kind: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::project::Entity",
        from = "Column::ProjectId",
        to = "super::project::Column::Id"
    )]
    Project,
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::FromTaskId",
        to = "super::task::Column::Id"
    )]
    FromTask,
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::ToTaskId",
        to = "super::task::Column::Id"
    )]
    ToTask,
}

impl Related<super::project::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl Related<super::task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::FromTask.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
