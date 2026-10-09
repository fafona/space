// Source contracts only; these are not PostgreSQL execution/authorization proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040129_merchant_attendance_personal_rules.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const tables=['merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations'];
const functions=['faolla_attendance_personal_rule_end_v1','faolla_attendance_personal_rule_command_v1','faolla_attendance_personal_rule_item_v1',
  'faolla_attendance_personal_rule_receipt_v1','faolla_attendance_personal_rule_stream_checked_v1','faolla_attendance_personal_rules_v1'];
const between=(start,end)=>clean.slice(clean.indexOf(start),clean.indexOf(end));
const body=between('create or replace function public.faolla_attendance_personal_rules_v1(','do $personal_rules_acl$');
const command=between('create or replace function public.faolla_attendance_personal_rule_command_v1','create table if not exists');
const item=between('create or replace function public.faolla_attendance_personal_rule_item_v1','create or replace function public.faolla_attendance_personal_rule_receipt_v1');
const receipt=between('create or replace function public.faolla_attendance_personal_rule_receipt_v1','create or replace function public.faolla_attendance_personal_rule_stream_checked_v1');
const checked=between('create or replace function public.faolla_attendance_personal_rule_stream_checked_v1','create or replace function public.faolla_attendance_personal_rules_v1(');
function ordered(...parts){let position=-1;for(const part of parts){const next=body.indexOf(part,position+1);assert(next>position,`missing/out-of-order ${part}`);position=next;}}

test('129 creates only its independent two-table ledger and six helpers without changing existing source/writer paths',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(match=>match[1]),tables);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),functions);
  for(const match of clean.matchAll(/(?:insert into|update|alter table) public\.(\w+)/g))assert([...tables,'faolla_schema_migrations'].includes(match[1]),match[1]);
  assert.doesNotMatch(clean,/\b(?:drop|delete from|disable trigger|owner to|create policy)\b/i);
  assert.doesNotMatch(body,/s\.enabled|merchant_attendance_(?:events\b|schedule_|leave_|calendar_|missing_|correction_|effect_|rule_operations)|source[s]?_v1|save_draft|publish/);
  assert(clean.includes("values(202610040129,'merchant_attendance_personal_rules') on conflict(version) do nothing"));
});

test('prerequisites and named registry/object conflicts are explicit and only new objects are re-created on reapply',()=>{
  for(const part of ["version=202609290064 and name='merchant_attendance_owner_configuration'","version=202610030124 and name='merchant_attendance_groups'",
    "version=202610040127 and name='merchant_attendance_rule_versions'",'merchant_attendance_personal_rules_prerequisite_required',
    'merchant_attendance_personal_rules_installation_conflict',"installed<>(to_regclass('public.'||t) is not null)",
    'installed<>(to_regprocedure(p) is not null)','to_regclass(\'public.merchant_enterprise_employees\')'])assert(clean.includes(part),part);
  assert.doesNotMatch(clean,/create.*function public\.faolla_attendance_(?:rule_values|rule_day_start|group_|control_)/);
});

test('commands have exact twelve/five keys, safe integer CAS, strict explicit identities and no all-inherit approval',()=>{
  for(const part of ["array['operationId','action','expectedRevision','reason']",'::numeric>9007199254740989',
    "n<>12 or not(p ?& array['expectedWorkerVersion','expectedSettingsVersion','employeeId','employeeAuthUserId','timeZone','startsOn','endsOn','rules'])",
    "array['employeeId','employeeAuthUserId']","array['expectedWorkerVersion','expectedSettingsVersion']",'::numeric>9007199254740990',
    "public.faolla_attendance_group_text_v1(p->>'reason',1,200)","public.faolla_attendance_rule_values_v1(p->'rules')",
    "choices.value->>'mode'<>'inherit'","n<>5 or not(p ? 'approvedRevision')","(p->>'approvedRevision')::numeric>(p->>'expectedRevision')::numeric",
    "(p->>'endsOn')::date-(p->>'startsOn')::date not between 0 and 30"])assert(command.includes(part),part);
  assert.doesNotMatch(command,/save_draft|submit|reject|publish|expectedGroup/);
});

test('inclusive end boundary validates selected date but permits a skipped next label and2101 sentinel without old helper changes',()=>{
  const end=between('create or replace function public.faolla_attendance_personal_rule_end_v1','create or replace function public.faolla_attendance_personal_rule_command_v1');
  for(const part of ['public.faolla_attendance_rule_day_start_v1(p,z) is null','d:=p::date+1','-129600000;hi:=lo+259200000',
    'while lo<hi loop','middle:=lo+(hi-lo)/2','(instant at time zone z)::date<d',"return epoch+(lo/1000)*interval '1 second'+(lo%1000)*interval '1 millisecond'"])assert(end.includes(part),part);
  assert.doesNotMatch(end,/date<>d|d between|rule_day_start_v1\(d|2100-12-31/);
  assert(body.includes("start_at:=public.faolla_attendance_rule_day_start_v1(p_command->>'startsOn',s.time_zone)"));
  assert(body.includes("end_at:=public.faolla_attendance_personal_rule_end_v1(p_command->>'endsOn',s.time_zone)"));
  assert(body.includes("start_at is null or end_at is null or end_at<=start_at then raise exception 'attendance_invalid_request'"));
});

test('same-merchant worker and actual employee identity are locked after current owner/settings and before receipt recovery',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'if p_command is null then select * into s', 'else select * into s',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'select * into stream', 'stream.employee_id is distinct from w.employee_id or stream.employee_auth_user_id is distinct from e.auth_user_id',
    "raise exception 'attendance_personal_rule_identity_changed'",'select * into existing');
  assert(body.includes("raise exception 'attendance_worker_not_found'"));
  assert(body.includes("'employeeActive',coalesce(e.status='active',false)"));
  assert(body.includes("'employeeAuthUserId',e.auth_user_id"));assert.doesNotMatch(body,/auth_user_id=p_auth_user_id|display_name\s*=|email\s*=/);
});

test('immutable original actor/command receipt precedes pause, active/version and fresh identity eligibility',()=>{
  ordered("existing.worker_id<>wid or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied'",
    "existing.command is distinct from p_command then raise exception 'attendance_operation_conflict'",
    'receipt:=public.faolla_attendance_personal_rule_receipt_v1(existing)','if p_command is not null and receipt is null then',
    'if not p_allow_write',"(p_command->>'expectedRevision')::bigint<>current_rev",
    "not w.active or e.id is null or e.status<>'active' or e.auth_user_id is null",
    "(p_command->>'employeeId')::uuid is distinct from w.employee_id or (p_command->>'employeeAuthUserId')::uuid is distinct from e.auth_user_id",
    "(p_command->>'expectedWorkerVersion')::bigint<>w.version");
  assert(body.includes("array['siteId','workerId','operationId','beforeRevision']"));assert(body.includes('jsonb_object_keys(p_query))<>4'));
  assert(body.includes('if op is not null and before_rev is not null'));assert(body.includes('if op is not null or before_rev is not null'));
  assert(clean.includes('primary key(merchant_id,operation_id)'));
});

test('future approval and withdrawal use locked fresh wall clock and UTC half-open overlap with touching endpoints allowed',()=>{
  ordered('else select * into s',"start_at:=public.faolla_attendance_rule_day_start_v1",'approved.from_at<end_at and approved.to_at>start_at',
    'withdrawn.approved_revision=approved.revision', 'select * into target',"raise exception 'attendance_personal_rule_already_withdrawn'",
    'stamp:=clock_timestamp()',"(p_command->>'startsOn')::date<=today or start_at<=stamp",'stamp>=target.from_at',
    'insert into public.merchant_attendance_personal_rule_streams');
  assert.doesNotMatch(body,/\bnow\(\)|transaction_timestamp\(|approved\.from_at<=end_at|approved\.to_at>=start_at/);
  assert(body.includes("raise exception 'attendance_personal_rule_future_required'"));assert(body.includes("raise exception 'attendance_personal_rule_overlap'"));
});

test('withdraw retains all ten original context fields and requires a nonnull earlier approval at storage level',()=>{
  for(const key of ['employee_id','employee_auth_user_id','worker_version','settings_version','time_zone','starts_on','ends_on','from_at','to_at','rules'])
    assert(body.includes(`entry.${key}:=target.${key}`),key);
  assert(body.includes('entry.approved_revision:=target.revision'));
  assert(clean.includes("action='withdraw' and approved_revision is not null and approved_revision between 1 and revision-1"));
  assert(clean.includes('foreign key(merchant_id,worker_id,approved_revision,approved_action)'));
  assert(clean.includes("approved_action text not null default 'approve' check(approved_action='approve')"));
  assert(clean.includes('create unique index if not exists attendance_personal_rule_withdrawals_idx'));
  assert(receipt.includes('is distinct from row(target.employee_id,target.employee_auth_user_id,target.worker_version,target.settings_version,target.time_zone,target.starts_on,target.ends_on,target.from_at,target.to_at,target.rules)'));
});

test('item has exactly seventeen keys with original actor and canonical6us/3ms precision; receipt never contains derived withdrawal status',()=>{
  assert.deepEqual([...item.matchAll(/(?<=[(,])\s*'([A-Za-z]+)',/g)].map(match=>match[1]),[
    'revision','operationId','actorId','action','reason','recordedAt','employeeId','employeeAuthUserId','workerVersion','settingsVersion','timeZone','startsOn','endsOn','fromAt','toAt','rules','approvedRevision']);
  assert(item.includes("'actorId',p.actor_auth_user_id"));assert(item.includes('SS.US"Z"'));assert(item.includes('SS.MS"Z"'));
  assert.doesNotMatch(item,/withdrawnByRevision|workerName|employeeActive/);
  assert(receipt.includes("jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'command',p.command,'item',expected)"));
});

test('receipt validation checks snapshot, indexed predecessor/target and source boundaries without recursive history replay',()=>{
  for(const part of ['p.snapshot is distinct from expected','revision=p.revision-1','previous.recorded_at>p.recorded_at',
    'previous.employee_auth_user_id is distinct from p.employee_auth_user_id','revision=p.approved_revision','target.recorded_at>p.recorded_at',
    'p.recorded_at>=target.from_at',"context.command->'expectedWorkerVersion' is distinct from to_jsonb(context.worker_version)",
    "context.command->>'employeeAuthUserId' is distinct from context.employee_auth_user_id::text",
    "context.to_at is distinct from public.faolla_attendance_personal_rule_end_v1",
    'context.starts_on<=(context.recorded_at at time zone context.time_zone)::date'])assert(receipt.includes(part),part);
  assert.equal((receipt.match(/faolla_attendance_personal_rule_receipt_v1\(/g)||[]).length,1);
  assert.doesNotMatch(receipt,/\bloop\b|with recursive|language plpgsql stable/);
  for(const part of ['first_op.recorded_at<>p.created_at','last_op.recorded_at<>p.updated_at','revision>p.revision',
    'first_op.employee_id is distinct from p.employee_id','last_op.employee_auth_user_id is distinct from p.employee_auth_user_id'])assert(checked.includes(part),part);
});

test('identity-anchored head/approval receipt links and private append-only operations cannot be rewritten or truncated',()=>{
  for(const part of ['unique(merchant_id,worker_id,employee_id,employee_auth_user_id)',
    'foreign key(merchant_id,worker_id,employee_id,employee_auth_user_id)',
    'foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id)',
    'attendance_personal_rule_head_receipt_fk','deferrable initially deferred','unique(merchant_id,worker_id,revision,action)',
    'before update or delete on public.merchant_attendance_personal_rule_operations',
    'before truncate on public.merchant_attendance_personal_rule_operations'])assert(clean.includes(part),part);
  const update=body.match(/update public\.merchant_attendance_personal_rule_streams[^;]+;/)?.[0];assert(update);assert.doesNotMatch(update,/employee_id\s*=|employee_auth_user_id\s*=/);
});

test('history is bounded25plus1 with derived marker separate, current read timestamp and exact eleven-key result',()=>{
  assert(body.includes('order by revision desc limit 26'));assert(body.includes('exit when count_seen=26'));
  assert(body.includes("entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by)"));assert(body.includes('case when count_seen=26 then next_before else null end'));
  ordered('for entry in select','read_at:=clock_timestamp()','read_at<stream.updated_at',"result:=jsonb_build_object('protocol','personal-rules-v1'",'octet_length(result::text)>131072');
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/(?<=[(,])\s*'([A-Za-z]+)',/g)].map(match=>match[1]),[
    'protocol','siteId','actorId','worker','settingsVersion','timeZone','revision','items','nextBeforeRevision','receipt','readAt']);
});

test('only new SECURITY DEFINER RPC has service execute; helpers/tables stay private with RLS and postcondition assertions',()=>{
  assert.equal((clean.match(/enable row level security/g)||[]).length,2);assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(body.includes('language plpgsql security definer set search_path=pg_catalog'));
  assert(clean.includes('grant execute on function public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean) to service_role'));
  assert(clean.includes("execute format('revoke all on function %s from public,anon,authenticated,service_role',p)"));
  for(const part of ["pg_has_role(r,c.relowner,'USAGE')","aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))",
    "case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end",'merchant_attendance_personal_rules_registry_postcondition_failed',
    'merchant_attendance_personal_rules_acl_postcondition_failed',"notify pgrst, 'reload schema'"])assert(clean.includes(part),part);
  assert.doesNotMatch(clean,/search_path\s*=\s*(?:public|pg_catalog,\s*public)|grant.*(?:anon|authenticated)/);
});
