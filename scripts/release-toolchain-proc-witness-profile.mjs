// Original 6e grammar for its ORIGINAL completed closure/qualification; current
// source retains its own full post-save observer, genuine lock and qualification.
import * as fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{PROC_WITNESS_PRIOR as H,procWitnessHistoricalBinding,assertProcWitnessHistoricalBinding,assertPinnedProcWitnessRefusal}from'./release-toolchain-proc-witness-contract.mjs';
import{inspectPinnedExecutionSource,ownedReleasePath}from'./release-toolchain-source.mjs';
import{inspectPostSaveWithPinnedSource}from'./release-toolchain-post-save-closed.mjs';
import{preIntentHistoricalBinding}from'./release-toolchain-pre-intent-profile.mjs';
import{assertOnlineRetentionHeldLocks}from'./online-release-retention-writer.mjs';
import{reviewedBookingExecution}from'./release-toolchain-authority.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';
import{validateAttendanceBackupEvidence}from'./attendance-production-database-migrations.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'evidence_invalid');
export const hasProcWitnessContinuationEvidence=()=>fs.existsSync(H.closedDirectory+'/closed.json');
export async function verifyPinnedProcWitnessHistory(preparedWorker){
 const directory='/var/lib/faolla-online-code/'+H.toolRevision,source=inspectPinnedExecutionSource({revision:H.toolRevision,directory});same(source.inventorySha256,H.inventorySha256);
 ownedReleasePath(H.closedDirectory,{directory:true,privateMode:true});same(sha256(bookingHostRead(H.closedDirectory+'/closed.json')),H.closedSha256);
 const original=await import('file://'+directory+'/scripts/release-toolchain-pre-intent-closure.mjs'),closed=await original.verifyClosedPreIntentAbort(H.toolRevision,preparedWorker);
 same(closed.directory,H.closedDirectory);same(closed.sha256,H.closedSha256);same(closed.qualificationSha256,H.qualificationSha256);
 const file=H.refusedBackup+'/controller-exit-unconfirmed.json';ownedReleasePath(H.refusedBackup,{directory:true,privateMode:true});const text=bookingHostRead(file),failure=JSON.parse(text);same(text,canonicalJson(failure)+'\n');same(sha256(text),H.refusalSha256);assertPinnedProcWitnessRefusal(failure);
 need(!fs.existsSync(H.refusedBackup+'/backup-producer-failure.json'),'attempt_unknown');
 await validateAttendanceBackupEvidence({target:H.toolRevision,backup:H.refusedBackup+'/database.tar.enc',createReport:H.refusedBackup+'/backup-create.json',verifyReport:H.refusedBackup+'/backup-verify.json'});
 return{kind:'original-proc-witness-prior-history-verified',...procWitnessHistoricalBinding()};
}
export async function inspectProcWitnessContinuation(toolRevision,heldLock,preparedWorker){
 need(toolRevision!==H.toolRevision&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'source_changed');
 if(heldLock){assertOnlineRetentionHeldLocks(heldLock);need(reviewedBookingExecution(toolRevision),'source_changed');}else need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'attempt_unknown');
 await verifyPinnedProcWitnessHistory(preparedWorker);
 // This is the ORIGINAL complete current-source verifier with the actual
 // current held token. Historical JSON is never a substitute for that token.
 const current=await inspectPostSaveWithPinnedSource(toolRevision,heldLock,preparedWorker),binding=procWitnessHistoricalBinding();assertProcWitnessHistoricalBinding(binding,toolRevision);
 return{...current,preIntentHistoricalBinding:preIntentHistoricalBinding(),procWitnessHistoricalBinding:binding};
}
