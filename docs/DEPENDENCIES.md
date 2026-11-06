# Dependency checks

Current backport checks recorded on **2026-11-06** against the committed lockfiles.
`cargo audit` 0.22.2 checked 543 dependencies against 1,422 advisories at RustSec
database commit `309392b18f6b17022f82c701f300433126901068`.
It returned exit 0 with zero vulnerability-list entries and the three unmaintained
warnings below, without ignores or target filters. A successful command does not
mean there are no findings.

- `npm audit`: zero reported vulnerabilities, including development dependencies.
- GLib's path dependency is **excluded from cargo-audit's registry advisory matching**
  (rustsec 0.33.0 filters packages without a default-registry source). Its absence
  from the report is not a validation of this backport. The real version stays
  0.18.5; source integrity, locked-selection checks and optimized red/green
  regressions provide the backport evidence. Other version-based scanners may
  still report RUSTSEC-2024-0429. The same tool/database against the original
  registry lockfile does report GLib's unsoundness, alongside the same three
  unmaintained warnings.
- Historical baseline (2026-11-02): Gitleaks 8.30.1 found no detected secrets in the initial committed history. No fresh Gitleaks run is claimed for this backport.

## Tracked Rust findings

| Package                  | Advisory                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glib` 0.18.5            | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) — unsound `VariantStrIter` | The Linux GTK/WebKit graph now selects a local 0.18.5 backport containing only upstream b5a4071 (PR 1343). Original archive, notices, exact patch and full-tree integrity checks are retained; see [provenance](../vendor/glib-provenance/README.md). Optimized Linux iterator regression has actual pristine SIGSEGV / patched PASS evidence. The real version remains 0.18.5; version-based scanners may still report this advisory. Interactive GTK/dialog and installer/device acceptance remains unverified; keep #11 open. This runtime dependency is absent from the macOS graph. |
| `pin-utils` 0.1.1 | [RUSTSEC-2026-0441](https://rustsec.org/advisories/RUSTSEC-2026-0441.html) — unmaintained | Newly reported transitive dependency warning. Upstream is archived; track removal/migration by its consumers. No unrelated graph upgrade is included in this backport. |
| `proc-macro-error` 1.0.4 | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) — unmaintained             | Transitive procedural macro dependency. Track upstream migration.                                                                                                                                                                                                                                                                                                                                                                               |
| `rustls-pemfile` 2.2.0   | [RUSTSEC-2025-0134](https://rustsec.org/advisories/RUSTSEC-2025-0134.html) — unmaintained             | Transitive dependency; upstream recommends the equivalent PEM APIs in rustls-pki-types. Track upstream migration.                                                                                                                                                                                                                                                                                                                               |

These records describe a point-in-time automated check, not a security audit. Re-run the tools when changing lockfiles and before releases.

## Redistributed license texts

`resources/licenses/index.html`, `rust.json` and `frontend.json` retain the collected license texts, package versions and source locations for Rust runtime dependencies and frontend packages/fonts. They are shipped inside the application resources. The Rust collection includes target-specific dependencies, so it may list packages that are not present in a particular binary.

To regenerate after `npm ci`:

```sh
cargo install cargo-about --locked --features cli --version 0.9.3
node scripts/licenses.mjs
```

`about.toml` configures license selection. Original copyright statements remain in the collected texts. The generated JSON intentionally excludes machine-local paths. Vendored hook scripts and optional externally installed Frida runtimes are documented separately in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
