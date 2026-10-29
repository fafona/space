// Narrow post-8607 source/closure bridge. Historical qualification retains its
// ORIGINAL revision. The current tool must separately pass full qualification.
import * as fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{PRE_ROUTE}from'./release-toolchain-pre-route-contract.mjs';
import{PRE_INTENT as H}from'./release-toolchain-pre-intent-pins.mjs';
import{observePreIntentUnchanged,preIntentPinsSha256,readPinnedPreIntentFailure}from'./release-toolchain-pre-intent-evidence.mjs';
import{inspectPreIntentClosedProfile}from'./release-toolchain-pre-intent-closure.mjs';
import{inspectPostSaveWithPinnedSource}from'./release-toolchain-post-save-closed.mjs';
import{observeBookingReadyApplication}from'./booking-ready-backup.mjs';
import{inspectPinnedExecutionSource}from'./release-toolchain-source.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';
import{requireToolchain as need}from'./release-toolchain-contracts.mjs';
export const preIntentHistoricalBinding=()=>({priorToolRevision:H.toolRevision,priorInventorySha256:H.inventorySha256,priorPreConnectClosureSha256:H.preConnectClosedSha256,priorPreConnectQualificationSha256:H.preConnectQualificationSha256,pinsSha256:preIntentPinsSha256(),originalOperationInode:H.operationInode});
export async function verifyPreIntentAbortPreparation(revision,toolRevision){
 need(revision===BOOKING_PREPARATION_REVISION&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==H.toolRevision&&!fs.existsSync(H.root),'source_changed');
 const source=inspectPinnedExecutionSource({revision,directory:'/var/lib/faolla-online-code/'+revision}),execution=inspectPinnedExecutionSource({revision:toolRevision,directory:'/var/lib/faolla-online-code/'+toolRevision});
 await observePreIntentUnchanged();const closed=JSON.parse(bookingHostRead(PRE_ROUTE.closedDirectory+'/closed.json')),context=JSON.parse(bookingHostRead(PRE_ROUTE.closedDirectory+'/closure-context.json'));
 return{revision,inventorySha256:source.inventorySha256,application:observeBookingReadyApplication(),preIntentAbort:{oldToolRevision:H.toolRevision,pinsSha256:preIntentPinsSha256(),originalOperationInode:H.operationInode,historical:preIntentHistoricalBinding(),processControlAllowed:false,metadataWriteAllowed:false,processSaveAllowed:false,activationReplayAllowed:false,mailEnabled:false},activeIncidentClosed:{oldOperationId:P.operationId,generation:P.generation,toolRevision,toolInventorySha256:execution.inventorySha256,closedDirectory:PRE_ROUTE.closedDirectory,closedSha256:PRE_ROUTE.closedSha256,closureSha256:closed.closureSha256,qualificationSha256:context.qualificationSha256,evidenceToolRevision:PRE_ROUTE.toolRevision,evidenceInventorySha256:PRE_ROUTE.inventorySha256,actualRoute:P.compatibleRollback,activationReplayAllowed:false,legacyRestartAllowed:false,mailEnabled:false}};
}
export async function inspectPreIntentContinuation(toolRevision,heldLock,preparedWorker){
 need(toolRevision!==H.toolRevision&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'source_changed');
 const closed=await inspectPreIntentClosedProfile(toolRevision,heldLock,preparedWorker);
 // Keep the ORIGINAL complete current-source post-save verifier, genuine
 // current held token, and original DC80 native readers. No foreign token or
 // historical procfs/CI observation is presented as a new current event.
 const current=await inspectPostSaveWithPinnedSource(toolRevision,heldLock,preparedWorker);
 return{...current,preIntentHistoricalBinding:preIntentHistoricalBinding(),...(closed?{preIntentQualificationSha256:closed.qualificationSha256,preIntentClosureSha256:closed.sha256}:{})};
}
export function hasPreIntentContinuationEvidence(){
 return fs.existsSync(H.root)||fs.existsSync('/var/lib/faolla-booking-active-publications/'+P.candidate+'/'+H.windowId);
}
// Static data witness only; callers still require the real profile/locks.
export const pinnedPreIntentFiles=()=>readPinnedPreIntentFailure();
