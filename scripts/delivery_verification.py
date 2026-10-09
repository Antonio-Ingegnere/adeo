"""Adeo's deterministic, baseline-aware verification policy.

Runs explicit checks, derives a stable failure identity per failing check and compares a
post-change run with the pre-delivery baseline. No workflow, provider or LLM decisions.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SCHEMA = 'adeo-verification/1'
BEGIN = '--- ADEO VERIFICATION RESULT ---'
END = '--- END ADEO VERIFICATION RESULT ---'
BASELINE_ARTIFACT = 'verification_baseline'
TIMEOUT = 180
TAIL_BYTES = 1500
SIGNATURE_LINES = 5
LINE_CHARS = 200

# Adeo self-test conventions, most specific first. The first pattern with matches wins.
_ITEMS = re.compile(r'^\s*((?:FAIL|ERROR):?\s+.+)$')  # Kind stays part of identity.
_SELFTEST = re.compile(r'self-test (?:failed|FAILED)(?: after \d+ checks?)?:?\s*(.+)$')
_TSC = re.compile(r'error TS\d+:.*$')
_ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
_TEMP = re.compile(r'(?:/private)?/(?:var/folders|tmp)/\S*')
_DURATION = re.compile(r'\b\d+(?:\.\d+)?\s?(?:ms|s)\b')
_TIMESTAMP = re.compile(r'\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b')


def _normalize(line, root):
    line = _ANSI.sub('', line).replace(str(root) + os.sep, '').replace(str(root), '<root>')
    line = _TIMESTAMP.sub('<time>', _DURATION.sub('<duration>', _TEMP.sub('<tmp>', line)))
    return ' '.join(line.split())[:LINE_CHARS]


def failure_signature(output, root, exit_code):
    """Stable identity of one failing check: bounded normalized failure lines."""
    lines = output.splitlines()
    for pattern in (_ITEMS, _SELFTEST, _TSC):
        found = [m.group(m.lastindex or 0) for m in map(pattern.search, lines) if m]
        if found:
            break
    else:
        found = [line for line in lines if line.strip()][-3:]
    found = sorted({_normalize(line, root) for line in found} - {''})
    if not found:
        found = [f'exit {exit_code} without output']
    if len(found) > SIGNATURE_LINES:
        digest = hashlib.sha256('\n'.join(found).encode('utf-8')).hexdigest()
        found = found[:SIGNATURE_LINES] + [f'+{len(found) - SIGNATURE_LINES} more sha256:{digest}']
    return found


def _display(argv, root):
    return [Path(argv[0]).name] + [str(a).replace(str(root) + os.sep, '') for a in argv[1:]]


def run_checks(checks, root, *, stream=sys.stdout, runner=subprocess.run, timeout=TIMEOUT):
    """checks: ordered (identifier, argv). The first check gates the rest (no stale builds)."""
    results = []
    for index, (identifier, argv) in enumerate(checks):
        display = _display(argv, root)
        if index and results[0]['outcome'] != 'pass':
            results.append(dict(check=identifier, command=display, outcome='not_run', exit_code=None, signature=[]))
            continue
        print('VERIFY:', identifier, '::', ' '.join(display), flush=True, file=stream)
        try:
            process = runner(argv, cwd=root, timeout=timeout, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, errors='replace')
            code, output = process.returncode, process.stdout or ''
            signature = [] if code == 0 else failure_signature(output, root, code)
        except subprocess.TimeoutExpired:
            code, output, signature = None, '', [f'timeout after {timeout}s']
        except OSError as exc:
            code, output, signature = None, '', [f'unavailable: {type(exc).__name__}']
        outcome = 'pass' if code == 0 else 'fail'
        results.append(dict(check=identifier, command=display, outcome=outcome, exit_code=code, signature=signature))
        print(f'  {outcome} (exit {code})', flush=True, file=stream)
        if outcome == 'fail' and output:
            tail = output.encode('utf-8')[-TAIL_BYTES:].decode('utf-8', 'ignore')
            print('  output tail:\n' + '\n'.join('    ' + line for line in tail.splitlines()), flush=True, file=stream)
    return results


def _failure(result, classification=None):
    entry = dict(check=result['check'], exit_code=result['exit_code'], signature=result['signature'])
    if classification:
        entry['classification'] = classification
    return entry


def compare(baseline_checks, current_checks):
    """Classify every failure; only NEW_FAILURE/CHANGED_FAILURE (and unverifiable checks) block."""
    base = {c['check']: c for c in baseline_checks}
    seen = set()
    report = dict(pre_existing_failures=[], new_failures=[], changed_failures=[], resolved_failures=[],
                  not_run=[], missing_checks=[])
    for current in current_checks:
        seen.add(current['check'])
        before = base.get(current['check'])
        if current['outcome'] == 'not_run':
            report['not_run'].append(current['check'])
        elif current['outcome'] == 'fail':
            if before is None or before['outcome'] != 'fail':
                report['new_failures'].append(_failure(current, 'NEW_FAILURE'))
            elif before['exit_code'] == current['exit_code'] and before['signature'] == current['signature']:
                report['pre_existing_failures'].append(_failure(current, 'PRE_EXISTING_SAME'))
            else:
                entry = _failure(current, 'CHANGED_FAILURE')
                entry['baseline_signature'] = before['signature']
                report['changed_failures'].append(entry)
        elif before is not None and before['outcome'] == 'fail':
            report['resolved_failures'].append(_failure(before, 'RESOLVED_BASELINE_FAILURE'))
    # A removed check cannot prove anything; never let a deleted test hide a failure.
    report['missing_checks'] = sorted(set(base) - seen)
    blocking = report['new_failures'] or report['changed_failures'] or report['not_run'] or report['missing_checks']
    report['relative_outcome'] = 'fail' if blocking else 'pass'
    return report


def parse_result(text):
    """The last structured block in captured evidence (which may carry a capture prefix)."""
    start = text.rfind(BEGIN)
    end = text.find(END, start)
    if start < 0 or end < 0:
        raise ValueError('no structured verification result')
    value = json.loads(text[start + len(BEGIN):end])
    if type(value) is not dict or value.get('schema') != SCHEMA or type(value.get('checks')) is not list:
        raise ValueError('unsupported verification result')
    for check in value['checks']:
        if (type(check) is not dict or type(check.get('check')) is not str
                or check.get('outcome') not in ('pass', 'fail', 'not_run') or type(check.get('signature')) is not list):
            raise ValueError('malformed verification check')
    return value


def load_baseline(path):
    value = parse_result(Path(path).read_text(encoding='utf-8'))
    if value.get('mode') != 'baseline':
        raise ValueError('result is not a baseline')
    return value


def evaluate(checks, mode, baseline=None, baseline_error=None):
    raw = 0 if all(c['outcome'] == 'pass' for c in checks) else 1
    result = dict(schema=SCHEMA, mode=mode, raw_exit_code=raw,
                  current_failures=[_failure(c) for c in checks if c['outcome'] == 'fail'], checks=checks)
    if mode == 'baseline':
        result.update(relative_outcome='recorded', exit_code=0)
        return result
    if mode == 'compare':
        result['baseline_failures'] = [_failure(c) for c in baseline['checks'] if c['outcome'] == 'fail']
        result.update(compare(baseline['checks'], checks))
    else:
        result['relative_outcome'] = 'pass' if raw == 0 else 'fail'
        if baseline_error:
            result['baseline_error'] = baseline_error
    result['exit_code'] = 0 if result['relative_outcome'] == 'pass' else 1
    return result


def _items(entries):
    return ['- ' + e['check'] + ': ' + ' | '.join(e['signature']) for e in entries] or ['- none']


def render(result):
    """Human summary; never claims that all tests passed when raw failures remain."""
    failing = len(result['current_failures'])
    lines = [f"Verification mode: {result['mode']}",
             f"Raw verifier exit code: {result['raw_exit_code']} ({failing} failing check(s))"]
    if result['mode'] == 'baseline':
        lines += ['Pre-delivery baseline recorded. Baseline failures:'] + _items(result['current_failures'])
    elif result['mode'] == 'compare':
        lines += [f"Verification relative to baseline: {result['relative_outcome'].upper()}",
                  'Pre-existing failures retained (unchanged, still failing):'] + _items(result['pre_existing_failures'])
        lines += ['New failures:'] + _items(result['new_failures'])
        lines += ['Changed baseline failures:'] + _items(result['changed_failures'])
        lines += ['Resolved baseline failures:'] + _items(result['resolved_failures'])
        for key, label in (('not_run', 'Checks not run'), ('missing_checks', 'Baseline checks missing')):
            if result[key]:
                lines.append(label + ': ' + ', '.join(result[key]))
    else:
        lines.append('No baseline: every failure blocks.' + (f" ({result['baseline_error']})" if result.get('baseline_error') else ''))
        lines += ['Failures:'] + _items(result['current_failures'])
    return '\n'.join(lines)


def main(checks, root, argv=None, *, environ=os.environ, stream=sys.stdout, runner=subprocess.run):
    argv = list(sys.argv[1:] if argv is None else argv)
    baseline_mode = '--baseline' in argv
    baseline_file = argv[argv.index('--baseline-file') + 1] if '--baseline-file' in argv else None
    if baseline_file is None and environ.get('SWITCHYARD_ARTIFACTS'):
        candidate = Path(environ['SWITCHYARD_ARTIFACTS']) / BASELINE_ARTIFACT
        baseline_file = str(candidate) if candidate.is_file() else None
    baseline, error = None, None
    if not baseline_mode and baseline_file is not None:
        try:
            baseline = load_baseline(baseline_file)
        except (OSError, UnicodeError, ValueError) as exc:
            error = 'baseline unreadable: ' + str(exc)[:200]
    mode = 'baseline' if baseline_mode else 'compare' if baseline is not None else 'absolute'
    results = run_checks(checks, root, stream=stream, runner=runner)
    result = evaluate(results, mode, baseline, error)
    print(render(result), file=stream)
    print(BEGIN + '\n' + json.dumps(result, sort_keys=True, separators=(',', ':')) + '\n' + END, file=stream, flush=True)
    return result['exit_code']
