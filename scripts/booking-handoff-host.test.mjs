import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingHandoffPublication,executeBookingHandoffHost} from './booking-handoff-host.mjs';
import {bookingHandoffFixture} from './test-support/booking-handoff-retention-fixture.mjs';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
const names=['admit','preflight','plans','arm','gateAndDrain','armCompatibleFallback','activate','pauseOriginalOnce','routePrimary','unfence','publication','journal','worker','finishSupervisor'];
function fixture(failAt){
 const events=[],window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
 return {events,operations:{nowMs:()=>Date.parse(window.startedAt),...Object.fromEntries(names.map(name=>[name,async()=>{
  events.push(name);if(name===failAt)throw Error('unknown_'+name);return name==='plans'?window:{kind:name};
 }]))}};
}
test('normal host order holds the independent supervisor through strict journal commit and worker admission',async()=>{
 const f=fixture();const result=await executeBookingHandoffHost(f.operations);assert.deepEqual(f.events,names);assert.equal(result.watchdog.kind,'finishSupervisor');
 assert.ok(f.events.indexOf('activate')<f.events.indexOf('pauseOriginalOnce'));
 assert.ok(f.events.indexOf('armCompatibleFallback')<f.events.indexOf('activate'));
 assert.ok(f.events.indexOf('journal')<f.events.indexOf('worker'));
});
for(const name of names)test('unknown '+name+' terminates the controller without replay, worker enable, or unsafe legacy restoration',async()=>{
 const f=fixture(name);await assert.rejects(executeBookingHandoffHost(f.operations),new RegExp('unknown_'+name));
 assert.deepEqual(f.events,names.slice(0,names.indexOf(name)+1));assert.equal(f.events.filter(n=>n===name).length,1);
});
test('actual publication construction validates complete handoff before changing either metadata file',()=>{
 const f=bookingHandoffFixture(),h=f.handoff;
 const input={history:f.history,originalStageText:h.originalStageText,cohort:{active:f.active,rollback:f.rollback,processes:f.after,runtimeByName:h.runtimeByName},
  legacyTransition:{legacyBefore:h.legacyBefore,legacyAfter:h.legacyAfter},activation:{before:h.databaseBefore,after:h.databaseAfter},ruleRepair:h.ruleRepair,rollbackReadiness:h.rollbackReadiness,evidence:h.evidence};
 const result=bookingHandoffPublication(input);assert.deepEqual(result.handoff,h);assert.equal(result.state.baseline,APPLICATION);
 assert.equal(result.state.bookingHandoffSha256,retentionHash(h));assert.equal(result.stateText,JSON.stringify(result.state,null,2));
 assert.deepEqual(result.state.processes,JSON.parse(h.originalStageText).processes);
 for(const change of [v=>v.cohort.processes.pop(),v=>v.ruleRepair.fieldCount=28,v=>v.evidence.backupSha256='bad',v=>v.legacyTransition.legacyAfter.pid=1590381,
  v=>v.activation.after.active=false,v=>v.rollbackReadiness.target='a'.repeat(40)]){const v=structuredClone(input);change(v);assert.throws(()=>bookingHandoffPublication(v));}
});
test('fixed CLI has no force, skip, alternate candidate, synthetic acceptance, generic rollback or mail configuration path',()=>{
 const source=readFileSync(new URL('./booking-handoff-host.mjs',import.meta.url),'utf8');
 assert.match(source,/process\.argv\.length===2/);assert.match(source,/withOnlineRetentionLocks/);assert.match(source,/nativeAcceptance\(toolRevision\)/);
 assert.doesNotMatch(source,/process\.env|--(?:force|skip)|activateCandidate|restoreConfigs|RESEND_API_KEY|BOOKING_CONFIRMATION_EMAIL_FROM/);
});
test('a claimed supervisor lease keeps the real kernel lock and operation directory if the controller fails',()=>{
 const source=readFileSync(new URL('./booking-handoff-host.mjs',import.meta.url),'utf8');
 assert.match(source,/lease\?\.parent\?\.pid===process\.pid&&lease\.toolRevision===toolRevision/);
 assert.match(source,/finally\{console\.error\('booking_handoff_controller_failed_independent_recovery_retains_lock'\);process\.exit\(1\);\}/);
 assert.doesNotMatch(source,/rmdirSync|unlinkSync|flock.*unlock/);
});
