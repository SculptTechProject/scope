# Verification

## Reproduce from repository root

Use Node.js 22.22.3 or newer. The runtime CLI is dependency-free. Install only
the separately locked development lab for DOM/browser checks:

```sh
npm ci --prefix tools/har-compare/lab --ignore-scripts
npm test --prefix tools/har-compare
node tools/har-compare/examples/run-demo.mjs
node tools/har-compare/examples/sprint/run.mjs
node tools/har-compare/examples/check-html-dom.mjs
```

For a clean sandbox-enabled Chromium and synthetic screenshots, follow
[the isolated CI job](ci.md). Browser installation is optional locally; an
unavailable sandbox is a failed browser check, never a passing substitute.

## Local review baseline: 2026-11-04

Source baseline: `2895fcb3ae8fc2cbf3184e79cc4256c918293494` on PR #18.
Fresh local checks on Node.js 24.22.2:

| Check | Observed result |
| --- | --- |
| `npm test --prefix tools/har-compare` | 182 passed, 0 failed |
| `node tools/har-compare/examples/run-demo.mjs` | Passed all seven expected outcomes; six report pairs match checked-in bytes |
| `node tools/har-compare/examples/sprint/run.mjs` | Passed all thirteen scenarios; repeated output and checked-in golden bytes match |
| `node tools/har-compare/examples/check-html-dom.mjs` | Passed hostile text/no executable resource/no network attempt checks in jsdom |
| `npm run build` | TypeScript/Vite passed |
| `npm test -- --run` | 10 passed across 4 files |
| `cargo fmt --all -- --check` | Passed using repository-pinned Rust 1.99.1 |

A fresh independent read-only review ran all 182 product tests and thirteen
additional adversarial CLI cases on both Node.js 22.22.3 and 24.22.2. It covered exits 0/1/2, malformed and missing
captures, scoped ignores over repeated query variants, endpoint boundaries,
required fields beneath ignored nodes, invalid UTF-8 query identity, HTML/XML
escaping and metadata-only projection. No reproducible correctness/privacy/HTML
blocker was found in that bounded review. This is not a comprehensive security
audit or a guarantee of complete secret removal.

The synthetic demonstrations verify the distinction between observed changes
and authored requirements: unchanged HTTP 500 or a field absent in both captures
can pass observation mode but fail an explicit contract. Invalid or lossy JSON
fails analysis with exit 2. Report checks use synthetic secret markers rather
than real traffic.

## Remote evidence and remaining gates

At baseline `2895fcb`, the eight existing GitHub checks were completed/success,
including Linux/macOS/Windows checks and CodeQL. Those existing checks did not
run the new HAR job. They cannot establish success for a later head.

The added isolated workflow has not yet been executed remotely. The configured
connection lacks GitHub OAuth `workflow` scope, so publishing its active workflow
file is blocked until a maintainer uses an appropriately authorized connection. Exact-head
Actions results and browser screenshots must be read back after the branch
update before marking PR #18 ready. The sandbox-enabled local Chromium attempt exited 2 with
`BROWSER_SANDBOX_UNAVAILABLE`; no screenshot or runtime-CSP success is claimed.
The isolated lab passed 29 tests; moved DOM dependency resolution also passed.

The full workspace attempt with `cargo test --workspace --locked --offline`
failed with an uncached `atk 0.18.2` desktop dependency. This host also lacks
`pkg-config`; no full desktop test pass is claimed. Real sandboxed browser
evidence remains pending; headless Rust tests do not establish desktop coverage. No new device claim, device test, package release or
production deployment is part of this change.

## Boundaries

Readable host/path/field/config labels may contain sensitive information.
`--labels ids` minimizes labels, not interaction patterns or identity risk.
Excluded operations are outside selected-response analysis. Repeated calls pair
by encounter order; reordered or request-body-dependent variants remain ambiguous.
Synthetic capture lab results establish only the named localhost scenarios.
