//! Synthetic native-import measurement. Run the compiled binary once per sample:
//! `cargo build -p scope-core --example import_memory --locked`
//! `target/debug/examples/import_memory utf8 4 8`
//! Modes: utf8/binary; cells: 1 exchange x 1 MiB or 4 exchanges x 8 MiB.
//! Each exchange has BOTH a request and a response body of the selected size.
//! Linux VmHWM includes setup/input generation; after-import is sampled before
//! correctness checks. Import timing excludes setup, serialization and checks.
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use scope_core::{Engine, Session};
use serde_json::{json, Value};
use std::{fs, io, path::Path, time::Instant};

fn memory() -> Result<Value> {
    let status = fs::read_to_string("/proc/self/status")
        .context("This measurement requires Linux /proc/self/status")?;
    let field = |name: &str| -> Result<u64> {
        status
            .lines()
            .find_map(|line| line.strip_prefix(name))
            .context("Missing Linux memory counter")?
            .split_whitespace()
            .next()
            .context("Empty Linux memory counter")?
            .parse()
            .context("Invalid Linux memory counter")
    };
    Ok(json!({"rssKiB":field("VmRSS:")?,"hwmKiB":field("VmHWM:")?}))
}

fn raw_body(binary: bool, bytes: usize, row: usize, response: bool) -> Vec<u8> {
    // UTF-8 contains non-ASCII two-byte characters; binary includes invalid UTF-8.
    let pattern: &[u8] = if binary {
        &[0, 255, 128, 13, 10, 42]
    } else {
        "é".as_bytes()
    };
    let mut body: Vec<_> = (0..bytes).map(|i| pattern[i % pattern.len()]).collect();
    // Distinguish each direction and row without changing byte length/encoding.
    body[0] = b'A' + row as u8;
    body[1] = if response { b'R' } else { b'Q' };
    body
}

fn body_value(binary: bool, bytes: usize, row: usize, response: bool) -> Value {
    let body = raw_body(binary, bytes, row, response);
    Value::String(if binary {
        STANDARD.encode(body)
    } else {
        String::from_utf8(body).expect("valid synthetic UTF-8")
    })
}

fn headers(response: bool, row: usize) -> Value {
    let name = if response { "set-cookie" } else { "x-repeat" };
    json!([{"name":name,"value":format!("first-{row}")},
           {"name":name,"value":format!("second-{row}")}])
}

fn original(response: bool, row: usize) -> Value {
    json!({"body":format!("synthetic-original-{row}-{response}"),"bodyBase64":false,
           "headers":headers(response,row)})
}

fn input(binary: bool, count: usize, bytes: usize) -> Value {
    let rows: Vec<_> = (0..count)
        .map(|row| {
            let mut value = json!({
                "id":format!("source-{row}"),"sessionId":"source-session","method":"POST",
                "url":format!("https://example.invalid/synthetic/{row}"),"status":201,
                "completed":row + 1 != count,"requestHeaders":headers(false,row),
                "responseHeaders":headers(true,row),"requestBodyBase64":binary,
                "responseBodyBase64":binary,"startedAt":1700000000000_i64 + row as i64,
                "durationMs":17,"requestBytes":bytes,"responseBytes":bytes,"error":null,
                "edited":true,"originalRequest":original(false,row),
                "originalResponse":original(true,row),"provenance":"upstream","appliedRules":[]
            });
            value["requestBody"] = body_value(binary, bytes, row, false);
            value["responseBody"] = body_value(binary, bytes, row, true);
            value
        })
        .collect();
    let mut archive = json!({"format":"scope-session","version":1,
        "session":{"id":"source-session","name":"Synthetic native import","source":"synthetic",
        "createdAt":1700000000000_i64,"exchangeCount":count,"revision":count,
        "notes":"Synthetic benchmark metadata","tags":["synthetic","benchmark"],"pinned":true},
        "exchanges":[]});
    archive["exchanges"] = Value::Array(rows);
    archive
}

struct ByteCount(u64);
impl io::Write for ByteCount {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn archive_bytes(dir: &Path) -> Result<Value> {
    let size = |name: &str| -> Result<u64> {
        match fs::metadata(dir.join(name)) {
            Ok(meta) => Ok(meta.len()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
            Err(error) => Err(error.into()),
        }
    };
    let db = size("scope.sqlite3")?;
    let wal = size("scope.sqlite3-wal")?;
    let shm = size("scope.sqlite3-shm")?;
    Ok(json!({"sqlite":db,"wal":wal,"shm":shm,"total":db+wal+shm}))
}

fn verify(
    engine: &Engine,
    session: &Session,
    binary: bool,
    count: usize,
    bytes: usize,
) -> Result<()> {
    let stored = engine
        .list_sessions()?
        .into_iter()
        .find(|stored| stored.id == session.id)
        .context("Imported session missing")?;
    assert_ne!(session.id, "source-session");
    assert_eq!(stored.name, "Synthetic native import");
    assert_eq!(stored.source, "import");
    assert_eq!(stored.notes, "Synthetic benchmark metadata");
    assert_eq!(stored.tags, ["benchmark", "synthetic"]);
    assert!(stored.pinned);
    assert_eq!(stored.exchange_count, count as i64);
    let rows = engine.list_exchanges(&session.id, None, count + 1, 0)?;
    assert_eq!(rows.len(), count);
    let mut identities = std::collections::BTreeSet::new();
    let mut row_indices = std::collections::BTreeSet::new();
    for exchange in rows {
        let row: usize = exchange.url.rsplit('/').next().unwrap().parse()?;
        assert!(row < count);
        assert!(row_indices.insert(row));
        assert_ne!(exchange.id, format!("source-{row}"));
        assert!(identities.insert(exchange.id.clone()));
        assert_eq!(exchange.session_id, session.id);
        assert_eq!(exchange.method, "POST");
        assert_eq!(exchange.status, Some(201));
        assert_eq!(exchange.started_at, 1700000000000_i64 + row as i64);
        assert_eq!(exchange.duration_ms, 17);
        assert!(exchange.completed && exchange.edited);
        assert_eq!(exchange.error.is_some(), row + 1 == count);
        for response in [false, true] {
            let (body, encoded, stored_bytes, stored_headers, snapshot) = if response {
                (
                    &exchange.response_body,
                    exchange.response_body_base64,
                    exchange.response_bytes,
                    &exchange.response_headers,
                    &exchange.original_response,
                )
            } else {
                (
                    &exchange.request_body,
                    exchange.request_body_base64,
                    exchange.request_bytes,
                    &exchange.request_headers,
                    &exchange.original_request,
                )
            };
            assert_eq!(encoded, binary);
            assert_eq!(stored_bytes, bytes as i64);
            let decoded = if encoded {
                STANDARD.decode(body)?
            } else {
                body.as_bytes().to_vec()
            };
            assert_eq!(decoded, raw_body(binary, bytes, row, response));
            assert_eq!(
                serde_json::to_value(stored_headers)?,
                headers(response, row)
            );
            assert_eq!(snapshot.as_ref(), Some(&original(response, row)));
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        bail!("Usage: import_memory <utf8|binary> <1|4 exchanges> <1|8 MiB per body>");
    }
    let binary = match args[0].as_str() {
        "utf8" => false,
        "binary" => true,
        _ => bail!("Mode must be utf8 or binary"),
    };
    let count: usize = args[1].parse()?;
    let mib: usize = args[2].parse()?;
    if !matches!((count, mib), (1, 1) | (4, 8)) {
        bail!("Supported bounded cells: 1 1 or 4 8");
    }
    let bytes = mib * 1024 * 1024;
    let dir = tempfile::tempdir()?;
    let engine = Engine::open(dir.path())?;
    let before_input = memory()?;
    let value = input(binary, count, bytes);
    let mut serialized_bytes = ByteCount(0);
    serde_json::to_writer(&mut serialized_bytes, &value)?;
    let before_import = memory()?;
    let started = Instant::now();
    let session = engine.import_session(value)?;
    let import_seconds = started.elapsed().as_secs_f64();
    // Capture immediately: export, row materialization and reopen happen later.
    let after_import = memory()?;
    let archive_after_import = archive_bytes(dir.path())?;
    verify(&engine, &session, binary, count, bytes)?;
    drop(engine);
    let archive_after_close = archive_bytes(dir.path())?;
    let reopened = Engine::open(dir.path())?;
    verify(&reopened, &session, binary, count, bytes)?;
    drop(reopened);
    // Engine::open creates a private synthetic CA here. Never retain that archive.
    dir.close()?;
    println!(
        "{}",
        json!({"schemaVersion":1,"mode":args[0],"exchanges":count,
        "bytesPerBody":bytes,"bodiesPerExchange":2,"decodedBodyBytes":count*bytes*2,
        "nativeInputSerializedBytes":serialized_bytes.0,"importSeconds":import_seconds,
        "beforeInput":before_input,"beforeImport":before_import,"afterImport":after_import,
        "archiveAfterImport":archive_after_import,"archiveAfterClose":archive_after_close,
        "controls":{"rawBytes":true,"repeatedHeaderOrder":true,"pairing":true,"originals":true,
        "metadata":true,"identities":true,"completion":true,"reopen":true,"tempArchiveRemoved":true}})
    );
    Ok(())
}
