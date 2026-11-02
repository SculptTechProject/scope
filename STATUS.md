# Scope v0.1.0-alpha.1 status

Application version: `0.1.0`. First GitHub prerelease targets macOS arm64. See [Releases](https://github.com/SculptTechProject/scope/releases) for the published assets, checksums and release notes.

Implemented: Rust HTTP(S) interception and SQLite archive; native Tauri inspector; request/response editing and replay; HAR/native import/export; observed-traffic analysis/comparison; Android package selection and proxy/Frida integration; seven scoped MCP tools.

The local validation baseline includes 16 passing Rust tests, a TypeScript production build, a native macOS package, real-process MCP checks, native HAR export/import and response editing, and proxy/Frida capture from the included test APK on one rooted Android emulator. [Recorded verification](docs/VERIFICATION.md) distinguishes these checks from unsupported combinations. Check [dependency review](docs/DEPENDENCIES.md) for tracked upstream advisories and maintenance warnings.

The public app omits optional Frida native worker/server binaries. Install the runtime locally for Frida mode; integration source and hook profiles remain included. [Android setup](docs/ANDROID.md)

Windows/Linux workflows are included, but device/runtime parity is not claimed. WebSocket frames, HTTP3, unbounded/streaming bodies and long-session stability remain outside this alpha's verified coverage. The macOS package is not Apple-notarized.

Development: `npm ci` then `npm run desktop`. Packaging: `npm run package`. [Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Release process](docs/RELEASING.md)
