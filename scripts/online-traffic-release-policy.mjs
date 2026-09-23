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
