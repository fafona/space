import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as p from './booking-compatibility-tool-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function compatibilityReceiptFixture(){return {schemaVersion:1,kind:'booking-compatibility-tool',priorTool:p.BOOKING_COMPATIBILITY_PRIOR_TOOL,
 originalTool:p.BOOKING_COMPATIBILITY_ORIGINAL_TOOL,toolRevision:'f'.repeat(40),sourceInputsSha256:p.BOOKING_COMPATIBILITY_INPUTS_SHA256,
 toolClosureSha256:'a'.repeat(64),preservedSha256:hash(JSON.stringify(p.BOOKING_COMPATIBILITY_PRESERVED)),preparedAt:'2026-10-26T23:00:00.000Z'};}
test('source scope is exactly fifteen tool/test files; unchanged inputs include old guard, app, dependencies and migrations',()=>{
 const files=p.BOOKING_COMPATIBILITY_TOOL_FILES;
 assert.equal(files.length,15);assert.equal(new Set(files).size,15);assert.ok(files.every(f=>f.startsWith('scripts/')));
 for(const forbidden of ['scripts/attendance-extension-metadata.mjs','scripts/prepare-online-release-tool.mjs','package.json','package-lock.json'])assert.ok(!files.includes(forbidden));
 // A CI checkout need not contain historical objects. The fixed predecessor
 // digest still binds every current non-allowlisted input, without fetching or
 // skipping anything. The production verifier separately reads BOTH revisions.
 // Project only the explicitly approved successor delta back to this sealed
 // predecessor. Its validator and fixed digest are NOT widened. The successor
 // test independently binds every current non-allowlisted tree entry.
 const predecessorRows={"scripts/booking-handoff-execution.mjs":"100644 blob 3bf60348711aeb1e5689d2742e8a5adb8214c2a3\tscripts/booking-handoff-execution.mjs","scripts/booking-handoff-execution.test.mjs":"100644 blob 271d1e627302daae37389ea444cc24e93cb3e8ca\tscripts/booking-handoff-execution.test.mjs","scripts/booking-handoff-journal.mjs":"100644 blob 0f7e0770be3c01560682a97c8bc20d619d66aec9\tscripts/booking-handoff-journal.mjs","scripts/booking-handoff-journal.test.mjs":"100644 blob 7f05ebd5297508cc0329a0cac87e47004a5abc11\tscripts/booking-handoff-journal.test.mjs","scripts/booking-publication-database.mjs":"100644 blob f2b0b6655b2b722f7feb0d95ca8e04d18939a47e\tscripts/booking-publication-database.mjs","scripts/booking-publication-database.test.mjs":"100644 blob 0d1b0a1cbad9db23e45deb18efc17a44bc586bbc\tscripts/booking-publication-database.test.mjs"};
 const successorAdded=["scripts/booking-registry-backup.mjs","scripts/booking-registry-backup.test.mjs","scripts/booking-registry-extension.mjs","scripts/booking-registry-extension.test.mjs","scripts/booking-registry-tool-policy.mjs","scripts/booking-registry-tool-policy.test.mjs","scripts/booking-registry-tool.mjs","scripts/booking-registry-tool.test.mjs"];
 const original=execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean)
  .filter(row=>!files.includes(row.slice(row.indexOf('\t')+1))&&!successorAdded.includes(row.slice(row.indexOf('\t')+1)))
  .map(row=>predecessorRows[row.slice(row.indexOf('\t')+1)]??row).join('\0');
 assert.equal(p.assertBookingCompatibilityToolDelta({files,originalInputs:original,currentInputs:original}),p.BOOKING_COMPATIBILITY_INPUTS_SHA256);
 for(const patch of [{files:files.slice(1)},{files:[...files,files[0]]},{files:[...files.slice(1),'src/app/login/page.tsx']},{currentInputs:original+'changed'},{originalInputs:'fake',currentInputs:'fake'}])
  assert.throws(()=>p.assertBookingCompatibilityToolDelta({files,originalInputs:original,currentInputs:original,...patch}));
});
test('successor receipt binds prior smoke tool, original build tool, complete failure evidence and exact shape',()=>{
 const receipt=compatibilityReceiptFixture();assert.equal(p.assertBookingCompatibilityToolReceipt(receipt,receipt.toolRevision),true);
 for(const patch of [{schemaVersion:2},{kind:'skip'},{priorTool:'b'.repeat(40)},{originalTool:'b'.repeat(40)},{sourceInputsSha256:'b'.repeat(64)},
  {toolClosureSha256:'bad'},{preservedSha256:'b'.repeat(64)},{preparedAt:'bad'},{extra:true},{toolRevision:'b'.repeat(40)}])
  assert.throws(()=>p.assertBookingCompatibilityToolReceipt({...receipt,...patch},receipt.toolRevision));
 const absent={...receipt};delete absent.priorTool;assert.throws(()=>p.assertBookingCompatibilityToolReceipt(absent,receipt.toolRevision));
 assert.equal(Object.keys(p.BOOKING_COMPATIBILITY_PRESERVED).length,6);
 for(const name of ['booking-compatibility-attempt.json','booking-compatibility-extension.json','booking-compatibility-metadata.sql','booking-compatibility-supplement.sql','built-smoke-tool-repair.json','built-smoke-original-state.json'])
  assert.match(p.BOOKING_COMPATIBILITY_PRESERVED[name],/^[a-f0-9]{64}$/);
});
