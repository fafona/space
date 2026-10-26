import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A} from './booking-handoff-policy.mjs';
import {bookingAtomicRuntimePlan,bookingAtomicRuntimeCommands,executeBookingAtomicRuntime,verifyBookingAtomicRuntimeCohort,BOOKING_ATOMIC_NEXT_ENV_PROBE} from './booking-handoff-runtime.mjs';

const anchor=(target,port)=>({target,name:'merchant-space-online-'+target.slice(0,12),directory:'/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online',port});
const primary=anchor(C,3106),rollback=anchor(A,3110);
const env=s=>({NODE_ENV:'production',PWD:s.directory,PORT:String(s.port),PM2_HOME:'/root/.pm2',
  FAOLLA_WEB_BUILD_ID:s.target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:s.target,FAOLLA_BACKGROUND_JOBS_PAUSED:'1',
  MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
  MERCHANT_BOOKING_STORAGE_MODE:'legacy',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret'});
const input=()=>({primary:structuredClone(primary),rollback:structuredClone(rollback),primaryRuntime:env(primary),rollbackRuntime:env(rollback),toolRevision:'f'.repeat(40)});
const plan=()=>bookingAtomicRuntimePlan(input());
test('atomic web runtime overrides exactly the storage mode; build artifacts and secrets are not edited',()=>{
  const i=input(),p=bookingAtomicRuntimePlan(i);
  for(const [s,original]of [[primary,i.primaryRuntime],[rollback,i.rollbackRuntime]]){
    assert.deepEqual(p.runtimeByName[s.name],{...original,MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'});
    assert.equal(original.MERCHANT_BOOKING_STORAGE_MODE,'legacy');
  }
  const expectedWorker={...p.runtimeByName[primary.name],MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1',FAOLLA_BACKGROUND_JOBS_PAUSED:'0'};
  delete expectedWorker.PORT;assert.deepEqual(p.worker.runtime,expectedWorker);
});
test('worker has no listening port and stays independently gated with mail and unrelated workers off',()=>{
  const p=plan();assert.equal(Object.hasOwn(p.worker.runtime,'PORT'),false);
  assert.equal(p.worker.runtime.FAOLLA_BACKGROUND_JOBS_PAUSED,'0');assert.equal(p.worker.runtime.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED,'1');
  assert.equal(p.worker.script,'/var/lib/faolla-online-code/'+'f'.repeat(40)+'/scripts/booking-atomic-worker.mjs');
  assert.equal(p.worker.directory,primary.directory);
});
test('the host and native rehearsal share exactly the private primary restart and two scoped start commands',()=>{
  const p=plan(),commands=bookingAtomicRuntimeCommands(p);
  assert.deepEqual(commands.primary.args,['restart',primary.name,'--update-env']);
  assert.deepEqual(commands.rollback.args,['start',rollback.directory+'/node_modules/next/dist/bin/next','--name',rollback.name,
    '--cwd',rollback.directory,'--interpreter','/usr/bin/node','--','start','-H','127.0.0.1','-p',String(rollback.port)]);
  assert.deepEqual(commands.worker.args,['start',p.worker.script,'--name',p.worker.name,'--cwd',primary.directory,'--interpreter','/usr/bin/node']);
  assert.deepEqual(commands.primary.environment,p.runtimeByName[primary.name]);
  commands.primary.environment.SUPABASE_SERVICE_ROLE_KEY='changed';assert.equal(p.runtimeByName[primary.name].SUPABASE_SERVICE_ROLE_KEY,'synthetic-secret');
});
test('unreviewed source, non-private flags, enabled mail and ambiguous ports fail before commands',()=>{
  for(const change of [i=>i.primary.port=3000,i=>i.rollback.port=i.primary.port,i=>i.toolRevision=C,
    i=>i.primaryRuntime.MERCHANT_BOOKING_STORAGE_MODE='atomic-v2',i=>i.primaryRuntime.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED='1',
    i=>i.rollbackRuntime.FAOLLA_BACKGROUND_JOBS_PAUSED='0',i=>i.primaryRuntime.RESEND_API_KEY='forbidden',
    i=>i.rollbackRuntime.BOOKING_CONFIRMATION_EMAIL_FROM='forbidden',i=>i.primaryRuntime.ARBITRARY_KEY='unreviewed',
    i=>i.rollbackRuntime.PWD='/wrong',i=>i.primaryRuntime.PORT='3000']){
    const i=input();change(i);assert.throws(()=>bookingAtomicRuntimePlan(i));
  }
});
function fixture(failAt){
  const calls=[],p=plan(),before={preserved:['independent-enterprise','old-booking-timer','public-52f']};
  const row=(s,pid)=>({name:s.name,pid,pmId:pid,cwd:s.directory,port:s.port,status:'online',backgroundPaused:'1',automationEnabled:'0',invitationEnabled:'0'});
  const operations=Object.fromEntries(['admit','begin','saveRuntime','restartPrimary','startRollback','startGatedWorker','complete'].map(k=>[k,async()=>{
    calls.push(k);if(k===failAt)throw Error('unknown_'+k);
  }]));
  Object.assign(operations,{now:()=> '2026-10-26T18:00:00.000Z',observe:async()=>{calls.push('observe');return structuredClone(before);},
    verifyPrimary:async()=>{calls.push('verifyPrimary');if(failAt==='verifyPrimary')throw Error('probe');return row(primary,100);},
    verifyRollback:async()=>{calls.push('verifyRollback');return row(rollback,101);},
    verifyAll:async()=>{calls.push('verifyAll');if(failAt==='verifyAll')throw Error('retained_changed');return {sameUnrelated:true};}});
  return {p,operations,calls};
}
test('actual execution order never starts rollback or worker before primary verification',async()=>{
  const f=fixture();const receipt=await executeBookingAtomicRuntime(f.operations,f.p);
  assert.deepEqual(f.calls,['observe','admit','begin','observe','saveRuntime','restartPrimary','verifyPrimary','startRollback','verifyRollback','startGatedWorker','verifyAll','complete']);
  const state=JSON.parse(receipt.rollbackStateText);assert.equal(state.status,'booking-rollback-ready');assert.equal(state.storageMode,'atomic-v2');
});
for(const stage of ['admit','begin','saveRuntime','restartPrimary','verifyPrimary','startRollback','startGatedWorker','verifyAll','complete']){
  test('unknown '+stage+' is retained without replay, public fallback or unrelated stop',async()=>{
    const f=fixture(stage);await assert.rejects(executeBookingAtomicRuntime(f.operations,f.p));
    assert.equal(f.calls.filter(x=>x===stage).length,1);
    if(stage!=='complete')assert.equal(f.calls.includes('complete'),false);
    assert.ok(f.calls.every(x=>!/^stop|enable|publish|activate|restore/.test(x)));
  });
}
test('a caller cannot forge worker or web changes into the execution plan',async()=>{
  for(const change of [p=>p.worker.runtime.RESEND_API_KEY='bad',p=>p.worker.runtime.PORT='3000',p=>p.runtimeByName[primary.name].FAOLLA_BACKGROUND_JOBS_PAUSED='0',p=>p.worker.script='/other']){
    const f=fixture();change(f.p);await assert.rejects(executeBookingAtomicRuntime(f.operations,f.p));assert.deepEqual(f.calls,[]);
  }
});
test('host adapter owns exact identities and preserves original build/runtime without a production CLI bypass',()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>verifyBookingAtomicRuntimeCohort({lock:true,toolRevision:'f'.repeat(40)}),/parent_locks_required/);
  const source=readFileSync(new URL('./booking-handoff-runtime.mjs',import.meta.url),'utf8');
  for(const contract of ['assertOnlineRetentionHeldLocks(lock)','assertBookingHandoffToolClosure','verifyInactiveBookingSchema',"'/worker-enabled.json'",'retained_os_identity_changed','primary-runtime-restart-attempt.json','atomic-runtime.json','runtime-ready.json',
    'cohort_os_identity_changed','cohort_actual_environment','atomic_saved_runtime_changed','runtime_attempt_changed'])assert.ok(source.includes(contract),contract);
  assert.doesNotMatch(source.replace(BOOKING_ATOMIC_NEXT_ENV_PROBE,''),/process\.argv|--force|--skip|\['stop'|\['delete'|pm\(\['restart','merchant-space'|writeFileSync\([^\n]*\.env\.local/);
});

test('a repaired already-built origin is accepted only by the strict sealed incident attester',()=>{
 const source=readFileSync(new URL('./booking-handoff-runtime.mjs',import.meta.url),'utf8');
 assert.match(source,/primary\.bookingReviewedStage\?\.toolRevision===toolRevision\?toolRevision:\s*toolRevision===BOOKING_COMPATIBILITY_PRIOR_TOOL\?assertBookingBuiltSmokeRuntimeContinuation\(\{toolRevision,primary,rollback\}\):\s*assertBookingCompatibilityRuntimeContinuation\(\{toolRevision,primary,rollback\}\)/);
 assert.match(source,/rollback\.toolRevision===buildToolRevision/);assert.match(source,/built\.toolRevision===buildToolRevision/);
 const repair=readFileSync(new URL('./booking-built-smoke-repair.mjs',import.meta.url),'utf8');
 assert.match(repair,/assertBookingBuiltSmokeCandidate\(\{toolRevision,phase:'database-ready'\}\)/);
 assert.match(repair,/primary\.bookingReviewedStage\.toolClosureSha256==='1660fac7e48e5e18d11b439f01626d8f0823afebfb1eed00035cbef51caf65fa'/);
 assert.match(repair,/rollback\.toolRevision===P\.originalTool/);
});
test('actual Next loader respects atomic process env over legacy file values and rejects file-only email enablement',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'faolla-booking-atomic-next-env-'));
  writeFileSync(path.join(root,'package.json'),'{}',{flag:'wx'});
  mkdirSync(path.join(root,'node_modules'),{recursive:true});
  const installed=fileURLToPath(new URL('../node_modules/@next',import.meta.url));
  symlinkSync(installed,path.join(root,'node_modules','@next'),process.platform==='win32'?'junction':'dir');
  writeFileSync(path.join(root,'.env.local'),'MERCHANT_BOOKING_STORAGE_MODE=legacy\nFAOLLA_BACKGROUND_JOBS_PAUSED=0\n',{flag:'wx'});
  const childEnv={PATH:process.env.PATH,...plan().runtimeByName[primary.name]};
  const check=()=>spawnSync(process.execPath,['-e',BOOKING_ATOMIC_NEXT_ENV_PROBE,root],{env:childEnv,encoding:'utf8',timeout:10000,windowsHide:true});
  const good=check();assert.equal(good.status,0,good.stderr);const proof=JSON.parse(good.stdout);
  assert.equal(proof.storageMode,'atomic-v2');assert.equal(proof.mailDisabled,true);assert.match(proof.loaderSha256,/^[a-f0-9]{64}$/);
  writeFileSync(path.join(root,'.env.production'),'RESEND_API_KEY=file-only-forbidden\n',{flag:'wx'});
  const bad=check();assert.notEqual(bad.status,0);assert.equal(bad.stdout,'');assert.match(bad.stderr,/mail_not_disabled/);
});
