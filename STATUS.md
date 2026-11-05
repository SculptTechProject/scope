# Scope 1.2.0 release candidate

Application version: `1.2.0`. This source branch prepares the reusable offline
HAR comparison Action, refreshed identity and desktop icons, and dependency
updates. A version in source does not establish a published release; see
[Releases](https://github.com/dalkedev/scope/releases) for downloads and their
exact platform manifests/checksums.

Scope includes persistent HTTP(S) capture, request/response rules, editing and
replay, structured traffic filters, HAR/native archives, observed-traffic
analysis, Android proxy/Frida integration and twelve scoped MCP tools. The
separate HAR CLI and composite Action compare local captures; authored contracts
provide explicit status/JSON requirements.

[Recorded verification](docs/VERIFICATION.md) separates local candidate checks,
exact-commit hosted CI and historical macOS/Android interaction. Fresh combined
CI, draft asset verification and interactive desktop/device checks are separate
release steps. Windows/Linux interactive behavior remains experimental; Intel
macOS is unverified. The macOS package is ad-hoc signed, without Apple notarization.

Public packages exclude optional native Frida worker/server binaries. Users may
install the optional runtime separately; source integration, setup helpers and
hook profiles remain included. [Android setup](docs/ANDROID.md)

Bodies remain buffered up to 16 MiB each. WebSocket frames, trailers, HTTP/3,
large-session streaming and long-duration stability are outside verified coverage.
The HAR Action initially targets Linux runners with caller-supplied Node 22.22.3+
and Bash; its results do not validate desktop or device behavior. Derived report
labels and traffic patterns need review before sharing. Existing upstream
dependency findings remain in [DEPENDENCIES.md](docs/DEPENDENCIES.md).

Development: `npm ci` then `npm run desktop`. Packaging: `npm run package`.
[Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) ·
[Release process](docs/RELEASING.md)
