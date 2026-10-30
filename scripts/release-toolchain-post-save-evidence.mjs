// Read-only, fixed partial-state admission. A saved JSON receipt never grants
// authority: live peer, registry, dump, source, old inodes and public state are
// independently collected. No save/restart/archive/repair operation exists here.
import * as fs from 'node:fs';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {POST_SAVE_PRIOR as H,POST_SAVE_PRIOR_FILES as PINS} from './release-toolchain-post-save-pins.mjs';
import {assertSameLongLivedDaemon} from './release-toolchain-daemon-identity.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M} from './release-toolchain-active-generation-contract.mjs';
import {assertActiveMetadataOnlyDelta,assertActiveCorrectedObservationProgress} from './release-toolchain-active-generation-metadata.mjs';
import {inspectActiveBookingIncidentAfterMetadata} from './release-toolchain-active-generation-incident.mjs';
import {ownedReleasePath,inspectPinnedExecutionSource,collectRemoteReleaseReview} from './release-toolchain-source.mjs';
import {pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {inspectReleasePm2Registry as inspectPm2Registry,verifyReleasePm2Dump as verifyPm2Dump,captureReleasePm2DumpTarget as capturePm2DumpTarget} from './release-toolchain-pm2-readonly-diagnostic.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid'),read=name=>JSON.parse(bookingHostRead(H.directory+'/'+name));
const sourceDirectory='/var/lib/faolla-online-code/'+H.toolRevision;let priorSource,review;
const directoryIdentity=s=>Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,s[k]]));
export const postSavePinsSha256=()=>sha256(canonicalJson({prior:H,files:PINS}));
export const postSavePriorBinding=records=>({directory:H.directory,toolRevision:H.toolRevision,inventorySha256:H.inventorySha256,pinsSha256:records.pinsSha256,metadataSha256:records.metadataSha256,persistenceSha256:records.persistenceSha256,metadataWrittenByContinuation:false,processSavePerformedByContinuation:false});
export function assertPostSaveFileInventory({directory,files}){
 same(directory,H.directoryIdentity);same(Object.keys(files).sort(),PINS.map(v=>v[0]));
 for(const [name,bytes,hash,dev,ino,mode,uid,nlink,mtimeMs,ctimeMs]of PINS)same(files[name],{bytes,sha256:hash,dev,ino,mode,uid,nlink,mtimeMs,ctimeMs});return true;
}
export function readPinnedPostSaveRecords(){
 const directory=ownedReleasePath(H.directory,{directory:true,privateMode:true}),files={};
 for(const name of fs.readdirSync(H.directory).sort()){
  need(PINS.some(row=>row[0]===name),'attempt_unknown');const file=H.directory+'/'+name,s=ownedReleasePath(file,{privateMode:true}),bytes=bookingHostRead(file,{binary:true});
  files[name]={bytes:bytes.length,sha256:sha256(bytes),...Object.fromEntries(['dev','ino','mode','uid','nlink','mtimeMs','ctimeMs'].map(k=>[k,s[k]]))};
 }
 assertPostSaveFileInventory({directory:directoryIdentity(directory),files});
 const context=read('closure-context.json'),before=read('metadata-before-observation.json'),after=read('metadata-after-observation.json'),metadata=read('metadata-corrected.json'),attempt=read('pm2-persistence-attempt.json'),saved=read('pm2-persistence-completed.json'),failure=read('closure-failed.json');
 need(context.kind==='active-incident-reconciliation-context'&&context.toolRevision===H.toolRevision&&context.inventorySha256===H.inventorySha256&&context.window.id===H.windowId&&context.oldOperationId===P.operationId&&context.generation===P.generation,'evidence_invalid');
 need(failure.kind==='active-incident-reconciliation-unconfirmed'&&failure.stage==='verifyPostconditions'&&failure.automaticRetryAllowed===false&&failure.diagnostic.code==='observation_mismatch'&&failure.diagnostic.toolRevision===H.toolRevision&&read('closure-exit-unconfirmed.json').stage===failure.stage,'attempt_unknown');
 assertActiveMetadataOnlyDelta(before,after);assertActiveCorrectedObservationProgress(after,read('pm2-persistence-before-observation.json'));assertActiveCorrectedObservationProgress(read('pm2-persistence-before-observation.json'),read('pm2-persistence-after-observation.json'));
 need(metadata.kind==='active-incident-compatible-metadata-corrected'&&metadata.beforeSha256===sha256(M.beforeText)&&metadata.afterSha256===sha256(M.afterText)&&metadata.routingChanged===false&&metadata.productionDatabaseMutated===false&&metadata.processControlPerformed===false,'evidence_invalid');
 const binding={oldOperationId:P.operationId,window:context.window,toolRevision:H.toolRevision,toolInventorySha256:H.inventorySha256,preservedSha256:sha256(bookingHostRead(H.directory+'/preserved.json'))};
 same(metadata.binding,binding);same(attempt.binding,binding);same(saved.binding,binding);
 same(saved.metadataReceiptSha256,sha256(bookingHostRead(H.directory+'/metadata-corrected.json')));same(attempt.metadataReceiptSha256,saved.metadataReceiptSha256);
 same(attempt.beforeObservationSha256,sha256(canonicalJson(read('pm2-persistence-before-observation.json'))));same(saved.beforeObservationSha256,attempt.beforeObservationSha256);same(saved.afterObservationSha256,sha256(canonicalJson(read('pm2-persistence-after-observation.json'))));same(saved.registrySha256,attempt.registrySha256);
 need(saved.kind==='active-incident-current-pm2-persistence-completed'&&saved.receipt.saved===true&&saved.receipt.peerVerified===true&&saved.receipt.processCount===25&&saved.processControlPerformed===false&&saved.daemonBootPerformed===false&&saved.productionDatabaseMutated===false&&saved.oldOperationRemoved===false,'evidence_invalid');
 for(const value of [metadata,attempt,saved,failure])need(value.publicationAuthority===false,'evidence_invalid');
 for(const [file,key]of [['pm2-dump-before.json','dump'],['pm2-backup-before.json','backup']])same(sha256(bookingHostRead(H.directory+'/'+file)),attempt.target[key].sha256);
 return{context,before,after,metadata,attempt,saved,pinsSha256:postSavePinsSha256(),metadataSha256:sha256(bookingHostRead(H.directory+'/metadata-corrected.json')),persistenceSha256:sha256(bookingHostRead(H.directory+'/pm2-persistence-completed.json'))};
}
export async function verifyPinnedPostSaveHistory(){
 const records=readPinnedPostSaveRecords();
 if(!priorSource){const source=inspectPinnedExecutionSource({revision:H.toolRevision,directory:sourceDirectory});same(source.inventorySha256,H.inventorySha256);priorSource={source,witnesses:source.rows.filter(r=>!r.file.startsWith('public/downloads/')).map(row=>{const file=sourceDirectory+'/'+row.file,s=fs.lstatSync(file);return[file,canonicalJson(Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]])))];})};}
 for(const [file,expected]of priorSource.witnesses){const s=ownedReleasePath(file);same(canonicalJson(Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]))),expected);}
 if(!review||Date.now()-Date.parse(review.createdAt)>600000){review=await collectRemoteReleaseReview(H.toolRevision,{production:false});same(review.runs.map(v=>v.runId),[40838684513,40838684449]);need(review.productionEligible===false,'evidence_invalid');}
 const {context}=records;need(context.qualificationAttempt.startsWith('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+H.toolRevision+'/attempt_'),'invalid_path');
 const qualification=JSON.parse(bookingHostRead(context.qualificationAttempt+'/verified.json'));same(sha256(bookingHostRead(context.qualificationAttempt+'/verified.json')),context.qualificationSha256);need(qualification.toolRevision===H.toolRevision&&qualification.inventorySha256===H.inventorySha256&&!fs.existsSync(context.qualificationAttempt+'/failed.json'),'evidence_invalid');
 const admission=await import('file://'+sourceDirectory+'/scripts/release-toolchain-booking-admission.mjs'),interrupt=await import('file://'+sourceDirectory+'/scripts/release-toolchain-full-interrupt.mjs'),routing=await import('file://'+sourceDirectory+'/scripts/release-toolchain-active-generation-routing-native.mjs');
 const native=admission.verifyQualificationFiles(qualification.nativeRoot,{toolRevision:H.toolRevision,inventorySha256:H.inventorySha256});same(native.sha256,qualification.nativeSha256);same(interrupt.verifyFullInterruptionReport(qualification.interruptionRoot,{toolRevision:H.toolRevision}).sha256,qualification.interruptionSha256);same(routing.verifyOwnedActiveRoutingAcceptance(qualification.activeRoutingNativeRoot,{toolRevision:H.toolRevision,inventorySha256:H.inventorySha256}).sha256,qualification.activeRoutingNativeSha256);same(admission.observeBookingCompatibility(native),context.compatibility);
 need(context.backupDirectory==='/var/lib/faolla-booking-handoff/'+P.candidate+'/toolchain-admission/1793262504483-a9ec21ba-2bd2-4ebb-a852-155bf1379134','invalid_path');
 same(await validateAttendanceBackupEvidence({target:H.toolRevision,backup:context.backupDirectory+'/database.tar.enc',createReport:context.backupDirectory+'/backup-create.json',verifyReport:context.backupDirectory+'/backup-verify.json'}),context.backup);same(sha256(bookingHostRead(context.backupDirectory+'/backup-application-binding.json')),context.backupBindingSha256);
 return records;
}
export async function verifyPostSaveCurrentProcesses(records,{physical=collectFormalBookingPm2Registry(),priorRegistry=null}={}){
 const {commandLine,...daemon}=captureProcessFact(physical.daemon.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();assertSameLongLivedDaemon(daemon,records.attempt.daemon);same(boot,records.attempt.bootId);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);
 const registry=await inspectPm2Registry(daemon,boot);same(registry,physical.filteredRegistry);assertCompletePm2DumpSet(physical.rows,registry);need(physical.rows.length===25,'owned_resource_changed');
 if(priorRegistry){same(pm2RegistryDigest(priorRegistry),records.saved.registrySha256);same(await capturePm2DumpTarget(daemon,boot),records.saved.receipt.target);}
 else{same(pm2RegistryDigest(registry),records.saved.registrySha256);need(await verifyPm2Dump(daemon,boot,registry,records.saved.receipt)===true,'operation_unconfirmed');}
 return{daemon,boot,registrySha256:records.saved.registrySha256,processCount:25,savedReceiptSha256:records.persistenceSha256,savePerformed:false};
}
export function assertPostSaveContinuity(records,current){
 // Different real observation windows are compared, never reissued as an old
 // event or used as a lock capability. The live observer validates its window.
 const after=structuredClone(current);after.window=records.after.window;delete after.originalOperationArchived;assertActiveCorrectedObservationProgress(records.after,after);return true;
}
export async function observePostSaveIncident({window}){
 const root='/var/lib/faolla-booking-active-closures/'+P.operationId;ownedReleasePath(root,{directory:true,privateMode:true});same(fs.readdirSync(root),[H.windowId]);const history=await verifyPinnedPostSaveHistory(),current=await inspectActiveBookingIncidentAfterMetadata({window});assertPostSaveContinuity(history,current);const persistence=await verifyPostSaveCurrentProcesses(history);same(fs.readdirSync(root),[H.windowId]);readPinnedPostSaveRecords();return{history,current,persistence};
}
export async function observePostSaveForInstallation(){const at=Date.now(),window={id:randomUUID(),startedAt:new Date(at).toISOString(),deadlineAt:new Date(at+600000).toISOString()};const observed=await observePostSaveIncident({window});return{kind:'fixed-post-save-incident-read-only-observation',oldOperationId:P.operationId,priorToolRevision:H.toolRevision,priorDirectory:H.directory,pinsSha256:observed.history.pinsSha256,current:observed.current,persistence:observed.persistence,publicationAuthority:false};}
