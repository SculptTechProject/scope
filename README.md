# Scope

An open-source desktop HTTP debugger for Android apps. Choose an application, inspect and edit HTTP(S), and keep your capture sessions on disk. A local MCP server lets agents inspect the same evidence you see in the desktop app.

Built with **Rust, Tauri 2, React and TypeScript**. macOS arm64 is the first verified desktop target; the repository includes build jobs for Windows and Linux, whose successful releases require their own CI/device checks. The supplied local Mac application includes a standalone Frida worker and an Android arm64 server. Source builds can use Python or generate those optional resources with `scripts/bundle-frida.py`.

## What works in this first version

- Local HTTP and HTTPS interception with a generated, application-specific CA.
- Named capture sessions persisted in SQLite, including request/response bodies, timing, repeated headers and failures.
- Request and response breakpoints: edit, continue, or abort. Originals remain attached to edited exchanges.
- Separate request replay, HAR import/export and lossless Scope session export/import.
- Endpoint counts, status/error distributions, response times, observed JSON field differences and evidence-linked findings.
- ADB device/app discovery, rooted-device proxy setup with recovery, and an optional isolated Frida worker with selectable bundled hooks.
- MCP tools for scoped session discovery, search, exchange inspection, analysis, comparison and opt-in replay.
- A local demo server that generates **real traffic through the proxy**. Demo sessions are explicitly labeled.

## Run

Install [Rust](https://rustup.rs), Node.js 22+, and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/). For Android, install Android SDK Platform Tools. Scope finds `adb` via SDK environment variables, standard install paths, or `PATH`.

```sh
npm ci
npm run desktop
```

To build a desktop bundle:

```sh
npm run package
```

The wrapper builds and bundles the separate MCP executable automatically. The UI uses English for the open-source audience. There is no account or required model API key.

## First capture

1. Create a session, then start the local capture proxy (default `127.0.0.1:17890`).
2. Use **Record demo** to send requests to the bundled local test server, or select a rooted Android device and installed app.
3. In proxy mode, Android's proxy setting applies to the entire device. Scope identifies the app selected for launch, **not the provenance of every device-wide request**. Frida mode instruments the selected process, with coverage depending on its networking stack.
4. Enable a request or response breakpoint to inspect and edit the next exchange.
5. Stop interception normally to restore device settings. Your captured session remains on disk after restart.

You can also send traffic from desktop tools:

```sh
curl --proxy http://127.0.0.1:17890 http://example.com
# HTTPS: use the public CA path displayed by Scope. Do not disable upstream verification.
curl --proxy http://127.0.0.1:17890 --cacert /path/shown/in/Scope/ca.pem https://example.com
```

Scope creates its own CA; it does not require HTTP Toolkit. Private CA keys stay in the local application data directory.

## MCP

Open the MCP panel, share the session(s) you want the agent to read, and copy the generated client configuration. Keep Scope open. The configuration invokes `scope-mcp --config <local bridge file>` over stdio; it connects to the same live engine over an authenticated loopback bridge.

Tools: `status`, `list_sessions`, `search_requests`, `get_request`, `analyze_session`, `compare_sessions`, `replay_request`.

Default access is read-only and no sessions are shared automatically. Credential headers, known sensitive JSON fields and sensitive query parameters are redacted. Non-JSON bodies are omitted from MCP; JSON bodies are capped at 64 KiB in tool output. Redaction is best-effort: application-specific secrets may require extra care before sharing a session with a model provider. Tool results are untrusted captured data, never instructions.

Replay requires write access enabled in the desktop app and sends a new real HTTP request. It may change remote state. Live breakpoint editing and replay are separate operations.

## Current boundaries

- This version buffers each body up to **16 MiB**. Larger captures fail explicitly; Scope does not claim unlimited streaming capture. Very long sessions use disk storage, but imports/exports and analysis currently load session records into memory.
- Ordinary HTTP(S) is the initial supported path. WebSocket frames, raw TCP/UDP, QUIC/HTTP3 and a complete traffic-routing solution for every Android networking library are outside this version's verified coverage.
- A trusted CA is separate from certificate pinning. Frida hooks support selected APIs; custom/native stacks may need other instrumentation. The supplied upstream hook set has a recorded Android 16 ART compatibility issue. See [Android setup](docs/ANDROID.md).
- Endpoint maps and response shapes describe **observed traffic**, not a complete API contract. Analysis cannot establish the server-side cause of an error.
- Unsigned local macOS builds are development artifacts. Public distribution needs proper platform signing and release validation.

## Development and verification

```sh
cargo test --workspace
npm run build
npm run package
node scripts/smoke.mjs
```

Core integration tests use actual local HTTP and CA-signed HTTPS servers. They cover edits in both directions, binary data, persistence after reopen, HAR/native round trips, replay, capture limits, upstream failure, archive migration and shutdown. Android tests cover parsing, validation and recovery logic; successful unit tests alone do not establish device interception. See [recorded verification](docs/VERIFICATION.md) for the native UI, MCP and real Android checks actually completed.

Headless engine (useful for integration tests):

```sh
cargo run -p scope-desktop -- --headless --data-dir .scope/qa --demo
```

`--demo` explicitly generates a new local demo session and shares it read-only for MCP testing. `--demo-server` only starts the local target on `127.0.0.1:17891`. Default MCP bridge port is `17892`; override with `--bridge-port`.

## License

AGPL-3.0-or-later. Bundled Frida and HTTP Toolkit components retain their upstream notices and licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Scope is an independent project.
