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
export function onlineReleaseLane(files) {
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
  if (lane === 'qr-export' || lane === 'performance') return true;
  if (lane === 'traffic') return false;
  throw Error('unknown_online_release_lane');
}
export function onlineReleaseStageStatus(lane) {
  return isNoDatabaseLane(lane) ? 'ready-no-database' : 'staged';
}
export function onlineReleaseActivationStatus(lane) {
  return isNoDatabaseLane(lane) ? 'ready-no-database' : 'database-ready';
}
export function assertOnlineReleaseDatabaseAllowed(lane) {
  if (lane === 'qr-export') throw Error('qr_export_database_forbidden');
  if (lane === 'performance') throw Error('performance_database_forbidden');
  if (lane !== 'traffic') throw Error('unknown_online_release_lane');
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
