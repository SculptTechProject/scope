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
