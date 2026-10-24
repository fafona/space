import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {GOOGLE_LOGIN_RELEASE_LANE as lane,GOOGLE_LOGIN_RELEASE_BASELINE as baseline,GOOGLE_LOGIN_REVIEWED_MAIN,GOOGLE_LOGIN_APPLICATION_FILES as app,GOOGLE_LOGIN_TOOL_FILES as tooling,GOOGLE_LOGIN_INHERITED_TOOLS,GOOGLE_LOGIN_FOCUSED_TESTS,hasGoogleLoginReleaseAnchor,assertGoogleLoginReleaseScope,assertGoogleLoginReleaseClosure,buildGoogleLoginReleaseCandidate} from './google-login-release-policy.mjs';
import {loginProtectedEnvironment,assertLoginEnvironment,loginCandidateOverrides,loginCandidateEnvironmentText} from './merchant-login-release-policy.mjs';
import {onlinePublicationLane} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations} from './online-traffic-release-policy.mjs';
import {attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
const files=[...app,...tooling],target='a'.repeat(40);
const root=new URL('../',import.meta.url);
// Synthetic baseline port keeps unit tests independent of checkout depth.
// The real controller reads both revisions using git show before any write.
const readCurrentBlob=file=>readFileSync(new URL(file,root),'utf8').replace(/\r\n/g,'\n');
// Immutable reviewed page, not today's UI: old production pins stay unchanged.
const readBlob=file=>readCurrentBlob(file==='src/app/login/page.tsx'?'scripts/fixtures/google-login-account-confirmation-page-20261023.txt':file);
test('only the complete three-file Google repair has the distinct no-database lane',()=>{
 for(const list of [app,files,[...files].reverse()]){assert.equal(onlinePublicationLane(list),lane);assert.equal(onlineReleaseLane(list),lane);}
 assert.equal(onlineReleaseStageStatus(lane),'ready-no-database');assert.equal(onlineReleaseActivationStatus(lane),'ready-no-database');
 for(const fn of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>fn(lane),/google_login_release_database_forbidden/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,new Proxy([],{get(){assert.fail('no database reads');}})),/database_forbidden/);
 for(const file of app)assert.throws(()=>assertGoogleLoginReleaseScope(files.filter(x=>x!==file)),/scope_rejected/);
 assert.equal(hasGoogleLoginReleaseAnchor(tooling),false);
});
test('no unrelated auth, app, SQL, dependency, workflow, config or cleanup implementation gets authority',()=>{
 for(const file of ['src/app/admin/AdminClient.tsx','src/app/api/bookings/route.ts','src/lib/authSessionRecovery.ts','src/lib/browserAuthStorage.ts','package-lock.json','.env.local','.github/workflows/ci.yml','scripts/supabase-migrations/new.sql','scripts/online-release-artifact-cleanup.mjs','scripts/merchant-login-release-policy.mjs'])assert.throws(()=>onlinePublicationLane([...files,file]),/scope_rejected/);
 for(const list of [[],null,[...files,app[0]],['../'+app[0],...files]])assert.throws(()=>assertGoogleLoginReleaseScope(list),/scope_rejected/);
});
test('closure pins full application content, inherited tools, exact baseline and every byte',()=>{
 const digest=assertGoogleLoginReleaseClosure({baseline,files,readBlob});
 assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(assertGoogleLoginReleaseClosure({baseline,files:[...files].reverse(),readBlob}),digest);
 assert.throws(()=>assertGoogleLoginReleaseClosure({baseline:target,files,readBlob}),/baseline_invalid/);
 for(const file of tooling)assert.throws(()=>assertGoogleLoginReleaseClosure({baseline,files:files.filter(x=>x!==file),readBlob}),/tool_closure_missing/);
 for(const file of ['package.json','src/app/login/page.tsx'])assert.throws(()=>assertGoogleLoginReleaseClosure({baseline,files,readBlob:(f,r)=>readBlob(f,r)+(f===file?'\n// unexpected app edit':'')}),/application_content_rejected/);
 for(const file of GOOGLE_LOGIN_INHERITED_TOOLS)assert.throws(()=>assertGoogleLoginReleaseClosure({baseline,files,readBlob:(f,r)=>readBlob(f,r)+(f===file&&!r?'changed':'')}),/inherited_tool_changed/);
 assert.notEqual(assertGoogleLoginReleaseClosure({baseline,files,readBlob:(f,r)=>readBlob(f,r)+(f==='src/app/login/googleOAuthSignIn.test.ts'?'\n// fixture change':'')}),digest);
 assert.equal(GOOGLE_LOGIN_REVIEWED_MAIN,'5447e076c66eeda5ef61833f2d2e7ac511041eb2');
});
test('the original Google lane still rejects the later loading-only page',()=>{
 assert.throws(()=>assertGoogleLoginReleaseClosure({baseline,files,readBlob:readCurrentBlob}),/application_content_rejected/);
});

test('build retains private-network, memory, CPU, task and time budgets and rejects other input',()=>{
 const input={lane,baseline,target,directory:`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`,operation:`/var/lib/faolla-online-release/${target}`,environment:{PATH:'/usr/bin'}};
 const plan=buildGoogleLoginReleaseCandidate(input,attendanceOnlineBuildPlan);
 for(const p of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes'])assert.ok(plan.properties.includes(p));
 for(const patch of [{lane:'merchant-login-recovery-code-only'},{baseline:target},{environment:{UNREVIEWED_SECRET:'fixture'}}])assert.throws(()=>buildGoogleLoginReleaseCandidate({...input,...patch},()=>assert.fail('no build')),/scope_invalid|environment_unreviewed/);
 for(const file of GOOGLE_LOGIN_FOCUSED_TESTS)assert.ok(existsSync(new URL(file,root)),file);
});
function verifierFixture(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyGoogleLoginRelease('),code.indexOf('function loginClosure('));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const s={target,baseline,directory:'/candidate',oldDirectory:'/baseline',oldName:'baseline',googleLoginBaselinePid:101,port:3105,googleLoginClosureSha256:'closure'};
 const inherited={PATH:'/usr/bin',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'fixture',FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE:'off',PWD:'/baseline'};
 const env={...inherited,...loginCandidateOverrides(s,'2026-10-18T12:00:00.000Z'),PWD:s.directory,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
 const prior={name:s.oldName,pid:101,pm2_env:{...inherited,status:'online',pm_cwd:s.oldDirectory}},p={pid:202,pm2_env:{...env}};
 const proof={target,buildId:'fixture-build',guardedCommand:'npm run build',memoryBytes:4*1024**3,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
 const files=new Map([['/candidate/package-lock.json','lock'],['/baseline/package-lock.json','lock'],['/operation/runtime.json',JSON.stringify(env)],['/baseline/.env.local','EXISTING=keep\n'],['/candidate/.next/BUILD_ID','fixture-build'],['/operation/attendance-build-proof.json',JSON.stringify(proof)]]);
 files.set('/candidate/.env.local',loginCandidateEnvironmentText(files.get('/baseline/.env.local'),loginCandidateOverrides(s,env.FAOLLA_WEB_RELEASED_AT)));
 Object.assign(s,{googleLoginDependencyLockSha256:hash('lock'),googleLoginRuntimeSha256:hash(files.get('/operation/runtime.json')),googleLoginBaselineEnvironmentFileSha256:hash(files.get('/baseline/.env.local')),googleLoginEnvironmentFileSha256:hash(files.get('/candidate/.env.local')),googleLoginInheritedEnvironmentSha256:hash(JSON.stringify(loginProtectedEnvironment(env))),googleLoginBuildProofSha256:hash(files.get('/operation/attendance-build-proof.json'))});
 const hooks={head:target,status:'',closure:'closure',owned:true},checked=[];
 const check=runInNewContext(`${source}verifyGoogleLoginRelease`,{GOOGLE_LOGIN_RELEASE_BASELINE:baseline,operation:'/operation',hash,loginProtectedEnvironment,assertLoginEnvironment,loginCandidateEnvironmentText,loginCandidateOverrides,
  bookingResumeOwnedPath:path=>{checked.push(path);if(!hooks.owned)throw Error('path_not_owned');},
  run:(_command,args)=>args[0]==='rev-parse'?hooks.head:hooks.status,googleLoginClosure:()=>hooks.closure,
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
   f.s.googleLoginBuildProofSha256=f.hash(f.files.get('/operation/attendance-build-proof.json'));
  }),
 ];
 for(const mutate of mutations){const fixture=verifierFixture();mutate(fixture);assert.throws(fixture.check,/google_login_|super_admin_backup_release_environment_changed|missing_proof|path_not_owned/);}
});

test('controller wires Google-only ownership, budget, unit environment, smoke, rollback and convergence gates',()=>{
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 for(const part of ['if(lane===GOOGLE_LOGIN_RELEASE_LANE)assertAttendanceBuildAdmission','verifyGoogleLoginRelease(s);buildGoogleLoginReleaseCandidate','s.googleLoginBuildProofSha256=hash(safeFile(','verifyGoogleLoginRelease(s,true,p)','env:lane===GOOGLE_TRANSITION_RELEASE_LANE||lane===SCOPE_NAV_RELEASE_LANE||lane===GOOGLE_LOGIN_RELEASE_LANE||lane===LOGIN_RELEASE_LANE?loginUnitTestEnvironment():env','s.googleLoginDependenciesSha256','let googleLoginBaseline;'])assert.ok(source.includes(part),part);
 const retention=source.slice(source.indexOf(' if(s.lane===GOOGLE_LOGIN_RELEASE_LANE){'),source.indexOf(' if(s.lane===LOGIN_RELEASE_LANE){'));
 assert.match(retention,/victimTarget:null/);assert.doesNotMatch(retention,/completePublicationRetention|reclaimPublicationArtifacts/);
 const smoke=source.slice(source.indexOf(' if(s.lane===GOOGLE_LOGIN_RELEASE_LANE){',source.indexOf('async function smoke(')),source.indexOf(' if(s.lane===LOGIN_RELEASE_LANE){',source.indexOf('async function smoke(')));
 for(const part of ['assertContactWechatResponse','data-backups','contactWechatAttendanceSmoke','merchantLoginReleaseProbeFetch','authenticated!==false'])assert.ok(smoke.includes(part),part);
 assert.match(source,/s.lane===GOOGLE_LOGIN_RELEASE_LANE\|\|s.lane===LOGIN_RELEASE_LANE/);
});
