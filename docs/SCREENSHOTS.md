# Screenshots

These images show the actual Scope desktop application with synthetic localhost fixture traffic. They do not show private app captures. The fixture sends real HTTP requests through Scope's capture engine.

## Traffic inspector

![Captured local requests and the response inspector](images/traffic-inspector.png)

## Analysis

![Observed endpoint and error analysis for a saved local session](images/analysis.png)

## Response editing

![An actual paused localhost response edited to HTTP 503 with synthetic maintenance JSON](images/response-breakpoint.png)

The response was paused in the proxy, edited in the native interface, and continued to the requesting client. The saved exchange retains its original HTTP 200 response.

## Android application picker

![The Android app picker with the local Scope Demo package and device-wide proxy disclosure](images/android-app-picker.png)

These images are unedited native captures; [capture provenance](images/README.md) records their setup. They document the alpha interface, not universal Android or cross-platform compatibility. See [recorded verification](VERIFICATION.md) for the checks actually performed.
