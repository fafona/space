// Separately approved tool-only repair of ONE already-built, never-cut candidate.
// No generic resume, pending bypass, source replacement or build-provenance rewrite.
import assert from 'node:assert/strict';

const target='a535a308e21f121e7cf410a6f7d84c974eb370a6';
export const ATTENDANCE_STAGED_REPAIR=Object.freeze({
 target,baseline:'b1304d5d58841c2247b93229b90bb7adcfd64965',
 operation:`/var/lib/faolla-online-release/${target}`,
 directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,
 stateSha256:'2732c9e1b4d85da750be85445d72cb84d5ea8d939aab0fb88c957732476a3156',
 buildProofSha256:'061bbbd1d96ee6960c44fa14db9abff5e99dd1eda65b1b045cad8dd366695b71',
 builtOutputSha256:'b1999ed2478f75b219f4ae029b5458a35b5f2c0c12efdcc78bd624163980b760',
 scopeSha256:'3518a971c62c0f9a074b94c873078729e3ebe79adb0bd661793d07063d057ce3',
 activeSha256:'6e78b358aa79efc8e1b7b7ad0dd911663633c0d4036c111594d224a684f62d3e',
 maintenanceSha256:'1443543536254a8b9edf318ef5382789cf1df62f4e8dfe72c60a1d003a60b673',
 markerSha256:'487d4192e05edbabac37d7e560e1cb29d07e4fc3455d034402d6f7939a8a6468',
 retentionHeadSha256:'799e0a2a60f17989eb74e94b205a36f8e499528c36209d02049640a8b0a08abf',
});
export const ATTENDANCE_STAGED_REPAIR_FILES=Object.freeze([
 'scripts/attendance-production-052-compatibility.mjs','scripts/attendance-production-052-compatibility.test.mjs',
 'scripts/attendance-production-database-migrations.mjs','scripts/attendance-production-database-migrations.test.mjs',
 'scripts/prepare-online-release-tool.mjs','scripts/prepare-online-release-tool.test.mjs',
 'scripts/online-unpublished-candidate.test.mjs',
 'scripts/attendance-staged-tool-repair-policy.mjs','scripts/attendance-staged-tool-repair-policy.test.mjs',
 'scripts/attendance-staged-tool-repair.mjs','scripts/attendance-staged-tool-repair.test.mjs',
 'docs/attendance-staged-tool-repair-20261010.md',
]);
export const ATTENDANCE_STAGED_REPAIR_PRESERVED=Object.freeze({
 'state.json':ATTENDANCE_STAGED_REPAIR.stateSha256,
 'attendance-build-proof.json':ATTENDANCE_STAGED_REPAIR.buildProofSha256,
 'runtime.json':'dc15e89265bcd03b1d7515629c5fdeb3c701d4a4cdbba0bce1795bda1dfdfce3',
 'attendance-build.env':'daeea7dd4d148c15786b4ba89e9f3ec5fa8bb84327bd38eae30135bbbfd0ffe7',
 '.env.local':'f6442f07f99b1071eacc4ec763e94ed5620f1a82b8ceec05c7fbf90ea1764f78',
 'stage.log':'36ad85aeeaa7de567b0f60c7ef6b344409af245b61ed118b67a76a729e518c61',
 'BUILD_ID':'c623880a75b8b06d196367becb2adc280b8409d8fcc3c096668e461a75a1efc4',
 'before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf':'474c2eef77404ebf7905c8563e5a0e015f4525420c4ce925b2478a196a560608',
 'after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf':'ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c',
 'before-no_store_entries_www.faolla.com.conf':'3a274b28d47d3be7e7963611b638a1d94a75dc9d351277941739291061972db2',
 'after-no_store_entries_www.faolla.com.conf':'2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52',
 'before-faolla_contact_card_release.conf':'90ec0b94cdb735d9375744c98b1b2fb2ae7ae4bbb9ce22c1d8efb7d6c641d69a',
 'after-faolla_contact_card_release.conf':'9da32c319f61ddfdc38f24cb908536f4b57cc8ad8d0d1c4d30122176378893c5',
});
const keys=['schemaVersion','kind','target','baseline','toolRevision','originalStateSha256','originalBuildProofSha256',
 'sourceInputsSha256','builtOutputSha256','scopeSha256','preservedFiles','activeSha256','maintenanceSha256','markerSha256',
 'retentionHeadSha256','dependencySha256','changedToolFiles','approvedNoRebuild','preparedAt'];
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const need=x=>{if(!x)throw Error('attendance_staged_repair_receipt_invalid');};
export function assertAttendanceStagedRepairReceipt(r,{target:expectedTarget,toolRevision}={}){
 need(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k)));
 const p=ATTENDANCE_STAGED_REPAIR;
 need(r.schemaVersion===1&&r.kind==='attendance-staged-tool-repair'&&r.target===p.target&&r.baseline===p.baseline&&
  (!expectedTarget||expectedTarget===p.target)&&/^[a-f0-9]{40}$/.test(r.toolRevision??'')&&r.toolRevision!==p.target&&
  (!toolRevision||r.toolRevision===toolRevision)&&r.originalStateSha256===p.stateSha256&&r.originalBuildProofSha256===p.buildProofSha256&&
  r.builtOutputSha256===p.builtOutputSha256&&r.scopeSha256===p.scopeSha256&&r.activeSha256===p.activeSha256&&
  r.maintenanceSha256===p.maintenanceSha256&&r.markerSha256===p.markerSha256&&r.retentionHeadSha256===p.retentionHeadSha256&&
  hex(r.sourceInputsSha256)&&hex(r.dependencySha256)&&r.approvedNoRebuild===true);
 try{assert.deepEqual(r.preservedFiles,ATTENDANCE_STAGED_REPAIR_PRESERVED);}catch{need(false);}
 need(Array.isArray(r.changedToolFiles)&&r.changedToolFiles.length>0&&new Set(r.changedToolFiles).size===r.changedToolFiles.length&&
  r.changedToolFiles.every(f=>ATTENDANCE_STAGED_REPAIR_FILES.includes(f))&&r.changedToolFiles.includes('scripts/attendance-production-052-compatibility.mjs')&&
  typeof r.preparedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.preparedAt)&&
  Number.isFinite(Date.parse(r.preparedAt))&&new Date(r.preparedAt).toISOString()===r.preparedAt);
 return r;
}
