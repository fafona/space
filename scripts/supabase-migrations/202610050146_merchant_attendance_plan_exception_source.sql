-- Independent owner-only manual-review evidence. No automatic assignment,
-- absence, payroll, clock, correction, approval or stored-history mutations.
--145 retains merchant/settings/worker/employee SHARE through this whole read.
begin;
set local lock_timeout='3s';

do $plan_exception_prerequisites$
declare installed boolean;dependency record;signature text;relation_name text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_plan_exception_prerequisite_required';end if;
  for dependency in select * from (values
    (202609300083::bigint,'merchant_attendance_correction_owner_review'),
    (202610010095::bigint,'merchant_attendance_revision_cycles'),
    (202610010103::bigint,'merchant_attendance_missing_revisions'),
    (202610030116::bigint,'merchant_attendance_self_revision_history'),
    (202610030122::bigint,'merchant_attendance_leave_requests'),
    (202610030123::bigint,'merchant_attendance_calendar'),
    (202610050145::bigint,'merchant_attendance_plan_adoption_view')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_plan_exception_prerequisite_required';end if;
  end loop;
  foreach relation_name in array array['merchant_attendance_missing_requests','merchant_attendance_missing_entries',
    'merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_calendar_entries',
    'merchant_attendance_calendar_operations','merchant_attendance_effect_versions','merchant_attendance_plan_rule_artifacts'] loop
    if to_regclass('public.'||relation_name) is null then raise exception 'merchant_attendance_plan_exception_prerequisite_required';end if;
  end loop;
  foreach signature in array array['public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)',
    'public.faolla_attendance_shift_check_v1(jsonb,uuid)','public.faolla_attendance_plan_rule_source_v1(jsonb)',
    'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',
    'public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)',
    'public.faolla_attendance_control_day_boundary_v1(date,text)'] loop
    if to_regprocedure(signature) is null then raise exception 'merchant_attendance_plan_exception_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050146 and name='merchant_attendance_plan_exception_source') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050146 and name<>'merchant_attendance_plan_exception_source') then
    raise exception 'merchant_attendance_plan_exception_installation_conflict';end if;
  foreach signature in array array['public.faolla_attendance_plan_exception_session_v1(jsonb)',
    'public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(signature) is not null) then raise exception 'merchant_attendance_plan_exception_installation_conflict';end if;
  end loop;
end;
$plan_exception_prerequisites$;

-- Trusted138 projection only, not a validator for caller-supplied event facts.
-- Preserve original versus latest approved edges; never invent a clock_out.
create or replace function public.faolla_attendance_plan_exception_session_v1(p_check jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare first_event jsonb;last_event jsonb;effect jsonb;original jsonb;selected jsonb;effect_ref jsonb;
begin
  if p_check->>'protocol' is distinct from 'shift-check-source-v1' or jsonb_typeof(p_check->'events') is distinct from 'array'
    or jsonb_array_length(p_check->'events') not between 1 and 2002 then raise exception 'attendance_plan_exception_invalid';end if;
  first_event:=p_check->'events'->0;last_event:=p_check->'events'->-1;effect:=nullif(p_check->'effect','null'::jsonb);
  original:=jsonb_build_object('startAt',first_event->'occurredAt','endAt',case when last_event->>'action'='clock_out' then last_event->'occurredAt' else 'null'::jsonb end);
  selected:=original;
  if effect is not null then
    selected:=jsonb_build_object('startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt');
    effect_ref:=jsonb_build_object('requestId',effect->'requestId','operationId',effect->'operationId','revision',effect->'revision',
      'recordedAt',effect->'recordedAt','rootRequestId',effect->'lineage'->'rootRequestId','previousOperationId',effect->'lineage'->'previousOperationId');
  end if;
  return jsonb_build_object('startEventId',first_event->'id','operationId',p_check->'binding'->'event'->'operationId',
    'lastEventId',last_event->'id','lastSequence',last_event->'sequence','original',original,'selected',selected,'effect',effect_ref);
end;
$$;

create or replace function public.faolla_attendance_plan_exception_source_v1(p_query jsonb,p_auth_user_id uuid)
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

revoke all on function public.faolla_attendance_plan_exception_session_v1(jsonb),public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_exception_source_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050146,'merchant_attendance_plan_exception_source') on conflict(version) do nothing;

do $plan_exception_postconditions$
declare signature text;role_name text;is_rpc boolean;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050146 and name='merchant_attendance_plan_exception_source') then
    raise exception 'merchant_attendance_plan_exception_registry_postcondition_failed';end if;
  foreach signature in array array['public.faolla_attendance_plan_exception_session_v1(jsonb)','public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)'] loop
    is_rpc:=signature='public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)';
    if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(signature) and x.prosecdef=is_rpc and x.provolatile='v'
      and x.prorettype='jsonb'::regtype and x.proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_plan_exception_definition_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') is distinct from (is_rpc and role_name='service_role') then
        raise exception 'merchant_attendance_plan_exception_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) acl
      where x.oid=to_regprocedure(signature) and acl.grantee=0 and acl.privilege_type='EXECUTE') then raise exception 'merchant_attendance_plan_exception_acl_postcondition_failed';end if;
  end loop;
end;
$plan_exception_postconditions$;
notify pgrst, 'reload schema';
commit;
