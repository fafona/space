import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ONLINE_RETENTION_POLICY, retentionHash} from './online-release-retention-policy.mjs';
import {assertArtifactMaintenanceScope, historicalArtifactContext, assertHistoricalStoppedDump,
  executeHistoricalArtifactMaintenance, ARTIFACT_MAINTENANCE_FILES} from './application-release-artifact-maintenance-policy.mjs';
import {artifactMaintenanceMain} from './application-release-artifact-maintenance.mjs';
import {applicationReleaseRole} from './application-release-policy.mjs';
const clone=structuredClone,sha=c=>c.repeat(40),hash=c=>c.repeat(64);
const dir=t=>'/www/wwwroot/merchant-space.web-releases/'+t.slice(0,12)+'-online';
function raw(t,id,port){const cwd=dir(t),name='merchant-space-online-'+t.slice(0,12);return {name,pm_id:id,pid:2000+id,pm2_env:{name,
  status:'online',pm_cwd:cwd,pm_exec_path:cwd+'/node_modules/next/dist/bin/next',exec_interpreter:'/usr/bin/node',
  args:['start','-H','127.0.0.1','-p',String(port)],PORT:String(port),node_args:[],exec_mode:'fork_mode',autorestart:true,
  watch:false,cron_restart:null,restart_time:0,created_at:1000+id,kill_timeout:1600,shutdown_with_message:false,
  FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',
  env:{PORT:String(port),SYNTHETIC_ONLY:'fixture-value'}}};}
function fixture(){
  const raws=[raw(sha('a'),1,3103),raw(sha('b'),2,3104),raw(sha('c'),3,3105),raw(sha('d'),4,3106)];
  const [a,b,c,d]=raws.map(normalizeRetirementProcess),sa={...a,pid:0,status:'stopped'},sd={...d,pid:0,status:'stopped'};
  const anchor=(p,t)=>({target:t,name:p.name,directory:p.cwd,port:p.port,process:clone(p)});
  const active=anchor(c,sha('c')),rollback=anchor(b,sha('b'));
  const certificate=(target,process,stopped,sequence,previousSha256,processes)=>({version:2,policy:ONLINE_RETENTION_POLICY,
    kind:'retire',status:'completed',sequence,previousSha256,legacySha256:hash('2'),rollingHeadSha256:hash('3'),rollingHistorySha256:hash('4'),
    beforeSha256:hash('5'),afterSha256:hash('6'),preparedSha256:hash('7'),recoverySha256:hash('8'),toolRevision:sha('f'),
    completedAt:'2026-11-16T05:00:00.000Z',active:clone(active),rollback:clone(rollback),victim:{target,process:clone(process)},
    stoppedProcess:clone(stopped),processes:clone(processes)});
  const first=certificate(sha('a'),a,sa,1,hash('1'),[sa,b,c,d]);
  const latest=certificate(sha('d'),d,sd,2,retentionHash(first),[sa,b,c,sd]);
  const history={version:2,policy:ONLINE_RETENTION_POLICY,rollingHistory:{legacyCertificates:[],entries:[]},entries:[first,latest],headSha256:retentionHash(latest)};
  const observation={retentionHead:history.headSha256,pm2:clone(latest.processes),certifiedStoppedDirectories:[a.cwd,d.cwd],protectedDirectories:[b.cwd,c.cwd,'/base/worker']};
  const window={phase:'stable',active:clone(active),stableRollback:clone(rollback)};
  return {input:{victimTarget:sha('a'),history,observation,window,active:Object.fromEntries(['target','name','directory','port'].map(k=>[k,active[k]]))},raws};
}
test('a historical certificate may prove its own stopped victim, never a fake newly-retired publication event',()=>{
  const {input}=fixture(),before=clone(input),result=historicalArtifactContext(input);
  assert.equal(result.victimTarget,sha('a'));assert.equal(result.activeTarget,sha('c'));assert.equal(result.rollbackTarget,sha('b'));
  assert.equal(result.retirementCertificateSha256,retentionHash(input.history.entries[0]));
  assert.notEqual(result.retirementCertificateSha256,input.history.headSha256);assert.deepEqual(input,before);
  result.stopped.args.push('not-input');assert.deepEqual(input,before);
});
for(const [label,change]of Object.entries({
  'current':x=>x.victimTarget=sha('c'),'rollback':x=>x.victimTarget=sha('b'),'unknown':x=>x.victimTarget=sha('e'),
  'bad SHA':x=>x.victimTarget='../a','rollback phase':x=>x.window.phase='rolled-back','wrong active':x=>x.active.target=sha('e'),
  'wrong window':x=>x.window.stableRollback.target=sha('e'),'bad head':x=>x.observation.retentionHead=hash('0'),
  'no certification':x=>x.observation.certifiedStoppedDirectories=[],
  'resource reference':x=>x.observation.protectedDirectories.push(dir(sha('a'))+'/.next/static'),
  'parent reference':x=>x.observation.protectedDirectories.push('/www/wwwroot/merchant-space.web-releases'),
  'online process':x=>x.observation.pm2[0].status='online','unexpected PID':x=>x.observation.pm2[0].pid=123,
  'restart drift':x=>x.observation.pm2[0].restartCount++,'birth drift':x=>x.observation.pm2[0].createdAt++,
  'environment drift':x=>x.observation.pm2[0].environmentSha256=hash('0'),
  'watch enabled':x=>x.observation.pm2[0].watch=true,'scheduled restart':x=>x.observation.pm2[0].cronRestart='* * * * *',
  'worker enabled':x=>x.observation.pm2[0].backgroundPaused='0',
  'alias':x=>x.observation.pm2.push({...x.observation.pm2[0],pmId:99}),
  'certificate duplicate':x=>x.history.entries.splice(0,0,clone(x.history.entries[0])),
})){test('refuses '+label,()=>{const{input}=fixture();change(input);assert.throws(()=>historicalArtifactContext(input));});}
test('saved stopped rows must match the currently certified birth/environment; online or restartable recovery rows reject',()=>{
  const f=fixture(),context=historicalArtifactContext(f.input),row={...clone(f.raws[0].pm2_env),status:'stopped'};
  assertHistoricalStoppedDump([row],context);
  for(const patch of [{status:'online'},{instances:1},{watch:true},{cron_restart:'0 * * * *'},{created_at:999},{pm_cwd:'/other'},
    {pm_exec_path:'/other'},{FAOLLA_BACKGROUND_JOBS_PAUSED:'0'}])assert.throws(()=>assertHistoricalStoppedDump([{...row,...patch}],context));
  assert.throws(()=>assertHistoricalStoppedDump([row,clone(row)],context));
});
test('maintenance-only scope never admits a website, migration, dependency, old guard or publication-rule change',()=>{
  assertArtifactMaintenanceScope([]);assertArtifactMaintenanceScope([...ARTIFACT_MAINTENANCE_FILES]);
  for(const file of ['src/app/page.tsx','package.json','scripts/online-release-artifact-policy.mjs','scripts/online-traffic-release.mjs',
    'scripts/supabase-migrations/anything.sql','release/application-release.json','../scripts/application-release-artifact-maintenance.mjs'])
    assert.throws(()=>assertArtifactMaintenanceScope([file]));
  assert.throws(()=>assertArtifactMaintenanceScope([ARTIFACT_MAINTENANCE_FILES[0],ARTIFACT_MAINTENANCE_FILES[0]]));
  for(const file of ARTIFACT_MAINTENANCE_FILES)assert.ok(['release-tool','verification'].includes(applicationReleaseRole(file)));
});
function ports(failure){const events=[],failures=[];const p={};
  for(const name of ['verify','begin','preserve','repairBackup','apply','complete'])p[name]=arg=>{const key=name==='verify'?arg:name;events.push(key);if(key===failure)throw Error('synthetic-private-value');if(name==='apply')return {removedAllocatedBytes:10};};
  p.failed=value=>{events.push('failed');failures.push(value);};return {p,events,failures};}
test('one guarded application, exact ordering and durable completion; no controller, stop, rebuild or SQL port',()=>{
  const f=ports();assert.deepEqual(executeHistoricalArtifactMaintenance({tree:{}},f.p),{removedAllocatedBytes:10});
  assert.deepEqual(f.events,['before-intent','begin','preserve','repairBackup','before-delete','apply','after-delete','complete']);assert.deepEqual(f.failures,[]);
});
for(const stage of ['before-intent','begin','preserve','repairBackup','before-delete','apply','after-delete','complete'])test('failure at '+stage+' never retries or invents completion',()=>{
  const f=ports(stage);assert.throws(()=>executeHistoricalArtifactMaintenance({tree:{}},f.p));
  assert.equal(f.events.filter(x=>x==='apply').length,stage==='apply'||['after-delete','complete'].includes(stage)?1:0);
  if(['before-intent','begin'].includes(stage))assert.deepEqual(f.failures,[]);
  else {assert.equal(f.failures.length,1);assert.equal(JSON.stringify(f.failures).includes('private-value'),false);
    assert.equal(f.failures[0].partialCleanupPossible,['apply','after-delete','complete'].includes(stage));}
});
test('production entry composes original locks, history, reboot-aware certification, tree and complete reference proofs',()=>{
  const src=readFileSync(new URL('./application-release-artifact-maintenance.mjs',import.meta.url),'utf8');
  for(const text of ['collectRemoteReleaseReview','inspectPinnedExecutionSource','assertArtifactMaintenanceScope','withOnlineToolPreparationLocks',
    'observeReleaseResources','readOnlineRetentionHistory','inspectOnlineRetentionWindow','assertNoRetiredArtifactReferences','captureRetiredArtifactTree',
    'applyRetiredArtifactTree','assertOnlineRetentionPersistedProcesses','assertHistoricalStoppedDump','buildRetiredBackupReplacement',
    'original-dump.pm2','original-dump.pm2.bak','attempt_already_started','automaticRetryAllowed:false'])assert.ok(src.includes(text),text);
  assert.match(src,/latest\.kind==='retire'&&latest\.victim\?\.target===context\.victimTarget/);
  assert.match(src,/observeApplicationRelease\(active\.target\)/);
  assert.equal(/\['(?:stop|restart|delete|save)'/.test(src),false);assert.equal(/rmSync|recursive\s*:\s*true|--force|pg_dump|psql|systemctl.*restart/.test(src),false);
});
test('invalid local production invocation refuses before host I/O or any mutation',async()=>{
  await assert.rejects(artifactMaintenanceMain(['inspect',sha('a'),sha('b')]),/^Error: artifact_maintenance_(?:invocation|entry)$/);
});
