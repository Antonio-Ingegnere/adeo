#!/usr/bin/env python3
"""Adeo lifecycle pointers around the accepted Switchyard delivery presets."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict
import fcntl
import json
import os
from pathlib import Path
import sys
from uuid import uuid4


class DeliveryError(ValueError):
    pass


def configuration(root):
    try:
        config = json.loads((root / '.switchyard/config.json').read_text())
        keys = {'switchyard_root', 'python_executable', 'codex_executable',
                'git_executable', 'node_executable', 'npm_executable'}
        if set(config) != keys or any(type(v) is not str or not Path(v).is_absolute() for v in config.values()):
            raise ValueError()
        if not (Path(config['switchyard_root']) / 'examples/delivery/analytics.py').is_file():
            raise ValueError()
        for key in keys - {'switchyard_root'}:
            if not Path(config[key]).is_file():
                raise ValueError()
        return config
    except (OSError, ValueError, TypeError) as exc:
        raise DeliveryError('Configure absolute paths in .switchyard/config.json; see docs/agent/switchyard-delivery.md') from exc


def load_switchyard(config):
    sys.path.insert(0, config['switchyard_root'])
    # Import the existing public APIs, without copying any runtime or recorder logic.
    global run, WorkUnit, RunContext, JsonlRecorder, read_events, summarize_runs
    global build_change, build_accept, AcceptanceApproval, GitAcceptance
    from runtime import run, WorkUnit, RunContext
    from runtime.recording import JsonlRecorder
    from switchyard.observability import read_events, summarize_runs
    from examples.delivery.presets import build_change, build_accept
    from examples.delivery.acceptance import AcceptanceApproval, GitAcceptance


class Delivery:
    def __init__(self, root, config):
        self.root = Path(root).resolve()
        self.config = config
        self.directory = self.root / '.switchyard'
        self.pointer = self.directory / 'current.json'

    @contextmanager
    def locked(self):
        self.directory.mkdir(exist_ok=True)
        with (self.directory / 'command.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise DeliveryError('Another delivery command is running') from exc
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def save(self, state):
        temporary = self.pointer.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, indent=2) + '\n')
        temporary.replace(self.pointer)

    def current(self):
        if not self.pointer.exists():
            raise DeliveryError('No active Switchyard lifecycle; start /deliver')
        try:
            state = json.loads(self.pointer.read_text())
            expected = {'correlation_id', 'latest_run_id', 'latest_terminal', 'status', 'events_file'}
            if set(state) != expected or type(state['correlation_id']) is not str:
                raise ValueError()
            correlation = state['correlation_id']
            if len(correlation) != 39 or not correlation.startswith('change-') or any(c not in '0123456789abcdef' for c in correlation[7:]):
                raise ValueError()
            if state['events_file'] != f'.switchyard/runs/{correlation}.jsonl':
                raise ValueError()
            if state['status'] == 'running':
                raise DeliveryError('Interrupted/running lifecycle; inspect canonical history before manual recovery')
            events = tuple(read_events(self.root / state['events_file']))
            summaries = summarize_runs(events)
            if not summaries or any(s.correlation_id != correlation for s in summaries):
                raise ValueError()
            last = summaries[-1]
            if (last.run_id != state['latest_run_id'] or last.terminal_state != state['latest_terminal']
                    or not last.completed_normally or any(not s.completed_normally for s in summaries)
                    or state['status'] != ('closed' if last.terminal_state == 'ACCEPTED' else 'active')):
                raise ValueError()
            return state
        except DeliveryError:
            raise
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise DeliveryError('Inconsistent lifecycle pointer/event history; no recovery facts were invented') from exc

    def legacy_check(self):
        legacy = self.root / '.claude/delivery/current.json'
        if legacy.exists():
            try:
                closed = json.loads(legacy.read_text()).get('state') in ('DONE', 'FAILED')
            except (OSError, ValueError, AttributeError):
                closed = False
            if not closed:
                raise DeliveryError('Active legacy delivery exists; explicitly archive it after review before /deliver')

    def execute(self, command, task='', approval=None):
        with self.locked():
            if command == 'deliver':
                if self.pointer.exists() and self.current()['status'] != 'closed':
                    raise DeliveryError('A lifecycle is already active; /deliver cannot overwrite it')
                self.legacy_check()
                correlation = 'change-' + uuid4().hex
                state = dict(correlation_id=correlation, latest_run_id=None,
                             latest_terminal=None, status='active',
                             events_file=f'.switchyard/runs/{correlation}.jsonl')
                parent = None
            else:
                state = self.current()
                if state['status'] == 'closed':
                    raise DeliveryError('Lifecycle is closed; start a new /deliver')
                if state['latest_terminal'] != 'READY_FOR_MANUAL_QA':
                    raise DeliveryError('Command requires the latest run to be READY_FOR_MANUAL_QA')
                parent = state['latest_run_id']
            if command == 'accept':
                if approval is None:
                    raise DeliveryError('Explicit human QA and exact staged patch/HEAD approval required')
                loaded = build_accept(workspace=str(self.root), git_executable=self.config['git_executable'], approval=approval)
                task = 'Accept the explicitly reviewed change after human manual QA'
            else:
                if not task.strip():
                    raise DeliveryError('A nonempty task or bug report is required')
                loaded = build_change(command, workspace=str(self.root),
                                      codex_executable=self.config['codex_executable'],
                                      verifier_executable=self.config['python_executable'],
                                      verifier_argv=(str(self.root / 'scripts/verify-delivery.py'),),
                                      agent_timeout=1800, verifier_timeout=1200)
            events_file = self.root / state['events_file']
            events_file.parent.mkdir(exist_ok=True)
            state['status'] = 'running'
            self.save(state)
            # On any exception leave the running marker. Never guess which events persisted.
            result = run(WorkUnit(task), loaded.flow, loaded.executors,
                         recorder=JsonlRecorder(events_file),
                         context=RunContext(state['correlation_id'], parent))
            state.update(latest_run_id=result.events[0].run_id,
                         latest_terminal=result.terminal_state,
                         status='closed' if result.terminal_state == 'ACCEPTED' else 'active')
            self.save(state)
            return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('deliver', 'repair'):
        sub.add_parser(name).add_argument('--task', required=True)
    accept = sub.add_parser('accept')
    accept.add_argument('--approved-head', required=True)
    accept.add_argument('--approved-patch-sha256', required=True)
    accept.add_argument('--message', required=True)
    accept.add_argument('--manual-qa-passed', action='store_true', required=True)
    sub.add_parser('inspect')
    sub.add_parser('status')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[2]
    try:
        config = configuration(root)
        if Path(sys.executable).resolve() != Path(config['python_executable']).resolve():
            os.execv(config['python_executable'], [config['python_executable'], str(Path(__file__).resolve()), *sys.argv[1:]])
        load_switchyard(config)
        delivery = Delivery(root, config)
        if args.command == 'status':
            with delivery.locked():
                print(json.dumps(delivery.current()))
            return 0
        if args.command == 'inspect':
            with delivery.locked():
                state = delivery.current()
                if state['status'] != 'active' or state['latest_terminal'] != 'READY_FOR_MANUAL_QA':
                    raise DeliveryError('Scope inspection requires the latest QA-ready run')
                print(json.dumps(asdict(GitAcceptance(str(root), config['git_executable']).inspect())))
            return 0
        approval = (AcceptanceApproval(args.approved_head, args.approved_patch_sha256,
                                       args.message, args.manual_qa_passed)
                    if args.command == 'accept' else None)
        state = delivery.execute(args.command, getattr(args, 'task', ''), approval)
        print(state['latest_terminal'])
        print('Correlation: ' + state['correlation_id'])
        print('Run: ' + state['latest_run_id'])
        print('Events: ' + state['events_file'])
        return 0 if state['latest_terminal'] in ('READY_FOR_MANUAL_QA', 'ACCEPTED') else 1
    except (DeliveryError, ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception:
        # Public output excludes executor payloads. Pointer remains running for inspection.
        print('Execution failed; inspect lifecycle event history before recovery', file=sys.stderr)
        return 3


if __name__ == '__main__':
    raise SystemExit(main())
