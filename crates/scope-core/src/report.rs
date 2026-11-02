use super::*;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

fn percentile(values: &[i64], p: f64) -> i64 {
    if values.is_empty() {
        return 0;
    }
    let mut values = values.to_vec();
    values.sort_unstable();
    values[((values.len() as f64 * p).ceil() as usize)
        .saturating_sub(1)
        .min(values.len() - 1)]
}
fn endpoint(e: &Exchange) -> (String, String, String) {
    match url::Url::parse(&e.url) {
        Ok(url) => (
            e.method.clone(),
            url.host_str().unwrap_or("").into(),
            url.path()
                .split('/')
                .map(|part| {
                    if !part.is_empty()
                        && (part.chars().all(|c| c.is_ascii_digit())
                            || Uuid::parse_str(part).is_ok())
                    {
                        ":id"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join("/"),
        ),
        Err(_) => (e.method.clone(), String::new(), e.url.clone()),
    }
}
fn key(e: &Exchange) -> String {
    let (m, h, p) = endpoint(e);
    format!("{m} {h}{p}")
}
fn shape(value: &Value, prefix: &str, out: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let path = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                out.insert(format!("{path}:{}", kind(v)));
                shape(v, &path, out);
            }
        }
        Value::Array(values) => {
            for v in values.iter().take(50) {
                shape(v, &format!("{prefix}[]"), out);
            }
        }
        _ => {}
    }
}
fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}
fn response_shape(exchanges: &[&Exchange]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for e in exchanges {
        if !e.response_body_base64 {
            if let Ok(value) = serde_json::from_str::<Value>(&e.response_body) {
                shape(&value, "", &mut out);
            }
        }
    }
    out
}
impl Engine {
    pub fn analysis(&self, session_id: &str) -> Result<Value> {
        let exchanges = self.all_exchanges(session_id)?;
        let total = exchanges.len();
        let errors = exchanges
            .iter()
            .filter(|e| e.error.is_some() || e.status.is_some_and(|s| s >= 400))
            .count();
        let durations: Vec<_> = exchanges.iter().map(|e| e.duration_ms).collect();
        let total_bytes: i64 = exchanges
            .iter()
            .map(|e| e.request_bytes + e.response_bytes)
            .sum();
        let mut hosts: BTreeMap<String, usize> = BTreeMap::new();
        let mut codes: BTreeMap<u16, usize> = BTreeMap::new();
        let mut groups: BTreeMap<String, Vec<&Exchange>> = BTreeMap::new();
        for e in &exchanges {
            *hosts.entry(endpoint(e).1).or_default() += 1;
            *codes.entry(e.status.unwrap_or(0)).or_default() += 1;
            groups.entry(key(e)).or_default().push(e);
        }
        let endpoints:Vec<_>=groups.values().map(|group| {let(m,h,p)=endpoint(group[0]);let times:Vec<_>=group.iter().map(|e|e.duration_ms).collect();let mut statuses=BTreeMap::new();for e in group{*statuses.entry(e.status.unwrap_or(0)).or_insert(0)+=1;}json!({"method":m,"host":h,"path":p,"count":group.len(),"errorCount":group.iter().filter(|e|e.error.is_some()||e.status.is_some_and(|s|s>=400)).count(),"averageDurationMs":times.iter().sum::<i64>() as f64/times.len() as f64,"p95DurationMs":percentile(&times,0.95),"totalBytes":group.iter().map(|e|e.request_bytes+e.response_bytes).sum::<i64>(),"statuses":statuses})}).collect();
        let mut insights = Vec::new();
        let failed: Vec<_> = exchanges
            .iter()
            .filter(|e| e.error.is_some() || e.status.is_some_and(|s| s >= 400))
            .map(|e| e.id.clone())
            .collect();
        if !failed.is_empty() {
            insights.push(json!({"kind":"error","title":format!("{} failed requests",failed.len()),"detail":"HTTP 4xx/5xx responses and capture or transport errors occurred. Open the linked exchanges to inspect the evidence.","exchangeIds":failed}));
        }
        let slow: Vec<_> = exchanges
            .iter()
            .filter(|e| e.duration_ms > 1000)
            .map(|e| e.id.clone())
            .collect();
        if !slow.is_empty() {
            insights.push(json!({"kind":"latency","title":format!("{} requests exceeded one second",slow.len()),"detail":"Duration includes time spent waiting at breakpoints and buffering response bodies; it is not pure server latency.","exchangeIds":slow}));
        }
        for (endpoint, items) in groups.iter().filter(|(_, v)| v.len() >= 3).take(12) {
            insights.push(json!({"kind":"repeat","title":format!("{} calls to {}",items.len(),endpoint),"detail":"Repeated calls were observed. Polling, retries and user actions are possible explanations; capture alone does not establish a bug.","exchangeIds":items.iter().map(|e|&e.id).collect::<Vec<_>>()}));
        }
        Ok(
            json!({"totalRequests":total,"totalErrors":errors,"totalBytes":total_bytes,"averageDurationMs":if total>0{durations.iter().sum::<i64>() as f64/total as f64}else{0.0},"p95DurationMs":percentile(&durations,0.95),"hosts":hosts.into_iter().map(|(host,count)|json!({"host":host,"count":count})).collect::<Vec<_>>(),"endpoints":endpoints,"statusCodes":codes.into_iter().map(|(status,count)|json!({"status":status,"count":count})).collect::<Vec<_>>(),"insights":insights}),
        )
    }
    pub fn compare_sessions(&self, left: &str, right: &str) -> Result<Value> {
        let left_s = self.session(left)?;
        let right_s = self.session(right)?;
        let left_e = self.all_exchanges(left)?;
        let right_e = self.all_exchanges(right)?;
        let mut a: BTreeMap<String, Vec<&Exchange>> = BTreeMap::new();
        let mut b: BTreeMap<String, Vec<&Exchange>> = BTreeMap::new();
        for e in &left_e {
            a.entry(key(e)).or_default().push(e);
        }
        for e in &right_e {
            b.entry(key(e)).or_default().push(e);
        }
        let added: Vec<_> = b.keys().filter(|k| !a.contains_key(*k)).cloned().collect();
        let removed: Vec<_> = a.keys().filter(|k| !b.contains_key(*k)).cloned().collect();
        let mut changed = Vec::new();
        for (key, av) in &a {
            if let Some(bv) = b.get(key) {
                let ac: BTreeSet<_> = av.iter().map(|e| e.status.unwrap_or(0)).collect();
                let bc: BTreeSet<_> = bv.iter().map(|e| e.status.unwrap_or(0)).collect();
                let ash = response_shape(av);
                let bsh = response_shape(bv);
                let added_fields: Vec<_> = bsh.difference(&ash).cloned().collect();
                let removed_fields: Vec<_> = ash.difference(&bsh).cloned().collect();
                let avg = |v: &Vec<&Exchange>| {
                    v.iter().map(|e| e.duration_ms).sum::<i64>() as f64 / v.len() as f64
                };
                if av.len() != bv.len()
                    || ac != bc
                    || ash != bsh
                    || ((avg(bv) - avg(av)).abs() > 100.0)
                {
                    changed.push(json!({"endpoint":key,"leftCount":av.len(),"rightCount":bv.len(),"leftStatuses":ac,"rightStatuses":bc,"leftAverageDurationMs":avg(av),"rightAverageDurationMs":avg(bv),"addedResponseFields":added_fields,"removedResponseFields":removed_fields,"leftExchangeIds":av.iter().map(|e|&e.id).collect::<Vec<_>>(),"rightExchangeIds":bv.iter().map(|e|&e.id).collect::<Vec<_>>()}));
                }
            }
        }
        Ok(
            json!({"leftSession":left_s,"rightSession":right_s,"addedEndpoints":added,"removedEndpoints":removed,"changedEndpoints":changed,"summary":{"leftRequests":left_e.len(),"rightRequests":right_e.len(),"addedEndpoints":added.len(),"removedEndpoints":removed.len(),"changedEndpoints":changed.len()},"method":"Exact normalized endpoint comparison; numeric and UUID path segments become :id. JSON shapes reflect observed payloads, not an inferred API contract."}),
        )
    }
    pub fn export_session(&self, session_id: &str) -> Result<Value> {
        Ok(
            json!({"format":"scope-session","version":1,"session":self.session(session_id)?,"exchanges":self.all_exchanges(session_id)?}),
        )
    }
    pub fn import_session(&self, value: Value) -> Result<Session> {
        if value["format"] != "scope-session" || value["version"] != 1 {
            bail!("Unsupported Scope session format/version");
        }
        let original: Session = serde_json::from_value(value["session"].clone())?;
        let exchanges: Vec<Exchange> = serde_json::from_value(value["exchanges"].clone())?;
        self.import_validated(original.name, "import".into(), exchanges)
    }
    fn import_validated(
        &self,
        name: String,
        source: String,
        mut exchanges: Vec<Exchange>,
    ) -> Result<Session> {
        if name.trim().is_empty() || name.len() > 256 {
            bail!("Session name must contain 1–256 characters");
        }
        if exchanges.len() > 100_000 {
            bail!("Import exceeds 100,000 exchanges");
        }
        for e in &exchanges {
            validate_url(&e.url)?;
            e.method.parse::<hudsucker::hyper::Method>()?;
            proxy::header_map(&e.request_headers)?;
            proxy::header_map(&e.response_headers)?;
            if let Some(status) = e.status {
                hudsucker::hyper::StatusCode::from_u16(status)?;
            }
            for (body, base64) in [
                (&e.request_body, e.request_body_base64),
                (&e.response_body, e.response_body_base64),
            ] {
                if decode_body(body, base64)?.len() > CAPTURE_LIMIT_BYTES {
                    bail!("Imported body exceeds 16 MiB capture limit");
                }
            }
            if e.duration_ms < 0 || e.request_bytes < 0 || e.response_bytes < 0 {
                bail!("Imported timing and sizes cannot be negative");
            }
        }
        let s = Session {
            id: uid(),
            name,
            source,
            created_at: now(),
            exchange_count: exchanges.len() as i64,
            revision: exchanges.len() as i64,
        };
        let mut db = self.inner.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO sessions(id,name,source,created_at) VALUES(?1,?2,?3,?4)",
            params![s.id, s.name, s.source, s.created_at],
        )?;
        for e in &mut exchanges {
            e.id = uid();
            e.session_id = s.id.clone();
            tx.execute(
                "INSERT INTO exchanges VALUES(?1,?2,?3,?4)",
                params![e.id, e.session_id, e.started_at, serde_json::to_string(e)?],
            )?;
        }
        tx.commit()?;
        Ok(s)
    }
    pub fn export_har(&self, session_id: &str) -> Result<Value> {
        let session = self.session(session_id)?;
        let entries:Vec<_>=self.all_exchanges(session_id)?.into_iter().map(|e| {
            let mime=|headers:&[Header]|headers.iter().find(|h|h.name.eq_ignore_ascii_case("content-type")).map(|h|h.value.clone()).unwrap_or_else(||"application/octet-stream".into());
            let url=url::Url::parse(&e.url).ok();let query=url.as_ref().map(|u|u.query_pairs().map(|(name,value)|json!({"name":name,"value":value})).collect::<Vec<_>>()).unwrap_or_default();
            let date=chrono::DateTime::from_timestamp_millis(e.started_at).map(|v|v.to_rfc3339_opts(chrono::SecondsFormat::Millis,true)).unwrap_or_else(||chrono::Utc::now().to_rfc3339());
            json!({"startedDateTime":date,"time":e.duration_ms,"pageref":session_id,"request":{"method":e.method,"url":e.url,"httpVersion":"HTTP/1.1","cookies":[],"headers":e.request_headers,"queryString":query,"headersSize":-1,"bodySize":e.request_bytes,"postData":{"mimeType":mime(&e.request_headers),"text":e.request_body,"_encoding":if e.request_body_base64{Some("base64")}else{None}}},"response":{"status":e.status.unwrap_or(0),"statusText":e.status.and_then(|s|hudsucker::hyper::StatusCode::from_u16(s).ok()).and_then(|s|s.canonical_reason().map(str::to_owned)).unwrap_or_default(),"httpVersion":"HTTP/1.1","cookies":[],"headers":e.response_headers,"content":{"size":e.response_bytes,"mimeType":mime(&e.response_headers),"text":e.response_body,"encoding":if e.response_body_base64{Some("base64")}else{None}},"redirectURL":e.response_headers.iter().find(|h|h.name.eq_ignore_ascii_case("location")).map(|h|&h.value).cloned().unwrap_or_default(),"headersSize":-1,"bodySize":e.response_bytes},"cache":{},"timings":{"send":0,"wait":e.duration_ms,"receive":0},"_scope":{"error":e.error,"edited":e.edited,"originalRequest":e.original_request,"originalResponse":e.original_response,"protocolNote":"HTTP version is normalized; original version and trailers are not recorded"}})
        }).collect();
        Ok(
            json!({"log":{"version":"1.2","creator":{"name":"Scope","version":env!("CARGO_PKG_VERSION")},"pages":[{"id":session_id,"title":session.name,"startedDateTime":chrono::DateTime::from_timestamp_millis(session.created_at).unwrap().to_rfc3339(),"pageTimings":{}}],"entries":entries}}),
        )
    }
    pub fn import_har(&self, har: Value, name: String) -> Result<Session> {
        let entries = har["log"]["entries"]
            .as_array()
            .context("HAR must contain log.entries array")?;
        if entries.len() > 100_000 {
            bail!("Import exceeds 100,000 exchanges");
        }
        let mut exchanges = Vec::new();
        for item in entries {
            let req = &item["request"];
            let res = &item["response"];
            let scope = &item["_scope"];
            let mut e = self.fresh_exchange(
                "",
                req["method"]
                    .as_str()
                    .context("HAR request missing method")?
                    .into(),
                req["url"]
                    .as_str()
                    .context("HAR request missing URL")?
                    .into(),
            );
            let parse_headers = |v: &Value| -> Result<Vec<Header>> {
                if v.is_null() {
                    Ok(vec![])
                } else {
                    Ok(serde_json::from_value(v.clone())?)
                }
            };
            e.request_headers = parse_headers(&req["headers"])?;
            e.response_headers = parse_headers(&res["headers"])?;
            e.request_body = req["postData"]["text"].as_str().unwrap_or("").into();
            e.request_body_base64 = req["postData"]["_encoding"] == "base64";
            e.response_body = res["content"]["text"].as_str().unwrap_or("").into();
            e.response_body_base64 = res["content"]["encoding"] == "base64";
            e.request_bytes = decode_body(&e.request_body, e.request_body_base64)?.len() as i64;
            e.response_bytes = decode_body(&e.response_body, e.response_body_base64)?.len() as i64;
            e.started_at = item["startedDateTime"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp_millis())
                .unwrap_or_else(now);
            e.duration_ms = item["time"].as_f64().unwrap_or(0.0).max(0.0) as i64;
            e.status = match res["status"].as_u64() {
                Some(0) | None => None,
                Some(s) if s <= u16::MAX as u64 => Some(s as u16),
                _ => bail!("Invalid HAR response status"),
            };
            e.error = scope["error"].as_str().map(str::to_owned).or_else(|| {
                if e.status.is_none() {
                    Some("HAR entry has no completed response".into())
                } else {
                    None
                }
            });
            e.edited = scope["edited"].as_bool().unwrap_or(false);
            e.original_request = scope
                .get("originalRequest")
                .filter(|v| !v.is_null())
                .cloned();
            e.original_response = scope
                .get("originalResponse")
                .filter(|v| !v.is_null())
                .cloned();
            exchanges.push(e);
        }
        self.import_validated(name, "har".into(), exchanges)
    }
}
