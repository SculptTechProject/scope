// Artifact-only synthetic producer. Build separately; never use a live archive.
use anyhow::{bail, ensure, Result};
use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use scope_core::{Engine, TrafficProvenance};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

#[derive(Clone)]
struct Fixture {
    variant: Arc<AtomicUsize>,
    requests: Arc<AtomicUsize>,
}
async fn response(State(state): State<Fixture>, uri: axum::http::Uri) -> impl IntoResponse {
    state.requests.fetch_add(1, Ordering::SeqCst);
    let variant = state.variant.load(Ordering::SeqCst);
    let mut status = StatusCode::OK;
    let body = match uri.path() {
        "/users" if variant == 1 => json!({"user":{"name":"NATIVE_SYNTHETIC_BODY_VALUE"}}),
        "/users" => json!({"user":{"name":"NATIVE_SYNTHETIC_BODY_VALUE","role":"reader"}}),
        "/failure" => {
            if variant == 2 {
                status = StatusCode::INTERNAL_SERVER_ERROR;
            }
            json!({"ok":true})
        }
        "/health" => {
            json!({"timestamp":if variant == 3 { "2026-11-04T00:00:00Z" } else { "2026-11-03T00:00:00Z" },"ok":true})
        }
        _ => {
            status = StatusCode::NOT_FOUND;
            json!({"error":"unexpected fixture route"})
        }
    };
    (status, Json(body))
}
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(
        args.len() == 3,
        "Pass NEW archive directory and NEW export directory"
    );
    let archive = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    ensure!(
        !archive.exists() && !output.exists(),
        "Refusing existing archive or export directory"
    );
    std::fs::create_dir(&output)?;
    let fixture = Fixture {
        variant: Arc::new(AtomicUsize::new(0)),
        requests: Arc::new(AtomicUsize::new(0)),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let router = Router::new()
        .route("/users", get(response))
        .route("/failure", get(response))
        .route("/health", get(response))
        .with_state(fixture.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await });
    let engine = Engine::open(&archive)?;
    let mut sessions: Vec<Value> = vec![];
    for (variant, name) in [
        "baseline",
        "missing-field",
        "http-failure",
        "timestamp-noise",
    ]
    .iter()
    .enumerate()
    {
        fixture.variant.store(variant, Ordering::SeqCst);
        let session = engine.create_session(
            format!("Synthetic native {name}"),
            "artifact-only synthetic loopback fixture".into(),
        )?;
        let proxy = engine.start_proxy(session.id.clone(), 0).await?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(format!(
                "http://127.0.0.1:{}",
                proxy.port
            ))?)
            .timeout(std::time::Duration::from_secs(5))
            .build()?;
        for path in ["/users", "/failure", "/health"] {
            let response = client
                .get(format!(
                    "{origin}{path}?marker=NATIVE_SYNTHETIC_QUERY_VALUE"
                ))
                .header("Authorization", "Bearer NATIVE_SYNTHETIC_HEADER_VALUE")
                .send()
                .await?;
            let expected = if variant == 2 && path == "/failure" {
                500
            } else {
                200
            };
            ensure!(
                response.status().as_u16() == expected,
                "Unexpected fixture status"
            );
            let _: Value = response.json().await?;
        }
        drop(client);
        engine.stop_proxy().await?;
        let captured = engine.list_exchanges(&session.id, None, 100, 0)?;
        ensure!(captured.len() == 3, "Expected three persisted exchanges");
        for exchange in &captured {
            ensure!(
                exchange.completed && exchange.error.is_none(),
                "Capture incomplete"
            );
            ensure!(
                exchange.provenance == TrafficProvenance::Upstream,
                "Non-upstream provenance"
            );
            ensure!(
                !exchange.edited && exchange.applied_rules.is_empty(),
                "Unexpected modification"
            );
        }
        let har = engine.export_har(&session.id)?;
        ensure!(
            har["log"]["entries"]
                .as_array()
                .is_some_and(|entries| entries.len() == 3),
            "Incomplete HAR export"
        );
        let path = output.join(format!("{name}.har"));
        std::fs::write(&path, serde_json::to_vec_pretty(&har)?)?;
        sessions.push(json!({"name":name,"sessionId":session.id,"entries":3,"proxyPort":proxy.port,"export":path.file_name().unwrap().to_string_lossy()}));
    }
    ensure!(
        fixture.requests.load(Ordering::SeqCst) == 12,
        "Unexpected upstream request count"
    );
    println!(
        "{}",
        json!({"status":"ready","origin":origin,"sessions":sessions,"upstreamRequestsBeforeAnalysis":12,"producer":"unchanged scope_core::Engine proxy + export_har","network":"synthetic HTTP over 127.0.0.1 only; no TLS/device/browser coverage"})
    );
    std::io::stdout().flush()?;
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    if line.trim() != "finish" {
        bail!("Expected explicit finish after analysis");
    }
    let count = fixture.requests.load(Ordering::SeqCst);
    ensure!(count == 12, "Analysis unexpectedly contacted the fixture");
    server.abort();
    let _ = server.await;
    drop(engine);
    println!(
        "{}",
        json!({"status":"finished","upstreamRequestsAfterAnalysis":count,"proxyStopped":true})
    );
    Ok(())
}
