// Only the already-gated private booking worker changes source. No web restart.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_READY_BASE as BASE} from './booking-ready-policy.mjs';
import {assertBookingReadySource} from './booking-ready-tool.mjs';
import {collectBookingReadyOriginalCohort,bookingReadyRawProcesses,bookingReadyProcessFact,assertBookingReadyWorkerTransition,attestBookingReadyReplacement} from './booking-ready-runtime.mjs';
import {collectBookingLegacyHost,bookingLegacyRpcExpected} from './booking-handoff-legacy.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_PM2_PROVENANCE} from './booking-handoff-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {withOnlineRetentionLocks,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {verifyInactiveBookingSchema} from './booking-publication-database.mjs';
import {bookingHostRead as read,bookingHostWriteOnce as write} from './booking-handoff-host-io.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';
const ROOT='/var/lib/faolla-booking-handoff/'+C,WORKER='merchant-space-booking-atomic-'+C.slice(0,12),FILE=fileURLToPath(import.meta.url);
const need=(v,c)=>{if(!v)throw Error('booking_ready_worker_'+c);},hash=v=>createHash('sha256').update(v).digest('hex'),same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const raw=pid=>Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');need(i>0,'environment');return [v.slice(0,i),v.slice(i+1)];}));
function peer(pid){const f=bookingReadyProcessFact(pid),s=fs.statSync('/proc/'+pid+'/exe',{bigint:true});return {pid,uid:0,startTicks:f.startTicks,
 bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:f.executable,
 executableIdentity:['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':')};}
function absent(){for(const f of ['worker-enabled.json','watchdog-lease.json','preflight.json'])need(!fs.existsSync(ROOT+'/'+f),'gate_or_public_attempt');}
export function assertBookingReadyWorkerRawTransition(before,after,oldRow,newRow){
 same(newRow.env,oldRow.env,'configured_environment');
 const metadata={created_at:newRow.created_at,pm_uptime:newRow.pm_uptime,restart_time:newRow.restart_time,pm_exec_path:newRow.pm_exec_path,
 exit_code:newRow.exit_code,node_version:newRow.node_version,version:newRow.version,prev_restart_delay:newRow.prev_restart_delay};
 need(before.pm_exec_path===oldRow.pm_exec_path&&after.pm_exec_path===newRow.pm_exec_path,'raw_source');
 const expected={...before};for(const [key,value]of Object.entries(metadata)){
  if(value!==undefined&&value!==null&&(Object.hasOwn(before,key)||Object.hasOwn(after,key)))expected[key]=String(value);
 }
 same(after,expected,'raw_environment');need(!after.RESEND_API_KEY&&!after.BOOKING_CONFIRMATION_EMAIL_FROM,'mail');return true;
}
export async function executeBookingReadyWorkerReplacement(operations){
 const before=await operations.observe();await operations.admit(before);await operations.begin(before);
 same(await operations.observe(),before,'before_changed');const ack=await operations.restart(before);
 need(ack?.kind==='booking-ready-worker-rpc-ack'&&ack.schemaVersion===1&&ack.acknowledged===true&&ack.peerVerified===true&&ack.pm2Version==='6.0.14','ack');
 const after=await operations.settled();await operations.verify(before,after);return operations.complete(before,after);
}
export async function replaceBookingReadyWorker({lock,toolRevision}){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.version===BOOKING_HANDOFF_PM2_PROVENANCE.nodeVersion,'linux_runtime');
 need(path.dirname(path.dirname(FILE))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');assertOnlineRetentionHeldLocks(lock);assertBookingReadySource(toolRevision);absent();
 const initial=collectBookingReadyOriginalCohort(),legacy=collectBookingLegacyHost(),database=await verifyInactiveBookingSchema({rootDir:initial.active.directory});
 need(database.registry.length===211&&database.savedBookingRowsSha256==='76bac52f5b3dfc990709a34d89d828a6b77d0479001f6cd5d55128ae077dbe4b','inactive_database');
 need(hash(fs.readFileSync('/usr/lib/node_modules/pm2/lib/Utility.js'))==='97dc35e42a3ca1fdb4d79829346e8dbc693f1b180a764c99f202abc3328f3129','pm2_utility');
 const observe=()=>{assertOnlineRetentionHeldLocks(lock);absent();const list=bookingReadyRawProcesses(),target=list.find(p=>p.name===WORKER);need(target,'worker');need(target.pid>0&&target.pm2_env.status==='online','process_not_ready');
  return {process:normalizeRetirementProcess(target),raw:raw(target.pid),configured:target.pm2_env,identity:{name:WORKER,...bookingReadyProcessFact(target.pid)},
   legacy:collectBookingLegacyHost(),peer:peer(target.pid),rpcExpected:bookingLegacyRpcExpected({...target,pm2_env:{...target.pm2_env,args:target.pm2_env.args??[],node_args:target.pm2_env.node_args??[]}})};};
 let attemptText;
 return executeBookingReadyWorkerReplacement({observe,
  admit:before=>{same(before.process,initial.processes.find(p=>p.name===WORKER),'original_worker');same(before.legacy,legacy,'legacy_changed');
   for(const f of ['ready-worker-attempt.json','ready-worker-completed.json'])try{fs.lstatSync(ROOT+'/'+f);need(false,'existing_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}},
  begin:before=>{absent();attemptText=retentionCanonicalText({schemaVersion:1,kind:'booking-ready-worker-replacement-attempt',priorTool:BASE,toolRevision,before:before.process,
   originalObservation:before,database,startedAt:new Date().toISOString()});write(ROOT+'/ready-worker-attempt.json',attemptText);},
  restart:before=>{
   assertOnlineRetentionHeldLocks(lock);absent();const python=captureTrustedPython(),helper=fileURLToPath(new URL('./booking-ready-pm2-replace.py',import.meta.url)),bytes=fs.readFileSync(helper);verifyTrustedPython(python);
   const r=spawnSync(python.target.path,['-I','-S','-B',helper],{cwd:'/',input:JSON.stringify({daemon:before.legacy.daemonPeer,process:before.peer,expected:before.rpcExpected,revision:toolRevision}),
    encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:262144,windowsHide:true,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
   verifyTrustedPython(python);same(fs.readFileSync(helper),bytes,'helper_changed');need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','restart_outcome_unknown');return JSON.parse(r.stdout);
  },
  settled:async()=>{const deadline=process.hrtime.bigint()+10000000000n;for(let i=0;i<100&&process.hrtime.bigint()<deadline;i++){
   assertOnlineRetentionHeldLocks(lock);absent();try{const value=observe();if(value.process.pid!==830152&&value.process.restartCount===1)return value;}
   catch(e){if(!['ENOENT','ESRCH'].includes(e.code)&&e.message!=='booking_ready_worker_process_not_ready')throw e;}
   await new Promise(r=>setTimeout(r,100));}need(false,'not_settled');},
  verify:async(before,after)=>{
   assertBookingReadyWorkerTransition(before.process,after.process,toolRevision);assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);
   same(after.legacy.processes.filter(p=>p.name!==WORKER),before.legacy.processes.filter(p=>p.name!==WORKER),'protected_processes');
   same(after.legacy.identityProofs.filter(p=>p.name!==WORKER),before.legacy.identityProofs.filter(p=>p.name!==WORKER),'protected_os');
   same(after.legacy.daemonPeer,before.legacy.daemonPeer,'daemon_changed');same(after.legacy.raw,before.legacy.raw,'legacy_environment');
   same(await verifyInactiveBookingSchema({rootDir:initial.active.directory}),database,'database_changed');absent();
  },
  complete:(before,after)=>{
   same(read(ROOT+'/ready-worker-attempt.json'),attemptText,'attempt_changed');absent();
   const receipt={schemaVersion:1,kind:'booking-ready-worker-replacement',priorTool:BASE,toolRevision,before:before.process,after:after.process,identity:after.identity,
    attemptSha256:hash(attemptText),gateNeverOpened:true,mailEnabled:false,completedAt:new Date().toISOString()};
   attestBookingReadyReplacement(receipt,toolRevision);write(ROOT+'/ready-worker-completed.json',retentionCanonicalText(receipt));
   return {kind:receipt.kind,workerPid:after.process.pid,webProcessesChanged:false,mailEnabled:false,gateOpen:false};
  },
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const directory=path.dirname(path.dirname(FILE)),toolRevision=path.basename(directory);
 if(process.argv.length!==2||process.cwd()!==directory)throw Error('booking_ready_worker_arguments');
 withOnlineRetentionLocks(async lock=>replaceBookingReadyWorker({lock,toolRevision})).then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error('booking_ready_worker_unconfirmed_evidence_preserved');process.exitCode=1;});
}
