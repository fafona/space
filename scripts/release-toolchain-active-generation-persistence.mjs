// One verified persistence of the CURRENT PM2 configuration. This connects to
// the existing daemon; it cannot boot, stop, restart or resurrect any process.
// No CLI entry exists. The eventual closure controller must satisfy admission
// and qualification before constructing this internal operation.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {inspectActiveBookingIncidentAfterMetadata} from './release-toolchain-active-generation-incident.mjs';
import {verifyActiveBookingMetadataCorrection,assertActiveCorrectedObservationProgress} from './release-toolchain-active-generation-metadata.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks,assertActiveBookingIncidentHeldWindow} from './online-release-retention-writer.mjs';
import {inspectPm2Registry,capturePm2DumpTarget,persistPm2Dump,verifyPm2Dump,pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {bookingHostRead,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const publicationPersistenceScopes=new WeakMap();
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
export const ACTIVE_PERSISTENCE_STEPS=Object.freeze(['inspect','freeze','claim','saveOnce','verifySaved','postconditions','complete']);
export async function executeActiveProcessPersistence(operations){
 let result,stage='startup';try{for(const name of ACTIVE_PERSISTENCE_STEPS){stage=name;await operations.assertHeld();result=await operations[name]();await operations.assertHeld();}return result;}
 catch(error){if(operations.failure)try{await operations.failure(error,stage);}catch{}throw error;}
}
export async function persistActiveBookingCurrentProcesses({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');assertActiveBookingWindow(window);
 assertActiveBookingIncidentHeldWindow(lock,window);
 need(process.argv[1]&&process.argv[1]!=='-'&&Date.parse(window.deadlineAt)-Date.now()>=120000,'evidence_stale');
 const metadata=verifyActiveBookingMetadataCorrection({lock,toolRevision,window}),directory=metadata.directory;
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');verifyActiveBookingMetadataCorrection({lock,toolRevision,window});};
 const expectedPeer=JSON.parse(bookingHostRead(directory+'/legacy-restart-attempt.json')).before.daemonPeer;
 return persistObservedCurrentProcesses({directory,metadata,held,observe:()=>inspectActiveBookingIncidentAfterMetadata({window}),compare:assertActiveCorrectedObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer});
}
// Separate normal-publication factory; the original closure factory remains
// restricted to its original incident scope and never adopts this profile.
export async function persistActiveBookingPublicationCurrentProcesses(options){
 const {activeBookingPublicationEvidence,assertActiveBookingPublicationLockBinding}=await import('./release-toolchain-active-generation-publication-scope.mjs'),{observeActiveBookingPublicationBeforeMetadata,assertActivePublicationObservationProgress}=await import('./release-toolchain-active-generation-publication-observation.mjs');
 const {scope,lock,toolRevision,window}=options,admission=assertActiveBookingPublicationLockBinding(scope,{lock,toolRevision,window}),evidence=activeBookingPublicationEvidence(scope),initial=await observeActiveBookingPublicationBeforeMetadata(options),directory=admission.directory;
 need(!publicationPersistenceScopes.has(scope),'attempt_replay_forbidden');
 const checkpoint={kind:'active-booking-post-route-runtime-checkpoint',toolRevision,inventorySha256:evidence.inventorySha256,window,observation:initial.observation,closedIncidentSha256:evidence.closed.closedSha256,publicationAuthority:false};seal(directory+'/publication-runtime-checkpoint.json',checkpoint);
 const metadata={directory,binding:{kind:'active-booking-publication-process-persistence',toolRevision,window,closedIncidentSha256:evidence.closed.closedSha256,publicationAuthority:false},receiptSha256:sha256(bookingHostRead(directory+'/publication-runtime-checkpoint.json')),after:initial.observation};
 const held=()=>{assertActiveBookingPublicationLockBinding(scope,{lock,toolRevision,window});same(read(directory+'/publication-runtime-checkpoint.json'),checkpoint);};
 publicationPersistenceScopes.set(scope,{lock,toolRevision,window,metadata,held,expectedPeer:initial.daemonPeer});
 return persistObservedCurrentProcesses({directory,metadata,held,observe:async()=>(await observeActiveBookingPublicationBeforeMetadata(options)).observation,compare:assertActivePublicationObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer:initial.daemonPeer});
}
export async function verifyActiveBookingPublicationPersistenceBeforeMetadata(options){
 const {scope,lock,toolRevision,window}=options,s=publicationPersistenceScopes.get(scope);need(s&&s.lock===lock&&s.toolRevision===toolRevision,'invalid_contract');same(s.window,window);s.held();
 const {observeActiveBookingPublicationBeforeMetadata,assertActivePublicationObservationProgress}=await import('./release-toolchain-active-generation-publication-observation.mjs');
 return verifyObservedCurrentProcesses({metadata:s.metadata,held:s.held,observe:async()=>(await observeActiveBookingPublicationBeforeMetadata(options)).observation,compare:assertActivePublicationObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer:s.expectedPeer});
}
// Independently verify the SAME saved process set after the two exact metadata
// CAS operations. No second save and no adoption of serialized receipts.
export async function verifyActiveBookingPublicationPersistenceAfterMetadata(options){
 const {scope,lock,toolRevision,window}=options,s=publicationPersistenceScopes.get(scope);need(s&&s.lock===lock&&s.toolRevision===toolRevision,'invalid_contract');same(s.window,window);s.held();
 const {observeActiveBookingPublicationAfterMetadata,assertActivePublicationObservationProgress}=await import('./release-toolchain-active-generation-publication-observation.mjs');
 return verifyObservedCurrentProcesses({metadata:s.metadata,held:s.held,observe:async()=>(await observeActiveBookingPublicationAfterMetadata(options)).observation,compare:assertActivePublicationObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer:s.expectedPeer});
}
export async function persistActiveBookingRecoveryCurrentProcesses(capability){
 const {assertActiveBookingSupervisorInheritedLease}=await import('./release-toolchain-active-generation-supervisor-lease.mjs'),{activeBookingRecoveryPersistenceContext,observeActiveBookingRecoveryPostMetadata,assertActiveBookingRecoveryObservationProgress}=await import('./release-toolchain-active-generation-recovery-host.mjs');
 assertActiveBookingSupervisorInheritedLease(capability,{requireParentGone:true});const s=activeBookingRecoveryPersistenceContext(capability),held=()=>{assertActiveBookingSupervisorInheritedLease(capability,{requireParentGone:true});activeBookingRecoveryPersistenceContext(capability);};
 return persistObservedCurrentProcesses({directory:s.directory,metadata:s.metadata,held,observe:()=>observeActiveBookingRecoveryPostMetadata(capability),compare:assertActiveBookingRecoveryObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer:s.expectedPeer});
}
// Shared real connect-only IO path. Only closed profile factories call it;
// neither paths nor the private fault seam are CLI or serialized authority.
async function persistObservedCurrentProcesses({directory,metadata,held,observe,compare,collect,home,expectedPeer,afterSave}){
 need(!['pm2-persistence-before-observation.json','pm2-persistence-after-observation.json','pm2-persistence-attempt.json','pm2-persistence-completed.json','pm2-persistence-failed.json','pm2-dump-before.json','pm2-backup-before.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_replay_forbidden');
 const {captureProcessFact}=await import('./check-production-runtime-supervision.mjs');
 let before,daemon,bootId,registry,target,receipt,after;
 return executeActiveProcessPersistence({assertHeld:held,
  inspect:async()=>{before=await observe();compare(metadata.after,before);seal(directory+'/pm2-persistence-before-observation.json',before);},
  freeze:async()=>{
   const pid=Number(bookingHostRead(home+'/pm2.pid',{privateMode:false}).trim()),{commandLine,...captured}=captureProcessFact(pid);need(captured.uid===0&&captured.executable==='/usr/bin/node'&&commandLine.length===1&&commandLine[0]==='PM2 v6.0.14: God Daemon ('+home+')','owned_resource_changed');daemon=captured;bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
   same({pid:daemon.pid,uid:daemon.uid,startTicks:daemon.startTicks,bootId,executable:daemon.executable,executableIdentity:daemon.executableIdentity},expectedPeer);
   registry=await inspectPm2Registry(daemon,bootId);const physical=collect();same(physical.filteredRegistry,registry);assertCompletePm2DumpSet(physical.rows,registry);target=await capturePm2DumpTarget(daemon,bootId);need(target.dump&&target.backup,'evidence_invalid');
   for(const [file,key,destination]of [['dump.pm2','dump','pm2-dump-before.json'],['dump.pm2.bak','backup','pm2-backup-before.json']]){held();const text=bookingHostRead(home+'/'+file,{privateMode:false});need(sha256(text)===target[key].sha256,'owned_resource_changed');bookingHostWriteOnce(directory+'/'+destination,text);}
   same(await capturePm2DumpTarget(daemon,bootId),target);same(await inspectPm2Registry(daemon,bootId),registry);
  },
  claim:()=>seal(directory+'/pm2-persistence-attempt.json',{kind:'active-incident-current-pm2-persistence-attempt',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,daemon,bootId,registrySha256:pm2RegistryDigest(registry),target,beforeObservationSha256:sha256(canonicalJson(before)),at:new Date().toISOString(),publicationAuthority:false}),
  saveOnce:async()=>{receipt=await persistPm2Dump(daemon,bootId,registry,target);need(receipt.processCount===registry.length,'evidence_invalid');if(afterSave)afterSave();},
  verifySaved:async()=>{need(await verifyPm2Dump(daemon,bootId,registry,receipt)===true,'operation_unconfirmed');same(await inspectPm2Registry(daemon,bootId),registry);const {commandLine,...current}=captureProcessFact(daemon.pid);same(current,daemon);need(commandLine.length===1&&commandLine[0]==='PM2 v6.0.14: God Daemon ('+home+')','owned_resource_changed');},
  postconditions:async()=>{after=await observe();compare(before,after);seal(directory+'/pm2-persistence-after-observation.json',after);},
  complete:()=>{const completed={kind:'active-incident-current-pm2-persistence-completed',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,registrySha256:pm2RegistryDigest(registry),receipt,beforeObservationSha256:sha256(canonicalJson(before)),afterObservationSha256:sha256(canonicalJson(after)),processControlPerformed:false,daemonBootPerformed:false,productionDatabaseMutated:false,oldOperationRemoved:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(directory+'/pm2-persistence-completed.json',completed);return{kind:completed.kind,directory,processCount:receipt.processCount,persistenceSha256:sha256(bookingHostRead(directory+'/pm2-persistence-completed.json')),processControlPerformed:false,publicationAuthority:false};},
  failure:(error,stage)=>{held();seal(directory+'/pm2-persistence-failed.json',{kind:'active-incident-current-pm2-persistence-unconfirmed',binding:metadata.binding,stage,errorSha256:sha256(String(error?.message??'unknown')),detailsRedacted:true,retryAllowed:false,oldDumpNotAutomaticallyRestored:true,publicationAuthority:false,at:new Date().toISOString()});},
 });
}
export async function persistOwnedActiveReconciliationProcesses(capability,lock,window){
 const {ownedActiveReconciliationScope,observeOwnedActiveReconciliation,assertOwnedActiveReconciliationDelta,ownedActiveReconciliationBoundary}=await import('./release-toolchain-active-generation-owned-lab.mjs');
 const {ownedActiveReconciliationHeldChecker}=await import('./online-release-retention-writer.mjs'),held=ownedActiveReconciliationHeldChecker(capability,lock),s=ownedActiveReconciliationScope(capability),directory=s.directory+'/vault';
 const metadata={directory,binding:{kind:'owned-active-reconciliation-persistence',window,publicationAuthority:false},receiptSha256:sha256(bookingHostRead(directory+'/metadata-corrected.json')),after:JSON.parse(bookingHostRead(directory+'/metadata-after-observation.json'))};
 const {collectOwnedCiPm2Registry}=await import('./release-toolchain-pm2-observation.mjs'),physical=collectOwnedCiPm2Registry(s.pm2Root);
 const afterSave=()=>ownedActiveReconciliationBoundary(capability,'after-save');
 return persistObservedCurrentProcesses({directory,metadata,held,observe:()=>observeOwnedActiveReconciliation(capability),compare:assertOwnedActiveReconciliationDelta,collect:()=>collectOwnedCiPm2Registry(s.pm2Root),home:s.pm2Root+'/pm2',expectedPeer:physical.daemonPeer,afterSave});
}
async function verifyObservedCurrentProcesses({metadata,held,observe,compare,collect,home,expectedPeer}){
 held();const directory=metadata.directory;need(!fs.existsSync(directory+'/pm2-persistence-failed.json'),'operation_unconfirmed');
 const before=read(directory+'/pm2-persistence-before-observation.json'),after=read(directory+'/pm2-persistence-after-observation.json'),attempt=read(directory+'/pm2-persistence-attempt.json'),completed=read(directory+'/pm2-persistence-completed.json');
 compare(metadata.after,before);compare(before,after);const beforeObservationSha256=sha256(canonicalJson(before)),afterObservationSha256=sha256(canonicalJson(after));
 same(attempt,{kind:'active-incident-current-pm2-persistence-attempt',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,daemon:attempt.daemon,bootId:attempt.bootId,registrySha256:attempt.registrySha256,target:attempt.target,beforeObservationSha256,at:attempt.at,publicationAuthority:false});
 same(completed,{kind:'active-incident-current-pm2-persistence-completed',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,registrySha256:attempt.registrySha256,receipt:completed.receipt,beforeObservationSha256,afterObservationSha256,processControlPerformed:false,daemonBootPerformed:false,productionDatabaseMutated:false,oldOperationRemoved:false,publicationAuthority:false,completedAt:completed.completedAt});
 const {captureProcessFact}=await import('./check-production-runtime-supervision.mjs'),{commandLine,...daemon}=captureProcessFact(attempt.daemon.pid),bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
 same(daemon,attempt.daemon);same(bootId,attempt.bootId);same({pid:daemon.pid,uid:daemon.uid,startTicks:daemon.startTicks,bootId,executable:daemon.executable,executableIdentity:daemon.executableIdentity},expectedPeer);need(commandLine.length===1&&commandLine[0]==='PM2 v6.0.14: God Daemon ('+home+')','owned_resource_changed');
 const registry=await inspectPm2Registry(daemon,bootId),physical=collect();same(physical.filteredRegistry,registry);assertCompletePm2DumpSet(physical.rows,registry);same(pm2RegistryDigest(registry),attempt.registrySha256);
 need(await verifyPm2Dump(daemon,bootId,registry,completed.receipt)===true&&completed.receipt.processCount===registry.length,'operation_unconfirmed');
 for(const [file,key]of [['pm2-dump-before.json','dump'],['pm2-backup-before.json','backup']])need(sha256(bookingHostRead(directory+'/'+file))===attempt.target[key]?.sha256,'evidence_invalid');
 const start=Date.parse(metadata.binding.window.startedAt),end=Date.parse(metadata.binding.window.deadlineAt),at=Date.parse(attempt.at),done=Date.parse(completed.completedAt);need(Number.isFinite(at)&&Number.isFinite(done)&&new Date(at).toISOString()===attempt.at&&new Date(done).toISOString()===completed.completedAt&&at>=start&&done>=at&&done<=Date.now()&&Date.now()<end,'evidence_stale');
 const current=await observe();compare(after,current);held();return{directory,metadata,completed,current,persistenceSha256:sha256(bookingHostRead(directory+'/pm2-persistence-completed.json'))};
}
export async function verifyActiveBookingProcessPersistence({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');const metadata=verifyActiveBookingMetadataCorrection({lock,toolRevision,window});
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');verifyActiveBookingMetadataCorrection({lock,toolRevision,window});};
 const expectedPeer=read(metadata.directory+'/legacy-restart-attempt.json').before.daemonPeer;
 return verifyObservedCurrentProcesses({metadata,held,observe:()=>inspectActiveBookingIncidentAfterMetadata({window}),compare:assertActiveCorrectedObservationProgress,collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer});
}
export async function verifyActiveBookingArchivedProcessPersistence({lock,toolRevision,window}){
 const {activeBookingArchiveWitness}=await import('./online-release-retention-writer.mjs'),{inspectActiveBookingIncidentWithArchivedOperation}=await import('./release-toolchain-active-generation-incident.mjs');
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');const archive=activeBookingArchiveWitness(lock);need(archive,'evidence_invalid');same(archive.window,window);
 const metadata=verifyActiveBookingMetadataCorrection({lock,toolRevision,window}),expected={destination:archive.destination,original:archive.original,replacement:archive.replacement,closureSha256:archive.closureSha256};
 const strip=value=>{const result=structuredClone(value);if(Object.hasOwn(result,'originalOperationArchived')){same(result.originalOperationArchived,expected);delete result.originalOperationArchived;}return result;};
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');same(activeBookingArchiveWitness(lock),archive);verifyActiveBookingMetadataCorrection({lock,toolRevision,window});};
 return verifyObservedCurrentProcesses({metadata,held,observe:()=>inspectActiveBookingIncidentWithArchivedOperation({lock,toolRevision,window}),compare:(before,after)=>assertActiveCorrectedObservationProgress(strip(before),strip(after)),collect:collectFormalBookingPm2Registry,home:'/root/.pm2',expectedPeer:read(metadata.directory+'/legacy-restart-attempt.json').before.daemonPeer});
}
export async function verifyOwnedActiveReconciliationPersistence(capability,lock){
 const {ownedActiveReconciliationScope,observeOwnedActiveReconciliation,assertOwnedActiveReconciliationDelta}=await import('./release-toolchain-active-generation-owned-lab.mjs');
 const {ownedActiveReconciliationHeldChecker}=await import('./online-release-retention-writer.mjs'),held=ownedActiveReconciliationHeldChecker(capability,lock),s=ownedActiveReconciliationScope(capability),directory=s.directory+'/vault';
 const metadata={directory,binding:{kind:'owned-active-reconciliation-persistence',window:read(s.directory+'/controller.json').window,publicationAuthority:false},receiptSha256:sha256(bookingHostRead(directory+'/metadata-corrected.json')),after:read(directory+'/metadata-after-observation.json')};
 const {collectOwnedCiPm2Registry}=await import('./release-toolchain-pm2-observation.mjs'),physical=collectOwnedCiPm2Registry(s.pm2Root);
 return verifyObservedCurrentProcesses({metadata,held,observe:()=>observeOwnedActiveReconciliation(capability),compare:assertOwnedActiveReconciliationDelta,collect:()=>collectOwnedCiPm2Registry(s.pm2Root),home:s.pm2Root+'/pm2',expectedPeer:physical.daemonPeer});
}
