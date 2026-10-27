// Approved successor to the sealed smoke repair, not a widening of that case.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_COMPATIBILITY_PRESERVED} from './booking-compatibility-tool-policy.mjs';
export const BOOKING_REGISTRY_PRIOR_TOOL='83eb6014ef541cf2266f34701bc67fd126ae7bc9';
export const BOOKING_REGISTRY_ORIGINAL_TOOL='2fec6ef6f482cbdd066103986b9aad23c201a919';
export const BOOKING_REGISTRY_RECEIPT='booking-registry-tool.json';
export const BOOKING_REGISTRY_PRESERVED=Object.freeze({
 ...BOOKING_COMPATIBILITY_PRESERVED,
 'booking-compatibility-tool.json':'38d571df1e67204c1c79cf741be5d5b75a2a24977bcda3f913c0bd47521882c2',
 'booking-compatibility-adapter-attempt.json':'96624a592697a9c6ac3731cbbde7446e854005d08ae5a1c91e30cd6ac45485a3',
 'booking-compatibility-adapter-extension.json':'77dfb7919dd0f4f557a29bc12e1920933bc0449b8060f8f62dd951dd2f736be6',
 'booking-compatibility-adapter-metadata.sql':'4fa00b5c46180aecff8fd67b5c9e9c26482585e67df0f98ade06be2b0e5b2b9d',
 'booking-compatibility-adapter-supplement.sql':'9f313b846eb3912b567e6956b5681c5724430103bf4af32e7690b4d4f9352027',
});
export const BOOKING_REGISTRY_STAGED_SHA256='6c11e4111093d1a0d596b02b1e7b08749112862bb05912ab36da28d362fa8115';
export const BOOKING_REGISTRY_TOOL_FILES=Object.freeze([
 "scripts/booking-registry-backup.mjs",
 "scripts/booking-registry-backup.test.mjs",
 "scripts/booking-handoff-execution.mjs",
 "scripts/booking-handoff-execution.test.mjs",
 "scripts/booking-handoff-journal.mjs",
 "scripts/booking-handoff-journal.test.mjs",
 "scripts/booking-registry-extension.mjs",
 "scripts/booking-registry-extension.test.mjs",
 "scripts/booking-registry-tool-policy.mjs",
 "scripts/booking-registry-tool-policy.test.mjs",
 "scripts/booking-registry-tool.mjs",
 "scripts/booking-registry-tool.test.mjs",
 "scripts/booking-publication-database.mjs",
 "scripts/booking-publication-database.test.mjs",
 "scripts/booking-publication-compatibility.mjs",
 "scripts/booking-publication-compatibility.test.mjs",
 "scripts/booking-publication-policy.test.mjs",
 "scripts/booking-handoff-pending.mjs",
 "scripts/booking-handoff-policy.mjs",
 "scripts/booking-handoff-runtime.mjs",
 "scripts/booking-handoff-runtime.test.mjs",
 "scripts/online-traffic-release.mjs",
 "scripts/online-traffic-release.test.mjs",
 "scripts/booking-compatibility-tool-policy.test.mjs"
]);
export const BOOKING_REGISTRY_INPUTS_SHA256='7974bfa4d8554d4946ec76e9fbc4a205c84791da0b866391abb59d039b60e1fa';
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error('booking_registry_tool_'+c);};
export function assertBookingRegistryToolDelta({files,originalInputs,currentInputs}){
 need(Array.isArray(files)&&new Set(files).size===files.length&&isDeepStrictEqual([...files].sort(),[...BOOKING_REGISTRY_TOOL_FILES].sort()),'scope');
 need(typeof originalInputs==='string'&&currentInputs===originalInputs&&hash(currentInputs)===BOOKING_REGISTRY_INPUTS_SHA256,'application_inputs');
 return BOOKING_REGISTRY_INPUTS_SHA256;
}
export function assertBookingRegistryToolReceipt(receipt,toolRevision){
 need(receipt&&isDeepStrictEqual(Object.keys(receipt).sort(),['schemaVersion','kind','priorTool','originalTool','toolRevision','sourceInputsSha256','toolClosureSha256','preservedSha256','preparedAt'].sort()),'receipt_shape');
 need(receipt.schemaVersion===1&&receipt.kind==='booking-registry-tool'&&receipt.priorTool===BOOKING_REGISTRY_PRIOR_TOOL&&
  receipt.originalTool===BOOKING_REGISTRY_ORIGINAL_TOOL&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==receipt.priorTool&&
  receipt.toolRevision===toolRevision&&receipt.sourceInputsSha256===BOOKING_REGISTRY_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(receipt.toolClosureSha256??'')&&
  receipt.preservedSha256===hash(JSON.stringify(BOOKING_REGISTRY_PRESERVED))&&Number.isFinite(Date.parse(receipt.preparedAt)),'receipt');
 return true;
}
