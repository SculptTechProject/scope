#!/usr/bin/env python3
"""Build the synthetic native producer in a NEW artifact directory, offline.
No application archive is opened. Only the supplied artifact toolchains are used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import doctor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', required=True, type=Path, help='New directory outside this checkout, with an existing parent.')
    parser.add_argument('--artifact-prefix', required=True)
    parser.add_argument('--node', required=True)
    args = parser.parse_args()
    directory = args.work_dir.resolve()
    root = doctor.ROOT.resolve()
    if directory.exists() or not directory.parent.is_dir() or directory == root or root in directory.parents:
        parser.error('--work-dir must be NEW, outside the checkout, with an existing parent.')
    probe = doctor.inspect(argparse.Namespace(node=args.node, artifact_prefix=args.artifact_prefix, verify=False))
    if not probe['ok']:
        print(json.dumps(probe, indent=2))
        return 2
    directory.mkdir(mode=0o700)
    source = Path(__file__).with_name('native_capture.rs')
    shutil.copy2(source, directory / 'native_capture.rs')
    manifest = '''[package]
name = "scope-synthetic-native-capture"
version = "0.0.0"
edition = "2021"
publish = false

[workspace]

[[bin]]
name = "native_capture"
path = "native_capture.rs"

[dependencies]
scope-core = { path = SCOPE_CORE_PATH }
anyhow = "=1.0.104"
axum = "=0.8.9"
serde_json = "=1.0.154"
tokio = { version = "=1.54.1", features = ["full"] }
reqwest = { version = "=0.12.28", default-features = false, features = ["rustls-tls", "json"] }

[profile.dev]
debug = 1
'''.replace('SCOPE_CORE_PATH', json.dumps(str(root / 'crates/scope-core')))
    (directory / 'Cargo.toml').write_text(manifest)
    shutil.copy2(root / 'Cargo.lock', directory / 'Cargo.lock')
    environment = doctor.child_environment()
    environment.update(probe['rust']['childOverrides'])
    prefix = Path(args.artifact_prefix).resolve()
    cargo = prefix / f"rust-{probe['rust']['channel']}-x86_64-unknown-linux-gnu/bin/cargo"
    environment['PATH'] = str(cargo.parent) + os.pathsep + environment.get('PATH', '')
    # Separate target avoids collisions with the repository's ordinary build.
    environment['CARGO_TARGET_DIR'] = str(directory / 'target')
    receipt = {'schemaVersion': 1, 'ok': False, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
               'rootLockBefore': doctor.lock_hash(), 'checks': [],
               'lockPreparation': 'A copy of root Cargo.lock is resolved offline for this standalone package. Only the artifact copy may change.'}
    try:
        for name, command in [
            ('prepare-artifact-lock', [str(cargo), 'metadata', '--manifest-path', str(directory / 'Cargo.toml'), '--format-version', '1', '--filter-platform', 'x86_64-unknown-linux-gnu', '--offline']),
            ('locked-offline-build', [str(cargo), 'build', '--manifest-path', str(directory / 'Cargo.toml'), '--bin', 'native_capture', '--locked', '--offline']),
        ]:
            result = doctor.run(command, environment, 1200)
            log = directory / f'{name}.log'
            log.write_text(result.pop('output'))
            result.update({'name': name, 'log': str(log)})
            receipt['checks'].append(result)
            if result['exitCode']:
                break
        binary = directory / 'target/debug/native_capture'
        receipt['binary'] = str(binary)
        receipt['ok'] = len(receipt['checks']) == 2 and all(check['exitCode'] == 0 for check in receipt['checks']) and binary.is_file()
        if receipt['ok']:
            receipt['binarySha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        receipt['artifactLockSha256'] = hashlib.sha256((directory / 'Cargo.lock').read_bytes()).hexdigest()
    finally:
        receipt['rootLockAfter'] = doctor.lock_hash()
        receipt['rootLockUnchanged'] = receipt['rootLockAfter'] == receipt['rootLockBefore']
        receipt['ok'] = receipt['ok'] and receipt['rootLockUnchanged']
        (directory / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    return 0 if receipt['ok'] else 2


if __name__ == '__main__':
    sys.exit(main())
