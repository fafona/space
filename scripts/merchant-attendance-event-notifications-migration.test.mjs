//200 source-contract checks only: no PostgreSQL, browser or runtime is started.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const sql=readFileSync(new URL('./supabase-migrations/202610060169_merchant_attendance_event_notifications.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const body=name=>{const start=sql.indexOf(`create or replace function public.${name}(`),end=sql.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+4);};
const helper=name=>body(`faolla_attendance_event_notification_${name}_v1`);
const api=body('faolla_attendance_event_notifications_v1');
const includes=(s,parts)=>parts.forEach(p=>assert(s.includes(p),p));
const ordered=(s,parts)=>{let previous=-1;for(const p of parts){const at=s.indexOf(p,previous+1);assert(at>previous,p);previous=at;}};
const wrappers=[
  ['faolla_attendance_schedule_event_v1','merchant_attendance_schedule_commands','faolla_attendance_schedule_v1',"'schedule'"],
  ['faolla_attendance_schedule_delegation_event_v1','merchant_attendance_schedule_commands','faolla_attendance_schedule_delegation_v1',"'schedule'"],
  ['faolla_attendance_work_arrangement_event_v1','merchant_attendance_work_arrangement_entries','faolla_attendance_work_arrangement_v1',"'work_arrangement'"],
  ['faolla_attendance_delegated_applications_event_v1','merchant_attendance_work_arrangement_entries','faolla_attendance_delegated_applications_v1',"'work_arrangement'"],
  ['faolla_attendance_plan_exception_review_event_v1','merchant_attendance_plan_exception_entries','faolla_attendance_plan_exception_review_v1',"'plan_exception'"],
];

test('169 is additive with exact five source wrappers, five private helpers and one self RPC',()=>{
  const names=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]);
  assert.deepEqual(names,[...['source','verify','guard','capture','detail'].map(n=>`faolla_attendance_event_notification_${n}_v1`),...wrappers.map(x=>x[0]),'faolla_attendance_event_notifications_v1']);
  assert.equal((sql.match(/create table if not exists public\./g)||[]).length,2);
  const writes=[...sql.matchAll(/(?:insert into|update|delete from|alter table) public\.([a-z0-9_]+)/gi)].map(x=>x[1]);
  assert(writes.every(n=>['merchant_attendance_event_notifications','merchant_attendance_event_notification_reads','faolla_schema_migrations'].includes(n)));
  assert.doesNotMatch(sql,/pg_get_functiondef|disable trigger|set_replication_role|set session_replication_role/i);
});

test('real prerequisite versions and schema-relative reentry are explicit',()=>{
  includes(sql,["set local lock_timeout='3s'",'(202610050136::bigint,\'merchant_attendance_schedule_publication_evidence\')',
    "(202610060156::bigint,'merchant_attendance_work_arrangements')","(202610060159::bigint,'merchant_attendance_work_arrangement_exceptions')",
    "(202610060162::bigint,'merchant_attendance_application_delegation')","(202610060167::bigint,'merchant_attendance_schedule_delegation')",
    "pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)",
    "values(202610060169,'merchant_attendance_event_notifications') on conflict(version) do nothing", "notify pgrst, 'reload schema';\ncommit;"]);
  assert.doesNotMatch(sql,/nspname\s*=\s*'public'/);
});

test('capture identity/revision constraints fail closed including SQL NULL cases',()=>{
  includes(sql,['primary key(merchant_id,notification_id),unique(merchant_id,source_category,operation_id)',
    "source_category='work_arrangement' and source_revision is not null", "source_category='plan_exception' and source_revision is not null",
    "capture_status='ready' and recipient_auth_user_id is not null and unavailable_reason is null",
    "capture_status='recipient_unavailable' and source_category='schedule' and recipient_auth_user_id is null and unavailable_reason is not null",
    "unavailable_reason='publication_identity_unproven'", "octet_length(convert_to(summary::text,'UTF8'))<=16384",
    'foreign key(merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id)']);
});

test('both ledgers are private, append-only, source-guarded and indexed by exact saved recipient',()=>{
  includes(sql,['alter table %s enable row level security','revoke all on %s from public,anon,authenticated,service_role',
    'attendance_event_notification_immutable before update or delete','attendance_event_notification_no_truncate before truncate',
    'attendance_event_notification_source_guard after insert',
    "(merchant_id,worker_id,employee_id,recipient_auth_user_id,occurred_at desc,notification_id desc) where capture_status='ready'",
    "tgname in('attendance_event_notification_immutable','attendance_event_notification_no_truncate','attendance_event_notification_source_guard'))<>3"]);
  const acl=sql.slice(sql.indexOf('do $event_notification_acl$'));
  for(const n of [...wrappers.map(x=>x[0]),'faolla_attendance_event_notifications_v1']){
    assert(body(n).includes('security definer set search_path=pg_catalog'));assert(acl.includes(`public.${n}(`));
  }
  includes(acl,['revoke all on function %s from public,anon,authenticated,service_role',
    "f::text !~ 'faolla_attendance_event_notification_(source|verify|guard|capture|detail)_v1'",'grant execute on function %s to service_role']);
});

test('ACL postconditions enumerate all standard table privileges and the unchanged safety checker accepts169',()=>{
  const post=sql.slice(sql.indexOf('do $event_notification_postconditions$'));
  ordered(post,["foreach r in array array['anon','authenticated','service_role'] loop",
    'for privilege_name in select distinct a.privilege_type from pg_catalog.pg_class c',
    "cross join lateral pg_catalog.aclexplode(pg_catalog.acldefault('r',c.relowner)) a where c.oid=t loop",
    "if has_table_privilege(r,t,privilege_name) then raise exception 'merchant_attendance_event_notifications_acl_postcondition_failed'"]);
  assert.doesNotMatch(post,/privilege_type\s+in\s*\(|privilege_name\s*=|has_table_privilege\(r,t,'/);
  assert.deepEqual(validateMigrationSource('202610060169_merchant_attendance_event_notifications.sql',sql),[]);
});

test('each capture follows source lock/probe/original write and cannot backfill GET or replay',()=>{
  for(const [name,table,original,category] of wrappers){
    const s=body(name);
    ordered(s,['from public.merchants','from public.merchant_attendance_settings',`select exists(select 1 from public.${table}`,
      `result:=public.${original}(`,'if op is not null and not existed then','faolla_attendance_event_notification_capture_v1(', 'return result;']);
    assert(s.includes(category));assert(s.includes('p_command is not null'));
    assert.doesNotMatch(s,/exception when|on conflict|from public\.merchant_attendance_event_notifications/);
  }
  assert.doesNotMatch(helper('capture'),/on conflict\s*\(/i);
  ordered(helper('capture'),['source:=public.faolla_attendance_event_notification_source_v1','source->\'command\' is distinct from p_command','insert into public.merchant_attendance_event_notifications']);
});

test('099 versus136 and the original162 leave capture switch remain independent',()=>{
  includes(body(wrappers[0][0]),['p_capture_publication_evidence boolean default false',
    'if p_capture_publication_evidence then result:=public.faolla_attendance_schedule_evidenced_v1(p_query,p_auth_user_id,p_command,p_allow_write)',
    'else result:=public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write)']);
  const delegated=body(wrappers[3][0]);
  ordered(delegated,["select g.category into category","if category='work_arrangement' then","op:=(p_command->'decision'->>'operationId')::uuid"]);
  includes(delegated,['p_capture_notifications boolean default false',
    'public.faolla_attendance_delegated_applications_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_capture_notifications)']);
  assert.doesNotMatch(delegated,/insert into public\.merchant_attendance_leave|captured_notification\s*:=/);
});

test('159 wrapper matches its original pre-advisory lock hierarchy and never upgrades settings',()=>{
  const s=body(wrappers[4][0]);
  ordered(s,['from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for share',
    "where merchant_id=site and id=(p_query->>'workerId')::uuid for share",
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    "pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0))",
    'select exists(select 1 from public.merchant_attendance_plan_exception_entries',
    'result:=public.faolla_attendance_plan_exception_review_v1']);
  assert.doesNotMatch(s,/for update|plan_exception_source_v1\(/);
  includes(s,["p_query->>'access'='owner' and p_query->>'mode'='decide'",'public.merchant_attendance_plan_exception_reads']);
});

test('schedule summaries use saved publication Auth without guessing current binding',()=>{
  const s=helper('source').split("elsif p_category='work_arrangement'")[0];
  includes(s,["'expectedGrantRevision',1,'decision',sc.command",'public.faolla_attendance_self_schedule_slot_v1(slot)',
    'recipient:=publication.employee_auth_user_id','order by s.start_at,s.id limit 33','if n>32',"n<>jsonb_array_length(sc.command->'slots')",
    "checked->'cancellation'->>'operationId' is distinct from p_operation::text",'slot.employee_id is distinct from employee']);
  assert.doesNotMatch(s,/merchant_enterprise_employees|auth_user_id\s*=\s*recipient|clock_timestamp\(|pg_timezone_names/);
  includes(helper('source'),["case when recipient is null then 'recipient_unavailable' else 'ready' end",
    "case when recipient is null then 'publication_identity_unproven' else null end"]);
});

test('work and exception summaries verify saved actors and specified historical revision, not current sources',()=>{
  const s=helper('source');
  includes(s,['public.faolla_attendance_work_arrangement_summary_v1(req,entry.revision)','checked is distinct from entry.snapshot',
    'recipient:=req.actor_auth_user_id','public.faolla_attendance_application_delegation_receipt_v1(authority)',
    "authority.category<>'work_arrangement'",'public.faolla_attendance_plan_exception_review_entry_v1(decision)',
    'recipient:=case_row.employee_auth_user_id',"decision.kind is distinct from 'decision'",'source_revision:=decision.revision']);
  assert.doesNotMatch(s,/plan_exception_source_v1\(|schedule_delegation_actions_v1\(|merchant_enterprise_roles|account_epochs|now\(\)|clock_timestamp\(/);
  assert.doesNotMatch(s,/when others|check_violation|unique_violation/);
  includes(s,['YYYY-MM-DD"T"HH24:MI:SS.US"Z"',"'summary',summary,'command',command"]);
});

test('self query and command are exact and worker pinning applies to detail and pagination',()=>{
  includes(api,["array['siteId','expectedEmployeeId','expectedWorkerId','notificationId','beforeAt','beforeId']",
    "octet_length(convert_to(p_query::text,'UTF8'))>4096","coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'",
    "p_query->'beforeAt','stamp6'",'(cursor_id is null)<>(cursor_at is null)',
    'expected_worker is null and (nid is not null or cursor_id is not null)',"array['action','notificationId']",
    "p_command->>'action' is distinct from 'mark_read'","p_command->'notificationId' is distinct from p_query->'notificationId'"]);
  assert.doesNotMatch(sql,/shift_rule_binding_scalar_v1\([^\n]+,'site'\)/);
});

test('self read locks and rechecks current member/Auth while preserving paused-worker reads',()=>{
  ordered(api,['from public.merchants where id=site for share',
    'from public.merchant_attendance_settings where merchant_id=site for share',
    'select id into employee_uuid','where merchant_id=site and employee_id=employee_uuid for share',
    'where merchant_id=site and id=employee_uuid for share','e.auth_user_id is distinct from p_auth_user_id',
    'where merchant_id=site and id=e.role_id for share']);
  includes(api,["e.status<>'active'","array['enterprise.view','attendance.self.view']::text[]",
    'expected_worker is not null and expected_worker is distinct from w.id','can_mark:=p_allow_write and s.enabled and w.id is not null',
    "and capture_status='ready' and worker_id=w.id and employee_id=e.id and recipient_auth_user_id=p_auth_user_id"]);
  assert.doesNotMatch(api,/w\.active|merchant_attendance_employment_periods|role.*owner|\buser_id=p_auth_user_id/);
});

test('first mark-read is independent, atomic and preserves the original read timestamp even when paused',()=>{
  ordered(api,["if p_command is not null and detail->'readAt'='null'::jsonb then",
    "if not can_mark then raise exception 'attendance_platform_paused'",'insert into public.merchant_attendance_event_notification_reads',
    'greatest(clock_timestamp(),target.occurred_at)) on conflict(merchant_id,notification_id) do nothing',
    'detail:=public.faolla_attendance_event_notification_detail_v1(target)']);
  assert.doesNotMatch(api,/plan_exception_reads|period_closures|leave_notifications|operationId|when others/);
  includes(helper('guard'),['notice.capture_status<>\'ready\'','(notice.worker_id,notice.employee_id,notice.recipient_auth_user_id)',
    '(new.worker_id,new.employee_id,new.recipient_auth_user_id)','new.read_at<notice.occurred_at']);
});

test('bounded keyset list emits exact frozen envelope and minimal eight-key items',()=>{
  includes(api,["order by n.occurred_at desc,n.notification_id desc limit 26",'seen:=seen+1;exit when seen=26',
    '(n.occurred_at,n.notification_id)<(cursor_at,cursor_id)',"public.faolla_attendance_event_notification_detail_v1(candidate)-'summary'",
    "'nextCursor',case when seen=26 then next_cursor else null end","'detail',detail,'canMarkRead',can_mark",
    "octet_length(convert_to(result::text,'UTF8'))>131072"]);
  const envelope=api.match(/result:=jsonb_build_object\(([\s\S]+?)\);/)[1];
  assert.deepEqual([...envelope.matchAll(/'([A-Za-z]+)'\s*,/g)].map(x=>x[1]),['protocol','siteId','actorId','employeeId','workerId','items','nextCursor','detail','canMarkRead']);
  assert.doesNotMatch(api,/moduleEnabled|count\(\*\)|offset\s+[0-9]|interval.*days/i);
});

test('historical detail is immutable source-bound and excludes recipient, actor, names and reasons from DTO',()=>{
  includes(helper('verify'),["source-'command'",'p.summary','p.recipient_auth_user_id','p.actor_auth_user_id']);
  const detail=helper('detail');
  includes(detail,['public.faolla_attendance_event_notification_verify_v1(p)',"'summary',p.summary",'r.read_at<p.occurred_at']);
  const wire=detail.slice(detail.indexOf('return jsonb_build_object'));
  assert.doesNotMatch(wire,/'(?:actorId|recipientAuthUserId|employeeId|workerId|reason|workerName|evidence|command)'/);
  assert.deepEqual([...wire.matchAll(/'([a-z][A-Za-z]+)'\s*,/g)].map(x=>x[1]),['notificationId','sourceCategory','sourceOperationId','sourceId','sourceRevision','type','occurredAt','readAt','summary']);
});
