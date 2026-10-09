//205 static migration/ABI regression checks, never a PostgreSQL acceptance run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610060172_merchant_attendance_plan_posthoc_evaluation.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const a=sql.indexOf('create or replace function public.faolla_attendance_plan_posthoc_'+name+'_v1('),b=sql.indexOf('\n$$;',a);assert(a>=0&&b>a);return sql.slice(a,b+4);};
const observation=fn('observation'),rpc=fn('evaluation');
const has=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const ordered=(s,...parts)=>{let a=-1;for(const p of parts){const b=s.indexOf(p,a+1);assert(b>a,p);a=b;}};

test('172 registers two new functions only and does not replace or write any old or new business ledger',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),
    ['faolla_attendance_plan_posthoc_observation_v1','faolla_attendance_plan_posthoc_evaluation_v1']);
  assert.doesNotMatch(sql,/create table|create index|alter table|disable trigger|pg_get_functiondef|execute\s+replace\(|set_config\(|current_setting\(/i);
  assert.doesNotMatch(observation+rpc,/\b(insert into|update public\.|delete from|truncate)\b/i);
  has(sql,"version=202610060171 and name='merchant_attendance_plan_posthoc_adoption'",
    "values(202610060172,'merchant_attendance_plan_posthoc_evaluation') on conflict(version) do nothing","notify pgrst, 'reload schema';\ncommit;");
});

test('exact3 query delegates authorization and lock ordering to171 with null command and false allow',()=>{
  has(rpc,"array['siteId','workerId','slotId']","p_query->'workerId','uuid'","p_query->'slotId','uuid'",'>4096',
    "faolla_attendance_plan_posthoc_adoption_v1(p_query||jsonb_build_object('mode','detail','operationId',null),p_auth_user_id,null,false)",
    "baseline->>'actorId' is distinct from p_auth_user_id::text",'row(wid,sid,employee,member_auth)');
  ordered(rpc,'baseline:=public.faolla_attendance_plan_posthoc_adoption_v1',
    'select * into saved_operation from public.merchant_attendance_plan_posthoc_operations','for snapshot in select source_rows.value');
  assert.doesNotMatch(rpc,/merchants\.user_id|p_auth_user_id\s*:=|allow_write\s*:=\s*true/);
});

test('saved current operation and selected snapshots remain explicit, revoked and absent heads are inactive',()=>{
  has(rpc,"'revision',baseline->'revision','current',baseline->'current'","'selected',coalesce(saved_operation.selected,'[]'::jsonb),'approval',saved_operation.approval",
    "if saved_operation.action is distinct from 'apply' then flags:=array_append(flags,'posthoc_inactive')",
    'faolla_attendance_plan_posthoc_operation_v1(saved_operation)',"jsonb_array_length(saved_operation.selected)>10");
  assert.doesNotMatch(rpc,/source_fingerprint\s*(?:=|<>)|sourceFingerprint.*fingerprint/);
});

test('source exact7 and raw9 hash complete facts only, with unchanged basis and no derived geometry/clock in canonical',()=>{
  has(rpc,"basis:=baseline->'preview'->'source'->'basis'",
    "'protocol','posthoc-evaluation-evidence-v1','basis',basis,'posthoc',posthoc_item,'observations',observations",
    "'approval',approval_item,'leave',leave_context,'resolutionBlockers',resolution_blockers",
    "'protocol','plan-posthoc-evaluation-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item",
    "'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'sourceText',source_text,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex')");
  const canonical=rpc.slice(rpc.indexOf('source:=jsonb_build_object'),rpc.indexOf('source_text:=source::text'));
  assert.doesNotMatch(canonical,/readAt|clock_timestamp|caseRevision|preview.*fingerprint|eligible|leaveEdges|candidate/);
});

test('each saved session is re-read by immutable startID and includes current tail/effect even outside plan',()=>{
  has(observation,"reference_id:=(saved_ref->>'startEventId')::uuid",
    'faolla_attendance_period_session_v1(p_site,p_worker,reference_id,p_employee,p_auth,p_observed)',
    "'lastEventId',last_event->'id','lastSequence',last_event->'sequence'",
    "'effectOperationId',effect->'operationId','effectRevision',effect->'revision'",
    "'startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt'",
    "span_begin>=plan_end or span_end<=plan_begin then candidate_flags:=array_append(candidate_flags,'source_outside_plan')");
  ordered(observation,'faolla_attendance_period_session_v1','span_begin>=plan_end or span_end<=plan_begin');
  has(observation,"failure='attendance_period_source_identity_unproven'", "'current',null,'blockers',jsonb_build_array('source_changed','source_unavailable')");
});

test('missing replacement is observed via indexed root current view without worker/date prefilter or recursive history limit',()=>{
  const lookup=observation.slice(observation.indexOf('current_ids:=array'),observation.indexOf('if cardinality(current_ids)>1'));
  has(lookup,'public.merchant_attendance_missing_current_v1 current_rows',
    'coalesce(current_rows.root_request_id,current_rows.request_id)=reference_id limit 2');
  assert.doesNotMatch(lookup,/worker_id|employee_id|auth_user_id|start_at|end_at|plan_begin|plan_end/);
  has(observation,'cardinality(current_ids)>1','faolla_attendance_plan_posthoc_missing_v1(p_site,p_worker,p_employee,p_auth,current_ids[1])',
    "proof->>'current' is distinct from 'true'","current_ref->>'rootRequestId' is distinct from reference_id::text",
    "(proof->>'pending')::boolean then candidate_flags:=array_append(candidate_flags,'pending_missing')");
  assert.doesNotMatch(observation,/with recursive/i);
});

test('moved-away pending proposals still block by latest root stream and independently recheck original Auth',()=>{
  const probes=observation.slice(observation.indexOf('for pending_row in'),observation.indexOf('else\n    reference_id:='));
  has(probes,'ce.start_event_id=reference_id','tail.revision>ce.revision','decision.request_id=ce.request_id',
    'base.start_event_id=reference_id','tail.revision>rr.revision','decision.request_id=rr.request_id',
    'row(pending_row.employee_id,pending_row.actor_auth_user_id) is distinct from row(p_employee,p_auth)',
    'pending_count>100',"candidate_flags:=array_append(candidate_flags,'pending_correction')");
  assert.doesNotMatch(probes,/plan_begin|plan_end/);
});

test('claim must remain the active head and source change ignores harmless own claim metadata but compares all source facts',()=>{
  has(observation,'row(claim_row.worker_id,claim_row.slot_id,claim_row.operation_id) is distinct from row(p_worker,(p_slot->>\'id\')::uuid,p_operation)',
    "claim_operation.action is distinct from 'apply'",
    "(candidate-array['available','blockers','claim']) is distinct from (p_saved-array['available','blockers','claim'])",
    "observation_flags:=array_append(observation_flags,'source_changed')",
    "candidate_blockers<>'[]'::jsonb then observation_flags:=array_append(observation_flags,'source_unavailable')");
  has(rpc,"observation->'blockers' ? 'source_changed'","observation->'blockers' ? 'source_unavailable'");
});

test('fixed140 is read by saved operation and byte-proven helper, never current head substituted',()=>{
  has(rpc,'compact_approval:=saved_operation.approval',
    "faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,(compact_approval->>'operationId')::uuid)",
    "(approval_item-'source') is distinct from compact_approval","else approval_item:=nullif(basis->'approval','null'::jsonb)");
  assert.doesNotMatch(rpc,/merchant_attendance_plan_rule_operations|faolla_attendance_plan_rule_approvals_v1|lateGraceMinutes|earlyGraceMinutes/);
});

test('current leave exact overlap precedes cap, identity is checked afterwards and all current terminal statuses remain',()=>{
  ordered(rpc,'requests.start_at<plan_end and requests.end_at>plan_begin','order by requests.start_at,requests.end_at,requests.request_id limit 101',
    'row(leave_row.worker_id,leave_row.employee_id,leave_row.actor_auth_user_id) is distinct from row(wid,employee,member_auth)',
    'faolla_attendance_leave_summary_v1(leave_row,null)','order by entries.revision desc limit 1');
  has(rpc,"'status',leave_summary->'status'","'current',true",
    "leave_limited:=cardinality(leave_ids)>100 or (basis->'context'->'leave'->>'limited')::boolean",
    "'limited',leave_limited,'resolved',not leave_limited,'items',leave_items",
    "baseline->'preview'->'blockers' ? 'context_unknown'");
  const scope=rpc.slice(rpc.indexOf('leave_ids:=array'),rpc.indexOf('leave_limited:='));
  assert.doesNotMatch(scope,/actor_auth_user_id|employee_id|status.*approved/);
});

test('saved original and selected spans retain seal facts, byte and source-count budgets are explicit',()=>{
  has(observation,'jsonb_build_array(selected_span)','jsonb_build_array(original_span)',"failure='attendance_period_sealed'",
    "'available',candidate_blockers='[]'::jsonb");
  has(rpc,'jsonb_array_length(saved_operation.selected)>10',">1048576 then raise exception 'attendance_plan_posthoc_evaluation_too_large'",
    ">2097152 then raise exception 'attendance_plan_posthoc_evaluation_too_large'");
  has(sql,'revoke all on function public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone) from public,anon,authenticated,service_role',
    'grant execute on function public.faolla_attendance_plan_posthoc_evaluation_v1(jsonb,uuid) to service_role');
});

test('original associated mid-event location mismatch survives compact basis without treating normal association as unavailable',()=>{
  const guard=rpc.slice(rpc.indexOf("if exists(select 1 from jsonb_array_elements(baseline->'preview'->'candidates')"),rpc.indexOf('--171 also point-checks'));
  has(guard,"candidate_rows.value->'reference'->>'kind'='session'","candidate_rows.value->'blockers' ? 'location_mismatch'",
    "jsonb_array_elements(basis->'sessions') session_rows(value)",
    "session_rows.value->>'startEventId'=candidate_rows.value->'reference'->>'startEventId'",
    "flags:=array_append(flags,'source_unavailable')");
  assert.doesNotMatch(guard,/already_associated|'available'|blockers'\s*<>/);
});

test('locked171 pending correction and missing checks remain non-relaxable even outside compact context',()=>{
  const guard=rpc.slice(rpc.indexOf("if baseline->'preview'->'blockers' ?|"),rpc.indexOf('for part in select sections.value'));
  has(guard,"baseline->'preview'->'blockers' ?| array['pending_correction','pending_missing']",
    "flags:=array_append(flags,'source_unavailable')");
  assert.doesNotMatch(guard,/saved_operation|observations|plan_begin|plan_end|basis->'context'/);
  ordered(rpc,"baseline->'preview'->'blockers' ?|",'into resolution_blockers',"'resolutionBlockers',resolution_blockers");
});

test('new SQL scopes avoid unparenthesized IF comparison CASE and local-variable relation aliases',()=>{
  assert.doesNotMatch(sql,/is\s+(?:not\s+)?distinct\s+from\s+case\b|#variable_conflict|plpgsql\.variable_conflict/i);
  for(const body of [observation,rpc]){
    const decl=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
    const locals=new Set([...decl.matchAll(/(?:\bdeclare|;)\s*([a-z_][a-z0-9_]*)\s+(?:public\.[a-z0-9_]+%rowtype|jsonb|text|uuid|record|integer|bigint|boolean|numeric|timestamptz)\b/g)].map(m=>m[1]));
    const aliases=[...body.matchAll(/\b(?:from|join)\s+(?:public\.[a-z0-9_]+|jsonb_array_elements\([^;\n]*?\)|jsonb_each\([^;\n]*?\))\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]);
    for(const alias of aliases.filter(n=>!['where','order','limit','for','loop','on'].includes(n))) assert(!locals.has(alias),alias);
  }
});
