import assert from 'node:assert/strict';import test from 'node:test';
import {ATTENDANCE_STAGED_REPAIR as p,ATTENDANCE_STAGED_REPAIR_PRESERVED as preserved,
 ATTENDANCE_STAGED_FOLLOW_ON as follow,ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON as sequence,ATTENDANCE_STAGED_ACL_FOLLOW_ON as acl,
 ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON as schema,
 ATTENDANCE_STAGED_GUARD_FOLLOW_ON as guard,
 ATTENDANCE_STAGED_PHASE_FOLLOW_ON as phaseFollowOn,
 ATTENDANCE_STAGED_PHASE_FOLLOW_ON_FILES as phaseAllowed,
 ATTENDANCE_STAGED_REPAIR_FILES as allowed,
 assertAttendanceStagedRepairReceipt,assertAttendanceStagedFollowOnReceipt,
 assertAttendanceStagedSequenceFollowOnReceipt,assertAttendanceStagedAclFollowOnReceipt,
 assertAttendanceStagedSchemaFollowOnReceipt,assertAttendanceStagedGuardFollowOnReceipt,
 assertAttendanceStagedPhaseFollowOnReceipt} from './attendance-staged-tool-repair-policy.mjs';
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

export function stagedGuardFollowOnReceiptFixture(){
 const {original,firstFollowOnReceipt,sequenceFollowOnReceipt,previousReceipt:aclFollowOnReceipt,chain:previousReceipt}=stagedSchemaFollowOnReceiptFixture();
 previousReceipt.effectiveReceipt.toolRevision=guard.previousToolRevision;
 const preparedAt='2026-10-10T14:00:00.000Z',effectiveReceipt={...previousReceipt.effectiveReceipt,
  toolRevision:'e'.repeat(40),preparedAt};
 return {original,firstFollowOnReceipt,sequenceFollowOnReceipt,aclFollowOnReceipt,previousReceipt,
  chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-guard-follow-on',target:p.target,baseline:p.baseline,
   previousToolRevision:guard.previousToolRevision,previousReceiptSha256:guard.previousReceiptSha256,
   failedAttemptArchive:structuredClone(guard.archive),effectiveReceipt,preparedAt}};
}
test('guard follow-on binds all seven actual sixth-failure pins and validates the complete immutable five-receipt chain',()=>{
 const f=stagedGuardFollowOnReceiptFixture(),ports={originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  aclFollowOnReceipt:f.aclFollowOnReceipt,aclFollowOnReceiptSha256:schema.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:guard.previousReceiptSha256};
 assert.equal(allowed.length,15);assert.equal(guard.previousToolRevision,'d7a2fd018adf3ce68ee31b51e7684051604c0b4b');
 assert.equal(guard.previousReceiptSha256,'6436bd65e5f19a626413d0b0d8cfcf7062589b891f07d88171c614a1d39103af');
 assert.equal(guard.archive.database.oid,'58619');assert.equal(Object.keys(guard.archive.files).length,7);
 assert.equal(new Set([follow.receiptName,sequence.receiptName,acl.receiptName,schema.receiptName,guard.receiptName]).size,5);
 assert.ok(Object.values(guard.archive.files).every(x=>/^[a-f0-9]{64}$/.test(x)));
 assert.equal(assertAttendanceStagedGuardFollowOnReceipt(f.chain,ports),f.chain);
});

export function stagedPhaseFollowOnReceiptFixture(){
 const {original,firstFollowOnReceipt,sequenceFollowOnReceipt,aclFollowOnReceipt,
  previousReceipt:schemaFollowOnReceipt,chain:previousReceipt}=stagedGuardFollowOnReceiptFixture();
 previousReceipt.effectiveReceipt.toolRevision=phaseFollowOn.previousToolRevision;
 const preparedAt='2026-10-10T15:00:00.000Z',effectiveReceipt={...previousReceipt.effectiveReceipt,
  toolRevision:'f'.repeat(40),preparedAt,changedToolFiles:[
   'scripts/attendance-production-052-compatibility.mjs',
   'scripts/attendance-production-052-compatibility.test.mjs',
   'scripts/attendance-production-database-migrations.mjs',
   'scripts/attendance-production-database-migrations.test.mjs',
   'scripts/attendance-staged-tool-repair-policy.mjs',
   'scripts/attendance-staged-tool-repair-policy.test.mjs',
   'scripts/attendance-staged-tool-repair.mjs',
   'scripts/attendance-staged-tool-repair.test.mjs',
   'scripts/attendance-production-multiphase-guards-native.mjs',
   'scripts/attendance-production-multiphase-guards-native.test.mjs',
  ]};
 return {original,firstFollowOnReceipt,sequenceFollowOnReceipt,aclFollowOnReceipt,schemaFollowOnReceipt,previousReceipt,
  chain:{schemaVersion:1,kind:'attendance-staged-tool-repair-phase-follow-on',target:p.target,baseline:p.baseline,
   previousToolRevision:phaseFollowOn.previousToolRevision,previousReceiptSha256:phaseFollowOn.previousReceiptSha256,
   failedAttemptArchive:structuredClone(phaseFollowOn.archive),effectiveReceipt,preparedAt}};
}
test('phase follow-on freezes the old 15-path scope and binds all actual seventh-failure pins through six predecessors',()=>{
 const f=stagedPhaseFollowOnReceiptFixture(),ports={originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  aclFollowOnReceipt:f.aclFollowOnReceipt,aclFollowOnReceiptSha256:schema.previousReceiptSha256,
  schemaFollowOnReceipt:f.schemaFollowOnReceipt,schemaFollowOnReceiptSha256:guard.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:phaseFollowOn.previousReceiptSha256};
 assert.equal(allowed.length,15);assert.equal(phaseAllowed.length,17);
 assert.deepEqual(phaseAllowed.slice(0,allowed.length),allowed);
 assert.equal(phaseFollowOn.previousToolRevision,'2cd4d129dfcc2ee18ba0866a4316266ba8f58a96');
 assert.equal(phaseFollowOn.previousReceiptSha256,'2d94c9c9a3a548e314ae075c53884ec5093924947e9cb97c4719f7aeb72a4c26');
 assert.equal(phaseFollowOn.archive.database.oid,'61716');assert.equal(phaseFollowOn.archive.database.registryCount,'135');
 assert.equal(phaseFollowOn.archive.database.maximumMigrationVersion,'202610040135');
 assert.equal(phaseFollowOn.archive.database.migration136IndexOid,'67386');
 assert.equal(phaseFollowOn.archive.directory,`${p.operation}/attendance-compatibility-failure-20261010-143000`);
 assert.equal(phaseFollowOn.archive.database.originalName,'faolla_attendance_compat_a535a308e21f');
 assert.equal(phaseFollowOn.archive.database.retainedName,'faolla_attendance_failed_a535a308e21f_20261010_143000');
 assert.equal(Object.keys(phaseFollowOn.archive.files).length,7);
 assert.ok(Object.values(phaseFollowOn.archive.files).every(value=>/^[a-f0-9]{64}$/.test(value)));
 assert.deepEqual(phaseFollowOn.archive.files,{
  'attendance-compatibility-attempt.json':'83248198a0b299fd4c5c2367d363bbddf6fd88ea58bfae78d2a2ed1f8f0ca364',
  'attendance-compatibility-metadata.sql':'3d4808ffd338bdddd7287d5281ddcb66b44dba720cc75bee349cf716b6e8405d',
  'attendance-compatibility-extension-metadata.json':'2acb4760ae3f402d92af21fbe7f03d1099dde93d66191a10b7cc4edd5a178f01',
  'attendance-compatibility-extension-supplement.sql':'4d0411d8405dcce07e600b2dc5de81b0c7eb7e42a609d92f7eec889237bd0db5',
  'prepared.json':'714feaa1a81c6511c09841e58da0114a6f07361265a0075afa0465fbaf9355d1',
  'sql-applied.json':'e5f8e9d8c2a21055bbccbdcff4694db57b875bdcfbcea98af1fa725bdf401be4',
  'completed.json':'89e5b3109155f829e61230317ce22821ecbab40d59b8a126f407a28c43aa95f4',
 });
 assert.equal(new Set([follow.receiptName,sequence.receiptName,acl.receiptName,schema.receiptName,
  guard.receiptName,phaseFollowOn.receiptName]).size,6);
 assert.equal(assertAttendanceStagedPhaseFollowOnReceipt(f.chain,ports),f.chain);
});
