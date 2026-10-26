import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeBookingBuiltSmokeContinuation,bookingBuiltSmokeRepairImportClosure,prepareBookingBuiltSmokeRepair,assertBookingBuiltSmokeRuntimeContinuation} from './booking-built-smoke-repair.mjs';
import {BOOKING_BUILT_SMOKE_REPAIR_FILES} from './booking-built-smoke-repair-policy.mjs';
import {assertBookingHandoffToolNoPending} from './booking-handoff-pending.mjs';
const read=file=>readFileSync(new URL('./'+file,import.meta.url),'utf8');
test('exact continuation uses every acceptance gate then only one normal status write',async()=>{
 const calls=[];let observations=0;const ops={observe:phase=>{calls.push('observe:'+phase);observations++;return {built:'original'};},bundle:()=>calls.push('bundle'),verify:()=>calls.push('verify'),smoke:()=>calls.push('smoke'),ready:()=>calls.push('ready')};
 await executeBookingBuiltSmokeContinuation(ops);assert.equal(observations,3);assert.deepEqual(calls,['observe:preparing','bundle','verify','smoke','observe:preparing','ready','observe:staged']);
 for(const failAt of ['bundle','verify','smoke','ready']){const trace=[];const bad={...ops,observe:()=>({built:'original'})};for(const key of ['bundle','verify','smoke','ready'])bad[key]=()=>{trace.push(key);if(key===failAt)throw Error('unconfirmed');};
  await assert.rejects(executeBookingBuiltSmokeContinuation(bad),/unconfirmed/);assert.equal(trace.filter(k=>k===failAt).length,1);if(failAt!=='ready')assert.equal(trace.includes('ready'),false);
 }let count=0,saved=false;await assert.rejects(executeBookingBuiltSmokeContinuation({...ops,observe:()=>({changed:++count}),ready:()=>{saved=true;}}),/continuity_changed/);assert.equal(saved,false);
});
test('source-only repair has original bootstrap checks, exact source/pins, normal locks, no build or business actuator',()=>{
 const code=read('booking-built-smoke-repair.mjs');
 for(const token of ['verifyOnlineToolBootstrap(plan,','assertBookingBuiltSmokeToolDelta','assertBookingHandoffToolClosure','withOnlineToolPreparationLocks(','assertBookingBuiltSmokeToolNoPending()','executeOnlineReleaseToolPlan(','same(observeBookingBuiltSmokePair(),before','BOOKING_BUILT_SMOKE_ORIGINAL','O_EXCL','candidate_blob','dependencies','built_output','processesSha256','assertOnlineRetentionPublication'])assert.ok(code.includes(token),token);
 assert.doesNotMatch(code,/\['(?:start|stop|restart|reload|delete|save)'\]|command\('npm'|command\('node'|bookingHostSql|unlinkSync|rmSync|--force|--skip/);
 const standard=read('prepare-online-release-tool.mjs');assert.ok(!standard.includes('booking-built-smoke'));
 const pending=read('booking-handoff-pending.mjs');assert.match(pending,/const pair=observeBookingBuiltSmokePair\(\);return bookingHandoffPendingBody/);
 for(const name of BOOKING_BUILT_SMOKE_REPAIR_FILES)assert.ok(name.startsWith('scripts/'));
});
test('bootstrap import closure resolves actual static imports including its cycle and rejects external relative traversal',()=>{
 const files=bookingBuiltSmokeRepairImportClosure(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'));assert.ok(files.includes('scripts/prepare-online-release-tool.mjs'));assert.ok(files.includes('scripts/booking-handoff-pending.mjs'));assert.ok(files.includes('scripts/booking-built-smoke-repair-policy.mjs'));assert.equal(new Set(files).size,files.length);
 assert.throws(()=>bookingBuiltSmokeRepairImportClosure(()=>"import '../outside.mjs';"),/import_path/);
});
test('actual operational entrypoints cannot be invoked by a non-host test or an unapproved caller',()=>{
 assert.throws(()=>prepareBookingBuiltSmokeRepair('a'.repeat(40),'not-approved'),/approval/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingBuiltSmokeRuntimeContinuation({toolRevision:'a'.repeat(40),primary:{},rollback:{}}),/invocation/);
 assert.throws(()=>assertBookingHandoffToolNoPending({},()=>{}, {preserved:{forged:true}}),/unexpected_pending_argument/);
});
