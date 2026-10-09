import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const sql=readFileSync(new URL("./supabase-migrations/202609300068_merchant_attendance_self_history.sql",import.meta.url),"utf8");
test("self history is additive with no existing employee, event or role writes",()=>{
  assert.doesNotMatch(sql,/\b(update|delete|truncate|alter table|create table)\b/i);
  assert.equal((sql.match(/insert into/gi)||[]).length,1);
  assert.match(sql,/insert into public.faolla_schema_migrations/);
  assert.match(sql,/revoke all on function public.faolla_attendance_self_history_v1\(text,uuid,jsonb\) from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public.faolla_attendance_self_history_v1\(text,uuid,jsonb\) to service_role/);
});
test("history locks current employee role and binding, self filters precede page limit",()=>{
  assert.match(sql,/auth_user_id=p_auth_user_id for share/);
  assert.match(sql,/attendance.self.view/);assert.doesNotMatch(sql,/attendance.records.view|attendance.self.clock/);
  assert.match(sql,/employee_id=v_employee.id for share/);
  assert.ok(sql.indexOf("employee_id=v_employee.id for share")<sql.indexOf("v_now:=clock_timestamp()"));
  assert.match(sql,/e.merchant_id=p_site_id and e.worker_id=v_worker.id[\s\S]*?order by e.occurred_at desc,e.id desc limit 51/);
  assert.match(sql,/v_worker.id<>\(p_query->>'expectedWorkerId'\)::uuid/);
  assert.doesNotMatch(sql,/not v_worker.active|not v_settings.enabled|not l.active/);
  assert.match(sql,/interval '31 days'/);
});
