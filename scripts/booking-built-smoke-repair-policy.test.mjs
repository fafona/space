import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from './booking-built-smoke-repair-policy.mjs';
const receipt=()=>({schemaVersion:1,kind:'booking-built-smoke-tool-repair',originalTool:p.BOOKING_BUILT_SMOKE_PINS.originalTool,toolRevision:'a'.repeat(40),pinsSha256:p.bookingBuiltSmokePinsSha256,
 sourceInputsSha256:'b'.repeat(64),toolClosureSha256:'c'.repeat(64),changedToolFiles:[...p.BOOKING_BUILT_SMOKE_REPAIR_FILES].sort(),preparedAt:'2026-10-26T21:50:00.000Z'});
test('strict receipt binds one original tool and both fixed built artifacts',()=>{
 p.assertBookingBuiltSmokeReceipt(receipt(),{toolRevision:'a'.repeat(40)});
 for(const patch of [{extra:true},{originalTool:'d'.repeat(40)},{toolRevision:p.BOOKING_BUILT_SMOKE_PINS.originalTool},{pinsSha256:'d'.repeat(64)},{changedToolFiles:[]},{sourceInputsSha256:'x'},{toolClosureSha256:'x'},{preparedAt:'bad'}])assert.throws(()=>p.assertBookingBuiltSmokeReceipt({...receipt(),...patch}));
 assert.throws(()=>p.assertBookingBuiltSmokeReceipt(receipt(),{toolRevision:'e'.repeat(40)}));
 assert.equal(p.BOOKING_BUILT_SMOKE_PINS.pair.length,2);assert.equal(p.BOOKING_BUILT_SMOKE_PINS.pair[0].built.sha256,'572e503ac11738d9c87ae48e76f76bd9afdf650fa252a6ac7dfb58a7ec5989f0');
 assert.equal(p.BOOKING_BUILT_SMOKE_PINS.pair[1].built.sha256,'3b6b0ab719c85fbc0fbd4b68209511dd00621abfb4aafaf284bc2183bb4092a2');
});
test('tool scope excludes application, lockfile, migrations, guard bootstrap and unrelated tools',()=>{
 const value={files:[...p.BOOKING_BUILT_SMOKE_REPAIR_FILES],originalInputs:'exact tree',currentInputs:'exact tree'};assert.match(p.assertBookingBuiltSmokeToolDelta(value),/^[a-f0-9]{64}$/);
 for(const file of ['src/app/login/page.tsx','package-lock.json','scripts/prepare-online-release-tool.mjs','scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql','scripts/online-release-retention.mjs'])assert.throws(()=>p.assertBookingBuiltSmokeToolDelta({...value,files:[...value.files,file]}));
 assert.throws(()=>p.assertBookingBuiltSmokeToolDelta({...value,currentInputs:'changed'}));assert.throws(()=>p.assertBookingBuiltSmokeToolDelta({...value,files:value.files.slice(1)}));
});
test('only phase and normal DB proof metadata may change; original bytes always need fixed pin',()=>{
 const before={status:'preparing',target:'synthetic',runtime:'preserved',nested:{build:'unchanged'}},original=JSON.stringify(before);
 for(const phase of ['preparing','staged','database-ready']){const next={...before,status:phase,...(phase==='database-ready'?{bookingDatabaseProofSha256:'a'.repeat(64)}:{})};
  p.assertBookingBuiltSmokePhaseTransition(original,next,phase);
  for(const patch of [{target:'changed'},{runtime:'changed'},{extra:true},{nested:{build:'changed'}}])assert.throws(()=>p.assertBookingBuiltSmokePhaseTransition(original,{...next,...patch},phase));
  assert.throws(()=>p.assertBookingBuiltSmokeState(original,next,phase),/original_state/);
 }assert.throws(()=>p.assertBookingBuiltSmokePhaseTransition(original,{...before,status:'active'},'active'));
});
