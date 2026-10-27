// Fixed, independent CI-only successor. The old guards remain unchanged.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE,BOOKING_HANDOFF_TOOL_FILES,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
import {BOOKING_FORMAL_PRESERVED} from './booking-formal-backup-policy.mjs';
export const BOOKING_CI_BASE='5727fc6a82a944b5007abea1d9028b69e015625d';
export const BOOKING_CI_VERIFIED_SOURCE='b59fd9d6f8d3114710a046e9f06bdcff31d46524';
export const BOOKING_CI_RECEIPT='booking-ci-continuation-tool.json';
export const BOOKING_CI_FILES=Object.freeze([
 ".github/workflows/ci.yml",
 "scripts/ci-workflow-contract.test.mjs",
 "scripts/production-maintenance-ingress-acceptance.mjs",
 "scripts/production-maintenance-ingress-acceptance.test.mjs",
 "scripts/booking-ci-continuation-policy.mjs",
 "scripts/booking-ci-continuation-policy.test.mjs",
 "scripts/booking-ci-continuation-tool.mjs",
 "scripts/booking-ci-continuation-tool.test.mjs",
 "scripts/booking-ci-continuation.mjs",
 "scripts/booking-ci-continuation.test.mjs",
 "scripts/test-support/booking-ci-source-base.json",
 "scripts/booking-formal-backup.mjs",
 "scripts/booking-handoff-runtime.mjs",
 "scripts/booking-handoff-host-io.mjs",
 "scripts/booking-handoff-journal.mjs",
 "scripts/booking-handoff-routing.mjs",
 "scripts/booking-handoff-legacy.mjs",
 "scripts/online-traffic-release.mjs",
 "scripts/booking-formal-backup-policy.test.mjs",
 "scripts/booking-registry-tool-policy.test.mjs",
 "scripts/booking-compatibility-tool-policy.test.mjs",
 "scripts/booking-publication-policy.test.mjs"
]);
export const BOOKING_CI_INPUTS_SHA256='e20f05744b1ae4ae79c0b3389b7ff8578c83db158a39d721d091d168946b9657';
export const BOOKING_CI_PINS=Object.freeze({
 ".github/workflows/ci.yml": "d93c69b262ce8d190483b330042c229acbf2d1bef56f894b06e757207de5f895",
 "scripts/ci-workflow-contract.test.mjs": "6128f595488f54fee12768eb9f873c84f43bd7a18f953db284ce2a3745d42cb8",
 "scripts/production-maintenance-ingress-acceptance.mjs": "59953e4a411c0ba54c56335443e35ac093e94a57c364feec9cc545228ab4e963",
 "scripts/production-maintenance-ingress-acceptance.test.mjs": "6ff753d916ce14d76173dd942e07d897f7d53b5ebc72d7fe5c1cf6ec643f672c"
});
const BASE_ROWS=Object.freeze({
 ".github/workflows/ci.yml": "100644 blob e8b68c997355620b58ca66002d6959d4a9e9523e\t.github/workflows/ci.yml",
 "scripts/booking-compatibility-tool-policy.test.mjs": "100644 blob a126f4485170a195817e0c5a941685ca06d534d5\tscripts/booking-compatibility-tool-policy.test.mjs",
 "scripts/booking-formal-backup-policy.test.mjs": "100644 blob 61ae66899b4134e8105fd2679e2c73d0bcfe257a\tscripts/booking-formal-backup-policy.test.mjs",
 "scripts/booking-formal-backup.mjs": "100644 blob a2cafb2a40f6da42c7e5ad09bae5ffc6bd1b8b0c\tscripts/booking-formal-backup.mjs",
 "scripts/booking-handoff-host-io.mjs": "100644 blob a76ff9f550da6570612566f19055977a0abbf0a8\tscripts/booking-handoff-host-io.mjs",
 "scripts/booking-handoff-journal.mjs": "100644 blob f40e7ff441de34821e18af9cc57cf7f0f841b097\tscripts/booking-handoff-journal.mjs",
 "scripts/booking-handoff-legacy.mjs": "100644 blob e4db6968578f6ff04fbc2c3340b2814b3d26b9da\tscripts/booking-handoff-legacy.mjs",
 "scripts/booking-handoff-routing.mjs": "100644 blob e661ebdd58ec09111eda59d009f17bc8f7802b5f\tscripts/booking-handoff-routing.mjs",
 "scripts/booking-handoff-runtime.mjs": "100644 blob b448a8606d3154b47051be7c9bf37c99136e24f6\tscripts/booking-handoff-runtime.mjs",
 "scripts/booking-publication-policy.test.mjs": "100644 blob dca8cb241be939e8039a7336dbee8fde2f2f2992\tscripts/booking-publication-policy.test.mjs",
 "scripts/booking-registry-tool-policy.test.mjs": "100644 blob ade69efdb726d63185db72b61d81f87f7b5234d1\tscripts/booking-registry-tool-policy.test.mjs",
 "scripts/ci-workflow-contract.test.mjs": "100644 blob 2d4dd34b54584642fec3c0e1cd55d8d99b3c4cab\tscripts/ci-workflow-contract.test.mjs",
 "scripts/online-traffic-release.mjs": "100644 blob b9ca297156c176641c7e36641302c386a7f40cd5\tscripts/online-traffic-release.mjs",
 "scripts/production-maintenance-ingress-acceptance.mjs": "100644 blob 50307b20b1422c4b35230fd94a771b7df2483f8e\tscripts/production-maintenance-ingress-acceptance.mjs",
 "scripts/production-maintenance-ingress-acceptance.test.mjs": "100644 blob 7b47c6ca321b8a0dd636bf92e0f882da87e98b34\tscripts/production-maintenance-ingress-acceptance.test.mjs"
});
export const BOOKING_CI_EVIDENCE=Object.freeze({
 'booking-ci-kernel7-job.log':'a3f093a1fabd9798048d59ea375c4005df2b3561f7d70197c417abf238be343e',
 'booking-ci-kernel7-run.json':'808c6ad68b8559e3bcd75871ccf9d718fb39cd018afe4bb386cd1563c3c4b015',
});
const need=(v,c)=>{if(!v)throw Error('booking_ci_continuation_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const name=r=>r.slice(r.indexOf('\t')+1);
const sameFiles=(a,b)=>Array.isArray(a)&&new Set(a).size===a.length&&isDeepStrictEqual([...a].sort(),[...b].sort());
export function bookingCiInputs(rows){
 need(Array.isArray(rows)&&rows.every(r=>/^(100644|100755) blob [a-f0-9]{40}\t[^\0\r\n]+$/.test(r))&&new Set(rows.map(name)).size===rows.length,'tree');
 return rows.filter(r=>!BOOKING_CI_FILES.includes(name(r))).join('\0');
}
// Test-only projection of this exact successor onto its sealed predecessor.
// Runtime source verification separately reads and validates BOTH real trees.
export function projectBookingCiPredecessorRows(rows){
 bookingCiInputs(rows);
 return rows.filter(r=>!BOOKING_CI_FILES.includes(name(r))||BASE_ROWS[name(r)])
  .map(r=>BASE_ROWS[name(r)]??r);
}
export function assertBookingCiPins(readBlob){
 for(const [file,pin]of Object.entries(BOOKING_CI_PINS))need(hash(readBlob(file))===pin,'ci_content');
 return true;
}
export function assertBookingCiToolDelta({files,originalInputs,currentInputs,readBlob}){
 need(sameFiles(files,BOOKING_CI_FILES),'scope');
 need(typeof originalInputs==='string'&&originalInputs===currentInputs&&hash(currentInputs)===BOOKING_CI_INPUTS_SHA256,'application_inputs');
 assertBookingCiPins(readBlob);return BOOKING_CI_INPUTS_SHA256;
}
export const BOOKING_CI_TOOL_FILES=Object.freeze([...new Set([...BOOKING_HANDOFF_TOOL_FILES,...BOOKING_CI_FILES])]);
export function assertBookingCurrentToolClosure(input){
 if(sameFiles(input.files,BOOKING_HANDOFF_TOOL_FILES))return assertBookingHandoffToolClosure(input);
 need(input.baseline===BOOKING_HANDOFF_CANDIDATE&&sameFiles(input.files,BOOKING_CI_TOOL_FILES),'tool_scope');
 assertBookingCiPins(input.readBlob);
 return hash(JSON.stringify([...input.files].sort().map(f=>[f,hash(input.readBlob(f))])));
}
export function assertBookingCiReceipt(value,revision){
 need(value&&isDeepStrictEqual(Object.keys(value).sort(),['schemaVersion','kind','priorTool','base','verifiedCiSource','toolRevision',
  'sourceInputsSha256','toolClosureSha256','preservedSha256','kernelEvidenceSha256','preparedAt'].sort()),'receipt_shape');
 need(value.schemaVersion===1&&value.kind==='booking-ci-continuation-tool'&&value.priorTool==='0b0f3f9dbe60a2fa3553c3b510a937cd13c4bd35'&&
  value.base===BOOKING_CI_BASE&&value.verifiedCiSource===BOOKING_CI_VERIFIED_SOURCE&&
  /^[a-f0-9]{40}$/.test(revision??'')&&![value.priorTool,BOOKING_CI_BASE,BOOKING_CI_VERIFIED_SOURCE].includes(revision)&&value.toolRevision===revision&&
  value.sourceInputsSha256===BOOKING_CI_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(value.toolClosureSha256??'')&&
  value.preservedSha256===hash(JSON.stringify(BOOKING_FORMAL_PRESERVED))&&value.kernelEvidenceSha256===hash(JSON.stringify(BOOKING_CI_EVIDENCE))&&
  Number.isFinite(Date.parse(value.preparedAt)),'receipt');return true;
}
