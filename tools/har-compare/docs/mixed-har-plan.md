# Mixed HAR operation selection: decision and implementation plan

Date: 2026-11-03. Source: owner continuation 1567256549058154618.
Base: afb8e4ac7a998b128eaa1f63eabc64db53e9f421, same isolated feature branch/PR.

Goal: make the demonstrator useful for a mixed browser HAR without weakening
complete analysis of the selected API. Existing checks at this base all passed
on GitHub; the prototype's own tests still run locally, not in active CI.

## Decision

Add optional `includeOperations`, an exact allowlist of up to 100 objects
`{method, origin, path}`. Method is an uppercase-normalized HTTP token, origin
must be a canonical HTTP(S) origin, and path must be an exact canonical pathname.
No regex, glob, prefix, query selection, origin merging or request replay.
Queries remain distinct internal matching keys, all variants of a selected
method/origin/path are included.

Automatic skipping of non-JSON bodies risks hiding a JSON endpoint that became
an HTML error. Post-filtering fully parsed entries still rejects unrelated
static assets. Explicit request-based preselection is the narrow alternative:
validate the HAR envelope and every request identity, then analyze responses
only for selected entries. Excluded response bodies are not validated, and the
report must state that exclusion is not a health check. Global file/entry limits
still cover the whole capture; body/node limits cover selected entries.

Each selector must match at least one entry across either capture. Zero selected
baseline entries fails with exit 2 (no baseline coverage). Zero selected
candidate entries with baseline coverage remains an observed removal, exit 1.
Selectors matching only the candidate are allowed when some baseline coverage
exists; their additions remain informational. No selector and no filters keeps
the original behavior and byte-identical example reports.

Evidence retains original 1-based HAR indices. JSON and HTML show total,
selected and excluded counts for each capture and visible scope disclosure.
The report includes only explicitly configured selectors and aggregate excluded
counts, never excluded URL/body/header values. HTML escapes selector data too.
Selected failures/malformed/missing bodies still fail; JSON ignores cannot
alter selection or HTTP status checks. Wrong/duplicate/unknown selectors fail.

## Tasks and validation

- [x] Add real CLI RED tests for mixed assets/API, evidence index preservation,
  selected 500 and missing body, omitted selected candidate, baseline-empty and
  unused-selector failures, query variants, canonical origins/paths, strict
  timestamp ignores, deterministic scoped JSON/HTML and excluded-secret omission.
- [x] Implement config validation in src/config.mjs, select before response
  decoding in src/input.mjs, and verify coverage across captures in cli.mjs.
  Return `parseHar(raw, config) -> {entries, totalEntries, matchedSelectors}`;
  `selectionCoverage(baseline, candidate, config)` validates and returns optional
  coverage. compareHar continues consuming arrays; selection does not change
  comparison semantics.
- [x] Add explicit coverage disclosure to HTML, mixed synthetic fixtures/config,
  reproducible reports/demo and English README updates. Preserve old report
  bytes when selection is omitted.
- [x] Independent whole-change review, fix concrete findings RED→GREEN, full
  affected suite/demo/checks, commit/push same branch and update/read back PR.

Review focus: query variants must all be analyzed; selected HTML/500 must not be
silently excluded; typo selectors/empty baseline must fail; ignored JSON must
not conceal status changes; excluded bodies must never reach report outputs.

Execution: inline implementation with TDD and one fresh independent reviewer.
No root dependency/workflow/license/core changes, merge, release or public
promotion. This is continued prototype engineering, not market validation.

Progress: 75 tests pass, including all prior 45 and 30 new selection/envelope
cases. Original four report bytes unchanged; two new scoped reports reproduce
byte for byte, and mixed unfiltered negative control exits 2. Added whole-JSON
envelope depth cap before parsing to retain resource bounds even on excluded
metadata. Literal double-slash paths are treated as paths on the explicit
origin, never as network-path URLs. These two cases were also observed RED
before implementation. Independent review complete: no Critical/Important issues or data leakage.
One P3 documentation clarification was applied with an interaction test: unused
JSON ignores retain error2 precedence when every selected candidate disappears.
Root locked dependency installation (scripts disabled) enables successful local
frontend build and 10/10 UI tests. Optional isolated jsdom QA is available from
examples/check-html-dom.mjs; it does not change runtime CLI dependencies.
