// Read-only admission AFTER the separately sealed fixed incident. This cannot
// close, repair, replay or adopt an unknown result. It accepts exactly one
// completed closure and independently rechecks its files and the actual host.
import {assertSameNodeProcess} from './release-toolchain-process-identity.mjs';
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA as M,assertActiveBookingWindow,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {ACTIVE_INCIDENT_ROOT,ACTIVE_INCIDENT_FILES,ACTIVE_INCIDENT_STATIC_NAMES} from './release-toolchain-active-generation-incident.mjs';
import {ownedReleasePath,inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {collectActiveBookingLegacyHost,collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {verifyReleasePm2Dump as verifyPm2Dump,captureReleasePm2DumpTarget as capturePm2DumpTarget} from './release-toolchain-pm2-readonly-diagnostic.mjs';
import {verifyQualificationFiles,observeBookingCompatibility} from './release-toolchain-booking-admission.mjs';
import {verifyFullInterruptionReport} from './release-toolchain-full-interrupt.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {assertActiveMetadataOnlyDelta,assertActiveCorrectedObservationProgress} from './release-toolchain-active-generation-metadata.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {bookingHostRead,bookingHostSql,bookingHostRun} from './booking-handoff-host-io.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {verifyOwnedActiveRoutingAcceptance} from './release-toolchain-active-generation-routing-native.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {assertSameLongLivedDaemon} from './release-toolchain-daemon-identity.mjs';
import {POST_SAVE_PRIOR as POST_SAVE} from './release-toolchain-post-save-pins.mjs';
const ROOT='/var/lib/faolla-booking-active-closures/'+P.operationId,OP='/var/lib/faolla-maintenance/merchant-space/operation.lock',RELEASE='/var/lib/faolla-online-release';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid'),digest=file=>sha256(bookingHostRead(file,{binary:true}));
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
const identity=s=>Object.fromEntries(['dev','ino','mode','uid'].map(k=>[k,s[k]]));
const fileIdentity=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
const exact=(value,names)=>{need(value&&typeof value==='object'&&!Array.isArray(value),'evidence_invalid');same(Object.keys(value).sort(),[...names].sort());};
export function assertClosedActiveBookingReceipt({closed,context,sealed,completion,archive,released},{toolRevision,directory,nowMs=Date.now()}){
 need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&typeof directory==='string'&&directory===ROOT+'/'+closed?.window?.id,'evidence_invalid');
 need(closed.kind==='active-incident-closed-on-compatible-rollback'&&context.kind==='active-incident-reconciliation-context'&&sealed.kind==='active-incident-reconciliation-sealed'&&completion.kind==='active-incident-reconciliation-completed'&&archive.kind==='active-incident-original-operation-archived'&&released.kind==='active-incident-replacement-released','evidence_invalid');
 exact(closed,['kind','oldOperationId','generation','window','toolRevision','closureSha256','archiveSha256','completionSha256','replacementReleasedSha256','originalOperationInodeRetained','originalEvidenceRetained','actualRoute','publicProof','database','mailEnabled','applicationPublished','activationReplayed','legacyRestarted','businessDataWritten','publicationAuthority','completedAt']);
 exact(context,['kind','oldOperationId','generation','window','toolRevision','inventorySha256','qualificationAttempt','qualificationSha256','backupDirectory','backupBindingSha256','backup','compatibility','before','publicationAuthority','at']);
 exact(sealed,['kind','oldOperationId','generation','window','toolRevision','inventorySha256','qualificationSha256','backupBindingSha256','metadataSha256','persistenceSha256','files','originalEvidenceRetained','activationReplayed','legacyRestarted','businessDataWritten','mailEnabled','publicationAuthority','completedAt']);
 exact(completion,['kind','oldOperationId','generation','window','toolRevision','closureSha256','archiveSha256','originalEvidenceRetained','publicationAuthority','incidentClosed','ownedReplacementStillHeld','completedAt']);
 exact(archive,['kind','window','closureSha256','source','destination','original','replacement','originalInodeRetained','replacementScopeRetained','incidentClosed','publicationAuthority','at']);exact(released,['kind','closureSha256','originalInodeRetained','publicationAuthority']);
 for(const value of [closed,context,sealed,completion]){need(value.oldOperationId===P.operationId&&value.generation===P.generation&&value.toolRevision===toolRevision&&value.publicationAuthority===false,'evidence_invalid');same(value.window,closed.window);}
 same(archive.window,closed.window);need(archive.publicationAuthority===false&&released.publicationAuthority===false,'evidence_invalid');
 const at=Date.parse(closed.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===closed.completedAt&&at<=nowMs&&nowMs-at<86400000,'evidence_stale');assertActiveBookingWindow(closed.window,{nowMs:at});
 for(const value of [closed,context,sealed,completion])if(value!==context){const when=Date.parse(value.completedAt);need(Number.isFinite(when)&&new Date(when).toISOString()===value.completedAt&&when>=Date.parse(closed.window.startedAt)&&when<=at,'evidence_invalid');}
 need(Date.parse(context.at)>=Date.parse(closed.window.startedAt)&&Date.parse(context.at)<=Date.parse(sealed.completedAt)&&Date.parse(completion.completedAt)>=Date.parse(sealed.completedAt),'evidence_invalid');
 const archivedAt=Date.parse(archive.at);need(Number.isFinite(archivedAt)&&new Date(archivedAt).toISOString()===archive.at&&archivedAt>=Date.parse(sealed.completedAt)&&archivedAt<=Date.parse(completion.completedAt),'evidence_invalid');
 need(closed.applicationPublished===false&&closed.mailEnabled===false&&closed.activationReplayed===false&&closed.legacyRestarted===false&&closed.businessDataWritten===false&&closed.originalOperationInodeRetained===true&&closed.originalEvidenceRetained===true&&closed.actualRoute===P.compatibleRollback&&sealed.originalEvidenceRetained===true&&sealed.activationReplayed===false&&sealed.legacyRestarted===false&&sealed.businessDataWritten===false&&sealed.mailEnabled===false&&completion.originalEvidenceRetained===true&&completion.incidentClosed===false&&completion.ownedReplacementStillHeld===true&&archive.originalInodeRetained===true&&archive.replacementScopeRetained===true&&archive.incidentClosed===false&&released.originalInodeRetained===true,'evidence_invalid');
 same(archive.source,OP);same(archive.destination,directory+'/operation.lock');same(archive.original,{dev:64769,ino:3566178,mode:0o40700,uid:0});
 need(archive.replacement?.uid===0&&archive.replacement.mode===0o40700&&Number.isSafeInteger(archive.replacement.ino)&&archive.replacement.ino>0&&archive.replacement.ino!==archive.original.ino&&archive.replacement.dev===archive.original.dev,'evidence_invalid');
 const bodyHash=value=>sha256(canonicalJson(value)+'\n');same(closed.closureSha256,bodyHash(sealed));same(completion.closureSha256,closed.closureSha256);same(archive.closureSha256,closed.closureSha256);same(released.closureSha256,closed.closureSha256);same(closed.archiveSha256,bodyHash(archive));same(completion.archiveSha256,closed.archiveSha256);same(closed.completionSha256,bodyHash(completion));same(closed.replacementReleasedSha256,bodyHash(released));
 same(sealed.inventorySha256,context.inventorySha256);same(sealed.qualificationSha256,context.qualificationSha256);same(sealed.backupBindingSha256,context.backupBindingSha256);
 need(Array.isArray(closed.publicProof)&&closed.publicProof.length===2&&new Set(closed.publicProof.map(v=>v.origin)).size===2&&closed.publicProof.every(v=>['https://faolla.com','https://launch.faolla.com'].includes(v.origin)&&v.status===200&&v.buildId===P.compatibleRollback&&Number.isSafeInteger(v.attempts)&&v.attempts>=1&&v.attempts<=6),'evidence_invalid');
 assertActiveBookingDatabaseProgress(context.before.database,closed.database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});return true;
}
async function inspect(toolRevision,heldLock,preparedWorker){
 need(process.platform==='linux'&&process.getuid?.()===0&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'unsupported_runtime');
 if(heldLock){assertOnlineRetentionHeldLocks(heldLock);need(reviewedBookingExecution(toolRevision),'source_changed');}else need(!fs.existsSync(OP),'attempt_unknown');
 ownedReleasePath(ROOT,{directory:true,privateMode:true});const entries=fs.readdirSync(ROOT);need(entries.length===1&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entries[0]),'attempt_unknown');const directory=ROOT+'/'+entries[0];ownedReleasePath(directory,{directory:true,privateMode:true});
 const texts=Object.fromEntries(['closed','closure-context','closure-sealed','reconciliation-completed','operation-archived','replacement-released'].map(name=>[name,read(directory+'/'+name+'.json')])),closed=texts.closed,context=texts['closure-context'],sealed=texts['closure-sealed'],archive=texts['operation-archived'];
 assertClosedActiveBookingReceipt({closed,context,sealed,completion:texts['reconciliation-completed'],archive,released:texts['replacement-released']},{toolRevision,directory});
 need(!['closure-failed.json','closure-exit-unconfirmed.json','metadata-correction-failed.json','pm2-persistence-failed.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_unknown');
 const source=inspectPinnedExecutionSource({revision:toolRevision,directory:'/var/lib/faolla-online-code/'+toolRevision});same(source.inventorySha256,sealed.inventorySha256);
 same(identity(ownedReleasePath(directory+'/operation.lock',{directory:true,privateMode:true})),archive.original);same(fs.readdirSync(directory+'/operation.lock'),[]);
 if(heldLock){assertOnlineRetentionHeldLocks(heldLock);need(fs.lstatSync(OP).ino!==archive.original.ino,'owned_resource_changed');}
 const files=sealed.files;need(files&&typeof files==='object'&&!Array.isArray(files),'evidence_invalid');
 const required=['intent.json','preserved.json','current-observation.json','metadata-before-observation.json','metadata-correction-intent.json','metadata-after-observation.json','metadata-corrected.json','pm2-persistence-before-observation.json','pm2-persistence-after-observation.json','pm2-persistence-attempt.json','pm2-persistence-completed.json','pm2-dump-before.json','pm2-backup-before.json','closure-context.json','closure-postconditions.json',...ACTIVE_INCIDENT_FILES.map(v=>v[0])];same(Object.keys(files).sort(),required.sort());for(const name of required)same(digest(directory+'/'+name),files[name]);
 same(fs.readdirSync(ACTIVE_INCIDENT_ROOT).sort(),[...ACTIVE_INCIDENT_STATIC_NAMES,...ACTIVE_INCIDENT_FILES.map(v=>v[0])].sort());
 const intent=read(directory+'/intent.json'),preserved=read(directory+'/preserved.json');same(intent.source,ACTIVE_INCIDENT_ROOT);same(preserved.source,ACTIVE_INCIDENT_ROOT);same(preserved.destination,directory);same(identity(fs.lstatSync(ACTIVE_INCIDENT_ROOT)),intent.sourceIdentity);same(identity(fs.lstatSync(directory)),preserved.destinationIdentity);same(preserved.intentSha256,digest(directory+'/intent.json'));same(intent.binding,preserved.binding);same(intent.binding.window,closed.window);same(intent.binding.toolRevision,toolRevision);same(intent.binding.oldOperationId,P.operationId);need(preserved.originalFilesRetained===true&&preserved.incidentClosed===false&&preserved.publicationAuthority===false,'evidence_invalid');
 same(preserved.files,ACTIVE_INCIDENT_FILES.map(([name,bytes,sha256])=>({name,bytes,sha256})));same(intent.files,ACTIVE_INCIDENT_FILES.map(([name,bytes,sha256])=>({name,bytes,sha256,identity:fileIdentity(ownedReleasePath(ACTIVE_INCIDENT_ROOT+'/'+name,{privateMode:true}))})));
 for(const [name,bytes,hash]of ACTIVE_INCIDENT_FILES){const before=bookingHostRead(ACTIVE_INCIDENT_ROOT+'/'+name,{binary:true}),copy=bookingHostRead(directory+'/'+name,{binary:true});need(before.length===bytes&&sha256(before)===hash&&copy.equals(before),'evidence_invalid');}
 // Preservation binds canonical JSON without its final file newline.
 same(intent.binding.currentObservationSha256,sha256(canonicalJson(read(directory+'/current-observation.json'))));
 const metadataBefore=read(directory+'/metadata-before-observation.json'),metadataAfter=read(directory+'/metadata-after-observation.json');assertActiveMetadataOnlyDelta(metadataBefore,metadataAfter);assertActiveCorrectedObservationProgress(metadataAfter,read(directory+'/closure-postconditions.json'));
 const metadata=read(directory+'/metadata-corrected.json');same(digest(directory+'/metadata-corrected.json'),sealed.metadataSha256);need(metadata.beforeSha256===sha256(M.beforeText)&&metadata.afterSha256===sha256(M.afterText)&&metadata.routingChanged===false&&metadata.processControlPerformed===false&&metadata.productionDatabaseMutated===false&&metadata.publicationAuthority===false,'evidence_invalid');
 const saved=read(directory+'/pm2-persistence-completed.json'),attempt=read(directory+'/pm2-persistence-attempt.json');same(digest(directory+'/pm2-persistence-completed.json'),sealed.persistenceSha256);need(saved.receipt?.saved===true&&saved.processControlPerformed===false&&saved.daemonBootPerformed===false&&saved.productionDatabaseMutated===false&&saved.publicationAuthority===false,'evidence_invalid');
 need(context.qualificationAttempt.startsWith('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision+'/attempt_')&&/^attempt_[0-9]{13}_[a-f0-9-]{36}$/.test(path.posix.basename(context.qualificationAttempt)),'invalid_path');
 const qualification=read(context.qualificationAttempt+'/verified.json');same(digest(context.qualificationAttempt+'/verified.json'),context.qualificationSha256);need(!fs.existsSync(context.qualificationAttempt+'/failed.json')&&qualification.kind==='active-incident-formal-qualification-completed'&&qualification.toolRevision===toolRevision&&qualification.inventorySha256===source.inventorySha256,'evidence_invalid');
 const native=verifyQualificationFiles(qualification.nativeRoot,{toolRevision,inventorySha256:source.inventorySha256}),interruption=verifyFullInterruptionReport(qualification.interruptionRoot,{toolRevision});same(native.sha256,qualification.nativeSha256);same(interruption.sha256,qualification.interruptionSha256);need(native.report.observationProfile==='fixed-active-incident-connect-only'&&interruption.report.observationProfile==='fixed-active-incident-connect-only','evidence_invalid');same(observeBookingCompatibility(native),context.compatibility);
 same(verifyOwnedActiveRoutingAcceptance(qualification.activeRoutingNativeRoot,{toolRevision,inventorySha256:source.inventorySha256}).sha256,qualification.activeRoutingNativeSha256);
 need(typeof context.backupDirectory==='string'&&context.backupDirectory.startsWith(ACTIVE_INCIDENT_ROOT+'/toolchain-admission/')&&/^\d{13}-[a-f0-9-]{36}$/.test(path.posix.basename(context.backupDirectory)),'invalid_path');
 const backup=await validateAttendanceBackupEvidence({target:toolRevision,backup:context.backupDirectory+'/database.tar.enc',createReport:context.backupDirectory+'/backup-create.json',verifyReport:context.backupDirectory+'/backup-verify.json'});same(backup,context.backup);same(digest(context.backupDirectory+'/backup-application-binding.json'),context.backupBindingSha256);
 const check=()=>{
  if(heldLock)assertOnlineRetentionHeldLocks(heldLock);else need(!fs.existsSync(OP),'attempt_unknown');
  same(bookingHostRead(RELEASE+'/active.json'),M.afterText);same(digest(RELEASE+'/'+P.candidate+'/state.json'),'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3');same(digest(RELEASE+'/'+P.compatibleRollback+'/state.json'),'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d');
  same(identity(ownedReleasePath(directory+'/operation.lock',{directory:true,privateMode:true})),archive.original);same(digest(directory+'/closed.json'),sha256(canonicalJson(closed)+'\n'));
  const plan=JSON.parse(bookingHostRead(ACTIVE_INCIDENT_ROOT+'/routing-plan.json')),gate=JSON.parse(bookingHostRead(ACTIVE_INCIDENT_ROOT+'/ingress-plan.json'));same(bookingHostRead(gate.file,{privateMode:false}),gate.beforeText);assertBookingRoutingCurrent(plan,Object.fromEntries(WEB_RELEASE_FILES.map(name=>[name,bookingHostRead(WEB_RELEASE_PROXY+'/'+name,{privateMode:false})])),{phase:'rollback'});
 };
 const pilots=bookingHostRun('docker',['inspect','--format','{{json .State.Running}}',...BOOKING_FORMAL_PILOT_IDS]).trim().split('\n');need(pilots.length===5&&pilots.every(value=>value==='false'),'owned_resource_changed');
 check();const cohort=collectActiveBookingLegacyHost(),physical=collectFormalBookingPm2Registry();assertCompletePm2DumpSet(physical.rows,physical.filteredRegistry);need(physical.rows.length===25,'owned_resource_changed');
 const originalCohort=preparedWorker?preparedWorker.priorCohort:cohort;if(preparedWorker){same(cohort,preparedWorker.after.legacy);same(physical.filteredRegistry,preparedWorker.physical.filteredRegistry);same(preparedWorker.closedSha256,sha256(canonicalJson(closed)+'\n'));}
 same(sha256(canonicalJson(originalCohort.processes)),context.before.processesSha256);same(sha256(canonicalJson(originalCohort.identityProofs)),context.before.identitiesSha256);same(sha256(canonicalJson(originalCohort.raw)),context.before.legacyEnvironmentSha256);
 const {commandLine,...daemon}=captureProcessFact(physical.daemon.pid),boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();assertSameLongLivedDaemon(daemon,attempt.daemon);same(boot,attempt.bootId);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);
 if(preparedWorker){same(pm2RegistryDigest(preparedWorker.priorRegistry),saved.registrySha256);same(await capturePm2DumpTarget(daemon,boot),saved.receipt.target);}
 else{same(pm2RegistryDigest(physical.filteredRegistry),saved.registrySha256);need(await verifyPm2Dump(daemon,boot,physical.filteredRegistry,saved.receipt)===true,'operation_unconfirmed');}
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(closed.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});same(readOnlineRetentionHistory().headSha256,context.before.retentionHeadSha256);
 const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.compatibleRollback,operationId:randomUUID(),verify:check,deadlineAtMs:Date.now()+30000});same(collectActiveBookingLegacyHost(),cohort);check();
 return{kind:'closed-active-incident-current-observation',oldOperationId:P.operationId,generation:P.generation,toolRevision,inventorySha256:source.inventorySha256,directory,closedSha256:sha256(canonicalJson(closed)+'\n'),closureSha256:closed.closureSha256,closedAt:closed.completedAt,qualificationSha256:context.qualificationSha256,qualification,compatibility:context.compatibility,database,actualRoute:P.compatibleRollback,publicProof,originalOperationInodeRetained:true,publicationAuthority:false,observedAt:new Date().toISOString()};
}
async function inspectSelectedProfile(toolRevision,lock,worker){
 const{hasRecoveredPublicationDisposition}=await import('./release-toolchain-recovered-publication-selector.mjs');
 if(hasRecoveredPublicationDisposition()){const{inspectRecoveredPublicationContinuation}=await import('./release-toolchain-recovered-publication-host.mjs');return inspectRecoveredPublicationContinuation(toolRevision,lock,worker);}
 const{ORIGIN_RECOVERY}=await import('./release-toolchain-origin-recovery-contract.mjs');
 if(toolRevision!==ORIGIN_RECOVERY.priorTool&&(fs.existsSync(ORIGIN_RECOVERY.publication)||fs.existsSync(ORIGIN_RECOVERY.root))){const{inspectOriginRecoveryContinuation}=await import('./release-toolchain-origin-recovery-closure.mjs');return inspectOriginRecoveryContinuation(toolRevision,lock,worker);}
 const{PROC_WITNESS_PRIOR}=await import('./release-toolchain-proc-witness-contract.mjs');
 if(toolRevision!==PROC_WITNESS_PRIOR.toolRevision){const{hasProcWitnessContinuationEvidence,inspectProcWitnessContinuation}=await import('./release-toolchain-proc-witness-profile.mjs');if(hasProcWitnessContinuationEvidence())return inspectProcWitnessContinuation(toolRevision,lock,worker);}
 if(toolRevision!=='8607f9d21980f8330cba46eb13c7e8f5d99a8485'){
  const{hasPreIntentContinuationEvidence,inspectPreIntentContinuation}=await import('./release-toolchain-pre-intent-profile.mjs');
  if(hasPreIntentContinuationEvidence())return inspectPreIntentContinuation(toolRevision,lock,worker);
 }
 if(fs.existsSync(ROOT)){const entries=fs.readdirSync(ROOT);if(entries.length===2&&entries.includes(POST_SAVE.windowId)){const {inspectClosedPostSaveIncident}=await import('./release-toolchain-post-save-closed.mjs');if(toolRevision!=='dc80eacba6b3c6a78b271f88786372b026efd7dc'){const {inspectPinnedPreRouteClosedIncident}=await import('./release-toolchain-pre-route-evidence.mjs');return inspectPinnedPreRouteClosedIncident(toolRevision,lock,worker);}return inspectClosedPostSaveIncident(toolRevision,lock,worker);}}
 return inspect(toolRevision,lock,worker);
}
export const inspectClosedActiveBookingIncidentForPreparation=toolRevision=>inspectSelectedProfile(toolRevision,null);
export const inspectClosedActiveBookingIncidentUnderHeldLocks=async({toolRevision,lock})=>{assertOnlineRetentionHeldLocks(lock);return inspectSelectedProfile(toolRevision,lock);};
// A distinct profile after the one approved gated-worker source transition.
// Actual sealed private receipts + current peer/process/raw environment are
// checked first; callers cannot provide a JSON exception or original cohort.
export async function inspectClosedActiveBookingIncidentWithPreparedWorker({lock,toolRevision,window,directory}){
 const {observeActiveBookingPreparedWorker}=await import('./release-toolchain-active-generation-worker.mjs');
 const before=observeActiveBookingPreparedWorker({lock,toolRevision,window,directory}),result=await inspectSelectedProfile(toolRevision,lock,before),after=observeActiveBookingPreparedWorker({lock,toolRevision,window,directory});
 same(after.receiptSha256,before.receiptSha256);assertSameNodeProcess(after.after.identity,before.after.identity);same({...after.after,identity:before.after.identity},before.after);same(after.priorRegistry,before.priorRegistry);return{...result,preparedWorker:{receiptSha256:after.receiptSha256,process:after.after.process,gateOpen:false,publicationAuthority:false}};
}
