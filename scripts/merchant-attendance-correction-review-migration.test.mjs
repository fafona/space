import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const sql = read("scripts/supabase-migrations/202609300083_merchant_attendance_correction_owner_review.sql");
test("owner review migration adds only bounded read helpers and partial inbox indexes; no business write grants", () => {
  assert.equal((sql.match(/create index /gi) ?? []).length, 2);
  assert.equal((sql.match(/where action='submit'/gi) ?? []).length, 2);
  assert.doesNotMatch(sql, /insert into public\.(?!faolla_schema_migrations)|update public\.|delete from public\.|truncate |create table |alter table /i);
  assert.match(sql, /set local lock_timeout='3s'/);
  assert.equal((sql.match(/grant execute/gi) ?? []).length, 1);
  assert.match(sql, /grant execute on function public\.faolla_attendance_correction_owner_review_v1\(text,uuid,jsonb\) to service_role/);
  assert.match(sql, /revoke all on function public\.faolla_attendance_review_event_v1\(public\.merchant_attendance_events\) from public,anon,authenticated,service_role/);
  assert.match(sql, /revoke all on function public\.faolla_attendance_correction_owner_basis_v1\(text,uuid,uuid,uuid,timestamptz\) from public,anon,authenticated,service_role/);
});
test("review authenticates current merchant owner under locks without acting as the employee", () => {
  const rpc = sql.slice(sql.indexOf("create function public.faolla_attendance_correction_owner_review_v1"));
  const positions = ["public.merchants where id=p_site_id and user_id=p_auth_user_id for share", "public.merchant_attendance_settings where",
    "public.merchant_enterprise_employees where", "public.merchant_attendance_workers where merchant_id=p_site_id and id=r.worker_id for share"].map(s => rpc.indexOf(s));
  assert.ok(positions.every(i => i >= 0)); assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(rpc, /security definer set search_path=pg_catalog/);
  assert.doesNotMatch(rpc, /set_config|set role|faolla_attendance_correction_self_v1|faolla_attendance_self_clock/);
  assert.match(rpc, /'bindingCurrent',coalesce\(w.employee_id=r.employee_id and emp.auth_user_id=r.actor_auth_user_id,false\)/);
  assert.match(rpc, /'ownApplication',r.actor_auth_user_id=p_auth_user_id/);
  assert.equal((rpc.match(/'approvalAvailable',false/g) ?? []).length, 2);
});
test("inbox and evidence scans are capped, cutoff uses microseconds, and empty filtered pages advance", () => {
  for (const expression of [/limit 51 loop/, /exit when v_count=51/, /'scanned',least\(v_count,50\)/, /limit 203 loop/, /if n>202/,
    /limit 101/, /filter\(where rn<=100\)/, /'employmentTruncated',v_period_count>100/, /interval '1 microsecond'/, /interval '31 days'/]) assert.match(sql, expression);
  const rpc = sql.slice(sql.indexOf("create function public.faolla_attendance_correction_owner_review_v1"));
  assert.ok(rpc.indexOf("v_next:=jsonb_build_object") < rpc.indexOf("then continue;end if"));
  assert.match(rpc, /recorded_at<=v_asof order by revision desc limit 1/);
  assert.match(rpc, /\(recorded_at,request_id\)<\(v_cursor_at,v_cursor\)/);
});
test("review HTTP surface is GET-only and guarded by default-off server flags", () => {
  const route = read("src/app/api/merchant-enterprise/attendance/correction-reviews/route.ts");
  assert.match(route, /export const GET/); assert.doesNotMatch(route, /export const (POST|PUT|PATCH|DELETE)/);
  const handler = read("src/app/api/merchant-enterprise/attendance/correction-reviews/route-handler.ts");
  assert.match(handler, /FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED === "1"/);
  assert.match(handler, /isCanonicalPortalRequest/); assert.match(handler, /private, no-store/);
});
