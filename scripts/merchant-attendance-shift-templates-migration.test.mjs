// Static source contracts only; PostgreSQL execution belongs to the owned runner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const sql=readFileSync(new URL('./supabase-migrations/202610030119_merchant_attendance_shift_templates.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=s=>s.replace(/--[^\n]*/g,'');
const fn=sql.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];assert(fn);
const body=strip(fn),outside=strip(sql.replace(fn,''));
const signature='public.faolla_attendance_shift_templates_v1(jsonb,uuid,jsonb,boolean)';
const ordered=(s,...parts)=>{let at=-1;for(const part of parts){const n=s.indexOf(part,at+1);assert(n>at,`missing or out of order: ${part}`);at=n;}};

test('119 adds only a current daily-template table and immutable operation table, without touching prior schemas or facts',()=>{
  assert.match(sql,/begin;\nset local lock_timeout='3s';/);
  assert.deepEqual([...outside.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_shift_templates','merchant_attendance_shift_template_operations']);
  assert.equal((strip(sql).match(/create or replace function/g)||[]).length,1);
  for(const table of [...strip(sql).matchAll(/(?:insert into|update) public\.(\w+)/g)].map(m=>m[1]))
    assert(['merchant_attendance_shift_templates','merchant_attendance_shift_template_operations','faolla_schema_migrations'].includes(table));
  assert.doesNotMatch(strip(sql),/\b(delete from|drop|owner to|create policy|disable trigger)\b/);
  assert.doesNotMatch(body,/worker_id|employee_id|weekdays|time_zone|work_date|schedule_slots|attendance_events\b/);
  assert(outside.includes("version=202609290061 and name='merchant_attendance_foundation'"));
  assert(outside.includes("to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null"));
  assert.match(outside,/merchant_attendance_shift_templates_installation_conflict/);
});

test('query and command have exact4/5 keys, independent UUID checks and mutually exclusive cursor/receipt query',()=>{
  assert.match(body,/jsonb_object_keys\(p_query\)\)<>4/);assert(body.includes("array['siteId','view','cursorId','operationId']"));
  assert(body.includes("coalesce(p_query->>'view','') not in ('active','archived')"));
  assert(body.includes("if cursor_id is not null and op is not null then raise exception 'attendance_invalid_request'"));
  assert(body.includes("if cursor_id is not null or op is not null or jsonb_typeof(p_command)<>'object'"));
  assert.match(body,/jsonb_object_keys\(p_command\)\)<>5/);assert(body.includes("array['operationId','templateId','expectedRevision','action','template']"));
  assert(body.includes("foreach k in array array['operationId','templateId']"));assert(body.includes('expected=0 and target_id<>op'));
  assert(body.includes("expected<1 or p_command->'template'<>'null'::jsonb"));assert(body.includes("::numeric>9007199254740989"));
});

test('daily pattern validation exactly matches name/segments, strict HH:mm+boolean and sorted half-open bounded durations',()=>{
  assert.match(body,/jsonb_object_keys\(value\)\)<>2/);assert(body.includes("array['name','segments']"));
  assert(body.includes("jsonb_array_length(value->'segments') not between 1 and 4"));
  assert(body.includes('char_length(name_value) not between 1 and 80'));
  assert(body.includes("[[:cntrl:]\\u007f-\\u009f]"));assert(body.includes("btrim(name_value,U&'\\0009"));assert(body.includes('\\feff'));
  assert.match(body,/jsonb_object_keys\(segment\)\)<>3/);assert(body.includes("array['start','end','nextDay']"));
  assert(body.includes("jsonb_typeof(segment->'nextDay')<>'boolean'"));
  assert.equal((body.match(/\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$/g)||[]).length,2);
  assert(body.includes('then 1440 else 0 end'));assert(body.includes('end_min<=start_min or end_min>start_min+1440 or start_min<=prior_start or start_min<prior_end'));
  assert.doesNotMatch(body,/generate_series|10080|weekday|recursive/);
});

test('current owner/settings locks always precede actor receipt matching and exact replay precedes pause, CAS and capacity',()=>{
  ordered(body,'perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;',
    'if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=site for share;',
    'else perform 1 from public.merchant_attendance_settings where merchant_id=site for update;',
    'select * into receipt_row','receipt_row.actor_auth_user_id is distinct from p_auth_user_id',
    'receipt_row.command is distinct from p_command','if not p_allow_write',
    'select * into current_row','if current_row.template_id is not null','not archived)>=100');
  assert(body.includes("if p_command is not null then raise exception 'attendance_operation_conflict';end if;\n      receipt_row:=null;"));
  assert(body.includes("if current_row.archived then raise exception 'attendance_template_archived'"));
  assert(body.includes("if current_row.revision<>expected then raise exception 'attendance_version_conflict'"));
  assert(body.includes("if current_row.template_id is null then raise exception 'attendance_not_available'"));
  assert.doesNotMatch(body,/settings\.enabled|web_clock_enabled|actor.*email|merchant_enterprise_roles/);
});

test('every accepted command atomically changes only current template and appends its exact historical command/item receipt',()=>{
  assert.equal((body.match(/insert into public\.merchant_attendance_shift_template_operations/g)||[]).length,1);
  assert(body.includes('values(site,op,target_id,p_auth_user_id,p_command,item,now_at)'));
  assert(body.includes("'command',receipt_row.command,'item',receipt_row.snapshot"));
  assert.equal((body.match(/update public\.merchant_attendance_shift_templates/g)||[]).length,2);
  assert(body.includes('set revision=expected+1,archived=true,updated_at=now_at'));
  assert.doesNotMatch(body,/delete|update public\.merchant_attendance_shift_template_operations|insert into public\.merchant_attendance_(events|schedule)/);
  ordered(body,'now_at:=clock_timestamp();','item:=jsonb_build_object(','insert into public.merchant_attendance_shift_template_operations');
});

test('live listing uses UUID DESC21 probe,20 items and a cursor at the last returned item, with exact safe projection',()=>{
  assert.match(body,/archived=\(view_name='archived'\)/);assert.match(body,/template_id<cursor_id\) order by template_id desc limit 21 loop/);
  ordered(body,'count_rows:=count_rows+1;exit when count_rows=21;','items:=items||jsonb_build_array(','next_cursor:=current_row.template_id;');
  const output=body.slice(body.indexOf("return jsonb_build_object('siteId'"));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['siteId','view','items','nextCursor','receipt']);
  assert(output.includes('case when count_rows=21 then next_cursor else null end'));
  const projection=body.slice(body.indexOf('item:=jsonb_build_object('),body.indexOf('insert into public.merchant_attendance_shift_template_operations'));
  assert.deepEqual([...projection.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]).filter(k=>k!=='UTC'),['templateId','revision','template','name','segments','archived','updatedAt']);
  assert(projection.includes('HH24:MI:SS.US'));assert.doesNotMatch(output+projection,/to_jsonb|row_to_json|actor|email|token/);
});

test('new tables are RLS private to every API role and original061 append-only trigger protects receipts',()=>{
  assert(outside.includes('revoke all on public.merchant_attendance_shift_templates,public.merchant_attendance_shift_template_operations from public,anon,authenticated,service_role;'));
  assert.equal((outside.match(/enable row level security/g)||[]).length,2);
  assert.match(outside,/before update or delete on public\.merchant_attendance_shift_template_operations/);
  assert.match(outside,/before truncate on public\.merchant_attendance_shift_template_operations/);
  assert.equal((outside.match(/execute function public\.faolla_attendance_events_append_only_v1\(\)/g)||[]).length,2);
  assert(outside.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));
  assert(outside.includes("pg_has_role(r,c.relowner,'USAGE')"));
  assert(outside.includes("case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end"));
  assert.doesNotMatch(outside,/a\.privilege_type\s*(?:=|in\b)|has_table_privilege/i);
  assert.doesNotMatch(outside,/grant (select|insert|update|delete|all)|alter function|owner to/i);
});

test('actual unchanged migration checker accepts119 without privilege-name masking or weakening receipt protection',()=>{
  assert.deepEqual(validateMigrationSource('202610030119_merchant_attendance_shift_templates.sql',sql),[]);
  const postconditions=outside.slice(outside.indexOf('do $shift_templates_postconditions$'));
  assert.doesNotMatch(postconditions,/\btruncate\b/i);
  assert(postconditions.includes("foreach r in array array['anon','authenticated','service_role']"));
  // The catalog check considers all ACL entries, never a hard-coded privilege
  // subset; PUBLIC's zero OID is handled without asking pg_has_role to resolve it.
  assert.match(postconditions,/where c\.oid=t and \([\s\S]*pg_has_role\(r,c\.relowner,'USAGE'\)[\s\S]*or exists\(select 1 from aclexplode/);
  assert.match(outside,/before truncate on public\.merchant_attendance_shift_template_operations/);
});

test('idempotent registry, preserved function owner and service-only execute are postcondition checked',()=>{
  assert.match(body,/security definer set search_path=pg_catalog/);assert(outside.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(outside.includes(`grant execute on function ${signature} to service_role;`));assert.equal((outside.match(/grant execute/g)||[]).length,1);
  assert(outside.includes("values(202610030119,'merchant_attendance_shift_templates') on conflict(version) do nothing"));
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  ordered(outside,'on conflict(version) do nothing;','do $shift_templates_postconditions$',"notify pgrst, 'reload schema';",'commit;');
});
