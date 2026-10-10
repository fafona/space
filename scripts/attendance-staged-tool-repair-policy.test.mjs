import assert from 'node:assert/strict';import test from 'node:test';
import {ATTENDANCE_STAGED_REPAIR as p,ATTENDANCE_STAGED_REPAIR_PRESERVED as preserved,
 assertAttendanceStagedRepairReceipt} from './attendance-staged-tool-repair-policy.mjs';
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
