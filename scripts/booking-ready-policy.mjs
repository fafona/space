// Independent native-rehearsal successor; the predecessor's exact allowlist is unchanged.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_DEPENDENCY_TOOL_FILES,assertBookingDependencyToolClosure} from './booking-dependency-continuation-policy.mjs';
import {assertBookingCiPins} from './booking-ci-continuation-policy.mjs';
export const BOOKING_READY_BASE='501b767925dd2956e1916a87d60c6f175882d9a2';
export const BOOKING_READY_RECEIPT='booking-ready-continuation-tool.json';
export const BOOKING_READY_FILES=Object.freeze([
  "scripts/booking-ready-policy.mjs",
  "scripts/booking-ready-policy.test.mjs",
  "scripts/booking-ready-evidence.mjs",
  "scripts/booking-ready-tool.mjs",
  "scripts/booking-ready-tool.test.mjs",
  "scripts/booking-ready-runtime.mjs",
  "scripts/booking-ready-runtime.test.mjs",
  "scripts/booking-ready-pending.mjs",
  "scripts/booking-ready-pending.test.mjs",
  "scripts/booking-ready-backup.mjs",
  "scripts/booking-ready-backup.test.mjs",
  "scripts/booking-ready-worker.mjs",
  "scripts/booking-ready-worker.test.mjs",
  "scripts/booking-ready-pm2-replace.py",
  "scripts/test_booking_ready_pm2_replace.py",
  "scripts/booking-handoff-native-acceptance.mjs",
  "scripts/booking-handoff-native-acceptance.test.mjs",
  "scripts/booking-handoff-runtime.mjs",
  "scripts/booking-handoff-host-io.mjs",
  "scripts/booking-handoff-journal.mjs",
  "scripts/booking-handoff-execution.mjs",
  "scripts/booking-handoff-routing.mjs",
  "scripts/booking-handoff-legacy.mjs",
  "scripts/online-traffic-release.mjs",
  "scripts/booking-dependency-continuation-policy.test.mjs",
  "scripts/booking-ci-continuation-policy.test.mjs",
  "scripts/booking-formal-backup-policy.test.mjs",
  "scripts/booking-registry-tool-policy.test.mjs",
  "scripts/booking-compatibility-tool-policy.test.mjs",
 "scripts/booking-handoff-journal.test.mjs",
 "scripts/booking-handoff-execution.test.mjs",
 "scripts/booking-ci-continuation.test.mjs"
]);
export const BOOKING_READY_INPUTS_SHA256='c7a96e760f808ffe8913e2602b45e95a901ea9f971e65ae6192ff39453a367a6';
const BEFORE=Object.freeze({
  "scripts/booking-ci-continuation-policy.test.mjs": "100644 blob c81912c0006dba3d63eab64acda63f0efc161c0f\tscripts/booking-ci-continuation-policy.test.mjs",
  "scripts/booking-ci-continuation.test.mjs": "100644 blob bbe0967f7daa82b1d35ac349ae4f5aacaec28093\tscripts/booking-ci-continuation.test.mjs",
  "scripts/booking-compatibility-tool-policy.test.mjs": "100644 blob a12ef077ef95b3ec815adf5792cb66deecb29f04\tscripts/booking-compatibility-tool-policy.test.mjs",
  "scripts/booking-dependency-continuation-policy.test.mjs": "100644 blob 8cafd8dcc0fb0bdce73d01c975fc499aff7f87fd\tscripts/booking-dependency-continuation-policy.test.mjs",
  "scripts/booking-formal-backup-policy.test.mjs": "100644 blob 9e4fcce796648b5b6ff7dd8f581155c56237367e\tscripts/booking-formal-backup-policy.test.mjs",
  "scripts/booking-handoff-execution.mjs": "100644 blob be188f1604b7c595f214b3e65d24b85d6ae2667b\tscripts/booking-handoff-execution.mjs",
  "scripts/booking-handoff-execution.test.mjs": "100644 blob 87d1c3eaeb9393ca7ce5c9c464564d564b025d11\tscripts/booking-handoff-execution.test.mjs",
  "scripts/booking-handoff-host-io.mjs": "100644 blob 205a44abf4b5ba863f7963b2d5d3b6e2719bf6b1\tscripts/booking-handoff-host-io.mjs",
  "scripts/booking-handoff-journal.mjs": "100644 blob b72abbdc5ecc03986481a09acc46dd7578ec8b96\tscripts/booking-handoff-journal.mjs",
  "scripts/booking-handoff-journal.test.mjs": "100644 blob a59a7ca5300443dbfd75f4dccc725d12cb3e4233\tscripts/booking-handoff-journal.test.mjs",
  "scripts/booking-handoff-legacy.mjs": "100644 blob 3ed7f38b9acc92620807d874d998930eb2189ccf\tscripts/booking-handoff-legacy.mjs",
  "scripts/booking-handoff-native-acceptance.mjs": "100644 blob 8c44c5abbef9e9c16e60ea73d8859fc2d066fa02\tscripts/booking-handoff-native-acceptance.mjs",
  "scripts/booking-handoff-native-acceptance.test.mjs": "100644 blob a0e43f61776b804147761cb09bea00213d09961f\tscripts/booking-handoff-native-acceptance.test.mjs",
  "scripts/booking-handoff-routing.mjs": "100644 blob 269390214f2c8bcfa5c593922f5be483748b1c44\tscripts/booking-handoff-routing.mjs",
  "scripts/booking-handoff-runtime.mjs": "100644 blob 751bc63c17dfdbee7860fa2db3191ad4f81db0be\tscripts/booking-handoff-runtime.mjs",
  "scripts/booking-registry-tool-policy.test.mjs": "100644 blob 562ddfa311414ddd6f9ae853964025aa71591a27\tscripts/booking-registry-tool-policy.test.mjs",
  "scripts/online-traffic-release.mjs": "100644 blob c1ba6c89cb6b492683ae1af72b7a648a8e122765\tscripts/online-traffic-release.mjs"
});
const need=(v,c)=>{if(!v)throw Error('booking_ready_'+c);},hash=v=>createHash('sha256').update(v).digest('hex');
const name=r=>r.slice(r.indexOf('\t')+1);
const sameFiles=(a,b)=>Array.isArray(a)&&new Set(a).size===a.length&&isDeepStrictEqual([...a].sort(),[...b].sort());
export function bookingReadyInputs(rows){
 need(Array.isArray(rows)&&rows.every(r=>/^(100644|100755) blob [a-f0-9]{40}\t[^\0\r\n]+$/.test(r))&&new Set(rows.map(name)).size===rows.length,'tree');
 return rows.filter(r=>!BOOKING_READY_FILES.includes(name(r))).join('\0');
}
// TEST ONLY. Production reads BOTH actual raw trees, never this projection.
export function projectBookingReadyPredecessorRows(rows){
 bookingReadyInputs(rows);return rows.filter(r=>!BOOKING_READY_FILES.includes(name(r))||BEFORE[name(r)]).map(r=>BEFORE[name(r)]??r);
}
export function assertBookingReadyDelta({files,originalInputs,currentInputs,readBlob}){
 need(sameFiles(files,BOOKING_READY_FILES),'scope');
 need(typeof currentInputs==='string'&&originalInputs===currentInputs&&hash(currentInputs)===BOOKING_READY_INPUTS_SHA256,'application_inputs');
 assertBookingCiPins(readBlob);return BOOKING_READY_INPUTS_SHA256;
}
export const BOOKING_READY_TOOL_FILES=Object.freeze([...new Set([...BOOKING_DEPENDENCY_TOOL_FILES,...BOOKING_READY_FILES])]);
export function assertBookingReadyClosure(input){
 if(!input.files?.some(f=>f.startsWith('scripts/booking-ready-')))return assertBookingDependencyToolClosure(input);
 need(input.baseline===C&&sameFiles(input.files,BOOKING_READY_TOOL_FILES),'tool_scope');
 assertBookingCiPins(input.readBlob);return hash(JSON.stringify([...input.files].sort().map(f=>[f,hash(input.readBlob(f))])));
}
export function assertBookingReadyReceipt(value,revision,evidenceSha256){
 need(value&&isDeepStrictEqual(Object.keys(value).sort(),['schemaVersion','kind','priorTool','toolRevision','sourceInputsSha256','toolClosureSha256','readyEvidenceSha256','preparedAt'].sort()),'receipt_shape');
 need(value.schemaVersion===1&&value.kind==='booking-ready-continuation-tool'&&value.priorTool===BOOKING_READY_BASE&&
 /^[a-f0-9]{40}$/.test(revision??'')&&revision!==BOOKING_READY_BASE&&value.toolRevision===revision&&
 value.sourceInputsSha256===BOOKING_READY_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(value.toolClosureSha256??'')&&
 value.readyEvidenceSha256===evidenceSha256&&Number.isFinite(Date.parse(value.preparedAt)),'receipt');return true;
}

