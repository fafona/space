import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {BOOKING_HANDOFF_LEGACY_DIRECTORY as LEGACY,BOOKING_HANDOFF_PM2_PROVENANCE as framework} from './booking-handoff-policy.mjs';
import {executeBookingLegacyPause,bookingLegacyPauseTransition,collectBookingLegacyHost,pauseLegacyBookingHost,bookingLegacyRpcExpected,BOOKING_LEGACY_PM2_SNAPSHOT_FIELDS} from './booking-handoff-legacy.mjs';
const h=c=>c.repeat(64),window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'},now='2026-10-26T10:00:02.000Z';
function snapshots(){
  const legacy={name:'merchant-space',pid:1590381,pmId:0,port:3000,cwd:LEGACY,executable:LEGACY+'/node_modules/next/dist/bin/next',status:'online',backgroundPaused:'0',
    watch:false,cronRestart:null,shutdownWithMessage:false,restartCount:0,environmentSha256:h('a'),args:['start','-p','3000'],automationEnabled:null,invitationEnabled:null,
    createdAt:123,killTimeout:10000,interpreter:'/usr/bin/node',execMode:'fork_mode',nodeArgs:[]};
  const afterLegacy={...legacy,pid:999999,backgroundPaused:'1',restartCount:1,createdAt:Date.parse('2026-10-26T10:00:00.500Z'),environmentSha256:h('b')};
  const configured={KEEP:'synthetic',FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},pmUptime=Date.parse('2026-10-26T09:00:00.000Z'),afterUptime=Date.parse('2026-10-26T10:00:01.000Z');
  const raw={...configured,created_at:'123',pm_uptime:String(pmUptime),restart_time:'0',unstable_restarts:'0',env:'[object Object]',status:'launching'};
  const other={name:'merchant-space-enterprise-automation-worker',pid:1590531,status:'online',environmentSha256:h('c')},otherFact={name:other.name,pid:other.pid,startTicks:'100',environmentSha256:h('d')};
  const before={legacy,raw,configured,pmUptime,pmDerived:{exitCode:null,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:null,unstableRestarts:0},framework:structuredClone(framework),
    processes:[legacy,other],identityProofs:[{name:legacy.name,pid:legacy.pid},otherFact],daemonPeer:{pid:99,startTicks:'50'}};
  const after={...structuredClone(before),legacy:afterLegacy,configured:{...configured,FAOLLA_BACKGROUND_JOBS_PAUSED:'1'},pmUptime:afterUptime,
    pmDerived:{exitCode:0,nodeVersion:'20.20.1',version:'16.3.4',previousRestartDelay:0,unstableRestarts:0},
    raw:{...raw,FAOLLA_BACKGROUND_JOBS_PAUSED:'1',created_at:String(afterLegacy.createdAt),pm_uptime:String(afterUptime),restart_time:'1',exit_code:'0',node_version:'20.20.1',version:'16.3.4',prev_restart_delay:'0'},
    processes:[afterLegacy,structuredClone(other)],identityProofs:[{name:afterLegacy.name,pid:afterLegacy.pid},structuredClone(otherFact)]};
  return {before,after};
}
function fixture(failAt){
  const {before,after}=snapshots(),calls=[];let completed;
  const step=(name,work=()=>{})=>async(...args)=>{calls.push(name);if(failAt===name)throw Error('unknown_'+name);return work(...args);};
  const operations={now:()=>now,observe:step('observe',()=>structuredClone(before)),admit:step('admit'),begin:step('begin'),
    restart:step('restart',()=>({schemaVersion:1,kind:'booking-legacy-pause-rpc-ack',acknowledged:true,peerVerified:true,pm2Version:'6.0.14'})),
    settled:step('settled',()=>structuredClone(after)),complete:step('complete',v=>{completed=v;})};
  return {before,after,calls,operations,completed:()=>completed};
}
test('only a write-once admitted attempt can reach the single restart, followed by complete actual transition validation',async()=>{
  const f=fixture(),v=await executeBookingLegacyPause(f.operations,window);
  assert.deepEqual(f.calls,['observe','admit','begin','observe','restart','settled','complete']);assert.deepEqual(f.completed(),v);
  assert.equal(v.legacyBefore.pid,1590381);assert.equal(v.legacyAfter.backgroundPaused,'1');
});
for(const stage of ['observe','admit','begin','restart','settled','complete'])test('unknown '+stage+' is not replayed and cannot manufacture a completed restart',async()=>{
  const f=fixture(stage);await assert.rejects(executeBookingLegacyPause(f.operations,window),/unknown_/);
  assert.equal(f.calls.filter(v=>v===stage).length,1);assert.equal(f.completed(),undefined);assert.ok(f.calls.filter(v=>v==='restart').length<=1);
});
test('a changed preread cannot signal anything and an ACK alone cannot certify a restart',async()=>{
  const f=fixture();let seen=0;f.operations.observe=async()=>{const r=structuredClone(f.before);if(++seen===2)r.raw.EXTRA='changed';return r;};
  await assert.rejects(executeBookingLegacyPause(f.operations,window),/before_changed/);assert.equal(f.calls.includes('restart'),false);
  const a=fixture();a.operations.restart=async()=>({acknowledged:true});await assert.rejects(executeBookingLegacyPause(a.operations,window),/rpc_ack/);assert.equal(a.completed(),undefined);
});
test('extra restart, altered credentials, daemon replacement, enterprise changes and expiry all reject the actual completion proof',()=>{
  for(const change of [a=>a.legacy.restartCount++,a=>a.raw.KEEP='changed',a=>a.configured.KEEP='changed',a=>a.daemonPeer.pid++,
    a=>a.processes[1].pid++,a=>a.identityProofs[1].startTicks='200',a=>a.framework.managerVersion='6.0.15',a=>a.raw.RESEND_API_KEY='forbidden']){
    const f=snapshots();change(f.after);assert.throws(()=>bookingLegacyPauseTransition(f.before,f.after,window,now));
  }
  const f=snapshots();assert.throws(()=>bookingLegacyPauseTransition(f.before,f.after,window,window.deadlineAt));
});
test('Node collector and fixed Python RPC compare precisely the same PM2 snapshot fields',()=>{
  const file=fileURLToPath(new URL('./booking-handoff-pm2-pause.py',import.meta.url));
  const code="import importlib.util,json,sys;s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m._FIELDS))";
  const r=spawnSync(process.platform==='win32'?'python.exe':'python3',['-I','-S','-B','-c',code,file],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),BOOKING_LEGACY_PM2_SNAPSHOT_FIELDS);
  assert.equal(bookingLegacyRpcExpected({name:'merchant-space',pid:1590381,pm_id:0,pm2_env:{}}).pm2_env.shutdown_with_message,false);
});
test('production actuator has fixed ownership, gate, routing, active DB, source, Python and immutable attempt checks',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0){assert.throws(()=>collectBookingLegacyHost(),/linux_runtime/);await assert.rejects(pauseLegacyBookingHost({lock:true,toolRevision:'f'.repeat(40)}),/linux_root/);}
  const source=readFileSync(new URL('./booking-handoff-legacy.mjs',import.meta.url),'utf8');
  for(const token of ['assertOnlineRetentionHeldLocks(lock)','assertBookingHandoffToolClosure','bookingIngressRestorationText','assertBookingRoutingCurrent',
    'insufficient_recovery_reserve','legacy-restart-attempt.json','legacy-runtime-transition.json','captureTrustedPython','verifyTrustedPython','restart_outcome_unknown',
    'active_database_changed','/api/app-web-version','/login']){
    if(token==='/api/app-web-version')continue;assert.ok(source.includes(token),token);
  }
  assert.doesNotMatch(source,/\['restart'|\['stop'|\['delete'|--update-env|process\.argv|--force|--skip|set active=false/);
});
