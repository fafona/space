// Source contracts only. Actual SQL/identity/locking/performance are root-owned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050148_merchant_attendance_period_source.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(filename),clean=source.replace(/--[^\n]*/g,'');
const names=['faolla_attendance_period_plan_rule_v1','faolla_attendance_period_session_v1','faolla_attendance_period_canonical_v1','faolla_attendance_period_source_v1'];
const fn=name=>{const at=clean.indexOf(`create or replace function public.${name}(`);assert(at>=0);return clean.slice(at,clean.indexOf('$$;',at)+3);};
const [rule,session,canonical,body]=names.map(fn);
const has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('148 adds only four independent functions, no old definitions, tables, indexes or business writes',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),names);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|function|index)/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
});

test('atomic reapply checks exact dependencies, marker and private/public function inventory',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  has(clean,"set local lock_timeout='3s'",'202610010093::bigint', '202610010103::bigint','202610030116::bigint','202610040135::bigint',
    '202610050144::bigint','202610050146::bigint','202610050147::bigint','installed<>(to_regprocedure(signature) is not null)',
    "version=202610050148 and name<>'merchant_attendance_period_source'");
  for(const block of clean.matchAll(/do \$(\w+)\$([\s\S]*?)\$\1\$;/g))for(const variable of block[2].slice(0,block[2].indexOf('begin')).matchAll(/\b(\w+)\s+record\b/g))
    assert.doesNotMatch(block[2],new RegExp('\\b(?:from|join)\\s+[\\w.]+\\s+(?:as\\s+)?'+variable[1]+'\\b','i'));
});

test('query exact five keys, owner/self only, maximum31 civil dates and no manager privilege widening',()=>{
  has(body,"array['siteId','access','workerId','fromDate','throughDate']","jsonb_typeof(p_query->'access') is distinct from 'string'",
    "p_query->>'access' not in('owner','self')",'last_day-first_day not between 0 and 30');
  assert.doesNotMatch(body,/access_name='manager'|p_page_size|offset\s+/i);
});

test('collector acquires worker UPDATE before employee and before the actual authorized unified reader',()=>{
  order(body,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'report:=public.faolla_attendance_unified_report_v1(site,p_auth_user_id');
  assert.equal((body.match(/for update/g)||[]).length,1);
  has(body,"e.auth_user_id=p_auth_user_id)","emp.auth_user_id<>p_auth_user_id", "'attendance.self.view'=any(role_row.permissions)");
});

test('self report uses real self query, never an impersonated owner, and private completeness is checked',()=>{
  has(body,"jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid",
    'with inside as(', 'preceding as(', 'moved as(',
    'faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed)',
    "x.value->>'startEventId'=ev.id::text");
});

test('private sessions require immutable historical double identity; no invented old Auth or omitted mixed events',()=>{
  has(session,'first_event.actor_employee_id is distinct from p_employee','b.employee_auth_user_id is distinct from p_member_auth',
    'rel.employee_auth_user_id is distinct from p_member_auth','ev.actor_employee_id is distinct from p_employee',
    "if not proof then raise exception 'attendance_period_source_identity_unproven'",'faolla_attendance_self_schedule_receipt_v1(rel,p_member_auth)');
  assert.doesNotMatch(session,/faolla_attendance_(shift_check|shift_rule_binding)_v1\(/);
});

test('complete raw chain and approved lineage are independently checked, not just report IDs',()=>{
  has(session,'limit 2003','if n>2002','ev.sequence<>previous_sequence+1',"state_name='working'", "state_name='break'",
    'tail.id=last_id','eff.original_last_event_id is distinct from last_id::text','request_row.actor_auth_user_id is distinct from p_member_auth',
    'revision_row.actor_auth_user_id is distinct from p_member_auth','faolla_attendance_effect_evidence_v2(eff,p_observed)');
  has(body,'expected_report_count<>jsonb_array_length(base->\'items\')','total_events>4000');
  assert.doesNotMatch(session,/jsonb_build_object\('action','clock_out'/);
});

test('original point rules keep exact bytes and point validator; unverified remains distinct',()=>{
  has(session,'faolla_attendance_shift_rule_source_valid_v1(a.source_text,p_site,p_worker,a.source_sha256,a.source_bytes)',
    'faolla_attendance_shift_rule_binding_graph_v1(graph,first_event.occurred_at)',"b.status='verified'","b.status<>'unverified'",
    "'sourceText',a.source_text","'canonicalFormat','pg-jsonb-text-utf8-v1'");
});

test('fixed140 adoption is not replaced by current head and full saved rule source is retained',()=>{
  has(session,'sidecar.approval_operation_id,false,sidecar.channel',"'planRuleApproval',plan_rule");
  assert.doesNotMatch(session,/merchant_attendance_plan_rule_streams/);
  has(rule,'x.operation_id=p_operation',"sha256(convert_to(artifact.source::text,'UTF8'))","'source',artifact.source",
    'faolla_attendance_plan_rule_source_v1(artifact.source)','op.recorded_at>=slot_row.start_at');
  has(body,"'currentApproval',current_approval",'x.revision=rule_stream.revision');
});

test('plan membership follows slot index, including cancelled and moved-out associated sessions',()=>{
  has(body,"range_from-interval '24 hours'",'x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11',
    'cardinality(other_ids)>10', 'if target_id=any(session_ids) then continue', 'cardinality(session_ids)>100',"item->'publication'->>'employeeAuthUserId' is null");
  assert.doesNotMatch(body,/where[^;]+slot_row\.cancelled\s*=\s*false/);
});

test('context uses bounded worker/date candidates and all terminal leave/missing states',()=>{
  has(body,"range_from-interval '8784 hours'",'faolla_attendance_leave_summary_v1(leave_row)',
    "when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn'",
    "'supersedesRequestId',missing_row.supersedes_request_id", "'isCurrentApproved'",'cardinality(root_ids)>100');
  assert((body.match(/limit 101/g)||[]).length>=9);
});

test('calendar scopes come from saved evidence, with bounded range and cached saved-zone boundaries',()=>{
  has(body,"r->'item'->'events'","report->'missing'","value->'slot'->>'locationId'",'cardinality(place_ids)>100',
    "x.location_id is null",'x.location_id=place',"::date-367",'faolla_attendance_calendar_summary_v1(calendar_row)',
    'if not(bounds ? cache_key)', 'if a>=range_to or b<=range_from then continue');
  assert.doesNotMatch(body,/default_location_id/);
});

test('pending proposals are worker-index-bounded before filtering and include moved-in proposals',()=>{
  order(body,"x.action='submit' order by x.recorded_at desc,x.request_id desc limit 101",'for correction_row in',"correction_tail.action<>'submit'");
  has(body,'order by x.employee_id,x.actor_auth_user_id,x.recorded_at desc,x.request_id desc limit 101',
    'not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from)',
    'not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from)',"flags:=array_append(flags,'pending_correction')");
});

test('147 owner freshness uses actual actor; self never impersonates or declares owner-checked',()=>{
  has(body,"'latestDecision',item,'latestNote',summary",
    "if access_name='self' then flags:=array_append(flags,'unresolved_review')",
    "faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id)",
    "decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint'",'note_row.revision>decision_row.revision',
    "then 'owner_checked' else 'self_not_checked'");
});

test('147 cases are bounded point lookups for complete related plan IDs, not worker lifetime history',()=>{
  const section=body.slice(body.indexOf('other_ids:=array(select distinct candidate.slot_id'),body.indexOf('read_at:=clock_timestamp()'));
  has(section,"value->'slot'->>'id'",'from jsonb_array_elements(plans)',
    "value->'relation'->'slot'->>'id'",'from jsonb_array_elements(sessions)',
    'candidate.slot_id is not null','select distinct candidate.slot_id','cardinality(other_ids)>200',
    'from unnest(other_ids) selected(slot_id)','cross join lateral(select x.case_id',
    'x.merchant_id=site and x.slot_id=selected.slot_id limit 1','order by picked.case_id limit 101',
    'cardinality(ids)>100',
    'row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id)');
  assert.doesNotMatch(section,/opened_at|slot_start_at|slot_end_at|x\.worker_id=wid/);
  has(read('202610050147_merchant_attendance_plan_exception_review.sql'),'unique(merchant_id,slot_id)');
  // Static query/constraint evidence only: this test does not claim an actual
  // >100 unrelated-case SQL fixture or a measured execution plan.
});

test('canonical fingerprint excludes only explicit access/observation fields and preserves business times',()=>{
  has(canonical,"array['asOf','access','viewerEmployeeId','scopeRevision','locationId','coverage','accessValidUntil']",
    "value-'actorEmployeeId'", "jsonb_set(item,'{employeeId}',p->'employeeId')", "'dayBoundaries',p->'dayBoundaries'", "'context',p->'context'");
  assert.doesNotMatch(canonical,/'blockers'|'validation'|'readAt'|recordedAt|submittedAt/);
  has(body,"source_text:=canonical::text", "'sourceText',source_text", "'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex')");
});

test('frozen civil day UTC boundaries, blockers and separate canonical/internal byte budgets are explicit',()=>{
  has(body,"'skipped',a=b", "'date',d,'fromAt'",'octet_length(convert_to(source_text,\'UTF8\'))>1048576',
    'octet_length(convert_to(result::text,\'UTF8\'))>4194304',
    "array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']",
    "'complete',true");
});

test('only new public source RPC is service executable; private composition is denied and rechecked',()=>{
  for(const name of names)assert.match(clean,new RegExp(`revoke all on function public\\.${name}\\([^;]+from public,anon,authenticated,service_role;`));
  assert.equal((clean.match(/grant execute on function/g)||[]).length,1);
  has(clean,'grant execute on function public.faolla_attendance_period_source_v1(jsonb,uuid) to service_role',
    "has_function_privilege('service_role',signature,'EXECUTE')<>","array['anon','authenticated']");
});

test('existing147 writes demonstrate why a new worker mutex is necessary; no old writer is edited',()=>{
  const old=read('202610050147_merchant_attendance_plan_exception_review.sql');
  order(old,'from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    "if p_command is not null then perform pg_advisory_xact_lock",'insert into public.merchant_attendance_plan_exception_entries');
});
