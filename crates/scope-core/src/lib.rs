//! Local, durable HTTP(S) interception engine shared by Scope desktop and MCP.
//! v0.1 buffers bodies up to 16 MiB. Larger bodies fail explicitly; no partial body
//! is presented as a successful capture. WebSocket frames and trailers are not captured.
mod proxy;
mod report;

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hudsucker::rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::oneshot;
use uuid::Uuid;

pub const CAPTURE_LIMIT_BYTES: usize = 16 * 1024 * 1024;
pub const BREAKPOINT_TIMEOUT_SECONDS: u64 = 60;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub source: String,
    pub created_at: i64,
    pub exchange_count: i64,
    #[serde(default)]
    pub revision: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Header {
    pub name: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exchange {
    pub id: String,
    pub session_id: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub request_headers: Vec<Header>,
    pub response_headers: Vec<Header>,
    pub request_body: String,
    pub response_body: String,
    pub request_body_base64: bool,
    pub response_body_base64: bool,
    pub started_at: i64,
    pub duration_ms: i64,
    pub request_bytes: i64,
    pub response_bytes: i64,
    pub error: Option<String>,
    pub edited: bool,
    pub original_request: Option<Value>,
    pub original_response: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub session_id: Option<String>,
    pub request_breakpoint: bool,
    pub response_breakpoint: bool,
    pub ca_cert_path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingExchange {
    pub id: String,
    pub exchange_id: String,
    pub stage: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub headers: Vec<Header>,
    pub body: String,
    pub body_base64: bool,
    pub created_at: i64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMessage {
    pub action: String,
    pub method: Option<String>,
    pub url: Option<String>,
    pub status: Option<u16>,
    pub headers: Option<Vec<Header>>,
    pub body: Option<String>,
    pub body_base64: Option<bool>,
}
impl EditMessage {
    pub fn continue_unchanged() -> Self {
        Self {
            action: "continue".into(),
            ..Self::default()
        }
    }
    fn abort() -> Self {
        Self {
            action: "abort".into(),
            ..Self::default()
        }
    }
    fn validate(&self) -> Result<()> {
        if self.action != "continue" && self.action != "abort" {
            bail!("Action must be continue or abort");
        }
        if let Some(method) = &self.method {
            method
                .parse::<hudsucker::hyper::Method>()
                .context("Invalid HTTP method")?;
        }
        if let Some(url) = &self.url {
            validate_url(url)?;
        }
        if let Some(status) = self.status {
            hudsucker::hyper::StatusCode::from_u16(status)?;
        }
        if let Some(headers) = &self.headers {
            proxy::header_map(headers)?;
        }
        if let Some(body) = &self.body {
            let decoded = decode_body(body, self.body_base64.unwrap_or(false))?;
            if decoded.len() > CAPTURE_LIMIT_BYTES {
                bail!("Edited body exceeds 16 MiB capture limit");
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}
struct Inner {
    db: Mutex<Connection>,
    dir: PathBuf,
    running: Mutex<Option<proxy::Running>>,
    lifecycle: tokio::sync::Mutex<()>,
    pending: Mutex<HashMap<String, (PendingExchange, oneshot::Sender<EditMessage>)>>,
    request_breakpoint: AtomicBool,
    response_breakpoint: AtomicBool,
}
pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub(crate) fn uid() -> String {
    Uuid::new_v4().to_string()
}
pub(crate) fn encode_body(bytes: &[u8]) -> (String, bool) {
    match String::from_utf8(bytes.to_vec()) {
        Ok(v) => (v, false),
        Err(_) => (STANDARD.encode(bytes), true),
    }
}
pub(crate) fn decode_body(body: &str, base64: bool) -> Result<Vec<u8>> {
    Ok(if base64 {
        STANDARD.decode(body).context("Invalid base64 body")?
    } else {
        body.as_bytes().to_vec()
    })
}
pub(crate) fn validate_url(value: &str) -> Result<()> {
    let url = url::Url::parse(value).context("Invalid URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("URL must use http or https with a host");
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("Use Authorization header instead of credentials in URL");
    }
    Ok(())
}
impl Engine {
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Self> {
        let dir = data_dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
        ensure_ca(&dir)?;
        let db = Connection::open(dir.join("scope.sqlite3"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS exchanges(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), started_at INTEGER NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS exchanges_session_time ON exchanges(session_id, started_at DESC);")?;
        let has_revision: i64 = db.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='revision'",
            [],
            |row| row.get(0),
        )?;
        if has_revision == 0 {
            db.execute_batch(
                "ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        // A completed response or resolved breakpoint updates an existing exchange;
        // a row count alone cannot tell the GUI that captured data has changed.
        db.execute_batch("CREATE TRIGGER IF NOT EXISTS scope_exchange_insert_revision AFTER INSERT ON exchanges BEGIN UPDATE sessions SET revision=revision+1 WHERE id=NEW.session_id; END; CREATE TRIGGER IF NOT EXISTS scope_exchange_update_revision AFTER UPDATE ON exchanges BEGIN UPDATE sessions SET revision=revision+1 WHERE id=NEW.session_id; END;")?;
        Ok(Self {
            inner: Arc::new(Inner {
                db: Mutex::new(db),
                dir,
                running: Mutex::new(None),
                lifecycle: tokio::sync::Mutex::new(()),
                pending: Mutex::new(HashMap::new()),
                request_breakpoint: AtomicBool::new(false),
                response_breakpoint: AtomicBool::new(false),
            }),
        })
    }
    pub fn data_dir(&self) -> PathBuf {
        self.inner.dir.clone()
    }
    pub fn ca_cert_path(&self) -> PathBuf {
        self.inner.dir.join("scope-ca.pem")
    }
    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let db = self.inner.db.lock().unwrap();
        let mut st = db.prepare("SELECT s.id,s.name,s.source,s.created_at,COUNT(e.id),s.revision FROM sessions s LEFT JOIN exchanges e ON e.session_id=s.id GROUP BY s.id ORDER BY s.created_at DESC")?;
        let rows = st.query_map([], |r| {
            Ok(Session {
                id: r.get(0)?,
                name: r.get(1)?,
                source: r.get(2)?,
                created_at: r.get(3)?,
                exchange_count: r.get(4)?,
                revision: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn create_session(&self, name: String, source: String) -> Result<Session> {
        if name.trim().is_empty() || name.len() > 256 {
            bail!("Session name must contain 1–256 characters");
        }
        let s = Session {
            id: uid(),
            name,
            source,
            created_at: now(),
            exchange_count: 0,
            revision: 0,
        };
        self.inner.db.lock().unwrap().execute(
            "INSERT INTO sessions(id,name,source,created_at) VALUES(?1,?2,?3,?4)",
            params![s.id, s.name, s.source, s.created_at],
        )?;
        Ok(s)
    }
    pub(crate) fn session(&self, id: &str) -> Result<Session> {
        self.list_sessions()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| anyhow!("Session not found: {id}"))
    }
    pub(crate) fn save(&self, e: &Exchange) -> Result<()> {
        let data = serde_json::to_string(e)?;
        self.inner.db.lock().unwrap().execute("INSERT INTO exchanges VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![e.id,e.session_id,e.started_at,data])?;
        Ok(())
    }
    pub fn get_exchange(&self, id: &str) -> Result<Exchange> {
        let text: String = self
            .inner
            .db
            .lock()
            .unwrap()
            .query_row("SELECT data FROM exchanges WHERE id=?1", [id], |r| r.get(0))
            .context("Exchange not found")?;
        Ok(serde_json::from_str(&text)?)
    }
    pub fn list_exchanges(
        &self,
        session_id: &str,
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Exchange>> {
        self.session(session_id)?;
        let db = self.inner.db.lock().unwrap();
        // Search the decoded persisted fields, including bodies, without SQL wildcard semantics.
        let mut st = db.prepare(
            "SELECT data FROM exchanges WHERE session_id=?1 ORDER BY started_at DESC,rowid DESC",
        )?;
        let rows = st.query_map([session_id], |r| r.get::<_, String>(0))?;
        let needle = query.unwrap_or("").to_lowercase();
        let mut found = Vec::new();
        let mut skipped = 0;
        for row in rows {
            let e: Exchange = serde_json::from_str(&row?)?;
            if !needle.is_empty()
                && !format!(
                    "{} {} {:?} {} {} {:?} {:?}",
                    e.method,
                    e.url,
                    e.status,
                    e.request_body,
                    e.response_body,
                    e.request_headers,
                    e.response_headers
                )
                .to_lowercase()
                .contains(&needle)
            {
                continue;
            }
            if skipped < offset {
                skipped += 1;
                continue;
            }
            if found.len() >= limit.min(10_000) {
                break;
            }
            found.push(e);
        }
        Ok(found)
    }
    pub(crate) fn all_exchanges(&self, id: &str) -> Result<Vec<Exchange>> {
        self.session(id)?;
        let db = self.inner.db.lock().unwrap();
        let mut st =
            db.prepare("SELECT data FROM exchanges WHERE session_id=?1 ORDER BY started_at,rowid")?;
        let rows = st.query_map([id], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn set_breakpoints(&self, request: bool, response: bool) {
        self.inner
            .request_breakpoint
            .store(request, Ordering::SeqCst);
        self.inner
            .response_breakpoint
            .store(response, Ordering::SeqCst);
    }
    pub fn pending(&self) -> Vec<PendingExchange> {
        let mut v: Vec<_> = self
            .inner
            .pending
            .lock()
            .unwrap()
            .values()
            .map(|(p, _)| p.clone())
            .collect();
        v.sort_by_key(|p| p.created_at);
        v
    }
    pub fn resolve_breakpoint(&self, id: &str, edit: EditMessage) -> Result<()> {
        edit.validate()?;
        let (_, tx) = self
            .inner
            .pending
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| anyhow!("Breakpoint expired or already resolved"))?;
        tx.send(edit)
            .map_err(|_| anyhow!("Breakpoint is no longer waiting"))
    }
    pub(crate) fn fresh_exchange(&self, session: &str, method: String, url: String) -> Exchange {
        Exchange {
            id: uid(),
            session_id: session.into(),
            method,
            url,
            status: None,
            request_headers: vec![],
            response_headers: vec![],
            request_body: String::new(),
            response_body: String::new(),
            request_body_base64: false,
            response_body_base64: false,
            started_at: now(),
            duration_ms: 0,
            request_bytes: 0,
            response_bytes: 0,
            error: Some("Capture in progress or interrupted before completion".into()),
            edited: false,
            original_request: None,
            original_response: None,
        }
    }
}
fn ensure_ca(dir: &Path) -> Result<()> {
    let cert_path = dir.join("scope-ca.pem");
    let key_path = dir.join("scope-ca-key.pem");
    if cert_path.exists() && key_path.exists() {
        return Ok(());
    }
    if cert_path.exists() || key_path.exists() {
        bail!("CA key/certificate pair is incomplete; restore both files or remove both to regenerate");
    }
    let key = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "Scope Local Debug CA");
    dn.push(DnType::OrganizationName, "Scope");
    params.distinguished_name = dn;
    params.key_usages = vec![
        hudsucker::rcgen::KeyUsagePurpose::KeyCertSign,
        hudsucker::rcgen::KeyUsagePurpose::CrlSign,
        hudsucker::rcgen::KeyUsagePurpose::DigitalSignature,
    ];
    let cert = params.self_signed(&key)?;
    fs::write(&key_path, key.serialize_pem())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))?;
    }
    fs::write(cert_path, cert.pem())?;
    Ok(())
}
