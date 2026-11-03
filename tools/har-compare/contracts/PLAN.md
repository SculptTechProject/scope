# Authored HAR response contracts implementation plan

**Goal:** Detect candidate responses that violate small, explicit developer-authored requirements, including unchanged HTTP errors and missing fields in both captures.

**Architecture:** A pure module consumes entries already normalized and bounded by `src/input.mjs`. Configuration validation is separate from evaluation; results expose ordinal rule/entry references, status numbers and JSON types, never captured values or request keys.

**Tech stack:** Node 22.22.3 ESM and built-in `node:test`, with no new dependencies.

**Scope:** Only this directory is owned by this work item. The coordinator owns config, CLI and report integration. No Git mutation, network request replay, schema inference, account or deployment work.

## Decision

Use exact method/origin/path rules with optional allowed status lists and required JSON pointer/type checks. A global HTTP-error policy would add another parallel mechanism; inferred required schemas would overstate what HAR observations establish. Status lists and required pointer/type pairs are the smallest useful authored language.

Selectors match all query variants and every repeated candidate response. Each rule must contain a real assertion. Unknown keys, duplicate selectors/pointers, invalid pointer escapes, invalid types/statuses and excess resource bounds fail with redacted configuration errors.

## Review focus

- A field missing from both captures still violates its authored requirement.
- HTTP 500 unchanged from baseline still violates `[200]`.
- All occurrences/query variants are checked, without leaking query values.
- Pointer traversal never follows inherited properties and uses canonical array indices.
- Unused rules and report/finding bounds fail closed.

## Steps

- [x] Write and run failing tests for allowed status contracts, including unchanged failures.
- [x] Implement `validateContracts(raw)` and `evaluateContracts(...)` in `index.mjs`.
- [x] Write and run failing tests for missing/type/body failures and RFC 6901 traversal; implement minimal traversal.
- [x] Write and run failing tests for configuration limits, exact matching, unused rules, determinism and redaction; implement validation/bounds.
- [x] Document the agreed API and configuration in `README.md`.
- [x] Run standalone contract tests and the existing HAR CLI suite. Report actual results and integration limits to the coordinator.

## Verification evidence

2026-11-03: the pinned Node command with `contracts/contracts.test.mjs` and `test/cli.test.mjs` passed 104/104 tests (29 contract and 75 existing CLI tests). This verifies the pure module and previous CLI behavior, not the coordinator's later integration. No commits, external writes or deployment occurred in this work item.
