-- Manual owner calendar only. Local-date labels are not automatic holidays,
-- scheduling prohibitions, attendance facts, paid time or payroll instructions.
begin;
set local lock_timeout='3s';
do $calendar_prerequisites$
declare installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_locations') is null or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null then
    raise exception 'merchant_attendance_calendar_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290061 and name='merchant_attendance_foundation') then
    raise exception 'merchant_attendance_calendar_prerequisite_required';
  end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610030123 and name='merchant_attendance_calendar') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610030123 and name<>'merchant_attendance_calendar')
    or not installed and (to_regclass('public.merchant_attendance_calendar_entries') is not null or to_regclass('public.merchant_attendance_calendar_operations') is not null
      or to_regprocedure('public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean)') is not null)
    or installed and (to_regclass('public.merchant_attendance_calendar_entries') is null or to_regclass('public.merchant_attendance_calendar_operations') is null
      or to_regprocedure('public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean)') is null) then
    raise exception 'merchant_attendance_calendar_installation_conflict';
  end if;
end;
$calendar_prerequisites$;
create table if not exists public.merchant_attendance_calendar_entries (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),entry_id uuid not null,actor_auth_user_id uuid not null,
  location_id uuid null,location_name text null,location_version bigint null,
  settings_version bigint not null check(settings_version between 1 and 9007199254740990),
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),
  kind text not null check(kind in ('holiday','closure')),title text not null,reason text not null,
  from_date date not null,through_date date not null,created_at timestamptz not null check(isfinite(created_at)),
  primary key(merchant_id,entry_id),foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  check((location_id is null and location_name is null and location_version is null)
    or (location_id is not null and location_name is not null and location_version is not null and char_length(btrim(location_name)) between 1 and 120 and location_version between 1 and 9007199254740990)),
  check(from_date>=date '2000-01-01' and through_date<=date '2100-12-31' and through_date-from_date between 0 and 365),
  check(char_length(title) between 1 and 80 and title=btrim(title,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') and title !~ '[[:cntrl:]\u007f-\u009f]'),
  check(char_length(reason) between 1 and 200 and reason=btrim(reason,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') and reason !~ '[[:cntrl:]\u007f-\u009f]')
);
create index if not exists attendance_calendar_scope_list_idx on public.merchant_attendance_calendar_entries(merchant_id,location_id,created_at desc,entry_id desc);
create index if not exists attendance_calendar_scope_dates_idx on public.merchant_attendance_calendar_entries(merchant_id,location_id,from_date,through_date);
create table if not exists public.merchant_attendance_calendar_operations (
  merchant_id text not null,operation_id uuid not null,entry_id uuid not null,revision smallint not null,action text not null,
  actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,entry_id,revision),
  foreign key(merchant_id,entry_id) references public.merchant_attendance_calendar_entries(merchant_id,entry_id),
  check((revision=1 and action='create' and operation_id=entry_id) or (revision=2 and action='cancel')),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object' and isfinite(recorded_at))
);
do $calendar_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_calendar_entries'::regclass and conname='attendance_calendar_create_receipt_fk') then
    alter table public.merchant_attendance_calendar_entries add constraint attendance_calendar_create_receipt_fk
      foreign key(merchant_id,entry_id) references public.merchant_attendance_calendar_operations(merchant_id,operation_id) deferrable initially deferred;
  end if;
end;
$calendar_constraints$;
alter table public.merchant_attendance_calendar_entries enable row level security;
alter table public.merchant_attendance_calendar_operations enable row level security;
revoke all on public.merchant_attendance_calendar_entries,public.merchant_attendance_calendar_operations from public,anon,authenticated,service_role;
do $calendar_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_calendar_entries','merchant_attendance_calendar_operations'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);
    end if;
  end loop;
end;
$calendar_triggers$;

create or replace function public.faolla_attendance_calendar_summary_v1(p public.merchant_attendance_calendar_entries,p_revision integer default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare op public.merchant_attendance_calendar_operations%rowtype;n integer:=0;item jsonb;result jsonb;
begin
  for op in select * from public.merchant_attendance_calendar_operations where merchant_id=p.merchant_id and entry_id=p.entry_id order by revision loop
    n:=n+1;
    if n>2 or op.revision<>n or op.recorded_at<p.created_at or op.command->>'operationId' is distinct from op.operation_id::text
      or op.command->>'action' is distinct from op.action or jsonb_typeof(op.command->'reason') is distinct from 'string'
      or char_length(op.command->>'reason') not between 1 and 200
      or op.command->>'reason'<>btrim(op.command->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
      or op.command->>'reason' ~ '[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_calendar_invalid';end if;
    if n=1 then
      if op.action<>'create' or op.operation_id<>p.entry_id or op.actor_auth_user_id<>p.actor_auth_user_id or op.recorded_at<>p.created_at
        or (select count(*) from jsonb_object_keys(op.command))<>11
        or not(op.command ?& array['operationId','action','reason','kind','title','fromDate','throughDate','expectedSettingsVersion','locationId','expectedLocationVersion','timeZone'])
        or op.command->>'reason' is distinct from p.reason or op.command->>'kind' is distinct from p.kind or op.command->>'title' is distinct from p.title
        or op.command->>'fromDate' is distinct from to_char(p.from_date,'YYYY-MM-DD') or op.command->>'throughDate' is distinct from to_char(p.through_date,'YYYY-MM-DD')
        or op.command->'expectedSettingsVersion' is distinct from to_jsonb(p.settings_version)
        or op.command->'locationId' is distinct from coalesce(to_jsonb(p.location_id),'null'::jsonb)
        or op.command->'expectedLocationVersion' is distinct from coalesce(to_jsonb(p.location_version),'null'::jsonb)
        or op.command->>'timeZone' is distinct from p.time_zone then raise exception 'attendance_calendar_invalid';end if;
    elsif op.action<>'cancel' or (select count(*) from jsonb_object_keys(op.command))<>5
      or not(op.command ?& array['operationId','action','reason','entryId','expectedRevision'])
      or op.command->>'entryId' is distinct from p.entry_id::text or op.command->'expectedRevision' is distinct from '1'::jsonb then raise exception 'attendance_calendar_invalid';end if;
    item:=jsonb_build_object('entryId',p.entry_id,'locationId',p.location_id,'locationName',p.location_name,'timeZone',p.time_zone,'kind',p.kind,'title',p.title,
      'fromDate',to_char(p.from_date,'YYYY-MM-DD'),'throughDate',to_char(p.through_date,'YYYY-MM-DD'),
      'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',n,'status',case when n=1 then 'created' else 'cancelled' end);
    if op.snapshot is distinct from item then raise exception 'attendance_calendar_invalid';end if;
    if p_revision is null or p_revision=n then result:=item;end if;
  end loop;
  if n=0 or result is null or p_revision is not null and p_revision not between 1 and n then raise exception 'attendance_calendar_invalid';end if;
  return result;
end;
$$;
revoke all on function public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_calendar_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;place uuid;target_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;from_day date;through_day date;a date;b date;k text;action_name text;now_at timestamptz;
  s public.merchant_attendance_settings%rowtype;l public.merchant_attendance_locations%rowtype;
  target public.merchant_attendance_calendar_entries%rowtype;candidate public.merchant_attendance_calendar_entries%rowtype;
  receipt_row public.merchant_attendance_calendar_operations%rowtype;cancel_row public.merchant_attendance_calendar_operations%rowtype;
  zone text;can_create boolean;item jsonb;detail jsonb;receipt jsonb;items jsonb:='[]';next_cursor jsonb;rows_seen integer:=0;result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['siteId','locationId','fromDate','throughDate','entryId','operationId','beforeAt','beforeId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$' then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';
  foreach k in array array['locationId','entryId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  place:=(p_query->>'locationId')::uuid;target_id:=(p_query->>'entryId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'beforeId')::uuid;
  if (p_query->'fromDate'='null'::jsonb)<>(p_query->'throughDate'='null'::jsonb) then raise exception 'attendance_invalid_request';end if;
  if p_query->'fromDate'<>'null'::jsonb then
    foreach k in array array['fromDate','throughDate'] loop
      if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char((p_query->>k)::date,'YYYY-MM-DD')<>p_query->>k then raise exception 'attendance_invalid_request';end if;
    end loop;
    from_day:=(p_query->>'fromDate')::date;through_day:=(p_query->>'throughDate')::date;
    if from_day<date '2000-01-01' or through_day>date '2100-12-31' or through_day-from_day not between 0 and 365 then raise exception 'attendance_invalid_request';end if;
  end if;
  if p_query->'beforeAt'<>'null'::jsonb then
    if jsonb_typeof(p_query->'beforeAt')<>'string' or coalesce(p_query->>'beforeAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then raise exception 'attendance_invalid_request';end if;
    cursor_at:=(p_query->>'beforeAt')::timestamptz;
    if not isfinite(cursor_at) or to_char(cursor_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>'beforeAt' then raise exception 'attendance_invalid_request';end if;
  end if;
  if (cursor_at is null)<>(cursor_id is null) or cursor_at is not null and (from_day is null or target_id is not null or op is not null)
    or from_day is not null and (target_id is not null or op is not null or p_command is not null) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or cursor_at is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    if not(p_command ?& array['operationId','action','reason']) or jsonb_typeof(p_command->'operationId')<>'string'
      or coalesce(p_command->>'operationId','') !~ uuid_pattern or jsonb_typeof(p_command->'action')<>'string'
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(p_command->>'reason') not between 1 and 200
      or p_command->>'reason'<>btrim(p_command->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
      or p_command->>'reason' ~ '[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if action_name='create' then
      if target_id is not null or (select count(*) from jsonb_object_keys(p_command))<>11
        or not(p_command ?& array['kind','title','fromDate','throughDate','expectedSettingsVersion','locationId','expectedLocationVersion','timeZone'])
        or jsonb_typeof(p_command->'kind')<>'string' or coalesce(p_command->>'kind','') not in ('holiday','closure')
        or jsonb_typeof(p_command->'title')<>'string' or char_length(p_command->>'title') not between 1 and 80
        or p_command->>'title'<>btrim(p_command->>'title',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
        or p_command->>'title' ~ '[[:cntrl:]\u007f-\u009f]' or p_command->'locationId' is distinct from p_query->'locationId'
        or jsonb_typeof(p_command->'timeZone')<>'string' or not public.faolla_attendance_valid_zone_v1(p_command->>'timeZone') then raise exception 'attendance_invalid_request';end if;
      foreach k in array array['expectedSettingsVersion','expectedLocationVersion'] loop
        if k='expectedLocationVersion' and place is null then
          if p_command->k<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
        elsif jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^[1-9][0-9]{0,15}$'
          or (p_command->>k)::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;
      end loop;
      foreach k in array array['fromDate','throughDate'] loop
        if jsonb_typeof(p_command->k)<>'string' or coalesce(p_command->>k,'') !~ '^\d{4}-\d{2}-\d{2}$'
          or to_char((p_command->>k)::date,'YYYY-MM-DD')<>p_command->>k then raise exception 'attendance_invalid_request';end if;
      end loop;
      a:=(p_command->>'fromDate')::date;b:=(p_command->>'throughDate')::date;
      if a<date '2000-01-01' or b>date '2100-12-31' or b-a not between 0 and 365
        or ((a::timestamp at time zone (p_command->>'timeZone')) at time zone (p_command->>'timeZone'))::date<>a
        or ((b::timestamp at time zone (p_command->>'timeZone')) at time zone (p_command->>'timeZone'))::date<>b then raise exception 'attendance_invalid_request';end if;
      target_id:=op;
    elsif action_name='cancel' then
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['entryId','expectedRevision'])
        or jsonb_typeof(p_command->'entryId')<>'string' or coalesce(p_command->>'entryId','') !~ uuid_pattern
        or target_id is null or p_command->>'entryId'<>target_id::text or p_command->'expectedRevision' is distinct from '1'::jsonb then raise exception 'attendance_invalid_request';end if;
    else raise exception 'attendance_invalid_request';end if;
  end if;

  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
  zone:=s.time_zone;can_create:=true;
  if place is not null then
    select * into l from public.merchant_attendance_locations where merchant_id=site and id=place for share;
    if not found then raise exception 'attendance_calendar_not_found';end if;
    if l.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
    zone:=l.time_zone;can_create:=l.active;
  end if;
  if op is not null then
    select * into receipt_row from public.merchant_attendance_calendar_operations where merchant_id=site and operation_id=op;
    if receipt_row.operation_id is not null and (receipt_row.actor_auth_user_id<>p_auth_user_id or target_id is not null and target_id<>receipt_row.entry_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt_row:=null;
    end if;
    if receipt_row.operation_id is not null then target_id:=receipt_row.entry_id;end if;
  end if;
  if p_command is not null and receipt_row.operation_id is not null and receipt_row.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
  if target_id is not null then
    select * into target from public.merchant_attendance_calendar_entries where merchant_id=site and entry_id=target_id;
    if target.entry_id is null and action_name is distinct from 'create'
      or target.entry_id is not null and target.location_id is distinct from place then raise exception 'attendance_calendar_not_found';end if;
    if target.entry_id is not null then item:=public.faolla_attendance_calendar_summary_v1(target);end if;
  end if;
  -- Only current ownership is required for old receipts; current location
  -- activity and version checks apply exclusively to a genuinely new create.
  if p_command is not null and receipt_row.operation_id is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if action_name='create' then
      if not can_create then raise exception 'attendance_calendar_location_inactive';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>zone
        or (p_command->>'expectedLocationVersion')::bigint is distinct from l.version then raise exception 'attendance_version_conflict';end if;
      if target.entry_id is not null then raise exception 'attendance_operation_conflict';end if;
      now_at:=clock_timestamp();
      target.merchant_id:=site;target.entry_id:=op;target.actor_auth_user_id:=p_auth_user_id;target.location_id:=place;target.location_name:=l.name;target.location_version:=l.version;
      target.settings_version:=s.version;target.time_zone:=zone;target.kind:=p_command->>'kind';target.title:=p_command->>'title';target.reason:=p_command->>'reason';
      target.from_date:=a;target.through_date:=b;target.created_at:=now_at;
      insert into public.merchant_attendance_calendar_entries select (target).*;
    else
      if item->>'status'<>'created' then raise exception 'attendance_calendar_closed';end if;
      now_at:=clock_timestamp();
    end if;
    item:=jsonb_build_object('entryId',target.entry_id,'locationId',target.location_id,'locationName',target.location_name,'timeZone',target.time_zone,'kind',target.kind,'title',target.title,
      'fromDate',to_char(target.from_date,'YYYY-MM-DD'),'throughDate',to_char(target.through_date,'YYYY-MM-DD'),
      'createdAt',to_char(target.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',case when action_name='create' then 1 else 2 end,
      'status',case when action_name='create' then 'created' else 'cancelled' end);
    insert into public.merchant_attendance_calendar_operations(merchant_id,operation_id,entry_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
      values(site,op,target.entry_id,case when action_name='create' then 1 else 2 end,action_name,p_auth_user_id,p_command,item,now_at) returning * into receipt_row;
  end if;
  if target.entry_id is not null then
    item:=public.faolla_attendance_calendar_summary_v1(target);
    select * into cancel_row from public.merchant_attendance_calendar_operations where merchant_id=site and entry_id=target.entry_id and revision=2;
    detail:=item||jsonb_build_object('reason',target.reason,'cancelReason',cancel_row.command->>'reason',
      'cancelledAt',case when cancel_row.operation_id is null then null else to_char(cancel_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'canCancel',cancel_row.operation_id is null);
  end if;
  if receipt_row.operation_id is not null then receipt:=jsonb_build_object('command',receipt_row.command,'item',public.faolla_attendance_calendar_summary_v1(target,receipt_row.revision));end if;
  -- Scope dates are historical labels; changing a location's current timezone
  -- must not reinterpret or hide records made with a different snapshot zone.
  if p_command is null and from_day is not null then
    for candidate in select * from public.merchant_attendance_calendar_entries p where p.merchant_id=site and p.location_id is not distinct from place
      and p.from_date<=through_day and p.through_date>=from_day and (cursor_at is null or (p.created_at,p.entry_id)<(cursor_at,cursor_id))
      order by p.created_at desc,p.entry_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_calendar_summary_v1(candidate));
      next_cursor:=jsonb_build_object('at',to_char(candidate.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',candidate.entry_id);
    end loop;
  end if;
  result:=jsonb_build_object('protocol','calendar-v1','siteId',site,'actorId',p_auth_user_id,'settingsVersion',s.version,'locationId',place,'locationName',l.name,'locationVersion',l.version,
    'timeZone',zone,'canCreate',can_create,'items',items,'nextCursor',case when rows_seen=26 then next_cursor else null end,'detail',detail,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_calendar_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610030123,'merchant_attendance_calendar') on conflict(version) do nothing;
do $calendar_postconditions$
declare t regclass;r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030123 and name='merchant_attendance_calendar') then raise exception 'merchant_attendance_calendar_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_calendar_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then raise exception 'merchant_attendance_calendar_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_calendar_entries'::regclass,'public.merchant_attendance_calendar_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_calendar_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,'public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)','EXECUTE')
        or exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE')
          or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then
        raise exception 'merchant_attendance_calendar_acl_postcondition_failed';
      end if;
    end loop;
  end loop;
end;
$calendar_postconditions$;
notify pgrst, 'reload schema';
commit;
