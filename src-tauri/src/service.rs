use anyhow::{anyhow, bail, Context, Result};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use scope_core::Engine;
use scope_device::DeviceManager;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAccess {
    pub session_ids: Vec<String>,
    pub allow_writes: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    pub endpoint: String,
    pub token: String,
}

pub struct AppCore {
    pub engine: Engine,
    pub devices: DeviceManager,
    pub data_dir: PathBuf,
    pub bridge: BridgeConfig,
    pub access: Mutex<McpAccess>,
    pub mcp_binary: PathBuf,
    demo_started: tokio::sync::Mutex<bool>,
}

pub(crate) fn write_private(path: &Path, content: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

impl AppCore {
    pub async fn open(
        data_dir: PathBuf,
        resources: Option<PathBuf>,
        requested_port: u16,
    ) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&data_dir)?;
        let engine = Engine::open(&data_dir)?;
        let mut devices = DeviceManager::new(data_dir.join("device"));
        // Bundled device resources are resolved independently from runtime state.
        if let Some(ref root) = resources {
            std::env::set_var("SCOPE_RESOURCES", root.join("resources"));
        }
        let _ = &mut devices;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", requested_port))
            .await
            .context("MCP bridge port is busy; another Scope instance may be open")?;
        let port = listener.local_addr()?.port();
        let bridge = BridgeConfig {
            endpoint: format!("http://127.0.0.1:{port}/api"),
            token: uuid::Uuid::new_v4().to_string(),
        };
        write_private(
            &data_dir.join("mcp-bridge.json"),
            &serde_json::to_vec_pretty(&bridge)?,
        )?;
        let suffix = if cfg!(windows) {
            "scope-mcp.exe"
        } else {
            "scope-mcp"
        };
        let beside = std::env::current_exe()?.parent().unwrap().join(suffix);
        let bundled = resources
            .as_ref()
            .map(|p| p.join("resources/bin").join(suffix));
        let mcp_binary = bundled.filter(|p| p.is_file()).unwrap_or(beside);
        let app = Arc::new(Self {
            engine,
            devices,
            data_dir,
            bridge,
            access: Mutex::new(McpAccess::default()),
            mcp_binary,
            demo_started: tokio::sync::Mutex::new(false),
        });
        let router = Router::new()
            .route("/api", post(bridge_call))
            .with_state(app.clone());
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("Scope MCP bridge: {e}");
            }
        });
        Ok(app)
    }

    pub fn mcp_status(&self) -> Value {
        let access = self.access.lock().unwrap().clone();
        json!({"sessionIds":access.session_ids,"allowWrites":access.allow_writes,"endpoint":self.bridge.endpoint})
    }

    pub fn mcp_config(&self) -> String {
        serde_json::to_string_pretty(&json!({"mcpServers":{"scope":{"command":self.mcp_binary,"args":["--config",self.data_dir.join("mcp-bridge.json")]}}})).unwrap()
    }

    pub fn bootstrap(&self) -> Result<Value> {
        Ok(
            json!({"sessions":self.engine.list_sessions()?,"proxy":self.engine.proxy_status(),"dataDir":self.data_dir,"version":env!("CARGO_PKG_VERSION"),"deviceStatus":self.devices.status(),"mcpConfig":self.mcp_config(),"mcpStatus":self.mcp_status()}),
        )
    }

    pub fn set_mcp_scope(&self, ids: Vec<String>, allow_writes: bool) -> Result<Value> {
        let existing = self.engine.list_sessions()?;
        if ids.len() > 8 || ids.iter().any(|id| !existing.iter().any(|s| s.id == *id)) {
            bail!("Select up to eight existing sessions");
        }
        *self.access.lock().unwrap() = McpAccess {
            session_ids: ids,
            allow_writes,
        };
        Ok(self.mcp_status())
    }

    pub async fn ensure_demo(&self) -> Result<()> {
        let mut started = self.demo_started.lock().await;
        if *started {
            return Ok(());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:17891")
            .await
            .context("Local demo port 17891 is busy")?;
        let router = Router::new().route("/{*path}", get(demo_response).post(demo_response));
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        *started = true;
        Ok(())
    }

    pub async fn generate_demo(&self, session_id: String) -> Result<Value> {
        self.ensure_demo().await?;
        let proxy = self.engine.proxy_status();
        if proxy.running && proxy.session_id.as_deref() != Some(&session_id) {
            bail!("Stop the current capture before recording demo traffic into another session");
        }
        if proxy.request_breakpoint || proxy.response_breakpoint {
            bail!("Disable breakpoints before generating demo traffic");
        }
        let port = if proxy.running {
            proxy.port
        } else {
            self.engine
                .start_proxy(session_id.clone(), 17890)
                .await?
                .port
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?)
            .timeout(Duration::from_secs(15))
            .build()?;
        for route in [
            "profile", "products", "products", "sign-in", "slow", "config",
        ] {
            client
                .get(format!("http://127.0.0.1:17891/api/{route}"))
                .header("X-Scope-Demo", "true")
                .send()
                .await?
                .bytes()
                .await?;
        }
        Ok(json!({"captured":6,"sessionId":session_id,"target":"http://127.0.0.1:17891"}))
    }
}

async fn demo_response(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path();
    if path.contains("slow") {
        tokio::time::sleep(Duration::from_millis(380)).await;
    }
    let (status, body) = if path.contains("sign-in") || path.contains("login") {
        (
            StatusCode::UNAUTHORIZED,
            json!({"error":"demo_invalid_token","message":"This deliberate demo response shows a failed sign-in."}),
        )
    } else if path.contains("products") {
        (
            StatusCode::OK,
            json!({"products":[{"id":"sku_001","name":"Field notebook","price":24},{"id":"sku_002","name":"Mechanical pencil","price":12}],"currency":"EUR"}),
        )
    } else if path.contains("error") {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":"demo_server_failure","message":"A deliberate local error for testing Scope."}),
        )
    } else if path.contains("orders") {
        (
            StatusCode::OK,
            json!({"orders":[{"id":"order_001","status":"processing","total":36}],"count":1}),
        )
    } else if path.contains("profile") {
        (
            StatusCode::OK,
            json!({"id":"demo_user","name":"Scope demo","plan":"open-source"}),
        )
    } else {
        (
            StatusCode::OK,
            json!({"demo":true,"path":path,"message":"Generated by Scope's local test server","features":{"capture":true,"persist":true}}),
        )
    };
    (
        status,
        [("X-Scope-Demo", "true"), ("Cache-Control", "no-store")],
        Json(body),
    )
}

#[derive(Deserialize)]
struct BridgeRequest {
    command: String,
    #[serde(default)]
    args: Value,
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Missing {key}"))
}

async fn bridge_call(
    State(app): State<Arc<AppCore>>,
    headers: HeaderMap,
    Json(call): Json<BridgeRequest>,
) -> impl IntoResponse {
    if headers.get("authorization").and_then(|s| s.to_str().ok())
        != Some(&format!("Bearer {}", app.bridge.token))
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        );
    }
    let result = dispatch_mcp(app, call).await;
    match result {
        Ok(v) => (StatusCode::OK, Json(json!({"result":v}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":e.to_string()})),
        ),
    }
}

async fn dispatch_mcp(app: Arc<AppCore>, call: BridgeRequest) -> Result<Value> {
    let access = app.access.lock().unwrap().clone();
    let args = &call.args;
    if call.command == "list_sessions" {
        return Ok(serde_json::to_value(
            app.engine
                .list_sessions()?
                .into_iter()
                .filter(|s| access.session_ids.contains(&s.id))
                .collect::<Vec<_>>(),
        )?);
    }
    if call.command == "status" {
        return Ok(json!({"connected":true,"access":access,"version":env!("CARGO_PKG_VERSION")}));
    }
    let session_id = if call.command == "get_request" || call.command == "replay_request" {
        app.engine.get_exchange(required(args, "id")?)?.session_id
    } else {
        required(args, "sessionId")?.to_string()
    };
    if !access.session_ids.contains(&session_id) {
        bail!("Session is not shared with MCP. Select it in Scope's MCP panel first.");
    }
    let value = match call.command.as_str() {
        "search_requests" => {
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .min(200) as usize;
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let mut rows = serde_json::to_value(app.engine.list_exchanges(
                &session_id,
                args.get("query").and_then(Value::as_str),
                limit,
                offset,
            )?)?;
            if let Some(rows) = rows.as_array_mut() {
                for row in rows {
                    if let Some(o) = row.as_object_mut() {
                        o.remove("requestBody");
                        o.remove("responseBody");
                        o.remove("originalRequest");
                        o.remove("originalResponse");
                    }
                }
            }
            rows
        }
        "get_request" => serde_json::to_value(app.engine.get_exchange(required(args, "id")?)?)?,
        "analyze_session" => app.engine.analysis(&session_id)?,
        "compare_sessions" => {
            let right = required(args, "rightSessionId")?;
            if !access.session_ids.contains(&right.to_string()) {
                bail!("Both sessions must be shared in Scope");
            }
            app.engine.compare_sessions(&session_id, right)?
        }
        "replay_request" => {
            if !access.allow_writes {
                bail!("MCP replay is disabled. Enable write access in Scope first.");
            }
            serde_json::to_value(app.engine.replay(required(args, "id")?, None).await?)?
        }
        _ => bail!("Unknown MCP command"),
    };
    Ok(redact(value))
}

fn sensitive(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace(['-', '_'], "");
    [
        "authorization",
        "proxyauthorization",
        "cookie",
        "setcookie",
        "password",
        "passwd",
        "secret",
        "token",
        "accesstoken",
        "refreshtoken",
        "apikey",
        "xapikey",
        "xauth",
        "xaccesskey",
        "xsessionid",
    ]
    .iter()
    .any(|k| key == *k || key.ends_with("token") || key.ends_with("secret"))
}

pub fn redact(mut value: Value) -> Value {
    match &mut value {
        Value::Array(values) => {
            for v in values {
                *v = redact(v.take());
            }
        }
        Value::Object(map) => {
            // Original snapshots remain available in the desktop. Do not expose a
            // second, differently-shaped body path that could bypass redaction.
            map.remove("originalRequest");
            map.remove("originalResponse");
            if map
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(sensitive)
                && map.contains_key("value")
            {
                map.insert("value".into(), json!("[redacted]"));
            }
            for (key, v) in map.iter_mut() {
                if sensitive(key) {
                    *v = json!("[redacted]");
                } else if (key == "requestBody" || key == "responseBody") && v.is_string() {
                    let s = v.as_str().unwrap();
                    *v = if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                        json!(redact(parsed).to_string())
                    } else {
                        json!("[body omitted from MCP: non-JSON content]")
                    };
                } else if key == "url" {
                    if let Some(s) = v.as_str() {
                        if let Ok(mut url) = reqwest::Url::parse(s) {
                            let pairs = url
                                .query_pairs()
                                .map(|(k, v)| {
                                    (
                                        k.to_string(),
                                        if sensitive(&k) {
                                            "[redacted]".to_string()
                                        } else {
                                            v.to_string()
                                        },
                                    )
                                })
                                .collect::<Vec<_>>();
                            if url.query().is_some() {
                                url.query_pairs_mut().clear().extend_pairs(pairs);
                            }
                            url.set_username("").ok();
                            url.set_password(None).ok();
                            *v = json!(url.to_string());
                        }
                    }
                } else {
                    *v = redact(v.take());
                }
            }
        }
        _ => {}
    }
    // Return bounded individual bodies to agents, with an explicit omission marker.
    if let Value::Object(ref mut map) = value {
        for key in ["requestBody", "responseBody"] {
            if map
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|s| s.len() > 65536)
            {
                map.insert(
                    key.into(),
                    json!("[body omitted from MCP: exceeds 64 KiB; inspect in Scope]"),
                );
            }
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_credentials_and_keeps_evidence() {
        let v = redact(
            json!({"url":"https://example.com/path?token=private&q=ok","requestHeaders":[{"name":"Authorization","value":"Bearer private"}],"responseBody":"{\"access_token\":\"private\",\"count\":3}","originalRequest":{"body":"{\"token\":\"private\"}"},"originalResponse":{"body":"private"}}),
        );
        assert!(!v.to_string().contains("private"));
        assert!(v["responseBody"].as_str().unwrap().contains("3"));
        assert!(v["url"].as_str().unwrap().contains("q=ok"));
        assert!(v.get("originalRequest").is_none());
    }
}
