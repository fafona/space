import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {expectedProcessStateSequence,observeExpectedProcessStateSequence,processBirth,assertExpectedReparentableProcessIdentity} from './release-toolchain-process-birth.mjs';
import {captureReparentableProcessFact} from './release-toolchain-process-reparent-capture.mjs';
const expected={pid:55,uid:0,startTicks:'123',executable:'/usr/bin/node',cwd:'/owned',commandLineDigest:'a'};
test('same birth with vanished executable must be independently absent before it is classified as gone',()=>{let n=0;assert.equal(expectedProcessStateSequence({expected,birth:()=>++n===1?{startTicks:'123',zombie:false}:null,capture:()=>{throw Object.assign(Error('gone'),{code:'ENOENT'});}}),'absent');});
test('PID reuse is distinct from absence and cannot authorize a signal',()=>{assert.equal(expectedProcessStateSequence({expected,birth:()=>({startTicks:'124',zombie:false}),capture:()=>{throw Error('must not inspect foreign executable');}}),'reused');});
for(const error of [Object.assign(Error('permission'),{code:'EACCES'}),Error('unknown'),Object.assign(Error('not gone'),{code:'ENOENT'})])test('a still-present birth or unrecognized failure stays a failure',()=>{assert.throws(()=>expectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>{throw error;}}),value=>value===error);});
test('complete identity mismatch remains reused, not absent',()=>{assert.equal(expectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>({...expected,commandLineDigest:'foreign'})}),'reused');});
test('SSH-parent loss may change only PPID, while every captured source/birth/UID/cwd/command field stays exact',()=>{const full={...expected,parentPid:42,commandLine:['/usr/bin/node','/owned/controller.mjs'],processIdentity:'fixed',cwdIdentity:'fixed',executableIdentity:'fixed'},reparented={...full,parentPid:1};assert.equal(assertExpectedReparentableProcessIdentity(full,reparented),true);for(const change of [value=>value.pid++,value=>value.startTicks='foreign',value=>value.cwdIdentity='foreign',value=>value.commandLine=['/usr/bin/node','/foreign.mjs'],value=>value.uid=1,value=>value.parentPid=-1]){const changed=structuredClone(reparented);change(changed);assert.throws(()=>assertExpectedReparentableProcessIdentity(full,changed));}});

test('a disappearing exe is not absence until a later independent birth proves exit',()=>{
 let births=0,captures=0;const waits=[];
 const result=observeExpectedProcessStateSequence({expected,birth:()=>++births<=4?{startTicks:'123',zombie:false}:{startTicks:'123',zombie:true},
  capture:()=>{captures++;throw Object.assign(Error('exe vanished'),{code:'ENOENT'});},wait:ms=>waits.push(ms)});
 assert.equal(result,'absent');assert.equal(captures,2);assert.deepEqual(waits,[10,10]);
});
test('transient read loss may return owned only after a complete fresh matching capture',()=>{
 let captures=0;const waits=[];
 const result=observeExpectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>{
  if(++captures<3)throw Object.assign(Error('not readable yet'),{code:'ESRCH'});return {...expected};},wait:ms=>waits.push(ms)});
 assert.equal(result,'owned');assert.equal(captures,3);assert.deepEqual(waits,[10,10]);
});
test('exit-read retries are bounded and preserve the last failure when birth is still present',()=>{
 const error=Object.assign(Error('still ambiguous'),{code:'ENOENT'});let captures=0,waits=0;
 assert.throws(()=>observeExpectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>{captures++;throw error;},wait:ms=>{assert.equal(ms,10);waits++;}}),value=>value===error);
 assert.equal(captures,25);assert.equal(waits,24);
});
for(const error of [Object.assign(Error('permission'),{code:'EACCES'}),Error('process_identity_drift'),Error('unknown')])test('exit observation does not retry permissions, capture drift or unknown failures',()=>{
 let waits=0;assert.throws(()=>observeExpectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>{throw error;},wait:()=>{waits++;}}),value=>value===error);assert.equal(waits,0);
});
test('PID reuse and changed identity after an exit-read failure never become owned or absent',()=>{
 for(const field of ['pid','uid','startTicks','executable','cwd','commandLineDigest']){
  let captures=0;const result=observeExpectedProcessStateSequence({expected,birth:()=>({startTicks:'123',zombie:false}),capture:()=>{
   if(++captures===1)throw Object.assign(Error('exit race'),{code:'ENOENT'});return {...expected,[field]:typeof expected[field]==='number'?expected[field]+1:'foreign'};},wait:()=>{}});
  assert.equal(result,'reused',field);assert.equal(captures,2);
 }
 let births=0,captures=0;assert.equal(observeExpectedProcessStateSequence({expected,birth:()=>({startTicks:++births>2?'124':'123',zombie:false}),capture:()=>{captures++;throw Object.assign(Error('race'),{code:'ENOENT'});},wait:()=>{}}),'reused');assert.equal(captures,1);
});
test('real owned controller SIGKILL during executable capture is independently observed as gone', {skip:process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted',timeout:15000},async()=>{
 for(let round=0;round<20;round++){
  const child=spawn(process.execPath,['-e','process.send("ready");setInterval(()=>{},1000)'],{stdio:['ignore','ignore','ignore','ipc']});
  const exited=once(child,'exit');await once(child,'message');
  const original=captureReparentableProcessFact(child.pid);let killed=false;
  try{
   const state=observeExpectedProcessStateSequence({expected:original,birth:()=>processBirth(child.pid),capture:()=>{
    if(!killed){killed=true;assert.equal(child.kill('SIGKILL'),true);throw Object.assign(Error('controlled executable-disappearance race'),{code:'ENOENT'});}
    return captureReparentableProcessFact(child.pid);
   },wait:ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)});
   assert.equal(state,'absent');
  }finally{if(!killed)child.kill('SIGKILL');await exited;}
 }
});
