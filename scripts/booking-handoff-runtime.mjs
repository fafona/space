import {assertBookingDependencyToolClosure as assertBookingHandoffToolClosure} from './booking-dependency-continuation-policy.mjs';
// Private runtime preparation only. No public routing, legacy-host restart,
// database mutation, history append or worker enablement is exposed here.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_CANDIDATE as CANDIDATE,
  BOOKING_HANDOFF_BASELINE as BASELINE,assertBookingAtomicCohort} from './booking-handoff-policy.mjs';
import {assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {assertBookingBuiltSmokeRuntimeContinuation} from './booking-built-smoke-repair.mjs';
import {assertBookingCompatibilityRuntimeContinuation} from './booking-compatibility-tool.mjs';
import {BOOKING_COMPATIBILITY_PRIOR_TOOL} from './booking-compatibility-tool-policy.mjs';
import {assertBookingRegistryRuntimeContinuation} from './booking-registry-tool.mjs';
import {BOOKING_REGISTRY_PRIOR_TOOL} from './booking-registry-tool-policy.mjs';
import {BOOKING_FORMAL_PRIOR_TOOL} from './booking-formal-backup-policy.mjs';
import {assertBookingDependencyRuntimeContinuation as assertBookingFormalRuntimeContinuation} from './booking-dependency-continuation-tool.mjs';
import {bookingModeAwareDependencies,assertBookingDependencyBinding} from './booking-dependency-fingerprint.mjs';
import {bookingProtectedEnvironment,assertBookingCompatibilityEnvironment} from './booking-publication-policy.mjs';
import {verifyInactiveBookingSchema} from './booking-publication-database.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {attendanceRepairTreeFingerprint} from './attendance-staged-tool-repair.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {retentionCanonicalText} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess,parseRetirementSockets,assertExistingPm2Directory} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER,webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';

export const BOOKING_HANDOFF_ROOT='/var/lib/faolla-booking-handoff/'+CANDIDATE;
const APP='/www/wwwroot/merchant-space',RELEASE='/var/lib/faolla-online-release',ROOT=BOOKING_HANDOFF_ROOT;
const directory=target=>APP+'.web-releases/'+target.slice(0,12)+'-online';
const name=target=>'merchant-space-online-'+target.slice(0,12);
const location=s=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,s[k]]));
const workerName='merchant-space-booking-atomic-'+CANDIDATE.slice(0,12);
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,code)=>{if(!v)throw Error('booking_handoff_runtime_'+code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const sha=/^[a-f0-9]{40}(?![\s\S])/;
const commandEnvironment=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
function run(command,args,options={}){
  const r=spawnSync(command,args,{encoding:'utf8',env:commandEnvironment(),timeout:15000,maxBuffer:32*1024**2,windowsHide:true,...options});
  need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;
}
const identity=st=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,st[k]]));
function read(file,{privateMode=true}={}){
  assertOnlineToolOwnedPath(file,'file');const st=fs.lstatSync(file);
  need(st.size>0&&st.size<=32*1024**2&&(!privateMode||(st.mode&0o777)===0o600),'file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    equal(identity(fs.fstatSync(fd)),identity(st),'file_replaced');const bytes=fs.readFileSync(fd);
    equal(identity(fs.fstatSync(fd)),identity(st),'file_changed');equal(identity(fs.lstatSync(file)),identity(st),'file_replaced');
    need(bytes.length===st.size,'file_changed');return bytes;
  }finally{fs.closeSync(fd);}
}
function sync(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeOnce(file,text){
  assertOnlineToolOwnedPath(path.dirname(file));need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_directory');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));equal(read(file),Buffer.from(text),'write_readback');
}
function vacant(file){try{fs.lstatSync(file);need(false,'prior_attempt');}catch(e){if(e.code!=='ENOENT')throw e;}}
function fact(pid){
  need(Number.isSafeInteger(pid)&&pid>0,'pid');const root='/proc/'+pid,stat=fs.readFileSync(root+'/stat','utf8');
  const end=stat.lastIndexOf(')'),f=stat.slice(end+2).trim().split(/\s+/);need(end>0&&/^\d+$/.test(f[19]??'')&&fs.lstatSync(root).uid===0,'process');
  return {pid,parentPid:Number(f[1]),startTicks:f[19],cwd:fs.realpathSync(root+'/cwd'),executable:fs.realpathSync(root+'/exe'),
    commandSha256:hash(fs.readFileSync(root+'/cmdline')),environmentSha256:hash(fs.readFileSync(root+'/environ'))};
}
function runtime(pid){return webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+pid+'/environ','utf8'));}

// Run only the actual installed Next environment loader, never app code or
// instrumentation. This also checks .env.production/.env, not just /proc (which
// cannot show environment assignments performed after process startup).
export const BOOKING_ATOMIC_NEXT_ENV_PROBE=`
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{createHash}=require('node:crypto'),fs=require('node:fs');
const directory=process.argv[1],initial={...process.env},requireApp=createRequire(directory+'/package.json');
const entry=requireApp.resolve('@next/env'),loader=requireApp('@next/env');
loader.loadEnvConfig(directory,false,{info(){},error(){}});
for(const [key,value]of Object.entries(initial))assert.equal(process.env[key],value,'inherited_environment_changed');
assert.equal(process.env.NODE_ENV,'production');assert.equal(process.env.MERCHANT_BOOKING_STORAGE_MODE,'atomic-v2');
assert.equal(process.env.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');assert.equal(process.env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED,'0');
assert.equal(process.env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');assert.equal(process.env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
assert.ok(!process.env.RESEND_API_KEY&&!process.env.BOOKING_CONFIRMATION_EMAIL_FROM,'mail_not_disabled');
const hash=value=>createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({kind:'booking-atomic-next-environment',storageMode:process.env.MERCHANT_BOOKING_STORAGE_MODE,mailDisabled:true,
 loaderSha256:hash(fs.readFileSync(entry)),effectiveEnvironmentSha256:hash(JSON.stringify(Object.fromEntries(Object.entries(process.env).sort(([a],[b])=>a.localeCompare(b)))))}));
`;

/** The web override is EXACTLY one key. Existing .env.local and build runtime
 * files remain immutable; Next's process-env precedence is separately tested. */
export function bookingAtomicRuntimePlan({primary,rollback,primaryRuntime,rollbackRuntime,toolRevision}){
  need(sha.test(toolRevision??'')&&toolRevision!==CANDIDATE,'tool_revision');
  for(const [s,target,env]of [[primary,CANDIDATE,primaryRuntime],[rollback,APPLICATION,rollbackRuntime]]){
    need(s?.target===target&&s.name===name(target)&&s.directory===directory(target)&&Number.isSafeInteger(s.port)&&s.port>=3103&&s.port<=3110,'anchor');
    assertContactWechatBuildEnvironmentKeys(env);assertBookingCompatibilityEnvironment(env);
    need(env.NODE_ENV==='production'&&env.PWD===s.directory&&env.PORT===String(s.port)&&env.PM2_HOME==='/root/.pm2'&&
      env.FAOLLA_WEB_BUILD_ID===target&&env.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID===target&&env.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&
      env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0'&&
      !env.RESEND_API_KEY&&!env.BOOKING_CONFIRMATION_EMAIL_FROM,'inherited_flags');
  }
  need(primary.port!==rollback.port,'distinct_ports');
  const envs=[primaryRuntime,rollbackRuntime].map(env=>({...env,MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'}));
  for(let i=0;i<2;i++)equal(bookingProtectedEnvironment(envs[i]),bookingProtectedEnvironment([primaryRuntime,rollbackRuntime][i]),'protected_environment');
  const workerRuntime={...envs[0],MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1',FAOLLA_BACKGROUND_JOBS_PAUSED:'0'};
  delete workerRuntime.PORT;assertBookingAtomicWorkerEnvironment(workerRuntime);
  return {schemaVersion:1,kind:'booking-atomic-private-runtime',candidate:CANDIDATE,application:APPLICATION,toolRevision,
    primary:location(primary),rollback:location(rollback),runtimeByName:{[primary.name]:envs[0],[rollback.name]:envs[1]},
    worker:{name:workerName,directory:primary.directory,script:'/var/lib/faolla-online-code/'+toolRevision+'/scripts/booking-atomic-worker.mjs',runtime:workerRuntime}};
}

// BEGIN shared booking runtime launch commands
// Pure command construction, used verbatim by both the fixed host adapter and
// the real-PM2 isolated rehearsal. This does not execute any command.
export function bookingAtomicRuntimeCommands(plan){
  return {
    primary:{args:['restart',plan.primary.name,'--update-env'],environment:structuredClone(plan.runtimeByName[plan.primary.name])},
    rollback:{args:['start',plan.rollback.directory+'/node_modules/next/dist/bin/next','--name',plan.rollback.name,
      '--cwd',plan.rollback.directory,'--interpreter','/usr/bin/node','--','start','-H','127.0.0.1','-p',String(plan.rollback.port)],
      environment:structuredClone(plan.runtimeByName[plan.rollback.name])},
    worker:{args:['start',plan.worker.script,'--name',plan.worker.name,'--cwd',plan.worker.directory,'--interpreter','/usr/bin/node'],
      environment:structuredClone(plan.worker.runtime)},
  };
}
// END shared booking runtime launch commands

/** An uncertain restart/start is never replayed. Failure retains all receipts
 * and gated processes; no automatic cleanup can stop a pre-existing service. */
export async function executeBookingAtomicRuntime(operations,plan){
  need(plan?.kind==='booking-atomic-private-runtime','plan');
  // Reconstruct rather than trusting runtime fields supplied by a caller.
  const legacy=env=>({...env,MERCHANT_BOOKING_STORAGE_MODE:'legacy'});
  equal(plan,bookingAtomicRuntimePlan({primary:plan.primary,rollback:plan.rollback,
    primaryRuntime:legacy(plan.runtimeByName[plan.primary.name]),rollbackRuntime:legacy(plan.runtimeByName[plan.rollback.name]),toolRevision:plan.toolRevision}),'plan_changed');
  const before=await operations.observe();await operations.admit(plan,before);
  await operations.begin({plan,before,startedAt:operations.now()});
  equal(await operations.observe(),before,'before_changed');
  await operations.saveRuntime(plan);
  await operations.restartPrimary(plan);
  const primary=await operations.verifyPrimary(plan);
  await operations.startRollback(plan);
  const rollback=await operations.verifyRollback(plan);
  assertBookingAtomicCohort({active:{...plan.primary,process:primary},rollback:{...plan.rollback,process:rollback},runtimeByName:plan.runtimeByName});
  await operations.startGatedWorker(plan);
  const after=await operations.verifyAll(plan,before);
  const readyAt=operations.now(),stateText=retentionCanonicalText({...plan.rollback,status:'booking-rollback-ready',readyAt,storageMode:'atomic-v2',candidate:CANDIDATE});
  const receipt={schemaVersion:1,kind:'booking-atomic-private-runtime-ready',planSha256:hash(retentionCanonicalText(plan)),
    before,after,readyAt,rollbackStateText:stateText};
  await operations.complete(receipt);return receipt;
}

/** Fixed production paths, normal held locks, exact tool closure and actual
 * inactive-schema verification. The independent enterprise worker is untouched. */
export async function prepareBookingAtomicRuntime({lock,toolRevision}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
  need(sha.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
  verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
  const changed=runOnlineToolGit(APP,['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
  const toolClosureSha256=assertBookingHandoffToolClosure({baseline:CANDIDATE,files:changed,readBlob:f=>runOnlineToolGit(APP,['show',toolRevision+':'+f])});
  const stateText=read(RELEASE+'/'+CANDIDATE+'/state.json').toString(),primary=JSON.parse(stateText);
  const rollbackText=read(RELEASE+'/'+APPLICATION+'/state.json').toString(),rollback=JSON.parse(rollbackText);
  const buildToolRevision=primary.bookingReviewedStage?.toolRevision===toolRevision?toolRevision:
    toolRevision===BOOKING_COMPATIBILITY_PRIOR_TOOL?assertBookingBuiltSmokeRuntimeContinuation({toolRevision,primary,rollback}):
    toolRevision===BOOKING_REGISTRY_PRIOR_TOOL?assertBookingCompatibilityRuntimeContinuation({toolRevision,primary,rollback}):
    toolRevision===BOOKING_FORMAL_PRIOR_TOOL?assertBookingRegistryRuntimeContinuation({toolRevision,primary,rollback}):
    assertBookingFormalRuntimeContinuation({toolRevision,primary,rollback});
  need(primary.status==='database-ready'&&primary.baseline===BASELINE&&primary.lane==='booking-runtime-compatibility-only'&&
    primary.bookingReviewedStage?.toolRevision===buildToolRevision&&
    (buildToolRevision!==toolRevision||primary.bookingReviewedStage?.toolClosureSha256===toolClosureSha256)&&
    rollback.status==='booking-rollback-built'&&rollback.primary===CANDIDATE&&rollback.toolRevision===buildToolRevision,'stage');
  const history=readOnlineRetentionHistory();need(history.entries.at(-1)?.active.target===BASELINE&&history.headSha256===primary.retentionHeadSha256,'history');
  vacant(ROOT);for(const s of [primary,rollback])vacant(RELEASE+'/'+s.target+'/atomic-runtime.json');
  const inactive=await verifyInactiveBookingSchema({rootDir:primary.directory});
  const inactiveText=read(RELEASE+'/'+CANDIDATE+'/booking-database-inactive.json'),inactiveProof=JSON.parse(inactiveText);
  need(inactiveProof.status==='installed-inactive'&&inactiveProof.atomicActive===false&&inactiveProof.target===CANDIDATE&&
    hash(inactiveText)===primary.bookingDatabaseProofSha256,'inactive_proof');
  const daemon=()=>{
    assertExistingPm2Directory();const pid=Number(read('/root/.pm2/pm2.pid',{privateMode:false}).toString().trim());
    const f=fact(pid);need(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');return f;
  };
  const daemonBefore=daemon(),pmBinary=fs.realpathSync(run('which',['pm2']).trim());assertOnlineToolOwnedPath(pmBinary,'file');
  need(JSON.parse(read(path.dirname(path.dirname(pmBinary))+'/package.json',{privateMode:false})).version==='6.0.14','pm2_version');
  const pm=(args,options)=>{equal(daemon(),daemonBefore,'daemon_changed');const result=run(pmBinary,args,options);equal(daemon(),daemonBefore,'daemon_changed');return result;};
  const all=()=>JSON.parse(pm(['jlist'])),initialRaw=all(),take=rows=>rows.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
  const initial=take(initialRaw),currentPrimary=initial.find(p=>p.name===primary.name);
  equal(initial.filter(p=>p.name!==primary.name),[...primary.processes].sort((a,b)=>a.pmId-b.pmId),'retained_processes');
  need(currentPrimary?.cwd===primary.directory&&currentPrimary.port===primary.port&&currentPrimary.status==='online'&&
    currentPrimary.backgroundPaused==='1'&&!initial.some(p=>[rollback.name,workerName].includes(p.name)),'private_primary');
  const originals={},environments={};
  for(const s of [primary,rollback]){
    const op=RELEASE+'/'+s.target,envText=read(op+'/runtime.json'),env=JSON.parse(envText);
    originals[s.target]={stateSha256:hash(s.target===CANDIDATE?stateText:rollbackText),runtimeSha256:hash(envText),
      environmentFileSha256:hash(read(s.directory+'/.env.local')),buildSha256:hash(read(s.directory+'/.next/BUILD_ID',{privateMode:false})),
      buildProofSha256:hash(read(op+'/attendance-build-proof.json'))};
    need(runOnlineToolGit(s.directory,['rev-parse','HEAD']).toString().trim()===s.target&&
      !runOnlineToolGit(s.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source');
    const dep=attendanceRepairTreeFingerprint(s.directory+'/node_modules',{allowInternalLinks:true});
    assertBookingDependencyBinding({target:s.target,savedDigest:s.target===CANDIDATE?primary.bookingDependenciesSha256:JSON.parse(read(op+'/rollback-built.json')).dependenciesSha256,
      modeAwareDigest:bookingModeAwareDependencies(s.directory+'/node_modules'),streamedTree:dep});
    if(s.target===CANDIDATE){
      need(originals[s.target].runtimeSha256===primary.bookingRuntimeSha256&&originals[s.target].environmentFileSha256===primary.bookingEnvironmentFileSha256&&
        originals[s.target].buildProofSha256===primary.bookingBuildProofSha256,'primary_artifacts');
      const actual=runtime(currentPrimary.pid);for(const [k,v]of Object.entries(env))need(actual[k]===v,'primary_inherited_runtime');
    }else{
      const builtText=read(op+'/rollback-built.json'),built=JSON.parse(builtText);
      need(hash(builtText)===rollback.rollbackBuildSha256&&built.status==='built-not-started'&&built.primary===CANDIDATE&&built.toolRevision===buildToolRevision&&
        built.runtimeSha256===originals[s.target].runtimeSha256&&built.environmentFileSha256===originals[s.target].environmentFileSha256&&
        built.buildEvidenceSha256===originals[s.target].buildProofSha256&&built.builtOutputSha256===attendanceRepairTreeFingerprint(s.directory+'/.next',{exclude:['cache','trace']}).sha256,'rollback_artifacts');
    }
    environments[s.target]=env;
  }
  const plan=bookingAtomicRuntimePlan({primary,rollback,primaryRuntime:environments[CANDIDATE],rollbackRuntime:environments[APPLICATION],toolRevision});
  const commands=bookingAtomicRuntimeCommands(plan);
  const nextEnvironmentProofs={};
  for(const s of [primary,rollback]){
    const text=run('/usr/bin/node',['-e',BOOKING_ATOMIC_NEXT_ENV_PROBE,s.directory],{cwd:s.directory,env:plan.runtimeByName[s.name]});
    const proof=JSON.parse(text);need(proof.kind==='booking-atomic-next-environment'&&proof.storageMode==='atomic-v2'&&proof.mailDisabled===true,'next_environment');
    nextEnvironmentProofs[s.target]=proof;
  }
  const publicFiles=['/var/lib/faolla-online-release/active.json','/var/lib/faolla-maintenance/merchant-space/state.json',WEB_RELEASE_MARKER,
    '/www/server/nginx/conf/nginx.conf','/www/server/panel/vhost/nginx/www.faolla.com.conf',...WEB_RELEASE_FILES.map(f=>WEB_RELEASE_PROXY+'/'+f)];
  const publicSnapshot=()=>({files:Object.fromEntries(publicFiles.map(f=>[f,hash(read(f,{privateMode:false}))])),baseDirectory:fs.realpathSync(APP+'.current')});
  const publicBefore=publicSnapshot(),onlineFacts=initial.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)}));
  const checkOriginals=()=>{
    for(const s of [primary,rollback]){const o=originals[s.target],op=RELEASE+'/'+s.target;
      need(hash(read(op+'/runtime.json'))===o.runtimeSha256&&hash(read(s.directory+'/.env.local'))===o.environmentFileSha256&&
        hash(read(s.directory+'/.next/BUILD_ID',{privateMode:false}))===o.buildSha256&&hash(read(op+'/attendance-build-proof.json'))===o.buildProofSha256,'original_artifact_changed');}
  };
  let runtimeSaved=false;
  const unchanged=()=>{
    assertOnlineRetentionHeldLocks(lock);equal(daemon(),daemonBefore,'daemon_changed');equal(readOnlineRetentionHistory(),history,'history_changed');
    equal(publicSnapshot(),publicBefore,'public_changed');checkOriginals();
    equal(read(RELEASE+'/'+CANDIDATE+'/state.json').toString(),stateText,'stage_changed');
    equal(read(RELEASE+'/'+APPLICATION+'/state.json').toString(),rollbackText,'rollback_state_changed');
    equal(read(RELEASE+'/'+CANDIDATE+'/booking-database-inactive.json'),inactiveText,'inactive_proof_changed');
    if(runtimeSaved){
      for(const s of [primary,rollback])equal(read(RELEASE+'/'+s.target+'/atomic-runtime.json').toString(),retentionCanonicalText(plan.runtimeByName[s.name]),'atomic_file_changed');
      equal(read(ROOT+'/worker-runtime.json').toString(),retentionCanonicalText(plan.worker.runtime),'worker_file_changed');vacant(ROOT+'/worker-enabled.json');
    }
  };
  const observe=()=>{unchanged();const rows=take(all());return {processes:rows,identityProofs:rows.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)})),public:publicSnapshot()};};
  const verifyWeb=async s=>{
    let verified;
    for(let i=0;i<30;i++){
      unchanged();const rows=take(all()),p=rows.find(p=>p.name===s.name);
      if(p?.status==='online'){
        need(p.cwd===s.directory&&p.port===s.port&&p.executable===s.directory+'/node_modules/next/dist/bin/next'&&p.interpreter==='/usr/bin/node'&&
          p.execMode==='fork_mode'&&p.autorestart===true&&p.watch===false&&p.shutdownWithMessage===false&&
          [null,false,'0'].includes(p.cronRestart)&&[undefined,''].includes(p.manualSignalHandle),'web_process');
        equal(p.args,['start','-H','127.0.0.1','-p',String(s.port)],'web_arguments');equal(p.nodeArgs,[],'web_arguments');
        const actual=runtime(p.pid),expected=plan.runtimeByName[s.name];
        for(const [k,v]of Object.entries(expected))need(actual[k]===v,'atomic_environment');
        need(!actual.RESEND_API_KEY&&!actual.BOOKING_CONFIRMATION_EMAIL_FROM,'mail');
        const sockets=parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));
        const owned=sockets.listeners.filter(l=>l.port===s.port);
        if(owned.length===1&&owned[0].pid===p.pid&&owned[0].address==='127.0.0.1'){
          try{const r=await fetch('http://127.0.0.1:'+s.port+'/api/app-web-version',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(2000)});
            const v=await r.json();if(r.status===200&&v.ok===true&&v.buildId===s.target){verified=p;break;}}
          catch{/* Read-only probes may be repeated; process commands may not. */}
        }
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    need(verified,'web_not_ready');return verified;
  };
  return executeBookingAtomicRuntime({now:()=>new Date().toISOString(),observe,
    admit:async()=>{equal(initial,take(all()),'before_changed');need(currentPrimary.restartCount===0,'primary_previously_restarted');
      equal(onlineFacts,initial.filter(p=>p.status==='online').map(p=>({name:p.name,...fact(p.pid)})),'process_changed');
      equal(await verifyInactiveBookingSchema({rootDir:primary.directory}),inactive,'inactive_changed');
      need(!parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH'])).listeners.some(l=>l.port===rollback.port),'rollback_port');},
    begin:evidence=>{
      const parent=path.dirname(ROOT);assertOnlineToolOwnedPath(path.dirname(parent));
      try{fs.lstatSync(parent);}catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(parent,{mode:0o700});sync(path.dirname(parent));}
      assertOnlineToolOwnedPath(parent);need((fs.lstatSync(parent).mode&0o777)===0o700,'private_directory');
      fs.mkdirSync(ROOT,{mode:0o700});sync(parent);
      writeOnce(ROOT+'/runtime-attempt.json',retentionCanonicalText({...evidence,toolClosureSha256,originals,nextEnvironmentProofs}));
      writeOnce(ROOT+'/primary-original-stage.json',stateText);writeOnce(ROOT+'/rollback-original-state.json',rollbackText);
    },
    saveRuntime:()=>{
      for(const s of [primary,rollback])writeOnce(RELEASE+'/'+s.target+'/atomic-runtime.json',retentionCanonicalText(plan.runtimeByName[s.name]));
      writeOnce(ROOT+'/worker-runtime.json',retentionCanonicalText(plan.worker.runtime));vacant(ROOT+'/worker-enabled.json');runtimeSaved=true;
    },
    restartPrimary:()=>{unchanged();writeOnce(ROOT+'/primary-runtime-restart-attempt.json',retentionCanonicalText({process:currentPrimary,at:new Date().toISOString()}));
      pm(commands.primary.args,{env:commands.primary.environment});},
    verifyPrimary:async()=>{const p=await verifyWeb(primary);need(p.pid!==currentPrimary.pid&&p.restartCount===currentPrimary.restartCount+1,'primary_restart');return p;},
    startRollback:()=>{unchanged();writeOnce(ROOT+'/rollback-runtime-start-attempt.json',retentionCanonicalText({anchor:location(rollback),at:new Date().toISOString()}));
      pm(commands.rollback.args,{env:commands.rollback.environment});},
    verifyRollback:()=>verifyWeb(rollback),
    startGatedWorker:()=>{unchanged();vacant(ROOT+'/worker-enabled.json');writeOnce(ROOT+'/worker-start-attempt.json',retentionCanonicalText({name:workerName,at:new Date().toISOString()}));
      pm(commands.worker.args,{env:commands.worker.environment});},
    verifyAll:async()=>{
      const active={...location(primary),process:await verifyWeb(primary)},back={...location(rollback),process:await verifyWeb(rollback)};
      const rows=take(all());need(rows.length===initial.length+2,'process_count');
      for(const p of initial.filter(p=>p.name!==primary.name))equal(rows.find(v=>v.name===p.name),p,'retained_process_changed');
      for(const f of onlineFacts.filter(f=>f.name!==primary.name))equal({name:f.name,...fact(f.pid)},f,'retained_os_identity_changed');
      assertBookingAtomicCohort({active,rollback:back,runtimeByName:plan.runtimeByName});
      const worker=rows.find(p=>p.name===workerName);need(worker?.status==='online'&&worker.port===null&&worker.cwd===primary.directory&&
        worker.executable===plan.worker.script&&worker.interpreter==='/usr/bin/node'&&worker.execMode==='fork_mode'&&worker.autorestart===true&&worker.watch===false&&
        worker.shutdownWithMessage===false&&[null,false,'0'].includes(worker.cronRestart)&&[undefined,''].includes(worker.manualSignalHandle)&&
        worker.backgroundPaused==='0'&&worker.automationEnabled==='0'&&worker.invitationEnabled==='0'&&worker.restartCount===0,'worker');
      equal(worker.args,[],'worker_args');equal(worker.nodeArgs,[],'worker_args');
      const env=runtime(worker.pid);assertBookingAtomicWorkerEnvironment(env);for(const [k,v]of Object.entries(plan.worker.runtime))need(env[k]===v,'worker_environment');
      vacant(ROOT+'/worker-enabled.json');
      equal(await verifyInactiveBookingSchema({rootDir:primary.directory}),inactive,'inactive_changed');
      unchanged();return observe();
    },
    complete:receipt=>{
      unchanged();writeOnce(ROOT+'/runtime-ready.json',retentionCanonicalText(receipt));
      writeOnce(RELEASE+'/'+APPLICATION+'/state.json.atomic-ready',receipt.rollbackStateText);
      equal(read(RELEASE+'/'+APPLICATION+'/state.json').toString(),rollbackText,'rollback_state_changed');
      fs.renameSync(RELEASE+'/'+APPLICATION+'/state.json.atomic-ready',RELEASE+'/'+APPLICATION+'/state.json');sync(RELEASE+'/'+APPLICATION);
      equal(read(RELEASE+'/'+APPLICATION+'/state.json').toString(),receipt.rollbackStateText,'rollback_ready_readback');
    },
  },plan);
}

/** Fresh non-mutating runtime attestation for every routing step. A stale
 * runtime-ready receipt alone is never authority to send public traffic. */
export function collectBookingAtomicRuntimeCohort({toolRevision}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');
  need(sha.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_path');
  verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
  const ready=JSON.parse(read(ROOT+'/runtime-ready.json'));
  need(ready.kind==='booking-atomic-private-runtime-ready','runtime_not_ready');
  const attempt=JSON.parse(read(ROOT+'/runtime-attempt.json'));
  need(attempt.plan?.toolRevision===toolRevision&&hash(retentionCanonicalText(attempt.plan))===ready.planSha256,'runtime_attempt_changed');
  assertExistingPm2Directory();const daemonPid=Number(read('/root/.pm2/pm2.pid',{privateMode:false}).toString().trim()),daemon=fact(daemonPid);
  need(fs.readFileSync('/proc/'+daemonPid+'/cmdline','utf8').replace(/\0+$/,'')==='PM2 v6.0.14: God Daemon (/root/.pm2)','daemon');
  const binary=fs.realpathSync(run('which',['pm2']).trim());assertOnlineToolOwnedPath(binary,'file');
  need(JSON.parse(read(path.dirname(path.dirname(binary))+'/package.json',{privateMode:false})).version==='6.0.14','pm2_version');
  const raw=JSON.parse(run(binary,['jlist'])),rows=raw.map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId);
  equal(fact(daemonPid),daemon,'daemon_changed');need(rows.length===ready.after.processes.length,'cohort_process_count');
  for(const p of ready.after.processes.filter(p=>p.name!=='merchant-space'))equal(rows.find(v=>v.name===p.name),p,'cohort_process_changed');
  for(const p of ready.after.identityProofs.filter(p=>p.name!=='merchant-space'))equal({name:p.name,...fact(p.pid)},p,'cohort_os_identity_changed');
  const anchors={},runtimeByName={};
  for(const target of [CANDIDATE,APPLICATION]){
    const state=JSON.parse(read(RELEASE+'/'+target+'/state.json'));
    anchors[target]={...location(state),process:rows.find(p=>p.name===state.name)};
    const saved=JSON.parse(read(RELEASE+'/'+target+'/atomic-runtime.json')),actual=runtime(anchors[target].process.pid);
    equal(saved,attempt.plan.runtimeByName[state.name],'atomic_saved_runtime_changed');
    for(const [key,value]of Object.entries(saved))need(actual[key]===value,'cohort_actual_environment');
    runtimeByName[state.name]=actual;
  }
  assertBookingAtomicCohort({active:anchors[CANDIDATE],rollback:anchors[APPLICATION],runtimeByName});
  const worker=rows.find(p=>p.name===workerName),workerActual=runtime(worker.pid),workerSaved=JSON.parse(read(ROOT+'/worker-runtime.json'));
  equal(workerSaved,attempt.plan.worker.runtime,'worker_saved_runtime_changed');
  assertBookingAtomicWorkerEnvironment(workerActual);for(const [key,value]of Object.entries(workerSaved))need(workerActual[key]===value,'worker_actual_environment');
  return {active:anchors[CANDIDATE],rollback:anchors[APPLICATION],runtimeByName,processes:rows};
}
export function verifyBookingAtomicRuntimeCohort({lock,toolRevision}){
  assertOnlineRetentionHeldLocks(lock);return collectBookingAtomicRuntimeCohort({toolRevision});
}
