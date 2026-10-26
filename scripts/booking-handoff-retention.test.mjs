import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
import {BOOKING_RETENTION_KIND,assertBookingRetentionHandoff,assertBookingRollbackToolPreparation} from './booking-handoff-retention.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {ONLINE_RETENTION_POLICY as policy,retentionHash,retentionCanonicalText,
  assertOnlineRetentionHistory,assertOnlineRetentionPlan,inspectOnlineRetentionWindow,
  assertOnlineRetentionPublication,assertOnlineRetentionRollbackProof,snapshotOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {bookingHandoffFixture as fixture} from './test-support/booking-handoff-retention-fixture.mjs';
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

test('one exact handoff appends a compatible rollback edge without rewriting any historical receipt',()=>{
  const f=fixture(),old=retentionCanonicalText(f.history),source=clone(f);
  assertOnlineRetentionPlan(f.before,f.history);
  const {history,receipt}=append(f.history,f.before);
  assert.equal(retentionCanonicalText(f.history),old);assert.deepEqual(f,source);
  assert.deepEqual(history.entries.slice(0,-1),f.history.entries);
  assert.deepEqual(JSON.parse(receipt.files.get('prepared.json')).bookingHandoff,f.handoff);
  assert.deepEqual(JSON.parse(receipt.files.get('before.json')).bookingHandoff,f.handoff);
  assert.deepEqual(history.entries.at(-1).bookingHandoff,f.handoff);
  const window=inspectOnlineRetentionWindow({history,actualActive:location(f.active),current:f.after,saved:f.current});
  assert.equal(window.stableRollback.target,APPLICATION);
  assert.deepEqual(assertOnlineRetentionPublication({history,state:f.before.activeState,actualActive:location(f.active),current:f.after,action:'verify'}).baseline,f.rollback);
  assert.equal(snapshotOnlineRetentionPublication({history,actualActive:location(f.active),current:f.after,releaseTarget:sha('7')}).retentionHeadSha256,history.headSha256);
});

test('handoff rejects predecessor, stage, process, atomic activation and readiness drift even with fresh hashes',()=>{
  for(const [label,mutate]of [
    ['old live',v=>{v.history.entries.at(-1).active.target=sha('8');}],
    ['history head',v=>{v.handoff.evidence.priorRetentionHeadSha256=h('0');}],
    ['tool',v=>{v.handoff.evidence.toolRevision=sha('1');}],
    ['missing independent worker',v=>{v.before.processes.splice(4,1);}],
    ['enterprise restart',v=>{v.before.processes.find(p=>p.name==='merchant-space-enterprise-automation-worker').pid++;}],
    ['legacy forged before',v=>{v.handoff.legacyBefore.pid++;}],
    ['legacy after',v=>{v.handoff.legacyAfter.backgroundPaused='0';}],
    ['restart before window',v=>{v.handoff.legacyAfter.createdAt=Date.parse(at)-1;v.before.processes.find(p=>p.name==='merchant-space').createdAt=v.handoff.legacyAfter.createdAt;}],
    ['restart after completion',v=>{v.handoff.legacyAfter.createdAt=Date.parse(v.handoff.evidence.completedAt)+1;v.before.processes.find(p=>p.name==='merchant-space').createdAt=v.handoff.legacyAfter.createdAt;}],
    ['extra process',v=>{v.before.processes.push({...process(sha('5'),3109,9),name:'foreign'});}],
    ['missing source bytes',v=>{v.handoff.originalStageText+=' ';}],
    ['rewritten stage',v=>{const s=JSON.parse(v.handoff.originalStageText);s.baseline=APPLICATION;v.handoff.originalStageText=JSON.stringify(s);v.handoff.evidence.priorStageSha256=digest(v.handoff.originalStageText);}],
    ['saved data',v=>{v.handoff.databaseAfter.savedBookingRowsSha256=h('0');}],
    ['queue nonempty',v=>{v.handoff.databaseAfter.mailJobs=1;}],
    ['activation hash',v=>{v.handoff.evidence.activationSha256=h('0');}],
    ['repair hash',v=>{v.handoff.evidence.ruleRepairSha256=h('0');}],
    ['repair wrong row',v=>{v.handoff.ruleRepair.rowId='00000000-0000-4000-8000-000000000001';v.handoff.evidence.ruleRepairSha256=retentionHash(v.handoff.ruleRepair);}],
    ['repair expanded',v=>{v.handoff.ruleRepair.fieldCount=28;v.handoff.evidence.ruleRepairSha256=retentionHash(v.handoff.ruleRepair);}],
    ['repair not activation baseline',v=>{v.handoff.ruleRepair.afterSavedRowsSha256=h('0');v.handoff.evidence.ruleRepairSha256=retentionHash(v.handoff.ruleRepair);}],
    ['repair outside window',v=>{v.handoff.ruleRepair.updatedAt='2026-10-26T09:59:59.000Z';v.handoff.evidence.ruleRepairSha256=retentionHash(v.handoff.ruleRepair);}],
    ['rollback fabricated publication',v=>{const s=JSON.parse(v.handoff.rollbackReadiness.stateText);s.status='active';s.activatedAt=at;v.handoff.rollbackReadiness.stateText=JSON.stringify(s);v.handoff.evidence.rollbackReadinessSha256=retentionHash(v.handoff.rollbackReadiness);}],
    ['rollback mail enabled',v=>{v.handoff.runtimeByName[v.rollback.name].RESEND_API_KEY='forbidden';}],
    ['rollback hash',v=>{v.handoff.evidence.rollbackReadinessSha256=h('0');}],
    ['wrong ready bytes',v=>{v.before.releaseProofs[1].stateText+=' ';v.before.releaseProofs[1].stateSha256=digest(v.before.releaseProofs[1].stateText);}],
    ['late receipt',v=>{v.handoff.evidence.completedAt=v.handoff.evidence.window.deadlineAt;}],
  ]){const f=fixture();mutate(f);f.before.bookingHandoff=clone(f.handoff);
    assert.throws(()=>assertOnlineRetentionPlan(f.before,f.history),undefined,label);}
});

test('normal convergence cannot launder the legacy restart or introduce the extra handoff cohort',()=>{
  const f=fixture();f.before.kind='converge';delete f.before.bookingHandoff;
  assert.throws(()=>assertOnlineRetentionPlan(f.before,f.history));
  const normal=observation(f.history,'converge',[...f.current,clone(f.active.process)],f.active,f.history.entries.at(-1).active);
  normal.processes.find(p=>p.name==='merchant-space').pid++;
  normal.identityProofs.find(p=>p.name==='merchant-space').pid++;
  normal.listeners.find(p=>p.port===3000).pid++;
  assert.throws(()=>assertOnlineRetentionPlan(normal,f.history),/retained_identity_changed/);
});

test('certified old PID replacement does not forgive later restart, environment drift or a second handoff',()=>{
  const f=fixture(),history=append(f.history,f.before).history;
  for(const mutate of [r=>{r.find(p=>p.name==='merchant-space').pid++;},r=>{r.find(p=>p.name==='merchant-space').environmentSha256=h('2');},
    r=>{r.find(p=>p.name==='merchant-space-enterprise-automation-worker').pid++;},r=>r.pop()]){
    const current=clone(f.after);mutate(current);assert.throws(()=>inspectOnlineRetentionWindow({history,actualActive:location(f.active),current,saved:f.current}));
  }
  const again=clone(f.before);again.sequence++;again.previousSha256=history.headSha256;
  assert.throws(()=>assertOnlineRetentionPlan(again,history),/duplicate_booking_handoff/);
  for(const k of ['bookingHandoffSha256','bookingOriginalStageSha256']){
    const state=clone(f.before.activeState);state[k]=h('0');
    assert.throws(()=>assertOnlineRetentionPublication({history,state,actualActive:location(f.active),current:f.after,action:'rollback'}),/booking_handoff_state_changed/);
  }
});

test('atomic rollback proof is bound to the new explicit edge, never the preserved old stage baseline',()=>{
  const f=fixture(),history=append(f.history,f.before).history;
  const proxyFiles=Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,{beforeText:'atomic rollback '+file,afterText:'atomic primary '+file}]));
  const state={...clone(f.before.activeState),status:'rolled-back',rolledBackAt:end,retentionRollbackHeadSha256:history.headSha256,
    configs:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,{oldHash:digest(proxyFiles[file].beforeText),newHash:digest(proxyFiles[file].afterText)}]))};
  const failedStateText=JSON.stringify(state);
  const proof={version:1,historyHeadSha256:history.headSha256,from:location(f.active),to:location(f.rollback),activeFile:location(f.rollback),
    failedStateText,failedStateSha256:digest(failedStateText),proxyFiles,
    proxyHashes:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,digest(proxyFiles[file].beforeText)]))};
  assertOnlineRetentionRollbackProof({history,proof,actualActive:location(f.rollback)});
  assert.throws(()=>assertOnlineRetentionRollbackProof({history,proof:{...proof,to:location(f.history.entries.at(-1).active)}}),/rollback_to_changed/);
});

test('handoff proof and retention remain side-effect-free policy modules',()=>{
  const source=readFileSync(new URL('./booking-handoff-retention.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]node:(?:fs|child_process)|\b(?:fetch|spawnSync|writeFileSync|mkdirSync|unlinkSync)\s*\(/);
  const f=fixture();assertBookingRetentionHandoff({handoff:f.handoff,prior:f.history.entries.at(-1),previousSha256:f.history.headSha256,
    active:f.active,rollback:f.rollback,processes:f.after,toolRevision:f.before.toolRevision,completedAt:end});
});

test('future tool preparation accepts only the committed compatible ready state and every exact retained artifact byte',()=>{
  const f=fixture(),history=append(f.history,f.before).history;
  const value={stateText:f.handoff.rollbackReadiness.stateText,history,
    artifacts:{buildEvidence:Buffer.from('synthetic-build'),runtime:Buffer.from('synthetic-runtime'),environmentFile:Buffer.from('synthetic-environment')}};
  assertBookingRollbackToolPreparation(value);
  for(const key of Object.keys(value.artifacts)){
    const v=clone(value);v.artifacts[key]=Buffer.from('changed');assert.throws(()=>assertBookingRollbackToolPreparation(v),/artifact_changed/);
  }
  for(const v of [{...value,stateText:value.stateText+' '},{...value,history:f.history}])assert.throws(()=>assertBookingRollbackToolPreparation(v));
});
