# Recorded verification

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
