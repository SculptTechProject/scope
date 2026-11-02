# Screenshot provenance

These are unedited captures of the running native macOS Scope app, taken on November 2, 2026. They show actual engine results, not seeded interface rows or a browser mockup. Native window chrome and the pointer at the window edge are part of the original captures.

All displayed HTTP traffic is synthetic: Scope's built-in local server on `127.0.0.1:17891`, reached through its local proxy on port `17890`. No account credentials, real user traffic, private filesystem paths or access tokens are shown.

| Image | What it shows |
| --- | --- |
| [Traffic inspector](traffic-inspector.png) | Two runs of **Generate test traffic** produced 12 real captured requests. The selected configuration endpoint returns JSON identifying the local test server. |
| [Analysis](analysis.png) | A separate six-request baseline, with observed endpoint aggregates, one HTTP 401 response and a deliberately slower endpoint. These measurements describe this capture only. |
| [Android app picker](android-app-picker.png) | A real ADB scan of a rooted Android emulator, showing the installed `com.scope.demo` package. This screenshot shows selection before interception starts and includes the device-wide proxy disclosure. |

To reproduce the traffic views, launch the desktop app, create a session, and select **Generate test traffic**. Open **Analysis** to inspect the same persisted capture. The Android view additionally requires a connected, authorized emulator or device with ADB available.
