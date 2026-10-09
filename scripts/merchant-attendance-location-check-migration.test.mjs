import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300071_merchant_attendance_location_precheck.sql");
test("location diagnostic adds only a default-closed field and read RPC; no event/evidence DML", () => {
  assert.match(sql, /location_check_enabled boolean not null default false/);
  assert.doesNotMatch(sql, /\b(update|delete|truncate|create table|create index)\b/i);
  assert.equal((sql.match(/insert into/gi) || []).length, 1);
  assert.match(sql, /revoke all on function public.faolla_attendance_location_policy_v1\(text,uuid,uuid,uuid,jsonb\) from public,anon,authenticated,service_role/);
  assert.match(sql, /grant execute on function public.faolla_attendance_location_policy_v1\(text,uuid,uuid,uuid,jsonb\) to service_role/);
  assert.match(sql, /'diagnosticOnly',true,'punchRecorded',false/);
});
test("current self role/binding/default-place/versions are rechecked; clock after share locks", () => {
  assert.match(sql, /auth_user_id=p_auth_user_id for share/); assert.match(sql, /employee_id=v_employee.id for share/);
  assert.match(sql, /attendance.self.clock/); assert.match(sql, /default_location_id is distinct from p_expected_location_id/);
  assert.match(sql, /'workerVersion'\)::bigint<>v_worker.version/);
  assert.ok(sql.indexOf("id=v_worker.default_location_id for share") < sql.indexOf("v_now:=date_trunc"));
});
test("diagnostic UI is not enabled in enterprise or ordinary self punch UI", () => {
  for (const file of ["../src/components/enterprise/MerchantAttendanceSelfPanel.tsx", "../src/components/admin/MerchantEnterpriseManager.tsx"])
    assert.doesNotMatch(read(file), /MerchantAttendanceLocationCheckPanel|location-check/);
  const route = read("../src/app/api/merchant-enterprise/attendance/location-check/route-handler.ts");
  assert.match(route, /FAOLLA_ATTENDANCE_SELF_ENABLED.*FAOLLA_ATTENDANCE_LOCATION_CHECK_ENABLED/);
  const panel = read("../src/components/enterprise/MerchantAttendanceLocationCheckPanel.tsx");
  assert.match(panel, /onClick=\{\(\) => void client.run\(\)\}/); assert.match(panel, /visibilitychange/);
  assert.match(panel, /未接入正式打卡/);
});
test("position collector has one-shot only, no local tracking history, auto loops, payload logging or punch endpoint", () => {
  const client = read("../src/lib/merchantAttendanceLocationCheckClient.ts");
  assert.match(client, /maximumAge: 0/); assert.match(client, /nativePending.has/);
  assert.doesNotMatch(client, /watchPosition|localStorage|sessionStorage|indexedDB|setInterval|console\.|attendance\/self/);
  const server = read("../src/lib/merchantAttendanceLocationCheck.server.ts");
  assert.doesNotMatch(server, /console\.|p_position|\.insert\(|\.update\(/);
  assert.match(server, /distanceMeters.*Math.round/);
});
test("location native check reuses only local fixture, asserts original fence guard, and rolls back", () => {
  const native = read("./merchant-attendance-location-check-native.mjs");
  assert.match(native, /runAttendanceLabelsReuse/); assert.match(native, /query\(`begin;/); assert.match(native, /rollback;`\)/);
  assert.match(native, /attendance_location_verification_required/);
  assert.doesNotMatch(native, /dotenv|SUPABASE_|DATABASE_URL|mkdtemp|rmSync|disable trigger|session_replication_role/);
});
