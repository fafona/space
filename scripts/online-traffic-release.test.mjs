import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {assertRetainedOnlineProcesses} from './online-release-retirement-policy.mjs';
import {assertOnlineTrafficScope,onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations,assertOrderAttentionReleaseProof,assertPendingTrafficMigrations,onlineProxy,hasExpectedCardWebsite,STATIC_RECOVERY_TOOL_FILES,assertStaticRecoveryToolScope,assertCatalogStaticRecoveryState} from './online-traffic-release-policy.mjs';

function retainedProcessHarness(){
 const sha=x=>x.repeat(40),name=x=>`merchant-space-online-${x.repeat(12)}`,cwd=x=>`/www/wwwroot/merchant-space.web-releases/${x.repeat(12)}-online`;
 const raw=(x,id,port)=>({name:name(x),pm_id:id,pid:id+100,pm2_env:{pm_cwd:cwd(x),status:'online',PORT:String(port),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0'}});
 const original=[raw('a',1,3110),raw('b',2,3109),raw('c',3,3103)];
 const certificate={version:1,status:'completed',victim:{target:sha('c'),name:name('c'),pmId:3,pid:103,cwd:cwd('c'),port:3103},activeTarget:sha('a'),rollbackTarget:sha('b'),nextTarget:sha('d'),allowedActiveTargets:[sha('a'),sha('b'),sha('d')],beforeSha256:'1'.repeat(64),afterSha256:'2'.repeat(64),completedAt:'2026-09-27T18:00:00.000Z'};
 const current=structuredClone(original);current[2].pid=0;current[2].pm2_env.status='stopped';
 const source=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const helpers=source.slice(source.indexOf('const protectedBaseProcesses='),source.indexOf('async function request('));
 const saved=original.map(p=>({name:p.name,pid:p.pid,cwd:p.pm2_env.pm_cwd}));
 const s={target:sha('a'),name:name('a'),oldName:name('b'),processes:saved};
 const normalize=p=>({name:p.name,pmId:p.pm_id,pid:p.pid,cwd:p.pm2_env.pm_cwd,status:p.pm2_env.status,port:Number(p.pm2_env.PORT),backgroundPaused:p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED,automationEnabled:p.pm2_env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,invitationEnabled:p.pm2_env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED});
 certificate.stoppedProcess=normalize(current[2]);
 const execute=(expression,{certificates=[certificate],all=current,state=s}={})=>runInNewContext(`${helpers}${expression}`,{s:state,all,releaseTarget:sha('d'),oldName:name('a'),readOnlineRetirementCertificates:()=>certificates,normalizeRetirementProcess:normalize,assertRetainedOnlineProcesses,fail:m=>{throw Error(m);}});
 return {sha,name,cwd,original,current,certificate,s,execute,source};
}

test('historical process checks retain original strict behavior without a retirement certificate',()=>{
 const h=retainedProcessHarness();
 assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[],all:h.original}));
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[]}),/existing_process_changed/);
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{certificates:[],all:h.original.slice(0,2)}),/existing_process_changed/);
});

test('one certified stopped entry supports new-to-current-to-previous rollback without rewriting old snapshots',()=>{
 const h=retainedProcessHarness(),before=structuredClone(h.s);
 for(const target of ['a','b','d'])assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha(target)}}));
 assert.deepEqual(h.s,before);
 const next=JSON.parse(JSON.stringify(h.execute('snapshotRetainedProcesses(all,releaseTarget,oldName)')));
 assert.deepEqual(next,h.s.processes.slice(0,2));
 assert.doesNotThrow(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha('d'),processes:next}}));
 assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,target:h.sha('e')}}),/certificate_anchor_rejected/);
 for(const key of ['name','oldName'])assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{state:{...h.s,[key]:h.name('c')}}),/certificate_anchor_rejected/);
});

test('retirement cannot mask absent restarted replaced or unrelated stopped processes during stage or rollback',()=>{
 const h=retainedProcessHarness();
 const changes=[all=>all.pop(),all=>{all[2].pid=103;all[2].pm2_env.status='online';},all=>{all[2].pm_id=9;},all=>{all[2].pm2_env.pm_cwd='/replacement';},all=>{all[1].pid=0;all[1].pm2_env.status='stopped';}];
 for(const change of changes){const all=structuredClone(h.current);change(all);
  assert.throws(()=>h.execute('verifyRetainedProcesses(s,all)',{all}),/online_retirement_/);
  assert.throws(()=>h.execute('snapshotRetainedProcesses(all,releaseTarget,oldName)',{all}),/online_retirement_/);
 }
});

test('retirement wiring precedes baseline HTTP acceptance and persists only a verified new snapshot',()=>{
 const {source}=retainedProcessHarness();
 const verify=source.slice(source.indexOf('async function verifyBase('),source.indexOf('function configUnchanged('));
 assert.ok(verify.indexOf('verifyRetainedProcesses(s,pm())')<verify.indexOf('baseline_version_changed'));
 assert.match(source,/processes:snapshotRetainedProcesses\(all,target,old.name\)/);
 assert.match(source,/if\(lane==='runtime-performance'\)run\('node',\['--test','scripts\/online-release-retirement-policy.test.mjs','scripts\/online-release-retirement.test.mjs'\]/);
 assert.doesNotMatch(source,/pm2.*\['(?:stop|delete)'/);
});

test('QR export lane admits only the requested client feature and exact release tooling',()=>{
 const feature=['src/lib/merchantBusinessCardQrExport.ts','src/lib/merchantBusinessCardQrExport.test.ts','src/components/admin/BusinessCardQrExportDialog.tsx','src/components/admin/MerchantBusinessCardManager.tsx'];
 assert.equal(onlineReleaseLane(feature),'qr-export');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficCampaign.server.ts']),'traffic');
 for(const file of ['src/app/api/polls/route.ts','src/lib/superAdminVerification.ts','src/lib/merchantBusinessCards.ts','src/data/platformControlStore.ts','package-lock.json','scripts/supabase-migrations/202609230049_account_traffic_events.sql','scripts/production-maintenance-attempt-recovery-evidence.mjs'])assert.throws(()=>onlineReleaseLane([...feature,file]));
 assert.equal(onlineReleaseLane([...feature,'scripts/production-maintenance-attempt-recovery-evidence.test.mjs']),'qr-export');
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.throws(()=>assertOnlineReleaseDatabaseAllowed('qr-export'),/qr_export_database_forbidden/);
 assert.equal(onlineReleaseStageStatus('qr-export'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('qr-export'),'ready-no-database');
 assert.match(code,/assertOnlineReleaseDatabaseAllowed\(s.lane\)/);
 assert.match(code,/s.status=onlineReleaseStageStatus\(lane\)/);
 assert.match(code,/lane==='traffic'\?\{FAOLLA_TRAFFIC_ENABLED:'0'/);
 assert.match(code,/qr_export_analytics_baseline_invalid/);
});

const performanceRuntimeFiles=[
 'src/app/admin/AdminClient.tsx','src/components/admin/MerchantCustomerManager.tsx',
 'src/lib/merchantCustomers.ts','src/lib/merchantCustomerListViewport.ts',
 'src/lib/performanceTelemetry.ts','src/lib/visiblePolling.ts',
];
const performanceAcceptanceFiles=[
 'src/app/admin/AdminClient.attention.test.ts',
 'src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/components/admin/MerchantCustomerManager.contract.test.ts',
 'src/lib/merchantCustomers.test.ts','src/lib/merchantCustomerListViewport.test.ts',
 'src/lib/performanceTelemetry.test.ts','src/lib/visiblePolling.test.ts',
 'scripts/performance-phase1-browser-harness.mjs','scripts/fixtures/performance-phase1-browser.tsx',
 'scripts/repair-unlaunched-transport.test.mjs','src/lib/merchantBusinessCardWebsiteRoute.test.ts',
 'docs/performance-phase1-2026-09-24.md','scripts/online-traffic-release-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];
test('performance lane requires a runtime anchor and admits only the exact phase 1 files',()=>{
 for(const anchor of performanceRuntimeFiles)assert.equal(onlineReleaseLane([anchor]),'performance');
 assert.equal(onlineReleaseLane([...performanceRuntimeFiles,...performanceAcceptanceFiles]),'performance');
 for(const file of performanceAcceptanceFiles.filter(file=>!file.startsWith('scripts/online-traffic-release')&&file!=='docs/no-maintenance-release.md'))assert.throws(()=>onlineReleaseLane([file]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane([]),/online_release_scope_rejected/);
});
test('performance lane cannot inherit authorization from traffic, QR, dependencies or arbitrary matching filenames',()=>{
 const rejected=[
  'src/app/api/bookings/route.ts','src/app/api/orders/route-handler.ts','src/app/api/merchant-customers/route.ts',
  'src/app/api/polls/route.ts','src/app/api/traffic/collect/route-handler.ts','src/lib/accountTrafficCampaign.server.ts',
  'src/app/api/auth/signin/route.ts','src/lib/superAdminVerification.ts','src/data/platformControlStore.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/merchantOrdersStore.ts','src/lib/merchantBookings.server.ts',
  'src/lib/merchantCustomerDirectoryStore.ts','src/lib/merchantEnterpriseAutomation.server.ts',
  'src/lib/merchantBusinessCardQrExport.ts','src/components/admin/MerchantBusinessCardManager.tsx',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml','scripts/deploy.production.sh',
  'scripts/repair-unlaunched-transport.mjs','src/lib/merchantBusinessCardWebsiteRoute.ts',
  'scripts/supabase-migrations/202609230049_account_traffic_analytics.sql',
  'scripts/supabase-migrations/202609240052_performance.sql',
  'src/lib/performanceTelemetry.server.ts','src/lib/visiblePollingExtra.ts',
  'scripts/fixtures/performance-phase2-browser.tsx','docs/performance-phase2-2026-09-24.md',
  './src/lib/visiblePolling.ts','src/lib/../lib/visiblePolling.ts','src/lib\\visiblePolling.ts',
 ];
 for(const file of rejected){
  assert.throws(()=>onlineReleaseLane([...performanceRuntimeFiles,file]),/performance_release_scope_rejected/,file);
  assert.throws(()=>onlineReleaseLane([file,...performanceRuntimeFiles]),/performance_release_scope_rejected/,file);
 }
 // The old analytics assertion itself must not become a performance bypass.
 for(const file of performanceRuntimeFiles)assert.throws(()=>assertOnlineTrafficScope([file]),/online_release_scope_rejected/);
});
test('stage and activation readiness remain lane-specific and fail closed for unknown persisted lanes',()=>{
 assert.equal(onlineReleaseStageStatus('performance'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('performance'),'ready-no-database');
 assert.equal(onlineReleaseStageStatus('traffic'),'staged');
 assert.equal(onlineReleaseActivationStatus('traffic'),'database-ready');
 assert.doesNotThrow(()=>assertOnlineReleaseDatabaseAllowed('traffic'));
 for(const lane of [undefined,null,'','ui','Performance','toString','__proto__']){
  for(const check of [onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed])assert.throws(()=>check(lane),/unknown_online_release_lane/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/verifyCandidate\(s\);s.status=onlineReleaseStageStatus\(lane\);save\(s\)/);
 assert.match(code,/await smoke\(s\);s.status=onlineReleaseStageStatus\(s.lane\);save\(s\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
});
test('actual database branch refuses every no-database lane before backup, migrations or candidate operations',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'){");
 const end=code.indexOf("}else if(action==='activate'){",start);
 assert.ok(start>0&&end>start);
 // This branch is extracted from an ESM controller. Substitute only the module
 // URL expression so the unchanged branch can be parsed in a classic VM script.
 const branch=code.slice(start+"}else if(action==='database'){".length,end).replaceAll('import.meta.url','controllerModuleUrl');
 for(const [lane,error] of [['performance','performance_database_forbidden'],['qr-export','qr_export_database_forbidden'],['bounded-lists','bounded_lists_database_forbidden'],['read-index','read_index_database_forbidden'],['public-catalog-batch','public_catalog_batch_database_forbidden'],['runtime-performance','runtime_performance_database_forbidden']]){
  const calls=[];
  const denied=(name)=>()=>{calls.push(name);throw Error(`unexpected_${name}`);};
  const task=runInNewContext(`(async()=>{${branch}})()`,{
   s:{lane,status:'staged'},assertOnlineReleaseDatabaseAllowed,controllerModuleUrl:import.meta.url,
   configUnchanged:denied('config'),verifyCandidate:denied('candidate'),verifyOrderAttentionSource:denied('source'),
   applyProductionDatabaseMigrations:denied('migration'),createProductionDatabaseBackup:denied('backup'),
   verifyProductionDatabaseBackup:denied('verify_backup'),run:denied('command'),atomic:denied('state'),
   verifyOrderAttention:denied('pilot_operation'),setOrderAttentionCandidateFlag:denied('pilot_flag'),
   fail:(message)=>{throw Error(message);},
  });
  await assert.rejects(task,new RegExp(`^Error: ${error}$`));
  assert.deepEqual(calls,[]);
 }
});

const runtimePerformanceFiles=[
 'src/lib/merchantCustomerSearch.ts','src/lib/merchantCustomerSearch.test.ts',
 'src/components/admin/MerchantCustomerManager.tsx','src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/app/site/[siteId]/SitePageClient.tsx','src/components/SitePageClient.behavior.test.ts',
 'src/components/blocks/ProductBlock.tsx','src/components/blocks/ProductBlock.behavior.test.ts',
 'docs/customer-request-lifecycle-2026-09-25.md','docs/customer-search-corpus-2026-09-25.md',
 'docs/performance-public-render-2026-09-26.md','docs/performance-runtime-release-2026-09-27.md',
 'scripts/online-static-recovery.mjs','scripts/online-static-recovery.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
 'scripts/online-release-retirement-policy.mjs','scripts/online-release-retirement-policy.test.mjs',
 'scripts/online-release-retirement.mjs','scripts/online-release-retirement.test.mjs',
];

test('runtime performance admits exactly the curated 22 paths and needs its unique search anchor',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const start=policy.indexOf('const runtimePerformanceAnchor ='),end=policy.indexOf('export function onlineReleaseLane(');
 assert.ok(start>0&&end>start);
 const actual=Array.from(runInNewContext(`${policy.slice(start,end)}Array.from(runtimePerformanceFiles)`));
 assert.deepEqual(actual,runtimePerformanceFiles);
 assert.equal(new Set(actual).size,22);
 assert.equal(onlineReleaseLane(runtimePerformanceFiles),'runtime-performance');
 assert.equal(onlineReleaseLane([runtimePerformanceFiles[0]]),'runtime-performance');
 for(const file of runtimePerformanceFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'runtime-performance',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.equal(onlineReleaseLane(['src/components/admin/MerchantCustomerManager.tsx']),'performance');
 assert.throws(()=>assertOnlineTrafficScope([runtimePerformanceFiles[0]]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane(runtimePerformanceFiles.filter(file=>file!==runtimePerformanceFiles[0])));
 assert.throws(()=>onlineReleaseLane(STATIC_RECOVERY_TOOL_FILES));
});

test('runtime performance rejects API, auth, writer, worker, schema, dependencies and every other lane in either order',()=>{
 const anchor=runtimePerformanceFiles[0];
 const rejected=[
  'src/app/api/merchant-customers/route.ts','src/app/api/bookings/route.ts','src/app/api/publish/route.ts',
  'src/app/api/orders/route-handler.ts','src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/app/api/auth/signin/route.ts','src/lib/personalAccountSession.server.ts','src/lib/superAdminVerification.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/merchantBusinessActor.server.ts',
  'src/lib/merchantCustomers.ts','src/lib/merchantCustomerDirectoryStore.ts','src/data/platformControlStore.ts',
  'src/lib/merchantBookings.server.ts','src/lib/merchantBookingRulesStore.ts','src/lib/merchantBookingWorkbenchStore.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantEnterpriseAutomation.server.ts','src/lib/webPush.ts',
  'src/lib/webPushTopic.server.ts','src/lib/merchantCustomerReadProjection.shadow.ts',
  'src/lib/merchantBookingPolicyPreparationCandidate.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
  'src/app/admin/AdminClient.tsx','src/lib/visiblePolling.ts','src/lib/merchantCustomerListViewport.ts',
  'src/lib/merchantCatalogReadIndex.ts','src/components/admin/MerchantCatalogProductList.tsx',
  'src/lib/merchantCustomerPagination.ts','src/lib/merchantOrderAttention.server.ts',
  'scripts/order-attention-pilot.ts','scripts/apply-production-database-migrations.mjs',
  'scripts/create-production-database-backup.mjs','scripts/deploy.production.sh',
  'scripts/booking-policy-admission-integration/candidate.sql','scripts/booking-policy-admission-integration/verify-preparation.ts',
  'scripts/supabase-migrations/202609230049_account_traffic_events.sql',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_customer_query_shadow.sql',
  'scripts/supabase-migrations/202609250054_customer_source_observation.sql',
  'scripts/supabase-migrations/202609250055_booking_dispatch_shadow.sql',
  'scripts/supabase-migrations/202609250056_booking_dispatch_shadow_evidence.sql',
  'scripts/supabase-migrations/202609260057_booking_authority_records.sql',
  'scripts/supabase-migrations/202609260058_booking_create_operations.sql',
  'scripts/supabase-migrations/202609260059_booking_policy_current_sources.sql',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml','PROJECT_RULES.md',
  'src/lib/merchantCustomerSearchExtra.ts','src/lib/merchantCustomerSearch.server.ts',
  'docs/performance-runtime-release-other.md','scripts/online-static-recovery-extra.mjs',
  './src/lib/merchantCustomerSearch.ts','src/lib/../lib/merchantCustomerSearch.ts','src/lib\\merchantCustomerSearch.ts',
 ];
 for(const file of rejected)for(const files of [[anchor,file],[file,anchor]]){
  assert.throws(()=>onlineReleaseLane(files),/runtime_performance_release_scope_rejected/,file);
 }
 // The new acceptance/source files do not widen any old lane either.
 for(const oldAnchor of ['src/lib/visiblePolling.ts','src/lib/merchantCatalogReadIndex.ts',
  'src/lib/merchantCustomerPagination.ts','src/lib/merchantOrderAttention.server.ts',
  'src/lib/merchantBusinessCardQrExport.ts','src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/lib/accountTrafficCampaign.server.ts']){
  assert.throws(()=>onlineReleaseLane([oldAnchor,'src/lib/merchantCustomerSearch.test.ts']));
 }
});

test('runtime performance is ready without a database and cannot migrate, prepare or toggle the pilot',()=>{
 assert.equal(onlineReleaseStageStatus('runtime-performance'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('runtime-performance'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget]){
  assert.throws(()=>check('runtime-performance'),/runtime_performance_database_forbidden/);
 }
 for(const pending of [null,[],[{version:'202609240052'}]]){
  assert.throws(()=>assertPendingOnlineReleaseMigrations('runtime-performance',pending),/runtime_performance_database_forbidden/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'runtime-performance'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'runtime-performance'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('runtime performance inherits analytics, retention, pilot and signing secret while only pausing candidate jobs',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'runtime-performance',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(effective.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='runtime-performance'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'runtime-performance',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>check(patch),/runtime_performance_baseline_features_invalid/);
 }
});

test('runtime performance source verification pins HEAD and the complete clean tree without affecting old lanes',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const source=code.slice(code.indexOf('function verifyRuntimePerformanceSource('),code.indexOf('function publishStatic('));
 const s={lane:'runtime-performance',target:'a'.repeat(40),directory:'/owned-candidate'};
 for(const [head,status] of [[s.target,''],['b'.repeat(40),''],[s.target,' M src/lib/merchantCustomerSearch.ts'],[s.target,'?? unexpected.txt']]){
  const calls=[];
  const check=()=>runInNewContext(`${source}verifyRuntimePerformanceSource(s)`,{s,
   run:(command,args,options)=>{
    assert.equal(command,'git');assert.equal(options.cwd,s.directory);calls.push(Array.from(args));
    if(args[0]==='rev-parse'){assert.deepEqual(Array.from(args),['rev-parse','HEAD']);return head+'\n';}
    assert.deepEqual(Array.from(args),['status','--porcelain=v1','--untracked-files=all']);return status;
   },fail:message=>{throw Error(message);},
  });
  if(head===s.target&&!status)assert.doesNotThrow(check);
  else assert.throws(check,/runtime_performance_candidate_source_changed/);
  assert.equal(calls.length,head===s.target?2:1);
 }
 for(const lane of ['traffic','qr-export','performance','bounded-lists','read-index','public-catalog-batch','order-attention']){
  runInNewContext(`${source}verifyRuntimePerformanceSource(s)`,{s:{lane},run:()=>{throw Error('old_lane_changed');}});
 }
});

test('runtime performance candidate refuses source, analytics, pilot, process and paused-state drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const target='a'.repeat(40);
 const check=(patch={},expected='unchanged',head=target,status='')=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'runtime-performance',target,name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
  run:(_command,args)=>args[0]==='rev-parse'?head:status,
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/runtime_performance_baseline_features_changed/);
 assert.throws(()=>check({},'unchanged','b'.repeat(40)),/runtime_performance_candidate_source_changed/);
 assert.throws(()=>check({},'unchanged',target,'?? unknown'),/runtime_performance_candidate_source_changed/);
});

test('runtime performance stage runs its exact suites between source gates before the unchanged build and readiness guards',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'runtime-performance',run:()=>{throw Error('unexpected_discovery');}}));
 assert.deepEqual(tests,[
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/lib/merchantCustomerSearch.test.ts',
  'src/components/SitePageClient.behavior.test.ts','src/components/blocks/ProductBlock.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomerPagination.test.ts','src/lib/merchantCustomerListViewport.test.ts',
  'src/lib/merchantCustomerImport.test.ts','src/lib/merchantCustomerDirectoryStore.test.ts',
  'src/app/api/merchant-customers/route.test.ts','src/app/api/orders/catalog/public/batch-route.test.ts',
  'src/app/api/orders/catalog/public/route.test.ts','src/app/api/orders/route.test.ts',
  'src/lib/merchantPublicCatalog.test.ts','src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts',
  'src/lib/merchantCatalog.test.ts','src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts',
  'src/lib/productBlock.test.ts','scripts/check-release-baseline.test.mjs','scripts/online-static-recovery.test.mjs',
 ]);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 assert.equal(new Set([...tests,...fixed]).size,26);
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const stage=code.indexOf("if(action==='stage'){");
 const before=code.indexOf('verifyRuntimePerformanceSource(s);',stage);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const after=code.indexOf('verifyRuntimePerformanceSource(s);',build);
 const launch=code.indexOf("run('pm2',['start'",after);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',launch);
 assert.ok(stage<before&&before<start&&end<build&&build<after&&after<launch&&launch<ready);
 assert.ok(code.indexOf("fail('target_not_main')",stage)<before);
 assert.ok(code.indexOf("fail('dependencies_changed')",stage)<before);
 assert.ok(code.indexOf("fail('candidate_not_ready')",launch)<ready);
 assert.match(code,/const port=\[3103,3104,3105,3106,3107,3108,3109,3110\]\.find/);
 assert.match(code,/if\(!port\)fail\('no_candidate_port'\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.equal(tests.some(file=>file.includes('booking-policy')||file.includes('shadow')||file.includes('browser-harness')),false);
});

function runtimePerformanceProxyHarness(){
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const saved=code.slice(code.indexOf('function readRuntimePerformanceSavedConfigs('),code.indexOf('function verifyCandidate('));
 const restore=code.slice(code.indexOf('function restoreConfigs('),code.indexOf('function candidateEnvironment('));
 const activate=code.slice(code.indexOf('async function activateCandidate('),code.indexOf('if(process.platform'));
 const unchanged=code.slice(code.indexOf('function configUnchanged('),code.indexOf('function readRuntimePerformanceSavedConfigs('));
 const names=['first.conf','second.conf','last.conf'];
 const files=new Map(),reads=[],effects=[],hooks={beforeStatic:null,beforeWrite:null,failPublic:false};
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const s={lane:'runtime-performance',target:'a'.repeat(40),baseline:'b'.repeat(40),
  status:'ready-no-database',directory:'/candidate',port:3110,oldPort:3109,name:'candidate',configs:{}};
 for(const file of names){
  const before=`# original ${file}\nupstream previous;\n`,after=`# candidate ${file}\nupstream next;\n`;
  files.set(`/operation/before-${file}`,before);files.set(`/operation/after-${file}`,after);files.set(`/proxy/${file}`,before);
  s.configs[file]={oldHash:digest(before),newHash:digest(after)};
 }
 const api=runInNewContext(`${unchanged}${saved}${restore}${activate}({activateCandidate,restoreConfigs,readRuntimePerformanceSavedConfigs})`,{
  WEB_RELEASE_FILES:names,operation:'/operation',proxy:'/proxy',app:'/www/wwwroot/merchant-space',
  activeFile:'/active',nginx:'/nginx',hash:digest,
  safeFile:path=>{reads.push(path);if(!files.has(path))throw Error('missing_fixture_file');return files.get(path);},
  atomic:(path,value)=>{hooks.beforeWrite?.(path);effects.push(`write:${path}`);files.set(path,value);},
  realpathSync:()=>'/www/wwwroot/merchant-space.releases/base/.next/static',
  publishStatic:()=>{hooks.beforeStatic?.();effects.push('static');return 4;},
  run:(command,args)=>effects.push(`${command}:${Array.from(args).join(',')}`),
  save:()=>effects.push(`state:${s.status}`),existsSync:()=>false,
  verifyOrderAttention:()=>{},verifyBase:async()=>{},verifyCandidate:()=>{},
  smoke:async()=>{if(hooks.failPublic)throw Error('synthetic_public_failure');return 4;},request:async()=>{},
  setTimeout:callback=>callback(),console:{error(){}},fail:message=>{throw Error(message);},
 });
 return {api,s,names,files,reads,effects,hooks};
}

test('runtime activation validates all saved before and after files before any static or cutover side effect',async()=>{
 for(const side of ['before','after'])for(const missing of [false,true]){
  const h=runtimePerformanceProxyHarness(),path=`/operation/${side}-last.conf`;
  if(missing)h.files.delete(path);else h.files.set(path,'# valid-looking but unowned upstream configuration');
  await assert.rejects(h.api.activateCandidate(h.s),missing?/missing_fixture_file/:/runtime_performance_saved_proxy_changed/);
  assert.deepEqual(h.effects,[],`${side} drift on the last file must not publish static files, write state/proxies or reload`);
  assert.equal(h.s.status,'ready-no-database');
  assert.ok(h.reads.includes('/operation/before-first.conf'));
  assert.ok(h.reads.includes(path));
 }
});

test('runtime rollback validates every saved before target before any write without relaxing current ownership',()=>{
 for(const invalid of ['saved-drift','saved-missing','current-drift']){
  const h=runtimePerformanceProxyHarness();h.s.status='active';
  for(const file of h.names)h.files.set(`/proxy/${file}`,h.files.get(`/operation/after-${file}`));
  if(invalid==='saved-drift')h.files.set('/operation/before-last.conf','unowned rollback target');
  if(invalid==='saved-missing')h.files.delete('/operation/before-last.conf');
  if(invalid==='current-drift')h.files.set('/proxy/last.conf','unowned current proxy');
  const error=invalid==='current-drift'?/rollback_proxy_not_owned/:invalid==='saved-missing'?/missing_fixture_file/:/runtime_performance_saved_proxy_changed/;
  assert.throws(()=>h.api.restoreConfigs(h.s),error);
  assert.deepEqual(h.effects,[],`${invalid} on the final file must not partially restore or reload`);
  assert.equal(h.s.status,'active');
  assert.equal(h.reads.some(path=>path.startsWith('/operation/after-')),false,'rollback does not need a saved after file');
 }
});

test('runtime activation and rollback write their validated snapshots rather than rereading a later changed saved file',async()=>{
 const activate=runtimePerformanceProxyHarness();
 const expectedAfter=activate.names.map(file=>activate.files.get(`/operation/after-${file}`));
 activate.hooks.beforeStatic=()=>{for(const file of activate.names)activate.files.set(`/operation/after-${file}`,'late saved-file drift');};
 await activate.api.activateCandidate(activate.s);
 assert.equal(activate.s.status,'active');
 assert.deepEqual(activate.names.map(file=>activate.files.get(`/proxy/${file}`)),expectedAfter);
 for(const file of activate.names)assert.equal(activate.reads.filter(path=>path===`/operation/after-${file}`).length,1);
 const restore=runtimePerformanceProxyHarness();restore.s.status='active';
 const expectedBefore=restore.names.map(file=>restore.files.get(`/operation/before-${file}`));
 for(const file of restore.names)restore.files.set(`/proxy/${file}`,restore.files.get(`/operation/after-${file}`));
 restore.hooks.beforeWrite=()=>{for(const file of restore.names)restore.files.set(`/operation/before-${file}`,'late rollback snapshot drift');};
 restore.api.restoreConfigs(restore.s);
 assert.equal(restore.s.status,'rolled-back');
 assert.deepEqual(restore.names.map(file=>restore.files.get(`/proxy/${file}`)),expectedBefore);
 for(const file of restore.names)assert.equal(restore.reads.filter(path=>path===`/operation/before-${file}`).length,1);
});

test('runtime public failure uses the verified all-file rollback and neither explicit path bypasses the gates',async()=>{
 const h=runtimePerformanceProxyHarness(),expected=h.names.map(file=>h.files.get(`/proxy/${file}`));
 h.hooks.failPublic=true;
 await assert.rejects(h.api.activateCandidate(h.s),/public_verification_failed/);
 assert.equal(h.s.status,'rolled-back');
 assert.deepEqual(h.names.map(file=>h.files.get(`/proxy/${file}`)),expected);
 assert.equal(h.effects.filter(effect=>effect==='/nginx:-s,reload').length,2);
 assert.equal(h.effects.includes('write:/active'),false);
 assert.equal(h.effects.includes('pm2:save'),false);
 for(const file of h.names)assert.equal(h.reads.filter(path=>path===`/operation/before-${file}`).length,2,'activation and rollback each validate all targets');
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.match(code,/else if\(action==='activate'\)\{[^}]*await activateCandidate\(s\);/);
 assert.match(code,/else if\(action==='rollback'\)\{[^}]*configUnchanged\(s,true\);if\(s.lane==='order-attention'\)restoreOrderAttentionConfigs\(s\);else restoreConfigs\(s\);/);
 assert.throws(()=>assertCatalogStaticRecoveryState({...staticIncident().s,lane:'runtime-performance'},staticIncident().active,staticIncident().target,staticIncident().baseline),/static_recovery_incident_not_owned/);
 for(const lane of ['traffic','performance','read-index','public-catalog-batch','order-attention']){
  const legacy=runtimePerformanceProxyHarness();
  assert.equal(legacy.api.readRuntimePerformanceSavedConfigs({...legacy.s,lane},true),null);
  assert.deepEqual(legacy.reads,[],'other lanes do not inherit this new snapshot check');
 }
});

const publicCatalogBatchFiles=[
 'src/app/api/orders/catalog/public/batch-route-handler.ts',
 'src/app/api/orders/catalog/public/batch/route.ts','src/app/api/orders/catalog/public/batch-route.test.ts',
 'src/app/api/orders/route.test.ts','src/app/site/[siteId]/SitePageClient.tsx',
 'src/components/blocks/BlockRenderer.tsx','src/components/blocks/ProductBlock.tsx',
 'src/lib/merchantPublicCatalog.ts','src/lib/merchantPublicCatalog.test.ts',
 'src/lib/publicCatalogCoordinator.ts','src/lib/publicCatalogCoordinator.test.ts',
 'src/lib/usePublicCatalogBlocks.ts','src/lib/usePublicCatalogBlocks.test.ts',
 'scripts/public-catalog-batch-browser-harness.mjs','scripts/fixtures/public-catalog-batch-browser.tsx',
 'docs/performance-public-catalog-batch-2026-09-25.md',
 'docs/ci-startup-single-snapshot-2026-09-25.md',
 'scripts/production-maintenance-next-startup-acceptance.mjs',
 'scripts/production-maintenance-next-startup-acceptance.test.mjs','scripts/test-helpers/startup-process-fact.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('public catalog batch admits exactly 24 files and requires its distinct batch-handler anchor',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const start=policy.indexOf('const publicCatalogBatchAnchor =');
 const end=policy.indexOf(']);',start)+3;
 assert.ok(start>0&&end>start);
 const actual=Array.from(runInNewContext(`${policy.slice(start,end)}Array.from(publicCatalogBatchFiles)`));
 assert.equal(publicCatalogBatchFiles.length,24);
 assert.equal(new Set(publicCatalogBatchFiles).size,24);
 assert.deepEqual(actual.sort(),[...publicCatalogBatchFiles].sort());
 assert.equal(onlineReleaseLane(publicCatalogBatchFiles),'public-catalog-batch');
 assert.equal(onlineReleaseLane([publicCatalogBatchFiles[0]]),'public-catalog-batch');
 for(const file of publicCatalogBatchFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'public-catalog-batch',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.throws(()=>assertOnlineTrafficScope([publicCatalogBatchFiles[0]]),/online_release_scope_rejected/);
 assert.throws(()=>onlineReleaseLane(publicCatalogBatchFiles.slice(16,20)),/online_release_scope_rejected/);
});

test('public catalog batch cannot admit old handlers, writers, guards or authority from another lane',()=>{
 const anchor=publicCatalogBatchFiles[0];
 for(const file of [
  'src/app/api/orders/catalog/public/route.ts','src/app/api/orders/catalog/public/route-handler.ts','src/app/api/orders/catalog/public/route.test.ts',
  'src/app/api/orders/catalog/route-handler.ts','src/app/api/orders/route-handler.ts',
  'src/app/api/bookings/route.ts','src/app/api/auth/signin/route.ts',
  'src/lib/merchantCatalog.ts','src/lib/merchantCatalogStore.ts','src/lib/merchantOrderCatalog.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersAtomic.server.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/data/platformControlStore.ts',
  'src/lib/superAdminVerification.ts','src/lib/merchantEnterpriseAutomation.server.ts',
  'src/lib/merchantCatalogReadIndex.ts','src/lib/accountTrafficResources.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
  'src/lib/visiblePolling.ts','src/app/admin/AdminClient.tsx',
  'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
  'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_public_catalog_batch.sql',
  'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
  'scripts/check-production-runtime-supervision.mjs','scripts/production-maintenance-runtime.mjs',
  'scripts/production-maintenance-next-startup-acceptance-extra.mjs','scripts/test-helpers/startup-process-extra.mjs',
  'scripts/deploy.production.sh','package.json','package-lock.json','.env.example','.github/workflows/ci.yml',
  'src/app/api/orders/catalog/public/batch-route-handler-extra.ts','src/lib/merchantPublicCatalogExtra.ts',
  'src/lib/publicCatalogCoordinatorExtra.ts','src/lib/usePublicCatalogBlocksExtra.ts',
  'scripts/fixtures/public-catalog-batch-other.tsx','docs/performance-public-catalog-other-2026-09-25.md',
  './src/app/api/orders/catalog/public/batch-route-handler.ts',
  'src/app/api/orders/catalog/public/../public/batch-route-handler.ts',
  'src\\app\\api\\orders\\catalog\\public\\batch-route-handler.ts',
 ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/public_catalog_batch_release_scope_rejected/,file);
 assert.equal(onlineReleaseLane(['src/lib/merchantCatalogReadIndex.ts']),'read-index');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficResources.server.ts']),'traffic');
 assert.equal(onlineReleaseLane(['src/lib/visiblePolling.ts']),'performance');
 assert.equal(onlineReleaseLane(['src/lib/merchantOrderAttention.server.ts']),'order-attention');
});

test('public catalog batch is ready without a database and cannot invoke any migration or pilot helper',()=>{
 assert.equal(onlineReleaseStageStatus('public-catalog-batch'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('public-catalog-batch'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget]){
  assert.throws(()=>check('public-catalog-batch'),/public_catalog_batch_database_forbidden/);
 }
 for(const pending of [[],null,[{version:'202609240052'}]]){
  assert.throws(()=>assertPendingOnlineReleaseMigrations('public-catalog-batch',pending),/public_catalog_batch_database_forbidden/);
 }
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'public-catalog-batch'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'public-catalog-batch'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('public catalog batch preserves enabled analytics, pilot, retention and signing secret in candidate overrides',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 assert.ok(start>0&&end>start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'public-catalog-batch',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(effective.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='public-catalog-batch'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'public-catalog-batch',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>check(patch),/public_catalog_batch_baseline_features_invalid/);
 }
});

test('public catalog batch candidate rejects missing identity and baseline feature drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={},expected='unchanged',present=true)=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'public-catalog-batch',name:'candidate',directory:'/candidate'},pm:()=>present?[{name:'candidate',pm2_env:{...env,...patch}}]:[],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}]){
  assert.throws(()=>check(patch),/candidate_identity_invalid|public_catalog_batch_baseline_features_changed/);
 }
 assert.throws(()=>check({},'unchanged',false),/candidate_identity_invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/public_catalog_batch_baseline_features_changed/);
});

test('public catalog batch stage runs its exact regressions before the guarded build and normal smoke readiness',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 assert.ok(start>0&&end>start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{
  lane:'public-catalog-batch',run:()=>{throw Error('unexpected_test_discovery');},
 }));
 assert.deepEqual(tests,[
  'src/app/api/orders/catalog/public/batch-route.test.ts','src/app/api/orders/catalog/public/route.test.ts',
  'src/app/api/orders/route.test.ts','src/lib/merchantPublicCatalog.test.ts',
  'src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts',
  'src/lib/merchantCatalogReadIndex.test.ts','src/lib/merchantCatalog.test.ts',
  'src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts','src/lib/productBlock.test.ts',
  'scripts/production-maintenance-next-startup-acceptance.test.mjs',
  'scripts/production-maintenance-build-recovery-evidence.test.mjs','scripts/production-maintenance-route-build-evidence.test.mjs',
 ]);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 assert.equal(new Set([...tests,...fixed]).size,tests.length+fixed.length);
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 assert.match(code,/await smoke\(s\);s.status=onlineReleaseStageStatus\(s.lane\);save\(s\)/);
 assert.match(code,/if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\)/);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*(?:public-catalog-batch-browser|production-maintenance-next-startup-acceptance\.mjs)/);
});

const readIndexFiles=[
 'src/lib/merchantCatalogReadIndex.ts','src/lib/merchantCatalogReadIndex.test.ts',
 'src/lib/accountTrafficResources.server.ts','src/lib/accountTrafficResources.server.test.ts',
 'scripts/benchmark-catalog-read-index.mjs','docs/performance-read-index-2026-09-25.md',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('read index admits exactly ten files with one anchor and no inherited traffic authority',()=>{
 const policy=readFileSync(new URL('./online-traffic-release-policy.mjs',import.meta.url),'utf8');
 const declaration=policy.slice(policy.indexOf('const readIndexAnchor ='),policy.indexOf('export function onlineReleaseLane('));
 assert.deepEqual(Array.from(runInNewContext(`${declaration}Array.from(readIndexFiles)`)),readIndexFiles);
 assert.equal(readIndexFiles.length,10);
 assert.equal(onlineReleaseLane(readIndexFiles),'read-index');
 assert.equal(onlineReleaseLane([readIndexFiles[0]]),'read-index');
 for(const file of readIndexFiles.slice(1)){
  try { assert.notEqual(onlineReleaseLane([file]),'read-index',file); }
  catch(error) { assert.match(error.message,/online_release_scope_rejected/); }
 }
 assert.throws(()=>assertOnlineTrafficScope([readIndexFiles[0]]),/online_release_scope_rejected/);
 // These readers were already permitted by the old analytics lane; do not
 // change that lane's meaning merely to introduce an independent new one.
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficResources.server.ts']),'traffic');
});

test('read index rejects source catalog writes, APIs, other lanes, migrations and neighboring filenames',()=>{
 const anchor=readIndexFiles[0];
 for(const file of [
  'src/lib/merchantCatalog.ts','src/lib/merchantCatalogStore.ts','src/lib/merchantOrderCatalog.ts',
  'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersAtomic.server.ts',
  'src/app/api/orders/catalog/route-handler.ts','src/app/api/orders/catalog/public/route-handler.ts',
  'src/app/api/orders/route-handler.ts','src/app/api/bookings/route.ts',
  'src/lib/merchantBusinessOrderPermissions.ts','src/lib/superAdminVerification.ts','src/app/api/auth/signin/route.ts',
  'src/lib/merchantEnterpriseAutomation.server.ts','src/lib/merchantBookings.server.ts',
  'src/lib/accountTrafficCampaign.server.ts','src/components/admin/AccountTrafficPanel.tsx',
  'src/lib/merchantBusinessCardQrExport.ts','src/lib/visiblePolling.ts','src/app/admin/AdminClient.tsx',
  'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
  'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
  'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
  'scripts/supabase-migrations/202609250053_read_index.sql','scripts/apply-production-database-migrations.mjs',
  'scripts/create-production-database-backup.mjs','scripts/deploy.production.sh',
  'package.json','package-lock.json','.env.example','.github/workflows/ci.yml',
  'src/lib/merchantCatalogReadIndexExtra.ts','src/lib/merchantCatalogReadIndex.server.ts',
  'src/lib/accountTrafficResourcesExtra.server.ts','scripts/benchmark-other-read-index.mjs',
  'docs/performance-other-2026-09-25.md','./src/lib/merchantCatalogReadIndex.ts',
  'src/lib/../lib/merchantCatalogReadIndex.ts','src/lib\\merchantCatalogReadIndex.ts',
 ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/read_index_release_scope_rejected/,file);
});

test('read index stays no-database and never invokes pilot verification or reset operations',()=>{
 assert.equal(onlineReleaseStageStatus('read-index'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('read-index'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>check('read-index'),/read_index_database_forbidden/);
 for(const pending of [[],null,[{version:'202609240052'}]])assert.throws(()=>assertPendingOnlineReleaseMigrations('read-index',pending),/read_index_database_forbidden/);
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const denied=()=>{throw Error('unexpected_pilot_operation');};
 for(const command of ['prepare','enable','verify','disable'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'read-index'},command,run:denied,atomic:denied,candidateEnvironment:denied,
 });
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),code.indexOf('function restoreOrderAttentionConfigs('));
 assert.throws(()=>runInNewContext(`${flag}setOrderAttentionCandidateFlag(s,'10000000')`,{
  s:{lane:'read-index'},fail:message=>{throw Error(message);},verifyCandidate:denied,candidateEnvironment:denied,
 }),/order_attention_candidate_flag_invalid/);
});

test('read index inherits enabled analytics and pilot while only pausing candidate background work',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'synthetic-original-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'read-index',target:'a'.repeat(40),port:3109,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [field,value] of Object.entries(env))assert.equal(effective[field],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='read-index'"));
 assert.ok(guard);
 const check=(patch={})=>runInNewContext(guard,{lane:'read-index',env:{...env,...patch},fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_ENABLED:undefined},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}])assert.throws(()=>check(patch),/read_index_baseline_features_invalid/);
});

test('read-index candidate rejects analytics secret, pilot, process and paused-state drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={},expected='unchanged')=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'read-index',name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:expected}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},{FAOLLA_TRAFFIC_SIGNING_SECRET:''},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{FAOLLA_SUPER_ADMIN_ORIGIN:'https://other.invalid'},
  {pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
 assert.throws(()=>check({FAOLLA_TRAFFIC_SIGNING_SECRET:''},''),/read_index_baseline_features_changed/);
});

test('read-index stage includes all tracked traffic regressions once plus catalog and unchanged safety/build gates',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const root=fileURLToPath(new URL('../',import.meta.url));
 const tracked=execFileSync('git',['ls-files','src/lib/accountTraffic*.test.ts'],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true}).trim().split('\n');
 assert.ok(tracked.length>0&&tracked.every(file=>/^src\/lib\/accountTraffic[A-Za-z.]*\.test\.ts$/.test(file)));
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'read-index',s:{directory:'/candidate'},run:(command,args,options)=>{
  assert.equal(command,'git');assert.deepEqual(Array.from(args),['ls-files','src/lib/accountTraffic*.test.ts']);
  assert.equal(options.cwd,'/candidate');return tracked.join('\n');
 }}));
 const expected=[...new Set(['src/lib/merchantCatalogReadIndex.test.ts','src/lib/accountTrafficResources.server.test.ts',...tracked,
  'src/lib/merchantCatalog.test.ts','src/lib/merchantCatalogStore.test.ts','src/lib/merchantOrderCatalog.test.ts','src/app/api/orders/catalog/public/route.test.ts'])];
 assert.deepEqual(tests,expected);
 assert.equal(new Set(tests).size,tests.length);
 const fixed=['src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'];
 for(const file of [...tests,...fixed])assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 assert.ok(code.slice(end).startsWith(`run('node',['--import','tsx','--test',...tests,${fixed.map(file=>`'${file}'`).join(',')}]`));
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(start>0&&end>start&&build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*benchmark-catalog-read-index/);
});

const boundedListFiles=[
 'src/components/admin/MerchantCatalogProductList.tsx','src/lib/merchantCustomerPagination.ts',
 'src/components/admin/MerchantCatalogProductList.test.ts','src/components/admin/MerchantCatalogManagerPanel.tsx',
 'src/components/admin/MerchantCustomerManager.tsx','src/components/admin/MerchantCustomerManager.behavior.test.ts',
 'src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomerPagination.test.ts',
 'src/lib/merchantOrdersStore.ts','src/lib/merchantOrdersStore.test.ts','src/lib/merchantOrdersStore.metadata.test.ts',
 '.github/workflows/ci.yml','scripts/ci-workflow-contract.test.mjs','scripts/run-ci-tests.mjs','scripts/run-ci-tests.test.mjs',
 'scripts/production-maintenance-topology-workflow.test.mjs',
 'scripts/performance-bounded-lists-browser-harness.mjs','scripts/fixtures/performance-bounded-lists-browser.tsx',
 'docs/performance-bounded-lists-2026-09-25.md','scripts/online-traffic-release-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];

test('bounded lists has exact runtime anchors and cannot inherit another lane or arbitrary matching files',()=>{
 assert.equal(onlineReleaseLane(boundedListFiles),'bounded-lists');
 for(const anchor of boundedListFiles.slice(0,2)){
  assert.equal(onlineReleaseLane([anchor]),'bounded-lists');
  assert.equal(onlineReleaseLane(['src/components/admin/MerchantCustomerManager.tsx',anchor]),'bounded-lists');
  for(const file of [
   'src/app/admin/AdminClient.tsx','src/lib/visiblePolling.ts','src/lib/performanceTelemetry.ts',
   'src/lib/merchantCustomerDirectoryStore.ts','src/lib/merchantCustomers.ts',
   'src/lib/merchantOrdersAtomic.server.ts','src/lib/merchantOrdersV1Read.server.ts','src/lib/merchantOrders.server.ts',
   'src/lib/merchantOrderMembershipTransaction.server.ts','src/app/api/orders/route-handler.ts',
   'src/app/api/merchant-customers/route.ts','src/app/api/bookings/route.ts','src/lib/merchantBookings.server.ts',
   'src/app/api/auth/signin/route.ts','src/lib/merchantBusinessOrderPermissions.ts','src/lib/superAdminVerification.ts',
   'src/lib/accountTrafficCampaign.server.ts','src/lib/merchantBusinessCardQrExport.ts',
   'src/lib/merchantOrderAttention.server.ts','scripts/order-attention-pilot.ts',
   'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
   'scripts/supabase-migrations/202609250053_bounded_lists.sql',
   'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
   'scripts/production-maintenance-runtime.mjs','scripts/deploy.production.sh',
   'package.json','package-lock.json','.env.local','.env.example',
   'src/lib/merchantCustomerPaginationExtra.ts','src/components/admin/MerchantCatalogProductListExtra.tsx',
   'scripts/run-ci-tests-extra.mjs','scripts/run-local-tests.mjs','docs/performance-other-2026-09-25.md',
   './src/lib/merchantCustomerPagination.ts','src/lib/../lib/merchantCustomerPagination.ts','src/lib\\merchantCustomerPagination.ts',
  ])for(const files of [[anchor,file],[file,anchor]])assert.throws(()=>onlineReleaseLane(files),/release_scope_rejected/,file);
 }
 for(const file of ['src/lib/merchantOrdersStore.ts','scripts/run-ci-tests.mjs','src/lib/merchantCustomerPagination.test.ts']){
  assert.throws(()=>onlineReleaseLane([file]),/online_release_scope_rejected/);
  assert.throws(()=>onlineReleaseLane(['src/lib/visiblePolling.ts',file]),/performance_release_scope_rejected/);
 }
 assert.equal(onlineReleaseLane(performanceRuntimeFiles),'performance');
 assert.equal(onlineReleaseLane(['src/lib/merchantBusinessCardQrExport.ts']),'qr-export');
 assert.equal(onlineReleaseLane(['src/lib/merchantOrderAttention.server.ts']),'order-attention');
 assert.equal(onlineReleaseLane(['src/lib/accountTrafficCampaign.server.ts']),'traffic');
});

test('bounded lists permits stage and activate only and rejects all database helper entrypoints',()=>{
 assert.equal(onlineReleaseStageStatus('bounded-lists'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('bounded-lists'),'ready-no-database');
 for(const check of [assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget])assert.throws(()=>check('bounded-lists'),/bounded_lists_database_forbidden/);
 for(const pending of [[],null,[{version:'202609240052'}]])assert.throws(()=>assertPendingOnlineReleaseMigrations('bounded-lists',pending),/bounded_lists_database_forbidden/);
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const calls=[];
 for(const command of ['enable','verify'])runInNewContext(`${verifier}verifyOrderAttention(s,command)`,{
  s:{lane:'bounded-lists'},command,
  run:()=>{calls.push('operation');throw Error('unexpected_operation');},
  atomic:()=>{calls.push('write');throw Error('unexpected_write');},
 });
 assert.deepEqual(calls,[]);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
 assert.match(code,/JSON.parse\(read\('\/var\/lib\/faolla-maintenance\/merchant-space\/state.json'\)\).phase!=='ended'/);
});

test('bounded lists preserves enabled pilot and analytics credentials without secret rotation or worker activation',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:'existing-synthetic-secret'};
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'bounded-lists',target:'a'.repeat(40),port:3105,env,
  randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 for(const field of Object.keys(env))assert.equal(Object.hasOwn(changes,field),false,field);
 const effective={...env,...changes};
 for(const [key,value] of Object.entries(env))assert.equal(effective[key],value);
 assert.equal(effective.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(effective.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(effective.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(Object.hasOwn(changes,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
 const guard=code.split(/\r?\n/).find(line=>line.includes("if(lane==='bounded-lists'"));
 assert.ok(guard);
 const evaluate=(value)=>runInNewContext(guard,{lane:'bounded-lists',env:value,fail:message=>{throw Error(message);}});
 assert.doesNotThrow(()=>evaluate(env));
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'20000000'},
  {FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},{FAOLLA_TRAFFIC_ENABLED:'0'},
  {FAOLLA_TRAFFIC_SIGNING_SECRET:''},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined}]){
  assert.throws(()=>evaluate({...env,...patch}),/bounded_lists_baseline_features_invalid/);
 }
});

test('actual bounded-list candidate identity check rejects pilot, analytics and inherited secret drift',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyCandidate('),code.indexOf('function publishStatic('));
 const env={status:'online',pm_cwd:'/candidate',FAOLLA_BACKGROUND_JOBS_PAUSED:'1',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',
  FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'10000000',FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'};
 const check=(patch={})=>runInNewContext(`${verifier}verifyCandidate(s)`,{
  s:{lane:'bounded-lists',name:'candidate',directory:'/candidate'},pm:()=>[{name:'candidate',pm2_env:{...env,...patch}}],
  candidateEnvironment:()=>({FAOLLA_TRAFFIC_SIGNING_SECRET:'unchanged'}),fail:message=>{throw Error(message);},
 });
 assert.doesNotThrow(()=>check());
 for(const patch of [{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'},{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:undefined},
  {FAOLLA_TRAFFIC_ENABLED:'0'},{FAOLLA_TRAFFIC_SIGNING_SECRET:'rotated'},{FAOLLA_TRAFFIC_SIGNING_SECRET:undefined},
  {FAOLLA_BACKGROUND_JOBS_PAUSED:'0'},{pm_cwd:'/old'},{status:'stopped'}])assert.throws(()=>check(patch),/changed|invalid/);
});

test('bounded-list candidate tests exist and run before the unchanged guarded build and smoke gates',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests='),end=code.indexOf("run('node',['--import','tsx','--test'",start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'bounded-lists',run:()=>{throw Error('unexpected_discovery');}}));
 assert.equal(new Set(tests).size,tests.length);
 for(const file of tests)assert.ok(statSync(new URL(`../${file}`,import.meta.url)).isFile(),file);
 for(const file of ['src/components/admin/MerchantCatalogProductList.test.ts','src/lib/merchantCustomerPagination.test.ts',
  'src/lib/merchantOrdersStore.metadata.test.ts','src/lib/merchantOrdersV1Read.server.test.ts',
  'src/lib/merchantOrdersAtomic.server.test.ts','src/lib/merchantOrderAttention.server.test.ts',
  'scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs'])assert.ok(tests.includes(file),file);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(start>0&&end>start&&build>end&&ready>build);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
 for(const gate of ['check:env:strict','check:v1-deploy-config','next build --webpack','check:bundle:admin'])assert.ok(scripts.build.includes(gate),gate);
 assert.doesNotMatch(code,/run\([^\n]*performance-bounded-lists-browser/);
});
test('actual performance candidate overrides never change analytics settings or generate secrets',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes={');
 const end=code.indexOf('const envText=',start);
 assert.ok(start>0&&end>start);
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{
  lane:'performance',target:'a'.repeat(40),port:3105,
  env:{FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'existing-secret'},
  randomBytes:()=>{throw Error('unexpected_secret_generation');},
 });
 for(const key of ['FAOLLA_TRAFFIC_ENABLED','FAOLLA_TRAFFIC_RETENTION_ENABLED','FAOLLA_TRAFFIC_SIGNING_SECRET'])assert.equal(Object.hasOwn(changes,key),false,key);
 assert.equal(changes.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(changes.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(changes.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 assert.equal(changes.FAOLLA_SUPER_ADMIN_ORIGIN,'https://console.faolla.com');
 assert.match(code,/if\(lane==='performance'&&\(env.FAOLLA_TRAFFIC_ENABLED!=='1'\|\|!env.FAOLLA_TRAFFIC_SIGNING_SECRET\)\)fail\('performance_analytics_baseline_invalid'\)/);
});
test('actual performance stage runs bounded regressions and retains the guarded build before candidate readiness',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const tests=');
 const end=code.indexOf("run('node',['--import','tsx','--test'",start);
 assert.ok(start>0&&end>start);
 const tests=Array.from(runInNewContext(`${code.slice(start,end)}tests`,{lane:'performance',run:()=>{throw Error('unexpected_test_discovery_command');}}));
 assert.deepEqual(tests,[
  'src/lib/performanceTelemetry.test.ts','src/lib/visiblePolling.test.ts','src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomerListViewport.test.ts','src/lib/merchantCustomerImport.test.ts',
  'src/lib/merchantCustomerDirectoryStore.test.ts','src/app/api/merchant-customers/route.test.ts',
  'src/app/admin/AdminClient.attention.test.ts','src/app/admin/AdminClient.contract.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts',
  'scripts/repair-unlaunched-transport.test.mjs','src/lib/merchantBusinessCardWebsiteRoute.test.ts',
 ]);
 const build=code.indexOf("run('nice',['-n','10','npm','run','build']",end);
 const ready=code.indexOf('s.status=onlineReleaseStageStatus(lane)',build);
 assert.ok(build>end&&ready>build);
 assert.ok(code.indexOf("fail('candidate_not_ready')",build)<ready);
 assert.ok(code.indexOf("fail('dependencies_changed')")<start);
 assert.doesNotMatch(code,/run\([^\n]*performance-phase1-browser/);
});
test('scope accepts analytics only, rejects auth, workers, dependencies and unrelated data migrations',()=>{
 for(const file of ['src/lib/accountTrafficCampaign.server.ts','src/app/api/traffic/collect/route-handler.ts','src/app/api/super-admin/traffic/campaign/route.test.ts','scripts/supabase-migrations/202609230051_account_traffic_outcomes_campaigns_export.sql'])assert.doesNotThrow(()=>assertOnlineTrafficScope([file]));
 for(const file of ['src/app/api/auth/signin/route.ts','package-lock.json','scripts/deploy.production.sh','src/lib/merchantEnterpriseAutomation.server.ts','scripts/supabase-migrations/202609230052_delete.sql'])assert.throws(()=>assertOnlineTrafficScope([file]));
 assert.throws(()=>assertOnlineTrafficScope([]));
});
test('owned upstream changes preserve fallback, real IP, cache, auth and all other nginx bytes',()=>{
 const before='proxy_pass http://127.0.0.1:3102;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_cache off;\nproxy_pass http://127.0.0.1:3000;';
 assert.equal(onlineProxy(before,3102,3103,'a'.repeat(40)),before.replace(':3102;',':3103;'));
 assert.throws(()=>onlineProxy(before,3104,3103,'a'.repeat(40)));assert.throws(()=>onlineProxy(before,3102,3000,'a'.repeat(40)));
});
test('only explicitly approved additive migrations can run',()=>{
 assert.doesNotThrow(()=>assertPendingTrafficMigrations([{version:'202609230049'},{version:'202609230051'}]));
 assert.throws(()=>assertPendingTrafficMigrations([{version:'202609230048'}]));
});
test('website probe checks actual destination, independent of analytics attribute ordering',()=>{
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-traffic-action="website_click" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://www.haoyouduosevilla.com/">'),true);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" href="https://haoyouduo.faolla.com/">'),false);
 assert.equal(hasExpectedCardWebsite('<a class="button secondary" data-href="https://www.haoyouduosevilla.com/" href="https://other.example/">'),false);
});
test('controller preserves legacy state, workers and assets; backup precedes apply and switch has rollback',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 assert.ok(code.indexOf('verifyProductionDatabaseBackup({')<code.indexOf('through,apply:true'));
 assert.match(code,/COPYFILE_EXCL/);assert.match(code,/static_collision/);assert.match(code,/maintenance_state_changed/);
 assert.match(code,/catch\(error\)\{if\(s.lane==='order-attention'\)restoreOrderAttentionConfigs\(s\);else restoreConfigs\(s\);throw error;\}/);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
});

const orderAttentionMigration={version:'202609240052',name:'order_attention_pilot',fileName:'202609240052_order_attention_pilot.sql'};
const orderAttentionFiles=[
 'scripts/supabase-migrations/202609240052_order_attention_pilot.sql',
 'src/lib/merchantOrderAttention.ts','src/lib/merchantOrderAttention.test.ts',
 'src/lib/merchantOrderAttention.server.ts','src/lib/merchantOrderAttention.server.test.ts',
 'src/lib/merchantOrderAttentionProjection.ts','src/lib/merchantOrderAttentionProjection.test.ts',
 'src/app/admin/AdminClient.tsx','src/app/admin/AdminClient.attention.test.ts',
 'src/app/api/orders/route-handler.ts','src/app/api/orders/route.attention.test.ts',
 'scripts/order-attention-pilot.ts','scripts/order-attention-pilot.test.ts',
 'scripts/order-attention-benchmark.ts',
 'scripts/order-attention-pilot-migration-contract.test.mjs',
 'scripts/order-attention-integration/run.mjs','scripts/order-attention-integration/run.test.mjs',
 'scripts/order-attention-integration/README.md','.github/workflows/ci.yml',
 'scripts/ci-workflow-contract.test.mjs','docs/order-attention-pilot-2026-09-24.md',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.mjs',
 'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
];
test('order attention pilot is an exact separate lane selected before its shared admin performance anchor',()=>{
 assert.equal(onlineReleaseLane(orderAttentionFiles),'order-attention');
 for(const anchor of [orderAttentionFiles[0],'src/lib/merchantOrderAttention.server.ts']){
  assert.equal(onlineReleaseLane([anchor]),'order-attention');
  assert.equal(onlineReleaseLane(['src/app/admin/AdminClient.tsx',anchor]),'order-attention');
  for(const file of [
   'src/lib/merchantOrderAttentionOther.ts','src/lib/merchantOrdersStore.ts','src/lib/merchantOrders.server.ts',
   'src/lib/merchantOrderMembershipTransaction.server.ts','src/lib/merchantBookings.server.ts',
   'src/app/api/bookings/route.ts','src/lib/merchantBusinessOrderPermissions.ts',
   'src/lib/superAdminVerification.ts','src/app/api/auth/signin/route.ts',
   'src/lib/merchantCustomers.ts','src/lib/visiblePolling.ts','src/lib/accountTrafficCampaign.server.ts',
   'src/lib/merchantBusinessCardQrExport.ts','src/lib/merchantEnterpriseAutomation.server.ts',
   'scripts/supabase-migrations/202609230049_account_traffic_analytics.sql',
   'scripts/supabase-migrations/202609240053_order_attention_pilot.sql',
   'scripts/supabase-migrations/202609240052_order_attention_other.sql',
   'scripts/apply-production-database-migrations.mjs','scripts/create-production-database-backup.mjs',
   'scripts/deploy.production.sh','package.json','package-lock.json','.env.example',
   'src/lib/../lib/merchantOrderAttention.ts','./src/lib/merchantOrderAttention.ts',
   'src/lib\\merchantOrderAttention.ts',
  ])assert.throws(()=>onlineReleaseLane([anchor,file]),/order_attention_release_scope_rejected/,file);
 }
 assert.throws(()=>onlineReleaseLane(['src/lib/merchantOrderAttentionProjection.ts']),/online_release_scope_rejected/);
 assert.throws(()=>assertOnlineTrafficScope([orderAttentionFiles[0]]),/online_release_scope_rejected/);
 assert.equal(onlineReleaseLane(['src/app/admin/AdminClient.tsx']),'performance');
});
test('order attention migration authority is exactly 052, never earlier pending migrations or another filename',()=>{
 assert.equal(onlineReleaseStageStatus('order-attention'),'staged');
 assert.equal(onlineReleaseActivationStatus('order-attention'),'database-ready');
 assert.equal(onlineReleaseMigrationTarget('order-attention'),'202609240052');
 assert.equal(onlineReleaseMigrationTarget('traffic'),'202609230051');
 assert.doesNotThrow(()=>assertPendingOnlineReleaseMigrations('order-attention',[orderAttentionMigration]));
 assert.doesNotThrow(()=>assertPendingOnlineReleaseMigrations('order-attention',[]));
 for(const pending of [null,{},[orderAttentionMigration,orderAttentionMigration],
  [{version:'202609230051'}],[{...orderAttentionMigration,version:202609240052}],
  [{...orderAttentionMigration,name:'other'}],[{...orderAttentionMigration,fileName:'other.sql'}],
  [orderAttentionMigration,{version:'202609240053'}],
 ])assert.throws(()=>assertPendingOnlineReleaseMigrations('order-attention',pending),/unapproved_order_attention_migration/);
 assert.throws(()=>assertPendingOnlineReleaseMigrations('traffic',[orderAttentionMigration]),/unapproved_pending_migration/);
 for(const lane of ['performance','qr-export',undefined,'other']){
  assert.throws(()=>onlineReleaseMigrationTarget(lane));
  assert.throws(()=>assertPendingOnlineReleaseMigrations(lane,[]));
 }
});
function orderAttentionProof(action='enable'){
 return {action,verified:true,siteId:'10000000',epoch:'00000000-0000-4000-8000-000000000001',
  generation:'9007199254740993',enabled:true,sourceRows:1,sourceBytes:3178,attentionCount:1,
  sourceSha256:'a'.repeat(64),summarySha256:'b'.repeat(64)};
}
test('pilot release requires an explicit exact verified owner-scope proof with bounded counts and lossless version',()=>{
 for(const action of ['enable','verify'])assert.deepEqual(assertOrderAttentionReleaseProof(orderAttentionProof(action),action),orderAttentionProof(action));
 for(const value of [null,[],{}, {...orderAttentionProof(),action:'prepare'},
  {...orderAttentionProof(),verified:false},{...orderAttentionProof(),siteId:'22222222'},
  {...orderAttentionProof(),enabled:false},{...orderAttentionProof(),generation:12},
  {...orderAttentionProof(),generation:'01'},{...orderAttentionProof(),generation:'9223372036854775808'},
  {...orderAttentionProof(),epoch:'invalid'},{...orderAttentionProof(),sourceRows:513},
  {...orderAttentionProof(),sourceBytes:8388609},{...orderAttentionProof(),attentionCount:-1},
  {...orderAttentionProof(),sourceSha256:'x'.repeat(64)},
  {...orderAttentionProof(),orders:[{customer:'must not be in a release proof'}]},
 ])assert.throws(()=>assertOrderAttentionReleaseProof(value,'enable'),/order_attention_verification_invalid/);
});
test('pilot candidate starts disabled with all workers paused and analytics credentials unchanged',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const changes='),end=code.indexOf('const envText=',start);
 const changes=runInNewContext(`${code.slice(start,end)}changes`,{lane:'order-attention',target:'a'.repeat(40),port:3105,
  env:{FAOLLA_TRAFFIC_ENABLED:'1',FAOLLA_TRAFFIC_SIGNING_SECRET:'original'},randomBytes:()=>{throw Error('secret_rotation_forbidden');}});
 assert.equal(changes.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID,'0');
 assert.equal(changes.FAOLLA_BACKGROUND_JOBS_PAUSED,'1');
 assert.equal(changes.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,'0');
 assert.equal(changes.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED,'0');
 for(const field of ['FAOLLA_TRAFFIC_ENABLED','FAOLLA_TRAFFIC_RETENTION_ENABLED','FAOLLA_TRAFFIC_SIGNING_SECRET','FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'])assert.equal(Object.hasOwn(changes,field),false);
 assert.match(code,/order_attention_analytics_baseline_invalid/);
 assert.match(code,/FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID!==\(s.orderAttentionEnabled\?'10000000':'0'\)/);
});
test('pilot operational verifier executes the pinned candidate with invocation-only target and rejects unverified output',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const verifier=code.slice(code.indexOf('function verifyOrderAttentionSource('),code.indexOf('function setOrderAttentionCandidateFlag('));
 const state={lane:'order-attention',target:'c'.repeat(40),directory:'/owned-candidate'};
 for(const valid of [true,false]){
  const env={FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'};const writes=[];const calls=[];
  const context={s:state,command:'enable',operation:'/private-operation',assertOrderAttentionReleaseProof,
   candidateEnvironment:()=>env,fail:message=>{throw Error(message);},atomic:(...args)=>writes.push(args),
   run:(command,args,options)=>{
    if(command==='git')return args[0]==='rev-parse'?state.target:'';
    calls.push({command,args:Array.from(args),cwd:options.cwd,target:options.env.FAOLLA_ORDER_ATTENTION_OPERATION_TARGET});
    return JSON.stringify({...orderAttentionProof(),verified:valid});
   }};
  if(valid)runInNewContext(`${verifier}verifyOrderAttention(s,command)`,context);
  else assert.throws(()=>runInNewContext(`${verifier}verifyOrderAttention(s,command)`,context),/order_attention_verification_invalid/);
  assert.deepEqual(calls,[{command:'node',args:['--import','tsx','scripts/order-attention-pilot.ts','enable'],cwd:state.directory,target:state.target}]);
  assert.equal(Object.hasOwn(env,'FAOLLA_ORDER_ATTENTION_OPERATION_TARGET'),false);
  assert.equal(writes.length,valid?1:0);
 }
});
test('actual pilot database branch backs up before exactly 052 and requires enable proof before candidate restart',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'){")+"}else if(action==='database'){".length;
 const end=code.indexOf("}else if(action==='activate'){",start);
 const branch=code.slice(start,end).replaceAll('import.meta.url','controllerModuleUrl');
 for(const proofValid of [true,false]){
  const calls=[];let migrated=false;
  const s={lane:'order-attention',status:'staged',directory:'/candidate',oldDirectory:'/old',name:'candidate'};
  const task=runInNewContext(`(async()=>{${branch}})()`,{
   s,operation:'/operation',controllerModuleUrl:import.meta.url,URL,
   assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations,
   configUnchanged:()=>calls.push('config'),verifyCandidate:()=>calls.push('candidate'),verifyBase:async()=>calls.push('baseline'),
   verifyOrderAttentionSource:()=>calls.push('source'),
   applyProductionDatabaseMigrations:async input=>{calls.push(input.apply?'apply':'dry');assert.equal(input.through,'202609240052');if(input.apply)migrated=true;return {pending:migrated?[]:[orderAttentionMigration]};},
   createProductionDatabaseBackup:async()=>{calls.push('backup');return {};},
   verifyProductionDatabaseBackup:async()=>{calls.push('verify-backup');return {};},
   verifyOrderAttention:()=>{calls.push('enable-proof');if(!proofValid)throw Error('proof_failed');return orderAttentionProof();},
   setOrderAttentionCandidateFlag:(_,flag)=>{assert.equal(flag,'10000000');calls.push('candidate-enable');},
   smoke:async()=>calls.push('smoke'),save:()=>calls.push('save'),atomic:()=>{},writeFileSync:()=>{},
   fileURLToPath:()=>'/controller',randomBytes:()=>({toString:()=> 'private-backup-key'}),
   run:(command,args)=>{assert.equal(command,'git');assert.deepEqual(Array.from(args),['rev-parse','HEAD']);return 'd'.repeat(40);},
   fail:message=>{throw Error(message);},console:{log:()=>{}},
  });
  if(proofValid){await task;assert.equal(s.status,'database-ready');}
  else {await assert.rejects(task,/proof_failed/);assert.equal(s.status,'staged');assert.equal(calls.includes('candidate-enable'),false);}
  assert.ok(calls.indexOf('verify-backup')>calls.indexOf('backup'));
  assert.ok(calls.indexOf('apply')>calls.indexOf('verify-backup'));
  assert.ok(calls.indexOf('enable-proof')>calls.indexOf('apply'));
  if(proofValid)assert.ok(calls.indexOf('candidate-enable')>calls.indexOf('enable-proof'));
 }
});
test('pilot re-verifies before static publication and restores web traffic before disabling only its candidate',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const activate=code.indexOf('async function activateCandidate(');
 assert.ok(code.indexOf("verifyOrderAttention(s,'verify')",activate)<code.indexOf('publishStatic(',activate));
 assert.match(code,/else if\(action==='activate'\)\{\s*if\(s.status!==onlineReleaseActivationStatus\(s.lane\)\)fail\('not_ready'\);verifyCandidate\(s\);configUnchanged\(s\);await smoke\(s\);\s*await activateCandidate\(s\);/);
 const start=code.indexOf('function restoreOrderAttentionConfigs('),end=code.indexOf('function recoveryToolIdentity(',start);
 const calls=[];
 runInNewContext(`${code.slice(start,end)}restoreOrderAttentionConfigs({lane:'order-attention'})`,{
  restoreConfigs:()=>calls.push('restore-owned-web'),
  setOrderAttentionCandidateFlag:(_,flag)=>calls.push(`candidate:${flag}`),
 });
 assert.deepEqual(calls,['restore-owned-web','candidate:0']);
 const flag=code.slice(code.indexOf('function setOrderAttentionCandidateFlag('),start);
 assert.match(flag,/run\('pm2',\['restart',s.name,'--update-env'\]/);
 assert.doesNotMatch(flag,/faolla_order_attention|disable'|merchant-space'/);
});

function staticIncident(){
 const target='1740b254851c11302b6c7fef536cf9ef92d75637',baseline='28c136d27d6f235683cb2eadbf2a5f1fceb34bac';
 const directory='/www/wwwroot/merchant-space.web-releases/';
 const active={target:baseline,port:3109,directory:`${directory}28c136d27d6f-online`,name:'merchant-space-online-28c136d27d6f'};
 const s={target,baseline,status:'rolled-back',lane:'public-catalog-batch',port:3110,oldPort:3109,
  directory:`${directory}1740b254851c-online`,name:'merchant-space-online-1740b254851c',
  oldDirectory:active.directory,oldName:active.name,previousActive:{...active},staticFiles:323,
  startedAt:'2026-09-25T08:33:33.264Z',rolledBackAt:'2026-09-25T08:37:03.614Z',
  baseDirectory:'/www/wwwroot/merchant-space.releases/base',
  processes:Array.from({length:11},(_,i)=>({cwd:`${directory}old${i}`,name:`old${i}`,pid:i+1})),
  configs:{'test.conf':{oldHash:'old',newHash:'new'}},
 };
 return {s,active,target,baseline};
}
test('static recovery tooling admits exactly six operational files, never application or authority changes',()=>{
 assert.equal(STATIC_RECOVERY_TOOL_FILES.length,6);
 assert.doesNotThrow(()=>assertStaticRecoveryToolScope(STATIC_RECOVERY_TOOL_FILES));
 for(const files of [[],null,['scripts/online-traffic-release.mjs'],
  [...STATIC_RECOVERY_TOOL_FILES,'src/lib/merchantCatalogStore.ts'],
  [...STATIC_RECOVERY_TOOL_FILES,'scripts/deploy.production.sh'],
  [...STATIC_RECOVERY_TOOL_FILES,'package-lock.json'],
  [...STATIC_RECOVERY_TOOL_FILES,'.github/workflows/ci.yml'],
  [...STATIC_RECOVERY_TOOL_FILES,'scripts/online-static-recovery-extra.mjs']]){
  assert.throws(()=>assertStaticRecoveryToolScope(files),/static_recovery_tool_scope_rejected/);
 }
 // No application stage lane inherits the recovery tool's authority.
 assert.throws(()=>onlineReleaseLane(STATIC_RECOVERY_TOOL_FILES));
 assert.throws(()=>onlineReleaseLane([...publicCatalogBatchFiles,'scripts/online-static-recovery.mjs']));
});
test('static retry is pinned to the explicit rolled-back incident and still-owned live baseline',()=>{
 const {s,active,target,baseline}=staticIncident();
 assert.doesNotThrow(()=>assertCatalogStaticRecoveryState(s,active,target,baseline));
 for(const patch of [{target:'a'.repeat(40)},{baseline:'b'.repeat(40)},{status:'ready-no-database'},
  {status:'active'},{status:'preparing'},{lane:'traffic'},{lane:'order-attention'},{port:3109},{oldPort:3108},
  {directory:'/other'},{oldDirectory:'/other'},{name:'other'},{oldName:'other'},
  {startedAt:'2026-09-25T08:32:33.264Z'},{rolledBackAt:'2026-09-25T08:38:03.614Z'},
  {staticFiles:322},{processes:[]},{previousActive:null},{previousActive:{...active,name:'other'}}]){
  assert.throws(()=>assertCatalogStaticRecoveryState({...s,...patch},active,target,baseline),/static_recovery_incident_not_owned/);
 }
 for(const patch of [{target:'a'.repeat(40)},{port:3110},{directory:'/other'},{name:'other'}]){
  assert.throws(()=>assertCatalogStaticRecoveryState(s,{...active,...patch},target,baseline),/static_recovery_incident_not_owned/);
 }
 assert.throws(()=>assertCatalogStaticRecoveryState(s,active,target,undefined));
 assert.throws(()=>assertCatalogStaticRecoveryState(s,active,'c'.repeat(40),baseline));
});
test('build umask is restored on both success and failure, without widening private file modes',()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("console.log('online_build_started')"),end=code.indexOf("if(!existsSync(`${s.directory}/.next/BUILD_ID`))",start);
 for(const shouldFail of [false,true]){
  let mask=0o077;const calls=[];
  const execute=()=>runInNewContext(code.slice(start,end),{
   s:{directory:'/candidate'},env:{},console:{log(){}},
   process:{umask(next){const before=mask;mask=next;calls.push(next);return before;}},
   run(command,args){assert.equal(command,'nice');assert.equal(mask,0o022);assert.deepEqual(Array.from(args),['-n','10','npm','run','build']);if(shouldFail)throw Error('build_failed');},
  });
  if(shouldFail)assert.throws(execute,/build_failed/);else execute();
  assert.equal(mask,0o077);assert.deepEqual(calls,[0o022,0o077]);
 }
 assert.match(code,/writeFileSync\(`\$\{s.directory\}\/\.env.local`[^\n]+mode:0o600,flag:'wx'/);
});
test('actual static recovery revalidates source, tests, metadata and public bytes before allowing activation',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const implementation=code.slice(code.indexOf('async function recoverStaticPermissions('),code.indexOf('async function activateCandidate('));
 for(const stop of [null,'baseline','config','candidate','tool','tests','plan','public']){
  const {s,active,target,baseline}=staticIncident();const calls=[];
  const gate=name=>{calls.push(name);if(stop===name)throw Error(`failed_${name}`);};
  const context={s,target,baseline,app:'/www/wwwroot/merchant-space',operation:'/operation',activeFile:'/active',Buffer,
   assertCatalogStaticRecoveryState,WEB_RELEASE_FILES:['test.conf'],
   safeFile:path=>path==='/active'?JSON.stringify(active):path.includes('/after-')?'new':path.includes('/before-')?'old':'lock',
   hash:value=>String(value),readFileSync:()=>Buffer.from('private'),
   lstatSync:()=>({isSymbolicLink:()=>false,isFile:()=>true,uid:0,mode:0o100600}),
   verifyBase:async()=>gate('baseline'),configUnchanged:()=>gate('config'),verifyCandidate:()=>gate('candidate'),
   recoveryToolIdentity:()=>{gate('tool');return {revision:'b'.repeat(40),directory:'/tool'};},
   candidateEnvironment:()=>({}),existsSync:()=>true,
   realpathSync:path=>path==='/www/wwwroot/merchant-space/.next/static'?`${s.baseDirectory}/.next/static`:path,
   run:(command,args)=>{
    if(command==='git')return args[0]==='status'?'':args[0]==='show'?'lock':args[1]==='HEAD^{tree}'?'a0ba91eb5fd76ab6fe33805baf403eaaac4dddf4':s.target;
    assert.equal(command,'node');assert.equal(args.includes('build'),false);gate('tests');return '';
   },
   smoke:async()=>gate('smoke'),writeFileSync:(_path,_text,options)=>{assert.equal(options.mode,0o600);assert.equal(options.flag,'wx');gate('audit');},
   planStaticPermissionRecovery:()=>{gate('plan');return {manifest:{directories:[],files:Array.from({length:191},(_,i)=>({relativePath:`chunks/${i}.js`,sha256:'asset'}))},apply:()=>{gate('repair');return {ok:true};}};},
   request:async()=>{gate('public');return {arrayBuffer:async()=>Buffer.from('asset')};},
   save:()=>gate('save'),fail:message=>{throw Error(message);},
  };
  const task=runInNewContext(`${implementation}recoverStaticPermissions(s)`,context);
  if(stop){await assert.rejects(task,new RegExp(`failed_${stop}`));assert.equal(calls.includes('save'),false);if(stop!=='public')assert.equal(calls.includes('repair'),false);}
  else {await task;assert.equal(calls.filter(x=>x==='public').length,191);assert.ok(calls.indexOf('audit')<calls.indexOf('repair'));assert.ok(calls.indexOf('repair')<calls.indexOf('public'));assert.equal(calls.at(-1),'save');}
  assert.equal(s.status,'rolled-back','recovery must not pretend the application is ready or active');
 }
 assert.match(code,/else if\(action==='retry-static'\)\{\s*await recoverStaticPermissions\(s\);await activateCandidate\(s\);/);
 assert.doesNotMatch(implementation,/worktree','add|\['restart'|\['start'|applyProductionDatabaseMigrations|createProductionDatabaseBackup|s.status=/);
});
test('shared activation preserves normal cutover, all public checks and owned rollback on retry failure',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const implementation=code.slice(code.indexOf('async function activateCandidate('),code.indexOf('if(process.platform'));
 for(const failedSmoke of [false,true]){
  const {s}=staticIncident();const calls=[];
  const task=runInNewContext(`${implementation}activateCandidate(s)`,{
   s,app:'/www/wwwroot/merchant-space',proxy:'/proxy',operation:'/operation',activeFile:'/active',nginx:'/nginx',WEB_RELEASE_FILES:['test.conf'],
   verifyOrderAttention:()=>calls.push('pilot-guard'),realpathSync:()=>'/www/wwwroot/merchant-space.releases/base/.next/static',
   publishStatic:()=>{calls.push('static');return 323;},save:()=>calls.push(`state:${s.status}`),
   atomic:(path)=>calls.push(path==='/active'?'active-record':'proxy-write'),safeFile:()=> 'owned-config',
   run:(command,args)=>{calls.push(command==='/nginx'?`nginx:${args.join(',')}`:`pm2:${args.join(',')}`);},
   smoke:async(_s,publicMode)=>{assert.equal(publicMode,true);calls.push('public-smoke');if(failedSmoke)throw Error('expected_public_failure');return 25;},
   request:async url=>{assert.equal(url,'https://launch.faolla.com/login');calls.push('launch');},
   verifyBase:async()=>calls.push('baseline'),verifyCandidate:()=>calls.push('candidate'),configUnchanged:()=>calls.push('config'),
   restoreConfigs:()=>{calls.push('owned-rollback');s.status='rolled-back';},restoreOrderAttentionConfigs:()=>{throw Error('unexpected_pilot_write');},
   setTimeout:callback=>callback(),console:{error(){}},fail:message=>{throw Error(message);},
  });
  if(failedSmoke){await assert.rejects(task,/public_verification_failed/);assert.equal(calls.filter(x=>x==='public-smoke').length,8);assert.equal(calls.at(-1),'owned-rollback');assert.equal(calls.includes('pm2:save'),false);assert.equal(calls.includes('active-record'),false);}
  else {await task;assert.equal(s.status,'active');assert.ok(calls.indexOf('launch')>calls.indexOf('public-smoke'));assert.ok(calls.indexOf('state:active')>calls.indexOf('config'));assert.equal(calls.at(-1),'active-record');}
  assert.ok(calls.indexOf('pilot-guard')<calls.indexOf('static'));assert.ok(calls.indexOf('static')<calls.indexOf('proxy-write'));
  assert.ok(calls.indexOf('nginx:-t')<calls.indexOf('nginx:-s,reload'));
 }
});
