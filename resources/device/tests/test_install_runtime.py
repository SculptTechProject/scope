import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / "install-runtime.py"
SPEC = importlib.util.spec_from_file_location("scope_runtime_setup", SOURCE)
SETUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SETUP)


class RuntimeSetupTests(unittest.TestCase):
    def test_corrupt_upstream_download_never_becomes_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(SETUP.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt release")):
                with self.assertRaisesRegex(RuntimeError, "integrity check failed"):
                    SETUP.download_server("arm64", Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_explicit_data_directory_matches_scope_device_subdirectory(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"SCOPE_DATA_DIR": directory}, clear=True):
                self.assertEqual(SETUP.default_runtime(), Path(directory).resolve() / "device")

    def test_windows_managed_python_uses_scripts_executable(self):
        with mock.patch.object(SETUP.sys, "platform", "win32"):
            self.assertEqual(SETUP.python_path(Path("runtime")), Path("runtime/Scripts/python.exe"))


if __name__ == "__main__":
    unittest.main()
