//215 static migration contract. No database execution or environment startup.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610070179_merchant_attendance_outage_periods.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(file),old=read('202610060175_merchant_attendance_plan_posthoc_periods.sql');
const fn=(text,name)=>{const a=text.indexOf('create or replace function public.'+name+'('),b=text.indexOf('\n$$;',a);assert(a>=0&&b>a,name);return text.slice(a,b+4);};
const has=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const order=(s,...parts)=>{let last=-1;for(const p of parts){const next=s.indexOf(p,last+1);assert(next>last,p);last=next;}};
const context=fn(sql,'faolla_attendance_outage_period_context_v1'),base=fn(sql,'faolla_attendance_period_closure_source_base_v1');
const source=fn(sql,'faolla_attendance_period_closure_source_v1'),closure=fn(sql,'faolla_attendance_period_closure_v1');
const once=(text,a,b)=>{assert.equal(text.split(a).length,2,a);return text.replace(a,b);};
const clean=text=>text.split('\n').map(l=>l.replace(/--.*$/,'').trim()).filter(Boolean).join('\n');

test('179 adds one private helper and exactly three scoped replacements, without tables or business writers',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]),[
    'faolla_attendance_outage_period_context_v1','faolla_attendance_period_closure_source_base_v1',
    'faolla_attendance_period_closure_source_v1','faolla_attendance_period_closure_v1']);
  assert.doesNotMatch(sql,/create table|disable trigger|pg_get_functiondef|set_config\(|current_setting\(|create policy|drop index|reindex|concurrently/i);
  assert.doesNotMatch(context,/\b(?:insert into|update|delete from) public\./i);
  has(sql,"version=202610060175 and name='merchant_attendance_plan_posthoc_periods'","version=202610070178 and name='merchant_attendance_outage_reviews'",
    "values(202610070179,'merchant_attendance_outage_periods') on conflict(version) do nothing", "notify pgrst,'reload schema';\ncommit;");
});

test('fixed-frame base is byte-identical to175 except permitting a first saved v4 source',()=>{
  const expected=once(fn(old,'faolla_attendance_period_closure_source_base_v1'),
    "('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3')",
    "('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4')");
  assert.equal(base,expected);
});

test('executor is byte-identical to175 except the approved fresh-send gate and its explanatory comment',()=>{
  let expected=once(fn(old,'faolla_attendance_period_closure_v1'),
    "if source_result->'blockers' ? 'period_in_progress' then raise exception 'attendance_period_blocked';end if;",
    "if (source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage') then raise exception 'attendance_period_blocked';end if;");
  expected=once(expected,'-- Only ended periods enter this workflow. Other complete-source blockers\n      -- may be sent for review; sealing still requires the entire list empty.',
    '--179 also blocks relevant unresolved outage reviews before a fresh send.\n      --Other old blockers retain their old review/seal semantics.');
  assert.equal(closure,expected);
});

test('outer source preserves all old arrangement/posthoc logic and only appends outage context/canonical material',()=>{
  let expected=clean(fn(old,'faolla_attendance_period_closure_source_v1'));
  expected=once(expected,'declare result jsonb;arrangements jsonb;canonical jsonb;source_text text;',
    'declare result jsonb;arrangements jsonb;outages jsonb;canonical jsonb;source_text text;');
  expected=once(expected,"if arrangements='[]'::jsonb then return result;end if;",[
    'outages:=public.faolla_attendance_outage_period_context_v1(',
    "result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,",
    "(result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);",
    "if arrangements='[]'::jsonb and outages='[]'::jsonb then return result;end if;",
    "if arrangements<>'[]'::jsonb then"].join('\n'));
  expected=once(expected,'canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;',[ 'end if;',
    "if outages<>'[]'::jsonb then",
    "result:=jsonb_set(result,'{context,outages}',outages)||jsonb_build_object('sourceVersion','attendance-period-source-v4');",
    "if exists(select 1 from jsonb_array_elements(outages) x where x->'status'->'resolved' is distinct from 'true'::jsonb) then",
    "result:=jsonb_set(result,'{blockers}',(result->'blockers')||'[\"unresolved_outage\"]'::jsonb);",'end if;','end if;',
    'canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;'].join('\n'));
  assert.equal(clean(source),expected);
});

test('range selection is same-worker half-open UTC6, capped before checking saved identities',()=>{
  order(context,'ids:=array(select x.declaration_id','x.merchant_id=p_site and x.worker_id=p_worker',
    "x.declared_interval->>'startAt'<to_char(p_to at time zone 'UTC',fmt)",
    "x.declared_interval->>'endAt'>to_char(p_from at time zone 'UTC',fmt)",
    'order by x.declaration_id limit 101','if cardinality(ids)>100', 'if cardinality(ids)=0 then return items',
    'foreach did in array ids','row(d.worker_id,d.employee_id,d.employee_auth_user_id) is distinct from row(p_worker,p_employee,p_employee_auth)');
  const candidates=context.slice(context.indexOf('ids:=array('),context.indexOf('if cardinality(ids)>100'));
  assert.doesNotMatch(candidates,/employee_id|employee_auth_user_id|account_epochs|incident_id|review_operations/);
});

test('context uses private authorized facts, never the public review RPC or additional self permissions',()=>{
  has(context,'faolla_attendance_outage_review_basis_v1(d,w.version,e.version,generation_no,true)',
    'faolla_attendance_outage_review_entry_v1(head)',"faolla_attendance_outage_review_proposal_v1(proposal_row)-'sourceText'",
    'faolla_attendance_outage_review_entry_v1(response_row)');
  assert.doesNotMatch(context,/faolla_attendance_outage_review_v1\(|attendance\.self\.request|p_auth_user_id|user_id=p_|p_allow|s\.enabled|settings.*enabled|canWrite|canPropose|canConfirm|canResolve|readAt/);
  has(source,"(result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz");
  assert.doesNotMatch(context,/at time zone [a-z_]+\.|valid_zone|control_day_boundary|for update|for share/);
});

test('exact eleven-key context and six-key status include unreviewed declarations and current source changes',()=>{
  has(context,"revision_no:=coalesce(head.revision,0);version_no:=coalesce(head.result_version,0)",
    "current_item:=null;proposal_item:=null;response_item:=null", "'\"result_missing\"'::jsonb",
    "jsonb_build_object('declarationId',did,'workerId',d.worker_id,'employeeId',d.employee_id,'employeeAuthUserId',d.employee_auth_user_id,\n      'interval',d.declared_interval,'revision',revision_no,'resultVersion',version_no,'current',current_item,'proposal',proposal_item,'response',response_item,'status',status_item)",
    "jsonb_build_object('basisFingerprint',basis->'fingerprint','linkOperationId',basis->'linkOperationId','linkRevision',basis->'linkRevision',\n      'linkFingerprint',basis->'linkFingerprint','blockers',blocks,'resolved',is_resolved)");
  assert.doesNotMatch(context,/where.*action='resolve'|and.*action='resolve'/);
});

test('resolved exactly requires same current basis, active same identity, unpaused epoch and exact-version confirmation',()=>{
  has(context,'generation_no:=coalesce(epoch.generation,0)',"not coalesce(w.active,false) or e.status is distinct from 'active'",
    'coalesce(epoch.paused,false)',"row(basis->>'linkOperationId',basis->>'linkRevision',basis->>'linkFingerprint')",
    "basis->>'fingerprint' is distinct from proposal_row.result_fingerprint",
    "source_ready:=proposal_row.operation_id is not null and blocks='[]'::jsonb",
    "if response_row.action='dispute'", "if head.action='reopen'",
    "is_resolved:=coalesce(head.action='resolve' and source_ready and response_row.action='confirm',false)");
  order(context,"'\"result_changed\"'::jsonb",'source_ready:=',"'\"disputed\"'::jsonb",'is_resolved:=');
  has(context,"result_version=version_no and action in('confirm','dispute') order by revision desc limit 1");
});

test('saved archives and original-operation recovery still bypass current context and fresh gates',()=>{
  order(closure,'select * into saved from public.merchant_attendance_period_entries','saved.command is distinct from p_command','if p_command is not null and saved.operation_id is null then',"if action_name='send' then");
  has(closure,"if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then",
    "'attendance_period_source_invalid','attendance_period_source_too_large'",'changed:=null;',
    "source_result->>'sourceFingerprint' is distinct from a.source_fingerprint",
    "source_result->'blockers' is distinct from '[]'::jsonb then raise exception 'attendance_period_blocked'");
  assert.doesNotMatch(context,/merchant_attendance_period_(artifacts|versions|entries|closures)/);
});

test('bounded failures use existing period source errors, never truncate or silently mark resolved',()=>{
  has(context,">1048576 then raise exception 'attendance_period_source_too_large'",
    "failure in('attendance_outage_links_too_large','attendance_outage_review_too_large') then raise exception 'attendance_period_source_too_large'",
    "'attendance_outage_review_invalid','attendance_outage_review_not_found') then raise exception 'attendance_period_source_invalid'",'else raise;end if;');
  assert.doesNotMatch(context,/when others|limit 100;|return 'true'|resolved',true/);
});

test('new normal index has exact pre/post metadata checks and no timestamp cast or online-runner changes',()=>{
  assert.equal([...sql.matchAll(/create index if not exists attendance_outage_declaration_period_idx/g)].length,1);
  order(sql,'begin;',"set local lock_timeout='3s'",'$outage_period_index_preflight$;',
    'create index if not exists attendance_outage_declaration_period_idx','$outage_period_index_ready$;',
    "values(202610070179,'merchant_attendance_outage_periods')",'commit;');
  has(sql,"(merchant_id,worker_id,(declared_interval->>'startAt'),(declared_interval->>'endAt'),declaration_id)",
    'i.indisvalid and i.indisready and i.indislive',"pg_get_indexdef(idx,5,true)='declaration_id'",
    'i.indexprs is not null and i.indpred is null','i.indnatts=5 and i.indnkeyatts=5',"collname='default'",'i.indcollation[3]=i.indcollation[2]');
  const index=sql.slice(sql.indexOf('create index if not exists'),sql.indexOf('--PRIVATE:'));
  assert.doesNotMatch(index,/timestamptz|concurrently|drop|delete/i);
});

test('pre-existing ACL drift fails closed and private context is never service-callable',()=>{
  has(sql,"service_allowed:=signature<>'public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)'",
    "meta.proconfig is distinct from array['search_path=pg_catalog']::text[]",
    "meta.proargnames is distinct from array['p_site','p_worker','p_employee','p_employee_auth','p_from','p_to']::text[]",
    'meta.prosecdef or meta.proretset',"if has_function_privilege(role_name,signature,'EXECUTE') then raise exception",
    "a.privilege_type='EXECUTE' and a.grantee<>p.proowner");
  assert.deepEqual([...sql.matchAll(/grant execute on function ([^\n]+)/g)].map(x=>x[1]),[
    'public.faolla_attendance_period_closure_source_v1(jsonb,uuid) to service_role;',
    'public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role;']);
});
