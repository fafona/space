// Source contracts, not evidence that PostgreSQL ran in these pure tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610040125_merchant_attendance_leave_notifications.sql',sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,''),wrapper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_leave_notify_v1'),clean.indexOf('revoke all on function public.faolla_attendance_leave_notify_v1'));
const reader=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_leave_notifications_v1'),clean.indexOf('revoke all on function public.faolla_attendance_leave_notifications_v1'));
const helper=clean.slice(clean.indexOf('create or replace function public.faolla_attendance_leave_notification_detail_v1'),clean.indexOf('revoke all on function public.faolla_attendance_leave_notification_detail_v1'));
const ordered=(source,...parts)=>{let at=-1;for(const part of parts){const next=source.indexOf(part,at+1);assert(next>at,`missing/out-of-order ${part}`);at=next;}};
const tables=['merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads'];

test('125 passes unchanged migration policy and adds only new notification tables/functions with122 prerequisites',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);assert.match(clean,/begin;\nset local lock_timeout='3s';/);
  assert(clean.includes("version=202610030122 and name='merchant_attendance_leave_requests'"));assert(clean.includes('merchant_attendance_leave_notifications_installation_conflict'));
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),tables);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_leave_notify_v1','faolla_attendance_leave_notification_detail_v1','faolla_attendance_leave_notifications_v1']);
  assert.doesNotMatch(clean,/\b(drop|delete from|disable trigger|owner to|create policy|update public\.)\b/i);
  for(const m of clean.matchAll(/insert into public\.(\w+)/g))assert([...tables,'faolla_schema_migrations'].includes(m[1]));
  assert.doesNotMatch(clean,/alter table public\.merchant_attendance_leave_(?:requests|entries)\b/);
  assert.doesNotMatch(clean,/\b(?:if|elsif)\b[^;\n]*?(?:<>|<=|>=|=|<|>)\s*case\b/i);
});
test('source projection stores only recipient IDs/type/time and new tables alone carry list index, RLS and immutable triggers',()=>{
  const ddl=clean.slice(clean.indexOf('create table'),clean.indexOf('create or replace function public.faolla_attendance_leave_notify_v1'));
  for(const text of ['recipient_auth_user_id uuid not null','unique(merchant_id,request_id,revision)',"revision=2 and action in('approve','reject')","revision=3 and action='cancel'",
    'references public.merchant_attendance_leave_entries(merchant_id,operation_id)',
    '(merchant_id,worker_id,employee_id,recipient_auth_user_id,decided_at desc,notification_id desc)',
    "array['merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads']",'before update or delete on public.%I','before truncate on public.%I'])assert(ddl.includes(text));
  assert.equal((clean.match(/create index if not exists/g)||[]).length,1);assert.equal((clean.match(/enable row level security/g)||[]).length,2);
  const notificationDdl=clean.slice(clean.indexOf('create table'),clean.indexOf('create index'));
  assert.doesNotMatch(notificationDdl,/reason|worker_name|email|command|snapshot|actor_auth_user_id/);
  assert.doesNotMatch(clean,/after insert|on public\.merchant_attendance_leave_(?:entries|requests)\s+for/i);
});
test('wrapper only accepts exact owner decision query6/command5, not GET/self/withdraw or an extra capture flag',()=>{
  assert(wrapper.includes('jsonb_object_keys(p_query))<>6'));assert(wrapper.includes("array['siteId','access','requestId','operationId','beforeAt','beforeId']"));
  assert(wrapper.includes('jsonb_object_keys(p_command))<>5'));assert(wrapper.includes("array['operationId','action','reason','requestId','expectedRevision']"));
  assert(wrapper.includes("p_query->'access' is distinct from '\"owner\"'::jsonb"));assert(wrapper.includes("not in('approve','reject','cancel')"));
  assert(wrapper.includes('p_command is null or jsonb_typeof(p_command)'));assert(wrapper.includes("p_command->'requestId' is distinct from p_query->'requestId'"));
  assert(wrapper.includes("p_query->'operationId'<>'null'::jsonb"));assert(wrapper.includes('language plpgsql volatile security definer set search_path=pg_catalog'));
});
test('locked fresh source check precedes unchanged original RPC; old replay returns without capture or historical backfill',()=>{
  ordered(wrapper,'perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'perform 1 from public.merchant_attendance_settings where merchant_id=site for update',
    'select exists(select 1 from public.merchant_attendance_leave_entries where merchant_id=site and operation_id=op) into existed',
    'result:=public.faolla_attendance_leave_v1(p_query,p_auth_user_id,p_command,p_allow_write)','if existed then return result;end if',
    'select * into source','select * into request_row','insert into public.merchant_attendance_leave_notifications');
  assert.equal((wrapper.match(/public\.faolla_attendance_leave_v1\(/g)||[]).length,1);assert.doesNotMatch(wrapper,/current_setting|set_config|advisory|on conflict/i);
});
test('capture verifies original receipt/command and request identity, and all capture errors roll back instead of silently succeeding',()=>{
  for(const text of ['source.actor_auth_user_id<>p_auth_user_id','source.command is distinct from p_command',"result->'receipt'->'command' is distinct from p_command",
    "result->'receipt'->'item' is distinct from source.snapshot",'checked:=public.faolla_attendance_leave_summary_v1(request_row,source.revision)',
    'values(site,op,rid,request_row.worker_id,request_row.employee_id,request_row.actor_auth_user_id,source.revision,source.action,source.recorded_at)'])assert(wrapper.includes(text));
  assert.match(wrapper,/exception when others then\s+raise exception 'attendance_leave_invalid';/);
  assert.doesNotMatch(wrapper,/exception when others then\s+(?:return|null)|insert into public\.merchant_attendance_leave_(?:requests|entries)\b/);
});
test('bounded helper checks source operation, all recipient identities and complete original history without reauthorizing historical owner',()=>{
  for(const text of ['source.request_id<>p.request_id','source.revision<>p.revision','source.action<>p.action','source.recorded_at<>p.decided_at',
    'request_row.worker_id<>p.worker_id','request_row.employee_id<>p.employee_id','request_row.actor_auth_user_id<>p.recipient_auth_user_id',
    'public.faolla_attendance_leave_summary_v1(request_row)','public.faolla_attendance_leave_summary_v1(request_row,p.revision)',
    'historical_item is distinct from source.snapshot','read_row.recipient_auth_user_id<>p.recipient_auth_user_id','read_row.read_at<p.decided_at'])assert(helper.includes(text));
  assert.doesNotMatch(helper,/merchants|merchant_enterprise_|\.active|\.permissions/);
  const output=helper.slice(helper.indexOf('return jsonb_build_object'),helper.indexOf('exception when others'));
  assert.deepEqual([...output.matchAll(/(?:jsonb_build_object\(|,)\s*'([A-Za-z]+)',/g)].map(m=>m[1]),['notificationId','requestId','revision','type','decidedAt','startAt','endAt','timeZone','readAt','currentStatus','currentRevision']);
  assert.doesNotMatch(output,/'reason'|'command'|'actorAuth'|'workerName'/);
});
test('reader strictly binds current employee/worker and filters all four identities before25+1 decision-time paging',()=>{
  assert(reader.includes('jsonb_object_keys(p_query))<>6'));assert(reader.includes("array['siteId','expectedEmployeeId','expectedWorkerId','notificationId','beforeAt','beforeId']"));
  ordered(reader,'perform 1 from public.merchants','if p_command is null then perform 1 from public.merchant_attendance_settings',
    'select * into e','select * into r','select * into w','expected_worker is not null and expected_worker is distinct from w.id');
  assert(reader.includes("e.status<>'active' or e.id<>expected_employee"));assert(reader.includes("not('attendance.self.view'=any(r.permissions))"));
  assert(reader.includes('(cursor_at is null)<>(cursor_id is null)'));assert(reader.includes('(cursor_at is not null or nid is not null) and expected_worker is null'));
  assert(reader.includes('n.merchant_id=site and n.worker_id=w.id and n.employee_id=e.id'));assert(reader.includes('n.recipient_auth_user_id=p_auth_user_id'));
  assert(reader.includes('order by n.decided_at desc,n.notification_id desc limit 26'));assert(reader.includes('rows_seen=26 then next_cursor else null'));
  assert.doesNotMatch(reader,/w\.active|self\.leave|self\.clock|employment|settings\.enabled|unread|mark_all/);
});
test('first read marker is explicit, naturally idempotent and paused-aware, retaining the first timestamp with no existing-row writes',()=>{
  assert(reader.includes('jsonb_object_keys(p_command))<>2'));assert(reader.includes("array['action','notificationId']"));
  assert(reader.includes("p_command->'notificationId' is distinct from p_query->'notificationId'"));
  ordered(reader,'detail:=public.faolla_attendance_leave_notification_detail_v1(target)',"if p_command is not null and detail->'readAt'='null'::jsonb then",
    "if not p_allow_write then raise exception 'attendance_platform_paused'",'insert into public.merchant_attendance_leave_notification_reads',
    'greatest(clock_timestamp(),target.decided_at)','on conflict(merchant_id,notification_id) do nothing');
  assert.doesNotMatch(reader,/update public\.|operationId/);
  const output=reader.slice(reader.indexOf("result:=jsonb_build_object('protocol'"),reader.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['protocol','siteId','actorId','employeeId','workerId','items','nextCursor','detail']);
});
test('both new public RPCs are service-only, helper/tables private and effective inherited ACLs checked without altering original grants',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,2);
  for(const fn of ['faolla_attendance_leave_notify_v1','faolla_attendance_leave_notifications_v1'])assert(clean.includes(`grant execute on function public.${fn}(jsonb,uuid,jsonb,boolean) to service_role`));
  assert(clean.includes('revoke all on function public.faolla_attendance_leave_notification_detail_v1(public.merchant_attendance_leave_notifications) from public,anon,authenticated,service_role'));
  assert.doesNotMatch(clean,/(?:grant|revoke)[^;]*function public\.faolla_attendance_leave_v1\(/);
  assert(clean.includes("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))"));assert(clean.includes("pg_has_role(r,c.relowner,'USAGE')"));
  assert(clean.includes("values(202610040125,'merchant_attendance_leave_notifications') on conflict(version) do nothing"));assert(clean.includes("notify pgrst, 'reload schema'"));
});
