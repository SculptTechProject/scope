# Local end-to-end MCP smoke test

Build the actual native executables, then run:

```sh
cargo build -p scope-desktop -p scope-mcp
node scripts/smoke.mjs
```

Requirements: Node.js 22.13+ with built-in `node:sqlite` (Node.js 24 LTS recommended), `curl`, and the platform dependencies needed to build Tauri. The test has no npm dependencies. On Windows run it in a normal terminal where console processes can be launched. Override executable locations with `SCOPE_BIN` and `SCOPE_MCP_BIN` when testing release builds.

Keep ports **17890** and **17891** free; the demo uses them. The authenticated MCP bridge and the credential fixture use ephemeral localhost ports. If a demo is already running, the test reports the busy port without stopping that process.

The script launches the real headless desktop engine and real `scope-mcp` process. It performs MCP protocol negotiation (`2025-11-25`), initializes the client, lists all seven tools, reads six actual demo captures, computes analysis, and verifies that unauthenticated bridge access, unshared session access, cross-scope comparison and replay without write access are denied.

It then sends a real HTTP request through the proxy using `curl` to a temporary local fixture. Synthetic secrets appear in authorization/cookie/custom headers, URL query parameters and nested JSON request/response bodies. The test verifies that MCP redacts them while preserving public evidence, and checks that the original local bodies are stored in SQLite. After stopping and reopening the engine with the **same data directory**, it verifies that all seven exchanges remain on disk and that the previously shared real session is inaccessible to MCP until shared again.

Only localhost is contacted. No Android device is connected or modified. Temporary processes and files are cleaned up on success and failure. Set `SCOPE_KEEP_SMOKE_DATA=1` to preserve a failing test's temporary SQLite database for diagnosis; it contains only generated fixture data.

The script requests graceful engine shutdown with `SIGINT`. POSIX systems deliver that signal to the Rust Ctrl+C handler. On Windows Node's process signal handling can terminate a child rather than dispatch console Ctrl+C, so the test still verifies committed SQLite persistence and cleanup but does **not** prove the graceful Ctrl+C path on Windows. The core Rust shutdown integration test separately verifies breakpoint draining and bounded shutdown.
