// Reattest the already-running, exactly sealed private cohort. Never relaunch a web.
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_READY_BASE as BASE} from './booking-ready-policy.mjs';
import {assertBookingReadySource} from './booking-ready-tool.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_APPLICATION as A,assertBookingAtomicCohort} from './booking-handoff-policy.mjs';
import {assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readBookingFormalFile as read} from './booking-formal-backup-tool.mjs';
import {spawnSync} from 'node:child_process';
const ROOT='/var/lib/faolla-booking-handoff/'+C,OP='/var/lib/faolla-online-release',WORKER='merchant-space-booking-atomic-'+C.slice(0,12);
const need=(v,c)=>{if(!v)throw Error('booking_ready_runtime_'+c);},hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
export function bookingReadyProcessFact(pid){
 need(Number.isSafeInteger(pid)&&pid>0,'pid');const p='/proc/'+pid,s=fs.readFileSync(p+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);
 need(fs.lstatSync(p).uid===0&&/^\d+$/.test(f[19]??'')&&f[0]!=='Z','process');
 return {pid,parentPid:Number(f[1]),startTicks:f[19],cwd:fs.realpathSync(p+'/cwd'),executable:fs.realpathSync(p+'/exe'),
 commandSha256:hash(fs.readFileSync(p+'/cmdline')),environmentSha256:hash(fs.readFileSync(p+'/environ'))};
}
export function bookingReadyRawProcesses(){
 need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertExistingPm2Directory();
 const pid=Number(read('/root/.pm2/pm2.pid',{privateMode:false}).toString().trim()),before=bookingReadyProcessFact(pid);
 need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');
 const r=spawnSync('/usr/bin/node',['/usr/lib/node_modules/pm2/bin/pm2','jlist'],{encoding:'utf8',timeout:15000,maxBuffer:32*1024**2,
 env:{PATH:'/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8'}});
 need(r.status===0&&!r.error&&!r.signal,'pm2_read');same(bookingReadyProcessFact(pid),before,'daemon_changed');return JSON.parse(r.stdout);
}
const runtime=pid=>webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+pid+'/environ','utf8'));
export function assertBookingReadyWorkerTransition(before,after,revision){
 need(before?.name===WORKER&&before.pmId===27&&before.pid===830152&&before.restartCount===0&&
 before.executable==='/var/lib/faolla-online-code/'+BASE+'/scripts/booking-atomic-worker.mjs','old_worker');
 need(/^[a-f0-9]{40}$/.test(revision??'')&&revision!==BASE&&after?.pid>0&&after.pid!==before.pid&&after.restartCount===1&&
 after.createdAt>before.createdAt&&after.executable==='/var/lib/faolla-online-code/'+revision+'/scripts/booking-atomic-worker.mjs','new_worker');
 const fixed=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['pid','restartCount','createdAt','executable'].includes(k)));
 same(fixed(after),fixed(before),'worker_configuration_changed');return true;
}
function collect(workerContinuation){
 const raw=bookingReadyRawProcesses(),rows=raw.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId),ready=JSON.parse(read(ROOT+'/runtime-ready.json')),
 attempt=JSON.parse(read(ROOT+'/runtime-attempt.json'));
 need(attempt.plan?.toolRevision===BASE&&hash(retentionCanonicalText(attempt.plan))===ready.planSha256,'original_plan');
 need(rows.length===ready.after.processes.length,'process_count');
 for(const old of ready.after.processes.filter(p=>p.name!=='merchant-space')){
  const actual=rows.find(p=>p.name===old.name);
  if(old.name===WORKER&&workerContinuation){assertBookingReadyWorkerTransition(old,actual,workerContinuation.toolRevision);same(actual,workerContinuation.after,'worker_receipt');}
  else same(actual,old,'protected_process_changed');
 }
 for(const old of ready.after.identityProofs.filter(p=>p.name!=='merchant-space')){
  const expected=old.name===WORKER&&workerContinuation?workerContinuation.identity:old;
  same({name:expected.name,...bookingReadyProcessFact(expected.pid)},expected,'protected_os_changed');
 }
 const anchors={},runtimeByName={};for(const target of [C,A]){
  const state=JSON.parse(read(OP+'/'+target+'/state.json'));
  anchors[target]={...Object.fromEntries(['target','name','directory','port'].map(k=>[k,state[k]])),process:rows.find(p=>p.name===state.name)};
  const saved=JSON.parse(read(OP+'/'+target+'/atomic-runtime.json')),actual=runtime(anchors[target].process.pid);
  same(saved,attempt.plan.runtimeByName[state.name],'saved_web_runtime');for(const [k,v]of Object.entries(saved))need(actual[k]===v,'actual_web_runtime');runtimeByName[state.name]=actual;
 }
 assertBookingAtomicCohort({active:anchors[C],rollback:anchors[A],runtimeByName});
 const worker=rows.find(p=>p.name===WORKER),saved=JSON.parse(read(ROOT+'/worker-runtime.json')),actual=runtime(worker.pid);
 same(saved,attempt.plan.worker.runtime,'saved_worker_runtime');assertBookingAtomicWorkerEnvironment(actual);for(const [k,v]of Object.entries(saved))need(actual[k]===v,'actual_worker_runtime');
 return {active:anchors[C],rollback:anchors[A],runtimeByName,processes:rows};
}
export function collectBookingReadyOriginalCohort(){
 need(!fs.existsSync(ROOT+'/worker-enabled.json')&&!fs.existsSync(ROOT+'/watchdog-lease.json')&&!fs.existsSync(ROOT+'/preflight.json'),'existing_public_attempt');
 return collect(null);
}
export function collectBookingReadyRuntimeCohort({toolRevision}){
 const text=read(ROOT+'/ready-worker-completed.json').toString(),receipt=JSON.parse(text);
 need(text===retentionCanonicalText(receipt),'receipt_encoding');return attestBookingReadyReplacement(receipt,toolRevision);
}
export function attestBookingReadyReplacement(receipt,toolRevision){
 assertBookingReadySource(toolRevision);
 same(Object.keys(receipt).sort(),['schemaVersion','kind','priorTool','toolRevision','before','after','identity','attemptSha256','gateNeverOpened','mailEnabled','completedAt'].sort(),'receipt_shape');
 const attempt=JSON.parse(read(ROOT+'/ready-worker-attempt.json'));
 need(attempt.toolRevision===toolRevision&&attempt.priorTool===BASE,'attempt_identity');
 same(attempt.before,receipt.before,'attempt_before');assertBookingReadyWorkerTransition(receipt.before,receipt.after,toolRevision);
 need(receipt.identity?.name===WORKER&&receipt.identity.pid===receipt.after.pid&&Number.isFinite(Date.parse(receipt.completedAt)),'worker_identity_binding');
 need(receipt.schemaVersion===1&&receipt.kind==='booking-ready-worker-replacement'&&receipt.priorTool===BASE&&
 receipt.toolRevision===toolRevision&&receipt.gateNeverOpened===true&&receipt.mailEnabled===false&&
 receipt.attemptSha256===hash(read(ROOT+'/ready-worker-attempt.json')),'worker_continuation');
 return collect(receipt);
}
export function verifyBookingReadyRuntimeCohort(options){assertOnlineRetentionHeldLocks(options.lock);return collectBookingReadyRuntimeCohort(options);}
