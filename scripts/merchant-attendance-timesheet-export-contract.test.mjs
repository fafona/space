import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('export permission validator extends current catalogue without role backfill or changing report readers',()=>{
  const old=read('scripts/supabase-migrations/202609300081_merchant_attendance_request_permission.sql'),next=read('scripts/supabase-migrations/202610010090_merchant_attendance_period_export.sql');
  const fn=s=>s.match(/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\$\$;/i)?.[0];
  assert(fn(old));assert(fn(next));
  assert.equal(fn(next).replace(/^.*\('attendance\.(?:self|reports)\.export'.*\n/gm,''),fn(old));
  assert(!/update public\.merchant_enterprise_roles|create or replace function public\.faolla_attendance_(?:scoped_)?period_report/i.test(next));
  assert.match(next,/revoke all on public\.merchant_attendance_report_exports from public,anon,authenticated,service_role/);
  assert.match(next,/enable row level security/);assert.match(next,/before update or delete/);assert.match(next,/before truncate/);
  assert.match(next,/on conflict\(merchant_id,operation_id\) do nothing/);assert.match(next,/case when replayed then 'null'::jsonb else report end/);
});
test('download entry is gated and mounted only on successful existing reports, no maintenance or background jobs',()=>{
  const component=read('src/components/enterprise/MerchantAttendanceTimesheetExport.tsx');
  assert.match(component,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_EXPORT_ENABLED/);assert.match(component,/URL\.revokeObjectURL/);
  for(const name of ['MerchantAttendanceTimesheetPanel','MerchantAttendanceScopedTimesheetPanel'])assert.match(read('src/components/enterprise/'+name+'.tsx'),/MerchantAttendanceTimesheetExport report=/);
  const client=read('src/lib/merchantAttendanceTimesheetExportClient.ts');assert(!/localStorage|sessionStorage|setInterval/.test(client));
  assert.match(client,/parseTimesheetExportReceipt/);assert.match(client,/Date\.parse\(until\)-Date\.parse\(receipt\.asOf\)<=now\(\)-started/);
});
