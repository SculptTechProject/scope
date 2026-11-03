# Two-hour multi-agent engineering sprint

Date: 2026-11-03. Owner job1567256898258866317.
Timebox:19:30:27–21:30:27UTC. Base1a6b71b. Same feature branch and draftPR18.

## Design choices

The owner delegates feature selection, implementation, testing and skill setup.
Continue within the original local HAR-to-CI scope; no core/paywall/license/root
lock/workflow/auth/production change. Independent agent lanes own lab/, contracts/
and formats/, json/, and research/toolchain artifacts. Root owns integration.

Prioritize practical repeatable API checks and trustworthy reports:

- Inspect inventory for selecting API operations from mixed captures. Show
  request identities/counts and a bounded config template, explicitly no body
  validation or compatibility result. Omit body/header/query values.
- User-authored exact operation contracts for allowed candidate statuses and
  required JSON pointer/types. These are configured requirements, not schemas
  inferred from traffic; they run independently of noise ignores.
- Scoped JSON ignores avoid letting an unrelated operation satisfy a rule or
  silently suppress another operation's meaningful value change.
- Reject duplicate JSON names and decimal tokens that silently change value
  through JavaScript's parse/stringify round trip. Preserve ordinary decimals
  and equivalent spellings; bound lexical complexity and diagnostics.
- Deterministic JUnit export retains CI exit0/1/2 and useful source evidence.
- Reproducible isolated lab records actual synthetic loopback HTTP responses,
  passes config from inspect to compare, includes positive detector controls,
  and checks zero CLI replay while the fixture remains available.

Alternatives deferred: full JSON Schema/OpenAPI inference, request replay,
heuristic body/GraphQL matching, statistical latency gates, cloud dashboards,
active CI installation, paid tooling and public launch. Their scope/ambiguity
cost exceeds this experiment's requested result.

## Report layout plan

Apply the artifact-installed official frontend-design guidance with real Scope
context; ignore its fictional paying-client assumptions. Tokens: paper#f7fafc,
ink#183244, link#176589, failure#a12e47, success#126c52, rule#d8e2e9. Use local
system sans text and a system monospace only for methods/paths/JSON pointers.

A readable review document: concise outcome header, in-page navigation, explicit
scope/authored-assertion summaries, findings grouped under operation identities,
operation coverage table, and expandable full analysis. Ordinary deltas display
observed before/after; authored rules display allowed/required vs observed.
No motion, remote fonts/assets or executable script. Keep mobile long labels
wrapping, keyboard focus, native details and print readability. This is a data
review surface, not a new hosted app or marketing page. DOM/structural tests can
verify semantics; real-browser layout/CSP observations remain separate evidence.

## Verification and delivery

TDD black-box tests for new CLI contracts plus module/unit and real HTTP lab
controls. Independent numeric oracle and mutation testing validate assumptions.
Pinned artifact-only Rust/C compiler environment attempts unchanged-core checks;
report actual missing prerequisites or results without changing root features.
Install only relevant official pinned skills under writable artifacts, preserving
licenses/hashes/receipts; do not claim global registration.

Every feature must have an acceptance test and appear in the final feature
matrix. Keep checkpoint/journal records and pushes bounded; inspect the PR after
writes. Completion requires the full two-hour work window and final verification,
not a promise of future work or an untested feature list.
