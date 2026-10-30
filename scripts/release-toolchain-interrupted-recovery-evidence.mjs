// Explicit forensic PREFIX reader: never represents the incomplete full history
// as valid, never changes the strict shared reader, and grants no capability.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {INTERRUPTED_RECOVERY as H,interruptedRecoveryBindingSha256} from './release-toolchain-interrupted-recovery-contract.mjs';
import {readOnlineRetentionHistory,ONLINE_RETENTION_ROOT as R,ONLINE_RETENTION_HEAD_FILE as HF,buildOnlineRetentionPreparation} from './online-release-retention.mjs';
import {ACTIVE_BOOKING_INCIDENT as P,assertActiveBookingDatabaseProgress} from './release-toolchain-active-generation-contract.mjs';
import {collectFormalBookingPm2Registry,collectActiveBookingLegacyHost} from './release-toolchain-pm2-observation.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';import {processBirth} from './release-toolchain-process-birth.mjs';
import {verifyReleasePm2Dump} from './release-toolchain-pm2-readonly-diagnostic.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {bookingHostRead as read,bookingHostSql} from './booking-handoff-host-io.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {assertOriginProbeListenerAbsent} from './release-toolchain-origin-probe-listener-host.mjs';
import {assertActiveBookingRoutingPlan,assertActiveBookingRoutingCurrent} from './release-toolchain-active-generation-routing.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid'),json=p=>JSON.parse(read(p));
export const interruptedFileFact=p=>{const s=ownedReleasePath(p,{privateMode:true});return{file:p,sha256:sha256(read(p,{binary:true})),...Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]))};};
export function readInterruptedRetentionPrefix(){
 const names=fs.readdirSync(R).sort(),expected=Array.from({length:22},(_,i)=>String(i+1).padStart(6,'0'));same(names,expected);
 const head=interruptedFileFact(HF);same(head.sha256,H.headFileSha256);
 const dir=ownedReleasePath(H.pending,{directory:true,privateMode:true});need(dir.ino===H.pendingInode&&dir.dev===64769,'owned_resource_changed');
 same(fs.readdirSync(H.pending).sort(),Object.keys(H.pendingFiles).sort());
 const facts=Object.keys(H.pendingFiles).sort().map(name=>{const f=interruptedFileFact(H.pending+'/'+name);same(f.sha256,H.pendingFiles[name]);return f;});
 const io={...fs,readdirSync(location,...args){if(location===R){same(fs.readdirSync(R).sort(),expected);return expected.slice(0,-1);}return fs.readdirSync(location,...args);}};
 const prefix=readOnlineRetentionHistory(R,io);need(prefix.entries.length===21&&prefix.headSha256===H.headSha256,'evidence_invalid');
 const before=json(H.pending+'/before.json'),prepared=json(H.pending+'/prepared.json'),recovery=json(H.pending+'/recovery-pm2.json');
 const built=buildOnlineRetentionPreparation(before,recovery,prefix,prepared.preparedAt);
 same(read(H.pending+'/prepared.json'),built.preparedText);same(read(H.pending+'/before.json'),built.beforeText);same(read(H.pending+'/recovery-pm2.json'),built.recoveryText);
 same(before.bookingHandoff,json(H.publication+'/handoff-proof.json'));need(before.kind==='booking-handoff'&&before.sequence===22&&before.active.target===P.candidate&&before.rollback.target===P.compatibleRollback&&before.victim===null,'evidence_invalid');
 same(interruptedFileFact(HF),head);same(Object.keys(H.pendingFiles).sort().map(n=>interruptedFileFact(H.pending+'/'+n)),facts);same(fs.readdirSync(R).sort(),expected);
 return{kind:'interrupted-retention-forensic-prefix-only',prefix,before,pending:facts,head,fullHistoryComplete:false,publicationAuthority:false};
}
export function readInterruptedFixedEvidence(){
 const files=fs.readdirSync(H.publication).sort().map(name=>{const f=interruptedFileFact(H.publication+'/'+name);return{file:name,sha256:f.sha256,bytes:f.size,...Object.fromEntries(['dev','ino','mode','uid','nlink','mtimeMs','ctimeMs'].map(k=>[k,f[k]]))};});
 need(files.length===34&&sha256(canonicalJson(files))===H.manifestSha256,'evidence_invalid');
 need(sha256(read(H.qualification+'/verified.json'))===H.qualificationSha256&&!fs.existsSync(H.qualification+'/failed.json'),'evidence_invalid');
 const metadata=json(H.publication+'/publication-metadata-completed.json'),lease=json(H.publication+'/supervisor-lease.json');
 need(metadata.toolRevision===H.priorTool&&lease.toolRevision===H.priorTool&&lease.toolInventorySha256===H.inventorySha256&&metadata.window.id===H.operationId&&lease.window.id===H.operationId&&Date.parse(lease.window.deadlineAt)<Date.now(),'evidence_invalid');
 need(metadata.activeFileSha256===H.activeSha256&&metadata.stateSha256===H.stateSha256,'evidence_invalid');
 const retention=readInterruptedRetentionPrefix();
 return{files,metadata,lease,retention,attempt:json(H.publication+'/worker-attempt.json'),worker:json(H.publication+'/worker-completed.json'),saved:json(H.publication+'/pm2-persistence-completed.json'),routing:json(H.publication+'/routing-plan.json'),originalRouting:json('/var/lib/faolla-booking-handoff/'+P.candidate+'/routing-plan.json'),application:json(H.qualification+'/verified.json').application};
}
export async function observeInterruptedPhysical({evidence=readInterruptedFixedEvidence(),metadata,phase='primary'}={}){
 need(['primary','rollback'].includes(phase),'invalid_contract');
 for(const pid of [H.parentPid,H.supervisorPid])need(processBirth(pid)===null,'parent_still_running');
 const op=ownedReleasePath('/var/lib/faolla-maintenance/merchant-space/operation.lock',{directory:true,privateMode:true});same(Object.fromEntries(['dev','ino','uid','mode','nlink'].map(k=>[k,op[k]])),{dev:64769,ino:H.operationInode,uid:0,mode:0o40700,nlink:2});same(fs.readdirSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),[]);
 need(!fs.existsSync('/var/lib/faolla-booking-handoff/'+P.candidate+'/worker-enabled.json'),'attempt_unknown');assertOriginProbeListenerAbsent();
 const physical=collectFormalBookingPm2Registry(),live=collectActiveBookingLegacyHost(),worker=physical.rows.find(v=>v.pm_id===27);need(physical.rows.length===25&&worker?.pid===H.workerPid&&worker.pm2_env.restart_time===H.workerRestarts&&worker.pm2_env.status==='online'&&worker.pm2_env.pm_exec_path==='/var/lib/faolla-online-code/'+H.priorTool+'/scripts/booking-atomic-worker.mjs','owned_resource_changed');
 same(live.processes,evidence.retention.before.processes);same(live.identityProofs,evidence.retention.before.identityProofs);same(live.raw,evidence.attempt.before.legacy.raw);
 const {commandLine,...daemon}=captureProcessFact(physical.daemonPeer.pid);same(commandLine,['PM2 v6.0.14: God Daemon (/root/.pm2)']);need(await verifyReleasePm2Dump(daemon,physical.daemonPeer.bootId,physical.filteredRegistry,evidence.saved.receipt)===true,'evidence_invalid');
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabaseProgress(evidence.attempt.database,database,{systemIdentifier:'7612049595342295079',databaseOid:'5'});
 const activeText=read('/var/lib/faolla-online-release/active.json'),stateText=read('/var/lib/faolla-online-release/'+P.candidate+'/state.json');same(sha256(activeText),metadata?sha256(metadata.activeText):H.activeSha256);same(sha256(stateText),metadata?sha256(metadata.stateText):H.stateSha256);
 const current=Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,read(WEB_RELEASE_PROXY+'/'+file,{privateMode:false})]));assertActiveBookingRoutingPlan(evidence.routing,evidence.originalRouting);assertActiveBookingRoutingCurrent(evidence.routing,evidence.originalRouting,current,{phase});
 const vhostSha256=sha256(read('/www/server/panel/vhost/nginx/www.faolla.com.conf',{privateMode:false})),mainSha256=sha256(read('/www/server/nginx/conf/nginx.conf',{privateMode:false}));same(vhostSha256,'d16686e4b1b9eae2fba6ba0c592d3c22597d75b606eed383af13eead3af213f1');same(mainSha256,'7e60b4200cf51f0dfdb99f88f9f106380d54d6378bf4fac8f255e3d82d2a0228');
 const retention=readInterruptedRetentionPrefix();same(retention.pending,evidence.retention.pending);same(retention.head,evidence.retention.head);
 return{kind:'interrupted-publication-physical-observation',bindingSha256:interruptedRecoveryBindingSha256(),at:new Date().toISOString(),processesSha256:sha256(canonicalJson(live.processes)),identitiesSha256:sha256(canonicalJson(live.identityProofs)),legacyRawSha256:sha256(canonicalJson(live.raw)),savedDumpVerified:true,operationInode:op.ino,workerGateOpen:false,activeSha256:sha256(activeText),stateSha256:sha256(stateText),database,proxyHashes:Object.fromEntries(Object.entries(current).map(([f,v])=>[f,sha256(v)])),vhostSha256,mainSha256,partialRetentionPreserved:true,publicationManifestSha256:H.manifestSha256,mailEnabled:false,publicationAuthority:false};
}
