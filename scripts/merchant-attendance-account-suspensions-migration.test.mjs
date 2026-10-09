//193 static/source-contract proofs. The root agent exclusively runs PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610060164_merchant_attendance_account_suspensions.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),clean=sql.replace(/--[^\n]*/g,'');
const fn=(name,source=sql)=>{const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('$$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+3);};
const body=source=>source.slice(source.indexOf('as $$')+5,source.lastIndexOf('$$;'));
const has=(source,...needles)=>{for(const needle of needles)assert(source.includes(needle),needle);};
const order=(source,...needles)=>{let pos=-1;for(const needle of needles){const next=source.indexOf(needle,pos+1);assert(next>pos,needle);pos=next;}};
const update=fn('faolla_update_merchant_enterprise_employee_v1'),capture=fn('faolla_attendance_account_capture_v1');
const api=fn('faolla_attendance_account_suspensions_v1'),detail=fn('faolla_attendance_account_detail_v1');
const grant=fn('faolla_attendance_account_grant_epoch_v1'),current=fn('faolla_attendance_account_grant_current_v1');
test('164 is a single guarded additive transaction, with five private new tables only',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.equal((clean.match(/create table if not exists public\./g)||[]).length,5);
  assert.equal((clean.match(/create index if not exists /g)||[]).length,1);
  assert.doesNotMatch(clean,/\b(?:delete from|truncate table|drop (?:table|function|index)|disable trigger|session_replication_role|set_config|pg_advisory|statement_timeout)\b/i);
  assert.doesNotMatch(clean,/alter function|rename to/);
  for(const match of clean.matchAll(/\b(?:insert into|update) public\.(\w+)/g))assert.match(match[1],/^(?:merchant_attendance_(?:account_(?:suspensions|epochs|status_operations|restores)|delegation_epochs|workers|pin_credentials)|faolla_schema_migrations)$/);
});
test('prerequisites and reentry reject partial or conflicting registration without bootstrap',()=>{
  has(sql,"set local lock_timeout='3s'","(202608020019::bigint,'merchant_enterprise_audit')","(202609290064::bigint,'merchant_attendance_owner_configuration')",
    "(202610010106::bigint,'merchant_attendance_pin_credentials')","(202610060160::bigint,'merchant_attendance_missing_delegation')",
    "(202610060162::bigint,'merchant_attendance_application_delegation')",'installed<>(to_regclass','installed<>exists',"where oid='public.merchants'::regclass");
  assert.doesNotMatch(sql,/'public'::regnamespace/);
  order(sql,'$account_suspension_postconditions$;',"values(202610060164,'merchant_attendance_account_suspensions')",'commit;');
});
test('all three private legacy bodies are exact copies, while old entry-point OIDs are retained',()=>{
  const pairs=[
    ['202608020019_merchant_enterprise_audit.sql','faolla_update_merchant_enterprise_employee_v1','faolla_update_merchant_enterprise_employee_v1_pre_suspend_164'],
    ['202610060160_merchant_attendance_missing_delegation.sql','faolla_attendance_missing_delegation_usable_v1','faolla_attendance_missing_delegation_usable_pre164'],
    ['202610060162_merchant_attendance_application_delegation.sql','faolla_attendance_application_delegation_usable_v1','faolla_attendance_application_delegation_usable_pre164'],
  ];
  for(const [file,original,alias] of pairs)assert.equal(body(fn(alias)),body(fn(original,read(file))),alias);
  for(const match of clean.matchAll(/create or replace function public\.(\w+)/g))assert(match[1].length<=63,match[1]);
});
test('legacy employee shape is retained and opt-in additions stripped before exactly one fresh delegate call',()=>{
  has(update,"clean_input:=p_input-'attendance_operation_id'-'attendance_suspension_enabled'",
    "jsonb_typeof(p_input->'attendance_suspension_enabled') is distinct from 'boolean'",
    "coalesce(clean_input->>'status','') not in('active','disabled')",
    "k not in('merchant_id','employee_id','expected_version','actor_type','actor_id','status','offboarding_mode','replacement_employee_id')",
    'result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input)','return result_json;');
  assert.equal((update.match(/result_json:=public\.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164/g)||[]).length,1);
  assert.doesNotMatch(update,/update public\.merchant_enterprise_employees|employee\.status\s*:=/);
});
test('merchant and settings precede original task/employee locks; fresh actor authorization is not forged',()=>{
  order(update,'from public.merchants x where x.id=site for share','from public.merchant_attendance_settings x where x.merchant_id=site for update',
    'result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input)',
    'sid:=public.faolla_attendance_account_capture_v1');
  has(update,"actor_employee:=btrim(clean_input->>'actor_id')::uuid",'actor_auth:=ae.auth_user_id');
  const beforeFresh=update.slice(0,update.indexOf('result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164'));
  assert.doesNotMatch(beforeFresh,/merchant_enterprise_employees[^;]*for (?:share|update)/s);
});
test('fresh status operations preserve exact old result; replay precedes old expected-version validation',()=>{
  order(update,'select * into prior','prior.input is distinct from clean_input','return prior.result;',
    'result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input)',
    'insert into public.merchant_attendance_account_status_operations');
  has(update,'prior.actor_auth_user_id<>actor_auth','prior.actor_employee_id is distinct from actor_employee',
    'faolla_authorize_merchant_enterprise_employee_actor_v1(clean_input,target,true)',
    "exception when unique_violation then raise exception 'attendance_operation_conflict'");
  assert.doesNotMatch(update,/from public\.merchant_enterprise_audit_events/);
});
test('untracked off path is legacy, explicit disabled first capture only, tracked employees remain protected',()=>{
  has(update,"if btrim(clean_input->>'status')='disabled' then sid:=public.faolla_attendance_account_capture_v1");
  order(capture,'if ep.paused then return ep.suspension_id','if ep.employee_id is null and not coalesce(p_enabled,false) then return null',
    'from public.merchant_attendance_settings','from public.merchant_attendance_workers','gen:=coalesce(ep.generation,0)+1');
  has(capture,'x.delegate_employee_id=p_employee','if ep.employee_id is null and w.id is null',
    'values(p_site,sid,e.id,e.auth_user_id,e.display_name,gen,w.id,w.display_name,w.active,w.version,e.version');
  assert.doesNotMatch(capture,/insert into public\.merchant_attendance_workers|merchant_attendance_.*requests|employment_periods/);
});
test('raw tail and original actor are captured without generating or changing events',()=>{
  has(capture,'order by x.sequence desc limit 1','original_actor_employee_id','ev.id,ev.sequence,ev.action,ev.actor_employee_id');
  has(detail,'(ev.id,ev.sequence,ev.action,ev.actor_employee_id) is distinct from',
    'p.original_actor_employee_id is distinct from p.employee_id','"state_binding_changed"');
  assert.doesNotMatch(clean,/(?:insert into|update|delete from) public\.merchant_attendance_(?:events|employment_periods|leave|missing|work_arrangement|period_)/);
});
test('legacy normalized employee, actor and disabled values cannot bypass suspension capture',()=>{
  has(update,"coalesce(btrim(clean_input->>'employee_id'),'')", "target:=btrim(clean_input->>'employee_id')::uuid",
    "if btrim(clean_input->>'actor_type')='owner'", "elsif btrim(clean_input->>'actor_type')='employee'",
    "actor_auth:=btrim(clean_input->>'actor_id')::uuid", "actor_employee:=btrim(clean_input->>'actor_id')::uuid",
    "if btrim(clean_input->>'status')='disabled' then sid:=public.faolla_attendance_account_capture_v1");
  assert.equal((update.match(/clean_input:=/g)||[]).length,1);
  has(update,'prior.input is distinct from clean_input','result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input)');
});
test('urgent PIN revoke increments revision and erases secrets without old setter gates or audit fabrication',()=>{
  order(capture,'from public.merchant_attendance_workers','from public.merchant_attendance_pin_credentials','pin_after:=c.revision+1',
    'set revision=pin_after,enabled=false,salt=null,verifier=null','insert into public.merchant_attendance_account_suspensions');
  has(capture,'pin_revision_before,pin_revision_after,pin_invalidated','c.worker_id is not null,true,stamp');
  assert.doesNotMatch(capture,/faolla_attendance_pin_admin|attendance_rate_limited|attendance_time_reversed|insert into public\.merchant_attendance_pin_audit/);
  assert.doesNotMatch(sql,/verifier\s+(?:text|jsonb)|salt\s+(?:text|jsonb)/);
});
test('new grant captures both employee epochs, including delegates without workers, before any future usability',()=>{
  order(grant,'from public.merchant_attendance_settings','if tg_when=\'BEFORE\' then return new','from public.merchant_attendance_account_epochs',
    "raise exception 'attendance_account_suspended'",'insert into public.merchant_attendance_delegation_epochs');
  has(grant,'new.delegate_employee_id,new.delegate_auth_user_id,new.employee_id,new.employee_auth_user_id,coalesce(de.generation,0),coalesce(te.generation,0)');
  has(sql,'attendance_account_grant_lock before insert','attendance_account_grant_epoch after insert',
    "channel in('missing','application')",'missing_grant_id uuid generated always as','application_grant_id uuid generated always as');
  assert.doesNotMatch(grant,/from public\.merchant_attendance_workers/);
});
test('legacy no-sidecar grant is accepted only at both zero epochs; pause and later generations never revive it',()=>{
  has(current,'if coalesce(de.paused,false) or coalesce(te.paused,false) then return false',
    'if b.grant_id is null then return coalesce(de.generation,0)=0 and coalesce(te.generation,0)=0',
    'b.delegate_employee_id,b.delegate_auth_user_id,b.employee_id,b.employee_auth_user_id,b.delegate_generation,b.employee_generation');
  for(const channel of ['missing','application'])has(fn('faolla_attendance_'+channel+'_delegation_usable_v1'),
    'faolla_attendance_'+channel+'_delegation_usable_pre164(p,p_at)','faolla_attendance_account_grant_current_v1');
  assert.doesNotMatch(clean,/create or replace function public\.faolla_attendance_(?:missing|application)_delegation_(?:guard|receipt)_v1/);
});
test('old config and PIN activation guard never reverses lock order or changes operation replay',()=>{
  const guard=fn('faolla_attendance_account_activation_guard_v1');
  has(guard,"tg_table_name='merchant_attendance_workers'",'if new.active and exists',"tg_table_name='merchant_attendance_pin_credentials'",'if new.enabled and exists');
  assert.doesNotMatch(guard,/for share|for update|merchant_attendance_settings|insert into|update public\./);
  assert.doesNotMatch(clean,/create or replace function public\.faolla_attendance_(?:admin|pin_admin|pin_begin|pin_finish|self)_v1/);
});
test('new query and restore command use exact frozen keys, nullable worker CAS and valid scalar types',()=>{
  has(api,"array['siteId','mode','afterId','suspensionId','operationId']",
    "array['action','operationId','suspensionId','expectedGeneration','workerId','expectedWorkerVersion','expectedEmployeeVersion','employeeId','employeeAuthUserId','reason']",
    "(p_command->'workerId'='null'::jsonb)<>(p_command->'expectedWorkerVersion'='null'::jsonb)",
    "p_command->'expectedEmployeeVersion' is distinct from detail->'employeeVersion'","p_command->'expectedWorkerVersion' is distinct from detail->'workerVersion'");
  assert.doesNotMatch(api,/'revision'\)/);
  has(api,"p_command->'expectedGeneration','version'","p_command->'expectedWorkerVersion','version'");
});
test('restore uses unchanged current settings date and role/location/employment, preserving inactive origin',()=>{
  has(detail,"today:=(clock_timestamp() at time zone s.time_zone)::date","array['attendance.self.view','attendance.self.clock']",
    'if p.was_active then','x.starts_on<=today and (x.ends_on is null or x.ends_on>=today)',
    'w.id is distinct from p.worker_id','e.auth_user_id is distinct from p.employee_auth_user_id');
  assert.doesNotMatch(detail,/clock_timestamp\(\) at time zone l.time_zone/);
  order(api,"if not p_allow_restore then raise exception 'attendance_platform_paused'",'for update;',
    'detail:=public.faolla_attendance_account_detail_v1(s)',
    'set paused=false,updated_at=stamp','set active=s.was_active,version=version+1','insert into public.merchant_attendance_account_restores');
  assert.doesNotMatch(api,/set active=true|set generation=|set status=|pin_credentials|delegation_epochs/);
});
test('compact hash serializes scalar elements, keeping spaces inside names/reasons and nullable values',()=>{
  const hash=fn('faolla_attendance_account_hash_v1');
  has(hash,"string_agg(value::text,',' order by ord)",'jsonb_array_elements(p_values) with ordinality');
  assert.doesNotMatch(body(hash),/replace|regexp_replace|p_values::text/);
  has(update,"jsonb_build_array('attendance-account-status-v1',site,op::text,target::text",
    "clean_input->>'status',clean_input->>'offboarding_mode',clean_input->>'replacement_employee_id'");
  has(api,"jsonb_build_array('attendance-account-restore-v1',site,p_command->>'action'", "p_command->>'workerId',(p_command->>'expectedWorkerVersion')::bigint");
});
test('original-actor minimal recovery bypasses current activity but never exposes old command/result',()=>{
  const recovery=api.slice(api.indexOf("if mode_name in('recover','recover-status') then"),api.indexOf("if not coalesce(p_auth_user_id=any"));
  has(recovery,'old_restore.actor_auth_user_id<>p_auth_user_id','old_status.actor_auth_user_id<>p_auth_user_id',
    'x.id=old_status.actor_employee_id and x.auth_user_id=p_auth_user_id for share');
  order(recovery,'old_status.actor_auth_user_id<>p_auth_user_id','x.id=old_status.actor_employee_id and x.auth_user_id=p_auth_user_id for share',
    "if not found then raise exception 'attendance_access_denied'",'status_receipt:=public.faolla_attendance_account_status_receipt_v1');
  assert.doesNotMatch(recovery.replace(/--[^\n]*/g,''),/\.status|permissions|p_allow_restore|insert into|\.result|\.input|\.command/);
  assert.doesNotMatch(recovery,/merchant_attendance_settings|merchant_enterprise_roles/);
  for(const name of ['status','restore'])assert.doesNotMatch(fn('faolla_attendance_account_'+name+'_receipt_v1'),/'reason'|'employeeName'|'command'|'result'/);
});
test('bounded current-pause pagination and explicit not-checked fields do not scan pending history',()=>{
  has(api,'and x.paused and (after_id is null or x.suspension_id>after_id)','order by x.suspension_id limit 26','jsonb_array_length(items)=25',
    "jsonb_build_object('siteId',site,'mode',mode_name,'items',items,'nextAfterId',next_id,'detail',detail,'receipt',receipt,'statusReceipt',status_receipt)",'>131072');
  has(detail,"jsonb_build_object('leave','not_checked','workArrangement','not_checked','missing','not_checked','unknownOperations','not_observable')");
  assert.doesNotMatch(detail,/missing_requests|leave_requests|work_arrangement_requests/);
});
test('new storage and helpers remain private, append-only facts and enabled correct triggers are rechecked',()=>{
  has(sql,'enable row level security','revoke all on table %s from public,anon,authenticated,service_role',
    "n<>'merchant_attendance_account_epochs'",'before update or delete','before truncate',
    "tgenabled='O' and tgtype=27","tgenabled='O' and tgtype=34",'tgtype=tr.kind','tgfoid=to_regprocedure(tr.func)',
    'c.relacl','p.proacl',"proconfig=array['search_path=pg_catalog']",'pg_policy');
  assert.equal((clean.match(/^grant execute on function /gm)||[]).length,2);
  has(sql,'faolla_update_merchant_enterprise_employee_v1(jsonb) to service_role','faolla_attendance_account_suspensions_v1(jsonb,uuid,jsonb,boolean) to service_role',
    'i.indisvalid and i.indisready and i.indislive',"a.amname='btree'","pg_get_expr(i.indpred,i.indrelid)='paused'");
});
