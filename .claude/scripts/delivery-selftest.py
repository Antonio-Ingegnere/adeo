#!/usr/bin/env python3
"""Adeo V2 boundary: fake provider CLIs, actual runtime/verifier/workspaces/Git."""
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

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('adeo_delivery',Path(__file__).with_name('delivery.py'))
delivery=importlib.util.module_from_spec(spec);spec.loader.exec_module(delivery)
CONFIG=delivery.configuration(ROOT)
if Path(sys.executable).absolute()!=Path(CONFIG['python_executable']).absolute():
    os.execv(CONFIG['python_executable'],[CONFIG['python_executable'],str(Path(__file__).resolve()),*sys.argv[1:]])
delivery.load_switchyard(CONFIG)
from switchyard.work_contract import WorkWorkspace
from examples.delivery.offline_lifecycle import FIX as FEATURE_FIX

class Integration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='adeo-v2-');self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name).resolve();self.data=self.base/'persistent-data'
        self.root=self.base/'client-a/app'
        self.environment=patch.dict(os.environ,{'PYTHONDONTWRITEBYTECODE':'1'});self.environment.start();self.addCleanup(self.environment.stop)
        self.config=dict(CONFIG)
        self.calls=self.base/'calls.jsonl';self.plan=self.base/'plan.json'
        # Existing offline CLI fixture speaks the real adapter protocols.
        script=(ROOT/'.claude/test-fixtures/switchyard/provider_cli.py').read_text()
        script=script.replace("outcome=plan.get", "if state in ('IMPLEMENT','FIX'):\n    change=plan['change']\n    Path(change['path']).write_text(change['content'])\noutcome=plan.get")
        bins=self.base/'bin';bins.mkdir()
        for provider in ('claude','codex'):
            path=bins/provider;path.write_text('#!'+sys.executable+'\n'+script);path.chmod(0o755)
            self.config[provider+'_executable']=str(path)
        self.config['python_executable']=sys.executable
        self.env=patch.dict(os.environ,{'FAKE_LOG':str(self.calls),'FAKE_PLAN':str(self.plan)})
        self.env.start();self.addCleanup(self.env.stop)
        self.make_repo(self.root,'feature')

    def git(self,*args,root=None):
        return subprocess.check_output([self.config['git_executable'],'-C',str(root or self.root),*args],stderr=subprocess.STDOUT).decode().strip()

    def make_repo(self,root,kind):
        shutil.copytree(ROOT/'.claude/test-fixtures/switchyard'/('feature_dogfood_project' if kind=='feature' else 'bugfix_dogfood_project'),root,
                        ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        (root/'scripts/lib').mkdir(parents=True)
        shutil.copyfile(ROOT/'scripts/lib/isolated-electron.mjs',root/'scripts/lib/isolated-electron.mjs')
        (root/'scripts/verify-delivery.py').write_text('import subprocess,sys\nraise SystemExit(subprocess.call([sys.executable,"-m","unittest","discover","-s","tests"]))\n')
        (root/'.gitignore').write_text('.switchyard/*\n!.switchyard/config.yaml\n__pycache__/\n*.pyc\n')
        (root/'.switchyard').mkdir()
        shutil.copyfile(ROOT/'.switchyard/config.yaml',root/'.switchyard/config.yaml')
        self.git('init','-b','main',root=root);self.git('config','user.name','Offline Adeo',root=root)
        self.git('config','user.email','test@example.invalid',root=root);self.git('config','commit.gpgsign','false',root=root)
        paths=['.gitignore','.switchyard/config.yaml','scripts/verify-delivery.py','scripts/lib/isolated-electron.mjs',
               'catalog.py' if kind=='feature' else 'task_queue.py',
               'tests/test_catalog.py' if kind=='feature' else 'tests/test_task_queue.py']
        self.git('add','--',*paths,root=root);self.git('commit','-m','baseline',root=root)

    def app(self,root=None):return delivery.Delivery(root or self.root,self.config,data_root=self.data)

    def start(self,kind='feature',root=None):
        # Contract-aware output avoids manually manufacturing provider artifacts in Adeo.
        spec=json.dumps(dict(id='OFFLINE',goal='Requested behavior',scope=['source'],constraints=[],
                             acceptance=['Independent tests pass'],verification=['unittest'],non_goals=[]))
        outputs={name:[{'name':artifact,'content':spec if artifact in ('microspec','bug_spec','fix_microspec') else 'Durable facts'}]
                 for name,artifact in [('SPECIFY','microspec'),('IMPLEMENT','implementation_handoff'),('TRIAGE','bug_spec'),
                 ('REPRODUCE','reproduction_evidence'),('DIAGNOSE','diagnosis'),('SPECIFY_FIX','fix_microspec'),('FIX','implementation_handoff')]}
        # Use exact known fixture fix for bugfix (no contract/source changes by harness during run).
        fix=FEATURE_FIX if kind=='feature' else (ROOT/'.claude/test-fixtures/switchyard/bugfix_dogfood_project/task_queue.py').read_text().replace('self._pending = []','self._pending = []\n        self._sequence = 0').replace('(priority, len(self._pending), task))','(priority, self._sequence, task))\n        self._sequence += 1')
        self.plan.write_text(json.dumps({'artifacts':outputs,'change':{'path':'catalog.py' if kind=='feature' else 'task_queue.py','content':fix}}))
        with patch('examples.delivery.presets.build_change',side_effect=AssertionError('legacy repair/delivery forbidden')), \
             patch('examples.delivery.presets.build_accept',side_effect=AssertionError('legacy accept forbidden')):
            return self.app(root).execute('deliver','Human request',kind=kind)

    def qa(self,op,state,feedback='',root=None):
        before=self.calls.read_bytes()
        with patch('switchyard.provider_stages.ProviderStageExecutorResolver.__call__',side_effect=AssertionError('no QA resolver')), \
             patch('switchyard.provider_stages.execute',side_effect=AssertionError('no QA provider')):
            value=self.app(root).execute(op,feedback,candidate_identity=state['candidate_identity'])
        self.assertEqual(self.calls.read_bytes(),before)
        return value

    def assert_ready(self,state,base,path,root=None):
        root=root or self.root
        self.assertEqual(state['terminal'],'READY_FOR_MANUAL_QA')
        self.assertEqual(self.git('rev-parse','HEAD',root=root),base)
        self.assertFalse(Path(state['qa_workspace']).resolve().is_relative_to(root))
        self.assertTrue(Path(state['qa_workspace']).is_relative_to(self.data))
        pointer=json.loads((root/'.switchyard/current.json').read_text())
        self.assertEqual(set(pointer),{'engine','work_id','repo_id','flow','phase','candidate_identity','terminal','config_sha256'})
        qa=WorkWorkspace.open(state['qa_workspace']);self.assertEqual(qa.latest_artifact('qa_candidate').sha256,pointer['candidate_identity'])
        self.assertEqual(list(json.loads(qa.read_artifact('qa_candidate'))['files']),[path])
        self.assertIn('OK',WorkWorkspace.open(state['workspace']).read_artifact('verifier_evidence'))

    def test_feature_restart_accept_exact_scope(self):
        base=self.git('rev-parse','HEAD');state=self.start();self.assert_ready(state,base,'catalog.py')
        restored=self.app().current();self.assertEqual(restored['candidate_identity'],state['candidate_identity'])
        result=self.qa('accept',restored)
        self.assertEqual(result['terminal'],'ACCEPTED')
        self.assertEqual(self.git('rev-parse','HEAD^'),base)
        self.assertEqual(self.git('diff-tree','--no-commit-id','--name-only','-r','HEAD'),'catalog.py')
        self.assertEqual(self.git('status','--porcelain'),'')
        self.assertEqual(self.git('show','HEAD:catalog.py'),FEATURE_FIX.strip())

    def test_bugfix_accept(self):
        root=self.base/'bugs/app';self.make_repo(root,'bugfix');base=self.git('rev-parse','HEAD',root=root)
        state=self.start('bugfix',root);self.assert_ready(state,base,'task_queue.py',root)
        calls=[json.loads(s)['binding']['logical_state'] for s in self.calls.read_text().splitlines()]
        self.assertEqual(calls,['TRIAGE','REPRODUCE','DIAGNOSE','SPECIFY_FIX','FIX'])
        self.assertEqual(self.qa('accept',state,root=root)['terminal'],'ACCEPTED')
        self.assertEqual(self.git('diff-tree','--no-commit-id','--name-only','-r','HEAD',root=root),'task_queue.py')

    def test_reopen_restart_feedback_and_fresh_followup(self):
        base=self.git('rev-parse','HEAD');state=self.start()
        result=self.qa('reopen',state,'Review naming')
        self.assertEqual(result['terminal'],'REOPENED');self.assertEqual(self.app().current()['feedback'],'Review naming')
        self.assertEqual(self.git('rev-parse','HEAD'),base)
        self.assertEqual(self.git('diff','--name-only'),'catalog.py')
        self.assertEqual(self.git('diff','--cached','--name-only'),'')
        next_state=self.start()
        self.assertNotEqual(next_state['qa_workspace'],state['qa_workspace'])
        self.assertTrue(Path(state['qa_workspace']).exists())

    def test_extra_work_blocks_without_cleanup(self):
        base=self.git('rev-parse','HEAD');state=self.start();(self.root/'unrelated.txt').write_text('keep')
        result=self.qa('accept',state)
        self.assertEqual((result['terminal'],result['reason']),('COMMIT_BLOCKED','unexpected_worktree_paths'))
        self.assertEqual(self.git('rev-parse','HEAD'),base);self.assertEqual((self.root/'unrelated.txt').read_text(),'keep')
        self.assertIn('catalog.py',self.git('diff','--name-only'))

    def test_candidate_drift_reason(self):
        state=self.start();(self.root/'catalog.py').write_text('changed after QA')
        self.assertEqual(self.qa('accept',state)['reason'],'candidate_drift')

    def test_two_same_leaf_repositories_and_swapped_pointer(self):
        other=self.base/'client-b/app';self.make_repo(other,'feature')
        one=self.start();two=self.start(root=other)
        self.assertNotEqual(one['candidate_identity'],two['candidate_identity']);self.assertNotEqual(one['qa_workspace'],two['qa_workspace'])
        with self.assertRaisesRegex(delivery.DeliveryError,'does not match'):
            self.app().execute('accept',candidate_identity=two['candidate_identity'])
        pointer=(self.root/'.switchyard/current.json');original=pointer.read_bytes()
        pointer.write_bytes((other/'.switchyard/current.json').read_bytes())
        with self.assertRaisesRegex(delivery.DeliveryError,'Inconsistent'):self.app().current()
        pointer.write_bytes(original)
        self.qa('accept',one);self.assertEqual(self.app(other).current()['terminal'],'READY_FOR_MANUAL_QA')

    def test_missing_external_never_recreates(self):
        state=self.start();path=Path(state['qa_workspace']);path.rename(path.with_name('retained-missing'))
        with self.assertRaisesRegex(delivery.DeliveryError,'QA lifecycle state is unavailable'):self.app().current()
        self.assertFalse(path.exists())

    def test_finalized_authority_over_stale_pointer(self):
        state=self.start();pointer=self.root/'.switchyard/current.json';before=pointer.read_bytes()
        self.qa('accept',state);pointer.write_bytes(before)
        self.assertEqual(self.app().current()['terminal'],'ACCEPTED')
        with self.assertRaisesRegex(delivery.DeliveryError,'not pending'):self.qa('accept',state)

    def test_production_data_resolver_and_internal_rejection(self):
        resolved=delivery.application_data(ROOT,CONFIG)
        self.assertTrue(resolved.is_absolute());self.assertFalse(resolved.is_relative_to(ROOT))
        with self.assertRaisesRegex(delivery.DeliveryError,'outside'):
            delivery.Delivery(self.root,self.config,data_root=self.root/'.switchyard/qa')

    def test_retired_repair_never_executes(self):
        with self.assertRaisesRegex(delivery.DeliveryError,'retired'):self.app().execute('repair','bug')
        self.assertFalse(self.calls.exists())

    def test_qa_fix_alias_uses_reopen_only(self):
        state=self.start()
        result=self.qa('qa-fix',state,'Human feedback')
        self.assertEqual(result['terminal'],'REOPENED')
        self.assertEqual(result['feedback'],'Human feedback')

    def test_legacy_current_readable_and_no_cross_engine_accept(self):
        old=delivery.legacy_module();old.load_switchyard(self.config)
        from runtime import Flow,State,WorkUnit,RunContext,run
        from runtime.recording import JsonlRecorder
        correlation='change-'+'a'*32
        path=self.root/'.switchyard/runs'/f'{correlation}.jsonl';path.parent.mkdir(parents=True)
        result=run(WorkUnit('legacy'),Flow('READY_FOR_MANUAL_QA',{'READY_FOR_MANUAL_QA':State(terminal=True)}),{},
                   recorder=JsonlRecorder(path),context=RunContext(correlation))
        state=dict(correlation_id=correlation,latest_run_id=result.events[0].run_id,latest_terminal='READY_FOR_MANUAL_QA',
                   status='active',events_file=f'.switchyard/runs/{correlation}.jsonl')
        self.app().save(state);before=path.read_bytes()
        self.assertEqual(self.app().current()['engine'],'legacy')
        with self.assertRaisesRegex(delivery.DeliveryError,'read-only'):self.app().execute('accept',candidate_identity='x')
        self.assertEqual(path.read_bytes(),before)
        with self.assertRaisesRegex(delivery.DeliveryError,'active'):self.start()

    def test_process_restart_pending_candidate_accept(self):
        state=self.start();before=self.calls.read_bytes()
        code = """import importlib.util,json,sys
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('delivery',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
c=json.loads(sys.argv[2]);m.load_switchyard(c);app=m.Delivery(sys.argv[3],c,data_root=sys.argv[4])
with patch('switchyard.provider_stages.execute',side_effect=AssertionError('no provider in QA')):
    pending=app.current()
    assert pending['terminal']=='READY_FOR_MANUAL_QA'
    result=app.execute('accept',candidate_identity=pending['candidate_identity'])
    print(json.dumps(result))
"""
        child=subprocess.run([sys.executable,'-c',code,str(Path(__file__).with_name('delivery.py')),
                              json.dumps(self.config),str(self.root),str(self.data)],capture_output=True,text=True)
        self.assertEqual(child.returncode,0,child.stderr)
        self.assertEqual(json.loads(child.stdout)['terminal'],'ACCEPTED')
        self.assertEqual(self.calls.read_bytes(),before)
        self.assertEqual(self.app().current()['terminal'],'ACCEPTED')

    def test_missing_delivery_and_corrupt_candidate_fail_closed(self):
        state=self.start();manifest=Path(state['workspace'])/'manifest.jsonl'
        original=manifest.read_bytes();manifest.unlink()
        with self.assertRaisesRegex(delivery.DeliveryError,'delivery state is unavailable'):self.app().current()
        manifest.write_bytes(original)
        qa=WorkWorkspace.open(state['qa_workspace']);record=qa.latest_artifact('qa_candidate')
        (qa.root/record.path).write_text('{}')
        with self.assertRaisesRegex(delivery.DeliveryError,'Inconsistent'):self.app().current()
        self.assertNotEqual(self.git('status','--porcelain'),'')

    def edit_config(self, change):
        from flow_config import _yaml_data
        path=self.root/'.switchyard/config.yaml'
        data=_yaml_data(path.read_text());change(data)
        path.write_text(json.dumps(data))
        self.git('add','--','.switchyard/config.yaml');self.git('commit','-m','Human config edit')

    def test_default_astra_and_only_one_project_config(self):
        state=self.start()
        self.assertFalse((self.root/'.switchyard/config.json').exists())
        calls=[json.loads(line) for line in self.calls.read_text().splitlines()]
        spec=calls[0]['binding']
        self.assertEqual((spec['provider'],spec['model'],spec['effort']),('codex','gpt-6-astra','high'))
        self.assertEqual(spec['capabilities'],['repo_read','command'])
        self.assertEqual(calls[1]['binding']['provider'],'claude')
        current=self.app().current()
        self.assertEqual(current['last_invocation']['agent'],'tests')
        self.assertEqual(current['candidate_identity'],state['candidate_identity'])

    def test_only_agent_edit_changes_specification_provider(self):
        self.edit_config(lambda d:d['agents']['spec'].update(provider='claude',model='sonnet'))
        self.start()
        b=json.loads(self.calls.read_text().splitlines()[0])['binding']
        self.assertEqual((b['provider'],b['model'],b['effort']),('claude','sonnet','high'))
        self.assertFalse((self.root/'.switchyard/config.json').exists())

    def test_invalid_permissions_fail_before_pointer_or_provider(self):
        self.edit_config(lambda d:d['agents']['spec'].update(shell=False))
        from flow_config import FlowConfigError
        with self.assertRaisesRegex(FlowConfigError,'workspace=read, shell=false'):self.start()
        self.assertFalse(self.calls.exists())
        self.assertFalse((self.root/'.switchyard/current.json').exists())

    def test_lifecycle_disable_accept_is_not_uncommitted_accept(self):
        self.edit_config(lambda d:d['lifecycle']['accept'].update(commit=False))
        state=self.start();base=self.git('rev-parse','HEAD')
        with self.assertRaisesRegex(delivery.DeliveryError,'disabled'):self.qa('accept',state)
        self.assertEqual(self.git('rev-parse','HEAD'),base)
        self.assertEqual(self.qa('reopen',state,'Review')['terminal'],'REOPENED')

    def test_lifecycle_disable_reopen(self):
        self.edit_config(lambda d:d['lifecycle'].update(reopen=False))
        state=self.start()
        with self.assertRaisesRegex(delivery.DeliveryError,'disabled'):self.qa('reopen',state,'Review')
        self.assertEqual(self.qa('accept',state)['terminal'],'ACCEPTED')

    def test_manual_qa_disabled_creates_no_candidate_or_commit(self):
        self.edit_config(lambda d:d.update(lifecycle={'manual_qa':False}))
        base=self.git('rev-parse','HEAD');state=self.start()
        self.assertEqual((state['terminal'],state['status']),('READY_FOR_MANUAL_QA','delivered'))
        self.assertIsNone(state['candidate_identity'])
        self.assertFalse(self.app().paths(state)[1].exists())
        with self.assertRaisesRegex(delivery.DeliveryError,'disabled'):self.qa('accept',state)
        self.assertEqual(self.git('rev-parse','HEAD'),base)

    def test_snapshot_survives_project_config_edit_but_git_drift_blocks(self):
        state=self.start();snapshot=Path(state['workspace'])/'project-config.yaml'
        self.assertEqual(snapshot.read_bytes(),(self.root/'.switchyard/config.yaml').read_bytes())
        (self.root/'.switchyard/config.yaml').write_text('not a valid config')
        self.assertEqual(self.app().current()['candidate_identity'],state['candidate_identity'])
        self.assertEqual(self.qa('accept',state)['reason'],'unexpected_worktree_paths')

    def test_missing_project_config_is_actionable_before_invocation(self):
        (self.root/'.switchyard/config.yaml').unlink()
        with self.assertRaisesRegex(delivery.DeliveryError,'Cannot read .switchyard/config.yaml'):self.start()
        self.assertFalse(self.calls.exists())

    def test_snapshot_digest_cannot_be_removed_to_select_legacy_path(self):
        self.start();pointer=self.root/'.switchyard/current.json'
        state=json.loads(pointer.read_text());del state['config_sha256'];pointer.write_text(json.dumps(state))
        with self.assertRaisesRegex(delivery.DeliveryError,'missing its project configuration digest'):self.app().current()

    def test_missing_snapshot_fails_without_fallback(self):
        state=self.start();(Path(state['workspace'])/'project-config.yaml').unlink()
        with self.assertRaisesRegex(delivery.DeliveryError,'Persisted project configuration'):self.app().current()

    def test_old_local_overrides_are_ignored(self):
        (self.root/'.switchyard/config.json').write_text(json.dumps({'model_aliases_file':'must-not-read'}))
        state=self.start()
        self.assertEqual(state['terminal'],'READY_FOR_MANUAL_QA')
        b=json.loads(self.calls.read_text().splitlines()[0])['binding']
        self.assertEqual(b['model'],'gpt-6-astra')

    def test_reference_guard_and_explicit_kind(self):
        with self.assertRaisesRegex(delivery.DeliveryError,'compatible Switchyard'):delivery.check_reference(self.root)
        with self.assertRaisesRegex(delivery.DeliveryError,'Choose feature or bugfix'):self.app().execute('deliver','task')
        self.assertFalse(self.calls.exists())

if __name__=='__main__':unittest.main()
