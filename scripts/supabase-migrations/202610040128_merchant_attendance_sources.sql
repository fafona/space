-- Owner-only bounded source evidence. No source writes, rule application,
-- historical sealing, absence classification or changes to existing writers.
begin;
set local lock_timeout='3s';
do $sources_prerequisites$
declare installed boolean;v bigint;n text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_sources_prerequisite_required';end if;
  for v,n in select * from (values
    (202610010093::bigint,'merchant_attendance_versioned_reports'),(202610010099::bigint,'merchant_attendance_schedule'),
    (202610010103::bigint,'merchant_attendance_missing_revisions'),(202610030122::bigint,'merchant_attendance_leave_requests'),
    (202610030123::bigint,'merchant_attendance_calendar'),(202610030124::bigint,'merchant_attendance_groups'),
    (202610040127::bigint,'merchant_attendance_rule_versions')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_sources_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_unified_report_v1(text,uuid,jsonb)',
    'public.faolla_attendance_control_day_boundary_v1(date,text)',
    'public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)',
    'public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)',
    'public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)',
    'public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)',
    'public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',
    'public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_sources_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040128 and name='merchant_attendance_sources') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040128 and name<>'merchant_attendance_sources') then
    raise exception 'merchant_attendance_sources_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_sources_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_sources_installation_conflict';end if;
  end loop;
end;
$sources_prerequisites$;

-- 099 has no private entry/receipt validator. Validate each retained immutable
-- slot against its original command and optional cancellation by indexed keys.
create or replace function public.faolla_attendance_sources_schedule_v1(p public.merchant_attendance_schedule_slots)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare original public.merchant_attendance_schedule_commands%rowtype;cancelled public.merchant_attendance_schedule_commands%rowtype;
  cancellation public.merchant_attendance_schedule_cancellations%rowtype;x jsonb;a timestamptz;b timestamptz;previous_end timestamptz;
  matches integer:=0;first_day date;last_day date;k text;
begin
  select * into original from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id and revision=p.revision;
  if original.operation_id is null or jsonb_typeof(original.command) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(original.command))<>8
    or not(original.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
    or original.command->>'operationId' is distinct from original.operation_id::text or original.command->>'action' is distinct from 'publish'
    or original.command->'expectedRevision' is distinct from to_jsonb(original.revision-1)
    or original.command->>'locationId' is distinct from p.location_id::text or original.command->>'timeZone' is distinct from p.time_zone
    or jsonb_typeof(original.command->'slots') is distinct from 'array' or jsonb_array_length(original.command->'slots') not between 1 and 32
    or jsonb_typeof(original.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(original.query))<>6
    or not(original.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or original.query->>'siteId' is distinct from p.merchant_id or original.query->>'workerId' is distinct from p.worker_id::text
    or original.query->>'access' is distinct from 'owner' or original.query->'operationId' is distinct from 'null'::jsonb
    or not isfinite(original.recorded_at)
    or not public.faolla_attendance_group_text_v1(p.worker_name,1,120) or not public.faolla_attendance_group_text_v1(p.location_name,1,120)
    or p.work_date<>(p.start_at at time zone p.time_zone)::date then raise exception 'attendance_sources_invalid';end if;
  if jsonb_typeof(original.command->'reason') is distinct from 'string'
    or not public.faolla_attendance_group_text_v1(original.command->>'reason',1,200)
    or jsonb_typeof(original.command->'expectedSettingsVersion') is distinct from 'number'
    or coalesce(original.command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$'
    or (original.command->>'expectedSettingsVersion')::numeric>9007199254740989 then raise exception 'attendance_sources_invalid';end if;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(original.query->k) is distinct from 'string' or not public.faolla_attendance_group_date_v1(original.query->>k) then
      raise exception 'attendance_sources_invalid';end if;
  end loop;
  first_day:=(original.query->>'fromDate')::date;last_day:=(original.query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 or p.work_date not between first_day and last_day then raise exception 'attendance_sources_invalid';end if;
  for x in select value from jsonb_array_elements(original.command->'slots') loop
    if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>2 or jsonb_typeof(x->0) is distinct from 'string' or jsonb_typeof(x->1) is distinct from 'string'
      or coalesce(x->>0,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' or coalesce(x->>1,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' then raise exception 'attendance_sources_invalid';end if;
    a:=(x->>0)::timestamptz;b:=(x->>1)::timestamptz;
    if not isfinite(a) or not isfinite(b) or b<=a or b-a>interval '24 hours' or a<previous_end
      or to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>x->>0 or to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>x->>1
      or (a at time zone p.time_zone)::date not between first_day and last_day then raise exception 'attendance_sources_invalid';end if;
    if a=p.start_at and b=p.end_at then matches:=matches+1;end if;previous_end:=b;
  end loop;
  if matches<>1 then raise exception 'attendance_sources_invalid';end if;
  select * into cancellation from public.merchant_attendance_schedule_cancellations where merchant_id=p.merchant_id and slot_id=p.id;
  if found then
    select * into cancelled from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id and revision=cancellation.revision;
    if cancelled.operation_id is null or cancelled.revision<=p.revision or not isfinite(cancelled.recorded_at) or cancelled.recorded_at<original.recorded_at
      or jsonb_typeof(cancelled.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.command))<>6
      or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
      or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text or cancelled.command->>'action' is distinct from 'cancel'
      or cancelled.command->>'slotId' is distinct from p.id::text or cancelled.command->'expectedRevision' is distinct from to_jsonb(cancelled.revision-1)
      or jsonb_typeof(cancelled.command->'expectedSettingsVersion') is distinct from 'number'
      or coalesce(cancelled.command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$' or (cancelled.command->>'expectedSettingsVersion')::numeric>9007199254740989
      or jsonb_typeof(cancelled.command->'reason') is distinct from 'string' or not public.faolla_attendance_group_text_v1(cancelled.command->>'reason',1,200)
      or jsonb_typeof(cancelled.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.query))<>6
      or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
      or cancelled.query->>'siteId' is distinct from p.merchant_id or cancelled.query->>'workerId' is distinct from p.worker_id::text
      or cancelled.query->>'access' is distinct from 'owner' or cancelled.query->'operationId' is distinct from 'null'::jsonb
      or not public.faolla_attendance_group_date_v1(cancelled.query->>'fromDate') or not public.faolla_attendance_group_date_v1(cancelled.query->>'throughDate')
      or (cancelled.query->>'throughDate')::date-(cancelled.query->>'fromDate')::date not between 0 and 30
      or p.work_date not between (cancelled.query->>'fromDate')::date and (cancelled.query->>'throughDate')::date then raise exception 'attendance_sources_invalid';end if;
  end if;
  return jsonb_build_object('id',p.id,'workerId',p.worker_id,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
    'timeZone',p.time_zone,'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',p.revision,'cancelled',cancelled.operation_id is not null,
    'reason',original.command->>'reason','cancelReason',cancelled.command->>'reason');
end;
$$;

create or replace function public.faolla_attendance_sources_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;first_day date;last_day date;from_at timestamptz;to_at timestamptz;read_at timestamptz;
  attendance jsonb;base jsonb;worker_item jsonb;result jsonb;item jsonb;summary jsonb;publication_items jsonb;gid uuid;scope_key text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;g public.merchant_attendance_groups%rowtype;
  assignment public.merchant_attendance_group_assignments%rowtype;stream public.merchant_attendance_rule_streams%rowtype;publication public.merchant_attendance_rule_operations%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;leave_request public.merchant_attendance_leave_requests%rowtype;leave_entry public.merchant_attendance_leave_entries%rowtype;
  calendar_entry public.merchant_attendance_calendar_entries%rowtype;
  assignment_candidates public.merchant_attendance_group_assignments[];schedule_candidates public.merchant_attendance_schedule_slots[];
  leave_candidates public.merchant_attendance_leave_requests[];calendar_candidates public.merchant_attendance_calendar_entries[];
  boundary_cache jsonb:='{}';boundary_key text;interval_from_at timestamptz;interval_to_at timestamptz;
  assignment_items jsonb:='[]';rule_items jsonb:='[]';schedule_items jsonb:='[]';leave_items jsonb:='[]';calendar_items jsonb:='[]';
  assignment_limited boolean:=false;rule_limited boolean:=false;schedule_limited boolean:=false;leave_limited boolean:=false;calendar_limited boolean:=false;
  group_ids uuid[]:='{}';location_ids uuid[]:='{}';publication_count integer:=0;head_revision bigint;
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or not public.faolla_attendance_group_date_v1(p_query->>'fromDate') or not public.faolla_attendance_group_date_v1(p_query->>'throughDate') then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 6 then raise exception 'attendance_invalid_request';end if;

  -- Existing owner report authorizes and retains merchant/settings/worker SHARE
  -- locks until this outer transaction ends. Collect no other source beforehand.
  attendance:=public.faolla_attendance_unified_report_v1(site,p_auth_user_id,(p_query-'siteId')||jsonb_build_object('access','owner'));
  base:=attendance->'base';
  if attendance->>'version' is distinct from 'attendance-unified-v1' or attendance->>'access' is distinct from 'owner'
    or attendance->'complete' is distinct from 'true'::jsonb or attendance->'payrollReady' is distinct from 'false'::jsonb
    or base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->'complete' is distinct from 'true'::jsonb
    or base->>'fromDate' is distinct from p_query->>'fromDate' or base->>'throughDate' is distinct from p_query->>'throughDate' then
    raise exception 'attendance_sources_invalid';end if;
  from_at:=(base->>'fromAt')::timestamptz;to_at:=(base->>'toAt')::timestamptz;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if s.merchant_id is null or w.id is null or s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or s.time_zone is distinct from base->>'timeZone' or not public.faolla_attendance_group_text_v1(w.display_name,1,120)
    or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_sources_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'version',w.version,'active',w.active);

  -- Conservative date-label candidates retain cancelled/originally-open rows.
  -- Current ends/status and the complete <=3-operation history stay explicit.
  -- Detect the101st candidate before doing any receipt/boundary validation;
  -- overfull sections expose no item, so validating100 discarded rows is waste.
  assignment_candidates:=array(select a from public.merchant_attendance_group_assignments a where a.merchant_id=site and a.worker_id=wid
    and a.starts_on<=last_day+2 and (a.original_ends_on is null or a.original_ends_on>=first_day-2) order by a.assignment_id limit 101);
  assignment_limited:=cardinality(assignment_candidates)>100;
  if not assignment_limited then
    foreach assignment in array assignment_candidates loop
      item:=public.faolla_attendance_group_assignment_detail_v1(assignment);
      boundary_key:=jsonb_build_array(assignment.time_zone,assignment.starts_on)::text;
      interval_from_at:=(boundary_cache->>boundary_key)::timestamptz;
      if interval_from_at is null then
        interval_from_at:=public.faolla_attendance_control_day_boundary_v1(assignment.starts_on,assignment.time_zone);
        boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_from_at);
      end if;
      interval_to_at:=null;
      if assignment.original_ends_on is not null then
        boundary_key:=jsonb_build_array(assignment.time_zone,assignment.original_ends_on+1)::text;
        interval_to_at:=(boundary_cache->>boundary_key)::timestamptz;
        if interval_to_at is null then
          interval_to_at:=public.faolla_attendance_control_day_boundary_v1(assignment.original_ends_on+1,assignment.time_zone);
          boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_to_at);
        end if;
      end if;
      if interval_from_at>=to_at or interval_to_at<=from_at then continue;end if;
      select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=assignment.group_id for share;
      if not found then raise exception 'attendance_sources_invalid';end if;
      assignment_items:=assignment_items||jsonb_build_array(jsonb_build_object('detail',item,'currentGroup',public.faolla_attendance_group_checked_v1(g)));
      if not(g.group_id=any(group_ids)) then group_ids:=array_append(group_ids,g.group_id);end if;
    end loop;
  end if;

  -- A missing assignment page cannot establish the complete set of rule targets.
  rule_limited:=assignment_limited or cardinality(group_ids)+1>100;
  if not rule_limited then
    for gid in select id from (select null::uuid id union all select unnest(group_ids)) targets order by id nulls first loop
      scope_key:=coalesce(gid::text,'enterprise');publication_items:='[]';head_revision:=0;
      select * into stream from public.merchant_attendance_rule_streams x where x.merchant_id=site and x.stream_key=scope_key;
      if found then head_revision:=stream.revision;perform public.faolla_attendance_rule_stream_checked_v1(stream);end if;
      -- Indexed effective-time seed, not the latest25 operations: any number of
      -- later drafts must not hide an older still-relevant candidate publication.
      for publication in
        with preceding as (select p.* from public.merchant_attendance_rule_operations p where p.merchant_id=site and p.stream_key=scope_key
          and p.action='publish' and p.effective_at<=from_at and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=p.merchant_id and wd.stream_key=p.stream_key and wd.action='withdraw' and wd.published_revision=p.revision)
          order by p.effective_at desc limit 1),
        inside as (select p.* from public.merchant_attendance_rule_operations p where p.merchant_id=site and p.stream_key=scope_key
          and p.action='publish' and p.effective_at>from_at and p.effective_at<to_at and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=p.merchant_id and wd.stream_key=p.stream_key and wd.action='withdraw' and wd.published_revision=p.revision)
          order by p.effective_at limit 101)
        select * from (select * from preceding union all select * from inside) bounded order by revision limit 101 loop
        publication_count:=publication_count+1;
        if publication_count>100 then rule_limited:=true;rule_items:='[]';exit;end if;
        if publication.revision>head_revision then raise exception 'attendance_sources_invalid';end if;
        perform public.faolla_attendance_rule_receipt_v1(publication);publication_items:=publication_items||jsonb_build_array(publication.snapshot);
      end loop;
      exit when rule_limited;
      rule_items:=rule_items||jsonb_build_array(jsonb_build_object('groupId',gid,'revision',head_revision,'publications',publication_items));
    end loop;
  end if;

  -- Bound indexed start-time candidates BEFORE endpoint filtering. Overfull
  -- conservative candidates yield unavailable coverage, never a partial list.
  schedule_candidates:=array(select p from public.merchant_attendance_schedule_slots p where p.merchant_id=site and p.worker_id=wid
    and p.start_at>=from_at-interval '24 hours' and p.start_at<to_at order by p.start_at,p.end_at limit 101);
  schedule_limited:=cardinality(schedule_candidates)>100;
  if not schedule_limited then
    foreach slot in array schedule_candidates loop
      if slot.end_at<=from_at then continue;end if;
      schedule_items:=schedule_items||jsonb_build_array(public.faolla_attendance_sources_schedule_v1(slot));
    end loop;
  end if;
  select coalesce(jsonb_agg(value order by value->>'startAt',value->>'id'),'[]'::jsonb) into schedule_items from jsonb_array_elements(schedule_items);
  leave_candidates:=array(select p from public.merchant_attendance_leave_requests p where p.merchant_id=site and p.worker_id=wid
    and p.start_at>=from_at-interval '8784 hours' and p.start_at<to_at order by p.start_at,p.end_at limit 101);
  leave_limited:=cardinality(leave_candidates)>100;
  if not leave_limited then
    foreach leave_request in array leave_candidates loop
      if leave_request.end_at<=from_at then continue;end if;
      summary:=public.faolla_attendance_leave_summary_v1(leave_request);
      select * into leave_entry from public.merchant_attendance_leave_entries where merchant_id=site and request_id=leave_request.request_id and revision=(summary->>'revision')::integer;
      if not found then raise exception 'attendance_sources_invalid';end if;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('workerId',leave_request.worker_id,'employeeId',leave_request.employee_id,'summary',summary,
        'operationId',leave_entry.operation_id,'recordedAt',to_char(leave_entry.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
    end loop;
  end if;
  select coalesce(jsonb_agg(value order by value->'summary'->>'startAt',value->'summary'->>'requestId'),'[]'::jsonb) into leave_items from jsonb_array_elements(leave_items);

  -- Location scope comes ONLY from retained raw/missing/schedule facts, never
  -- today's default location. Missing location coverage also limits calendar.
  calendar_limited:=schedule_limited;
  if not calendar_limited then
    select coalesce(array_agg(id order by id),'{}'::uuid[]) into location_ids from (
      select distinct id from (
        select (event->>'locationId')::uuid id from jsonb_array_elements(base->'items') row_item cross join lateral jsonb_array_elements(row_item->'events') event
        union all select (value->>'locationId')::uuid from jsonb_array_elements(attendance->'missing')
        union all select (value->>'locationId')::uuid from jsonb_array_elements(schedule_items)) ids where id is not null limit 101) bounded;
    if cardinality(location_ids)>100 then calendar_limited:=true;end if;
  end if;
  if not calendar_limited then
    calendar_candidates:=array(select c from public.merchant_attendance_calendar_entries c where c.merchant_id=site
      and (c.location_id is null or c.location_id=any(location_ids)) and c.from_date<=last_day+2 and c.through_date>=first_day-2
      order by c.from_date,c.entry_id limit 101);
    calendar_limited:=cardinality(calendar_candidates)>100;
  end if;
  if not calendar_limited then
    foreach calendar_entry in array calendar_candidates loop
      summary:=public.faolla_attendance_calendar_summary_v1(calendar_entry);
      -- Repeated calendar rows often share the same dates/zone. Cache only
      -- UTC boundary arithmetic for this invocation, never source validation.
      boundary_key:=jsonb_build_array(calendar_entry.time_zone,calendar_entry.from_date)::text;
      interval_from_at:=(boundary_cache->>boundary_key)::timestamptz;
      if interval_from_at is null then
        interval_from_at:=public.faolla_attendance_control_day_boundary_v1(calendar_entry.from_date,calendar_entry.time_zone);
        boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_from_at);
      end if;
      boundary_key:=jsonb_build_array(calendar_entry.time_zone,calendar_entry.through_date+1)::text;
      interval_to_at:=(boundary_cache->>boundary_key)::timestamptz;
      if interval_to_at is null then
        interval_to_at:=public.faolla_attendance_control_day_boundary_v1(calendar_entry.through_date+1,calendar_entry.time_zone);
        boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_to_at);
      end if;
      if interval_from_at>=to_at or interval_to_at<=from_at then continue;end if;
      calendar_items:=calendar_items||jsonb_build_array(summary);
    end loop;
  end if;
  read_at:=clock_timestamp();
  if read_at<(base->>'asOf')::timestamptz then raise exception 'attendance_sources_invalid';end if;
  result:=jsonb_build_object('protocol','sources-v1','siteId',site,'actorId',p_auth_user_id,'fromDate',p_query->>'fromDate','throughDate',p_query->>'throughDate',
    'worker',worker_item,'settingsVersion',s.version,'timeZone',s.time_zone,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'attendance',attendance,
    'assignments',jsonb_build_object('limited',assignment_limited,'items',assignment_items),'rules',jsonb_build_object('limited',rule_limited,'items',rule_items),
    'schedule',jsonb_build_object('limited',schedule_limited,'items',schedule_items),'leave',jsonb_build_object('limited',leave_limited,'items',leave_items),
    'calendar',jsonb_build_object('limited',calendar_limited,'items',calendar_items));
  if octet_length(result::text)>1048576 then raise exception 'attendance_sources_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_sources_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_sources_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040128,'merchant_attendance_sources') on conflict(version) do nothing;
do $sources_postconditions$
declare r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040128 and name='merchant_attendance_sources') then
    raise exception 'merchant_attendance_sources_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_sources_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_sources_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_sources_v1(jsonb,uuid)','EXECUTE') then
    raise exception 'merchant_attendance_sources_acl_postcondition_failed';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(r,'public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots)','EXECUTE') then
      raise exception 'merchant_attendance_sources_acl_postcondition_failed';end if;
  end loop;
end;
$sources_postconditions$;
notify pgrst, 'reload schema';
commit;
