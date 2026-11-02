use http_body_util::BodyExt;
use hudsucker::{
    hyper::{service::service_fn, Request, Response},
    hyper_util::{
        rt::{TokioExecutor, TokioIo},
        server::conn::auto,
    },
    rcgen::{CertificateParams, Issuer, KeyPair},
    rustls::{self, crypto::aws_lc_rs},
    Body,
};
use scope_core::{EditMessage, Engine, Header, CAPTURE_LIMIT_BYTES};
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio::{net::TcpListener, task::JoinHandle};

#[test]
fn legacy_archive_migrates_without_losing_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    db.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL); INSERT INTO sessions VALUES('legacy-session','Existing capture','desktop',1);").unwrap();
    drop(db);
    let engine = Engine::open(dir.path()).unwrap();
    let old = engine.list_sessions().unwrap().remove(0);
    assert_eq!(old.id, "legacy-session");
    assert_eq!(old.name, "Existing capture");
    assert_eq!(old.revision, 0);
    engine
        .create_session("New capture".into(), "desktop".into())
        .unwrap();
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    assert_eq!(reopened.list_sessions().unwrap().len(), 2);
}

async fn handler(
    req: Request<hudsucker::hyper::body::Incoming>,
) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_owned();
    let custom = req.headers().get("x-edited").cloned();
    let bytes = req.into_body().collect().await.unwrap().to_bytes();
    let mut res = Response::builder()
        .header("content-type", "application/octet-stream")
        .header("set-cookie", "one=1")
        .header("set-cookie", "two=2");
    if custom.is_some() {
        res = res.header("x-saw-edit", "yes");
    }
    Ok(if path == "/binary" {
        res.body(Body::from(vec![0, 255, 128, 42])).unwrap()
    } else if path == "/large" {
        res.body(Body::from(vec![b'x'; CAPTURE_LIMIT_BYTES + 1]))
            .unwrap()
    } else {
        res.body(Body::from(bytes)).unwrap()
    })
}
async fn server(engine: &Engine, tls: bool) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let acceptor = if tls {
        let key = KeyPair::generate().unwrap();
        let ca_key = KeyPair::from_pem(
            &std::fs::read_to_string(engine.data_dir().join("scope-ca-key.pem")).unwrap(),
        )
        .unwrap();
        let issuer = Issuer::from_ca_cert_pem(
            &std::fs::read_to_string(engine.ca_cert_path()).unwrap(),
            ca_key,
        )
        .unwrap();
        let cert = CertificateParams::new(vec!["localhost".into()])
            .unwrap()
            .signed_by(&key, &issuer)
            .unwrap();
        let config =
            rustls::ServerConfig::builder_with_provider(Arc::new(aws_lc_rs::default_provider()))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(
                    vec![cert.der().clone()],
                    rustls::pki_types::PrivatePkcs8KeyDer::from(key.serialize_der()).into(),
                )
                .unwrap();
        Some(tokio_rustls::TlsAcceptor::from(Arc::new(config)))
    } else {
        None
    };
    let task = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let server = auto::Builder::new(TokioExecutor::new());
                if let Some(tls) = acceptor {
                    if let Ok(tls) = tls.accept(stream).await {
                        let _ = server
                            .serve_connection(TokioIo::new(tls), service_fn(handler))
                            .await;
                    }
                } else {
                    let _ = server
                        .serve_connection(TokioIo::new(stream), service_fn(handler))
                        .await;
                }
            });
        }
    });
    (
        format!(
            "{}://{}:{}",
            if tls { "https" } else { "http" },
            if tls { "localhost" } else { "127.0.0.1" },
            addr.port()
        ),
        task,
    )
}
fn client(engine: &Engine, port: u16) -> reqwest::Client {
    reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .add_root_certificate(
            reqwest::Certificate::from_pem(&std::fs::read(engine.ca_cert_path()).unwrap()).unwrap(),
        )
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}
async fn pending(engine: &Engine, stage: &str) -> scope_core::PendingExchange {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(p) = engine.pending().into_iter().find(|p| p.stage == stage) {
                return p;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}
#[tokio::test]
async fn http_binary_persists_reopens_exports_and_replays() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = engine
        .create_session("Test".into(), "integration".into())
        .unwrap();
    let proxy = engine.start_proxy(session.id.clone(), 0).await.unwrap();
    let (url, server) = server(&engine, false).await;
    let client = client(&engine, proxy.port);
    let response = client
        .post(format!("{url}/echo"))
        .header("x-custom", "hello")
        .body(vec![1, 255, 128])
        .send()
        .await
        .unwrap();
    assert_eq!(response.bytes().await.unwrap().as_ref(), &[1, 255, 128]);
    assert_eq!(
        client
            .get(format!("{url}/binary"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        &[0, 255, 128, 42]
    );
    engine.stop_proxy().await.unwrap();
    let reopened = Engine::open(dir.path()).unwrap();
    let exchanges = reopened.list_exchanges(&session.id, None, 100, 0).unwrap();
    assert_eq!(exchanges.len(), 2);
    assert!(exchanges
        .iter()
        .all(|e| e.response_body_base64 && e.error.is_none()));
    assert_eq!(exchanges[1].request_body, "Af+A");
    assert_eq!(
        exchanges[0]
            .response_headers
            .iter()
            .filter(|h| h.name == "set-cookie")
            .count(),
        2
    );
    let replay = reopened.replay(&exchanges[1].id, None).await.unwrap();
    assert_eq!(replay.status, Some(200));
    assert_eq!(replay.response_body, "Af+A");
    assert!(replay.error.is_none());
    assert_ne!(replay.id, exchanges[1].id);
    let archive = reopened.export_session(&session.id).unwrap();
    let imported = reopened.import_session(archive).unwrap();
    assert_eq!(imported.exchange_count, 3);
    let har = reopened.export_har(&session.id).unwrap();
    let har_session = reopened.import_har(har, "HAR roundtrip".into()).unwrap();
    assert_eq!(har_session.exchange_count, 3);
    let har_entries = reopened
        .list_exchanges(&har_session.id, None, 10, 0)
        .unwrap();
    assert!(har_entries.iter().all(|e| e.response_body_base64));
    assert_eq!(reopened.analysis(&session.id).unwrap()["totalRequests"], 3);
    let cmp = reopened
        .compare_sessions(&session.id, &har_session.id)
        .unwrap();
    assert_eq!(cmp["changedEndpoints"].as_array().unwrap().len(), 0);
    server.abort();
}
#[tokio::test]
async fn https_mitm_edits_request_and_response_and_keeps_originals() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let s = engine
        .create_session("HTTPS".into(), "integration".into())
        .unwrap();
    let status = engine.start_proxy(s.id.clone(), 0).await.unwrap();
    let (url, server) = server(&engine, true).await;
    let client = client(&engine, status.port);
    engine.set_breakpoints(true, true);
    let handle = tokio::spawn(async move {
        client
            .post(format!("{url}/echo"))
            .body("before")
            .send()
            .await
            .unwrap()
    });
    let p = pending(&engine, "request").await;
    let request_revision = engine.list_sessions().unwrap()[0].revision;
    assert_eq!(p.body, "before");
    engine
        .resolve_breakpoint(
            &p.id,
            EditMessage {
                action: "continue".into(),
                headers: Some(vec![Header {
                    name: "x-edited".into(),
                    value: "yes".into(),
                }]),
                body: Some("upstream-edited".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let p = pending(&engine, "response").await;
    let response_revision = engine.list_sessions().unwrap()[0].revision;
    assert!(response_revision > request_revision);
    assert_eq!(p.body, "upstream-edited");
    assert!(p.headers.iter().any(|h| h.name == "x-saw-edit"));
    engine
        .resolve_breakpoint(
            &p.id,
            EditMessage {
                action: "continue".into(),
                status: Some(201),
                body: Some("client-edited".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let response = handle.await.unwrap();
    assert_eq!(response.status(), 201);
    assert_eq!(response.text().await.unwrap(), "client-edited");
    let e = engine.list_exchanges(&s.id, None, 10, 0).unwrap().remove(0);
    assert!(e.edited);
    assert_eq!(e.original_request.unwrap()["body"], "before");
    assert_eq!(e.original_response.unwrap()["body"], "upstream-edited");
    assert!(e.error.is_none());
    let completed_session = engine.list_sessions().unwrap().remove(0);
    assert_eq!(completed_session.exchange_count, 1);
    assert!(completed_session.revision > response_revision);
    engine.stop_proxy().await.unwrap();
    assert_eq!(
        Engine::open(dir.path()).unwrap().list_sessions().unwrap()[0].revision,
        completed_session.revision
    );
    server.abort();
}
#[tokio::test]
async fn upstream_failure_oversize_and_shutdown_are_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let s = engine
        .create_session("Failures".into(), "integration".into())
        .unwrap();
    let status = engine.start_proxy(s.id.clone(), 0).await.unwrap();
    let (url, server) = server(&engine, false).await;
    let client = client(&engine, status.port);
    let res = client.get(format!("{url}/large")).send().await.unwrap();
    assert_eq!(res.status(), 502);
    assert!(res.text().await.unwrap().contains("16 MiB"));
    let e = engine.list_exchanges(&s.id, None, 10, 0).unwrap().remove(0);
    assert!(e.error.unwrap().contains("16 MiB"));
    assert_eq!(e.response_body, "");
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    assert_eq!(
        client
            .get(format!("http://127.0.0.1:{port}/unreachable"))
            .send()
            .await
            .unwrap()
            .status(),
        502
    );
    engine.set_breakpoints(true, false);
    let task = tokio::spawn(async move { client.get(format!("{url}/echo")).send().await });
    let _ = pending(&engine, "request").await;
    let start = std::time::Instant::now();
    engine.stop_proxy().await.unwrap();
    assert!(start.elapsed() < Duration::from_secs(5));
    assert!(engine.pending().is_empty());
    let _ = task.await;
    assert!(engine
        .list_exchanges(&s.id, None, 100, 0)
        .unwrap()
        .iter()
        .all(|e| e.error.is_some()));
    server.abort();
}
#[test]
fn malformed_import_rolls_back_and_edits_validate() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = engine
        .create_session("Source".into(), "test".into())
        .unwrap();
    assert!(engine.import_har(serde_json::json!({"log":{"entries":[{"request":{"method":"GET","url":"file:///etc/passwd"},"response":{"status":200}}]}}),"bad".into()).is_err());
    assert_eq!(engine.list_sessions().unwrap().len(), 1);
    assert!(engine.import_session(serde_json::json!({"format":"scope-session","version":99,"session":session,"exchanges":[]})).is_err());
}

#[tokio::test]
async fn concurrent_exchanges_keep_request_response_pairing() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = engine
        .create_session("Concurrent".into(), "integration".into())
        .unwrap();
    let proxy = engine.start_proxy(session.id.clone(), 0).await.unwrap();
    let (url, server) = server(&engine, false).await;
    let client = client(&engine, proxy.port);
    let mut calls = Vec::new();
    for index in 0..32 {
        let client = client.clone();
        let url = format!("{url}/echo/{index}");
        calls.push(tokio::spawn(async move {
            let body = format!("request-{index}");
            assert_eq!(
                client
                    .post(url)
                    .body(body.clone())
                    .send()
                    .await
                    .unwrap()
                    .text()
                    .await
                    .unwrap(),
                body
            );
        }));
    }
    for call in calls {
        call.await.unwrap();
    }
    engine.stop_proxy().await.unwrap();
    let exchanges = engine.list_exchanges(&session.id, None, 100, 0).unwrap();
    assert_eq!(exchanges.len(), 32);
    assert!(exchanges
        .iter()
        .all(|e| e.error.is_none() && e.request_body == e.response_body));
    assert_eq!(
        engine.analysis(&session.id).unwrap()["endpoints"][0]["count"],
        32
    );
    server.abort();
}

#[tokio::test]
async fn manual_abort_returns_error_and_invalid_edit_keeps_breakpoint_waiting() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = engine
        .create_session("Abort".into(), "integration".into())
        .unwrap();
    let proxy = engine.start_proxy(session.id.clone(), 0).await.unwrap();
    let (url, server) = server(&engine, false).await;
    let client = client(&engine, proxy.port);
    engine.set_breakpoints(true, false);
    let call = tokio::spawn(async move { client.get(format!("{url}/echo")).send().await.unwrap() });
    let p = pending(&engine, "request").await;
    assert!(engine
        .resolve_breakpoint(
            &p.id,
            EditMessage {
                action: "continue".into(),
                url: Some("file:///etc/passwd".into()),
                ..Default::default()
            }
        )
        .is_err());
    assert_eq!(engine.pending().len(), 1);
    engine
        .resolve_breakpoint(
            &p.id,
            EditMessage {
                action: "abort".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(call.await.unwrap().status(), 502);
    assert!(engine
        .get_exchange(&p.exchange_id)
        .unwrap()
        .error
        .unwrap()
        .contains("aborted"));
    engine.stop_proxy().await.unwrap();
    server.abort();
}
