import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {assertBookingWatchdogLease,runBookingWatchdogLoop,BOOKING_WATCHDOG_TRIGGER_MS,armBookingHandoffWatchdog} from './booking-handoff-watchdog.mjs';
const revision='f'.repeat(40),h='a'.repeat(64),window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
const lease=()=>({schemaVersion:1,kind:'booking-handoff-independent-watchdog',candidate:C,toolRevision:revision,window:structuredClone(window),
  parent:{pid:1234,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:'/var/lib/faolla-online-code/'+revision,commandSha256:h},
  deploy:{file:'/www/wwwroot/merchant-space.deploy.lock',identity:{dev:1,ino:2,uid:0,mode:0o100600,nlink:1}},
  operation:{directory:'/var/lib/faolla-maintenance/merchant-space/operation.lock',identity:{dev:1,ino:3,uid:0,mode:0o40700,nlink:2}},routingPlanSha256:h,gatePlanSha256:h});
function fixture({states=['owned'],completedAt=Infinity,elapsedStep=250,failAt}={}){
  const calls=[];let elapsed=0,observations=0,stopped=false,recoveries=0;
  const step=(name,fn=()=>{})=>async(...args)=>{calls.push(name);if(name===failAt)throw Error('unknown_'+name);return fn(...args);};
  const operations={verify:step('verify'),armed:step('armed'),completed:step('completed',()=>++observations>=completedAt),
    parentState:step('parentState',()=>stopped?'absent':states[Math.min(observations-1,states.length-1)]),elapsedMs:()=>elapsed,
    stopOwnedParent:step('stopOwnedParent',()=>{stopped=true;}),recover:step('recover',()=>{recoveries++;return {gateClosed:true};}),
    wait:step('wait',()=>{elapsed+=elapsedStep;}),finish:step('finish',(outcome,recovery)=>({outcome,recovery}))};
  return {operations,calls,recoveries:()=>recoveries};
}
test('watchdog lease fixes the source, controller, inherited lock, operation directory and ten-minute window',()=>{
  assert.equal(assertBookingWatchdogLease(lease()),true);assert.equal(BOOKING_WATCHDOG_TRIGGER_MS,420000);
  for(const change of [l=>l.candidate='b'.repeat(40),l=>l.toolRevision='bad',l=>l.parent.pid=1,l=>l.parent.executable='/bin/sh',
    l=>l.parent.cwd='/other',l=>l.deploy.file='/other.lock',l=>l.operation.directory='/tmp',l=>l.routingPlanSha256='bad',
    l=>l.window.deadlineAt='2026-10-26T10:09:00.000Z',l=>l.window.deadlineAt='2026-10-26T10:11:00.000Z',l=>l.ignoreDeadline=true,
    l=>l.parent.startTicks='',l=>l.parent.commandSha256='bad',l=>l.parent.extra=true,l=>l.deploy.identity.uid=1,l=>l.deploy.identity.nlink=2,
    l=>l.deploy.identity.mode=0o100644,l=>l.operation.identity.mode=0o40755,l=>l.operation.identity.ino=0,l=>l.operation.identity.extra=true]){
    const l=lease();change(l);assert.throws(()=>assertBookingWatchdogLease(l));
  }
});
test('normal committed handoff disarms without a signal, recovery or process restart',async()=>{
  const f=fixture({completedAt:3});const r=await runBookingWatchdogLoop(f.operations,lease());assert.equal(r.outcome,'committed');
  assert.equal(f.calls.includes('stopOwnedParent'),false);assert.equal(f.recoveries(),0);assert.equal(f.calls[0],'verify');assert.equal(f.calls[1],'armed');
});
test('parent exit or PID reuse recovers exactly once without accepting a stale controller identity',async()=>{
  for(const state of ['absent','reused']){
    const f=fixture({states:[state]});const r=await runBookingWatchdogLoop(f.operations,lease());
    assert.equal(r.outcome,'recovered-failure');assert.equal(f.recoveries(),1);
    assert.ok(f.calls.indexOf('stopOwnedParent')<f.calls.indexOf('recover'));
  }
});
test('at seven minutes the owned controller is stopped and recovery receives the remaining three-minute reserve',async()=>{
  const f=fixture({elapsedStep:420000});const r=await runBookingWatchdogLoop(f.operations,lease());assert.equal(r.outcome,'recovered-failure');
  assert.equal(f.calls.filter(c=>c==='stopOwnedParent').length,1);assert.equal(f.recoveries(),1);
});
test('a just-committed handoff discovered after parent exit is never rolled back',async()=>{
  const f=fixture({states:['absent'],completedAt:2});const r=await runBookingWatchdogLoop(f.operations,lease());assert.equal(r.outcome,'committed-after-parent-exit');assert.equal(f.recoveries(),0);
});
test('a parent that remains owned after the termination step cannot race a recovery writer',async()=>{
  const f=fixture({states:['absent']});f.operations.parentState=async()=> 'owned';f.operations.elapsedMs=()=>420000;
  await assert.rejects(runBookingWatchdogLoop(f.operations,lease()),/parent_still_running/);assert.equal(f.recoveries(),0);
});
for(const failAt of ['verify','armed','completed','parentState','stopOwnedParent','recover','finish'])test('unknown '+failAt+' is not automatically replayed or marked as a successful handoff',async()=>{
  const f=fixture({states:['absent'],failAt});await assert.rejects(runBookingWatchdogLoop(f.operations,lease()),/unknown_/);
  assert.equal(f.calls.filter(c=>c===failAt).length,1);assert.ok(f.recoveries()<=1);
});
test('host arming checks source, two real entrypoints and actual private cohort before the gate changes',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)await assert.rejects(armBookingHandoffWatchdog({lock:true,toolRevision:revision}),/linux_root/);
  const source=readFileSync(new URL('./booking-handoff-watchdog.mjs',import.meta.url),'utf8');
  for(const s of ['assertOnlineRetentionHeldLocks(lock)','booking-handoff-host.mjs','booking-handoff-recovery.mjs','collectBookingAtomicRuntimeCohort',
    "stdio:['ignore',output,output,lock.deployFd]","process.kill(lease.parent.pid,'SIGTERM')","process.kill(lease.parent.pid,'SIGKILL')",'timeout:170000',
    'watchdog-armed.json','watchdog-finished.json','readOnlineToolInventory','fs.rmdirSync(OPERATION)'])assert.ok(source.includes(s),s);
  assert.doesNotMatch(source,/process\.kill\((?!lease\.parent\.pid)|\['stop'|\['restart'|\['delete'|set active=false|--force|--skip/);
});
