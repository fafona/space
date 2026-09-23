import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMigrationSource } from './check-supabase-migrations.mjs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('traffic migration is additive and private; aggregation precedes object pagination', () => {
  const name = '202609230049_account_traffic_analytics.sql';
  const sql = read('scripts/supabase-migrations/' + name);
  assert.deepEqual(validateMigrationSource(name, sql), []);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.account_traffic_events from public, anon, authenticated/i);
  assert.match(sql, /primary key \(site_id, event_id\)/);
  assert.match(sql, /p_module is null or module = p_module/);
  assert.match(sql, /p_object_id is null or object_id = p_object_id/);
  assert.match(sql, /Europe\/Madrid/);
  assert.doesNotMatch(sql, /limit 1000/);
  assert.doesNotMatch(sql, /grant .* to (anon|authenticated)/i);
});
test('editor and super-admin never mount the public analytics provider', () => {
  assert.doesNotMatch(read('src/components/admin/MerchantBusinessCardManager.tsx'), /PublicTrafficProvider/);
  assert.doesNotMatch(read('src/app/super-admin/SuperAdminClient.tsx'), /<PublicTrafficProvider/);
  assert.match(read('src/app/site/[siteId]/SitePageClient.tsx'), /<PublicTrafficProvider/);
  assert.match(read('src/app/api/super-admin/traffic/route-handler.ts'), /authorize: isSuperAdminRequestAuthorized/);
});
test('card script observes clicks without changing links or storing visitor IDs', () => {
  const script = read('public/traffic-card-v1.js');
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|preventDefault|location\s*=/);
  assert.match(script, /window\.top !== window/);
  assert.match(script, /globalPrivacyControl/);
  assert.match(script, /document\.visibilityState === "visible"/);
  assert.doesNotMatch(read('src/app/api/traffic/collect/route-handler.ts'), /email:\s|phone:\s|created_at:\s|user_agent:\s|referrer:\s/);
});

test('rollup migration does not schedule or execute retention and defaults to preview', () => {
  const file = '202609230050_account_traffic_rollup_retention.sql';
  const sql = read('scripts/supabase-migrations/' + file);
  assert.deepEqual(validateMigrationSource(file, sql), []);
  assert.match(sql, /p_apply boolean default false/);
  assert.match(sql, /after insert on public.account_traffic_events/);
  assert.match(sql, /event_count=d.event_count\+1/);
  assert.match(sql, /where created_at<raw_cutoff/);
  assert.match(sql, /blockedMissingRollups/);
  assert.doesNotMatch(sql, /cron\.schedule|delete from public.page_events|select public.faolla_account_traffic_retention/);
  assert.doesNotMatch(sql, /grant .* to (anon|authenticated)/i);
});
test('share-card resources require a stored share-key match and never alter destinations', () => {
  const source = read('src/app/share/business-card/page.tsx');
  assert.match(source, /trafficSite\?\.businessCards\?\.find/);
  assert.match(source, /objectId: trafficCard.id/);
  assert.match(source, /<SignedPublicTrafficProvider/);
  assert.match(source, /href=\{payload.contact\?\.websiteUrl \|\| payload.targetUrl\}/);
  assert.match(source, /runtimeSource="contact_card"/);
});

test('confirmed results are called only after persistence and without awaiting analytics',()=>{
  for(const [file,persist] of [
    ['src/app/api/bookings/route.ts','const created = await createMerchantBooking'],
    ['src/app/api/orders/route-handler.ts','const order = await dependencies.createOrder'],
    ['src/app/api/memberships/route-handler.ts','const membership = await joinMerchantMembership'],
    ['src/app/api/polls/route.ts','const ballot = normalizeStoredPollBallot(insertResult.data)'],
  ]) { const code=read(file);assert.ok(code.indexOf('void recordTrafficOutcome')>code.indexOf(persist));assert.doesNotMatch(code,/await recordTrafficOutcome/); }
  assert.match(read('src/lib/accountTrafficCard.server.ts'),/cards.find\(\(item\) => item.shareKey === shareKey\)/);
  assert.match(read('src/app/super-admin/SuperAdminClient.tsx'),/个人名片访问分析/);
});
