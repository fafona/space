import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {assertOnlineTrafficScope,onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,assertPendingTrafficMigrations,onlineProxy,hasExpectedCardWebsite} from './online-traffic-release-policy.mjs';

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
test('actual database branch refuses performance and QR before invoking backup, migrations or candidate operations',async()=>{
 const code=readFileSync(new URL('./online-traffic-release.mjs',import.meta.url),'utf8');
 const start=code.indexOf("}else if(action==='database'){");
 const end=code.indexOf("}else if(action==='activate'){",start);
 assert.ok(start>0&&end>start);
 // This branch is extracted from an ESM controller. Substitute only the module
 // URL expression so the unchanged branch can be parsed in a classic VM script.
 const branch=code.slice(start+"}else if(action==='database'){".length,end).replaceAll('import.meta.url','controllerModuleUrl');
 for(const [lane,error] of [['performance','performance_database_forbidden'],['qr-export','qr_export_database_forbidden']]){
  const calls=[];
  const denied=(name)=>()=>{calls.push(name);throw Error(`unexpected_${name}`);};
  const task=runInNewContext(`(async()=>{${branch}})()`,{
   s:{lane,status:'staged'},assertOnlineReleaseDatabaseAllowed,controllerModuleUrl:import.meta.url,
   configUnchanged:denied('config'),verifyCandidate:denied('candidate'),
   applyProductionDatabaseMigrations:denied('migration'),createProductionDatabaseBackup:denied('backup'),
   verifyProductionDatabaseBackup:denied('verify_backup'),run:denied('command'),atomic:denied('state'),
   fail:(message)=>{throw Error(message);},
  });
  await assert.rejects(task,new RegExp(`^Error: ${error}$`));
  assert.deepEqual(calls,[]);
 }
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
 assert.ok(code.indexOf('verifyProductionDatabaseBackup({')<code.indexOf("through:'202609230051',apply:true"));
 assert.match(code,/COPYFILE_EXCL/);assert.match(code,/static_collision/);assert.match(code,/maintenance_state_changed/);
 assert.match(code,/catch\(error\)\{restoreConfigs\(s\);throw error;\}/);
 assert.doesNotMatch(code,/\['restart','merchant-space'|unlinkSync\(marker|maintenance.*prepare|reset.*--hard/);
});
