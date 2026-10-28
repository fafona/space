// Fixed, operator-approved interrupted ACTIVE incident. Read-only observation
// only: no lock removal, metadata write, SQL mutation, process signal or retry.
import * as fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P,ACTIVE_BOOKING_METADATA,ACTIVE_BOOKING_PM2_RECORDS,assertActiveBookingWindow,assertActiveBookingDatabase,assertActiveBookingHistoricalEvidence,assertHistoricalPausedBookingHost} from './release-toolchain-active-generation-contract.mjs';
import {inspectPinnedPm2RecordSequence} from './release-toolchain-pm2-transition.mjs';
import {bookingHostRead,bookingHostSql,bookingHostRun} from './booking-handoff-host-io.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {collectBookingLegacyHost} from './booking-handoff-legacy.mjs';
import {assertBookingWatchdogArmedLease} from './booking-handoff-watchdog.mjs';
import {assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
import {assertArchivedRecoveredBookingAttempt} from './release-toolchain-recovered-attempt.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {proveRecoveryTargets} from './release-toolchain-recovery-probe.mjs';

export const ACTIVE_INCIDENT_ROOT='/var/lib/faolla-booking-handoff/'+P.candidate;
export const ACTIVE_INCIDENT_FILES=Object.freeze([
 ['activation-attempt.json',731,'44ec133762a6ba45bf0b4edb19b71a1fab8c4d01b05d84ede4d9324388ae174c'],
 ['activation.json',622,'b0d7402b3bcc592a954541f53f4b86a7bd314fe4339c99bbf065650514746e32'],
 ['controller-failure.json',214,'bb90368bb779113e41a642d2d1dccb90efb102f33066d106acb2abeadc385354'],
 ['ingress-install-attempt.json',523,'22ca30ae70736c3e25540e02f1ee86fbcf7b0c9cf8b4bf101b2829fd34edc242'],
 ['ingress-plan.json',5183,'a0ce596cf0ffaf6574a9390cc3ee445cfd818d34dc74c41696aaad4e203a9463'],
 ['legacy-drain.json',453,'02d6ccd7fee6f971129ffd45f142a76eee412965d8dbe9b82093e3fd30c25162'],
 ['legacy-restart-attempt.json',27235,'5fcfb7adca24c2ee2560c9a4fd621fc713a9e0f3a2fdf011ee62e96f145a435f'],
 ['legacy-restart-rpc-ack.json',120,'815bb4f450d91bbb686c4c82ca5830296a1b4f7b387cbb3d1da25ab74218ec43'],
 ['preflight.json',2434,'632e855cad52c7ad21a3e8054327af8e85d1d390f9f8a958f3bf157eb1558df5'],
 ['recovery-plan.json',716,'a6cd5feaa08ef1326dadb1eaa18e83143adf771d23d37be07861e8c390a51e6a'],
 ['rollback-readiness.json',901,'cbc46dcc66e29651ee04e4884c47c42161017f0e9db310911c2886b78c65a139'],
 ['routing-applied-armed.json',541,'c7c0c64c9840781d2b503ee793274522ab65aa70fb2b5f2b9bc05c4645a2479e'],
 ['routing-attempt-armed.json',6477,'97856fde2264aa31c27c3b7d3c045cf15de38918b3861f3be4a3cb336fc93036'],
 ['routing-plan.json',26309,'706fdf61115e7c761dd5062d09c8f6efc09a13243e03607669e649c970860601'],
 ['rule-repair-plan.json',12427,'bd2ded72a6020188a978710da65dfa186d0aed98d1ab6f878b2f0572c3410ba8'],
 ['rule-repair.json',887,'831001d1bb95f96641d81aba3544a1bba28a2ac2f86765008247b8e43bf96744'],
 ['watchdog-armed.json',382,'c565428be0b7599f60e2cb6972f5261f489be71f8ceb06b6dec67681ba77dfa8'],
 ['watchdog-lease.json',1017,'8ae34b12c8dca815830a5e90e650c822d9d44d6adc54cee9cb8993e6dc4bf695'],
 ['watchdog-recovery-attempt.json',18510,'17984b919420ec5b9a1a5ade7aa6b1c056a096de10376114fbb703f69f2af584'],
 ['watchdog.log',29,'78fd1dbac26659ffef547b4b8fdd6f27aa20d41632d362995d5fb18398308723'],
].map(Object.freeze));
export const ACTIVE_INCIDENT_STATIC_NAMES=Object.freeze(['primary-original-stage.json','primary-runtime-restart-attempt.json','ready-worker-attempt.json','ready-worker-completed.json','recovered-attempts','rollback-original-state.json','rollback-runtime-start-attempt.json','runtime-attempt.json','runtime-ready.json','static-assets.json','toolchain-admission','toolchain-qualification','toolchain-runtime','worker-runtime.json','worker-start-attempt.json']);
export const ACTIVE_INCIDENT_DATABASE_IDENTITY=Object.freeze({systemIdentifier:'7612049595342295079',databaseOid:'5'});
const DEPLOY='/www/wwwroot/merchant-space.deploy.lock',OPERATION='/var/lib/faolla-maintenance/merchant-space/operation.lock',RELEASE='/var/lib/faolla-online-release';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch');
const statFact=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
const lockFact=s=>Object.fromEntries(['dev','ino','mode','nlink','uid'].map(k=>[k,s[k]]));
const read=file=>JSON.parse(bookingHostRead(file));
const names=()=>fs.readdirSync(ACTIVE_INCIDENT_ROOT).sort();
export function assertPinnedActiveIncidentBytes(pin,bytes){
 need(ACTIVE_INCIDENT_FILES.some(p=>isDeepStrictEqual(p,pin))&&Buffer.isBuffer(bytes)&&bytes.length===pin[1]&&sha256(bytes)===pin[2],'evidence_invalid');return true;
}
function pinnedFiles(){
 const result={};for(const pin of ACTIVE_INCIDENT_FILES){const file=ACTIVE_INCIDENT_ROOT+'/'+pin[0],before=statFact(ownedReleasePath(file,{privateMode:true})),bytes=bookingHostRead(file,{binary:true});assertPinnedActiveIncidentBytes(pin,bytes);same(statFact(fs.lstatSync(file)),before);result[pin[0]]={...before,sha256:pin[2]};}return result;
}
function assertGone(expected){
 need(Number.isSafeInteger(expected?.pid)&&expected.pid>0&&/^[0-9]+$/.test(expected.startTicks),'evidence_invalid');
 try{const value=fs.readFileSync('/proc/'+expected.pid+'/stat','utf8'),fields=value.slice(value.lastIndexOf(')')+2).trim().split(/\s+/);need(fields[0]==='Z'||fields[19]!==expected.startTicks,'operation_unconfirmed');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
}
export function assertActiveIncidentHostDelta(before,after){
 same(after.framework,before.framework);same(after.daemonPeer,before.daemonPeer);
 for(const key of ['processes','identityProofs'])same(after[key].filter(v=>v.name!=='merchant-space'),before[key].filter(v=>v.name!=='merchant-space'));
 return true;
}
// The report cannot authorize a mutation. An actuator must independently obtain
// reviewed source/CI and the kernel flock, then recollect these actual facts.
async function collectActiveBookingIncident({window,metadataCorrected}){
 const bounds=assertActiveBookingWindow(window);ownedReleasePath(ACTIVE_INCIDENT_ROOT,{directory:true,privateMode:true});
 same(names(),[...ACTIVE_INCIDENT_STATIC_NAMES,...ACTIVE_INCIDENT_FILES.map(p=>p[0])].sort());
 const files=pinnedFiles(),j=name=>read(ACTIVE_INCIDENT_ROOT+'/'+name),lease=j('watchdog-lease.json'),armed=j('watchdog-armed.json'),originalPause=j('legacy-restart-attempt.json'),activation=j('activation.json');
 assertBookingWatchdogArmedLease(armed,lease);assertGone(lease.parent);assertGone(armed.process);
 assertActiveBookingHistoricalEvidence({lease,activation,originalPause,recoveryAttempt:j('watchdog-recovery-attempt.json'),failure:j('controller-failure.json')});
 same(lease.deploy.file,DEPLOY);same(lease.operation.directory,OPERATION);
 same(lockFact(ownedReleasePath(DEPLOY,{privateMode:true})),lease.deploy.identity);
 same(lockFact(ownedReleasePath(OPERATION,{directory:true,privateMode:true})),lease.operation.identity);same(fs.readdirSync(OPERATION),[]);
 const before=originalPause.before,current=collectBookingLegacyHost();assertActiveIncidentHostDelta(before,current);
 const recordProof=inspectPinnedPm2RecordSequence('/root/.pm2/pm2.log',ACTIVE_BOOKING_PM2_RECORDS);
 const transition={beforeRaw:before.raw,afterRaw:current.raw,beforeConfigured:before.configured,afterConfigured:current.configured,legacyBefore:before.legacy,legacyAfter:current.legacy,beforePmUptime:before.pmUptime,afterPmUptime:current.pmUptime,beforePmDerived:before.pmDerived,afterPmDerived:current.pmDerived,framework:current.framework,window:lease.window,observedAt:new Date().toISOString()};
 const historicalPause=assertHistoricalPausedBookingHost(transition,recordProof,window);
 const database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));assertActiveBookingDatabase(database,ACTIVE_INCIDENT_DATABASE_IDENTITY);
 const plan=j('routing-plan.json'),gate=j('ingress-plan.json'),preflight=j('preflight.json');
 const originalStage=bookingHostRead(ACTIVE_INCIDENT_ROOT+'/primary-original-stage.json');
 need(sha256(originalStage)==='7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3','evidence_invalid');same(bookingHostRead(RELEASE+'/'+P.candidate+'/state.json'),originalStage);
 const rollbackState=bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/state.json');need(sha256(rollbackState)==='12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d','evidence_invalid');
 same(preflight.activeFileText,ACTIVE_BOOKING_METADATA.beforeText);same(plan.rollback,JSON.parse(ACTIVE_BOOKING_METADATA.afterText));
 const activeText=bookingHostRead(RELEASE+'/active.json');same(activeText,metadataCorrected?ACTIVE_BOOKING_METADATA.afterText:ACTIVE_BOOKING_METADATA.beforeText);
 const routing=()=>Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,bookingHostRead(WEB_RELEASE_PROXY+'/'+f,{privateMode:false})]));
 const verify=()=>{assertActiveBookingWindow(window);assertGone(lease.parent);assertGone(armed.process);same(pinnedFiles(),files);same(names(),[...ACTIVE_INCIDENT_STATIC_NAMES,...ACTIVE_INCIDENT_FILES.map(p=>p[0])].sort());same(lockFact(ownedReleasePath(DEPLOY,{privateMode:true})),lease.deploy.identity);same(lockFact(ownedReleasePath(OPERATION,{directory:true,privateMode:true})),lease.operation.identity);same(fs.readdirSync(OPERATION),[]);same(bookingHostRead(RELEASE+'/active.json'),activeText);same(bookingHostRead(RELEASE+'/'+P.candidate+'/state.json'),originalStage);same(bookingHostRead(RELEASE+'/'+P.compatibleRollback+'/state.json'),rollbackState);same(bookingHostRead(gate.file,{privateMode:false}),gate.beforeText);assertBookingRoutingCurrent(plan,routing(),{phase:'rollback'});};
 verify();const publicProof=await proveRecoveryTargets({origins:['https://faolla.com','https://launch.faolla.com'],target:P.compatibleRollback,operationId:window.id,verify,deadlineAtMs:Math.min(bounds.deadlineAtMs,Date.now()+30000)});
 const pilots=bookingHostRun('docker',['inspect','--format','{{json .State.Running}}',...BOOKING_FORMAL_PILOT_IDS]).trim().split('\n');need(pilots.length===5&&pilots.every(v=>v==='false'),'operation_unconfirmed');
 const after=collectBookingLegacyHost();same(after,current);same(JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql)),database);verify();
 const history=readOnlineRetentionHistory();need(history.headSha256===preflight.priorRetentionHeadSha256,'observation_mismatch');assertArchivedRecoveredBookingAttempt();
 return{kind:'active-booking-incident-current-observation',oldOperationId:P.operationId,window,files,deploy:lease.deploy,operation:lease.operation,oldControllerGone:true,oldSupervisorGone:true,database,historicalPause,recordProof,processesSha256:sha256(canonicalJson(current.processes)),identitiesSha256:sha256(canonicalJson(current.identityProofs)),legacyEnvironmentSha256:sha256(canonicalJson(current.raw)),retentionHeadSha256:history.headSha256,activeMetadataSha256:sha256(activeText),metadataCorrected,candidateStateSha256:sha256(originalStage),rollbackStateSha256:sha256(rollbackState),actualRoute:P.compatibleRollback,publicProof,mailEnabled:false,productionMutated:false,publicationAuthority:false,observedAt:new Date().toISOString()};
}
export const inspectActiveBookingIncident=({window})=>collectActiveBookingIncident({window,metadataCorrected:false});
// A separate fixed postcondition observer, not an allowPending/expected-path
// option on the original admission or an authorization to perform correction.
export const inspectActiveBookingIncidentAfterMetadata=({window})=>collectActiveBookingIncident({window,metadataCorrected:true});
