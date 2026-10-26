// Builds the exact compatible rollback BEFORE the primary candidate starts.
// No process startup, DB operation, traffic write or notification is exposed.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_CANDIDATE as CANDIDATE,
  BOOKING_HANDOFF_BASELINE as BASELINE,BOOKING_HANDOFF_ATTENDANCE_FIX_PINS,assertBookingHandoffCandidateClosure,assertBookingHandoffToolClosure} from './booking-handoff-policy.mjs';
import {BOOKING_SCOPE,BOOKING_TOOL_FILES,bookingProtectedEnvironment,bookingCandidateOverrides,
  assertBookingCompatibilityEnvironment} from './booking-publication-policy.mjs';
import {loginCandidateEnvironmentText} from './merchant-login-release-policy.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';
import {attendanceRepairTreeFingerprint} from './attendance-staged-tool-repair.mjs';
import {buildAttendanceOnlineCandidate,assertAttendanceBuildAdmission} from './attendance-online-build.mjs';
import {assertOnlineToolOwnedPath,createOnlineReleaseToolPlan,verifyOnlineReleaseTool,
  assertOnlineToolNoPending,runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {snapshotOnlineRetentionPublication,retentionCanonicalText} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess,parseRetirementSockets} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER,webReleaseRuntimeEnvironment} from './web-presentation-release-policy.mjs';

const APP='/www/wwwroot/merchant-space',OP='/var/lib/faolla-online-release/'+APPLICATION;
const DIRECTORY=APP+'.web-releases/'+APPLICATION.slice(0,12)+'-online';
const BASE_DIRECTORY=APP+'.web-releases/'+BASELINE.slice(0,12)+'-online';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error('booking_handoff_build_'+code);};
const need=(v,code)=>{if(!v)fail(code);};
const equal=(a,b,code)=>need(isDeepStrictEqual(a,b),code);
const hex=/^[a-f0-9]{64}(?![\s\S])/,sha=/^[a-f0-9]{40}(?![\s\S])/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const runtimeEnv=()=>({PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
function run(command,args,{timeout=60000,...options}={}){
  const r=spawnSync(command,args,{env:runtimeEnv(),encoding:'utf8',timeout,maxBuffer:32*1024**2,windowsHide:true,...options});
  need(r.status===0&&!r.error&&!r.signal,'command_unconfirmed');return r.stdout;
}
function ownedRead(file,{privateMode=false}={}){
  assertOnlineToolOwnedPath(file,'file');const s=fs.lstatSync(file);
  need(s.size>0&&s.size<=16*1024**2&&(!privateMode||(s.mode&0o777)===0o600),'private_file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const identity=st=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,st[k]]));
  try{
    equal(identity(fs.fstatSync(fd)),identity(s),'file_replaced');const bytes=fs.readFileSync(fd);
    equal(identity(fs.fstatSync(fd)),identity(s),'file_changed');equal(identity(fs.lstatSync(file)),identity(s),'file_replaced');
    need(bytes.length===s.size,'file_changed');return bytes;
  }finally{fs.closeSync(fd);}
}
function fsyncDirectory(directory){
  assertOnlineToolOwnedPath(directory);const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function processFact(p){
  const root='/proc/'+p.pid,stat=fs.readFileSync(root+'/stat','utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).trim().split(/\s+/);
  need(end>0&&/^\d+$/.test(fields[19]??'')&&fs.lstatSync(root).uid===0,'process_identity');
  const cwd=fs.realpathSync(root+'/cwd');need(cwd===p.cwd,'process_directory');
  return {name:p.name,pid:p.pid,cwd,startTicks:fields[19],parentPid:Number(fields[1]),executable:fs.realpathSync(root+'/exe'),
    commandSha256:hash(fs.readFileSync(root+'/cmdline')),environmentSha256:hash(fs.readFileSync(root+'/environ'))};
}
function writeOnce(file,bytes,{privateParent=true}={}){
  assertOnlineToolOwnedPath(path.dirname(file));
  if(privateParent)need((fs.lstatSync(path.dirname(file)).mode&0o777)===0o700,'private_directory');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fsyncDirectory(path.dirname(file));equal(ownedRead(file,{privateMode:true}),Buffer.from(bytes),'write_readback');
}
function assertPlan(plan){
  need(object(plan)&&plan.schemaVersion===1&&plan.kind==='booking-compatible-rollback-build'&&plan.target===APPLICATION&&
    plan.primary===CANDIDATE&&plan.baseline===BASELINE&&plan.operation===OP&&plan.directory===DIRECTORY&&
    sha.test(plan.toolRevision??'')&&hex.test(plan.toolClosureSha256??'')&&hex.test(plan.applicationInputsSha256??'')&&
    Number.isSafeInteger(plan.port)&&plan.port>=3103&&plan.port<=3110&&plan.port!==plan.primaryPort,'plan');
  equal(Object.keys(plan).sort(),['schemaVersion','kind','target','primary','baseline','operation','directory','toolRevision',
    'toolClosureSha256','applicationInputsSha256','port','primaryPort'].sort(),'plan_shape');
  return true;
}
export function bookingRollbackBuildPlan({toolRevision,toolClosureSha256,applicationInputsSha256,primaryPort,listeners}){
  need(Number.isSafeInteger(primaryPort)&&primaryPort>=3103&&primaryPort<=3110&&Array.isArray(listeners)&&
    listeners.every(s=>object(s)&&Number.isSafeInteger(s.port)&&s.port>0&&s.port<=65535)&&
    !listeners.some(s=>s.port===primaryPort),'ports');
  const port=[3110,3109,3108,3107,3106,3105,3104,3103].find(p=>p!==primaryPort&&!listeners.some(s=>s.port===p));
  const plan={schemaVersion:1,kind:'booking-compatible-rollback-build',target:APPLICATION,primary:CANDIDATE,baseline:BASELINE,
    operation:OP,directory:DIRECTORY,toolRevision,toolClosureSha256,applicationInputsSha256,port,primaryPort};
  assertPlan(plan);return plan;
}

/** Test ports are an internal orchestration seam, not command-line overrides.
 * A failed or unknown build is retained and never retried by this function. */
export async function executeBookingRollbackBuild(operations,plan){
  assertPlan(plan);const before=await operations.observe();
  const prepared={...plan,status:'prepared',observed:before,preparedAt:operations.now()};
  await operations.admission();await operations.begin(prepared);
  equal(await operations.observe(),before,'baseline_changed');
  await operations.materialize();await operations.admission();
  const built=await operations.build();
  need(object(built)&&built.target===APPLICATION&&built.guardedCommand==='npm run build'&&built.memoryBytes===4294967296&&
    built.heapMiB===3072&&built.cpuQuotaPercent===100&&built.tasks===128&&built.seconds===1200&&
    built.privateNetworkVerified===true&&built.swapBytes===0,'bounded_build_proof');
  const artifacts=await operations.artifacts(built);
  need(object(artifacts)&&['buildEvidenceSha256','runtimeSha256','environmentFileSha256','dependenciesSha256','builtOutputSha256']
    .every(k=>hex.test(artifacts[k]??'')),'artifacts');
  equal(await operations.observe(),before,'baseline_changed');
  const receipt={...plan,status:'built-not-started',preparedSha256:hash(retentionCanonicalText(prepared)),
    ...artifacts,completedAt:operations.now()};
  await operations.complete(receipt);return receipt;
}

/** Called only by the exact reviewed-candidate stage while holding both normal
 * release locks. Normal stage and every historical publication lane are intact. */
export async function prepareBookingHandoffRollback({lock,toolRevision,primaryPort}){
  need(process.platform==='linux'&&process.getuid?.()===0,'linux_root');assertOnlineRetentionHeldLocks(lock);
  need(sha.test(toolRevision??'')&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))==='/var/lib/faolla-online-code/'+toolRevision,'tool_identity');
  verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));assertOnlineToolNoPending();
  const changed=runOnlineToolGit(APP,['diff','--name-only',CANDIDATE,toolRevision]).toString().trim().split('\n');
  const toolClosureSha256=assertBookingHandoffToolClosure({baseline:CANDIDATE,files:changed,
    readBlob:file=>runOnlineToolGit(APP,['show',toolRevision+':'+file])});
  const appDiff=runOnlineToolGit(APP,['diff','--name-only',APPLICATION,CANDIDATE]).toString().trim().split('\n');
  equal(appDiff.sort(),[...BOOKING_TOOL_FILES,...Object.keys(BOOKING_HANDOFF_ATTENDANCE_FIX_PINS)].sort(),'application_delta');
  const candidateDiff=runOnlineToolGit(APP,['diff','--name-only',BASELINE,CANDIDATE]).toString().trim().split('\n');
  assertBookingHandoffCandidateClosure({target:CANDIDATE,baseline:BASELINE,files:candidateDiff,
    readBlob:file=>runOnlineToolGit(APP,['show',CANDIDATE+':'+file])});
  for(const [file,digest]of Object.entries(BOOKING_SCOPE.pins))need(hash(runOnlineToolGit(APP,['show',APPLICATION+':'+file]))===digest,'application_pin');
  const applicationInputsSha256=hash(runOnlineToolGit(APP,['ls-tree','-r','-z',APPLICATION]));
  assertOnlineToolOwnedPath('/var/lib/faolla-online-release');
  for(const file of [OP,DIRECTORY]){try{fs.lstatSync(file);fail('prior_attempt_present');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const history=readOnlineRetentionHistory(),activeText=ownedRead('/var/lib/faolla-online-release/active.json',{privateMode:true});
  const active=JSON.parse(activeText);need(active.target===BASELINE&&active.directory===BASE_DIRECTORY,'baseline_identity');
  const pm=()=>JSON.parse(run('pm2',['jlist'])),raw=pm(),processes=raw.map(normalizeRetirementProcess);
  const baseline=raw.find(p=>p.name===active.name);
  need(baseline?.pm2_env?.status==='online'&&baseline.pm2_env.pm_cwd===BASE_DIRECTORY&&baseline.pid>0&&
    fs.realpathSync('/proc/'+baseline.pid+'/cwd')===BASE_DIRECTORY,'baseline_process');
  const publication=snapshotOnlineRetentionPublication({history,actualActive:active,current:processes,releaseTarget:CANDIDATE});
  const inherited=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+baseline.pid+'/environ','utf8'));
  assertContactWechatBuildEnvironmentKeys(inherited);assertBookingCompatibilityEnvironment(inherited,{allowAbsent:true});
  need(inherited.NODE_ENV==='production'&&inherited.FAOLLA_BACKGROUND_JOBS_PAUSED==='1'&&
    inherited.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED==='0'&&inherited.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED==='0'&&
    inherited.FAOLLA_WEB_BUILD_ID===BASELINE&&inherited.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID===BASELINE,'baseline_flags');
  need(!inherited.RESEND_API_KEY&&!inherited.BOOKING_CONFIRMATION_EMAIL_FROM,'mail_not_disabled');
  for(const [key,value]of Object.entries(bookingProtectedEnvironment(inherited)))need(baseline.pm2_env[key]===value,'baseline_environment');
  const inheritedFile=ownedRead(BASE_DIRECTORY+'/.env.local',{privateMode:true}).toString();
  equal(ownedRead(BASE_DIRECTORY+'/package-lock.json'),runOnlineToolGit(APP,['show',APPLICATION+':package-lock.json']),'dependency_lock');
  const dependencies=attendanceRepairTreeFingerprint(BASE_DIRECTORY+'/node_modules',{allowInternalLinks:true});
  const sockets=()=>parseRetirementSockets(run('ss',['-ltnpH']),run('ss',['-tnpH']));
  const plan=bookingRollbackBuildPlan({toolRevision,toolClosureSha256,applicationInputsSha256,primaryPort,listeners:sockets().listeners});
  const releasedAt=new Date().toISOString(),stateAnchor={target:APPLICATION,port:plan.port,directory:DIRECTORY,name:'merchant-space-online-'+APPLICATION.slice(0,12)};
  const changes=bookingCandidateOverrides(stateAnchor,releasedAt),environmentFile=loginCandidateEnvironmentText(inheritedFile,changes);
  const environment={...inherited,...changes,PWD:DIRECTORY,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
  assertContactWechatBuildEnvironmentKeys(environment);assertBookingCompatibilityEnvironment(environment);
  equal(bookingProtectedEnvironment(environment),bookingProtectedEnvironment({...inherited,MERCHANT_BOOKING_STORAGE_MODE:'legacy',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0'}),'protected_environment');
  let initialState;
  const admission=()=>{const disk=fs.statfsSync('/www',{bigint:true});assertAttendanceBuildAdmission({meminfo:fs.readFileSync('/proc/meminfo','utf8'),diskBytes:disk.bavail*disk.bsize,swaps:fs.readFileSync('/proc/swaps','utf8')});};
  const observe=()=>{
    assertOnlineRetentionHeldLocks(lock);equal(readOnlineRetentionHistory(),history,'history_changed');
    equal(ownedRead('/var/lib/faolla-online-release/active.json',{privateMode:true}),activeText,'active_changed');
    const current=pm().map(normalizeRetirementProcess);equal(current,processes,'process_changed');
    need(!sockets().listeners.some(s=>[primaryPort,plan.port].includes(s.port)),'port_occupied');
    const maintenance=ownedRead('/var/lib/faolla-maintenance/merchant-space/state.json',{privateMode:true});
    need(JSON.parse(maintenance).phase==='ended','maintenance_active');
    const rawEnv=webReleaseRuntimeEnvironment(fs.readFileSync('/proc/'+baseline.pid+'/environ','utf8'));
    equal(rawEnv,inherited,'runtime_environment_changed');
    equal(ownedRead(BASE_DIRECTORY+'/.env.local',{privateMode:true}).toString(),inheritedFile,'environment_file_changed');
    return {activeSha256:hash(activeText),processes:current,identityProofs:current.filter(p=>p.status==='online').map(processFact),retentionHeadSha256:history.headSha256,
      baselineEnvironmentSha256:hash(JSON.stringify(inherited)),baselineEnvironmentFileSha256:hash(inheritedFile),
      baseDirectory:fs.realpathSync(APP+'.current'),maintenanceSha256:hash(maintenance),markerSha256:hash(ownedRead(WEB_RELEASE_MARKER)),
      proxyHashes:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,hash(ownedRead(WEB_RELEASE_PROXY+'/'+file))]))};
  };
  return executeBookingRollbackBuild({observe,admission,now:()=>new Date().toISOString(),
    begin:prepared=>{
      assertOnlineRetentionHeldLocks(lock);fs.mkdirSync(OP,{mode:0o700});fsyncDirectory(path.dirname(OP));
      writeOnce(OP+'/rollback-build-prepared.json',retentionCanonicalText(prepared));
      initialState={...stateAnchor,baseline:BASELINE,primary:CANDIDATE,status:'booking-rollback-building',toolRevision,
        retainedOriginalHead:publication.retentionHeadSha256,startedAt:prepared.preparedAt};
      writeOnce(OP+'/state.json',retentionCanonicalText(initialState));
    },
    materialize:()=>{
      assertOnlineRetentionHeldLocks(lock);runOnlineToolGit(APP,['worktree','add','--detach',DIRECTORY,APPLICATION]);
      run('cp',['-a','--reflink=auto',BASE_DIRECTORY+'/node_modules',DIRECTORY+'/node_modules'],{timeout:180000});
      equal(attendanceRepairTreeFingerprint(DIRECTORY+'/node_modules',{allowInternalLinks:true}),dependencies,'copied_dependencies');
      writeOnce(DIRECTORY+'/.env.local',environmentFile,{privateParent:false});writeOnce(OP+'/runtime.json',JSON.stringify(environment));
    },
    build:()=>{assertOnlineRetentionHeldLocks(lock);return buildAttendanceOnlineCandidate({directory:DIRECTORY,target:APPLICATION,operation:OP});},
    artifacts:built=>{
      equal(attendanceRepairTreeFingerprint(BASE_DIRECTORY+'/node_modules',{allowInternalLinks:true}),dependencies,'baseline_dependencies_changed');
      equal(attendanceRepairTreeFingerprint(DIRECTORY+'/node_modules',{allowInternalLinks:true}),dependencies,'candidate_dependencies_changed');
      equal(ownedRead(OP+'/runtime.json',{privateMode:true}),Buffer.from(JSON.stringify(environment)),'runtime_file_changed');
      equal(ownedRead(DIRECTORY+'/.env.local',{privateMode:true}),Buffer.from(environmentFile),'candidate_environment_changed');
      need(runOnlineToolGit(DIRECTORY,['rev-parse','HEAD']).toString().trim()===APPLICATION&&
        !runOnlineToolGit(DIRECTORY,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'candidate_source');
      const proofText=ownedRead(OP+'/attendance-build-proof.json',{privateMode:true});equal(JSON.parse(proofText),built,'build_evidence_changed');
      return {buildEvidenceSha256:hash(proofText),
        runtimeSha256:hash(ownedRead(OP+'/runtime.json',{privateMode:true})),environmentFileSha256:hash(environmentFile),
        dependenciesSha256:dependencies.sha256,builtOutputSha256:attendanceRepairTreeFingerprint(DIRECTORY+'/.next',{exclude:['cache','trace']}).sha256};
    },
    complete:receipt=>{
      assertOnlineRetentionHeldLocks(lock);writeOnce(OP+'/rollback-built.json',retentionCanonicalText(receipt));
      equal(ownedRead(OP+'/state.json',{privateMode:true}),Buffer.from(retentionCanonicalText(initialState)),'state_changed');
      writeOnce(OP+'/rollback-build-original-state.json',retentionCanonicalText(initialState));
      const next={...initialState,status:'booking-rollback-built',rollbackBuildSha256:hash(retentionCanonicalText(receipt))};
      writeOnce(OP+'/state.json.built',retentionCanonicalText(next));fs.renameSync(OP+'/state.json.built',OP+'/state.json');fsyncDirectory(OP);
      equal(ownedRead(OP+'/state.json',{privateMode:true}),Buffer.from(retentionCanonicalText(next)),'state_readback');
    },
  },plan);
}
