#!/usr/bin/env python3
"""Scope's isolated Frida worker. Stdout is JSON Lines; stdin EOF requests cleanup.

The worker controls exactly one selected application. Hook source stays JavaScript.
Python/Frida is deliberately outside the desktop process so an ART crash cannot
take the session archive or UI with it. No HTTP Toolkit installation is used.
"""
import argparse
import json
from pathlib import Path
import re
import signal
import sys
import threading

PROFILES = {
    "proxy": ["android/android-proxy-override.js"],
    "certificate": ["android/android-system-certificate-injection.js"],
    "unpinning": ["android/android-certificate-unpinning.js", "android/android-certificate-unpinning-fallback.js"],
    "root": ["android/android-disable-root-detection.js"],
}


def emit(kind, **fields):
    # Keep Frida diagnostics local and avoid logging tokens inside query strings.
    if "message" in fields:
        fields["message"] = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[query omitted]", str(fields["message"]))[:4000]
    print(json.dumps({"kind": kind, **fields}), flush=True)


def build_script(root, ca, port, profiles):
    cert = ca.read_text().strip()
    if not re.fullmatch(r"-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----", cert):
        raise ValueError("Scope CA must be a public PEM certificate")
    unknown = set(profiles) - set(PROFILES)
    if unknown:
        raise ValueError("Unknown hook profile: " + ", ".join(sorted(unknown)))
    config = (root / "config-template.js").read_text()
    config, count = re.subn(r"const CERT_PEM = `.*?`;", lambda _: "const CERT_PEM = `" + cert + "`;", config, count=1, flags=re.S)
    if count != 1:
        raise ValueError("Unexpected Frida configuration template")
    config, count = re.subn(r"const PROXY_PORT = \d+;", "const PROXY_PORT = %d;" % port, config, count=1)
    if count != 1:
        raise ValueError("Missing proxy port configuration")
    scripts = [(root / "frida-java-bridge.js").read_text(), config]
    for profile in profiles:
        for name in PROFILES[profile]:
            scripts.append((root / name).read_text())
    scripts.append("Java.perform(() => send({kind: 'scope-hooks-ready'}));\n")
    return "\n".join(scripts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial")
    parser.add_argument("--version", action="store_true", help="Report bundled Frida version without contacting a device")
    parser.add_argument("--package")
    parser.add_argument("--address")
    parser.add_argument("--ca", type=Path)
    parser.add_argument("--scripts", type=Path)
    parser.add_argument("--port", type=int, default=17890)
    parser.add_argument("--profile", action="append", default=[])
    parser.add_argument("--list-apps", action="store_true")
    args = parser.parse_args()
    try:
        import frida
    except ImportError as error:
        raise RuntimeError("Frida Python is missing. Create a virtualenv, install resources/device/requirements-frida.txt and set SCOPE_PYTHON to its Python executable.") from error
    if args.version:
        emit("version", version=frida.__version__)
        return
    if not args.serial:
        parser.error("--serial is required for device operations")
    manager = frida.get_device_manager()
    device = manager.add_remote_device(args.address) if args.address else manager.get_device(args.serial, timeout=5)
    if args.list_apps:
        emit("apps", apps=[{"package": app.identifier, "name": app.name, "running": bool(app.pid)} for app in device.enumerate_applications()])
        return
    if not args.package or not args.ca or not args.scripts or not 1 <= args.port <= 65535:
        raise ValueError("Package, public CA, scripts and a valid port are required")
    source = build_script(args.scripts, args.ca, args.port, args.profile or ["proxy", "certificate", "unpinning"])
    stopped = threading.Event()
    ready = threading.Event()
    failure = []
    session = None
    script = None
    pid = None
    resumed = False

    def receive(message, _data):
        payload = message.get("payload")
        if message.get("type") == "send" and isinstance(payload, dict) and payload.get("kind") == "scope-hooks-ready":
            ready.set()
            return
        if message.get("type") == "error":
            failure.append(message.get("stack") or message.get("description") or "Hook error")
        emit("log", message=message.get("stack") or payload or message.get("description") or message)

    def detached(reason, crash=None):
        emit("detached", message=reason, crash=bool(crash))
        stopped.set()

    def wait_for_stop():
        for line in sys.stdin:
            if line.strip() == "stop":
                break
        stopped.set()

    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    threading.Thread(target=wait_for_stop, daemon=True).start()
    emit("log", message="Experimental Java hooks: Android 16 ART/GC crashes were observed upstream. Native TLS/QUIC stacks are not covered.")
    try:
        pid = device.spawn([args.package])
        session = device.attach(pid)
        session.on("detached", detached)
        script = session.create_script(source)
        script.on("message", receive)
        script.load()
        device.resume(pid)
        resumed = True
        if not ready.wait(30):
            raise RuntimeError("Java hooks did not become ready within 30 seconds. " + "; ".join(failure[-2:]))
        if failure:
            raise RuntimeError("A hook failed during startup: " + "; ".join(failure[-2:]))
        emit("ready", pid=pid, version=frida.__version__, profiles=args.profile or ["proxy", "certificate", "unpinning"])
        stopped.wait()
    finally:
        if script:
            try:
                script.unload()
            except Exception:
                pass
        if session:
            try:
                session.detach()
            except Exception:
                pass
        if pid and not resumed:
            try:
                device.kill(pid)
            except Exception:
                pass
        emit("stopped", message="Frida hooks detached; the selected application was left running")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
