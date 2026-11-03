# Discover operations before comparison

```sh
node tools/har-compare/cli.mjs inspect \
  --input tools/har-compare/examples/fixtures/mixed-baseline.har \
  --json tools/har-compare/out/inventory.json
```

`inspect --input FILE [--json NEW_FILE]` returns deterministic inventory JSON,
with `kind: "inventory"` and `analysisPerformed: false`. It groups exact method,
origin and pathname, retains original HAR indices, counts query variants, status
observations, JSON MIME responses and missing captured JSON text. Query values,
headers, credentials and body values are not output. Origin/path labels can
still be sensitive. It does not decode or validate response bodies, prove a
clean API run, or infer required schema fields.

`configTemplate` contains JSON-MIME operation selectors suitable for explicit
review and `includeOperations`. No MIME match, more than 100 candidates, an
unsupported selector or a pretty-printed UTF-8 template beyond the CLI's64KiB
config limit yields `null` plus a `templateUnavailable` reason. No partial
selector list is silently advertised as complete. A MIME match does not prove
the response is valid JSON or suitable for comparison.

Exit0 means the inventory completed, not that regressions were tested. Invalid
HAR/request identities or file/config/output errors exit2. Comparison remains a
separate `compare` command with its own exit0/1/2 contract. A new output path is
required; stdout always contains exactly the same JSON bytes as `--json`.

The isolated lab tests the real HTTP capture → inventory → reviewed template →
compare pipeline. The inventory tests also cover unsupported metadata, privacy,
query canonicalization, distinct origins, missing bodies and template limits.
