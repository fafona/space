// Fixed still-gated worker source transition, not a web restart or activation.
// Only the real reviewed publication controller can reach the peer-bound helper.
import {assertSameNodeProcess} from './release-toolchain-process-identity.mjs';
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
import {activeBookingPublicationGateProfile,readAdmittedActiveBookingWorkerContext} from './release-toolchain-active-generation-publication-scope.mjs';
import {ORIGIN_RECOVERY as ORIGIN} from './release-toolchain-origin-recovery-contract.mjs';
import {readOriginRecoveryClosed} from './release-toolchain-origin-recovery-closure.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+P.candidate,NAME='merchant-space-booking-atomic-'+P.candidate.slice(0,12),BASE='/var/lib/faolla-booking-active-publications/'+P.candidate;
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch'),read=file=>JSON.parse(bookingHostRead(file)),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const raw=pid=>{const rows={};for(const entry of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const index=entry.indexOf('=');need(index>0&&!Object.hasOwn(rows,entry.slice(0,index)),'evidence_invalid');rows[entry.slice(0,index)]=entry.slice(index+1);}return rows;};
// Diagnostic parsing never grants retry/control authority. Only the trusted
// child pre-connect boundary plus a completely unchanged actual cohort may
// produce the separate immutable refusal receipt below.
export function parseActiveWorkerPreConnectRefusal(response){
 if(response?.status!==1||response.signal||response.error||response.stdout!==''||typeof response.stderr!=='string'||response.stderr.length>4096)return null;
 let value;try{value=JSON.parse(response.stderr);}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value)||!isDeepStrictEqual(Object.keys(value).sort(),['automaticRetryAllowed','code','controlSent','detailsRedacted','kind','mutationPossible','schemaVersion','socketOpened','stage'].sort()))return null;
 const codes=['unconfirmed','active_worker_source','active_worker_gate_open','active_worker_attempt','active_worker_binding','active_worker_time','active_worker_window','active_worker_controller','active_worker_closure_path','active_worker_closure','active_worker_inherited_fd','active_worker_lock_not_held','active_worker_fixed_predecessor','active_worker_script','active_worker_script_changed','active_worker_path','active_worker_file','active_worker_file_changed'];
 if(value.schemaVersion!==1||value.kind!=='active-gated-worker-refused-before-connect'||!['input','formal-witness'].includes(value.stage)||!codes.includes(value.code)||value.socketOpened!==false||value.controlSent!==false||value.mutationPossible!==false||value.automaticRetryAllowed!==false||value.detailsRedacted!==true||response.stderr!==canonicalJson(value)+'\n')return null;return Object.freeze(value);
}
function peer(pid){const {commandLine,...fact}=captureProcessFact(pid);void commandLine;return{pid,uid:fact.uid,startTicks:fact.startTicks,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:fact.executable,executableIdentity:fact.executableIdentity};}
function predecessor(authority,toolRevision){
 if(!authority.prepared.originRecovered)return{pid:P.privateWorkerPid,revision:P.toolRevision,helper:'release-toolchain-active-generation-pm2-worker.py'};
 const closed=readOriginRecoveryClosed(toolRevision);same(closed.directory,authority.prepared.originRecovered.closedDirectory);same(closed.sha256,authority.prepared.originRecovered.closedSha256);return{pid:ORIGIN.workerPid,revision:ORIGIN.priorTool,helper:'release-toolchain-origin-recovery-pm2-worker.py',closed};
}
export async function prepareActiveBookingGatedWorker({scope,lock,toolRevision,window,directory,beforeIntent}){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority?.prepared.activeIncidentClosed?.oldOperationId===P.operationId,'source_changed');
 const prior=predecessor(authority,toolRevision);
 need(typeof beforeIntent==='function','invalid_contract');
 need(directory===BASE+'/'+window.id,'invalid_path');ownedReleasePath(directory,{directory:true,privateMode:true});need(!['worker-attempt.json','worker-completed.json','worker-unconfirmed.json'].some(name=>fs.existsSync(directory+'/'+name)),'attempt_replay_forbidden');
 const absent=()=>need(!fs.existsSync(ROOT+'/worker-enabled.json'),'attempt_unknown'),held=()=>{assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');absent();};
 held();const closed=scope===undefined?await inspectClosedActiveBookingIncidentUnderHeldLocks({lock,toolRevision}):await readAdmittedActiveBookingWorkerContext(scope,{lock,toolRevision,window,directory});held();same(closed.closedSha256,authority.prepared.activeIncidentClosed.closedSha256);need(Date.parse(closed.closedAt)<Date.parse(window.startedAt),'evidence_invalid');
 same(fs.readFileSync(authority.tool.directory+'/scripts/booking-atomic-worker.mjs'),fs.readFileSync('/var/lib/faolla-online-code/'+P.toolRevision+'/scripts/booking-atomic-worker.mjs'));
 const publication=read(directory+'/publication-attempt.json');need(publication.kind==='active-booking-publication-attempt'&&publication.toolRevision===toolRevision&&publication.closedIncidentSha256===closed.closedSha256,'evidence_invalid');same(publication.window,window);
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(closed.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});let attempt,intentStarted=false,stage='observe';
 const observe=()=>{held();const physical=collectFormalBookingPm2Registry(),target=physical.rows.find(row=>row.name===NAME);need(target?.pid>0&&target.pm2_env.status==='online','operation_unconfirmed');const runtime=raw(target.pid);assertBookingAtomicWorkerEnvironment(runtime);
  return{process:normalizeRetirementProcess(target),configured:bookingReadyWorkerConfiguration(target.pm2_env),raw:runtime,identity:captureProcessFact(target.pid),peer:peer(target.pid),registry:physical.filteredRegistry,rpcExpected:bookingLegacyRpcExpected({...target,pm2_env:{...target.pm2_env,args:target.pm2_env.args??[],node_args:target.pm2_env.node_args??[]}}),legacy:collectActiveBookingLegacyHost()};};
 try{return await executeBookingReadyWorkerReplacement({observe,
  admit:before=>{held();need(before.process.pid===prior.pid&&before.process.pmId===27&&before.process.executable==='/var/lib/faolla-online-code/'+prior.revision+'/scripts/booking-atomic-worker.mjs','owned_resource_changed');},
  begin:before=>{stage='durable-intent';beforeIntent();intentStarted=true;attempt={kind:'active-booking-gated-worker-attempt',toolRevision,inventorySha256:authority.tool.inventorySha256,window,closedDirectory:closed.directory,closedIncidentSha256:closed.closedSha256,...(prior.closed?{originRecoveryClosedDirectory:prior.closed.directory,originRecoveryClosedSha256:prior.closed.sha256}:{}),before,database,controller:captureProcessFact(process.pid),at:new Date().toISOString(),publicationAuthority:false};seal(directory+'/worker-attempt.json',attempt);},
  restart:before=>{stage='single-peer-source-transition';held();same(read(directory+'/worker-attempt.json'),attempt);const python=captureTrustedPython(),helper=fileURLToPath(new URL('./'+prior.helper,import.meta.url));verifyTrustedPython(python);
   const response=spawnSync(python.target.path,['-I','-S','-B',helper],{cwd:'/',stdio:['pipe','pipe','pipe',lock.deployFd],input:canonicalJson({daemon:before.legacy.daemonPeer,process:before.peer,expected:before.rpcExpected,revision:toolRevision,operationId:window.id,attemptSha256:sha256(canonicalJson(attempt)+'\n')}),encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:262144,windowsHide:true,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
   verifyTrustedPython(python);held();const refusal=parseActiveWorkerPreConnectRefusal(response);if(refusal){const after=observe();assertSameNodeProcess(after.identity,before.identity);same({...after,identity:before.identity},before);seal(directory+'/worker-refused-before-connect.json',{kind:'active-booking-worker-pre-connect-refusal-observed',toolRevision,window,attemptSha256:sha256(canonicalJson(attempt)+'\n'),child:refusal,childReportSha256:sha256(response.stderr),unchangedCohortSha256:sha256(canonicalJson(after.legacy)),unchangedRegistrySha256:sha256(canonicalJson(after.registry)),actualProcessUnchanged:true,automaticRetryAllowed:false,publicationAuthority:false,at:new Date().toISOString()});}
   need(response.status===0&&!response.signal&&!response.error&&response.stderr==='','attempt_unknown');return JSON.parse(response.stdout);},
  settled:async()=>{stage='actual-settlement';let settled;
   const asObservation=value=>activeBookingWorkerObservation({pid:value.process.pid,pm2_env:{...value.configured,restart_time:value.process.restartCount}},value.raw,value.identity);
   await waitForActiveBookingWorkerSettlement({before:asObservation(attempt.before),script:authority.tool.directory+'/scripts/booking-atomic-worker.mjs',observe:()=>{settled=observe();return asObservation(settled);}});return settled;},
  verify:(before,after)=>{stage='independent-postconditions';held();assertExecutionWorkerTransition(before.process,after.process,{priorRevision:prior.revision,revision:toolRevision});assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);
   assertActiveBookingWorkerConfigurationTransition(before.configured,after.configured);
   for(const key of ['processes','identityProofs'])same(after.legacy[key].filter(value=>value.name!==NAME),before.legacy[key].filter(value=>value.name!==NAME));same(after.legacy.daemonPeer,before.legacy.daemonPeer);same(after.legacy.raw,before.legacy.raw);
   const latest=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(database,latest,{systemIdentifier:'7612049595342295079',databaseOid:'5'});},
  complete:(before,after)=>{stage='durable-receipt';held();const receipt={kind:'active-booking-gated-worker-source-replaced',toolRevision,inventorySha256:authority.tool.inventorySha256,window,closedIncidentSha256:closed.closedSha256,before:before.process,after:after.process,identity:after.identity,attemptSha256:sha256(canonicalJson(attempt)+'\n'),gateNeverOpened:true,webProcessesChanged:false,businessDataWrittenByTool:false,mailEnabled:false,publicationAuthority:false,completedAt:new Date().toISOString()};seal(directory+'/worker-completed.json',receipt);held();return{kind:receipt.kind,workerPid:after.process.pid,receiptSha256:sha256(bookingHostRead(directory+'/worker-completed.json')),gateOpen:false,publicationAuthority:false};},
 });}catch(error){if(intentStarted)try{held();seal(directory+'/worker-unconfirmed.json',{kind:'active-booking-gated-worker-unconfirmed',stage,errorSha256:sha256(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false,at:new Date().toISOString()});}catch{}throw error;}
}
// Explicit read-only post-transition profile. It does not rerun a mutation or
// make the original closed-incident profile accept a changed worker by default.
export function observeActiveBookingPreparedWorker(options){return observePreparedWorker(options,null);}
export function observeActiveBookingCertifiedWorker(options){const gate=activeBookingPublicationGateProfile(options.scope,options);need(gate?.kind==='active-booking-certified-worker-gate-profile','invalid_contract');return observePreparedWorker(options,gate);}
function observePreparedWorker({lock,toolRevision,window,directory},gate){
 assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);const authority=reviewedBookingExecution(toolRevision);need(authority?.prepared.activeIncidentClosed?.toolRevision===toolRevision,'source_changed');
 const prior=predecessor(authority,toolRevision);
 need(directory===BASE+'/'+window.id,'invalid_path');ownedReleasePath(directory,{directory:true,privateMode:true});need(!fs.existsSync(directory+'/worker-unconfirmed.json'),'attempt_unknown');if(gate)same(bookingHostRead(ROOT+'/worker-enabled.json'),gate.gateText);else need(!fs.existsSync(ROOT+'/worker-enabled.json'),'attempt_unknown');
 const attempt=read(directory+'/worker-attempt.json'),receipt=read(directory+'/worker-completed.json'),publication=read(directory+'/publication-attempt.json');
 need(attempt.kind==='active-booking-gated-worker-attempt'&&attempt.toolRevision===toolRevision&&attempt.inventorySha256===authority.tool.inventorySha256&&attempt.closedDirectory===authority.prepared.activeIncidentClosed.closedDirectory&&attempt.closedIncidentSha256===authority.prepared.activeIncidentClosed.closedSha256,'evidence_invalid');same(attempt.window,window);same(publication.window,window);need(publication.kind==='active-booking-publication-attempt'&&publication.toolRevision===toolRevision&&publication.closedIncidentSha256===attempt.closedIncidentSha256,'evidence_invalid');
 const before=attempt.before;need(before.process.pid===prior.pid&&before.process.pmId===27,'evidence_invalid');if(prior.closed){same(attempt.originRecoveryClosedDirectory,prior.closed.directory);same(attempt.originRecoveryClosedSha256,prior.closed.sha256);}
 const physical=collectFormalBookingPm2Registry(),row=physical.rows.find(value=>value.name===NAME);need(row?.pid>0&&row.pm2_env.status==='online','owned_resource_changed');
 const after={process:normalizeRetirementProcess(row),configured:bookingReadyWorkerConfiguration(row.pm2_env),raw:raw(row.pid),identity:captureProcessFact(row.pid),legacy:collectActiveBookingLegacyHost()};
 assertExecutionWorkerTransition(before.process,after.process,{priorRevision:prior.revision,revision:toolRevision});assertBookingAtomicWorkerEnvironment(after.raw);assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);assertActiveBookingWorkerConfigurationTransition(before.configured,after.configured);
 for(const key of ['processes','identityProofs'])same(after.legacy[key].filter(value=>value.name!==NAME),before.legacy[key].filter(value=>value.name!==NAME));same(after.legacy.daemonPeer,before.legacy.daemonPeer);same(after.legacy.raw,before.legacy.raw);
 same(physical.filteredRegistry.filter(value=>value.name!==NAME),before.registry.filter(value=>value.name!==NAME));
 assertSameNodeProcess(after.identity,receipt.identity);same(receipt,{kind:'active-booking-gated-worker-source-replaced',toolRevision,inventorySha256:authority.tool.inventorySha256,window,closedIncidentSha256:attempt.closedIncidentSha256,before:before.process,after:after.process,identity:receipt.identity,attemptSha256:sha256(canonicalJson(attempt)+'\n'),gateNeverOpened:true,webProcessesChanged:false,businessDataWrittenByTool:false,mailEnabled:false,publicationAuthority:false,completedAt:receipt.completedAt});
 const at=Date.parse(receipt.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===receipt.completedAt&&at>=Date.parse(attempt.at)&&Date.parse(attempt.at)>=Date.parse(window.startedAt)&&at<=Date.now()&&at<Date.parse(window.deadlineAt),'evidence_invalid');
 const priorCohort={...after.legacy,processes:after.legacy.processes.map(value=>value.name===NAME?before.legacy.processes.find(old=>old.name===NAME):value),identityProofs:after.legacy.identityProofs.map(value=>value.name===NAME?before.legacy.identityProofs.find(old=>old.name===NAME):value)};
 same(priorCohort,before.legacy);assertSameNodeProcess(captureProcessFact(row.pid),after.identity);assertOnlineRetentionHeldLocks(lock);assertActiveBookingWindow(window);
 return{before,after,priorCohort,priorRegistry:before.registry,physical,receipt,receiptSha256:sha256(bookingHostRead(directory+'/worker-completed.json')),closedSha256:attempt.closedIncidentSha256,publicationAuthority:false};
}
