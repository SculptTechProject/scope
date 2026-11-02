# Traffic rules

Rules are saved locally and apply to all capture sessions. Open **Rules** to
create, enable, duplicate, change priority or remove one. A disabled rule does
nothing. The editor requires an explicit all-traffic choice if no matcher is set.

## Matching and order

Matchers are ANDed: exact method, exact host (case-insensitive, without port),
path prefix and URL substring. Empty matcher fields are ignored. Rules run by
ascending priority, then ID. The engine snapshots the enabled rules and their
matches at request entry. Changing a rule affects subsequent requests, including
replay, rather than changing a response halfway through its transfer.

Request rewrites run before sending upstream. Mock and block responses do not
contact upstream. Response rewrites run on the resulting response. A terminal
mock/block stops subsequent request actions; matched response rewrites can still
apply. Manual breakpoints run after automatic actions, so an explicit manual
edit wins. Replay uses current rules and skips manual breakpoints.

Each exchange records `provenance` (`upstream`, `mock`, `blocked`) and
`appliedRules`. Original messages remain available alongside edits. A mock is
synthetic evidence; its timing/status must not be treated as an upstream result.

## Full rule format

```json
{
  "id": "",
  "name": "Products maintenance fixture",
  "enabled": false,
  "priority": 100,
  "matcher": {
    "method": "GET",
    "host": "127.0.0.1",
    "pathPrefix": "/api/products"
  },
  "action": {
    "type": "mockResponse",
    "status": 503,
    "headers": [{ "name": "Content-Type", "value": "application/json" }],
    "body": "{\"maintenance\":true}",
    "bodyBase64": false
  }
}
```

An empty ID creates a new rule. An existing ID replaces the entire rule.
Matchers may also contain `urlContains`.

| Action type       | Fields                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- |
| `rewriteRequest`  | Optional `method`, absolute HTTP(S) `url`, `headers`, `body`, `bodyBase64`            |
| `rewriteResponse` | Optional `status`, `headers`, `body`, `bodyBase64`                                    |
| `mockResponse`    | `status`; optional `headers` (empty by default), `body` (empty), `bodyBase64` (false) |
| `block`           | Optional `reason`                                                                     |

`headers` replaces the full header list; it does not merge by name. Repeated
headers remain separate array entries. Omitted rewrite fields keep their current
values. Body changes normalize Content-Length and remove stale content encoding,
digest and ETag metadata. Host is normalized to the destination. Changing a
destination can forward captured credentials there; review the complete request.

The engine validates a whole update before replacing the last good configuration.
Limits: 256 rules, 128 headers per action, 1 MiB decoded body per rule and 8 MiB
serialized total rule configuration. A rule body limit is separate from the
16 MiB capture limit. Matching does not execute arbitrary JavaScript or regexes.

## Agent automation

MCP's global rule inventory requires **Global rule access**; creating/replacing
or deleting also requires **Allow traffic changes**. This access affects all
captures, including unshared sessions. Inventory reads omit names, matchers and
replacement payloads. Supply a full definition when updating; an inventory row
is not a restorable rule. All permissions reset when Scope restarts.

See [MCP](MCP.md), [architecture](ARCHITECTURE.md) and the real HTTP/TLS
integration tests in `crates/scope-core/tests/rules.rs`.
