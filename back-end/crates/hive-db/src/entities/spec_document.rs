use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// A spec-driven document — typically the markdown the CEO produces at the
/// end of an onboarding conversation, but also user-uploaded specs and
/// manual scratch documents.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "spec_documents")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub title: String,
    /// `"ceo-conversation"`, `"upload"`, `"manual"`.
    pub source: String,
    #[sea_orm(column_type = "Text")]
    pub markdown: String,
    /// Bumped on every edit so the planning UI can show diffs.
    pub version: i32,
    pub created_at: String,
    pub updated_at: String,
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
