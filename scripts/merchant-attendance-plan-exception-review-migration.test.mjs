// Static contracts only; these are not PostgreSQL, concurrency or user-path proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050147_merchant_attendance_plan_exception_review.sql';
const source=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=source.replace(/--[^\n]*/g,'');
const name=part=>'faolla_attendance_plan_exception_review'+(part?'_'+part:'')+'_v1';
function body(part='') {
  const start=sql.indexOf('create or replace function public.'+name(part)+'(');
  assert(start>=0);return sql.slice(start,sql.indexOf('$$;',start)+3);
}
const rpc=body();
const includes=(value,...parts)=>{for(const part of parts)assert(value.includes(part),part);};
const ordered=(value,...parts)=>{let at=-1;for(const part of parts){const next=value.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('147 adds four new functions and exactly three append-only tables, never modifies old business storage',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),['command','evidence','entry',''].map(name));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.(\w+)/g)].map(x=>x[1]),
    ['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads']);
  for(const hit of sql.matchAll(/\b(?:insert into|alter table|references)\s+public\.(\w+)/g))
    assert(hit[1]==='faolla_schema_migrations'||hit[1].startsWith('merchant_attendance_plan_exception_'),hit[1]);
  assert.doesNotMatch(sql,/\b(?:drop|delete from|truncate table|create extension)\b/i);
  assert.doesNotMatch(rpc,/faolla_attendance_(?:leave|revision|correction|missing|self|pin|onsite|location).*_v\d\(/);
});
test('dependency, reapply and partial-install checks precede new objects',()=>{
  includes(sql,"version=202610050146 and name='merchant_attendance_plan_exception_source'",
    "installed<>(to_regclass('public.'||t) is not null)","installed<>(to_regprocedure(p) is not null)",
    "version=202610050147 and name<>'merchant_attendance_plan_exception_review'");
  ordered(sql,'$plan_exception_review_prerequisites$;','create or replace function');
  includes(sql,'attendance_plan_exception_first_entry_fk','deferrable initially deferred');
  includes(sql,"f.proname='faolla_attendance_plan_exception_review_entry_v1'","if installed then\n    if to_regprocedure(");
  includes(sql,"f.pronamespace=(select pronamespace from pg_proc where oid=to_regprocedure('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)'))");
  assert.doesNotMatch(sql,/ns\.nspname\s*=\s*'public'/);
});
test('wire query and three command kinds are exact and reject client source or actor overrides',()=>{
  includes(rpc,"array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']",
    "mode_name='decide' and access_name<>'owner'", "mode_name in('note','ack') and access_name<>'self'",
    "(mode_name='detail')<>(op is null)","p_command->>'operationId' is distinct from op::text");
  includes(body('command'),"mode_name is null", "array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','outcome','note']",
    "array['operationId','expectedRevision','decisionOperationId','note']", "array['operationId','decisionOperationId']",
    "faolla_attendance_group_text_v1(p->>'note',1,500)");
  assert.doesNotMatch(rpc,/p_command->(?:>)?'(?:source|candidate|actorId|timeZone|readAt|rules)'/);
});
test('original actor and command recovery occurs before new-write pause, source work and quotas',()=>{
  ordered(rpc,'select * into saved from public.merchant_attendance_plan_exception_entries',
    'saved.actor_auth_user_id<>p_auth_user_id','saved.command is distinct from p_command',
    'if not p_allow_write or not s.enabled',"source_result:=public.faolla_attendance_plan_exception_source_v1(",
    'if n>=5000');
  includes(rpc,'saved_read.command is distinct from p_command','saved.operation_id is not null and saved_read.operation_id is not null',
    'saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth');
});
test('146 is invoked only once in owner detail or fresh decide and never by an impersonated owner',()=>{
  assert.equal((rpc.match(/:=public\.faolla_attendance_plan_exception_source_v1\(/g)||[]).length,1);
  includes(rpc,"access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null)",
    "jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id)",
    "current_item:=source_result-'sourceText'","case when checked then 'checked' else 'not_checked' end",'case when checked then stale else null end');
  assert.doesNotMatch(rpc,/select\s+user_id\s+into/i);
});
test('identity and self-view permission are checked before receipt lookup and no new role is invented',()=>{
  ordered(rpc,'from public.merchants where','from public.merchant_attendance_settings where',
    "if access_name='self' then", "'attendance.self.view'=any(r.permissions)",'if op is not null then');
  includes(rpc,"e.status<>'active'","r.status<>'active'",'c.employee_id is distinct from current_employee',
    'c.employee_auth_user_id is distinct from current_auth',"mode_name='decide' and p_auth_user_id=current_auth");
  assert.doesNotMatch(rpc,/insert into public\.merchant_enterprise_roles|update public\.merchant_enterprise_roles/);
});
test('only new lock namespace and case locks serialize cross-table IDs, CAS and coherent history',()=>{
  includes(rpc,"'faolla:attendance-plan-exception-review:v1:'||site",'where merchant_id=site and slot_id=sid for share;',
    'where merchant_id=site and slot_id=sid for update;',"(p_command->>'expectedRevision')::bigint<>head",
    'case_id=coalesce(saved.case_id,saved_read.case_id) for share;');
  assert.doesNotMatch(rpc,/merchant_attendance_(?:settings|workers|locations).*for update/);
  ordered(rpc,"if p_command is not null then perform pg_advisory_xact_lock",'if mode_name<>\'list\' then');
});
test('new confirmed or excused outcome requires eligible actual triggered candidate and exact source CAS',()=>{
  includes(rpc,"source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint'",
    "p_command->>'outcome'<>'follow_up'", "source_result->>'eligible' is distinct from 'true'",
    "source_result->'candidate'->'late'->>'state'='triggered'", "source_result->'candidate'->'early'->>'state'='triggered'",
    "raise exception 'attendance_plan_exception_review_blocked'");
  includes(body('entry'),"p.command->>'outcome'<>'follow_up'","p.evidence->'candidate'->'late'->>'state'='triggered'");
});
test('compact evidence preserves operation/version dependencies, exact microseconds and no raw sourceText',()=>{
  includes(body('evidence'),"array['policy','fingerprint','observedAt','eligible','blockers','candidate','approval','sessions','contextRefs']",
    "array['startEventId','lastEventId','lastSequence','effectOperationId']", "array['entryId','operationId','revision']",
    "array['kind','requestId','operationId','revision','startEventId']",'*60000000',"'stamp6'",'current_key<=previous');
  includes(rpc,"'contextRefs',refs-'sessions'","nullif(source_result->'source'->'approval','null'::jsonb)-'source'",
    "latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint'");
  assert.doesNotMatch(body('evidence'),/valid_zone|at time zone|day_start|day_boundary/);
});
test('new notes reference the current owner decision and advance shared case revision without changing evidence',()=>{
  includes(rpc,"mode_name='note'", "p_command->>'decisionOperationId' is distinct from latest.operation_id::text",
    "case mode_name when 'decide' then 'decision' else 'note' end", "case when mode_name='decide' then evidence else null end");
  includes(body('entry'),'p.actor_auth_user_id<>p.employee_auth_user_id',"target.kind is distinct from 'decision'",'target.revision>=p.revision');
  ordered(rpc,'saved.command is distinct from p_command',
    'if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then',
    "if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;");
  includes(rpc,"'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active");
});
test('explicit ack is immutable and exact original ID, not agreement or a second successful number',()=>{
  includes(sql,'unique(merchant_id,decision_operation_id)',"faolla_attendance_plan_exception_review_command_v1('ack',command)");
  includes(rpc,'saved_read.command is distinct from p_command',"raise exception 'attendance_operation_conflict'",
    "'actorId',saved_read.employee_auth_user_id", "'readAt',to_char(saved_read.read_at");
  assert.doesNotMatch(rpc,/on conflict.*do update|update public\./i);
  includes(source,'A read ack is not','agreement.');
});
test('immutable openedAt keyset is bounded25+1 and latest history is bounded25+1',()=>{
  includes(rpc,'(x.opened_at,x.case_id)<(cursor_at,cursor_id)', 'order by x.opened_at desc,x.case_id desc limit 26 for share',
    'if row_count>25 then exit','if row_count<=25 then next_cursor:=null',
    'order by revision desc limit 26','if row_count>25 then history_truncated:=true',
    "public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence'");
  assert.doesNotMatch(rpc,/\boffset\b|\bdelete\b/i);
});
test('finite new storage and response bounds reject without deleting or rewriting older receipts',()=>{
  includes(rpc,'n>=5000','>67108864','head>=200','n>=500',')>=100',
    "octet_length(convert_to(evidence::text,'UTF8'))>131072","octet_length(convert_to(result::text,'UTF8'))>1048576",
    'convert_to(x.evidence::text',"raise exception 'attendance_plan_exception_review_limit'");
  assert.doesNotMatch(rpc,/exception when others|\btruncate\b|delete from/i);
});
test('service-only RPC, fully private helpers and immutable RLS tables are verified after install',()=>{
  assert.equal((sql.match(/grant execute on function/g)||[]).length,1);
  includes(sql,'grant execute on function public.'+name('')+'(jsonb,uuid,jsonb,boolean) to service_role;',
    'before update or delete','before truncate','enable row level security',"aclexplode(coalesce(cls.relacl,acldefault('r',cls.relowner)))",
    "has_function_privilege(role_name,p,'EXECUTE')",'merchant_attendance_plan_exception_review_acl_postcondition_failed');
});
