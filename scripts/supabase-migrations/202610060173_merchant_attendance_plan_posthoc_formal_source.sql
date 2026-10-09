--206 independently callable formal-source foundation. No decision, period,
--notification, old source function or business ledger is modified here.
begin;
set local lock_timeout='3s';
do $formal_source_prerequisites$
declare installed boolean;signature text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610060172 and name='merchant_attendance_plan_posthoc_evaluation')
    or to_regprocedure('public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone)') is null
    or to_regprocedure('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)') is null then raise exception 'merchant_attendance_plan_posthoc_formal_source_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060173 and name='merchant_attendance_plan_posthoc_formal_source') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060173 and name<>'merchant_attendance_plan_posthoc_formal_source') then raise exception 'merchant_attendance_plan_posthoc_formal_source_installation_conflict';end if;
  foreach signature in array array[
    'public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)',
    'public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb,jsonb,jsonb)',
    'public.faolla_attendance_plan_posthoc_formal_compute_v1(jsonb)',
    'public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(signature) is not null) then raise exception 'merchant_attendance_plan_posthoc_formal_source_installation_conflict';end if;
  end loop;
end;
$formal_source_prerequisites$;

--PRIVATE collector based on172 main, deliberately retaining that version's
--complete171 baseline, exact-ID observations, fixed140 and current leave proof.
--Only difference: a seal is a mutation gate, not a change in attendance facts.
--Normalize it BEFORE aggregating derived unavailable flags; hidden location and
--moved-out pending checks still come from the SAME single baseline collection.
create or replace function public.faolla_attendance_plan_posthoc_formal_facts_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare baseline jsonb;basis jsonb;worker_item jsonb;slot_item jsonb;posthoc_item jsonb;observations jsonb:='[]';observation jsonb;snapshot jsonb;
  saved_operation public.merchant_attendance_plan_posthoc_operations%rowtype;full_approval jsonb;approval_item jsonb;compact_approval jsonb;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_head public.merchant_attendance_leave_entries%rowtype;leave_summary jsonb;
  leave_ids uuid[];leave_items jsonb:='[]';leave_context jsonb;leave_limited boolean;flags text[]:=array[]::text[];resolution_blockers jsonb;
  source jsonb;source_text text;site text:=p_query->>'siteId';wid uuid:=(p_query->>'workerId')::uuid;sid uuid:=(p_query->>'slotId')::uuid;
  employee uuid;member_auth uuid;plan_begin timestamptz;plan_end timestamptz;observed timestamptz;read_at timestamptz;part jsonb;
  current_candidate jsonb;candidate_blockers jsonb;observation_blockers jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  baseline:=public.faolla_attendance_plan_posthoc_adoption_v1(p_query||jsonb_build_object('mode','detail','operationId',null),p_auth_user_id,null,false);
  if baseline->>'actorId' is distinct from p_auth_user_id::text or baseline->>'siteId' is distinct from site or baseline->'current'='null'::jsonb then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  basis:=baseline->'preview'->'source'->'basis';worker_item:=baseline->'worker';slot_item:=baseline->'slot';
  employee:=(worker_item->>'employeeId')::uuid;member_auth:=(worker_item->>'employeeAuthUserId')::uuid;
  plan_begin:=(slot_item->>'startAt')::timestamptz;plan_end:=(slot_item->>'endAt')::timestamptz;observed:=(baseline->>'readAt')::timestamptz;
  select * into saved_operation from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=(baseline->'current'->>'operationId')::uuid;
  if public.faolla_attendance_plan_posthoc_operation_v1(saved_operation) is distinct from baseline->'current'
    or row(saved_operation.worker_id,saved_operation.slot_id,saved_operation.employee_id,saved_operation.employee_auth_user_id)
      is distinct from row(wid,sid,employee,member_auth) then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  posthoc_item:=jsonb_build_object('revision',baseline->'revision','current',baseline->'current',
    'selected',coalesce(saved_operation.selected,'[]'::jsonb),'approval',saved_operation.approval);
  compact_approval:=saved_operation.approval;
  if compact_approval is not null then
    full_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,(compact_approval->>'operationId')::uuid);
    approval_item:=jsonb_build_object('operationId',full_approval->'operationId','revision',full_approval->'revision','sourceId',full_approval->'sourceId',
      'sourceSha256',full_approval->'sourceSha256','recordedAt',full_approval->'recordedAt','source',full_approval->'source');
    if (approval_item-'source') is distinct from compact_approval then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  else approval_item:=nullif(basis->'approval','null'::jsonb);end if;
  if saved_operation.action is distinct from 'apply' then flags:=array_append(flags,'posthoc_inactive');
  else
    if jsonb_array_length(saved_operation.selected)>10 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
    for snapshot in select snapshot_rows.value from jsonb_array_elements(saved_operation.selected) snapshot_rows(value) loop
      observation:=public.faolla_attendance_plan_posthoc_observation_v1(site,wid,employee,member_auth,slot_item,saved_operation.operation_id,approval_item,snapshot,observed);
      current_candidate:=nullif(observation->'current','null'::jsonb);
      if current_candidate is not null then
        candidate_blockers:=(current_candidate->'blockers')-'sealed';
        current_candidate:=current_candidate||jsonb_build_object('blockers',candidate_blockers,'available',candidate_blockers='[]'::jsonb);
        observation_blockers:=(observation->'blockers')-'source_unavailable';
        if candidate_blockers<>'[]'::jsonb then observation_blockers:=observation_blockers||'"source_unavailable"'::jsonb;end if;
        observation:=observation||jsonb_build_object('current',current_candidate,'blockers',observation_blockers);
      end if;
      observations:=observations||jsonb_build_array(observation);
      if observation->'blockers' ? 'source_changed' then flags:=array_append(flags,'source_changed');end if;
      if observation->'blockers' ? 'source_unavailable' then flags:=array_append(flags,'source_unavailable');end if;
    end loop;
  end if;
  leave_ids:=array(select requests.request_id from public.merchant_attendance_leave_requests requests
    where requests.merchant_id=site and requests.worker_id=wid and requests.start_at<plan_end and requests.end_at>plan_begin
    order by requests.start_at,requests.end_at,requests.request_id limit 101);
  leave_limited:=cardinality(leave_ids)>100 or (basis->'context'->'leave'->>'limited')::boolean;
  if not leave_limited then
    for leave_row in select requests.* from public.merchant_attendance_leave_requests requests where requests.merchant_id=site and requests.request_id=any(leave_ids) order by requests.request_id loop
      if row(leave_row.worker_id,leave_row.employee_id,leave_row.actor_auth_user_id) is distinct from row(wid,employee,member_auth) then raise exception 'attendance_worker_changed';end if;
      leave_summary:=public.faolla_attendance_leave_summary_v1(leave_row,null);
      select * into leave_head from public.merchant_attendance_leave_entries entries where entries.merchant_id=site and entries.request_id=leave_row.request_id order by entries.revision desc limit 1;
      if leave_head.operation_id is null or leave_summary->'revision' is distinct from to_jsonb(leave_head.revision) then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('requestId',leave_row.request_id,'operationId',leave_head.operation_id,
        'revision',leave_head.revision,'status',leave_summary->'status','startAt',to_char(leave_row.start_at at time zone 'UTC',fmt),
        'endAt',to_char(leave_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(leave_head.recorded_at at time zone 'UTC',fmt),'current',true));
    end loop;
  end if;
  leave_context:=jsonb_build_object('limited',leave_limited,'resolved',not leave_limited,'items',leave_items);
  if leave_limited or baseline->'preview'->'blockers' ? 'context_unknown' then flags:=array_append(flags,'context_unknown');end if;
  if exists(select 1 from jsonb_array_elements(baseline->'preview'->'candidates') candidate_rows(value)
    where candidate_rows.value->'reference'->>'kind'='session' and candidate_rows.value->'blockers' ? 'location_mismatch'
      and exists(select 1 from jsonb_array_elements(basis->'sessions') session_rows(value)
        where session_rows.value->>'startEventId'=candidate_rows.value->'reference'->>'startEventId')) then
    flags:=array_append(flags,'source_unavailable');end if;
  if baseline->'preview'->'blockers' ?| array['pending_correction','pending_missing'] then flags:=array_append(flags,'source_unavailable');end if;
  for part in select sections.value from jsonb_each(basis->'context') sections(key,value) loop
    if part->>'limited'='true' then flags:=array_append(flags,'context_unknown');end if;
  end loop;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.flag),'[]'::jsonb) into resolution_blockers from (select distinct unnest(flags) as flag) flag_rows;
  source:=jsonb_build_object('protocol','posthoc-evaluation-evidence-v1','basis',basis,'posthoc',posthoc_item,'observations',observations,
    'approval',approval_item,'leave',leave_context,'resolutionBlockers',resolution_blockers);
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  return jsonb_build_object('protocol','plan-posthoc-evaluation-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;

--PRIVATE deterministic calculation, matching205 derive and LeaveEdges. Service
--role cannot call this with a forged preview. The public RPC supplies only its
--own locked collector facts. Future writers must collect again in their txn.
create or replace function public.faolla_attendance_plan_posthoc_formal_compute_v1(p_facts jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare source jsonb:=p_facts->'source';basis jsonb:=p_facts->'source'->'basis';posthoc jsonb:=p_facts->'source'->'posthoc';
  slot jsonb:=p_facts->'source'->'basis'->'slot';worker jsonb:=p_facts->'source'->'basis'->'worker';context jsonb:=p_facts->'source'->'basis'->'context';
  active boolean:=coalesce(p_facts->'source'->'posthoc'->'current'->>'action'='apply',false);flags text[]:=array[]::text[];adopted_keys text[]:=array[]::text[];
  item jsonb;part jsonb;observation jsonb;current_candidate jsonb;ref jsonb;compact jsonb;admitted jsonb:='[]';work jsonb:='[]';work_item jsonb;
  leave_edges jsonb;blockers jsonb;candidate jsonb;endpoints jsonb;field jsonb;field_result jsonb;result jsonb;
  flag text;reference_key text;endpoint_key text;field_key text;state_name text;eligible boolean;
  a timestamptz;b timestamptz;prior_end timestamptz;first_at timestamptz;last_at timestamptz;end_unknown boolean;
  selected_begin timestamptz;selected_end timestamptz;delta numeric;excess numeric;grace integer;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if source->>'protocol' is distinct from 'posthoc-evaluation-evidence-v1' or jsonb_typeof(source->'observations') is distinct from 'array'
    or jsonb_typeof(posthoc->'selected') is distinct from 'array' or posthoc->'current' is null
    or source->'basis'->'slot' is distinct from p_facts->'slot' then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  if octet_length(convert_to(source::text,'UTF8'))>1048576 or jsonb_array_length(posthoc->'selected')>10 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  flags:=array(select flag_rows.value from jsonb_array_elements_text(source->'resolutionBlockers') flag_rows(value));
  if basis->>'phase'<>'ended' then flags:=array_append(flags,'plan_not_ended');end if;
  if (slot->>'cancelled')::boolean then flags:=array_append(flags,'slot_cancelled');end if;
  if not(slot->>'hasPublicationEvidence')::boolean then flags:=array_append(flags,'publication_missing');end if;
  if not(worker->>'active')::boolean or not(worker->>'employeeActive')::boolean then flags:=array_append(flags,'worker_inactive');end if;
  if exists(select 1 from jsonb_each(context) sections(key,value) where (sections.value->>'limited')::boolean) then flags:=array_append(flags,'context_unknown');end if;
  if context->'pendingCorrections'->'items'<>'[]'::jsonb then flags:=array_append(flags,'pending_correction');end if;
  if exists(select 1 from jsonb_array_elements(context->'calendar'->'items') calendar_rows(value) where calendar_rows.value->>'status'='created') then flags:=array_append(flags,'calendar_entry');end if;
  if exists(select 1 from jsonb_array_elements(context->'leave'->'items') leave_rows(value) where leave_rows.value->>'status'='submitted') then flags:=array_append(flags,'leave_pending');end if;
  if exists(select 1 from jsonb_array_elements(context->'workArrangements'->'items') arrangement_rows(value) where arrangement_rows.value->>'status'='submitted') then flags:=array_append(flags,'work_arrangement_pending');end if;
  if active then
    for item in select selected_rows.value from jsonb_array_elements(posthoc->'selected') selected_rows(value) loop
      ref:=item->'reference';adopted_keys:=array_append(adopted_keys,(ref->>'kind')||':'||coalesce(ref->>'startEventId',ref->>'rootRequestId'));
    end loop;
  end if;
  if exists(select 1 from jsonb_array_elements(context->'unassociated'->'items') session_rows(value)
    where not(('session:'||(session_rows.value->>'startEventId'))=any(adopted_keys))) then flags:=array_append(flags,'unassociated_session');end if;
  if exists(select 1 from jsonb_array_elements(context->'missing'->'items') missing_rows(value)
    where missing_rows.value->>'status'='submitted' or (missing_rows.value->>'isCurrentApproved')::boolean
      and not(('missing:'||(missing_rows.value->>'rootRequestId'))=any(adopted_keys))) then flags:=array_append(flags,'missing_request');end if;
  compact:=nullif(source->'approval','null'::jsonb)-'source';
  for item in select session_rows.value from jsonb_array_elements(basis->'sessions') session_rows(value) loop
    if item->'relation'->>'status'<>'linked' then flags:=array_append(flags,'association_unverified');end if;
    if item->'adoption'='null'::jsonb then flags:=array_append(flags,'adoption_missing');
    elsif item->'adoption'->>'status'<>'adopted' then flags:=array_append(flags,'adoption_unverified');
    elsif item->'adoption'->'approval' is distinct from compact then flags:=array_append(flags,'approval_mismatch');end if;
  end loop;
  for observation in select observation_rows.value from jsonb_array_elements(source->'observations') observation_rows(value) loop
    for flag in select flag_rows.value from jsonb_array_elements_text(observation->'blockers') flag_rows(value) loop flags:=array_append(flags,flag);end loop;
    for flag in select flag_rows.value from jsonb_array_elements_text(observation->'current'->'blockers') flag_rows(value) loop
      if flag='sealed' then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
      flags:=array_append(flags,case flag when 'already_associated' then 'source_changed' when 'source_open' then 'session_open'
        when 'source_zero_duration' then 'session_zero_duration' when 'location_mismatch' then 'session_location_mismatch' else flag end);
    end loop;
  end loop;
  for item in select session_rows.value from jsonb_array_elements(basis->'sessions') session_rows(value) loop
    admitted:=admitted||jsonb_build_array(jsonb_build_object('original',item->'original','selected',item->'selected'));
  end loop;
  if active then
    for item in select selected_rows.value from jsonb_array_elements(posthoc->'selected') selected_rows(value) loop
      admitted:=admitted||jsonb_build_array(jsonb_build_object('original',item->'original','selected',item->'selected'));
    end loop;
  end if;
  for item in select admitted_rows.value from jsonb_array_elements(admitted) admitted_rows(value) order by admitted_rows.value->'selected'->>'startAt' nulls first loop
    a:=(item->'selected'->>'startAt')::timestamptz;b:=(item->'selected'->>'endAt')::timestamptz;
    if a is null or b is null then flags:=array_append(flags,'session_open');end if;
    if a is not null and b is not null then
      if a=b then flags:=array_append(flags,'session_zero_duration');
      elsif b>a and (a>=(slot->>'endAt')::timestamptz or b<=(slot->>'startAt')::timestamptz) then flags:=array_append(flags,'session_outside_plan');end if;
    end if;
    if a is not null and prior_end is not null and a<prior_end then flags:=array_append(flags,'session_overlap');end if;
    if b is not null then prior_end:=greatest(prior_end,b);end if;
  end loop;
  --ALL actual current work, not just adopted work, checks leave overlap.
  for item in select session_rows.value from jsonb_array_elements((basis->'sessions')||(context->'unassociated'->'items')) session_rows(value) loop
    work:=work||jsonb_build_array(jsonb_build_object('kind','session','sourceId',item->'startEventId','operationId',item->'effect'->'operationId',
      'startAt',to_char((item->'selected'->>'startAt')::timestamptz at time zone 'UTC',fmt),'endAt',to_char((item->'selected'->>'endAt')::timestamptz at time zone 'UTC',fmt)));
  end loop;
  for item in select missing_rows.value from jsonb_array_elements(context->'missing'->'items') missing_rows(value) where (missing_rows.value->>'isCurrentApproved')::boolean loop
    work:=work||jsonb_build_array(jsonb_build_object('kind','missing','sourceId',item->'rootRequestId','operationId',item->'operationId',
      'startAt',to_char((item->>'startAt')::timestamptz at time zone 'UTC',fmt),'endAt',to_char((item->>'endAt')::timestamptz at time zone 'UTC',fmt)));
  end loop;
  for observation in select observation_rows.value from jsonb_array_elements(source->'observations') observation_rows(value) loop
    current_candidate:=nullif(observation->'current','null'::jsonb);if current_candidate is null then continue;end if;
    ref:=current_candidate->'reference';reference_key:=(ref->>'kind')||':'||coalesce(ref->>'startEventId',ref->>'rootRequestId');
    if not exists(select 1 from jsonb_array_elements(work) work_rows(value) where (work_rows.value->>'kind')||':'||(work_rows.value->>'sourceId')=reference_key) then
      work_item:=jsonb_build_object('kind',ref->'kind','sourceId',coalesce(ref->'startEventId',ref->'rootRequestId'),
        'operationId',case when ref->>'kind'='session' then ref->'effectOperationId' else ref->'approvalOperationId' end,
        'startAt',to_char((current_candidate->'selected'->>'startAt')::timestamptz at time zone 'UTC',fmt),'endAt',to_char((current_candidate->'selected'->>'endAt')::timestamptz at time zone 'UTC',fmt));
      work:=work||jsonb_build_array(work_item);
    end if;
  end loop;
  leave_edges:=public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb_build_object('startAt',slot->'startAt','endAt',slot->'endAt'),source->'leave',work);
  for flag in select flag_rows.value from jsonb_array_elements_text(leave_edges->'blockers') flag_rows(value) loop flags:=array_append(flags,flag);end loop;
  if leave_edges->>'state'<>'not_applicable' and source->'approval'='null'::jsonb then flags:=array_append(flags,'approval_missing');end if;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.ord),'[]'::jsonb) into blockers from unnest(array[
    'posthoc_inactive','source_changed','source_unavailable','context_unknown','plan_not_ended','slot_cancelled','publication_missing','worker_inactive',
    'association_unverified','adoption_missing','adoption_unverified','approval_mismatch','approval_missing','session_open','session_zero_duration','session_outside_plan','session_overlap','session_location_mismatch',
    'unassociated_session','missing_request','pending_correction','leave_pending','calendar_entry','work_arrangement_pending','leave_context_unknown','work_endpoint_missing','work_zero_duration','source_outside_plan','work_leave_overlap',
    'identity_unproven','associated_elsewhere','claimed_elsewhere','pending_missing','sealed']) with ordinality flag_rows(flag,ord) where flag_rows.flag=any(flags);
  state_name:=case when not active or blockers<>'[]'::jsonb then 'blocked' when leave_edges->>'state'='not_applicable' then 'not_applicable' else 'required' end;
  eligible:=state_name in('required','not_applicable');candidate:='{}';
  foreach endpoint_key in array array['original','selected'] loop
    first_at:=null;last_at:=null;end_unknown:=false;
    for item in select admitted_rows.value from jsonb_array_elements(admitted) admitted_rows(value) loop
      part:=nullif(item->endpoint_key,'null'::jsonb);if part is null then continue;end if;
      a:=(part->>'startAt')::timestamptz;b:=(part->>'endAt')::timestamptz;
      first_at:=least(first_at,a);last_at:=greatest(last_at,b);if b is null then end_unknown:=true;end if;
    end loop;
    endpoints:=jsonb_build_object('startAt',to_char(first_at at time zone 'UTC',fmt),'endAt',case when end_unknown then null else to_char(last_at at time zone 'UTC',fmt) end);
    candidate:=candidate||jsonb_build_object(endpoint_key,endpoints);
  end loop;
  selected_begin:=(candidate->'selected'->>'startAt')::timestamptz;selected_end:=(candidate->'selected'->>'endAt')::timestamptz;
  foreach field_key in array array['late','early'] loop
    field:=source->'approval'->'source'->'fields'->(case field_key when 'late' then 'lateGraceMinutes' else 'earlyGraceMinutes' end);
    if state_name<>'required' then field_result:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field is null then field_result:=jsonb_build_object('state','unconfigured','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state' in('unconfigured','disabled') then field_result:=jsonb_build_object('state',field->'state','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state'='value' then
      grace:=(field->>'minutes')::integer;
      if grace is null or grace not between 0 and 1440 or selected_begin is null or selected_end is null
        or leave_edges->>'requiredStartAt' is null or leave_edges->>'requiredEndAt' is null then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
      delta:=case field_key when 'late' then extract(epoch from selected_begin-(leave_edges->>'requiredStartAt')::timestamptz)*1000000
        else extract(epoch from (leave_edges->>'requiredEndAt')::timestamptz-selected_end)*1000000 end;
      excess:=greatest(0,delta-grace::numeric*60000000);
      field_result:=jsonb_build_object('state',case when excess>0 then 'triggered' else 'not_triggered' end,'minutes',grace,'rawDeltaUs',delta::bigint::text,'excessUs',excess::bigint::text);
    else raise exception 'attendance_plan_posthoc_formal_invalid';end if;
    candidate:=candidate||jsonb_build_object(field_key,field_result);
  end loop;
  result:=jsonb_build_object('state',state_name,'eligible',eligible,'blockers',blockers,'leaveEdges',leave_edges,'candidate',candidate);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  return result;
end;
$$;

--PRIVATE UTC-microsecond geometry; inputs are current identities/heads proven by
--the SQL collector, never an HTTP preview. Touching approved leave is unioned;
--touching work/leave is not overlap. No breaks or worked minutes are subtracted.
create or replace function public.faolla_attendance_plan_posthoc_formal_leave_v1(p_plan jsonb,p_leave jsonb,p_work jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare plan_begin timestamptz:=(p_plan->>'startAt')::timestamptz;plan_end timestamptz:=(p_plan->>'endAt')::timestamptz;
  unknown_context boolean:=(p_leave->>'limited')::boolean or not(p_leave->>'resolved')::boolean;
  leaves jsonb;work jsonb;current_leaves jsonb:='[]';pieces jsonb:='[]';pending jsonb:='[]';coverage jsonb;remaining jsonb;work_overlaps jsonb;
  item jsonb;work_item jsonb;piece jsonb;component jsonb;leave_ref jsonb;sorted_refs jsonb;flags text[]:=array[]::text[];blockers jsonb;
  a timestamptz;b timestamptz;cursor_at timestamptz;full_coverage boolean;required_start text;required_end text;result jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if plan_begin is null or plan_end is null or plan_begin>=plan_end or unknown_context is null
    or jsonb_typeof(p_leave->'items') is distinct from 'array' or jsonb_typeof(p_work) is distinct from 'array' then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  if jsonb_array_length(p_leave->'items')>100 or jsonb_array_length(p_work)>100 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  select coalesce(jsonb_agg(leave_rows.value||jsonb_build_object(
    'startAt',to_char((leave_rows.value->>'startAt')::timestamptz at time zone 'UTC',fmt),
    'endAt',to_char((leave_rows.value->>'endAt')::timestamptz at time zone 'UTC',fmt),
    'recordedAt',to_char((leave_rows.value->>'recordedAt')::timestamptz at time zone 'UTC',fmt))
    order by leave_rows.value->>'requestId'),'[]'::jsonb) into leaves from jsonb_array_elements(p_leave->'items') leave_rows(value);
  select coalesce(jsonb_agg(work_rows.value order by work_rows.value->>'kind',work_rows.value->>'sourceId'),'[]'::jsonb) into work from jsonb_array_elements(p_work) work_rows(value);
  if (select count(*)<>count(distinct leave_rows.value->>'requestId') from jsonb_array_elements(leaves) leave_rows(value))
    or (select count(*)<>count(distinct (work_rows.value->>'kind')||':'||(work_rows.value->>'sourceId')) from jsonb_array_elements(work) work_rows(value)) then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  if unknown_context then flags:=array_append(flags,'leave_context_unknown');end if;
  for item in select leave_rows.value from jsonb_array_elements(leaves) leave_rows(value) loop
    if (p_leave->>'resolved')::boolean and (item->>'current')::boolean and (item->>'startAt')::timestamptz<plan_end and (item->>'endAt')::timestamptz>plan_begin then
      current_leaves:=current_leaves||jsonb_build_array(item);
      if item->>'status'='submitted' then
        pending:=pending||jsonb_build_array(jsonb_build_object('requestId',item->'requestId','operationId',item->'operationId','revision',item->'revision'));
      end if;
    end if;
  end loop;
  if pending<>'[]'::jsonb then flags:=array_append(flags,'leave_pending');end if;
  for work_item in select work_rows.value from jsonb_array_elements(work) work_rows(value) loop
    a:=(work_item->>'startAt')::timestamptz;b:=(work_item->>'endAt')::timestamptz;
    if a is null or b is null then flags:=array_append(flags,'work_endpoint_missing');
    elsif a=b then flags:=array_append(flags,'work_zero_duration');
    elsif a>=plan_end or b<=plan_begin then flags:=array_append(flags,'source_outside_plan');end if;
  end loop;
  if not unknown_context then
    for item in select leave_rows.value from jsonb_array_elements(current_leaves) leave_rows(value)
      where leave_rows.value->>'status'='approved'
      order by greatest((leave_rows.value->>'startAt')::timestamptz,plan_begin),least((leave_rows.value->>'endAt')::timestamptz,plan_end),leave_rows.value->>'requestId' loop
      leave_ref:=jsonb_build_object('requestId',item->'requestId','operationId',item->'operationId','revision',item->'revision');
      pieces:=pieces||jsonb_build_array(jsonb_build_object('startAt',to_char(greatest((item->>'startAt')::timestamptz,plan_begin) at time zone 'UTC',fmt),
        'endAt',to_char(least((item->>'endAt')::timestamptz,plan_end) at time zone 'UTC',fmt),'leave',leave_ref));
    end loop;
    coverage:='[]';
    for piece in select piece_rows.value from jsonb_array_elements(pieces) piece_rows(value) loop
      component:=coverage->-1;
      if component is not null and (piece->>'startAt')::timestamptz<=(component->>'endAt')::timestamptz then
        component:=component||jsonb_build_object('endAt',to_char(greatest((component->>'endAt')::timestamptz,(piece->>'endAt')::timestamptz) at time zone 'UTC',fmt),
          'leaveRefs',(component->'leaveRefs')||jsonb_build_array(piece->'leave'));
        coverage:=jsonb_set(coverage,array[(jsonb_array_length(coverage)-1)::text],component);
      else coverage:=coverage||jsonb_build_array(jsonb_build_object('startAt',piece->'startAt','endAt',piece->'endAt','leaveRefs',jsonb_build_array(piece->'leave')));end if;
    end loop;
    pieces:=coalesce(pieces,'[]');remaining:='[]';cursor_at:=plan_begin;
    for component in select coverage_rows.value from jsonb_array_elements(coverage) coverage_rows(value) loop
      if cursor_at<(component->>'startAt')::timestamptz then remaining:=remaining||jsonb_build_array(jsonb_build_object('startAt',to_char(cursor_at at time zone 'UTC',fmt),'endAt',component->'startAt'));end if;
      cursor_at:=(component->>'endAt')::timestamptz;
    end loop;
    if cursor_at<plan_end then remaining:=remaining||jsonb_build_array(jsonb_build_object('startAt',to_char(cursor_at at time zone 'UTC',fmt),'endAt',to_char(plan_end at time zone 'UTC',fmt)));end if;
    full_coverage:=remaining='[]'::jsonb;required_start:=remaining->0->>'startAt';required_end:=remaining->-1->>'endAt';
    if not full_coverage and work='[]'::jsonb then flags:=array_append(flags,'work_endpoint_missing');end if;
    --Sort only the coverage's contributing references, not the geometric pieces
    --used below: each work overlap retains its actual individual approval.
    sorted_refs:='[]';
    for component in select coverage_rows.value from jsonb_array_elements(coverage) coverage_rows(value) loop
      select jsonb_agg(ref_rows.value order by ref_rows.value->>'requestId') into leave_ref from jsonb_array_elements(component->'leaveRefs') ref_rows(value);
      sorted_refs:=sorted_refs||jsonb_build_array(component||jsonb_build_object('leaveRefs',leave_ref));
    end loop;
    coverage:=sorted_refs;work_overlaps:='[]';
    for work_item in select work_rows.value from jsonb_array_elements(work) work_rows(value) loop
      if work_item->>'startAt' is null or work_item->>'endAt' is null or (work_item->>'startAt')::timestamptz=(work_item->>'endAt')::timestamptz then continue;end if;
      for piece in select piece_rows.value from jsonb_array_elements(pieces) piece_rows(value) loop
        a:=greatest((work_item->>'startAt')::timestamptz,(piece->>'startAt')::timestamptz);b:=least((work_item->>'endAt')::timestamptz,(piece->>'endAt')::timestamptz);
        if a<b then
          if jsonb_array_length(work_overlaps)>=1000 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
          work_overlaps:=work_overlaps||jsonb_build_array(jsonb_build_object('startAt',to_char(a at time zone 'UTC',fmt),'endAt',to_char(b at time zone 'UTC',fmt),
            'work',work_item-array['startAt','endAt'],'leave',piece->'leave'));
        end if;
      end loop;
    end loop;
    if work_overlaps<>'[]'::jsonb then flags:=array_append(flags,'work_leave_overlap');end if;
  end if;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.ord),'[]'::jsonb) into blockers from unnest(array[
    'leave_context_unknown','leave_pending','work_endpoint_missing','work_zero_duration','source_outside_plan','work_leave_overlap']) with ordinality flag_rows(flag,ord) where flag_rows.flag=any(flags);
  result:=jsonb_build_object('version','plan-leave-edges-v1','plan',jsonb_build_object('startAt',to_char(plan_begin at time zone 'UTC',fmt),'endAt',to_char(plan_end at time zone 'UTC',fmt)),
    'leave',p_leave||jsonb_build_object('items',leaves),'work',work,
    'approvedCoverage',coverage,'remainingRequired',remaining,'fullCoverage',full_coverage,'requiredStartAt',required_start,'requiredEndAt',required_end,
    'workLeaveOverlaps',work_overlaps,'pending',pending,'unknown',unknown_context,'state',case when blockers<>'[]'::jsonb then 'blocked' when full_coverage then 'not_applicable' else 'required' end,'blockers',blockers);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_plan_posthoc_formal_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;sid uuid;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype;facts jsonb;derived jsonb;source jsonb;source_text text;result jsonb;
begin
  if p_auth_user_id is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  --Acquire writable lock levels FIRST, never after old review/case locks.
  --No writer is called. These locks serialize source changes until return/commit.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if e.id is null or e.auth_user_id is null then raise exception 'attendance_worker_changed';end if;
  --Absence is tested under the same settings lock used by171 apply/revoke. A
  --plan without a case or adoption is NOT required to pass171 prerequisites.
  --Call159's current public source, preserving its exact old v1/v2 canonical.
  if not exists(select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid) then
    return public.faolla_attendance_plan_exception_source_v1(p_query,p_auth_user_id);
  end if;
  facts:=public.faolla_attendance_plan_posthoc_formal_facts_v1(p_query,p_auth_user_id);
  derived:=public.faolla_attendance_plan_posthoc_formal_compute_v1(facts);
  source:=jsonb_build_object('protocol','plan-exception-evidence-v3','policy','owner-confirmed-plan-edges-posthoc-v3','evaluation',facts->'source');
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  result:=jsonb_build_object('protocol','plan-exception-source-v3','siteId',site,'actorId',p_auth_user_id,'worker',facts->'worker','slot',facts->'slot',
    'readAt',facts->'readAt','source',source,'sourceText',source_text,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'))||derived;
  if octet_length(convert_to(result::text,'UTF8'))>2097152 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_formal_compute_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid) to service_role;
do $formal_source_permissions$
declare role_name text;signature text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach signature in array array['public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)',
      'public.faolla_attendance_plan_posthoc_formal_leave_v1(jsonb,jsonb,jsonb)','public.faolla_attendance_plan_posthoc_formal_compute_v1(jsonb)'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'merchant_attendance_plan_posthoc_formal_source_permission_conflict';end if;
    end loop;
    if has_function_privilege(role_name,'public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)','EXECUTE') is distinct from (role_name='service_role') then
      raise exception 'merchant_attendance_plan_posthoc_formal_source_permission_conflict';end if;
  end loop;
end;
$formal_source_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610060173,'merchant_attendance_plan_posthoc_formal_source') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
