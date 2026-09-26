#!/usr/bin/env python3
"""Keep standalone design outside active or inconsistent delivery lifecycles."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', choices=['product-designer'], required=True)
    parser.parse_args()
    root = Path(os.environ['CLAUDE_PROJECT_DIR']).resolve()
    try:
        current = root / '.switchyard/current.json'
        if current.exists():
            spec = importlib.util.spec_from_file_location('delivery', Path(__file__).with_name('delivery.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            config = module.configuration(root)
            result = subprocess.run([config['python_executable'], str(root / '.claude/scripts/delivery.py'), 'status'],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode or json.loads(result.stdout)['status'] != 'closed':
                raise ValueError('active or inconsistent Switchyard lifecycle')
        legacy = root / '.claude/delivery/current.json'
        if legacy.exists():
            state = json.loads(legacy.read_text())
            if state.get('state') not in ('DONE', 'FAILED') or state.get('worker_claim') or state.get('verifier_claim'):
                raise ValueError('active or inconsistent legacy lifecycle')
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.TimeoutExpired):
        print('Standalone design blocked by active/inconsistent delivery state', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
