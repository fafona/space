import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300078_merchant_attendance_location_setup.sql");
test("setup is owner-only, settings-serialized and audited without granting raw writes", () => {
  assert.match(sql, /m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id/);
  assert.match(sql, /merchant_attendance_settings where merchant_id=p_site_id for update/);
  assert.match(sql, /merchant_attendance_locations where merchant_id=p_site_id and id=p_location_id for update/);
  assert.match(sql, /receipt.actor_auth_user_id<>p_auth_user_id/); assert.match(sql, /receipt.command<>p_command/);
  assert.match(sql, /enable row level security/); assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|select) on|update public.merchant_attendance_events|insert into public.merchant_attendance_events/i);
});
test("prepare updates only its fence and appends a bound draft, never auto-publishes or acknowledges", () => {
  assert.match(sql, /faolla_attendance_location_policy_draft_v1/);
  assert.match(sql, /'expectedLocationVersion',l.version,'values',d.command->'values'/);
  assert.doesNotMatch(sql, /insert into public.merchant_attendance_location_notices|insert into public.merchant_attendance_location_notice_acknowledgements|update public.merchant_attendance_location_policy_drafts/);
  assert.match(sql, /where merchant_id=p_site_id and id=p_location_id returning \* into l/);
  assert.doesNotMatch(sql, /set version=v_version|set version=version\+1.*merchant_attendance_settings/);
  assert.match(sql, /cross join lateral\(select e.id,e.action,e.location_id/);
  assert.match(sql, /order by e.sequence desc limit 1/);
  assert.match(sql, /last_event.action<>'clock_out'/);
  assert.match(sql, /if open_web_shift then raise exception 'attendance_setup_open_web_shift'/);
  assert.match(sql, /and not exists\(select 1 from public.merchant_attendance_location_results lr where lr.event_id=last_event.id\)/);
});
test("separate channel CAS fences pause/resume while preserving notice versions; pause is available during platform suspension", () => {
  assert.match(sql, /location_channel_version bigint not null default 1/);
  assert.match(sql, /act<>'pause' and not p_allow_prepare/);
  assert.match(sql, /expectedChannelVersion'\)::bigint<>s.location_channel_version/);
  assert.match(sql, /location_clock_enabled=\(act='enable'\),location_channel_version=location_channel_version\+1/);
  assert.match(sql, /if act='enable' and not can_enable/);
  assert.doesNotMatch(sql, /latitude=null|longitude=null|radius_meters=null/);
});
test("isolated setup UI explains enterprise-wide scope and split steps; native check is rollback-only with real response parsing", () => {
  const panel = read("../src/components/enterprise/MerchantAttendanceLocationSetupPanel.tsx");
  assert.match(panel, /这是企业级通路开关/); assert.match(panel, /不会自动发布告知或开启通路/); assert.match(panel, /!allowed \|\| !confirmed/);
  assert.doesNotMatch(panel, /navigator.geolocation|watchPosition|dangerouslySetInnerHTML/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationSetup|location-setup/);
  const native = read("./merchant-attendance-location-setup-native.mjs"); assert.match(native, /runAttendanceLabelsReuse/); assert.match(native, /query\(`begin;/); assert.match(native, /rollback;`\)/);
  assert.match(native, /parseLocationSetupResult\(sample.value/); assert.match(native, /synthetic_setup_audit_failure/);
  assert.doesNotMatch(native, /dotenv|DATABASE_URL|SUPABASE_|mkdtemp|rmSync/);
});
