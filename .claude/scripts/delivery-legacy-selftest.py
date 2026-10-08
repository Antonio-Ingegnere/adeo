#!/usr/bin/env python3
"""Offline project integration: real presets, runtime, recorder, analytics and Git."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('delivery', Path(__file__).with_name('delivery_legacy.py'))
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
PROJECT = Path(__file__).resolve().parents[2]
config_spec=importlib.util.spec_from_file_location('launch_config',Path(__file__).with_name('delivery.py'))
launch=importlib.util.module_from_spec(config_spec);config_spec.loader.exec_module(launch)
launch_config=launch.configuration(PROJECT)
SWITCHYARD=launch_config['switchyard_root']
interpreter=launch_config['python_executable']
if Path(sys.executable).absolute()!=Path(interpreter).absolute():
    os.execv(interpreter,[interpreter,str(Path(__file__).resolve()),*sys.argv[1:]])
delivery.load_switchyard({'switchyard_root': SWITCHYARD})
from runtime import ExecutorResult, InvocationResponse
from flow_config import LoadedFlow
from examples.delivery.analytics import summarize_delivery_analytics, summarize_delivery_lifecycles
from examples.delivery.acceptance import AcceptanceApproval, GitAcceptance


class Integration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.git_path = shutil.which('git')
        self.git('init', '-q')
        self.git('config', 'user.name', 'Offline Test')
        self.git('config', 'user.email', 'offline@example.invalid')
        (self.root / '.gitignore').write_text('.switchyard/\n.claude/delivery/current.json\n')
        (self.root / 'change.txt').write_text('before\n')
        self.git('add', '.gitignore', 'change.txt')
        self.git('commit', '-qm', 'baseline')
        self.app = delivery.Delivery(self.root, {'git_executable': self.git_path,
            'codex_executable': sys.executable, 'python_executable': sys.executable})
        self.requests = []
        self.verify_outcomes = ['success']
        original = delivery.build_change
        outer = self
        class Fake:
            def __init__(self, role): self.role = role
            def run(self, request):
                outer.requests.append((self.role, request))
                if self.role == 'verifier':
                    outcome = outer.verify_outcomes.pop(0)
                else:
                    outcome = 'success'
                return InvocationResponse(ExecutorResult(outcome))
        def build(kind, **kwargs):
            loaded = original(kind, **kwargs)
            return LoadedFlow(loaded.flow, {key: Fake(key) for key in loaded.executors})
        self.mock = patch.object(delivery, 'build_change', side_effect=build)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def git(self, *args):
        return subprocess.check_output([self.git_path, '-C', str(self.root), *args], stderr=subprocess.PIPE).decode().strip()

    def deliver(self, outcomes=None):
        self.verify_outcomes = outcomes or ['success']
        return self.app.execute('deliver', 'change requested')

    def approval(self):
        (self.root / 'change.txt').write_text('approved change\n')
        self.git('add', 'change.txt')
        snapshot = GitAcceptance(str(self.root), self.git_path).inspect()
        return AcceptanceApproval(snapshot.head, snapshot.patch_sha256, 'Approved change', True)

    def analytics(self):
        state = self.app.current()
        events = tuple(delivery.read_events(self.root / state['events_file']))
        return summarize_delivery_analytics(events), events

    def test_deliver_accept(self):
        first = self.deliver()
        accepted = self.app.execute('accept', approval=self.approval())
        self.assertEqual(accepted['latest_terminal'], 'ACCEPTED')
        self.assertEqual(first['correlation_id'], accepted['correlation_id'])
        analytics, events = self.analytics()
        summaries = delivery.summarize_runs(events)
        self.assertEqual(summaries[1].parent_run_id, summaries[0].run_id)
        self.assertEqual(analytics.accepted_lifecycle_count, 1)
        self.assertEqual(analytics.manual_qa_pass_count, 1)
        self.assertEqual(len(summarize_delivery_lifecycles(events)), 1)
        self.assertEqual(self.git('log', '-1', '--format=%s'), 'Approved change')

    def test_repair_is_fresh_new_run(self):
        self.deliver()
        self.verify_outcomes = ['success']
        self.app.execute('repair', 'observed bug')
        self.app.execute('accept', approval=self.approval())
        analytics, events = self.analytics()
        summaries = delivery.summarize_runs(events)
        self.assertEqual(len({s.correlation_id for s in summaries}), 1)
        self.assertEqual(summaries[1].parent_run_id, summaries[0].run_id)
        self.assertEqual(summaries[2].parent_run_id, summaries[1].run_id)
        self.assertIn('FRESH_DIAGNOSIS', summaries[1].state_visit_counts)
        self.assertEqual([r.work_unit.task for k, r in self.requests if k == 'analysis'], ['change requested', 'observed bug'])
        self.assertEqual(analytics.manual_qa_reopen_count, 1)
        self.assertEqual(analytics.accepted_lifecycle_count, 1)

    def test_automatic_repair_not_manual(self):
        self.deliver(['failed', 'success'])
        self.app.execute('accept', approval=self.approval())
        analytics, _ = self.analytics()
        self.assertEqual(analytics.automatic_repair_count, 1)
        self.assertEqual(analytics.manual_qa_reopen_count, 0)
        self.assertEqual(sum(k == 'repair' for k, _ in self.requests), 1)

    def test_second_failure_stops(self):
        state = self.deliver(['failed', 'failed'])
        self.assertEqual(state['latest_terminal'], 'NEEDS_REDIAGNOSIS')
        self.assertEqual(sum(k == 'repair' for k, _ in self.requests), 1)
        self.assertEqual(len(delivery.summarize_runs(self.analytics()[1])), 1)
        with self.assertRaises(delivery.DeliveryError):
            self.app.execute('repair', 'another attempt')
        with self.assertRaises(delivery.DeliveryError):
            self.app.execute('accept', approval=self.approval())

    def test_no_lifecycle(self):
        for command in ('repair', 'accept'):
            with self.subTest(command=command), self.assertRaises(delivery.DeliveryError):
                self.app.execute(command, 'bug')

    def test_second_deliver_preserves_pointer(self):
        state = self.deliver()
        with self.assertRaises(delivery.DeliveryError): self.deliver()
        self.assertEqual(self.app.current(), state)

    def test_closed_lifecycle_rejects_followup(self):
        self.deliver()
        self.app.execute('accept', approval=self.approval())
        with self.assertRaises(delivery.DeliveryError): self.app.execute('accept')
        with self.assertRaises(delivery.DeliveryError): self.app.execute('repair', 'bug')
        self.verify_outcomes = ['success']
        self.assertEqual(self.app.execute('deliver', 'next')['status'], 'active')

    def test_mixed_worktree_blocks_commit(self):
        self.deliver()
        approval = self.approval()
        before = self.git('rev-parse', 'HEAD')
        (self.root / 'unrelated.txt').write_text('unapproved\n')
        self.assertEqual(self.app.execute('accept', approval=approval)['latest_terminal'], 'COMMIT_BLOCKED')
        self.assertEqual(self.git('rev-parse', 'HEAD'), before)

    def test_stale_patch_blocks_commit(self):
        self.deliver()
        approval = self.approval()
        (self.root / 'change.txt').write_text('mixed content\n')
        self.git('add', 'change.txt')
        self.assertEqual(self.app.execute('accept', approval=approval)['latest_terminal'], 'COMMIT_BLOCKED')
        self.assertEqual(self.git('rev-parse', 'HEAD'), approval.base_commit)

    def test_stale_head_blocks_commit(self):
        self.deliver()
        approval = self.approval()
        self.git('commit', '--allow-empty', '-qm', 'outside commit')
        (self.root / 'change.txt').write_text('new content\n')
        self.git('add', 'change.txt')
        head = self.git('rev-parse', 'HEAD')
        self.assertEqual(self.app.execute('accept', approval=approval)['latest_terminal'], 'COMMIT_BLOCKED')
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)

    def test_approval_never_invented(self):
        self.deliver()
        with self.assertRaises(delivery.DeliveryError): self.app.execute('accept')
        self.assertEqual(len(delivery.summarize_runs(self.analytics()[1])), 1)

    def test_missing_log(self):
        state = self.deliver()
        (self.root / state['events_file']).unlink()
        with self.assertRaises(delivery.DeliveryError): self.app.execute('repair', 'bug')

    def test_pointer_mismatch(self):
        state = self.deliver()
        state['latest_run_id'] = 'fake'
        self.app.save(state)
        with self.assertRaises(delivery.DeliveryError): self.app.execute('repair', 'bug')

    def test_interruption_blocks_followup(self):
        with patch.object(delivery, 'run', side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError): self.deliver()
        with self.assertRaises(delivery.DeliveryError): self.app.execute('repair', 'bug')
        self.assertEqual(json.loads(self.app.pointer.read_text())['status'], 'running')

    def test_legacy_state_retained(self):
        legacy = self.root / '.claude/delivery/current.json'
        legacy.parent.mkdir(parents=True)
        legacy.write_text('{"state":"REPAIRING"}')
        with self.assertRaises(delivery.DeliveryError): self.deliver()
        self.assertEqual(legacy.read_text(), '{"state":"REPAIRING"}')

    def test_recorder_failure_stays_interrupted(self):
        class BrokenRecorder:
            def __init__(self, path): pass
            def record(self, event): raise OSError('disk failure')
        with patch.object(delivery, 'JsonlRecorder', BrokenRecorder):
            with self.assertRaises(Exception): self.deliver()
        with self.assertRaises(delivery.DeliveryError): self.app.current()
        self.assertEqual(json.loads(self.app.pointer.read_text())['status'], 'running')

    def test_truncated_history_blocks_followup(self):
        state = self.deliver()
        with (self.root / state['events_file']).open('ab') as stream:
            stream.write(b'{"kind":')
        with self.assertRaises(delivery.DeliveryError): self.app.execute('repair', 'bug')

    def cli(self, *args):
        script = self.root / '.claude/scripts/delivery.py'
        script.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(__file__).with_name('delivery_legacy.py'), script)
        config = dict(switchyard_root=SWITCHYARD, python_executable=sys.executable,
                      codex_executable=sys.executable, git_executable=self.git_path,
                      node_executable=shutil.which('node'), npm_executable=shutil.which('npm'))
        self.app.directory.mkdir(exist_ok=True)
        (self.app.directory / 'config.json').write_text(json.dumps(config))
        # The disposable fixture's wrapper is tooling, not part of the accepted change.
        exclude = self.root / '.git/info/exclude'
        exclude.write_text('.claude/scripts/\n')
        return subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True)

    def test_cli_accept_and_status(self):
        self.deliver()
        approval = self.approval()
        result = self.cli('accept', '--approved-head', approval.base_commit,
                          '--approved-patch-sha256', approval.patch_sha256,
                          '--message', approval.message, '--manual-qa-passed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ACCEPTED', result.stdout)
        status = self.cli('status')
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)['status'], 'closed')
        self.assertEqual(self.cli('repair', '--task', 'bug').returncode, 2)

    def test_cli_missing_approval_and_no_lifecycle(self):
        self.assertEqual(self.cli('accept').returncode, 2)
        self.assertEqual(self.cli('repair', '--task', 'bug').returncode, 2)
        self.assertFalse(self.app.pointer.exists())

    def test_concurrent_command(self):
        with self.app.locked():
            with self.assertRaises(delivery.DeliveryError): self.deliver()


if __name__ == '__main__':
    unittest.main()
