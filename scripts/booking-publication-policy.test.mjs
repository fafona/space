import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {BOOKING_RELEASE_LANE as lane,BOOKING_RELEASE_BASELINE as baseline,BOOKING_APPLICATION_FILES as app,BOOKING_TOOL_FILES as tooling,
 assertBookingReleaseScope,assertBookingReleaseClosure,bookingCandidateOverrides,bookingProtectedEnvironment,assertBookingCompatibilityEnvironment,
 buildBookingReleaseCandidate,BOOKING_RELEASE_BASELINE,bookingCandidateOverrides as overrides} from './booking-publication-policy.mjs';
import {loginCandidateEnvironmentText} from './merchant-login-release-policy.mjs';
import {onlinePublicationLane} from './online-traffic-publication-policy.mjs';
import {onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,onlineReleaseMigrationTarget} from './online-traffic-release-policy.mjs';
import {attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {readReviewedApplicationFixture} from './test-support/reviewed-application-fixture.mjs';
// Exercise the unchanged sealed application manifest against its historical
// workflow. The CI successor independently pins the four CURRENT CI files.
const sealed=JSON.parse(readFileSync(new URL('./test-support/booking-ci-source-base.json',import.meta.url),'utf8'));
const files=[...app,...tooling],readBlob=file=>file==='.github/workflows/ci.yml'?sealed.workflow:readReviewedApplicationFixture(file);
test('the exact independently approved booking closure has its own inactive compatibility publication lane',()=>{
 assert.equal(onlinePublicationLane(files),lane);assert.equal(onlineReleaseLane(files),lane);
 assert.equal(onlineReleaseStageStatus(lane),'staged');assert.equal(onlineReleaseActivationStatus(lane),'database-ready');
 assert.throws(()=>onlineReleaseMigrationTarget(lane),/booking_database_manager_required/);
 assert.match(assertBookingReleaseClosure({baseline,files,readBlob}),/^[a-f0-9]{64}$/);
 for(const file of app)assert.throws(()=>assertBookingReleaseScope(files.filter(f=>f!==file)),/scope_rejected/);
});
test('old lanes gain no authority; unrelated runtime, SQL, dependency, role and workflow edits are rejected',()=>{
 for(const extra of ['src/app/login/page.tsx','src/app/admin/AdminClient.tsx','src/lib/merchantOrders.server.ts','package-lock.json',
  'scripts/supabase-migrations/new.sql','.github/workflows/deploy.yml'])assert.throws(()=>onlinePublicationLane([...files,extra]),/scope_rejected/);
 for(const value of [null,[],[...files,files[0]]])assert.throws(()=>assertBookingReleaseScope(value),/scope_rejected/);
 for(const file of app)assert.throws(()=>assertBookingReleaseClosure({baseline,files,readBlob:f=>readBlob(f)+(f===file?'\nchanged':'')}),/application_content_rejected/);
 assert.throws(()=>assertBookingReleaseClosure({baseline:'a'.repeat(40),files,readBlob}),/baseline_invalid/);
 for(const file of tooling)assert.throws(()=>assertBookingReleaseClosure({baseline,files:files.filter(f=>f!==file),readBlob}),/scope_rejected|tool_closure_missing/);
});
test('compatibility publication cannot enable atomic storage, workers or silently adopt an already active baseline',()=>{
 const overrides=bookingCandidateOverrides({target:'a'.repeat(40),port:3104},'2026-10-26T00:00:00.000Z');
 assert.equal(overrides.MERCHANT_BOOKING_STORAGE_MODE,'legacy');assert.equal(overrides.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED,'0');
 assertBookingCompatibilityEnvironment(overrides);assertBookingCompatibilityEnvironment({}, {allowAbsent:true});
 for(const value of [{}, {...overrides,MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'}, {...overrides,MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1'}])assert.throws(()=>assertBookingCompatibilityEnvironment(value),/inactive/);
 assert.deepEqual(bookingProtectedEnvironment({KEEP:'unchanged',...overrides}),{FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',KEEP:'unchanged'});
});
test('new lane retains the exact existing sandbox and cannot fall back to an unbounded build',()=>{
 const input={lane,baseline,target:'a'.repeat(40),directory:'/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online',operation:'/var/lib/faolla-online-release/'+'a'.repeat(40),environment:{MERCHANT_BOOKING_STORAGE_MODE:'legacy',MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'0'}};
 const plan=buildBookingReleaseCandidate(input,attendanceOnlineBuildPlan);
 for(const value of ['MemoryMax=4294967296','CPUQuota=100%','TasksMax=128','RuntimeMaxSec=1200','PrivateNetwork=yes'])assert.ok(plan.properties.includes(value));
 for(const patch of [{lane:'traffic'},{baseline:'a'.repeat(40)},{environment:{MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'}}])assert.throws(()=>buildBookingReleaseCandidate({...input,...patch},()=>assert.fail('no build')),/scope_invalid|inactive/);
});
function verifierFixture(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyBookingPublication('),code.indexOf('async function verifyBookingDatabaseProof('));
 const digest=x=>createHash('sha256').update(x).digest('hex');
 const s={target:'a'.repeat(40),baseline,oldName:'baseline',oldDirectory:'/baseline',directory:'/candidate',port:3104,bookingBaselinePid:101,bookingClosureSha256:'closure'};
 const inherited={NODE_ENV:'production',KEEP:'synthetic-private-value',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',MERCHANT_ENTERPRISE_ATTENDANCE_ENABLED:'1'};
 const env={...inherited,...overrides(s,'2026-10-26T00:00:00Z'),PWD:s.directory,PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'};
 const p={pid:202,pm2_env:{...env}},prior={name:s.oldName,pid:101,pm2_env:{...inherited,status:'online',pm_cwd:'/baseline'}};
 const proof={target:s.target,buildId:'synthetic-build',guardedCommand:'npm run build',memoryBytes:4*1024**3,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0};
 const files=new Map([['/baseline/.env.local','KEEP=synthetic-private-value\n'],['/baseline/package-lock.json','same'],['/candidate/package-lock.json','same'],['/candidate/.env.local',loginCandidateEnvironmentText('KEEP=synthetic-private-value\n',overrides(s,env.FAOLLA_WEB_RELEASED_AT))],['/operation/runtime.json',JSON.stringify(env)],['/operation/attendance-build-proof.json',JSON.stringify(proof)],['/candidate/.next/BUILD_ID','synthetic-build']]);
 Object.assign(s,{bookingDependencyLockSha256:digest('same'),bookingRuntimeSha256:digest(files.get('/operation/runtime.json')),bookingBaselineEnvironmentFileSha256:digest(files.get('/baseline/.env.local')),bookingEnvironmentFileSha256:digest(files.get('/candidate/.env.local')),bookingInheritedEnvironmentSha256:digest(JSON.stringify(bookingProtectedEnvironment(inherited))),bookingBuildProofSha256:digest(JSON.stringify(proof))});
 const procEnv={101:{...inherited},202:{...env}};let dirty=false;
 const fn=runInNewContext(source+'verifyBookingPublication',{BOOKING_RELEASE_BASELINE,bookingResumeOwnedPath:()=>{},run:(_cmd,args)=>args[0]==='rev-parse'?s.target:dirty?'changed':'',bookingPublicationClosure:()=>s.bookingClosureSha256,hash:digest,safeFile:f=>{assert.ok(files.has(f),'synthetic file '+f);return files.get(f);},candidateEnvironment:()=>JSON.parse(files.get('/operation/runtime.json')),pm:()=>[prior],operation:'/operation',loginCandidateEnvironmentText,bookingCandidateOverrides:overrides,bookingProtectedEnvironment,webReleaseRuntimeEnvironment:x=>x,read:f=>procEnv[Number(f.split('/')[2])],assertBookingCompatibilityEnvironment,assertAttendanceCandidateEnvironment:()=>{},realpathSync:()=>s.directory,fail:c=>{throw Error(c);}});
 return {s,env,p,prior,procEnv,files,proof,run:()=>fn(s,true,p),dirty:()=>{dirty=true;},digest};
}
test('actual candidate verifier rejects source, process, file, environment, worker and bounded-build evidence drift',()=>{
 assert.doesNotThrow(()=>verifierFixture().run());
 for(const mutate of [f=>f.dirty(),f=>{f.s.baseline='b'.repeat(40);},f=>{f.prior.pid++;},f=>{f.prior.pm2_env.status='stopped';},
  f=>f.files.set('/candidate/package-lock.json','changed'),f=>f.files.set('/operation/runtime.json','{}'),f=>f.files.set('/candidate/.env.local','changed'),
  f=>{f.procEnv[101].KEEP='changed';},f=>{f.procEnv[202].KEEP='changed';},f=>{f.p.pm2_env.MERCHANT_BOOKING_STORAGE_MODE='atomic-v2';},
  f=>{f.p.pm2_env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED='1';},f=>{f.p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED='0';},
  f=>{f.files.set('/operation/attendance-build-proof.json',JSON.stringify({...f.proof,privateNetworkVerified:false}));f.s.bookingBuildProofSha256=f.digest(f.files.get('/operation/attendance-build-proof.json'));}]){
  const f=verifierFixture();mutate(f);assert.throws(()=>f.run(),/booking_publication_/);
 }
});
test('database compatibility, encrypted backup and inactive-schema proof all precede publication; no worker cutover is admitted',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'||action==='database-booking-compatibility-adapter'||action==='database-booking-registry-repair')"),end=code.indexOf("}else if(action==='activate')",start),branch=code.slice(start,end);
 assert.ok(start>0&&end>start);assert.match(branch,/const compatibility=action==='database-booking-registry-repair'\?runBookingRegistryCompatibility:action==='database-booking-compatibility-adapter'\?runBookingCompatibilityAdapter:runBookingCompatibility/);
 for(const pair of [['await compatibility','await createProductionDatabaseBackup'],['await createProductionDatabaseBackup','await verifyProductionDatabaseBackup'],['await verifyProductionDatabaseBackup','await installInactiveBookingSchema'],['await installInactiveBookingSchema',"s.status='database-ready'"]])assert.ok(branch.indexOf(pair[0])>=0&&branch.indexOf(pair[0])<branch.indexOf(pair[1]));
 const activate=code.slice(code.indexOf('async function activateCandidate('),code.indexOf('function bookingResumeOwnedPath('));
 assert.ok(activate.indexOf('await verifyBookingDatabaseProof(s)')<activate.indexOf('publishStatic('));
 assert.doesNotMatch(code,/MERCHANT_BOOKING_STORAGE_MODE:'atomic-v2'|MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED:'1'|pm2',\['(?:stop|delete)'/);
});

test('fixed formal-backup successor preserves compatibility proof and uses a fresh strict backup before inactive install',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database-booking-formal-backup'){"),end=code.indexOf("}else if(action==='database'||",start),branch=code.slice(start,end);
 assert.ok(start>0&&end>start);assert.match(branch,/s\.lane!==BOOKING_RELEASE_LANE\|\|s\.target!==BOOKING_HANDOFF_CANDIDATE\|\|s\.status!=='staged'/);
 assert.ok(branch.indexOf('await runBookingFormalBackup({lock:heldLock})')<branch.indexOf('await installInactiveBookingSchema('));
 assert.ok(branch.indexOf('await installInactiveBookingSchema(')<branch.indexOf("s.status='database-ready'"));
 assert.doesNotMatch(branch,/runBookingRegistryCompatibility|writeFileSync|createProductionDatabaseBackup|booking-compatibility\.json|backup\.key/);
});
