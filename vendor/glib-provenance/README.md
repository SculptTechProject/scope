# GLib 0.18.5 compatibility backport

Scope vendors the **real GLib 0.18.5 crate**, under its original MIT license,
with only the fix from gtk-rs/gtk-rs-core
[`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34)
([PR 1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)). This addresses
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
without mixing incompatible GLib/GTK Rust release families in Tauri's Linux graph.
It is a source backport, not a claim that upstream released a patched 0.18.5.

## Inputs and exact change

- `glib-0.18.5.crate` is the pristine [crates.io archive](https://static.crates.io/crates/glib/glib-0.18.5.crate).
  SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
  This equals the registry checksum in Scope's
  [original lockfile](https://github.com/dalkedev/scope/blob/98ba0ef71c0ccf50ccb9773cfa02807b6d374348/Cargo.lock#L1444-L1448).
- `variant-str-iter.patch` is the unchanged upstream commit patch, downloaded
  from the commit's `.patch` URL. SHA-256:
  `a742bf59f1b00af0f434623b34e2fd969dc8697d37c796efdf909dd9eb19b854`.
- `integrity.json` records the input hashes, original VCS commit from the crate's
  `.cargo_vcs_info.json`, upstream fix commit and pre/post-patch source hashes.
- All 121 files from the crate archive remain in `../glib`, including `LICENSE`,
  `COPYRIGHT`, manifests, tests and provenance. Only `src/variant_iter.rs` changes:
  `let p` becomes `let mut p`, and the C variadic out-argument `&p` becomes `&mut p`.
  No version, feature, manifest or other source changes are made inside the crate.

## Reproduce and verify

From the repository root, with Python 3.11+, Git and the pinned Rust toolchain:

```sh
python3 scripts/verify-glib-backport.py
python3 scripts/verify-glib-backport.py --check-selection
python3 -m unittest discover -s scripts/tests
cargo test --locked --release -p scope-glib-variant-regression
```

The first command works offline, including from a source archive without `.git`.
It checks the pristine archive and exact patch hashes, replays `git apply -p2` in
an isolated temporary directory with per-command `core.autocrlf=false` and
`core.eol=lf`, checks both source hashes, and compares **every
vendored file byte and the complete file set** with the result. Extra, missing,
changed files and symlinks fail verification. To reconstruct manually, extract
the verified archive into a temporary directory outside any Git checkout, enter
`glib-0.18.5`, and run
`git -c core.autocrlf=false -c core.eol=lf apply -p2 /path/to/variant-str-iter.patch`.
These command-local settings preserve exact archive bytes even if inherited global
Git settings request CRLF conversion; they never rewrite the user's configuration.
The Python regression suite injects such a temporary global config and runs in the
normal Linux, macOS and Windows CI matrix. No checksums or source comparisons are
relaxed or normalized.

The second command additionally runs `cargo metadata --locked` and requires one
local GLib 0.18.5 package at `vendor/glib/Cargo.toml`, used by the resolved graph
and excluded from workspace membership. It may download locked dependency
metadata/sources if they are not cached. `[patch.crates-io]` applies to every
consumer of this GLib version, including GTK/WebKit. `Cargo.lock` intentionally
has no registry source/checksum for the selected local crate; the original
registry checksum remains independently verified here. No global Cargo cache
replacement or audit-ignore is used.

Normal CI and release build validation run the verifier and its tamper tests;
Linux also runs the regression crate with optimizations. Vendored files are
excluded from workspace membership and byte-preserving Git attributes protect
all inputs and upstream notices on Windows. The Git source archive includes
both `vendor/glib` and this complete provenance directory. Do not omit them when
redistributing source or modifying the backport. Scope's AGPL license does not
replace GLib's MIT terms. Generated runtime notices retain gtk-rs attribution
and link both the upstream crate and Scope's backport provenance.

## Optimized regression evidence and limits

On Linux x86-64, Rust 1.99.1 and real GLib/GObject/GIO 2.88 shared libraries, the
pristine 0.18.5 release build crashed with `SIGSEGV` in each of seven independent
content-reading cases: `next`, `last`, `nth`, `next_back`, `nth_back`, mixed-direction
iteration and UTF-8. Empty-array/exhaustion-only cases passed. With the exact
backport, the same nine tests passed using the locked workspace dependency.
These are actual observed results, not an assumed reproduction from the advisory.

The tests require only GLib development/runtime libraries, not a display server.
They do not prove interactive GTK/dialog behavior, Linux installer acceptance,
Android/device compatibility or correctness on every architecture. Existing
upstream GLib compiler warnings remain unchanged. Keep issue #11 open until its
remaining interactive acceptance criteria have been exercised.

## Removal condition

Remove this backport only when Scope's complete compatible Tauri/GTK/WebKit
family resolves a maintained upstream GLib containing this fix (the advisory
currently identifies upstream GLib >=0.20.0 as patched). Update the lockfile and
notices together, verify the entire target graph, and repeat optimized iterator
and Linux GTK/dialog acceptance tests. Remove/adapt the test-only regression
crate, patch, vendor/provenance and verifier/CI hooks in that same reviewed change.
Do not replace only one member of the 0.18 dependency family or falsify the version
to silence audit tooling.
