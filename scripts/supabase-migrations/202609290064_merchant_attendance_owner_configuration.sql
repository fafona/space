-- Owner-only configuration, version fences and immutable operation receipts.
-- No existing merchant/employee data updates or grants. Unapplied candidate.
begin;
set local lock_timeout = '3s';

create table public.merchant_attendance_config_operations (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  version bigint not null check (version between 1 and 9007199254740990),
  command jsonb not null check (jsonb_typeof(command)='object'),
  before_value jsonb null,
  after_value jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id,operation_id),
  unique (merchant_id,version)
);
alter table public.merchant_attendance_config_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_config_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_config_operations from public,anon,authenticated,service_role;
grant select on public.merchant_attendance_config_operations to service_role;
create trigger merchant_attendance_config_no_rewrite before update or delete
on public.merchant_attendance_config_operations for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_config_no_truncate before truncate
on public.merchant_attendance_config_operations for each statement execute function public.faolla_attendance_events_append_only_v1();

create or replace function public.faolla_attendance_admin_v1(
  p_site_id text, p_auth_user_id uuid, p_query jsonb,
  p_command jsonb default null, p_operation_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype;
  v_settings public.merchant_attendance_settings%rowtype;
  v_location public.merchant_attendance_locations%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_operation public.merchant_attendance_config_operations%rowtype;
  v_values jsonb;
  v_before jsonb;
  v_after jsonb;
  v_kind text;
  v_expected bigint;
  v_operation_id uuid;
  v_id uuid;
  v_view text;
  v_cursor uuid;
  v_search text;
  v_rows jsonb := '[]'::jsonb;
  v_next uuid;
  v_version bigint;
  v_start date;
  v_is_new boolean;
  v_inserted integer := 0;
  v_uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['view','cursor','search'])
    or coalesce(p_query->>'view','') not in ('settings','locations','workers','employees')
    or jsonb_typeof(p_query->'search')<>'string' or char_length(p_query->>'search')>80
    or (p_query->>'search') ~ '[[:cntrl:]]'
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ v_uuid_pattern)
  then raise exception 'attendance_invalid_request'; end if;
  v_view:=p_query->>'view'; v_cursor:=(p_query->>'cursor')::uuid; v_search:=btrim(p_query->>'search');

  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>4 or not(p_command ?& array['kind','values','operationId','expectedVersion'])
      or coalesce(p_command->>'kind','') not in ('settings','location','worker')
      or coalesce(p_command->>'operationId','') !~ v_uuid_pattern
      or jsonb_typeof(p_command->'expectedVersion')<>'number'
      or coalesce(p_command->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedVersion')::numeric>=9007199254740991
      or jsonb_typeof(p_command->'values')<>'object'
    then raise exception 'attendance_invalid_request'; end if;
    v_values:=p_command->'values'; v_kind:=p_command->>'kind';
    v_operation_id:=(p_command->>'operationId')::uuid; v_expected:=(p_command->>'expectedVersion')::bigint;
    if v_kind='settings' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['timeZone','enabled','webClockEnabled','webBreakPaid'])
        or jsonb_typeof(v_values->'enabled')<>'boolean' or jsonb_typeof(v_values->'webClockEnabled')<>'boolean'
        or jsonb_typeof(v_values->'webBreakPaid')<>'boolean' then raise exception 'attendance_invalid_request'; end if;
    elsif v_kind='location' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['id','name','timeZone','active'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'name')<>'string' or char_length(btrim(v_values->>'name')) not between 1 and 120
        or (v_values->>'name') ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid;
    else
      if (select count(*) from jsonb_object_keys(v_values))<>7 or not(v_values ?& array['id','employeeId','workerNo','displayName','locationId','active','startsOn'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or coalesce(v_values->>'employeeId','') !~ v_uuid_pattern
        or coalesce(v_values->>'locationId','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'workerNo')<>'string' or char_length(btrim(v_values->>'workerNo')) not between 1 and 40
        or jsonb_typeof(v_values->'displayName')<>'string' or char_length(btrim(v_values->>'displayName')) not between 1 and 120
        or (v_values->>'workerNo') ~ '[[:cntrl:]]' or (v_values->>'displayName') ~ '[[:cntrl:]]'
        or coalesce(v_values->>'startsOn','') !~ '^\d{4}-\d{2}-\d{2}$'
      then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid; v_start:=(v_values->>'startsOn')::date;
      if v_start not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_invalid_request'; end if;
    end if;
    if v_kind in ('settings','location') and (jsonb_typeof(v_values->'timeZone')<>'string'
      or not public.faolla_attendance_valid_zone_v1(v_values->>'timeZone')) then raise exception 'attendance_invalid_time_zone'; end if;
  end if;

  -- Match existing owner identity columns; never trust a client actor/role claim.
  -- Holding this row makes an ownership transfer precede or follow this transaction.
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[
    v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,v_merchant.owner_id,
    v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
  then raise exception 'attendance_access_denied'; end if;

  if p_command is not null then
    -- Only explicit initial settings save creates a row; no implicit bootstrap on GET.
    if v_kind='settings' and v_expected=0 then
      insert into public.merchant_attendance_settings(merchant_id,time_zone)
      values(p_site_id,v_values->>'timeZone') on conflict(merchant_id) do nothing;
      get diagnostics v_inserted = row_count;
    end if;
    -- Rare config writes lock settings exclusively. All punches already take a
    -- shared settings lock FIRST, so checking open sessions cannot race a punch.
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for update;
  else
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  end if;
  v_version:=coalesce(v_settings.version,0);
  if p_command is not null then
    if v_settings.merchant_id is null then raise exception 'attendance_settings_required'; end if;
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=v_operation_id;
    if v_operation.operation_id is not null then
      if v_operation.actor_auth_user_id<>p_auth_user_id or v_operation.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
    else
      -- version 0 is reserved for settings with no previous config operation.
      v_is_new:=v_inserted=1;
      if not v_is_new and v_expected<>v_settings.version then raise exception 'attendance_version_conflict'; end if;
      if v_settings.version>=9007199254740990 then raise exception 'attendance_version_conflict'; end if;
      v_version:=case when v_is_new then 1 else v_settings.version+1 end;
      if v_kind='settings' then
        v_before:=case when v_is_new then null else to_jsonb(v_settings) end;
        if (v_values->>'timeZone')<>v_settings.time_zone and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id)
          then raise exception 'attendance_history_protected'; end if;
        if ((v_settings.enabled and not (v_values->>'enabled')::boolean)
          or (v_settings.web_clock_enabled and not (v_values->>'webClockEnabled')::boolean)
          or v_settings.web_break_paid<>(v_values->>'webBreakPaid')::boolean)
          and exists(select 1 from public.merchant_attendance_workers w
            cross join lateral (select action from public.merchant_attendance_events e where e.merchant_id=w.merchant_id and e.worker_id=w.id order by sequence desc limit 1) last
            where w.merchant_id=p_site_id and last.action<>'clock_out') then raise exception 'attendance_open_sessions'; end if;
        update public.merchant_attendance_settings set time_zone=v_values->>'timeZone',enabled=(v_values->>'enabled')::boolean,
          web_clock_enabled=(v_values->>'webClockEnabled')::boolean,web_break_paid=(v_values->>'webBreakPaid')::boolean where merchant_id=p_site_id;
        v_after:=v_values;
      elsif v_kind='location' then
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_location.id is null then null else to_jsonb(v_location) end;
        if v_location.id is not null and v_location.radius_meters is not null then raise exception 'attendance_history_protected'; end if;
        if v_location.id is not null and (v_values->>'timeZone')<>v_location.time_zone
          and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and location_id=v_id) then raise exception 'attendance_history_protected'; end if;
        if not (v_values->>'active')::boolean and exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site_id and default_location_id=v_id and active)
          then raise exception 'attendance_location_in_use'; end if;
        if v_location.id is null then
          insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
          values(v_id,p_site_id,btrim(v_values->>'name'),v_values->>'timeZone',(v_values->>'active')::boolean);
        else
          update public.merchant_attendance_locations set name=btrim(v_values->>'name'),time_zone=v_values->>'timeZone',active=(v_values->>'active')::boolean,
            version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      else
        -- Settings lock precedes employee and worker locks, same as self-clock.
        select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and id=(v_values->>'employeeId')::uuid for share;
        if not found or ((v_values->>'active')::boolean and v_employee.status<>'active') then raise exception 'attendance_employee_invalid'; end if;
        select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_worker.id is null then null else to_jsonb(v_worker) end;
        if v_worker.id is not null and (v_worker.employee_id is distinct from v_employee.id
          or (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id)<>1
          or not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_id and starts_on=v_start and ends_on is null))
          then raise exception 'attendance_history_protected'; end if;
        if v_worker.id is not null and (v_worker.active is distinct from (v_values->>'active')::boolean or v_worker.default_location_id is distinct from (v_values->>'locationId')::uuid)
          and exists(select 1 from (select action from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=v_id order by sequence desc limit 1) last where action<>'clock_out')
          then raise exception 'attendance_open_sessions'; end if;
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=(v_values->>'locationId')::uuid for share;
        if not found or v_location.radius_meters is not null or ((v_values->>'active')::boolean and not v_location.active) then raise exception 'attendance_location_denied'; end if;
        if v_worker.id is null then
          insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
          values(v_id,p_site_id,v_employee.id,btrim(v_values->>'workerNo'),btrim(v_values->>'displayName'),(v_values->>'active')::boolean,v_location.id);
          insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site_id,v_id,v_start);
        else
          update public.merchant_attendance_workers set worker_no=btrim(v_values->>'workerNo'),display_name=btrim(v_values->>'displayName'),
            active=(v_values->>'active')::boolean,default_location_id=v_location.id,version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      end if;
      update public.merchant_attendance_settings set version=v_version,updated_at=clock_timestamp() where merchant_id=p_site_id returning * into v_settings;
      insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value)
      values(p_site_id,v_operation_id,p_auth_user_id,v_version,p_command,v_before,v_after) returning * into v_operation;
    end if;
  else
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=p_operation_id and actor_auth_user_id=p_auth_user_id;
  end if;

  -- At most 26 indexed keyset rows, return 25. No enterprise overview snapshot,
  -- auth IDs, email, geolocation or all-history fetches in these choices.
  if v_view='locations' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select id,jsonb_build_object('id',id,'name',name,'timeZone',time_zone,'active',active) j
      from public.merchant_attendance_locations where merchant_id=p_site_id and (v_cursor is null or id>v_cursor)
        and (v_search='' or strpos(lower(name),lower(v_search))>0) order by id limit 26) page;
  elsif v_view='workers' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select w.id,jsonb_build_object('id',w.id,'employeeId',w.employee_id,'workerNo',w.worker_no,'displayName',w.display_name,'locationId',w.default_location_id,
        'active',w.active,'startsOn',p.starts_on::text) j
      from public.merchant_attendance_workers w
      join lateral(select starts_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=w.id order by starts_on desc limit 1) p on true
      where w.merchant_id=p_site_id and w.employee_id is not null and w.default_location_id is not null and (v_cursor is null or w.id>v_cursor)
        and (v_search='' or strpos(lower(w.display_name||' '||w.worker_no),lower(v_search))>0) order by w.id limit 26) page;
  elsif v_view='employees' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select e.id,jsonb_build_object('id',e.id,'displayName',e.display_name) j
      from public.merchant_enterprise_employees e where e.merchant_id=p_site_id and e.status='active' and (v_cursor is null or e.id>v_cursor)
        and (v_search='' or strpos(lower(e.display_name),lower(v_search))>0)
        and not exists(select 1 from public.merchant_attendance_workers w where w.merchant_id=p_site_id and w.employee_id=e.id)
      order by e.id limit 26) page;
  end if;
  if jsonb_array_length(v_rows)>25 then v_rows:=v_rows-25; v_next:=(v_rows->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site_id,'version',v_version,'view',v_view,'items',v_rows,'nextCursor',v_next,
    'settings',case when v_settings.merchant_id is null then null else jsonb_build_object('timeZone',v_settings.time_zone,'enabled',v_settings.enabled,
      'webClockEnabled',v_settings.web_clock_enabled,'webBreakPaid',v_settings.web_break_paid) end,
    'receipt',case when v_operation.operation_id is null then null else jsonb_build_object('operationId',v_operation.operation_id,'version',v_operation.version,
      'kind',v_operation.command->>'kind','targetId',v_operation.command->'values'->>'id') end);
exception
  when unique_violation then raise exception 'attendance_duplicate_worker';
  when invalid_text_representation or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid) to service_role;

insert into public.faolla_schema_migrations(version,name) values(202609290064,'merchant_attendance_owner_configuration') on conflict(version) do nothing;
commit;
