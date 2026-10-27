// Independent, fixed successor. The sealed registry case and shared DR rules
// are unchanged. No arbitrary candidate, backup namespace or DB is admitted.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const BOOKING_FORMAL_PRIOR_TOOL='0b0f3f9dbe60a2fa3553c3b510a937cd13c4bd35';
export const BOOKING_FORMAL_RECEIPT='booking-formal-backup-tool.json';
export const BOOKING_FORMAL_INPUTS_SHA256='2f264e63f38cd605f62e4fa9a7df595c254e8ff662c7e8a61a50e2187c7a0bae';
export const BOOKING_FORMAL_DIRECTORY='formal-backup-20261027';
export const BOOKING_FORMAL_FILES=Object.freeze([
 'scripts/booking-formal-backup-policy.mjs','scripts/booking-formal-backup-policy.test.mjs',
 'scripts/booking-formal-backup-tool.mjs','scripts/booking-formal-backup-tool.test.mjs',
 'scripts/booking-formal-backup.mjs','scripts/booking-formal-backup.test.mjs',
 'scripts/booking-publication-database.mjs','scripts/booking-handoff-execution.mjs','scripts/booking-handoff-execution.test.mjs',
 'scripts/booking-handoff-journal.mjs','scripts/booking-handoff-journal.test.mjs',
 'scripts/booking-handoff-runtime.mjs','scripts/booking-handoff-runtime.test.mjs',
 'scripts/booking-handoff-policy.mjs','scripts/booking-registry-tool-policy.test.mjs','scripts/booking-compatibility-tool-policy.test.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','scripts/booking-publication-policy.test.mjs',
]);
export const BOOKING_FORMAL_PRESERVED=Object.freeze({
 'booking-registry-tool.json':{sha256:'d7b5aabbed4505cf36ec2fdf964b200b8a3fa55579b070f475aba5f127af99a6',bytes:559},
 'booking-compatibility-registry-attempt.json':{sha256:'d574eb0e8addfff12d7e297d1059607d585f145249dbd3dd46a6ade9b64cf8c8',bytes:742},
 'booking-compatibility-registry-extension.json':{sha256:'77dfb7919dd0f4f557a29bc12e1920933bc0449b8060f8f62dd951dd2f736be6',bytes:289465},
 'booking-compatibility-registry-metadata.sql':{sha256:'4fa00b5c46180aecff8fd67b5c9e9c26482585e67df0f98ade06be2b0e5b2b9d',bytes:6062743},
 'booking-compatibility-registry-supplement.sql':{sha256:'95ea97418811554bf5d750106d1f50858fbc54335ce7f5e0726f158c46849b15',bytes:423708},
 'booking-compatibility.json':{sha256:'d74c9bf864b8a96aa0b381b4cacdf9619d37f4fc63472cfdd7175e61a9b52452',bytes:896},
 'booking-compatibility-evidence.json':{sha256:'cd29aa84307db3872ec60cd328b4a87814799dc53530ab7bf5af5cbcc6cf1a60',bytes:26219},
 // This is a rejected PILOT backup, never formal recovery evidence. Keep all
 // four original files byte-for-byte at their original paths.
 'backup.key':{sha256:'884d5c687e06e4d8f0f09dd905a138e3e97d2526208b8a981b79f33f27991c61',bytes:64},
 'database.tar.enc':{sha256:'01ed926ad6532f33860b1d670057f5986e0a41638b1a1fd22015a74d86e6e020',bytes:549908512},
 'backup-create.json':{sha256:'68ba2b6892e1194ea8bf254c13fcac59f14fb61794dc687f3aa78a6909e2c946',bytes:3288},
 'backup-verify.json':{sha256:'5ef0e1263cd7cfc5eb1549b136bc290184ec2db9906581f0f99e03bbe328fd49',bytes:3511},
});
export const BOOKING_FORMAL_PILOT_IDS=Object.freeze([
 '0d0a85a8ff50b585f690ba80a56d7d215adca2df1fa7c820840ff3389687d907',
 '64e442c27f0b2085b0dd566f90bad16cbad5053e58a605d81865c21ef3ba28b6',
 '65f891b4bbffc01b5bf3d5f5bb4a8b180891c48ea8ed97eaf56ec908c288341b',
 'cf01ce96a0a5770f13789eca3c5fe1f8f31ec6fc7d917e460e46994215f7fafb',
 'f108ac45cda5de58dbf0e618fd8208c4a96271e087d221865c293ea8d37c4590',
]);
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error('booking_formal_backup_'+c);};
export function assertBookingFormalToolDelta({files,originalInputs,currentInputs}){
 need(Array.isArray(files)&&new Set(files).size===files.length&&isDeepStrictEqual([...files].sort(),[...BOOKING_FORMAL_FILES].sort()),'scope');
 need(typeof originalInputs==='string'&&currentInputs===originalInputs&&hash(currentInputs)===BOOKING_FORMAL_INPUTS_SHA256,'application_inputs');
 return BOOKING_FORMAL_INPUTS_SHA256;
}
export function assertBookingFormalToolReceipt(value,toolRevision){
 need(value&&isDeepStrictEqual(Object.keys(value).sort(),['schemaVersion','kind','priorTool','toolRevision','sourceInputsSha256','toolClosureSha256','preservedSha256','preparedAt'].sort()),'receipt_shape');
 need(value.schemaVersion===1&&value.kind==='booking-formal-backup-tool'&&value.priorTool===BOOKING_FORMAL_PRIOR_TOOL&&
  /^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==BOOKING_FORMAL_PRIOR_TOOL&&value.toolRevision===toolRevision&&
  value.sourceInputsSha256===BOOKING_FORMAL_INPUTS_SHA256&&/^[a-f0-9]{64}$/.test(value.toolClosureSha256??'')&&
  value.preservedSha256===hash(JSON.stringify(BOOKING_FORMAL_PRESERVED))&&Number.isFinite(Date.parse(value.preparedAt)),'receipt');return true;
}
