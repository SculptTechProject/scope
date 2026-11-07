# Scope-owned Android engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HTTP Toolkit runtime hooks with an original CA-scoped Android interception engine in one independently reviewed PR.
**Architecture:** Original JavaScript hook/policy code runs in the selected app through the existing Python/Frida worker. Rust retains proxy/recovery management and materializes only the new assets. Imported system trust injection and unsupported root profiles are removed explicitly.
**Tech Stack:** JavaScript, Python, Rust, existing Frida Java bridge; pinned existing dependencies.
**Spec:** docs/superpowers/specs/2026-11-07-owned-android-engine-design.md

## Global Constraints

- Preserve existing Rust proxy/TLS/archive behavior and source history; no license change.
- New runtime implementations must be original, not copied or mechanically translated upstream hooks.
- Supported profiles are `proxy`, `certificate`, `unpinning`; an empty selection means all three. `unpinning` requires `certificate`.
- Unsupported `root`, `system-ca` or unknown profiles fail before any device probes or state mutation.
- No trust-all manager, hostname-verifier bypass, certificate-expiry bypass or global system trust-store mutation is allowed.
- Only validated Scope-CA chains may bypass supported OkHttp pin checks; all other chains keep original checks/exceptions.
- Readiness requires installed requested capabilities. Stop terminates only the exact worker-spawned process; failures remain visible.
- Keep legacy CA removal recovery; document proxy/root/native coverage reductions.
- Public artifacts contain no private context, paths, captures, credentials or machine identifiers.
- Never claim mock tests are Android results. Real unavailable gates are NOT RUN. No merge/release/tags/admin/engine changes.

## Review Focus

- Unrelated/expired/malformed chains must not gain trust or bypass pins.
- Partial hook installation and missing overloads must roll back, never report ready.
- Explicit profiles including stale root/system-ca values must fail before device writes.
- Worker cancellation/startup error must not leave an owned instrumented process active or kill unrelated PIDs.
- Old recovery records must still clean only Scope-owned CA/mappings after injection is removed.

### Task 1: Original hook engine and worker contract

**Files:** Create `resources/frida/scope-engine.js`, `resources/frida/tests/scope-engine.test.cjs`, `resources/device/tests/test_frida_worker.py`; modify `resources/device/frida_worker.py`.
**Interfaces:** Worker `build_script(root, ca, port, profiles) -> str` remains available. `normalize_profiles(profiles) -> list[str]` is shared by the CLI/builder. New JS exports a testable engine factory/policy boundary and runs through documented Frida `Java` APIs. JSON runtime config uses public CA/loopback proxy/normalized profiles. Readiness payload identifies engine `scope-java-v1`, selected profiles and installed capabilities; Python validates it. Existing Rust JSONL `ready/error/stopped/detached` kinds remain compatible.

- [ ] Write executable JS and Python failing tests for CA-scoped pin decisions, original rejection propagation, original trust delegation, explicit/default/unsupported profiles, missing classes and transactional rollback, hostile config serialization, readiness validation and owned-PID cleanup.
- [ ] Observe RED with expected missing implementation or wrong existing behavior; record exact commands/output in report.
- [ ] Implement original engine (small focused helpers in one runtime file), worker JSON config construction, capability-aware ready gate and finite owned-process cleanup; preserve CLI listing/version and bounded diagnostics. Use the actual Frida API, not a production test stub. Any unimplemented requested capability is an error.
- [ ] Run focused tests plus complete Python device suite; self-review. Do not claim fixture-based adapter tests are device verification.
- [ ] Commit only Task1 files and report exact RED/GREEN and remaining limitations.

### Task 2: Application integration, migration and release verification

**Files:** Modify `crates/scope-device/src/lib.rs`, `src/App.tsx`, `README.md`, `docs/ANDROID.md`, `THIRD_PARTY_NOTICES.md`, `.github/workflows/checks.yml`, affected existing tests; remove six imported HTK runtime JS/config files and `resources/device/install-system-ca.template.sh`; retain Frida bridge/licenses. Add `docs/ANDROID_ENGINE.md` with explicit coverage/evidence.
**Interfaces:** Consume Task1 `scope-engine.js`, `normalize_profiles` and JSONL engine/capability payload. Rust rejects unsupported profiles before ADB/root probes; ASSETS materializes only `frida/scope-engine.js`, existing Frida bridge and worker. Remove automatic system CA installation, preserve cleanup of old recovery ca_hash. UI removes unsupported root option and explains Stop ends the instrumented process.

- [ ] Add regression tests for early unsupported profile rejection, asset construction and legacy owned-CA recovery behavior where affected; observe RED.
- [ ] Wire original engine and remove imported runtime source/injection path. Preserve unrelated Rust proxy and recovery semantics.
- [ ] Update docs/notices accurately including retained bridge distribution provenance, current original engine, explicit reduced coverage and device NOT RUN gates; no licensing cleanup beyond truthful component inventory.
- [ ] Add the executable JS engine test command to the existing three-platform checks using existing pinned actions. Keep existing checks/security unchanged.
- [ ] Run focused Rust device tests, all JS/Python suites, UI tests/build when available, formatting and source/privacy/provenance checks; record unavailable desktop/device gates explicitly.
- [ ] Commit, report evidence. Root obtains independent spec/quality review, fixes findings with regression tests, creates exactly one PR only after local review, reconciles hosted checks on exact head. Keep draft if real device gates are unavailable.
