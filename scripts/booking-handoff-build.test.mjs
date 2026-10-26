import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {bookingRollbackBuildPlan,executeBookingRollbackBuild,prepareBookingHandoffRollback} from './booking-handoff-build.mjs';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
const clone=structuredClone,h=c=>c.repeat(64);
function fixture(){
  const events=[],plan=bookingRollbackBuildPlan({toolRevision:'f'.repeat(40),toolClosureSha256:h('a'),applicationInputsSha256:h('b'),
    primaryPort:3105,listeners:[{port:3103},{port:3104}]}),observed={processes:[{name:'unchanged',pid:123}],retentionHeadSha256:h('c')};
  let builds=0,complete=null;
  const operations={now:()=> '2026-10-26T10:00:00.000Z',observe:async()=>{events.push('observe');return clone(observed);},
    admission:async()=>{events.push('admission');},begin:async()=>{events.push('begin');},materialize:async()=>{events.push('materialize');},
    build:async()=>{events.push('build');builds++;return {target:APPLICATION,guardedCommand:'npm run build',memoryBytes:4294967296,heapMiB:3072,
      cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};},
    artifacts:async()=>{events.push('artifacts');return Object.fromEntries(['buildEvidenceSha256','runtimeSha256','environmentFileSha256','dependenciesSha256','builtOutputSha256'].map(k=>[k,h('d')]));},
    complete:async receipt=>{events.push('complete');complete=clone(receipt);}};
  return {operations,plan,events,observed,builds:()=>builds,receipt:()=>complete};
}
test('rollback plan reserves a distinct free owned port with the exact approved application identity',async()=>{
  const f=fixture();assert.equal(f.plan.port,3110);assert.notEqual(f.plan.port,f.plan.primaryPort);
  assert.throws(()=>bookingRollbackBuildPlan({toolRevision:'f'.repeat(40),toolClosureSha256:h('a'),applicationInputsSha256:h('b'),primaryPort:3103,
    listeners:Array.from({length:8},(_,i)=>({port:3103+i}))}),/ports|plan/);
  for(const [key,value]of Object.entries({target:'a'.repeat(40),primary:'a'.repeat(40),baseline:'a'.repeat(40),operation:'/tmp/other',directory:'/tmp/other',
    port:3105,toolRevision:'bad',toolClosureSha256:'bad',applicationInputsSha256:'bad'})){
    await assert.rejects(()=>executeBookingRollbackBuild(f.operations,{...f.plan,[key]:value}),undefined,key);
  }
});
test('compatible rollback is built and sealed before any process starts; existing website facts are checked again',async()=>{
  const f=fixture(),receipt=await executeBookingRollbackBuild(f.operations,f.plan);
  assert.deepEqual(f.events,['observe','admission','begin','observe','materialize','admission','build','artifacts','observe','complete']);
  assert.equal(f.builds(),1);assert.equal(receipt.status,'built-not-started');assert.deepEqual(f.receipt(),receipt);
  assert.ok(!f.events.some(v=>['start','restart','stop','database','traffic','mail'].includes(v)));
});
for(const point of ['observe','admission','begin','materialize','build','artifacts','complete'])test('failure at '+point+' is retained without retry or successful receipt',async()=>{
  const f=fixture();f.operations[point]=async()=>{f.events.push('failed:'+point);throw Error('synthetic fault');};
  await assert.rejects(()=>executeBookingRollbackBuild(f.operations,f.plan),/synthetic fault/);
  assert.ok(f.builds()<=1);assert.equal(f.receipt(),null);
  assert.equal(f.events.filter(v=>v==='failed:'+point).length,1);
});
test('an invalid sandbox, artifact hash or changed live process after build cannot be sealed as ready',async()=>{
  for(const key of ['target','guardedCommand','memoryBytes','heapMiB','cpuQuotaPercent','tasks','seconds','privateNetworkVerified','swapBytes']){
    const f=fixture(),build=f.operations.build;f.operations.build=async()=>({...await build(),[key]:'changed'});
    await assert.rejects(()=>executeBookingRollbackBuild(f.operations,f.plan),/bounded_build_proof/);assert.equal(f.receipt(),null);
  }
  const changed=fixture();let observations=0;
  changed.operations.observe=async()=>{const v=clone(changed.observed);if(++observations===3)v.processes[0].pid++;return v;};
  await assert.rejects(()=>executeBookingRollbackBuild(changed.operations,changed.plan),/baseline_changed/);assert.equal(changed.builds(),1);assert.equal(changed.receipt(),null);
  const bad=fixture();bad.operations.artifacts=async()=>({buildEvidenceSha256:'bad'});
  await assert.rejects(()=>executeBookingRollbackBuild(bad.operations,bad.plan),/artifacts/);assert.equal(bad.receipt(),null);
});
test('real host adapter requires both held locks and reviewed exact source; it has no process, DB or traffic actuator',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)await assert.rejects(()=>prepareBookingHandoffRollback({lock:true,toolRevision:'f'.repeat(40),primaryPort:3105}),/linux_root/);
  const source=readFileSync(new URL('./booking-handoff-build.mjs',import.meta.url),'utf8');
  assert.match(source,/assertOnlineRetentionHeldLocks\(lock\)/);assert.match(source,/verifyOnlineReleaseTool\(createOnlineReleaseToolPlan\(toolRevision\)\)/);
  assert.match(source,/assertOnlineToolNoPending\(\)/);assert.match(source,/assertBookingHandoffToolClosure\(/);
  assert.match(source,/buildAttendanceOnlineCandidate\(/);assert.match(source,/assertAttendanceBuildAdmission\(/);
  assert.doesNotMatch(source,/run\('pm2',\['(?:start|stop|restart|reload|delete|save)'|run\('(?:psql|docker|nginx)'|applyProduction|installInactive|RESEND_API_KEY\s*=/);
});
test('actual stage wiring builds rollback first, then freshly checks the primary build reserve; ordinary lanes never enter it',async()=>{
  const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const bookingRollbackBuild=bookingReviewedStage?'),end=source.indexOf('  privateDirectory(operation);',start);
  assert.ok(start>0&&end>start);assert.ok(source.indexOf('const bookingReviewedStage=requestedAction===')<start);
  assert.ok(source.indexOf("save(s);run('git',['worktree','add'",start)>end);
  const body=source.slice(start,end),token={synthetic:'lock'};
  for(const mode of ['normal','reviewed','low-memory','failed-build']){
    const events=[];
    const result=runInNewContext('(async()=>{'+body+'return bookingRollbackBuild;})()',{
      bookingReviewedStage:mode==='normal'?null:{toolRevision:'f'.repeat(40)},heldLock:token,port:3105,BigInt,
      prepareBookingHandoffRollback:async value=>{assert.equal(value.lock,token);assert.equal(value.primaryPort,3105);events.push('rollback-build');if(mode==='failed-build')throw Error('build_failed');return {status:'built-not-started'};},
      statfsSync:()=>{events.push('fresh-disk');return {bavail:30*1024**3,bsize:1};},read:()=> 'synthetic-resource',
      assertAttendanceBuildAdmission:()=>{events.push('fresh-admission');if(mode==='low-memory')throw Error('resource_admission_rejected');},
    });
    if(mode==='low-memory')await assert.rejects(result,/resource_admission_rejected/);
    else if(mode==='failed-build')await assert.rejects(result,/build_failed/);
    else await result;
    assert.deepEqual(events,mode==='normal'?[]:mode==='failed-build'?['rollback-build']:['rollback-build','fresh-disk','fresh-admission']);
  }
});
