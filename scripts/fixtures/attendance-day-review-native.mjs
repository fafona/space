//199 INERT. Real RPC/Node projection acceptance in an existing owned namespace.
//Past publication/event templates are explicitly synthetic; no clock is moved,
//no old row/guard is disabled and no past real publication is claimed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(199600000+n),day=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const dayReviewFixtureLimits=Object.freeze({groups:8,steps:220,rpcs:180,fixtureMs:180000,statementMs:10000,lockMs:3000,templateRows:110});
export const dayReviewFixtureGroups=Object.freeze(['closure_owner_self_dispute_new_decision','no_record_and_explicit_self_claims',
 'actual_open_pending_conflict_and_unchanged_raw_facts','calendar_scope_saved_zone_and_full_slot',
 'whole_day_all_plans_unassociated_and_capacity','source_and_head_invalidation','original_receipt_identity_gate_and_25plus1_history',
 'actual_server_projection_private_acl_and_old_artifact_protection']);
//Finite SOURCE-derived per-group bounds. The global spare19 RPC/19 SQL slots
//are not permission to grow a new matrix; a changed group needs an explicit edit.
export const dayReviewFixtureGroupBudgets=Object.freeze(dayReviewFixtureGroups.map((name,index)=>Object.freeze({name,
 rpcs:[15,13,18,24,4,20,65,2][index],steps:[19,14,26,30,13,23,71,4][index]})));
//Only the two actual204 sources inherited from207's explicit revoke may be
//re-associated. Values are copied from the strict real171 preview, not invented
//source references or a synthetic approval. No SQL or environment side effect.
export function dayReviewPosthocReassociationCommand(detail,h,operationId){
 assert.match(operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 assert.equal(detail?.worker?.workerId,h.workerId);assert.equal(detail?.worker?.employeeId,h.employeeId);
 assert.equal(detail?.worker?.employeeAuthUserId,h.employeeAuthUserId);assert.equal(detail?.slot?.id,h.slot.id);
 assert.equal(detail?.current?.action,'revoke');assert.equal(detail.current.revision,detail.revision);
 assert.equal(detail.current.employeeId,h.employeeId);assert.equal(detail.current.employeeAuthUserId,h.employeeAuthUserId);
 assert.equal(detail?.preview?.eligible,true);assert.deepEqual(detail.preview.blockers,[]);
 const available=detail.preview.candidates.filter(c=>c.available),expected=[
  {kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null},
  {kind:'missing',requestId:id(204715),rootRequestId:id(204715),approvalOperationId:id(204716)},
 ];
 assert.equal(available.length,2,'dr199_exact_two_actual204_available_sources');
 const sources=expected.map(ref=>{const matches=available.filter(c=>c.reference.kind===ref.kind);
  assert.equal(matches.length,1);assert.deepEqual(matches[0].reference,ref);assert.deepEqual(matches[0].blockers,[]);assert.equal(matches[0].claim,null);
  return structuredClone(matches[0].reference);});
 return {action:'apply',operationId,expectedRevision:detail.revision,expectedFingerprint:detail.preview.fingerprint,
  employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason:'Synthetic199 explicit re-association of two inherited available204 sources',sources};
}
//Bounded, non-secret diagnostics only. Never print canonical/source/command
//bodies, text, actor/employee identifiers, reasons or authentication material.
export function dayReviewNativeWorkDiagnostic(value){
 const input=value?.input,raw=value?.source?.raw,basis=raw?.protocol==='plan-exception-source-v3'?raw.source?.evaluation?.basis:raw?.source;
 const records=Array.isArray(input?.source?.records)?input.source.records:[];
 const tags=['evidence_insufficient','pending_source','open_record','source_conflict','unassociated_record','no_record','recorded_work'];
 const count=v=>Array.isArray(v)?Math.min(v.length,4001):null;
 return {protocol:typeof raw?.protocol==='string'&&/^plan-exception-source-v[123]$/.test(raw.protocol)?raw.protocol:null,
  sourceCurrent:typeof input?.source?.current==='boolean'?input.source.current:null,
  coverage:['complete','unknown','over_limit'].includes(input?.source?.coverage)?input.source.coverage:null,
  recordCount:count(input?.source?.records),closedSelected:records.filter(r=>r.selected?.endAt!=null).length,
  closedOriginal:records.filter(r=>r.original?.endAt!=null).length,administrative:records.filter(r=>r.administrativeBoundary!=null).length,
  basisSessions:count(basis?.sessions),basisUnassociated:count(basis?.context?.unassociated?.items),
  currentObservations:count(raw?.source?.evaluation?.observations),
  savedObservations:Array.isArray(value?.head?.latestDecision?.observations)?value.head.latestDecision.observations.filter(v=>tags.includes(v)):null};
}
// Read only the already returned plan/preview. This is a bounded failure
// message, not another SQL read or an alternative source/candidate assertion.
export function dayReviewNativeCandidateDiagnostic(value,preview){
 const input=value?.input,s=input?.source,t=input?.target,raw=value?.source?.raw;
 const array=v=>Array.isArray(v)?v.slice(0,4001):[],records=array(s?.records),plans=array(s?.plans),calendar=array(s?.calendar);
 const plan=plans.find(p=>p?.slotId===t?.slotId),candidate=array(preview?.candidates).find(c=>c?.outcome==='calendar_exempt');
 const blockerTags=['evidence_incomplete','identity_unproven','source_not_current','target_not_ended','self_review','pending_source','open_record','source_conflict','unassociated_record',
  'administrative_hours_unassessed','plan_required','plan_cancelled','publication_missing','covering_closure_missing','work_record_present','latest_not_worked_statement_required','recorded_work_required'];
 const observationTags=['evidence_insufficient','pending_source','open_record','source_conflict','unassociated_record','no_record','recorded_work'];
 const resolutionTags=['posthoc_inactive','source_changed','source_unavailable','context_unknown'];
 const kinds=(items,tags)=>Object.fromEntries(tags.map(kind=>[kind,items.filter(v=>v?.kind===kind).length]));
 const evaluation=raw?.protocol==='plan-exception-source-v3'?raw.source?.evaluation:null,action=evaluation?.posthoc?.current?.action;
 return {source:dayReviewNativeWorkDiagnostic(value),candidateState:['blocked','candidate'].includes(candidate?.candidateState)?candidate.candidateState:null,
  blockers:blockerTags.filter(tag=>array(candidate?.blockers).includes(tag)),observations:observationTags.filter(tag=>array(preview?.observations).includes(tag)),
  identity:['matching','unproven'].includes(s?.identity)?s.identity:null,
  unassociatedCount:records.filter(r=>!r?.association||t?.kind==='plan'&&r.association.slotId!==t.slotId).length,
  openCount:records.filter(r=>!r?.administrativeBoundary&&(r?.original?.endAt===null||r?.selected?.endAt===null)).length,
  pendingKinds:kinds(array(s?.pending),['correction','revision','missing','leave','arrangement','outage']),
  conflictKinds:kinds(array(s?.conflicts),['records_overlap','work_leave']),
  plan:{present:!!plan,cancelled:typeof plan?.cancelled==='boolean'?plan.cancelled:null,hasPublicationEvidence:typeof plan?.hasPublicationEvidence==='boolean'?plan.hasPublicationEvidence:null},
  calendarCount:calendar.length,coveringClosureCount:!plan||plan.cancelled||!plan.hasPublicationEvidence?0:calendar.filter(c=>c?.kind==='closure'&&c.status==='created'
   &&(c.locationId===null||c.locationId===plan.locationId)&&c.fromAt<=plan.startAt&&c.toAt>=plan.endAt).length,
  resolutionBlockers:resolutionTags.filter(tag=>array(evaluation?.resolutionBlockers).includes(tag)),currentPosthocAction:['apply','revoke'].includes(action)?action:null};
}
export function dayReviewNativeRpcExpression(name,a){
 assert.equal(name,'faolla_attendance_day_review_v1');assert.deepEqual(Object.keys(a).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
 assert.equal(typeof a.p_allow_write,'boolean');assert.match(a.p_query.siteId,/^9999000[1-6]$/);assert.match(a.p_auth_user_id,/^[0-9a-f-]{36}$/);
 return `public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_write})`;
}
const eventCoverageTable='merchant_attendance_disposal_event_coverage';
const eventCoverageRowsSql=(ids=[])=>`(select coalesce(jsonb_agg(to_jsonb(coverage_row) order by to_jsonb(coverage_row)::text),'[]') from public.${eventCoverageTable} coverage_row${ids.length?' where coverage_row.event_id not in('+ids.join(',')+')':''})`;
//197 captures exactly one immutable coverage row for each actual inserted
//event. This is a per-event expected delta, never a general writer allowance.
const eventCoverageProofSql=({site,worker,employee,events,receipt=null})=>`declare
 coverage_event public.merchant_attendance_events%rowtype;coverage_saved public.${eventCoverageTable}%rowtype;
 begin
 ${events.map(event=>`select * into coverage_event from public.merchant_attendance_events where id=${event.id};
 assert coverage_event.id is not null and coverage_event.merchant_id=${quote(site)} and coverage_event.worker_id=${quote(worker)}
  and coverage_event.actor_employee_id=${quote(employee)} and coverage_event.operation_id=${quote(event.operationId)}
  and coverage_event.sequence=${event.sequence} and coverage_event.action=${quote(event.action)} and coverage_event.source='web'
  ${event.locationId?'and coverage_event.location_id='+quote(event.locationId):''}
  and isfinite(coverage_event.occurred_at) and isfinite(coverage_event.received_at),'dr199_coverage_exact_event';
 ${receipt?`assert public.faolla_attendance_event_receipt_v1(coverage_event)=${receipt},'dr199_coverage_actual_receipt';`:''}
 select * into coverage_saved from public.${eventCoverageTable} where event_id=coverage_event.id;
 assert coverage_saved.event_id is not null and coverage_saved.merchant_id=coverage_event.merchant_id and coverage_saved.worker_id=coverage_event.worker_id
  and coverage_saved.sequence=coverage_event.sequence and coverage_saved.coverage_version=1 and isfinite(coverage_saved.recorded_at)
  and coverage_saved.recorded_at>=coverage_event.received_at and coverage_saved.recorded_at<=clock_timestamp(),'dr199_coverage_exact_capture';`).join('\n')}
 assert jsonb_array_length(${eventCoverageRowsSql()})=jsonb_array_length(coverage_before)+${events.length},'dr199_coverage_exact_delta';
 assert ${eventCoverageRowsSql(events.map(event=>event.id))}=coverage_before,'dr199_coverage_old_rows_changed';
 end;`;
export function dayReviewClockCoverageSql(label,{site,worker,employee,command}){
 assert.match(site,/^9999000[1-6]$/);for(const v of[worker,employee,command?.operationId,command?.locationId])assert.match(v,/^[0-9a-f-]{36}$/);
 assert.deepEqual(Object.keys(command).sort(),['action','expectedSequence','expectedWorkerId','locationId','operationId']);
 assert.equal(command.expectedWorkerId,worker);assert(Number.isSafeInteger(command.expectedSequence)&&command.expectedSequence>=0&&command.expectedSequence<Number.MAX_SAFE_INTEGER);
 assert(['clock_in','break_start'].includes(command.action));assert.equal(label,(command.action==='clock_in'?'actual137_':'actual111_')+command.action);
 const result=command.action==='clock_in'?"value->'clock'":'value',receipt=`(${result}->'receipt')`;
 return `assert ${result}->'replayed'='false'::jsonb,'dr199_coverage_fresh_actual_clock';\n`+eventCoverageProofSql({site,worker,employee,receipt,
  events:[{id:`(${receipt}->>'id')::uuid`,operationId:command.operationId,sequence:String(command.expectedSequence+1),action:command.action,locationId:command.locationId}]});
}
// The207 full-leave caller intentionally replaces h.slot but retains174's
// original start/end. Anchor this fixture to the actual original event's137
// relation, not that unrelated parent slot or a cached146 source body. This
// point read is fused into existing BEGIN/baseline steps; no business RPC/write.
export function dayReviewOriginalWorkAnchorSql(site,h){
 assert.match(site,/^9999000[1-6]$/);
 for(const v of[h.workerId,h.employeeId,h.employeeAuthUserId,h.startEventId,h.lastEventId,h.operationId])assert.match(v,/^[0-9a-f-]{36}$/);
 return `do $dr199_original_anchor$ declare
  original_start public.merchant_attendance_events%rowtype;original_end public.merchant_attendance_events%rowtype;
  original_relation public.merchant_attendance_shift_schedule_relations%rowtype;original_slot public.merchant_attendance_schedule_slots%rowtype;
  current_worker public.merchant_attendance_workers%rowtype;current_employee public.merchant_enterprise_employees%rowtype;session_proof jsonb;slot_proof jsonb;
 begin
  assert current_user='postgres','dr199_anchor_owned_postgres';
  select * into original_start from public.merchant_attendance_events where merchant_id=${quote(site)} and worker_id=${quote(h.workerId)} and id=${quote(h.startEventId)};
  select * into original_end from public.merchant_attendance_events where merchant_id=${quote(site)} and worker_id=${quote(h.workerId)} and id=${quote(h.lastEventId)};
  assert original_start.id is not null and original_end.id is not null and original_start.action='clock_in' and original_end.action='clock_out'
   and original_start.operation_id=${quote(h.operationId)} and original_start.actor_employee_id=${quote(h.employeeId)} and original_end.actor_employee_id=${quote(h.employeeId)}
   and original_end.sequence>original_start.sequence and original_end.occurred_at>original_start.occurred_at,'dr199_anchor_original_closed_events';
  select * into current_worker from public.merchant_attendance_workers where merchant_id=${quote(site)} and id=${quote(h.workerId)};
  select * into current_employee from public.merchant_enterprise_employees where merchant_id=${quote(site)} and id=${quote(h.employeeId)};
  assert current_worker.id is not null and current_employee.id is not null and current_worker.employee_id=current_employee.id
   and current_employee.auth_user_id=${quote(h.employeeAuthUserId)} and current_worker.active and current_employee.status='active','dr199_anchor_current_dual_identity';
  select * into original_relation from public.merchant_attendance_shift_schedule_relations where merchant_id=${quote(site)} and worker_id=${quote(h.workerId)} and start_event_id=original_start.id;
  assert original_relation.start_event_id is not null and original_relation.status='linked' and original_relation.employee_id=current_employee.id
   and original_relation.employee_auth_user_id=current_employee.auth_user_id and original_relation.operation_id=original_start.operation_id,'dr199_anchor_saved_dual_identity';
  select * into original_slot from public.merchant_attendance_schedule_slots where merchant_id=${quote(site)} and id=original_relation.slot_id;
  assert original_slot.id is not null and original_slot.worker_id=current_worker.id and original_slot.employee_id=current_employee.id
   and original_slot.revision=original_relation.slot_revision,'dr199_anchor_actual_relation_slot';
  perform public.faolla_attendance_self_schedule_receipt_v1(original_relation,current_employee.auth_user_id);
  session_proof:=public.faolla_attendance_period_session_v1(${quote(site)},current_worker.id,original_start.id,current_employee.id,current_employee.auth_user_id,clock_timestamp());
  assert session_proof->'item'->>'startEventId'=original_start.id::text and jsonb_array_length(session_proof->'item'->'events')>=2
   and session_proof->'item'->'events'->0->>'id'=original_start.id::text and session_proof->'item'->'events'->-1->>'id'=original_end.id::text
   and session_proof->'item'->'events'->-1->>'action'='clock_out','dr199_anchor_actual_closed_session';
  slot_proof:=public.faolla_attendance_self_schedule_slot_v1(original_slot)->'slot';
  assert slot_proof->>'id'=original_relation.slot_id::text and slot_proof->'hasPublicationEvidence'='true'::jsonb
   and slot_proof->'cancelled'='false'::jsonb,'dr199_anchor_actual_publication';
  perform set_config('faolla.dr199_work_anchor',jsonb_build_object('slot',slot_proof,'workerId',current_worker.id,'employeeId',current_employee.id,
   'employeeAuthUserId',current_employee.auth_user_id,'startEventId',original_start.id,'lastEventId',original_end.id,'operationId',original_start.operation_id)::text,true);
 end;$dr199_original_anchor$;`;
}
export function dayReviewOriginalWorkContext(site,inherited,anchor){
 assert.match(site,/^9999000[1-6]$/);assert(anchor&&typeof anchor==='object'&&!Array.isArray(anchor));
 assert.deepEqual(Object.keys(anchor).sort(),['employeeAuthUserId','employeeId','lastEventId','operationId','slot','startEventId','workerId']);
 for(const key of['workerId','employeeId','employeeAuthUserId','startEventId','lastEventId','operationId'])assert.equal(anchor[key],inherited[key],'dr199_anchor_identity:'+key);
 const slot=anchor.slot;assert(slot&&typeof slot==='object'&&!Array.isArray(slot));assert.match(slot.id,/^[0-9a-f-]{36}$/);
 assert.match(slot.workDate,/^20\d\d-\d\d-\d\d$/);assert.equal(slot.hasPublicationEvidence,true);assert.equal(slot.cancelled,false);
 assert(Number.isSafeInteger(slot.revision)&&slot.revision>=1);assert.match(slot.locationId,/^[0-9a-f-]{36}$/);
 assert.equal(typeof slot.timeZone,'string');assert(Number.isFinite(Date.parse(slot.startAt))&&Date.parse(slot.endAt)>Date.parse(slot.startAt));
 return {...inherited,slot:{...slot},query:{siteId:site,workerId:inherited.workerId,slotId:slot.id}};
}
//At most101 slots +4 commands +4 evidence=109 rows. The two-plan branch with
//a disclosed unassociated event pair+137 receipt proof is7 direct rows plus
//2 coverage rows produced by the real197 trigger. Full136 guards and FK chains
//remain enabled; each original publication/slot/evidence row is untouched.
export function dayReviewHistoricalTemplateSql({site,worker,employee,auth,owner,sourceSlot,sourceStart,sourceEnd,workDate,count=2,
 base=10000,zone='UTC',location=null,clock=false,overnight=false,startMinutes=360,captureCoverage=false}){
 for(const v of[worker,employee,auth,owner,sourceSlot,sourceStart,sourceEnd])assert.match(v,/^[0-9a-f-]{36}$/);
 assert.match(site,/^9999000[1-6]$/);assert.match(workDate,/^20\d\d-\d\d-\d\d$/);assert([1,2,101].includes(count));
 assert(['UTC','Europe/Madrid'].includes(zone));assert.equal(typeof clock,'boolean');assert.equal(typeof overnight,'boolean');
 assert.equal(typeof captureCoverage,'boolean');
 assert(Number.isSafeInteger(startMinutes)&&startMinutes>=0&&startMinutes<=1380);
 if(location!==null)assert.match(location,/^[0-9a-f-]{36}$/);assert(Number.isSafeInteger(base)&&base>=10000&&base<50000);
 const batches=Math.ceil(count/32),rows=count+2*batches+(clock?3:0)+(location===null?0:1),derivedCoverageRows=clock&&captureCoverage?2:0;assert(rows+derivedCoverageRows<=110);
 const slots=Array.from({length:count},(_,i)=>uid(base+100+i)),ops=Array.from({length:batches},(_,i)=>uid(base+i));
 const startEvent=uid(base+500),endEvent=uid(base+501),clockIn=uid(base+502),clockOut=uid(base+503);
 const sql=`do $dr199_template$ declare
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;s public.merchant_attendance_settings%rowtype;
  l public.merchant_attendance_locations%rowtype;template public.merchant_attendance_schedule_slots%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;event_row public.merchant_attendance_events%rowtype;
  relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  coverage_before jsonb;
  revision bigint;seq bigint;batch integer;pos integer;first_pos integer;last_pos integer;start_at timestamptz;end_at timestamptz;published timestamptz;
  pairs jsonb;refs jsonb;pair jsonb;slot_ids uuid[]:=array[${slots.map(quote).join(',')}];op_ids uuid[]:=array[${ops.map(quote).join(',')}];
  fmt3 constant text:='YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
 begin
  assert current_user='postgres','dr199_template_owned_postgres';
  ${captureCoverage?'coverage_before:='+eventCoverageRowsSql()+';':''}
  select * into w from public.merchant_attendance_workers where merchant_id=${quote(site)} and id=${quote(worker)} for update;
  select * into e from public.merchant_enterprise_employees where merchant_id=${quote(site)} and id=${quote(employee)} for share;
  select * into s from public.merchant_attendance_settings where merchant_id=${quote(site)} for update;
  select * into template from public.merchant_attendance_schedule_slots where merchant_id=${quote(site)} and id=${quote(sourceSlot)};
  select * into l from public.merchant_attendance_locations where merchant_id=${quote(site)} and id=template.location_id;
  assert w.employee_id=e.id and e.auth_user_id=${quote(auth)} and w.active and e.status='active' and template.worker_id=w.id;
  assert not exists(select 1 from public.merchant_attendance_schedule_slots where merchant_id=${quote(site)} and id=any(slot_ids));
  assert not exists(select 1 from public.merchant_attendance_schedule_commands where merchant_id=${quote(site)} and operation_id=any(op_ids));
  ${location===null?'':`assert not exists(select 1 from public.merchant_attendance_locations where merchant_id=${quote(site)} and id=${quote(location)});
  l.id:=${quote(location)};l.name:='Synthetic199 saved '||${quote(zone)}||' location';l.time_zone:=${quote(zone)};l.version:=1;
  insert into public.merchant_attendance_locations select(l).*;`}
  assert l.time_zone=${quote(zone)},'dr199_template_location_zone';
  select coalesce(max(command_row.revision),0) into revision from public.merchant_attendance_schedule_commands command_row where merchant_id=${quote(site)};
  for batch in 1..${batches} loop
   revision:=revision+1;pairs:='[]';refs:='[]';first_pos:=(batch-1)*32+1;last_pos:=least(batch*32,${count});
   published:=(${quote(workDate)}::date::timestamp at time zone ${quote(zone)})-interval '48 hours';
   for pos in first_pos..last_pos loop
    start_at:=(${quote(workDate)}::date::timestamp+make_interval(mins=>${overnight?1380:startMinutes}+(pos-1)*2)) at time zone ${quote(zone)};
    end_at:=start_at+${overnight?"interval '2 hours'":"interval '1 minute'"};
    pair:=jsonb_build_array(to_char(start_at at time zone 'UTC',fmt3),to_char(end_at at time zone 'UTC',fmt3));pairs:=pairs||jsonb_build_array(pair);
    refs:=refs||jsonb_build_array(jsonb_build_object('id',slot_ids[pos],'workDate',${quote(workDate)},'startAt',pair->0,'endAt',pair->1));
   end loop;
   insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
    values(${quote(site)},revision,op_ids[batch],${quote(owner)},jsonb_build_object('siteId',${quote(site)},'access','owner','workerId',w.id,
     'fromDate',${quote(workDate)},'throughDate',${quote(workDate)},'operationId',null),
     jsonb_build_object('operationId',op_ids[batch],'expectedRevision',revision-1,'expectedSettingsVersion',s.version,
      'reason','Synthetic199 history template; NOT a past real publication','action','publish','locationId',l.id,'timeZone',l.time_zone,'slots',pairs),published);
   for pos in first_pos..last_pos loop
    pair:=pairs->(pos-first_pos);slot_row:=template;slot_row.id:=slot_ids[pos];slot_row.revision:=revision;slot_row.location_id:=l.id;slot_row.location_name:=l.name;
    slot_row.time_zone:=l.time_zone;slot_row.work_date:=${quote(workDate)};slot_row.start_at:=(pair->>0)::timestamptz;slot_row.end_at:=(pair->>1)::timestamptz;
    insert into public.merchant_attendance_schedule_slots select(slot_row).*;
   end loop;
   insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,
    identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
    values(${quote(site)},revision,op_ids[batch],${quote(owner)},w.id,e.id,e.auth_user_id,'bound',w.version,l.id,l.version,s.version,l.time_zone,refs,published,published,'publish-identity-context-v1');
   for pos in first_pos..last_pos loop
    select * into slot_row from public.merchant_attendance_schedule_slots where merchant_id=${quote(site)} and id=slot_ids[pos];
    assert public.faolla_attendance_self_schedule_slot_v1(slot_row)->'slot'->'hasPublicationEvidence'='true'::jsonb,'dr199_template_full_publication_proof';
   end loop;
  end loop;
  ${!clock?'':`assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(site)} and id in(${quote(startEvent)},${quote(endEvent)}));
  select coalesce(max(sequence),0) into seq from public.merchant_attendance_events where merchant_id=${quote(site)} and worker_id=w.id;
  select * into event_row from public.merchant_attendance_events where merchant_id=${quote(site)} and id=${quote(sourceStart)};
  event_row.id:=${quote(startEvent)};event_row.operation_id:=${quote(clockIn)};event_row.sequence:=seq+1;
  event_row.occurred_at:=(${quote(workDate)}::date::timestamp+interval '12 hours') at time zone 'UTC';event_row.received_at:=event_row.occurred_at;
  insert into public.merchant_attendance_events select(event_row).*;
  select * into event_row from public.merchant_attendance_events where merchant_id=${quote(site)} and id=${quote(sourceEnd)};
  event_row.id:=${quote(endEvent)};event_row.operation_id:=${quote(clockOut)};event_row.sequence:=seq+2;
  event_row.occurred_at:=(${quote(workDate)}::date::timestamp+interval '13 hours') at time zone 'UTC';event_row.received_at:=event_row.occurred_at;
  insert into public.merchant_attendance_events select(event_row).*;
  --A source string/actor employee alone is NOT historical Auth proof. This
  --explicit legacy137 unselected receipt proves identity without inventing a
  --135 binding or145 adoption. The original full receipt checker must pass.
  select * into relation_row from public.merchant_attendance_shift_schedule_relations where merchant_id=${quote(site)} and start_event_id=${quote(sourceStart)};
  relation_row.start_event_id:=${quote(startEvent)};relation_row.operation_id:=${quote(clockIn)};relation_row.sequence:=seq+1;
  relation_row.occurred_at:=(${quote(workDate)}::date::timestamp+interval '12 hours') at time zone 'UTC';relation_row.recorded_at:=relation_row.occurred_at;
  relation_row.selection:=null;relation_row.slot_id:=null;relation_row.slot_revision:=null;relation_row.schedule_revision:=revision;relation_row.status:='unselected';
  relation_row.reason:=null;relation_row.slot_snapshot:=null;relation_row.publication_snapshot:=null;relation_row.cancellation_snapshot:=null;
  insert into public.merchant_attendance_shift_schedule_relations select(relation_row).*;
  perform public.faolla_attendance_self_schedule_receipt_v1(relation_row,e.auth_user_id);
  ${captureCoverage?eventCoverageProofSql({site,worker,employee,events:[{id:quote(startEvent),operationId:clockIn,sequence:'seq+1',action:'clock_in'},
   {id:quote(endEvent),operationId:clockOut,sequence:'seq+2',action:'clock_out'}]}):''}`}
  ${captureCoverage&&!clock?`assert ${eventCoverageRowsSql()}=coverage_before,'dr199_template_no_coverage_delta';`:''}
 end;$dr199_template$;set constraints all immediate;set constraints all deferred;select ${rows};`;
 return Object.freeze({sql,rows,derivedCoverageRows,totalRows:rows+derivedCoverageRows,slots,operations:ops,startEvent:clock?startEvent:null,endEvent:clock?endEvent:null,syntheticHistorical:true,actualHistoricalPublication:false,actualClockRequests:false});
}

export async function verifyDayReviewNative(ctx){
 const {d,h:inheritedH,native,scope,archive,periodArchive}=ctx;let h=inheritedH;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executeDayReviews}=require('../../src/lib/merchantAttendanceDayReview.server.ts');
 const {evaluateDayClassification}=require('../../src/lib/merchantAttendanceDayClassification.ts');
 const {parseCorrectionResult}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
 const {parseMissingBody,parseMissingResult}=require('../../src/lib/merchantAttendanceMissing.ts');
 const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
 const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
 const names=d.inventory(),hasEventCoverage=names.includes(eventCoverageTable),all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard;
 const own=['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries'];
 const writerTables=[...own,'merchant_attendance_calendar_entries','merchant_attendance_calendar_operations','merchant_attendance_events','merchant_attendance_shift_schedule_relations',
  'merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings','merchant_attendance_correction_decisions','merchant_attendance_correction_effects',
  'merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_missing_requests','merchant_attendance_missing_entries',
  'merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'];
 const outside=outageNativeFingerprintSql(names.filter(n=>!writerTables.includes(n)));
 //Mutable current binding probes are savepoint-isolated and checked in full on
 //restore. Every pre-existing append-only source row is protected at each RPC.
 const mutable=['merchants','merchant_attendance_workers','merchant_enterprise_employees','merchant_enterprise_roles','merchant_attendance_settings'];
 const protectedNames=names.filter(n=>!mutable.includes(n));
 const originals=`(select jsonb_object_agg(name,rows) from(${protectedNames.map(n=>`select ${quote(n)} name,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) old_rows)`;
 const preserve=protectedNames.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dr199_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'dr199_existing_row_changed:${n}';`).join('\n');
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const definitions=d.definitions(),catalog=d.tableCatalog(),connection=native.connect({lifetimeMs:dayReviewFixtureLimits.fixtureMs});
 let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,lastSourceDiagnostic=null,replayOnly=false,rolledBack=false;const groups=[],groupCounts=[];
 let priorSteps=0,priorRpcs=0;
 const finishGroup=index=>{const budget=dayReviewFixtureGroupBudgets[index],actual={name:budget.name,steps:steps-priorSteps,rpcs:rpcs-priorRpcs};
  assert(actual.steps<=budget.steps&&actual.rpcs<=budget.rpcs,'dr199_frozen_group_budget:'+JSON.stringify(actual));
  groups.push(budget.name);groupCounts.push(actual);priorSteps=steps;priorRpcs=rpcs;
  native.pass('199 group'+(index+1)+' '+budget.name+': '+actual.rpcs+' actual RPC/'+actual.steps+' SQL steps');};
 const next=()=>uid(++serial),site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId);
 const step=async(label,sql)=>{stage=label;assert(++steps<=dayReviewFixtureLimits.steps,'dr199_max220_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,replay=false,role='service_role',eventCapture=null}={})=>{
  const coverageProof=eventCapture===null||!hasEventCoverage?'':dayReviewClockCoverageSql(label,eventCapture);
  if(eventCapture!==null){assert.equal(write,true);assert.equal(replay,false);assert.equal(role,'service_role');}
  const callOutside=eventCapture===null||!hasEventCoverage?outside:outageNativeFingerprintSql(names.filter(n=>!writerTables.includes(n)&&n!==eventCoverageTable));
  assert(++rpcs<=dayReviewFixtureLimits.rpcs,'dr199_max180_actual_RPC');
  const r=JSON.parse(await step(label,`do $dr199_call$ declare old_hash text;outside_hash text;coverage_before jsonb;value jsonb;failure text;state_code text;context_text text;begin
   old_hash:=${all};outside_hash:=${callOutside};${hasEventCoverage?'coverage_before:='+eventCoverageRowsSql()+';':''}begin set local role ${role};assert current_user=${quote(role)};value:=${expression};
    set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dr199_read_rejection_replay_wrote';end if;
   assert ${callOutside}=outside_hash,'dr199_unrelated_table_changed';
   ${coverageProof===''?'':`if failure is null and not coalesce(value ? 'error',false) then ${coverageProof}end if;`}${preserve}
   perform set_config('faolla.dr199_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$dr199_call$;select current_setting('faolla.dr199_result')::jsonb;`));
  lastRpc={error:r.error??r.value?.error??null,sqlstate:r.sqlstate,context:r.context?.slice(0,6000)??null,
   protocol:r.value?.protocol??null,kind:r.value?.kind??null};
  if(r.value?.input&&r.value?.source)lastSourceDiagnostic=dayReviewNativeWorkDiagnostic(r.value);
  if(r.error||r.value?.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{const r=await call('actual199_'+(args.p_command?.action??args.p_query.mode),dayReviewNativeRpcExpression(name,args),{write:!!args.p_command,replay:replayOnly});
  return{data:r.value,error:r.error?{message:r.error}:null};}};
 const run=(query,command=null,actor=d.owner,enabled=true)=>executeDayReviews({query,command,authUserId:actor,moduleEnabled:enabled},service);
 const raw=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(r));assert(!r.value?.error,JSON.stringify(r));return r.value;};
 const previewQ=(workDate=h.slot.workDate,slotId=h.slot.id,caseId=null)=>({siteId:d.site,access:'owner',mode:'preview',workerId:h.workerId,workDate,slotId,caseId});
 const detailQ=(caseId,access='owner')=>({siteId:d.site,access,mode:'detail',caseId});
 const fresh=async(workDate,slotId=null,caseId=null)=>run(previewQ(workDate,slotId,caseId));
 const candidate=(view,outcome)=>evaluateDayClassification(view.input).candidates.find(c=>c.outcome===outcome);
 const observations=view=>evaluateDayClassification(view.input).observations;
 const decide=(view,outcome='follow_up',patch={})=>({action:'decide',operationId:next(),caseId:view.saved?.head.caseId??next(),expectedRevision:view.saved?.head.revision??0,
  workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,expectedFingerprint:view.input.source.fingerprint,outcome,
  calendarReference:outcome==='calendar_exempt'&&candidate(view,outcome).calendarReferences[0]?Object.fromEntries(Object.entries(candidate(view,outcome).calendarReferences[0]).filter(([k])=>['entryId','operationId','revision'].includes(k))):null,
  selfStatementOperationId:outcome==='not_worked_reported'?candidate(view,outcome).selfStatementReference?.operationId??null:null,
  reason:'Synthetic199 explicit administrative '+outcome,...patch});
 const append=async(view,outcome='follow_up',patch={},enabled=true)=>{const command=decide(view,outcome,patch),query=previewQ(view.input.target.workDate,view.input.target.slotId,view.saved?.head.caseId??null);
  const result=await run(query,command,d.owner,enabled);assert.equal(result.kind,'receipt');assert.equal(result.receipt.revision,command.expectedRevision+1);return{query,command,receipt:result.receipt};};
 const self=async(caseId,action='explain',claim='uncertain',enabled=false)=>{const query=detailQ(caseId,'self'),current=await run(query,null,h.employeeAuthUserId,false);
  const command={action,operationId:next(),expectedRevision:current.head.revision,decisionOperationId:current.head.latestDecision.receipt.operationId,claim:action==='dispute'?null:claim,reason:'Synthetic199 actual self '+action};
  const result=await run(query,command,h.employeeAuthUserId,enabled);assert.equal(result.kind,'receipt');return{query,command,receipt:result.receipt};};
 const deny=async(promise,code)=>{await assert.rejects(promise,e=>e?.code===code||e?.message===code,code);};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash,'dr199_probe_not_restored');
 const rawFacts=()=>step('raw_and_effect_facts',`select ${outageNativeFingerprintSql(names.filter(n=>n==='merchant_attendance_events'||n.includes('correction_effect')||n.includes('shift_plan')||n.includes('plan_posthoc')||n.includes('missing')))};`);
 let profile,mainHash,closureSaved,emptySaved,emptyOther,historyCase;
 const calendarQ=(locationId=null,entryId=null)=>({siteId:d.site,locationId,fromDate:null,throughDate:null,entryId,operationId:null,beforeAt:null,beforeId:null});
 const calendar=async({locationId=null,kind='closure',fromDate=h.slot.workDate,throughDate=fromDate}={})=>{
  const home=await raw('actual123_calendar_home',`public.faolla_attendance_calendar_v1(${json(calendarQ(locationId))},${owner},null,true)`);
  const command={operationId:next(),action:'create',reason:'Synthetic199 actual123 '+kind,kind,title:'Synthetic199 '+kind,fromDate,throughDate,
   expectedSettingsVersion:home.settingsVersion,locationId,expectedLocationVersion:home.locationVersion,timeZone:home.timeZone};
  const result=await raw('actual123_create',`public.faolla_attendance_calendar_v1(${json(calendarQ(locationId))},${owner},${json(command)},true)`,{write:true});
  return{command,query:calendarQ(locationId,command.operationId),result};};
 const cancel=entry=>raw('actual123_cancel',`public.faolla_attendance_calendar_v1(${json(entry.query)},${owner},${json({action:'cancel',operationId:next(),entryId:entry.command.operationId,expectedRevision:1,reason:'Synthetic199 actual123 cancellation'})},true)`,{write:true});
 const template=async(patch)=>{const value=dayReviewHistoricalTemplateSql({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,owner:d.owner,
  sourceSlot:h.slot.id,sourceStart:h.startEventId,sourceEnd:h.lastEventId,workDate:day(h.slot.workDate,1),...patch,captureCoverage:hasEventCoverage});
  assert.equal(await step('synthetic_history_template',value.sql),String(value.rows));return value;};
 const wire=q=>Object.fromEntries(Object.entries(q).filter(([k])=>k!=='siteId'));
 const correction=async(command=null)=>{const q={siteId:d.site,expectedWorkerId:h.workerId,mode:command?'detail':'prepare',...(command?{requestId:command.operationId,operationId:null}:{startEventId:h.startEventId})};
  return parseCorrectionResult(await raw('actual082_correction_'+(command?'submit':'prepare'),`public.faolla_attendance_correction_self_v3(${site},${auth},${json(wire(q))},${json(command)},true)`,{write:!!command}),command?{...q,operationId:command.operationId}:q,true,true);};
 const submitCorrection=async()=>{const prep=await correction(),command={action:'submit',operationId:next(),expectedRevision:prep.revision,expectedPolicyRevision:prep.rules.policy.revision,
  startEventId:h.startEventId,expectedLastEventId:h.lastEventId,proposal:{startAt:prep.basis.events[0].occurredAt,endAt:prep.basis.events.at(-1).occurredAt,breaks:[]},reason:'Synthetic199 actual pending correction'};
  //A real correction must differ from its original, without forging a clock.
  command.proposal.endAt=new Date(Date.parse(command.proposal.endAt)+60000).toISOString().replace('Z','000Z');await correction(command);return command;};
 const approveCorrection=async requestId=>{const q={siteId:d.site,requestId,operationId:null};const r=parseCurrentCorrectionDecision(await raw('actual096_owner_read',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},null,null,true)`),q);
  assert(r.canApprove,JSON.stringify(r));const command={action:'approve',operationId:next(),requestId,expectedRevision:r.review.application.item.revision,expectedEvidence:r.evidenceToken,reason:'Synthetic199 actual096 correction'};
  return parseCurrentCorrectionDecision(await raw('actual096_owner_approve',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},${json(command)},null,true)`,{write:true}),{...q,operationId:command.operationId});};
 try{
  profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';${dayReviewOriginalWorkAnchorSql(d.site,inheritedH)}do $dr199_begin$ begin
   assert current_user='postgres';assert not exists(select 1 from public.merchant_attendance_day_review_cases);
   assert not exists(select 1 from public.merchant_attendance_day_review_entries);perform set_config('faolla.dr199_originals',${originals}::text,true);end;$dr199_begin$;
   select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date::text,'workerSequence',(select max(sequence) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(h.workerId)}),
    'workAnchor',current_setting('faolla.dr199_work_anchor')::jsonb);`));
  h=dayReviewOriginalWorkContext(d.site,inheritedH,profile.workAnchor);
  mainHash=await step('main_baseline',`select ${all};`);
  //1: First preserve the real negative:207 explicitly revoked204 association,
  //so these two records must block199. Before a calendar is created, missing
  //closure cover is also expected; it must not be hidden or relabeled.
  const beforeAssociation=await fresh(h.slot.workDate,h.slot.id),negative=candidate(beforeAssociation,'calendar_exempt');
  assert.equal(negative.candidateState,'blocked');assert(negative.blockers.includes('unassociated_record'));
  const unassociated=beforeAssociation.input.source.records.filter(r=>!r.association||r.association.slotId!==h.slot.id);
  assert.deepEqual(unassociated.map(r=>[r.kind,r.sourceId]).sort(),[['session',id(204710)],['missing',id(204715)]].sort());
  //Actual171 independently re-checks current owner, real approval, period-open,
  //source identity and availability. Its calendar_entry guard means this must
  //precede the actual123 closure; no guard or existing row is bypassed.
  const posthocQuery={siteId:d.site,workerId:h.workerId,slotId:h.slot.id,mode:'detail',operationId:null};
  const posthoc=async command=>projectPlanPosthocResult(await raw('actual171_'+(command?'apply':'detail'),
   `public.faolla_attendance_plan_posthoc_adoption_v1(${json(posthocQuery)},${owner},${json(command)},true)`,{write:!!command}),posthocQuery,d.owner,command);
  const posthocDetail=await posthoc(null),posthocCommand=dayReviewPosthocReassociationCommand(posthocDetail,h,next()),posthocSaved=await posthoc(posthocCommand);
  assert.deepEqual(posthocSaved.receipt.command,posthocCommand);assert.deepEqual(posthocSaved.current.sources,posthocCommand.sources);
  assert.equal(posthocSaved.revision,posthocDetail.revision+1);
  //The immutable historical/raw baseline for199 starts after this disclosed
  //legal append. mainHash and every original-row prefix remain pre-setup, so
  //the final complete rollback still protects all inherited facts exactly.
  const rawBefore=await rawFacts();
  //Existing explicitly synthetic published plan; create/cancel/self/decide
  //are all actual original RPCs. Opening self detail has no acknowledgement.
  const closing=await calendar(),plan=await fresh(h.slot.workDate,h.slot.id);assert.equal(candidate(plan,'calendar_exempt').candidateState,'candidate',
   'dr199_calendar_candidate_expectation:'+JSON.stringify(dayReviewNativeCandidateDiagnostic(plan,evaluateDayClassification(plan.input))));
  closureSaved=await append(plan,'calendar_exempt');const first=await run(detailQ(closureSaved.receipt.caseId,'self'),null,h.employeeAuthUserId,false);
  assert.equal(first.head.needsResponse,false);assert.equal(first.head.latestDecision.outcome,'calendar_exempt');
  assert(first.head.latestDecision.observations.includes('recorded_work'),'dr199_closed_work_expectation:'+JSON.stringify({
   source:lastSourceDiagnostic,preview:dayReviewNativeWorkDiagnostic(plan),pureObservations:observations(plan),saved:dayReviewNativeWorkDiagnostic(first)}));
  const dispute=await self(first.head.caseId,'dispute'),needs=await run(detailQ(first.head.caseId));assert.equal(needs.head.needsResponse,true);assert.equal(needs.head.latestSelf.receipt.operationId,dispute.command.operationId);
  const afterDispute=await fresh(h.slot.workDate,h.slot.id,first.head.caseId);assert.equal(candidate(afterDispute,'calendar_exempt').candidateState,'candidate');
  const revised=await append(afterDispute,'calendar_exempt');assert.equal(revised.receipt.revision,3);assert.equal((await run(detailQ(first.head.caseId))).head.needsResponse,false);
  assert.deepEqual((await run({siteId:d.site,mode:'recover',operationId:closureSaved.command.operationId},null,d.owner,false)).receipt,closureSaved.receipt);
  assert.equal(await rawFacts(),rawBefore);finishGroup(0);
  //2: Empty ended days are not conclusions of absence. Each explanation is an
  //actual self write, permitted for existing cases with the new-decide flag off.
  const emptyDay=day(h.slot.workDate,1),otherDay=day(h.slot.workDate,-1),empty=await fresh(emptyDay);assert.deepEqual(observations(empty),['no_record']);
  assert.equal(candidate(empty,'not_worked_reported').candidateState,'blocked');emptySaved=await append(empty);historyCase=emptySaved.receipt.caseId;
  await self(historyCase,'explain','worked_missing_records');const pendingSelf=await fresh(emptyDay,null,historyCase);assert.equal(candidate(pendingSelf,'not_worked_reported').candidateState,'blocked');
  emptyOther=await append(await fresh(otherDay));const statement=await self(emptyOther.receipt.caseId,'explain','not_worked');const noWork=await fresh(otherDay,null,emptyOther.receipt.caseId);
  assert.equal(candidate(noWork,'not_worked_reported').selfStatementReference.operationId,statement.command.operationId);await append(noWork,'not_worked_reported');
  const contrary=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId);
  await deny(run(previewQ(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId),decide(contrary,'not_worked_reported',{selfStatementOperationId:statement.command.operationId})),'attendance_day_review_ineligible');
  assert.equal(await rawFacts(),rawBefore);finishGroup(1);
  //3: Actual real-now clock transitions. No fabricated clock_out is inserted;
  //the whole branch rolls back before later historical source checks.
  const clockHash=await save('dr199_clock'),todayBefore=await fresh(profile.today),sequence=profile.workerSequence;
  const clock=async(action,expectedSequence)=>{const command={operationId:next(),expectedWorkerId:h.workerId,locationId:h.slot.locationId,action,expectedSequence};
   return raw((action==='clock_in'?'actual137_':'actual111_')+action,action==='clock_in'
    ?`public.faolla_attendance_self_schedule_v1(${site},${auth},${json(command)},null,null,true,false)`
    :`public.faolla_attendance_self_v1(${site},${auth},${json(command)},null)`,{write:true,eventCapture:{site:d.site,worker:h.workerId,employee:h.employeeId,command}});};
  await clock('clock_in',sequence);const working=await fresh(profile.today);assert(observations(working).includes('open_record'));assert(observations(working).includes('unassociated_record'));
  const staleToday=decide(todayBefore);await deny(run(previewQ(profile.today,null),staleToday),'attendance_day_review_source_changed');
  await clock('break_start',sequence+1);const breaking=await fresh(profile.today);assert(observations(breaking).includes('open_record'));
  await restore('dr199_clock',clockHash);
  const pendingHash=await save('dr199_pending'),beforeCorrection=await fresh(h.slot.workDate,h.slot.id),correctionCommand=await submitCorrection();
  const pendingCorrection=await fresh(h.slot.workDate,h.slot.id);assert(pendingCorrection.input.source.pending.some(p=>p.kind==='correction'&&p.sourceId===correctionCommand.operationId));assert(observations(pendingCorrection).includes('pending_source'));
  await deny(run(previewQ(h.slot.workDate,h.slot.id),decide(beforeCorrection)),'attendance_day_review_source_changed');await approveCorrection(correctionCommand.operationId);
  const corrected=await fresh(h.slot.workDate,h.slot.id);assert.notEqual(corrected.input.source.fingerprint,pendingCorrection.input.source.fingerprint);assert(corrected.input.source.records.some(r=>r.operationId!==null));
  await restore('dr199_pending',pendingHash);
  const leaveHash=await save('dr199_leave');await step('explicit_synthetic_leave_role',`do $dr199_role$ declare r public.merchant_enterprise_roles%rowtype;e public.merchant_enterprise_employees%rowtype;begin
   select * into e from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(h.employeeId)};select * into r from public.merchant_enterprise_roles where merchant_id=${site} and id=e.role_id;
   r.id:=${quote(uid(9000))};r.name:='Synthetic199 explicit leave permission';r.permissions:=array(select distinct unnest(r.permissions||array['attendance.self.leave']));
   insert into public.merchant_enterprise_roles select(r).*;update public.merchant_enterprise_employees set role_id=r.id where merchant_id=${site} and id=e.id;end;$dr199_role$;select 1;`);
  const leaveService={rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_leave_v1');const r=await call('actual122_'+(args.p_command?.action??'read'),`public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`,{write:!!args.p_command});return{data:r.value,error:r.error?{message:r.error}:null};}};
  const leaveQ=(access='self',requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  const leaveHome=await executeLeave({query:leaveQ(),command:null,authUserId:h.employeeAuthUserId,allowWrite:true},leaveService);assert(leaveHome.canSubmit);
  const leaveCmd={action:'submit',operationId:next(),reason:'Synthetic199 actual work leave conflict',expectedWorkerId:h.workerId,expectedSettingsVersion:leaveHome.settingsVersion,timeZone:leaveHome.timeZone,
   startAt:h.slot.workDate+'T08:00:00.000Z',endAt:h.slot.workDate+'T09:00:00.000Z'};
  await executeLeave({query:leaveQ(),command:leaveCmd,authUserId:h.employeeAuthUserId,allowWrite:true},leaveService);
  await executeLeave({query:leaveQ('owner',leaveCmd.operationId),command:{action:'approve',operationId:next(),requestId:leaveCmd.operationId,expectedRevision:1,reason:'Synthetic199 actual approved overlap'},authUserId:d.owner,allowWrite:true},leaveService);
  const conflicting=await fresh(h.slot.workDate,h.slot.id);assert(observations(conflicting).includes('source_conflict'));assert(conflicting.input.source.conflicts.some(c=>c.kind==='work_leave'&&c.sourceIds.includes(leaveCmd.operationId)));
  await restore('dr199_leave',leaveHash);assert.equal(await rawFacts(),rawBefore);finishGroup(2);
  //4: Real calendar scopes and immutable saved-zone full-slot templates.
  const correctLocation=await calendar({locationId:h.slot.locationId});const locationView=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId);
  assert(candidate(locationView,'calendar_exempt').calendarReferences.some(r=>r.entryId===correctLocation.command.operationId));
  const holiday=await calendar({kind:'holiday'}),holidayView=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId);
  assert(!candidate(holidayView,'calendar_exempt').calendarReferences.some(r=>r.entryId===holiday.command.operationId));
  await deny(run(previewQ(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId),decide(holidayView,'calendar_exempt',{
   calendarReference:{entryId:holiday.command.operationId,operationId:holiday.command.operationId,revision:1}})),'attendance_day_review_ineligible');
  await cancel(correctLocation);assert(!candidate(await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId),'calendar_exempt').calendarReferences.some(r=>r.entryId===correctLocation.command.operationId));
  const overnightHash=await save('dr199_overnight'),overnight=await template({count:1,base:12000,overnight:true});const partial=await calendar({fromDate:emptyDay});
  const overnightView=await fresh(emptyDay,overnight.slots[0]);assert(overnightView.input.target.toAt>day(emptyDay,1)+'T00:00:00.000000Z');assert.equal(candidate(overnightView,'calendar_exempt').candidateState,'blocked');
  assert(!candidate(overnightView,'calendar_exempt').calendarReferences.some(r=>r.entryId===partial.command.operationId));await restore('dr199_overnight',overnightHash);
  const dstHash=await save('dr199_dst'),dst=await template({count:1,base:14000,zone:'Europe/Madrid',location:uid(14500),workDate:'2026-03-29',startMinutes:30});
  const wrongZone=await calendar({fromDate:'2026-03-29'}),wrongZoneView=await fresh('2026-03-29',dst.slots[0]);
  assert(wrongZoneView.input.target.fromAt<'2026-03-29T00:00:00.000000Z');assert.equal(candidate(wrongZoneView,'calendar_exempt').candidateState,'blocked');
  assert(!candidate(wrongZoneView,'calendar_exempt').calendarReferences.some(r=>r.entryId===wrongZone.command.operationId));
  const dstCalendar=await calendar({locationId:uid(14500),fromDate:'2026-03-29'}),dstView=await fresh('2026-03-29',dst.slots[0]);
  assert.equal(dstView.input.target.timeZone,'Europe/Madrid');assert.equal(candidate(dstView,'calendar_exempt').candidateState,'candidate');
  const dstEntry=dstView.input.source.calendar.find(c=>c.entryId===dstCalendar.command.operationId);assert.equal(Date.parse(dstEntry.toAt)-Date.parse(dstEntry.fromAt),23*3600000);
  const wrongLocation=await calendar({locationId:uid(14500)}),originalLocation=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId);
  assert(!candidate(originalLocation,'calendar_exempt').calendarReferences.some(r=>r.entryId===wrongLocation.command.operationId));
  const touching=await calendar({fromDate:day(h.slot.workDate,-1)}),fullDay=await fresh(h.slot.workDate);
  assert.equal(fullDay.input.target.fromAt,h.slot.workDate+'T00:00:00.000000Z');assert(!fullDay.input.source.calendar.some(c=>c.entryId===touching.command.operationId));
  await restore('dr199_dst',dstHash);finishGroup(3);
  //5: Exact whole-day includes both new plans plus a disclosed out-of-plan
  //historical pair.101 guard is an error, never a fabricated complete empty day.
  const twoHash=await save('dr199_two'),two=await template({count:2,base:16000,clock:true}),whole=await run({siteId:d.site,access:'owner',mode:'candidates',workerId:h.workerId,workDate:emptyDay});
  assert.equal(whole.input.source.plans.length,2);assert(whole.input.source.records.some(r=>r.sourceId===two.startEvent&&r.association===null));assert(observations(whole).includes('unassociated_record'));
  const one=await fresh(emptyDay,two.slots[0]);assert.equal(one.input.source.plans.length,1);assert.equal(one.input.target.slotId,two.slots[0]);
  assert.equal(one.input.target.fromAt,whole.input.source.plans.find(p=>p.slotId===two.slots[0]).startAt);
  await restore('dr199_two',twoHash);
  const capacityHash=await save('dr199_capacity');const capacity=await template({count:101,base:18000});assert.equal(capacity.rows,109);
  const tooLarge=await call('actual199_101_fail_closed',dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{p_query:previewQ(emptyDay,null),p_auth_user_id:d.owner,p_command:null,p_allow_write:true}));
  assert(tooLarge.error&&/too_large|ineligible/.test(tooLarge.error),JSON.stringify(tooLarge));assert.equal(tooLarge.value,null);await restore('dr199_capacity',capacityHash);
  const identityHash=await save('dr199_identity');await step('synthetic_current_rebinding',`update public.merchant_enterprise_employees set auth_user_id=${quote(uid(9500))} where merchant_id=${site} and id=${quote(h.employeeId)};select 1;`);
  const identityDenied=await call('actual199_unproven_historical_identity',dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{
   p_query:previewQ(h.slot.workDate,h.slot.id),p_auth_user_id:d.owner,p_command:null,p_allow_write:true}));
  assert(identityDenied.error&&/identity|worker_changed|invalid|ineligible/.test(identityDenied.error),JSON.stringify(lastRpc));assert.equal(identityDenied.value,null);
  await restore('dr199_identity',identityHash);finishGroup(4);
  //6: Real calendar cancellation changes only source, self response only head.
  const oldView=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId),oldCommand=decide(oldView,'calendar_exempt');await cancel(closing);
  const changed=await fresh(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId);assert.equal(changed.sourceChanged,true);assert.notEqual(changed.input.source.fingerprint,oldView.input.source.fingerprint);
  await deny(run(previewQ(h.slot.workDate,h.slot.id,closureSaved.receipt.caseId),oldCommand),'attendance_day_review_source_changed');
  const nextSaved=await append(changed),priorHead=await fresh(h.slot.workDate,h.slot.id,nextSaved.receipt.caseId),priorCommand=decide(priorHead);await self(nextSaved.receipt.caseId,'explain','uncertain');
  const nextHead=await fresh(h.slot.workDate,h.slot.id,nextSaved.receipt.caseId);assert.equal(nextHead.input.source.fingerprint,priorHead.input.source.fingerprint);assert.equal(nextHead.saved.head.needsResponse,true);
  await deny(run(previewQ(h.slot.workDate,h.slot.id,nextSaved.receipt.caseId),priorCommand),'attendance_day_review_head_changed');await append(nextHead);
  const missingHash=await save('dr199_missing'),missingBefore=await fresh(emptyDay,null,historyCase);
  const missingQ=(access='self',requestId=null)=>({siteId:d.site,access,fromDate:profile.today,throughDate:profile.today,requestId,operationId:null,beforeAt:null,beforeId:null});
  const missing=async(query,command=null)=>{if(command!==null)parseMissingBody({query,command});
   return parseMissingResult(await raw('actual100_missing_'+(command?.action??'read'),`public.faolla_attendance_missing_v1(${json(query)},${query.access==='owner'?owner:auth},${json(command)},true)`,{write:!!command}),
    command?{...query,operationId:command.operationId}:query,false);};
  const missingHome=await missing(missingQ());assert(missingHome.canRequest);
  const missingCommand={action:'submit',operationId:next(),reason:'Synthetic199 actual source-state change',expectedWorkerId:h.workerId,expectedSettingsVersion:missingHome.settingsVersion,
   expectedPolicyRevision:missingHome.policyRevision,locationId:missingHome.locationId,timeZone:missingHome.timeZone,
   proposal:{startAt:emptyDay+'T08:00:00.000000Z',endAt:emptyDay+'T09:00:00.000000Z',breaks:[]}};
  await missing(missingQ(),missingCommand);const missingPending=await fresh(emptyDay,null,historyCase);assert(missingPending.input.source.pending.some(p=>p.kind==='missing'&&p.sourceId===missingCommand.operationId));
  const review=await missing(missingQ('owner',missingCommand.operationId));assert(review.detail.canApprove,JSON.stringify(review.detail.issues));
  const approval={action:'approve',operationId:next(),requestId:missingCommand.operationId,expectedRevision:1,evidenceToken:review.detail.evidenceToken,reason:'Synthetic199 original missing approval'};
  await missing(missingQ('owner',missingCommand.operationId),approval);const missingApproved=await fresh(emptyDay,null,historyCase);
  assert(missingApproved.input.source.records.some(r=>r.kind==='missing'&&r.sourceId===missingCommand.operationId&&r.operationId===approval.operationId));
  assert.notEqual(missingApproved.input.source.fingerprint,missingPending.input.source.fingerprint);assert.notEqual(missingPending.input.source.fingerprint,missingBefore.input.source.fingerprint);
  const missingPlan=await template({count:1,base:20000,startMinutes:480}),missingPlanView=await fresh(emptyDay,missingPlan.slots[0]);
  assert(missingPlanView.input.source.records.some(r=>r.kind==='missing'&&r.sourceId===missingCommand.operationId&&r.operationId===approval.operationId));
  await restore('dr199_missing',missingHash);
  assert.deepEqual((await run({siteId:d.site,mode:'recover',operationId:closureSaved.command.operationId},null,d.owner,false)).receipt,closureSaved.receipt);finishGroup(5);
  //7: Exactly26 actual self appends force history25+1. Original receipt is
  //recovered with current ownership/binding lost and new-write flag false.
  let lastSelf;for(let n=0;n<25;n++)lastSelf=await self(historyCase,'explain',n%2?'uncertain':'worked_missing_records');
  const page1=await run({siteId:d.site,access:'self',mode:'history',caseId:historyCase,beforeRevision:null},null,h.employeeAuthUserId,false);assert.equal(page1.items.length,25);assert(page1.nextRevision!==null);
  const page2=await run({siteId:d.site,access:'self',mode:'history',caseId:historyCase,beforeRevision:page1.nextRevision},null,h.employeeAuthUserId,false);
  const history=[...page1.items,...page2.items];assert.equal(history.length,page1.head.revision);assert.equal(new Set(history.map(e=>e.receipt.operationId)).size,history.length);assert.equal(history.at(-1).receipt.revision,1);assert.equal(page2.nextRevision,null);
  replayOnly=true;try{assert.deepEqual((await run(closureSaved.query,closureSaved.command,d.owner,false)).receipt,closureSaved.receipt);}finally{replayOnly=false;}
  await deny(run(closureSaved.query,{...closureSaved.command,reason:'Different intent'},d.owner,true),'attendance_operation_conflict');
  await deny(run(closureSaved.query,closureSaved.command,h.employeeAuthUserId,true),'attendance_invalid_request');
  await deny(run(closureSaved.query,closureSaved.command,uid(9700),true),'attendance_operation_conflict');
  const lostHash=await save('dr199_lost_owner');await step('synthetic_owner_handoff',`update public.merchants set user_id=${quote(uid(9600))} where id=${site};select 1;`);
  assert.deepEqual((await run({siteId:d.site,mode:'recover',operationId:closureSaved.command.operationId},null,d.owner,false)).receipt,closureSaved.receipt);
  replayOnly=true;try{assert.deepEqual((await run(closureSaved.query,closureSaved.command,d.owner,false)).receipt,closureSaved.receipt);}finally{replayOnly=false;}
  await deny(run(detailQ(closureSaved.receipt.caseId)),'attendance_access_denied');await restore('dr199_lost_owner',lostHash);
  const selfBindingHash=await save('dr199_lost_self_binding'),newAuth=uid(9650);assert(lastSelf);
  await step('synthetic_self_binding_handoff',`update public.merchant_enterprise_employees set auth_user_id=${quote(newAuth)} where merchant_id=${site} and id=${quote(h.employeeId)};select 1;`);
  assert.deepEqual((await run({siteId:d.site,mode:'recover',operationId:lastSelf.command.operationId},null,h.employeeAuthUserId,false)).receipt,lastSelf.receipt);
  replayOnly=true;try{assert.deepEqual((await run(lastSelf.query,lastSelf.command,h.employeeAuthUserId,false)).receipt,lastSelf.receipt);}finally{replayOnly=false;}
  await deny(run(detailQ(historyCase,'self'),null,h.employeeAuthUserId,false),'attendance_access_denied');
  await deny(run(detailQ(historyCase,'self'),null,newAuth,false),'attendance_access_denied');
  await deny(run({siteId:d.site,mode:'recover',operationId:lastSelf.command.operationId},null,newAuth,false),'attendance_operation_not_found');
  await restore('dr199_lost_self_binding',selfBindingHash);
  const gateView=await fresh(otherDay,null,emptyOther.receipt.caseId);await deny(run(previewQ(otherDay,null,emptyOther.receipt.caseId),decide(gateView),d.owner,false),'attendance_module_disabled');
  finishGroup(6);
  //8: Actual Node source and saved projection already cover every above RPC.
  //Browser390px/dirty/late response is intentionally a separate evidence layer.
  for(const role of['anon','authenticated']){const denied=await call('199_private_acl_'+role,dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{p_query:detailQ(closureSaved.receipt.caseId),p_auth_user_id:d.owner,p_command:null,p_allow_write:false}),{role});assert.equal(denied.sqlstate,'42501');}
  const immutable=JSON.parse(await step('199_immutable_and_saved_source',`do $dr199_guard$ declare changed boolean:=false;bad boolean:=false;begin
   begin update public.merchant_attendance_day_review_entries set entry=entry where merchant_id=${site};exception when others then assert sqlerrm='attendance_day_review_immutable';changed:=true;end;
   begin delete from public.merchant_attendance_day_review_cases where merchant_id=${site};exception when others then assert sqlerrm='attendance_day_review_immutable';bad:=true;end;
   assert changed and bad;${preserve}end;$dr199_guard$;
   select jsonb_build_object('hashesValid',not exists(select 1 from public.merchant_attendance_day_review_entries where action='decide'
    and(source_text<>canonical::text or source_fingerprint<>encode(sha256(convert_to(source_text,'UTF8')),'hex') or normalized_input->'source'->>'fingerprint'<>source_fingerprint)),
    'noNewPeriods',not exists(select 1 from public.merchant_attendance_period_closures x where not exists(select 1 from jsonb_array_elements(current_setting('faolla.dr199_originals')::jsonb->'merchant_attendance_period_closures') prior where prior.value=to_jsonb(x))));`));
  assert.equal(immutable.hashesValid,true);assert.equal(immutable.noNewPeriods,true);assert.equal(await rawFacts(),rawBefore);finishGroup(7);
  native.pass('199 eight finite real SQL/Node groups completed in rollback-only transaction; browser/Auth remain separate');
  await step('rollback','rollback;select 1;');rolledBack=true;
 }catch(error){throw new Error('day_review_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc));}
 finally{try{if(!rolledBack)await connection.step(scope.sql('rollback;'));}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  if(mainHash!==undefined)assert.equal(d.exec('begin;'+prefix+'select '+all+';rollback;'),mainHash,'dr199_full_main_rollback_not_restored');
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
 assert.equal(groups.length,8);assert(steps<=220&&rpcs<=180);assert(mainHash!==undefined);
 return{groups,groupCounts,steps,rpcs,reads,writes,rejections,rollbackRestored:true,syntheticHistoryTemplates:true,maxTemplateRows:109,
  eventCoverage:{installed:hasEventCoverage,actualClockEvents:2,actualClockTriggerRows:hasEventCoverage?2:0,syntheticTemplateEvents:2,
   syntheticTemplateDirectRows:7,syntheticTemplateTriggerRows:hasEventCoverage?2:0,syntheticTemplateTotalRows:hasEventCoverage?9:7},
  actualHistoricalPublication:false,actualHistoricalClock:false,newDatabase:false,realAuth:false,browser:false,
  trustedProofBoundary:{sql:'Actual transactional full-source recollection proves historical Auth, association and exclusive claims; Node is not an alternative authority',
   node:'Actual production projector validates exact wire, legacy collectors, canonical/SHA, endpoints and bounded normalized collections; compact missing fields remain SQL-proven'},
  missingCoverage:['390px/dirty/hidden/scope late response requires separate actual browser fixture','real Auth/phone/hardware requires user pilot accounts'],cleanupOwnedByParent:true};
}

//Only after the main rollback and full old-facts/archive guard succeeds. One
//actual holder + one actual waiter, exact backend blocker evidence. The winner
//commits just one199 case and one199 entry; old tables are never written here.
export async function verifyDayReviewNativeRace(ctx){
 const {d,h:inheritedH,native,scope}=ctx;let h=inheritedH;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const names=d.inventory(),own=['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries'],outsideNames=names.filter(n=>!own.includes(n));
 const read=sql=>d.exec('begin;'+periodContinuationSerialization+sql+'rollback;');
 const baseline=JSON.parse(read(dayReviewOriginalWorkAnchorSql(d.site,inheritedH)+"select jsonb_build_object('old',"+outageNativeFingerprintSql(outsideNames)+",'workAnchor',current_setting('faolla.dr199_work_anchor')::jsonb);"));
 h=dayReviewOriginalWorkContext(d.site,inheritedH,baseline.workAnchor);
 const old=baseline.old,definitions=d.definitions(),catalog=d.tableCatalog();
 const query={siteId:d.site,access:'owner',mode:'preview',workerId:h.workerId,workDate:day(h.slot.workDate,1),slotId:null,caseId:null};
 const view=JSON.parse(read('set local role service_role;select public.faolla_attendance_day_review_v1('+json(query)+','+quote(d.owner)+',null,true);reset role;'));
 assert.equal(view.input.source.records.length,0);assert.equal(view.input.source.plans.length,0);assert.equal(view.saved,null);
 const command={action:'decide',operationId:uid(49000),caseId:uid(49001),expectedRevision:0,workerId:h.workerId,employeeId:h.employeeId,
  employeeAuthUserId:h.employeeAuthUserId,expectedFingerprint:view.input.source.fingerprint,outcome:'follow_up',calendarReference:null,selfStatementOperationId:null,reason:'Synthetic199 actual same-head race'};
 const expression=c=>dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{p_query:query,p_auth_user_id:d.owner,p_command:c,p_allow_write:true});
 const prefix=periodContinuationSerialization+d.guard+"set local lock_timeout='3s';set local statement_timeout='10s';set local role service_role;";
 const counts=read('select jsonb_build_array((select count(*) from public.merchant_attendance_day_review_cases),(select count(*) from public.merchant_attendance_day_review_entries));');
 const race=await lifecycleRace({connect:()=>native.connect(),query:native.query,sql:scope.sql},prefix+'select '+expression(command)+';reset role;set constraints all immediate;',
  prefix+`do $dr199_waiter$ begin begin perform ${expression({...command,operationId:uid(49002)})};raise exception 'dr199_competing_head_accepted';
   exception when others then assert sqlerrm='attendance_day_review_head_changed',sqlerrm;end;end;$dr199_waiter$;reset role;select 1;`);
 assert(race.witnessed);assert.equal(race.right.error,null);const receipt=JSON.parse(race.left);assert.equal(receipt.receipt.operationId,command.operationId);
 assert.equal(read('select '+outageNativeFingerprintSql(outsideNames)+';'),old,'dr199_race_old_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
 const after=JSON.parse(read('select jsonb_build_array((select count(*) from public.merchant_attendance_day_review_cases),(select count(*) from public.merchant_attendance_day_review_entries));'));
 assert.deepEqual(after,JSON.parse(counts).map(n=>n+1));assert.equal(read('select count(*) from public.merchant_attendance_day_review_entries where operation_id='+quote(uid(49002))+';'),'0');
 native.pass('199 exact PID settings-lock race: one owner decide saved, stale peer rejected; only2 own rows committed until parent namespace cleanup');
 return{groups:1,witnessed:true,connections:2,sqlStepsUpperBound:12,oldTablesUnchanged:true,committedOwnRows:2,rollbackOnly:false,cleanupOwnedByParent:true};
}
