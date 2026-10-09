#!/usr/bin/env python3
"""VERIFICATION-RECOVERY-001: baseline-aware verification, diagnosis routing and declared recovery.

Pure classification tests plus Adeo's real delivery boundary with fake providers, the real
runtime/verifier and disposable Git repositories. No live provider calls.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('adeo_integration',Path(__file__).with_name('delivery-selftest.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
ROOT=fixture.ROOT
sys.path.insert(0,str(ROOT/'scripts'))
import delivery_verification as dv
from switchyard.recovery import RecoveryBlocked
from switchyard.simple_config import load_simple_config
from switchyard.workflow_compiler import compile_workflow
from switchyard.work_contract import WorkWorkspace
from switchyard.observability import read_events

# Real dogfood failure lines (VERIFICATION-RECOVERY-001); fixtures only, never an ignore list.
BOARD='Board self-test failed after 20 checks: 1a: the card shows the long multi-day recurrence summary'
KEBAB='Task delete self-test failed after 9 checks: 2: the kebab is hidden until the row is hovered'


def check(name,outcome='pass',signature=(),code=1):
    return dict(check=name,command=[name],outcome=outcome,exit_code={'pass':0,'not_run':None}.get(outcome,code),signature=list(signature))


class Classification(unittest.TestCase):
    def kinds(self,report):
        return {key:[e['check'] for e in report[key]] for key in ('pre_existing_failures','new_failures','changed_failures','resolved_failures')}

    def test_clean_baseline(self):
        report=dv.compare([check('a'),check('b')],[check('a'),check('b')])
        self.assertEqual((report['relative_outcome'],self.kinds(report)),('pass',dict(pre_existing_failures=[],new_failures=[],changed_failures=[],resolved_failures=[])))

    def test_new_regression_blocks(self):
        report=dv.compare([check('a')],[check('a','fail',['X'])])
        self.assertEqual(report['relative_outcome'],'fail')
        self.assertEqual([e['classification'] for e in report['new_failures']],['NEW_FAILURE'])

    def test_existing_same_failure_does_not_block(self):
        report=dv.compare([check('a','fail',['X'])],[check('a','fail',['X'])])
        self.assertEqual(report['relative_outcome'],'pass')
        self.assertEqual([e['classification'] for e in report['pre_existing_failures']],['PRE_EXISTING_SAME'])

    def test_existing_changed_failure_blocks(self):
        for final in (check('a','fail',['Y']),check('a','fail',['X'],code=2)):
            report=dv.compare([check('a','fail',['X'])],[final])
            self.assertEqual(report['relative_outcome'],'fail')
            self.assertEqual([(e['classification'],e['baseline_signature']) for e in report['changed_failures']],[('CHANGED_FAILURE',['X'])])

    def test_resolved_failure_is_improvement(self):
        report=dv.compare([check('a','fail',['X'])],[check('a')])
        self.assertEqual(report['relative_outcome'],'pass')
        self.assertEqual([e['classification'] for e in report['resolved_failures']],['RESOLVED_BASELINE_FAILURE'])

    def test_mixed_only_new_regression_blocks(self):
        report=dv.compare([check('old',  'fail',['X']),check('fixed','fail',['Z']),check('new')],
                          [check('old','fail',['X']),check('fixed'),check('new','fail',['N'])])
        self.assertEqual(self.kinds(report),dict(pre_existing_failures=['old'],new_failures=['new'],changed_failures=[],resolved_failures=['fixed']))
        self.assertEqual(report['relative_outcome'],'fail')
        report=dv.compare([check('old','fail',['X']),check('fixed','fail',['Z'])],[check('old','fail',['X']),check('fixed'),check('added')])
        self.assertEqual(report['relative_outcome'],'pass')

    def test_unverified_checks_never_pass(self):
        # A failed gate skips later checks; deleting a failing check cannot hide it.
        self.assertEqual(dv.compare([check('build'),check('a','fail',['X'])],[check('build','fail',['E']),check('a','not_run')])['not_run'],['a'])
        report=dv.compare([check('build'),check('a','fail',['X'])],[check('build')])
        self.assertEqual((report['missing_checks'],report['relative_outcome']),(['a'],'fail'))
        self.assertEqual(dv.compare([check('a','not_run')],[check('a','fail',['X'])])['new_failures'][0]['classification'],'NEW_FAILURE')

    def test_signature_is_stable_but_material(self):
        root=Path('/work/adeo')
        first=dv.failure_signature('started 2026-10-09T10:00:01Z in 84.886s at /work/adeo/dist/x.js /private/var/folders/ab/T/run1\n'+BOARD,root,1)
        again=dv.failure_signature('started 2026-10-10T11:00:02Z in 1.2s\n'+BOARD.replace('after 20','after 23'),root,1)
        self.assertEqual(first,again);self.assertEqual(first,['1a: the card shows the long multi-day recurrence summary'])
        self.assertNotEqual(first,dv.failure_signature(BOARD.replace('1a:','1b:'),root,1))
        self.assertEqual(dv.failure_signature(KEBAB,root,1),['2: the kebab is hidden until the row is hovered'])
        unit='.F\nFAIL: test_x (tests.T.test_x)\nTraceback\nAssertionError: 1 != 2\nFAILED (failures=1)\n'
        self.assertEqual(dv.failure_signature(unit,root,1),['FAIL: test_x (tests.T.test_x)'])
        self.assertNotEqual(dv.failure_signature(unit.replace('FAIL: test_x','ERROR: test_x'),root,1),dv.failure_signature(unit,root,1))
        self.assertEqual(dv.failure_signature('',root,3),['exit 3 without output'])
        many='\n'.join(f'FAIL: case {i}' for i in range(9))
        signature=dv.failure_signature(many,root,1)
        self.assertEqual(len(signature),6);self.assertTrue(signature[-1].startswith('+4 more sha256:'))


class VerifierCli(unittest.TestCase):
    """main() exactly as Switchyard's command agent runs it, with a fake process runner."""
    def setUp(self):
        import tempfile
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()

    def run_main(self,outputs,argv=(),env=None):
        def runner(argv,**kwargs):
            code,text=outputs[argv[0]]
            return subprocess.CompletedProcess(argv,code,text)
        checks=[(name,[name]) for name in outputs]
        stream=io.StringIO();code=dv.main(checks,self.root,list(argv),environ=env or {},stream=stream,runner=runner)
        text=stream.getvalue()
        return code,dv.parse_result('='+text),text

    def test_baseline_compare_and_raw_exit_code(self):
        failing={'build':(0,''),'board-selftest':(1,BOARD),'task-delete-selftest':(1,KEBAB),'attachments-flow-selftest':(1,'FAIL: missing panel')}
        code,baseline,text=self.run_main(failing,['--baseline'])
        self.assertEqual((code,baseline['mode'],baseline['raw_exit_code'],baseline['relative_outcome']),(0,'baseline',1,'recorded'))
        artifacts=self.root/'artifacts';artifacts.mkdir();(artifacts/dv.BASELINE_ARTIFACT).write_text('='+text)
        after=dict(failing,**{'attachments-flow-selftest':(0,'Attachments flow self-test passed (36 checks)')})
        code,result,text=self.run_main(after,env={'SWITCHYARD_ARTIFACTS':str(artifacts)})
        self.assertEqual((code,result['mode'],result['raw_exit_code'],result['exit_code'],result['relative_outcome']),(0,'compare',1,0,'pass'))
        self.assertEqual([f['check'] for f in result['baseline_failures']],['board-selftest','task-delete-selftest','attachments-flow-selftest'])
        self.assertEqual([(f['check'],f['signature']) for f in result['pre_existing_failures']],
                         [('board-selftest',['1a: the card shows the long multi-day recurrence summary']),
                          ('task-delete-selftest',['2: the kebab is hidden until the row is hovered'])])
        self.assertEqual((result['new_failures'],result['changed_failures']),([],[]))
        self.assertEqual([f['check'] for f in result['resolved_failures']],['attachments-flow-selftest'])
        self.assertEqual({c['check']:c['exit_code'] for c in result['checks']}['board-selftest'],1)
        self.assertIn('Verification relative to baseline: PASS',text)
        self.assertIn('Pre-existing failures retained (unchanged, still failing):\n- board-selftest: 1a:',text)
        self.assertIn('New failures:\n- none',text);self.assertIn('Raw verifier exit code: 1 (2 failing check(s))',text)
        self.assertNotIn('all tests passed',text.lower())
        code,result,_=self.run_main(dict(after,**{'board-selftest':(1,BOARD.replace('1a','4'))}),env={'SWITCHYARD_ARTIFACTS':str(artifacts)})
        self.assertEqual((code,[f['check'] for f in result['changed_failures']]),(1,['board-selftest']))

    def test_without_or_with_unreadable_baseline_every_failure_blocks(self):
        outputs={'build':(0,''),'board-selftest':(1,BOARD)}
        code,result,text=self.run_main(outputs)
        self.assertEqual((code,result['mode'],result['relative_outcome']),(1,'absolute','fail'))
        bad=self.root/'bad';bad.mkdir();(bad/dv.BASELINE_ARTIFACT).write_text('=no structured block')
        code,result,_=self.run_main(outputs,env={'SWITCHYARD_ARTIFACTS':str(bad)})
        self.assertEqual((code,result['mode']),(1,'absolute'));self.assertIn('baseline unreadable',result['baseline_error'])
        code,result,_=self.run_main({'build':(0,'')})
        self.assertEqual((code,result['raw_exit_code']),(0,0))

    def test_build_gate_and_timeouts(self):
        def runner(argv,**kwargs):
            if argv[0]=='slow':raise subprocess.TimeoutExpired(argv,1)
            return subprocess.CompletedProcess(argv,1 if argv[0]=='build' else 0,'error TS2322: bad type')
        results=dv.run_checks([('build',['build']),('a',['a'])],self.root,stream=io.StringIO(),runner=runner)
        self.assertEqual([(r['check'],r['outcome'],r['exit_code']) for r in results],[('build','fail',1),('a','not_run',None)])
        self.assertEqual(results[0]['signature'],['error TS2322: bad type'])
        results=dv.run_checks([('build',['ok']),('slow',['slow'])],self.root,stream=io.StringIO(),
                              runner=lambda argv,**k:runner(argv,**k) if argv[0]=='slow' else subprocess.CompletedProcess(argv,0,''))
        self.assertEqual((results[1]['outcome'],results[1]['signature']),('fail',['timeout after 180s']))


class AdeoWorkflow(unittest.TestCase):
    """The committed Adeo configuration, compiled; no execution."""
    def compiled(self,flow):
        class Never:
            def run(self,request):raise AssertionError('projection only')
        project=load_simple_config(ROOT/'.switchyard/config.yaml')
        return project,compile_workflow(project.bundle,flow,lambda binding:Never())

    def test_baseline_precedes_first_writer_once(self):
        for flow,before,writer in (('feature','SPECIFY','IMPLEMENT'),('bugfix','SPECIFY_FIX','FIX')):
            project,compiled=self.compiled(flow);states=project.bundle.flow(flow).states
            self.assertEqual(states[before].on['ready'],'BASELINE_VERIFY')
            self.assertEqual(dict(states['BASELINE_VERIFY'].on),{'recorded':writer,'error':'NEEDS_HUMAN'})
            self.assertEqual([n for n,s in states.items() if 'verification_baseline' in s.produces],['BASELINE_VERIFY'])
            writers=[n for n,s in states.items() if s.capabilities and 'repo_write' in s.capabilities]
            self.assertIn(writer,writers)
            for name in ('VERIFY','VERIFY_AGAIN'):
                self.assertIn('verification_baseline',states[name].consumes)

    def test_diagnosis_ladder_routes_every_declared_outcome(self):
        for flow,state,exhausted in (('feature','DIAGNOSE_FAILURE','NEEDS_REDIAGNOSIS'),('bugfix','DIAGNOSE','NEEDS_HUMAN')):
            project,compiled=self.compiled(flow)
            rungs=sorted((k for k,p in compiled.plan.items() if p.logical_state==state and p.binding),key=lambda k:compiled.plan[k].binding.rung_index)
            role=project.bundle.roles[project.bundle.flow(flow).states[state].role]
            for index,key in enumerate(rungs):
                transitions=compiled.flow.states[key].on
                self.assertTrue(all(target in compiled.flow.states for target in transitions.values()))
                later={t for step in role.escalation[index:] for t in step.on}
                for trigger in later-{'budget_exceeded'}:
                    # The observed bug: verification_same_failure skipped past rung 1 into the terminal.
                    self.assertEqual(transitions[trigger],rungs[index+1],(flow,index,trigger))
            last=compiled.flow.states[rungs[-1]].on
            self.assertEqual(last['verification_same_failure'],exhausted)
            self.assertEqual(compiled.flow.states[rungs[0]].on['verification_same_failure'],rungs[1])

    def test_recovery_route_is_declared_only_for_feature_rediagnosis(self):
        project,_=self.compiled('feature')
        self.assertEqual(project.bundle.flow('feature').states['NEEDS_REDIAGNOSIS'].resume_to,'VERIFY')
        self.assertEqual(project.bundle.flow('feature').states['VERIFY'].budget.max_state_visits,2)
        self.assertTrue(all(s.resume_to is None for s in project.bundle.flow('bugfix').states.values()))


PROVIDER_PATCH="""if state in ('IMPLEMENT','FIX','REPAIR_ONCE'):
    for change in plan.get('changes',{}).get(state,[]):
        Path(change['path']).parent.mkdir(parents=True,exist_ok=True);Path(change['path']).write_text(change['content'])
    for path in plan.get('unlink',{}).get(state,[]):
        Path(path).unlink(missing_ok=True)
outcome=plan.get"""
CHECK="import sys\nprint({message!r},file=sys.stderr)\nsys.exit({code})\n"
GATED="import os,sys\nfrom pathlib import Path\nok=Path(os.environ['ADEO_TEST_GATE']).exists()\nprint('environment self-test passed' if ok else 'Environment self-test failed after 3 checks: 1: service reachable')\nsys.exit(0 if ok else 1)\n"
OUTPUTS={'SPECIFY':'microspec','IMPLEMENT':'implementation_handoff','DIAGNOSE_FAILURE':'failure_diagnosis',
         'REPAIR_ONCE':'implementation_handoff','TRIAGE':'bug_spec'}


class DeliveryIntegration(unittest.TestCase):
    setUp_base=fixture.Integration.setUp
    git=fixture.Integration.git
    make_repo=fixture.Integration.make_repo
    app=fixture.Integration.app
    qa=fixture.Integration.qa

    def setUp(self):
        self.setUp_base()
        script=(ROOT/'.claude/test-fixtures/switchyard/provider_cli.py').read_text().replace('outcome=plan.get',PROVIDER_PATCH)
        for provider in ('claude','codex'):
            Path(self.config[provider+'_executable']).write_text('#!'+sys.executable+'\n'+script)
        self.gate=self.base/'gate';self.gate.write_text('environment available')
        env=patch.dict(os.environ,{'ADEO_TEST_GATE':str(self.gate)});env.start();self.addCleanup(env.stop)
        checks={'board-selftest':CHECK.format(message=BOARD,code=1),'task-delete-selftest':CHECK.format(message=KEBAB,code=1),
                'quick-add-selftest':CHECK.format(message='Quick Add self-test passed (40 checks)',code=0),'environment-selftest':GATED}
        for name,content in checks.items():
            (self.root/'checks').mkdir(exist_ok=True);(self.root/'checks'/(name+'.py')).write_text(content)
        self.git('add','--','checks');self.git('commit','-m','pre-existing project checks; two already fail')
        self.base_head=self.git('rev-parse','HEAD')

    def deliver(self,plan,kind='feature'):
        spec=json.dumps(dict(id='OFFLINE',goal='Requested behavior',scope=['source'],constraints=[],
                             acceptance=['Independent tests pass'],verification=['unittest'],non_goals=[]))
        artifacts={state:[{'name':name,'content':spec if name in ('microspec','bug_spec') else 'Durable facts'}] for state,name in OUTPUTS.items()}
        feature=[{'path':'catalog.py','content':fixture.FEATURE_FIX},
                 {'path':'checks/attachments-flow-selftest.py','content':CHECK.format(message='Attachments flow self-test passed (36 checks)',code=0)}]
        changes={'IMPLEMENT':feature+plan.pop('extra',[]),**plan.pop('changes',{})}
        plan={'artifacts':artifacts,'changes':changes,**plan}
        self.plan.write_text(json.dumps(plan))
        return self.app().execute('deliver','Human request',kind=kind)

    def invoked(self):  # Model invocations only; the verifier is a command agent.
        return [(c['binding']['logical_state'],c['binding']['rung_index']) for c in map(json.loads,self.calls.read_text().splitlines())]
    def evidence(self,state,name='verifier_evidence'):return WorkWorkspace.open(state['workspace']).read_artifact(name)
    def result(self,state):return dv.parse_result(self.evidence(state))

    def test_dogfood_equivalent_pre_existing_failures_reach_manual_qa(self):
        state=self.deliver({})
        self.assertEqual(state['terminal'],'READY_FOR_MANUAL_QA')
        self.assertEqual(self.invoked(),[('SPECIFY',0),('IMPLEMENT',0)])  # No diagnosis for known failures.
        baseline=dv.parse_result(self.evidence(state,'verification_baseline'))
        self.assertEqual([f['check'] for f in baseline['current_failures']],['unit','board-selftest','task-delete-selftest'])
        result=self.result(state)
        self.assertEqual((result['raw_exit_code'],result['exit_code'],result['relative_outcome']),(1,0,'pass'))
        self.assertEqual([(f['check'],f['classification']) for f in result['pre_existing_failures']],
                         [('board-selftest','PRE_EXISTING_SAME'),('task-delete-selftest','PRE_EXISTING_SAME')])
        self.assertEqual((result['new_failures'],result['changed_failures']),([],[]))
        self.assertEqual([f['check'] for f in result['resolved_failures']],['unit'])
        self.assertEqual({c['check']:c['outcome'] for c in result['checks']}['attachments-flow-selftest'],'pass')
        text=self.evidence(state)
        self.assertIn('Verification relative to baseline: PASS',text);self.assertIn('New failures:\n- none',text)
        self.assertIn('- task-delete-selftest: 2: the kebab is hidden until the row is hovered',text)
        events=tuple(read_events(Path(state['workspace'])/'events.jsonl'))
        self.assertNotIn('DIAGNOSE_FAILURE',' '.join(e.state or '' for e in events))
        self.assertEqual(self.qa('accept',state)['terminal'],'ACCEPTED')

    def test_new_regression_diagnoses_and_same_failure_claim_escalates(self):
        broken=[{'path':'checks/quick-add-selftest.py','content':CHECK.format(message='Quick Add self-test failed after 5 checks: 3: Enter adds the task',code=1)}]
        restored=[{'path':'checks/quick-add-selftest.py','content':CHECK.format(message='Quick Add self-test passed (40 checks)',code=0)}]
        state=self.deliver({'extra':broken,'changes':{'REPAIR_ONCE':restored},
                            'outcomes':{'DIAGNOSE_FAILURE:0':'verification_same_failure','DIAGNOSE_FAILURE:1':'inconclusive'}})
        self.assertEqual(state['terminal'],'READY_FOR_MANUAL_QA')
        self.assertEqual(self.invoked(),[('SPECIFY',0),('IMPLEMENT',0),('DIAGNOSE_FAILURE',0),('DIAGNOSE_FAILURE',1),
                                       ('DIAGNOSE_FAILURE',2),('REPAIR_ONCE',0)])
        work=WorkWorkspace.open(state['workspace'])
        first=dv.parse_result(work.read_artifact('verifier_evidence',1))
        self.assertEqual(([f['check'] for f in first['new_failures']],first['relative_outcome']),(['quick-add-selftest'],'fail'))
        self.assertEqual([f['check'] for f in first['pre_existing_failures']],['board-selftest','task-delete-selftest'])
        self.assertEqual(self.result(state)['relative_outcome'],'pass')

    def test_changed_pre_existing_failure_blocks(self):
        worse=[{'path':'checks/board-selftest.py','content':CHECK.format(message=BOARD.replace('1a: the card shows the long multi-day recurrence summary','1b: the card is missing'),code=1)}]
        state=self.deliver({'extra':worse,'outcomes':{f'DIAGNOSE_FAILURE:{i}':'inconclusive' for i in range(3)}})
        self.assertEqual(state['terminal'],'NEEDS_REDIAGNOSIS')
        result=dv.parse_result(WorkWorkspace.open(state['workspace']).read_artifact('verifier_evidence',1))
        self.assertEqual([(f['check'],f['classification'],f['baseline_signature']) for f in result['changed_failures']],
                         [('board-selftest','CHANGED_FAILURE',['1a: the card shows the long multi-day recurrence summary'])])
        self.assertEqual(result['relative_outcome'],'fail')

    def stopped(self):
        state=self.deliver({'unlink':{'IMPLEMENT':[str(self.gate)]},'outcomes':{f'DIAGNOSE_FAILURE:{i}':'inconclusive' for i in range(3)}})
        self.assertEqual((state['terminal'],state['resume_allowed'],state['resume_to']),('NEEDS_REDIAGNOSIS',True,'VERIFY'))
        return state

    def test_needs_rediagnosis_explicit_resume_same_work(self):
        stopped=self.stopped();workspace=Path(stopped['workspace'])
        before=tuple(read_events(workspace/'events.jsonl'));calls=self.invoked()
        self.assertEqual(self.app().current()['terminal'],'NEEDS_REDIAGNOSIS')  # Nothing resumes by itself.
        self.gate.write_text('environment restored by a human')
        ready=self.app().execute('resume','verification failures confirmed environmental')
        self.assertEqual((ready['terminal'],ready['work_id']),('READY_FOR_MANUAL_QA',stopped['work_id']))
        self.assertEqual(self.invoked(),calls)  # SPECIFY/IMPLEMENT/diagnosis never rerun; VERIFY is a command.
        events=tuple(read_events(workspace/'events.jsonl'))
        self.assertEqual(events[:len(before)],before);self.assertEqual(len({e.run_id for e in events}),1)
        self.assertEqual([(e.state,e.target) for e in events if e.kind=='run_resumed'],[('NEEDS_REDIAGNOSIS','@v2:feature:VERIFY:0')])
        self.assertEqual(sum(e.kind=='invocation_started' for e in events),sum(e.kind=='invocation_started' for e in before)+1)
        store=WorkWorkspace.open(workspace/'recovery')
        operations=[json.loads(store.read_artifact('operation',r.version)) for r in store.versions('operation')]
        self.assertIn(dict(from_terminal='NEEDS_REDIAGNOSIS',resume_to='VERIFY',reason='verification failures confirmed environmental'),
                      [o.get('recovery') for o in operations])
        self.assertEqual(self.qa('accept',ready)['terminal'],'ACCEPTED')
        self.assertEqual(self.git('rev-parse','HEAD^'),self.base_head)

    def test_resume_refuses_drift_and_undeclared_routes(self):
        stopped=self.stopped();(self.root/'catalog.py').write_text('human edit')
        with self.assertRaisesRegex(RecoveryBlocked,'RESUME_BLOCKED: checkpoint_drift'):self.app().execute('resume')
        self.assertEqual((self.root/'catalog.py').read_text(),'human edit')
        self.assertEqual(json.loads(self.app().pointer.read_text())['terminal'],'NEEDS_REDIAGNOSIS')
        # A NEEDS_HUMAN terminal without a declared route stays stopped (separate repository/pointer).
        self.calls.unlink();root=self.base/'bugs/app';self.make_repo(root,'bugfix');self.root=root
        state=self.deliver({'outcomes':{'TRIAGE:0':'needs_clarification'}},kind='bugfix')
        self.assertEqual((state['terminal'],state['resume_allowed'],state['resume_to']),('NEEDS_HUMAN',False,None))
        with self.assertRaisesRegex(RecoveryBlocked,'no_declared_recovery_route'):self.app().execute('resume','please continue')
        self.assertEqual(self.invoked(),[('TRIAGE',0)])


if __name__=='__main__':unittest.main()
