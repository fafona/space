import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300076_merchant_attendance_location_notices.sql");
test("notices and acknowledgements are append-only and cannot activate GPS or change any facts", () => {
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 2); assert.equal((sql.match(/before update or delete/g) ?? []).length, 2); assert.equal((sql.match(/before truncate/g) ?? []).length, 2);
  assert.match(sql, /from public,anon,authenticated,service_role/); assert.match(sql, /primary key\(merchant_id,employee_id,worker_id,location_id,notice_revision\)/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.merchant_attendance_(?:settings|workers|locations|events|location_results|location_reviews)\b/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)/i);
});
test("immutable draft reference and fixed template bind publication to current configuration", () => {
  assert.match(sql, /template_version integer not null default 1 check\(template_version=1\)/);
  assert.match(sql, /references public.merchant_attendance_location_policy_drafts/);
  assert.match(sql, /draft.revision<>\(p_command->>'draftRevision'\)/); assert.match(sql, /s.version<>\(draft.command->>'expectedSettingsVersion'\)/);
  assert.match(sql, /\(published_draft.command->'values'\)-'latitude'-'longitude'/);
});
test("employee/current owner checks and serialization precede receipt replay, GET cannot acknowledge", () => {
  assert.ok(sql.indexOf("select * into emp") < sql.indexOf("select * into ack_receipt")); assert.match(sql, /w.default_location_id is distinct from loc/);
  assert.match(sql, /ack_receipt.worker_id<>w.id or ack_receipt.actor_auth_user_id<>p_auth_user_id/);
  assert.match(sql, /if p_command is not null then[\s\S]*insert into public.merchant_attendance_location_notice_acknowledgements/);
  assert.match(sql, /where merchant_id=p_site_id for update/);
});
test("UI distinguishes explicit confirmation and activation, stays isolated and performs no tracking", () => {
  const panel = read("../src/components/enterprise/MerchantAttendanceLocationNoticePanel.tsx"), route = read("../src/app/api/merchant-enterprise/attendance/location-notice/route-handler.ts");
  assert.match(panel, /本操作不是同意定位/); assert.match(panel, /本地候选定位打卡已增加最终版本校验/); assert.match(panel, /!allowed \|\| !confirmed/);
  assert.match(route, /FAOLLA_ATTENDANCE_LOCATION_NOTICE_ENABLED/); assert.doesNotMatch(panel, /navigator\.geolocation|watchPosition|dangerouslySetInnerHTML|setInterval/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationNotice|location-notice/);
  assert.doesNotMatch(read("./merchant-attendance-location-notice-native.mjs"), /dotenv|DATABASE_URL|SUPABASE_|mkdtemp|rmSync|disable trigger/);
});
