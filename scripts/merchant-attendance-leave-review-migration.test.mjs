// Pure source contracts only; PostgreSQL execution is owned by the native runner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610040126_merchant_attendance_leave_review.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,''),body=clean.slice(clean.indexOf('create or replace function'),clean.indexOf('revoke all on function'));
const ordered=(...parts)=>{let at=-1;for(const part of parts){const next=body.indexOf(part,at+1);assert(next>at,`missing/out-of-order ${part}`);at=next;}};
test('126 passes unchanged migration policy and installs only the new function and registration with122 prerequisites',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);assert(clean.includes("set local lock_timeout='3s'"));
  for(const text of ['public.merchant_attendance_leave_requests','public.merchant_attendance_leave_entries','public.attendance_leave_owner_list_idx',
    'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',"version=202610030122 and name='merchant_attendance_leave_requests'",
    "installed<>(to_regprocedure('public.faolla_attendance_leave_review_v1(jsonb,uuid)') is not null)"])assert(clean.includes(text));
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_leave_review_v1']);
  assert.doesNotMatch(clean,/\b(?:create table|create index|create trigger|alter table|update public\.|delete from|drop |owner to|disable trigger)\b/i);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
});
test('query accepts only exact3 canonical paired microsecond/UUID cursor fields and authenticated subject',()=>{
  for(const text of ['p_auth_user_id is null','jsonb_object_keys(p_query))<>3',"array['siteId','afterAt','afterId']",'(cursor_at is null)<>(cursor_id is null)',
    "jsonb_typeof(p_query->'afterAt')<>'string'","jsonb_typeof(p_query->'afterId')<>'string'",'not isfinite(cursor_at)','HH24:MI:SS.US'])assert(body.includes(text));
  assert(body.includes('[0-9]{6}Z$'));assert(body.includes('[1-8][0-9a-f]{3}-[89ab]'));
  assert(body.includes('exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value'));
});
test('every page rechecks current owner and locks merchant before settings without worker/member/feature write gates',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    "raise exception 'attendance_access_denied'",'perform 1 from public.merchant_attendance_settings where merchant_id=site for share',
    "raise exception 'attendance_settings_required'",'for candidate in select');
  assert.doesNotMatch(body,/merchant_enterprise_|merchant_attendance_workers|\.active|\.enabled|self\.view|self\.leave|for update|p_allow_write|p_command/);
});
test('oldest51 candidate probe processes only50 then checks complete original summary before submitted filtering',()=>{
  ordered('where p.merchant_id=site and (cursor_at is null or (p.submitted_at,p.request_id)>(cursor_at,cursor_id))',
    'order by p.submitted_at asc,p.request_id asc limit 51','rows_seen:=rows_seen+1','exit when rows_seen=51',
    'item:=public.faolla_attendance_leave_summary_v1(candidate)',"if item->>'status'='submitted'",'next_cursor:=jsonb_build_object');
  assert.equal((body.match(/public\.faolla_attendance_leave_summary_v1\(/g)||[]).length,1);
  assert(body.includes("item->'revision' is distinct from '1'::jsonb"));assert(body.includes('least(rows_seen,50)'));
  assert(body.includes('case when rows_seen=51 then next_cursor else null end'));assert.doesNotMatch(body,/offset|clock_timestamp|statement_timestamp|submitted_at\s*[<]=?\s*now|count\(\*\).*requests/i);
});
test('bounded result exact6 and historical summary exact8 contain neither reasons nor counts/snapshot promises',()=>{
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['protocol','siteId','ownerId','items','scanned','nextCursor']);
  assert(body.includes("array['requestId','workerName','startAt','endAt','timeZone','submittedAt','revision','status']"));
  assert(body.includes('octet_length(result::text)>131072'));assert.doesNotMatch(body,/'reason'|'history'|'total'|'asOf'|exception when others/);
});
test('only new RPC is granted to service; PUBLIC/browser execute closed and reapply owner is retained',()=>{
  assert.deepEqual([...clean.matchAll(/(?:grant|revoke)[^;]*function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_leave_review_v1','faolla_attendance_leave_review_v1']);
  assert(clean.includes('from public,anon,authenticated,service_role'));assert(clean.includes('to service_role'));
  assert(clean.includes("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))"));assert(clean.includes('a.grantee=0'));
  assert(clean.includes("proconfig=array['search_path=pg_catalog']"));assert(clean.includes("values(202610040126,'merchant_attendance_leave_review') on conflict(version) do nothing"));
  assert(clean.includes("notify pgrst, 'reload schema'"));assert.doesNotMatch(clean,/grant\s+(?:select|all)\s+on\s+(?:table|public\.merchant_)/i);
});
