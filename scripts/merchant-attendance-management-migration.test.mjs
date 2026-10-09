import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=n=>readFileSync(new URL(`./supabase-migrations/${n}`,import.meta.url),"utf8").replace(/\r\n/g,"\n");
const sql=read("202609290066_merchant_attendance_scopes_records.sql");
test("record permission only adds one catalog entry without changing old dependencies or roles",()=>{
  const pattern=/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\n\$\$;/;
  const old=read("202609290062_merchant_attendance_permissions.sql").match(pattern)?.[0];
  const added=read("202609290065_merchant_attendance_record_permission.sql").match(pattern)?.[0];
  assert.ok(old);assert.ok(added);assert.equal(added.replace(/\n      \('attendance\.records\.view',[^\n]+/,""),old);
});
test("all scope tables are closed and tenant FKs protect grant membership",()=>{
  for(const suffix of ["scopes","scope_grants","scope_workers","scope_locations","scope_operations"])
    assert.ok(sql.includes(`alter table public.merchant_attendance_${suffix} enable row level security;`));
  assert.match(sql,/foreign key\(merchant_id,worker_id\) references public\.merchant_attendance_workers\(merchant_id,id\)/);
  assert.match(sql,/foreign key\(merchant_id,location_id\) references public\.merchant_attendance_locations\(merchant_id,id\)/);
  assert.doesNotMatch(sql,/update public\.merchant_enterprise_(employees|roles)|insert into public\.merchant_enterprise_(employees|roles)|update public\.merchant_attendance_events/i);
});
test("scope audit append-only and all new functions explicitly remove public execution",()=>{
  assert.equal((sql.match(/create function public\./g)||[]).length,4);
  assert.equal((sql.match(/revoke all on function public\./g)||[]).length,4);
  assert.equal((sql.match(/grant execute on function public\./g)||[]).length,2);
  assert.match(sql,/scope_audit_no_rewrite before update or delete/);assert.match(sql,/scope_audit_no_truncate before truncate/);
});
test("read locks current role and scope before event query; filtering precedes page limit",()=>{
  const records=sql.slice(sql.indexOf("create function public.faolla_attendance_records_v1"));
  assert.ok(records.indexOf("select * into v_role")<records.indexOf("select * into v_scope"));
  assert.ok(records.indexOf("select * into v_scope")<records.indexOf("v_now:=clock_timestamp()"));
  assert.ok(records.indexOf("sw.worker_id=e.worker_id and sl.location_id=e.location_id")<records.indexOf("limit 51"));
  assert.match(records,/HH24:MI:SS\.US/);assert.match(records,/interval '31 days'/);
  assert.doesNotMatch(records,/default_location_id|offset |count\(\*\).*merchant_attendance_events/);
});
test("owner candidates are read-only, tenant-scoped, bounded and include historical workers",()=>{
  const choices=read("202609290067_merchant_attendance_scope_choices.sql");
  assert.match(choices,/security definer set search_path=pg_catalog/);
  assert.match(choices,/select \* into v_merchant[\s\S]*?for share/);
  assert.match(choices,/attendance_access_denied/);
  assert.equal((choices.match(/limit 26/g)||[]).length,3);
  assert.equal((choices.match(/case when count\(\*\)>25/g)||[]).length,3);
  assert.doesNotMatch(choices,/insert into public\.merchant_|update public\.|delete from|not exists.*employee_id/i);
  assert.match(choices,/revoke all on function public\.faolla_attendance_choices_v1/);
});
test("exact candidate lookups validate bounded distinct IDs and filter within each merchant before paging",()=>{
  const choices=read("202609290067_merchant_attendance_scope_choices.sql");
  assert.match(choices,/jsonb_array_length\(p_query->'ids'\) not between 1 and 25/);
  assert.match(choices,/cardinality\(v_ids\)<>\(select count\(distinct x\)/);
  assert.match(choices,/jsonb_object_keys\(p_query\)\)<>2/);
  for(const alias of ["e","w","l"])
    assert.ok(choices.includes(`${alias}.merchant_id=p_site_id and (v_cursor is null or ${alias}.id>v_cursor)\n        and (v_ids is null or ${alias}.id=any(v_ids))`));
});
