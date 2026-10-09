import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./supabase-migrations/202609300087_merchant_attendance_period_report.sql',import.meta.url),'utf8');
test('period report migration adds only one service-read RPC, index and migration marker',()=>{
  assert.match(sql,/security definer set search_path=pg_catalog/);assert.match(sql,/revoke all on function public\.faolla_attendance_period_report_v1\(text,uuid,jsonb\) from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public\.faolla_attendance_period_report_v1\(text,uuid,jsonb\) to service_role/);
  assert.doesNotMatch(sql,/create table|create or replace|for update|grant (?:select|insert|update|delete)|\b(?:update|delete from|truncate) public\./i);
  assert.equal((sql.match(/insert into/g)||[]).length,1);assert.match(sql,/where action='clock_in'/);
});
test('authorization, stable read locks and current timestamp precede evidence selection',()=>{
  for(const text of ['user_id=p_auth_user_id for share','merchant_id=p_site_id for share','id=worker for share','now_at:=clock_timestamp()'])assert.ok(sql.includes(text));
  assert.ok(sql.indexOf('now_at:=clock_timestamp()')<sql.indexOf('with inside as'));
  assert.match(sql,/attendance_access_denied/);assert.match(sql,/attendance_worker_not_found/);
});
test('both original boundary and approvals moved into the period are bounded candidates',()=>{
  for(const text of ['preceding as','moved as',"from_at-interval '31 days'",'union select id from moved','candidate_count>100','limit 2003','event_count>4000','1048576','last_day-first_day>30'])assert.ok(sql.includes(text));
  assert.match(sql,/attendance_report_too_large/);assert.match(sql,/'complete',true/);
});
test('effective source verifies decision, submission and original last event without leaking internal reasons',()=>{
  for(const text of ["d.action is distinct from 'approve'",'d.operation_id is distinct from eff.operation_id','r.proposal is distinct from eff.proposal',"r.basis->'events'->-1->'id'"] )assert.ok(sql.includes(text));
  assert.doesNotMatch(sql,/'actor_auth_user_id'|'reason'|'latitude'|'longitude'|'review_snapshot'/);
});
test('native report acceptance reuses the owned database and chunks fixtures without weakening guards',()=>{
  const source=readFileSync(new URL('./merchant-attendance-timesheet-native.mjs',import.meta.url),'utf8');
  assert.match(source,/runAttendanceLabelsReuse/);assert.match(source,/withAttendanceConcurrencySandbox/);
  assert.match(source,/pg_blocking_pids\(pid\)/);assert.match(source,/context.querySteps/);
  assert.doesNotMatch(source,/\.\.\.process\.env|dotenv|SUPABASE_|DATABASE_URL|disable trigger|session_replication_role|statement_timeout\s*=|initdb|mkdtempSync/);
});
