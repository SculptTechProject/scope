# Contributing

Scope is a local desktop debugger. Keep the core engine independent from Tauri so the GUI and MCP use the same behavior.

Before opening a change, run `cargo test --workspace` and `npm run build`. For capture changes, add an integration test using a local server and actual traffic. A parser test or a screenshot alone does not establish end-to-end interception.

For Android reports, include host OS, Android version, device ABI, capture mode, Frida versions and sanitized logs. Specify whether the request was seen and whether the edited response reached the app. Do not include private CA keys, credentials or personal captures.

Keep upstream copyright and license notices when changing bundled scripts. Document protocol and networking-stack limitations explicitly. Findings should cite captured exchange IDs and separate evidence from hypotheses.

Do not introduce a mandatory account or paid gate for local session storage, import/export or the MCP interface.
