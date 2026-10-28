// One exact metadata correction, not routing/activation, a release certificate,
// or permission to remove the old operation directory. No CLI action exists.
import * as fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingWindow,assertActiveBookingObservedHostProgress} from './release-toolchain-active-generation-contract.mjs';
import {inspectActiveBookingIncident,inspectActiveBookingIncidentAfterMetadata} from './release-toolchain-active-generation-incident.mjs';
import {verifyActiveBookingIncidentPreservation} from './release-toolchain-active-generation-preservation.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks,assertActiveBookingIncidentHeldWindow} from './online-release-retention-writer.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostReplace,bookingHostSync} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const digest=/^[a-f0-9]{64}$/;
export function assertActiveMetadataOnlyDelta(before,after){
 need(before?.oldOperationId===P.operationId&&after?.oldOperationId===P.operationId&&before.metadataCorrected===false&&after.metadataCorrected===true&&before.activeMetadataSha256===sha256(M.beforeText)&&after.activeMetadataSha256===sha256(M.afterText)&&before.publicationAuthority===false&&after.publicationAuthority===false,'evidence_invalid');assertActiveBookingObservedHostProgress(before,after);return true;
}
export function assertActiveCorrectedObservationProgress(before,after){
 need(before?.oldOperationId===P.operationId&&after?.oldOperationId===P.operationId&&before.metadataCorrected===true&&after.metadataCorrected===true&&before.activeMetadataSha256===sha256(M.afterText)&&after.activeMetadataSha256===sha256(M.afterText)&&before.publicationAuthority===false&&after.publicationAuthority===false,'evidence_invalid');assertActiveBookingObservedHostProgress(before,after);return true;
}
// Same physical write/fsync/readback path for fixed production metadata and
// owned CI metadata. Factories below construct all paths and ownership checks.
async function correctMetadata({file,beforeText,afterText,directory,binding,assertHeld,observe,verifyDelta}){
 need(!['metadata-before-observation.json','metadata-correction-intent.json','metadata-after-observation.json','metadata-corrected.json','metadata-correction-failed.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_replay_forbidden');
 let stage='before-observation';try{
  assertHeld();const before=await observe('before');assertHeld();same(bookingHostRead(file),beforeText);
  seal(directory+'/metadata-before-observation.json',before);assertHeld();
  stage='durable-intent';seal(directory+'/metadata-correction-intent.json',{kind:'active-incident-compatible-metadata-correction-intent',binding,file,beforeSha256:sha256(beforeText),afterSha256:sha256(afterText),beforeObservationSha256:sha256(canonicalJson(before)),at:new Date().toISOString(),publicationAuthority:false});
  assertHeld();same(bookingHostRead(file),beforeText);stage='single-compare-and-replace';bookingHostReplace(file,beforeText,afterText,binding.window.id+'-compatible-metadata');assertHeld();
  stage='independent-after-observation';same(bookingHostRead(file),afterText);const after=await observe('after');assertHeld();seal(directory+'/metadata-after-observation.json',after);assertHeld();verifyDelta(before,after);
  const receipt={kind:'active-incident-compatible-metadata-corrected',binding,beforeSha256:sha256(beforeText),afterSha256:sha256(afterText),beforeObservationSha256:sha256(canonicalJson(before)),afterObservationSha256:sha256(canonicalJson(after)),routingChanged:false,productionDatabaseMutated:false,processControlPerformed:false,oldOperationRemoved:false,publicationAuthority:false,completedAt:new Date().toISOString()};
  stage='durable-metadata-receipt';seal(directory+'/metadata-corrected.json',receipt);assertHeld();same(bookingHostRead(file),afterText);return receipt;
 }catch(error){try{assertHeld();seal(directory+'/metadata-correction-failed.json',{kind:'active-incident-metadata-correction-unconfirmed',binding,stage,code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'operation_unconfirmed',errorSha256:sha256(String(error?.message??'unknown')),resultNotAutomaticallyRestored:true,publicationAuthority:false,at:new Date().toISOString()});}catch{}throw error;}
}
export async function correctActiveBookingCompatibleMetadata({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 assertActiveBookingIncidentHeldWindow(lock,window);
 const preserved=verifyActiveBookingIncidentPreservation({lock,toolRevision,window});
 const binding={oldOperationId:P.operationId,window,toolRevision,toolInventorySha256:authority.tool.inventorySha256,preservedSha256:preserved.preservedSha256};
 need(digest.test(binding.preservedSha256),'evidence_invalid');
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');verifyActiveBookingIncidentPreservation({lock,toolRevision,window});};
 return correctMetadata({file:'/var/lib/faolla-online-release/active.json',beforeText:M.beforeText,afterText:M.afterText,directory:preserved.directory,binding,assertHeld:held,
  observe:phase=>phase==='before'?inspectActiveBookingIncident({window}):inspectActiveBookingIncidentAfterMetadata({window}),verifyDelta:assertActiveMetadataOnlyDelta});
}
export function verifyActiveBookingMetadataCorrection({lock,toolRevision,window}){
 const preserved=verifyActiveBookingIncidentPreservation({lock,toolRevision,window}),authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 const directory=preserved.directory,binding={oldOperationId:P.operationId,window,toolRevision,toolInventorySha256:authority.tool.inventorySha256,preservedSha256:preserved.preservedSha256},read=name=>{const text=bookingHostRead(directory+'/'+name),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
 need(!fs.existsSync(directory+'/metadata-correction-failed.json'),'operation_unconfirmed');
 const before=read('metadata-before-observation.json'),after=read('metadata-after-observation.json'),intent=read('metadata-correction-intent.json'),receipt=read('metadata-corrected.json');assertActiveMetadataOnlyDelta(before,after);
 const beforeSha256=sha256(M.beforeText),afterSha256=sha256(M.afterText),beforeObservationSha256=sha256(canonicalJson(before)),afterObservationSha256=sha256(canonicalJson(after));
 same(intent,{kind:'active-incident-compatible-metadata-correction-intent',binding,file:'/var/lib/faolla-online-release/active.json',beforeSha256,afterSha256,beforeObservationSha256,at:intent.at,publicationAuthority:false});
 same(receipt,{kind:'active-incident-compatible-metadata-corrected',binding,beforeSha256,afterSha256,beforeObservationSha256,afterObservationSha256,routingChanged:false,productionDatabaseMutated:false,processControlPerformed:false,oldOperationRemoved:false,publicationAuthority:false,completedAt:receipt.completedAt});
 for(const date of [intent.at,receipt.completedAt]){const ms=Date.parse(date);need(Number.isFinite(ms)&&new Date(ms).toISOString()===date&&ms>=Date.parse(window.startedAt)&&ms<=Date.now()&&ms<Date.parse(window.deadlineAt),'evidence_invalid');}
 need(Date.parse(receipt.completedAt)>=Date.parse(intent.at),'evidence_invalid');same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);assertOnlineRetentionHeldLocks(lock);
 return{directory,binding,before,after,receipt,receiptSha256:sha256(bookingHostRead(directory+'/metadata-corrected.json'))};
}
export async function correctOwnedActiveReconciliationMetadata(capability,lock,window){
 const {ownedActiveReconciliationScope,observeOwnedActiveReconciliation,assertOwnedActiveReconciliationDelta}=await import('./release-toolchain-active-generation-owned-lab.mjs');
 const {ownedActiveReconciliationHeldChecker}=await import('./online-release-retention-writer.mjs'),held=ownedActiveReconciliationHeldChecker(capability,lock),s=ownedActiveReconciliationScope(capability);
 const preserved=JSON.parse(bookingHostRead(s.directory+'/vault/preserved.json'));
 need(preserved.binding.kind==='owned-active-reconciliation-preservation'&&preserved.publicationAuthority===false,'evidence_invalid');
 return correctMetadata({file:s.directory+'/active.json',beforeText:s.beforeText,afterText:s.afterText,directory:s.directory+'/vault',binding:{kind:'owned-active-reconciliation-metadata',window,preservedSha256:sha256(bookingHostRead(s.directory+'/vault/preserved.json')),publicationAuthority:false},assertHeld:()=>{ownedActiveReconciliationScope(capability);held();},observe:()=>observeOwnedActiveReconciliation(capability),verifyDelta:(before,after)=>assertOwnedActiveReconciliationDelta(before,after,{metadata:true})});
}
export async function acceptActiveIncidentMetadataInCi(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(f=>fs.existsSync(f)),'ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-active-metadata-ci-');fs.chmodSync(root,0o700);seal(root+'/started.json',{kind:'active-incident-metadata-ci-started',syntheticInputsOnly:true,at:new Date().toISOString()});let stage='prepare';
 try{
  const cases=[],beforeText='{"target":"owned-ci-old"}',afterText='{"target":"owned-ci-compatible"}';
  const prepare=name=>{const directory=root+'/'+name;fs.mkdirSync(directory,{mode:0o700});bookingHostSync(root);const file=directory+'/active.json';bookingHostWriteOnce(file,beforeText);bookingHostWriteOnce(directory+'/unrelated.json','{"unchanged":true}');let held=true,failAfter=false;
   const start=Date.now(),binding={kind:'owned-ci-metadata-profile',window:{id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()}};
   return{file,directory,lose:()=>{held=false;},failAfter:()=>{failAfter=true;},run:()=>correctMetadata({file,beforeText,afterText,directory,binding,assertHeld:()=>need(held,'ci_ownership_lost'),observe:phase=>{if(phase==='after'&&failAfter)throw Error('ci_after_observation_refused');same(bookingHostRead(file),phase==='before'?beforeText:afterText);return{phase,unrelated:bookingHostRead(directory+'/unrelated.json')};},verifyDelta:(before,after)=>same(before.unrelated,after.unrelated)})};};
  stage='actual-correction';const normal=prepare('normal'),receipt=await normal.run();need(receipt.routingChanged===false&&receipt.productionDatabaseMutated===false&&receipt.publicationAuthority===false,'ci_authority_leak');same(bookingHostRead(normal.file),afterText);cases.push('single-atomic-correction-with-independent-readback');
  stage='replay-refusal';let refused=false;try{await normal.run();}catch{refused=true;}need(refused,'ci_refusal_missing');same(bookingHostRead(normal.file),afterText);cases.push('replay-does-not-overwrite-or-revert');
  stage='lost-ownership';const lost=prepare('lost');lost.lose();refused=false;try{await lost.run();}catch{refused=true;}need(refused,'ci_refusal_missing');same(bookingHostRead(lost.file),beforeText);need(!fs.existsSync(lost.directory+'/metadata-corrected.json'),'ci_false_receipt');cases.push('lost-ownership-refuses-before-replace');
  stage='unknown-after-replace';const unknown=prepare('unknown');unknown.failAfter();refused=false;try{await unknown.run();}catch{refused=true;}need(refused,'ci_refusal_missing');same(bookingHostRead(unknown.file),afterText);need(!fs.existsSync(unknown.directory+'/metadata-corrected.json')&&fs.existsSync(unknown.directory+'/metadata-correction-intent.json')&&fs.existsSync(unknown.directory+'/metadata-correction-failed.json'),'ci_unknown_not_retained');cases.push('unknown-after-replace-retains-new-bytes-without-false-success');
  const report={kind:'active-incident-metadata-native-acceptance',root,cases,realOwnedFiles:true,failedEvidenceRetained:true,formalHostTouched:false,fullActiveReleaseAccepted:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(root+'/acceptance.json',report);return report;
 }catch(error){try{seal(root+'/failure.json',{stage,errorSha256:sha256(String(error?.message??'unknown')),detailsRedacted:true,at:new Date().toISOString()});}catch{}throw error;}
}
