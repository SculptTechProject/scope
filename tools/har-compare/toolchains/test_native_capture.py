"""Boundary tests for the artifact-only native capture coordinators.
These processes test cleanup/refusal only; real capture has a separate receipt.
"""
import json
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parent


spec = importlib.util.spec_from_file_location('scope_native_capture', SOURCE / 'native_capture.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeCaptureEventTests(unittest.TestCase):
    def producer(self, code):
        child = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE)
        def cleanup():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
            child.stdout.close()
        self.addCleanup(cleanup)
        return child

    def test_partial_event_deadline_does_not_wait_for_newline_or_eof(self):
        child = self.producer("import os,time;os.write(1,b'partial synthetic event');time.sleep(.7)")
        started = time.monotonic()
        error = None
        try:
            native.read_event(child, timeout=.1)
        except Exception as failure:
            error = failure
        self.assertLess(time.monotonic() - started, .5, 'Partial stdout must not defeat the event deadline')
        self.assertIsInstance(error, AssertionError)
        self.assertIn('timed out', str(error))
        self.assertNotIn('partial synthetic event', str(error))

    def test_two_events_from_one_write_are_preserved_for_later_read(self):
        child = self.producer("import os,time;os.write(1,b'{\"status\":\"one\"}\\n{\"status\":\"two\"}\\n');time.sleep(.7)")
        self.assertEqual(native.read_event(child, timeout=.2), {'status': 'one'})
        self.assertEqual(native.read_event(child, timeout=.2), {'status': 'two'})

    def test_oversized_event_is_rejected_without_echoing_content(self):
        child = self.producer("import os;os.write(1,b'{\"private\":\"SYNTHETIC_EVENT_VALUE' + b'x'*256 + b'\"}\\n')")
        error = None
        try:
            native.read_event(child, timeout=.2, max_bytes=64)
        except Exception as failure:
            error = failure
        self.assertIsInstance(error, AssertionError)
        self.assertIn('byte limit', str(error))
        self.assertNotIn('SYNTHETIC_EVENT_VALUE', str(error))

    def test_partial_event_eof_is_rejected_without_echo(self):
        child = self.producer("import os;os.write(1,b'{\"private\":\"SYNTHETIC_EVENT_VALUE\"}')")
        error = None
        try:
            native.read_event(child, timeout=.2)
        except Exception as failure:
            error = failure
        self.assertIsInstance(error, AssertionError)
        self.assertIn('complete event', str(error))
        self.assertNotIn('SYNTHETIC_EVENT_VALUE', str(error))


class NativeCaptureBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='scope-native-boundaries-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.tools = self.root / 'repo/tools/har-compare/toolchains'
        self.tools.mkdir(parents=True)
        for name in ('native_capture.py', 'native_capture.rs', 'build_native_capture.py', 'doctor.py'):
            shutil.copy2(SOURCE / name, self.tools / name)
        (self.root / 'repo/Cargo.lock').write_text('synthetic protected lock\n')
        (self.root / 'repo/tools/har-compare/cli.mjs').write_text('// not executed by boundary tests\n')
        self.output = self.root / 'runs'
        self.output.mkdir()

    def invoke(self, script, *args):
        return subprocess.run([sys.executable, '-B', str(self.tools / script), *map(str, args)],
                              capture_output=True, text=True, timeout=10)

    def test_missing_binary_is_rejected_before_creating_output(self):
        result = self.invoke('native_capture.py', '--binary', self.root / 'missing', '--node', sys.executable,
                             '--output-parent', self.output)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_failed_producer_is_terminated_and_private_archive_removed(self):
        fake = self.root / 'failed-producer'
        fake.write_text('#!' + sys.executable + '\n' + '''
from pathlib import Path
import json, os, sys, time
archive, exports = map(Path, sys.argv[1:])
archive.mkdir(); exports.mkdir()
(archive / 'scope-ca-key.pem').write_text('synthetic private fixture')
(archive / 'scope.db').write_text('synthetic database fixture')
(exports / 'credential-presence.json').write_text(json.dumps({'unexpected': 'NATIVE_TEST_SECRET' in os.environ}))
print('invalid event', flush=True)
time.sleep(60)
''')
        fake.chmod(0o755)
        environment = os.environ.copy()
        environment['NATIVE_TEST_SECRET'] = 'synthetic credential sentinel'
        result = subprocess.run([sys.executable, '-B', str(self.tools / 'native_capture.py'), '--binary', str(fake),
                                 '--node', sys.executable, '--output-parent', str(self.output)], env=environment,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(result.stdout)
        receipt = json.loads(Path(report['receipt']).read_text())
        self.assertFalse(receipt['ok'])
        self.assertTrue(receipt['privateArchiveRemoved'])
        self.assertEqual(receipt['retainedPrivateKeysOrDatabases'], [])
        self.assertTrue(receipt['rootLockUnchanged'])
        presence = Path(report['receipt']).parent / 'exports/credential-presence.json'
        self.assertEqual(json.loads(presence.read_text()), {'unexpected': False})

    def test_partial_event_timeout_terminates_producer_and_removes_archive(self):
        fake = self.root / 'partial-producer'
        fake.write_text('#!' + sys.executable + '\n' + '''
from pathlib import Path
import os,sys,time
archive,exports=map(Path,sys.argv[1:])
archive.mkdir();exports.mkdir()
(archive/'scope-ca-key.pem').write_text('synthetic private fixture')
(exports/'producer.pid').write_text(str(os.getpid()))
os.write(1,b'partial synthetic event')
time.sleep(.7)
''')
        fake.chmod(0o755)
        command = "import sys;sys.path.insert(0,sys.argv.pop(1));import native_capture;sys.exit(native_capture.main(event_timeout=.1))"
        started = time.monotonic()
        result = subprocess.run([sys.executable, '-B', '-c', command, str(self.tools), '--binary', str(fake), '--node', sys.executable, '--output-parent', str(self.output)], capture_output=True, text=True, timeout=5)
        self.assertLess(time.monotonic() - started, .5, 'Coordinator must clean up before producer finishes its wait')
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(result.stdout)
        path = Path(report['receipt'])
        receipt = json.loads(path.read_text())
        self.assertIn('timed out', receipt['error'])
        self.assertNotIn('partial synthetic event', result.stdout)
        self.assertTrue(receipt['privateArchiveRemoved'])
        self.assertEqual(receipt['retainedPrivateKeysOrDatabases'], [])
        pid = int((path.parent / 'exports/producer.pid').read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_builder_refuses_existing_directory_without_overwriting(self):
        marker = self.output / 'preserved.txt'
        marker.write_text('preserved synthetic artifact')
        result = self.invoke('build_native_capture.py', '--work-dir', self.output, '--artifact-prefix', self.root / 'missing', '--node', sys.executable)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(marker.read_text(), 'preserved synthetic artifact')
        self.assertEqual(list(self.output.iterdir()), [marker])

    def test_builder_refuses_checkout_directory_before_tool_probes(self):
        result = self.invoke('build_native_capture.py', '--work-dir', self.root / 'repo/new-artifact', '--artifact-prefix', self.root / 'missing', '--node', sys.executable)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / 'repo/new-artifact').exists())
        self.assertIn('outside the checkout', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
