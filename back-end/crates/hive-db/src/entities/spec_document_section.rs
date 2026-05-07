use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Anchored slice of a `SpecDocument`. Anchors are slugified at write-time
/// (never on the fly) so tasks can FK to a stable identifier even when the
/// markdown is re-rendered or paginated.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "spec_document_sections")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub spec_document_id: String,
    /// Stable slug (e.g. `"payments-checkout"`) referenced by tasks.
    pub anchor: String,
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub body: String,
    pub ordinal: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::spec_document::Entity",
        from = "Column::SpecDocumentId",
        to = "super::spec_document::Column::Id"
    )]
    SpecDocument,
}

impl ActiveModelBehavior for ActiveModel {}
