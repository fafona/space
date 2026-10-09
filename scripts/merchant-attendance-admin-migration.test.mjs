import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(p)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const sql=read("scripts/supabase-migrations/202609290064_merchant_attendance_owner_configuration.sql");
test("owner configuration is additive, service RPC only and no existing user/role backfill",()=>{
  assert.match(sql,/security definer set search_path=pg_catalog/);
  assert.match(sql,/revoke all on function public\.faolla_attendance_admin_v1.*from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public\.faolla_attendance_admin_v1.*to service_role/);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete|all)\s+on/i);
  assert.doesNotMatch(sql,/(update|delete from|insert into) public\.(merchants|merchant_enterprise_employees|merchant_enterprise_roles)\b/i);
  assert.doesNotMatch(sql,/(update|delete from|insert into) public\.merchant_attendance_events\b/i);
});
test("config receipt and audit are append-only; ownership and version locks precede writes",()=>{
  assert.match(sql,/primary key \(merchant_id,operation_id\)/);
  assert.match(sql,/unique \(merchant_id,version\)/);
  assert.match(sql,/config_no_rewrite before update or delete/);
  assert.match(sql,/config_no_truncate before truncate/);
  assert.ok(sql.indexOf("where id=p_site_id for share")<sql.indexOf("if v_kind='settings' and v_expected=0"));
  assert.match(sql,/get diagnostics v_inserted = row_count/);
  assert.match(sql,/attendance_version_conflict/);
  assert.match(sql,/attendance_open_sessions/);
});
test("configuration entry is owner only including merchant external navigation",()=>{
  const ui=read("src/components/admin/MerchantEnterpriseManager.tsx");
  assert.equal((ui.match(/item.key !== "attendanceAdmin" \|\| actor.type === "owner"/g)??[]).length,2);
  assert.match(ui,/requestedView !== "attendanceAdmin" \|\| actor.type === "owner"/);
  assert.match(ui,/tab === "attendanceAdmin" && actor.type === "owner"/);
  assert.match(read("src/app/admin/AdminClient.tsx"),/label: "考勤配置", view: "attendanceAdmin"/);
  assert.match(read("src/app/api/merchant-enterprise/attendance/admin/route-handler.ts"),/FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1"/);
});
