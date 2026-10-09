// Source contracts only; PostgreSQL acceptance is independently run by root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610030124_merchant_attendance_groups.sql',sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,''),body=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_groups_v1'),clean.indexOf('do $groups_acl$'));
const ordered=(...parts)=>{let at=-1;for(const part of parts){const next=body.indexOf(part,at+1);assert(next>at,`missing/out-of-order ${part}`);at=next;}};
const tables=['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'];

test('124 passes the unchanged migration checker and only adds its four-table independent owner group model',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);assert.match(clean,/begin;\nset local lock_timeout='3s';/);
  assert(clean.includes("version=202609290061 and name='merchant_attendance_foundation'"));assert(clean.includes('merchant_attendance_groups_installation_conflict'));
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),tables);
  assert.doesNotMatch(clean,/\b(drop|delete from|disable trigger|owner to|create policy)\b/i);
  for(const m of clean.matchAll(/(?:insert into|update) public\.(\w+)/g))assert([...tables,'faolla_schema_migrations'].includes(m[1]));
  assert.doesNotMatch(body,/merchant_attendance_(?:events\b|schedule_|leave_|calendar_|missing_|correction_|effect_)|merchant_enterprise_/);
  assert.doesNotMatch(body,/s\.enabled|web_clock_enabled|set version|set time_zone|set active/);
});
test('current projections and immutable receipts retain original identities and assignment dates with deferred creation-receipt FKs',()=>{
  for(const text of ['group_name text not null','worker_name text not null,worker_no text not null,employee_id uuid null','original_ends_on date null,ends_on date null',
    'group_revision bigint not null,worker_version bigint not null,settings_version bigint not null',"status='assigned' and revision=1", "status='ended' and revision=2",
    "status='cancelled' and revision in(2,3)",'unique(merchant_id,group_id,revision)','unique(merchant_id,assignment_id,revision)',
    'deferrable initially deferred',"array['merchant_attendance_group_operations','merchant_attendance_group_assignment_operations']",'before update or delete on public.%I','before truncate on public.%I'])assert(clean.includes(text));
  assert.equal((clean.match(/create index if not exists/g)||[]).length,3);
  assert(clean.includes("where status<>'cancelled'"));
});
test('query is exact8 and separates group/member pages from selected context and command scope',()=>{
  assert(body.includes("array['siteId','view','groupId','workerId','onDate','assignmentId','operationId','cursorId']"));assert(body.includes('jsonb_object_keys(p_query))<>8'));
  assert(body.includes("view_name='members' and (gid is null and wid is null or aid is not null or op is not null)"));
  assert(body.includes("view_name='context' and (on_day is not null or cursor_id is not null or aid is not null and (gid is null or wid is null))"));
  assert(body.includes("if view_name<>'context' or op is not null"));assert(body.includes("p_command->'expectedRevision'='0'::jsonb and gid is not null"));
  assert(body.includes('order by group_id desc limit 26'));assert(body.includes('order by x.assignment_id desc limit 26'));assert(body.includes('rows_seen=26 then next_cursor else null'));
  const list=body.slice(body.indexOf("elsif view_name='members' then"));assert(list.includes('x.starts_on<=on_day and (x.ends_on is null or x.ends_on>=on_day)'));
  assert(!list.includes("status<>'cancelled'"),'cancelled date-label records remain explicitly visible');
});
test('commands have exact8/11/6/5 fields, safe revisions, strict Unicode text and real finite IANA endpoints without paid-time conversion',()=>{
  const command=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_group_command_v1'),clean.indexOf('create table if not exists'));
  for(const text of ['n<>8','n<>11',"n<>(case when a='end' then 6 else 5 end)",'::numeric>9007199254740989','::numeric>9007199254740990',
    "array['groupId','workerId','expectedGroupRevision','expectedWorkerVersion','expectedSettingsVersion','timeZone','startsOn','endsOn']", "p->'expectedRevision' not in('1'::jsonb,'2'::jsonb)"] )assert(command.includes(text));
  assert(clean.includes('[[:cntrl:]\\u007f-\\u009f]'));assert(clean.includes('\\feff'));assert(clean.includes("((d::timestamp at time zone z) at time zone z)::date=d"));
  assert(clean.includes("date '2000-01-01' and date '2100-12-31'"));assert.doesNotMatch(body,/generate_series|86400|employment|start_at|end_at/);
});
test('PL/pgSQL conditional CASE expressions are parenthesized before the outer IF continues',()=>{
  assert(clean.includes("if n<>(case when a='end' then 6 else 5 end) or not(p ?& array['assignmentId','expectedRevision'])"));
  assert.doesNotMatch(clean,/\b(?:if|elsif)\b[^;\n]*?(?:<>|<=|>=|=|<|>)\s*case\b/i);
});
test('current owner and settings lock precede cross-ledger operation checks, exact actor replay and pause/CAS',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share','if p_command is null then select * into s','else select * into s',
    'select * into go','select * into ao','go.operation_id is not null and ao.operation_id is not null',
    'go.actor_auth_user_id<>p_auth_user_id','go.command is distinct from p_command','select * into g','select * into w',
    'if p_command is not null and receipt is null then','if not p_allow_write');
  assert(body.includes("if p_command is not null then raise exception 'attendance_operation_conflict';end if;go:=null"));
  assert(body.includes("if p_command is not null then raise exception 'attendance_operation_conflict';end if;ao:=null"));
  assert(body.includes('gid is null and go.revision<>1'));assert(body.includes('target.group_id is distinct from gid or target.worker_id is distinct from wid'));
});
test('inclusive cross-group overlap is checked after serialization and end/cancel only mutate the new projection',()=>{
  ordered('else select * into s',"if action_name='assign' then\n        if not g.active",'if not w.active',"(p_command->>'expectedGroupRevision')::bigint<>g.revision",
    'if exists(select 1 from public.merchant_attendance_group_assignments x',"raise exception 'attendance_group_overlap'",'insert into public.merchant_attendance_group_assignments');
  const overlap=body.slice(body.indexOf('if exists(select 1 from public.merchant_attendance_group_assignments x'),body.indexOf('insert into public.merchant_attendance_group_assignments'));
  assert(overlap.includes('x.worker_id=wid'));assert(!overlap.includes('x.group_id=gid'));assert(overlap.includes("x.status<>'cancelled'"));
  assert(overlap.includes("x.ends_on>=(p_command->>'startsOn')::date"));assert(overlap.includes("x.starts_on<=(p_command->>'endsOn')::date"));
  assert(body.includes("action_name='end' and (target.status<>'assigned' or target.ends_on is not null)"));
  assert(body.includes("ends_on=case when action_name='end' then (p_command->>'endsOn')::date else ends_on end"));
  assert(body.includes("public.faolla_attendance_group_date_v1(p_command->>'endsOn',target.time_zone)"));
});
test('private bounded assignment history validates every command/snapshot, frozen identity and date transition with complete result shape',()=>{
  const helper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_group_assignment_detail_v1'),clean.indexOf('create or replace function public.faolla_attendance_groups_v1'));
  for(const text of ['order by revision limit 4','n>3 or o.revision<>n','o.actor_auth_user_id<>p.actor_auth_user_id','o.recorded_at<previous_at',
    "o.command->>'workerId'<>p.worker_id::text",'to_jsonb(p.settings_version)','o.snapshot is distinct from item','item is distinct from public.faolla_attendance_group_assignment_item_v1(p)',
    "v.ends_on:=p.original_ends_on","'canEnd',p.status='assigned' and p.ends_on is null","'canCancel',p.status<>'cancelled'"])assert(helper.includes(text));
  assert.doesNotMatch(helper,/language plpgsql stable/,'helper must observe current transaction writes');
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['protocol','siteId','actorId','settingsVersion','timeZone','view','group','worker','items','nextCursor','detail','receipt']);
  assert(body.includes('octet_length(result::text)>131072'));
});
test('four tables and every helper stay private, sole public service RPC is checked with effective inherited ACLs and idempotent registry',()=>{
  assert.equal((clean.match(/enable row level security/g)||[]).length,4);assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes('grant execute on function public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean) to service_role'));
  assert(clean.includes("execute format('revoke all on function %s from public,anon,authenticated,service_role',p)"));
  assert(clean.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));assert(clean.includes("pg_has_role(r,c.relowner,'USAGE')"));
  assert(clean.includes("case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end"));
  assert(clean.includes("values(202610030124,'merchant_attendance_groups') on conflict(version) do nothing"));assert(clean.includes("notify pgrst, 'reload schema'"));
});
