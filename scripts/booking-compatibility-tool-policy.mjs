// Approved successor to the sealed smoke repair, not a widening of that case.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const BOOKING_COMPATIBILITY_PRIOR_TOOL='38de1223f91e3049d6d78cfff38b58ca0b9d7d6b';
export const BOOKING_COMPATIBILITY_ORIGINAL_TOOL='2fec6ef6f482cbdd066103986b9aad23c201a919';
export const BOOKING_COMPATIBILITY_RECEIPT='booking-compatibility-tool.json';
export const BOOKING_COMPATIBILITY_PRESERVED=Object.freeze({
 'built-smoke-original-state.json':'d0e8d279f285c2dcc70b4b48413bb24104ae41606817b98ce0bdc505eca96964',
 'built-smoke-tool-repair.json':'2fc2ba1497d50d57cf1b3523e4766ecdf6d80cd539640af18ed95e3a81d41ecd',
 'booking-compatibility-attempt.json':'364638df0c2df940fdde7bfbcb618f79527f57a81b89d0444bb9c2d1dabc8aae',
 'booking-compatibility-extension.json':'f3099bc3af1b06a31ed4ec82e224e662ecc269573a597b0c6b8e95ecfca2416b',
 'booking-compatibility-metadata.sql':'4fa00b5c46180aecff8fd67b5c9e9c26482585e67df0f98ade06be2b0e5b2b9d',
 'booking-compatibility-supplement.sql':'4d0411d8405dcce07e600b2dc5de81b0c7eb7e42a609d92f7eec889237bd0db5',
});
export const BOOKING_COMPATIBILITY_STAGED_SHA256='6c11e4111093d1a0d596b02b1e7b08749112862bb05912ab36da28d362fa8115';
export const BOOKING_COMPATIBILITY_TOOL_FILES=Object.freeze([
 'scripts/booking-compatibility-extension.mjs','scripts/booking-compatibility-extension.test.mjs',
 'scripts/booking-compatibility-tool-policy.mjs','scripts/booking-compatibility-tool-policy.test.mjs',
 'scripts/booking-compatibility-tool.mjs','scripts/booking-compatibility-tool.test.mjs',
 'scripts/booking-publication-compatibility.mjs','scripts/booking-publication-compatibility.test.mjs',
 'scripts/booking-publication-policy.test.mjs',
 'scripts/booking-handoff-pending.mjs','scripts/booking-handoff-policy.mjs',
 'scripts/booking-handoff-runtime.mjs','scripts/booking-handoff-runtime.test.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
]);
export const BOOKING_COMPATIBILITY_INPUTS_SHA256='d23df45b04fb7352c58278d89dd0b97314ba80765af835d88dcec29a111ee044';
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error('booking_compatibility_tool_'+c);};
export function assertBookingCompatibilityToolDelta({files,originalInputs,currentInputs}){
 need(Array.isArray(files)&&new Set(files).size===files.length&&isDeepStrictEqual([...files].sort(),[...BOOKING_COMPATIBILITY_TOOL_FILES].sort()),'scope');
 need(typeof originalInputs==='string'&&currentInputs===originalInputs&&hash(currentInputs)===BOOKING_COMPATIBILITY_INPUTS_SHA256,'application_inputs');
 return BOOKING_COMPATIBILITY_INPUTS_SHA256;
}
export function assertBookingCompatibilityToolReceipt(receipt,toolRevision){
 need(receipt&&isDeepStrictEqual(Object.keys(receipt).sort(),['schemaVersion','kind','priorTool','originalTool','toolRevision','sourceInputsSha256','toolClosureSha256','preservedSha256','preparedAt'].sort()),'receipt_shape');
 need(receipt.schemaVersion===1&&receipt.kind==='booking-compatibility-tool'&&receipt.priorTool===BOOKING_COMPATIBILITY_PRIOR_TOOL&&
  receipt.originalTool===BOOKING_COMPATIBILITY_ORIGINAL_TOOL&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==receipt.priorTool&&
  receipt.toolRevision===toolRevision&&receipt.sourceInputsSha256===BOOKING_COMPATIBILITY_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(receipt.toolClosureSha256??'')&&
  receipt.preservedSha256===hash(JSON.stringify(BOOKING_COMPATIBILITY_PRESERVED))&&Number.isFinite(Date.parse(receipt.preparedAt)),'receipt');
 return true;
}
