# Screenshot provenance

These are original, unedited captures of the running native macOS Scope 1.0.0 application, taken on November 2, 2026. They show actual engine results and persisted rules, not seeded interface rows or a browser mockup.

Scope was placed in native fullscreen mode to hide the system capture/title strip. Before each capture, the pointer was moved to Finder's native menu outside Scope's captured window and the menu was dismissed. The documented native application screenshot API then saved the original image bytes. No cropping, cursor removal, image generation or retouching was applied.

All displayed traffic is synthetic and local: Scope's fixture on `127.0.0.1:17891`, reached through its proxy on `127.0.0.1:17890`, plus a replay sent by Scope's engine. A fresh QA archive was used. No private app traffic, account credentials, access tokens or private filesystem paths are shown. The Android emulator stayed stopped throughout this capture session.

| Image                                      | What it shows                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Traffic inspector](traffic-inspector.jpg) | A 15-exchange session from two six-request fixture runs, two separately issued curl requests, and one composed replay. The selected products response is HTTP 503 with its local mock provenance.                                                                                            |
| [Traffic rules](traffic-rules.jpg)         | The persisted, enabled **Product API maintenance** rule: priority 10, host `127.0.0.1`, path prefix `/api/products`, local HTTP 503 response, JSON content type and maintenance body.                                                                                                        |
| [Replay composer](replay-composer.jpg)     | A successfully replayed request reopened in the composer: POST `/api/profile?scenario=composed` with a synthetic JSON body. The prior send returned HTTP 200; the request inspector confirmed `x-scope-lab: composed` and the edited body. The reopened composer was canceled after capture. |
| [Analysis](analysis.jpg)                   | Aggregates for the same 15 exchanges: six observed method/path combinations, intentional HTTP 401 responses, four local mock responses and a deliberately slower endpoint. These timings describe this capture only.                                                                         |

To reproduce:

1. Launch the native desktop application and select **Generate real test traffic**. This starts the localhost fixture and captures real HTTP requests.
2. In **Traffic rules**, save an enabled mock response rule for host `127.0.0.1` and path prefix `/api/products`, status `503`, header `content-type: application/json`, and a synthetic maintenance body.
3. Issue a separate request through the proxy:

   ```sh
   curl --noproxy '' --proxy http://127.0.0.1:17890 http://127.0.0.1:17891/api/products
   ```

4. Inspect the saved exchange and its rule provenance. Select **Compose replay**, change method, URL, headers or body, and explicitly send it. The example POST targets `/api/profile?scenario=composed`, outside the mock's path matcher.
5. Open **Analysis** for the same saved session. Additional fixture runs and proxied requests change the counts and timings.

The screenshot QA also verified session name/notes/tags/pin persistence, rule duplication and priority changes, the metadata-only activity trail, read-only diagnostics with no device connected, and independent MCP scope/permission toggles. All MCP access was restored to zero shared sessions with changes, rules and diagnostics disabled. Capture was stopped and Scope was quit after verification.
