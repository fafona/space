import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const sql = read("./supabase-migrations/202609300075_merchant_attendance_location_discussion.sql");
test("discussion ledger is append-only, service-only and cannot modify facts or expose private review notes", () => {
  assert.match(sql, /enable row level security/); assert.match(sql, /before update or delete/); assert.match(sql, /before truncate/);
  assert.match(sql, /revoke all on public.merchant_attendance_location_discussion from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.merchant_attendance_(?:events|location_results|location_reviews|settings|workers|locations)\b/i);
  assert.doesNotMatch(sql, /rv\.note|rv\.command|grant (?:select|insert|update|delete)/i);
});
test("current identity and binding precede receipts; worker AND original employee constrain self events", () => {
  assert.ok(sql.indexOf("select * into emp") < sql.indexOf("select * into receipt"));
  assert.match(sql, /ev.worker_id<>worker.id or ev.actor_employee_id is distinct from emp.id/);
  assert.match(sql, /receipt.actor_auth_user_id<>p_auth_user_id or receipt.author<>v_access/);
  assert.match(sql, /event_id=v_event and needs_review for update/); assert.match(sql, /receipt.command<>p_command/);
  assert.match(sql, /coalesce\(latest.revision,0\)<>\(p_command->>'expectedRevision'\)/);
});
test("bounded scans, separate latest-author marker and recent history avoid full-history reads", () => {
  assert.match(sql, /with candidates as materialized/); assert.match(sql, /limit 51/); assert.match(sql, /if v_count=51 then exit/);
  assert.match(sql, /'lastAuthor',r.author/); assert.match(sql, /order by revision desc limit 20/);
  assert.doesNotMatch(sql, /count\(\*\) from public\.merchant_attendance_events/);
});
test("standalone UI explicitly confirms public replies and cannot activate GPS or mutate enterprise entry", () => {
  const panel = read("../src/components/enterprise/MerchantAttendanceLocationDiscussionPanel.tsx"), route = read("../src/app/api/merchant-enterprise/attendance/location-discussion/route-handler.ts");
  assert.match(panel, /这段回复可以向该员工公开/); assert.match(panel, /!confirmed \|\| !note.trim\(\)/);
  assert.match(route, /FAOLLA_ATTENDANCE_LOCATION_DISCUSSION_ENABLED/); assert.match(route, /FAOLLA_ATTENDANCE_SELF_ENABLED/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|navigator\.geolocation|watchPosition|setInterval/);
  assert.doesNotMatch(read("../src/components/admin/MerchantEnterpriseManager.tsx"), /LocationDiscussion|location-discussion/);
});
