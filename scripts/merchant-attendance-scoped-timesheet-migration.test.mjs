import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const sql=read("scripts/supabase-migrations/202610010088_merchant_attendance_scoped_period_report.sql");
test("new scoped reader is service-only, additive and never impersonates owner reader",()=>{
  assert.match(sql,/security definer set search_path=pg_catalog/);assert.equal((sql.match(/grant execute/g)||[]).length,1);
  assert.match(sql,/revoke all on function[\s\S]*from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql,/create or replace|faolla_attendance_period_report_v1\(|insert into public\.merchant_attendance_|update public\.|delete from public\.|alter table|grant select/i);
  assert.equal((sql.match(/create index/g)||[]).length,2);
});
test("self identity is server-derived and every segment event retains immutable attribution",()=>{
  assert.match(sql,/auth_user_id=p_auth_user_id for share/);assert.match(sql,/employee_id=viewer\.id for share/);assert.match(sql,/expected_worker<>worker/);
  assert.match(sql,/actor_employee_id is not distinct from viewer\.id/);assert.match(sql,/r\.employee_id is distinct from viewer\.id then continue/);
  assert.match(sql,/'actorEmployeeId',ev\.actor_employee_id/);
});
test("manager pair is matched inside one current grant, not current worker location",()=>{
  assert.match(sql,/sw\.grant_id=g\.id/);assert.match(sql,/sl\.grant_id=g\.id/);assert.match(sql,/sw\.worker_id=worker and sl\.location_id=target_location/);
  assert.doesNotMatch(sql,/default_location_id/);assert.match(sql,/g\.valid_from<=now_at/);assert.match(sql,/clock_timestamp\(\)>=access_until/);
  assert.ok(sql.indexOf("select * into viewer_scope")<sql.indexOf("now_at:=clock_timestamp()"));
});
test("whole-segment check precedes projection and bounded result never claims completeness for person",()=>{
  assert.ok(sql.indexOf("if not coalesce(fully_visible,false)")<sql.indexOf("select jsonb_agg"));assert.match(sql,/'coverage','authorized-complete-sessions-v1'/);
  for(const pattern of [/limit 101/,/limit 2003/,/record_count>2002/,/event_count>4000/,/octet_length\(result::text\)>1048576/])assert.match(sql,pattern);
  assert.match(sql,/join public\.merchant_attendance_events se/);assert.doesNotMatch(sql,/'excludedCount'|'hiddenCount'|'excludedItems'/);
});
