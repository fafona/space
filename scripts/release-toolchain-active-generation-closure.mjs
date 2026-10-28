// Fixed ACTIVE-incident reconciliation only. It never activates SQL, changes
// routes/business data, restarts an app, enables mail, or claims publication.
// The entry constructs every real resource; JSON cannot recreate this scope.
import * as fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingWindow,assertActiveBookingDatabaseProgress,assertActiveBookingObservedHostProgress,executeActiveBookingReconciliation} from './release-toolchain-active-generation-contract.mjs';
import {inspectActiveBookingIncident,inspectActiveBookingIncidentAfterMetadata} from './release-toolchain-active-generation-incident.mjs';
import {preserveActiveBookingIncidentEvidence,verifyActiveBookingIncidentPreservation} from './release-toolchain-active-generation-preservation.mjs';
import {correctActiveBookingCompatibleMetadata,verifyActiveBookingMetadataCorrection,assertActiveMetadataOnlyDelta} from './release-toolchain-active-generation-metadata.mjs';
import {persistActiveBookingCurrentProcesses,verifyActiveBookingProcessPersistence,verifyActiveBookingArchivedProcessPersistence} from './release-toolchain-active-generation-persistence.mjs';
import {verifyLatestActiveBookingQualification} from './release-toolchain-active-generation-qualification.mjs';
import {assertOnlineRetentionHeldLocks,assertActiveBookingIncidentHeldWindow,assertReleasedActiveBookingScope,activeBookingArchiveWitness,archiveActiveBookingClosureOperation,releaseActiveBookingClosureOperation} from './online-release-retention-writer.mjs';
import {reviewedBookingExecution,refreshReviewedBookingExecution} from './release-toolchain-authority.mjs';
import {createReviewedBookingBackup} from './release-toolchain-backup-producer.mjs';
import {admissionFileFact} from './release-toolchain-admission-context.mjs';
import {observeBookingCompatibility} from './release-toolchain-booking-admission.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {bookingHostRead,bookingHostSql,bookingHostWriteOnce,bookingHostSync} from './booking-handoff-host-io.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
const scopes=new WeakMap(),same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;},digest=file=>sha256(bookingHostRead(file,{binary:true}));
const VAULT_FILES=Object.freeze(['intent.json','preserved.json','current-observation.json','metadata-before-observation.json','metadata-correction-intent.json','metadata-after-observation.json','metadata-corrected.json','pm2-persistence-before-observation.json','pm2-persistence-after-observation.json','pm2-persistence-attempt.json','pm2-persistence-completed.json','pm2-dump-before.json','pm2-backup-before.json','closure-context.json','closure-postconditions.json']);
function scope(options){
 const {lock,toolRevision,window}=options;assertOnlineRetentionHeldLocks(lock);assertActiveBookingIncidentHeldWindow(lock,window);assertActiveBookingWindow(window);const s=scopes.get(lock);need(s&&s.toolRevision===toolRevision&&isDeepStrictEqual(s.window,window)&&reviewedBookingExecution(toolRevision)===s.authority,'evidence_invalid');
 for(const [file,witness]of s.witnesses)same(admissionFileFact(file),witness);return s;
}
function vaultFiles(s){const pins=read(s.directory+'/preserved.json').files;return Object.fromEntries([...VAULT_FILES,...pins.map(v=>v.name)].map(name=>[name,digest(s.directory+'/'+name)]));}
export async function verifyActiveBookingClosure(options){
 const s=scope(options),qualified=verifyLatestActiveBookingQualification(options);same(qualified.sha256,s.qualification.sha256);same(qualified.attempt,s.qualification.attempt);
 const preserved=verifyActiveBookingIncidentPreservation(options),metadata=verifyActiveBookingMetadataCorrection(options);same(preserved.directory,s.directory);same(metadata.receiptSha256,s.metadataSha256);
 const archived=activeBookingArchiveWitness(options.lock),persistence=await(archived?verifyActiveBookingArchivedProcessPersistence(options):verifyActiveBookingProcessPersistence(options));same(persistence.persistenceSha256,s.persistenceSha256);
 same(observeBookingCompatibility(qualified.native),s.compatibility);same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);
 const context=read(s.directory+'/closure-context.json');same(context,s.context);const postconditions=read(s.directory+'/closure-postconditions.json');assertActiveMetadataOnlyDelta(s.before,postconditions);same(digest(s.directory+'/closure-postconditions.json'),s.postconditionsSha256);
 if(!archived)assertActiveBookingObservedHostProgress(postconditions,persistence.current);
 else{const current=structuredClone(persistence.current);delete current.originalOperationArchived;assertActiveBookingObservedHostProgress(postconditions,current);}
 need(!['closure-failed.json','metadata-correction-failed.json','pm2-persistence-failed.json'].some(name=>fs.existsSync(s.directory+'/'+name)),'operation_unconfirmed');
 const closure=read(s.directory+'/closure-sealed.json');same(closure,{kind:'active-incident-reconciliation-sealed',oldOperationId:P.operationId,generation:P.generation,window:s.window,toolRevision:s.toolRevision,inventorySha256:s.authority.tool.inventorySha256,qualificationSha256:s.qualification.sha256,backupBindingSha256:digest(s.backupDirectory+'/backup-application-binding.json'),metadataSha256:s.metadataSha256,persistenceSha256:s.persistenceSha256,files:vaultFiles(s),originalEvidenceRetained:true,activationReplayed:false,legacyRestarted:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false,completedAt:closure.completedAt});
 const at=Date.parse(closure.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===closure.completedAt&&at>=Date.parse(s.window.startedAt)&&at<=Date.now()&&at<Date.parse(s.window.deadlineAt),'evidence_stale');scope(options);return{directory:s.directory,sha256:digest(s.directory+'/closure-sealed.json')};
}
export async function reconcileActiveBookingIncidentUnderHeldLocks(options){
 const {lock,toolRevision,window}=options;assertOnlineRetentionHeldLocks(lock);assertActiveBookingIncidentHeldWindow(lock,window);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority&&!scopes.has(lock),'source_changed');
 const qualification=verifyLatestActiveBookingQualification(options),s={toolRevision,window,authority,qualification,witnesses:new Map()};scopes.set(lock,s);let stage='inspect';
 const held=()=>scope(options);let completed;
 try{
  completed=await executeActiveBookingReconciliation({assertHeld:held,progress:name=>{stage=name;},
   inspect:async()=>{s.before=await inspectActiveBookingIncident({window});},
   sourceAndCi:async()=>{await refreshReviewedBookingExecution(toolRevision);held();same(observeBookingReadyApplication(),authority.prepared.application);},
   freshBackup:async()=>{
    const parent='/var/lib/faolla-booking-handoff/'+P.candidate+'/toolchain-admission';ownedReleasePath(parent,{directory:true,privateMode:true});s.backupDirectory=parent+'/'+Date.now()+'-'+randomUUID();fs.mkdirSync(s.backupDirectory,{mode:0o700});bookingHostSync(parent);s.backupDirectoryIdentity=Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,fs.lstatSync(s.backupDirectory)[k]]));
    seal(s.backupDirectory+'/active-closure-attempt.json',{kind:'active-incident-closure-admission-started',toolRevision,inventorySha256:authority.tool.inventorySha256,window,oldOperationId:P.operationId,qualificationSha256:qualification.sha256,publicationAuthority:false,at:new Date().toISOString()});
    s.backup=await createReviewedBookingBackup({lock,toolRevision,directory:s.backupDirectory});
    for(const name of ['database.tar.enc','backup.key','backup-create.json','backup-verify.json','backup-producer-source.json','backup-application-binding.json'])s.witnesses.set(s.backupDirectory+'/'+name,admissionFileFact(s.backupDirectory+'/'+name));
   },
   freshCompatibility:async()=>{s.compatibility=observeBookingCompatibility(qualification.native);same(s.compatibility,qualification.proof.compatibility);const current=await inspectActiveBookingIncident({window});assertActiveBookingObservedHostProgress(s.before,current);s.before=current;},
   begin:()=>{need(Date.parse(window.deadlineAt)-Date.now()>=180000,'evidence_stale');},
   preserveFailureEvidence:async()=>{
    const preserved=await preserveActiveBookingIncidentEvidence(options);s.directory=preserved.directory;s.directoryIdentity=Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,fs.lstatSync(s.directory)[k]]));
    s.context={kind:'active-incident-reconciliation-context',oldOperationId:P.operationId,generation:P.generation,window,toolRevision,inventorySha256:authority.tool.inventorySha256,qualificationAttempt:qualification.attempt,qualificationSha256:qualification.sha256,backupDirectory:s.backupDirectory,backupBindingSha256:digest(s.backupDirectory+'/backup-application-binding.json'),backup:s.backup.backup,compatibility:s.compatibility,before:s.before,publicationAuthority:false,at:new Date().toISOString()};seal(s.directory+'/closure-context.json',s.context);
   },
   reconcileMetadata:async()=>{await correctActiveBookingCompatibleMetadata(options);s.metadataSha256=verifyActiveBookingMetadataCorrection(options).receiptSha256;},
   persistProcesses:async()=>{s.persistenceSha256=(await persistActiveBookingCurrentProcesses(options)).persistenceSha256;},
   verifyPostconditions:async()=>{const verified=await verifyActiveBookingProcessPersistence(options),current=await inspectActiveBookingIncidentAfterMetadata({window});same(verified.persistenceSha256,s.persistenceSha256);assertActiveMetadataOnlyDelta(s.before,current);seal(s.directory+'/closure-postconditions.json',current);s.postconditionsSha256=digest(s.directory+'/closure-postconditions.json');},
   sealClosure:()=>seal(s.directory+'/closure-sealed.json',{kind:'active-incident-reconciliation-sealed',oldOperationId:P.operationId,generation:P.generation,window,toolRevision,inventorySha256:authority.tool.inventorySha256,qualificationSha256:qualification.sha256,backupBindingSha256:digest(s.backupDirectory+'/backup-application-binding.json'),metadataSha256:s.metadataSha256,persistenceSha256:s.persistenceSha256,files:vaultFiles(s),originalEvidenceRetained:true,activationReplayed:false,legacyRestarted:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false,completedAt:new Date().toISOString()}),
   archiveOldOperation:async()=>{const verified=await verifyActiveBookingClosure(options);s.closureSha256=verified.sha256;await archiveActiveBookingClosureOperation(options);},
   complete:async()=>{await verifyActiveBookingClosure(options);const value={kind:'active-incident-reconciliation-completed',oldOperationId:P.operationId,generation:P.generation,window,toolRevision,closureSha256:s.closureSha256,archiveSha256:digest(s.directory+'/operation-archived.json'),originalEvidenceRetained:true,publicationAuthority:false,incidentClosed:false,ownedReplacementStillHeld:true,completedAt:new Date().toISOString()};seal(s.directory+'/reconciliation-completed.json',value);return value;},
   failure:(error,failedStage)=>{held();if(s.directory)seal(s.directory+'/closure-failed.json',{kind:'active-incident-reconciliation-unconfirmed',stage:failedStage,diagnostic:stageFailureDiagnostic(error,{stage:'candidate',toolRevision,knownFiles:['release-toolchain-active-generation-closure.mjs','release-toolchain-active-generation-persistence.mjs','release-toolchain-active-generation-incident.mjs','online-release-retention-writer.mjs']}),automaticRetryAllowed:false,publicationAuthority:false,at:new Date().toISOString()});},
  });
  stage='release-owned-replacement';await releaseActiveBookingClosureOperation(options);
  // Formal held-lock admission is intentionally revoked after removal of OUR
  // replacement. The enclosing kernel scope still owns its FD until return.
  assertReleasedActiveBookingScope(lock,s.closureSha256);need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'operation_unconfirmed');same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);
  const archive=read(s.directory+'/operation-archived.json'),original=fs.lstatSync(s.directory+'/operation.lock');same(Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,original[k]])),archive.original);need(fs.readdirSync(s.directory+'/operation.lock').length===0&&reviewedBookingExecution(toolRevision)===authority,'owned_resource_changed');
  const verifyReleased=()=>{assertReleasedActiveBookingScope(lock,s.closureSha256);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');same(bookingHostRead('/var/lib/faolla-online-release/active.json'),M.afterText);};
  const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.compatibleRollback,operationId:window.id,verify:verifyReleased,deadlineAtMs:Math.min(Date.parse(window.deadlineAt),Date.now()+30000)});
  const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(read(s.directory+'/closure-postconditions.json').database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});verifyReleased();
  const receipt={kind:'active-incident-closed-on-compatible-rollback',...Object.fromEntries(['oldOperationId','generation','window','toolRevision','closureSha256','archiveSha256'].map(k=>[k,completed[k]])),completionSha256:digest(s.directory+'/reconciliation-completed.json'),replacementReleasedSha256:digest(s.directory+'/replacement-released.json'),originalOperationInodeRetained:true,originalEvidenceRetained:true,actualRoute:P.compatibleRollback,publicProof,database,mailEnabled:false,applicationPublished:false,activationReplayed:false,legacyRestarted:false,businessDataWritten:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(s.directory+'/closed.json',receipt);verifyReleased();return{kind:receipt.kind,directory:s.directory,sha256:digest(s.directory+'/closed.json'),incidentClosed:true,applicationPublished:false,mailEnabled:false,publicationAuthority:false};
 }catch(error){
  // Never restore metadata/dump, replay a save/archive, remove the original
  // operation, or hide an unknown release boundary behind automatic cleanup.
  if(s.directory||s.backupDirectory)try{need(reviewedBookingExecution(toolRevision)===authority,'source_changed');const location=s.directory??s.backupDirectory,expected=s.directory?s.directoryIdentity:s.backupDirectoryIdentity;same(Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,fs.lstatSync(location)[k]])),expected);if(!fs.existsSync(location+'/closure-exit-unconfirmed.json'))seal(location+'/closure-exit-unconfirmed.json',{kind:'active-incident-closure-exit-unconfirmed',stage,diagnostic:stageFailureDiagnostic(error,{stage:'candidate',toolRevision,knownFiles:['release-toolchain-active-generation-closure.mjs','online-release-retention-writer.mjs']}),publicationAuthority:false,at:new Date().toISOString()});}catch{}throw error;
 }finally{scopes.delete(lock);}
}
