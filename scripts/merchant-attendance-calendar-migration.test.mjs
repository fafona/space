// Source contracts only, never a claim that PostgreSQL was run by these tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610030123_merchant_attendance_calendar.sql',sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,''),body=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_calendar_v1'),clean.indexOf('revoke all on function public.faolla_attendance_calendar_v1'));
const ordered=(...parts)=>{let at=-1;for(const s of parts){const n=body.indexOf(s,at+1);assert(n>at,`missing/out-of-order ${s}`);at=n;}};
test('123 adds only two immutable calendar tables and functions, with guarded061 prerequisites and unchanged checker acceptance',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);assert.match(clean,/begin;\nset local lock_timeout='3s';/);
  assert(clean.includes("version=202609290061 and name='merchant_attendance_foundation'"));assert(clean.includes('merchant_attendance_calendar_installation_conflict'));
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations']);
  assert.doesNotMatch(clean,/\b(drop|delete from|disable trigger|owner to|create policy)\b/i);
  assert.doesNotMatch(body,/merchant_attendance_(?:events\b|schedule_|leave_|missing_|correction_|effect_)|merchant_enterprise_|worker_id|employee_id/);
  for(const m of clean.matchAll(/insert into public\.(\w+)/g))assert(['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations','faolla_schema_migrations'].includes(m[1]));
  assert.doesNotMatch(body,/\bupdate public\./);
});
test('atomic creation receipt and unique terminal revision preserve scope/name/timezone/version snapshots and immutable history',()=>{
  for(const s of ['location_id uuid null,location_name text null,location_version bigint null','location_version is not null','settings_version bigint not null','foreign key(merchant_id,location_id)',
    'unique(merchant_id,entry_id,revision)',"revision=1 and action='create' and operation_id=entry_id","revision=2 and action='cancel'",'deferrable initially deferred',
    'command jsonb not null,snapshot jsonb not null','before update or delete on public.%I','before truncate on public.%I'])assert(clean.includes(s));
  assert(clean.includes('attendance_calendar_scope_list_idx'));assert(clean.includes('attendance_calendar_scope_dates_idx'));
  assert(body.includes('target.location_name:=l.name;target.location_version:=l.version'));
});
test('query is exact8 with paired dates/cursor and separate context/list/detail/receipt/POST modes',()=>{
  assert(body.includes("array['siteId','locationId','fromDate','throughDate','entryId','operationId','beforeAt','beforeId']"));assert(body.includes('jsonb_object_keys(p_query))<>8'));
  assert(body.includes("(p_query->'fromDate'='null'::jsonb)<>(p_query->'throughDate'='null'::jsonb)"));assert(body.includes('(cursor_at is null)<>(cursor_id is null)'));
  assert(body.includes('cursor_at is not null and (from_day is null or target_id is not null or op is not null)'));
  assert(body.includes('from_day is not null and (target_id is not null or op is not null or p_command is not null)'));
  assert(body.includes('if p_command is null and from_day is not null then'));
  assert(body.includes('p.from_date<=through_day and p.through_date>=from_day'));
  assert(body.includes('p.location_id is not distinct from place'));assert(body.includes('order by p.created_at desc,p.entry_id desc limit 26 loop'));
  assert(body.includes('rows_seen:=rows_seen+1;exit when rows_seen=26'));assert(body.includes('rows_seen=26 then next_cursor else null'));
});
test('create exact11 and cancel exact5 enforce canonical date labels, endpoint IANA existence, safe versions and strict Unicode text',()=>{
  assert(body.includes('jsonb_object_keys(p_command))<>11'));assert(body.includes('jsonb_object_keys(p_command))<>5'));
  assert(body.includes("array['kind','title','fromDate','throughDate','expectedSettingsVersion','locationId','expectedLocationVersion','timeZone']"));
  assert(body.includes("p_command->'locationId' is distinct from p_query->'locationId'"));assert(body.includes("p_command->'expectedRevision' is distinct from '1'::jsonb"));
  assert(body.includes("if k='expectedLocationVersion' and place is null then"));assert(body.includes('::numeric>9007199254740990'));
  assert(body.includes('b-a not between 0 and 365'));assert(body.includes('through_day-from_day not between 0 and 365'));
  assert(body.includes("((a::timestamp at time zone (p_command->>'timeZone')) at time zone (p_command->>'timeZone'))::date<>a"));
  assert(body.includes("((b::timestamp at time zone (p_command->>'timeZone')) at time zone (p_command->>'timeZone'))::date<>b"));
  assert(body.includes('[[:cntrl:]\\u007f-\\u009f]'));assert(body.includes('\\feff'));assert(body.includes("char_length(p_command->>'title') not between 1 and 80"));
  assert.doesNotMatch(body,/generate_series|366\s*\*\s*86400|recurr/i);
});
test('current owner/settings/location locks precede actor command replay, with pause/CAS/activity only on genuine new writes',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share','if p_command is null then select * into s',
    'else select * into s','select * into l','select * into receipt_row','receipt_row.actor_auth_user_id<>p_auth_user_id',
    'receipt_row.command is distinct from p_command','target.location_id is distinct from place','if not p_allow_write',"if action_name='create' then","if not can_create");
  assert(body.includes("if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt_row:=null;"));
  assert(body.includes("if item->>'status'<>'created' then raise exception 'attendance_calendar_closed'"));
  assert(body.includes("(p_command->>'expectedLocationVersion')::bigint is distinct from l.version"));
  assert.doesNotMatch(body,/s\.enabled|web_clock_enabled|set version|set time_zone|set active/);
});
test('private summary validates the full immutable chain and exact original snapshot rather than substituting latest cancellation',()=>{
  const helper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_calendar_summary_v1'),clean.indexOf('revoke all on function public.faolla_attendance_calendar_summary_v1'));
  for(const s of ['n>2 or op.revision<>n','op.actor_auth_user_id<>p.actor_auth_user_id','op.recorded_at<>p.created_at','op.snapshot is distinct from item',
    'p_revision=n',"raise exception 'attendance_calendar_invalid'",'op.command->\'expectedLocationVersion\' is distinct from coalesce(to_jsonb(p.location_version)'])assert(helper.includes(s));
  assert(body.includes("'command',receipt_row.command,'item',public.faolla_attendance_calendar_summary_v1(target,receipt_row.revision)"));
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['protocol','siteId','actorId','settingsVersion','locationId','locationName','locationVersion','timeZone','canCreate','items','nextCursor','detail','receipt']);
  assert(body.includes('octet_length(result::text)>131072'));
});
test('only public RPC gets service execute; both tables/helper stay private with RLS and effective inherited ACL checks',()=>{
  assert.equal((clean.match(/enable row level security/g)||[]).length,2);assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes('revoke all on public.merchant_attendance_calendar_entries,public.merchant_attendance_calendar_operations from public,anon,authenticated,service_role'));
  assert(clean.includes('grant execute on function public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean) to service_role'));
  assert(clean.includes('revoke all on function public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer) from public,anon,authenticated,service_role'));
  assert(clean.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));assert(clean.includes("pg_has_role(r,c.relowner,'USAGE')"));
  assert(clean.includes("case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end"));
  assert(clean.includes("values(202610030123,'merchant_attendance_calendar') on conflict(version) do nothing"));assert(clean.includes("notify pgrst, 'reload schema'"));
});
