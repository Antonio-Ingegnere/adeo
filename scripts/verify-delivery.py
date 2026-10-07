#!/usr/bin/env python3
"""Adeo's deterministic verification, no lifecycle mutations or provider calls."""
import importlib.util
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('delivery_config', ROOT / '.claude/scripts/delivery.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    config = module.configuration(ROOT)
    npm, node, python = (config[k + '_executable'] for k in ('npm', 'node', 'python'))
    checks = [[npm, 'run', 'build'],
              [python, str(ROOT / '.claude/scripts/delivery-selftest.py')],
              [python, str(ROOT / '.claude/scripts/delivery-legacy-selftest.py')],
              [python, str(ROOT / '.claude/scripts/product-designer-selftest.py')]]
    checks += [[node, str(path)] for path in sorted((ROOT / 'scripts').glob('*-selftest.mjs'))]
    checks += [[npm, 'run', 'storybook:build']]
    failed = []
    for command in checks:
        print('VERIFY:', ' '.join(command), flush=True)
        try:
            result = subprocess.run(command, cwd=ROOT, timeout=180)
            if result.returncode: failed.append(command)
        except (OSError, subprocess.TimeoutExpired):
            failed.append(command)
        if failed and command == checks[0]:
            break  # Never exercise stale build output.
    print(f'Failed checks: {len(failed)}', flush=True)
    for command in failed: print('FAILED:', ' '.join(command), flush=True)
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
