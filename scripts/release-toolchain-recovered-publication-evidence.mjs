// Fixed read-only evidence for the already independently recovered legacy
// interruption. These readers cannot archive, reset, release, or publish.
import * as fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {INTERRUPTED_RECOVERY as H} from './release-toolchain-interrupted-recovery-contract.mjs';
import {RECOVERED_PUBLICATION as R,recoveredPublicationBindingSha256} from './release-toolchain-recovered-publication-contract.mjs';
import {readInterruptedFixedEvidence,readInterruptedRetentionPrefix} from './release-toolchain-interrupted-recovery-evidence.mjs';
import {readOnlineRetentionHistory,buildOnlineRetentionPreparation,ONLINE_RETENTION_ROOT,ONLINE_RETENTION_HEAD_FILE} from './online-release-retention.mjs';
import {collectFormalBookingPm2Registry,collectActiveBookingLegacyHost} from './release-toolchain-pm2-observation.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
import {processBirth} from './release-toolchain-process-birth.mjs';
import {assertSameNodeProcess} from './release-toolchain-process-identity.mjs';
import {verifyReleasePm2Dump,captureReleasePm2DumpTarget} from './release-toolchain-pm2-readonly-diagnostic.mjs';
import {pm2RegistryDigest} from './production-maintenance-pm2-adapter.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {bookingHostRead as read,bookingHostSql,bookingHostRun} from './booking-handoff-host-io.mjs';
import {ownedReleasePath,inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {assertActiveBookingRoutingCurrent} from './release-toolchain-active-generation-routing.mjs';
import {assertOriginProbeListenerAbsent} from './release-toolchain-origin-probe-listener-host.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid'),json=file=>JSON.parse(read(file)),hash=(file,privateMode=true)=>sha256(read(file,{binary:true,privateMode}));
export const recoveredPathIdentity=value=>Object.fromEntries(['dev','ino','uid','mode'].map(key=>[key,value[key]]));
const OP='/var/lib/faolla-maintenance/merchant-space/operation.lock',RELEASE='/var/lib/faolla-online-release';
export function recoveredPublicationClosureDirectory(){
 if(!fs.existsSync(R.root))return null;ownedReleasePath(R.root,{directory:true,privateMode:true});const names=fs.readdirSync(R.root);
 need(names.length===1&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(names[0]),'attempt_unknown');
 const directory=R.root+'/'+names[0];ownedReleasePath(directory,{directory:true,privateMode:true});return directory;
}
function manifest(directory){
 const files=fs.readdirSync(directory).sort().map(file=>{const s=ownedReleasePath(directory+'/'+file,{privateMode:true});return{file,sha256:hash(directory+'/'+file),bytes:s.size,...Object.fromEntries(['dev','ino','mode','uid','nlink','mtimeMs','ctimeMs'].map(key=>[key,s[key]]))};});
 need(files.length===34&&sha256(canonicalJson(files))===H.manifestSha256,'evidence_invalid');return files;
}
export function readRecoveredPublicationRecords({directory=null,historyOnly=false}={}){
 const publication=fs.existsSync(H.publication)?H.publication:directory+'/publication';
 need(publication===H.publication||directory===recoveredPublicationClosureDirectory(),'invalid_path');
 manifest(publication);
 const recoveryFile=H.root+'/recovery/completed.json';same(hash(recoveryFile),R.recoverySha256);
 need(!fs.existsSync(H.root+'/recovery/unconfirmed.json'),'attempt_unknown');const recovery=json(recoveryFile);
 need(recovery.kind==='interrupted-publication-independently-recovered'&&recovery.toolRevision===R.recoveryTool&&recovery.inventorySha256===R.recoveryInventorySha256&&recovery.expiredOperationId===H.operationId&&recovery.actualRoute===P.compatibleRollback&&recovery.originalOperationInode===H.operationInode&&recovery.workerGateOpen===false&&recovery.businessDataWritten===false&&recovery.mailEnabled===false&&recovery.applicationPublished===false,'evidence_invalid');
 const before=json(publication+'/worker-attempt.json'),worker=json(publication+'/worker-completed.json'),saved=json(publication+'/pm2-persistence-completed.json');
 same(hash(H.qualification+'/verified.json'),H.qualificationSha256);need(!fs.existsSync(H.qualification+'/failed.json'),'attempt_unknown');
 let history,pending;
 if(publication===H.publication&&fs.existsSync(H.pending)){const prefix=readInterruptedRetentionPrefix();history=prefix.prefix;pending=H.pending;}
 else{
  need(directory===recoveredPublicationClosureDirectory(),'attempt_unknown');pending=directory+'/partial-retention';
  const s=ownedReleasePath(pending,{directory:true,privateMode:true});need(s.dev===64769&&s.ino===H.pendingInode,'owned_resource_changed');same(fs.readdirSync(pending).sort(),Object.keys(H.pendingFiles).sort());
  for(const [name,value]of Object.entries(H.pendingFiles))same(hash(pending+'/'+name),value);
  if(historyOnly){
   // Historical provenance ONLY, never a current full-history observation.
   // Recheck all 21 actual old entries with the unchanged strict reader and
   // the exact retained pre-disposition head. A later journal/head is neither
   // hidden from normal readers nor granted any new publication authority.
   const savedHead=directory+'/retention-head-before.json',expected=Array.from({length:21},(_,index)=>String(index+1).padStart(6,'0'));
   same(hash(savedHead),H.headFileSha256);const map=file=>file===ONLINE_RETENTION_HEAD_FILE?savedHead:file;
   const io={...fs,lstatSync(file,...args){return fs.lstatSync(map(file),...args);},openSync(file,...args){return fs.openSync(map(file),...args);},readdirSync(file,...args){if(file===ONLINE_RETENTION_ROOT){same(fs.readdirSync(file).sort().slice(0,21),expected);return expected;}return fs.readdirSync(file,...args);}};
   history=readOnlineRetentionHistory(ONLINE_RETENTION_ROOT,io);same(hash(savedHead),H.headFileSha256);
  }else{history=readOnlineRetentionHistory();same(hash(ONLINE_RETENTION_HEAD_FILE),H.headFileSha256);}
  need(history.entries.length===21&&history.headSha256===H.headSha256,'evidence_invalid');
  const plan=buildOnlineRetentionPreparation(json(pending+'/before.json'),json(pending+'/recovery-pm2.json'),history,json(pending+'/prepared.json').preparedAt);
  for(const [name,key]of [['before.json','beforeText'],['prepared.json','preparedText'],['recovery-pm2.json','recoveryText']])same(read(pending+'/'+name),plan[key]);
 }
 same(json(pending+'/before.json').bookingHandoff,json(publication+'/handoff-proof.json'));
 same(hash(publication+'/publication-primary-before.json'),R.originalStateSha256);
 same(hash(publication+'/publication-active-before.json'),R.activeSha256);
 return{publication,pending,recovery,before,worker,saved,history,fullCurrentHistoryValidated:!historyOnly&&publication!==H.publication,routing:json(publication+'/routing-plan.json'),lease:json(publication+'/supervisor-lease.json'),supervisor:json(publication+'/supervisor-armed.json').process};
}
export async function verifyRecoveredPublicationHistory(){
 same(inspectPinnedExecutionSource({revision:R.recoveryTool,directory:'/var/lib/faolla-online-code/'+R.recoveryTool}).inventorySha256,R.recoveryInventorySha256);
 // Validate the pre-recovery manifest/prefix using the unchanged original
 // evidence reader, before ANY new disposition directory is created.
 need(!fs.existsSync(R.root),'attempt_unknown');readInterruptedFixedEvidence();
 const records=readRecoveredPublicationRecords();
 const old=await import('file:///var/lib/faolla-online-code/'+H.priorTool+'/scripts/release-toolchain-origin-recovery-evidence.mjs');
 return{records,historical:await old.verifyRecoveredOriginHistory()};
}
export async function observeRecoveredPublication({directory=null,metadataReset=false,operationDirectory=OP,preparedWorker=null,verify=()=>{}}={}){
 const records=readRecoveredPublicationRecords({directory}),stateFile=RELEASE+'/'+P.candidate+'/state.json';
 const expectedState=metadataReset?R.originalStateSha256:R.recoveredStateSha256;
 const check=()=>{verify();for(const fact of [records.lease.parent,records.supervisor]){const birth=processBirth(fact.pid);need(birth===null||birth.startTicks!==fact.startTicks||birth.zombie,'parent_still_running');}
  need(operationDirectory===OP||directory===recoveredPublicationClosureDirectory()&&operationDirectory===directory+'/operation.lock','invalid_path');
  const op=ownedReleasePath(operationDirectory,{directory:true,privateMode:true});same(recoveredPathIdentity(op),{dev:64769,ino:H.operationInode,uid:0,mode:0o40700});same(fs.readdirSync(operationDirectory),[]);
  same(hash(stateFile),expectedState);same(hash(RELEASE+'/active.json'),R.activeSha256);same(hash(RELEASE+'/'+P.compatibleRollback+'/state.json'),'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d');
  need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+P.candidate+'/worker-enabled.json'),'attempt_unknown');assertOriginProbeListenerAbsent();
  const current=Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,read(WEB_RELEASE_PROXY+'/'+file,{privateMode:false})]));
  assertActiveBookingRoutingCurrent(records.routing,json('/var/lib/faolla-booking-handoff/'+P.candidate+'/routing-plan.json'),current,{phase:'rollback'});
  same(hash('/www/server/panel/vhost/nginx/www.faolla.com.conf',false),'d16686e4b1b9eae2fba6ba0c592d3c22597d75b606eed383af13eead3af213f1');
  same(hash('/www/server/nginx/conf/nginx.conf',false),'7e60b4200cf51f0dfdb99f88f9f106380d54d6378bf4fac8f255e3d82d2a0228');};
 // Public nginx files need the existing non-private reader policy.
 const physical=collectFormalBookingPm2Registry(),live=collectActiveBookingLegacyHost(),row=physical.rows.find(value=>value.pm_id===27);
 need(physical.rows.length===25&&row?.pm2_env.status==='online','owned_resource_changed');
 const prior=preparedWorker?preparedWorker.priorCohort:live,registry=preparedWorker?preparedWorker.priorRegistry:physical.filteredRegistry;
 same(prior.processes,json(records.pending+'/before.json').processes);same(prior.identityProofs,json(records.pending+'/before.json').identityProofs);same(prior.raw,records.before.before.legacy.raw);
 if(preparedWorker){same(preparedWorker.before.process,records.worker.after);assertSameNodeProcess(preparedWorker.before.identity,records.worker.identity);same(preparedWorker.after.legacy,live);same(preparedWorker.physical.filteredRegistry,physical.filteredRegistry);}
 else{need(row.pid===H.workerPid&&row.pm2_env.restart_time===H.workerRestarts&&row.pm2_env.pm_exec_path==='/var/lib/faolla-online-code/'+H.priorTool+'/scripts/booking-atomic-worker.mjs','owned_resource_changed');assertSameNodeProcess(captureProcessFact(row.pid),records.worker.identity);}
 const {commandLine,...daemon}=captureProcessFact(physical.daemonPeer.pid);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);same(pm2RegistryDigest(registry),records.saved.registrySha256);
 if(preparedWorker)same(await captureReleasePm2DumpTarget(daemon,physical.daemonPeer.bootId),records.saved.receipt.target);
 else need(await verifyReleasePm2Dump(daemon,physical.daemonPeer.bootId,registry,records.saved.receipt)===true,'evidence_invalid');
 const pilots=bookingHostRun('docker',['inspect','--format','{{json .State.Running}}',...BOOKING_FORMAL_PILOT_IDS]).trim().split('\n');need(pilots.length===5&&pilots.every(value=>value==='false'),'owned_resource_changed');
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(records.recovery.after.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 check();const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.compatibleRollback,operationId:records.recovery.window.id,verify:check,deadlineAtMs:Date.now()+30000});check();same(collectFormalBookingPm2Registry().filteredRegistry,physical.filteredRegistry);same(collectActiveBookingLegacyHost(),live);
 return{kind:'recovered-publication-current-observation',bindingSha256:recoveredPublicationBindingSha256(),at:new Date().toISOString(),database,publicProof,processesSha256:sha256(canonicalJson(prior.processes)),identitiesSha256:sha256(canonicalJson(prior.identityProofs)),legacyEnvironmentSha256:sha256(canonicalJson(prior.raw)),registrySha256:records.saved.registrySha256,retentionHeadSha256:H.headSha256,stateSha256:expectedState,activeSha256:R.activeSha256,actualRoute:P.compatibleRollback,actualWorkerUnchanged:true,gateEnabled:false,processControlPerformed:false,processSavePerformed:false,businessDataWritten:false,mailEnabled:false,publicationAuthority:false};
}
