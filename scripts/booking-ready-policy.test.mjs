import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {historicalToolTreeRows,readHistoricalCiBlob,HISTORICAL_CI_FILES} from './test-support/release-toolchain-historical-fixture.mjs';
import * as p from './booking-ready-policy.mjs';
import {bookingDependencyInputs,assertBookingDependencyToolDelta,assertBookingDependencyToolClosure,BOOKING_DEPENDENCY_FILES,BOOKING_DEPENDENCY_TOOL_FILES} from './booking-dependency-continuation-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_READY_EVIDENCE} from './booking-ready-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),read=f=>HISTORICAL_CI_FILES.includes(f)?readHistoricalCiBlob(f):readFileSync(new URL('../'+f,import.meta.url),'utf8').replaceAll('\r\n','\n');
const tree=revision=>execFileSync('git',['ls-tree','-r','-z',revision],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean);
test('independent exact32 historical successor binds captured raw tree, unchanged app/deps/SQL/old guards and CI pins',()=>{
 // Immutable evidence works in shallow CI. Production still reads BOTH raw
 // revisions; the historical policy must reject today's unrelated changes.
 const head=p.bookingReadyInputs(tree('HEAD'));
 assert.throws(()=>p.assertBookingReadyDelta({files:p.BOOKING_READY_FILES,originalInputs:head,currentInputs:head,readBlob:read}),/application_inputs/);
 const actual=historicalToolTreeRows(),inputs=p.bookingReadyInputs(actual),before=p.bookingReadyInputs(p.projectBookingReadyPredecessorRows(actual));
 assert.equal(p.BOOKING_READY_FILES.length,32);assert.equal(hash(inputs),p.BOOKING_READY_INPUTS_SHA256);assert.equal(inputs,before);
 const value={files:p.BOOKING_READY_FILES,originalInputs:before,currentInputs:inputs,readBlob:read};
 assert.equal(p.assertBookingReadyDelta(value),hash(inputs));
 for(const patch of [{files:value.files.slice(1)},{files:[...value.files,value.files[0]]},{files:[...value.files,'package.json']},
 {originalInputs:'fake',currentInputs:'fake'},{currentInputs:inputs+'drift'},{readBlob:()=>Buffer.from('changed')}])assert.throws(()=>p.assertBookingReadyDelta({...value,...patch}));
 const original=p.projectBookingReadyPredecessorRows(actual),old=bookingDependencyInputs(original);
 const raw=bookingDependencyInputs(actual);assert.throws(()=>assertBookingDependencyToolDelta({files:BOOKING_DEPENDENCY_FILES,originalInputs:raw,currentInputs:raw,readBlob:read}),/application_inputs/);
 assert.doesNotThrow(()=>assertBookingDependencyToolDelta({files:BOOKING_DEPENDENCY_FILES,originalInputs:old,currentInputs:old,readBlob:read}));
 for(const f of ['package.json','package-lock.json','scripts/booking-dependency-continuation-policy.mjs','scripts/booking-dependency-continuation-tool.mjs',
 'scripts/prepare-online-release-tool.mjs','scripts/booking-handoff-policy.mjs','scripts/booking-handoff-pending.mjs','.github/workflows/ci.yml'])assert.ok(!value.files.includes(f),f);
 for(const invalid of [['bad'],['100644 blob '+'a'.repeat(40)+'\tx','100644 blob '+'b'.repeat(40)+'\tx']])assert.throws(()=>p.bookingReadyInputs(invalid));
});
test('new exact closure cannot widen predecessor, accept extra application files, duplicate files or a subset',()=>{
 const value={baseline:C,files:p.BOOKING_READY_TOOL_FILES,readBlob:read};
 assert.match(p.assertBookingReadyClosure(value),/^[a-f0-9]{64}$/);assert.throws(()=>assertBookingDependencyToolClosure(value));
 const old={...value,files:BOOKING_DEPENDENCY_TOOL_FILES};assert.equal(p.assertBookingReadyClosure(old),assertBookingDependencyToolClosure(old));
 for(const patch of [{baseline:'a'.repeat(40)},{files:value.files.slice(1)},{files:[...value.files,value.files[0]]},{files:[...value.files,'package.json']}])assert.throws(()=>p.assertBookingReadyClosure({...value,...patch}));
});
test('receipt fixes the original501 ready source and all retained failed/native/config evidence without repinning user data',()=>{
 const evidence=hash(JSON.stringify(BOOKING_READY_EVIDENCE)),revision='f'.repeat(40),receipt={schemaVersion:1,kind:'booking-ready-continuation-tool',priorTool:p.BOOKING_READY_BASE,toolRevision:revision,
 sourceInputsSha256:p.BOOKING_READY_INPUTS_SHA256,toolClosureSha256:'a'.repeat(64),readyEvidenceSha256:evidence,preparedAt:'2026-10-27T20:30:00.000Z'};
 assert.equal(p.assertBookingReadyReceipt(receipt,revision,evidence),true);
 for(const patch of [{priorTool:'a'.repeat(40)},{kind:'skip'},{schemaVersion:2},{toolRevision:'b'.repeat(40)},{sourceInputsSha256:'b'.repeat(64)},
 {readyEvidenceSha256:'b'.repeat(64)},{toolClosureSha256:'bad'},{preparedAt:'bad'},{extra:true}])assert.throws(()=>p.assertBookingReadyReceipt({...receipt,...patch},revision,evidence));
 const pins=Object.keys(BOOKING_READY_EVIDENCE);assert.equal(pins.length,36);assert.ok(pins.some(f=>f.endsWith('/runtime-ready.json')));assert.ok(pins.some(f=>f.endsWith('/owned-cleanup-completed.json')));
 assert.equal(pins.some(f=>f.endsWith('/state.json')),false);assert.ok(pins.some(f=>f.endsWith('/atomic-runtime.json')));
});
