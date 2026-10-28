import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('new private worker transport independently rechecks actual PID, full flags, peer and sealed attempt without contacting PM2 in tests',()=>{
 const r=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./release-toolchain-pm2-worker.test.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:262144,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stderr,/Ran 5 tests/);assert.match(r.stderr,/\bOK\b/);
});
