//! CRUD for `chat_message_attachments`. Files attached to a chat
//! message before send. The repo records the filesystem path; the
//! API handler is responsible for actually reading/writing the
//! bytes under `~/.hive/attachments/{project_id}/`.

use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::chat_attachment::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone)]
pub struct NewAttachment {
    pub message_id: String,
    pub kind: AttachmentKind,
    pub name: String,
    pub mime_type: String,
    pub bytes_size: i64,
    pub storage_path: String,
}

#[derive(Debug, Clone, Copy)]
pub enum AttachmentKind {
    Image,
    Text,
    Binary,
}

impl AttachmentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Text => "text",
            Self::Binary => "binary",
        }
    }

    /// Best-effort classification from a mime type. Falls back to
    /// `Binary` for anything unrecognised.
    pub fn from_mime(mime: &str) -> Self {
        let mime = mime.to_ascii_lowercase();
        if mime.starts_with("image/") {
            Self::Image
        } else if mime.starts_with("text/")
            || mime == "application/json"
            || mime == "application/xml"
            || mime == "application/javascript"
        {
            Self::Text
        } else {
            Self::Binary
        }
    }
}

pub async fn insert(db: &DatabaseConnection, input: NewAttachment) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        message_id: Set(input.message_id),
        kind: Set(input.kind.as_str().to_owned()),
        name: Set(input.name),
        mime_type: Set(input.mime_type),
        bytes_size: Set(input.bytes_size),
        storage_path: Set(input.storage_path),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub async fn list_for_message(
    db: &DatabaseConnection,
    message_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::MessageId.eq(message_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

/// Batched variant of [`list_for_message`] for history rebuilds: one query
/// for every message in a thread instead of one per user message (C102).
/// Returns rows ordered by `created_at`; the caller groups by `message_id`.
pub async fn list_for_message_ids(
    db: &DatabaseConnection,
    message_ids: &[String],
) -> Result<Vec<Model>, DbErr> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    Entity::find()
        .filter(Column::MessageId.is_in(message_ids.iter().cloned()))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned()).exec(db).await?;
    Ok(())
}

pub async fn count_for_message(db: &DatabaseConnection, message_id: &str) -> Result<u64, DbErr> {
    Entity::find()
        .filter(Column::MessageId.eq(message_id))
        .count(db)
        .await
}

/// Delete every attachment row whose `message_id` is in `message_ids` and
/// return their `storage_path`s so the caller can `unlink` the files. Returns
/// an empty vec if `message_ids` is empty.
pub async fn delete_for_message_ids(
    db: &DatabaseConnection,
    message_ids: &[String],
) -> Result<Vec<String>, DbErr> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = Entity::find()
        .filter(Column::MessageId.is_in(message_ids.iter().cloned()))
        .all(db)
        .await?;
    let paths: Vec<String> = rows.iter().map(|r| r.storage_path.clone()).collect();
    if !paths.is_empty() {
        let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        Entity::delete_many()
            .filter(Column::Id.is_in(ids))
            .exec(db)
            .await?;
    }
    Ok(paths)
}

/// Every storage_path currently referenced by an attachment row — used by the
/// startup orphan sweep to find files on disk without a matching row.
pub async fn list_all_storage_paths(db: &DatabaseConnection) -> Result<Vec<String>, DbErr> {
    let rows = Entity::find()
        .select_only()
        .column(Column::StoragePath)
        .into_tuple::<String>()
        .all(db)
        .await?;
    Ok(rows)
}
