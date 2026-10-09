-- Local candidate187. Preserve155 fixed frames and all old archives; only a
-- relevant work-arrangement ledger adds an explicit v2 source context.
begin;
set local lock_timeout='3s';
do $prerequisites$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050155 and name='merchant_attendance_period_fixed_boundaries')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name='merchant_attendance_work_arrangements') then
    raise exception 'merchant_attendance_work_arrangement_periods_prerequisite_required';
  end if;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060158 and name<>'merchant_attendance_work_arrangement_periods') then
    raise exception 'merchant_attendance_work_arrangement_periods_version_conflict';
  end if;
end;
$prerequisites$;

create or replace function public.faolla_attendance_period_closure_source_base_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;wid uuid;access_name text;first_day date;last_day date;range_from timestamptz;range_to timestamptz;observed timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  report jsonb;base jsonb;result jsonb;canonical jsonb;source_text text;day_items jsonb:='[]';d date;a timestamptz;b timestamptz;
  item jsonb;child jsonb;summary jsonb;context jsonb;plans jsonb:='[]';sessions jsonb:='[]';reviews jsonb:='[]';leaves jsonb:='[]';calendars jsonb:='[]';missing jsonb:='[]';pending jsonb:='[]';
  flags text[]:='{}';blockers jsonb;ids uuid[];other_ids uuid[];candidate_ids uuid[];session_ids uuid[]:='{}';report_ids uuid[]:='{}';place_ids uuid[]:='{}';place uuid;target_id uuid;
  ev public.merchant_attendance_events%rowtype;endpoint public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;
  missing_base_ids uuid[];missing_child_ids uuid[];missing_parent public.merchant_attendance_missing_requests%rowtype;missing_root public.merchant_attendance_missing_requests%rowtype;
  missing_parent_approval public.merchant_attendance_missing_entries%rowtype;missing_proposal jsonb;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;root_effect public.merchant_attendance_correction_effects%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;review_head public.merchant_attendance_plan_exception_entries%rowtype;
  rule_stream public.merchant_attendance_plan_rule_streams%rowtype;rule_operation public.merchant_attendance_plan_rule_operations%rowtype;current_approval jsonb;
  decision_row public.merchant_attendance_plan_exception_entries%rowtype;note_row public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  current_source jsonb;status_name text;bounds jsonb:='{}';cache_key text;boundary_date date;total_events integer:=0;expected_report_count integer:=0;

  missing_approved_ids uuid[];missing_edge_ids uuid[];missing_sibling_ids uuid[];missing_is_current boolean;
  missing_successor public.merchant_attendance_missing_requests%rowtype;missing_successor_first public.merchant_attendance_missing_entries%rowtype;
  missing_successor_approval public.merchant_attendance_missing_entries%rowtype;missing_checked_approval public.merchant_attendance_missing_entries%rowtype;
  fixed_head public.merchant_attendance_period_closures%rowtype;fixed_artifact public.merchant_attendance_period_artifacts%rowtype;
  fixed_version public.merchant_attendance_period_versions%rowtype;fixed_body jsonb;current_body jsonb;fixed_frame jsonb;fixed_day jsonb;fixed_pid uuid;fixed_index integer:=0;
  fixed_previous timestamptz;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','periodId']) is distinct from true
    or p_auth_user_id is null or coalesce(p_query->>'siteId','')!~'^\d{8}$' or jsonb_typeof(p_query->'siteId')<>'string'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self') or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'fromDate') is distinct from true or public.faolla_attendance_group_date_v1(p_query->>'throughDate') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if p_query->'periodId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'periodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  fixed_pid:=(p_query->>'periodId')::uuid;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:=p_query->>'access';first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  -- First match self without locks to avoid locking another person's worker;
  -- recheck the authenticated identity under the employee lock below.
  if access_name='self' and not exists(select 1 from public.merchant_attendance_workers x join public.merchant_enterprise_employees e
    on e.merchant_id=x.merchant_id and e.id=x.employee_id where x.merchant_id=site and x.id=wid and e.auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if emp.id is null or emp.auth_user_id is null then raise exception 'attendance_period_source_identity_changed';end if;
  if access_name='self' then
    if emp.auth_user_id<>p_auth_user_id or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    if role_row.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  --155 fixed frame begins. The caller supplies only an identity, never a zone,
  -- UTC interval, day boundary, session setting, or impersonated owner.
  if fixed_pid is not null then
    select * into fixed_head from public.merchant_attendance_period_closures where merchant_id=site and period_id=fixed_pid;
  end if;
  if fixed_head.period_id is null then
    -- A first send has a new UUID but no saved frame yet. Preserve154 exactly.
    return public.faolla_attendance_period_source_v1(p_query-'periodId',p_auth_user_id);
  end if;
  if fixed_head.worker_id<>wid or fixed_head.from_date<>first_day or fixed_head.through_date<>last_day then raise exception 'attendance_access_denied';end if;
  if fixed_head.employee_id<>emp.id or fixed_head.employee_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=1;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  fixed_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,fixed_body);
  if fixed_version.version is distinct from 1 or coalesce(fixed_body->'source'->>'sourceVersion','') not in ('attendance-period-source-v1','attendance-period-source-v2')
    or fixed_body->'source'->>'siteId' is distinct from site or fixed_body->'source'->>'workerId' is distinct from wid::text
    or fixed_body->'source'->>'employeeId' is distinct from emp.id::text or fixed_body->'source'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text
    or fixed_body->'source'->>'sourceFingerprint' is not null
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((fixed_body->'source')::text,'UTF8')),'hex')
    or fixed_body->'source'->>'fromDate' is distinct from first_day::text or fixed_body->'source'->>'throughDate' is distinct from last_day::text
    or fixed_body->'source'->>'timeZone' is distinct from fixed_head.time_zone
    or fixed_body->'source'->>'fromAt' is distinct from to_char(fixed_head.start_at at time zone 'UTC',fmt)
    or fixed_body->'source'->>'toAt' is distinct from to_char(fixed_head.end_at at time zone 'UTC',fmt)
    or fixed_body->'dayBoundaries' is distinct from fixed_body->'source'->'dayBoundaries'
    or jsonb_array_length(fixed_body->'dayBoundaries')<>last_day-first_day+1 then raise exception 'attendance_period_closure_invalid';end if;
  -- Authoritative first-version civil dates must be ordered, gapless and exactly
  -- cover the saved UTC head. A skipped date has equal endpoints, not a missing
  -- row. No current PostgreSQL timezone lookup is used to validate old days.
  for fixed_day in select value from jsonb_array_elements(fixed_body->'dayBoundaries') loop
    if public.faolla_attendance_shift_rule_binding_object_v1(fixed_day,array['date','fromAt','toAt','skipped']) is distinct from true
      or fixed_day->>'date' is distinct from (first_day+fixed_index)::text
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'fromAt','stamp6') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'toAt','stamp6') is distinct from true
      or jsonb_typeof(fixed_day->'skipped') is distinct from 'boolean' then raise exception 'attendance_period_closure_invalid';end if;
    a:=(fixed_day->>'fromAt')::timestamptz;b:=(fixed_day->>'toAt')::timestamptz;
    if a>b or fixed_day->'skipped' is distinct from to_jsonb(a=b)
      or fixed_index=0 and a is distinct from fixed_head.start_at
      or fixed_index>0 and a is distinct from fixed_previous then raise exception 'attendance_period_closure_invalid';end if;
    fixed_previous:=b;fixed_index:=fixed_index+1;
  end loop;
  if fixed_previous is distinct from fixed_head.end_at
    or fixed_body->'dayBoundaries'->0->'skipped' is distinct from 'false'::jsonb
    or fixed_body->'dayBoundaries'->-1->'skipped' is distinct from 'false'::jsonb then raise exception 'attendance_period_closure_invalid';end if;
  -- Later versions may change business sources, never this period's frame.
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=fixed_head.current_version;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  current_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,current_body);
  if current_body->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or current_body->'source'->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((current_body->'source')::text,'UTF8')),'hex') then raise exception 'attendance_period_closure_invalid';end if;
  fixed_frame:=jsonb_build_object('timeZone',fixed_head.time_zone,'fromAt',to_char(fixed_head.start_at at time zone 'UTC',fmt),'toAt',to_char(fixed_head.end_at at time zone 'UTC',fmt));
  --155 fixed frame ends.
  report:=public.faolla_attendance_period_closure_unified_report_v1(site,p_auth_user_id,case when access_name='owner' then
    jsonb_build_object('access','owner','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end,fixed_frame);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  day_items:=fixed_body->'dayBoundaries';
  -- Mirror the unfiltered owner candidate set. The scoped reader may silently
  -- omit a mixed-identity session; compare the complete private set explicitly.
  candidate_ids:=array(with inside as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at>=range_from and x.occurred_at<range_to order by x.occurred_at,x.sequence limit 101),
    preceding as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1),
    moved as(select x.start_event_id id from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid
      and x.start_at>=range_from-interval '744 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.start_event_id limit 101)
    select id from (select id from inside union select id from preceding union select id from moved) all_candidates order by id limit 102);
  for ev in select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.id=any(candidate_ids) order by x.sequence loop
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce(endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
  end loop;
  if expected_report_count<>jsonb_array_length(base->'items') or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;

  -- Full original plan membership, including cancelled plans and associations
  -- whose original/latest endpoints moved outside this period. No auto matching.
  ids:=array(select x.id from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=any(ids) order by x.id loop
    if slot_row.end_at<=range_from then continue;end if;
    if slot_row.employee_id<>emp.id then raise exception 'attendance_period_source_identity_changed';end if;
    item:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if item->'publication'->>'employeeAuthUserId' is null then raise exception 'attendance_period_source_identity_unproven';end if;
    if item->'publication'->>'employeeId' is distinct from emp.id::text or item->'publication'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text then
      raise exception 'attendance_period_source_identity_changed';end if;
    current_approval:=null;
    select * into rule_stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=slot_row.id;
    if rule_stream.slot_id is not null then
      if row(rule_stream.worker_id,rule_stream.employee_id,rule_stream.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into rule_operation from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=slot_row.id and x.revision=rule_stream.revision;
      if rule_operation.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      current_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,slot_row.id,emp.id,emp.auth_user_id,rule_operation.operation_id);
    end if;
    plans:=plans||jsonb_build_array(item||jsonb_build_object('currentApproval',current_approval));
    other_ids:=array(select x.start_event_id from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11);
    if cardinality(other_ids)>10 then raise exception 'attendance_period_source_too_large';end if;
    foreach target_id in array other_ids loop
      if target_id=any(session_ids) then continue;end if;
      child:=public.faolla_attendance_period_session_v1(site,wid,target_id,emp.id,emp.auth_user_id,observed);
      sessions:=sessions||jsonb_build_array(child);session_ids:=array_append(session_ids,target_id);total_events:=total_events+jsonb_array_length(child->'item'->'events');
      if cardinality(session_ids)>100 or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;
      if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(value order by value->'item'->>'startEventId'),'[]'::jsonb) into sessions from jsonb_array_elements(sessions);

  -- Leave retains current terminal state, not a payroll deduction/excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if leave_row.end_at<=range_from then continue;end if;
    if leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    summary:=public.faolla_attendance_leave_summary_v1(leave_row);
    select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id and x.revision=(summary->>'revision')::integer;
    leaves:=leaves||jsonb_build_array(jsonb_build_object('workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,'summary',summary,
      'operationId',leave_op.operation_id,'recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    if summary->>'status'='submitted' then flags:=array_append(flags,'pending_leave');end if;
  end loop;
  -- Saved locations only. No current default location and no unrelated people.
  place_ids:=array(select distinct id from (select (event->>'locationId')::uuid id from jsonb_array_elements(sessions) r cross join lateral jsonb_array_elements(r->'item'->'events') event
    union all select (value->>'locationId')::uuid from jsonb_array_elements(report->'missing')
    union all select (value->'slot'->>'locationId')::uuid from jsonb_array_elements(plans)) places where id is not null order by id limit 101);
  if cardinality(place_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  -- Date indexes narrow each saved scope; they are only a conservative UTC
  -- superset. Do NOT cap that superset: only precise saved-zone overlaps count.
  -- The existing local cache avoids repeating STABLE/tzdata boundary work for
  -- equal (zone,date). No UTC/tzdata expression is falsely declared immutable.
  for calendar_row in
    select candidates.* from (
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
      union all
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=any(place_ids)
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
    ) candidates order by candidates.entry_id
  loop
    foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
      cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
      if not(bounds ? cache_key) then bounds:=bounds||jsonb_build_object(cache_key,to_char(public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone) at time zone 'UTC',fmt));end if;
    end loop;
    a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
    if a>=range_to or b<=range_from then continue;end if;
    if jsonb_array_length(calendars)>=100 then raise exception 'attendance_period_source_too_large';end if;
    summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
    select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id and x.revision=(summary->>'revision')::integer;
    calendars:=calendars||jsonb_build_array(jsonb_build_object('summary',summary,'operationId',calendar_op.operation_id,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
  end loop;

  -- Relevant missing facts retain the151 exact UTC window. A direct pending
  -- revision can move OUT of that window while replacing an approved parent
  -- which is still counted in this period. Include that request, not its hours.
  -- No recursive/root expansion: once an approved successor is outside, its
  -- own outside pending successor does not affect an old ancestor's period.
  missing_base_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(missing_base_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  missing_child_ids:=array(
    select child.request_id from unnest(missing_base_ids) relevant_parent(request_id)
    cross join lateral(
      select x.request_id from public.merchant_attendance_missing_requests x
      where x.merchant_id=site and x.supersedes_request_id=relevant_parent.request_id and x.supersedes_request_id is not null
        and not exists(select 1 from public.merchant_attendance_missing_entries terminal
          where terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2)
      order by x.request_id limit 101
    ) child order by child.request_id limit 101);
  -- Do not filter the new child candidates by worker/Auth: an invalid saved
  -- relationship must be rejected, not silently omitted from a complete source.
  ids:=array(select distinct candidate.request_id from unnest(missing_base_ids||missing_child_ids) candidate(request_id) order by candidate.request_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if row(missing_row.worker_id,missing_row.employee_id,missing_row.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
      raise exception 'attendance_period_source_identity_changed';end if;
    select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
    select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
    if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
      or missing_first.actor_auth_user_id is distinct from emp.auth_user_id or missing_first.command->'proposal' is distinct from missing_row.proposal
      or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at then raise exception 'attendance_period_source_invalid';end if;
    -- Validate every pending revision we actually return, including an in-window
    -- child whose approved parent is outside. This checks saved UTC/identity and
    -- immutable receipt linkage only: no current employment/timezone/policy
    -- eligibility, and no owner impersonation or old writer invocation.
    if missing_row.supersedes_request_id is not null and missing_op.revision=1 then
      select * into missing_parent from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries x
        where x.merchant_id=site and x.request_id=missing_parent.request_id and x.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_row.supersedes_operation_id
        or missing_row.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_row.location_id is distinct from missing_parent.location_id or missing_row.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_row.submitted_at
        or exists(select 1 from public.merchant_attendance_missing_requests successor
          join public.merchant_attendance_missing_entries approved on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
            and approved.revision=2 and approved.action='approve'
          where successor.merchant_id=site and successor.supersedes_request_id=missing_parent.request_id)
        or exists(select 1 from public.merchant_attendance_missing_requests sibling
          where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id and sibling.request_id<>missing_row.request_id
            and not exists(select 1 from public.merchant_attendance_missing_entries terminal
              where terminal.merchant_id=sibling.merchant_id and terminal.request_id=sibling.request_id and terminal.revision=2)) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null or missing_root.supersedes_request_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      if public.faolla_attendance_shift_rule_binding_object_v1(missing_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_first.command->>'action' is distinct from 'revise'
        or missing_first.command->>'operationId' is distinct from missing_row.request_id::text
        or missing_first.command->>'expectedWorkerId' is distinct from missing_row.worker_id::text
        or missing_first.command->>'supersedesRequestId' is distinct from missing_row.supersedes_request_id::text
        or missing_first.command->>'expectedApprovalOperationId' is distinct from missing_row.supersedes_operation_id::text
        or missing_first.command->>'locationId' is distinct from missing_row.location_id::text
        or missing_first.command->>'timeZone' is distinct from missing_row.time_zone
        or missing_first.command->>'reason' is distinct from missing_row.reason
        or missing_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_row.policy_revision)
        or jsonb_typeof(missing_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_first.command->>'expectedSettingsVersion')::numeric>9007199254740989
        or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_op.operation_id is distinct from missing_first.operation_id then raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_row.proposal,missing_row.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_row.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_row.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_row.end_at then raise exception 'attendance_period_source_invalid';end if;
    end if;
    status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
    if status_name is null then raise exception 'attendance_period_source_invalid';end if;
    --154 direct-approved-edge validation begins.
    -- Do not enumerate/cap lifetime root history. A direct approval makes the
    -- parent historical even if that child was later superseded. Never filter
    -- by worker/Auth/root/date before validation: an invalid edge must not hide.
    -- LIMIT2 is a duplicate witness, not a constant-cost scan claim: rejected/
    -- withdrawn siblings can still require indexed probes under the deadline.
    missing_approved_ids:=array(select successor.request_id
      from public.merchant_attendance_missing_requests successor
      join public.merchant_attendance_missing_entries approved
        on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
          and approved.revision=2 and approved.action='approve'
      where successor.merchant_id=site and successor.supersedes_request_id=missing_row.request_id
        and successor.supersedes_request_id is not null limit 2);
    if cardinality(missing_approved_ids)>1 then raise exception 'attendance_period_source_invalid';end if;
    missing_is_current:=status_name='approved' and cardinality(missing_approved_ids)=0;
    missing_edge_ids:=missing_approved_ids;
    -- A returned approved revision may itself have an out-of-period parent.
    -- Validate that incoming edge too; at most two local edges, never recurse.
    if status_name='approved' and missing_row.supersedes_request_id is not null then
      missing_edge_ids:=array_append(missing_edge_ids,missing_row.request_id);
    end if;
    for missing_successor in select successor.* from public.merchant_attendance_missing_requests successor
      where successor.merchant_id=site and successor.request_id=any(missing_edge_ids) order by successor.request_id loop
      if row(missing_successor.worker_id,missing_successor.employee_id,missing_successor.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent from public.merchant_attendance_missing_requests parent
        where parent.merchant_id=site and parent.request_id=missing_successor.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_parent.request_id and approval.revision=2;
      select * into missing_successor_first from public.merchant_attendance_missing_entries submission
        where submission.merchant_id=site and submission.request_id=missing_successor.request_id and submission.revision=1;
      select * into missing_successor_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_successor.request_id and approval.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_successor.supersedes_operation_id
        or missing_successor.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_successor.location_id is distinct from missing_parent.location_id
        or missing_successor.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_successor.submitted_at
        or missing_successor_approval.action is distinct from 'approve'
        or missing_successor_approval.recorded_at<missing_successor.submitted_at
        --103 explicitly prohibits a revision approval before its submission,
        -- but makes no corresponding monotonic-clock promise for an initial root.
        or (missing_parent.supersedes_request_id is not null and missing_parent_approval.recorded_at<missing_parent.submitted_at) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests root_row
        where root_row.merchant_id=site and root_row.request_id=missing_successor.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null
        or missing_root.supersedes_request_id is not null or missing_root.supersedes_operation_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      -- The incoming edge's parent might not be one of our returned rows.
      -- Validate uniqueness there too; no current-head/current-owner test.
      missing_sibling_ids:=array(select sibling.request_id from public.merchant_attendance_missing_requests sibling
        join public.merchant_attendance_missing_entries approved
          on approved.merchant_id=sibling.merchant_id and approved.request_id=sibling.request_id
            and approved.revision=2 and approved.action='approve'
        where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id
          and sibling.supersedes_request_id is not null limit 2);
      if cardinality(missing_sibling_ids)<>1 or missing_sibling_ids[1] is distinct from missing_successor.request_id then
        raise exception 'attendance_period_source_invalid';end if;
      if missing_successor_first.operation_id is distinct from missing_successor.request_id
        or missing_successor_first.action is distinct from 'submit'
        or missing_successor_first.actor_auth_user_id is distinct from missing_successor.actor_auth_user_id
        or missing_successor_first.recorded_at is distinct from missing_successor.submitted_at
        or missing_successor_first.command->'proposal' is distinct from missing_successor.proposal
        or public.faolla_attendance_shift_rule_binding_object_v1(missing_successor_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_successor_first.command->>'action' is distinct from 'revise'
        or missing_successor_first.command->>'operationId' is distinct from missing_successor.request_id::text
        or missing_successor_first.command->>'expectedWorkerId' is distinct from missing_successor.worker_id::text
        or missing_successor_first.command->>'supersedesRequestId' is distinct from missing_parent.request_id::text
        or missing_successor_first.command->>'expectedApprovalOperationId' is distinct from missing_parent_approval.operation_id::text
        or missing_successor_first.command->>'locationId' is distinct from missing_successor.location_id::text
        or missing_successor_first.command->>'timeZone' is distinct from missing_successor.time_zone
        or missing_successor_first.command->>'reason' is distinct from missing_successor.reason
        or jsonb_typeof(missing_successor_first.command->'reason') is distinct from 'string'
        or char_length(missing_successor.reason) not between 1 and 200 or missing_successor.reason<>btrim(missing_successor.reason)
        or missing_successor.reason ~ '[[:cntrl:]]'
        or missing_successor_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_successor.policy_revision)
        or jsonb_typeof(missing_successor_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_successor_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_successor_first.command->>'expectedSettingsVersion')::numeric>9007199254740989 then
        raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_successor.proposal,missing_successor.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_successor.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_successor.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_successor.end_at then
        raise exception 'attendance_period_source_invalid';end if;
      -- Both approval receipts bind their actual request and operation. Their
      -- historical owner may differ from today's caller/owner, but cannot be the
      -- applicant itself. Do not revalidate old evidenceTokens against today.
      for missing_checked_approval in select approval.* from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.operation_id in(missing_parent_approval.operation_id,missing_successor_approval.operation_id) loop
        if missing_checked_approval.actor_auth_user_id=emp.auth_user_id
          or public.faolla_attendance_shift_rule_binding_object_v1(missing_checked_approval.command,
            array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
          or missing_checked_approval.command->>'action' is distinct from 'approve'
          or missing_checked_approval.command->>'operationId' is distinct from missing_checked_approval.operation_id::text
          or missing_checked_approval.command->>'requestId' is distinct from missing_checked_approval.request_id::text
          or missing_checked_approval.command->'expectedRevision' is distinct from '1'::jsonb
          or jsonb_typeof(missing_checked_approval.command->'evidenceToken') is distinct from 'string'
          or coalesce(missing_checked_approval.command->>'evidenceToken','')!~'^[a-f0-9]{32}$'
          or jsonb_typeof(missing_checked_approval.command->'reason') is distinct from 'string'
          or char_length(missing_checked_approval.command->>'reason') not between 1 and 200
          or (missing_checked_approval.command->>'reason')<>btrim(missing_checked_approval.command->>'reason')
          or (missing_checked_approval.command->>'reason') ~ '[[:cntrl:]]' then
          raise exception 'attendance_period_source_invalid';end if;
      end loop;
    end loop;
    --154 direct-approved-edge validation ends.
    missing:=missing||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,'revision',missing_op.revision,'status',status_name,
      'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),
      'supersedesRequestId',missing_row.supersedes_request_id,'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
      'isCurrentApproved',missing_is_current));
    if status_name='submitted' then flags:=array_append(flags,'pending_missing');end if;
  end loop;

  -- A pending head can affect this period either via its original/current
  -- session (including a proposal moving OUT), or via a proposal moving IN.
  -- Each related stream/root is point-read at its latest revision. Range arms
  -- use the new partial UTC expression indexes; superseded/withdrawn/decided
  -- submissions do not consume the 100 truly-related pending-request budget.
  ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_correction_entries x
        where x.merchant_id=site and x.worker_id=wid and x.start_event_id=related_session.start_event_id
        order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_correction_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_correction_entries x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.proposal->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_correction_entries newer
          where newer.merchant_id=x.merchant_id and newer.worker_id=x.worker_id and newer.start_event_id=x.start_event_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_correction_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  other_ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      join public.merchant_attendance_correction_effects root on root.merchant_id=site and root.worker_id=wid and root.start_event_id=related_session.start_event_id
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_revision_requests x
        where x.merchant_id=site and x.base_request_id=root.request_id order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_revision_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_revision_requests x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_revision_requests newer
          where newer.merchant_id=x.merchant_id and newer.base_request_id=x.base_request_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_revision_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  if cardinality(ids)>100 or cardinality(other_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
    select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
    if correction_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id) then continue;end if;
    a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
    if not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,'revision',correction_row.revision,
      'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt','recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
    select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
    if revision_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id) then continue;end if;
    select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
    a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
    if not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
      or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal' then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,'revision',revision_row.revision,
      'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt','recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large';end if;
  if jsonb_array_length(pending)>0 then flags:=array_append(flags,'pending_correction');end if;

  -- Only the complete already-collected plan membership is relevant: plans in
  -- this period plus saved plan references of original/latest related sessions.
  -- At most 200 distinct IDs (100 plans + 100 sessions), each looked up through
  -- existing147 UNIQUE(merchant_id,slot_id). Unrelated lifetime cases do not
  -- consume the period's 100-case budget; no history scan or silent truncation.
  other_ids:=array(select distinct candidate.slot_id from (
    select (value->'slot'->>'id')::uuid slot_id from jsonb_array_elements(plans)
    union all select (value->'relation'->'slot'->>'id')::uuid slot_id from jsonb_array_elements(sessions)
  ) candidate where candidate.slot_id is not null order by candidate.slot_id);
  if cardinality(other_ids)>200 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select picked.case_id from unnest(other_ids) selected(slot_id)
    cross join lateral(select x.case_id from public.merchant_attendance_plan_exception_cases x
      where x.merchant_id=site and x.slot_id=selected.slot_id limit 1) picked
    order by picked.case_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for case_row in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and x.case_id=any(ids) order by x.case_id loop
    if row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
    select * into review_head from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id order by x.revision desc limit 1;
    select * into decision_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='decision' order by x.revision desc limit 1;
    select * into note_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='note' order by x.revision desc limit 1;
    select * into read_row from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.decision_operation_id=decision_row.operation_id;
    if review_head.operation_id is null or decision_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);
    summary:=case when note_row.operation_id is null then null else public.faolla_attendance_plan_exception_review_entry_v1(note_row) end;
    reviews:=reviews||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'slotId',case_row.slot_id,'revision',review_head.revision,'latestDecision',item,'latestNote',summary,
      'read',case when read_row.operation_id is null then null else jsonb_build_object('operationId',read_row.operation_id,'decisionOperationId',read_row.decision_operation_id,'readAt',to_char(read_row.read_at at time zone 'UTC',fmt)) end));
    -- Validation is deliberately outside canonical content. A self read cannot
    -- call146 as the owner.149 owner send/seal performs the real fresh check.
    if access_name='self' then flags:=array_append(flags,'unresolved_review');
    else
      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
      if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision
        or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review');end if;
    end if;
  end loop;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_period_source_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(reason) order by ord),'[]'::jsonb) into blockers from unnest(array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']) with ordinality t(reason,ord) where reason=any(flags);
  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);
  result:=jsonb_build_object('sourceVersion','attendance-period-source-v1','siteId',site,'workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,
    'timeZone',fixed_head.time_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='owner' then 'owner_checked' else 'self_not_checked' end);
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  result:=result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  -- Internal SQL envelope carries raw and canonical material for server-side
  -- verification. The HTTP service projects a smaller archive artifact.
  if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_period_source_invalid';
end;
$$;

create or replace function public.faolla_attendance_period_closure_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;canonical jsonb;source_text text;
begin
  -- The original collector authorizes current owner/self and holds the same
  -- merchant/settings/worker/employee locks as all work-arrangement writers.
  result:=public.faolla_attendance_period_closure_source_base_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  if arrangements='[]'::jsonb then return result;end if;
  result:=jsonb_set(result,'{context,workArrangements}',arrangements)||jsonb_build_object('sourceVersion','attendance-period-source-v2');
  if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then
    result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["pending_work_arrangement"]'::jsonb);
  end if;
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  return result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;
revoke all on function public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_closure_source_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610060158,'merchant_attendance_work_arrangement_periods') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
