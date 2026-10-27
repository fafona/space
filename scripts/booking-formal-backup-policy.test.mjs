import {projectBookingCiPredecessorRows} from './booking-ci-continuation-policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as p from './booking-formal-backup-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function formalReceiptFixture(){return {schemaVersion:1,kind:'booking-formal-backup-tool',priorTool:p.BOOKING_FORMAL_PRIOR_TOOL,
 toolRevision:'f'.repeat(40),sourceInputsSha256:p.BOOKING_FORMAL_INPUTS_SHA256,toolClosureSha256:'a'.repeat(64),
 preservedSha256:hash(JSON.stringify(p.BOOKING_FORMAL_PRESERVED)),preparedAt:'2026-10-27T03:00:00.000Z'};}
test('independent successor is exactly nineteen tool/test files and pins all non-allowlisted blobs',()=>{
 const files=p.BOOKING_FORMAL_FILES;assert.equal(files.length,19);assert.equal(new Set(files).size,19);
 for(const forbidden of ['scripts/create-production-database-backup.mjs','scripts/verify-production-database-backup.mjs',
  'scripts/attendance-production-database-migrations.mjs','scripts/database-backup-contract.mjs','scripts/check-database-backup-readiness.mjs',
  'scripts/prepare-online-release-tool.mjs','scripts/booking-registry-tool.mjs','scripts/booking-registry-tool-policy.mjs','scripts/booking-registry-backup.mjs',
  'scripts/booking-publication-compatibility.mjs','package.json','package-lock.json'])assert.ok(!files.includes(forbidden));
 const rows=projectBookingCiPredecessorRows(execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean))
  .filter(row=>!files.includes(row.slice(row.indexOf('\t')+1))).join('\0');
 assert.equal(p.assertBookingFormalToolDelta({files,originalInputs:rows,currentInputs:rows}),p.BOOKING_FORMAL_INPUTS_SHA256);
 for(const patch of [{files:files.slice(1)},{files:[...files,files[0]]},{files:[...files.slice(1),'src/app/login/page.tsx']},
  {currentInputs:rows+'changed'},{originalInputs:'fake',currentInputs:'fake'}])assert.throws(()=>p.assertBookingFormalToolDelta({files,originalInputs:rows,currentInputs:rows,...patch}));
});
test('new receipt binds immutable predecessor and all eleven completed/wrong-backup artifacts',()=>{
 const receipt=formalReceiptFixture();assert.equal(p.assertBookingFormalToolReceipt(receipt,receipt.toolRevision),true);
 assert.equal(Object.keys(p.BOOKING_FORMAL_PRESERVED).length,11);
 assert.equal(p.BOOKING_FORMAL_PRESERVED['database.tar.enc'].bytes,549908512);
 for(const pin of Object.values(p.BOOKING_FORMAL_PRESERVED)){assert.match(pin.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);}
 for(const patch of [{schemaVersion:2},{kind:'skip'},{priorTool:'b'.repeat(40)},{toolRevision:'b'.repeat(40)},
  {sourceInputsSha256:'b'.repeat(64)},{toolClosureSha256:'bad'},{preservedSha256:'b'.repeat(64)},{preparedAt:'bad'},{extra:true}])
  assert.throws(()=>p.assertBookingFormalToolReceipt({...receipt,...patch},receipt.toolRevision));
 assert.throws(()=>p.assertBookingFormalToolReceipt(receipt,p.BOOKING_FORMAL_PRIOR_TOOL));
 const absent={...receipt};delete absent.preservedSha256;assert.throws(()=>p.assertBookingFormalToolReceipt(absent,receipt.toolRevision));
});
