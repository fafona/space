import {assertBookingReadyClosure as assertBookingHandoffToolClosure} from './booking-ready-policy.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
// Exactly one approved restart of the legacy booking timer host. This is NOT a
// generic PM2 controller. No independent enterprise/outbox process is signalled.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_LEGACY_DIRECTORY as LEGACY,BOOKING_HANDOFF_PM2_PROVENANCE,
  assertBookingLegacyEnvironmentTransition,assertBookingLegacyRuntimeEnvironmentTransition,assertBookingHandoffWindow} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT,verifyBookingAtomicRuntimeCohort} from './booking-handoff-runtime.mjs';
import {assertBookingAtomicRoutingPlan,assertBookingRoutingCurrent} from './booking-handoff-routing.mjs';
import {bookingIngressRestorationText,BOOKING_INGRESS_VHOST} from './booking-handoff-ingress.mjs';
import {bookingHandoffActivationSnapshotSql} from './booking-handoff-activation.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess,assertExistingPm2Directory,parseRetirementSockets} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {assertOnlineToolOwnedPath,verifyOnlineReleaseTool,createOnlineReleaseToolPlan,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {captureTrustedPython,verifyTrustedPython} from './production-maintenance-trusted-python.mjs';

const APP='/www/wwwroot/merchant-space',CONTAINER='0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',PM2='/usr/lib/node_modules/pm2';
const hash=v=>createHash('sha256').update(v).digest('hex'),need=(v,c)=>{if(!v)throw Error('booking_legacy_pause_'+c);},equal=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
const environment=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
function run(bin,args,options={}){const r=spawnSync(bin,args,{env:environment(),encoding:'utf8',timeout:10000,maxBuffer:32*1024**2,windowsHide:true,...options});need(r.status===0&&!r.signal&&!r.error,'command_unconfirmed');return r.stdout;}
const fileIdentity=s=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,s[k]]));
function read(file,{privateMode=true}={}){
  assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);need(s.size>0&&s.size<=32*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{equal(fileIdentity(fs.fstatSync(fd)),fileIdentity(s),'file_replaced');const b=fs.readFileSync(fd);equal(fileIdentity(fs.fstatSync(fd)),fileIdentity(s),'file_changed');equal(fileIdentity(fs.lstatSync(file)),fileIdentity(s),'file_replaced');need(b.length===s.size,'file_changed');return b;}finally{fs.closeSync(fd);}
}
function writeOnce(file,text){
  assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_directory');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}equal(read(file),Buffer.from(text),'write_readback');
}
function rawEnv(pid){const result={};for(const v of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean)){const at=v.indexOf('=');need(at>0&&!Object.hasOwn(result,v.slice(0,at)),'raw_environment');result[v.slice(0,at)]=v.slice(at+1);}return result;}
function fact(pid){
  need(Number.isSafeInteger(pid)&&pid>0,'pid');const root='/proc/'+pid,stat=fs.readFileSync(root+'/stat','utf8'),end=stat.lastIndexOf(')'),f=stat.slice(end+2).trim().split(/\s+/);
  need(end>0&&/^\d+$/.test(f[19]??'')&&fs.lstatSync(root).uid===0,'process');
  return {pid,uid:0,startTicks:f[19],parentPid:Number(f[1]),cwd:fs.realpathSync(root+'/cwd'),executable:fs.realpathSync(root+'/exe'),
    commandSha256:hash(fs.readFileSync(root+'/cmdline')),environmentSha256:hash(fs.readFileSync(root+'/environ'))};
}
function peer(pid){
  const f=fact(pid),s=fs.statSync('/proc/'+pid+'/exe',{bigint:true});
  return {pid,uid:f.uid,startTicks:f.startTicks,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),executable:f.executable,
    executableIdentity:['dev','ino','size','mtimeNs','ctimeNs','nlink','uid','mode'].map(k=>String(s[k])).join(':')};
}
const pmDerived=p=>({exitCode:p.exit_code??null,nodeVersion:p.node_version??null,version:p.version??null,previousRestartDelay:p.prev_restart_delay??null,unstableRestarts:p.unstable_restarts??null});
export const BOOKING_LEGACY_PM2_SNAPSHOT_FIELDS=Object.freeze(['status','pm_cwd','pm_exec_path','exec_interpreter','exec_mode','args','node_args',
  'watch','cron_restart','autorestart','kill_timeout','shutdown_with_message','created_at','pm_uptime','restart_time','node_version','version','exit_code',
  'prev_restart_delay','unstable_restarts','FAOLLA_BACKGROUND_JOBS_PAUSED','env']);
export function bookingLegacyRpcExpected(target){return {name:target.name,pid:target.pid,pm_id:target.pm_id,
  pm2_env:Object.fromEntries(BOOKING_LEGACY_PM2_SNAPSHOT_FIELDS.map(k=>[k,target.pm2_env[k]??(k==='shutdown_with_message'?false:null)]))};}

/** Non-mutating read shared by the preflight and post-restart proof. No CLI
 * actuator is used: the mutation helper sends one fixed peer-bound RPC. */
export function collectBookingLegacyHost(){
  need(process.platform==='linux'&&process.getuid?.()===0&&process.version===BOOKING_HANDOFF_PM2_PROVENANCE.nodeVersion,'linux_runtime');
  assertExistingPm2Directory();const pid=Number(read('/root/.pm2/pm2.pid',{privateMode:false}).toString().trim()),daemon=fact(pid);
  need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');
  const sources={};for(const [file,pin]of Object.entries(BOOKING_HANDOFF_PM2_PROVENANCE.frameworkSources)){sources[file]=hash(read(PM2+'/'+file,{privateMode:false}));need(sources[file]===pin,'pm2_source');}
  const raw=JSON.parse(run('/usr/bin/node',[PM2+'/bin/pm2','jlist'])),rows=raw.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
  equal(fact(pid),daemon,'daemon_changed');const target=raw.find(p=>p.name==='merchant-space');
  need(target?.pm_id===0&&target.pid>0&&target.pm2_env.status==='online'&&target.pm2_env.pm_cwd===LEGACY,'legacy_host');
  const legacy=normalizeRetirementProcess(target),legacyFact=fact(target.pid);need(legacyFact.parentPid===pid&&legacyFact.cwd===LEGACY&&legacyFact.executable==='/usr/bin/node','legacy_os_host');
  return {legacy,raw:rawEnv(target.pid),configured:structuredClone(target.pm2_env.env),pmUptime:target.pm2_env.pm_uptime,
    pmDerived:pmDerived(target.pm2_env),framework:{nodeVersion:process.version,managerVersion:'6.0.14',frameworkSources:sources},
    processes:rows,identityProofs:rows.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)})),
    daemonPeer:peer(pid),processPeer:peer(target.pid),
    rpcExpected:bookingLegacyRpcExpected(target)};
}

export function bookingLegacyPauseTransition(before,after,window,observedAt){
  const transition={beforeRaw:before.raw,afterRaw:after.raw,beforeConfigured:before.configured,afterConfigured:after.configured,
    legacyBefore:before.legacy,legacyAfter:after.legacy,beforePmUptime:before.pmUptime,afterPmUptime:after.pmUptime,
    beforePmDerived:before.pmDerived,afterPmDerived:after.pmDerived,framework:before.framework,window,observedAt};
  equal(after.framework,before.framework,'framework_changed');equal(after.daemonPeer,before.daemonPeer,'daemon_changed');
  assertBookingLegacyRuntimeEnvironmentTransition(transition);
  equal(after.processes.filter(p=>p.name!=='merchant-space'),before.processes.filter(p=>p.name!=='merchant-space'),'unrelated_process_changed');
  equal(after.identityProofs.filter(p=>p.name!=='merchant-space'),before.identityProofs.filter(p=>p.name!=='merchant-space'),'unrelated_os_changed');
  return transition;
}
export async function executeBookingLegacyPause(operations,window){
  const before=await operations.observe();await operations.admit(before,window);
  need(before.legacy.pid===1590381&&before.legacy.name==='merchant-space'&&before.legacy.backgroundPaused==='0','original_host');
  assertBookingLegacyEnvironmentTransition(before.configured,{...before.configured,FAOLLA_BACKGROUND_JOBS_PAUSED:'1'});
  await operations.begin({schemaVersion:1,kind:'booking-single-legacy-pause-attempt',window,before,startedAt:operations.now()});
  equal(await operations.observe(),before,'before_changed');
  const ack=await operations.restart(before);need(ack?.schemaVersion===1&&ack.kind==='booking-legacy-pause-rpc-ack'&&ack.acknowledged===true&&ack.peerVerified===true&&ack.pm2Version==='6.0.14','rpc_ack');
  const after=await operations.settled(),transition=bookingLegacyPauseTransition(before,after,window,operations.now());
  await operations.complete(transition);return transition;
}

/** Connect-only transport, NOT release authority. The normal host or bounded
 * recovery watchdog must claim the SAME exclusive attempt file first. */
export function invokeBookingLegacyPause(before){
  need(process.platform==='linux'&&process.getuid?.()===0&&before?.legacy?.pid===1590381,'rpc_original_host');
  need(/^\/var\/lib\/faolla-online-code\/[a-f0-9]{40}\/scripts\/booking-handoff-legacy\.mjs$/.test(fileURLToPath(import.meta.url)),'rpc_tool_path');
  const python=captureTrustedPython(),helper=fileURLToPath(new URL('./booking-handoff-pm2-pause.py',import.meta.url));
  const helperBefore=read(helper,{privateMode:false});verifyTrustedPython(python);
  const r=spawnSync(python.target.path,['-I','-S','-B',helper],{cwd:'/',input:JSON.stringify({daemon:before.daemonPeer,process:before.processPeer,expected:before.rpcExpected}),
    encoding:'utf8',timeout:35000,killSignal:'SIGKILL',maxBuffer:262144,windowsHide:true,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
  verifyTrustedPython(python);equal(read(helper,{privateMode:false}),helperBefore,'helper_changed');
  need(r.status===0&&!r.signal&&!r.error&&r.stderr==='','restart_outcome_unknown');return JSON.parse(r.stdout);
}
export async function waitBookingLegacyPauseSettled(window,assertHeld=()=>{}){
  const deadline=process.hrtime.bigint()+10000000000n;
  let observed;for(let i=0;i<100&&process.hrtime.bigint()<deadline;i++){
    assertHeld();assertBookingHandoffWindow(window,{nowMs:Date.now()});
    try{observed=collectBookingLegacyHost();if(observed.legacy.pid!==1590381&&observed.legacy.status==='online'&&observed.legacy.backgroundPaused==='1'){
      const sockets=parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));
      if(sockets.listeners.some(s=>s.port===3000&&s.pid===observed.legacy.pid)){
        const response=await fetch('http://127.0.0.1:3000/login',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(1000)});
        await response.body?.cancel();if([200,301,302,303,307,308].includes(response.status))return observed;
      }
    }}catch{/* Only fresh reads may be repeated during the single restart. */}
    await new Promise(r=>setTimeout(r,100));
  }need(false,'restart_not_settled');
}

export async function pauseLegacyBookingHost({lock,toolRevision}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
  const adopted=reviewedBookingExecution(toolRevision);
  need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
  if(!adopted){verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
   const files=runOnlineToolGit(APP,['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
   assertBookingHandoffToolClosure({baseline:CANDIDATE,files,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});}
  const routingText=read(ROOT+'/routing-plan.json'),routing=JSON.parse(routingText),window=routing.window;assertBookingAtomicRoutingPlan(routing);
  const preflightText=read(ROOT+'/preflight.json'),preflight=JSON.parse(preflightText),activationText=read(ROOT+'/activation.json'),activation=JSON.parse(activationText);
  need(activation.before?.active===false&&activation.after?.active===true&&activation.before.generation===activation.after.generation,'activation_not_committed');
  const gateText=read(ROOT+'/ingress-plan.json'),gate=JSON.parse(gateText);
  const verifyAdmission=before=>{
    assertOnlineRetentionHeldLocks(lock);const bounds=assertBookingHandoffWindow(window,{nowMs:Date.now()});need(bounds.deadlineAtMs-Date.now()>=75000,'insufficient_recovery_reserve');
    equal(read(ROOT+'/routing-plan.json'),routingText,'routing_changed');equal(read(ROOT+'/preflight.json'),preflightText,'preflight_changed');equal(read(ROOT+'/activation.json'),activationText,'activation_changed');
    equal(read(ROOT+'/ingress-plan.json'),gateText,'gate_changed');bookingIngressRestorationText(gate,read(BOOKING_INGRESS_VHOST,{privateMode:false}).toString());equal(gate.window,window,'gate_window');
    assertBookingRoutingCurrent(routing,Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,{privateMode:false}).toString()])),{phase:'armed'});
    verifyBookingAtomicRuntimeCohort({lock,toolRevision});equal(before.legacy,preflight.legacyBefore,'preflight_host_changed');
    need(hash(retentionCanonicalText(before.raw))===preflight.legacyRawSha256&&hash(retentionCanonicalText(before.configured))===preflight.legacyConfiguredSha256,'preflight_environment_changed');
    const db=JSON.parse(run('docker',['exec','-i',CONTAINER,'sh','-lc','export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],{input:bookingHandoffActivationSnapshotSql,timeout:15000}).trim());
    equal(db,activation.after,'active_database_changed');
  };
  return executeBookingLegacyPause({now:()=>new Date().toISOString(),observe:()=>collectBookingLegacyHost(),admit:verifyAdmission,
    begin:attempt=>{verifyAdmission(attempt.before);writeOnce(ROOT+'/legacy-restart-attempt.json',retentionCanonicalText(attempt));},
    restart:before=>{
      assertOnlineRetentionHeldLocks(lock);const ack=invokeBookingLegacyPause(before);
      writeOnce(ROOT+'/legacy-restart-rpc-ack.json',retentionCanonicalText(ack));return ack;
    },
    settled:()=>waitBookingLegacyPauseSettled(window,()=>assertOnlineRetentionHeldLocks(lock)),
    complete:transition=>{assertOnlineRetentionHeldLocks(lock);writeOnce(ROOT+'/legacy-runtime-transition.json',retentionCanonicalText(transition));},
  },window);
}
