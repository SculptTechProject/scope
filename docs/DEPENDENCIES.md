# Dependency checks

Recorded on 2026-11-02 against the committed `Cargo.lock` and `package-lock.json`.

- `npm audit`: zero reported vulnerabilities, including development dependencies.
- `cargo audit` 0.22.2: zero entries in its vulnerability list, with the informational findings below. A successful command does not mean there are no findings.
- Gitleaks 8.30.1: the initial committed history contained no detected secrets. Public release preparation is scanned again before upload. Detection is heuristic.

## Rust informational findings

| Package                  | Advisory                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glib` 0.18.5            | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) — unsound `VariantStrIter` | Pulled by Tauri's GTK/WebKit dependencies on Linux. The upstream fix is in glib 0.20; replacing it alone is incompatible with the GTK 0.18 dependency family. Linux is experimental and has no published tested installer in the first release. No claim is made that the affected function is unreachable on Linux. This dependency is absent from the macOS runtime graph. |
| `proc-macro-error` 1.0.4 | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) — unmaintained             | Transitive procedural macro dependency. Track upstream migration.                                                                                                                                                                                                                                                                                                            |
| `rustls-pemfile` 2.2.0   | [RUSTSEC-2025-0134](https://rustsec.org/advisories/RUSTSEC-2025-0134.html) — unmaintained             | Transitive dependency; upstream recommends the equivalent PEM APIs in rustls-pki-types. Track upstream migration.                                                                                                                                                                                                                                                            |

These records describe a point-in-time automated check, not a security audit. Re-run the tools when changing lockfiles and before releases.

## Redistributed license texts

`resources/licenses/index.html`, `rust.json` and `frontend.json` retain the collected license texts, package versions and source locations for Rust runtime dependencies and frontend packages/fonts. They are shipped inside the application resources. The Rust collection includes target-specific dependencies, so it may list packages that are not present in a particular binary.

To regenerate after `npm ci`:

```sh
cargo install cargo-about --locked --features cli --version 0.9.3
node scripts/licenses.mjs
```

`about.toml` configures license selection. Original copyright statements remain in the collected texts. The generated JSON intentionally excludes machine-local paths. Vendored hook scripts and optional externally installed Frida runtimes are documented separately in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
