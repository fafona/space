// One approved, proven pre-activation failure only. No reset, replay, caller
// path, restore, SQL mutation, process signal or removal is exposed.
import * as fs from 'node:fs';
import {RECOVERED_BOOKING_ATTEMPT as P,RECOVERED_BOOKING_STATIC_NAMES} from './release-toolchain-recovered-contract.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ownedReleasePath,inspectPinnedExecutionSource} from './release-toolchain-source.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {captureToolchainProductionSnapshot} from './release-toolchain-full-rehearsal.mjs';
import {bookingHostSql,bookingHostRun,bookingHostWriteOnce,bookingHostSync} from './booking-handoff-host-io.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {assertBookingWatchdogArmedLease} from './booking-handoff-watchdog.mjs';
import {BOOKING_FORMAL_PILOT_IDS} from './booking-formal-backup-policy.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+C,ARCHIVE=ROOT+'/recovered-attempts/'+P.operationId;
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
const identity=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
function bytes(file){
 ownedReleasePath(file,{privateMode:true});const before=fs.lstatSync(file);need(before.size<=1024**2,'evidence_invalid');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{same(identity(fs.fstatSync(fd)),identity(before));const b=fs.readFileSync(fd);same(identity(fs.fstatSync(fd)),identity(before));same(identity(fs.lstatSync(file)),identity(before));need(b.length===before.size,'evidence_invalid');return b;}finally{fs.closeSync(fd);}
}
const json=file=>JSON.parse(bytes(file).toString('utf8'));
const seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
function attest(file,pin){const b=bytes(file);need(b.length===pin[1]&&sha256(b)===pin[2],'evidence_invalid');return identity(fs.lstatSync(file));}
function noLiveProcess(expected){try{const s=fs.readFileSync('/proc/'+expected.pid+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);need(f[19]!==expected.startTicks||f[0]==='Z','attempt_unknown');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}
async function unchangedFormalHost(){
 const snapshot=captureToolchainProductionSnapshot(),database=JSON.parse(bookingHostSql(bookingHandoffActivationSnapshotSql));
 need(sha256(canonicalJson(snapshot))===P.protectedSnapshotSha256&&sha256(canonicalJson(database))===P.databaseSha256,'observation_mismatch');
 need(readOnlineRetentionHistory().headSha256===P.retentionHead,'observation_mismatch');
 const pilots=bookingHostRun('docker',['inspect','--format','{{json .State.Running}}',...BOOKING_FORMAL_PILOT_IDS]).trim().split('\n');need(pilots.length===5&&pilots.every(v=>v==='false'),'attempt_unknown');
 for(const origin of ['https://faolla.com','https://launch.faolla.com']){const r=await fetch(origin+'/api/app-web-version?recoveredAttempt='+P.operationId,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(5000)}),v=await r.json();need(r.status===200&&v.ok===true&&v.buildId===B,'observation_mismatch');}
 return {protectedSnapshotSha256:P.protectedSnapshotSha256,databaseSha256:P.databaseSha256,retentionHead:P.retentionHead};
}
export function assertRecoveredBookingProof({lease,armed,failure,finished,recovery,gate}){
 need(lease.toolRevision===P.priorTool&&lease.window.id===P.operationId&&failure.operationId===P.operationId&&finished.operationId===P.operationId&&recovery.operationId===P.operationId&&gate.window.id===P.operationId,'evidence_invalid');
 assertBookingWatchdogArmedLease(armed,lease);
 need(failure.errorSha256===sha256('booking_host_watchdog_not_armed')&&finished.outcome==='recovered-failure'&&finished.recovery?.operationId===P.operationId,'evidence_invalid');
 same(finished.recovery,recovery);
 need(recovery.phase==='baseline'&&recovery.target===B&&recovery.gateClosed===true&&recovery.normalHandoffCompleted===false&&recovery.withinAuthorizedWindow===true&&
  recovery.database.activationAttempted===false&&recovery.database.activationCommitted===false&&recovery.database.active===false&&recovery.legacyPause.attempted===false,'evidence_invalid');return true;
}
export async function inspectRecoveredBookingAttempt(){
 ownedReleasePath(ROOT,{directory:true,privateMode:true});
 same(fs.readdirSync(ROOT).sort(),[...RECOVERED_BOOKING_STATIC_NAMES,...P.files.map(p=>p[0])].sort());
 const files=Object.fromEntries(P.files.map(pin=>[pin[0],attest(ROOT+'/'+pin[0],pin)]));
 const proof={lease:json(ROOT+'/watchdog-lease.json'),armed:json(ROOT+'/watchdog-armed.json'),failure:json(ROOT+'/controller-failure.json'),finished:json(ROOT+'/watchdog-finished.json'),recovery:json(ROOT+'/watchdog-recovery.json'),gate:json(ROOT+'/ingress-plan.json')};
 assertRecoveredBookingProof(proof);noLiveProcess(proof.lease.parent);noLiveProcess(proof.armed.process);
 const baseline=await unchangedFormalHost();return {files,baseline,operationId:P.operationId,profileSha256:sha256(canonicalJson(P))};
}
// Pure sequencing contract: uncertain moves are terminal, never retried.
export async function executeRecoveredBookingArchive(operations){
 const before=await operations.inspect();await operations.begin(before);
 for(let index=0;index<P.files.length;index++)await operations.move(index,P.files[index],before);
 await operations.verify(before);return operations.complete(before);
}
export async function archiveRecoveredBookingAttempt({lock,toolRevision,qualificationSha256}){
 assertOnlineRetentionHeldLocks(lock);const authority=reviewedBookingExecution(toolRevision);need(authority&&/^[a-f0-9]{64}$/.test(qualificationSha256),'evidence_invalid');
 const profileSha256=sha256(canonicalJson(P));let started;
 const held=()=>{assertOnlineRetentionHeldLocks(lock);need(reviewedBookingExecution(toolRevision)===authority,'source_changed');};
 return executeRecoveredBookingArchive({
  inspect:async()=>{held();return inspectRecoveredBookingAttempt();},
  begin:before=>{held();const parent=ROOT+'/recovered-attempts';fs.mkdirSync(parent,{mode:0o700});bookingHostSync(ROOT);fs.mkdirSync(ARCHIVE,{mode:0o700});bookingHostSync(parent);
   started={kind:'booking-recovered-attempt-archive-started',operationId:P.operationId,priorTool:P.priorTool,toolRevision,toolInventorySha256:authority.tool.inventorySha256,qualificationSha256,profileSha256,before,startedAt:new Date().toISOString()};seal(ARCHIVE+'/started.json',started);},
  move:(index,pin,before)=>{held();const source=ROOT+'/'+pin[0],destination=ARCHIVE+'/'+pin[0];same(attest(source,pin),before.files[pin[0]]);need(!fs.existsSync(destination),'attempt_unknown');
   // Exact source/destination paths are all fixed above, never a glob/root move.
   fs.renameSync(source,destination);bookingHostSync(ROOT);bookingHostSync(ARCHIVE);const after=attest(destination,pin);need(!fs.existsSync(source),'attempt_unknown');
   seal(ARCHIVE+'/move-'+String(index+1).padStart(2,'0')+'.json',{kind:'booking-recovered-evidence-moved',index,name:pin[0],bytes:pin[1],sha256:pin[2],before:before.files[pin[0]],after});},
  verify:async before=>{held();same(fs.readdirSync(ROOT).sort(),[...RECOVERED_BOOKING_STATIC_NAMES,'recovered-attempts'].sort());for(const pin of P.files)attest(ARCHIVE+'/'+pin[0],pin);same(await unchangedFormalHost(),before.baseline);},
  complete:()=>{held();const receipt={kind:'booking-recovered-attempt-archive-completed',operationId:P.operationId,priorTool:P.priorTool,toolRevision,toolInventorySha256:authority.tool.inventorySha256,qualificationSha256,profileSha256,startedSha256:sha256(bytes(ARCHIVE+'/started.json')),files:P.files.length,protectedSnapshotSha256:P.protectedSnapshotSha256,databaseSha256:P.databaseSha256,applicationPublished:false,productionDatabaseMutated:false,trafficChanged:false,mailEnabled:false,completedAt:new Date().toISOString()};
   seal(ARCHIVE+'/completed.json',receipt);assertArchivedRecoveredBookingAttempt();return {kind:receipt.kind,archive:ARCHIVE,operationId:P.operationId,toolRevision,files:receipt.files,productionMutated:false,mailEnabled:false};}
 });
}
export function assertArchivedRecoveredBookingAttempt(){
 ownedReleasePath(ARCHIVE,{directory:true,privateMode:true});const started=json(ARCHIVE+'/started.json'),completed=json(ARCHIVE+'/completed.json');
 need(started.kind==='booking-recovered-attempt-archive-started'&&completed.kind==='booking-recovered-attempt-archive-completed'&&completed.operationId===P.operationId&&started.operationId===P.operationId&&
  started.priorTool===P.priorTool&&completed.priorTool===P.priorTool&&started.toolRevision===completed.toolRevision&&completed.toolRevision!==P.priorTool&&
  completed.profileSha256===sha256(canonicalJson(P))&&started.profileSha256===completed.profileSha256&&completed.startedSha256===sha256(bytes(ARCHIVE+'/started.json'))&&completed.files===P.files.length&&
  completed.qualificationSha256===started.qualificationSha256&&/^[a-f0-9]{64}$/.test(completed.qualificationSha256)&&completed.protectedSnapshotSha256===P.protectedSnapshotSha256&&completed.databaseSha256===P.databaseSha256&&started.before.profileSha256===completed.profileSha256&&
  completed.applicationPublished===false&&completed.productionDatabaseMutated===false&&completed.trafficChanged===false&&completed.mailEnabled===false,'evidence_invalid');
 const tool=inspectPinnedExecutionSource({revision:completed.toolRevision,directory:'/var/lib/faolla-online-code/'+completed.toolRevision});need(tool.inventorySha256===completed.toolInventorySha256&&started.toolInventorySha256===completed.toolInventorySha256,'source_changed');
 same(fs.readdirSync(ARCHIVE).sort(),['started.json','completed.json',...P.files.map(p=>p[0]),...P.files.map((_,i)=>'move-'+String(i+1).padStart(2,'0')+'.json')].sort());
 for(const [i,pin]of P.files.entries()){attest(ARCHIVE+'/'+pin[0],pin);const moved=json(ARCHIVE+'/move-'+String(i+1).padStart(2,'0')+'.json');need(moved.kind==='booking-recovered-evidence-moved'&&moved.index===i&&moved.name===pin[0]&&moved.bytes===pin[1]&&moved.sha256===pin[2],'evidence_invalid');same(moved.before,started.before.files[pin[0]]);const actual=identity(fs.lstatSync(ARCHIVE+'/'+pin[0]));same(actual,moved.after);}
 assertRecoveredBookingProof({lease:json(ARCHIVE+'/watchdog-lease.json'),armed:json(ARCHIVE+'/watchdog-armed.json'),failure:json(ARCHIVE+'/controller-failure.json'),finished:json(ARCHIVE+'/watchdog-finished.json'),recovery:json(ARCHIVE+'/watchdog-recovery.json'),gate:json(ARCHIVE+'/ingress-plan.json')});return completed;
}
