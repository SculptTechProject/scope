use scope_core::{Engine, Session};
use serde_json::{json, Value};

fn exchange(label: &str, method: &str, url: &str, status: Option<u16>) -> Value {
    json!({
        "id": label, "sessionId": "synthetic-source", "method": method, "url": url,
        "status": status, "completed": true, "requestHeaders": [], "responseHeaders": [],
        "requestBody": "", "responseBody": "", "requestBodyBase64": false,
        "responseBodyBase64": false, "startedAt": 1700000000000_i64, "durationMs": 1,
        "requestBytes": 0, "responseBytes": 0, "error": null, "edited": false,
        "originalRequest": null, "originalResponse": null, "provenance": "upstream",
        "appliedRules": []
    })
}

fn row(label: &str, status: Option<u16>) -> Value {
    exchange(
        label,
        "GET",
        &format!("https://api.example.test/{label}"),
        status,
    )
}

fn archive(engine: &Engine, rows: Vec<Value>) -> Session {
    engine
        .import_session(json!({
            "format": "scope-session", "version": 1,
            "session": {"id": "synthetic-source", "name": "Search fixture", "source": "fixture",
                        "createdAt": 1700000000000_i64, "exchangeCount": rows.len()},
            "exchanges": rows
        }))
        .unwrap()
}

fn paths(
    engine: &Engine,
    session: &Session,
    query: &str,
    limit: usize,
    offset: usize,
) -> Vec<String> {
    engine
        .list_exchanges(&session.id, Some(query), limit, offset)
        .unwrap_or_else(|error| panic!("valid search failed: {error}"))
        .into_iter()
        .map(|e| url::Url::parse(&e.url).unwrap().path().to_owned())
        .collect()
}

#[test]
fn method_and_host_match_exact_values_case_insensitively() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(
        &engine,
        vec![
            exchange(
                "target",
                "POST",
                "https://API.example.test:8443/target",
                Some(201),
            ),
            exchange(
                "suffix",
                "POST",
                "https://api.example.test.attacker.test/suffix",
                Some(201),
            ),
            exchange("other", "GET", "https://api.example.test/other", Some(200)),
            exchange(
                "method-prefix",
                "POSTER",
                "https://api.example.test/method-prefix",
                Some(200),
            ),
            exchange("ipv6", "POST", "https://[2001:db8::1]:8080/ipv6", Some(201)),
        ],
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:method=pOsT host=api.EXAMPLE.test",
            100,
            0
        ),
        ["/target"]
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:method!=post host=api.example.test",
            100,
            0
        ),
        ["/method-prefix", "/other"]
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:host!=api.example.test method=POST",
            100,
            0
        ),
        ["/ipv6", "/suffix"]
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:host=[2001:0db8:0:0:0:0:0:1]",
            100,
            0
        ),
        ["/ipv6"]
    );
}

#[test]
fn status_comparisons_exclude_missing_status_even_for_not_equal() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(
        &engine,
        vec![
            row("ok", Some(200)),
            row("redirect", Some(302)),
            row("error", Some(404)),
            row("missing", None),
        ],
    );
    for (query, expected) in [
        ("filter:status=302", vec!["/redirect"]),
        ("filter:status!=302", vec!["/error", "/ok"]),
        ("filter:status>302", vec!["/error"]),
        ("filter:status>=302", vec!["/error", "/redirect"]),
        ("filter:status<302", vec!["/ok"]),
        ("filter:status<=302", vec!["/redirect", "/ok"]),
        ("filter:status>=200 status<400", vec!["/redirect", "/ok"]),
    ] {
        assert_eq!(paths(&engine, &session, query, 100, 0), expected, "{query}");
    }
}

#[test]
fn body_predicates_search_each_plain_body_without_matching_encoded_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut request = row("request", Some(200));
    request["requestBody"] = json!("Needle in request");
    let mut response = row("response", Some(200));
    response["responseBody"] = json!("NEEDLE in response");
    let mut binary = row("binary", Some(200));
    binary["requestBody"] = json!("TmVlZGxl"); // base64 for Needle
    binary["requestBodyBase64"] = json!(true);
    binary["responseBody"] = json!("TmVlZGxl");
    binary["responseBodyBase64"] = json!(true);
    let mut mixed = row("mixed", Some(200));
    mixed["requestBody"] = json!("TmVlZGxl");
    mixed["requestBodyBase64"] = json!(true);
    mixed["responseBody"] = json!("needle plain");
    let mut split = row("split", Some(200));
    split["requestBody"] = json!("nee");
    split["responseBody"] = json!("dle");
    let session = archive(&engine, vec![request, response, binary, mixed, split]);
    assert_eq!(
        paths(&engine, &session, "filter:body~=needle", 100, 0),
        ["/mixed", "/response", "/request"]
    );
    assert!(paths(&engine, &session, "filter:body~=TmVlZGxl", 100, 0).is_empty());
}

#[test]
fn quoted_values_and_terms_preserve_literal_characters_and_and_semantics() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut target = row("target", Some(200));
    target["responseBody"] = json!(r#"hello world say "yes" C:\tmp https://example.test/a?x=%_"#);
    target["edited"] = json!(true);
    let mut decoy = row("decoy", Some(200));
    decoy["responseBody"] = json!("hello world");
    let session = archive(&engine, vec![target, decoy]);
    assert_eq!(
        paths(
            &engine,
            &session,
            r#"filter: body~="HELLO world" edited=true "#,
            100,
            0
        ),
        ["/target"]
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            r#"filter:body~="say \"yes\"" body~="C:\\tmp""#,
            100,
            0
        ),
        ["/target"]
    );
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:body~=https://example.test/a?x=%_",
            100,
            0
        ),
        ["/target"]
    );
    assert!(paths(
        &engine,
        &session,
        "filter:body~=https://example.test/a?x=%X",
        100,
        0
    )
    .is_empty());
    assert_eq!(
        paths(&engine, &session, "filter:edited=false", 100, 0),
        ["/decoy"]
    );
}

#[test]
fn states_distinguish_inflight_http_failures_capture_errors_and_empty_errors() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut capture_error = row("capture-error", None);
    capture_error["error"] = json!("Synthetic capture failure");
    let mut empty_error = row("empty-error", Some(200));
    empty_error["error"] = json!("");
    let mut pending = row("pending", Some(503));
    pending["error"] = json!("Synthetic pending placeholder");
    let session = archive(
        &engine,
        vec![
            row("ok", Some(200)),
            row("http-error", Some(400)),
            capture_error,
            empty_error,
            pending,
        ],
    );
    // Historical imports intentionally complete interrupted captures. Set an in-flight
    // persisted fixture as reports.rs does, without starting a proxy or touching live data.
    let pending_id = engine
        .list_exchanges(&session.id, Some("/pending"), 1, 0)
        .unwrap()[0]
        .id
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    db.execute(
        "UPDATE exchanges SET data=json_set(data,'$.completed',json('false')) WHERE id=?1",
        [&pending_id],
    )
    .unwrap();
    drop(db);
    assert_eq!(
        paths(&engine, &session, "filter:state=pending", 100, 0),
        ["/pending"]
    );
    assert_eq!(
        paths(&engine, &session, "filter:state=error", 100, 0),
        ["/capture-error", "/http-error"]
    );
    assert_eq!(
        paths(&engine, &session, "filter:state=complete", 100, 0),
        ["/empty-error", "/ok"]
    );
    assert!(paths(
        &engine,
        &session,
        "filter:state=pending status!=503",
        100,
        0
    )
    .is_empty());
}

#[test]
fn literal_search_keeps_whole_string_fields_and_explicit_prefix_escape() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut body = row("body", Some(200));
    body["responseBody"] =
        json!("Alpha Beta 100%_literal filter:method=POST Filter:method=GET text:literal");
    let mut separated = row("separated", Some(200));
    separated["responseBody"] = json!("alpha distant beta 100XXliteral");
    let mut header = row("header", Some(200));
    header["requestHeaders"] = json!([{"name": "x-synthetic", "value": "Header Search Phrase"}]);
    let session = archive(&engine, vec![body, separated, header]);
    for query in [
        "ALPHA BETA",
        "100%_literal",
        "text:filter:method=POST",
        "Filter:method=GET",
        "text:text:literal",
    ] {
        assert_eq!(
            paths(&engine, &session, query, 100, 0),
            ["/body"],
            "{query}"
        );
    }
    assert_eq!(
        paths(&engine, &session, "header search phrase", 100, 0),
        ["/header"]
    );
    assert_eq!(
        paths(&engine, &session, "", 100, 0),
        ["/header", "/separated", "/body"]
    );
}

#[test]
fn malformed_structured_search_fails_without_echoing_input_even_with_zero_limit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(&engine, vec![]);
    let mut queries: Vec<String> = [
        "filter:",
        "filter:   ",
        "filter:unknown=synthetic-marker",
        "filter:method=",
        "filter:method~=GET",
        "filter:method=bad/method",
        "filter:host=",
        "filter:host=api.example.test:443",
        "filter:status=99",
        "filter:status=600",
        "filter:status=-200",
        "filter:status=200.0",
        "filter:status==200",
        "filter:status>=",
        "filter:body=example",
        "filter:body~=\"\"",
        "filter:body~=\"unterminated",
        "filter:body~=\"bad\\q\"",
        "filter:body~=\"ok\"tail",
        "filter:state=unknown",
        "filter:state!=error",
        "filter:edited=yes",
        "filter:edited!=true",
        "filter:method=GET OR method=POST",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    queries.push(format!("filter:body~=\"{}\"", "é".repeat(2048)));
    queries.push(format!("filter:{}", vec!["edited=true"; 33].join(" ")));
    for query in queries {
        let error = engine
            .list_exchanges(&session.id, Some(&query), 0, 0)
            .expect_err("invalid filter must fail before scanning an empty session");
        let message = format!("{error:#}");
        assert!(!message.trim().is_empty());
        assert!(!message.contains(&query), "error echoed the query");
        for marker in ["synthetic-marker", "unterminated", "bad\\q"] {
            assert!(!message.contains(marker), "error echoed a query value");
        }
    }
}

#[test]
fn structured_limits_accept_32_terms_and_4096_utf8_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(&engine, vec![row("ok", Some(200))]);
    let terms = format!("filter:{}", vec!["method=GET"; 32].join(" "));
    assert_eq!(paths(&engine, &session, &terms, 100, 0), ["/ok"]);
    let long_valid = format!("filter:body~=\"{}\"", "x".repeat(4081));
    assert_eq!(long_valid.len(), 4096);
    assert!(paths(&engine, &session, &long_valid, 100, 0).is_empty());
}

#[test]
fn filtering_precedes_stable_pagination_and_survives_reopen_with_session_isolation() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut old = row("old", Some(200));
    old["startedAt"] = json!(1699999999999_i64);
    let session = archive(
        &engine,
        vec![
            row("first", Some(200)),
            row("skip", Some(500)),
            row("second", Some(200)),
            row("third", Some(200)),
            old,
        ],
    );
    let other = archive(&engine, vec![row("foreign", Some(200))]);
    let query = "filter:status=200";
    assert_eq!(paths(&engine, &session, query, 2, 0), ["/third", "/second"]);
    assert_eq!(paths(&engine, &session, query, 2, 2), ["/first", "/old"]);
    assert!(paths(&engine, &session, query, 1, 4).is_empty());
    assert!(paths(&engine, &session, query, 0, 0).is_empty());
    assert_eq!(paths(&engine, &other, query, 100, 0), ["/foreign"]);
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    assert_eq!(
        paths(&reopened, &session, query, 2, 1),
        ["/second", "/first"]
    );
    let expected = reopened
        .list_exchanges("missing-session", None, 10, 0)
        .unwrap_err()
        .to_string();
    let actual = reopened
        .list_exchanges("missing-session", Some("filter:bad"), 10, 0)
        .unwrap_err()
        .to_string();
    assert_eq!(actual, expected, "session lookup must precede parsing");
}

#[test]
fn structured_search_preserves_the_10000_result_cap() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let rows = (0..10002)
        .map(|index| row(&format!("item-{index}"), Some(200)))
        .collect();
    let session = archive(&engine, rows);
    let page = paths(&engine, &session, "filter:method=GET", usize::MAX, 0);
    assert_eq!(page.len(), 10000);
    assert_eq!(page.first().unwrap(), "/item-10001");
    assert_eq!(page.last().unwrap(), "/item-2");
    assert_eq!(
        paths(&engine, &session, "filter:method=GET", 10, 10000),
        ["/item-1", "/item-0"]
    );
}

#[test]
fn host_matching_normalizes_idna_and_excludes_absent_or_invalid_hosts_for_both_operators() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(
        &engine,
        vec![
            exchange(
                "idna",
                "GET",
                "https://xn--bcher-kva.example.test/idna",
                Some(200),
            ),
            row("other", Some(200)),
            row("absent-host", Some(200)),
            row("invalid-url", Some(200)),
        ],
    );
    let absent = engine
        .list_exchanges(&session.id, Some("/absent-host"), 1, 0)
        .unwrap()[0]
        .id
        .clone();
    let invalid = engine
        .list_exchanges(&session.id, Some("/invalid-url"), 1, 0)
        .unwrap()[0]
        .id
        .clone();
    // Import validates URLs. These synthetic persisted rows exercise defensive matching
    // when reading historical data that does not have a usable URL hostname.
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    for (id, value) in [
        (&absent, "mailto:fixture@example.test"),
        (&invalid, "not a URL"),
    ] {
        db.execute(
            "UPDATE exchanges SET data=json_set(data,'$.url',?1) WHERE id=?2",
            [value, id],
        )
        .unwrap();
    }
    drop(db);
    for query in [
        "filter:host=bücher.example.test",
        "filter:host=XN--BCHER-KVA.EXAMPLE.TEST",
    ] {
        let actual: Vec<_> = engine
            .list_exchanges(&session.id, Some(query), 100, 0)
            .unwrap()
            .into_iter()
            .map(|exchange| exchange.url)
            .collect();
        assert_eq!(
            actual,
            ["https://xn--bcher-kva.example.test/idna"],
            "{query}"
        );
    }
    let actual: Vec<_> = engine
        .list_exchanges(
            &session.id,
            Some("filter:host!=bücher.example.test"),
            100,
            0,
        )
        .unwrap()
        .into_iter()
        .map(|exchange| exchange.url)
        .collect();
    assert_eq!(actual, ["https://api.example.test/other"]);
}

#[test]
fn unicode_quoted_body_preserves_embedded_tabs_and_tab_separators() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut target = row("unicode", Some(200));
    target["responseBody"] = json!("ZAŻÓŁĆ\tGĘŚLĄ 😀");
    let mut decoy = row("spaces", Some(200));
    decoy["responseBody"] = json!("ZAŻÓŁĆ GĘŚLĄ 😀");
    let session = archive(&engine, vec![target, decoy]);
    assert_eq!(
        paths(
            &engine,
            &session,
            "filter:\tbody~=\"zażółć\tgęślą 😀\"\tmethod=GET\t",
            100,
            0
        ),
        ["/unicode"]
    );
}

#[test]
fn bounded_queries_do_not_deserialize_rows_after_full_pages_or_for_zero_limit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = archive(
        &engine,
        vec![row("older", Some(200)), row("newest", Some(200))],
    );
    let rows = engine.list_exchanges(&session.id, None, 2, 0).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("scope.sqlite3")).unwrap();
    db.execute(
        "UPDATE exchanges SET data='{invalid-json' WHERE id=?1",
        [&rows[1].id],
    )
    .unwrap();
    assert_eq!(
        paths(&engine, &session, "filter:method=GET", 1, 0),
        ["/newest"]
    );
    assert!(
        engine
            .list_exchanges(&session.id, Some("filter:method=GET"), 2, 0)
            .is_err(),
        "fixture corruption must fail when its row is needed"
    );
    db.execute(
        "UPDATE exchanges SET data='{invalid-json' WHERE id=?1",
        [&rows[0].id],
    )
    .unwrap();
    drop(db);
    for query in [None, Some("filter:method=GET")] {
        assert!(engine
            .list_exchanges(&session.id, query, 0, 0)
            .unwrap()
            .is_empty());
    }
}
