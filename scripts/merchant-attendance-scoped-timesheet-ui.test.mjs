import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('scoped UI is additive and gated with no owner selector or business write',()=>{
  const launcher=read('src/components/enterprise/MerchantAttendanceScopedTimesheetLauncher.tsx'),panel=read('src/components/enterprise/MerchantAttendanceScopedTimesheetPanel.tsx'),client=read('src/lib/merchantAttendanceScopedTimesheetClient.ts');
  assert.match(launcher,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED==="1"/);assert.match(launcher,/lazy/);
  assert.match(read('src/components/enterprise/MerchantAttendanceSelfPanel.tsx'),/actorId=\{employeeId\} access="self"/);
  assert.match(read('src/components/enterprise/MerchantAttendanceRecordsPanel.tsx'),/access === "manager" && <ScopedTimesheetLauncher/);
  assert.doesNotMatch(client,/\/attendance\/(admin|choices|timesheet)\?/);assert.doesNotMatch(panel+client,/localStorage|sessionStorage|setInterval|geolocation|method:\s*["'](?:POST|PATCH|DELETE)/);
  for(const event of ['visibilitychange','pagehide','pageshow'])assert(panel.includes(event));
  assert.match(panel,/不是完整个人月报/);assert.match(panel,/无实时撤权推送/);assert.match(client,/performance.now/);
});
test('context migration is service-only, bounded same-grant metadata with scope lock and revision guard',()=>{
  const sql=read('scripts/supabase-migrations/202610010089_merchant_attendance_scoped_report_context.sql');
  assert.match(sql,/security definer set search_path=pg_catalog/);assert.match(sql,/from public,anon,authenticated,service_role/);
  assert.match(sql,/sw\.grant_id=g\.id/);assert.match(sql,/sl\.grant_id=g\.id/);assert.match(sql,/limit 26/);assert.match(sql,/select \* into sc[\s\S]+for share/);
  assert.match(sql,/expected_revision<>sc\.revision/);assert.match(sql,/clock_timestamp\(\)>=access_until/);
  assert.doesNotMatch(sql,/insert into public\.merchant_|update public\.|delete from public\.|merchant_attendance_events|owner_user_id|default_location_id|grant select/);
});
