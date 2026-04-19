use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "projects")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub health_score: i32,
    pub spec_completion: i32,
    pub test_coverage: i32,
    pub sovereignty_tier: String,
    pub status: String,
    pub budget_total_cents: i32,
    pub last_activity_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::agent::Entity")]
    Agents,
    #[sea_orm(has_many = "super::task::Entity")]
    Tasks,
    #[sea_orm(has_many = "super::alert::Entity")]
    Alerts,
    #[sea_orm(has_many = "super::session::Entity")]
    Sessions,
    #[sea_orm(has_many = "super::cost_event::Entity")]
    CostEvents,
    #[sea_orm(has_many = "super::hive_mind_note::Entity")]
    HiveMindNotes,
    #[sea_orm(has_many = "super::tech_debt_item::Entity")]
    TechDebtItems,
    #[sea_orm(has_many = "super::sprint::Entity")]
    Sprints,
}

impl Related<super::agent::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Agents.def()
    }
}
impl Related<super::task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tasks.def()
    }
}
impl Related<super::alert::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Alerts.def()
    }
}
impl Related<super::session::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Sessions.def()
    }
}
impl Related<super::cost_event::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CostEvents.def()
    }
}
impl Related<super::hive_mind_note::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::HiveMindNotes.def()
    }
}
impl Related<super::tech_debt_item::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TechDebtItems.def()
    }
}
impl Related<super::sprint::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Sprints.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
