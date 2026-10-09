"""Offline process fixture emulating the documented CLI channels, never a provider."""
import json
import os
from pathlib import Path
import sys
import time

argv=sys.argv[1:]
provider=Path(sys.argv[0]).name
mode=os.environ.get('FAKE_MODE','valid')
text=sys.stdin.read()
log=Path(os.environ['FAKE_LOG'])
binding=None
if provider!='python3':
    binding=json.loads(text.split('EXECUTION BINDING\n')[1].split('\n\n')[0])
record={'provider':provider,'argv':argv,'cwd':os.getcwd(),'input':text,'binding':binding,
        'thinking':os.environ.get('MAX_THINKING_TOKENS'),
        'retries':os.environ.get('MAX_STRUCTURED_OUTPUT_RETRIES')}
if '--output-schema' in argv:
    record['schema']=json.loads(Path(argv[argv.index('--output-schema')+1]).read_text())
with log.open('a') as stream: stream.write(json.dumps(record)+'\n')
if mode=='timeout': time.sleep(5)
if mode=='exit': sys.exit(7)
if mode=='signal':
    import signal
    os.kill(os.getpid(),signal.SIGTERM)
if mode=='scripted':
    # Exact provider channel bytes from test-owned files; a Codex result file may coexist.
    for name,fd in (('FAKE_STDOUT_FILE',1),('FAKE_STDERR_FILE',2)):
        if os.environ.get(name): os.write(fd,Path(os.environ[name]).read_bytes())
    if os.environ.get('FAKE_RESULT_FILE') and '--output-last-message' in argv:
        Path(argv[argv.index('--output-last-message')+1]).write_bytes(Path(os.environ['FAKE_RESULT_FILE']).read_bytes())
    sys.exit(int(os.environ.get('FAKE_EXIT','1')))
if provider=='python3':
    if mode=='large':
        os.write(1,('old'*30000+'終わり').encode())
    elif mode=='invalid_utf8': os.write(1,b'good\xffend')
    else:
        os.write(1,b'stdout evidence\n'); os.write(2,b'stderr evidence\n')
    code=int(os.environ.get('FAKE_EXIT','0'))
    if os.environ.get('FAKE_VERIFY_FAIL')=='1':
        prior=[json.loads(line) for line in log.read_text().splitlines()]
        code=1 if sum(r['provider']=='python3' for r in prior)==1 else 0
    sys.exit(code)
plan=json.loads(Path(os.environ['FAKE_PLAN']).read_text())
state=binding['logical_state']; rung=binding['rung_index']
outcome=plan.get('outcomes',{}).get(f'{state}:{rung}','ready')
result={'outcome':outcome,'produced_artifacts':plan['artifacts'].get(state,[]),
        'handoff':{'summary':f'{state} reasoning {rung}','findings':[], 'evidence':[],
                   'changed_assumptions':[], 'blockers':[]}, 'diagnostics':None}
if os.environ.get('FAKE_CONTRACT_AWARE') == '1':
    contract=json.loads(text.split('STAGE OUTPUT CONTRACT\n')[1].split('\n\n')[0])
    result['outcome']='ready' if 'ready' in contract['allowed_outcomes'] else contract['allowed_outcomes'][0]
    result['produced_artifacts']=[]
    for artifact in contract['artifacts']:
        content='evidence'
        if artifact['schema']=='microspec':
            content=json.dumps({f['name']: 'bounded feature' if f['type']=='string' else ['check']
                                for f in artifact['schema_fields']})
        result['produced_artifacts'].append({'name':artifact['name'],'content':content})
raw=json.dumps(result)
if mode=='malformed': raw='not JSON'
if mode=='oversized': raw='x'*2000000
if mode=='missing_outcome':
    del result['outcome']; raw=json.dumps(result)
if provider=='claude':
    if mode in ('malformed','oversized'): print(raw)
    else: print(json.dumps({'type':'result','subtype':'success','is_error':False,
                           'structured_output':result,'result':'operational prose must not be parsed'}))
else:
    print('progress: operational stdout is NOT the result')
    if mode!='missing_file': Path(argv[argv.index('--output-last-message')+1]).write_text(raw)
print('operational stderr chatter',file=sys.stderr)
