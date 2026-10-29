// Genuine formal-host qualification for the specifically approved ACTIVE
// incident. No incident mutation, process control, traffic switch or closure.
import {assertClosedSourceObservationProgress} from './release-toolchain-pre-route-contract.mjs';
import * as fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow,assertActiveBookingObservedHostProgress} from './release-toolchain-active-generation-contract.mjs';
import {inspectActiveBookingIncident} from './release-toolchain-active-generation-incident.mjs';
import {reviewedBookingExecution,refreshReviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks,assertActiveBookingIncidentHeldWindow} from './online-release-retention-writer.mjs';
import {runFullActiveToolchainRehearsal} from './release-toolchain-full-rehearsal.mjs';
import {rehearseFullActiveToolchainInterruption,verifyFullInterruptionReport} from './release-toolchain-full-interrupt.mjs';
import {verifyQualificationFiles,observeBookingCompatibility} from './release-toolchain-booking-admission.mjs';
import {observeBookingReadyApplication} from './booking-ready-backup.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
import {acceptOwnedActiveRouting,verifyOwnedActiveRoutingAcceptance} from './release-toolchain-active-generation-routing-native.mjs';
import{runActualPythonWorkerContract,verifyActualPythonRuntimeFile}from'./release-toolchain-python-runtime.mjs';
const BASE='/var/lib/faolla-booking-active-qualifications',ROOT=BASE+'/'+P.operationId;
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const read=file=>{const text=bookingHostRead(file),value=JSON.parse(text);same(text,canonicalJson(value)+'\n');return value;};
function ensure(parent,name){ownedReleasePath(parent,{directory:true});const file=parent+'/'+name;if(!fs.existsSync(file)){fs.mkdirSync(file,{mode:0o700});bookingHostSync(parent);}ownedReleasePath(file,{directory:true,privateMode:true});return file;}
const invocation=toolRevision=>need(path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'source_changed');
export const qualifyActiveBookingIncident=options=>qualify(options,window=>inspectActiveBookingIncident({window}));
export async function qualifyPostSaveBookingIncident(options){
 assertOnlineRetentionHeldLocks(options.lock);const authority=reviewedBookingExecution(options.toolRevision);need(authority?.prepared.postSavePartial,'source_changed');
 const {observePostSaveIncident}=await import('./release-toolchain-post-save-evidence.mjs');return qualify(options,async window=>(await observePostSaveIncident({window})).current);
}
export async function qualifyClosedPreRouteIncident(options){const {inspectClosedActiveBookingIncidentUnderHeldLocks}=await import('./release-toolchain-active-generation-closed-incident.mjs');return qualify(options,()=>inspectClosedActiveBookingIncidentUnderHeldLocks(options),true);}
async function qualify({lock,toolRevision,window},observe,closedProfile=false){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);invocation(toolRevision);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');
 if(closedProfile)need(authority.prepared.activeIncidentClosed?.evidenceToolRevision==='dc80eacba6b3c6a78b271f88786372b026efd7dc','source_changed');else assertActiveBookingIncidentHeldWindow(lock,window);
 const directory=ensure(ensure(ensure('/var/lib','faolla-booking-active-qualifications'),P.operationId),toolRevision),attempt=directory+'/attempt_'+Date.now()+'_'+randomUUID();fs.mkdirSync(attempt,{mode:0o700});bookingHostSync(directory);
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');};
 let stage='before';try{
  held();const before=await observe(window);seal(attempt+'/started.json',{kind:'active-incident-qualification-started',toolRevision,inventorySha256:authority.tool.inventorySha256,oldOperationId:P.operationId,window,application:authority.prepared.application,before,at:new Date().toISOString(),publicationAuthority:false});
  stage='actual-trusted-python-runtime';const pythonRuntime=runActualPythonWorkerContract();held();seal(attempt+'/python-runtime.json',pythonRuntime);const pythonProof=verifyActualPythonRuntimeFile(attempt+'/python-runtime.json',{toolRevision,inventorySha256:authority.tool.inventorySha256});
  stage='full-active-native';const result=await runFullActiveToolchainRehearsal();held();const native=verifyQualificationFiles(result.root,{toolRevision,inventorySha256:authority.tool.inventorySha256});need(native.report.observationProfile==='fixed-active-incident-connect-only','evidence_invalid');
  stage='real-active-interruption';const interruption=await rehearseFullActiveToolchainInterruption();held();need(interruption.report.observationProfile==='fixed-active-incident-connect-only','evidence_invalid');
  stage='already-active-routing-and-controller-death';const activeRouting=await acceptOwnedActiveRouting();held();const routing=verifyOwnedActiveRoutingAcceptance(activeRouting.root,{toolRevision,inventorySha256:authority.tool.inventorySha256});
  const compatibility=observeBookingCompatibility(native);same(observeBookingReadyApplication(),authority.prepared.application);const after=await observe(window);if(closedProfile)assertClosedSourceObservationProgress(before,after);else assertActiveBookingObservedHostProgress(before,after);held();
  await refreshReviewedBookingExecution(toolRevision);held();
  const proof={kind:'active-incident-formal-qualification-completed',toolRevision,inventorySha256:authority.tool.inventorySha256,oldOperationId:P.operationId,generation:P.generation,window,application:authority.prepared.application,pythonRuntimeSha256:pythonProof.sha256,nativeRoot:native.root,nativeSha256:native.sha256,interruptionRoot:interruption.root,interruptionSha256:interruption.sha256,activeRoutingNativeRoot:routing.root,activeRoutingNativeSha256:routing.sha256,compatibility,beforeObservationSha256:sha256(canonicalJson(before)),afterObservationSha256:sha256(canonicalJson(after)),productionMutated:false,mailEnabled:false,publicationAuthority:false,completedAt:new Date().toISOString()};
  seal(attempt+'/after-observation.json',after);seal(attempt+'/verified.json',proof);held();return{kind:proof.kind,attempt,sha256:sha256(bookingHostRead(attempt+'/verified.json')),nativeRoot:native.root,productionMutated:false,publicationAuthority:false};
 }catch(error){try{held();seal(attempt+'/failed.json',{kind:'active-incident-qualification-unconfirmed',stage,diagnostic:stageFailureDiagnostic(error,{stage:'rehearsal',toolRevision,knownFiles:['release-toolchain-active-generation-qualification.mjs','release-toolchain-full-rehearsal.mjs','release-toolchain-full-interrupt.mjs']}),publicationAuthority:false,at:new Date().toISOString()});}catch{}throw error;}
}
export function verifyLatestActiveBookingQualification({lock,toolRevision}){
 assertOnlineRetentionHeldLocks(lock);invocation(toolRevision);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');const directory=ROOT+'/'+toolRevision;ownedReleasePath(directory,{directory:true,privateMode:true});
 const entries=fs.readdirSync(directory).sort();need(entries.length>0&&entries.every(name=>/^attempt_[0-9]{13}_[a-f0-9-]{36}$/.test(name)),'evidence_invalid');const attempt=directory+'/'+entries.at(-1),started=read(attempt+'/started.json'),proof=read(attempt+'/verified.json');need(!fs.existsSync(attempt+'/failed.json'),'operation_unconfirmed');
 need(proof.kind==='active-incident-formal-qualification-completed'&&proof.toolRevision===toolRevision&&proof.inventorySha256===authority.tool.inventorySha256&&proof.oldOperationId===P.operationId&&proof.generation===P.generation&&proof.productionMutated===false&&proof.mailEnabled===false&&proof.publicationAuthority===false,'evidence_invalid');
 same(proof.application,authority.prepared.application);same(started.application,proof.application);same(started.toolRevision,toolRevision);same(started.inventorySha256,authority.tool.inventorySha256);same(started.oldOperationId,P.operationId);same(started.window,proof.window);same(verifyActualPythonRuntimeFile(attempt+'/python-runtime.json',{toolRevision,inventorySha256:authority.tool.inventorySha256}).sha256,proof.pythonRuntimeSha256);
 const at=Date.parse(proof.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===proof.completedAt&&at>=Date.parse(started.at)&&at<Date.parse(proof.window.deadlineAt)&&at<=Date.now()&&Date.now()-at<86400000,'evidence_stale');
 const native=verifyQualificationFiles(proof.nativeRoot,{toolRevision,inventorySha256:authority.tool.inventorySha256}),interruption=verifyFullInterruptionReport(proof.interruptionRoot,{toolRevision});
 need(native.report.observationProfile==='fixed-active-incident-connect-only'&&interruption.report.observationProfile==='fixed-active-incident-connect-only','evidence_invalid');same(native.sha256,proof.nativeSha256);same(interruption.sha256,proof.interruptionSha256);
 const routing=verifyOwnedActiveRoutingAcceptance(proof.activeRoutingNativeRoot,{toolRevision,inventorySha256:authority.tool.inventorySha256});same(routing.sha256,proof.activeRoutingNativeSha256);
 same(sha256(canonicalJson(started.before)),proof.beforeObservationSha256);const after=read(attempt+'/after-observation.json');same(sha256(canonicalJson(after)),proof.afterObservationSha256);if(started.before.kind==='closed-active-incident-current-observation')assertClosedSourceObservationProgress(started.before,after);else assertActiveBookingObservedHostProgress(started.before,after);same(observeBookingCompatibility(native),proof.compatibility);
 return{attempt,proof,native,activeRouting:routing,sha256:sha256(bookingHostRead(attempt+'/verified.json'))};
}
