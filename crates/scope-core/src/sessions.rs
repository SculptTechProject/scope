use super::*;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionUpdate {
    pub name: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub created_at: i64,
    pub action: String,
    pub target_id: Option<String>,
}
pub(crate) fn migrate(db: &Connection) -> Result<()> {
    for (column, definition) in [
        ("notes", "TEXT NOT NULL DEFAULT ''"),
        ("tags", "TEXT NOT NULL DEFAULT '[]'"),
        ("pinned", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name=?1)",
            [column],
            |row| row.get(0),
        )?;
        if !exists {
            db.execute_batch(&format!(
                "ALTER TABLE sessions ADD COLUMN {column} {definition};"
            ))?;
        }
    }
    db.execute_batch("CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,action TEXT NOT NULL,target_id TEXT);CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at DESC);")?;
    Ok(())
}
pub(crate) fn audit(db: &Connection, action: &str, target_id: Option<&str>) -> Result<()> {
    if action.is_empty()
        || action.len() > 64
        || !action
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        bail!("Audit action must be a short identifier, not user data");
    }
    if let Some(id) = target_id {
        if id.len() > 128
            || !id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        {
            bail!("Audit target must be an opaque identifier");
        }
    }
    db.execute(
        "INSERT INTO audit_log VALUES(?1,?2,?3,?4)",
        params![uid(), now(), action, target_id],
    )?;
    // Bounded local operation history. This is deliberately not a tamper-proof audit service.
    db.execute("DELETE FROM audit_log WHERE rowid NOT IN (SELECT rowid FROM audit_log ORDER BY created_at DESC,rowid DESC LIMIT 10000)", [])?;
    Ok(())
}
pub(crate) fn apply_update(session: &mut Session, update: SessionUpdate) -> Result<()> {
    if let Some(name) = update.name {
        if name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
            bail!("Session name must contain 1–256 bytes without control characters");
        }
        session.name = name.trim().into();
    }
    if let Some(notes) = update.notes {
        if notes.len() > 16 * 1024
            || notes
                .chars()
                .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
        {
            bail!("Session notes exceed 16 KiB or contain invalid controls");
        }
        session.notes = notes;
    }
    if let Some(mut tags) = update.tags {
        if tags.len() > 20
            || tags.iter().any(|tag| {
                tag.trim().is_empty() || tag.len() > 48 || tag.chars().any(char::is_control)
            })
        {
            bail!("Use at most 20 tags, each 1–48 bytes without control characters");
        }
        for tag in &mut tags {
            *tag = tag.trim().into();
        }
        tags.sort();
        tags.dedup();
        session.tags = tags;
    }
    if let Some(pinned) = update.pinned {
        session.pinned = pinned;
    }

    Ok(())
}
impl Engine {
    pub fn record_audit(&self, action: &str, target_id: Option<&str>) -> Result<()> {
        audit(&self.inner.db.lock().unwrap(), action, target_id)
    }
    pub fn list_audit(&self, limit: usize) -> Result<Vec<AuditEntry>> {
        let db = self.inner.db.lock().unwrap();
        let mut statement = db.prepare("SELECT id,created_at,action,target_id FROM audit_log ORDER BY created_at DESC,rowid DESC LIMIT ?1")?;
        let rows = statement.query_map([limit.min(1000) as i64], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                action: row.get(2)?,
                target_id: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn update_session(&self, id: &str, update: SessionUpdate) -> Result<Session> {
        let mut db = self.inner.db.lock().unwrap();
        let tx = db.transaction()?;
        let (name, source, created_at, revision, notes, tags, pinned, exchange_count): (String, String, i64, i64, String, String, bool, i64) = tx.query_row(
            "SELECT name,source,created_at,revision,notes,tags,pinned,(SELECT COUNT(*) FROM exchanges WHERE session_id=?1) FROM sessions WHERE id=?1",
            [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?))
        ).context("Session not found")?;
        let mut session = Session {
            id: id.into(),
            name,
            source,
            created_at,
            revision,
            notes,
            tags: serde_json::from_str(&tags)?,
            pinned,
            exchange_count,
        };
        apply_update(&mut session, update)?;

        if tx.execute("UPDATE sessions SET name=?2,notes=?3,tags=?4,pinned=?5,revision=revision+1 WHERE id=?1", params![id,session.name,session.notes,serde_json::to_string(&session.tags)?,session.pinned])? == 0 { bail!("Session no longer exists"); }
        audit(&tx, "session.update", Some(id))?;
        tx.commit()?;
        session.revision += 1;
        Ok(session)
    }
    pub fn delete_session(&self, id: &str) -> Result<()> {
        // Same lock ordering as start_proxy prevents deletion racing with capture startup.
        let running = self.inner.running.lock().unwrap();
        if running
            .as_ref()
            .is_some_and(|capture| capture.session == id && !capture.task.is_finished())
        {
            bail!("Stop capture before deleting its active session");
        }
        let replays = self.inner.active_replays.lock().unwrap();
        if replays.values().any(|session| session == id) {
            bail!("Wait for active replays before deleting this session");
        }
        let mut db = self.inner.db.lock().unwrap();
        let tx = db.transaction()?;
        let unfinished: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM exchanges WHERE session_id=?1 AND json_extract(data,'$.completed')=0)", [id], |row|row.get(0))?;
        if unfinished {
            bail!("Wait for unfinished requests or replays before deleting this session");
        }
        tx.execute("DELETE FROM exchanges WHERE session_id=?1", [id])?;
        if tx.execute("DELETE FROM sessions WHERE id=?1", [id])? == 0 {
            bail!("Session not found");
        }
        audit(&tx, "session.delete", Some(id))?;
        tx.commit()?;
        drop(replays);
        drop(running);
        Ok(())
    }
}
