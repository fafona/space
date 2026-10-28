// Generic tool-version adoption for ONE gated private worker, under the normal
// release kernel/retention locks. No web restart, DB write, enable or retry.
import * as fs from 'node:fs';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {assertExecutionWorkerReceipt} from './release-toolchain-worker-contract.mjs';
import {collectBookingReadyRuntimeCohort,bookingReadyRawProcesses,bookingReadyProcessFact} from './booking-ready-runtime.mjs';
import {bookingReadyWorkerConfiguration,assertBookingReadyWorkerRawTransition,executeBookingReadyWorkerReplacement} from './booking-ready-worker.mjs';
import {collectBookingLegacyHost,bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {verifyInactiveBookingSchema} from './booking-publication-database.mjs';
import {bookingHostRead,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
const ROOT='/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa',NAME='merchant-space-booking-atomic-f274ad615550';
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch'),read=file=>JSON.parse(bookingHostRead(file)),seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n');
const absent=()=>{for(const name of ['worker-enabled.json','watchdog-lease.json','preflight.json'])need(!fs.existsSync(ROOT+'/'+name),'attempt_unknown');};
function raw(pid){return Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');need(i>0,'evidence_invalid');return [v.slice(0,i),v.slice(i+1)];}));}
function peer(pid){const f=bookingReadyProcessFact(pid),s=fs.statSync('/proc/'+pid+'/exe',{bigint:true});return {pid,uid:0,startTicks:f.startTicks,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:f.executable,executableIdentity:['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':')};}
export async function prepareExecutionWorker({lock,toolRevision}){
 const authority=reviewedBookingExecution(toolRevision);need(authority,'source_changed');assertOnlineRetentionHeldLocks(lock);absent();
 const initial=collectBookingReadyRuntimeCohort({toolRevision}),original=initial.processes.find(p=>p.name===NAME),priorRevision=/^\/var\/lib\/faolla-online-code\/([a-f0-9]{40})\/scripts\/booking-atomic-worker\.mjs$/.exec(original?.executable??'')?.[1];
 need(priorRevision,'source_changed');if(priorRevision===toolRevision)return {kind:'release-toolchain-private-worker-already-prepared',toolRevision,workerPid:original.pid,gateOpen:false};
 const prior=read(priorRevision===authority.preparationRevision?ROOT+'/ready-worker-completed.json':ROOT+'/toolchain-runtime/'+priorRevision+'/worker-completed.json');same(prior.after,original);
 const database=await verifyInactiveBookingSchema({rootDir:initial.active.directory});need(database.savedBookingRowsSha256==='76bac52f5b3dfc990709a34d89d828a6b77d0479001f6cd5d55128ae077dbe4b','database_identity_mismatch');
 const parent=ROOT+'/toolchain-runtime';if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700});ownedReleasePath(parent,{directory:true,privateMode:true});
 const directory=parent+'/'+toolRevision;fs.mkdirSync(directory,{mode:0o700});let attempt;
 const observe=()=>{assertOnlineRetentionHeldLocks(lock);reviewedBookingExecution(toolRevision);absent();const row=bookingReadyRawProcesses().find(p=>p.name===NAME);need(row?.pid>0&&row.pm2_env.status==='online','operation_unconfirmed');
  return {process:normalizeRetirementProcess(row),raw:raw(row.pid),configured:bookingReadyWorkerConfiguration(row.pm2_env),identity:{name:NAME,...bookingReadyProcessFact(row.pid)},
   legacy:collectBookingLegacyHost(),peer:peer(row.pid),rpcExpected:bookingLegacyRpcExpected({...row,pm2_env:{...row.pm2_env,args:row.pm2_env.args??[],node_args:row.pm2_env.node_args??[]}})};};
 return executeBookingReadyWorkerReplacement({observe,admit:before=>same(before.process,original),
  begin:before=>{attempt={schemaVersion:1,kind:'release-toolchain-private-worker-attempt',priorRevision,toolRevision,before:before.process,originalObservation:before,database,startedAt:new Date().toISOString()};seal(directory+'/worker-attempt.json',attempt);},
  restart:before=>{assertOnlineRetentionHeldLocks(lock);reviewedBookingExecution(toolRevision);absent();same(read(directory+'/worker-attempt.json'),attempt);
   const python=captureTrustedPython(),helper=fileURLToPath(new URL('./release-toolchain-pm2-worker.py',import.meta.url));verifyTrustedPython(python);
   const r=spawnSync(python.target.path,['-I','-S','-B',helper],{cwd:'/',input:canonicalJson({daemon:before.legacy.daemonPeer,process:before.peer,expected:before.rpcExpected,revision:toolRevision,attemptSha256:sha256(canonicalJson(attempt)+'\n')}),encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:262144,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
   verifyTrustedPython(python);reviewedBookingExecution(toolRevision);need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','attempt_unknown');return JSON.parse(r.stdout);},
  settled:async()=>{for(let i=0;i<100;i++){try{const after=observe();if(after.process.pid!==original.pid&&after.process.restartCount===original.restartCount+1)return after;}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}await new Promise(r=>setTimeout(r,100));}need(false,'attempt_unknown');},
  verify:async(before,after)=>{
   assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);
   const expected={...before.configured};for(const key of ['created_at','pm_uptime','restart_time','pm_exec_path','exit_code','node_version','version','prev_restart_delay','unstable_restarts'])if(Object.hasOwn(after.configured,key))expected[key]=after.configured[key];same(after.configured,expected);
   same(after.legacy.processes.filter(p=>p.name!==NAME),before.legacy.processes.filter(p=>p.name!==NAME));same(after.legacy.identityProofs.filter(p=>p.name!==NAME),before.legacy.identityProofs.filter(p=>p.name!==NAME));
   same(after.legacy.daemonPeer,before.legacy.daemonPeer);same(after.legacy.raw,before.legacy.raw);same(await verifyInactiveBookingSchema({rootDir:initial.active.directory}),database);absent();
  },complete:(before,after)=>{const receipt={schemaVersion:1,kind:'release-toolchain-private-worker-replacement',priorRevision,toolRevision,before:before.process,after:after.process,identity:after.identity,attemptSha256:sha256(canonicalJson(attempt)+'\n'),gateNeverOpened:true,mailEnabled:false,completedAt:new Date().toISOString()};
   assertExecutionWorkerReceipt(receipt,attempt,{revision:toolRevision,prior});seal(directory+'/worker-completed.json',receipt);collectBookingReadyRuntimeCohort({toolRevision});return {kind:receipt.kind,toolRevision,workerPid:after.process.pid,webProcessesChanged:false,productionDatabaseChanged:false,gateOpen:false,mailEnabled:false};},
 });
}
