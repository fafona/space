import {createHash} from 'node:crypto';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION, BOOKING_HANDOFF_CANDIDATE as CANDIDATE,
  BOOKING_HANDOFF_BASELINE as BASELINE, BOOKING_HANDOFF_LEGACY_DIRECTORY} from '../booking-handoff-policy.mjs';
import {BOOKING_RETENTION_KIND} from '../booking-handoff-retention.mjs';
import {normalizeRetirementProcess} from '../online-release-retirement.mjs';
import {ROLLING_BASE_NAMES} from '../online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES} from '../web-presentation-release-policy.mjs';
import {ONLINE_RETENTION_POLICY as policy,createOnlineRetentionHistory,retentionHash,
  assertOnlineRetentionHistory} from '../online-release-retention-policy.mjs';
import {buildOnlineRetentionReceipt} from '../online-release-retention.mjs';
const clone=structuredClone,h=c=>c.repeat(64),sha=c=>c.repeat(40),digest=x=>createHash('sha256').update(x).digest('hex');
const at='2026-10-26T10:00:00.000Z',end='2026-10-26T10:01:00.000Z';
const location=a=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,a[k]]));
function process(target,port,id){
  const cwd='/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online';
  return normalizeRetirementProcess({name:'merchant-space-online-'+target.slice(0,12),pm_id:id,pid:1000+id,
    pm2_env:{status:'online',pm_cwd:cwd,pm_exec_path:cwd+'/node_modules/next/dist/bin/next',
      exec_interpreter:'/usr/bin/node',exec_mode:'fork_mode',args:['start','-H','127.0.0.1','-p',String(port)],
      env:{PORT:String(port)},PORT:String(port),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
      watch:false,cron_restart:null,shutdown_with_message:false,kill_timeout:1600,created_at:123,restart_time:0}});
}
const anchor=(p,target)=>({target,...{name:p.name,directory:p.cwd,port:p.port},process:clone(p)});
function observation(history,kind,processes,active,rollback,handoff){
  const activeState={...location(active),status:'active',activatedAt:kind===BOOKING_RETENTION_KIND?end:at,
    baseline:rollback.target,oldName:rollback.name,oldDirectory:rollback.directory,oldPort:rollback.port,
    ...(kind!== 'initialize'?{retentionHeadSha256:history.headSha256}:{}),
    ...(handoff?{bookingHandoffSha256:retentionHash(handoff),bookingOriginalStageSha256:handoff.evidence.priorStageSha256}:{}),
    processes:clone(handoff?history.entries.at(-1).processes:processes)};
  return {version:2,policy,kind,toolRevision:sha('f'),sequence:history.entries.length+1,previousSha256:history.headSha256,
    legacySha256:history.rollingHistory.legacySha256,rollingHeadSha256:history.rollingHistory.headSha256,
    rollingHistorySha256:retentionHash(history.rollingHistory),active:clone(active),rollback:clone(rollback),victim:null,
    activeFile:location(active),activeState,processes:clone(processes),sourceClean:true,maintenanceEnded:true,
    maintenanceSha256:h('1'),markerSha256:h('2'),baseDirectory:'/base/owned',
    proxyHashes:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,h('3')])),nginxConfig:'server { listen 443 ssl; }',
    releaseProofs:[active,rollback].map(a=>{
      const state=a.target===active.target?activeState:handoff?JSON.parse(handoff.rollbackReadiness.stateText):
        {...location(a),status:'active',activatedAt:at};
      const stateText=a.target===rollback.target&&handoff?handoff.rollbackReadiness.stateText:JSON.stringify(state);
      return {target:a.target,sourceHead:a.target,sourceClean:true,resolvedInterpreter:'/usr/bin/node',
        http:{status:200,ok:true,buildId:a.target},state,stateText,stateSha256:digest(stateText),
        buildSha256:h('4'),runtimeSha256:h('5'),environmentSha256:h('6')};
    }),
    identityProofs:processes.filter(p=>p.status==='online').map(p=>({name:p.name,pid:p.pid,uid:0,parentPid:99,
      cwd:p.cwd,executable:'/usr/bin/node',startTicks:'100',commandSha256:h('7'),environmentSha256:h('8')})),
    listeners:processes.filter(p=>p.status==='online'&&p.port!==null).map(p=>({address:'127.0.0.1',port:p.port,pid:p.pid})),established:[],
    ancestry:[{older:rollback.target,newer:active.target,verified:true}],...(handoff?{bookingHandoff:clone(handoff)}:{})};
}
function append(history,before){
  const receipt=buildOnlineRetentionReceipt(before,clone(before),{version:2,process:null},history,
    {preparedAt:before.kind===BOOKING_RETENTION_KIND?end:at,completedAt:before.kind===BOOKING_RETENTION_KIND?end:at});
  const next={...clone(history),entries:[...clone(history.entries),receipt.certificate],headSha256:retentionHash(receipt.certificate)};
  assertOnlineRetentionHistory(next);return {history:next,receipt};
}
export function bookingHandoffFixture(injected){
  const p=process(BASELINE,3103,1),old=process(sha('b'),3104,2),stopped=process(sha('c'),3105,3);
  const current=[p,old,{...stopped,pid:0,status:'stopped'}];
  for(const [i,name]of ROLLING_BASE_NAMES.entries()){
    const base={...process(sha('9'),3000+i,20+i),name};
    if(name==='merchant-space')Object.assign(base,{pid:1590381,pmId:0,port:3000,cwd:BOOKING_HANDOFF_LEGACY_DIRECTORY,
      executable:BOOKING_HANDOFF_LEGACY_DIRECTORY+'/node_modules/next/dist/bin/next',backgroundPaused:'0',args:['start','-p','3000']});
    current.push(base);
  }
  const legacy={version:1,status:'completed',victim:{target:sha('c'),name:stopped.name,cwd:stopped.cwd,pmId:stopped.pmId,pid:stopped.pid,port:stopped.port},
    stoppedProcess:clone(current[2]),activeTarget:BASELINE,rollbackTarget:sha('b'),nextTarget:sha('d'),allowedActiveTargets:[BASELINE,sha('b'),sha('d')],
    beforeSha256:h('a'),afterSha256:h('b'),completedAt:at};
  const seed=createOnlineRetentionHistory({version:1,legacyCertificates:[legacy],legacyProcesses:clone(current),legacySha256:h('9'),entries:[],headSha256:null});
  let history=append(seed,observation(seed,'initialize',current,anchor(p,BASELINE),anchor(old,sha('b')))).history;
  if(injected){history=injected.history;current.splice(0,current.length,...clone(injected.current));}
  const priorActive=history.entries.at(-1).active;
  const active=anchor(process(CANDIDATE,3106,6),CANDIDATE),rollback=anchor(process(APPLICATION,3107,7),APPLICATION);
  const legacyBefore=clone(current.find(p=>p.name==='merchant-space'));
  const legacyAfter={...clone(legacyBefore),pid:999999,backgroundPaused:'1',restartCount:legacyBefore.restartCount+1,createdAt:Date.parse(at)+500,environmentSha256:h('0')};
  const worker={...process(sha('8'),3009,8),name:'merchant-space-booking-atomic-'+CANDIDATE.slice(0,12),
    cwd:active.directory,port:null,interpreter:'/usr/bin/node',executable:'/var/lib/faolla-online-code/'+sha('f')+'/scripts/booking-atomic-worker.mjs',
    args:[],nodeArgs:[],autorestart:true,backgroundPaused:'0'};
  const added=[clone(active.process),clone(rollback.process),worker];
  const after=[...current.map(p=>p.name==='merchant-space'?clone(legacyAfter):clone(p)),...clone(added)];
  const e={schemaVersion:1,kind:'booking-task-handoff',candidate:CANDIDATE,baseline:BASELINE,application:APPLICATION,
    toolRevision:sha('f'),window:{id:'10000000-0000-4000-8000-000000000001',startedAt:at,deadlineAt:'2026-10-26T10:10:00.000Z'},completedAt:end};
  for(const k of ['sourceClosureSha256','preflightSha256','compatibilitySha256','backupSha256','ingressGateSha256','legacyDrainSha256','recoveryPlanSha256'])e[k]=h('e');
  e.priorRetentionHeadSha256=history.headSha256;
  const stage={...location(active),status:'database-ready',lane:'booking-runtime-compatibility-only',baseline:BASELINE,
    oldName:priorActive.name,oldDirectory:priorActive.directory,oldPort:priorActive.port,previousActive:location(history.entries.at(-1).active),retentionHeadSha256:history.headSha256,processes:clone(current)};
  const originalStageText=JSON.stringify(stage,null,2);e.priorStageSha256=digest(originalStageText);
  const databaseBefore={systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',
    generation:'20000000-0000-4000-8000-000000000002',revision:'0',protocol:2,active:false,savedBookingRowsSha256:h('a'),commands:0,mailJobs:0};
  const databaseAfter={...databaseBefore,active:true};e.activationSha256=retentionHash({before:databaseBefore,after:databaseAfter});
  const rollbackReadiness={schemaVersion:1,kind:'booking-atomic-rollback-ready',candidate:CANDIDATE,target:APPLICATION,
    stateText:JSON.stringify({...location(rollback),status:'booking-rollback-ready',readyAt:at,storageMode:'atomic-v2',candidate:CANDIDATE}),
    buildEvidenceSha256:digest('synthetic-build'),runtimeSha256:digest('synthetic-runtime'),
    environmentFileSha256:digest('synthetic-environment'),compatibilitySha256:e.compatibilitySha256};
  e.rollbackReadinessSha256=retentionHash(rollbackReadiness);
  const runtimeByName=Object.fromEntries([active,rollback].map(a=>[a.name,{MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2',
    MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
    FAOLLA_WEB_BUILD_ID:a.target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:a.target,PORT:String(a.port),PWD:a.directory}]));
  const handoff={evidence:e,originalStageText,legacyBefore,legacyAfter,added,runtimeByName,databaseBefore,databaseAfter,rollbackReadiness};
  const before=observation(history,BOOKING_RETENTION_KIND,after,active,rollback,handoff);
  return {history,before,handoff,active,rollback,current,after};
}
