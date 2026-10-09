//206 static SQL/ABI checks only, not a PostgreSQL execution claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610060173_merchant_attendance_plan_posthoc_formal_source.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const begin=sql.indexOf('create or replace function public.faolla_attendance_plan_posthoc_formal_'+name+'_v1('),end=sql.indexOf('\n$$;',begin);assert(begin>=0&&end>begin);return sql.slice(begin,end+4);};
const facts=fn('facts'),compute=fn('compute'),leave=fn('leave'),rpc=fn('source');
const has=(text,...parts)=>parts.forEach(part=>assert(text.includes(part),part));
const ordered=(text,...parts)=>{let prior=-1;for(const part of parts){const next=text.indexOf(part,prior+1);assert(next>prior,part);prior=next;}};

test('173 introduces four independent functions, never modifies old source/decisions/periods or facts',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),[
    'faolla_attendance_plan_posthoc_formal_facts_v1','faolla_attendance_plan_posthoc_formal_compute_v1',
    'faolla_attendance_plan_posthoc_formal_leave_v1','faolla_attendance_plan_posthoc_formal_source_v1']);
  assert.doesNotMatch(sql,/create table|create index|alter table|disable trigger|pg_get_functiondef|set_config\(|current_setting\(/i);
  assert.doesNotMatch(facts+compute+leave+rpc,/\b(insert into|update public\.|delete from|truncate)\b/i);
  has(sql,"version=202610060172 and name='merchant_attendance_plan_posthoc_evaluation'",
    "values(202610060173,'merchant_attendance_plan_posthoc_formal_source') on conflict(version) do nothing","notify pgrst,'reload schema';\ncommit;");
});

test('actual owner strict query and writable lock order precede even the no-ledger compatibility check',()=>{
  has(rpc,"array['siteId','workerId','slotId']",'p_auth_user_id is null',">4096","p_query->'workerId','uuid'","p_query->'slotId','uuid'");
  ordered(rpc,'id=site and user_id=p_auth_user_id for share','merchant_attendance_settings where merchant_id=site for update',
    'merchant_attendance_workers where merchant_id=site and id=wid for update','merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'if not exists(select 1 from public.merchant_attendance_plan_posthoc_operations','return public.faolla_attendance_plan_exception_source_v1(p_query,p_auth_user_id)',
    'facts:=public.faolla_attendance_plan_posthoc_formal_facts_v1');
  assert.doesNotMatch(rpc,/p_auth_user_id\s*:=|merchant_attendance_plan_exception_cases|faolla_attendance_plan_exception_review|p_command|allow_write/);
});

test('one171 baseline supplies preserved172 identities, fixed140, bounded latest leave and hidden non-relaxable blockers',()=>{
  assert.equal((facts.match(/:=public\.faolla_attendance_plan_posthoc_adoption_v1/g)||[]).length,1);
  has(facts,"p_auth_user_id,null,false)",'row(wid,sid,employee,member_auth)',
    "faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,(compact_approval->>'operationId')::uuid)",
    "(approval_item-'source') is distinct from compact_approval",
    "requests.start_at<plan_end and requests.end_at>plan_begin",'order by requests.start_at,requests.end_at,requests.request_id limit 101',
    "cardinality(leave_ids)>100 or (basis->'context'->'leave'->>'limited')::boolean",'faolla_attendance_leave_summary_v1(leave_row,null)',
    "candidate_rows.value->'blockers' ? 'location_mismatch'","jsonb_array_elements(basis->'sessions') session_rows(value)",
    "baseline->'preview'->'blockers' ?| array['pending_correction','pending_missing']");
  assert.doesNotMatch(facts,/faolla_attendance_plan_posthoc_evaluation_v1\(|faolla_attendance_plan_posthoc_preview_v1\(/);
});

test('only current sealed and its derived unavailable cause are removed; saved sources, claims and source_changed remain',()=>{
  ordered(facts,'observation:=public.faolla_attendance_plan_posthoc_observation_v1',
    "candidate_blockers:=(current_candidate->'blockers')-'sealed'",
    "'available',candidate_blockers='[]'::jsonb",
    "observation_blockers:=(observation->'blockers')-'source_unavailable'",
    "if candidate_blockers<>'[]'::jsonb then observation_blockers:=observation_blockers",
    "if observation->'blockers' ? 'source_changed'", "if observation->'blockers' ? 'source_unavailable'");
  has(facts,"'selected',coalesce(saved_operation.selected,'[]'::jsonb),'approval',saved_operation.approval",
    "saved_operation.action is distinct from 'apply' then flags:=array_append(flags,'posthoc_inactive')");
  assert.doesNotMatch(facts,/-'source_changed'|-'pending_correction'|-'pending_missing'|-'location_mismatch'/);
});

test('new raw14 wraps full normalized evidence, hashes only canonical facts and never accepts client geometry',()=>{
  has(rpc,"'protocol','plan-exception-evidence-v3','policy','owner-confirmed-plan-edges-posthoc-v3','evaluation',facts->'source'",
    "'protocol','plan-exception-source-v3','siteId',site,'actorId',p_auth_user_id,'worker',facts->'worker','slot',facts->'slot'",
    "'readAt',facts->'readAt','source',source,'sourceText',source_text,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'))||derived",
    'derived:=public.faolla_attendance_plan_posthoc_formal_compute_v1(facts)');
  const canonical=rpc.slice(rpc.indexOf('source:=jsonb_build_object'),rpc.indexOf('source_text:=source::text'));
  assert.doesNotMatch(canonical,/readAt|state|candidate|leaveEdges|caseRevision|preview/);
  has(facts,"'protocol','posthoc-evaluation-evidence-v1','basis',basis,'posthoc',posthoc_item,'observations',observations",
    "'approval',approval_item,'leave',leave_context,'resolutionBlockers',resolution_blockers");
});

test('private SQL derivation conserves legacy sources and includes all current work in leave overlap',()=>{
  has(compute,"context->'workArrangements'->'items'","flags:=array_append(flags,'work_arrangement_pending')",
    "item->'adoption'->'approval' is distinct from compact","flags:=array_append(flags,'approval_mismatch')",
    "jsonb_array_elements((basis->'sessions')||(context->'unassociated'->'items'))",
    "where (missing_rows.value->>'isCurrentApproved')::boolean",
    "current_candidate:=nullif(observation->'current','null'::jsonb)",
    "if not exists(select 1 from jsonb_array_elements(work) work_rows(value)",
    "jsonb_build_object('original',item->'original','selected',item->'selected')");
  assert.doesNotMatch(compute,/set.*basis|jsonb_set\(source|jsonb_set\(basis|work.*breaks/);
});

test('global blocker order matches205 exact enum, while formal state never exposes not_active',()=>{
  const contract=readFileSync(new URL('../src/lib/merchantAttendancePlanPosthocEvaluationContract.ts',import.meta.url),'utf8');
  const prefix=contract.match(/PLAN_POSTHOC_RESOLUTION_BLOCKERS = \[([^\]]+)\]/)[1];
  const rest=contract.match(/PLAN_POSTHOC_EVALUATION_BLOCKERS = \[([\s\S]+?)\] as const/)[1];
  const expected=[...prefix.matchAll(/"([a-z_]+)"/g),...rest.matchAll(/"([a-z_]+)"/g)].map(m=>m[1]);
  const ordering=compute.slice(compute.indexOf("'posthoc_inactive','source_changed'"),compute.indexOf(']) with ordinality flag_rows'));
  assert.deepEqual([...ordering.matchAll(/'([a-z_]+)'/g)].map(m=>m[1]),expected);
  has(compute,"state_name:=case when not active or blockers<>'[]'::jsonb then 'blocked'", "eligible:=state_name in('required','not_applicable')");
  assert.doesNotMatch(compute,/'state','not_active'|then 'not_active'/);
});

test('leave union clips to UTC plan, merges touching coverage, subtracts gaps and keeps source-specific overlaps',()=>{
  has(leave,"greatest((item->>'startAt')::timestamptz,plan_begin)","least((item->>'endAt')::timestamptz,plan_end)",
    "(piece->>'startAt')::timestamptz<=(component->>'endAt')::timestamptz", "cursor_at<(component->>'startAt')::timestamptz",
    "full_coverage:=remaining='[]'::jsonb", "required_start:=remaining->0->>'startAt';required_end:=remaining->-1->>'endAt'",
    'if a<b then',"'work',work_item-array['startAt','endAt'],'leave',piece->'leave'",
    "if work_overlaps<>'[]'::jsonb then flags:=array_append(flags,'work_leave_overlap')");
  assert.doesNotMatch(leave,/interval\s+'1 day'|date_trunc|extract\(hour|->>?\s*'(?:breaks|duration|minutesWorked)'/i);
});

test('all derived dates normalize UTC3 to UTC6, stable reference order matches the TS helper',()=>{
  has(leave,"'startAt',to_char((leave_rows.value->>'startAt')::timestamptz at time zone 'UTC',fmt)",
    "'endAt',to_char((leave_rows.value->>'endAt')::timestamptz at time zone 'UTC',fmt)",
    "'recordedAt',to_char((leave_rows.value->>'recordedAt')::timestamptz at time zone 'UTC',fmt)",
    "'plan',jsonb_build_object('startAt',to_char(plan_begin at time zone 'UTC',fmt),'endAt',to_char(plan_end at time zone 'UTC',fmt))",
    "order by work_rows.value->>'kind',work_rows.value->>'sourceId'","order by ref_rows.value->>'requestId'");
  has(compute,"to_char((item->'selected'->>'startAt')::timestamptz at time zone 'UTC',fmt)",
    "to_char((item->>'startAt')::timestamptz at time zone 'UTC',fmt)");
});

test('full coverage is distinct not_applicable with blocked null fields, partial edges use exact numeric microseconds',()=>{
  has(compute,"if leave_edges->>'state'<>'not_applicable' and source->'approval'='null'::jsonb",
    "if state_name<>'required' then field_result:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null)",
    "elsif field->>'state' in('unconfigured','disabled')",'extract(epoch from selected_begin-',
    "extract(epoch from (leave_edges->>'requiredEndAt')::timestamptz-selected_end)*1000000",'grace::numeric*60000000',
    "'rawDeltaUs',delta::bigint::text,'excessUs',excess::bigint::text");
  assert.doesNotMatch(compute,/double precision|\breal\b|round\(|ceil\(|floor\(/i);
});

test('null unknown arrays, pending blockers and existing caps are retained instead of silently empty coverage',()=>{
  has(leave,'coverage jsonb;remaining jsonb;work_overlaps jsonb;',"if unknown_context then flags:=array_append(flags,'leave_context_unknown')",
    "if pending<>'[]'::jsonb then flags:=array_append(flags,'leave_pending')",'if not unknown_context then',
    "jsonb_array_length(p_leave->'items')>100 or jsonb_array_length(p_work)>100",'jsonb_array_length(work_overlaps)>=1000');
  has(rpc,'>1048576 then raise exception', '>2097152 then raise exception');
  has(compute,"'state',state_name,'eligible',eligible,'blockers',blockers,'leaveEdges',leave_edges,'candidate',candidate");
});

test('only public actual-owner collector is service callable, private facts/geometry/compute remain inaccessible',()=>{
  for(const [name,args] of [['facts','jsonb,uuid'],['leave','jsonb,jsonb,jsonb'],['compute','jsonb']]){
    has(sql,`revoke all on function public.faolla_attendance_plan_posthoc_formal_${name}_v1(${args}) from public,anon,authenticated,service_role`);
    assert.doesNotMatch(sql,new RegExp(`grant execute on function public\\.faolla_attendance_plan_posthoc_formal_${name}_v1`));
  }
  has(sql,'grant execute on function public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid) to service_role',
    "has_function_privilege(role_name,signature,'EXECUTE')", "is distinct from (role_name='service_role')");
});

test('SQL expression scopes avoid prior CASE and alias ambiguity regressions',()=>{
  assert.doesNotMatch(sql,/is\s+(?:not\s+)?distinct\s+from\s+case\b|#variable_conflict|plpgsql\.variable_conflict/i);
  for(const body of [facts,compute,leave,rpc]){
    const decl=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
    const locals=new Set([...decl.matchAll(/(?:\bdeclare|;)\s*([a-z_][a-z0-9_]*)\s+(?:public\.[a-z0-9_]+%rowtype|jsonb|text|uuid|record|integer|bigint|boolean|numeric|timestamptz)\b/g)].map(m=>m[1]));
    const aliases=[...body.matchAll(/\b(?:from|join)\s+(?:public\.[a-z0-9_]+|jsonb_array_elements(?:_text)?\([^;\n]*?\)|jsonb_each\([^;\n]*?\))\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]);
    for(const alias of aliases.filter(n=>!['where','order','limit','for','loop','on'].includes(n)))assert(!locals.has(alias),alias);
  }
});

test('geometry local identifier never uses reserved OVERLAPS, while the wire field remains unchanged',()=>{
  assert.doesNotMatch(leave,/\boverlaps\b/i);
  has(leave,'work_overlaps jsonb;',"work_overlaps:='[]'",'work_overlaps:=work_overlaps||jsonb_build_array',"'workLeaveOverlaps',work_overlaps");
  const reserved=new Set(['all','analyse','analyze','and','any','array','as','asc','asymmetric','authorization','binary','both','case','cast','check','collate','collation','column','concurrently','constraint','create','cross','current_catalog','current_date','current_role','current_schema','current_time','current_timestamp','current_user','default','deferrable','desc','distinct','do','else','end','except','false','fetch','for','foreign','freeze','from','full','grant','group','having','ilike','in','initially','inner','intersect','into','is','isnull','join','lateral','leading','left','like','limit','localtime','localtimestamp','natural','not','notnull','null','offset','on','only','or','order','outer','overlaps','placing','primary','references','returning','right','select','session_user','similar','some','symmetric','table','tablesample','then','to','trailing','true','union','unique','user','using','variadic','verbose','when','where','window','with']);
  for(const body of [facts,compute,leave,rpc]){
    const decl=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
    for(const [,name] of decl.matchAll(/(?:\bdeclare|;)\s*([a-z_][a-z0-9_]*)\s+/g))assert(!reserved.has(name),name);
  }
});
