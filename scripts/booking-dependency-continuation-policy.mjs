// Fixed dependency-binding successor. Prior policies and sealed evidence remain unchanged.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_CI_TOOL_FILES,assertBookingCurrentToolClosure,assertBookingCiPins} from './booking-ci-continuation-policy.mjs';
export const BOOKING_DEPENDENCY_BASE='4005d8cd382696a81d8efca92570dbfd92f6b01a';
export const BOOKING_DEPENDENCY_RECEIPT='booking-dependency-continuation-tool.json';
export const BOOKING_DEPENDENCY_FILES=Object.freeze([
 "scripts/booking-dependency-fingerprint.mjs",
 "scripts/booking-dependency-fingerprint.test.mjs",
 "scripts/booking-dependency-continuation-policy.mjs",
 "scripts/booking-dependency-continuation-policy.test.mjs",
 "scripts/booking-dependency-continuation-tool.mjs",
 "scripts/booking-dependency-continuation-tool.test.mjs",
 "scripts/booking-dependency-backup.mjs",
 "scripts/booking-dependency-backup.test.mjs",
 "scripts/booking-dependency-pending.mjs",
 "scripts/booking-dependency-pending.test.mjs",
 "scripts/booking-handoff-runtime.mjs",
 "scripts/booking-handoff-runtime.test.mjs",
 "scripts/booking-handoff-execution.mjs",
 "scripts/booking-handoff-execution.test.mjs",
 "scripts/booking-handoff-host-io.mjs",
 "scripts/booking-handoff-journal.mjs",
 "scripts/booking-handoff-routing.mjs",
 "scripts/booking-handoff-legacy.mjs",
 "scripts/online-traffic-release.mjs",
 "scripts/booking-ci-continuation-policy.test.mjs",
 "scripts/booking-formal-backup-policy.test.mjs",
 "scripts/booking-registry-tool-policy.test.mjs",
 "scripts/booking-compatibility-tool-policy.test.mjs",
 "scripts/booking-handoff-journal.test.mjs",
 "scripts/booking-ci-continuation.test.mjs"
]);
export const BOOKING_DEPENDENCY_INPUTS_SHA256='f7bce43831e7cb03c7b9d51b81b55a971284ad71793b7eb306d9b95bd46f9a7d';
const BASE_ROWS=Object.freeze({
 "scripts/booking-ci-continuation.test.mjs": "100644 blob 17eabd0372dc02f4a32a6ce6e0cca2f749791b31\tscripts/booking-ci-continuation.test.mjs",
 "scripts/booking-handoff-journal.test.mjs": "100644 blob 28bfb64d340e39dc82ff752b5cfeff7040cced3a\tscripts/booking-handoff-journal.test.mjs",
 "scripts/booking-ci-continuation-policy.test.mjs": "100644 blob 47075ea010d5a47c5bf21c88c9ac466eeb14e83f\tscripts/booking-ci-continuation-policy.test.mjs",
 "scripts/booking-compatibility-tool-policy.test.mjs": "100644 blob 4e8d784e90c89f3815fc2331fe724ae31c87997f\tscripts/booking-compatibility-tool-policy.test.mjs",
 "scripts/booking-formal-backup-policy.test.mjs": "100644 blob 0b8a83fd6e5a3a971ff6e78882678da4d4ea3263\tscripts/booking-formal-backup-policy.test.mjs",
 "scripts/booking-handoff-execution.mjs": "100644 blob 4bf2ebdeba14c7b6648c222265d2f43dfb0e549f\tscripts/booking-handoff-execution.mjs",
 "scripts/booking-handoff-execution.test.mjs": "100644 blob 6bf5fb31089342738c7e68c7c2afbc05384b5f2c\tscripts/booking-handoff-execution.test.mjs",
 "scripts/booking-handoff-host-io.mjs": "100644 blob c6c9052cb139a070ded807fb95fc6fbbd4ad1eb6\tscripts/booking-handoff-host-io.mjs",
 "scripts/booking-handoff-journal.mjs": "100644 blob dcaf3cdd8bc6222e452c90b5fdf9b0f3071bf7dc\tscripts/booking-handoff-journal.mjs",
 "scripts/booking-handoff-legacy.mjs": "100644 blob 3a1c678b249338a9c532b04479641f7153ca26db\tscripts/booking-handoff-legacy.mjs",
 "scripts/booking-handoff-routing.mjs": "100644 blob fa330476218ee598318af3e39e3f122e09bc0e70\tscripts/booking-handoff-routing.mjs",
 "scripts/booking-handoff-runtime.mjs": "100644 blob 2a1f3abf93958c989ec1f202b49ecf21a825a3c3\tscripts/booking-handoff-runtime.mjs",
 "scripts/booking-handoff-runtime.test.mjs": "100644 blob f995e6f3d3a45694bfb8c7ddd0d4bea46e3bed2f\tscripts/booking-handoff-runtime.test.mjs",
 "scripts/booking-registry-tool-policy.test.mjs": "100644 blob c8adcb83ef0cd20da78c9964f661f5f44b406d8a\tscripts/booking-registry-tool-policy.test.mjs",
 "scripts/online-traffic-release.mjs": "100644 blob 94216e0e2f35b8667936a9f40ddb3784c82ab256\tscripts/online-traffic-release.mjs"
});
export const BOOKING_DEPENDENCY_STOPPED=Object.freeze({
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/state.json": {
  "bytes": 25001,
  "sha256": "7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/booking-ci-continuation-tool.json": {
  "bytes": 718,
  "sha256": "f2d30b6e1ff3ec12aaa0bcc0e336978f2ff67e2744d979d945667e7b3739dc93"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/booking-ci-kernel7-job.log": {
  "bytes": 55312,
  "sha256": "a3f093a1fabd9798048d59ea375c4005df2b3561f7d70197c417abf238be343e"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/booking-ci-kernel7-run.json": {
  "bytes": 45694,
  "sha256": "808c6ad68b8559e3bcd75871ccf9d718fb39cd018afe4bb386cd1563c3c4b015"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/booking-install-attempt.json": {
  "bytes": 18554,
  "sha256": "ec5b257342cd458b65149d2777c137e0cb493a314ab26df2832c93c842757512"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/booking-database-inactive.json": {
  "bytes": 32250,
  "sha256": "2509116750d38562aa461196c6fdb4340b6d48e5627d9d4cf1a97c5df4699c65"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/attempt.json": {
  "bytes": 29595,
  "sha256": "cf9e09e7102137ec394f1c8abe599d64d54e2b7c68723ad18dab5e0a459025f4"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/backup.key": {
  "bytes": 64,
  "sha256": "0f34c4b1658b7d898066567638b8cc90bdd77d0376d9c1e67f7a9a3ccd4cfd7b"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/database.tar.enc": {
  "bytes": 551331872,
  "sha256": "9b01ca74ee96cbb7965010734d1f36500593c71375109980f813ae03f8f6304e"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/backup-create.json": {
  "bytes": 4326,
  "sha256": "2eed7ff755bb8955722d40a898573f38361ea635c6b384df5ccd160e3c3cea2d"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/backup-verify.json": {
  "bytes": 4637,
  "sha256": "3736682f51ddab262681c71480fa9cecdcf501612ca8f6d3d440064dffc9b312"
 },
 "/var/lib/faolla-online-release/f274ad615550c83717aa7af2ad32339608e6f8aa/formal-backup-20261027/application-binding.json": {
  "bytes": 5178,
  "sha256": "ba1b5a084e9ef03d8823a673a62210445dd50ba2b40ddc466d27f4d9e6fc0ef2"
 },
 "/var/lib/faolla-booking-pilot-session-GEw2vb/before.json": {
  "bytes": 4862,
  "sha256": "259bab442f0234ffbbe2f88e8a83fe29795c5de3c7a7c654d81623a64fa69f22"
 },
 "/var/lib/faolla-booking-pilot-session-GEw2vb/started.json": {
  "bytes": 3674,
  "sha256": "1c11daee973312e5bb97460bdb6f6c830b24ac141fd2da074e818f860aa23c7c"
 },
 "/var/lib/faolla-booking-pilot-session-GEw2vb/restore-attempt.json": {
  "bytes": 3676,
  "sha256": "6594eadf14ef594dc82888b343e62ccd86528710268e6c0b1ebfae3eef8598af"
 },
 "/var/lib/faolla-booking-pilot-session-GEw2vb/restored.json": {
  "bytes": 3675,
  "sha256": "e8d26073164269af678425f0e05024323cc0bb3e4e03aaad1bfa26d631c7c358"
 }
});
export const BOOKING_DEPENDENCY_STATES=Object.freeze({
 primary:{target:C,file:'booking-dependency-original-primary-state.json',sha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3'},
 rollback:{target:'6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0',file:'booking-dependency-original-rollback-state.json',sha256:'36b56054d7f532f7e088e4c4fb584fbc18ece90cd5811e31c6eca13c86e89c3a'}
});
const need=(v,c)=>{if(!v)throw Error('booking_dependency_continuation_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const name=r=>r.slice(r.indexOf('\t')+1);
const sameFiles=(a,b)=>Array.isArray(a)&&new Set(a).size===a.length&&isDeepStrictEqual([...a].sort(),[...b].sort());
export function bookingDependencyInputs(rows){
 need(Array.isArray(rows)&&rows.every(r=>/^(100644|100755) blob [a-f0-9]{40}\t[^\0\r\n]+$/.test(r))&&new Set(rows.map(name)).size===rows.length,'tree');
 return rows.filter(r=>!BOOKING_DEPENDENCY_FILES.includes(name(r))).join('\0');
}
// Test-only projection. Production attestation independently reads real trees.
export function projectBookingDependencyPredecessorRows(rows){
 bookingDependencyInputs(rows);
 return rows.filter(r=>!BOOKING_DEPENDENCY_FILES.includes(name(r))||BASE_ROWS[name(r)]).map(r=>BASE_ROWS[name(r)]??r);
}
export function assertBookingDependencyToolDelta({files,originalInputs,currentInputs,readBlob}){
 need(sameFiles(files,BOOKING_DEPENDENCY_FILES),'scope');
 need(typeof currentInputs==='string'&&originalInputs===currentInputs&&hash(currentInputs)===BOOKING_DEPENDENCY_INPUTS_SHA256,'application_inputs');
 assertBookingCiPins(readBlob);return BOOKING_DEPENDENCY_INPUTS_SHA256;
}
export const BOOKING_DEPENDENCY_TOOL_FILES=Object.freeze([...new Set([...BOOKING_CI_TOOL_FILES,...BOOKING_DEPENDENCY_FILES])]);
export function assertBookingDependencyToolClosure(input){
 if(sameFiles(input.files,BOOKING_CI_TOOL_FILES)||!input.files?.some(f=>f.startsWith('scripts/booking-dependency-')))return assertBookingCurrentToolClosure(input);
 need(input.baseline===C&&sameFiles(input.files,BOOKING_DEPENDENCY_TOOL_FILES),'tool_scope');
 assertBookingCiPins(input.readBlob);return hash(JSON.stringify([...input.files].sort().map(f=>[f,hash(input.readBlob(f))])));
}
export function assertBookingDependencyReceipt(value,revision){
 need(value&&isDeepStrictEqual(Object.keys(value).sort(),['schemaVersion','kind','priorTool','toolRevision','sourceInputsSha256','toolClosureSha256','stoppedEvidenceSha256','preparedAt'].sort()),'receipt_shape');
 need(value.schemaVersion===1&&value.kind==='booking-dependency-continuation-tool'&&value.priorTool===BOOKING_DEPENDENCY_BASE&&
  /^[a-f0-9]{40}$/.test(revision??'')&&revision!==BOOKING_DEPENDENCY_BASE&&value.toolRevision===revision&&
  value.sourceInputsSha256===BOOKING_DEPENDENCY_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(value.toolClosureSha256??'')&&
  value.stoppedEvidenceSha256===hash(JSON.stringify(BOOKING_DEPENDENCY_STOPPED))&&Number.isFinite(Date.parse(value.preparedAt)),'receipt');return true;
}

