# Recorded verification

## 1.0.0 release preparation — 2026-11-02

These checks were recorded on `release/1.0.0` before publication, with source and
package version `1.0.0`. [GitHub Releases](https://github.com/SculptTechProject/scope/releases)
records published versions and downloadable artifacts. The earlier alpha evidence
is retained below as a separate historical baseline.

Checks run during candidate preparation:

- 52 Rust workspace tests passed: 22 core, 23 device, 5 desktop policy/redaction
  and 2 MCP transport tests. Rules use real HTTP/TLS fixtures; diagnostics and
  cleanup use fake ADB fixtures rather than a newly booted emulator.
- Regressions cover proxy Stop during a held replay, deletion/cancellation
  ownership, Scope session IDs versus payload credential names, valid OpenAPI
  schema fields and redacted-search membership isolation.
- 10 frontend interaction tests passed on Node 22.22.3; TypeScript/Vite built.
- Strict workspace Clippy, actionlint, three Node release/tag-resource tests and three
  Python installer tests passed. npm audit reports zero vulnerabilities.
- The macOS arm64 native package built and its complete ad-hoc signature verified.
- Cargo audit's vulnerability list has zero entries; the Linux glib unsoundness
  and two unmaintained-dependency warnings remain documented in DEPENDENCIES.md.

Cross-platform [CI run 41440372077](https://github.com/SculptTechProject/scope/actions/runs/41440372077)
passed all three jobs at source commit `6448b60`: Windows 2022 x64, Ubuntu 22.04
x64 and macOS 14 arm64. Each job ran the Rust/frontend/resource/installer tests,
native packaging and the real-process MCP/capture/persistence smoke. These are
build and headless-protocol checks, not interactive desktop/device validation on
Windows or Linux. The final PR head is checked separately by GitHub Actions.

### Local native candidate checks

- Fresh synthetic archive: real demo traffic visibly transitioned from in-flight
  to completed. Rename, notes, tags and pin persisted; active-capture deletion
  stayed disabled.
- Created, duplicated, reordered, toggled and deleted rules in the native UI.
  The enabled product mock returned actual HTTP 503 and the configured JSON to
  an independent proxied curl client; provenance and applied rule were visible.
- Composed a POST replay with a new URL/query, custom header and JSON body.
  The saved exchange showed status 200, the edited fields and normalized length.
- Activity filtering and no-device diagnostics worked; all MCP permissions were
  toggled and restored off. Capture stopped and native Quit released all three
  listeners. No emulator was started.
- Four new genuine native screenshots show traffic, rules, replay and analysis,
  with neither the upper recording bar nor mouse pointer. No generative editing
  or image retouching was used. See [gallery](SCREENSHOTS.md).
- After final packaging, `scripts/smoke.mjs` passed against executables INSIDE
  the public `.app`: twelve tools, OpenAPI, real capture, redaction, access gates,
  SQLite persistence, restart isolation and graceful shutdown. Final resources
  exclude optional native Frida files; the complete ad-hoc signature verifies.

No new physical Android or Windows/Linux desktop interaction is implied. Native
branch protection requires maintainer review before merge; the release workflow
builds an existing tag into a draft and does not publish automatically.

## Historical alpha baseline

Date: 2026-11-02. Host: macOS arm64. Application version 0.1.0; verification baseline for prerelease `v0.1.0-alpha.1`.

## Automated checks

- `cargo test --workspace --locked`: **16 passing tests**. Eight core tests (one unit and seven real-protocol integration/migration tests), seven Android adapter tests, one MCP credential-redaction test.
- `npm run build`: TypeScript and Vite production bundle passed.
- `npm run package`: native release application and separate MCP executable built; macOS `.app` produced.
- `scripts/smoke.mjs` ran successfully against release binaries: real MCP initialize/initialized, seven tool definitions, live local captures, analysis, authentication, sharing scope, default replay denial and credential redaction.
- That smoke test shut down and reopened the same SQLite archive: seven complete exchanges remained, shared-session access reset, and previously shared real session/exchange IDs were denied.
- Core tests include actual CA-signed HTTPS interception, both breakpoint directions, originals, binary data, concurrent pairing, replay, HAR/native roundtrips, 16 MiB rejection, timeout/abort/shutdown, legacy schema migration and persistent session revisions after completion.

## Native macOS interface

The packaged application was launched through its actual `.app` bundle.

- Generated six real requests through the proxy to the local fixture server.
- Selected captured exchanges and inspected actual response JSON.
- Quit/reopened the app: saved requests remained visible.
- Exported a HAR using the native Save dialog to `scope-native-verified.har`; parsed the resulting file and confirmed all 13 response bodies were present.
- Imported that file through the native picker: a separate 13-request session appeared.
- Opened Analysis and confirmed observed endpoint/error counts.
- Enabled a response breakpoint; a real curl request paused. Edited JSON in the native editor and continued. The waiting curl client received `{"editedInScope":true,"plan":"open-source"}`.
- This check exposed a stale-row issue when a response updated an existing exchange. The fix uses persistent session revisions plus pending transitions; integration assertions cover revision changes after request/response completion. A second native run then visibly changed the same 30th row from Paused to 200 / edited without adding a request; curl received `{"finalBuildVerified":true}`.
- macOS titlebar overlay was removed after it interfered with controls. Standard native titlebar controls and Save dialog were then verified.

## Real Android / Frida checks

See [Android test detail](ANDROID.md#recorded-local-smoke-test). One existing rooted Android 16 arm64 emulator and only the included `com.scope.demo` app were used.

- System proxy mode captured four real app GET/POST requests. Scope CA visibility was verified in the app namespace. Stop restored previous proxy and removed Scope-owned mappings/certificate.
- Frida 17.9.1 captured three additional requests while the global proxy remained disabled. Stop detached and stopped its owned server.
- The bundled standalone worker and automatic Android arm64 server selection were then tested with Python/Frida overrides unset: two more real app requests were captured, followed by verified cleanup.

## Boundaries

These checks establish a local functional alpha, not universal Android compatibility or production stability. Windows/Linux jobs are included but were not executed in this local run. Physical devices, long-duration sessions, WebSocket frames, HTTP3 and arbitrary native Android networking stacks were not verified. The macOS artifact is not Apple-notarized.

The standalone Frida worker/server checks above used a development bundle. The public `v0.1.0-alpha.1` package deliberately omits these optional native binaries because a complete artifact-specific Frida dependency notice inventory has not been established. Users can install the optional runtime locally; source integration and profiles remain included. See [Android setup](ANDROID.md#frida-runtime), [release procedure](RELEASING.md), and [third-party notices](../THIRD_PARTY_NOTICES.md).

Publication and CI status are recorded by [GitHub Releases](https://github.com/SculptTechProject/scope/releases) and [Actions](https://github.com/SculptTechProject/scope/actions), separately from the local checks above.

## Public alpha preparation

Additional checks on the public macOS arm64 bundle:

- All **16 Rust workspace tests**, strict workspace Clippy (`--all-targets --locked -- -D warnings`), TypeScript and production builds passed.
- **Two Node release-resource tests** and **three Python installer tests** passed. The installer rejects a corrupt server download before writing an executable.
- Actual bundled resources were inspected: optional Frida/Python native binaries, capture archives, private CA keys and MCP bridge tokens are absent. Scope's license, dependency notices and source setup helper are present.
- `codesign --verify --deep --strict` passed after the packaging helper signed the complete final bundle with a local **ad-hoc** signature. It is not Apple Developer signed/notarized.
- `scripts/smoke.mjs` ran against the desktop and MCP executables **inside that public app bundle**. Real capture reads, seven MCP tools, authentication, session access, credential redaction, default replay denial, shutdown and persisted archive/restart isolation passed.
- Gitleaks 8.30.1 scanned the complete committed source history with no detected secrets. Build products are excluded from the source archive.
- The alpha's four [screenshots](https://github.com/SculptTechProject/scope/blob/e2611d640e10fd2be0c97b0095fed6826ce0ddcb/docs/SCREENSHOTS.md) were actual native captures. In the final public alpha, a proxied curl response paused; the native editor changed HTTP 200 to 503 and supplied synthetic maintenance JSON. The waiting client received that exact body, the saved row became `503 / edited`, and Original retained status 200 and the original JSON. The current gallery shows the 1.0 candidate.
- A separate concurrency check kept a direct replay waiting at a controlled localhost fixture while another response passed through the proxy. Edit/Continue remained usable, the client received `{"demo":true,"concurrentBreakpointPassed":true}`, and replay finished after the fixture was released. This verifies the separation of replay state from other breakpoint actions. Replay itself sends directly and does not trigger proxy breakpoints.
- A replay selection race was corrected so an asynchronous result cannot select an old session's exchange after switching sessions. TypeScript/build and independent code review passed. The final native app was left with capture stopped and both breakpoints disabled.

See [release preparation](RELEASING.md) and [dependency findings](DEPENDENCIES.md) for artifact and platform boundaries.
