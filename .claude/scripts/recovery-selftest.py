#!/usr/bin/env python3
"""RECOVERY-001 through Adeo's real installed-package boundary; fake providers only."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

spec=importlib.util.spec_from_file_location('adeo_integration',Path(__file__).with_name('delivery-selftest.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
delivery=fixture.delivery
from switchyard.recovery import RecoveryBlocked
from switchyard.work_contract import WorkWorkspace
from switchyard.observability import read_events
from switchyard.qa_lifecycle import accept_v2_work,LifecycleError


class RecoveryIntegration(unittest.TestCase):
    setUp=fixture.Integration.setUp
    git=fixture.Integration.git
    make_repo=fixture.Integration.make_repo
    app=fixture.Integration.app
    start=fixture.Integration.start
    qa=fixture.Integration.qa
    edit_config=fixture.Integration.edit_config

    def interrupt(self):
        self.edit_config(lambda d:d['agents']['code'].update(timeout=1))
        marker=self.base/'attempt'
        exe=Path(self.config['claude_executable']);source=exe.read_text()
        addition="""if state in ('IMPLEMENT','FIX'):
    marker=Path(MARKER)
    if not marker.exists():
        marker.write_text('first attempt')
        time.sleep(3)
    else:
        time.sleep(1.1)
""".replace('MARKER',repr(str(marker)))
        exe.write_text(source.replace('outcome=plan.get',addition+'outcome=plan.get'))
        state=self.start()
        self.assertEqual((state['terminal'],state['phase'],state['reason']),('INTERRUPTED','interrupted','provider_timeout'))
        self.assertEqual(json.loads(self.app().pointer.read_text())['phase'],'interrupted')
        self.assertEqual(len(WorkWorkspace.open(state['workspace']).versions('implementation_handoff')),0)
        return state

    def retune(self):
        from flow_config import _yaml_data
        path=self.root/'.switchyard/config.yaml';data=_yaml_data(path.read_text())
        data['agents']['code']['timeout']=5;path.write_text(json.dumps(data))

    def test_resume_partial_same_work_and_artifacts(self):
        first=self.interrupt();before=(self.root/'catalog.py').read_bytes();work=WorkWorkspace.open(first['workspace'])
        microspec=work.read_artifact('microspec');self.retune()
        restored=self.app().current();self.assertEqual(restored['work_id'],first['work_id'])
        ready=self.app().execute('resume')
        self.assertEqual(ready['terminal'],'READY_FOR_MANUAL_QA');self.assertEqual(ready['work_id'],first['work_id'])
        self.assertEqual((self.root/'catalog.py').read_bytes(),before)
        self.assertEqual(work.read_artifact('microspec'),microspec);self.assertEqual(len(work.versions('microspec')),1)
        calls=[json.loads(l)['binding']['logical_state'] for l in self.calls.read_text().splitlines()]
        self.assertEqual(calls,['SPECIFY','IMPLEMENT','IMPLEMENT'])
        events=tuple(read_events(Path(first['workspace'])/'events.jsonl'))
        self.assertEqual(len({e.run_id for e in events}),1)
        self.assertEqual(len([e for e in events if e.kind=='invocation_started']),4)
        self.assertEqual(self.qa('accept',ready)['terminal'],'ACCEPTED')

    def test_semantic_change_blocks_resume(self):
        self.interrupt()
        from flow_config import _yaml_data
        path=self.root/'.switchyard/config.yaml';data=_yaml_data(path.read_text());data['agents']['code']['model']='haiku';path.write_text(json.dumps(data))
        with self.assertRaisesRegex(RecoveryBlocked,'RESUME_BLOCKED.*semantic_configuration_changed'):self.app().execute('resume')
        self.assertEqual(json.loads(self.app().pointer.read_text())['phase'],'interrupted')

    def test_drift_refuses_both_operations(self):
        self.interrupt();(self.root/'catalog.py').write_text('human edit');self.retune()
        for operation in ('resume','rollback'):
            with self.assertRaisesRegex(RecoveryBlocked,'checkpoint_drift'):self.app().execute(operation)
        self.assertEqual((self.root/'catalog.py').read_text(),'human edit')

    def test_dirty_rollback_retires_and_allows_new_delivery(self):
        dirty=self.root/'preexisting.bin';dirty.write_bytes(b'\x00user\xff')
        state=self.interrupt();self.assertEqual(self.app().execute('rollback','Wrong direction')['terminal'],'ROLLED_BACK')
        self.assertEqual(dirty.read_bytes(),b'\x00user\xff')
        self.assertTrue(Path(state['workspace']).is_dir())
        self.assertEqual(self.app().current()['status'],'closed')
        # Fresh new operation is possible without removing current.json.
        self.retune();new=self.start();self.assertNotEqual(new['work_id'],state['work_id'])
        self.assertEqual(new['terminal'],'READY_FOR_MANUAL_QA')

    def test_qa_rollback_and_accepted_protection(self):
        ready=self.start();qa=ready['qa_workspace']
        result=self.app().execute('rollback')
        self.assertEqual(result['terminal'],'ROLLED_BACK')
        with self.assertRaisesRegex(LifecycleError,'finalized'):accept_v2_work(self.root,qa)
        next_ready=self.start();self.qa('accept',next_ready)
        head=self.git('rev-parse','HEAD')
        with self.assertRaisesRegex(RecoveryBlocked,'accepted_history_use_git_revert'):self.app().execute('rollback')
        self.assertEqual(self.git('rev-parse','HEAD'),head)

    def test_installed_cli_with_root_unset_feature_status_and_rollback(self):
        scripts=self.root/'.claude/scripts';scripts.mkdir(parents=True)
        for name in ('delivery.py','delivery_legacy.py'):
            shutil.copyfile(Path(__file__).with_name(name),scripts/name)
        (self.root/'scripts/lib/isolated-electron.mjs').write_text('export function normalUserDataDir(){return '+json.dumps(str(self.data))+';}')
        self.git('add','--','.claude/scripts','scripts/lib/isolated-electron.mjs');self.git('commit','-m','local command wrapper')
        self.plan.write_text(json.dumps({'artifacts':{},'change':{'path':'catalog.py','content':fixture.FEATURE_FIX}}))
        env={k:v for k,v in os.environ.items() if k not in ('SWITCHYARD_ROOT','PYTHONPATH')}
        env.update(SWITCHYARD_CLAUDE=self.config['claude_executable'],SWITCHYARD_CODEX=self.config['codex_executable'],FAKE_CONTRACT_AWARE='1')
        # Test-owned data helper retains the production API and resolves outside the fixture target.
        for args,terminal in ((['deliver','feature','Human request'],'READY_FOR_MANUAL_QA'),(['status'],'READY_FOR_MANUAL_QA'),(['deliver','rollback','discard'],'ROLLED_BACK'),(['status'],'ROLLED_BACK')):
            child=subprocess.run([sys.executable,str(scripts/'delivery.py'),*args],env=env,cwd=self.root,capture_output=True,text=True)
            self.assertEqual(child.returncode,0,child.stderr)
            self.assertEqual(json.loads(child.stdout)['terminal'],terminal)
        probe=subprocess.check_output([sys.executable,'-c','from importlib.metadata import version; import switchyard; print(version("switchyard-runtime")); print(switchyard.__file__)'],env=env,cwd=self.root,text=True)
        self.assertIn('2.1.0',probe);self.assertIn('site-packages',probe)

    def test_qa_capture_failure_still_allows_rollback(self):
        (self.root/'staged.txt').write_text('user staging')
        self.git('add','--','staged.txt')
        index=self.git('diff','--cached','--binary')
        with self.assertRaises(Exception):self.start()
        self.assertEqual(self.app().execute('rollback')['terminal'],'ROLLED_BACK')
        self.assertEqual(self.git('diff','--cached','--binary'),index)
        self.assertEqual((self.root/'staged.txt').read_text(),'user staging')

    def test_valid_explicit_developer_override(self):
        import switchyard
        source=Path(switchyard.__file__).parent
        checkout=self.base/'developer-checkout';checkout.mkdir()
        shutil.copytree(source,checkout/'switchyard')
        (checkout/'pyproject.toml').write_text('version = "2.1.0"\n')
        code="import importlib.util; s=importlib.util.spec_from_file_location('delivery',"+repr(str(Path(__file__).with_name('delivery.py')))+"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=m.configuration("+repr(str(self.root))+"); m.load_switchyard(c); import switchyard; print(switchyard.__file__)"
        env={k:v for k,v in os.environ.items() if k!='PYTHONPATH'}
        env['SWITCHYARD_ROOT']=str(checkout)
        output=subprocess.check_output([sys.executable,'-c',code],env=env,cwd=self.root,text=True)
        self.assertIn(str(checkout/'switchyard'),output)

    def test_invalid_developer_override_is_explicit(self):
        from unittest.mock import patch
        with patch.dict(os.environ,{'SWITCHYARD_ROOT':str(self.root)}):
            with self.assertRaisesRegex(delivery.DeliveryError,'Developer override'):delivery.configuration(self.root)


if __name__=='__main__':unittest.main()
