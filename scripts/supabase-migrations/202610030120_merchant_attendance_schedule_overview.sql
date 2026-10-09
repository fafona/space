-- Additive owner-only, bounded multi-worker planned-shift read model.
-- Existing099 writers, table privileges and immutable histories are unchanged.
-- The cursor follows scanned candidates, including later snapshot exclusions.
begin;
set local lock_timeout='3s';

do $schedule_overview_prerequisites$
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchants') is null
    or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_workers') is null
    or to_regclass('public.merchant_attendance_schedule_commands') is null
    or to_regclass('public.merchant_attendance_schedule_slots') is null
    or to_regclass('public.merchant_attendance_schedule_cancellations') is null
    or to_regclass('public.attendance_schedule_worker_date_idx') is null
    or to_regprocedure('public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)') is null
    or to_regprocedure('public.faolla_attendance_valid_zone_v1(text)') is null then
    raise exception 'merchant_attendance_schedule_overview_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202610010099 and name='merchant_attendance_schedule') then
    raise exception 'merchant_attendance_schedule_overview_prerequisite_required';
  end if;
end;
$schedule_overview_prerequisites$;

create or replace function public.faolla_attendance_schedule_overview_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;workers uuid[]:='{}';worker uuid;previous_worker uuid;value jsonb;k text;
  first_day date;last_day date;cursor_day date;cursor_start timestamptz;cursor_id uuid;
  snapshot_revision bigint;latest_revision bigint;candidate record;
  published public.merchant_attendance_schedule_commands%rowtype;
  cancelled public.merchant_attendance_schedule_commands%rowtype;
  count_rows integer:=0;items jsonb:='[]';next_cursor jsonb:='null';result jsonb;
  start_text text;end_text text;cancel_revision bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['siteId','workerIds','fromDate','throughDate','revision','cursorDate','cursorStart','cursorId']) then
    raise exception 'attendance_invalid_request';
  end if;
  site:=p_query->>'siteId';
  if jsonb_typeof(p_query->'siteId')<>'string' or coalesce(site,'') !~ '^[0-9]{8}$'
    or jsonb_typeof(p_query->'workerIds')<>'array' then raise exception 'attendance_invalid_request';end if;
  if jsonb_array_length(p_query->'workerIds') not between 1 and 20 then raise exception 'attendance_invalid_request';end if;
  for value in select jsonb_array_elements(p_query->'workerIds') loop
    if jsonb_typeof(value)<>'string' or coalesce(value#>>'{}','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    worker:=(value#>>'{}')::uuid;
    if previous_worker is not null and worker<=previous_worker then raise exception 'attendance_invalid_request';end if;
    workers:=array_append(workers,worker);previous_worker:=worker;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_query->>k)::date not between date '2000-01-01' and date '2100-12-31'
      or to_char((p_query->>k)::date,'YYYY-MM-DD')<>p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day<first_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'revision'<>'null'::jsonb then
    if jsonb_typeof(p_query->'revision')<>'number' or coalesce(p_query->>'revision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_query->>'revision')::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
    snapshot_revision:=(p_query->>'revision')::bigint;
  end if;
  if (p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorStart'='null'::jsonb)
    or (p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb) then raise exception 'attendance_invalid_request';end if;
  if p_query->'cursorId'<>'null'::jsonb then
    if snapshot_revision is null or jsonb_typeof(p_query->'cursorId')<>'string' or coalesce(p_query->>'cursorId','') !~ uuid_pattern
      or jsonb_typeof(p_query->'cursorDate')<>'string' or coalesce(p_query->>'cursorDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_query->'cursorStart')<>'string' or coalesce(p_query->>'cursorStart','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00\.000Z$' then
      raise exception 'attendance_invalid_request';
    end if;
    cursor_day:=(p_query->>'cursorDate')::date;cursor_start:=(p_query->>'cursorStart')::timestamptz;cursor_id:=(p_query->>'cursorId')::uuid;
    if cursor_day not between first_day and last_day or to_char(cursor_day,'YYYY-MM-DD')<>p_query->>'cursorDate'
      or not isfinite(cursor_start)
      or to_char(cursor_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_query->>'cursorStart' then
      raise exception 'attendance_invalid_request';
    end if;
  end if;
  -- Original099 writes take these locks in this order. The SHARE lock fixes the
  -- first revision read and this page without weakening later owner revocation.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  foreach worker in array workers loop
    perform 1 from public.merchant_attendance_workers where merchant_id=site and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
  end loop;
  select coalesce(max(revision),0) into latest_revision from public.merchant_attendance_schedule_commands where merchant_id=site;
  if snapshot_revision is null then snapshot_revision:=latest_revision;
  elsif snapshot_revision>latest_revision then raise exception 'attendance_invalid_request';end if;

  -- No revision or cancellation filtering before each index-aligned LIMIT.
  -- A later publication can produce an empty page, but cannot cause an unbounded
  -- pre-limit search for old-snapshot rows. Only the first50 merged rows are read.
  for candidate in
    with probes as materialized (
      select s.* from unnest(workers) selected(worker_id)
      cross join lateral (
        select x.* from public.merchant_attendance_schedule_slots x
        where x.merchant_id=site and x.worker_id=selected.worker_id and x.work_date between first_day and last_day
          and (cursor_id is null or (x.work_date,x.start_at,x.id)>(cursor_day,cursor_start,cursor_id))
        order by x.work_date,x.start_at,x.id limit 51
      ) s
    )
    select * from probes order by work_date,start_at,id limit 51
  loop
    count_rows:=count_rows+1;exit when count_rows=51;
    start_text:=to_char(candidate.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end_text:=to_char(candidate.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    next_cursor:=jsonb_build_object('workDate',candidate.work_date,'startAt',start_text,'slotId',candidate.id);
    if candidate.revision>snapshot_revision then continue;end if;
    begin
      if candidate.revision<1 or candidate.id::text !~ uuid_pattern or candidate.worker_id::text !~ uuid_pattern or candidate.location_id::text !~ uuid_pattern
        or char_length(candidate.worker_name) not between 1 and 120 or candidate.worker_name<>btrim(candidate.worker_name) or candidate.worker_name ~ '[[:cntrl:]]'
        or char_length(candidate.location_name) not between 1 and 120 or candidate.location_name<>btrim(candidate.location_name) or candidate.location_name ~ '[[:cntrl:]]'
        or not public.faolla_attendance_valid_zone_v1(candidate.time_zone)
        or not isfinite(candidate.start_at) or not isfinite(candidate.end_at) or candidate.end_at<=candidate.start_at
        or candidate.end_at-candidate.start_at>interval '24 hours'
        or date_trunc('minute',candidate.start_at)<>candidate.start_at or date_trunc('minute',candidate.end_at)<>candidate.end_at
        or (candidate.start_at at time zone candidate.time_zone)::date<>candidate.work_date then raise exception 'attendance_schedule_overview_invalid';end if;
      select * into published from public.merchant_attendance_schedule_commands where merchant_id=site and revision=candidate.revision;
      if not found or published.command->>'action' is distinct from 'publish'
        or jsonb_typeof(published.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(published.query))<>6
        or not(published.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
        or published.query->'operationId' is distinct from 'null'::jsonb
        or jsonb_typeof(published.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(published.command))<>8
        or not(published.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
        or published.query->>'siteId' is distinct from site or published.query->>'access' is distinct from 'owner'
        or published.query->>'workerId' is distinct from candidate.worker_id::text
        or published.command->>'operationId' is distinct from published.operation_id::text
        or published.command->>'locationId' is distinct from candidate.location_id::text
        or published.command->>'timeZone' is distinct from candidate.time_zone
        or (published.command->>'expectedRevision')::bigint is distinct from candidate.revision-1
        or candidate.work_date not between (published.query->>'fromDate')::date and (published.query->>'throughDate')::date
        or not coalesce(published.command->'slots' @> jsonb_build_array(jsonb_build_array(start_text,end_text)),false) then
        raise exception 'attendance_schedule_overview_invalid';
      end if;
      -- The ON predicate hides future cancellations while retaining the slot.
      select c.revision into cancel_revision from public.merchant_attendance_schedule_slots s
        left join public.merchant_attendance_schedule_cancellations c on c.merchant_id=s.merchant_id and c.slot_id=s.id and c.revision<=snapshot_revision
        where s.merchant_id=site and s.id=candidate.id;
      if cancel_revision is not null then
        select * into cancelled from public.merchant_attendance_schedule_commands where merchant_id=site and revision=cancel_revision;
        if not found or cancel_revision<=candidate.revision or cancelled.command->>'action' is distinct from 'cancel'
          or jsonb_typeof(cancelled.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.query))<>6
          or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
          or cancelled.query->'operationId' is distinct from 'null'::jsonb
          or jsonb_typeof(cancelled.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.command))<>6
          or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
          or cancelled.query->>'siteId' is distinct from site or cancelled.query->>'access' is distinct from 'owner'
          or cancelled.query->>'workerId' is distinct from candidate.worker_id::text
          or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text
          or cancelled.command->>'slotId' is distinct from candidate.id::text
          or (cancelled.command->>'expectedRevision')::bigint is distinct from cancel_revision-1
          or candidate.work_date not between (cancelled.query->>'fromDate')::date and (cancelled.query->>'throughDate')::date then raise exception 'attendance_schedule_overview_invalid';end if;
      end if;
    exception when others then raise exception 'attendance_schedule_overview_invalid';end;
    items:=items||jsonb_build_array(jsonb_build_object('id',candidate.id,'workerId',candidate.worker_id,'workerName',candidate.worker_name,
      'locationId',candidate.location_id,'locationName',candidate.location_name,'timeZone',candidate.time_zone,'workDate',candidate.work_date,
      'startAt',start_text,'endAt',end_text,'revision',candidate.revision,'cancelled',cancel_revision is not null,'cancelRevision',cancel_revision));
  end loop;
  result:=jsonb_build_object('protocol','schedule-overview-v1','readOnly',true,'siteId',site,'ownerId',p_auth_user_id,'workerIds',to_jsonb(workers),
    'fromDate',first_day,'throughDate',last_day,'revision',snapshot_revision,'items',items,'scanned',least(count_rows,50),
    'nextCursor',case when count_rows=51 then next_cursor else 'null'::jsonb end);
  if octet_length(result::text)>131072 then raise exception 'attendance_schedule_overview_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_schedule_overview_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_schedule_overview_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name)
values(202610030120,'merchant_attendance_schedule_overview') on conflict(version) do nothing;
do $schedule_overview_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030120 and name='merchant_attendance_schedule_overview') then
    raise exception 'merchant_attendance_schedule_overview_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_schedule_overview_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_schedule_overview_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_schedule_overview_v1(jsonb,uuid)','EXECUTE') then
    raise exception 'merchant_attendance_schedule_overview_acl_postcondition_failed';end if;
end;
$schedule_overview_postconditions$;
notify pgrst, 'reload schema';
commit;
