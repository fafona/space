//207 source/ABI regression checks, not a native PostgreSQL execution claim.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610060174_merchant_attendance_plan_posthoc_reviews.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),old159=read('202610060159_merchant_attendance_work_arrangement_exceptions.sql'),old170=read('202610060170_merchant_attendance_plan_clearance.sql');
const fn=(name,source=sql)=>{const a=source.indexOf('create or replace function public.'+name+'('),b=source.indexOf('\n$$;',a);assert(a>=0&&b>a,name);return source.slice(a,b+4);};
const command=fn('faolla_attendance_plan_exception_review_command_v1'),evidence=fn('faolla_attendance_plan_exception_posthoc_evidence_v1'),entry=fn('faolla_attendance_plan_exception_review_entry_v1');
const engine=fn('faolla_attendance_plan_exception_posthoc_execute_v1');
const has=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const ordered=(s,...parts)=>{let prior=-1;for(const p of parts){const next=s.indexOf(p,prior+1);assert(next>prior,p);prior=next;}};

test('174 is forward-only: four new functions, six exact compatibility functions and one notification CHECK',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),[
    'faolla_attendance_plan_exception_review_evidence_legacy_v1','faolla_attendance_plan_exception_review_command_v1',
    'faolla_attendance_plan_exception_posthoc_evidence_v1','faolla_attendance_plan_exception_review_evidence_v1',
    'faolla_attendance_plan_exception_review_entry_v1','faolla_attendance_plan_exception_posthoc_execute_v1',
    'faolla_attendance_plan_exception_review_v1','faolla_attendance_plan_exception_clearance_v1',
    'faolla_attendance_plan_exception_review_event_v1','faolla_attendance_plan_exception_posthoc_review_v1']);
  assert.doesNotMatch(sql,/create table|create index|disable trigger|pg_get_functiondef|set_config\(|current_setting\(/i);
  assert.deepEqual([...sql.matchAll(/alter table public\.([a-z0-9_]+)/g)].map(m=>m[1]),Array(3).fill('merchant_attendance_event_notifications'));
  has(sql,"version=202610060173 and name='merchant_attendance_plan_posthoc_formal_source'", "values(202610060174,'merchant_attendance_plan_posthoc_reviews') on conflict(version) do nothing");
});

test('legacy v1/work-v2 validator is exact preserved source except private name; dispatch cannot reinterpret it',()=>{
  assert.equal(fn('faolla_attendance_plan_exception_review_evidence_legacy_v1'),fn('faolla_attendance_plan_exception_review_evidence_v1',old159)
    .replace('faolla_attendance_plan_exception_review_evidence_v1(','faolla_attendance_plan_exception_review_evidence_legacy_v1('));
  const dispatch=fn('faolla_attendance_plan_exception_review_evidence_v1');
  has(dispatch,"p->>'policy'='owner-confirmed-plan-edges-posthoc-v3'",'return public.faolla_attendance_plan_exception_posthoc_evidence_v1(p)',
    'return public.faolla_attendance_plan_exception_review_evidence_legacy_v1(p)');
});

test('command keeps old exact7 decision and separate note/ack shapes; not_applicable requires existing revision',()=>{
  has(command,"array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','outcome','note']",
    "array['operationId','expectedRevision','decisionOperationId','note']","array['operationId','decisionOperationId']",
    "in('confirmed','excused','follow_up','cleared','not_applicable')", "p->>'outcome' not in('cleared','not_applicable') or (p->>'expectedRevision')::bigint>=1");
  assert.equal(command.replace(", 'not_applicable'",'' ).includes('p_allow_posthoc'),false);
});

test('new engine acquires UPDATE levels before review advisory/case, no legacy event prefix can upgrade later',()=>{
  ordered(engine,'id=site and (access_name=\'self\' or user_id=p_auth_user_id) for share',
    'merchant_attendance_settings where merchant_id=site for update','merchant_attendance_workers where merchant_id=site and employee_id=current_employee for update',
    'merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share',
    "pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'",'slot_id=sid for update',
    'faolla_attendance_plan_posthoc_formal_source_v1(');
  for(const name of ['review_v1','clearance_v1','review_event_v1']){
    const wrapper=fn('faolla_attendance_plan_exception_'+name);
    assert.doesNotMatch(wrapper,/for share|pg_advisory|select |perform /i);
    has(wrapper,'faolla_attendance_plan_exception_posthoc_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,false,');
  }
});

test('no-ledger and genuine self branch delegate unchanged170 engine, never impersonate a current owner',()=>{
  const dispatch=engine.slice(engine.indexOf('--Do not introduce'),engine.indexOf('-- New namespace'));
  has(dispatch,"access_name<>'owner' or mode_name not in('detail','decide')",'merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid',
    'return public.faolla_attendance_plan_exception_clearance_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications)',
    "p_command->>'outcome'='not_applicable' then raise exception 'attendance_plan_exception_review_blocked'");
  assert.doesNotMatch(dispatch,/action='apply'|p_auth_user_id\s*:=|merchants\.user_id/);
  assert.equal((engine.match(/faolla_attendance_plan_posthoc_formal_source_v1\(/g)||[]).length,1);
});

test('same original command/auth/dual identity is checked before new flags, current source, quotas and capture',()=>{
  ordered(engine,'select * into saved from public.merchant_attendance_plan_exception_entries',
    'saved.actor_auth_user_id<>p_auth_user_id','saved.command is distinct from p_command',
    'if not p_allow_posthoc then raise exception',"p_command->>'employeeAuthUserId' is distinct from current_auth::text",
    'source_result:=public.faolla_attendance_plan_posthoc_formal_source_v1','if capture_new_decision then');
  has(engine,"mode_name='decide' and saved.operation_id is null",'saved.operation_id is null and saved_read.operation_id is null',
    'p_allow_posthoc is null','head>=200','n>=5000','>67108864','row_count>25');
});

test('every new v3 decision is case-bound, CAS-bound, active, not self-approved and guarded after source recompute',()=>{
  has(engine,"not p_allow_posthoc then raise exception 'attendance_plan_exception_posthoc_disabled'",
    "c.case_id is null or head<1 or (p_command->>'expectedRevision')::bigint<1", "not w.active or e.status<>'active'",
    'p_auth_user_id=current_auth',"source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint'",
    "source_result->>'protocol' is distinct from 'plan-exception-source-v3'",'source_result->>\'sourceText\' is distinct from (source_result->\'source\')::text');
  has(engine,"source_result->>'state' is distinct from 'not_applicable'", "source_result->'leaveEdges'->>'fullCoverage' is distinct from 'true'", "source_result->'leaveEdges'->'work'<>'[]'::jsonb");
});

test('sealed plan plus saved/current original/selected sources reject fresh decisions without contaminating source hash',()=>{
  ordered(engine,'source_result:=public.faolla_attendance_plan_posthoc_formal_source_v1',
    'perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(',
    "selected_sources:=source_result->'source'->'evaluation'->'posthoc'->'selected'",
    "jsonb_array_elements(source_result->'source'->'evaluation'->'observations')",'jsonb_build_array(ref_item->\'selected\')',
    'jsonb_build_array(ref_item->\'original\')','insert into public.merchant_attendance_plan_exception_entries');
  assert.doesNotMatch(engine,/jsonb_set\(source_result|source_result\s*:=.*-'sealed'/);
});

test('compact exact10/evaluation5 comes from actual SQL source; work-v2 context is extracted from nested basis',()=>{
  has(evidence,"array['policy','fingerprint','observedAt','eligible','blockers','candidate','approval','sessions','contextRefs','evaluation']",
    "array['state','slot','posthoc','observations','leaveEdges']","array['slotId','locationId','timeZone','startAt','endAt']",'>131072');
  has(engine,"source_basis:=source_result->'source'->'evaluation'->'basis'", "source_basis->>'policy'='owner-confirmed-plan-edges-work-v2'",
    "'posthoc',source_result->'source'->'evaluation'->'posthoc'","'observations',source_result->'source'->'evaluation'->'observations'","'leaveEdges',source_result->'leaveEdges'",
    "octet_length(convert_to(evidence::text,'UTF8'))>131072");
  assert.doesNotMatch(engine,/evidence:=.*source_result->'source'\s*;|left\(.*evidence|substring.*evidence/);
});

test('historical validator recomputes saved leave geometry and selected endpoints, not a mutable full source',()=>{
  has(evidence,"faolla_attendance_plan_posthoc_formal_leave_v1(edges->'plan',edges->'leave',edges->'work') is distinct from edges",
    "p->'contextRefs'->'leave' is distinct from jsonb_build_object('limited',edges->'leave'->'limited','items',part)",
    "work_rows.value->>'kind'='session' and work_rows.value->'sourceId'=item->'startEventId'", "part->'operationId' is distinct from item->'effectOperationId'",
    "if active then selected_spans:=selected_spans||jsonb_build_array(selected_item->'selected')",'extract(epoch from selected_begin-',
    "'startAt',to_char(selected_begin at time zone 'UTC',fmt)");
  assert.doesNotMatch(evidence,/faolla_attendance_plan_posthoc_formal_source_v1|faolla_attendance_plan_posthoc_evaluation_v1|current_setting|pg_timezone_names|original\s*:=/);
});

test('saved selections retain either mixed-kind order and reverse same-kind order from171, with duplicate roots rejected',()=>{
  const adoption=read('202610060171_merchant_attendance_plan_posthoc_adoption.sql');
  has(fn('faolla_attendance_plan_posthoc_command_v1',adoption),'if k=any(keys) then return false;end if;keys:=array_append(keys,k)');
  has(evidence,"seen_reference_keys text[]:=array[]::text[]",'if current_key=any(seen_reference_keys) then return false;end if;',
    'seen_reference_keys:=array_append(seen_reference_keys,current_key)',
    "ev->'observations'->(selected_rows.ordinality::integer-1)","current_op->'sources'->(selected_rows.ordinality::integer-1)");
  assert.doesNotMatch(evidence,/current_key\s*<=\s*previous|order by[^;]*current_key|order by[^;]*reference/);
  //Contract witness only, not SQL execution: both immutable arrays preserve
  //the command order; the SQL guard above must enforce uniqueness, not sort.
  const session={kind:'session',startEventId:'00000000-0000-4000-8000-000000000002'};
  const earlier={kind:'session',startEventId:'00000000-0000-4000-8000-000000000001'};
  const missing={kind:'missing',requestId:'00000000-0000-4000-8000-000000000003',rootRequestId:'00000000-0000-4000-8000-000000000003'};
  const valid=refs=>{const seen=new Set();return refs.every(ref=>{const key=ref.kind+':'+(ref.startEventId??ref.rootRequestId);if(seen.has(key))return false;seen.add(key);return true;});};
  for(const sources of [[session,missing],[missing,session],[session,earlier]]){
    assert(valid(sources));
    const selected=sources.map(reference=>({reference})),observations=sources.map(reference=>({reference}));
    assert.deepEqual(selected.map((item,i)=>[item.reference,observations[i].reference]),sources.map(ref=>[ref,ref]));
  }
  assert.equal(valid([session,missing,session]),false);
  assert.equal(valid([missing,{...missing,requestId:'00000000-0000-4000-8000-000000000004'}]),false);
});

test('changed/revoked saved adoption remains history, resolved original171 operation is immutable and case-bound',()=>{
  has(entry,'faolla_attendance_plan_posthoc_operation_v1(adoption) is distinct from ev->\'posthoc\'->\'current\'',
    'row(p.case_id,p.worker_id,p.slot_id,p.employee_id,p.employee_auth_user_id)',
    "adoption.selected is distinct from ev->'posthoc'->'selected'", "coalesce(adoption.approval,'null'::jsonb) is distinct from ev->'posthoc'->'approval'",
    'is distinct from c.slot_start_at','is distinct from c.slot_end_at');
  assert.doesNotMatch(entry,/order by.*revision desc|merchant_attendance_plan_posthoc_claims|adoption\.action\s*<>\s*'apply'/);
  has(evidence,"state_name<>'blocked' or not(p->'blockers' ? 'posthoc_inactive')", "observation->'blockers' ? 'source_changed'", "part->'blockers' ? 'sealed'");
});

test('not_applicable is a separate later verdict with current saved v3 evidence; old outcome meanings remain',()=>{
  has(entry,"p.command->>'outcome' in('confirmed','excused')", "p.command->>'outcome'='cleared'", "p.command->>'outcome'='not_applicable' and (p.revision<2",
    "p.evidence->>'policy' is distinct from 'owner-confirmed-plan-edges-posthoc-v3'", "p.evidence->'evaluation'->>'state' is distinct from 'not_applicable'");
  has(evidence,"state_name='not_applicable' and (edges->>'state' is distinct from 'not_applicable'", "state_name<>'required'", "jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null)");
});

test('notification capture is fresh actual INSERT only, same transaction and original-recipient verification remains',()=>{
  ordered(engine,'insert into public.merchant_attendance_plan_exception_entries','capture_new_decision:=p_capture_notifications','if capture_new_decision then',
    "faolla_attendance_event_notification_capture_v1(site,'plan_exception',op,p_auth_user_id,p_command)");
  has(sql,"event_type in('cleared','not_applicable') and source_revision>=2", "source_revision is not null and source_revision between 1 and 9007199254740990",
    'validate constraint attendance_event_notification_outcome_v3');
  assert.doesNotMatch(engine,/on conflict|exception when|merchant_attendance_event_notifications/);
});

test('self history/note/ack remain unchanged170 behavior including current null and separate business read receipt',()=>{
  const old=fn('faolla_attendance_plan_exception_clearance_execute_v1',old170);
  has(old,"mode_name='detail' or mode_name='decide' and saved.operation_id is null", "if access_name='owner' and",
    "'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end",
    'insert into public.merchant_attendance_plan_exception_reads',"mode_name='note'", "p_auth_user_id=current_auth");
  has(engine,'return public.faolla_attendance_plan_exception_clearance_execute_v1(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications)');
});

test('private engine/helpers have no service execution; all old service wrappers disable fresh v3',()=>{
  for(const signature of ['posthoc_execute_v1(jsonb,uuid,jsonb,boolean,boolean,boolean,boolean)','posthoc_evidence_v1(jsonb)','review_evidence_legacy_v1(jsonb)']){
    has(sql,'revoke all on function public.faolla_attendance_plan_exception_'+signature+' from public,anon,authenticated,service_role');
  }
  has(fn('faolla_attendance_plan_exception_review_v1'),'p_allow_write,false,false,false');
  has(fn('faolla_attendance_plan_exception_clearance_v1'),'p_allow_write,false,p_allow_clearance,p_capture_notifications');
  has(fn('faolla_attendance_plan_exception_review_event_v1'),'p_allow_write,false,false,true');
  has(fn('faolla_attendance_plan_exception_posthoc_review_v1'),'p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications');
});

test('new declarations and SQL references avoid known reserved-variable, CASE and relation-alias collisions',()=>{
  assert.doesNotMatch(sql,/is\s+(?:not\s+)?distinct\s+from\s+case\b|#variable_conflict|plpgsql\.variable_conflict|\boverlaps\s*(?:jsonb|:=)/i);
  for(const body of [evidence,entry,engine]){
    const decl=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
    const locals=new Set([...decl.matchAll(/(?:\bdeclare|;)\s*([a-z_][a-z0-9_]*)\s+(?:public\.[a-z0-9_]+%rowtype|jsonb|text|uuid|record|integer|bigint|boolean|numeric|timestamptz)\b/g)].map(m=>m[1]));
    const aliases=[...body.matchAll(/\b(?:from|join)\s+(?:public\.[a-z0-9_]+|jsonb_array_elements(?:_text)?\([^;\n]*?\)|jsonb_each\([^;\n]*?\))\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]);
    for(const alias of aliases.filter(n=>!['where','order','limit','for','loop','on','with'].includes(n)))assert(!locals.has(alias),alias);
  }
});
