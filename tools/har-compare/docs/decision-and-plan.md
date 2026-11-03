# HAR CI demonstrator: decision and execution plan

Date: 2026-11-03. Source: owner job 1567234820436664500 and prototype brief.

Goal: compare two explicit HAR files offline, identify observed API changes, and
produce deterministic CI JSON and a standalone HTML report. This is a one-week
product experiment; demand and a possible PLN 99–149 price remain unvalidated.

## Decisions

Use dependency-free ESM on the prepared Node 22.22.3 runtime inside
`tools/har-compare/`. Reusing the Rust desktop comparison would inherit unions
of response fields and origin normalization; integrating with the desktop would
expand this experiment. Neither fits the requested isolated headless tool.
The free core, root dependency files, license and active workflows stay intact.

Match uppercase method, exact WHATWG origin/path and canonical query pairs
(including values internally, excluding fragments/userinfo). Do not normalize
numeric IDs or combine origins. Pair repeated keys by HAR encounter order,
never union their fields. Report ambiguity explicitly: reordered responses,
request-body-dependent variants and omitted query labels need human review.
Unmatched baseline entries are regression candidates; additions are informational.

Compare JSON fields/types recursively; strict mode also compares scalar values
and array positions/length. Shape mode ignores scalar values but still compares
array positions and lengths. Ignore rules are exact RFC 6901 JSON pointers to a
subtree, scoped only to JSON, with at least one matched response required.
Never ignore HTTP status findings. No latency assertion, inferred schema,
request replay, native archive access, model call or remote resource loading.

Reports expose entry indices, method/origin/path, JSON paths, status/type labels
and allowlisted Scope provenance only. No headers, cookies, request/response
values, query values, capture IDs or raw parser messages. Paths and field names
can themselves contain secrets; reports are private artifacts, not anonymization.
Reject incomplete/unsupported body analysis rather than returning a clean result.
Bound files, entries, decoded bodies, depth, nodes and findings.

## Implementation plan

Execution: inline with TDD, then independent whole-prototype review.

- [x] Parser/config/comparison: write failing black-box tests for missing fields,
  200→500, timestamp negative control, repeated calls, query/origin boundaries,
  base64/Scope extensions, incomplete bodies, malformed config and resource caps.
  Implement `src/input.mjs`, `src/compare.mjs`, `src/config.mjs`.
- [x] CLI/report: exercise real exit codes 0/1/2, doctor/help, output paths,
  deterministic bytes, sensitive-data exclusion and hostile HTML strings.
  Implement `cli.mjs` and `src/report.mjs`; no dependencies or installation.
- [x] Delivery examples: synthetic fixtures and checked-in deterministic reports,
  runnable example workflow under examples only, English README and limits.
- [x] Independent review: inspect adversarial input, matching ambiguity, ignore
  mistakes, output writes and CI behavior; reproduce/fix substantive findings.
- [ ] Verify affected suite and available repository checks; commit/push only the
  feature branch, create/read back draft PR, save product outcome in agent memory.

## Review focus and evidence ledger

Tests must cover query variants sharing a displayed label; repeat-count changes;
null/array/root JSON changes; forged Scope extension flags; and report output
collisions. Run `node --test tools/har-compare/test/*.test.mjs` with prepared Node.
Use literal expectations and real subprocesses/files. Browser execution testing
is conditional on an isolated provisioned runtime; static escaping checks alone
must not be described as a browser XSS test.

Initial state: clean isolated checkout, requested branch and exact base verified.
GitHub MCP get_me verified SculptTechProject / 150788324.

Progress: parser, CLI, static report and demo complete; 41 tests green. All four
example outcomes and deterministic report bytes verified. Independent review
running. Root build/test unavailable (missing tsc/vitest); cargo absent. No
browser or remote-CI execution claimed.

Independent review: two P2 incomplete-analysis findings reproduced and fixed with
RED→GREEN tests: interim HTTP statuses and contradictory decoded body sizes.
Final suite 45/45; required demos still 1/1/0/1 and reports unchanged. Actual
example shell blocks locally preserve exit codes 0/1/2; no remote CI claim.
