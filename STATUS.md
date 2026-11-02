# Scope 0.1.0 local alpha

Implemented on 2026-11-02: Rust HTTP(S) interception and SQLite archive, Tauri interface, request/response editing, replay, HAR/native import/export, observed-traffic analysis/comparison, Android package selection, proxy/Frida integration and scoped MCP.

Verification: 16 passing Rust tests; TypeScript production build; native macOS release bundle; release MCP end-to-end smoke; native HAR export/import and response editing; real own-APK Android proxy and Frida capture with cleanup. See [verification](docs/VERIFICATION.md).

Run from source: `npm ci`, then `npm run desktop`. Build: `npm run package`. macOS arm64 application is delivered beside this repository as `Scope.app`.

Local repository only. Windows/Linux workflows are prepared but not locally executed. Public repository/release and platform signing are still separate steps.
