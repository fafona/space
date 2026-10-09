//204 static proofs only. Does not start PostgreSQL, run migrations or use data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const name='202610060171_merchant_attendance_plan_posthoc_adoption.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const a=sql.indexOf('create or replace function public.faolla_attendance_plan_posthoc_'+name+'_v1('),b=sql.indexOf('\n$$;',a);assert(a>=0&&b>a);return sql.slice(a,b+4);};
const includes=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const order=(s,...parts)=>{let at=-1;for(const p of parts){const next=s.indexOf(p,at+1);assert(next>at,p);at=next;}};
const ref=fn('reference'),command=fn('command'),missing=fn('missing'),operation=fn('operation'),preview=fn('preview'),rpc=fn('adoption');

test('171 passes migration gate and creates only six new functions and two scoped tables',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),
    ['reference','command','missing','operation','preview','adoption'].map(n=>'faolla_attendance_plan_posthoc_'+n+'_v1'));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(m=>m[1]),
    ['merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims']);
  assert.doesNotMatch(sql,/disable trigger|pg_get_functiondef|execute\s+replace\(|set_config\(|current_setting\(/i);
  includes(sql,"values(202610060171,'merchant_attendance_plan_posthoc_adoption') on conflict(version) do nothing","notify pgrst, 'reload schema';\ncommit;");
  order(sql,'create table if not exists public.merchant_attendance_plan_posthoc_operations','create or replace function public.faolla_attendance_plan_posthoc_operation_v1');
});

test('strict command and reference ABI has no event invention and bounded explicit empty apply',()=>{
  includes(ref,"array['kind','startEventId','lastEventId','lastSequence','effectOperationId','effectRevision']","array['kind','requestId','rootRequestId','approvalOperationId']",
    "p->'effectOperationId'='null'::jsonb and p->'effectRevision'='null'::jsonb","p->>'requestId'<>p->>'approvalOperationId'");
  includes(command,"array['action','operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','sources','reason']",
    "jsonb_array_length(p->'sources')>10","public.faolla_attendance_group_text_v1(p->>'reason',1,1000)",'if k=any(keys) then return false',">16384");
  assert.doesNotMatch(command,/jsonb_array_length\(p->'sources'\)\s*(?:<|=)\s*0/);
});

test('append-only operations and unique current projection cannot mutate any old facts',()=>{
  includes(sql,'primary key(merchant_id,kind,source_id)','unique(merchant_id,slot_id,revision)',
    'references public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)',
    'before update or delete on public.merchant_attendance_plan_posthoc_operations',
    'before truncate on public.merchant_attendance_plan_posthoc_operations');
  const targets=[...sql.matchAll(/\b(?:insert into|delete from|update)\s+public\.([a-z0-9_]+)/g)].map(m=>m[1]);
  assert(targets.every(t=>['merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims','faolla_schema_migrations'].includes(t)));
  order(rpc,'insert into public.merchant_attendance_plan_posthoc_operations','delete from public.merchant_attendance_plan_posthoc_claims','insert into public.merchant_attendance_plan_posthoc_claims');
});

test('merchant/settings/worker/employee lock order precedes current identity and replay checks',()=>{
  order(rpc,'from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'select * into saved from public.merchant_attendance_plan_posthoc_operations');
  includes(rpc,'row(saved.worker_id,saved.slot_id,saved.case_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_auth_user_id)',
    'row(wid,sid,c.case_id,e.id,e.auth_user_id,p_auth_user_id)',"saved.command is distinct from p_command then raise exception 'attendance_operation_conflict'");
});

test('GET recovery and exact retry never recollect source or enforce later pause and unknown recovery is explicit404',()=>{
  order(rpc,'if saved.operation_id is not null then','receipt:=jsonb_build_object',
    'if receipt is null and p_command is not null then',"if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused'",
    "if not w.active or e.status<>'active' then raise exception 'attendance_worker_changed'");
  includes(rpc,"elsif mode_name='recover' then raise exception 'attendance_plan_posthoc_adoption_not_found'",
    "elsif receipt is null and mode_name='detail' then",'p_allow_write boolean default false','if p_auth_user_id=e.auth_user_id');
});

test('apply consumes complete preview with exact CAS; selected snapshots cannot overlap or replace137 associations',()=>{
  order(rpc,"p_command->'expectedRevision' is distinct from to_jsonb(revision_no)",
    'preview:=public.faolla_attendance_plan_posthoc_preview_v1',"p_command->>'expectedFingerprint' is distinct from preview->>'fingerprint'",
    "preview->>'eligible' is distinct from 'true'","value->'reference'=x","item->>'available' is distinct from 'true'");
  includes(rpc,"if c.case_id is null then raise exception 'attendance_plan_posthoc_adoption_blocked'",
    "x->'reference'<>y->'reference'","preview->'source'->'basis'->'sessions'",'selected:=selected||jsonb_build_array(item)');
});

test('one final release is reserved and revoke uses saved fingerprint without broken-source recollection',()=>{
  includes(rpc,"revision_no>=100 or p_command->>'action'='apply' and revision_no>=99",
    "if head.action is distinct from 'apply'", "p_command->>'expectedFingerprint' is distinct from head.source_fingerprint");
  const revoke=rpc.slice(rpc.indexOf("if p_command->>'action'='revoke' then"),rpc.indexOf('preview:=public.faolla_attendance_plan_posthoc_preview_v1'));
  assert.doesNotMatch(revoke,/perform public\.faolla_attendance_plan_exception|preview_v1\(/);
  includes(operation,"previous.action is distinct from 'apply'","p.sources<>'[]'::jsonb or p.selected<>'[]'::jsonb or p.approval is not null",
    'p.source_fingerprint is distinct from previous.source_fingerprint');
});

test('all old and new selected/original spans plus normalized plan UTC6 protect sealed periods',()=>{
  includes(rpc,"to_char(slot_row.start_at at time zone 'UTC',fmt)","to_char(slot_row.end_at at time zone 'UTC',fmt)",
    "jsonb_array_elements(coalesce(head.selected,'[]'::jsonb)||selected)","jsonb_build_array(x->'selected')","jsonb_build_array(x->'original')");
  includes(preview,"to_char(plan_begin at time zone 'UTC',fmt)","to_char(plan_end at time zone 'UTC',fmt)","if failure='attendance_period_sealed' then cf:=array_append(cf,'sealed')");
});

test('candidate session proof independently fixes historical dualidentity tail and effect; unknown cannot enable empty apply',()=>{
  includes(preview,'faolla_attendance_period_session_v1(site,wid,ref_source_id,employee,member_auth,observed)',
    "'lastEventId',last_event->'id','lastSequence',last_event->'sequence'","'effectOperationId',effect->'operationId','effectRevision',effect->'revision'",
    "cf:=array_append(cf,'identity_unproven');flags:=array_append(flags,'context_unknown')",
    "case when relation_id=sid then 'already_associated' else 'associated_elsewhere' end");
  assert.doesNotMatch(sql,/create or replace function public\.faolla_attendance_(?:plan_exception_source|period_source|self_schedule|plan_rule)_v/);
  includes(preview,'select e.location_id,e.time_zone into location_id,zone_name','merchant_attendance_plan_posthoc_claims.source_id=ref_source_id');
});

test('PLpgSQL comparison CASE expression is parenthesized independently of IF END tokens',()=>{
  includes(preview,"or selected is distinct from (case when effect is null then original else jsonb_build_object('startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt') end) then");
  assert.doesNotMatch(sql,/is\s+(?:not\s+)?distinct\s+from\s+case\b/i);
});

test('six function scopes never reuse a declared variable as a SQL relation alias',()=>{
  includes(rpc,"jsonb_array_elements(history) history_rows(value) where (history_rows.value->>'recordedAt')::timestamptz>read_at");
  for(const name of ['reference','command','missing','operation','preview','adoption']){
    const body=fn(name),declarations=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
    const locals=new Set([...declarations.matchAll(/(?:\bdeclare|;)\s*([a-z_][a-z0-9_]*)\s+(?:public\.[a-z0-9_]+%rowtype|jsonb|text|uuid|record|integer|bigint|boolean|numeric|timestamptz)\b/g)].map(m=>m[1]));
    const aliases=[...body.matchAll(/\b(?:from|join)\s+(?:public\.[a-z0-9_]+|jsonb_array_elements\([^;\n]*?\)|jsonb_each\([^;\n]*?\))\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]);
    for(const alias of aliases.filter(n=>!['where','order','limit','for','loop','on'].includes(n))) assert(!locals.has(alias),`${name}: local and SQL alias ${alias}`);
  }
  assert.doesNotMatch(sql,/#variable_conflict|plpgsql\.variable_conflict/i);
});

test('current missing and local incoming/outgoing/pending edges reject wrong identities, approval roots and temporal links',()=>{
  includes(missing,'s.supersedes_request_id=p_request limit 2','check_ids:=array[p_request]||approved||pending',
    'row(b.worker_id,b.employee_id,b.actor_auth_user_id) is distinct from row(p_worker,p_employee,p_auth)',
    'b.root_request_id is distinct from coalesce(parent.root_request_id,parent.request_id)',
    'b.supersedes_operation_id is distinct from pa.operation_id','pa.recorded_at>=b.submitted_at','terminal.recorded_at<b.submitted_at',
    "array['action','operationId','requestId','expectedRevision','evidenceToken','reason']",
    "'pending',pending_child,'current',is_current");
  assert.doesNotMatch(missing,/\buser_id=p_auth|root_request_id\s*=\s*r\.root_request_id|with recursive/i);
  includes(preview,"proof->'current' is distinct from compact->'isCurrentApproved'","if not(proof->>'current')::boolean then continue",
    "cf:=array_append(cf,'pending_missing');flags:=array_append(flags,'pending_missing')");
});

test('moved-out pending correction and revision are checked against root streams, not only proposed interval',()=>{
  const local=preview.slice(preview.indexOf('for pending_ref in'),preview.indexOf('else\n      proof:=public.faolla_attendance_plan_posthoc_missing'));
  includes(local,'ce.start_event_id=ref_source_id','tail.revision>ce.revision','decision.request_id=ce.request_id',
    'base.start_event_id=ref_source_id','tail.revision>rr.revision','decision.request_id=rr.request_id',
    'row(pending_ref.employee_id,pending_ref.actor_auth_user_id) is distinct from row(employee,member_auth)',"flags:=array_append(flags,'pending_correction')");
  assert.doesNotMatch(local,/plan_begin|plan_end/);
});

test('canonical preview preserves original159 basis and fixed pre-plan140, no observation hashing or fabricated approval',()=>{
  includes(preview,'faolla_attendance_plan_exception_source_legacy_v1(p_query,p_auth_user_id)',
    'faolla_attendance_work_arrangement_context_v1(site,wid,employee,member_auth,plan_begin,plan_end)',
    'faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,approval_id)',
    "'protocol','posthoc-adoption-preview-v1','basis',basis,'caseId',c.case_id,'caseRevision',case_revision",
    "'revision',p_revision,'currentOperationId',p_current,'candidates',candidates,'approval',approval,'blockers',blocks",
    "source_text:=source::text","encode(sha256(convert_to(source_text,'UTF8')),'hex')");
  assert.doesNotMatch(preview,/faolla_attendance_plan_rule_approvals_v1|faolla_attendance_plan_exception_source_v1\(/);
  const canonical=preview.slice(preview.indexOf('source:=jsonb_build_object'),preview.indexOf('source_text:=source::text'));
  assert.doesNotMatch(canonical,/readAt|observed|clock_timestamp/);
});

test('bounded canonical/raw/history storage plus private ACL are explicit, no silent truncation',()=>{
  includes(preview,'count_sources>100','event_count>2002',">1048576 then raise exception 'attendance_plan_posthoc_adoption_too_large'");
  includes(rpc,'order by revision desc limit 25',"'historyTruncated',revision_no>25",">2097152 then raise exception 'attendance_plan_posthoc_adoption_too_large'");
  includes(sql,"octet_length(convert_to(selected::text,'UTF8'))<=131072",'enable row level security',
    'grant execute on function public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean) to service_role',
    "aclexplode(acldefault('r',c.relowner))",'has_table_privilege(r,t,priv)');
  for(const n of ['reference','command','missing','operation','preview']) assert.match(sql,new RegExp('revoke all on function public\\.faolla_attendance_plan_posthoc_'+n+'_v1\\([^;]+from public,anon,authenticated,service_role;'));
});
