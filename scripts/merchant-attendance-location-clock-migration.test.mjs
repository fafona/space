import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300072_merchant_attendance_location_clock.sql");
test("atomic location adds default-closed channel and append-only minimal results without raw coordinates", () => {
  assert.match(sql, /location_clock_enabled boolean not null default false/);
  const table = sql.match(/create table public.merchant_attendance_location_results \([\s\S]*?\n\);/)?.[0]; assert.ok(table);
  assert.doesNotMatch(table, /latitude|longitude|jsonb|text\[\]/);
  assert.match(table, /event_id uuid primary key references public.merchant_attendance_events\(id\)/);
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on public.merchant_attendance_location_results from public,anon,authenticated,service_role/);
  assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete).*merchant_attendance_(events|location_results)/i);
});
test("current auth, common worker lock and idempotency precede new-write policy checks", () => {
  assert.match(sql, /auth_user_id=p_auth_user_id for share/); assert.match(sql, /employee_id=v_employee.id for update/);
  assert.match(sql, /v_receipt.actor_employee_id is distinct from v_employee.id/);
  assert.match(sql, /v_receipt.action<>v_action or v_receipt.location_id<>v_location_id/);
  assert.ok(sql.indexOf("v_replayed:=true") < sql.indexOf("if not v_settings.location_clock_enabled"));
  assert.match(sql, /if p_command is not null and not v_replayed/);
});
test("policy fingerprint covers fence values and versions; age is evaluated after locks before both inserts", () => {
  assert.match(sql, /md5\(jsonb_build_array/); assert.match(sql, /v_location.latitude,v_location.longitude,v_location.radius_meters/);
  assert.match(sql, /p_assertion->>'policyFingerprint'<>v_fingerprint/);
  assert.ok(sql.indexOf("v_now:=date_trunc") > sql.indexOf("id=v_worker.default_location_id for share"));
  assert.ok(sql.indexOf("interval '60 seconds'") < sql.indexOf("insert into public.merchant_attendance_events"));
  assert.ok(sql.indexOf("insert into public.merchant_attendance_events") < sql.indexOf("insert into public.merchant_attendance_location_results"));
  assert.doesNotMatch(sql, /exception when others|commit;[\s\S]*insert into|update public.merchant_attendance_events/i);
});
test("API is separately gated and no existing production/punch component is altered to mount the new channel", () => {
  const route = read("../src/app/api/merchant-enterprise/attendance/location-clock/route-handler.ts");
  assert.match(route, /FAOLLA_ATTENDANCE_SELF_ENABLED.*FAOLLA_ATTENDANCE_LOCATION_CLOCK_ENABLED/);
  assert.match(route, /isCanonicalPortalRequest/); assert.match(route, /isTrustedSameOriginMutationRequest/);
  for (const file of ["../src/components/enterprise/MerchantAttendanceSelfPanel.tsx", "../src/components/admin/MerchantEnterpriseManager.tsx"])
    assert.doesNotMatch(read(file), /LocationClock|location-clock/);
  const client = read("../src/lib/merchantAttendanceLocationClockClient.ts");
  assert.doesNotMatch(client, /watchPosition|setInterval|console\./); assert.match(client, /type Pending = .*intent: AttendanceLocationClockIntent/);
  assert.match(client, /this.save\(pending\);/); assert.match(client, /result.state.sequence > pending.intent.expectedSequence/);
});
test("rollback-only native test injects summary failure and asserts no orphan event without a new cluster", () => {
  const native = read("./merchant-attendance-location-clock-native.mjs");
  assert.match(native, /runAttendanceLabelsReuse/); assert.match(native, /query\(`begin;/); assert.match(native, /rollback;`\)/);
  assert.match(native, /synthetic_summary_failure/); assert.match(native, /event rollback after summary failure/);
  assert.doesNotMatch(native, /dotenv|SUPABASE_|DATABASE_URL|mkdtemp|rmSync|disable trigger|session_replication_role/);
});
test("isolated panel exposes explicit fallback acknowledgement and preserves intent on hiding/unload", () => {
  const panel = read("../src/components/enterprise/MerchantAttendanceLocationClockPanel.tsx");
  assert.match(panel, /disabled=\{!ready \|\| !acknowledged\}/);
  assert.match(panel, /client.retry\(failure\) : client.submit\(action, failure\)/);
  assert.match(panel, /visibilitychange/); assert.match(panel, /beforeunload/); assert.match(panel, /client.pause/);
  assert.match(panel, /不会自动补录过去时间/); assert.match(panel, /正式企业入口尚未开放/);
  const fixture = read("./fixtures/attendance-location-clock-browser.tsx");
  assert.match(fixture, /environment=\{environment\}/); assert.match(fixture, /synthetic_response_lost_after_commit/);
  assert.doesNotMatch(fixture, /navigator\.geolocation\s*\(|fetch\(/);
});
