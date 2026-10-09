-- Local candidate187. Work arrangements are manual-review context, never
-- actual attendance or an automatic exemption. Empty related context is v1.
begin;
set local lock_timeout='3s';
do $prerequisites$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050147 and name='merchant_attendance_plan_exception_review')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name='merchant_attendance_work_arrangements') then
    raise exception 'merchant_attendance_work_arrangement_exceptions_prerequisite_required';
  end if;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060159 and name<>'merchant_attendance_work_arrangement_exceptions') then
    raise exception 'merchant_attendance_work_arrangement_exceptions_version_conflict';
  end if;
end;
$prerequisites$;
create or replace function public.faolla_attendance_plan_exception_source_legacy_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  envelope jsonb;coverage jsonb;child jsonb;item jsonb;adoption jsonb;compact jsonb;summary jsonb;source jsonb;source_text text;result jsonb;
  site text;wid uuid;employee uuid;member_auth uuid;place uuid;sid uuid;target_id uuid;approval_id uuid;associated_ids uuid[]:='{}';candidate_ids uuid[];
  slot jsonb;worker jsonb;approval jsonb;sessions jsonb:='[]';extra_items jsonb:='[]';leave_items jsonb:='[]';calendar_items jsonb:='[]';missing_items jsonb:='[]';pending_items jsonb:='[]';
  extra_limited boolean:=false;leave_limited boolean:=false;calendar_limited boolean:=false;missing_limited boolean:=false;pending_limited boolean:=false;
  flags text[]:='{}';blockers jsonb;candidate jsonb;field jsonb;field_result jsonb;key text;phase text;status_name text;failure text;
  plan_begin timestamptz;plan_end timestamptz;read_at timestamptz;a timestamptz;b timestamptz;original_start timestamptz;original_end timestamptz;
  selected_start timestamptz;selected_end timestamptz;all_closed boolean:=true;prior_end timestamptz;raw_delta numeric;excess numeric;grace integer;
  event_count integer:=0;ids uuid[];other_ids uuid[];calendar_ids uuid[];root_ids uuid[];
  bounds jsonb:='{}';cache_key text;from_day date;through_day date;boundary_date date;boundary_at timestamptz;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;
  root_effect public.merchant_attendance_correction_effects%rowtype;artifact public.merchant_attendance_plan_rule_artifacts%rowtype;
  decision public.merchant_attendance_correction_decisions%rowtype;revision_decision public.merchant_attendance_revision_decisions%rowtype;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  -- This is the authorization/lock acquisition, including empty relation sets.
  -- No impersonation, lock upgrades, independent current-head read or rescanning
  -- a changing association set after authorization.
  envelope:=public.faolla_attendance_plan_coverage_adoptions_v1(p_query,p_auth_user_id);
  coverage:=envelope->'coverage';site:=coverage->>'siteId';worker:=coverage->'worker';slot:=coverage->'slot';
  wid:=(worker->>'workerId')::uuid;employee:=(worker->>'employeeId')::uuid;member_auth:=(worker->>'employeeAuthUserId')::uuid;
  sid:=(slot->>'id')::uuid;place:=(slot->>'locationId')::uuid;plan_begin:=(slot->>'startAt')::timestamptz;plan_end:=(slot->>'endAt')::timestamptz;
  if envelope->>'protocol' is distinct from 'plan-coverage-adoptions-source-v1'
    or coverage->>'actorId' is distinct from p_auth_user_id::text or site is distinct from p_query->>'siteId'
    or wid::text is distinct from p_query->>'workerId' or sid::text is distinct from p_query->>'slotId'
    or employee is null or member_auth is null or jsonb_array_length(coverage->'sessions')>10
    or jsonb_array_length(coverage->'sessions')<>jsonb_array_length(envelope->'adoptions') then raise exception 'attendance_plan_exception_invalid';end if;
  if (slot->>'cancelled')::boolean then flags:=array_append(flags,'slot_cancelled');end if;
  if not (slot->>'hasPublicationEvidence')::boolean then flags:=array_append(flags,'publication_missing');end if;
  if not (worker->>'active')::boolean or not (worker->>'employeeActive')::boolean then flags:=array_append(flags,'worker_inactive');end if;
  if jsonb_array_length(coverage->'sessions')=0 then flags:=array_append(flags,'no_associated_sessions');end if;

  for child in select value from jsonb_array_elements(coverage->'sessions') loop
    compact:=public.faolla_attendance_plan_exception_session_v1(child);target_id:=(compact->>'startEventId')::uuid;
    associated_ids:=array_append(associated_ids,target_id);event_count:=event_count+jsonb_array_length(child->'events');
    if event_count>2002 then raise exception 'attendance_plan_exception_too_large';end if;
    select x.value->'adoption' into adoption from jsonb_array_elements(envelope->'adoptions') x where x.value->>'startEventId'=target_id::text;
    if adoption is null then raise exception 'attendance_plan_exception_invalid';end if;
    if child->'relation'->>'status' is distinct from 'linked' then flags:=array_append(flags,'association_unverified');end if;
    if adoption='null'::jsonb then flags:=array_append(flags,'adoption_missing');
    elsif adoption->>'status'<>'adopted' then flags:=array_append(flags,'adoption_unverified');
    elsif approval_id is null then
      approval_id:=(adoption->'approval'->>'operationId')::uuid;
      --145 already called the exact fixed-reference validator (p_current=false).
      -- Recheck the body/byte hash here; never use the mutable approval stream.
      select * into artifact from public.merchant_attendance_plan_rule_artifacts x
        where x.merchant_id=site and x.source_id=(adoption->'approval'->>'sourceId')::uuid;
      if artifact.source_id is null or artifact.worker_id<>wid or artifact.slot_id<>sid
        or artifact.employee_id<>employee or artifact.employee_auth_user_id<>member_auth
        or artifact.source_sha256 is distinct from adoption->'approval'->>'sourceSha256'
        or artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')
        or artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))
        or public.faolla_attendance_plan_rule_source_v1(artifact.source) is distinct from true then raise exception 'attendance_plan_exception_invalid';end if;
      approval:=(adoption->'approval')||jsonb_build_object('source',artifact.source);
    elsif adoption->'approval'->>'operationId' is distinct from approval_id::text
      or adoption->'approval' is distinct from (approval-'source') then flags:=array_append(flags,'approval_mismatch');end if;
    if exists(select 1 from jsonb_array_elements(child->'events') ev where ev.value->>'locationId' is distinct from place::text) then
      flags:=array_append(flags,'session_location_mismatch');end if;
    a:=(compact->'original'->>'startAt')::timestamptz;b:=(compact->'original'->>'endAt')::timestamptz;
    original_start:=least(original_start,a);original_end:=greatest(original_end,b);
    a:=(compact->'selected'->>'startAt')::timestamptz;b:=(compact->'selected'->>'endAt')::timestamptz;
    selected_start:=least(selected_start,a);selected_end:=greatest(selected_end,b);
    if b is null then all_closed:=false;flags:=array_append(flags,'session_open');
    elsif b=a then flags:=array_append(flags,'session_zero_duration');
    elsif a>=plan_end or b<=plan_begin then flags:=array_append(flags,'session_outside_plan');end if;
    sessions:=sessions||jsonb_build_array(compact||jsonb_build_object('relation',child->'relation','adoption',adoption));
  end loop;
  if not all_closed then original_end:=null;selected_end:=null;end if;
  for item in select value from jsonb_array_elements(sessions) order by (value->'selected'->>'startAt')::timestamptz,value->>'startEventId' loop
    a:=(item->'selected'->>'startAt')::timestamptz;b:=(item->'selected'->>'endAt')::timestamptz;
    if prior_end is not null and a<prior_end then flags:=array_append(flags,'session_overlap');end if;
    prior_end:=greatest(prior_end,b);
  end loop;

  -- Raw candidates use the existing clock_in partial index. One preceding
  -- anchor has NO lookback ceiling: an indefinitely open shift stays visible.
  ids:=array(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
    and x.occurred_at>=plan_begin and x.occurred_at<plan_end order by x.occurred_at,x.sequence limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;
  candidate_ids:=ids;
  select x.id into target_id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
    and x.occurred_at<plan_begin order by x.occurred_at desc,x.sequence desc limit 1;
  if target_id is not null then candidate_ids:=array_append(candidate_ids,target_id);end if;
  -- Separately bound ORIGINAL effect and every revised start range BEFORE latest
  -- selection. Thus a revision moved in from outside the raw window is not lost.
  ids:=array(select x.start_event_id from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at desc limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;candidate_ids:=candidate_ids||ids;
  ids:=array(select x.start_event_id from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at,x.start_event_id limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;candidate_ids:=candidate_ids||ids;
  candidate_ids:=array(select distinct x from unnest(candidate_ids) x where not(x=any(associated_ids)) order by x limit 101);
  if cardinality(candidate_ids)>100 then extra_limited:=true;end if;
  event_count:=0;
  if not extra_limited then
    foreach target_id in array candidate_ids loop
      begin
        child:=public.faolla_attendance_shift_check_v1(jsonb_build_object('siteId',site,'workerId',wid,'startEventId',target_id),p_auth_user_id);
        event_count:=event_count+jsonb_array_length(child->'events');
        if event_count>2002 then extra_limited:=true;exit;end if;
        compact:=public.faolla_attendance_plan_exception_session_v1(child);
        if ((compact->'original'->>'startAt')::timestamptz<plan_end and coalesce((compact->'original'->>'endAt')::timestamptz,'infinity'::timestamptz)>plan_begin)
          or ((compact->'selected'->>'startAt')::timestamptz<plan_end and coalesce((compact->'selected'->>'endAt')::timestamptz,'infinity'::timestamptz)>plan_begin) then
          extra_items:=extra_items||jsonb_build_array(compact||jsonb_build_object('relationSlotId',child->'relation'->'slot'->'id'));
        end if;
      exception when raise_exception then
        get stacked diagnostics failure=message_text;
        if failure in('attendance_shift_check_too_large','attendance_plan_adoption_view_too_large') then extra_limited:=true;exit;end if;
        raise;
      end;
    end loop;
  end if;
  if extra_limited then extra_items:='[]';end if;

  -- Leave: include all terminal states, no reason text and no automatic excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '8784 hours' and x.start_at<plan_end order by x.start_at,x.end_at limit 101);
  leave_limited:=cardinality(ids)>100;
  if not leave_limited then
    for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
      if leave_row.end_at<=plan_begin then continue;end if;
      if leave_row.employee_id<>employee or leave_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      summary:=public.faolla_attendance_leave_summary_v1(leave_row);
      select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id order by x.revision desc limit 1;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('requestId',leave_row.request_id,'operationId',leave_op.operation_id,
        'revision',summary->'revision','status',summary->'status','startAt',summary->'startAt','endAt',summary->'endAt','recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    end loop;
  end if;

  -- Calendar: two indexed scopes (enterprise and ORIGINAL slot location), never
  -- today's default location. Conservative366-day civil range, cap BEFORE costly
  -- chain/date checks; cache each distinct saved-zone/day boundary once.
  from_day:=(plan_begin at time zone 'UTC')::date-367;through_day:=(plan_end at time zone 'UTC')::date+2;
  calendar_ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
    and x.from_date>=from_day and x.from_date<=through_day order by x.from_date,x.through_date limit 101);
  ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=place
    and x.from_date>=from_day and x.from_date<=through_day order by x.from_date,x.through_date limit 101);
  calendar_ids:=calendar_ids||ids;calendar_limited:=cardinality(calendar_ids)>100;
  if not calendar_limited then
    for calendar_row in select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.entry_id=any(calendar_ids) order by x.entry_id loop
      summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
      foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
        cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
        if not(bounds ? cache_key) then
          boundary_at:=public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone);
          bounds:=bounds||jsonb_build_object(cache_key,to_char(boundary_at at time zone 'UTC',fmt));
        end if;
      end loop;
      a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;
      b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
      if a>=plan_end or b<=plan_begin then continue;end if;
      select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id order by x.revision desc limit 1;
      calendar_items:=calendar_items||jsonb_build_array(jsonb_build_object('entryId',calendar_row.entry_id,'operationId',calendar_op.operation_id,
        'revision',summary->'revision','status',summary->'status','locationId',calendar_row.location_id,'kind',calendar_row.kind,'timeZone',calendar_row.time_zone,
        'fromDate',summary->'fromDate','throughDate',summary->'throughDate','fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),
        'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
    end loop;
  end if;

  -- Missing declarations are independent request intervals, including pending
  -- revisions moved in. Do NOT only query the approved-current view. Each request
  -- has at most2 immutable entries. Bounded root membership proves supersession.
  ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '24 hours' and x.start_at<plan_end order by x.start_at,x.end_at limit 101);
  missing_limited:=cardinality(ids)>100;
  if not missing_limited then
    for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
      if missing_row.end_at<=plan_begin then continue;end if;
      if missing_row.employee_id<>employee or missing_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
      select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
      if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
        or missing_first.actor_auth_user_id is distinct from member_auth or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_first.command->'proposal' is distinct from missing_row.proposal
        or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at
        or missing_op.command->>'operationId' is distinct from missing_op.operation_id::text then raise exception 'attendance_plan_exception_invalid';end if;
      root_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site
        and coalesce(x.root_request_id,x.request_id)=coalesce(missing_row.root_request_id,missing_row.request_id) limit 101);
      if cardinality(root_ids)>100 then missing_limited:=true;exit;end if;
      status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
      if status_name is null then raise exception 'attendance_plan_exception_invalid';end if;
      missing_items:=missing_items||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,
        'revision',missing_op.revision,'status',status_name,'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),
        'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),'supersedesRequestId',missing_row.supersedes_request_id,
        'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
        'isCurrentApproved',status_name='approved' and not exists(select 1 from public.merchant_attendance_missing_requests x
          join public.merchant_attendance_missing_entries terminal on terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2 and terminal.action='approve'
          where x.merchant_id=site and x.request_id=any(root_ids) and x.supersedes_request_id=missing_row.request_id)));
    end loop;
  end if;
  if missing_limited then missing_items:='[]';end if;

  -- Pending proposals have no proposal-time index. Use existing worker submit
  -- indexes and101 BEFORE filtering status/overlap. Large history is explicitly
  -- unknown, not silently "no pending correction". Revision ordering exactly
  -- follows116's worker/identity/history index (no unbounded expression sort).
  ids:=array(select x.request_id from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.worker_id=wid and x.action='submit'
    order by x.recorded_at desc,x.request_id desc limit 101);
  other_ids:=array(select x.request_id from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.worker_id=wid and x.action='submit'
    order by x.employee_id,x.actor_auth_user_id,x.recorded_at desc,x.request_id desc limit 101);
  pending_limited:=cardinality(ids)>100 or cardinality(other_ids)>100;
  if not pending_limited then
    for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
      select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
      select * into decision from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id;
      if correction_tail.action<>'submit' or decision.operation_id is not null then continue;end if;
      a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
      if not(correction_row.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;
      if correction_row.employee_id<>employee or correction_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal
        or correction_tail.operation_id is distinct from correction_row.operation_id then raise exception 'attendance_plan_exception_invalid';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,
        'revision',correction_row.revision,'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt',
        'recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
    end loop;
    for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
      select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
      select * into revision_decision from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id;
      if revision_tail.action<>'submit' or revision_decision.operation_id is not null then continue;end if;
      select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
      a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
      if not(root_effect.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;
      if revision_row.employee_id<>employee or revision_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
        or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal'
        or revision_tail.operation_id is distinct from revision_row.operation_id then raise exception 'attendance_plan_exception_invalid';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,
        'revision',revision_row.revision,'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt',
        'recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
    end loop;
    if jsonb_array_length(pending_items)>100 then pending_limited:=true;end if;
  end if;
  if pending_limited then pending_items:='[]';end if;

  read_at:=clock_timestamp();
  if read_at<(coverage->>'readCompletedAt')::timestamptz then raise exception 'attendance_plan_exception_invalid';end if;
  phase:=case when read_at<plan_begin then 'future' when read_at<plan_end then 'ongoing' else 'ended' end;
  if phase<>'ended' then flags:=array_append(flags,'plan_not_ended');end if;
  if extra_limited or leave_limited or calendar_limited or missing_limited or pending_limited then flags:=array_append(flags,'context_unknown');end if;
  if jsonb_array_length(extra_items)>0 then flags:=array_append(flags,'unassociated_session');end if;
  if exists(select 1 from jsonb_array_elements(leave_items) x where x.value->>'status'='submitted') then flags:=array_append(flags,'leave_pending');end if;
  if exists(select 1 from jsonb_array_elements(leave_items) x where x.value->>'status'='approved') then flags:=array_append(flags,'leave_approved');end if;
  if exists(select 1 from jsonb_array_elements(calendar_items) x where x.value->>'status'='created') then flags:=array_append(flags,'calendar_entry');end if;
  if exists(select 1 from jsonb_array_elements(missing_items) x where x.value->>'status'='submitted' or (x.value->>'isCurrentApproved')::boolean) then flags:=array_append(flags,'missing_request');end if;
  if jsonb_array_length(pending_items)>0 then flags:=array_append(flags,'pending_correction');end if;
  -- The fixed order is also the browser/shared-contract enum order.
  select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb) into blockers
    from unnest(array['plan_not_ended','slot_cancelled','publication_missing','worker_inactive','no_associated_sessions','association_unverified',
      'adoption_missing','adoption_unverified','approval_mismatch','session_open','session_zero_duration','session_outside_plan','session_overlap',
      'session_location_mismatch','context_unknown','unassociated_session','leave_pending','leave_approved','calendar_entry','missing_request','pending_correction'])
      with ordinality x(value,ordinality) where x.value=any(flags);
  source:=jsonb_build_object('protocol','plan-exception-evidence-v1','policy','owner-confirmed-plan-edges-v1','siteId',site,'worker',worker,'slot',slot,'phase',phase,
    'approval',approval,'sessions',sessions,'context',jsonb_build_object(
      'unassociated',jsonb_build_object('limited',extra_limited,'items',extra_items),'leave',jsonb_build_object('limited',leave_limited,'items',leave_items),
      'calendar',jsonb_build_object('limited',calendar_limited,'items',calendar_items),'missing',jsonb_build_object('limited',missing_limited,'items',missing_items),
      'pendingCorrections',jsonb_build_object('limited',pending_limited,'items',pending_items)));
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  candidate:=jsonb_build_object('original',jsonb_build_object('startAt',to_char(original_start at time zone 'UTC',fmt),'endAt',to_char(original_end at time zone 'UTC',fmt)),
    'selected',jsonb_build_object('startAt',to_char(selected_start at time zone 'UTC',fmt),'endAt',to_char(selected_end at time zone 'UTC',fmt)));
  foreach key in array array['late','early'] loop
    field:=approval->'source'->'fields'->(case key when 'late' then 'lateGraceMinutes' else 'earlyGraceMinutes' end);
    if jsonb_array_length(blockers)>0 then field_result:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field is null or field->>'state'='unconfigured' then field_result:=jsonb_build_object('state','unconfigured','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state'='disabled' then field_result:=jsonb_build_object('state','disabled','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state'='value' then
      grace:=(field->>'minutes')::integer;
      raw_delta:=case key when 'late' then extract(epoch from selected_start-plan_begin)*1000000 else extract(epoch from plan_end-selected_end)*1000000 end;
      excess:=greatest(0,raw_delta-grace::numeric*60000000);
      field_result:=jsonb_build_object('state',case when raw_delta>grace::numeric*60000000 then 'triggered' else 'not_triggered' end,
        'minutes',grace,'rawDeltaUs',raw_delta::bigint::text,'excessUs',excess::bigint::text);
    else raise exception 'attendance_plan_exception_invalid';end if;
    candidate:=candidate||jsonb_build_object(key,field_result);
  end loop;
  result:=jsonb_build_object('protocol','plan-exception-source-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker,'slot',slot,
    'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'sourceText',source_text,
    'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',jsonb_array_length(blockers)=0,'blockers',blockers,'candidate',candidate);
  return result;
end;
$$;

create or replace function public.faolla_attendance_plan_exception_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;ordered_items jsonb;evidence jsonb;source_text text;blockers jsonb;candidate jsonb;field jsonb;
begin
  result:=public.faolla_attendance_plan_exception_source_legacy_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(result->>'siteId',
    (result->'worker'->>'workerId')::uuid,(result->'worker'->>'employeeId')::uuid,(result->'worker'->>'employeeAuthUserId')::uuid,
    (result->'slot'->>'startAt')::timestamptz,(result->'slot'->>'endAt')::timestamptz);
  if arrangements='[]'::jsonb then return result;end if;
  select jsonb_agg(x order by x->>'requestId') into ordered_items from jsonb_array_elements(arrangements) x;
  evidence:=jsonb_set(result->'source','{context,workArrangements}',jsonb_build_object('limited',false,'items',ordered_items))
    ||jsonb_build_object('protocol','plan-exception-evidence-v2','policy','owner-confirmed-plan-edges-work-v2');
  blockers:=result->'blockers';candidate:=result->'candidate';
  if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then blockers:=blockers||'["work_arrangement_pending"]'::jsonb;end if;
  -- Approved arrangements stay in the evidence. They do not waive an edge or
  -- permanently block an explicit owner decision; pending requests must first
  -- be resolved. Actual edge math remains the legacy calculation.
  if blockers<>'[]'::jsonb then
    field:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null);
    candidate:=candidate||jsonb_build_object('late',field,'early',field);
  end if;
  source_text:=evidence::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  return result||jsonb_build_object('protocol','plan-exception-source-v2','source',evidence,'sourceText',source_text,
    'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',blockers='[]'::jsonb,'blockers',blockers,'candidate',candidate);
end;
$$;

create or replace function public.faolla_attendance_plan_exception_review_evidence_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;part jsonb;item jsonb;field jsonb;ref_keys text[];previous text;current_key text;
begin
  if octet_length(convert_to(p::text,'UTF8'))>131072
    or public.faolla_attendance_shift_rule_binding_object_v1(p,array['policy','fingerprint','observedAt','eligible','blockers','candidate','approval','sessions','contextRefs']) is distinct from true
    or coalesce(p->>'policy','') not in('owner-confirmed-plan-edges-v1','owner-confirmed-plan-edges-work-v2')
    or jsonb_typeof(p->'fingerprint')<>'string' or p->>'fingerprint'!~'^[0-9a-f]{64}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'observedAt','stamp6') is distinct from true
    or jsonb_typeof(p->'eligible')<>'boolean' or jsonb_typeof(p->'blockers')<>'array'
    or jsonb_array_length(p->'blockers')>32 or jsonb_typeof(p->'sessions')<>'array' or jsonb_array_length(p->'sessions')>10
    or public.faolla_attendance_shift_rule_binding_object_v1(p->'candidate',array['late','early','original','selected']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(p->'contextRefs',array['unassociated','leave','calendar','missing','pendingCorrections']||case when p->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end) is distinct from true then return false;end if;
  if (p->>'eligible')::boolean<>(jsonb_array_length(p->'blockers')=0)
    or exists(select 1 from jsonb_array_elements(p->'blockers') x where jsonb_typeof(x)<>'string')
    or exists(select 1 from jsonb_array_elements_text(p->'blockers') x where x not in('plan_not_ended','slot_cancelled','publication_missing','worker_inactive',
      'no_associated_sessions','association_unverified','adoption_missing','adoption_unverified','approval_mismatch','session_open','session_zero_duration',
      'session_outside_plan','session_overlap','session_location_mismatch','context_unknown','unassociated_session','leave_pending','leave_approved',
      'calendar_entry','missing_request','pending_correction','work_arrangement_pending','work_arrangement_approved'))
    or (select count(*)<>count(distinct x) from jsonb_array_elements(p->'blockers') x) then return false;end if;
  foreach k in array array['late','early'] loop
    field:=p->'candidate'->k;
    if public.faolla_attendance_shift_rule_binding_object_v1(field,array['state','minutes','rawDeltaUs','excessUs']) is distinct from true
      or jsonb_typeof(field->'state')<>'string' or field->>'state' not in('blocked','unconfigured','disabled','triggered','not_triggered') then return false;end if;
    if field->>'state' in('triggered','not_triggered') then
      if jsonb_typeof(field->'minutes')<>'number' or field->>'minutes'!~'^(0|[1-9][0-9]*)$' or (field->>'minutes')::numeric>1440
        or jsonb_typeof(field->'rawDeltaUs')<>'string' or field->>'rawDeltaUs'!~'^(0|-?[1-9][0-9]*)$'
        or jsonb_typeof(field->'excessUs')<>'string' or field->>'excessUs'!~'^(0|[1-9][0-9]*)$'
        or (field->>'excessUs')::numeric<>greatest(0,(field->>'rawDeltaUs')::numeric-(field->>'minutes')::numeric*60000000)
        or (field->>'state'='triggered')<>((field->>'excessUs')::numeric>0) then return false;end if;
    elsif field->'minutes'<>'null'::jsonb or field->'rawDeltaUs'<>'null'::jsonb or field->'excessUs'<>'null'::jsonb then return false;end if;
    if (field->>'state'='blocked')=(p->>'eligible')::boolean then return false;end if;
  end loop;
  foreach k in array array['original','selected'] loop
    part:=p->'candidate'->k;
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['startAt','endAt']) is distinct from true then return false;end if;
    if part->'startAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(part->'startAt','stamp6') is distinct from true
      or part->'endAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(part->'endAt','stamp6') is distinct from true then return false;end if;
  end loop;
  part:=p->'approval';
  if part<>'null'::jsonb then
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['operationId','revision','sourceId','sourceSha256','recordedAt']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'operationId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'sourceId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'revision','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'recordedAt','stamp6') is distinct from true
      or jsonb_typeof(part->'sourceSha256')<>'string' or part->>'sourceSha256'!~'^[0-9a-f]{64}$' then return false;end if;
  end if;
  foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when p->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
    if k='sessions' then part:=jsonb_build_object('limited',false,'items',p->'sessions');
    else part:=p->'contextRefs'->k;end if;
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['limited','items']) is distinct from true
      or jsonb_typeof(part->'limited')<>'boolean' or jsonb_typeof(part->'items')<>'array'
      or jsonb_array_length(part->'items')>100 or (part->>'limited')::boolean and part->'items'<>'[]'::jsonb then return false;end if;
    previous:=null;
    for item in select value from jsonb_array_elements(part->'items') loop
      ref_keys:=case when k in('sessions','unassociated') then array['startEventId','lastEventId','lastSequence','effectOperationId']
        when k='calendar' then array['entryId','operationId','revision']
        when k='pendingCorrections' then array['kind','requestId','operationId','revision','startEventId']
        else array['requestId','operationId','revision'] end;
      if public.faolla_attendance_shift_rule_binding_object_v1(item,ref_keys) is distinct from true then return false;end if;
      if k in('sessions','unassociated') then
        if public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startEventId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'lastEventId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'lastSequence','version') is distinct from true
          or item->'effectOperationId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(item->'effectOperationId','uuid') is distinct from true then return false;end if;
        current_key:=item->>'startEventId';
      else
        if public.faolla_attendance_shift_rule_binding_scalar_v1(item->case when k='calendar' then 'entryId' else 'requestId' end,'uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'operationId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'revision','version') is distinct from true then return false;end if;
        current_key:=case when k='calendar' then item->>'entryId' else item->>'requestId' end;
        if k='pendingCorrections' then
          if jsonb_typeof(item->'kind')<>'string' or item->>'kind' not in('correction','revision') or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startEventId','uuid') is distinct from true then return false;end if;
          current_key:=(item->>'kind')||':'||current_key;
        end if;
      end if;
      if previous is not null and current_key<=previous then return false;end if;previous:=current_key;
    end loop;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$$;

create or replace function public.faolla_attendance_plan_exception_review_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for share;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
    source_result:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome'<>'follow_up' and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections']||case when source_result->'source'->>'policy'='owner-confirmed-plan-edges-work-v2' then array['workArrangements'] else array[]::text[] end loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_result->'source'->'sessions') else source_result->'source'->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          elsif k='workArrangements' then
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'history'->-1->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy',source_result->'source'->>'policy','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions');
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and s.enabled and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_exception_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_exception_source_v1(jsonb,uuid) to service_role;
revoke all on function public.faolla_attendance_plan_exception_review_evidence_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610060159,'merchant_attendance_work_arrangement_exceptions') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
