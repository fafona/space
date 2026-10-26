import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('fixed legacy pause RPC tests issue no commands to any real PM2 instance',()=>{
  const script=fileURLToPath(new URL('./test_booking_handoff_pm2_pause.py',import.meta.url));
  const r=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',script],{encoding:'utf8',timeout:10000,maxBuffer:256*1024,windowsHide:true,
    env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stderr,/Ran 9 tests/);assert.match(r.stderr,/\bOK\b/);
});
test('new helper has no generic target/env/CLI or daemon-bootstrap facility; old allowlists are not expanded',()=>{
  const source=readFileSync(new URL('./booking-handoff-pm2-pause.py',import.meta.url),'utf8');
  assert.match(source,/_SOCKET = "\/root\/\.pm2\/rpc.sock"/);assert.match(source,/result\["pid"\] != 1590381/);
  assert.match(source,/_ARGUMENT = \{"id": 0, "env": \{"FAOLLA_BACKGROUND_JOBS_PAUSED": "1"\}\}/);
  assert.match(source,/class _Session\(_control\._Session\)/);assert.match(source,/_control\._check_target_process/);
  assert.doesNotMatch(source,/subprocess|os\.system|Popen|connect\(.*PM2|process\.env|reconnect\(|retry\(/);
  const old=readFileSync(new URL('./production-maintenance-pm2-control.py',import.meta.url),'utf8');
  assert.doesNotMatch(old,/restartProcessId/);
});
