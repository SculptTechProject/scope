# Verification and independent review

Date: 2026-11-03. Runtime: Node.js 22.22.3 on Linux.

## Local evidence

From repository root, with the prepared runtime directory on PATH:

- `node --test tools/har-compare/test/*.test.mjs`: 45 passing, 0 failing after
  independent review fixes. Real CLI subprocesses, no mocks or live captures.
- `node tools/har-compare/examples/run-demo.mjs`: four scenarios pass, expected
  exits 1/1/0/1, generated JSON and HTML byte-equal to checked-in examples.
- `git diff --check`: clean (new files also checked when staged).
- MCP `get_me` and `GH_CONFIG_DIR=/var/lib/szpont/github gh api user` both match
  SculptTechProject / 150788324. No authentication changes.
- All three action commit SHAs in the inactive example were verified against
  their official GitHub tag refs using read-only API calls.

TDD evidence: initial 38 black-box tests failed with no implementation, then
passed after implementation and correcting a test's RFC 6901 slash expectation.
Additional null-config, finding-byte-budget and FIFO tests were observed failing
and then passed after rejecting null defaults, limiting finding evidence and
opening inputs nonblocking before checking their regular-file type.

## Checks unavailable in the prepared environment

- Root `npm run build`: exit 127, `tsc: not found`.
- Root `npm test -- --run`: exit 127, `vitest: not found`.
- `cargo test --workspace --locked`: exit 127, `cargo: command not found`.
- Rust formatting cannot run without cargo. No desktop dependencies installed
  or root locks changed to enable unrelated checks.
- Static hostile-HTML and privacy assertions passed. No isolated project-pinned
  Playwright runtime is installed. No perceptual screenshot or browser execution/
  network test is claimed; existing authenticated browser profiles were not used.
- The sample workflow is an inactive YAML file under `examples/`; it was not
  installed, dispatched or remotely executed in GitHub Actions.

## Independent review

A fresh-context reviewer independently ran all 41 original tests, reproduced the
four demos, checked source/privacy boundaries and reported two P2 defects:

1. HTTP 1xx was accepted as a final response, so HEAD 200 → 103 could exit 0.
   Fixed by rejecting unsupported interim/upgrade responses with `INCOMPLETE`
   (exit 2). A regression test covers 100, 101, 103 and 199.
2. Known `content.size` contradictions were ignored. Fixed by comparing known
   uncompressed size to captured decoded bytes for entity bodies, including
   base64. Omitted/-1 sizes remain unknown; legitimate bodyless/HEAD responses
   remain supported. Tests cover contradiction, UTF-8, base64, unknown/invalid
   sizes and HEAD representation size.

Both failure cases were observed RED before changes, then the full 45-test suite
passed. Reviewer reported no Critical or Minor findings. No unresolved findings
were deferred. Review excluded market demand, inferred schema compatibility,
remote Actions behavior and whole-application security; these remain outside
the demonstrator's claim. This is not a production-readiness certification.

## Workflow shell verification

The actual comparison and status-propagation `run` blocks were loaded from the
example YAML with Python safe_load and executed locally in temporary directories
using only synthetic inputs and a minimal environment. Clean comparison: 0,
regression: 1, invalid HAR: 2. The upload staging block preserved those values;
only successful analyses (0/1) generated report files. Artifact upload itself
was not executed. The harness receipt is kept outside Git at
`/var/lib/szpont/artifacts/scope-ci-experiment-20261103/workflow-local-verification.json`.

## Continuation: mixed HAR selection (2026-11-03)

Owner job 1567256549058154618. Feature plan:
[mixed-har-plan.md](mixed-har-plan.md). This section supersedes earlier local
frontend dependency and test-count limitations; browser/Rust limits remain.

- `node --test tools/har-compare/test/*.test.mjs`: **75 passed, 0 failed**.
  Initial selection tests failed before implementation. Later double-slash-path
  and whole-envelope-depth tests were also observed RED, then passed after fixes.
- `node tools/har-compare/examples/run-demo.mjs`: original exits 1/1/0/1 plus
  mixed selected1, mixed clean0 and unfiltered mixed2. All six checked-in
  JSON/HTML report pairs reproduce byte for byte; original four unchanged.
- Fresh independent read-only reviewer ran the then-current 74-test suite,
  eight extra adversarial cases and all report reproductions. No Critical or
  Important findings, false-clean result or excluded-data leakage reproduced.
  P3 documentation issue clarified: an unused JSON ignore can yield exit2 when
  all selected candidates disappear. Added the interaction test; existing
  fail-closed ignore policy is preserved. No findings deferred.
- Root `npm ci --ignore-scripts --no-audit --no-fund` using the prepared Node
  runtime and a task-local npm cache installed the existing locked dependencies;
  no root dependency/lockfile was changed and no install scripts were run.
- Root `npm run build`: **passed** (TypeScript and Vite).
- Root `npm test -- --run`: **10 passed across 4 files**.
- `node tools/har-compare/examples/check-html-dom.mjs`: **passed** using the
  existing locked jsdom dependency. An isolated synthetic hostile report was
  parsed with script execution enabled and resource/fetch/open interception:
  zero executable/resource nodes, zero observed attempts, payload remained text,
  no raw body secret or DOM execution error. This is DOM QA, not a real-browser
  or CSP-enforcement test; no authenticated browser/profile was used.
- Rust/cargo remain unavailable locally. Review does not establish desktop
  capture behavior, complete secret removal, API schema compatibility or market
  demand. The sample Actions workflow remains inactive and undispatched.

At the start of this continuation all 8 existing GitHub checks at base
`afb8e4ac7a998b128eaa1f63eabc64db53e9f421` had completed SUCCESS, including
macOS/Windows/Linux checks and CodeQL. New-head status must be read back after
push; the base result alone is not evidence that the continuation passed CI.

## Multi-agent sprint recovery checkpoint

2026-11-03, owner job1567256898258866317, manually recovered by
1567269938568368222 after the earlier20-minute process timeout. Saved working
tree and remote state were reconciled before any write; no push/publication
from the interrupted sprint was assumed or repeated.

Fresh product suite: **162/162 passed** after recovery. Scope includes request
inventory/config templates, explicit authored status/JSON-type requirements,
operation-scoped ignores, duplicate-key/decimal-round-trip rejection and JUnit
export. This includes direct module tests and black-box CLI integration.

Existing report demos still reproduce, and protected root dependencies,
Cargo.lock, active workflows, core and license have no diff from1a6b71b.
Independent static/parser probes and fixed six behavioral mutations were run on
recorded source snapshots; future quality/lab checkpoints report their own
versions and fresh outcomes rather than generalizing these receipts.

The artifact-only pinned Rust1.99.1 and Zig0.17.1 environment ran
`cargo fmt --all -- --check` successfully and
`cargo test --workspace --exclude scope-desktop --locked` successfully:
**47 tests** (core22,device23,mcp2). No system package or global toolchain/config
change; root Cargo.lock hash stayed unchanged. Desktop/GUI was explicitly
excluded because GTK/WebKit/pkg-config host prerequisites are unavailable.
Toolchain receipts/commands remain private task artifacts, not source archives.

Normal sandbox-enabled Chromium/Firefox launches remain blocked on this host.
The lab provides actual synthetic loopback HTTP capture, positive no-replay
controls and independent XML parsing; these are not browser screenshots or
runtime-CSP evidence. No sandbox-disabling or host-security change was made.

GitHub account rename was reconciled through MCP get_me and repository metadata:
`dalkedev`, same numeric ID150788324. Canonical draft URL is now
https://github.com/dalkedev/scope/pull/18 . At recovery all8existing checks for
1a6b71b were SUCCESS; this does not establish results for later commits.
