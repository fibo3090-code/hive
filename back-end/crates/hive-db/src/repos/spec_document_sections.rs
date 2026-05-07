use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::spec_document_section::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSection {
    pub anchor: String,
    pub title: String,
    pub body: String,
    pub ordinal: i32,
}

pub async fn list_for_document(
    db: &DatabaseConnection,
    spec_document_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::SpecDocumentId.eq(spec_document_id))
        .order_by_asc(Column::Ordinal)
        .all(db)
        .await
}

pub async fn get_by_anchor(
    db: &DatabaseConnection,
    spec_document_id: &str,
    anchor: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::SpecDocumentId.eq(spec_document_id))
        .filter(Column::Anchor.eq(anchor))
        .one(db)
        .await
}

/// Replace all sections for a document atomically. Used after the spec
/// markdown is rewritten — anchors are slugified at write-time so any
/// FK references can be re-resolved deterministically.
pub async fn sync_for_document(
    db: &DatabaseConnection,
    spec_document_id: &str,
    sections: Vec<UpsertSection>,
) -> Result<Vec<Model>, DbErr> {
    Entity::delete_many()
        .filter(Column::SpecDocumentId.eq(spec_document_id))
        .exec(db)
        .await?;
    let mut out = Vec::with_capacity(sections.len());
    for s in sections {
        let row = ActiveModel {
            id: Set(new_id()),
            spec_document_id: Set(spec_document_id.to_owned()),
            anchor: Set(s.anchor),
            title: Set(s.title),
            body: Set(s.body),
            ordinal: Set(s.ordinal),
        }
        .insert(db)
        .await?;
        out.push(row);
    }
    let _ = now_rfc3339();
    Ok(out)
}
