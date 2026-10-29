// Independent, bounded supervisor. Its inherited OFD keeps the normal deploy
// flock held if the controller/SSH session dies. It may terminate ONLY its own
// provenance-bound controller, never a web/DB/enterprise/background process.
import * as fs from 'node:fs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,assertBookingHandoffWindow} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT,collectBookingAtomicRuntimeCohort} from './booking-handoff-runtime.mjs';
import {assertBookingAtomicRoutingPlan} from './booking-handoff-routing.mjs';
import {bookingIngressRestorationText,BOOKING_INGRESS_VHOST,BOOKING_INGRESS_MAIN_SHA256} from './booking-handoff-ingress.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,readOnlineToolInventory,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {retentionCanonicalText,retentionHash} from './online-release-retention-policy.mjs';
import {assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {recoveryChildExitEvidence} from './release-toolchain-recovery-diagnostics.mjs';

export const BOOKING_WATCHDOG_TRIGGER_MS=420000;
const APP='/www/wwwroot/merchant-space',DEPLOY=APP+'.deploy.lock',OPERATION='/var/lib/faolla-maintenance/merchant-space/operation.lock';
const need=(v,c)=>{if(!v)throw Error('booking_watchdog_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c),hash=v=>createHash('sha256').update(v).digest('hex');
const env=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
const metadata=s=>Object.fromEntries(['dev','ino','uid','mode','nlink'].map(k=>[k,s[k]]));
const handles=new WeakMap();
function read(file){
  assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);need((s.mode&0o777)===0o600&&s.size>0&&s.size<=32*1024**2,'file');
  const identity=s=>Object.fromEntries(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{equal(identity(fs.fstatSync(fd)),identity(s),'file_replaced');const b=fs.readFileSync(fd);equal(identity(fs.fstatSync(fd)),identity(s),'file_changed');equal(identity(fs.lstatSync(file)),identity(s),'file_replaced');need(b.length===s.size,'file_changed');return b.toString('utf8');}finally{fs.closeSync(fd);}
}
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,text){
  assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_directory');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));equal(read(file),text,'write_readback');
}
function fact(pid){
  need(Number.isSafeInteger(pid)&&pid>0,'pid');const root='/proc/'+pid,text=fs.readFileSync(root+'/stat','utf8'),end=text.lastIndexOf(')'),f=text.slice(end+2).trim().split(/\s+/);
  need(end>0&&/^\d+$/.test(f[19]??'')&&fs.lstatSync(root).uid===0,'process');
  // A zombie owns no descriptors and can never resume the controller.
  if(f[0]==='Z')return {pid,zombie:true,startTicks:f[19]};
  return {pid,uid:0,startTicks:f[19],executable:fs.realpathSync(root+'/exe'),cwd:fs.realpathSync(root+'/cwd'),commandSha256:hash(fs.readFileSync(root+'/cmdline'))};
}
const command=pid=>fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').filter(Boolean);
function parentState(expected){try{const current=fact(expected.pid);return current.zombie?'absent':isDeepStrictEqual(current,expected)?'owned':'reused';}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return 'absent';throw error;}}
function run(bin,args,options={}){const r=spawnSync(bin,args,{env:env(),encoding:'utf8',timeout:10000,maxBuffer:32*1024**2,windowsHide:true,...options});need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;}
function sourceIdentity(toolRevision,{initial=false}={}){
  const directory='/var/lib/faolla-online-code/'+toolRevision;
  need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))===directory,'source_path');
  if(initial){const adopted=reviewedBookingExecution(toolRevision);if(adopted)return adopted.tool;return verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));}
  // Long-lived recovery pins immutable source, not a moving origin/main ref.
  need(runOnlineToolGit(directory,['rev-parse','HEAD']).toString().trim()===toolRevision&&
    !runOnlineToolGit(directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source_changed');
  for(const item of readOnlineToolInventory(createOnlineReleaseToolPlan(toolRevision))){
    if(item.excluded)continue;const file=directory+'/'+item.name;assertOnlineToolOwnedPath(file,'file');const b=fs.readFileSync(file);
    need(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')===item.oid,'source_bytes_changed');
  }
}
export function assertBookingWatchdogLease(lease){
  equal(Object.keys(lease??{}).sort(),['schemaVersion','kind','candidate','toolRevision','window','parent','deploy','operation','routingPlanSha256','gatePlanSha256'].sort(),'lease_shape');
  equal(Object.keys(lease.parent??{}).sort(),['pid','uid','startTicks','executable','cwd','commandSha256'].sort(),'lease_parent_shape');
  need(/^[1-9][0-9]*$/.test(lease.parent.startTicks??'')&&/^[a-f0-9]{64}$/.test(lease.parent.commandSha256??''),'lease_parent');
  for(const [key,first,type,mode]of [['deploy','file',0o100000,0o600],['operation','directory',0o40000,0o700]]){
    equal(Object.keys(lease[key]??{}).sort(),[first,'identity'].sort(),'lease_lock_shape');
    const id=lease[key].identity;equal(Object.keys(id??{}).sort(),['dev','ino','uid','mode','nlink'].sort(),'lease_lock_identity');
    need(['dev','ino','uid','mode','nlink'].every(k=>Number.isSafeInteger(id[k]))&&id.dev>=0&&id.ino>0&&id.uid===0&&
      (id.mode&0o170000)===type&&(id.mode&0o7777)===mode&&id.nlink===(key==='deploy'?1:2),'lease_lock_identity');
  }
  need(lease?.schemaVersion===1&&lease.kind==='booking-handoff-independent-watchdog'&&lease.candidate===CANDIDATE&&
    /^[a-f0-9]{40}$/.test(lease.toolRevision??'')&&lease.deploy.file===DEPLOY&&lease.operation.directory===OPERATION&&
    Number.isSafeInteger(lease.parent.pid)&&lease.parent.pid>1&&lease.parent.uid===0&&lease.parent.executable==='/usr/bin/node'&&
    lease.parent.cwd==='/var/lib/faolla-online-code/'+lease.toolRevision&&
    ['routingPlanSha256','gatePlanSha256'].every(k=>/^[a-f0-9]{64}$/.test(lease[k]??'')),'lease');
  const bounds=assertBookingHandoffWindow(lease.window);need(bounds.deadlineAtMs-bounds.startedAtMs===600000,'lease_window');return true;
}

// This receipt seals FILE BYTES, including the canonical trailing newline.
// Keep its producer and both production consumers on the same representation.
export function bookingWatchdogLeaseDigest(lease){assertBookingWatchdogLease(lease);return hash(retentionCanonicalText(lease));}
export function assertBookingWatchdogArmedLease(armed,lease){
  equal(Object.keys(armed??{}).sort(),['schemaVersion','leaseSha256','process','at'].sort(),'arming_shape');
  need(armed.schemaVersion===1&&armed.leaseSha256===bookingWatchdogLeaseDigest(lease),'arming_receipt');
  const at=Date.parse(armed.at);need(Number.isFinite(at)&&new Date(at).toISOString()===armed.at&&at>=Date.parse(lease.window.startedAt)&&at<=Date.parse(lease.window.deadlineAt),'arming_time');return true;
}

/** Actual process/FD tests can exercise this same supervisor with isolated
 * operations. No user-facing timing override or generic target is accepted. */
export async function runBookingWatchdogLoop(operations,lease){
  assertBookingWatchdogLease(lease);return runBookingWatchdogSequence(operations);
}
// Shared sequence for the separately ownership-checked native fixture. It is
// NOT a production admission API: the actual entry always uses the strict lease.
export async function runBookingWatchdogSequence(operations){
  await operations.verify();await operations.armed();
  while(true){
    await operations.verify();
    if(await operations.completed())return operations.finish('committed',null);
    if(await operations.parentState()!=='owned'||operations.elapsedMs()>=BOOKING_WATCHDOG_TRIGGER_MS){
      await operations.stopOwnedParent();need(await operations.parentState()!=='owned','parent_still_running');
      if(await operations.completed())return operations.finish('committed-after-parent-exit',null);
      const recovery=await operations.recover();return operations.finish('recovered-failure',recovery);
    }
    await operations.wait(250);
  }
}

/** Verification only: recovery never fabricates the normal lock WeakMap token.
 * It inherits the real kernel open-file description from the admitted host. */
function kernelLease(lease,{requireParentGone=false}={}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertBookingWatchdogLease(lease);
  const text=read(ROOT+'/watchdog-lease.json');equal(text,retentionCanonicalText(lease),'lease_changed');
  assertOnlineToolOwnedPath(DEPLOY,'file');equal(metadata(fs.fstatSync(3)),lease.deploy.identity,'inherited_lock_changed');equal(metadata(fs.lstatSync(DEPLOY)),lease.deploy.identity,'deploy_lock_changed');
  need(fs.readlinkSync('/proc/self/fd/3')===DEPLOY,'inherited_fd_target');
  try{assertOnlineToolOwnedPath(OPERATION);equal(metadata(fs.lstatSync(OPERATION)),lease.operation.identity,'operation_lock_changed');need(fs.readdirSync(OPERATION).length===0,'operation_lock_not_empty');}
  catch(error){if(error.code!=='ENOENT'||parentState(lease.parent)==='owned')throw error;}
  if(requireParentGone)need(parentState(lease.parent)!=='owned','parent_still_running');
  need(hash(read(ROOT+'/routing-plan.json'))===lease.routingPlanSha256&&hash(read(ROOT+'/ingress-plan.json'))===lease.gatePlanSha256,'plan_changed');
  return true;
}
export function assertBookingWatchdogInheritedLease(lease,options){sourceIdentity(lease.toolRevision);return kernelLease(lease,options);}
export function bookingWatchdogControllerArguments(toolRevision,reviewed=false){
 need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&typeof reviewed==='boolean','controller_entry');const directory='/var/lib/faolla-online-code/'+toolRevision;
 return reviewed?['/usr/bin/node',directory+'/scripts/release-toolchain-release.mjs','publish']:['/usr/bin/node',directory+'/scripts/booking-handoff-host.mjs'];
}
export function assertBookingWatchdogControllerArguments(actual,toolRevision,reviewed=false){
 const expected=bookingWatchdogControllerArguments(toolRevision,reviewed);if(!reviewed){equal(actual,expected,'controller_entry');return true;}
 need(Array.isArray(actual)&&actual.length===3&&['node','/usr/bin/node'].includes(actual[0])&&
  [expected[1],'scripts/release-toolchain-release.mjs'].includes(actual[1])&&actual[2]==='publish','controller_entry');return true;
}

export async function armBookingHandoffWatchdog({lock,toolRevision}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);sourceIdentity(toolRevision,{initial:true});
  const directory='/var/lib/faolla-online-code/'+toolRevision,parent=fact(process.pid);
  assertBookingWatchdogControllerArguments(command(process.pid),toolRevision,!!reviewedBookingExecution(toolRevision));need(parent.cwd===directory,'controller_cwd');
  // No gate is installed unless BOTH the supervisor and its separately verified
  // recovery entrypoint have already been installed by the standard tool path.
  for(const file of ['booking-handoff-watchdog.mjs','booking-handoff-recovery.mjs'])assertOnlineToolOwnedPath(directory+'/scripts/'+file,'file');
  collectBookingAtomicRuntimeCohort({toolRevision});
  const routingText=read(ROOT+'/routing-plan.json'),routing=JSON.parse(routingText),gateText=read(ROOT+'/ingress-plan.json'),gate=JSON.parse(gateText);
  assertBookingAtomicRoutingPlan(routing);bookingIngressRestorationText(gate,gate.afterText);equal(routing.window,gate.window,'window_changed');
  assertBookingHandoffWindow(gate.window,{nowMs:Date.now()});need(Date.now()-Date.parse(gate.window.startedAt)<5000,'late_arming');
  need(hash(fs.readFileSync('/www/server/nginx/conf/nginx.conf'))===BOOKING_INGRESS_MAIN_SHA256&&fs.readFileSync(BOOKING_INGRESS_VHOST,'utf8')===gate.beforeText,'gate_already_changed');
  const lease={schemaVersion:1,kind:'booking-handoff-independent-watchdog',candidate:CANDIDATE,toolRevision,window:gate.window,parent,
    deploy:{file:DEPLOY,identity:metadata(fs.fstatSync(lock.deployFd))},operation:{directory:OPERATION,identity:metadata(fs.lstatSync(OPERATION))},
    routingPlanSha256:hash(routingText),gatePlanSha256:hash(gateText)};
  assertBookingWatchdogLease(lease);write(ROOT+'/watchdog-lease.json',retentionCanonicalText(lease));
  const output=fs.openSync(ROOT+'/watchdog.log',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  let child;
  try{child=spawn('/usr/bin/node',[directory+'/scripts/booking-handoff-watchdog.mjs'],{detached:true,cwd:directory,env:env(),stdio:['ignore',output,output,lock.deployFd]});}
  finally{fs.closeSync(output);}
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});const childFact=fact(child.pid);
  equal(command(child.pid),['/usr/bin/node',directory+'/scripts/booking-handoff-watchdog.mjs'],'watchdog_entry');
  let armed=false;for(let i=0;i<250;i++){
    assertOnlineRetentionHeldLocks(lock);equal(fact(child.pid),childFact,'watchdog_changed');
    try{const a=JSON.parse(read(ROOT+'/watchdog-armed.json'));assertBookingWatchdogArmedLease(a,lease);equal(a.process,childFact,'arming_process');armed=true;break;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(r=>setTimeout(r,20));
  }need(armed,'arming_unconfirmed');child.unref();const handle=Object.freeze({operationId:lease.window.id});handles.set(handle,{child,childFact,lease});return handle;
}

async function actualCompleted(lease){
  try{
    const gate=JSON.parse(read(ROOT+'/worker-enabled.json'));const history=readOnlineRetentionHistory();
    need(history.entries.at(-1)?.toolRevision===lease.toolRevision,'completion_tool');
    const active=JSON.parse(read('/var/lib/faolla-online-release/active.json'));need(active.target===CANDIDATE,'completion_target');
    assertExistingPm2Directory();const daemonPid=Number(fs.readFileSync('/root/.pm2/pm2.pid','utf8').trim()),daemon=fact(daemonPid);
    equal(command(daemonPid),['PM2 v6.0.14: God Daemon (/root/.pm2)'],'completion_daemon');
    const list=JSON.parse(run('/usr/bin/node',['/usr/lib/node_modules/pm2/bin/pm2','jlist'])).map(normalizeRetirementProcess);equal(fact(daemonPid),daemon,'completion_daemon_changed');
    assertBookingAtomicWorkerGate({gate,history,actualActive:active,current:list,toolRevision:lease.toolRevision});
    const ingress=JSON.parse(read(ROOT+'/ingress-plan.json'));need(fs.readFileSync(BOOKING_INGRESS_VHOST,'utf8')===ingress.beforeText,'completion_ingress');
    for(const origin of ['https://faolla.com','https://launch.faolla.com']){
      const r=await fetch(origin+'/api/app-web-version?bookingWatchdog='+lease.window.id,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(2000)}),v=await r.json();need(r.status===200&&v.ok===true&&v.buildId===CANDIDATE,'completion_public');
    }
    return {certificateSha256:retentionHash(history.entries.at(-1)),generation:gate.generation};
  }catch(error){if(['EACCES','EPERM'].includes(error.code))throw error;return false;} // A partial journal is never skipped or called complete.
}
export async function finishBookingHandoffWatchdog({lock,handle}){
  assertOnlineRetentionHeldLocks(lock);const value=handles.get(handle);need(value,'unowned_handle');value.child.ref();
  let finished;for(let i=0;i<100;i++){
    assertOnlineRetentionHeldLocks(lock);
    try{finished=JSON.parse(read(ROOT+'/watchdog-finished.json'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(r=>setTimeout(r,100));
  }
  need(finished&&['committed','committed-after-parent-exit'].includes(finished.outcome),'completion_unconfirmed');
  need(await actualCompleted(value.lease),'completion_not_committed');
  const until=Date.now()+2000;while(value.child.exitCode===null&&value.child.signalCode===null&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
  need(value.child.exitCode===0&&!value.child.signalCode,'watchdog_exit_unconfirmed');handles.delete(handle);return finished;
}

async function productionWatchdog(){
  need(process.argv.length===2,'arguments');const lease=JSON.parse(read(ROOT+'/watchdog-lease.json'));assertBookingWatchdogInheritedLease(lease);
  equal(command(process.pid),['/usr/bin/node','/var/lib/faolla-online-code/'+lease.toolRevision+'/scripts/booking-handoff-watchdog.mjs'],'watchdog_entry');
  const self=fact(process.pid),started=process.hrtime.bigint(),initialElapsed=Date.now()-Date.parse(lease.window.startedAt);
  need(initialElapsed>=0&&initialElapsed<10000,'startup_bound');
  const stopOwnedParent=async()=>{
    if(parentState(lease.parent)!=='owned')return;
    assertBookingWatchdogInheritedLease(lease);process.kill(lease.parent.pid,'SIGTERM');
    for(let i=0;i<50&&parentState(lease.parent)==='owned';i++)await new Promise(r=>setTimeout(r,20));
    if(parentState(lease.parent)==='owned'){assertBookingWatchdogInheritedLease(lease);process.kill(lease.parent.pid,'SIGKILL');}
    for(let i=0;i<50&&parentState(lease.parent)==='owned';i++)await new Promise(r=>setTimeout(r,20));
    need(parentState(lease.parent)!=='owned','controller_not_terminated');
  };
  await runBookingWatchdogLoop({verify:()=>kernelLease(lease),
    armed:()=>write(ROOT+'/watchdog-armed.json',retentionCanonicalText({schemaVersion:1,leaseSha256:bookingWatchdogLeaseDigest(lease),process:self,at:new Date().toISOString()})),
    completed:()=>actualCompleted(lease),parentState:()=>parentState(lease.parent),
    elapsedMs:()=>initialElapsed+Number((process.hrtime.bigint()-started)/1000000n),wait:ms=>new Promise(r=>setTimeout(r,ms)),stopOwnedParent,
    recover:()=>{
      assertBookingWatchdogInheritedLease(lease,{requireParentGone:true});
      const script='/var/lib/faolla-online-code/'+lease.toolRevision+'/scripts/booking-handoff-recovery.mjs';assertOnlineToolOwnedPath(script,'file');
      const r=spawnSync('/usr/bin/node',[script],{cwd:path.dirname(path.dirname(script)),env:env(),encoding:'utf8',timeout:170000,killSignal:'SIGKILL',maxBuffer:65536,stdio:['ignore','pipe','pipe',3]});
      assertBookingWatchdogInheritedLease(lease,{requireParentGone:true});const exit=recoveryChildExitEvidence(r,{operationId:lease.window.id,toolRevision:lease.toolRevision});
      write(ROOT+'/watchdog-recovery-exit.json',retentionCanonicalText(exit));
      need(r.status===0&&!r.error&&!r.signal&&exit.outputEmpty,'recovery_unconfirmed');return JSON.parse(read(ROOT+'/watchdog-recovery.json'));
    },
    finish:(outcome,recovery)=>{
      assertBookingWatchdogInheritedLease(lease);const finished={schemaVersion:1,operationId:lease.window.id,outcome,recovery,completedAt:new Date().toISOString()};
      write(ROOT+'/watchdog-finished.json',retentionCanonicalText(finished));
      if(parentState(lease.parent)!=='owned'){
        try{equal(metadata(fs.lstatSync(OPERATION)),lease.operation.identity,'operation_lock_changed');need(fs.readdirSync(OPERATION).length===0,'operation_lock_not_empty');fs.rmdirSync(OPERATION);sync(path.dirname(OPERATION));}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      return finished;
    },
  },lease);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){productionWatchdog().catch(()=>{console.error('booking_watchdog_unconfirmed');process.exitCode=1;});}
