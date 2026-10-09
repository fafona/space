import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300074_merchant_attendance_location_reviews.sql");
test("review migration adds an append-only annotation ledger without modifying original facts or permissions", () => {
  assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on public.merchant_attendance_location_reviews from public,anon,authenticated,service_role/);
  assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/); assert.match(sql, /unique\(merchant_id,operation_id\)/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.merchant_attendance_(?:events|location_results|settings|workers|locations)\b/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)|create index.*merchant_attendance_events/i);
});
test("owner and same-event lock precede receipt comparison and new revision insertion", () => {
  assert.ok(sql.indexOf("select * into m") < sql.indexOf("select * into v_receipt"));
  assert.match(sql, /event_id=v_event_id for update/); assert.match(sql, /v_receipt.actor_auth_user_id<>p_auth_user_id/);
  assert.match(sql, /v_receipt.command<>p_command/); assert.match(sql, /expectedRevision.*coalesce\(v_latest.revision,0\)/);
  assert.match(sql, /when unique_violation then raise exception 'attendance_operation_conflict'/);
});
test("list bounds raw tenant-time candidates before optional filters and preserves a scanned cursor", () => {
  assert.match(sql, /with candidates as materialized/); assert.match(sql, /limit 51/);
  assert.ok(sql.indexOf("limit 51") < sql.indexOf("r.worker_id<>v_worker")); assert.match(sql, /v_count=50 then v_next:=v_last_scan/);
  assert.match(sql, /order by revision desc limit 21/); assert.match(sql, /'historyTruncated',jsonb_array_length\(v_history\)>20/);
  assert.doesNotMatch(sql, /count\(\*\) from public\.merchant_attendance_events/);
});
test("UI requires reason and confirmation, is separately gated and remains outside enterprise shell", () => {
  const route = read("../src/app/api/merchant-enterprise/attendance/location-reviews/route-handler.ts"), panel = read("../src/components/enterprise/MerchantAttendanceLocationReviewPanel.tsx");
  assert.match(route, /FAOLLA_ATTENDANCE_ADMIN_ENABLED.*FAOLLA_ATTENDANCE_LOCATION_REVIEW_ENABLED/);
  assert.match(panel, /!confirmed \|\| !note.trim\(\)/); assert.match(panel, /不等于工资审批/); assert.match(panel, /每批检查 50 条打卡后筛选异常/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|navigator\.geolocation|watchPosition/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationReview|location-reviews/);
  const native = read("./merchant-attendance-location-review-native.mjs"); assert.match(native, /runAttendanceLabelsReuse/); assert.match(native, /rollback;`\)/);
  assert.doesNotMatch(native, /dotenv|SUPABASE_|DATABASE_URL|mkdtemp|rmSync|disable trigger/);
});
