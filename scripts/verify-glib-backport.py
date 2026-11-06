#!/usr/bin/env python3
"""Verify the GLib backport offline; optionally verify Cargo's locked selection."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tempfile
import tomllib

ARCHIVE_SHA256 = '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5'
PATCH_SHA256 = 'a742bf59f1b00af0f434623b34e2fd969dc8697d37c796efdf909dd9eb19b854'
PACKAGE = 'glib-0.18.5'
CHANGED_FILE = 'src/variant_iter.rs'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify_tree(root):
    provenance = root / 'vendor/glib-provenance'
    archive = provenance / f'{PACKAGE}.crate'
    patch = provenance / 'variant-str-iter.patch'
    manifest = json.loads((provenance / 'integrity.json').read_text())
    require(sha256(archive.read_bytes()) == ARCHIVE_SHA256 == manifest['archiveSha256'],
            'Original crates.io archive checksum mismatch')
    require(sha256(patch.read_bytes()) == PATCH_SHA256 == manifest['patchSha256'],
            'Reviewed upstream patch checksum mismatch')
    expected = {}
    with tarfile.open(archive, 'r:gz') as crate:
        for member in crate:
            path = PurePosixPath(member.name)
            require(member.isfile() and path.parts[0] == PACKAGE and '..' not in path.parts,
                    f'Unexpected archive member: {member.name}')
            name = str(path.relative_to(PACKAGE))
            require(name not in expected, f'Duplicate archive member: {name}')
            expected[name] = crate.extractfile(member).read()
    require(sha256(expected[CHANGED_FILE]) == manifest['originalSourceSha256'],
            'Original VariantStrIter source checksum mismatch')
    # Apply the recorded upstream patch, rather than trusting hashes of vendor alone.
    with tempfile.TemporaryDirectory(prefix='glib-backport-') as temp:
        work = Path(temp)
        source = work / CHANGED_FILE
        source.parent.mkdir(parents=True)
        source.write_bytes(expected[CHANGED_FILE])
        subprocess.run(['git', 'apply', '-p2', str(patch.resolve())], cwd=work,
                       check=True, capture_output=True)
        expected[CHANGED_FILE] = source.read_bytes()
    require(sha256(expected[CHANGED_FILE]) == manifest['patchedSourceSha256'],
            'Patched VariantStrIter source checksum mismatch')
    vendor = root / 'vendor/glib'
    require(not vendor.is_symlink(), 'Vendored directory must not be a symlink')
    actual = {}
    for path in vendor.rglob('*'):
        require(not path.is_symlink(), f'Vendored symlink: {path.relative_to(vendor)}')
        if path.is_dir():
            continue
        require(path.is_file(), f'Unexpected vendored entry: {path.relative_to(vendor)}')
        actual[path.relative_to(vendor).as_posix()] = path.read_bytes()
    require(actual.keys() == expected.keys(),
            f'Vendored file set differs: missing={sorted(expected.keys() - actual.keys())}, '
            f'extra={sorted(actual.keys() - expected.keys())}')
    for name, content in expected.items():
        require(actual[name] == content, f'Vendored content differs: {name}')
    config = tomllib.loads((root / 'Cargo.toml').read_text())
    require(config['patch']['crates-io']['glib'] == {'path': 'vendor/glib'},
            'Workspace must patch crates.io GLib to vendor/glib')
    require('vendor/glib' in config['workspace']['exclude'],
            'Vendored GLib must be excluded from workspace membership')
    locked = [p for p in tomllib.loads((root / 'Cargo.lock').read_text())['package']
              if p['name'] == 'glib']
    require(len(locked) == 1 and locked[0]['version'] == '0.18.5'
            and 'source' not in locked[0] and 'checksum' not in locked[0],
            'Cargo.lock must select one local GLib 0.18.5, without a registry source/checksum')
    return len(expected)


def verify_selection(root, metadata):
    glib = [p for p in metadata['packages'] if p['name'] == 'glib']
    require(len(glib) == 1, 'Cargo must resolve exactly one GLib package')
    package = glib[0]
    require(package['version'] == '0.18.5' and package['source'] is None,
            'Cargo must select the local GLib 0.18.5 backport')
    require(Path(package['manifest_path']).resolve() == (root / 'vendor/glib/Cargo.toml').resolve(),
            'Cargo selected a different local GLib source')
    require(package['id'] not in metadata['workspace_members'],
            'Vendored GLib must not be a workspace member')
    require(any(package['id'] in node['dependencies'] for node in metadata['resolve']['nodes']),
            'The GLib patch must be used by the dependency graph')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--check-selection', action='store_true',
                        help='Also run cargo metadata --locked and verify the resolved GLib path')
    args = parser.parse_args()
    root = args.root.resolve()
    count = verify_tree(root)
    if args.check_selection:
        result = subprocess.run(['cargo', 'metadata', '--locked', '--format-version', '1'],
                                cwd=root, check=True, capture_output=True, text=True)
        verify_selection(root, json.loads(result.stdout))
    print(f'GLib 0.18.5 backport verified: {count} files, original archive + exact upstream patch'
          + (', locked Cargo selection' if args.check_selection else ''))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        raise SystemExit(f'GLib backport verification failed: {error}')
