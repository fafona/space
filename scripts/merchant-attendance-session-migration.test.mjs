import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=file=>readFileSync(new URL(file,import.meta.url),"utf8");
const sql=read("./supabase-migrations/202609300070_merchant_attendance_self_session.sql");
test("session migration only adds a service-only read RPC and migration ledger entry",()=>{
  assert.doesNotMatch(sql,/\b(update|delete|truncate|alter table|create table|create index)\b/i);
  assert.equal((sql.match(/insert into/gi)||[]).length,1);assert.match(sql,/insert into public.faolla_schema_migrations/);
  assert.match(sql,/revoke all on function public.faolla_attendance_self_session_v1\(text,uuid,uuid\) from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public.faolla_attendance_self_session_v1\(text,uuid,uuid\) to service_role/);
});
test("session rechecks current self membership before filtering selected event and bounding both scans",()=>{
  assert.match(sql,/auth_user_id=p_auth_user_id for share/);assert.match(sql,/attendance.self.view/);
  assert.doesNotMatch(sql,/attendance.self.clock|not v_worker.active|not v_settings.enabled|not l.active/);
  assert.match(sql,/employee_id=v_employee.id for share/);assert.match(sql,/worker_id=v_worker.id and id=p_start_event_id and action='clock_in'/);
  assert.match(sql,/sequence=v_start.sequence-1 and action='clock_out'/);
  assert.ok(sql.indexOf("employee_id=v_employee.id for share")<sql.indexOf("v_now:=clock_timestamp()"));
  assert.equal((sql.match(/order by sequence limit 2003/g)||[]).length,2);
  assert.match(sql,/jsonb_array_length\(v_rows\)>2002/);assert.match(sql,/and \(v_end_sequence is null or sequence<=v_end_sequence\)/);
  assert.doesNotMatch(sql,/jsonb_build_object\('operationId'|actor_auth_user_id|evidence|latitude|longitude/);
});
test("session UI loads lazily from one clock-in, clears on page changes and disclaims fabricated hours",()=>{
  const history=read("../src/components/enterprise/MerchantAttendanceHistoryPanel.tsx"),panel=read("../src/components/enterprise/MerchantAttendanceSessionPanel.tsx");
  assert.match(history,/lazy\(\(\)=>import\("\.\/MerchantAttendanceSessionPanel"\)\)/);
  assert.match(history,/record.action==="clock_in"&&sessionId===record.id/);assert.match(history,/closeSession\(\);void client.next/);
  assert.match(history,/selectedSession.current=null;setSessionId\(null\)/);
  assert.match(history,/onIdentityInvalidated=\{onSessionIdentityInvalidated\}/);
  assert.match(history,/client.invalidateFromSession\(state.result\)/);
  assert.match(panel,/不自动补下班|不补造结束时间/);assert.match(panel,/不计算应出勤、加班或工资/);
  assert.match(panel,/props.siteId.*props.employeeId.*props.startEventId/);
});
test("session read client keeps no durable history or automatic request loop",()=>{
  const client=read("../src/lib/merchantAttendanceSessionClient.ts");
  assert.doesNotMatch(client,/localStorage|sessionStorage|setInterval|method:\s*["']POST/);
  assert.match(client,/maxBytes:1048576/);assert.match(client,/result.employeeId!==this.options.employeeId/);
  assert.match(client,/result:null,report:null/);
});
test("session boundary database fixtures are local, bounded, constraint-preserving and rolled back",()=>{
  const checks=read("./merchant-attendance-session-native-checks.mjs"),entry=read("./merchant-attendance-session-reuse-native.mjs");
  assert.match(checks,/script=`begin;/);assert.match(checks,/rollback;`;/);assert.match(checks,/rollback to savepoint bulk_boundary/);
  assert.match(checks,/await querySteps\(script.split/);
  assert.doesNotMatch(checks+entry,/dotenv|SUPABASE_|DATABASE_URL|rmSync|mkdtempSync|disable trigger|session_replication_role/);
  assert.match(entry,/runAttendanceLabelsReuse/);
  const runner=read("./merchant-attendance-choice-labels-reuse-native.mjs");
  assert.match(runner,/sources.length<=100/);assert.match(runner,/attendance_reuse_step_deadline/);
  assert.match(runner,/25000/);assert.match(runner,/statement_timeout=10000/);assert.match(runner,/await check/);
});
