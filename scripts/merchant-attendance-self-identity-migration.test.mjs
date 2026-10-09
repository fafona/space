import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const original=read("./supabase-migrations/202609290063_merchant_attendance_self_clock.sql");
const sql=read("./supabase-migrations/202610020111_merchant_attendance_self_clock_identity.sql");
const withoutComments=text=>text.replace(/--[^\n]*/g,"");
const code=withoutComments(sql);
const functionText=text=>{
  const start=text.indexOf("create or replace function public.faolla_attendance_self_v1(");
  assert(start>=0,"established self-clock RPC must exist");
  const end=text.indexOf("\n$$;",start);assert(end>=0,"self-clock RPC terminator must exist");
  return text.slice(start,end+4);
};
const body=withoutComments(functionText(sql));
const latestGuard="if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id then\n    raise exception 'attendance_access_denied';\n  end if;";
const receiptGuard="if v_receipt.id is not null and v_receipt.actor_employee_id is distinct from v_employee.id then\n    raise exception 'attendance_access_denied';\n  end if;";
const normalize=text=>withoutComments(text).replace(/\s+/g," ").trim();
const ordered=(text,...parts)=>{
  let previous=-1;
  for(const part of parts){const at=text.indexOf(part,previous+1);assert(at>previous,`missing/out-of-order SQL: ${part}`);previous=at;}
};

test("111 replaces only the established self RPC and migration ledger, without data repair or broader grants",()=>{
  assert.equal((code.match(/create or replace function/g)||[]).length,1);
  assert.match(body,/p_site_id text, p_auth_user_id uuid, p_command jsonb default null, p_operation_id uuid default null/);
  assert.match(body,/returns jsonb language plpgsql security definer set search_path = pg_catalog/);
  assert.doesNotMatch(code,/\b(?:create table|create index|alter table|drop|truncate|delete from|update public\.|grant select)\b/i);
  // The established function still inserts a fact only for an explicit command.
  // Outside the function, the migration itself only appends its ledger entry.
  const outside=code.replace(body,"");
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),["public.faolla_schema_migrations"]);
  const signature="public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)";
  assert(code.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(code.includes(`grant execute on function ${signature} to service_role;`));
  assert.match(code,/values \(202610020111,'merchant_attendance_self_clock_identity'\) on conflict\(version\) do nothing/);
  assert.match(code,/^\s*begin;/);assert.match(code,/set local lock_timeout = '3s'/);assert.match(code,/commit;\s*$/);
});

test("the whole original RPC remains identical after removing only the two approved identity guards",()=>{
  assert.equal(body.split(latestGuard).length,2);assert.equal(body.split(receiptGuard).length,2);
  assert.equal(normalize(body.replace(latestGuard,"").replace(receiptGuard,"")),normalize(functionText(original)));
});

test("latest-event identity is checked unconditionally before status derivation and any receipt or new write",()=>{
  const start=body.indexOf("select * into v_last from public.merchant_attendance_events");
  const status=body.indexOf("v_sequence := coalesce(v_last.sequence,0)",start);
  assert.equal(normalize(body.slice(start,status)),normalize(`select * into v_last from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id order by sequence desc limit 1;
    ${latestGuard}`));
  ordered(body,"if p_command is not null and v_worker.id <>","select * into v_last",latestGuard,
    "v_sequence := coalesce(v_last.sequence,0)","v_status := case", "select * into v_receipt", "insert into public.merchant_attendance_events(");
  assert.doesNotMatch(body.slice(start,status),/v_last\.(?:id|action)\s*:=|actor_employee_id\s*=|action\s*=\s*'clock_out'/);
});

test("older receipt identity has a separate guard before GET return or replay even when latest belongs to self",()=>{
  const start=body.indexOf("select * into v_receipt from public.merchant_attendance_events");
  const branch=body.indexOf("if p_command is not null then",start);
  assert.equal(normalize(body.slice(start,branch)),normalize(`select * into v_receipt from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id
      and operation_id=coalesce(v_operation,p_operation_id);
    ${receiptGuard}`));
  ordered(body,"select * into v_receipt",receiptGuard,"if p_command is not null then","if v_receipt.id is not null then",
    "if v_receipt.action<>v_action or v_receipt.location_id<>v_location_id", "v_replayed := true;", "return jsonb_build_object(");
  assert.doesNotMatch(body,/v_receipt\s*:=\s*null|v_last\s*:=\s*null|coalesce\([^)]*actor_employee_id/);
});

test("existing principal resolution, read/write permissions, worker locks and expected-worker fence remain in order",()=>{
  ordered(body,"into v_settings","into v_employee","into v_role","into v_worker",
    "raise exception 'attendance_worker_changed'","select * into v_last");
  assert.match(body,/where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share/);
  assert.match(body,/where merchant_id=p_site_id and employee_id=v_employee.id for update/);
  assert.match(body,/where merchant_id=p_site_id and employee_id=v_employee.id for share/);
  assert.match(body,/not \('attendance.self.view'=any\(v_role.permissions\)\)/);
  assert.match(body,/p_command is not null and not \('attendance.self.clock'=any\(v_role.permissions\)\)/);
  assert.match(body,/not found or not v_settings.enabled/);assert.match(body,/not found or not v_worker.active/);
});

test("null identity is rejected without source discrimination, filtering or fabricated off state",()=>{
  assert.equal((body.match(/actor_employee_id is distinct from v_employee.id/g)||[]).length,2);
  assert.doesNotMatch(body,/where[^;]*actor_employee_id|and\s+(?:v_last\.|v_receipt\.)?actor_employee_id\s*=|(?:v_last|v_receipt)\.source/);
  assert.match(body,/v_status := case when v_last.id is null or v_last.action='clock_out' then 'off'/);
  assert.match(body,/v_sequence := coalesce\(v_last.sequence,0\)/);
  assert.match(body,/v_now,v_now,v_location.time_zone,v_employee.id/);
  assert.match(body,/'lastEvent',public.faolla_attendance_event_receipt_v1\(v_last\)/);
  assert.match(body,/'receipt',public.faolla_attendance_event_receipt_v1\(v_receipt\),'replayed',v_replayed/);
  const errors=read("../src/lib/merchantAttendanceSelf.ts");
  assert.match(errors,/attendance_access_denied:\s*403/);
});

test("same-identity replay still precedes fresh-write policy and sequence checks without adding mutations",()=>{
  ordered(body,receiptGuard,"v_replayed := true;","if not v_settings.web_clock_enabled",
    "if v_sequence<>v_expected", "if v_location_id is distinct from v_worker.default_location_id",
    "v_now := date_trunc('milliseconds',clock_timestamp())", "attendance_not_employed", "insert into public.merchant_attendance_events(");
  assert.equal((body.match(/insert into public\.merchant_attendance_events\(/g)||[]).length,1);
  for(const error of ["attendance_time_reversed","attendance_already_clocked_in","attendance_not_working","attendance_not_on_break","attendance_break_must_end","attendance_not_clocked_in"])
    assert(body.includes(`raise exception '${error}'`));
  assert.doesNotMatch(body,/merchant_attendance_pin_|merchant_attendance_onsite_|faolla_attendance_location_clock/);
});
