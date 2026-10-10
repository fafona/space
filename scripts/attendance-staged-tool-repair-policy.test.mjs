import assert from 'node:assert/strict';import test from 'node:test';
import {ATTENDANCE_STAGED_REPAIR as p,ATTENDANCE_STAGED_REPAIR_PRESERVED as preserved,
 ATTENDANCE_STAGED_FOLLOW_ON as follow,ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON as sequence,ATTENDANCE_STAGED_ACL_FOLLOW_ON as acl,
 ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON as schema,
 ATTENDANCE_STAGED_REPAIR_FILES as allowed,
 assertAttendanceStagedRepairReceipt,assertAttendanceStagedFollowOnReceipt,
 assertAttendanceStagedSequenceFollowOnReceipt,assertAttendanceStagedAclFollowOnReceipt,
 assertAttendanceStagedSchemaFollowOnReceipt} from './attendance-staged-tool-repair-policy.mjs';
export function stagedRepairReceiptFixture(){return {schemaVersion:1,kind:'attendance-staged-tool-repair',target:p.target,baseline:p.baseline,
 toolRevision:'e'.repeat(40),originalStateSha256:p.stateSha256,originalBuildProofSha256:p.buildProofSha256,
 sourceInputsSha256:'a'.repeat(64),builtOutputSha256:p.builtOutputSha256,scopeSha256:p.scopeSha256,preservedFiles:{...preserved},
 activeSha256:p.activeSha256,maintenanceSha256:p.maintenanceSha256,markerSha256:p.markerSha256,retentionHeadSha256:p.retentionHeadSha256,
 dependencySha256:'b'.repeat(64),changedToolFiles:['scripts/attendance-production-052-compatibility.mjs'],approvedNoRebuild:true,preparedAt:'2026-10-10T04:00:00.000Z'};}
test('fixed repair receipt distinguishes application and tool identity, never fabricated build identity',()=>{
 const r=stagedRepairReceiptFixture();assert.equal(assertAttendanceStagedRepairReceipt(r),r);
 assert.throws(()=>assertAttendanceStagedRepairReceipt(r,{target:'d'.repeat(40)}));
 assert.throws(()=>assertAttendanceStagedRepairReceipt(r,{toolRevision:'f'.repeat(40)}));
});
test('fixed evidence, unchanged build/SQL/dependencies and no arbitrary skip/scope are mandatory',()=>{
 const r=stagedRepairReceiptFixture();
 for(const key of ['target','baseline','toolRevision','originalStateSha256','originalBuildProofSha256','sourceInputsSha256','builtOutputSha256',
  'scopeSha256','activeSha256','maintenanceSha256','markerSha256','retentionHeadSha256','dependencySha256','preparedAt'])
  assert.throws(()=>assertAttendanceStagedRepairReceipt({...r,[key]:'invalid'}),key);
 for(const changes of [{toolRevision:p.target},{approvedNoRebuild:false},{skip:true},{changedToolFiles:['src/app/admin/AdminClient.tsx']},
  {changedToolFiles:['scripts/supabase-migrations/202610090210_merchant_attendance_utc.sql']},{changedToolFiles:[]},
  {preservedFiles:{...preserved,'runtime.json':'0'.repeat(64)}}])assert.throws(()=>assertAttendanceStagedRepairReceipt({...r,...changes}));
 for(const key of Object.keys(r)){const v={...r};delete v[key];assert.throws(()=>assertAttendanceStagedRepairReceipt(v),key);}
});

export function stagedFollowOnReceiptFixture(){
 const original={...stagedRepairReceiptFixture(),toolRevision:follow.previousToolRevision};
 const preparedAt='2026-10-10T06:00:00.000Z',effectiveReceipt={...original,toolRevision:'f'.repeat(40),preparedAt,
  changedToolFiles:['scripts/attendance-production-052-compatibility.mjs','scripts/attendance-staged-tool-repair.mjs',
   'scripts/attendance-staged-tool-repair-policy.mjs']};
 return {original,chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-follow-on',target:p.target,baseline:p.baseline,
  previousToolRevision:follow.previousToolRevision,previousReceiptSha256:follow.previousReceiptSha256,
  failedAttemptArchive:structuredClone(follow.archive),effectiveReceipt,preparedAt}};
}
test('one follow-on distinguishes its effective revision from the fixed original receipt and archived failed attempt',()=>{
 const {original,chain}=stagedFollowOnReceiptFixture(),before=JSON.stringify(original);
 assert.equal(assertAttendanceStagedFollowOnReceipt(chain,{originalReceipt:original,originalReceiptSha256:follow.previousReceiptSha256}),chain);
 assert.equal(JSON.stringify(original),before);assert.notEqual(chain.effectiveReceipt.toolRevision,original.toolRevision);
 assert.equal(chain.previousReceiptSha256,'9fcbddec82ad14257e8eacc1a187b40c34a02bc00f89547c3a4dec41f3200633');
 assert.equal(chain.previousToolRevision,'80803b115ed964031650cfb9b3d5676d6d50aeaa');
 assert.equal(chain.failedAttemptArchive.database.oid,'31204');
 assert.ok(allowed.includes('scripts/attendance-extension-metadata.mjs'));
 assert.ok(allowed.includes('scripts/attendance-extension-metadata.test.mjs'));
 assert.ok(allowed.includes('scripts/test-helpers/attendance-extension-metadata.mjs'));
});
test('follow-on rejects missing/unknown chain fields, arbitrary history or archive, and application/input/dependency changes',()=>{
 const {original,chain}=stagedFollowOnReceiptFixture(),ports={originalReceipt:original,originalReceiptSha256:follow.previousReceiptSha256};
 for(const key of Object.keys(chain)){const altered={...chain};delete altered[key];assert.throws(()=>assertAttendanceStagedFollowOnReceipt(altered,ports),key);}
 for(const change of [{skip:true},{target:'a'.repeat(40)},{baseline:'b'.repeat(40)},{kind:'attendance-staged-tool-repair'},
  {previousToolRevision:'d'.repeat(40)},{previousReceiptSha256:'e'.repeat(64)},
  {failedAttemptArchive:{...follow.archive,directory:'/arbitrary/archive'}},
  {failedAttemptArchive:{...follow.archive,files:{...follow.archive.files,'additional.json':'a'.repeat(64)}}}])
  assert.throws(()=>assertAttendanceStagedFollowOnReceipt({...chain,...change},ports));
 for(const change of [{toolRevision:follow.previousToolRevision},{toolRevision:p.target},{sourceInputsSha256:'c'.repeat(64)},
  {dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},{builtOutputSha256:'c'.repeat(64)},
  {changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},
  {preparedAt:'2026-10-10T03:00:00.000Z'},{preparedAt:'2026-10-10T07:00:00.000Z'}])
  assert.throws(()=>assertAttendanceStagedFollowOnReceipt({...chain,effectiveReceipt:{...chain.effectiveReceipt,...change}},ports));
 assert.throws(()=>assertAttendanceStagedFollowOnReceipt(chain,{...ports,originalReceiptSha256:'0'.repeat(64)}));
 assert.throws(()=>assertAttendanceStagedFollowOnReceipt(chain,{...ports,originalReceipt:{...original,toolRevision:'c'.repeat(40)}}));
 assert.throws(()=>assertAttendanceStagedFollowOnReceipt(chain,{...ports,target:'c'.repeat(40)}));
 assert.throws(()=>assertAttendanceStagedFollowOnReceipt(chain,{...ports,toolRevision:'c'.repeat(40)}));
});

export function stagedSequenceFollowOnReceiptFixture(){
 const {original,chain:previousReceipt}=stagedFollowOnReceiptFixture();
 previousReceipt.effectiveReceipt.toolRevision=sequence.previousToolRevision;
 const preparedAt='2026-10-10T07:00:00.000Z',effectiveReceipt={...previousReceipt.effectiveReceipt,
  toolRevision:'e'.repeat(40),preparedAt};
 return {original,previousReceipt,chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-sequence-follow-on',
  target:p.target,baseline:p.baseline,previousToolRevision:sequence.previousToolRevision,
  previousReceiptSha256:sequence.previousReceiptSha256,failedAttemptArchive:structuredClone(sequence.archive),effectiveReceipt,preparedAt}};
}

test('sequence follow-on preserves both earlier receipt identities and binds all seven actual archived-file pins',()=>{
 const {original,previousReceipt,chain}=stagedSequenceFollowOnReceiptFixture(),ports={originalReceipt:original,
  originalReceiptSha256:follow.previousReceiptSha256,previousReceipt,previousReceiptSha256:sequence.previousReceiptSha256};
 const before=JSON.stringify({original,previousReceipt});
 assert.equal(allowed.length,15);assert.equal(sequence.previousToolRevision,'c9829973748fd082c4c579023edd6f7fc538ed29');
 assert.equal(sequence.previousReceiptSha256,'3c2fc90cbc0d6857312c0bf86c16cb0fd2e80623262c9610340e73220b13a58d');
 assert.equal(chain.failedAttemptArchive.database.oid,'34130');
 assert.notEqual(sequence.receiptName,follow.receiptName);assert.equal(Object.keys(sequence.archive.files).length,7);
 assert.ok(Object.values(sequence.archive.files).every(x=>/^[a-f0-9]{64}$/.test(x)));
 assert.equal(assertAttendanceStagedSequenceFollowOnReceipt(chain,ports),chain);
 assert.equal(JSON.stringify({original,previousReceipt}),before);
});

test('sequence follow-on keeps exact chain keys, historical SHA, fixed archive and unchanged 19-field evidence',()=>{
 const {original,previousReceipt,chain}=stagedSequenceFollowOnReceiptFixture(),ports={originalReceipt:original,
  originalReceiptSha256:follow.previousReceiptSha256,previousReceipt,previousReceiptSha256:sequence.previousReceiptSha256};
 for(const key of Object.keys(chain)){const altered={...chain};delete altered[key];assert.throws(()=>assertAttendanceStagedSequenceFollowOnReceipt(altered,ports),key);}
 for(const change of [{skip:true},{kind:'attendance-staged-tool-repair-follow-on'},{target:'d'.repeat(40)},
  {baseline:'d'.repeat(40)},{previousToolRevision:follow.previousToolRevision},{previousReceiptSha256:follow.previousReceiptSha256},
  {failedAttemptArchive:{...sequence.archive,directory:'/arbitrary/archive'}},
  {failedAttemptArchive:{...sequence.archive,database:{...sequence.archive.database,oid:'31204'}}},
  {failedAttemptArchive:{...sequence.archive,files:{...sequence.archive.files,'unexpected.json':'a'.repeat(64)}}}])
  assert.throws(()=>assertAttendanceStagedSequenceFollowOnReceipt({...chain,...change},ports));
 for(const change of [{toolRevision:sequence.previousToolRevision},{toolRevision:follow.previousToolRevision},{toolRevision:p.target},
  {sourceInputsSha256:'c'.repeat(64)},{dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},
  {builtOutputSha256:'c'.repeat(64)},{approvedNoRebuild:false},{preservedFiles:{...preserved,'runtime.json':'0'.repeat(64)}},
  {changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},
  {preparedAt:'2026-10-10T05:00:00.000Z'},{preparedAt:'2026-10-10T08:00:00.000Z'}])
  assert.throws(()=>assertAttendanceStagedSequenceFollowOnReceipt({...chain,effectiveReceipt:{...chain.effectiveReceipt,...change}},ports));
 for(const change of [{originalReceiptSha256:'0'.repeat(64)},{previousReceiptSha256:'0'.repeat(64)},
  {previousReceipt:{...previousReceipt,kind:'unknown'}},
  {previousReceipt:{...previousReceipt,effectiveReceipt:{...previousReceipt.effectiveReceipt,toolRevision:'d'.repeat(40)}}},
  {target:'d'.repeat(40)},{toolRevision:'d'.repeat(40)}])
  assert.throws(()=>assertAttendanceStagedSequenceFollowOnReceipt(chain,{...ports,...change}));
});

export function stagedAclFollowOnReceiptFixture(){
 const {original,previousReceipt:firstFollowOnReceipt,chain:previousReceipt}=stagedSequenceFollowOnReceiptFixture();
 previousReceipt.effectiveReceipt.toolRevision=acl.previousToolRevision;
 const preparedAt='2026-10-10T09:00:00.000Z',effectiveReceipt={...previousReceipt.effectiveReceipt,
  toolRevision:'e'.repeat(40),preparedAt};
 return {original,firstFollowOnReceipt,previousReceipt,chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-acl-follow-on',
  target:p.target,baseline:p.baseline,previousToolRevision:acl.previousToolRevision,
  previousReceiptSha256:acl.previousReceiptSha256,failedAttemptArchive:structuredClone(acl.archive),effectiveReceipt,preparedAt}};
}
test('ACL follow-on validates all three immutable earlier receipts and seven actual fourth-failure pins without expanding tool scope',()=>{
 const {original,firstFollowOnReceipt,previousReceipt,chain}=stagedAclFollowOnReceiptFixture(),ports={originalReceipt:original,
  originalReceiptSha256:follow.previousReceiptSha256,firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  previousReceipt,previousReceiptSha256:acl.previousReceiptSha256};
 const before=JSON.stringify({original,firstFollowOnReceipt,previousReceipt});
 assert.equal(allowed.length,15);assert.equal(acl.previousToolRevision,'ff85a47ae96fa766d037b3d728f7f21a113efb70');
 assert.equal(acl.previousReceiptSha256,'b908814b40ab9f8b7983851ffb1f1b9982439abe12f83aa7d82e3a177ab3f644');
 assert.equal(acl.archive.database.oid,'37190');assert.equal(Object.keys(acl.archive.files).length,7);
 assert.ok(Object.values(acl.archive.files).every(x=>/^[a-f0-9]{64}$/.test(x)));
 assert.equal(new Set([follow.receiptName,sequence.receiptName,acl.receiptName]).size,3);
 assert.equal(assertAttendanceStagedAclFollowOnReceipt(chain,ports),chain);
 assert.equal(JSON.stringify({original,firstFollowOnReceipt,previousReceipt}),before);
});
test('ACL follow-on rejects a broken older chain, arbitrary history/archive, new authority or changed original application evidence',()=>{
 const {original,firstFollowOnReceipt,previousReceipt,chain}=stagedAclFollowOnReceiptFixture(),ports={originalReceipt:original,
  originalReceiptSha256:follow.previousReceiptSha256,firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  previousReceipt,previousReceiptSha256:acl.previousReceiptSha256};
 for(const key of Object.keys(chain)){const altered={...chain};delete altered[key];assert.throws(()=>assertAttendanceStagedAclFollowOnReceipt(altered,ports),key);}
 for(const change of [{skip:true},{kind:'attendance-staged-tool-repair-sequence-follow-on'},{target:'d'.repeat(40)},
  {baseline:'d'.repeat(40)},{previousToolRevision:sequence.previousToolRevision},{previousReceiptSha256:sequence.previousReceiptSha256},
  {failedAttemptArchive:{...acl.archive,directory:'/arbitrary/archive'}},
  {failedAttemptArchive:{...acl.archive,database:{...acl.archive.database,oid:'34130'}}},
  {failedAttemptArchive:{...acl.archive,files:{...acl.archive.files,'unexpected.json':'a'.repeat(64)}}}])
  assert.throws(()=>assertAttendanceStagedAclFollowOnReceipt({...chain,...change},ports));
 for(const change of [{toolRevision:acl.previousToolRevision},{toolRevision:sequence.previousToolRevision},
  {toolRevision:follow.previousToolRevision},{toolRevision:p.target},{sourceInputsSha256:'c'.repeat(64)},
  {dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},{builtOutputSha256:'c'.repeat(64)},
  {approvedNoRebuild:false},{preservedFiles:{...preserved,'runtime.json':'0'.repeat(64)}},
  {changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},
  {preparedAt:'2026-10-10T05:00:00.000Z'},{preparedAt:'2026-10-10T10:00:00.000Z'}])
  assert.throws(()=>assertAttendanceStagedAclFollowOnReceipt({...chain,effectiveReceipt:{...chain.effectiveReceipt,...change}},ports));
 for(const change of [{originalReceiptSha256:'0'.repeat(64)},{firstFollowOnReceiptSha256:'0'.repeat(64)},
  {previousReceiptSha256:'0'.repeat(64)},{originalReceipt:{...original,kind:'unknown'}},
  {firstFollowOnReceipt:{...firstFollowOnReceipt,kind:'unknown'}},{previousReceipt:{...previousReceipt,kind:'unknown'}},
  {previousReceipt:{...previousReceipt,effectiveReceipt:{...previousReceipt.effectiveReceipt,toolRevision:'d'.repeat(40)}}},
  {target:'d'.repeat(40)},{toolRevision:'d'.repeat(40)}])
  assert.throws(()=>assertAttendanceStagedAclFollowOnReceipt(chain,{...ports,...change}));
});

export function stagedSchemaFollowOnReceiptFixture(){
 const {original,firstFollowOnReceipt,previousReceipt:sequenceFollowOnReceipt,chain:previousReceipt}=stagedAclFollowOnReceiptFixture();
 previousReceipt.effectiveReceipt.toolRevision=schema.previousToolRevision;
 const preparedAt='2026-10-10T12:00:00.000Z',effectiveReceipt={...previousReceipt.effectiveReceipt,
  toolRevision:'e'.repeat(40),preparedAt};
 return {original,firstFollowOnReceipt,sequenceFollowOnReceipt,previousReceipt,
  chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-schema-follow-on',target:p.target,baseline:p.baseline,
   previousToolRevision:schema.previousToolRevision,previousReceiptSha256:schema.previousReceiptSha256,
   failedAttemptArchive:structuredClone(schema.archive),effectiveReceipt,preparedAt}};
}
test('schema follow-on binds all seven actual fifth-failure pins and validates the complete immutable four-receipt chain',()=>{
 const f=stagedSchemaFollowOnReceiptFixture(),ports={originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:schema.previousReceiptSha256};
 assert.equal(allowed.length,15);assert.equal(schema.previousToolRevision,'ce22f77b8d89f4cf36f0c6737149014cef8bdb69');
 assert.equal(schema.previousReceiptSha256,'01ffc768fc7de8c69978d6fd83cbe0669a7168cb15943ce2e01f2a8e53fc9b37');
 assert.equal(schema.archive.database.oid,'55550');assert.equal(Object.keys(schema.archive.files).length,7);
 assert.equal(new Set([follow.receiptName,sequence.receiptName,acl.receiptName,schema.receiptName]).size,4);
 assert.ok(Object.values(schema.archive.files).every(x=>/^[a-f0-9]{64}$/.test(x)));
 assert.equal(assertAttendanceStagedSchemaFollowOnReceipt(f.chain,ports),f.chain);
});
