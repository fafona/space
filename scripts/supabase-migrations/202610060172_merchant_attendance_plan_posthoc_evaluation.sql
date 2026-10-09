--205 Read-only facts for a future explicit evaluation protocol. This does not
--replace old source/review/period functions, write a verdict or activate policy.
--Geometry is derived by the strict Node consumer; a future formal writer must
--validate the same facts and decision inside its own locked transaction.
begin;
set local lock_timeout='3s';
do $posthoc_evaluation_prerequisites$
declare installed boolean;signature text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610060171 and name='merchant_attendance_plan_posthoc_adoption')
    or to_regprocedure('public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)') is null
    or to_regprocedure('public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)') is null
    or to_regprocedure('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)') is null
    or to_regclass('public.merchant_attendance_missing_current_v1') is null then raise exception 'merchant_attendance_plan_posthoc_evaluation_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060172 and name='merchant_attendance_plan_posthoc_evaluation') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060172 and name<>'merchant_attendance_plan_posthoc_evaluation') then raise exception 'merchant_attendance_plan_posthoc_evaluation_installation_conflict';end if;
  foreach signature in array array[
    'public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone)',
    'public.faolla_attendance_plan_posthoc_evaluation_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(signature) is not null) then raise exception 'merchant_attendance_plan_posthoc_evaluation_installation_conflict';end if;
  end loop;
end;
$posthoc_evaluation_prerequisites$;

--PRIVATE exact-ID/root observation. Not a range search and never a replacement
--adoption: saved references remain untouched even when the latest source moves.
create or replace function public.faolla_attendance_plan_posthoc_observation_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid,
  p_slot jsonb,p_operation uuid,p_approval jsonb,p_saved jsonb,p_observed timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare saved_ref jsonb:=p_saved->'reference';current_ref jsonb;proof jsonb;events jsonb;first_event jsonb;last_event jsonb;effect jsonb;
  original_span jsonb;selected_span jsonb;candidate jsonb;candidate_flags text[]:=array[]::text[];observation_flags text[]:=array[]::text[];
  candidate_blockers jsonb;observation_blockers jsonb;reference_kind text:=saved_ref->>'kind';reference_id uuid;current_ids uuid[];
  current_request public.merchant_attendance_missing_requests%rowtype;claim_row public.merchant_attendance_plan_posthoc_claims%rowtype;
  claim_operation public.merchant_attendance_plan_posthoc_operations%rowtype;claim_item jsonb;pending_row record;pending_count integer:=0;
  current_location uuid;current_zone text;relation_slot uuid;span_begin timestamptz;span_end timestamptz;
  plan_begin timestamptz:=(p_slot->>'startAt')::timestamptz;plan_end timestamptz:=(p_slot->>'endAt')::timestamptz;
  failure text;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_plan_posthoc_reference_v1(saved_ref) is distinct from true then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  if reference_kind='session' then
    reference_id:=(saved_ref->>'startEventId')::uuid;
    begin
      proof:=public.faolla_attendance_period_session_v1(p_site,p_worker,reference_id,p_employee,p_auth,p_observed);
    exception when raise_exception then get stacked diagnostics failure=message_text;
      if failure='attendance_period_source_identity_unproven' then
        return jsonb_build_object('reference',saved_ref,'current',null,'blockers',jsonb_build_array('source_changed','source_unavailable'));
      end if;
      raise;
    end;
    events:=proof->'item'->'events';first_event:=events->0;last_event:=events->-1;effect:=nullif(proof->'item'->'effect','null'::jsonb);
    current_ref:=jsonb_build_object('kind','session','startEventId',reference_id,'lastEventId',last_event->'id','lastSequence',last_event->'sequence',
      'effectOperationId',effect->'operationId','effectRevision',effect->'revision');
    original_span:=jsonb_build_object('startAt',first_event->'occurredAt','endAt',case when last_event->>'action'='clock_out' then last_event->'occurredAt' else 'null'::jsonb end);
    selected_span:=case when effect is null then original_span else jsonb_build_object('startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt') end;
    current_location:=(first_event->>'locationId')::uuid;current_zone:=first_event->>'timeZone';
    if exists(select 1 from jsonb_array_elements(events) event_rows(value) where event_rows.value->>'locationId' is distinct from p_slot->>'locationId') then candidate_flags:=array_append(candidate_flags,'location_mismatch');end if;
    relation_slot:=(proof->'relation'->'selection'->>'slotId')::uuid;
    if relation_slot is not null then candidate_flags:=array_append(candidate_flags,case when relation_slot::text=p_slot->>'id' then 'already_associated' else 'associated_elsewhere' end);end if;
    --Do not lose a pending correction/revision whose proposed interval moved
    --away from the plan. Inspect latest root-stream heads without date filters.
    for pending_row in
      select ce.employee_id,ce.actor_auth_user_id from public.merchant_attendance_correction_entries ce
        where ce.merchant_id=p_site and ce.worker_id=p_worker and ce.start_event_id=reference_id and ce.action='submit'
          and not exists(select 1 from public.merchant_attendance_correction_entries tail where tail.merchant_id=p_site and tail.request_id=ce.request_id and tail.revision>ce.revision)
          and not exists(select 1 from public.merchant_attendance_correction_decisions decision where decision.merchant_id=p_site and decision.request_id=ce.request_id)
      union all
      select rr.employee_id,rr.actor_auth_user_id from public.merchant_attendance_revision_requests rr
        join public.merchant_attendance_correction_effects base on base.merchant_id=rr.merchant_id and base.request_id=rr.base_request_id
        where rr.merchant_id=p_site and base.worker_id=p_worker and base.start_event_id=reference_id and rr.action='submit'
          and not exists(select 1 from public.merchant_attendance_revision_requests tail where tail.merchant_id=p_site and tail.request_id=rr.request_id and tail.revision>rr.revision)
          and not exists(select 1 from public.merchant_attendance_revision_decisions decision where decision.merchant_id=p_site and decision.request_id=rr.request_id)
      limit 101
    loop
      pending_count:=pending_count+1;if pending_count>100 then raise exception 'attendance_plan_posthoc_evaluation_too_large';end if;
      if row(pending_row.employee_id,pending_row.actor_auth_user_id) is distinct from row(p_employee,p_auth) then raise exception 'attendance_worker_changed';end if;
      candidate_flags:=array_append(candidate_flags,'pending_correction');
    end loop;
  else
    reference_id:=(saved_ref->>'rootRequestId')::uuid;
    --The existing103 root expression index supports this current-head lookup.
    --LIMIT2 witnesses contradictory current approvals; it does not limit or
    --enumerate terminal historical children and does not follow by recursion.
    current_ids:=array(select current_rows.request_id from public.merchant_attendance_missing_current_v1 current_rows
      where current_rows.merchant_id=p_site and coalesce(current_rows.root_request_id,current_rows.request_id)=reference_id limit 2);
    if cardinality(current_ids)>1 then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
    if cardinality(current_ids)=0 then
      return jsonb_build_object('reference',saved_ref,'current',null,'blockers',jsonb_build_array('source_changed','source_unavailable'));
    end if;
    proof:=public.faolla_attendance_plan_posthoc_missing_v1(p_site,p_worker,p_employee,p_auth,current_ids[1]);
    if proof->>'current' is distinct from 'true' then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
    current_ref:=proof->'reference';
    if current_ref->>'rootRequestId' is distinct from reference_id::text then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
    select * into current_request from public.merchant_attendance_missing_requests where merchant_id=p_site and request_id=current_ids[1];
    current_location:=current_request.location_id;current_zone:=current_request.time_zone;
    original_span:=null;selected_span:=jsonb_build_object('startAt',to_char(current_request.start_at at time zone 'UTC',fmt),'endAt',to_char(current_request.end_at at time zone 'UTC',fmt));
    if (proof->>'pending')::boolean then candidate_flags:=array_append(candidate_flags,'pending_missing');end if;
  end if;
  span_begin:=(selected_span->>'startAt')::timestamptz;span_end:=(selected_span->>'endAt')::timestamptz;
  if span_end is null then candidate_flags:=array_append(candidate_flags,'source_open');
  elsif span_end=span_begin then candidate_flags:=array_append(candidate_flags,'source_zero_duration');
  elsif span_begin>=plan_end or span_end<=plan_begin then candidate_flags:=array_append(candidate_flags,'source_outside_plan');end if;
  if current_location::text is distinct from p_slot->>'locationId' then candidate_flags:=array_append(candidate_flags,'location_mismatch');end if;
  if p_approval is null then candidate_flags:=array_append(candidate_flags,'approval_missing');end if;
  select * into claim_row from public.merchant_attendance_plan_posthoc_claims claims
    where claims.merchant_id=p_site and claims.kind=reference_kind and claims.source_id=reference_id;
  if row(claim_row.worker_id,claim_row.slot_id,claim_row.operation_id) is distinct from row(p_worker,(p_slot->>'id')::uuid,p_operation) then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  select * into claim_operation from public.merchant_attendance_plan_posthoc_operations where merchant_id=p_site and operation_id=claim_row.operation_id;
  perform public.faolla_attendance_plan_posthoc_operation_v1(claim_operation);
  if claim_operation.action is distinct from 'apply' then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  claim_item:=jsonb_build_object('slotId',claim_row.slot_id,'operationId',claim_row.operation_id,'revision',claim_operation.revision);
  if span_begin is not null and span_end is not null then
    begin
      perform public.faolla_attendance_period_assert_open_v1(p_site,p_worker,jsonb_build_array(selected_span));
      if original_span is not null and original_span->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(p_site,p_worker,jsonb_build_array(original_span));end if;
    exception when raise_exception then get stacked diagnostics failure=message_text;
      if failure='attendance_period_sealed' then candidate_flags:=array_append(candidate_flags,'sealed');else raise;end if;
    end;
  end if;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.flag),'[]'::jsonb) into candidate_blockers from (select distinct unnest(candidate_flags) as flag) flag_rows;
  candidate:=jsonb_build_object('reference',current_ref,'original',original_span,'selected',selected_span,'locationId',current_location,'timeZone',current_zone,
    'available',candidate_blockers='[]'::jsonb,'blockers',candidate_blockers,'claim',claim_item);
  --Claim metadata changes when apply is committed; it was not part of the old
  --source fact. Compare only immutable source reference/identity/location/edges.
  if (candidate-array['available','blockers','claim']) is distinct from (p_saved-array['available','blockers','claim']) then observation_flags:=array_append(observation_flags,'source_changed');end if;
  if candidate_blockers<>'[]'::jsonb then observation_flags:=array_append(observation_flags,'source_unavailable');end if;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.flag),'[]'::jsonb) into observation_blockers from (select distinct unnest(observation_flags) as flag) flag_rows;
  return jsonb_build_object('reference',saved_ref,'current',candidate,'blockers',observation_blockers);
end;
$$;

create or replace function public.faolla_attendance_plan_posthoc_evaluation_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare baseline jsonb;basis jsonb;worker_item jsonb;slot_item jsonb;posthoc_item jsonb;observations jsonb:='[]';observation jsonb;snapshot jsonb;
  saved_operation public.merchant_attendance_plan_posthoc_operations%rowtype;full_approval jsonb;approval_item jsonb;compact_approval jsonb;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_head public.merchant_attendance_leave_entries%rowtype;leave_summary jsonb;
  leave_ids uuid[];leave_items jsonb:='[]';leave_context jsonb;leave_limited boolean;flags text[]:=array[]::text[];resolution_blockers jsonb;
  source jsonb;source_text text;result jsonb;site text;wid uuid;sid uuid;employee uuid;member_auth uuid;
  plan_begin timestamptz;plan_end timestamptz;observed timestamptz;read_at timestamptz;part jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  --171 reauthenticates current owner/dual identity and holds the common order:
  --merchant SHARE -> settings UPDATE -> worker UPDATE -> employee SHARE.
  --This is a GET invocation with null command and false allow; no impersonation.
  baseline:=public.faolla_attendance_plan_posthoc_adoption_v1(p_query||jsonb_build_object('mode','detail','operationId',null),p_auth_user_id,null,false);
  if baseline->>'actorId' is distinct from p_auth_user_id::text or baseline->>'siteId' is distinct from site then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  basis:=baseline->'preview'->'source'->'basis';worker_item:=baseline->'worker';slot_item:=baseline->'slot';
  employee:=(worker_item->>'employeeId')::uuid;member_auth:=(worker_item->>'employeeAuthUserId')::uuid;
  plan_begin:=(slot_item->>'startAt')::timestamptz;plan_end:=(slot_item->>'endAt')::timestamptz;observed:=(baseline->>'readAt')::timestamptz;
  if baseline->'current'<>'null'::jsonb then
    select * into saved_operation from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=(baseline->'current'->>'operationId')::uuid;
    if public.faolla_attendance_plan_posthoc_operation_v1(saved_operation) is distinct from baseline->'current'
      or row(saved_operation.worker_id,saved_operation.slot_id,saved_operation.employee_id,saved_operation.employee_auth_user_id)
        is distinct from row(wid,sid,employee,member_auth) then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  end if;
  posthoc_item:=jsonb_build_object('revision',baseline->'revision','current',baseline->'current',
    'selected',coalesce(saved_operation.selected,'[]'::jsonb),'approval',saved_operation.approval);
  --Read exactly the140 approval chosen at apply time. A later approval head is
  --not its replacement. Empty apply may instead retain the original137 basis.
  compact_approval:=saved_operation.approval;
  if compact_approval is not null then
    full_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,(compact_approval->>'operationId')::uuid);
    approval_item:=jsonb_build_object('operationId',full_approval->'operationId','revision',full_approval->'revision','sourceId',full_approval->'sourceId',
      'sourceSha256',full_approval->'sourceSha256','recordedAt',full_approval->'recordedAt','source',full_approval->'source');
    if (approval_item-'source') is distinct from compact_approval then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  else approval_item:=nullif(basis->'approval','null'::jsonb);end if;
  if saved_operation.action is distinct from 'apply' then flags:=array_append(flags,'posthoc_inactive');
  else
    if jsonb_array_length(saved_operation.selected)>10 then raise exception 'attendance_plan_posthoc_evaluation_too_large';end if;
    for snapshot in select source_rows.value from jsonb_array_elements(saved_operation.selected) source_rows(value) loop
      observation:=public.faolla_attendance_plan_posthoc_observation_v1(site,wid,employee,member_auth,slot_item,saved_operation.operation_id,approval_item,snapshot,observed);
      observations:=observations||jsonb_build_array(observation);
      if observation->'blockers' ? 'source_changed' then flags:=array_append(flags,'source_changed');end if;
      if observation->'blockers' ? 'source_unavailable' then flags:=array_append(flags,'source_unavailable');end if;
    end loop;
  end if;
  --Current leave heads, not a cached approved row. Exact UTC overlap precedes
  --LIMIT101; no currentAuth filter can hide a historical identity mismatch.
  leave_ids:=array(select requests.request_id from public.merchant_attendance_leave_requests requests
    where requests.merchant_id=site and requests.worker_id=wid and requests.start_at<plan_end and requests.end_at>plan_begin
    order by requests.start_at,requests.end_at,requests.request_id limit 101);
  --A new exact query is not authority to erase an older incomplete basis. This
  --foundation deliberately retains that bounded legacy limit as unresolved.
  leave_limited:=cardinality(leave_ids)>100 or (basis->'context'->'leave'->>'limited')::boolean;
  if not leave_limited then
    for leave_row in select requests.* from public.merchant_attendance_leave_requests requests where requests.merchant_id=site and requests.request_id=any(leave_ids) order by requests.request_id loop
      if row(leave_row.worker_id,leave_row.employee_id,leave_row.actor_auth_user_id) is distinct from row(wid,employee,member_auth) then raise exception 'attendance_worker_changed';end if;
      leave_summary:=public.faolla_attendance_leave_summary_v1(leave_row,null);
      select * into leave_head from public.merchant_attendance_leave_entries entries where entries.merchant_id=site and entries.request_id=leave_row.request_id order by entries.revision desc limit 1;
      if leave_head.operation_id is null or leave_summary->'revision' is distinct from to_jsonb(leave_head.revision) then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('requestId',leave_row.request_id,'operationId',leave_head.operation_id,
        'revision',leave_head.revision,'status',leave_summary->'status','startAt',to_char(leave_row.start_at at time zone 'UTC',fmt),
        'endAt',to_char(leave_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(leave_head.recorded_at at time zone 'UTC',fmt),'current',true));
    end loop;
  end if;
  leave_context:=jsonb_build_object('limited',leave_limited,'resolved',not leave_limited,'items',leave_items);
  if leave_limited or baseline->'preview'->'blockers' ? 'context_unknown' then flags:=array_append(flags,'context_unknown');end if;
  --The compact old basis does not contain every event location. Preserve171's
  --full148 proof for original137-associated sessions as well as new selections.
  --Normal already_associated is NOT an unavailable-source condition.
  if exists(select 1 from jsonb_array_elements(baseline->'preview'->'candidates') candidate_rows(value)
    where candidate_rows.value->'reference'->>'kind'='session' and candidate_rows.value->'blockers' ? 'location_mismatch'
      and exists(select 1 from jsonb_array_elements(basis->'sessions') session_rows(value)
        where session_rows.value->>'startEventId'=candidate_rows.value->'reference'->>'startEventId')) then
    flags:=array_append(flags,'source_unavailable');end if;
  --171 also point-checks pending root streams and direct missing revisions
  --which moved outside the old context range. Never lose those locked checks
  --merely because this protocol preserves the compact legacy basis unchanged.
  if baseline->'preview'->'blockers' ?| array['pending_correction','pending_missing'] then
    flags:=array_append(flags,'source_unavailable');end if;
  for part in select sections.value from jsonb_each(basis->'context') sections(key,value) loop
    if part->>'limited'='true' then flags:=array_append(flags,'context_unknown');end if;
  end loop;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.flag),'[]'::jsonb) into resolution_blockers from (select distinct unnest(flags) as flag) flag_rows;
  source:=jsonb_build_object('protocol','posthoc-evaluation-evidence-v1','basis',basis,'posthoc',posthoc_item,'observations',observations,
    'approval',approval_item,'leave',leave_context,'resolutionBlockers',resolution_blockers);
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_evaluation_too_large';end if;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_plan_posthoc_evaluation_invalid';end if;
  result:=jsonb_build_object('protocol','plan-posthoc-evaluation-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'sourceText',source_text,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  if octet_length(convert_to(result::text,'UTF8'))>2097152 then raise exception 'attendance_plan_posthoc_evaluation_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_evaluation_v1(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.faolla_attendance_plan_posthoc_evaluation_v1(jsonb,uuid) to service_role;
do $posthoc_evaluation_permissions$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,'public.faolla_attendance_plan_posthoc_observation_v1(text,uuid,uuid,uuid,jsonb,uuid,jsonb,jsonb,timestamp with time zone)','EXECUTE')
      or has_function_privilege(role_name,'public.faolla_attendance_plan_posthoc_evaluation_v1(jsonb,uuid)','EXECUTE') is distinct from (role_name='service_role') then
      raise exception 'merchant_attendance_plan_posthoc_evaluation_permission_conflict';end if;
  end loop;
end;
$posthoc_evaluation_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610060172,'merchant_attendance_plan_posthoc_evaluation') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
