import {readFileSync} from 'node:fs';

// Authorized on 2026-09-23: additive analytics, with no maintenance or worker restart.
export const ONLINE_ROOT = '/var/lib/faolla-online-release';
export const TRAFFIC_MIGRATIONS = ['202609230049','202609230050','202609230051'];
const integration = new Set([
  '.env.example','PROJECT_RULES.md','src/app/api/bookings/route.ts',
  'src/app/api/memberships/route-handler.ts','src/app/api/orders/route-handler.ts',
  'src/app/api/polls/route.ts','src/app/api/super-admin/merchant-accounts/route-handler.ts',
  'src/app/card/[card]/route.ts','src/app/share/business-card/page.tsx',
  'src/app/site/[siteId]/SitePageClient.tsx','src/app/super-admin/SuperAdminClient.tsx',
  'src/components/MerchantMembershipEntry.tsx','src/components/PublicTrafficProvider.tsx',
  'src/components/admin/AccountTrafficPanel.tsx','src/components/admin/TrafficChannelLinkBuilder.tsx',
  'src/components/blocks/BlockRenderer.tsx','src/components/blocks/BookingBlock.tsx',
  'src/components/blocks/CouponBlock.tsx','src/components/blocks/PollBlock.tsx','src/components/blocks/ProductBlock.tsx',
  'src/components/admin/MerchantBusinessCardManager.tsx','src/components/admin/useBusinessCardQrPreview.ts',
  'src/lib/merchantBusinessCardQrPreview.ts','src/lib/merchantBusinessCardQrPreview.test.ts',
  'src/lib/canonicalSuperAdminRequest.test.ts',
  'docs/business-card-qr-preview-stability-2026-09-22.md','docs/super-admin-console-origin-fix-2026-09-23.md',
  'public/traffic-card-v1.js','scripts/online-traffic-release.mjs','scripts/online-traffic-release-policy.mjs',
  'scripts/online-traffic-release.test.mjs','docs/no-maintenance-release.md',
]);
export function assertOnlineTrafficScope(files) {
  if (!files.length || files.some(file => !integration.has(file) && ![
    /^src\/lib\/accountTraffic[A-Za-z.]*\.tsx?$/,
    /^src\/app\/api\/(?:super-admin\/)?traffic\/(?:[a-z-]+\/)?(?:route|route-handler|route.test)\.ts$/,
    /^scripts\/account-traffic-[a-z-]+\.(?:test\.)?mjs$/,
    /^scripts\/maintain-account-traffic(?:\.test)?\.ts$/,
    /^docs\/account-traffic-analytics-[a-z0-9-]+\.md$/,
    /^scripts\/supabase-migrations\/2026092300(?:49|50|51)_account_traffic_[a-z_]+\.sql$/,
  ].some(pattern => pattern.test(file)))) throw Error('online_release_scope_rejected');
}
// User-requested export-only UI release. This is a distinct, exact allowlist:
// no migration, API, auth, entitlement, worker or dependency changes are admitted.
const qrExportFiles = new Set([
  'src/components/admin/MerchantBusinessCardManager.tsx',
  'src/components/admin/BusinessCardQrExportDialog.tsx',
  'src/lib/merchantBusinessCardQrExport.ts',
  'src/lib/merchantBusinessCardQrExport.test.ts',
  'docs/business-card-qr-export-2026-09-23.md',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
  // Already merged historical-fixture corrections between the live release
  // and main; no production behavior or migration is changed by these tests.
  ...['attempt','budget','build','preflight','prelaunch','second-attempt'].map(name => `scripts/production-maintenance-${name}-recovery-evidence.test.mjs`),
  'scripts/production-maintenance-continuation-evidence.test.mjs',
  'scripts/production-maintenance-window-renewal-evidence.test.mjs',
]);
// Authorized performance phase 1 (2026-09-24): exact runtime and local
// acceptance files only. This does not extend either existing release lane.
const performanceRuntimeFiles = new Set([
  'src/app/admin/AdminClient.tsx',
  'src/components/admin/MerchantCustomerManager.tsx',
  'src/lib/merchantCustomers.ts',
  'src/lib/merchantCustomerListViewport.ts',
  'src/lib/performanceTelemetry.ts',
  'src/lib/visiblePolling.ts',
]);
const performanceFiles = new Set([
  ...performanceRuntimeFiles,
  'src/app/admin/AdminClient.attention.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.contract.test.ts',
  'src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomerListViewport.test.ts',
  'src/lib/performanceTelemetry.test.ts',
  'src/lib/visiblePolling.test.ts',
  'scripts/performance-phase1-browser-harness.mjs',
  'scripts/fixtures/performance-phase1-browser.tsx',
  'docs/performance-phase1-2026-09-24.md',
  // Reviewed historical CI fixture/HTML-attribute assertions only. Their
  // production guard and route implementations remain outside this lane.
  'scripts/repair-unlaunched-transport.test.mjs',
  'src/lib/merchantBusinessCardWebsiteRoute.test.ts',
  'scripts/online-traffic-release-policy.mjs',
  'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs',
  'docs/no-maintenance-release.md',
]);
// Separately approved owner-only order badge pilot for fafona (10000000).
// This lane cannot inherit files or database authority from any older lane.
export const ORDER_ATTENTION_MIGRATION = '202609240052';
const orderAttentionMigrationFile = 'scripts/supabase-migrations/202609240052_order_attention_pilot.sql';
const orderAttentionFiles = new Set([
  orderAttentionMigrationFile,
  'src/lib/merchantOrderAttention.ts', 'src/lib/merchantOrderAttention.test.ts',
  'src/lib/merchantOrderAttention.server.ts', 'src/lib/merchantOrderAttention.server.test.ts',
  'src/lib/merchantOrderAttentionProjection.ts', 'src/lib/merchantOrderAttentionProjection.test.ts',
  'src/app/admin/AdminClient.tsx', 'src/app/admin/AdminClient.attention.test.ts',
  'src/app/api/orders/route-handler.ts', 'src/app/api/orders/route.attention.test.ts',
  'scripts/order-attention-pilot.ts', 'scripts/order-attention-pilot.test.ts',
  'scripts/order-attention-benchmark.ts',
  'scripts/order-attention-pilot-migration-contract.test.mjs',
  'scripts/order-attention-integration/run.mjs', 'scripts/order-attention-integration/run.test.mjs',
  'scripts/order-attention-integration/README.md',
  '.github/workflows/ci.yml', 'scripts/ci-workflow-contract.test.mjs',
  'docs/order-attention-pilot-2026-09-24.md',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
]);
// 2026-09-25: bounded list views and complete order metadata reads only.
// No API, authorization, source write path, dependency or migration changes.
const boundedListAnchors = new Set([
  'src/components/admin/MerchantCatalogProductList.tsx', 'src/lib/merchantCustomerPagination.ts',
]);
const boundedListFiles = new Set([
  ...boundedListAnchors,
  'src/components/admin/MerchantCatalogProductList.test.ts',
  'src/components/admin/MerchantCatalogManagerPanel.tsx',
  'src/components/admin/MerchantCustomerManager.tsx',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.contract.test.ts',
  'src/lib/merchantCustomerPagination.test.ts',
  'src/lib/merchantOrdersStore.ts', 'src/lib/merchantOrdersStore.test.ts',
  'src/lib/merchantOrdersStore.metadata.test.ts',
  '.github/workflows/ci.yml', 'scripts/ci-workflow-contract.test.mjs',
  'scripts/run-ci-tests.mjs', 'scripts/run-ci-tests.test.mjs',
  'scripts/production-maintenance-topology-workflow.test.mjs',
  'scripts/performance-bounded-lists-browser-harness.mjs',
  'scripts/fixtures/performance-bounded-lists-browser.tsx',
  'docs/performance-bounded-lists-2026-09-25.md',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
]);
// 2026-09-25: request-local catalog lookup for the read-only traffic resource list.
// Source catalog normalization, stores, APIs and every database action stay out.
const readIndexAnchor = 'src/lib/merchantCatalogReadIndex.ts';
const readIndexFiles = new Set([
  readIndexAnchor, 'src/lib/merchantCatalogReadIndex.test.ts',
  'src/lib/accountTrafficResources.server.ts', 'src/lib/accountTrafficResources.server.test.ts',
  'scripts/benchmark-catalog-read-index.mjs', 'docs/performance-read-index-2026-09-25.md',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
]);
// 2026-09-25: approved public catalog request coalescing, with no database,
// order writer, permission, dependency or GET handler change. CI-only files
// are included because that already-reviewed correction is not deployed yet.
const publicCatalogBatchAnchor = 'src/app/api/orders/catalog/public/batch-route-handler.ts';
const publicCatalogBatchFiles = new Set([
  publicCatalogBatchAnchor,
  'src/app/api/orders/catalog/public/batch/route.ts', 'src/app/api/orders/catalog/public/batch-route.test.ts',
  'src/app/api/orders/route.test.ts',
  'src/app/site/[siteId]/SitePageClient.tsx',
  'src/components/blocks/BlockRenderer.tsx', 'src/components/blocks/ProductBlock.tsx',
  'src/lib/merchantPublicCatalog.ts', 'src/lib/merchantPublicCatalog.test.ts',
  'src/lib/publicCatalogCoordinator.ts', 'src/lib/publicCatalogCoordinator.test.ts',
  'src/lib/usePublicCatalogBlocks.ts', 'src/lib/usePublicCatalogBlocks.test.ts',
  'scripts/public-catalog-batch-browser-harness.mjs', 'scripts/fixtures/public-catalog-batch-browser.tsx',
  'docs/performance-public-catalog-batch-2026-09-25.md',
  'docs/ci-startup-single-snapshot-2026-09-25.md',
  'scripts/production-maintenance-next-startup-acceptance.mjs',
  'scripts/production-maintenance-next-startup-acceptance.test.mjs',
  'scripts/test-helpers/startup-process-fact.mjs',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
]);
// 2026-09-27: date-parse memoization only; no adjacent capacity, writer,
// authentication, migration or dependency changes are admitted by this lane.
const bookingMergeCpuAnchor = 'src/lib/merchantBookingPersistenceStore.ts';
const bookingMergeCpuFiles = new Set([
  bookingMergeCpuAnchor, 'src/lib/merchantBookingMergeParity.test.ts',
  'src/app/api/merchant-customers/route.booking-merge.test.ts',
  'docs/booking-merge-cpu-2026-09-27.md',
  '.github/workflows/ci.yml', 'scripts/run-ci-tests.mjs',
  'scripts/ci-workflow-contract.test.mjs', 'scripts/production-maintenance-pm2-connection.test.mjs',
  'scripts/repair-startup.test.mjs', 'docs/performance-ci-parallel-2026-09-27.md',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
  'scripts/online-release-rolling-policy.mjs', 'scripts/online-release-rolling-policy.test.mjs',
  'scripts/online-release-rolling.mjs', 'scripts/online-release-rolling.test.mjs',
  'docs/booking-merge-release-2026-09-27.md',
]);
// 2026-09-27: the curated customer lifecycle/search and public render slice.
// This exact no-database lane does not inherit phase 1, catalog API, shadow,
// authentication, writer, worker or dependency authority from any other lane.
const runtimePerformanceAnchor = 'src/lib/merchantCustomerSearch.ts';
const runtimePerformanceFiles = new Set([
  runtimePerformanceAnchor, 'src/lib/merchantCustomerSearch.test.ts',
  'src/components/admin/MerchantCustomerManager.tsx',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts',
  'src/app/site/[siteId]/SitePageClient.tsx', 'src/components/SitePageClient.behavior.test.ts',
  'src/components/blocks/ProductBlock.tsx', 'src/components/blocks/ProductBlock.behavior.test.ts',
  'docs/customer-request-lifecycle-2026-09-25.md', 'docs/customer-search-corpus-2026-09-25.md',
  'docs/performance-public-render-2026-09-26.md', 'docs/performance-runtime-release-2026-09-27.md',
  // Reviewed operational-only changes between the live application 1740b254
  // and main 975935b4; admitting these files does not authorize retry-static.
  'scripts/online-static-recovery.mjs', 'scripts/online-static-recovery.test.mjs',
  'scripts/online-traffic-release-policy.mjs', 'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
  'scripts/online-release-retirement-policy.mjs', 'scripts/online-release-retirement-policy.test.mjs',
  'scripts/online-release-retirement.mjs', 'scripts/online-release-retirement.test.mjs',
]);
// 2026-09-28: separately authorized customer code-only performance release.
// Exact live 57dbac3a -> reviewed 426dd705 closure plus this lane's own tests/docs.
// The 060 SQL file is inert source here: no database action or projection enable
// authority is granted, and none of the older lane allowlists is widened.
const customerCodePerformanceAnchor = 'src/lib/merchantCustomerListView.ts';
export const CUSTOMER_CODE_PERFORMANCE_FILES = Object.freeze([
  '.env.example',
  'docs/benchmarks/customer-get-baseline-20260928.json',
  'docs/benchmarks/customer-manager-payload-20260928.json',
  'docs/benchmarks/customer-membership-profile-read-20260928.json',
  'docs/benchmarks/customer-order-normalization-reuse-20260928.json',
  'docs/benchmarks/customer-reducer-optimization-20260928.json',
  'docs/benchmarks/customer-token-reuse-get-20260928.json',
  'docs/benchmarks/customer-token-reuse-pure-20260928.json',
  'docs/benchmarks/membership-profile-db-projection-20260928.json',
  'docs/booking-merge-release-2026-09-27.md',
  'docs/customer-code-release-2026-09-28.md',
  'docs/customer-get-scale-baseline-2026-09-28.md',
  'docs/customer-manager-payload-2026-09-28.md',
  'docs/customer-membership-profile-read-2026-09-28.md',
  'docs/customer-reducer-optimization-2026-09-28.md',
  'docs/customer-token-reuse-2026-09-28.md',
  'docs/membership-profile-db-projection-2026-09-28.md',
  'docs/no-maintenance-release.md',
  'docs/order-normalization-reuse-2026-09-28.md',
  'scripts/benchmark-merchant-customer-get.mjs',
  'scripts/benchmark-merchant-customer-get.test.mjs',
  'scripts/benchmark-merchant-customer-membership-profile.mjs',
  'scripts/benchmark-merchant-customer-membership-profile.test.mjs',
  'scripts/benchmark-merchant-customer-order-normalization.mjs',
  'scripts/benchmark-merchant-customer-order-normalization.test.mjs',
  'scripts/benchmark-merchant-customer-reducer.mjs',
  'scripts/benchmark-merchant-customer-reducer.test.mjs',
  'scripts/customer-code-release-policy.test.mjs',
  'scripts/customer-membership-profile-projection-migration.test.mjs',
  'scripts/customer-membership-profile-projection-native.mjs',
  'scripts/customer-membership-profile-projection-native.unit.test.mjs',
  'scripts/fixtures/merchantCustomerGetBaselineHarness.test.ts',
  'scripts/fixtures/merchantCustomerGetBaselineHarness.ts',
  'scripts/fixtures/merchantCustomersReference.ts',
  'scripts/fixtures/merchantOrdersMergeReference.ts',
  'scripts/online-traffic-release-policy.mjs',
  'scripts/online-traffic-release.mjs',
  'scripts/online-traffic-release.test.mjs',
  'scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql',
  'src/app/api/merchant-customers/route.test.ts',
  'src/app/api/merchant-customers/route.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.tsx',
  'src/lib/merchantCustomerListView.test.ts',
  'src/lib/merchantCustomerListView.ts',
  'src/lib/merchantCustomerMembershipProfiles.test.ts',
  'src/lib/merchantCustomerSearch.test.ts',
  'src/lib/merchantCustomerSearch.ts',
  'src/lib/merchantCustomers.optimization.test.ts',
  'src/lib/merchantCustomers.token-reuse.test.ts',
  'src/lib/merchantCustomers.ts',
  'src/lib/merchantMembershipProfileProjection.server.test.ts',
  'src/lib/merchantMembershipProfileProjection.server.ts',
  'src/lib/merchantMembershipsStore.ts',
  'src/lib/merchantOrdersNormalizationReuse.test.ts',
  'src/lib/merchantOrdersStore.ts',
  'src/lib/merchantOrdersV1Read.server.test.ts',
]);
const customerCodePerformanceFiles = new Set(CUSTOMER_CODE_PERFORMANCE_FILES);
// A source-only scope is not a deployment or database authorization receipt.
// Every exact path is reviewed in the same clean-main commit as this policy.
export const ATTENDANCE_RELEASE_SCOPE_FILE = 'docs/attendance-production-release-scope-20261009.json';
export function validateAttendanceReleaseScope(value) {
  const groups=['runtime','quality','migrations','configuration','operations','evidence'];
  if(value?.schemaVersion!==1||value.owner!=='attendance-production-release-20261009'||value.baseline!=='b1304d5d58841c2247b93229b90bb7adcfd64965'||value.approvedSiteId!=='10000000'||value.migrationCount!==149||JSON.stringify(value.unusedOrdinals)!=='[165]')throw Error('attendance_release_scope_manifest_invalid');
  const files=[];
  for(const group of groups){
    if(!Array.isArray(value[group]))throw Error('attendance_release_scope_manifest_invalid');
    for(const file of value[group]){
      if(typeof file!=='string'||!file||/[\\\0\r\n*?]/.test(file)||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..')||files.includes(file))throw Error('attendance_release_scope_manifest_invalid');
      files.push(file);
    }
  }
  if(files.length>4096||!files.includes('src/lib/merchantAttendance.ts')||!files.includes(ATTENDANCE_RELEASE_SCOPE_FILE)||value.migrations.length!==149)throw Error('attendance_release_scope_manifest_invalid');
  const ordinals=[];
  for(const file of value.migrations){const m=/^scripts\/supabase-migrations\/\d{8}(\d{4})_[a-z0-9_]+\.sql$/.exec(file);if(!m)throw Error('attendance_release_migration_scope_invalid');ordinals.push(Number(m[1]));}
  const expected=Array.from({length:150},(_,i)=>61+i).filter(n=>n!==165);
  if(JSON.stringify(ordinals.slice().sort((a,b)=>a-b))!==JSON.stringify(expected))throw Error('attendance_release_migration_scope_invalid');
  for(const [group,pattern] of [['serverFlags',/^FAOLLA_ATTENDANCE_[A-Z0-9_]+_ENABLED$/],['publicFlags',/^NEXT_PUBLIC_FAOLLA_ATTENDANCE_[A-Z0-9_]+_ENABLED$/],['siteKeys',/^FAOLLA_ATTENDANCE_[A-Z0-9_]+_(?:SITE_IDS|SITES)$/]]){
    if(!Array.isArray(value[group])||value[group].length<1||value[group].length>256||new Set(value[group]).size!==value[group].length||value[group].some(key=>!pattern.test(key)))throw Error('attendance_release_environment_catalog_invalid');
  }
  if(JSON.stringify(value.disabledFlags)!==JSON.stringify(['FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED','FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED','NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED'])||JSON.stringify(value.credentialKeys)!==JSON.stringify(['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER']))throw Error('attendance_release_environment_catalog_invalid');
  return Object.freeze({...value,...Object.fromEntries(groups.map(g=>[g,Object.freeze([...value[g]])])),serverFlags:Object.freeze([...value.serverFlags]),publicFlags:Object.freeze([...value.publicFlags]),siteKeys:Object.freeze([...value.siteKeys]),disabledFlags:Object.freeze([...value.disabledFlags]),credentialKeys:Object.freeze([...value.credentialKeys])});
}
export const ATTENDANCE_RELEASE_SCOPE=validateAttendanceReleaseScope(JSON.parse(readFileSync(new URL('../'+ATTENDANCE_RELEASE_SCOPE_FILE,import.meta.url),'utf8')));
export const ATTENDANCE_RELEASE_FILES=Object.freeze(['runtime','quality','migrations','configuration','operations','evidence'].flatMap(g=>ATTENDANCE_RELEASE_SCOPE[g]));
const attendanceReleaseFiles=new Set(ATTENDANCE_RELEASE_FILES);
export function assertAttendanceReleaseScope(files){
  if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length||files.some(file=>!attendanceReleaseFiles.has(file)))throw Error('attendance_release_scope_rejected');
}
export function attendanceCandidateEnvironment(phase,siteId=phase==='database-ready'?ATTENDANCE_RELEASE_SCOPE.approvedSiteId:''){
  if(!['staged','database-ready'].includes(phase)||siteId!==(phase==='database-ready'?ATTENDANCE_RELEASE_SCOPE.approvedSiteId:''))throw Error('attendance_release_environment_invalid');
  const disabled=new Set(ATTENDANCE_RELEASE_SCOPE.disabledFlags);
  return {...Object.fromEntries(ATTENDANCE_RELEASE_SCOPE.publicFlags.map(k=>[k,disabled.has(k)?'0':'1'])),...Object.fromEntries(ATTENDANCE_RELEASE_SCOPE.serverFlags.map(k=>[k,phase==='database-ready'&&!disabled.has(k)?'1':'0'])),...Object.fromEntries(ATTENDANCE_RELEASE_SCOPE.siteKeys.map(k=>[k,phase==='database-ready'?siteId:''])),FAOLLA_ATTENDANCE_ROLLOUT_ENABLED:'1',FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS:ATTENDANCE_RELEASE_SCOPE.approvedSiteId,FAOLLA_ENTERPRISE_E2E_HARNESS:'',FAOLLA_BACKUP_RESTORE_HARNESS:''};
}
export function assertAttendanceCandidateEnvironment(env,phase,siteId=phase==='database-ready'?ATTENDANCE_RELEASE_SCOPE.approvedSiteId:''){
  const expected=attendanceCandidateEnvironment(phase,siteId),known=new Set([...Object.keys(expected),...ATTENDANCE_RELEASE_SCOPE.credentialKeys]);
  if(!env||Object.entries(expected).some(([k,v])=>env[k]!==v)||Object.keys(env).some(k=>/^(?:NEXT_PUBLIC_)?FAOLLA_ATTENDANCE_/.test(k)&&!known.has(k))||ATTENDANCE_RELEASE_SCOPE.credentialKeys.some(k=>!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(env[k]??'')))throw Error('attendance_release_environment_invalid');
  return env;
}
export function assertAttendanceDatabaseReadyProof(value,{target,baseline,scopeSha256,proofSha256}={}){
  const keys=['schemaVersion','kind','target','baseline','scopeSha256','dbIdentity','registryCount','registryMaximum','backupVerified','compatibilityVerified','proofSha256'];
  const identity={containerId:'0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',containerName:'supabase-db',databaseName:'postgres',databaseOid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',dataSource:'/opt/supabase/docker/volumes/db/data'};
  if(!value||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||value.schemaVersion!==1||value.kind!=='attendance-production-database-ready'||value.target!==target||value.baseline!==baseline||!(/^[a-f0-9]{40}$/).test(target??'')||baseline!==ATTENDANCE_RELEASE_SCOPE.baseline||value.scopeSha256!==scopeSha256||!(/^[a-f0-9]{64}$/).test(scopeSha256??'')||!value.dbIdentity||Object.keys(value.dbIdentity).length!==Object.keys(identity).length||Object.entries(identity).some(([k,v])=>value.dbIdentity[k]!==v)||value.registryCount!==209||value.registryMaximum!=='202610090210'||value.backupVerified!==true||value.compatibilityVerified!==true||!(/^[a-f0-9]{64}$/).test(value.proofSha256??'')||proofSha256!==undefined&&value.proofSha256!==proofSha256)throw Error('attendance_database_ready_proof_invalid');
  return value;
}
export const ATTENDANCE_RELEASE_FOCUSED_TESTS=Object.freeze([
  'src/lib/merchantAttendanceTime.test.ts','src/lib/merchantAttendanceEntitlement.test.ts','src/lib/merchantAttendanceSelf.test.ts','src/lib/merchantAttendanceAdmin.test.ts','src/lib/merchantAttendanceSelfClient.test.ts','src/lib/merchantAttendanceAdminClient.test.ts',
  'src/app/api/merchant-enterprise/attendance/self/route.test.ts','src/app/api/merchant-enterprise/attendance/admin/route.test.ts','src/lib/merchantEnterpriseAuth.server.test.ts','src/lib/merchantEnterprise.test.ts','src/data/platformControlStore.test.ts','src/app/super-admin/SuperAdminClient.contract.test.ts',
  'scripts/merchant-enterprise-invitation-application-contract.test.mjs','scripts/merchant-enterprise-membership-selector-ui-contract.test.mjs','scripts/merchant-enterprise-ui-contract.test.mjs','scripts/check-supabase-migrations.test.mjs','scripts/attendance-production-database-migrations.test.mjs',
  'src/lib/merchantAttendanceRollout.test.ts','scripts/merchant-attendance-rollout-ui-contract.test.mjs','scripts/attendance-build-worker-config.test.mjs','scripts/attendance-online-build.test.mjs',
  'src/app/api/merchant-enterprise/roles/route.attendance-admission.test.ts','src/lib/merchantAttendanceOwnerNotificationsClient.test.ts','src/lib/merchantAttendanceAccountSuspensionClient.test.ts',
  'src/lib/merchantAttendanceIndependentAdminClient.test.ts','src/lib/merchantAttendanceIndependentTerminalClient.test.ts','src/lib/merchantAttendanceCorrectionDelegationClient.test.ts',
]);
export function onlineReleaseLane(files) {
  if(files.includes('src/lib/merchantAttendance.ts')){assertAttendanceReleaseScope(files);return 'attendance';}
  if (files.includes(customerCodePerformanceAnchor)) {
    if (files.some(file => !customerCodePerformanceFiles.has(file))) throw Error('customer_code_performance_release_scope_rejected');
    return 'customer-code-performance';
  }
  if (files.includes(bookingMergeCpuAnchor)) {
    if (files.some(file => !bookingMergeCpuFiles.has(file))) throw Error('booking_merge_cpu_release_scope_rejected');
    return 'booking-merge-cpu';
  }
  if (files.includes(runtimePerformanceAnchor)) {
    if (files.some(file => !runtimePerformanceFiles.has(file))) throw Error('runtime_performance_release_scope_rejected');
    return 'runtime-performance';
  }
  if (files.includes(publicCatalogBatchAnchor)) {
    if (files.some(file => !publicCatalogBatchFiles.has(file))) throw Error('public_catalog_batch_release_scope_rejected');
    return 'public-catalog-batch';
  }
  if (files.includes(readIndexAnchor)) {
    if (files.some(file => !readIndexFiles.has(file))) throw Error('read_index_release_scope_rejected');
    return 'read-index';
  }
  if (files.includes(orderAttentionMigrationFile) || files.includes('src/lib/merchantOrderAttention.server.ts')) {
    if (files.some(file => !orderAttentionFiles.has(file))) throw Error('order_attention_release_scope_rejected');
    return 'order-attention';
  }
  if (files.some(file => boundedListAnchors.has(file))) {
    if (files.some(file => !boundedListFiles.has(file))) throw Error('bounded_lists_release_scope_rejected');
    return 'bounded-lists';
  }
  if (files.some(file => performanceRuntimeFiles.has(file))) {
    if (files.some(file => !performanceFiles.has(file))) throw Error('performance_release_scope_rejected');
    return 'performance';
  }
  if (files.includes('src/lib/merchantBusinessCardQrExport.ts')) {
    if (files.some(file => !qrExportFiles.has(file))) throw Error('qr_export_release_scope_rejected');
    return 'qr-export';
  }
  assertOnlineTrafficScope(files);
  return 'traffic';
}
function isNoDatabaseLane(lane) {
  if(lane==='attendance')return false;
  if (lane === 'customer-code-performance') return true;
  if (lane === 'booking-merge-cpu') return true;
  if (lane === 'runtime-performance') return true;
  if (lane === 'public-catalog-batch') return true;
  if (lane === 'qr-export' || lane === 'performance' || lane === 'bounded-lists' || lane === 'read-index') return true;
  if (lane === 'traffic' || lane === 'order-attention') return false;
  throw Error('unknown_online_release_lane');
}
export function onlineReleaseStageStatus(lane) {
  return isNoDatabaseLane(lane) ? 'ready-no-database' : 'staged';
}
export function onlineReleaseActivationStatus(lane) {
  return isNoDatabaseLane(lane) ? 'ready-no-database' : 'database-ready';
}
export function assertOnlineReleaseDatabaseAllowed(lane) {
  if(lane==='attendance')return;
  if (lane === 'customer-code-performance') throw Error('customer_code_performance_database_forbidden');
  if (lane === 'booking-merge-cpu') throw Error('booking_merge_cpu_database_forbidden');
  if (lane === 'runtime-performance') throw Error('runtime_performance_database_forbidden');
  if (lane === 'public-catalog-batch') throw Error('public_catalog_batch_database_forbidden');
  if (lane === 'read-index') throw Error('read_index_database_forbidden');
  if (lane === 'bounded-lists') throw Error('bounded_lists_database_forbidden');
  if (lane === 'qr-export') throw Error('qr_export_database_forbidden');
  if (lane === 'performance') throw Error('performance_database_forbidden');
  if (lane !== 'traffic' && lane !== 'order-attention') throw Error('unknown_online_release_lane');
}
export function onlineReleaseMigrationTarget(lane) {
  assertOnlineReleaseDatabaseAllowed(lane);
  if(lane==='attendance')throw Error('attendance_database_manager_required');
  return lane === 'order-attention' ? ORDER_ATTENTION_MIGRATION : '202609230051';
}
export function assertPendingOnlineReleaseMigrations(lane, pending) {
  assertOnlineReleaseDatabaseAllowed(lane);
  if(lane==='attendance')throw Error('attendance_database_manager_required');
  if (lane === 'traffic') return assertPendingTrafficMigrations(pending);
  if (!Array.isArray(pending) || pending.length > 1 || pending.some(item =>
    item?.version !== ORDER_ATTENTION_MIGRATION || item?.name !== 'order_attention_pilot' ||
    item?.fileName !== '202609240052_order_attention_pilot.sql')) throw Error('unapproved_order_attention_migration');
}
export function assertOrderAttentionReleaseProof(value, action) {
  const fields = ['action','verified','siteId','epoch','generation','enabled','sourceRows','sourceBytes','attentionCount','sourceSha256','summarySha256'];
  if (!['enable','verify'].includes(action) || !value || Array.isArray(value) || typeof value !== 'object' ||
    Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
    value.action !== action || value.verified !== true || value.siteId !== '10000000' || value.enabled !== true ||
    typeof value.epoch !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.epoch) ||
    typeof value.generation !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value.generation) ||
    BigInt(value.generation) > 9223372036854775807n ||
    !Number.isInteger(value.sourceRows) || value.sourceRows < 0 || value.sourceRows > 512 ||
    !Number.isInteger(value.sourceBytes) || value.sourceBytes < 0 || value.sourceBytes > 8388608 ||
    !Number.isInteger(value.attentionCount) || value.attentionCount < 0 || value.attentionCount > 1000000 ||
    typeof value.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
    typeof value.summarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.summarySha256)) throw Error('order_attention_verification_invalid');
  return value;
}
export function onlineProxy(original, oldPort, newPort, sha) {
  if (!Number.isInteger(oldPort) || oldPort < 3102 || oldPort > 3110 || !Number.isInteger(newPort) || newPort < 3102 || newPort > 3110 || oldPort === newPort || !/^[a-f0-9]{40}$/.test(sha)) throw Error('online_proxy_identity_invalid');
  const prior=`proxy_pass http://127.0.0.1:${oldPort};`;
  if (!original.includes(prior) || original.includes(`proxy_pass http://127.0.0.1:${newPort};`)) throw Error('online_proxy_baseline_invalid');
  return original.replaceAll(prior,`proxy_pass http://127.0.0.1:${newPort};`).replace(/X-Faolla-Card-Release "[a-f0-9]{40}"/g,`X-Faolla-Card-Release "${sha}"`);
}
export function assertPendingTrafficMigrations(pending) {
  if (pending.some(item => !TRAFFIC_MIGRATIONS.includes(String(item.version)))) throw Error('unapproved_pending_migration');
}
export function hasExpectedCardWebsite(html) {
  return (html.match(/<a\b[^>]*>/g)||[]).some(anchor=>/\sclass="button secondary"/.test(anchor)&&/\shref="https:\/\/www\.haoyouduosevilla\.com\/"/.test(anchor));
}

export const BOOKING_MERGE_CPU_FOCUSED_TESTS = Object.freeze([
  'src/lib/merchantBookingPersistenceStore.test.ts','src/lib/merchantBookingMergeParity.test.ts','src/app/api/merchant-customers/route.booking-merge.test.ts',
  'src/app/api/merchant-customers/route.test.ts','src/lib/merchantCustomers.test.ts','src/lib/merchantCustomerDirectoryStore.test.ts','src/lib/merchantBookings.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomerSearch.test.ts',
  'src/components/SitePageClient.behavior.test.ts','src/components/blocks/ProductBlock.behavior.test.ts',
  'src/app/api/orders/catalog/public/batch-route.test.ts','src/app/api/orders/catalog/public/route.test.ts','src/app/api/orders/route.test.ts',
  'src/lib/publicCatalogCoordinator.test.ts','src/lib/usePublicCatalogBlocks.test.ts','scripts/check-release-baseline.test.mjs','scripts/online-static-recovery.test.mjs',
  'scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs','scripts/production-maintenance-pm2-connection.test.mjs','scripts/repair-startup.test.mjs',
  'src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs',
]);
// Pinned application/compatibility and pure tooling tests. The controller must
// execute this list with --test-concurrency=1. The native unit test imports only
// guarded pure helpers; the PostgreSQL runner itself is NEVER an executable gate.
export const CUSTOMER_CODE_PERFORMANCE_FOCUSED_TESTS = Object.freeze([
  'src/lib/merchantCustomerDirectoryStore.test.ts',
  'src/lib/merchantCustomerImport.test.ts',
  'src/lib/merchantCustomerListView.test.ts',
  'src/lib/merchantCustomerListViewport.test.ts',
  'src/lib/merchantCustomerMembershipProfiles.test.ts',
  'src/lib/merchantCustomerPagination.test.ts',
  'src/lib/merchantCustomerSearch.test.ts',
  'src/lib/merchantCustomers.optimization.test.ts',
  'src/lib/merchantCustomers.test.ts',
  'src/lib/merchantCustomers.token-reuse.test.ts',
  'src/lib/merchantOrderAttention.server.test.ts',
  'src/lib/merchantOrderAttention.test.ts',
  'src/lib/merchantOrderAttentionProjection.test.ts',
  'src/lib/merchantOrderBackfill.server.test.ts',
  'src/lib/merchantOrderCatalog.test.ts',
  'src/lib/merchantOrderDualWrite.server.test.ts',
  'src/lib/merchantOrderEnterprise.test.ts',
  'src/lib/merchantOrderExport.test.ts',
  'src/lib/merchantOrderFrontendAccess.test.ts',
  'src/lib/merchantOrderManagerPreferences.test.ts',
  'src/lib/merchantOrderMembershipTransaction.server.test.ts',
  'src/lib/merchantOrderPoints.test.ts',
  'src/lib/merchantOrderPrint.test.ts',
  'src/lib/merchantOrderReconciliation.test.ts',
  'src/lib/merchantOrderV1DeploymentApproval.server.test.ts',
  'src/lib/merchantOrderV1DeploymentGuard.test.ts',
  'src/lib/merchantOrderV1PrimaryCanaryAudit.test.ts',
  'src/lib/merchantOrderV1PrimaryCanaryWatch.test.ts',
  'src/lib/merchantOrderV1PrimaryCanaryWatchHealth.test.ts',
  'src/lib/merchantOrderV1ReadCircuitBreaker.test.ts',
  'src/lib/merchantOrderWorkbench.test.ts',
  'src/lib/merchantOrders.test.ts',
  'src/lib/merchantOrdersAtomic.server.test.ts',
  'src/lib/merchantOrdersNormalizationReuse.test.ts',
  'src/lib/merchantOrdersStore.metadata.test.ts',
  'src/lib/merchantOrdersStore.test.ts',
  'src/lib/merchantOrdersV1.test.ts',
  'src/lib/merchantOrdersV1Read.server.test.ts',
  'src/lib/merchantMembershipAuthorizationLock.test.ts',
  'src/lib/merchantMembershipBusinessPermissions.test.ts',
  'src/lib/merchantMembershipFrontendAccess.test.ts',
  'src/lib/merchantMembershipLedger.test.ts',
  'src/lib/merchantMembershipLedgerBackfill.server.test.ts',
  'src/lib/merchantMembershipLedgerDualWrite.server.test.ts',
  'src/lib/merchantMembershipLedgerReconciliation.test.ts',
  'src/lib/merchantMembershipLedgerV1Read.server.test.ts',
  'src/lib/merchantMembershipOrderPointsPreparation.test.ts',
  'src/lib/merchantMembershipProfileProjection.server.test.ts',
  'src/lib/merchantMembershipRedemptionCheckout.test.ts',
  'src/lib/merchantMembershipRouteContract.test.ts',
  'src/lib/merchantMembershipRoutesSecurity.test.ts',
  'src/lib/merchantMembershipSettings.server.test.ts',
  'src/lib/merchantMembershipSettingsStore.test.ts',
  'src/lib/merchantMemberships.test.ts',
  'src/lib/merchantMembershipsStore.test.ts',
  'src/lib/merchantBookings.test.ts',
  'src/lib/merchantBookingsV1.test.ts',
  'src/lib/merchantBookingsV1Read.server.test.ts',
  'src/lib/merchantBookingPersistenceStore.test.ts',
  'src/lib/merchantBookingMergeParity.test.ts',
  'src/app/api/merchant-customers/route.test.ts',
  'src/app/api/merchant-customers/route.booking-merge.test.ts',
  'src/app/api/orders/route.test.ts',
  'src/app/api/orders/catalog/route.test.ts',
  'src/app/api/orders/export/route.test.ts',
  'src/components/admin/MerchantCustomerManager.behavior.test.ts',
  'src/components/admin/MerchantCustomerManager.contract.test.ts',
  'scripts/fixtures/merchantCustomerGetBaselineHarness.test.ts',
  'scripts/benchmark-merchant-customer-get.test.mjs',
  'scripts/benchmark-merchant-customer-reducer.test.mjs',
  'scripts/benchmark-merchant-customer-membership-profile.test.mjs',
  'scripts/benchmark-merchant-customer-order-normalization.test.mjs',
  'scripts/customer-membership-profile-projection-migration.test.mjs',
  'scripts/customer-membership-profile-projection-native.unit.test.mjs',
  'scripts/check-release-baseline.test.mjs',
  'scripts/online-static-recovery.test.mjs',
  'scripts/run-ci-tests.test.mjs',
  'scripts/ci-workflow-contract.test.mjs',
  'scripts/production-maintenance-pm2-connection.test.mjs',
  'scripts/repair-startup.test.mjs',
  'scripts/customer-code-release-policy.test.mjs',
]);
// This one failed pre-build attempt retains its original application identity.
// These are read-only incident observations, not caller-issued recovery authority.
export const BOOKING_STAGE_RESUME = Object.freeze({
  target:'57dbac3ab07899fcca03a17d149c3c717b805d63',baseline:'0004c202f1c75bce4241c4185aeb16eb1724b177',
  stateSha256:'84a9523ef6ffa9a9038d554fdfb345047e88bd435907279194c2048fadf65798',
  runtimeSha256:'9895668c59d4987ec4f5232c4637154db2dd617cd2697997264b194c460e851e',
  environmentSha256:'1b5de1855c2b91aeb7697cd9794e245240a37515f776f9a7deb4fba47a5fc3ad',
  historyHead:'fb5b966a6f5b15267b1e9b8f5ff028cb29522a681fb0d5f1391964254e9eee07',
  dependencySha256:'f12f24a40f70ac0f5c55821268303873826ece213856cb0b8e84f871cd58428e',
  tree:'2e071ce133bcf1a66a6b41ca56e1a90bb2c95011',port:3104,oldPort:3103,
});
// Separately authorized one-attempt continuation after the first recovery's
// pre-build probe failure. Original receipts remain immutable prerequisites.
export const BOOKING_STAGE_PROBE_RESUME = Object.freeze({
  priorToolRevision:'3d73d081beacdd1856c9170a08294e5a1507be25',
  priorBeforeSha256:'b3a6bc00f6a5d632a207953a13e326e29bf962c1210d75e7e1701cae9214586a',
  priorFailureSha256:'c27dc12d4fd8213a830389159732c95c6ff590428c5dd29d5782669a78810f65',
  priorFailureAt:'2026-09-27T21:32:51.679Z',
});
export const BOOKING_STAGE_RESUME_TOOL_FILES = Object.freeze([
  'scripts/online-traffic-release.mjs','scripts/online-traffic-release-policy.mjs','scripts/online-traffic-release.test.mjs',
  'docs/no-maintenance-release.md','docs/booking-merge-release-2026-09-27.md',
]);
export function assertBookingStageResumeToolScope(files) {
  if (!Array.isArray(files) || !files.includes('scripts/online-traffic-release.mjs') ||
      files.some(file=>!BOOKING_STAGE_RESUME_TOOL_FILES.includes(file))) throw Error('booking_stage_resume_tool_scope_rejected');
}
export function assertBookingStageResumeState(s,active,target,baseline) {
  const p=BOOKING_STAGE_RESUME,base='/www/wwwroot/merchant-space.web-releases/';
  if (target!==p.target || baseline!==p.baseline || s?.target!==target || s?.baseline!==baseline ||
      s.status!=='preparing' || s.lane!=='booking-merge-cpu' || s.port!==p.port || s.oldPort!==p.oldPort ||
      s.directory!==`${base}${target.slice(0,12)}-online` || s.name!==`merchant-space-online-${target.slice(0,12)}` ||
      s.oldDirectory!==`${base}${baseline.slice(0,12)}-online` || s.oldName!==`merchant-space-online-${baseline.slice(0,12)}` ||
      s.rollingRetentionHeadSha256!==p.historyHead || active?.target!==baseline || active.port!==s.oldPort ||
      active.directory!==s.oldDirectory || active.name!==s.oldName || !s.previousActive ||
      ['target','port','directory','name'].some(key=>s.previousActive[key]!==active[key])) throw Error('booking_stage_resume_incident_not_owned');
}

// Explicit one-incident recovery authorized on 2026-09-25. This is NOT an
// application release lane and does not widen any existing stage allowlist.
export const STATIC_RECOVERY_TOOL_FILES = [
  'scripts/online-static-recovery.mjs', 'scripts/online-static-recovery.test.mjs',
  'scripts/online-traffic-release.mjs', 'scripts/online-traffic-release-policy.mjs',
  'scripts/online-traffic-release.test.mjs', 'docs/no-maintenance-release.md',
];
export function assertStaticRecoveryToolScope(files) {
  if (!Array.isArray(files) || !files.includes('scripts/online-static-recovery.mjs') ||
      !files.includes('scripts/online-traffic-release.mjs') ||
      files.some(file=>!STATIC_RECOVERY_TOOL_FILES.includes(file))) throw Error('static_recovery_tool_scope_rejected');
}
export function assertCatalogStaticRecoveryState(s,active,target,baseline) {
  const expectedTarget='1740b254851c11302b6c7fef536cf9ef92d75637';
  const expectedBase='28c136d27d6f235683cb2eadbf2a5f1fceb34bac';
  const directory='/www/wwwroot/merchant-space.web-releases/';
  if (target!==expectedTarget || baseline!==expectedBase || s?.target!==target || s?.baseline!==baseline ||
      s.status!=='rolled-back' || s.lane!=='public-catalog-batch' || s.port!==3110 || s.oldPort!==3109 ||
      s.directory!==`${directory}1740b254851c-online` || s.name!=='merchant-space-online-1740b254851c' ||
      s.oldDirectory!==`${directory}28c136d27d6f-online` || s.oldName!=='merchant-space-online-28c136d27d6f' ||
      s.startedAt!=='2026-09-25T08:33:33.264Z' || s.rolledBackAt!=='2026-09-25T08:37:03.614Z' ||
      s.staticFiles!==323 || !Array.isArray(s.processes) || s.processes.length!==11 ||
      active?.target!==baseline || active.port!==s.oldPort || active.directory!==s.oldDirectory || active.name!==s.oldName ||
      !s.previousActive || ['target','port','directory','name'].some(key=>s.previousActive[key]!==active[key])) {
    throw Error('static_recovery_incident_not_owned');
  }
}
