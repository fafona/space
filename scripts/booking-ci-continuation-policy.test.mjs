import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import * as p from './booking-ci-continuation-policy.mjs';
import {projectBookingDependencyPredecessorRows} from './booking-dependency-continuation-policy.mjs';
import {projectBookingReadyPredecessorRows} from './booking-ready-policy.mjs';
import {BOOKING_FORMAL_PRESERVED,BOOKING_FORMAL_FILES,assertBookingFormalToolDelta} from './booking-formal-backup-policy.mjs';
import {BOOKING_HANDOFF_CANDIDATE,BOOKING_HANDOFF_TOOL_FILES,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const currentRows=()=>projectBookingDependencyPredecessorRows(projectBookingReadyPredecessorRows(execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:new URL('../',import.meta.url)}).toString().split('\0').filter(Boolean)));
export function ciReceiptFixture(){return {schemaVersion:1,kind:'booking-ci-continuation-tool',priorTool:'0b0f3f9dbe60a2fa3553c3b510a937cd13c4bd35',
 base:p.BOOKING_CI_BASE,verifiedCiSource:p.BOOKING_CI_VERIFIED_SOURCE,toolRevision:'f'.repeat(40),sourceInputsSha256:p.BOOKING_CI_INPUTS_SHA256,
 toolClosureSha256:'a'.repeat(64),preservedSha256:hash(JSON.stringify(BOOKING_FORMAL_PRESERVED)),
 kernelEvidenceSha256:hash(JSON.stringify(p.BOOKING_CI_EVIDENCE)),preparedAt:'2026-10-27T18:00:00.000Z'};}
test('fixed successor pins every actual non-allowlisted tree entry and exactly four verified CI blobs',()=>{
 const files=p.BOOKING_CI_FILES,inputs=p.bookingCiInputs(currentRows());
 assert.equal(files.length,22);assert.equal(new Set(files).size,22);assert.equal(Object.keys(p.BOOKING_CI_PINS).length,4);
 assert.equal(p.assertBookingCiToolDelta({files,originalInputs:inputs,currentInputs:inputs,readBlob:read}),p.BOOKING_CI_INPUTS_SHA256);
 for(const f of ['src/app/login/page.tsx','package.json','package-lock.json','scripts/prepare-online-release-tool.mjs',
  'scripts/booking-formal-backup-tool.mjs','scripts/booking-formal-backup-policy.mjs','scripts/booking-handoff-policy.mjs',
  'scripts/create-production-database-backup.mjs','scripts/verify-production-database-backup.mjs','scripts/booking-registry-tool.mjs'])assert.ok(!files.includes(f),f);
 for(const patch of [{files:files.slice(1)},{files:[...files,files[0]]},{files:[...files,'src/app/login/page.tsx']},
  {currentInputs:inputs+'changed'},{originalInputs:'fake',currentInputs:'fake'}])
  assert.throws(()=>p.assertBookingCiToolDelta({files,originalInputs:inputs,currentInputs:inputs,readBlob:read,...patch}));
 for(const file of Object.keys(p.BOOKING_CI_PINS))assert.throws(()=>p.assertBookingCiToolDelta({files,originalInputs:inputs,currentInputs:inputs,
  readBlob:f=>read(f)+(f===file?'\nchanged':'')}),/ci_content/);
});
test('old source guard still rejects raw current source; projection is limited to the fixed predecessor rows',()=>{
 const rows=currentRows(),outside=rows.filter(r=>!BOOKING_FORMAL_FILES.includes(r.slice(r.indexOf('\t')+1))).join('\0');
 assert.throws(()=>assertBookingFormalToolDelta({files:BOOKING_FORMAL_FILES,originalInputs:outside,currentInputs:outside}),/application_inputs/);
 const restored=p.projectBookingCiPredecessorRows(rows),projected=restored.filter(r=>!BOOKING_FORMAL_FILES.includes(r.slice(r.indexOf('\t')+1))).join('\0');
 assert.doesNotThrow(()=>assertBookingFormalToolDelta({files:BOOKING_FORMAL_FILES,originalInputs:projected,currentInputs:projected}));
 assert.equal(restored.find(r=>r.endsWith('\tpackage.json')),rows.find(r=>r.endsWith('\tpackage.json')));
 for(const rows of [['bad'],['100644 blob '+'a'.repeat(40)+'\tsame','100644 blob '+'b'.repeat(40)+'\tsame']])assert.throws(()=>p.bookingCiInputs(rows),/tree/);
 const fixture=JSON.parse(read('scripts/test-support/booking-ci-source-base.json'));
 assert.equal(fixture.revision,p.BOOKING_CI_BASE);assert.equal(hash(fixture.workflow),'de31f136f75744c1dee97774d171821ff54571c4c061f2f015ade85ccf73a534');
});
test('new closure is exact; unchanged old closure remains independently accepted with no new files',()=>{
 const old={baseline:BOOKING_HANDOFF_CANDIDATE,files:BOOKING_HANDOFF_TOOL_FILES,readBlob:()=>Buffer.from('synthetic-old-tool')};
 assert.equal(p.assertBookingCurrentToolClosure(old),assertBookingHandoffToolClosure(old));
 const input={baseline:BOOKING_HANDOFF_CANDIDATE,files:p.BOOKING_CI_TOOL_FILES,readBlob:read};
 assert.equal(input.files.length,97);assert.match(p.assertBookingCurrentToolClosure(input),/^[a-f0-9]{64}$/);
 assert.throws(()=>assertBookingHandoffToolClosure(input),/tool_scope/);
 for(const patch of [{baseline:'a'.repeat(40)},{files:input.files.slice(1)},{files:[...input.files,input.files[0]]},
  {files:[...input.files,'package.json']},{readBlob:f=>read(f)+(f==='.github/workflows/ci.yml'?'changed':'')}])
  assert.throws(()=>p.assertBookingCurrentToolClosure({...input,...patch}));
});
test('receipt binds exact predecessor, verified CI source and both retained evidence sets',()=>{
 const receipt=ciReceiptFixture();assert.equal(p.assertBookingCiReceipt(receipt,receipt.toolRevision),true);
 for(const patch of [{schemaVersion:2},{kind:'skip'},{priorTool:'b'.repeat(40)},{base:'b'.repeat(40)},{verifiedCiSource:'b'.repeat(40)},
  {toolRevision:'b'.repeat(40)},{sourceInputsSha256:'b'.repeat(64)},{toolClosureSha256:'bad'},{preservedSha256:'b'.repeat(64)},
  {kernelEvidenceSha256:'b'.repeat(64)},{preparedAt:'bad'},{extra:true}])assert.throws(()=>p.assertBookingCiReceipt({...receipt,...patch},receipt.toolRevision));
 for(const revision of [p.BOOKING_CI_BASE,p.BOOKING_CI_VERIFIED_SOURCE,receipt.priorTool,null])assert.throws(()=>p.assertBookingCiReceipt({...receipt,toolRevision:revision},revision));
 const missing={...receipt};delete missing.kernelEvidenceSha256;assert.throws(()=>p.assertBookingCiReceipt(missing,receipt.toolRevision));
});
