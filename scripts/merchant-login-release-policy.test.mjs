import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {LOGIN_RELEASE_LANE as lane,LOGIN_RELEASE_BASELINE as baseline,LOGIN_APPLICATION_FILES as app,LOGIN_TOOL_FILES as tooling,LOGIN_FOCUSED_TESTS,hasLoginReleaseAnchor,assertLoginReleaseScope,assertLoginReleaseClosure,loginProtectedEnvironment,assertLoginEnvironment,loginCandidateOverrides,loginCandidateEnvironmentText,buildLoginReleaseCandidate} from './merchant-login-release-policy.mjs';
import {onlinePublicationLane,ONLINE_PUBLICATION_SUPPORT_FILES} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations} from './online-traffic-release-policy.mjs';
import {attendanceOnlineBuildPlan,ATTENDANCE_BUILD_LIMITS} from './attendance-online-build.mjs';
const files=[...app,...tooling],target='a'.repeat(40);
test('only the complete six-file login repair gets its own no-database lane',()=>{
 for(const list of [app,files,[...files].reverse()]){
  assert.equal(onlinePublicationLane(list),lane);assert.equal(onlineReleaseLane(list),lane);
 }
 assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');assert.equal(onlineReleaseActivationStatus(lane),'ready-no-database');
 for(const action of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>action(lane),/database_forbidden/);
 const poisonous=new Proxy([],{get(){assert.fail('database denial must happen first');}});
 assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,poisonous),/database_forbidden/);
 for(const file of app)assert.throws(()=>assertLoginReleaseScope(files.filter(name=>name!==file)),/scope_rejected/);
 assert.equal(hasLoginReleaseAnchor(tooling),false);
});
test('all other auth, business, SQL, dependency and workflow files remain forbidden',()=>{
 for(const file of ['package.json','package-lock.json','.env.local','.github/workflows/ci.yml','src/lib/browserAuthStorage.ts','src/app/api/auth/signin/route.ts','src/lib/merchantAuthSession.ts','src/lib/merchantAttendance.ts','scripts/supabase-migrations/new.sql',...ONLINE_PUBLICATION_SUPPORT_FILES.filter(file=>!files.includes(file))])assert.throws(()=>onlinePublicationLane([...files,file]),/scope_rejected/);
 for(const list of [[...files,app[0]],['../'+app[0],...files],null,[]])assert.throws(()=>assertLoginReleaseScope(list),/scope_rejected/);
});
test('closure requires the exact live baseline and complete tools and binds every source byte',()=>{
 const readBlob=file=>Buffer.from(`fixture:${file}`);
 const digest=assertLoginReleaseClosure({baseline,files,readBlob});assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(assertLoginReleaseClosure({baseline,files:[...files].reverse(),readBlob}),digest);
 assert.throws(()=>assertLoginReleaseClosure({baseline:target,files,readBlob}),/baseline_invalid/);
 for(const file of tooling)assert.throws(()=>assertLoginReleaseClosure({baseline,files:files.filter(name=>name!==file),readBlob}),/tool_closure_missing/);
 assert.notEqual(assertLoginReleaseClosure({baseline,files,readBlob:file=>Buffer.from('changed:'+file)}),digest);
});
test('build uses unchanged bounded sandbox and rejects other baselines and environments',()=>{
 const input={lane,baseline,target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`,environment:{PATH:'/usr/bin',FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'1'}};
 const plan=buildLoginReleaseCandidate(input,attendanceOnlineBuildPlan);
 assert.deepEqual(plan.command,['npm','run','build']);
 assert.equal(ATTENDANCE_BUILD_LIMITS.minimumAvailableBytes,6*1024**3);
 for(const property of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes'])assert.ok(plan.properties.includes(property));
 for(const patch of [{lane:'super-admin-backup-code-only'},{baseline:target},{environment:{UNREVIEWED_SECRET:'fixture'}}])assert.throws(()=>buildLoginReleaseCandidate({...input,...patch},()=>assert.fail('must not build')),/scope_invalid|environment_unreviewed/);
 for(const file of LOGIN_FOCUSED_TESTS)assert.ok(existsSync(fileURLToPath(new URL('../'+file,import.meta.url))),file);
});
function verifierFixture(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyLoginRelease('),code.indexOf('function backupClosure('));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const s={target,baseline,directory:'/candidate',oldDirectory:'/baseline',oldName:'baseline',loginBaselinePid:101,port:3105,loginClosureSha256:'closure'};
 const inherited={PATH:'/usr/bin',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'fixture',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE:'off',PWD:'/baseline'};
 const env={...inherited,...loginCandidateOverrides(s,'2026-10-18T12:00:00.000Z'),PWD:s.directory,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
 const prior={name:s.oldName,pid:101,pm2_env:{...inherited,status:'online',pm_cwd:s.oldDirectory}},p={pid:202,pm2_env:{...env}};
 const proof={target,buildId:'fixture-build',guardedCommand:'npm run build',memoryBytes:4*1024**3,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
 const files=new Map([['/candidate/package-lock.json','lock'],['/baseline/package-lock.json','lock'],['/operation/runtime.json',JSON.stringify(env)],['/baseline/.env.local','EXISTING=keep\n'],['/candidate/.next/BUILD_ID','fixture-build'],['/operation/attendance-build-proof.json',JSON.stringify(proof)]]);
 files.set('/candidate/.env.local',loginCandidateEnvironmentText(files.get('/baseline/.env.local'),loginCandidateOverrides(s,env.FAOLLA_WEB_RELEASED_AT)));
 Object.assign(s,{loginDependencyLockSha256:hash('lock'),loginRuntimeSha256:hash(files.get('/operation/runtime.json')),loginBaselineEnvironmentFileSha256:hash(files.get('/baseline/.env.local')),loginEnvironmentFileSha256:hash(files.get('/candidate/.env.local')),loginInheritedEnvironmentSha256:hash(JSON.stringify(loginProtectedEnvironment(env))),loginBuildProofSha256:hash(files.get('/operation/attendance-build-proof.json'))});
 const hooks={head:target,status:'',closure:'closure',owned:true},checked=[];
 const check=runInNewContext(`${source}verifyLoginRelease`,{LOGIN_RELEASE_BASELINE:baseline,operation:'/operation',hash,loginProtectedEnvironment,assertLoginEnvironment,loginCandidateEnvironmentText,loginCandidateOverrides,
  bookingResumeOwnedPath:path=>{checked.push(path);if(!hooks.owned)throw Error('path_not_owned');},
  run:(_command,args)=>args[0]==='rev-parse'?hooks.head:hooks.status,loginClosure:()=>hooks.closure,
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
   f.s.loginBuildProofSha256=f.hash(f.files.get('/operation/attendance-build-proof.json'));
  }),
 ];
 for(const mutate of mutations){const fixture=verifierFixture();mutate(fixture);assert.throws(fixture.check,/merchant_login_|super_admin_backup_release_environment_changed|missing_proof|path_not_owned/);}
});

test('controller wires every source/env/build gate and has no database, retirement or production write smoke',()=>{
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(lane===LOGIN_RELEASE_LANE\)assertAttendanceBuildAdmission/);
 assert.match(source,/verifyLoginRelease\(s\);buildLoginReleaseCandidate/);
 assert.match(source,/s.loginBuildProofSha256=hash\(safeFile\(/);
 assert.match(source,/verifyLoginRelease\(s,true,p\)/);
 assert.match(source,/old.port!==3105/);
 assert.match(source,/merchantLoginReleaseProbeFetch\(`/);
 const branch=source.slice(source.indexOf('if(s.lane===LOGIN_RELEASE_LANE){'),source.indexOf('if(s.lane===BACKUP_RELEASE_LANE){'));
 assert.match(branch,/victimTarget:null/);assert.doesNotMatch(branch,/reclaimPublicationArtifacts|completePublicationRetention/);
});
