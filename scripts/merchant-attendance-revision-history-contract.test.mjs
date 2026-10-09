import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'),sql=read('scripts/supabase-migrations/202610010097_merchant_attendance_revision_history.sql');
test('history adds two bounded query indexes and private read-only function, no copies, backfill or execution grants',()=>{
  assert.equal((sql.match(/create index/g)||[]).length,2);assert.equal((sql.match(/create function/g)||[]).length,1);
  assert(!/create table|grant execute|update public\.|delete from|truncate|create or replace/i.test(sql));
  assert.match(sql,/revoke all on function public\.faolla_attendance_revision_history_v1\(text,uuid,jsonb\) from public,anon,authenticated,service_role/);
  assert.deepEqual([...sql.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
});
test('history independently rechecks owner or bound current employee and preserves read snapshot fences',()=>{
  for(const s of ["v_access='self' or user_id=p_auth_user_id","emp.status<>'active'","role_row.status<>'active'","attendance.self.view","worker.id<>v_worker","original.actor_auth_user_id is distinct from p_auth_user_id","for share","recorded_at<=v_asof","v_asof>v_now"] )assert(sql.includes(s),s);
  assert(sql.includes("r.employee_id<>emp.id or r.actor_auth_user_id<>p_auth_user_id"));assert(!sql.includes('revision%'));
});
test('candidate scan precedes true terminal filtering, both indexes match sorted scope and no current payroll projection leaks',()=>{
  assert(sql.includes('union all'));assert(sql.includes('base_request_id=v_root'));assert(sql.includes('limit 51'));assert(sql.includes('least(v_count,50)'));
  assert(sql.indexOf('exit when v_count=51')<sql.indexOf("if v_status<>'all'"));assert(sql.includes('v_count=51 then v_next'));assert(sql.includes("'readOnly',true"));assert(sql.includes('131072'));
  assert(!/effect_current|reason',|latitude|select count\(\*\) from public/.test(sql));
});
test('real parent entries are opt-in lazy and block switching while uncertain; list is read-only and no storage/polling',()=>{
  for(const f of ['MerchantAttendanceRevisionApprovalPanel','MerchantAttendanceRevisionWorkspace']){const s=read('src/components/enterprise/'+f+'.tsx');assert(s.includes('NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED'));assert(s.includes('lazy(()=>import("./MerchantAttendanceRevisionHistoryPanel"))'));assert(s.includes('client.pause()'));}
  const ui=read('src/components/enterprise/MerchantAttendanceRevisionHistoryPanel.tsx'),client=read('src/lib/merchantAttendanceRevisionHistoryClient.ts');
  for(const s of ['最多 31 个 UTC 日','不是历史身份快照','状态截点','下一页候选','visibilitychange','进入详情重新核验最新状态'])assert(ui.includes(s),s);
  assert(!/localStorage|sessionStorage|setInterval|method:"POST"/.test(ui+client));assert(client.includes('result.employeeId!==this.options.actorId'));assert(client.includes('maxBytes:131072'));
});
