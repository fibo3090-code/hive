use sea_orm::*;

use super::now_rfc3339;
use crate::entities::llm_provider::{ActiveModel, Column, Entity, Model};

pub async fn list(db: &DatabaseConnection) -> Result<Vec<Model>, DbErr> {
    Entity::find().order_by_asc(Column::Name).all(db).await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub struct UpdateKey {
    pub api_key_ciphertext: Option<Vec<u8>>,
    pub masked_key: Option<String>,
    pub base_url: Option<String>,
    pub connected: Option<bool>,
}

pub async fn update_key(
    db: &DatabaseConnection,
    id: &str,
    patch: UpdateKey,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("llm_provider {id}")))?;
    let mut active: ActiveModel = existing.into();
    if let Some(ct) = patch.api_key_ciphertext {
        active.api_key_ciphertext = Set(Some(ct));
    }
    if let Some(m) = patch.masked_key {
        active.masked_key = Set(Some(m));
    }
    if let Some(url) = patch.base_url {
        active.base_url = Set(Some(url));
    }
    if let Some(c) = patch.connected {
        active.connected = Set(c);
    }
    active.updated_at = Set(now_rfc3339());
    active.update(db).await
}

pub async fn set_connected(
    db: &DatabaseConnection,
    id: &str,
    connected: bool,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or_else(|| DbErr::RecordNotFound(format!("llm_provider {id}")))?;
    let mut active: ActiveModel = existing.into();
    active.connected = Set(connected);
    active.updated_at = Set(now_rfc3339());
    active.update(db).await
}
