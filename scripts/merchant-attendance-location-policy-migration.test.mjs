import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = f => readFileSync(new URL(f, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300073_merchant_attendance_location_policy_drafts.sql");
test("policy draft migration is additive with restricted append-only history and two bounded indexes", () => {
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on public.merchant_attendance_location_policy_drafts from public,anon,authenticated,service_role/);
  assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/);
  assert.match(sql, /primary key\(merchant_id,location_id,revision\)/); assert.match(sql, /unique\(merchant_id,operation_id\)/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.merchant_attendance_(?:settings|locations|events|workers)\b/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete)|location_clock_enabled\s*=|location_check_enabled\s*=/i);
});
test("current owner check and configuration locks precede receipt replay and revision insertion", () => {
  assert.match(sql, /v_merchant\.user_id,v_merchant\.auth_user_id/); assert.match(sql, /merchant_id=p_site_id for update/);
  assert.ok(sql.indexOf("select * into v_merchant") < sql.indexOf("select * into v_receipt"));
  assert.match(sql, /v_receipt\.actor_auth_user_id<>p_auth_user_id/); assert.match(sql, /v_receipt.command<>p_command/);
  assert.match(sql, /expectedSettingsVersion/); assert.match(sql, /expectedLocationVersion/);
  assert.ok(sql.indexOf("if v_receipt.command<>") < sql.indexOf("if not p_allow_write"));
  assert.match(sql, /order by revision desc limit 1/); assert.match(sql, /revision=v_current.revision-1/);
});
test("draft UI and API cannot activate or request location; no live enterprise mount", () => {
  const route = read("../src/app/api/merchant-enterprise/attendance/location-policy/route-handler.ts"), panel = read("../src/components/enterprise/MerchantAttendanceLocationPolicyPanel.tsx");
  assert.match(route, /FAOLLA_ATTENDANCE_ADMIN_ENABLED.*FAOLLA_ATTENDANCE_LOCATION_POLICY_ENABLED/);
  assert.match(panel, /保存草稿 · 不启用定位/); assert.match(panel, /未启用|不启用/); assert.match(panel, /!acknowledged/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|navigator\.geolocation|watchPosition/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationPolicy|location-policy/);
  const client = read("../src/lib/merchantAttendanceLocationPolicyClient.ts"); assert.doesNotMatch(client, /setInterval|console\.|geolocation/); assert.match(client, /maxBytes: 16384/);
});
