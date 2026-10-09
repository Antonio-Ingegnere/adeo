#!/usr/bin/env python3
"""Adeo's deterministic verification, no lifecycle mutations or provider calls.

--baseline records the pre-delivery state. Otherwise failures are compared with the
baseline Switchyard provides in SWITCHYARD_ARTIFACTS; without one every failure blocks.
"""
import importlib.util
from pathlib import Path
import sys

from delivery_verification import main as verify

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('delivery_config', ROOT / '.claude/scripts/delivery.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def checks():
    config = module.configuration(ROOT)
    npm, node, python = (config[k + '_executable'] for k in ('npm', 'node', 'python'))
    result = [('build', [npm, 'run', 'build'])]  # Gates the rest: never exercise stale build output.
    result += [(name, [python, str(ROOT / '.claude/scripts' / (name + '.py'))])
               for name in ('delivery-selftest', 'recovery-selftest', 'verification-selftest',
                            'delivery-legacy-selftest', 'product-designer-selftest')]
    result += [(path.stem, [node, str(path)]) for path in sorted((ROOT / 'scripts').glob('*-selftest.mjs'))]
    result += [('storybook-build', [npm, 'run', 'storybook:build'])]
    return result


if __name__ == '__main__':
    raise SystemExit(verify(checks(), ROOT, sys.argv[1:]))
