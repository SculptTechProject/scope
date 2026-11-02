# Changelog

User-visible changes are recorded here. The project is in alpha; interfaces and archive schemas may evolve. Back up important captures before upgrading.

## v0.1.0-alpha.1 — 2026-11-02

Application/package version: `0.1.0`. GitHub prerelease; macOS arm64 public artifact.

### Added

- Rust HTTP(S) interception with a generated Scope CA and binary-safe SQLite sessions.
- Native Tauri desktop UI: traffic inspector, request/response bodies and headers, timing, saved sessions and device setup.
- Request/response breakpoints with editing, original snapshots, abort and bounded expiry; separate request replay.
- HAR import/export and a lossless Scope session format.
- Observed endpoint/error/size/latency analysis and session comparison.
- ADB device/app discovery, device-wide proxy mode and selected-process Frida mode with selectable attributed hook profiles.
- Recorded cleanup/recovery state for device proxy, temporary certificates, forwarding and Scope-owned Frida server resources.
- Seven stdio MCP tools with authenticated loopback transport, explicit session scope, output redaction and opt-in replay.
- A local HTTP fixture and Android demo app for real, reproducible capture checks.
- Automated integration tests, native macOS/Android verification records and desktop build workflows.

### Known limits

- macOS arm64 is the first locally verified host; other desktop runtime/device combinations require validation.
- Bodies are buffered up to 16 MiB each. WebSocket frames, HTTP trailers and QUIC/HTTP3 are not captured.
- Android hook coverage targets selected Java APIs; Android 16/Frida compatibility is experimental.
- Analysis and import/export load session records into memory; long-running stability has not been established.
- The public macOS package is not Apple-notarized. Optional Frida native binaries are installed separately by the user; source integration and hook profiles are included.

Exact checks and device coverage: [docs/VERIFICATION.md](docs/VERIFICATION.md).
