import {randomUUID} from 'node:crypto';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {observePostSaveIncident} from './release-toolchain-post-save-evidence.mjs';
import {POST_SAVE_PRIOR as H} from './release-toolchain-post-save-pins.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export async function verifyPostSavePreparation(revision,toolRevision){
 need(revision===BOOKING_PREPARATION_REVISION&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==H.toolRevision,'source_changed');
 const source=inspectPinnedExecutionSource({revision,directory:'/var/lib/faolla-online-code/'+revision}),at=Date.now(),window={id:randomUUID(),startedAt:new Date(at).toISOString(),deadlineAt:new Date(at+600000).toISOString()},observed=await observePostSaveIncident({window});
 return{revision,inventorySha256:source.inventorySha256,application:observeBookingReadyApplication(),postSavePartial:{priorToolRevision:H.toolRevision,priorDirectory:H.directory,pinsSha256:observed.history.pinsSha256,metadataSha256:observed.history.metadataSha256,persistenceSha256:observed.history.persistenceSha256,metadataWriteAllowed:false,processSaveAllowed:false,activationReplayAllowed:false,mailEnabled:false}};
}
