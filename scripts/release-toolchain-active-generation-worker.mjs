// Fixed still-gated worker source transition, not a web restart or activation.
// Only the real reviewed publication controller can reach the peer-bound helper.
import * as fs from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingWindow,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {inspectClosedActiveBookingIncidentUnderHeldLocks} from './release-toolchain-active-generation-closed-incident.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {collectFormalBookingPm2Registry,collectActiveBookingLegacyHost} from './release-toolchain-pm2-observation.mjs';
import {bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {bookingReadyWorkerConfiguration,assertBookingReadyWorkerRawTransition,executeBookingReadyWorkerReplacement} from './booking-ready-worker.mjs';
import {assertExecutionWorkerTransition} from './release-toolchain-worker-contract.mjs';
import {assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {bookingHostRead,bookingHostSql,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {assertActiveBookingWorkerConfigurationTransition,waitForActiveBookingWorkerSettlement,activeBookingWorkerObservation} from './release-toolchain-active-generation-worker-settlement.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+P.candidate,NAME='merchant-space-booking-atomic-'+P.candidate.slice(0,12),BASE='/var/lib/faolla-booking-active-publications/'+P.candidate;
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),read=file=>JSON.parse(bookingHostRead(file)),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const raw=pid=>{const rows={};for(const entry of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const index=entry.indexOf('=');need(index>0&&!Object.hasOwn(rows,entry.slice(0,index)),'evidence_invalid');rows[entry.slice(0,index)]=entry.slice(index+1);}return rows;};
function peer(pid){const {commandLine,...fact}=captureProcessFact(pid);void commandLine;return{pid,uid:fact.uid,startTicks:fact.startTicks,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:fact.executable,executableIdentity:fact.executableIdentity};}
export async function prepareActiveBookingGatedWorker({lock,toolRevision,window,directory}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority?.prepared.activeIncidentClosed?.oldOperationId===P.operationId,'source_changed');
 need(directory===BASE+'/'+window.id,'invalid_path');ownedReleasePath(directory,{directory:true,privateMode:true});need(!['worker-attempt.json','worker-completed.json','worker-unconfirmed.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_replay_forbidden');
 const absent=()=>need(!fs.existsSync(ROOT+'/worker-enabled.json'),'attempt_unknown'),held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');absent();};
 held();const closed=await inspectClosedActiveBookingIncidentUnderHeldLocks({lock,toolRevision});same(closed.closedSha256,authority.prepared.activeIncidentClosed.closedSha256);need(Date.parse(closed.closedAt)<Date.parse(window.startedAt),'evidence_invalid');
 same(fs.readFileSync(authority.tool.directory+'/scripts/booking-atomic-worker.mjs'),fs.readFileSync('/var/lib/faolla-online-code/'+P.toolRevision+'/scripts/booking-atomic-worker.mjs'));
 const publication=read(directory+'/publication-attempt.json');need(publication.kind==='active-booking-publication-attempt'&&publication.toolRevision===toolRevision&&publication.closedIncidentSha256===closed.closedSha256,'evidence_invalid');same(publication.window,window);
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(closed.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});let attempt,stage='observe';
 const observe=()=>{held();const physical=collectFormalBookingPm2Registry(),target=physical.rows.find(row=>row.name===NAME);need(target?.pid>0&&target.pm2_env.status==='online','operation_unconfirmed');const runtime=raw(target.pid);assertBookingAtomicWorkerEnvironment(runtime);
  return{process:normalizeRetirementProcess(target),configured:bookingReadyWorkerConfiguration(target.pm2_env),raw:runtime,identity:captureProcessFact(target.pid),peer:peer(target.pid),rpcExpected:bookingLegacyRpcExpected({...target,pm2_env:{...target.pm2_env,args:target.pm2_env.args??[],node_args:target.pm2_env.node_args??[]}}),legacy:collectActiveBookingLegacyHost()};};
 try{return await executeBookingReadyWorkerReplacement({observe,
  admit:before=>{held();need(before.process.pid===P.privateWorkerPid&&before.process.pmId===27&&before.process.executable==='/var/lib/faolla-online-code/'+P.toolRevision+'/scripts/booking-atomic-worker.mjs','owned_resource_changed');},
  begin:before=>{stage='durable-intent';attempt={kind:'active-booking-gated-worker-attempt',toolRevision,inventorySha256:authority.tool.inventorySha256,window,closedDirectory:closed.directory,closedIncidentSha256:closed.closedSha256,before,database,controller:captureProcessFact(process.pid),at:new Date().toISOString(),publicationAuthority:false};seal(directory+'/worker-attempt.json',attempt);},
  restart:before=>{stage='single-peer-source-transition';held();same(read(directory+'/worker-attempt.json'),attempt);const python=captureTrustedPython(),helper=fileURLToPath(new URL('./release-toolchain-active-generation-pm2-worker.py',import.meta.url));verifyTrustedPython(python);
   const response=spawnSync(python.target.path,['-I','-S','-B',helper],{cwd:'/',stdio:['pipe','pipe','pipe',lock.deployFd],input:canonicalJson({daemon:before.legacy.daemonPeer,process:before.peer,expected:before.rpcExpected,revision:toolRevision,operationId:window.id,attemptSha256:sha256(canonicalJson(attempt)+'\n')}),encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:262144,windowsHide:true,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
   verifyTrustedPython(python);held();need(response.status===0&&!response.signal&&!response.error&&response.stderr==='','attempt_unknown');return JSON.parse(response.stdout);},
  settled:async()=>{stage='actual-settlement';let settled;
   const asObservation=value=>activeBookingWorkerObservation({pid:value.process.pid,pm2_env:{...value.configured,restart_time:value.process.restartCount}},value.raw,value.identity);
   await waitForActiveBookingWorkerSettlement({before:asObservation(attempt.before),script:authority.tool.directory+'/scripts/booking-atomic-worker.mjs',observe:()=>{settled=observe();return asObservation(settled);}});return settled;},
  verify:(before,after)=>{stage='independent-postconditions';held();assertExecutionWorkerTransition(before.process,after.process,{priorRevision:P.toolRevision,revision:toolRevision});assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);
   assertActiveBookingWorkerConfigurationTransition(before.configured,after.configured);
   for(const key of ['processes','identityProofs'])same(after.legacy[key].filter(value=>value.name!==NAME),before.legacy[key].filter(value=>value.name!==NAME));same(after.legacy.daemonPeer,before.legacy.daemonPeer);same(after.legacy.raw,before.legacy.raw);
   const latest=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(database,latest,{systemIdentifier:'7612049595342295079',databaseOid:'5'});},
  complete:(before,after)=>{stage='durable-receipt';held();const receipt={kind:'active-booking-gated-worker-source-replaced',toolRevision,inventorySha256:authority.tool.inventorySha256,window,closedIncidentSha256:closed.closedSha256,before:before.process,after:after.process,identity:after.identity,attemptSha256:sha256(canonicalJson(attempt)+'\n'),gateNeverOpened:true,webProcessesChanged:false,businessDataWrittenByTool:false,mailEnabled:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(directory+'/worker-completed.json',receipt);held();return{kind:receipt.kind,workerPid:after.process.pid,receiptSha256:sha256(bookingHostRead(directory+'/worker-completed.json')),gateOpen:false,publicationAuthority:false};},
 });}catch(error){try{held();seal(directory+'/worker-unconfirmed.json',{kind:'active-booking-gated-worker-unconfirmed',stage,errorSha256:sha256(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false,at:new Date().toISOString()});}catch{}throw error;}
}
