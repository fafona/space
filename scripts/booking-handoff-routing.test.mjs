import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {createBookingAtomicRoutingPlan,assertBookingAtomicRoutingPlan,assertBookingRoutingCurrent,executeBookingRoutingPhase} from './booking-handoff-routing.mjs';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';

const before=JSON.parse(readFileSync(new URL('./test-support/booking-handoff-routing-fixture.json',import.meta.url),'utf8'));
const anchor=(target,port)=>({target,name:'merchant-space-online-'+target.slice(0,12),directory:'/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online',port});
const window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
const plan=()=>createBookingAtomicRoutingPlan({before,primary:anchor(C,3106),rollback:anchor(A,3110),window});
const upstreams=text=>[...text.matchAll(/proxy_pass http:\/\/127\.0\.0\.1:(\d+);/g)].map(m=>Number(m[1]));
test('arming changes only the old card fallback; primary and recovery route every app upstream to compatible processes',()=>{
  const p=plan();assertBookingAtomicRoutingPlan(p);assert.deepEqual(p.before,before);
  for(const f of WEB_RELEASE_FILES){
    assert.deepEqual(upstreams(p.phases.primary[f]),f==='faolla_contact_card_release.conf'?[3106,3110]:upstreams(before[f]).map(()=>3106));
    assert.deepEqual(upstreams(p.phases.rollback[f]),upstreams(before[f]).map(()=>3110));
    assert.ok(!p.phases.primary[f].includes('127.0.0.1:3000;'));assert.ok(!p.phases.rollback[f].includes('127.0.0.1:3103;'));
    if(f!=='faolla_contact_card_release.conf')assert.equal(p.phases.armed[f],before[f]);
  }
  assert.deepEqual(upstreams(p.phases.armed['faolla_contact_card_release.conf']),[3103,3110]);
  assert.equal((p.phases.primary['faolla_contact_card_release.conf'].match(new RegExp('"'+C+'"','g'))??[]).length,1);
  assert.equal((p.phases.primary['faolla_contact_card_release.conf'].match(new RegExp('"'+A+'"','g'))??[]).length,1);
});
test('all location structures, headers and non-app routing remain exact after reversing the explicitly changed tokens',()=>{
  const p=plan();
  for(const phase of ['armed','primary','rollback'])for(const f of WEB_RELEASE_FILES){
    const tree=parseNginx(p.phases[phase][f],WEB_RELEASE_PROXY+'/'+f),old=parseNginx(before[f],WEB_RELEASE_PROXY+'/'+f);
    assert.deepEqual(tree.map(n=>[n.name,n.args]),old.map(n=>[n.name,n.args]));
    let normalized=p.phases[phase][f].replaceAll('127.0.0.1:3106;','127.0.0.1:3103;');
    if(f==='faolla_contact_card_release.conf'){
      const split=normalized.indexOf('location @faolla_contact_card_previous');
      normalized=normalized.slice(0,split).replaceAll('127.0.0.1:3110;','127.0.0.1:3103;')+normalized.slice(split).replaceAll('127.0.0.1:3110;','127.0.0.1:3000;');
      normalized=normalized.replaceAll('"'+C+'"','"'+B+'"').replaceAll('"'+A+'"','"'+B+'"');
    }else normalized=normalized.replaceAll('127.0.0.1:3110;','127.0.0.1:3103;');
    assert.equal(normalized,before[f]);
  }
});
test('unreviewed baseline, out-of-window scope, forged targets and additional file/phase changes fail closed',()=>{
  for(const change of [i=>i.before[WEB_RELEASE_FILES[0]]+='\n',i=>i.before.extra='x',i=>i.primary.port=3103,i=>i.primary.target=B,
    i=>i.rollback.port=i.primary.port,i=>i.window.deadlineAt='2026-10-26T10:11:00.000Z']){
    const i={before:structuredClone(before),primary:anchor(C,3106),rollback:anchor(A,3110),window:structuredClone(window)};change(i);assert.throws(()=>createBookingAtomicRoutingPlan(i));
  }
  const p=plan();p.phases.rollback[WEB_RELEASE_FILES[0]]+='\n';assert.throws(()=>assertBookingAtomicRoutingPlan(p));
});
function fixture(phase='primary',failAt){
  const p=plan(),events=[];let current=structuredClone(phase==='armed'?p.before:phase==='primary'?p.phases.armed:p.phases.primary),receipt;
  const step=(name,work=()=>{})=>async(...args)=>{events.push(name);if(name===failAt)throw Error('unknown_'+name);return work(...args);};
  const operations={now:()=> '2026-10-26T10:01:00.000Z',read:async()=>structuredClone(current),authorize:step('authorize'),begin:step('begin'),
    replace:step('replace',(file,expected,next)=>{assert.equal(current[file],expected);current[file]=next;}),syntax:step('syntax'),reload:step('reload'),verify:step('verify'),
    complete:step('complete',v=>{receipt=v;})};
  return {p,events,operations,current:()=>current,receipt:()=>receipt};
}
for(const phase of ['armed','primary','rollback'])test('actual routing order for '+phase+' validates all owned files before the reload and public verification',async()=>{
  const f=fixture(phase),r=await executeBookingRoutingPhase(f.operations,f.p,phase);
  assert.deepEqual(f.events,['authorize','begin','replace','replace','replace','syntax','reload','verify','complete']);
  assert.equal(r.phase,phase);assertBookingRoutingCurrent(f.p,f.current(),{phase});
});
test('partial atomic switching can recover only through exact owned bytes to 6c; arbitrary drift and legacy restore are rejected',async()=>{
  const f=fixture('rollback');f.operations.read=async()=>({...f.p.phases.armed,[WEB_RELEASE_FILES[1]]:f.p.phases.primary[WEB_RELEASE_FILES[1]]});
  assertBookingRoutingCurrent(f.p,await f.operations.read());
  const bad={...f.p.phases.primary,[WEB_RELEASE_FILES[0]]:'server { proxy_pass http://127.0.0.1:3000; }'};
  assert.throws(()=>assertBookingRoutingCurrent(f.p,bad),/unowned_current/);
  await assert.rejects(executeBookingRoutingPhase(f.operations,f.p,'baseline'),/phase/);
  await assert.rejects(executeBookingRoutingPhase(f.operations,f.p,'armed'),/arming_requires_baseline/);
});
for(const phase of ['armed','primary','rollback'])for(const stage of ['authorize','begin','replace','syntax','reload','verify','complete'])test(phase+' unknown '+stage+' retains failure, never automatically restores legacy routing',async()=>{
  const f=fixture(phase,stage);await assert.rejects(executeBookingRoutingPhase(f.operations,f.p,phase),/unknown_/);
  assert.equal(f.events.filter(n=>n===stage).length,1);assert.equal(f.receipt(),undefined);
});
test('binary asset hashes distinguish arbitrary bytes, while host copies use exclusive, fsynced, non-destructive operations',()=>{
  const hash=v=>createHash('sha256').update(v).digest('hex');assert.notEqual(hash(Buffer.from([0xff])),hash(Buffer.from([0xfe])));
  const source=readFileSync(new URL('./booking-handoff-routing.mjs',import.meta.url),'utf8');
  assert.match(source,/const bytes=readBytes\(source\+'\/'\+e.name,false,true\)/);assert.match(source,/fs\.constants\.COPYFILE_EXCL/);
  for(const required of ['cohort_static_collision','existing_static_collision','assertOnlineRetentionHeldLocks(lock)','verifyOnlineReleaseTool','assertBookingHandoffToolClosure','atomic-private-runtime-ready','activation-attempt.json'])assert.ok(source.includes(required),required);
  assert.doesNotMatch(source,/unlinkSync|rmSync|rmdirSync|process\.argv|--force|--skip|restoreConfigs|set active=false/);
});
