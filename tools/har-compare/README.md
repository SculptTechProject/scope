# Scope HAR comparison — local CI experiment

Compare a baseline HAR with a new run, without opening Scope or replaying traffic.
The CLI reports **observed regression candidates**, returns a CI exit status, and
creates a self-contained HTML report that a reviewer can open offline. It does
not infer required schema fields or prove that a client will break.

This is an isolated product demonstrator, not a production release or paid gate.
Scope's existing free capture, storage, export and comparison remain unchanged.
The repository's [AGPL-3.0-or-later license](../../LICENSE) applies.

## Quick start

Requires Node.js 22.22.3 (the tested runtime). No npm install, dependencies, model,
authentication, network access or running desktop/database is required.
From the repository root:

```sh
node tools/har-compare/cli.mjs --help
node tools/har-compare/cli.mjs doctor
node --test tools/har-compare/test/*.test.mjs
node tools/har-compare/examples/run-demo.mjs
```

The demo checks all four expected outcomes and compares generated JSON/HTML
bytes with the checked-in [synthetic example reports](examples/reports/). It
writes new reports under `tools/har-compare/out/demo-*/` on each run.

```text
missing-field: exit 1, 1 regression candidates
http-500: exit 1, 1 regression candidates
timestamp-ignored: exit 0, 0 regression candidates
timestamp-strict: exit 1, 1 regression candidates
```

For the prepared VPS runtime, prefix these commands with:

```sh
export PATH=/opt/szpont/toolchains/node-v22.22.3-linux-x64/bin:$PATH
```

All CLI paths resolve from the caller's working directory; an absolute path to
`cli.mjs` works from `/tmp` too. The commands below run from this directory:

```sh
# Missing /user/role: exit 1. stdout is JSON, even without --json.
node cli.mjs compare --baseline examples/fixtures/baseline.har \
  --candidate examples/fixtures/missing-field.har

# HTTP 200 → 500: exit 1, with before/after status and entry evidence.
node cli.mjs compare --baseline examples/fixtures/baseline.har \
  --candidate examples/fixtures/http-500.har

# Timestamp noise explicitly ignored in strict mode: exit 0.
node cli.mjs compare --baseline examples/fixtures/baseline.har \
  --candidate examples/fixtures/timestamp.har \
  --config examples/fixtures/ignore-timestamp.json \
  --json out/ignored.json --html out/ignored.html

# Negative control: remove the ignore, observe /timestamp value change, exit 1.
node cli.mjs compare --baseline examples/fixtures/baseline.har \
  --candidate examples/fixtures/timestamp.har \
  --config examples/fixtures/strict.json
```

Output files must be **new**, distinct paths. Existing files and symlinks are
never overwritten. Choose a new output directory/name for another run. Files
are created with mode 0600 (on platforms supporting POSIX permissions); keep
their parent directory trusted. No report is written for an invalid analysis.

## CLI and JSON contract

`compare --baseline FILE --candidate FILE [--config FILE] [--json NEW_FILE]
[--html NEW_FILE]` always emits analysis JSON to stdout. `--json` saves the exact
same bytes. There is no progress text mixed into stdout. `doctor` emits JSON
with runtime, offline/auth state and input limits; it performs no network probe.
`--help` emits human-readable usage. Unknown/duplicate flags are errors.

| Exit | Meaning |
| --- | --- |
| 0 | Analysis completed; no configured regression candidates. Informational findings may exist. |
| 1 | Analysis completed; at least one regression candidate. Reports are still available. |
| 2 | Invalid input/config/output or incomplete/failed analysis. No clean-result claim. |

Successful envelope (abridged):

```json
{
  "schemaVersion": 1,
  "tool": "scope-har-compare",
  "config": { "mode": "shape", "ignoreJsonPaths": [] },
  "summary": {
    "baselineEntries": 1, "candidateEntries": 1, "pairedEntries": 1,
    "operations": 1, "regressions": 1, "informational": 0, "ignoredNodes": 0
  },
  "notices": [],
  "operations": [{
    "id": "operation-0001", "method": "GET",
    "origin": "https://api.example.invalid", "path": "/users/7",
    "queryValuesOmitted": false,
    "baseline": [{ "entry": 1 }], "candidate": [{ "entry": 1 }]
  }],
  "findings": [{
    "id": "finding-00001", "operation": "operation-0001", "occurrence": 1,
    "evidence": { "baselineEntry": 1, "candidateEntry": 1 },
    "kind": "field-removed", "severity": "regression",
    "path": "/user/role", "types": { "before": "string" }
  }]
}
```

Errors use `{"schemaVersion":1,"error":{"code":"BODY","message":"Entry 1: JSON body was not captured."}}`
(with normal pretty formatting). Codes include `ARGUMENT`, `CONFIG`,
`IGNORE_UNUSED`, `INPUT`, `JSON`, `HAR`, `BODY`, `ENCODING`, `NUMBER`,
`INCOMPLETE`, `LIMIT`, `OUTPUT`, `RUNTIME`, and the fallback `ANALYSIS`.
Messages exclude original file paths, URLs, body/parser excerpts and stack traces.
`doctor` returns `{schemaVersion, tool, offline, authRequired, node, limits}`.

There are no timestamps, absolute input paths, randomness or runtime metadata
in analysis output. IDs and ordering are deterministic for identical inputs and
config; IDs are report-local, not permanent identities across different captures.
Evidence entry numbers are 1-based indices in each original `log.entries` array.

## Matching and repeated operations

- Keys are uppercase HTTP method + WHATWG URL origin + exact pathname + query
  pairs sorted by parameter name. Scheme and non-default port remain distinct.
  Default ports and URL encoding follow Node's WHATWG URL normalization.
- Query **values participate internally** to prevent unrelated variants from
  being merged, but names and values never enter reports. Duplicate parameter
  order is retained. Fragment and URL userinfo do not participate.
- Numeric/UUID path segments are not generalized. Origins cannot be combined by
  config in this prototype. Request bodies/headers are not matching keys.
- Within a key, the first baseline entry pairs with the first candidate entry,
  then the second with the second, and so on in HAR encounter order. No union of
  fields can hide a regression in one repeated response. A notice identifies
  keys using ordinal pairing.
- This is a deterministic assumption, not proof of semantic equivalence.
  Reordering, retries and body-dependent POST variants may cause misleading
  pairings. Missing baseline occurrences fail; extra candidate occurrences are
  informational. Separate query variants can share a displayed label; operation
  ID and entry evidence distinguish them and a notice explains omitted queries.

## Assertions and noise configuration

Config is a JSON object with only these optional fields:

```json
{ "mode": "strict", "ignoreJsonPaths": ["/timestamp", "/user/lastSeen"] }
```

`shape` (default) detects removed observed fields, changed JSON types, array
length/position changes and JSON/empty-body changes. New object fields are
informational. `strict` also detects scalar value changes. Values themselves
are never reported. Object member order does not matter; array order does.
Root JSON strings, numbers, booleans, arrays and null are supported. A finding
with an empty JSON pointer refers to the root.

A changed status ending at HTTP 400–599 is a regression; successful-to-error
changes have kind `http-failure`. Other status changes are informational.
An unchanged baseline error or an error on a newly added operation does not
fail on its own: this is a change detector, not an absolute health check.
Latency, headers, cookies and request payload changes are not asserted.

Ignore rules are **exact RFC 6901 JSON pointers** to response JSON subtrees,
including indexed array elements, e.g. `/items/0/updatedAt`. Escape `/` as `~1`
and `~` as `~0`. There are no globs, JSONPath expressions or status ignores.
Ignoring `/timestamp` skips existence/type/value comparison at that node only.
Rules apply across all paired JSON responses. An array parent length change
still counts even when an element subtree is ignored. Root ignores, duplicate
and overlapping rules, unknown config fields and unused pointers are errors.
A pointer must be reached in at least one compared response: if its entire
parent disappears or changes type, analysis fails with `IGNORE_UNUSED` rather
than silently claiming that a typo worked. Input validation runs before ignores.

## HAR support and limits

Input must contain `log.entries`; unused HAR metadata is not validated as a full
HAR schema. Responses must have final status 200–599 and JSON content with an
`application/json` or `application/*+json` MIME type. A missing JSON body,
malformed JSON, unsupported MIME/encoding or capture error fails **the whole
analysis**, including unmatched operations. HTML pages and binary asset captures
need filtering/export support outside this demonstrator.

Bodies use `response.content.text`; absent/null `encoding` means plain text.
Canonical padded `base64` is supported, decoded as strict UTF-8. Compressed or
unknown encodings are rejected. Empty HEAD/204/205/304 responses are allowed;
other explicitly empty non-JSON responses require `text: ""` and `size: 0`.
Known nonnegative `content.size` must match captured decoded bytes; omitted or
`-1` sizes are unknown. HEAD/bodyless responses do not require a representation
body merely because a size is declared. Informational responses and protocol
upgrades (1xx) lack a supported final response and fail with exit 2.
An empty body is distinct from JSON `null`.

Scope exports may include `_scope`: only validated `provenance`
(`upstream`/`mock`/`blocked`) and boolean `edited` reach the evidence. Incomplete
captures or non-null errors fail. Original payloads, rule names, arbitrary IDs
and other extension data are omitted. Native Scope archives are not supported;
no archive, CA state or `Engine::open` is used.

| Bound | Limit |
| --- | --- |
| Each HAR / config file | 10 MiB / 64 KiB, regular files only |
| Entries per HAR | 2,000 |
| Decoded body | 1 MiB (base64 also bounded before decoding) |
| Body depth / total JSON nodes per HAR | 64 / 100,000 |
| URL / method / JSON field name | 4,096 / 32 / 1,024 code units |
| Ignore pointers | 100, each up to 1,024 code units |
| Findings / serialized finding evidence | 10,000 / 4 MiB |

Node's JSON parser uses IEEE-754 numbers and last-member-wins semantics for
duplicate object keys. Unsafe integer results and non-finite numbers are
rejected; decimal precision still follows JavaScript. Avoid duplicate keys and
use strings for precision-sensitive numeric identifiers. Limits fail with exit
2 instead of truncating findings. File reads remain bounded if a file grows;
non-regular files (including FIFOs) are rejected.

## Privacy and offline HTML

Reports exclude authorization headers, all cookies, request/response body
values, URL credentials, query parameters and fragments. No captured URL is a
clickable link. HTML escapes captured strings (including script-closing text),
contains no scripts, and uses a restrictive CSP with a hash for its static CSS.
It needs no external image, font, script or stylesheet.

This is **data minimization, not complete secret detection**. Hostnames, path
segments and JSON field names can contain identifiers or secrets. Config
pointers appear in the report too. Review derived reports before sharing or
uploading; keep real HAR files outside Git and use restricted CI artifacts.
The fixtures and checked-in reports here contain synthetic `.invalid` traffic.

## GitHub Actions example

[examples/github-actions.yml](examples/github-actions.yml) is inactive and uses
synthetic timestamp fixtures. It preserves the comparison's 0/1/2 status after
uploading only derived reports, with read-only repository permissions, pinned
action commits and short artifact retention. No HAR or credential is uploaded.
Copy it into `.github/workflows/` only when you choose to enable it and replace
the fixture inputs with safely obtained captures. This task does not install or
dispatch the workflow. A local successful demo is not a remotely executed CI run.

## Development and validation

```sh
node --test test/*.test.mjs
node examples/run-demo.mjs
```

The tests run actual subprocesses and temporary files: regression evidence,
strict negative control, repeat pairing, query/origin boundaries, base64,
malformed/missing bodies, Scope extensions, config typos, resource limits,
privacy, deterministic report bytes, HTML escaping and non-overwriting outputs.
See [decision and execution record](docs/decision-and-plan.md) and
[verification/review record](docs/verification.md) for actual checks and limits.
