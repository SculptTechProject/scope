# Android interception

Scope's Android adapter uses its own localhost proxy and public CA. HTTP Toolkit does not need to be installed or running.

## What is implemented

- Real ADB device enumeration, including offline/unauthorized states, model and a read-only root check.
- Installed packages and running state. If an existing Frida server is available, app display labels come from Frida; otherwise the exact package ID is shown as the name.
- **System proxy:** Android's global HTTP proxy, a matching ADB reverse mapping and, on rooted devices, temporary system CA injection. The selected application is restarted. This mode is **device-wide**, so traffic from other apps may appear.
- **Frida:** a separate Python worker spawns and attaches to the selected application. Bundled JavaScript profiles configure the app proxy, inject Scope's CA, disable supported certificate pinning and optionally hide selected root indicators.
- Stop restores the previous Android proxy and reverse mapping, detaches hooks, removes Scope's temporary CA and stops only a server process spawned by Scope.
- A saved recovery file allows Stop to retry after a disconnected device or interrupted session. Starting another session is refused until that cleanup succeeds.

No device proxy, certificate or Frida server changes occur during device/app listing. Start interception is the action that changes the selected device. A root check can cause the device's superuser manager to show its normal authorization prompt.

## ADB

Install Android SDK platform-tools and enable USB debugging on the device.

Discovery order:

1. `SCOPE_ADB` executable override.
2. `ANDROID_HOME/platform-tools`, then `ANDROID_SDK_ROOT/platform-tools`.
3. Common macOS, Linux and Windows Android SDK locations.
4. `adb` / `adb.exe` on PATH.

Authorize the computer on the device and use Refresh. A rooted emulator is useful for a local lab. Scope does not create, root or rewrite emulator images.

A non-rooted device can use system proxy mode for HTTP. HTTPS then depends on manually configured app trust. Modern Android apps commonly ignore user-installed CAs, and pinning is not bypassed by proxy mode.

## Frida runtime

The Rust adapter and resources are designed for multiple hosts; the worker is isolated from the desktop process. **The public v0.1.0-alpha.1 app does not include a standalone Frida worker or Android server.** Install the optional runtime locally before using Frida mode. The integration source and JavaScript profiles are included; ordinary proxy capture does not require Python or Frida.

A task-local macOS arm64 bundle with a standalone worker/server was exercised during development. That verifies the optional integration, not the contents of the public download. Worker and device server must use the **same Frida version**.

### Recommended user-side setup

Install Python **3.9+** with `venv` support. Find the Android ABI with `adb -s YOUR_SERIAL shell getprop ro.product.cpu.abi`, then run the included helper. For the public macOS app installed in Applications:

```sh
python3 /Applications/Scope.app/Contents/Resources/resources/device/install-runtime.py --abi arm64-v8a
```

From a source checkout:

```sh
python3 resources/device/install-runtime.py --abi arm64-v8a
```

Replace `arm64-v8a` with the ABI reported by the device (`armeabi-v7a`, `x86` and `x86_64` are also accepted). On Windows, use `py -3` instead of `python3`. Scope also reports a command with the actual resource/runtime paths when no runtime is found.

The helper creates a private virtualenv under Scope's `device/managed-frida` runtime directory, installs pinned Frida 17.9.1 from PyPI and downloads the matching official Android server with a pinned SHA-256 check. It does not use system-wide pip or change the Android device. After it succeeds, retry interception; no environment variables are needed. Server push/start happens only when you start interception. `--runtime-dir` supports a custom Scope device-runtime directory.

Worker precedence is an explicit `SCOPE_FRIDA_WORKER` executable, an explicit `SCOPE_PYTHON` interpreter, an optional privately packaged worker, the managed virtualenv, then `python3`/`python` on PATH. Server precedence is explicit local/device overrides, an optional privately packaged ABI match, the managed ABI match, then an existing default-port USB Frida server. Packaged resources are resolved through `SCOPE_RESOURCES`; source builds also find the repository's resources directory.

### Manual environment overrides

For a separately managed Python environment, from the repository root:

```sh
python3 -m venv .venv-frida
.venv-frida/bin/python -m pip install -r resources/device/requirements-frida.txt
export SCOPE_PYTHON="$PWD/.venv-frida/bin/python"
```

On Windows, use `.venv-frida\Scripts\python.exe` and set `SCOPE_PYTHON` to its absolute path before launching Scope.

With no server override, Scope checks the selected device's ABI and uses a matching optional packaged or managed `frida-server-17.9.1-android-*` resource when available. No native server is included in the initial public app; the recommended helper installs it locally. If none is found, Scope connects to an existing default-port USB Frida server and does not stop a server it did not start.

To have Scope launch a dedicated server, download a matching official binary locally first. This helper **only downloads** and does not alter the device:

```sh
# Choose --abi from: adb -s YOUR_SERIAL shell getprop ro.product.cpu.abi
.venv-frida/bin/python resources/device/prepare_frida.py \
  --abi arm64-v8a --output .runtime/frida-server
export SCOPE_FRIDA_SERVER_LOCAL="$PWD/.runtime/frida-server"
```

Start interception then copies that binary to `/data/local/tmp/scope-frida-server`, checks its version and starts it on device loopback port `24073`. A dynamically allocated local ADB forward connects the Python worker. Only the recorded server PID is stopped.

Alternatively, `SCOPE_FRIDA_SERVER=/absolute/device/path/frida-server` selects an existing executable on the Android device and starts a dedicated instance. The path is validated before entering a remote shell command.

### Experimental local-only standalone packaging

Public packaging excludes optional native Frida binaries from `resources/bin`. To experiment locally with a standalone worker for the current desktop OS/architecture, use a redistributable Python runtime and a dedicated virtualenv. This is not a public redistribution recipe:

```sh
/path/to/redistributable/python3 -m venv .venv-frida-bundle
.venv-frida-bundle/bin/python -m pip install -r resources/device/requirements-bundle-frida.txt
.venv-frida-bundle/bin/python scripts/bundle-frida.py --local-only \
  --work-dir .runtime/frida-package \
  --server /absolute/path/to/matching/android/frida-server --server-arch arm64
```

The helper runs PyInstaller, checks the resulting worker's version and copies the optional device server. It does not install dependencies or touch a device. The selected server is still pushed/started only when interception starts. `SCOPE_FRIDA_WORKER` can point to the result when packaging resources separately.

The locally tested optional worker used CPython 3.12.13 from python-build-standalone, Frida 17.9.1 and PyInstaller 6.22.3. It was checked with an empty environment containing only `/usr/bin:/bin` on PATH and without a system Python. It is macOS arm64 only and is not part of the public release. Windows, Linux and Intel macOS need their own worker builds. Before redistributing any optional native runtime, review the artifact-specific dependency notice requirements and corresponding-source references in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### Hook profiles

| ID            | Behavior                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| `proxy`       | Redirect supported Java HTTP proxy configuration to Scope.                    |
| `certificate` | Inject Scope's public CA into supported Java trust managers.                  |
| `unpinning`   | Disable supported Java certificate pinning checks, including a fallback hook. |
| `root`        | Hide selected root indicators from the instrumented app.                      |

An empty profile array selects `proxy`, `certificate`, `unpinning`. Explicit profiles select exactly those hooks. Root hiding is opt-in. The UI and worker report hook startup diagnostics; readiness means the Java callbacks ran, not that every possible network stack is covered.

### Compatibility boundaries

The source repository recorded Android 16 ART/GC crashes with Frida 17.9.1. This remains experimental; app/OS combinations must be tested. Hook crashes are contained in the external worker/app process and do not erase saved sessions.

The bundled profiles target **Java** networking. Native TLS implementations, QUIC/HTTP3, child processes, anti-instrumentation and app-specific pinning may need additional work. Do not infer complete capture from an empty request list.

The version pin is the imported repository's integration baseline, not a claim that it supports every current Android release. Python/server upgrades should be tested together with the Java bridge bundle.

## Cleanup and recovery

Scope writes `device-recovery.json` under its runtime directory before changing the device. It contains the selected serial/package, previous proxy/reverse state, temporary CA hash and owned forwarding/server identifiers.

Press Stop while the device is connected. If cleanup fails, the file remains and the log explains that reconnection is needed. Reconnect the **same device**, then press Stop again. Do not delete the recovery file as a substitute for restoring device settings.

Rooted CA injection uses temporary mount overlays, following the upstream Android 14+ namespace handling. Stop removes Scope's certificate from those shared stores and the selected app. The remaining mount overlays disappear on reboot. The adapter does not unmount shared trust stores underneath other apps.

Frida detaches hooks on Stop and leaves the selected app running. Restart that app to return its full runtime state to a clean baseline. A server binary downloaded/copied for Scope remains available for the next session; its process is stopped.

## Local Android demo

`examples/android-demo` contains a small Java Activity using `HttpURLConnection`. It talks only to Scope's local demo API at `http://127.0.0.1:17891`.

The build script uses an installed SDK and JDK directly; it requires no Gradle or Maven download:

```sh
bash examples/android-demo/build.sh
adb -s YOUR_SERIAL install -r examples/android-demo/build/scope-demo.apk
adb -s YOUR_SERIAL reverse tcp:17891 tcp:17891
```

The default paths target macOS Android Studio. Override `ANDROID_HOME`, `JAVA_HOME`, `SCOPE_ANDROID_BUILD_TOOLS` and `SCOPE_ANDROID_JAR` for another SDK layout. The demo app itself works on Android API 26+; the offline shell build is currently verified on macOS.

Start Scope's demo server, choose `com.scope.demo` in the application picker and start interception. The app buttons send real GET/POST requests, show the received HTTP status/body and allow enough read timeout for an interactive breakpoint.

The package uses cleartext for the local fixture server. It is a test target, not an example of production TLS configuration. Its login request contains only an explicit local-demo credential.

For low-level adapter diagnosis:

```sh
cargo run -p scope-device --example device -- devices
cargo run -p scope-device --example device -- apps YOUR_SERIAL
cargo run -p scope-device --example device -- start YOUR_SERIAL com.scope.demo proxy 17890 /absolute/path/scope-ca.pem
# Enter stops and restores this smoke-test session.
cargo run -p scope-device --example device -- stop
```

Set `SCOPE_DEVICE_RUNTIME` to an absolute directory to keep the smoke-test recovery state at a chosen location. The smoke test is separate from the desktop runtime.

## Source and licenses

The JavaScript, bridge and original CA template are preserved with their original copyright notices. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the included license files. Runtime config substitutes Scope's own CA and selected proxy port; an installed HTTP Toolkit service or certificate is never read.

## Recorded local smoke test

On 2026-11-02, the macOS build was checked against an existing rooted Android 16 arm64 emulator using only the included `com.scope.demo` application:

- The APK built offline, signed, installed and launched successfully.
- Rust ADB discovery reported the actual device and verified root.
- Proxy mode injected Scope's own CA and verified its contents inside the app's mount namespace. Four tapped GET/POST requests reached the Scope archive with the real `Dalvik` user agent and `X-Scope-Source: android-demo` header.
- Stop restored the previous `:0` global proxy, removed only the proxy ADB reverse mapping, preserved the separate demo-server mapping and removed Scope's CA from system/APEX stores. The Rust subject hash matched `openssl x509 -subject_hash_old`.
- Frida 17.9.1 Python and server then instrumented the selected process. With the global Android proxy still `:0`, three additional tapped requests reached the same archive through the app's Java proxy hooks.
- Frida Stop detached the worker, removed its ADB forward/reverse mappings and stopped the owned server process. The demo app remained running.
- A second Frida smoke used the standalone worker and automatically selected packaged Android arm64 server, with all Python/Frida override variables unset. Two further real APK requests reached the native app's archive; Stop again restored forwarding and left no owned server process.

This is a short functional smoke test of one app/OS/device combination. It does not establish stability under long sessions or support for other network stacks. Windows/Linux packaging and physical-device behavior were not tested in this run.
