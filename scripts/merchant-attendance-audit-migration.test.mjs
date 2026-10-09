import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=file=>readFileSync(new URL(file,import.meta.url),"utf8");
const sql=read("./supabase-migrations/202609300069_merchant_attendance_audit_read.sql");
test("audit migration adds read-only owner access without existing data writes",()=>{
  assert.doesNotMatch(sql,/\b(update|delete|truncate|alter table|create table)\b/i);
  assert.equal((sql.match(/insert into/gi)||[]).length,1);
  assert.match(sql,/insert into public.faolla_schema_migrations/);
  assert.match(sql,/revoke all on function public.faolla_attendance_audit_value_v1\(text,jsonb,boolean,uuid\) from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public.faolla_attendance_audit_v1\(text,uuid,jsonb\) to service_role/);
  assert.equal((sql.match(/grant execute/gi)||[]).length,1);
});
test("audit pages are tenant bounded with owner recheck and matching time indexes",()=>{
  assert.equal((sql.match(/merchant_id,recorded_at desc,operation_id desc/g)||[]).length,2);
  assert.match(sql,/where id=p_site_id for share/);
  for(const column of ["user_id","auth_user_id","owner_user_id","owner_id","auth_id","created_by","created_by_user_id"])assert.ok(sql.includes(`m.${column}`));
  assert.ok(sql.indexOf("for share")<sql.indexOf("v_now:=clock_timestamp()"));
  assert.equal((sql.match(/order by recorded_at desc,operation_id desc limit 26/g)||[]).length,2);
  assert.match(sql,/v_source='config' and merchant_id=p_site_id/);assert.match(sql,/v_source='scope' and merchant_id=p_site_id/);
  assert.match(sql,/interval '31 days'/);assert.match(sql,/\(recorded_at,operation_id\)<\(v_cursor_at,v_cursor\)/);
});
test("audit detail projects one immutable operation and never reconstructs old employment",()=>{
  assert.match(sql,/jsonb_array_elements\(p_value->'grants'\)g where g->>'id'=p_target::text/);
  assert.match(sql,/'startsOn',case when p_before then 'null'::jsonb else p_value->'startsOn' end/);
  assert.equal((sql.match(/where merchant_id=p_site_id and operation_id=v_operation/g)||[]).length,2);
  assert.doesNotMatch(sql,/merchant_attendance_employments|latitude|longitude|current_setting\('request/);
  assert.match(sql,/md5\('attendance-audit:'\|\|p_site_id/);
});
test("audit UI is owner-local, on-demand, read-only and clears hidden views",()=>{
  const panel=read("../src/components/enterprise/MerchantAttendanceAuditPanel.tsx");
  const admin=read("../src/components/enterprise/MerchantAttendanceAdminPanel.tsx");
  const client=read("../src/lib/merchantAttendanceAuditClient.ts");
  assert.match(admin,/lazy\(\(\)\s*=>\s*import\("\.\/MerchantAttendanceAuditPanel"\)\)/);
  assert.match(panel,/key=\{`\$\{props.siteId\}:\$\{props.ownerId\}`\}/);
  assert.match(panel,/document.visibilityState==="hidden"\)client.invalidate/);
  assert.match(panel,/当时快照未记录/);assert.match(panel,/修改前后对比/);
  assert.doesNotMatch(client,/localStorage|sessionStorage|setInterval|method:\s*["']POST/);
  assert.match(client,/maxBytes:65536/);assert.match(client,/list.items.includes\(entry\)/);
});
test("audit database verification reuses existing synthetic storage and rolls back schema plus data",()=>{
  const checks=read("./merchant-attendance-audit-native-checks.mjs");
  const reuse=read("./merchant-attendance-choice-labels-reuse-native.mjs");
  const entry=read("./merchant-attendance-audit-reuse-native.mjs");
  assert.match(checks,/output=query\(`begin;/);assert.match(checks,/rollback;`\)/);
  assert.match(entry,/runAttendanceLabelsReuse/);assert.match(reuse,/'indexes'.*select md5\(string_agg\(indexdef/);
  assert.doesNotMatch(checks+entry,/dotenv|SUPABASE_|DATABASE_URL|rmSync|mkdtempSync/);
});
