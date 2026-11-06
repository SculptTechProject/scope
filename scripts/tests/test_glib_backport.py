"""Exercise the offline verifier against real pristine and modified artifacts."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


class BackportIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / 'vendor', self.root / 'vendor')
        shutil.copy(ROOT / 'Cargo.toml', self.root)
        shutil.copy(ROOT / 'Cargo.lock', self.root)

    def verify(self, env=None):
        return subprocess.run(
            [sys.executable, str(ROOT / 'scripts/verify-glib-backport.py'), '--root', str(self.root)],
            capture_output=True, text=True, env=env,
        )

    def test_verified_backport_passes(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('verified', result.stdout)

    def test_inherited_global_crlf_conversion_cannot_change_replayed_bytes(self):
        # Temporary replay has no repository attributes. A user's global Git
        # settings must neither change verified bytes nor be rewritten by us.
        config = self.root / 'hostile.gitconfig'
        original = b'[core]\n\tautocrlf = true\n\teol = crlf\n'
        config.write_bytes(original)
        env = {**os.environ, 'GIT_CONFIG_GLOBAL': str(config), 'GIT_CONFIG_NOSYSTEM': '1'}
        inherited = subprocess.run(
            ['git', 'config', '--global', '--get', 'core.autocrlf'],
            env=env, capture_output=True, text=True, check=True,
        )
        self.assertEqual(inherited.stdout.strip(), 'true')
        result = self.verify(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('verified', result.stdout)
        self.assertEqual(config.read_bytes(), original)

    def test_pristine_unsound_source_is_rejected(self):
        source = self.root / 'vendor/glib/src/variant_iter.rs'
        source.write_bytes(source.read_bytes().replace(b'let mut p:', b'let p:').replace(b'&mut p,', b'&p,'))
        self.assertNotEqual(self.verify().returncode, 0)

    def test_changed_unrelated_source_is_rejected(self):
        with (self.root / 'vendor/glib/src/lib.rs').open('ab') as source:
            source.write(b'\n// unexpected change\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_deleted_license_is_rejected(self):
        (self.root / 'vendor/glib/LICENSE').unlink()
        self.assertNotEqual(self.verify().returncode, 0)

    def test_added_source_is_rejected(self):
        (self.root / 'vendor/glib/src/extra.rs').write_text('// unexpected\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_changed_archive_is_rejected(self):
        with (self.root / 'vendor/glib-provenance/glib-0.18.5.crate').open('ab') as archive:
            archive.write(b'changed')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_changed_patch_is_rejected(self):
        with (self.root / 'vendor/glib-provenance/variant-str-iter.patch').open('ab') as patch:
            patch.write(b'changed')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_symlink_is_rejected(self):
        source = self.root / 'vendor/glib/src/variant_iter.rs'
        target = self.root / 'source.rs'
        source.rename(target)
        try:
            source.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest('symlink creation unavailable')
        self.assertNotEqual(self.verify().returncode, 0)


class CargoSelection(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('glib_verifier', ROOT / 'scripts/verify-glib-backport.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.package = {
            'name': 'glib', 'version': '0.18.5', 'source': None,
            'id': 'path+file:///test/vendor/glib#0.18.5',
            'manifest_path': str(ROOT / 'vendor/glib/Cargo.toml'),
        }
        self.metadata = {
            'packages': [self.package], 'workspace_members': [],
            'resolve': {'nodes': [{'dependencies': [self.package['id']]}]},
        }

    @unittest.skipUnless(shutil.which('cargo'), 'Cargo is required for metadata encoding regression')
    def test_metadata_is_decoded_as_utf8_even_under_a_windows_legacy_codepage(self):
        # Keep the real Cargo process/locked graph, changing only the parent's
        # default text encoding to reproduce Windows CP1252 on every CI host.
        with mock.patch('locale.getencoding', return_value='cp1252'):
            with mock.patch.object(sys, 'argv', ['verify-glib-backport.py', '--check-selection']):
                self.module.main()

    def test_used_local_backport_is_accepted(self):
        self.module.verify_selection(ROOT, self.metadata)

    def test_registry_package_is_rejected(self):
        self.package['source'] = 'registry+https://github.com/rust-lang/crates.io-index'
        with self.assertRaisesRegex(ValueError, 'local GLib'):
            self.module.verify_selection(ROOT, self.metadata)

    def test_other_local_source_is_rejected(self):
        self.package['manifest_path'] = str(ROOT / 'other/glib/Cargo.toml')
        with self.assertRaisesRegex(ValueError, 'different local'):
            self.module.verify_selection(ROOT, self.metadata)

    def test_unused_patch_is_rejected(self):
        self.metadata['resolve']['nodes'][0]['dependencies'] = []
        with self.assertRaisesRegex(ValueError, 'must be used'):
            self.module.verify_selection(ROOT, self.metadata)

    def test_fake_version_is_rejected(self):
        self.package['version'] = '0.20.0'
        with self.assertRaisesRegex(ValueError, 'local GLib'):
            self.module.verify_selection(ROOT, self.metadata)

    def test_extra_glib_version_is_rejected(self):
        self.metadata['packages'].append(dict(self.package, version='0.20.0'))
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.module.verify_selection(ROOT, self.metadata)

    def test_vendor_workspace_membership_is_rejected(self):
        self.metadata['workspace_members'].append(self.package['id'])
        with self.assertRaisesRegex(ValueError, 'workspace member'):
            self.module.verify_selection(ROOT, self.metadata)


if __name__ == '__main__':
    unittest.main()
