#!/usr/bin/env python3
"""Adeo human commands around one-file Switchyard configuration; no workflow or Git engine."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from importlib.metadata import version, PackageNotFoundError
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
from uuid import uuid4

SUPPORTED_VERSION = '2.2.0'

class DeliveryError(ValueError):
    pass


def check_reference(root):
    """Explicit contributor override only; never run for installed-package usage."""
    root=Path(root).resolve()
    try:
        text=(root/'pyproject.toml').read_text()
        if ('version = "'+SUPPORTED_VERSION+'"') not in text or not (root/'switchyard/recovery.py').is_file():raise ValueError()
    except (OSError,ValueError):
        raise DeliveryError('Developer override must be a compatible Switchyard '+SUPPORTED_VERSION+' checkout') from None


def configuration(root):
    """Launch environment only; installed dependency is the ordinary path."""
    interpreter=Path(root)/'.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    config={'python_executable':os.environ.get('SWITCHYARD_PYTHON',str(interpreter) if interpreter.is_file() else sys.executable)}
    override=os.environ.get('SWITCHYARD_ROOT')
    if override:
        check_reference(override)
        config['developer_override']=str(Path(override).resolve())
    for tool in ('claude','codex','git','node','npm'):
        config[tool+'_executable']=os.environ.get('SWITCHYARD_'+tool.upper()) or shutil.which(tool) or tool
    return config


def load_switchyard(config):
    override=config.get('developer_override')
    if override:
        check_reference(override);sys.path.insert(0,override)
    else:
        try:
            if version('switchyard-runtime')!=SUPPORTED_VERSION:raise ValueError()
        except (PackageNotFoundError,ValueError):
            raise DeliveryError('Install the pinned delivery dependency into .venv: .venv/bin/python -m pip install -r requirements-delivery.txt') from None
    import switchyard
    origin=Path(switchyard.__file__).resolve()
    if override:
        if not origin.is_relative_to(Path(override)):raise DeliveryError('A different Switchyard is already imported; restart')
    elif not origin.is_relative_to(Path(sys.prefix).resolve()):
        raise DeliveryError('Normal delivery requires installed Switchyard; remove source-path injection or use the explicit developer override')
    config['switchyard_root']=str(origin.parent.parent)  # Historical readers/test resources only, never bootstrap authority.
    global RunResult, JsonlRecorder, read_events, summarize_runs, WorkWorkspace
    global load_workflow_bundle, compile_workflow, execute_v2_workflow, ProviderRuntimeConfig
    global simple_config_from_text, compile_simple_config
    global create_qa_candidate, accept_v2_work, reopen_v2_work
    global execute_recoverable_v2_work, resume_v2_work, rollback_v2_work, recovery_status, attach_qa_candidate, RecoveryBlocked
    from runtime import RunResult
    from runtime.recording import JsonlRecorder
    from switchyard.observability import read_events, summarize_runs
    from switchyard.work_contract import WorkWorkspace
    from switchyard.workflow_bundle import load_workflow_bundle
    from switchyard.simple_config import simple_config_from_text, compile_simple_config
    from switchyard.workflow_compiler import compile_workflow
    from switchyard.workflow_execution import execute_v2_workflow
    from switchyard.provider_stages import ProviderRuntimeConfig
    from switchyard.qa_lifecycle import create_qa_candidate, accept_v2_work, reopen_v2_work
    from switchyard.recovery import (execute_recoverable_v2_work,resume_v2_work,rollback_v2_work,
                                    recovery_status,attach_qa_candidate,RecoveryBlocked)


def application_data(root, config):
    # Reuse Adeo's existing cross-platform normalUserDataDir; do not mirror OS policy.
    helper = (Path(root)/'scripts/lib/isolated-electron.mjs').resolve().as_uri()
    code = 'import {normalUserDataDir} from '+json.dumps(helper)+'; console.log(normalUserDataDir());'
    try:
        raw = subprocess.check_output([config['node_executable'],'--input-type=module','-e',code],
                                      text=True, stderr=subprocess.PIPE, timeout=15).strip()
        if not Path(raw).is_absolute(): raise ValueError()
        return Path(raw).resolve()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise DeliveryError('Adeo persistent application-data directory is unavailable') from None


def legacy_module():
    spec = importlib.util.spec_from_file_location('adeo_delivery_legacy', Path(__file__).with_name('delivery_legacy.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class Delivery:
    def __init__(self, root, config, *, data_root=None):
        self.root = Path(root).resolve(); self.config = config
        self.directory = self.root/'.switchyard'; self.pointer = self.directory/'current.json'
        # A location namespace, not a replacement for V2's repository/candidate identity.
        self.repo_id = hashlib.sha256(os.fsencode(self.root)).hexdigest()
        self.data_root = Path(data_root).resolve() if data_root is not None else application_data(self.root,config)
        self.qa_base = self.data_root/'switchyard/qa'/self.repo_id
        if self.qa_base.resolve().is_relative_to(self.root):
            raise DeliveryError('Persistent QA storage must be outside the target worktree')

    @contextmanager
    def locked(self):
        self.directory.mkdir(exist_ok=True)
        with (self.directory/'command.lock').open('a') as lock:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise DeliveryError('Another delivery command is running') from None
            try: yield
            finally: fcntl.flock(lock, fcntl.LOCK_UN)

    def save(self, state):
        path = self.pointer.with_suffix('.tmp')
        with path.open('w') as stream:
            stream.write(json.dumps(state,indent=2)+'\n'); stream.flush(); os.fsync(stream.fileno())
        path.replace(self.pointer)

    def paths(self, state):
        work = self.directory/'work'/state['work_id']
        qa = self.qa_base/state['work_id']
        if qa.resolve().is_relative_to(self.root) or qa.resolve() != qa:
            raise DeliveryError('QA storage path changed or resolves inside target')
        if work.resolve() != work:
            raise DeliveryError('Delivery workspace path changed')
        return work, qa

    def project_config(self, state):
        work, _ = self.paths(state)
        try:
            snapshot = (work/'project-config.yaml').read_bytes()
            if hashlib.sha256(snapshot).hexdigest() != state['config_sha256']: raise ValueError()
            return simple_config_from_text(snapshot.decode('utf-8'))
        except Exception:
            raise DeliveryError('Persisted project configuration is unavailable or inconsistent; inspect retained work') from None

    def current(self, update_pointer=True):
        try:
            if not self.pointer.is_file(): raise DeliveryError('No current work; start /deliver feature or /deliver bugfix')
            state = json.loads(self.pointer.read_text())
            if 'engine' not in state:
                old = legacy_module(); old.load_switchyard(self.config)
                # Compatibility reader only. Never dispatch its execute/accept methods.
                value = old.Delivery(self.root,self.config).current()
                return {**value,'engine':'legacy','read_only':True}
            keys = {'engine','work_id','repo_id','flow','phase','candidate_identity','terminal'}
            if set(state) not in (keys,keys|{'config_sha256'}) or state['engine'] != 'v2': raise ValueError()
            if not re.fullmatch('[a-f0-9]{32}',state['work_id']) or state['repo_id'] != self.repo_id: raise ValueError()
            if state['flow'] not in ('feature','bugfix'): raise ValueError()
            work, qa = self.paths(state)
            recovery=None
            if (work/'recovery/manifest.jsonl').is_file():
                recovery=recovery_status(work)
                if recovery['phase'] in ('running','interrupted','rolled_back','rollback_running'):
                    phase=recovery['phase'];terminal=recovery['terminal']
                    state.update(phase=phase,terminal=terminal)
                    if update_pointer:self.save(state)
                    return {**state,**recovery,'status':'closed' if terminal=='ROLLED_BACK' else 'active',
                            'workspace':str(work),'qa_workspace':str(qa)}
            if not (work/'manifest.jsonl').is_file() or not (work/'events.jsonl').is_file():
                raise DeliveryError('Persisted delivery state is unavailable; inspect retained history')
            workspace = WorkWorkspace.open(work)
            events = tuple(read_events(work/'events.jsonl')); summaries = summarize_runs(events)
            if len(summaries) != 1 or not summaries[0].completed_normally:
                raise DeliveryError('Interrupted delivery; inspect durable history; no automatic resume')
            terminal = summaries[0].terminal_state
            class ProjectionOnly:
                def run(self, request): raise AssertionError('status never executes')
            if 'config_sha256' in state:
                project = self.project_config(state)
                bundle = compile_simple_config(project)
            else:
                if (work/'project-config.yaml').exists():
                    raise DeliveryError('Current-work pointer is missing its project configuration digest')
                # Historical V2-009 runs had this fixed graph. Never used for new delivery.
                project = None
                bundle = load_workflow_bundle(Path(self.config['switchyard_root'])/'examples/delivery/workflows-v2.yaml')
            compiled = compile_workflow(bundle,state['flow'],lambda binding: ProjectionOnly())
            entry = next(e for e in reversed(events) if e.kind=='state_entered')
            latest = next((e for e in reversed(events) if e.kind=='invocation_started'),None)
            binding = compiled.plan[latest.state].binding if latest else None
            progress = dict(logical_state=compiled.plan[entry.state].logical_state,
                            last_invocation=None if binding is None else dict(logical_state=binding.logical_state,
                            rung=binding.rung_index,provider=binding.provider,agent=binding.profile_name,model=binding.model,effort=binding.effort))
            if terminal != 'READY_FOR_MANUAL_QA':
                # Human terminals continue only through a route the frozen workflow declares.
                route={k:recovery[k] for k in ('resume_allowed','resume_to')} if recovery else {}
                return {**state,**progress,**route,'terminal':terminal,'status':'active','read_only':True,'workspace':str(work)}
            if project is not None and not project.lifecycle.manual_qa:
                return {**state,**progress,'terminal':terminal,'status':'delivered','read_only':True,
                        'lifecycle':'manual QA disabled by project config','workspace':str(work)}
            if state['phase'] not in ('qa','decision','lifecycle_running'):
                raise DeliveryError('Interrupted QA creation; inspect durable state before recovery')
            if not (qa/'manifest.jsonl').is_file():
                raise DeliveryError('Persisted QA lifecycle state is unavailable; restore it or inspect history; no replacement created')
            store = WorkWorkspace.open(qa)
            record = store.latest_artifact('qa_candidate')
            if record is None or record.sha256 != state['candidate_identity']: raise ValueError()
            candidate = json.loads(store.read_artifact('qa_candidate'))
            if (candidate['target'] != str(self.root) or candidate['source_workspace'] != str(work)
                or candidate['source_run_id'] != events[0].run_id or candidate['source_flow'] != state['flow']
                or candidate['source_request_sha256'] != workspace.latest_artifact('request').sha256): raise ValueError()
            decision = store.latest_artifact('qa_decision')
            reason = None; feedback = None
            if decision:
                result = json.loads(store.read_artifact('qa_decision'))
                if result['candidate_identity'] != record.sha256: raise ValueError()
                terminal, reason = result['terminal'],result['reason']
                if terminal == 'REOPENED': feedback = store.read_artifact('qa_feedback')
            elif store.versions('qa_intent'):
                raise DeliveryError('Unresolved QA intent; inspect lifecycle state and Git before manual recovery')
            status = 'closed' if terminal == 'ACCEPTED' else 'reopened' if terminal == 'REOPENED' else 'active'
            # Lifecycle record is authority even if the process died before pointer update.
            if decision and (state['terminal'] != terminal or state['phase'] != 'decision'):
                state.update(terminal=terminal,phase='decision')
                if update_pointer:self.save(state)
            return {**state,**progress,'terminal':terminal,'status':status,'reason':reason,'feedback':feedback,
                    'workspace':str(work),'qa_workspace':str(qa),'source_run_id':events[0].run_id}
        except DeliveryError: raise
        except RecoveryBlocked as exc:
            if exc.reason=='qa_workspace_unavailable':
                raise DeliveryError('Persisted QA lifecycle state is unavailable; restore it or inspect history') from None
            raise DeliveryError(str(exc)) from None
        except Exception:
            raise DeliveryError('Inconsistent current-work pointer or durable V2 state; inspect before recovery') from None

    def execute(self, command, task='', *, kind=None, candidate_identity=None):
        if command == 'repair':
            raise DeliveryError('/repair is retired: explicitly start /deliver bugfix for new work')
        if command == 'qa-fix': command = 'reopen'
        with self.locked():
            if command == 'deliver':
                if kind not in ('feature','bugfix') or not task.strip():
                    raise DeliveryError('Choose feature or bugfix and supply a nonempty human request')
                if self.pointer.exists():
                    previous = self.current()
                    if previous['status'] not in ('closed','reopened','delivered'):
                        raise DeliveryError('Current work is active; no overwrite or cross-engine resume')
                old = legacy_module(); old.Delivery(self.root,self.config).legacy_check()
                try:
                    snapshot = (self.directory/'config.yaml').read_bytes()
                    text = snapshot.decode('utf-8')
                except (OSError, UnicodeError):
                    raise DeliveryError('Cannot read .switchyard/config.yaml as UTF-8; restore the project configuration') from None
                project = simple_config_from_text(text)
                bundle = compile_simple_config(project)
                bundle.flow(kind)
                state = dict(config_sha256=hashlib.sha256(snapshot).hexdigest(),engine='v2', work_id=uuid4().hex, repo_id=self.repo_id, flow=kind,
                             phase='delivery_running',candidate_identity=None,terminal=None)
                work, qa = self.paths(state)
                if work.exists() or qa.exists(): raise DeliveryError('Work identity already exists')
                work.mkdir(parents=True); self.save(state)
                # Immutable per-run evidence, not another editable configuration source.
                with (work/'project-config.yaml').open('xb') as stream:
                    stream.write(snapshot); stream.flush(); os.fsync(stream.fileno())
                config = ProviderRuntimeConfig(
                    str(self.root),
                    self.config['claude_executable'],
                    self.config['codex_executable']
                    )
                try:
                    execution = execute_recoverable_v2_work(text,kind,task,work,config)
                except Exception:
                    if (work/'recovery/manifest.jsonl').is_file():
                        recovery=recovery_status(work)
                        state.update(phase=recovery['phase'],terminal=recovery['terminal']);self.save(state)
                        return self.current()
                    raise
                state.update(terminal=execution.result.terminal_state,phase='delivery_done'); self.save(state)
                if state['terminal']=='READY_FOR_MANUAL_QA' and project.lifecycle.manual_qa:
                    candidate = create_qa_candidate(self.root,execution.workspace,execution.result,kind,qa,
                                                    git_executable=self.config['git_executable'])
                    attach_qa_candidate(work,qa)
                    state.update(phase='qa',candidate_identity=candidate.identity); self.save(state)
                return self.current()
            if command in ('resume','rollback'):
                state=json.loads(self.pointer.read_text())
                if state.get('engine')!='v2':raise DeliveryError('Historical delivery has no recovery baseline')
                if state.get('repo_id')!=self.repo_id or not re.fullmatch('[a-f0-9]{32}',state.get('work_id','')):
                    raise DeliveryError('Inconsistent current-work pointer')
                work,qa=self.paths(state)
                recovery=recovery_status(work)
                if recovery['target']!=str(self.root) or recovery['flow']!=state.get('flow'):
                    raise DeliveryError('Recovery baseline does not belong to current project')
                if command=='rollback':
                    result=rollback_v2_work(work,task)
                    state.update(phase='rolled_back',terminal='ROLLED_BACK');self.save(state)
                    return self.current()
                config=ProviderRuntimeConfig(str(self.root),self.config['claude_executable'],self.config['codex_executable'])
                text=(self.directory/'config.yaml').read_text(encoding='utf-8')
                state.update(phase='delivery_running',terminal='RUNNING');self.save(state)
                try:
                    execution=resume_v2_work(work,text,config,reason=task)  # Annotation only; never routing.
                except RecoveryBlocked:
                    recovery=recovery_status(work)
                    state.update(phase=recovery['phase'],terminal=recovery['terminal']);self.save(state)
                    raise
                except Exception:
                    recovery=recovery_status(work)
                    state.update(phase=recovery['phase'],terminal=recovery['terminal']);self.save(state)
                    return self.current()
                state.update(phase='delivery_done',terminal=execution.result.terminal_state);self.save(state)
                if state['terminal']=='READY_FOR_MANUAL_QA' and self.project_config(state).lifecycle.manual_qa:
                    candidate=create_qa_candidate(self.root,execution.workspace,execution.result,state['flow'],qa,
                                                   git_executable=self.config['git_executable'])
                    attach_qa_candidate(work,qa)
                    state.update(phase='qa',candidate_identity=candidate.identity);self.save(state)
                return self.current()
            if command not in ('accept','reopen'): raise DeliveryError('Unknown delivery operation')
            current = self.current()
            if current['engine'] != 'v2': raise DeliveryError('Legacy work is read-only; no cross-engine accept/resume')
            if current['terminal'] != 'READY_FOR_MANUAL_QA': raise DeliveryError('Current candidate is not pending QA')
            state=json.loads(self.pointer.read_text())
            if 'config_sha256' in state:
                policy = self.project_config(state).lifecycle
                if not policy.manual_qa or not (policy.commit if command=='accept' else policy.reopen):
                    raise DeliveryError(command+' is disabled by this work item project configuration')
            if candidate_identity != current['candidate_identity']:
                raise DeliveryError('Reviewed candidate does not match current work; refresh QA status')
            if command=='reopen' and not task.strip(): raise DeliveryError('Reopen requires nonempty human feedback')
            state=json.loads(self.pointer.read_text());state['phase']='lifecycle_running';self.save(state)
            _,qa=self.paths(state)
            if command=='accept': accept_v2_work(self.root,qa,git_executable=self.config['git_executable'])
            else: reopen_v2_work(self.root,qa,task)
            return self.current()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    d=sub.add_parser('deliver');d.add_argument('operation',nargs='?',choices=('feature','bugfix','resume','rollback'));d.add_argument('request',nargs='?',default='')
    d.add_argument('--kind',choices=('feature','bugfix'));d.add_argument('--task',default='')
    for op in ('accept','reopen','qa-fix'):
        p=sub.add_parser(op);p.add_argument('--candidate',required=True)
        if op in ('reopen','qa-fix'):p.add_argument('--feedback',required=True)
    sub.add_parser('status')
    sub.add_parser('repair').add_argument('--task',default='')
    args=parser.parse_args(argv);root=Path(__file__).resolve().parents[2]
    try:
        config=configuration(root)
        if Path(sys.executable).absolute()!=Path(config['python_executable']).absolute():
            os.execv(config['python_executable'],[config['python_executable'],str(Path(__file__).resolve()),*(argv if argv is not None else sys.argv[1:])])
        load_switchyard(config);app=Delivery(root,config)
        if args.command=='status':
            try:
                with app.locked():result=app.current()
            except DeliveryError as exc:
                if 'Another delivery command' not in str(exc):raise
                result=app.current(update_pointer=False)
        else:
            operation=getattr(args,'operation',None)
            command=operation if operation in ('resume','rollback') else args.command
            result=app.execute(command,getattr(args,'task',getattr(args,'feedback','')) or getattr(args,'request',''),
                               kind=getattr(args,'kind',None) or (operation if operation in ('feature','bugfix') else None),
                               candidate_identity=getattr(args,'candidate',None))
        print(json.dumps(result,indent=2))
        return 0 if args.command=='status' or result.get('terminal',result.get('latest_terminal')) in ('READY_FOR_MANUAL_QA','ACCEPTED','REOPENED','ROLLED_BACK') else 1
    except DeliveryError as exc:
        print(str(exc),file=sys.stderr);return 2
    except Exception as exc:
        # Canonical contract diagnostics are safe; never echo arbitrary process exception text.
        from switchyard.work_contract import WorkContractError
        from flow_config import FlowConfigError
        from switchyard.workflow_compiler import WorkflowCompileError
        from switchyard.provider_process import ProviderExecutionError
        from switchyard.provider_stages import ProviderResolutionError
        from switchyard.qa_lifecycle import LifecycleError
        current=exc;seen=[]
        while current is not None:
            if isinstance(current,(WorkContractError,ProviderExecutionError,ProviderResolutionError,LifecycleError,FlowConfigError,WorkflowCompileError,RecoveryBlocked)):
                seen.append(type(current).__name__+': '+str(current)[:2048])
            current=current.__cause__
        print('\n'.join(seen) or 'Execution interrupted; inspect durable events and QA intent before recovery',file=sys.stderr)
        return 3

if __name__=='__main__': raise SystemExit(main())
