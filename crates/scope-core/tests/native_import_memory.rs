use base64::{engine::general_purpose::STANDARD, Engine as _};
use scope_core::Engine;
use serde_json::{json, Value};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

// This integration-test binary owns its allocator. Only the calling test thread
// is measured, and setup/readback allocations are outside the measured window.
struct CountingAllocator;
thread_local! {
    static WATCHED_SIZE: Cell<usize> = const { Cell::new(0) };
    static MATCHING_ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

fn record_allocation(size: usize) {
    let _ = WATCHED_SIZE.try_with(|watched| {
        if watched.get() != 0 && watched.get() == size {
            let _ = MATCHING_ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
        }
    });
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record_allocation(layout.size());
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record_allocation(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        record_allocation(size);
        unsafe { System.realloc(pointer, layout, size) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn archive(rows: Vec<Value>) -> Value {
    json!({
        "format": "scope-session", "version": 1,
        "session": {"id":"source-session", "name":"Native fixture", "source":"fixture",
            "createdAt":1700000000000_i64, "exchangeCount":rows.len(), "revision":7,
            "notes":"Preserved notes", "tags":["native","fixture"], "pinned":true},
        "exchanges":rows
    })
}

fn exchange(id: &str, request_body: Value, response_body: Value) -> Value {
    json!({"id":id,"sessionId":"source-session","method":"POST",
        "url":format!("https://example.invalid/{id}"),"status":201,"completed":true,
        "requestHeaders":[],"responseHeaders":[],"requestBody":request_body,
        "responseBody":response_body,"requestBodyBase64":false,"responseBodyBase64":false,
        "startedAt":1700000000000_i64,"durationMs":17,"requestBytes":3,"responseBytes":4,
        "error":null,"edited":false,"originalRequest":null,"originalResponse":null,
        "provenance":"upstream","appliedRules":[]})
}

#[test]
fn consuming_native_import_does_not_duplicate_the_owned_body_tree() {
    // An odd size distinguishes exact body copies from serializer growth and
    // database page buffers. The one permitted allocation is body validation's
    // decoded byte buffer; cloning the input Value adds a second full copy.
    const BODY_BYTES: usize = 1_048_583;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let input = archive(vec![exchange(
        "large",
        json!("x".repeat(BODY_BYTES)),
        json!("ok"),
    )]);
    MATCHING_ALLOCATIONS.with(|count| count.set(0));
    WATCHED_SIZE.with(|size| size.set(BODY_BYTES));
    let result = engine.import_session(input);
    WATCHED_SIZE.with(|size| size.set(0));
    let copies = MATCHING_ALLOCATIONS.with(Cell::get);
    let imported = result.unwrap();
    eprintln!("Owned native import: {copies} allocations of {BODY_BYTES} bytes");
    assert!(copies <= 1, "native import made {copies} body-sized allocations; at most one validation buffer is needed for an owned body");
    let rows = engine.list_exchanges(&imported.id, None, 10, 0).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].request_body.len(), BODY_BYTES);
    assert!(rows[0].request_body.bytes().all(|byte| byte == b'x'));
}

#[test]
fn native_import_accepts_binary_body_at_the_decoded_capture_limit() {
    // Catches applying the limit to the larger base64 representation or using
    // >= instead of > at the decoded-byte boundary.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut row = exchange("boundary", json!(""), json!(""));
    row["requestBody"] =
        Value::String(STANDARD.encode(vec![0xff; scope_core::CAPTURE_LIMIT_BYTES]));
    row["requestBodyBase64"] = json!(true);
    let imported = engine.import_session(archive(vec![row])).unwrap();
    let rows = engine.list_exchanges(&imported.id, None, 10, 0).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].request_body_base64);
    let decoded = STANDARD.decode(&rows[0].request_body).unwrap();
    assert_eq!(decoded.len(), 16 * 1024 * 1024);
    assert!(decoded.iter().all(|byte| *byte == 0xff));
}

#[test]
fn native_import_preserves_paired_bodies_headers_originals_and_metadata_after_reopen() {
    // Catches field swaps, lost binary flags, reordered/deduplicated headers,
    // discarded original snapshots and failure to persist the imported records.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut binary = exchange("binary", json!("AP+A"), json!("QUL/AA=="));
    binary["requestBodyBase64"] = json!(true);
    binary["responseBodyBase64"] = json!(true);
    binary["requestHeaders"] = json!([
        {"name":"x-pair","value":"first"},
        {"name":"x-between","value":"middle"},
        {"name":"x-pair","value":"last"}
    ]);
    binary["responseHeaders"] = json!([
        {"name":"set-cookie","value":"one=1"},
        {"name":"x-response","value":"middle"},
        {"name":"set-cookie","value":"two=2"}
    ]);
    binary["edited"] = json!(true);
    binary["provenance"] = json!("mock");
    binary["appliedRules"] = json!([{"ruleId":"fixture-rule","name":"Fixture rewrite","action":"mockResponse","stage":"request"}]);
    binary["originalRequest"] = json!({"method":"PUT","url":"https://example.invalid/original",
        "headers":[{"name":"x-original","value":"first"},{"name":"x-original","value":"second"}],
        "body":"AQD/","bodyBase64":true});
    binary["originalResponse"] = json!({"status":202,"headers":[{"name":"x-original-response","value":"yes"}],
        "body":"original response\n","bodyBase64":false});
    let mut plain = exchange(
        "plain",
        json!("plain request\nzażółć\u{0}"),
        json!("plain response 🦀"),
    );
    plain["startedAt"] = json!(1700000000001_i64);
    plain["completed"] = json!(false);
    let mut interrupted = exchange("interrupted", json!(""), json!(""));
    interrupted["startedAt"] = json!(1700000000002_i64);
    interrupted["completed"] = json!(false);
    interrupted["error"] = json!("Original capture error");
    let imported = engine
        .import_session(archive(vec![binary, plain, interrupted]))
        .unwrap();
    assert_ne!(imported.id, "source-session");
    assert_eq!(imported.name, "Native fixture");
    assert_eq!(imported.source, "import");
    assert_eq!(imported.notes, "Preserved notes");
    assert_eq!(imported.tags, ["fixture", "native"]);
    assert!(imported.pinned);
    assert_eq!(imported.exchange_count, 3);
    assert_eq!(imported.revision, 3);
    let saved = engine.export_session(&imported.id).unwrap();
    drop(engine);

    let reopened = Engine::open(dir.path()).unwrap();
    assert_eq!(reopened.export_session(&imported.id).unwrap(), saved);
    let rows = reopened.list_exchanges(&imported.id, None, 10, 0).unwrap();
    assert_eq!(rows.len(), 3);
    let binary = rows
        .iter()
        .find(|row| row.url.ends_with("/binary"))
        .unwrap();
    assert_ne!(binary.id, "binary");
    assert_eq!(binary.session_id, imported.id);
    assert_eq!(binary.method, "POST");
    assert_eq!(binary.status, Some(201));
    assert_eq!(binary.started_at, 1700000000000_i64);
    assert_eq!(binary.duration_ms, 17);
    assert_eq!((binary.request_bytes, binary.response_bytes), (3, 4));
    assert!(binary.completed && binary.edited && binary.error.is_none());
    assert!(binary.request_body_base64 && binary.response_body_base64);
    assert_eq!(
        STANDARD.decode(&binary.request_body).unwrap(),
        [0, 255, 128]
    );
    assert_eq!(
        STANDARD.decode(&binary.response_body).unwrap(),
        [65, 66, 255, 0]
    );
    assert_eq!(
        serde_json::to_value(&binary.request_headers).unwrap(),
        json!([
            {"name":"x-pair","value":"first"},{"name":"x-between","value":"middle"},{"name":"x-pair","value":"last"}
        ])
    );
    assert_eq!(
        serde_json::to_value(&binary.response_headers).unwrap(),
        json!([
            {"name":"set-cookie","value":"one=1"},{"name":"x-response","value":"middle"},{"name":"set-cookie","value":"two=2"}
        ])
    );
    assert_eq!(
        binary.original_request.as_ref().unwrap(),
        &json!({"method":"PUT","url":"https://example.invalid/original",
        "headers":[{"name":"x-original","value":"first"},{"name":"x-original","value":"second"}],"body":"AQD/","bodyBase64":true})
    );
    assert_eq!(
        binary.original_response.as_ref().unwrap(),
        &json!({"status":202,"headers":[{"name":"x-original-response","value":"yes"}],
        "body":"original response\n","bodyBase64":false})
    );
    assert_eq!(serde_json::to_value(&binary.provenance).unwrap(), "mock");
    assert_eq!(
        serde_json::to_value(&binary.applied_rules).unwrap(),
        json!([{"ruleId":"fixture-rule","name":"Fixture rewrite","action":"mockResponse","stage":"request"}])
    );
    let plain = rows.iter().find(|row| row.url.ends_with("/plain")).unwrap();
    assert_ne!(plain.id, "plain");
    assert_eq!(plain.session_id, imported.id);
    assert_ne!(plain.id, binary.id);
    assert_eq!(plain.request_body, "plain request\nzażółć\u{0}");
    assert_eq!(plain.response_body, "plain response 🦀");
    assert!(!plain.request_body_base64 && !plain.response_body_base64);
    assert!(plain.completed);
    assert_eq!(
        plain.error.as_deref(),
        Some("Imported exchange was not completed in the source capture")
    );
    let interrupted = rows
        .iter()
        .find(|row| row.url.ends_with("/interrupted"))
        .unwrap();
    assert!(interrupted.completed);
    assert_eq!(interrupted.error.as_deref(), Some("Original capture error"));
    assert_eq!(interrupted.session_id, imported.id);
    assert!(interrupted.request_body.is_empty() && interrupted.response_body.is_empty());
}

#[test]
fn native_import_rejects_a_bad_late_row_without_sessions_exchanges_or_audit_writes() {
    // Catches validation moved after partial writes, skipped late rows and
    // missing decoded-size/base64/field validation.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let seed = engine
        .import_session(archive(vec![exchange(
            "existing",
            json!("kept"),
            json!("also kept"),
        )]))
        .unwrap();
    let sessions_before = serde_json::to_value(engine.list_sessions().unwrap()).unwrap();
    let audit_before = serde_json::to_value(engine.list_audit(100).unwrap()).unwrap();
    let archive_before = engine.export_session(&seed.id).unwrap();
    for (field, bad_value) in [
        ("url", json!("file:///invalid")),
        ("method", json!("invalid method")),
        ("status", json!(99)),
        (
            "requestHeaders",
            json!([{"name":"bad\nname","value":"value"}]),
        ),
        (
            "responseHeaders",
            json!([{"name":"x-valid","value":"bad\nvalue"}]),
        ),
        ("durationMs", json!(-1)),
        ("requestBytes", json!(-1)),
        ("responseBytes", json!(-1)),
        ("requestBody", json!(false)),
    ] {
        let mut bad = exchange("late", json!("late request"), json!("late response"));
        bad[field] = bad_value;
        let result = engine.import_session(archive(vec![
            exchange("first", json!("first request"), json!("first response")),
            bad,
        ]));
        assert!(result.is_err(), "accepted invalid late-row {field}");
        assert_eq!(
            serde_json::to_value(engine.list_sessions().unwrap()).unwrap(),
            sessions_before,
            "session changed after rejecting {field}"
        );
        assert_eq!(
            serde_json::to_value(engine.list_audit(100).unwrap()).unwrap(),
            audit_before,
            "audit changed after rejecting {field}"
        );
        assert_eq!(engine.export_session(&seed.id).unwrap(), archive_before);
    }
    for field in ["requestBody", "responseBody"] {
        let mut bad = exchange("late", json!(""), json!(""));
        bad[field] = json!("%%%invalid-base64%%%");
        bad[format!("{field}Base64")] = json!(true);
        assert!(engine
            .import_session(archive(vec![
                exchange("first", json!("first"), json!("response")),
                bad
            ]))
            .is_err());
        assert_eq!(
            serde_json::to_value(engine.list_sessions().unwrap()).unwrap(),
            sessions_before
        );
        assert_eq!(
            serde_json::to_value(engine.list_audit(100).unwrap()).unwrap(),
            audit_before
        );
    }
    for (field, base64) in [
        ("requestBody", false),
        ("responseBody", false),
        ("requestBody", true),
        ("responseBody", true),
    ] {
        let mut bad = exchange("late", json!(""), json!(""));
        let oversized = if base64 {
            STANDARD.encode(vec![0xff; scope_core::CAPTURE_LIMIT_BYTES + 1])
        } else {
            "x".repeat(scope_core::CAPTURE_LIMIT_BYTES + 1)
        };
        bad[field] = Value::String(oversized);
        bad[format!("{field}Base64")] = json!(base64);
        assert!(
            engine
                .import_session(archive(vec![
                    exchange("first", json!("first"), json!("response")),
                    bad
                ]))
                .is_err(),
            "accepted oversized {field}, base64={base64}"
        );
        assert_eq!(
            serde_json::to_value(engine.list_sessions().unwrap()).unwrap(),
            sessions_before
        );
        assert_eq!(
            serde_json::to_value(engine.list_audit(100).unwrap()).unwrap(),
            audit_before
        );
    }
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    let exchange_count: i64 = db
        .query_row("SELECT count(*) FROM exchanges", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        exchange_count, 1,
        "rejected imports left orphan or partial exchange rows"
    );
    drop(db);
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    assert_eq!(
        serde_json::to_value(reopened.list_sessions().unwrap()).unwrap(),
        sessions_before
    );
    assert_eq!(
        serde_json::to_value(reopened.list_audit(100).unwrap()).unwrap(),
        audit_before
    );
    assert_eq!(reopened.export_session(&seed.id).unwrap(), archive_before);
}

#[test]
fn native_import_rejects_malformed_envelopes_without_panicking_or_writing() {
    // Taking fields out of a consumed Value must preserve fallible validation
    // for absent/wrong-type envelopes rather than introducing indexing panics.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut inputs = vec![
        Value::Null,
        json!([]),
        json!(true),
        json!({}),
        json!({"format":"scope-session","version":2}),
    ];
    for (field, value) in [
        ("session", Value::Null),
        ("session", json!([])),
        ("exchanges", Value::Null),
        ("exchanges", json!({})),
        ("exchanges", json!([null])),
    ] {
        let mut input = archive(vec![]);
        input[field] = value;
        inputs.push(input);
    }
    for field in ["format", "version", "session", "exchanges"] {
        let mut input = archive(vec![]);
        input.as_object_mut().unwrap().remove(field);
        inputs.push(input);
    }
    let audit_before = serde_json::to_value(engine.list_audit(100).unwrap()).unwrap();
    for input in inputs {
        assert!(engine.import_session(input).is_err());
        assert!(engine.list_sessions().unwrap().is_empty());
        assert_eq!(
            serde_json::to_value(engine.list_audit(100).unwrap()).unwrap(),
            audit_before
        );
    }
}
