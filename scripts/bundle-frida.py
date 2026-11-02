#!/usr/bin/env python3
"""Optionally bundle the Frida worker for the current desktop OS/architecture.

Run from a redistributable Python virtualenv with requirements-bundle-frida.txt
installed. This does not install dependencies or contact/alter any Android device.
The normal Rust/source build remains usable without these ignored binaries.
"""
import argparse
import json
import os
from importlib import metadata
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=root / "resources/bin")
    parser.add_argument("--server", type=Path, help="Matching official Android frida-server binary to include")
    parser.add_argument("--server-arch", choices=["arm64", "arm", "x86", "x86_64"], default="arm64")
    args = parser.parse_args()
    args.work_dir = args.work_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    extra_metadata = []
    try:
        metadata.distribution("typing_extensions")
        extra_metadata = ["--copy-metadata", "typing_extensions"]
    except metadata.PackageNotFoundError:
        pass  # Frida on newer Python versions uses the standard typing module.
    environment = os.environ.copy()
    environment["PYINSTALLER_CONFIG_DIR"] = str(args.work_dir / "cache")
    subprocess.run([
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--console",
        "--name", "scope-frida-worker", "--collect-all", "frida", "--copy-metadata", "frida",
        *extra_metadata, "--distpath", str(args.output_dir),
        "--workpath", str(args.work_dir / "build"), "--specpath", str(args.work_dir),
        str(root / "resources/device/frida_worker.py"),
    ], check=True, env=environment)
    worker = args.output_dir / ("scope-frida-worker.exe" if sys.platform == "win32" else "scope-frida-worker")
    check = subprocess.run([str(worker), "--version"], check=True, capture_output=True, text=True, timeout=30)
    version = json.loads(check.stdout.strip())["version"]
    print("Standalone worker: %s (%s bytes), Frida %s" % (worker, worker.stat().st_size, version))
    if args.server:
        destination = args.output_dir / ("frida-server-%s-android-%s" % (version, args.server_arch))
        shutil.copy2(args.server, destination)
        destination.chmod(0o755)
        print("Android server: %s (%s bytes)" % (destination, destination.stat().st_size))


if __name__ == "__main__":
    main()
