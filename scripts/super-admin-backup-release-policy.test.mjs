import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {BACKUP_RELEASE_LANE as lane,BACKUP_RELEASE_BASELINE as baseline,BACKUP_APPLICATION_FILES as app,BACKUP_HISTORICAL_FILES as historical,BACKUP_TOOL_FILES as tooling,BACKUP_FOCUSED_TESTS,hasBackupReleaseAnchor,assertBackupReleaseScope,assertBackupReleaseClosure,backupProtectedEnvironment,assertBackupEnvironment,backupCandidateOverrides,backupCandidateEnvironmentText,buildBackupReleaseCandidate} from './super-admin-backup-release-policy.mjs';
import {onlinePublicationLane,ONLINE_PUBLICATION_SUPPORT_FILES} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations} from './online-traffic-release-policy.mjs';
import {attendanceOnlineBuildPlan,ATTENDANCE_BUILD_LIMITS} from './attendance-online-build.mjs';
const files=[...app,...historical,...tooling],target='a'.repeat(40);
test('only the complete approved repair gets a distinct no-database lane',()=>{
 for(const list of [app,files,[...files].reverse()]){
  assert.equal(onlinePublicationLane(list),lane);assert.equal(onlineReleaseLane(list),lane);
 }
 assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');assert.equal(onlineReleaseActivationStatus(lane),'ready-no-database');
 for(const action of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>action(lane),/database_forbidden/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,[]),/database_forbidden/);
 for(const file of app)assert.throws(()=>assertBackupReleaseScope(files.filter(name=>name!==file)),/scope_rejected/);
 assert.equal(hasBackupReleaseAnchor(tooling),false);
});
test('unknown runtime, SQL, API, dependencies, and generic support never become exemptions',()=>{
 for(const file of ['package.json','package-lock.json','.env.local','.github/workflows/ci.yml','src/lib/platformAdminBackupRestoreClient.ts','src/app/api/super-admin/data-backups/route.ts','scripts/supabase-migrations/202610180001_new.sql','src/lib/merchantAttendance.ts',...ONLINE_PUBLICATION_SUPPORT_FILES.filter(file=>!files.includes(file))]){
  assert.throws(()=>onlinePublicationLane([...files,file]),/scope_rejected/);
 }
 for(const list of [[...files,app[0]],['../'+app[0],...files],null,[]])assert.throws(()=>assertBackupReleaseScope(list),/scope_rejected/);
});
test('closure pins live baseline and all already-reviewed inert checker bytes',()=>{
 const readBlob=file=>Buffer.from(`fixture:${file}`);
 const digest=assertBackupReleaseClosure({baseline,files,readBlob});assert.match(digest,/^[a-f0-9]{64}$/);
 assert.throws(()=>assertBackupReleaseClosure({baseline:target,files,readBlob}),/baseline_invalid/);
 for(const changed of historical)assert.throws(()=>assertBackupReleaseClosure({baseline,files,readBlob:(file,revision)=>Buffer.from(`fixture:${file}:${file===changed&&!revision?'changed':'same'}`)}),/historical_source_changed/);
 assert.throws(()=>assertBackupReleaseClosure({baseline,files:files.filter(file=>file!==historical[0]),readBlob}),/historical_source_changed/);
});
test('entire protected environment stays identical and contextual PWD is explicit',()=>{
 const original={PATH:'/usr/bin',SUPABASE_SERVICE_ROLE_KEY:'fixture',FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'1',FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE:'off',PWD:'/old'};
 const next={...original,PWD:'/candidate',PORT:'3105',FAOLLA_WEB_BUILD_ID:target};
 assertBackupEnvironment(next,original);assert.deepEqual(backupProtectedEnvironment(next),backupProtectedEnvironment(original));
 for(const key of ['SUPABASE_SERVICE_ROLE_KEY','FAOLLA_ATTENDANCE_ROLLOUT_ENABLED','FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE','PATH']){
  assert.throws(()=>assertBackupEnvironment({...next,[key]:'changed'},original),/environment_changed/);
  const removed={...next};delete removed[key];assert.throws(()=>assertBackupEnvironment(removed,original),/environment_changed/);
 }
 assert.throws(()=>assertBackupEnvironment({...next,UNREVIEWED_KEY:'1'},original),/environment_changed/);
 const s={target,port:3105},changes=backupCandidateOverrides(s,'2026-10-18T12:00:00.000Z');
 assert.deepEqual(Object.keys(changes),['FAOLLA_WEB_BUILD_ID','NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID','FAOLLA_WEB_RELEASED_AT','FAOLLA_BACKGROUND_JOBS_PAUSED','MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED','MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED','FAOLLA_SUPER_ADMIN_ORIGIN','PORT']);
 const originalText='# preserve comment\nSUPABASE_SERVICE_ROLE_KEY=fixture\nCUSTOM_SETTING=keep\nPORT=3104\n';
 const text=backupCandidateEnvironmentText(originalText,changes);
 assert.ok(text.startsWith('# preserve comment\nSUPABASE_SERVICE_ROLE_KEY=fixture\nCUSTOM_SETTING=keep\n\n'));
 assert.equal((text.match(/^PORT=/gm)||[]).length,1);assert.ok(text.endsWith('PORT=3105\n'));
});
test('candidate reuses enforced sandbox, with no generic fallback or database authority',()=>{
 const input={lane,baseline,target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`,environment:{PATH:'/usr/bin',FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'1'}};
 let calls=0;const plan=buildBackupReleaseCandidate(input,value=>{calls++;return attendanceOnlineBuildPlan(value);});
 assert.equal(calls,1);assert.deepEqual(plan.command,['npm','run','build']);
 assert.equal(ATTENDANCE_BUILD_LIMITS.minimumAvailableBytes,6*1024**3);assert.equal(ATTENDANCE_BUILD_LIMITS.minimumDiskBytes,20*1024**3);
 for(const property of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes','ProtectSystem=strict'])assert.ok(plan.properties.includes(property));
 for(const patch of [{lane:'contact-wechat-code-only'},{baseline:target},{environment:{UNREVIEWED_SECRET:'fixture'}}])assert.throws(()=>buildBackupReleaseCandidate({...input,...patch},()=>{throw Error('must_not_build');}),/scope_invalid|environment_unreviewed/);
 for(const file of BACKUP_FOCUSED_TESTS)assert.ok(existsSync(fileURLToPath(new URL('../'+file,import.meta.url))),file);
});
test('controller requires source/env/build proof before startup, with no test production writes or retirement',()=>{
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(lane===BACKUP_RELEASE_LANE\)assertAttendanceBuildAdmission/);
 assert.match(source,/verifyBackupRelease\(s\);buildBackupReleaseCandidate/);
 assert.match(source,/s.backupBuildProofSha256=hash\(safeFile\(/);
 assert.match(source,/verifyBackupRelease\(s,true,p\)/);
 assert.match(source,/env.PWD=s.directory/);
 const branch=source.slice(source.indexOf('if(s.lane===BACKUP_RELEASE_LANE){'),source.indexOf("if(s.lane==='contact-wechat-code-only'){"));
 assert.match(branch,/victimTarget:null/);assert.doesNotMatch(branch,/reclaimPublicationArtifacts|completePublicationRetention/);
});
function verifierFixture(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyBackupRelease('),code.indexOf('function contactWechatProtectedEnvironment('));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const s={target,baseline,directory:'/candidate',oldDirectory:'/baseline',oldName:'baseline',backupBaselinePid:101,port:3105,backupClosureSha256:'closure'};
 const inherited={PATH:'/usr/bin',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'fixture',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE:'off',PWD:'/baseline'};
 const env={...inherited,...backupCandidateOverrides(s,'2026-10-18T12:00:00.000Z'),PWD:s.directory,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
 const prior={name:s.oldName,pid:101,pm2_env:{...inherited,status:'online',pm_cwd:s.oldDirectory}},p={pid:202,pm2_env:{...env}};
 const proof={target,buildId:'fixture-build',guardedCommand:'npm run build',memoryBytes:4*1024**3,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
 const files=new Map([['/candidate/package-lock.json','lock'],['/baseline/package-lock.json','lock'],['/operation/runtime.json',JSON.stringify(env)],['/baseline/.env.local','EXISTING=keep\n'],['/candidate/.next/BUILD_ID','fixture-build'],['/operation/attendance-build-proof.json',JSON.stringify(proof)]]);
 files.set('/candidate/.env.local',backupCandidateEnvironmentText(files.get('/baseline/.env.local'),backupCandidateOverrides(s,env.FAOLLA_WEB_RELEASED_AT)));
 Object.assign(s,{backupDependencyLockSha256:hash('lock'),backupRuntimeSha256:hash(files.get('/operation/runtime.json')),backupBaselineEnvironmentFileSha256:hash(files.get('/baseline/.env.local')),backupEnvironmentFileSha256:hash(files.get('/candidate/.env.local')),backupInheritedEnvironmentSha256:hash(JSON.stringify(backupProtectedEnvironment(env))),backupBuildProofSha256:hash(files.get('/operation/attendance-build-proof.json'))});
 const hooks={head:target,status:'',closure:'closure',owned:true},checked=[];
 const check=runInNewContext(`${source}verifyBackupRelease`,{BACKUP_RELEASE_BASELINE:baseline,operation:'/operation',hash,backupProtectedEnvironment,assertBackupEnvironment,backupCandidateEnvironmentText,backupCandidateOverrides,
  bookingResumeOwnedPath:path=>{checked.push(path);if(!hooks.owned)throw Error('path_not_owned');},
  run:(_command,args)=>args[0]==='rev-parse'?hooks.head:hooks.status,backupClosure:()=>hooks.closure,
  candidateEnvironment:()=>JSON.parse(files.get('/operation/runtime.json')),pm:()=>[prior],
  safeFile:path=>{if(!files.has(path))throw Error('missing_proof');return files.get(path);},
  read:path=>path==='/proc/101/environ'?inherited:env,webReleaseRuntimeEnvironment:value=>value,
  assertAttendanceCandidateEnvironment:()=>checked.push('attendance-settings'),realpathSync:()=>s.directory,
  fail:message=>{throw Error(message);},
 });
 return {s,env,inherited,prior,p,proof,files,hooks,checked,hash,check:()=>check(s,true,p)};
}
test('real controller verifier seals source, inherited settings, process identity and build evidence without writes',()=>{
 const good=verifierFixture();assert.doesNotThrow(good.check);assert.ok(good.checked.includes('/candidate/node_modules'));assert.ok(good.checked.includes('attendance-settings'));
 const mutations=[
  f=>{f.hooks.head='b'.repeat(40);},f=>{f.hooks.status=' M src/unreviewed.ts';},f=>{f.hooks.closure='wrong';},f=>{f.hooks.owned=false;},
  f=>{f.files.set('/candidate/package-lock.json','different');},f=>{f.files.set('/operation/runtime.json','{}');},
  f=>{f.files.set('/baseline/.env.local','changed');},f=>{f.files.set('/candidate/.env.local','changed');},
  f=>{f.inherited.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='on';},f=>{f.inherited.NEW_BUSINESS_SETTING='1';},
  f=>{f.prior.pid++;},f=>{f.prior.pm2_env.status='stopped';},f=>{f.p.pm2_env.PWD='/wrong';},
  f=>{f.p.pm2_env.FAOLLA_TRAFFIC_SIGNING_SECRET='changed';},f=>{f.env.PWD='/wrong';},
  f=>{f.files.delete('/operation/attendance-build-proof.json');},f=>{f.files.set('/candidate/.next/BUILD_ID','wrong');},
  ...['target','guardedCommand','memoryBytes','heapMiB','cpuQuotaPercent','tasks','seconds','privateNetworkVerified','swapBytes'].map(key=>f=>{
   f.files.set('/operation/attendance-build-proof.json',JSON.stringify({...f.proof,[key]:'wrong'}));
   f.s.backupBuildProofSha256=f.hash(f.files.get('/operation/attendance-build-proof.json'));
  }),
 ];
 for(const mutate of mutations){const fixture=verifierFixture();mutate(fixture);assert.throws(fixture.check,/super_admin_backup_|missing_proof|path_not_owned/);}
});
