// One verified persistence of the CURRENT PM2 configuration. This connects to
// the existing daemon; it cannot boot, stop, restart or resurrect any process.
// No CLI entry exists. The eventual closure controller must satisfy admission
// and qualification before constructing this internal operation.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {inspectActiveBookingIncidentAfterMetadata} from './release-toolchain-active-generation-incident.mjs';
import {verifyActiveBookingMetadataCorrection,assertActiveCorrectedObservationProgress} from './release-toolchain-active-generation-metadata.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {inspectPm2Registry,capturePm2DumpTarget,persistPm2Dump,verifyPm2Dump,pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {bookingHostRead,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {collectFormalBookingPm2Registry} from './release-toolchain-pm2-observation.mjs';
import {assertCompletePm2DumpSet} from './release-toolchain-pm2-transition.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
export const ACTIVE_PERSISTENCE_STEPS=Object.freeze(['inspect','freeze','claim','saveOnce','verifySaved','postconditions','complete']);
export async function executeActiveProcessPersistence(operations){
 let result,stage='startup';try{for(const name of ACTIVE_PERSISTENCE_STEPS){stage=name;await operations.assertHeld();result=await operations[name]();await operations.assertHeld();}return result;}
 catch(error){if(operations.failure)try{await operations.failure(error,stage);}catch{}throw error;}
}
export async function persistActiveBookingCurrentProcesses({lock,toolRevision,window}){
 assertOnlineRetentionHeldLocks(lock);const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');assertActiveBookingWindow(window);
 need(process.argv[1]&&process.argv[1]!=='-'&&Date.parse(window.deadlineAt)-Date.now()>=120000,'evidence_stale');
 const metadata=verifyActiveBookingMetadataCorrection({lock,toolRevision,window}),directory=metadata.directory;
 need(!['pm2-persistence-before-observation.json','pm2-persistence-after-observation.json','pm2-persistence-attempt.json','pm2-persistence-completed.json','pm2-persistence-failed.json','pm2-dump-before.json','pm2-backup-before.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_replay_forbidden');
 const held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');verifyActiveBookingMetadataCorrection({lock,toolRevision,window});};
 const {captureProcessFact}=await import('./check-production-runtime-supervision.mjs');
 let before,daemon,bootId,registry,target,receipt,after;
 return executeActiveProcessPersistence({assertHeld:held,
  inspect:async()=>{before=await inspectActiveBookingIncidentAfterMetadata({window});assertActiveCorrectedObservationProgress(metadata.after,before);seal(directory+'/pm2-persistence-before-observation.json',before);},
  freeze:async()=>{
   const pid=Number(bookingHostRead('/root/.pm2/pm2.pid',{privateMode:false}).trim()),{commandLine,...captured}=captureProcessFact(pid);need(captured.uid===0&&captured.executable==='/usr/bin/node'&&commandLine.length===1&&commandLine[0]==='PM2 v6.0.14: God Daemon (/root/.pm2)','owned_resource_changed');daemon=captured;bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
   const historical=JSON.parse(bookingHostRead(directory+'/legacy-restart-attempt.json')).before.daemonPeer;
   same({pid:daemon.pid,uid:daemon.uid,startTicks:daemon.startTicks,bootId,executable:daemon.executable,executableIdentity:daemon.executableIdentity},historical);
   registry=await inspectPm2Registry(daemon,bootId);const physical=collectFormalBookingPm2Registry();same(physical.filteredRegistry,registry);assertCompletePm2DumpSet(physical.rows,registry);target=await capturePm2DumpTarget(daemon,bootId);need(target.dump&&target.backup,'evidence_invalid');
   for(const [file,key,destination]of [['dump.pm2','dump','pm2-dump-before.json'],['dump.pm2.bak','backup','pm2-backup-before.json']]){held();const text=bookingHostRead('/root/.pm2/'+file,{privateMode:false});need(sha256(text)===target[key].sha256,'owned_resource_changed');bookingHostWriteOnce(directory+'/'+destination,text);}
   same(await capturePm2DumpTarget(daemon,bootId),target);same(await inspectPm2Registry(daemon,bootId),registry);
  },
  claim:()=>seal(directory+'/pm2-persistence-attempt.json',{kind:'active-incident-current-pm2-persistence-attempt',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,daemon,bootId,registrySha256:pm2RegistryDigest(registry),target,beforeObservationSha256:sha256(canonicalJson(before)),at:new Date().toISOString(),publicationAuthority:false}),
  saveOnce:async()=>{receipt=await persistPm2Dump(daemon,bootId,registry,target);need(receipt.processCount===registry.length,'evidence_invalid');},
  verifySaved:async()=>{need(await verifyPm2Dump(daemon,bootId,registry,receipt)===true,'operation_unconfirmed');same(await inspectPm2Registry(daemon,bootId),registry);const {commandLine,...current}=captureProcessFact(daemon.pid);same(current,daemon);need(commandLine.length===1&&commandLine[0]==='PM2 v6.0.14: God Daemon (/root/.pm2)','owned_resource_changed');},
  postconditions:async()=>{after=await inspectActiveBookingIncidentAfterMetadata({window});assertActiveCorrectedObservationProgress(before,after);seal(directory+'/pm2-persistence-after-observation.json',after);},
  complete:()=>{const completed={kind:'active-incident-current-pm2-persistence-completed',binding:metadata.binding,metadataReceiptSha256:metadata.receiptSha256,registrySha256:pm2RegistryDigest(registry),receipt,beforeObservationSha256:sha256(canonicalJson(before)),afterObservationSha256:sha256(canonicalJson(after)),processControlPerformed:false,daemonBootPerformed:false,productionDatabaseMutated:false,oldOperationRemoved:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(directory+'/pm2-persistence-completed.json',completed);return{kind:completed.kind,directory,processCount:receipt.processCount,persistenceSha256:sha256(bookingHostRead(directory+'/pm2-persistence-completed.json')),processControlPerformed:false,publicationAuthority:false};},
  failure:(error,stage)=>{held();seal(directory+'/pm2-persistence-failed.json',{kind:'active-incident-current-pm2-persistence-unconfirmed',binding:metadata.binding,stage,errorSha256:sha256(String(error?.message??'unknown')),detailsRedacted:true,retryAllowed:false,oldDumpNotAutomaticallyRestored:true,publicationAuthority:false,at:new Date().toISOString()});},
 });
}
