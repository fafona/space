import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {historicalToolTreeRows,readHistoricalCiBlob,HISTORICAL_CI_FILES} from './test-support/release-toolchain-historical-fixture.mjs';
import * as p from './booking-dependency-continuation-policy.mjs';
import {projectBookingReadyPredecessorRows} from './booking-ready-policy.mjs';
import {BOOKING_CI_FILES,bookingCiInputs,assertBookingCiToolDelta,BOOKING_CI_TOOL_FILES,assertBookingCurrentToolClosure} from './booking-ci-continuation-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=f=>HISTORICAL_CI_FILES.includes(f)?readHistoricalCiBlob(f):readFileSync(new URL('../'+f,import.meta.url),'utf8').replaceAll('\r\n','\n');
const rows=()=>projectBookingReadyPredecessorRows(historicalToolTreeRows());
test('exact25 historical successor independently binds its captured Git tree; predecessor stays sealed',()=>{
 const head=p.bookingDependencyInputs(execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean));
 assert.throws(()=>p.assertBookingDependencyToolDelta({files:p.BOOKING_DEPENDENCY_FILES,originalInputs:head,currentInputs:head,readBlob:read}),/application_inputs/);
 const actual=rows(),inputs=p.bookingDependencyInputs(actual),files=p.BOOKING_DEPENDENCY_FILES;
 assert.equal(files.length,25);assert.equal(hash(inputs),p.BOOKING_DEPENDENCY_INPUTS_SHA256);
 assert.equal(p.assertBookingDependencyToolDelta({files,originalInputs:inputs,currentInputs:inputs,readBlob:read}),hash(inputs));
 for(const f of ['package.json','package-lock.json','scripts/booking-handoff-policy.mjs','scripts/booking-handoff-pending.mjs',
  'scripts/prepare-online-release-tool.mjs','scripts/booking-ci-continuation-policy.mjs','scripts/booking-ci-continuation-tool.mjs',
  'scripts/booking-formal-backup.mjs','scripts/attendance-production-database-migrations.mjs','.github/workflows/ci.yml'])assert.ok(!files.includes(f));
 for(const patch of [{files:files.slice(1)},{files:[...files,files[0]]},{files:[...files,'package.json']},
  {currentInputs:inputs+'changed'},{originalInputs:'fake',currentInputs:'fake'},{readBlob:()=>Buffer.from('changed')}])
  assert.throws(()=>p.assertBookingDependencyToolDelta({files,originalInputs:inputs,currentInputs:inputs,readBlob:read,...patch}));
 const raw=bookingCiInputs(actual);assert.throws(()=>assertBookingCiToolDelta({files:BOOKING_CI_FILES,originalInputs:raw,currentInputs:raw,readBlob:read}),/application_inputs/);
 const predecessor=p.projectBookingDependencyPredecessorRows(actual),old=bookingCiInputs(predecessor);
 assert.doesNotThrow(()=>assertBookingCiToolDelta({files:BOOKING_CI_FILES,originalInputs:old,currentInputs:old,readBlob:read}));
 assert.equal(predecessor.find(r=>r.endsWith('\tpackage.json')),actual.find(r=>r.endsWith('\tpackage.json')));
 for(const invalid of [['bad'],['100644 blob '+'a'.repeat(40)+'\tx','100644 blob '+'b'.repeat(40)+'\tx']])assert.throws(()=>p.bookingDependencyInputs(invalid));
});
test('new107 closure never widens old97 or accepts a subset, duplicate or unrelated file',()=>{
 const input={baseline:C,files:p.BOOKING_DEPENDENCY_TOOL_FILES,readBlob:read};assert.equal(input.files.length,107);
 assert.match(p.assertBookingDependencyToolClosure(input),/^[a-f0-9]{64}$/);assert.throws(()=>assertBookingCurrentToolClosure(input));
 assert.equal(p.assertBookingDependencyToolClosure({...input,files:BOOKING_CI_TOOL_FILES}),assertBookingCurrentToolClosure({...input,files:BOOKING_CI_TOOL_FILES}));
 for(const patch of [{baseline:'a'.repeat(40)},{files:input.files.slice(1)},{files:[...input.files,input.files[0]]},{files:[...input.files,'package.json']}])
  assert.throws(()=>p.assertBookingDependencyToolClosure({...input,...patch}));
});
test('strict receipt fixes prior4005 and all16 retained evidence pins, including the formal backup and inactive install',()=>{
 assert.equal(Object.keys(p.BOOKING_DEPENDENCY_STOPPED).length,16);
 const receipt={schemaVersion:1,kind:'booking-dependency-continuation-tool',priorTool:p.BOOKING_DEPENDENCY_BASE,toolRevision:'f'.repeat(40),
 sourceInputsSha256:p.BOOKING_DEPENDENCY_INPUTS_SHA256,toolClosureSha256:'a'.repeat(64),stoppedEvidenceSha256:hash(JSON.stringify(p.BOOKING_DEPENDENCY_STOPPED)),preparedAt:'2026-10-27T19:00:00.000Z'};
 assert.equal(p.assertBookingDependencyReceipt(receipt,receipt.toolRevision),true);
 for(const patch of [{schemaVersion:2},{kind:'skip'},{priorTool:'a'.repeat(40)},{toolRevision:'b'.repeat(40)},{sourceInputsSha256:'b'.repeat(64)},
 {toolClosureSha256:'bad'},{stoppedEvidenceSha256:'b'.repeat(64)},{preparedAt:'bad'},{extra:true}])assert.throws(()=>p.assertBookingDependencyReceipt({...receipt,...patch},receipt.toolRevision));
 for(const revision of [p.BOOKING_DEPENDENCY_BASE,null])assert.throws(()=>p.assertBookingDependencyReceipt({...receipt,toolRevision:revision},revision));
});
