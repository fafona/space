import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionHash,retentionCanonicalText,assertOnlineRetentionHistory,inspectOnlineRetentionWindow,assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {buildHostRebootPlan,assertHostBootChain,assertHostRebootPlan,assertHostRebootCompletion,assertHostBootRetainedBuild,resolveCertifiedProcess,REBOOT_WORKER_NAME as NAME} from './release-toolchain-host-reboot-contract.mjs';
import {assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {assertBookingWorkerExecutionRevision} from './release-toolchain-worker-release-contract.mjs';
import {executeHostRebootRecovery,assertHostBootOriginalDumpSnapshots} from './release-toolchain-host-reboot-state.mjs';
import {normalizeResurrectedRetirementProcess as normalizeRetirementProcess} from './release-toolchain-process-observation.mjs';
const clone=structuredClone,H=x=>x.repeat(64),S=x=>x.repeat(40);
import {hostRebootFixture as fixture} from './test-support/release-toolchain-host-reboot-fixture.mjs';

test('retained Next random build IDs bind to their original certified bytes, not to the HTTP Git revision',()=>{
 for(const [version,bytes,buildSha256] of [['f274ad615550c83717aa7af2ad32339608e6f8aa','TLsfdOVOfZo8hl2UIpbiy','04a6a662ccf5d8a255784200ca28e84598a6c13299c7f142cf0f621b0bab01a4'],['6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0','79bAZoTsolzW9sJ8Pc-Ll','d63c1c0d3e186ee7e60fa1bcc8c1d2e3b8efb128482d3b05ab77dc9ea41e4eb6']])assertHostBootRetainedBuild({target:version,buildBytes:bytes,proof:{target:version,sourceHead:version,sourceClean:true,buildSha256,http:{status:200,ok:true,buildId:version}}});
 const target='f274ad615550c83717aa7af2ad32339608e6f8aa',buildBytes='TLsfdOVOfZo8hl2UIpbiy\n',proof={target,sourceHead:target,sourceClean:true,buildSha256:createHash('sha256').update(buildBytes).digest('hex'),http:{status:200,ok:true,buildId:target}};
 assert.equal(assertHostBootRetainedBuild({target,buildBytes,proof}),true);assert.notEqual(buildBytes.trim(),target);
 for(const change of [v=>v.target=S('9'),v=>v.buildBytes=target+'\n',v=>v.buildBytes=v.buildBytes.trim(),v=>v.buildBytes+='\n',v=>v.buildBytes='../invalid\n',v=>v.proof.sourceHead=S('9'),v=>v.proof.sourceClean=false,v=>v.proof.http.buildId=v.buildBytes.trim(),v=>v.proof.http.status=503,v=>v.proof.buildSha256=H('9')]){const changed=clone({target,buildBytes,proof});change(changed);assert.throws(()=>assertHostBootRetainedBuild(changed));}
});
test('a separately certified real boot rebinds all online and stopped registrations without rewriting old evidence',()=>{
 const f=fixture(),original=retentionCanonicalText(f.history);assertHostRebootPlan(f.before,f.history);assertHostRebootCompletion(f.before,f.after,f.history);
 const r=buildOnlineRetentionReceipt(f.before,f.after,{version:2,process:null},f.history,{preparedAt:f.before.hostReboot.window.startedAt,completedAt:'2026-11-10T10:01:00.000Z'}),history={...clone(f.history),entries:[...clone(f.history.entries),r.certificate],headSha256:retentionHash(r.certificate)};
 assertOnlineRetentionHistory(history);assert.equal(retentionCanonicalText(f.history),original);
 const active=Object.fromEntries(['target','name','directory','port'].map(k=>[k,f.before.active[k]]));
 for(const saved of [f.prior.processes,f.before.processes])assert.equal(inspectOnlineRetentionWindow({history,actualActive:active,current:f.after.processes,saved}).phase,'stable');
 assertBookingAtomicWorkerGate({gate:f.gate,history,actualActive:active,current:f.after.processes,toolRevision:f.gate.toolRevision});assertBookingWorkerExecutionRevision({gate:f.gate,history,toolRevision:f.before.toolRevision});
 assert.equal(assertOnlineRetentionPublication({history,state:f.websiteState,actualActive:active,current:f.after.processes,action:'stage'}).phase,'published');
});

test('the shared production plan builder cannot inherit a previous retirement victim or operation-specific payload',()=>{
 const f=fixture(),history=clone(f.history),prior=history.entries.at(-1),victim={target:S('9'),process:clone(prior.processes.find(p=>p.status==='stopped'))};
 // Projection test of an already-parsed prior context, not a replacement for
 // the independently tested full signed-history reader used on the host.
 Object.assign(prior,{kind:'retire',victim,rollbackProof:{syntheticPriorOnly:true}});history.headSha256=retentionHash(prior);
 const hostReboot={...clone(f.before.hostReboot),priorHistoryHead:history.headSha256},original=retentionCanonicalText(history);
 const before=buildHostRebootPlan({history,toolRevision:f.before.toolRevision,hostReboot,workerIdentity:clone(f.before.workerIdentity)});
 assert.equal(before.victim,null);assert.equal(before.rollbackProof,undefined);assert.equal(before.workerRelease,undefined);assert.equal(before.bookingHandoff,undefined);assert.equal(before.applicationRelease,undefined);assertHostRebootPlan(before,history);assert.equal(retentionCanonicalText(history),original);
 assert.throws(()=>assertHostRebootPlan({...before,victim},history),/host_reboot_plan/);
});
test('same kernel boot, renamed/deleted registrations, changed definitions/env/mail and stopped resurrection are refused',()=>{
 for(const mutate of [v=>v.hostReboot.bootId=v.hostReboot.previousBootId,v=>v.hostReboot.resurrectedProcesses.pop(),v=>v.hostReboot.resurrectedProcesses[0].args.push('foreign'),v=>v.hostReboot.environmentProofs[0].afterStableSha256=H('9'),v=>v.hostReboot.resurrectedProcesses[0].createdAt++,v=>v.hostReboot.mailEnabled=true,v=>v.hostReboot.identities[0].parentPid++,v=>v.hostReboot.resurrectedProcesses.find(p=>p.status==='stopped').status='online',v=>v.previousSha256=H('9'),v=>v.active.port++]){const f=fixture();mutate(f.before);assert.throws(()=>assertHostRebootPlan(f.before,f.history));}
});
test('a recovery cannot change any other process, source binding, environment, persistent proof or website',()=>{
 for(const mutate of [v=>v.processes[0].pid++,v=>v.processes.find(p=>p.name===NAME).environmentSha256=H('9'),v=>v.processes.find(p=>p.name===NAME).restartCount++,v=>v.persistenceSha256=null,v=>v.workerIdentity.startTicks=v.hostReboot.identities.find(p=>p.name===NAME).startTicks,v=>v.rollback.target=S('9')]){const f=fixture();mutate(f.after);assert.throws(()=>assertHostRebootCompletion(f.before,f.after,f.history));}
});
test('process replacement composes chronological boot/source edges; unchanged stopped edges work and cycles fail',()=>{
 const a={pid:1},b={pid:2},c={pid:3};assert.deepEqual(resolveCertifiedProcess(a,[{before:a,after:b},{before:b,after:c}]),c);assert.deepEqual(resolveCertifiedProcess(a,[{before:a,after:a}]),a);assert.throws(()=>resolveCertifiedProcess(a,[{before:a,after:b},{before:b,after:a}]),/replacement_cycle/);
});
test('a later reboot retains an already compatible verifier without an unnecessary second restart',()=>{
 const f=fixture(),before=clone(f.before);before.hostReboot.verifierAction='retain';before.toolRevision=before.processes.find(p=>p.name===NAME).executable.split('/')[4];const after={...clone(before),persistenceSha256:H('4')};
 assertHostRebootCompletion(before,after,f.history);
 const receipt=buildOnlineRetentionReceipt(before,after,{version:2,process:null},f.history,{preparedAt:before.hostReboot.window.startedAt,completedAt:'2026-11-10T10:01:00.000Z'});assert.equal(receipt.certificate.hostReboot.verifierAction,'retain');
 for(const change of [v=>v.processes.find(p=>p.name===NAME).pid++,v=>v.processes.find(p=>p.name===NAME).restartCount++,v=>v.workerIdentity.startTicks='70000']){const bad=clone(after);change(bad);assert.throws(()=>assertHostRebootCompletion(before,bad,f.history));}
});
test('successive boot receipts must advance from the exact last boot and cannot replay any earlier kernel identity',()=>{
 const f=fixture(),r=f.before.hostReboot,history={entries:[{kind:'host-reboot',hostReboot:r}]};
 assertHostBootChain({previousBootId:r.bootId,bootId:r.bootId.replace(/2$/,'4')},history);
 assert.throws(()=>assertHostBootChain({previousBootId:r.previousBootId,bootId:r.bootId.replace(/2$/,'4')},history),/boot_chain/);
 for(const bootId of [r.bootId,r.previousBootId])assert.throws(()=>assertHostBootChain({previousBootId:r.bootId,bootId},history),/boot_replay/);
});
test('missing PID means zero only for a specifically stopped PM2 registration',()=>{
 const f=fixture(),p=f.prior.processes.find(p=>p.status==='stopped');
 const raw={name:p.name,pm_id:p.pmId,pm2_env:{status:'stopped',pm_cwd:p.cwd,pm_exec_path:p.executable,env:{}}};assert.equal(normalizeRetirementProcess(raw).pid,0);raw.pm2_env.status='online';assert.throws(()=>normalizeRetirementProcess(raw));raw.pid=null;raw.pm2_env.status='stopped';assert.throws(()=>normalizeRetirementProcess(raw));
});
test('resuming after every durable boundary never sends a second verifier restart',async()=>{
 for(const boundary of ['attempt','restart','settled','persistence','certificate','audit','complete']){
  let attempted=false,restarts=0,persisted=false,certificate=false,completed=false,cut=true;
  const stop=where=>{if(cut&&where===boundary){cut=false;throw Error('owned-interruption');}};
  const ops={admit:async()=>({}),hasRestartAttempt:async()=>attempted,recordRestartAttempt:async()=>{attempted=true;stop('attempt');},restartVerifierOnce:async()=>{restarts++;stop('restart');},verifySettledVerifier:async()=>{stop('settled');if(restarts!==1)throw Error('restart-unknown-never-replay');return{};},ensurePersistence:async()=>{persisted=true;stop('persistence');return{};},ensureCertificate:async()=>{assert.ok(persisted);certificate=true;stop('certificate');return{};},auditNaturalCyclesAndPublicRoute:async()=>{assert.ok(certificate);stop('audit');return{verified:true};},complete:async()=>{completed=true;stop('complete');}};
  await assert.rejects(executeHostRebootRecovery(ops));
  if(boundary==='attempt'){await assert.rejects(executeHostRebootRecovery(ops),/restart-unknown-never-replay/);assert.equal(restarts,0);assert.equal(completed,false);}
  else{await executeHostRebootRecovery(ops);assert.equal(restarts,1);assert.equal(completed,true);}
 }
});
test('both original manager dump and rotating backup remain independently hash-bound throughout recovery',()=>{
 const hash=v=>createHash('sha256').update(v).digest('hex'),proof={primary:'synthetic-primary',backup:'synthetic-backup',primarySha256:hash('synthetic-primary'),backupSha256:hash('synthetic-backup')};
 assertHostBootOriginalDumpSnapshots(proof);assertHostBootOriginalDumpSnapshots({...proof,backup:null,backupSha256:null});
 for(const change of [v=>v.primary+='x',v=>v.backup+='x',v=>v.backup=null,v=>v.backupSha256=null]){const changed=clone(proof);change(changed);assert.throws(()=>assertHostBootOriginalDumpSnapshots(changed),/original_dump_changed/);}
});
test('post-boot Python worker projection is strict and cannot obtain mutation authority outside the installed entry',()=>{
 const result=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B',fileURLToPath(new URL('./release-toolchain-host-reboot-pm2.test.py',import.meta.url))],{encoding:'utf8',timeout:10000,maxBuffer:262144,windowsHide:true,env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 5 tests/);assert.match(result.stderr,/OK/);
});
