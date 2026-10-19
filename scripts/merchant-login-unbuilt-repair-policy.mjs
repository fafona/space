// One approved, never-built login candidate. No application/runtime/DB changes.
import assert from 'node:assert/strict';
export const LOGIN_UNBUILT_REPAIR=Object.freeze({
  "target": "518d32cdf8088b285ed174833ac2ed7fe8e38282",
  "baseline": "6d77f3dfb61d1b694cc807c17d14f334cfec62f0",
  "operation": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282",
  "directory": "/www/wwwroot/merchant-space.web-releases/518d32cdf808-online",
  "name": "merchant-space-online-518d32cdf808",
  "port": 3103,
  "stateSha256": "26a784b09bd012339c3044968ec6a3469181c077357ec6f46f8012d83731f4a6",
  "sourceInputsSha256": "5adf4479e57cad9bd88837084785022fad4dc012db6121fd5f0dda7058850947",
  "dependency": {
    "sha256": "cb0428251f3bfe2c700eedd3242d3506e0bdd556511852f9810e7dd62e9b63fe",
    "files": 31354,
    "bytes": 843728222
  },
  "activeSha256": "271358fa968a96428fc6dc35aa15f00cf704e40f846186ca6bacd0c31f3ec530",
  "maintenanceSha256": "1443543536254a8b9edf318ef5382789cf1df62f4e8dfe72c60a1d003a60b673",
  "markerSha256": "487d4192e05edbabac37d7e560e1cb29d07e4fc3455d034402d6f7939a8a6468",
  "retentionHeadSha256": "b8a3313b7a3d6964eef63217e4e8c00048c58eb3397f09eaebf8de179bd00674",
  "receiptName": "merchant-login-unbuilt-repair.json",
  "originalStateCopyName": "merchant-login-unbuilt-original-state.json",
  "attemptName": "merchant-login-unbuilt-resume-attempt.json",
  "resultName": "merchant-login-unbuilt-resume-result.json"
});
export const LOGIN_UNBUILT_REPAIR_FILES=Object.freeze([
  "scripts/merchant-login-unbuilt-repair-policy.mjs",
  "scripts/merchant-login-unbuilt-repair-policy.test.mjs",
  "scripts/merchant-login-unbuilt-repair.mjs",
  "scripts/merchant-login-unbuilt-repair.test.mjs",
  "scripts/online-traffic-release.mjs",
  "scripts/online-traffic-release.test.mjs",
  "scripts/prepare-online-release-tool.mjs",
  "scripts/prepare-online-release-tool.test.mjs",
  "scripts/attendance-staged-tool-repair.test.mjs",
  "scripts/online-unpublished-candidate.test.mjs"
]);
export const LOGIN_UNBUILT_REPAIR_PATHS=Object.freeze({
  "state.json": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/state.json",
  "runtime.json": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/runtime.json",
  ".env.local": "/www/wwwroot/merchant-space.web-releases/518d32cdf808-online/.env.local",
  "package-lock.json": "/www/wwwroot/merchant-space.web-releases/518d32cdf808-online/package-lock.json",
  "baseline.env.local": "/www/wwwroot/merchant-space.web-releases/6d77f3dfb61d-online/.env.local",
  "stage-attempt01.log": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-stage-attempt01.log",
  "stage-attempt02.log": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-stage-attempt02.log",
  "focused-fixture-environment-diagnostic.log": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-focused-fixture-environment-diagnostic.log",
  "studio-attempt01-before.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt01-before.json",
  "studio-attempt01-paused.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt01-paused.json",
  "studio-attempt01-restored.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt01-restored.json",
  "studio-attempt02-before.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt02-before.json",
  "studio-attempt02-paused.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt02-paused.json",
  "studio-attempt02-restored.json": "/var/log/faolla-merchant-login-publication/518d32cdf8088b285ed174833ac2ed7fe8e38282-studio-attempt02-restored.json",
  "retirement-certificate.json": "/var/lib/faolla-online-retention/000013/certificate.json",
  "before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf",
  "after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf",
  "before-no_store_entries_www.faolla.com.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/before-no_store_entries_www.faolla.com.conf",
  "after-no_store_entries_www.faolla.com.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/after-no_store_entries_www.faolla.com.conf",
  "before-faolla_contact_card_release.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/before-faolla_contact_card_release.conf",
  "after-faolla_contact_card_release.conf": "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/after-faolla_contact_card_release.conf"
});
export const LOGIN_UNBUILT_REPAIR_PRESERVED=Object.freeze({
  "state.json": "26a784b09bd012339c3044968ec6a3469181c077357ec6f46f8012d83731f4a6",
  "runtime.json": "9fd001002fe6c4a9906672cec03f8a5fbb1434d915dea49fca445b3a6d30295b",
  ".env.local": "9509c450edba0aff54d5dd66b8298095e0fe0d97cea2746c492871b49b09fcff",
  "package-lock.json": "34252b297a23562219d5b29ec773a761dda3c9fe88f18cb7c0bff122b773254c",
  "baseline.env.local": "900ad1a28d18db5e1e667cb880e5c5d19a6b9877970327765af68602a5c56052",
  "stage-attempt01.log": "29eb23a3435ef035e89590b5518c094dee7d16e7689459ccaf6d06df2260d350",
  "stage-attempt02.log": "b165ff262d8049c415c26360981da1b0ee0929f217988ddc164e4b1e2fe21d71",
  "focused-fixture-environment-diagnostic.log": "b0294703ce78e9d6e28613c93d68cc3ffa6c3e38890cee0d8e9a5975c2f3c251",
  "studio-attempt01-before.json": "0786c8cc963f69c280bc0aac05be747b11a487c813b7ff2ad63261a1f2f73f97",
  "studio-attempt01-paused.json": "d929aee50078e9ce4bc95f95b53e787d55b9ab3d07509567c5c8e417b748ed2f",
  "studio-attempt01-restored.json": "65284eb583e42356fdbdd2f9b947c8ad2239a58d8385ffafd63eda6f36e91a7f",
  "studio-attempt02-before.json": "9082a314a8ba35cad30bd0d6e68c57259a0291aa6e278e4a65868255e9ee8c5d",
  "studio-attempt02-paused.json": "4376c3c0185cee8927e4a5ebe26f89dc840fa1a70b6bbd501f858c8dacbb6141",
  "studio-attempt02-restored.json": "af3e68735e91d09d310c8549bcd9bc023e59d349cf41dc136941a1d7ecb9309e",
  "retirement-certificate.json": "610793b3089a9fa32e51be5a5cd7ca61dfad692c62392418816cc5d01079ca6a",
  "before-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "474c2eef77404ebf7905c8563e5a0e015f4525420c4ce925b2478a196a560608",
  "after-e6718553d7a03bef1e991fe6b6898cab_www.faolla.com.conf": "ff7104caafcca9c6578caacfb1305fdcf1438a1f09ecda131aac33d1d863a60c",
  "before-no_store_entries_www.faolla.com.conf": "3a274b28d47d3be7e7963611b638a1d94a75dc9d351277941739291061972db2",
  "after-no_store_entries_www.faolla.com.conf": "2be8bb00e785f713f3119c569de014e4d2ca1d77e14bd900dc9e9fa454d33b52",
  "before-faolla_contact_card_release.conf": "55b0b42d3f665407914ba3a692ef6e8ea7c01f843fd986a65e5963130250f311",
  "after-faolla_contact_card_release.conf": "036015f1c07c8689559a76350ea4c020b6cdf625dbc01726ec3be8ae07a3501d"
});
export const LOGIN_UNBUILT_REPAIR_ABSENT=Object.freeze([
  "/www/wwwroot/merchant-space.web-releases/518d32cdf808-online/.next",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-build-proof.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-build.env",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/build-home",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/build-cache",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/build-tmp",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-database-compatibility.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-compatibility-attempt.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-compatibility-metadata.sql",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-database-progress.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/attendance-database-ready.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/migration-preview.json",
  "/var/lib/faolla-online-release/518d32cdf8088b285ed174833ac2ed7fe8e38282/migration-report.json"
]);
Object.freeze(LOGIN_UNBUILT_REPAIR.dependency);
const p=LOGIN_UNBUILT_REPAIR;
const need=x=>{if(!x)throw Error('merchant_login_unbuilt_receipt_invalid');};
function record(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 const own=Reflect.ownKeys(value);
 return own.length===keys.length&&keys.every(k=>Object.hasOwn(value,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'));
}
const keys=['schemaVersion','kind','target','baseline','toolRevision','originalStateSha256','sourceInputsSha256','dependencySha256','preservedFiles','activeSha256','maintenanceSha256','markerSha256','retentionHeadSha256','changedToolFiles','approvedTestEnvironmentIsolation','preparedAt'];
export function assertLoginUnbuiltRepairToolScope(files){
 need(Array.isArray(files)&&files.length===LOGIN_UNBUILT_REPAIR_FILES.length&&new Set(files).size===files.length&&files.every(f=>LOGIN_UNBUILT_REPAIR_FILES.includes(f)));
}
export function assertLoginUnbuiltRepairReceipt(r,{target,toolRevision}={}){
 need(record(r,keys));
 need(r.schemaVersion===1&&r.kind==='merchant-login-unbuilt-test-environment-repair'&&r.target===p.target&&r.baseline===p.baseline&&(target===undefined||target===p.target)&&typeof r.toolRevision==='string'&&/^[a-f0-9]{40}$/.test(r.toolRevision)&&![p.target,p.baseline].includes(r.toolRevision)&&(toolRevision===undefined||toolRevision===r.toolRevision));
 need(r.originalStateSha256===p.stateSha256&&r.sourceInputsSha256===p.sourceInputsSha256&&r.dependencySha256===p.dependency.sha256&&r.activeSha256===p.activeSha256&&r.maintenanceSha256===p.maintenanceSha256&&r.markerSha256===p.markerSha256&&r.retentionHeadSha256===p.retentionHeadSha256&&r.approvedTestEnvironmentIsolation===true);
 need(record(r.preservedFiles,Object.keys(LOGIN_UNBUILT_REPAIR_PRESERVED)));assert.deepEqual(r.preservedFiles,LOGIN_UNBUILT_REPAIR_PRESERVED);
 assertLoginUnbuiltRepairToolScope(r.changedToolFiles);
 need(typeof r.preparedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.preparedAt)&&Number.isFinite(Date.parse(r.preparedAt))&&new Date(r.preparedAt).toISOString()===r.preparedAt);
 return r;
}
// This is exclusively a synthetic unit/contract process. No production keys,
// dotenv, build IDs, canonical-host settings or NODE_OPTIONS are inherited.
export function loginUnitTestEnvironment(){
 return {PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_ENV:'test',NEXT_TELEMETRY_DISABLED:'1'};
}
export function assertLoginUnbuiltState(state,original,{phase='unbuilt',buildProofSha256}={}){
 need(['unbuilt','built','ready'].includes(phase)&&original.target===p.target&&original.baseline===p.baseline&&original.directory===p.directory&&original.name===p.name&&original.port===p.port&&original.lane==='merchant-login-recovery-code-only'&&original.status==='preparing'&&!Object.hasOwn(original,'loginBuildProofSha256'));
 const expected=structuredClone(original);
 if(phase!=='unbuilt'){need(typeof buildProofSha256==='string'&&/^[a-f0-9]{64}$/.test(buildProofSha256));expected.loginBuildProofSha256=buildProofSha256;}
 else need(buildProofSha256===undefined);
 if(phase==='ready')expected.status='ready-no-database';
 assert.deepEqual(state,expected);
 return state;
}
