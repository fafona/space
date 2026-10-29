// Pending no-effects preparation, not a false current-tool incident closure.
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{PRE_ROUTE}from'./release-toolchain-pre-route-contract.mjs';
import{PRE_CONNECT as H}from'./release-toolchain-preconnect-contract.mjs';
import{observePreConnectForInstallation,preConnectPinsSha256}from'./release-toolchain-preconnect-evidence.mjs';
import{observeBookingReadyApplication}from'./booking-ready-backup.mjs';
import{inspectPinnedExecutionSource}from'./release-toolchain-source.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';
import{requireToolchain as need}from'./release-toolchain-contracts.mjs';
export async function verifyPreConnectAbortPreparation(revision,toolRevision){
 need(revision===BOOKING_PREPARATION_REVISION&&/^[a-f0-9]{40}$/.test(toolRevision??'')&&toolRevision!==H.toolRevision,'source_changed');
 const source=inspectPinnedExecutionSource({revision,directory:'/var/lib/faolla-online-code/'+revision}),execution=inspectPinnedExecutionSource({revision:toolRevision,directory:'/var/lib/faolla-online-code/'+toolRevision});await observePreConnectForInstallation();const old=JSON.parse(bookingHostRead(PRE_ROUTE.closedDirectory+'/closed.json')),context=JSON.parse(bookingHostRead(PRE_ROUTE.closedDirectory+'/closure-context.json'));
 return{revision,inventorySha256:source.inventorySha256,application:observeBookingReadyApplication(),preConnectAbort:{oldToolRevision:H.toolRevision,pinsSha256:preConnectPinsSha256(),originalOperationInode:H.operationInode,processControlAllowed:false,metadataWriteAllowed:false,processSaveAllowed:false,activationReplayAllowed:false,mailEnabled:false},activeIncidentClosed:{oldOperationId:P.operationId,generation:P.generation,toolRevision,toolInventorySha256:execution.inventorySha256,closedDirectory:PRE_ROUTE.closedDirectory,closedSha256:PRE_ROUTE.closedSha256,closureSha256:old.closureSha256,qualificationSha256:context.qualificationSha256,evidenceToolRevision:PRE_ROUTE.toolRevision,evidenceInventorySha256:PRE_ROUTE.inventorySha256,actualRoute:P.compatibleRollback,activationReplayAllowed:false,legacyRestartAllowed:false,mailEnabled:false}};
}
