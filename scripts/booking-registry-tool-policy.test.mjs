import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as p from './booking-registry-tool-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function registryReceiptFixture(){return {schemaVersion:1,kind:'booking-registry-tool',priorTool:p.BOOKING_REGISTRY_PRIOR_TOOL,
 originalTool:p.BOOKING_REGISTRY_ORIGINAL_TOOL,toolRevision:'f'.repeat(40),sourceInputsSha256:p.BOOKING_REGISTRY_INPUTS_SHA256,
 toolClosureSha256:'a'.repeat(64),preservedSha256:hash(JSON.stringify(p.BOOKING_REGISTRY_PRESERVED)),preparedAt:'2026-10-26T23:00:00.000Z'};}
test('source scope is exactly twenty-four tool/test files; unchanged inputs include old guard, app, dependencies and migrations',()=>{
 const files=p.BOOKING_REGISTRY_TOOL_FILES;
 assert.equal(files.length,24);assert.equal(new Set(files).size,24);assert.ok(files.every(f=>f.startsWith('scripts/')));
 for(const forbidden of ['scripts/attendance-extension-metadata.mjs','scripts/prepare-online-release-tool.mjs','scripts/create-production-database-backup.mjs',
  'scripts/verify-production-database-backup.mjs','scripts/attendance-production-database-migrations.mjs','package.json','package-lock.json'])assert.ok(!files.includes(forbidden));
 // A CI checkout need not contain historical objects. The fixed predecessor
 // digest still binds every current non-allowlisted input, without fetching or
 // skipping anything. The production verifier separately reads BOTH revisions.
 // Project only the six new formal-backup successor files out of this sealed
 // predecessor test. Its runtime policy/digest are unchanged; the new policy
 // test separately pins every current non-allowlisted blob.
 const successorAdded=['scripts/booking-formal-backup-policy.mjs','scripts/booking-formal-backup-policy.test.mjs',
  'scripts/booking-formal-backup-tool.mjs','scripts/booking-formal-backup-tool.test.mjs',
  'scripts/booking-formal-backup.mjs','scripts/booking-formal-backup.test.mjs'];
 const original=execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean)
  .filter(row=>!files.includes(row.slice(row.indexOf('\t')+1))&&!successorAdded.includes(row.slice(row.indexOf('\t')+1))).join('\0');
 assert.equal(p.assertBookingRegistryToolDelta({files,originalInputs:original,currentInputs:original}),p.BOOKING_REGISTRY_INPUTS_SHA256);
 for(const patch of [{files:files.slice(1)},{files:[...files,files[0]]},{files:[...files.slice(1),'src/app/login/page.tsx']},{currentInputs:original+'changed'},{originalInputs:'fake',currentInputs:'fake'}])
  assert.throws(()=>p.assertBookingRegistryToolDelta({files,originalInputs:original,currentInputs:original,...patch}));
});
test('successor receipt binds prior smoke tool, original build tool, complete failure evidence and exact shape',()=>{
 const receipt=registryReceiptFixture();assert.equal(p.assertBookingRegistryToolReceipt(receipt,receipt.toolRevision),true);
 for(const patch of [{schemaVersion:2},{kind:'skip'},{priorTool:'b'.repeat(40)},{originalTool:'b'.repeat(40)},{sourceInputsSha256:'b'.repeat(64)},
  {toolClosureSha256:'bad'},{preservedSha256:'b'.repeat(64)},{preparedAt:'bad'},{extra:true},{toolRevision:'b'.repeat(40)}])
  assert.throws(()=>p.assertBookingRegistryToolReceipt({...receipt,...patch},receipt.toolRevision));
 const absent={...receipt};delete absent.priorTool;assert.throws(()=>p.assertBookingRegistryToolReceipt(absent,receipt.toolRevision));
 assert.equal(Object.keys(p.BOOKING_REGISTRY_PRESERVED).length,11);
 for(const name of ['booking-compatibility-attempt.json','booking-compatibility-extension.json','booking-compatibility-metadata.sql','booking-compatibility-supplement.sql','built-smoke-tool-repair.json','built-smoke-original-state.json'])
  assert.match(p.BOOKING_REGISTRY_PRESERVED[name],/^[a-f0-9]{64}$/);
});
