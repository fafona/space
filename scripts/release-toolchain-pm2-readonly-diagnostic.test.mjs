import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{inspectPm2Registry}from'./production-maintenance-pm2-adapter.mjs';
import{executeObservedReadOnlyPm2,readReleasePm2FailureDiagnostic,inspectReleasePm2Registry}from'./release-toolchain-pm2-readonly-diagnostic.mjs';
const boot='12345678-1234-1234-1234-123456789012',id='1:2:3:4:5:1:0:33261';
const daemon={pid:10,parentPid:1,uid:0,startTicks:'123',processIdentity:id,cwd:'/',cwdIdentity:id,executable:'/usr/bin/node',executableIdentity:id,commandLineDigest:'a'.repeat(64)};
function fixture(){
 const calls=[],current={...daemon,commandLine:['PM2 v6.0.14: God Daemon (/root/.pm2)']};
 const io={readProcess:()=>{calls.push('process');return structuredClone(current);},python:()=>{calls.push('python');return{target:{path:'/fixed/python'}};},verifyPython:()=>{calls.push('verify');},invoke:()=>{calls.push('invoke');return{status:0,stderr:'',stdout:JSON.stringify({version:1,pm2Version:'6.0.14',peerVerified:true,registry:[]})};}};
 const defaults={...io,boot:()=>boot,canonical:p=>p,daemonEnvironment:()=>true,helperProof:()=> 'fixed'};
 return{calls,current,io,defaults,perform:overrides=>inspectPm2Registry(daemon,boot,{...defaults,...overrides})};
}
test('release observation preserves shared transport result, exact host call order and one read invocation',async()=>{
 const original=fixture(),observed=fixture();const expected=await original.perform({});
 assert.deepEqual(await executeObservedReadOnlyPm2({operation:'registry-read',perform:observed.perform,io:observed.io}),expected);
 assert.deepEqual(observed.calls,original.calls);assert.equal(observed.calls.filter(x=>x==='invoke').length,1);
});
test('original fresh-process refusal remains rejected, recording only changed field names',async()=>{
 const f=fixture(),original=f.io.readProcess;let reads=0;
 f.io.readProcess=()=>{if(++reads===2)f.current.processIdentity='1:9:3:4:5:1:0:33261';return original();};
 await assert.rejects(executeObservedReadOnlyPm2({operation:'registry-read',perform:f.perform,io:f.io}),error=>{
  assert.equal(error.message,'production_maintenance_pm2_unverified');const d=readReleasePm2FailureDiagnostic(error);
  assert.deepEqual(d.changedFields,['processIdentity']);assert.equal(d.lastIo,'process-read');assert.equal(d.automaticRetryAllowed,false);
  assert.doesNotMatch(JSON.stringify(d),/1:9:3|[a-f0-9]{64}/);return true;
 });assert.equal(f.calls.includes('invoke'),false);
});
test('child failure keeps original error and no repeat while dropping raw output and arbitrary system text',async()=>{
 const f=fixture();let count=0;f.io.invoke=()=>{count++;return{status:1,signal:null,error:Object.assign(Error('password=private'),{code:'ENOMEM'}),stderr:'private stderr',stdout:'private stdout'};};
 await assert.rejects(executeObservedReadOnlyPm2({operation:'registry-read',perform:f.perform,io:f.io}),error=>{
  assert.equal(error.message,'production_maintenance_pm2_unverified');assert.deepEqual(Object.keys(error),[]);const d=readReleasePm2FailureDiagnostic(error);
  assert.equal(d.operation,'registry-read');assert.equal(d.lastIo,'process-read');assert.equal(d.child.errorCode,'ENOMEM');assert.equal(d.child.stderrEmpty,false);assert.equal(d.child.stdoutBytes,14);
  assert.doesNotMatch(JSON.stringify(d),/private|password/);return true;
 });assert.equal(count,1);
});
test('read-only seam cannot forward a control request or a dump-write even through a caller composition',async()=>{
 for(const[operation,method,payload]of[['registry-read','invoke',{request:{action:'delete'}}],['dump-verify','invokeDump',{request:{action:'persist'}}]]){
  let calls=0;const io={invoke:()=>calls++,invokeDump:()=>calls++};
  await assert.rejects(executeObservedReadOnlyPm2({operation,io,perform:o=>o[method]({},payload)}));assert.equal(calls,0);
 }
});
test('read wrapper preserves SAME errors and refuses getter/proxy/extra-output diagnostic evidence',async()=>{
 const original=Error('private');await assert.rejects(executeObservedReadOnlyPm2({operation:'dump-verify',io:{},perform:()=>{throw original;}}),e=>e===original);
 const valid=readReleasePm2FailureDiagnostic(original);assert.equal(valid.lastIo,'start');assert.equal(valid.automaticRetryAllowed,false);
 let touched=0;const getter={};Object.defineProperty(getter,'releasePm2FailureDiagnostic',{get(){touched++;return valid;}});
 const proxy=new Proxy({},{getOwnPropertyDescriptor(){touched++;return{};}});assert.equal(readReleasePm2FailureDiagnostic(getter),null);assert.equal(readReleasePm2FailureDiagnostic(proxy),null);assert.equal(touched,0);
 assert.equal(readReleasePm2FailureDiagnostic({releasePm2FailureDiagnostic:{...valid,rawEnvironment:'private'}}),null);
 assert.equal(readReleasePm2FailureDiagnostic({releasePm2FailureDiagnostic:{...valid,child:{stdout:'private'}}}),null);
});
test('production read exports cannot accept a JSON IO override on an unqualified workstation',async()=>{
 await assert.rejects(inspectReleasePm2Registry(daemon,boot,{}));
 const source=readFileSync(new URL('./release-toolchain-pm2-readonly-diagnostic.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bcontrolPm2\b|\bpersistPm2Dump\b|spawnSync\(['"]pm2|process\.env/);
 for(const token of ['PM2_CONTROL_BRIDGE_SOURCE','PM2_DUMP_BRIDGE_SOURCE','timeout:dump?20000:7000','maxBuffer:524288',"cwd:'/'","stdio:['pipe','pipe','pipe']","await import('./check-production-runtime-supervision.mjs')"])assert.ok(source.includes(token),token);
});
