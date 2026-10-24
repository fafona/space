import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {SCOPE_NAV_RELEASE_LANE as lane,SCOPE_NAV_RELEASE_BASELINE as baseline,SCOPE_NAV_APPLICATION_FILES as app,SCOPE_NAV_TOOL_FILES as tooling,SCOPE_NAV_FOCUSED_TESTS,hasScopeNavigationReleaseAnchor,assertScopeNavigationReleaseScope,assertScopeNavigationReleaseClosure,buildScopeNavigationReleaseCandidate} from './attendance-scope-navigation-release-policy.mjs';
import {loginProtectedEnvironment,assertLoginEnvironment,loginCandidateOverrides,loginCandidateEnvironmentText} from './merchant-login-release-policy.mjs';
import {onlinePublicationLane} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations} from './online-traffic-release-policy.mjs';
import {attendanceOnlineBuildPlan,ATTENDANCE_BUILD_LIMITS} from './attendance-online-build.mjs';
const files=[...app,...tooling],target='a'.repeat(40),root=new URL('../',import.meta.url);
const readBlob=file=>readFileSync(new URL(file,root),'utf8').replace(/\r\n/g,'\n');
test('the complete three-file pristine-scope UI repair has a distinct no-database lane',()=>{
 for(const list of [app,files,[...files].reverse()]){assert.equal(onlinePublicationLane(list),lane);assert.equal(onlineReleaseLane(list),lane);}
 assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');assert.equal(onlineReleaseActivationStatus(lane),'ready-no-database');
 for(const fn of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>fn(lane),/scope_navigation_release_database_forbidden/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,new Proxy([],{get(){assert.fail('no database reads');}})),/database_forbidden/);
 for(const file of app)assert.throws(()=>assertScopeNavigationReleaseScope(files.filter(x=>x!==file)),/scope_rejected/);
 assert.equal(hasScopeNavigationReleaseAnchor(tooling),false);
});
test('scope cannot admit adjacent data, permission, auth, API, worker, SQL, dependency, workflow or cleanup changes',()=>{
 for(const file of ['src/app/admin/AdminClient.tsx','src/app/api/bookings/route.ts','src/app/login/page.tsx','src/lib/merchantAttendanceManagementClient.ts','src/lib/merchantAttendanceScope.ts','src/app/api/merchant-enterprise/attendance/scopes/route.ts','src/lib/authSessionRecovery.ts','src/lib/browserAuthStorage.ts','package.json','package-lock.json','.env.local','.github/workflows/ci.yml','scripts/supabase-migrations/new.sql','scripts/online-release-artifact-cleanup.mjs','scripts/merchant-login-release-policy.mjs'])assert.throws(()=>onlinePublicationLane([...files,file]),/scope_rejected/);
 for(const list of [[],null,[...files,app[0]],['../'+app[0],...files]])assert.throws(()=>assertScopeNavigationReleaseScope(list),/scope_rejected/);
});
test('closure pins all three full application files, the exact live baseline, complete tools and every byte',()=>{
 const value=assertScopeNavigationReleaseClosure({baseline,files,readBlob});
 assert.match(value,/^[a-f0-9]{64}$/);assert.equal(assertScopeNavigationReleaseClosure({baseline,files:[...files].reverse(),readBlob}),value);
 assert.throws(()=>assertScopeNavigationReleaseClosure({baseline:target,files,readBlob}),/baseline_invalid/);
 for(const file of tooling)assert.throws(()=>assertScopeNavigationReleaseClosure({baseline,files:files.filter(x=>x!==file),readBlob}),/tool_closure_missing/);
 for(const file of app)assert.throws(()=>assertScopeNavigationReleaseClosure({baseline,files,readBlob:f=>readBlob(f)+(f===file?'\n// unexpected app edit':'')}),/application_content_rejected/);
 assert.notEqual(assertScopeNavigationReleaseClosure({baseline,files,readBlob:f=>readBlob(f)+(f===tooling[0]?'\n// fixture tool change':'')}),value);
});
test('bounded build retains private network, memory, CPU, tasks, no swap, time and admission without larger budgets',()=>{
 const input={lane,baseline,target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`,environment:{PATH:'/usr/bin'}};
 const plan=buildScopeNavigationReleaseCandidate(input,attendanceOnlineBuildPlan);
 for(const p of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes'])assert.ok(plan.properties.includes(p));
 assert.equal(ATTENDANCE_BUILD_LIMITS.minimumAvailableBytes,6*1024**3);assert.equal(ATTENDANCE_BUILD_LIMITS.minimumDiskBytes,20*1024**3);
 for(const patch of [{lane:'google-login-account-confirmation-code-only'},{baseline:target},{environment:{UNREVIEWED_SECRET:'fixture'}}])assert.throws(()=>buildScopeNavigationReleaseCandidate({...input,...patch},()=>assert.fail('no build')),/scope_invalid|environment_unreviewed/);
 for(const file of SCOPE_NAV_FOCUSED_TESTS)assert.ok(existsSync(new URL(file,root)),file);
 for(const file of ['src/lib/merchantAttendanceScopeNavigation.test.tsx','src/lib/merchantAttendanceManagementClient.test.ts','src/app/api/merchant-enterprise/attendance/scopes/route.test.ts'])assert.ok(SCOPE_NAV_FOCUSED_TESTS.includes(file));
});
function verifierFixture(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyScopeNavigationRelease('),code.indexOf('function googleLoginClosure('));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const s={target,baseline,directory:'/candidate',oldDirectory:'/baseline',oldName:'baseline',scopeNavigationBaselinePid:101,port:3105,scopeNavigationClosureSha256:'closure'};
 const inherited={PATH:'/usr/bin',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'fixture',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE:'off',PWD:'/baseline'};
 const env={...inherited,...loginCandidateOverrides(s,'2026-10-18T12:00:00.000Z'),PWD:s.directory,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
 const prior={name:s.oldName,pid:101,pm2_env:{...inherited,status:'online',pm_cwd:s.oldDirectory}},p={pid:202,pm2_env:{...env}};
 const proof={target,buildId:'fixture-build',guardedCommand:'npm run build',memoryBytes:4*1024**3,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
 const files=new Map([['/candidate/package-lock.json','lock'],['/baseline/package-lock.json','lock'],['/operation/runtime.json',JSON.stringify(env)],['/baseline/.env.local','EXISTING=keep\n'],['/candidate/.next/BUILD_ID','fixture-build'],['/operation/attendance-build-proof.json',JSON.stringify(proof)]]);
 files.set('/candidate/.env.local',loginCandidateEnvironmentText(files.get('/baseline/.env.local'),loginCandidateOverrides(s,env.FAOLLA_WEB_RELEASED_AT)));
 Object.assign(s,{scopeNavigationDependencyLockSha256:hash('lock'),scopeNavigationRuntimeSha256:hash(files.get('/operation/runtime.json')),scopeNavigationBaselineEnvironmentFileSha256:hash(files.get('/baseline/.env.local')),scopeNavigationEnvironmentFileSha256:hash(files.get('/candidate/.env.local')),scopeNavigationInheritedEnvironmentSha256:hash(JSON.stringify(loginProtectedEnvironment(env))),scopeNavigationBuildProofSha256:hash(files.get('/operation/attendance-build-proof.json'))});
 const hooks={head:target,status:'',closure:'closure',owned:true},checked=[];
 const check=runInNewContext(`${source}verifyScopeNavigationRelease`,{SCOPE_NAV_RELEASE_BASELINE:baseline,operation:'/operation',hash,loginProtectedEnvironment,assertLoginEnvironment,loginCandidateEnvironmentText,loginCandidateOverrides,
  bookingResumeOwnedPath:path=>{checked.push(path);if(!hooks.owned)throw Error('path_not_owned');},
  run:(_command,args)=>args[0]==='rev-parse'?hooks.head:hooks.status,scopeNavigationClosure:()=>hooks.closure,
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
   f.s.scopeNavigationBuildProofSha256=f.hash(f.files.get('/operation/attendance-build-proof.json'));
  }),
 ];
 for(const mutate of mutations){const fixture=verifierFixture();mutate(fixture);assert.throws(fixture.check,/scope_navigation_|super_admin_backup_release_environment_changed|missing_proof|path_not_owned/);}
});

test('controller wires scope-only source, environment, budget, smoke, rollback and convergence gates without retirement',()=>{
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 for(const part of ['if(lane===SCOPE_NAV_RELEASE_LANE)assertAttendanceBuildAdmission','verifyScopeNavigationRelease(s);buildScopeNavigationReleaseCandidate','s.scopeNavigationBuildProofSha256=hash(safeFile(','verifyScopeNavigationRelease(s,true,p)','env:lane===SCOPE_NAV_RELEASE_LANE||lane===GOOGLE_LOGIN_RELEASE_LANE||lane===LOGIN_RELEASE_LANE?loginUnitTestEnvironment():env','s.scopeNavigationDependenciesSha256','let scopeNavigationBaseline;'])assert.ok(source.includes(part),part);
 const retention=source.slice(source.indexOf(' if(s.lane===SCOPE_NAV_RELEASE_LANE){'),source.indexOf(' if(s.lane===GOOGLE_LOGIN_RELEASE_LANE){'));
 assert.match(retention,/victimTarget:null/);assert.doesNotMatch(retention,/completePublicationRetention|reclaimPublicationArtifacts|kind:'retire'/);
 const smoke=source.slice(source.indexOf(' if(s.lane===SCOPE_NAV_RELEASE_LANE){',source.indexOf('async function smoke(')),source.indexOf(' if(s.lane===GOOGLE_LOGIN_RELEASE_LANE){',source.indexOf('async function smoke(')));
 for(const part of ['assertContactWechatResponse','data-backups','contactWechatAttendanceSmoke','merchantLoginReleaseProbeFetch','authenticated!==false'])assert.ok(smoke.includes(part),part);
 assert.match(source,/s.lane===SCOPE_NAV_RELEASE_LANE\|\|s.lane===GOOGLE_LOGIN_RELEASE_LANE/);
});
