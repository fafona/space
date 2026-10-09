import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300077_merchant_attendance_location_clock_notice_guard.sql");

test("notice-bound clock serializes publication via settings and acknowledgement via worker before commit", () => {
  assert.match(sql, /merchant_attendance_settings where merchant_id=p_site_id for share/);
  assert.match(sql, /employee_id=e.id for update/);
  assert.ok(sql.indexOf("employee_id=e.id for update") < sql.indexOf("b:=public.faolla_attendance_location_clock_v1"));
  assert.match(sql, /a\.notice_revision=n\.revision[\s\S]*a\.worker_id=w\.id and a\.actor_auth_user_id=p_auth_user_id/);
  assert.match(sql, /n\.revision<>\(p_command->>'noticeRevision'\)::bigint/);
  assert.match(sql, /l\.latitude is distinct from/); assert.match(sql, /l\.longitude is distinct from/); assert.match(sql, /l\.radius_meters is distinct from/);
});

test("unreleased v1 cannot be invoked as an unguarded service bypass; new binding is immutable and contains no raw GPS", () => {
  assert.match(sql, /revoke all on function public\.faolla_attendance_location_clock_v1\(.*\) from service_role/);
  assert.match(sql, /grant execute on function public\.faolla_attendance_location_clock_v2\(.*\) to service_role/);
  assert.match(sql, /references public\.merchant_attendance_location_notice_acknowledgements/);
  assert.match(sql, /enable row level security/); assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/);
  assert.doesNotMatch(sql.match(/create table[\s\S]*?\n\);/)[0], /latitude|longitude|captured_at|accuracy/);
  assert.doesNotMatch(sql, /update public\.merchant_attendance_|delete from|disable trigger|grant (select|insert|update|delete)/i);
});

test("explicit finish preserves original shift identity and time zone, not admission or GPS approval", () => {
  assert.match(sql, /last_fact\.actor_employee_id=e\.id/);
  assert.match(sql, /'attendance.self.clock'=any\(r.permissions\)/);
  assert.match(sql, /p_command->>'action' not in \('break_end','clock_out'\)/);
  assert.match(sql, /'web',null,stamp,stamp,last_fact.time_zone,e.id/);
  assert.match(sql, /1,'not_provided',true/);
  assert.match(sql, /attendance_break_must_end/);
  assert.match(sql, /link.command<>p_command/);
  assert.doesNotMatch(sql, /greatest\(.*last_fact.occurred_at|update.*break_paid/);
});

test("client rechecks before any sample and exposes explicit version-bound locationless finish; remains isolated", () => {
  const client = read("../src/lib/merchantAttendanceLocationClockClient.ts");
  assert.ok(client.indexOf("!result.noticeGate.ready") < client.indexOf("await acquireAttendancePosition"));
  assert.match(client, /!safeFinish && failure === null/);
  assert.match(client, /result.noticeGate.revision > pending.intent.noticeRevision/);
  assert.match(client, /result.state.sequence !== finishSequence/);
  const server = read("../src/lib/merchantAttendanceLocationClock.server.ts");
  assert.match(server, /attendanceClockRpcName\("location", input.siteId\)/);
  assert.match(server, /service\.rpc\(clockRpcName,/);
  const dispatcher = read("../src/lib/merchantAttendanceRuleBindingDispatch.server.ts");
  assert.match(dispatcher, /location: \["faolla_attendance_location_clock_v2", "faolla_attendance_location_clock_bound_v1"\]/);
  assert.match(dispatcher, /FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED !== "1"/);
  assert.match(dispatcher, /sites\.includes\(siteId\)/);
  assert.match(read("../src/components/enterprise/MerchantAttendanceLocationClockPanel.tsx"), /无定位收尾（不是定位通过）/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationClock|location-clock/);
  const native = read("./merchant-attendance-location-clock-notice-native.mjs");
  assert.match(native, /runAttendanceLabelsReuse/); assert.match(native, /query\(`begin;/); assert.match(native, /rollback;`\)/);
  assert.match(native, /synthetic_link_failure/); assert.doesNotMatch(native, /initdb|mkdtemp|dotenv|DATABASE_URL|SUPABASE_/);
});
