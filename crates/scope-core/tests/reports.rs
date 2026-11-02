use scope_core::{Engine, SessionUpdate};
use serde_json::{json, Value};

fn exchange(id: &str, url: &str, status: u16, body: Value) -> Value {
    json!({"id":id,"sessionId":"source","method":"POST","url":url,"status":status,"completed":true,"requestHeaders":[{"name":"content-type","value":"application/json"},{"name":"authorization","value":"Bearer HEADER_SECRET_739"},{"name":"cookie","value":"sid=COOKIE_SECRET_278"}],"responseHeaders":[{"name":"content-type","value":"application/json; charset=utf-8"},{"name":"set-cookie","value":"access=COOKIE_RESPONSE_SECRET_219"}],"requestBody":"{\"password\":\"BODY_SECRET_563\",\"name\":\"Example\"}","responseBody":serde_json::to_string(&body).unwrap(),"requestBodyBase64":false,"responseBodyBase64":false,"startedAt":1700000000000_i64,"durationMs":100,"requestBytes":20,"responseBytes":100,"error":null,"edited":false,"originalRequest":null,"originalResponse":null,"provenance":"upstream","appliedRules":[]})
}
fn archive(engine: &Engine, rows: Vec<Value>) -> scope_core::Session {
    let original = engine
        .create_session("Original".into(), "fixture".into())
        .unwrap();
    engine
        .import_session(
            json!({"format":"scope-session","version":1,"session":original,"exchanges":rows}),
        )
        .unwrap()
}
#[test]
fn native_import_preserves_validated_metadata_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let source = archive(
        &engine,
        vec![exchange(
            "1",
            "https://api.example.com/users/123",
            200,
            json!({"ok":true}),
        )],
    );
    engine
        .update_session(
            &source.id,
            SessionUpdate {
                name: Some("Investigation".into()),
                notes: Some("Review notes\nretained".into()),
                tags: Some(vec!["android".into(), "release".into()]),
                pinned: Some(true),
            },
        )
        .unwrap();
    let exported = engine.export_session(&source.id).unwrap();
    let imported = engine.import_session(exported.clone()).unwrap();
    assert_eq!(imported.name, "Investigation");
    assert!(imported.pinned);
    assert_eq!(imported.tags, vec!["android", "release"]);
    assert!(imported.notes.contains("retained"));
    assert_eq!(imported.exchange_count, 1);
    let count = engine.list_sessions().unwrap().len();
    let audit_count = engine.list_audit(100).unwrap().len();
    for (field, bad) in [
        ("tags", json!(["bad\ncontrol"])),
        ("notes", json!("x".repeat(16385))),
        ("name", json!("bad\nname")),
    ] {
        let mut invalid = exported.clone();
        invalid["session"][field] = bad;
        assert!(engine.import_session(invalid).is_err());
        assert_eq!(engine.list_sessions().unwrap().len(), count);
        assert_eq!(engine.list_audit(100).unwrap().len(), audit_count);
    }
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    let restored = reopened
        .list_sessions()
        .unwrap()
        .into_iter()
        .find(|session| session.id == imported.id)
        .unwrap();
    assert_eq!(restored.notes, imported.notes);
    assert_eq!(restored.tags, imported.tags);
    assert_eq!(restored.pinned, imported.pinned);
}
#[test]
fn har_roundtrip_keeps_rule_provenance_originals_and_historical_completion() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut row = exchange(
        "mock",
        "https://api.example.com/items",
        201,
        json!({"mock":true}),
    );
    row["provenance"] = json!("mock");
    row["appliedRules"] = json!([{"ruleId":"evidence-id","name":"Offline mock","action":"mockResponse","stage":"request"}]);
    row["originalResponse"] = json!({"body":"original"});
    row["edited"] = json!(true);
    let source = archive(&engine, vec![row]);
    let mut har = engine.export_har(&source.id).unwrap();
    assert_eq!(har["log"]["entries"][0]["_scope"]["provenance"], "mock");
    assert_eq!(har["log"]["entries"][0]["_scope"]["completed"], true);
    let imported = engine.import_har(har.clone(), "HAR".into()).unwrap();
    let row = engine
        .list_exchanges(&imported.id, None, 10, 0)
        .unwrap()
        .remove(0);
    assert_eq!(serde_json::to_value(&row.provenance).unwrap(), "mock");
    assert_eq!(row.applied_rules[0].name, "Offline mock");
    assert_eq!(row.original_response.unwrap()["body"], "original");
    assert!(row.completed);
    assert!(row.error.is_none());
    har["log"]["entries"][0]["_scope"]["completed"] = json!(false);
    let imported = engine
        .import_har(har, "Incomplete historical HAR".into())
        .unwrap();
    let row = engine
        .list_exchanges(&imported.id, None, 10, 0)
        .unwrap()
        .remove(0);
    assert!(row.completed);
    assert!(row.error.unwrap().contains("not completed"));
}
#[test]
fn analysis_excludes_pending_errors_and_latency_and_bounds_observation_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut rows = Vec::new();
    for i in 0..65 {
        rows.push(exchange(
            &i.to_string(),
            "http://api.example.com/users/12?access_token=QUERY_SECRET_965",
            500,
            json!({"error":"private error value"}),
        ));
    }
    let session = archive(&engine, rows);
    // Mark one row as genuinely in-flight in the existing engine, rather than importing
    // an in-flight historical archive (which intentionally becomes completed + interrupted).
    let row = engine
        .list_exchanges(&session.id, None, 1, 0)
        .unwrap()
        .remove(0);
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    db.execute("UPDATE exchanges SET data=json_set(data,'$.completed',json('false'),'$.durationMs',999999,'$.error','Pending placeholder') WHERE id=?1",[&row.id]).unwrap();
    drop(db);
    let report = engine.analysis(&session.id).unwrap();
    assert_eq!(report["totalRequests"], 65);
    assert_eq!(report["completedRequests"], 64);
    assert_eq!(report["inFlightRequests"], 1);
    assert_eq!(report["totalErrors"], 64);
    assert_eq!(report["averageDurationMs"], 100.0);
    assert_eq!(report["p95DurationMs"], 100);
    assert!(report["insights"]
        .as_array()
        .unwrap()
        .iter()
        .all(|insight| insight["kind"] != "latency"));
    let error = report["insights"]
        .as_array()
        .unwrap()
        .iter()
        .find(|insight| insight["kind"] == "error")
        .unwrap();
    assert_eq!(error["exchangeIds"].as_array().unwrap().len(), 50);
    assert_eq!(error["count"], 64);
    assert_eq!(error["evidenceTruncated"], true);
    assert!(report["insights"]
        .as_array()
        .unwrap()
        .iter()
        .any(|insight| insight["kind"] == "security"));
    let output = serde_json::to_string(&report).unwrap();
    assert!(!output.contains("QUERY_SECRET_965"));
    assert!(!output.contains("HEADER_SECRET_739"));
}
#[test]
fn observed_openapi_omits_values_and_credentials_and_preserves_structure_and_provenance() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut first=exchange("one","https://api.example.com/users/123/orders/550e8400-e29b-41d4-a716-446655440000?access_token=QUERY_SECRET_965&limit=20",200,json!({"id":987,"token":"RESPONSE_SECRET_346","nested":{"enabled":true},"items":[{"price":12.5}]}));
    first["provenance"] = json!("mock");
    let second = exchange(
        "two",
        "https://api.example.com/users/456/orders/55?limit=30",
        404,
        json!({"message":"NOT_FOUND_SECRET_354"}),
    );
    let session = archive(&engine, vec![first, second]);
    engine
        .update_session(
            &session.id,
            SessionUpdate {
                name: Some("SESSION_SECRET_432".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let doc = engine.infer_openapi(&session.id).unwrap();
    assert_eq!(doc["openapi"], "3.1.1");
    let operation = &doc["paths"]["/users/{id1}/orders/{id2}"]["post"];
    assert_eq!(operation["servers"][0]["url"], "https://api.example.com");
    assert_eq!(operation["x-scope-observations"]["count"], 2);
    assert_eq!(operation["x-scope-observations"]["mock"], 1);
    assert_eq!(operation["x-scope-observations"]["upstream"], 1);
    let parameters = operation["parameters"].as_array().unwrap();
    assert!(parameters
        .iter()
        .any(|p| p["name"] == "id1" && p["in"] == "path" && p["required"] == true));
    assert!(parameters.iter().any(|p| p["name"] == "id2"));
    assert!(parameters
        .iter()
        .any(|p| p["name"] == "access_token" && p["in"] == "query"));
    let schema = &operation["responses"]["200"]["content"]["application/json"]["schema"];
    assert_eq!(schema["properties"]["id"]["type"], "integer");
    assert_eq!(
        schema["properties"]["nested"]["properties"]["enabled"]["type"],
        "boolean"
    );
    assert_eq!(
        schema["properties"]["items"]["items"]["properties"]["price"]["type"],
        "number"
    );
    assert!(schema.get("required").is_none());
    assert_eq!(
        operation["requestBody"]["content"]["application/json"]["schema"]["properties"]["password"]
            ["type"],
        "string"
    );
    let text = serde_json::to_string(&doc).unwrap();
    for secret in [
        "QUERY_SECRET_965",
        "HEADER_SECRET_739",
        "BODY_SECRET_563",
        "COOKIE_SECRET_278",
        "COOKIE_RESPONSE_SECRET_219",
        "RESPONSE_SECRET_346",
        "NOT_FOUND_SECRET_354",
        "SESSION_SECRET_432",
    ] {
        assert!(!text.contains(secret), "Leaked {secret}");
    }
    assert!(!text.contains("\"example\""));
    assert!(!text.contains("\"examples\""));
    assert!(!text.contains("\"default\""));
    assert!(!text.contains("550e8400-e29b-41d4-a716-446655440000"));
    assert_eq!(doc["x-scope"]["observedOnly"], true);
}
#[test]
fn observed_openapi_bounds_schema_and_omits_inflight_and_capture_errors() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut properties = serde_json::Map::new();
    for i in 0..100 {
        properties.insert(
            format!("field{i}"),
            json!({"deep":{"one":{"two":{"three":{"four":{"five":{"secret":"not emitted"}}}}}}}),
        );
    }
    let mut failed = exchange(
        "failed",
        "https://api.example.com/failure",
        200,
        json!({"never":"infer"}),
    );
    failed["error"] = json!("Capture rejected oversized response");
    let session = archive(
        &engine,
        vec![
            exchange(
                "wide",
                "https://api.example.com/wide",
                200,
                Value::Object(properties),
            ),
            failed,
            exchange(
                "pending",
                "https://api.example.com/pending",
                200,
                json!({"pending":"never"}),
            ),
        ],
    );
    let pending = engine
        .list_exchanges(&session.id, Some("/pending"), 1, 0)
        .unwrap()
        .remove(0);
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    db.execute(
        "UPDATE exchanges SET data=json_set(data,'$.completed',json('false')) WHERE id=?1",
        [&pending.id],
    )
    .unwrap();
    drop(db);
    let doc = engine.infer_openapi(&session.id).unwrap();
    assert!(doc["paths"].get("/failure").is_none());
    assert!(doc["paths"].get("/pending").is_none());
    assert_eq!(doc["x-scope"]["eligibleExchanges"], 1);
    assert_eq!(doc["x-scope"]["truncated"], true);
    let schema =
        &doc["paths"]["/wide"]["post"]["responses"]["200"]["content"]["application/json"]["schema"];
    assert!(schema["properties"].as_object().unwrap().len() <= 40);
    assert!(serde_json::to_vec(&doc).unwrap().len() < 50000);
}
