# Security policy

Scope handles traffic that can contain credentials, personal data and a local certificate-authority private key. Keep real captures and application data out of public issues and pull requests.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/SculptTechProject/scope/security/advisories/new) when it is available for this repository. Include the affected commit/version, reproduction steps using synthetic data, impact, and any proposed fix. Do not attach real credentials, captured user data, private CA keys or MCP bridge tokens.

If private reporting is unavailable, open a minimal public issue asking for a private reporting channel without disclosing exploit details or secrets. The project is maintained on a best-effort basis; there is no guaranteed response deadline.

Only the latest alpha is actively maintained at this stage. Security fixes are expected on the main branch and the next release; there is no LTS policy or promise of backports yet.

## Relevant boundaries

- Capture and the authenticated MCP bridge bind loopback. Do not expose them through a public tunnel or change their bind addresses without reviewing the access model.
- Scope generates its own CA. Its private key stays in the application data directory; only the public certificate belongs on a device/client trust store.
- Local SQLite captures and HAR/Scope exports contain raw traffic and are not encrypted by Scope. Protect them with your host's filesystem/account controls.
- MCP shares no sessions by default. Session scope and write permission reset on restart. Known credentials are redacted from tool output, but redaction cannot identify every application-specific secret.
- MCP replay sends the raw captured request, including stored credentials, to its original destination. Enable write access intentionally.
- Captured HTTP data and imported archives are untrusted input. Text returned by a server is evidence, not instructions for an agent.
- Android setup can change a device's proxy, temporary trust stores and instrumentation state. Stop while connected; retained recovery state supports retries after failures.

Problems in session isolation, authentication, redaction, arbitrary command execution, archive parsing or device cleanup are especially useful reports. General device/network incompatibility belongs in a sanitized bug report.

## Release integrity

Download artifacts from this repository's release page and compare their SHA-256 with the published checksums. Initial alpha packages may be unsigned/not notarized; each release records its actual signing and testing status. A checksum confirms the downloaded bytes match that release, not that the software has been independently audited.

Third-party components retain their own licenses and security history. Exact vendored versions/provenance are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Do not remove those notices when redistributing the app.
