import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const read=name=>readFileSync(new URL(name,import.meta.url),"utf8").replaceAll("\r\n","\n");
const sql=read("./supabase-migrations/202609300082_merchant_attendance_correction_requests.sql");
test("request permission extends the prior validator exactly without granting any existing role",()=>{
  const pattern=/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\n\$\$;/;
  const before=read("./supabase-migrations/202609290065_merchant_attendance_record_permission.sql").match(pattern)?.[0];
  const source=read("./supabase-migrations/202609300081_merchant_attendance_request_permission.sql");
  const next=source.match(pattern)?.[0];assert.ok(before);assert.ok(next);
  assert.equal(next.replace(/\n      \('attendance\.self\.request',[^\n]+/,""),before);
  assert.doesNotMatch(source,/update public|insert into public.merchant_enterprise_roles|alter table/i);
});
test("correction ledger is separate, append-only and inaccessible through direct service/client table access",()=>{
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on public.merchant_attendance_correction_entries from public,anon,authenticated,service_role/);
  assert.match(sql,/before update or delete/);assert.match(sql,/before truncate/);
  assert.doesNotMatch(sql,/insert into public.merchant_attendance_events|update public|delete from public|alter table public.merchant_attendance_events/);
  assert.equal((sql.match(/grant execute/gi)||[]).length,1);
  assert.match(sql,/grant execute on function public.faolla_attendance_correction_self_v1\(text,uuid,jsonb,jsonb,boolean\) to service_role/);
});
test("correction writes follow current identity locks and persist receipts before any retry can create new declarations",()=>{
  const rpc=sql.slice(sql.indexOf("create function public.faolla_attendance_correction_self_v1"));
  assert.ok(rpc.indexOf("public.merchants where")<rpc.indexOf("public.merchant_attendance_settings where"));
  assert.ok(rpc.indexOf("public.merchant_enterprise_employees where")<rpc.indexOf("public.merchant_enterprise_roles where"));
  assert.ok(rpc.indexOf("public.merchant_enterprise_roles where")<rpc.indexOf("employee_id=emp.id for update"));
  assert.ok(rpc.indexOf("if receipt.revision is not null then")<rpc.indexOf("if not v_can then"));
  assert.match(rpc,/receipt.command<>p_command/);assert.match(rpc,/attendance_correction_basis_changed/);
  assert.match(rpc,/head.action='submit'.*attendance_correction_pending/);
  const prepare=rpc.slice(rpc.indexOf("select * into head"));
  assert.ok(prepare.indexOf("head.actor_auth_user_id<>p_auth_user_id")<prepare.indexOf("v_basis:=public.faolla_attendance_correction_basis_v1"));
});
test("candidate has no approval path, bounded reads/bodies and stays behind both server flags",()=>{
  assert.match(sql,/limit 26/);assert.match(sql,/jsonb_array_length\(v->'events'\)>202/);assert.match(sql,/jsonb_array_length\(p_value->'breaks'\)>32/);
  assert.match(sql,/not in \('submit','withdraw'\)/);assert.doesNotMatch(sql,/action='approve'|timesheets|set enabled=true/);
  const route=read("../src/app/api/merchant-enterprise/attendance/corrections/route-handler.ts");
  assert.match(route,/FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_SELF_ENABLED==="1"/);
  assert.match(route,/requireMerchantEnterprisePasswordAuthentication\(context\)/);assert.match(route,/isTrustedSameOriginMutationRequest/);
  const service=read("../src/lib/merchantAttendanceCorrection.server.ts");assert.match(service,/bytes>8192/);assert.match(service,/timeoutMs=12000/);
});
