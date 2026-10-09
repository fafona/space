//202 static migration/compatibility proofs. Never starts PostgreSQL/browser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610060170_merchant_attendance_plan_clearance.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),old147=read('202610050147_merchant_attendance_plan_exception_review.sql'),old159=read('202610060159_merchant_attendance_work_arrangement_exceptions.sql');
const fn=(s,name)=>{const a=s.indexOf('create or replace function public.'+name+'('),b=s.indexOf('\n$$;',a);assert(a>=0&&b>a,name);return s.slice(a,b+4);};
const one=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,()=>b);};
const has=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const order=(s,parts)=>{let i=-1;for(const p of parts){const j=s.indexOf(p,i+1);assert(j>i,p);i=j;}};
const commandName='faolla_attendance_plan_exception_review_command_v1',entryName='faolla_attendance_plan_exception_review_entry_v1';
const oldName='faolla_attendance_plan_exception_review_v1',newName='faolla_attendance_plan_exception_clearance_v1',engineName='faolla_attendance_plan_exception_clearance_execute_v1';
const command=fn(sql,commandName),entry=fn(sql,entryName),engine=fn(sql,engineName);

test('170 is an additive guarded migration replacing only three approved functions and adding two explicit RPC/engine functions',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),[commandName,entryName,engineName,oldName,newName]);
  assert.doesNotMatch(sql,/create table|create index|disable trigger|pg_get_functiondef|execute\s+replace\(|current_setting\(|set_config\(/i);
  has(sql,"version=202610050147 and name='merchant_attendance_plan_exception_review'",
    "version=202610060158 and name='merchant_attendance_work_arrangement_periods'","version=202610060159 and name='merchant_attendance_work_arrangement_exceptions'",
    "version=202610060169 and name='merchant_attendance_event_notifications'","values(202610060170,'merchant_attendance_plan_clearance') on conflict(version) do nothing",
    "pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)","notify pgrst, 'reload schema';\ncommit;");
});

test('shared147 strict command changes only the new enum and forbids cleared revision0 without relaxing other commands',()=>{
  const restored=one(command,"p->>'outcome' in('confirmed','excused','follow_up','cleared')\n      and (p->>'outcome'<>'cleared' or (p->>'expectedRevision')::bigint>=1);",
    "p->>'outcome' in('confirmed','excused','follow_up');");
  assert.equal(restored,fn(old147,commandName));
  has(command,"array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','outcome','note']",
    "p->'expectedRevision','head'",'public.faolla_attendance_group_text_v1(p->>\'note\',1,500)');
});

test('saved cleared evidence must be eligible and both configured rules not_triggered at revision2 or later',()=>{
  has(entry,"p.command->>'outcome'='cleared' and (p.revision<2 or p.evidence->>'eligible' is distinct from 'true'",
    "p.evidence->'candidate'->'late'->>'state' is distinct from 'not_triggered'",
    "p.evidence->'candidate'->'early'->>'state' is distinct from 'not_triggered'",
    'public.faolla_attendance_plan_exception_review_evidence_v1(p.evidence) is distinct from true',
    'p.employee_auth_user_id is distinct from c.employee_auth_user_id','previous.recorded_at>p.recorded_at');
  let restored=one(entry,"or p.command->>'outcome' in('confirmed','excused') and","or p.command->>'outcome'<>'follow_up' and");
  restored=one(restored,"or p.evidence->'candidate'->'early'->>'state'='triggered'))\n      or p.command->>'outcome'='cleared' and (p.revision<2 or p.evidence->>'eligible' is distinct from 'true'\n        or p.evidence->'candidate'->'late'->>'state' is distinct from 'not_triggered'\n        or p.evidence->'candidate'->'early'->>'state' is distinct from 'not_triggered') then",
    "or p.evidence->'candidate'->'early'->>'state'='triggered')) then");
  assert.equal(restored,fn(old147,entryName));
});

test('private engine is exact159 body apart from approved clearance gate, predicate and fresh capture additions',()=>{
  let restored=one(engine,
    `create or replace function public.${engineName}(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_allow_clearance boolean,p_capture_notifications boolean)`,
    `create or replace function public.${oldName}(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)`);
  restored=one(restored,'returns jsonb language plpgsql volatile set search_path=pg_catalog as $$','returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$');
  restored=one(restored,'current_auth uuid;capture_new_decision boolean:=false;','current_auth uuid;');
  restored=one(restored,'if p_auth_user_id is null or p_allow_write is null or p_allow_clearance is null or p_capture_notifications is null','if p_auth_user_id is null or p_allow_write is null');
  restored=one(restored,`    --Only the explicit new RPC can authorize a fresh clearance. This is after
    --locked original-receipt resolution, before current-source collection.
    if mode_name='decide' and p_command->>'outcome'='cleared' then
      if not p_allow_clearance then raise exception 'attendance_plan_exception_clearance_disabled';end if;
      if c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1 then
        raise exception 'attendance_plan_exception_review_blocked';end if;
    end if;
`,'');
  restored=one(restored,"      if p_command->>'outcome' in('confirmed','excused') and","      if p_command->>'outcome'<>'follow_up' and");
  restored=one(restored,`      if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'
        or source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'
        or source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered') then
        raise exception 'attendance_plan_exception_review_blocked';end if;
`,'');
  restored=one(restored,'latest:=saved;stale:=false;capture_new_decision:=p_capture_notifications;','latest:=saved;stale:=false;');
  restored=one(restored,`  --Set only by the actual new decision INSERT. Reads and exact retries never
  --infer freshness from a missing notification, even after rollout changes.
  if capture_new_decision then
    perform public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command);
  end if;
`,'');
  assert.equal(restored,fn(old159,oldName));
});

test('legacy and169 wrapper cannot bypass disabled fresh clearance while the new RPC uses explicit booleans',()=>{
  assert.equal(fn(sql,oldName),`create or replace function public.${oldName}(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
  return public.${engineName}(p_query,p_auth_user_id,p_command,p_allow_write,false,false);
end;
$$;`);
  has(fn(sql,newName),'p_allow_clearance boolean default false,p_capture_notifications boolean default false',
    `${engineName}(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications)`);
  has(read('202610060169_merchant_attendance_event_notifications.sql'),
    'result:=public.faolla_attendance_plan_exception_review_v1(p_query,p_auth_user_id,p_command,p_allow_write)');
});

test('receipt and full current authorization precede fresh gates, and the established159 lock order is retained',()=>{
  order(engine,['from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for share',
    "if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0))",
    'where merchant_id=site and slot_id=sid for update','select * into saved from public.merchant_attendance_plan_exception_entries',
    'saved.command is distinct from p_command','if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then',
    "if not p_allow_write or not s.enabled",'attendance_plan_exception_clearance_disabled',
    'if c.case_id is null or head<1',"(p_command->>'expectedRevision')::bigint<>head",
    'source_result:=public.faolla_attendance_plan_exception_source_v1']);
  has(engine,'e.auth_user_id is null','c.employee_auth_user_id is distinct from current_auth',
    "if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied'",
    'saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth');
});

test('fresh cleared requires exact source fingerprint and two not_triggered states, preserving old outcome eligibility',()=>{
  order(engine,["source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint'",
    "if p_command->>'outcome' in('confirmed','excused')", "if p_command->>'outcome'='cleared' and (source_result->>'eligible' is distinct from 'true'",
    "source_result->'candidate'->'late'->>'state' is distinct from 'not_triggered'",
    "source_result->'candidate'->'early'->>'state' is distinct from 'not_triggered'", "refs:='{}'"]);
  has(engine,"source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered'",
    'source_result->>\'sourceText\' is distinct from (source_result->\'source\')::text',
    "encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex')");
});

test('capture occurs only after an actual new decision INSERT and remains atomic without retries/backfill',()=>{
  order(engine,['insert into public.merchant_attendance_plan_exception_entries',
    'returning * into saved','capture_new_decision:=p_capture_notifications',
    "octet_length(convert_to(result::text,'UTF8'))>1048576",'if capture_new_decision then',
    "public.faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command)",'return result;']);
  assert.equal((engine.match(/capture_new_decision:=/g)||[]).length,1);
  assert.doesNotMatch(engine,/from public\.merchant_attendance_event_notifications|on conflict|exception when|check_violation/);
});

test('notification CHECK retains all old categories and only admits later cleared while reentry preserves constraint identity',()=>{
  const block=sql.slice(sql.indexOf('do $plan_clearance_notification_constraint$'),sql.indexOf('$plan_clearance_notification_constraint$;')+42);
  order(block,["if not exists(select 1 from pg_constraint",'add constraint attendance_event_notification_outcome_v2',
    'validate constraint attendance_event_notification_outcome_v2','drop constraint merchant_attendance_event_notifications_check']);
  has(block,"source_category='schedule' and event_type in('published','cancelled') and source_revision is null",
    "source_category='work_arrangement' and source_revision is not null", "event_type in('approved','rejected') and source_revision=2",
    "event_type='approval_cancelled' and source_revision=3", "source_category='plan_exception' and source_revision is not null",
    "event_type in('confirmed','excused','follow_up') or event_type='cleared' and source_revision>=2");
  has(sql,"cardinality(columns) is distinct from 3",'old_check.contype<>\'c\' or not old_check.convalidated',
    '(select array_agg(k order by k) from unnest(old_check.conkey) k) is distinct from columns',
    'new_check.contype<>\'c\' or not new_check.convalidated',
    '(select array_agg(k order by k) from unnest(new_check.conkey) k) is distinct from columns');
});

test('158 source and169 notice helpers consume shared cleared history without replacing either source algorithm or reducing blockers',()=>{
  const period=read('202610060158_merchant_attendance_work_arrangement_periods.sql'),notice=read('202610060169_merchant_attendance_event_notifications.sql');
  has(period,'item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row)',
    "if access_name='self' then flags:=array_append(flags,'unresolved_review')",
    "if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision",
    "or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review')",
    "array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']");
  has(notice,'perform public.faolla_attendance_plan_exception_review_entry_v1(decision)',"kind:=decision.command->>'outcome'",
    "'timeZone',case_row.time_zone,'outcome',kind", "'summary',p.summary");
  assert.doesNotMatch(sql,/create or replace function public\.faolla_attendance_(?:period_|event_notification_|plan_exception_source)/);
});

test('saved body, quotas, employee notes and business acknowledgement retain159 semantics',()=>{
  has(engine,"if n>=5000",'67108864 or head>=200',"if n>=500 or (select count(*)",'worker_id=wid)>=100',
    "if mode_name='ack' then",'insert into public.merchant_attendance_plan_exception_reads',
    "if mode_name='decide' then latest:=saved;stale:=false",'current_item:=source_result-\'sourceText\'',
    "if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint'");
  assert.doesNotMatch(sql,/update public\.|delete from public\.|insert into public\.merchant_attendance_(?:events|correction|missing|period_closure)/);
});

test('private engine cannot be called by service role and no new employee or manager privileges are granted',()=>{
  assert.doesNotMatch(engine,/security definer/);
  has(sql,`revoke all on function public.${engineName}(jsonb,uuid,jsonb,boolean,boolean,boolean) from public,anon,authenticated,service_role`,
    "foreach r in array array['anon','authenticated','service_role'] loop", "if has_function_privilege(r,f,'EXECUTE') then raise exception 'merchant_attendance_plan_clearance_acl_postcondition_failed'");
  assert.deepEqual([...sql.matchAll(/grant execute on function public\.([a-z0-9_]+)/g)].map(m=>m[1]),[oldName,newName]);
  assert.doesNotMatch(sql,/merchant_enterprise_roles[^;]+(?:update|insert)|grant .*to authenticated|grant .*to anon|grant .*to public/i);
});
