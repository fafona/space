import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=file=>readFileSync(new URL(file,import.meta.url),"utf8");
const sql=read("./supabase-migrations/202609300080_merchant_attendance_audit_export.sql");
test("export migration is additive, read-only, owner locked and service-only",()=>{
  assert.doesNotMatch(sql,/\b(update|delete|truncate|alter table|create table)\b/i);
  assert.equal((sql.match(/insert into/gi)||[]).length,1);assert.match(sql,/where id=p_site_id for share/);
  assert.match(sql,/revoke all on function public.faolla_attendance_audit_export_v1\(text,uuid,jsonb\) from public,anon,authenticated,service_role/);
  assert.equal((sql.match(/grant execute/gi)||[]).length,1);
  assert.match(sql,/set search_path=pg_catalog/);assert.doesNotMatch(sql,/current_setting\('request|merchant_attendance_events/);
});
test("export uses one bounded receipt snapshot and historical whitelist without paging RPC loops",()=>{
  assert.match(sql,/with receipts as materialized/);assert.equal((sql.match(/limit 251/g)||[]).length,2);
  assert.equal((sql.match(/merchant_id=p_site_id and recorded_at>=v_from/g)||[]).length,2);
  assert.match(sql,/jsonb_array_length\(v_rows\)>250/);assert.match(sql,/octet_length\(v_result::text\)>1572864/);
  assert.match(sql,/interval '31 days'/);assert.match(sql,/faolla_attendance_audit_value_v1\(kind,before_value,true,target_id\)/);
  assert.doesNotMatch(sql,/loop|offset|faolla_attendance_audit_v1\(/i);
});
test("export UI is in owner audit screen, uses current filters, clears on hidden/unmount and releases blob",()=>{
  const panel=read("../src/components/enterprise/MerchantAttendanceAuditPanel.tsx"),ui=read("../src/components/enterprise/MerchantAttendanceAuditExport.tsx");
  const client=read("../src/lib/merchantAttendanceAuditExportClient.ts");
  assert.match(panel,/MerchantAttendanceAuditExport siteId=\{siteId\} start=\{start\} end=\{end\} zone=\{zone\} source=\{source\}/);
  assert.match(ui,/document.visibilityState==="visible"/);assert.match(ui,/document.visibilityState==="hidden"\)client.invalidate/);
  assert.match(ui,/client.invalidate\(\);\},\[client,start,end,zone,source\]/);
  assert.match(ui,/URL.revokeObjectURL\(url\)/);assert.match(ui,/anchor.remove\(\)/);
  assert.doesNotMatch(client,/localStorage|sessionStorage|setInterval|method:\s*["']POST/);
  assert.match(client,/maxBytes:2097152/);assert.match(client,/g!==this.generation\|\|!this.options.available\(\)/);
});
