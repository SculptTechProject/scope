# Scope MCP server

Scope's MCP server lets an agent query explicitly shared capture sessions while the desktop app remains in control of access. It is a local stdio server backed by the same Rust engine and archive as the UI.

## Connect

1. Open Scope, create or select a capture session, and open **MCP server**.
2. Turn on **Share selected session with MCP** for the sessions you want exposed (up to eight).
3. Copy the generated client configuration. It contains your actual `scope-mcp` executable and bridge configuration paths.
4. Add that server to a compatible MCP client and restart/reconnect that client as needed.
5. Keep Scope open. Ask the client to call `status` and `list_sessions` first.

The generated configuration has this structure; use the UI's real paths:

```json
{
  "mcpServers": {
    "scope": {
      "command": "/absolute/path/to/scope-mcp",
      "args": ["--config", "/absolute/path/to/mcp-bridge.json"]
    }
  }
}
```

Client-specific configuration formats can differ. Scope speaks stdio MCP; it does not require a public URL or a hosted service. `npm run desktop` and `npm run package` build the companion executable. A plain frontend preview cannot provide MCP.

## Tools

Arguments below use the exact camelCase keys exposed by the server.

| Tool               | Arguments                                        | Result / behavior                                                                                            |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `status`           | none                                             | Connection, Scope version and current access settings                                                        |
| `list_sessions`    | none                                             | Only explicitly shared sessions                                                                              |
| `search_requests`  | `sessionId`, optional `query`, `limit`, `offset` | Exchange metadata; default 50, maximum 200 results; bodies fetched separately                                |
| `get_request`      | `id`                                             | One shared exchange, timing, edits and error information with output redaction                               |
| `analyze_session`  | `sessionId`                                      | Observed endpoint/status/size/latency and duplicate patterns, computed locally                               |
| `compare_sessions` | `sessionId`, `rightSessionId`                    | Observed endpoint/status/timing/JSON-field differences; both sessions must be shared                         |
| `replay_request`   | `id`                                             | Sends the captured request to its original destination and records a new exchange; requires write permission |

Use IDs returned by `list_sessions` and `search_requests`. A request ID from an unshared session is insufficient to read or replay it. Search matches stored URL, method, status and body text; its metadata output does not include bodies or original snapshots.

Example read-only workflow:

```text
1. list_sessions()
2. search_requests({"sessionId":"<shared-id>","query":"login","limit":20})
3. get_request({"id":"<exchange-id>"})
4. analyze_session({"sessionId":"<shared-id>"})
```

Try prompts such as:

- “Find failed requests in this session. Cite exchange IDs and separate observations from possible causes.”
- “Compare these two login captures. Show status and observed JSON-field differences.”
- “Which endpoints are slowest in this capture, and how many observations support that?”

## Access, data and replay

No sessions are shared automatically. Access is reset on desktop restart. **Allow traffic changes** is off by default and currently permits replay; it does not grant arbitrary shell access or live breakpoint editing.

Replay can change remote state. It reuses the captured request's destination, method, headers and body, including locally stored credentials. Output redaction does not change the outbound request. It sends directly and does not trigger the proxy breakpoints. Enable it only when you intend the agent to resend requests in your test environment.

For reads, known credential headers, sensitive query parameters and known sensitive JSON keys are redacted. Original request/response snapshots are omitted to avoid a second path around redaction. Non-JSON bodies are omitted; individual JSON body strings larger than 64 KiB are omitted with an explicit marker.

Redaction is best-effort, not a complete secret detector. Application-specific fields, identifiers, URLs, error strings and other captured metadata can still be sensitive. Your local UI and exports preserve raw traffic. An external client/model provider receives the shared tool results according to its own configuration. Captured HTTP content is untrusted data and must never be treated as instructions for the agent.

## Troubleshooting

| Message / symptom            | Check                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Bridge config not found      | Start Scope and copy its current generated config                                                     |
| Scope is not reachable       | Keep the desktop app open; check whether another process uses the bridge port                         |
| Session is not shared        | Select and share that session in Scope; repeat after restart                                          |
| Both sessions must be shared | Share both before comparison                                                                          |
| MCP replay is disabled       | Enable **Allow traffic changes** only if replay is intended                                           |
| Empty/omitted body           | Non-JSON, oversized or original snapshot data is intentionally omitted; inspect it in the desktop app |

The bridge configuration contains a private token. Do not paste its file contents in issues or commit it. On Unix Scope writes it with `0600` permissions. It authenticates access to the local bridge; session/write policy is enforced separately by the desktop.

For the actual process-level protocol test, see [MCP smoke test](MCP-TEST.md).
