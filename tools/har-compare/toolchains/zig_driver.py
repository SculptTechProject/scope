"""Adapt cc-rs' Rust target spelling for the optional local Linux Zig toolchain."""
import os
from pathlib import Path
import sys


def main(mode):
    zig = os.environ.get('SCOPE_TOOLCHAIN_ZIG')
    if not zig or not Path(zig).is_absolute() or not Path(zig).is_file():
        raise SystemExit('Set SCOPE_TOOLCHAIN_ZIG to the existing absolute Zig executable.')
    arguments = []
    source = iter(sys.argv[1:])
    for argument in source:
        if mode != 'ar' and argument.startswith('--target='):
            if argument != '--target=x86_64-unknown-linux-gnu':
                raise SystemExit('Unsupported compiler target in local wrapper.')
        elif mode != 'ar' and argument in ('--target', '-target'):
            if next(source, None) != 'x86_64-unknown-linux-gnu':
                raise SystemExit('Unsupported compiler target in local wrapper.')
        else:
            arguments.append(argument)
    command = [zig, mode]
    if mode != 'ar':
        command.extend(['-target', 'x86_64-linux-gnu.2.35'])
    os.execv(zig, [*command, *arguments])
