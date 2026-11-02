# Roadmap

Scope is an alpha built around a complete loop: select a target, capture, inspect/edit, save, reopen and analyze. This roadmap is a direction, not a delivery schedule. Proposals are welcome through [feature requests](https://github.com/SculptTechProject/scope/issues/new?template=feature_request.yml).

## Next: make the first release dependable

- Validate packaged apps on Windows and Linux, then publish a clear host/device compatibility matrix.
- Expand physical-device and Android-version testing with reproducible fixtures and explicit cleanup checks.
- Add macOS signing/notarization and document provenance for every bundled native runtime.
- Exercise interrupted capture, device disconnect/reconnect and long sessions beyond the short functional smoke tests.
- Improve actionable diagnostics for CA trust, pinning, native networking and unavailable Frida runtimes.

## Capture and archive

- Bounded streaming/body storage for large messages and long captures.
- Session retention, deletion and efficient indexed search.
- WebSocket frame inspection and replay where technically meaningful.
- Better handling of additional HTTP features and Android native networking stacks, with tests per supported path.

## Understand and automate

- Reusable interception rules and mock responses.
- More useful traffic comparison with clear evidence links and fewer noisy field differences.
- Configurable redaction before sharing or exporting; review of custom secret fields.
- MCP capabilities that preserve explicit session scope and distinguish read-only analysis from traffic changes.

## Principles for accepting scope

Local session storage and export stay available without an account or paid gate. Capture support claims require actual protocol/device evidence. New instrumentation must preserve upstream notices and include a reliable Stop/recovery path. Observed traffic must remain distinguishable from a claimed complete API specification.
