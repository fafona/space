-- New, default-closed scope tables and bounded record RPCs. No employee backfill.
begin;
set local lock_timeout = '3s';

create table public.merchant_attendance_scopes (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  employee_id uuid not null,
  revision bigint not null default 0 check(revision between 0 and 9007199254740990),
  primary key(merchant_id,employee_id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict
);
create table public.merchant_attendance_scope_grants (
  merchant_id text not null,
  employee_id uuid not null,
  id uuid not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  primary key(merchant_id,employee_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_attendance_scopes(merchant_id,employee_id) on delete restrict,
  check(isfinite(valid_from) and (valid_until is null or (isfinite(valid_until) and valid_until>valid_from)))
);
create table public.merchant_attendance_scope_workers (
  merchant_id text not null, employee_id uuid not null, grant_id uuid not null, worker_id uuid not null,
  primary key(merchant_id,employee_id,grant_id,worker_id),
  foreign key(merchant_id,employee_id,grant_id) references public.merchant_attendance_scope_grants(merchant_id,employee_id,id) on delete cascade,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict
);
create table public.merchant_attendance_scope_locations (
  merchant_id text not null, employee_id uuid not null, grant_id uuid not null, location_id uuid not null,
  primary key(merchant_id,employee_id,grant_id,location_id),
  foreign key(merchant_id,employee_id,grant_id) references public.merchant_attendance_scope_grants(merchant_id,employee_id,id) on delete cascade,
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id) on delete restrict
);
create table public.merchant_attendance_scope_operations (
  merchant_id text not null, operation_id uuid not null, employee_id uuid not null, actor_auth_user_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),
  command jsonb not null, before_value jsonb not null, after_value jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(merchant_id,operation_id), unique(merchant_id,employee_id,revision),
  foreign key(merchant_id,employee_id) references public.merchant_attendance_scopes(merchant_id,employee_id) on delete restrict
);
alter table public.merchant_attendance_scopes enable row level security;
alter table public.merchant_attendance_scope_grants enable row level security;
alter table public.merchant_attendance_scope_workers enable row level security;
alter table public.merchant_attendance_scope_locations enable row level security;
alter table public.merchant_attendance_scope_operations enable row level security;
revoke all on public.merchant_attendance_scopes, public.merchant_attendance_scope_grants,
  public.merchant_attendance_scope_workers, public.merchant_attendance_scope_locations,
  public.merchant_attendance_scope_operations from public,anon,authenticated,service_role;
grant select on public.merchant_attendance_scopes, public.merchant_attendance_scope_grants,
  public.merchant_attendance_scope_workers, public.merchant_attendance_scope_locations,
  public.merchant_attendance_scope_operations to service_role;
create trigger merchant_attendance_scope_audit_no_rewrite before update or delete
on public.merchant_attendance_scope_operations for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_scope_audit_no_truncate before truncate
on public.merchant_attendance_scope_operations for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_instant_v1(p_value text) returns timestamptz
language plpgsql immutable set search_path=pg_catalog as $$
declare v_at timestamptz;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d{3}|\d{6})Z$' then raise exception 'attendance_invalid_request'; end if;
  v_at:=p_value::timestamptz;
  if to_char(v_at at time zone 'UTC',case when length(p_value)=24 then 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"' else 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"' end)<>p_value then raise exception 'attendance_invalid_request'; end if;
  return v_at;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_instant_v1(text) from public,anon,authenticated,service_role;

create function public.faolla_attendance_scope_snapshot_v1(p_site_id text,p_employee_id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('siteId',p_site_id,'employeeId',p_employee_id,
    'revision',coalesce((select revision from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=p_employee_id),0),
    'grants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,
      'workerIds',coalesce((select jsonb_agg(w.worker_id order by w.worker_id) from public.merchant_attendance_scope_workers w
        where w.merchant_id=g.merchant_id and w.employee_id=g.employee_id and w.grant_id=g.id),'[]'::jsonb),
      'locationIds',coalesce((select jsonb_agg(l.location_id order by l.location_id) from public.merchant_attendance_scope_locations l
        where l.merchant_id=g.merchant_id and l.employee_id=g.employee_id and l.grant_id=g.id),'[]'::jsonb),
      'validFrom',to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'validUntil',case when g.valid_until is null then null else to_char(g.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end) order by g.id)
      from public.merchant_attendance_scope_grants g where g.merchant_id=p_site_id and g.employee_id=p_employee_id),'[]'::jsonb));
$$;
revoke all on function public.faolla_attendance_scope_snapshot_v1(text,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_scopes_v1(p_site_id text,p_auth_user_id uuid,p_employee_id uuid,
  p_command jsonb default null,p_operation_id uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype; v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype; v_scope public.merchant_attendance_scopes%rowtype;
  v_operation public.merchant_attendance_scope_operations%rowtype;
  v_grant jsonb; v_before jsonb; v_after jsonb; v_worker_ids uuid[]; v_location_ids uuid[];
  v_operation_id uuid; v_grant_id uuid; v_expected bigint; v_from timestamptz; v_until timestamptz;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_employee_id is null then raise exception 'attendance_invalid_request'; end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','grantId','grant','operationId','expectedRevision'])
      or coalesce(p_command->>'action','') not in ('put','remove') or coalesce(p_command->>'grantId','') !~ v_uuid
      or coalesce(p_command->>'operationId','') !~ v_uuid or jsonb_typeof(p_command->'expectedRevision')<>'number'
      or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedRevision')::numeric>=9007199254740991 then raise exception 'attendance_invalid_request'; end if;
    v_operation_id:=(p_command->>'operationId')::uuid; v_grant_id:=(p_command->>'grantId')::uuid;
    v_expected:=(p_command->>'expectedRevision')::bigint; v_grant:=p_command->'grant';
    if p_command->>'action'='remove' then
      if v_grant<>'null'::jsonb then raise exception 'attendance_invalid_request'; end if;
    else
      if jsonb_typeof(v_grant)<>'object' then raise exception 'attendance_invalid_request'; end if;
      if (select count(*) from jsonb_object_keys(v_grant))<>4 or not(v_grant ?& array['workerIds','locationIds','validFrom','validUntil'])
        or jsonb_typeof(v_grant->'workerIds')<>'array' or jsonb_typeof(v_grant->'locationIds')<>'array'
      then raise exception 'attendance_invalid_request'; end if;
      if jsonb_array_length(v_grant->'workerIds')>200 or jsonb_array_length(v_grant->'locationIds')>50
        or exists(select 1 from jsonb_array_elements(v_grant->'workerIds') x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ v_uuid)
        or exists(select 1 from jsonb_array_elements(v_grant->'locationIds') x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ v_uuid)
      then raise exception 'attendance_invalid_request'; end if;
      select coalesce(array_agg(value::uuid order by value),'{}'::uuid[]) into v_worker_ids from jsonb_array_elements_text(v_grant->'workerIds');
      select coalesce(array_agg(value::uuid order by value),'{}'::uuid[]) into v_location_ids from jsonb_array_elements_text(v_grant->'locationIds');
      if (select count(distinct x) from unnest(v_worker_ids) x)<>cardinality(v_worker_ids)
        or (select count(distinct x) from unnest(v_location_ids) x)<>cardinality(v_location_ids) then raise exception 'attendance_invalid_request'; end if;
      if length(coalesce(v_grant->>'validFrom',''))<>24 or (v_grant->'validUntil'<>'null'::jsonb and length(coalesce(v_grant->>'validUntil',''))<>24)
        then raise exception 'attendance_invalid_request'; end if;
      v_from:=public.faolla_attendance_instant_v1(v_grant->>'validFrom');
      v_until:=case when v_grant->'validUntil'='null'::jsonb then null else public.faolla_attendance_instant_v1(v_grant->>'validUntil') end;
      if v_until is not null and v_until<=v_from then raise exception 'attendance_invalid_request'; end if;
    end if;
  end if;
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,
    v_merchant.owner_id,v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false) then raise exception 'attendance_access_denied'; end if;
  -- Same lock order as config and punches: merchant -> settings -> employee -> role -> scope.
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and id=p_employee_id for share;
  if not found then raise exception 'attendance_employee_invalid'; end if;
  select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
  if p_command is not null then
    insert into public.merchant_attendance_scopes(merchant_id,employee_id) values(p_site_id,p_employee_id) on conflict do nothing;
    select * into v_scope from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=p_employee_id for update;
    select * into v_operation from public.merchant_attendance_scope_operations where merchant_id=p_site_id and operation_id=v_operation_id;
    if v_operation.operation_id is not null then
      if v_operation.actor_auth_user_id<>p_auth_user_id or v_operation.employee_id<>p_employee_id or v_operation.command<>p_command
        then raise exception 'attendance_operation_conflict'; end if;
    else
      if v_scope.revision<>v_expected or v_scope.revision>=9007199254740990 then raise exception 'attendance_version_conflict'; end if;
      v_before:=public.faolla_attendance_scope_snapshot_v1(p_site_id,p_employee_id);
      if p_command->>'action'='remove' then
        delete from public.merchant_attendance_scope_grants where merchant_id=p_site_id and employee_id=p_employee_id and id=v_grant_id;
        if not found then raise exception 'attendance_scope_grant_missing'; end if;
      else
        if v_employee.status<>'active' or v_role.id is null or v_role.status<>'active'
          or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
          or not ('attendance.records.view'=any(v_role.permissions)) then raise exception 'attendance_scope_manager_invalid'; end if;
        if (select count(*) from public.merchant_attendance_workers where merchant_id=p_site_id and id=any(v_worker_ids))<>cardinality(v_worker_ids)
          or (select count(*) from public.merchant_attendance_locations where merchant_id=p_site_id and id=any(v_location_ids))<>cardinality(v_location_ids)
          then raise exception 'attendance_scope_target_invalid'; end if;
        if not exists(select 1 from public.merchant_attendance_scope_grants where merchant_id=p_site_id and employee_id=p_employee_id and id=v_grant_id)
          and (select count(*) from public.merchant_attendance_scope_grants where merchant_id=p_site_id and employee_id=p_employee_id)>=32
          then raise exception 'attendance_scope_limit'; end if;
        insert into public.merchant_attendance_scope_grants(merchant_id,employee_id,id,valid_from,valid_until)
          values(p_site_id,p_employee_id,v_grant_id,v_from,v_until)
          on conflict(merchant_id,employee_id,id) do update set valid_from=excluded.valid_from,valid_until=excluded.valid_until;
        delete from public.merchant_attendance_scope_workers where merchant_id=p_site_id and employee_id=p_employee_id and grant_id=v_grant_id;
        delete from public.merchant_attendance_scope_locations where merchant_id=p_site_id and employee_id=p_employee_id and grant_id=v_grant_id;
        insert into public.merchant_attendance_scope_workers(merchant_id,employee_id,grant_id,worker_id)
          select p_site_id,p_employee_id,v_grant_id,unnest(v_worker_ids);
        insert into public.merchant_attendance_scope_locations(merchant_id,employee_id,grant_id,location_id)
          select p_site_id,p_employee_id,v_grant_id,unnest(v_location_ids);
      end if;
      update public.merchant_attendance_scopes set revision=revision+1 where merchant_id=p_site_id and employee_id=p_employee_id returning * into v_scope;
      v_after:=public.faolla_attendance_scope_snapshot_v1(p_site_id,p_employee_id);
      insert into public.merchant_attendance_scope_operations(merchant_id,operation_id,employee_id,actor_auth_user_id,revision,command,before_value,after_value)
        values(p_site_id,v_operation_id,p_employee_id,p_auth_user_id,v_scope.revision,p_command,v_before,v_after) returning * into v_operation;
    end if;
  else
    select * into v_scope from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=p_employee_id for share;
    select * into v_operation from public.merchant_attendance_scope_operations where merchant_id=p_site_id
      and employee_id=p_employee_id and operation_id=p_operation_id and actor_auth_user_id=p_auth_user_id;
  end if;
  return jsonb_build_object('scope',public.faolla_attendance_scope_snapshot_v1(p_site_id,p_employee_id),
    'receipt',case when v_operation.operation_id is null then null else jsonb_build_object('operationId',v_operation.operation_id,
      'revision',v_operation.revision,'grantId',v_operation.command->>'grantId','action',v_operation.command->>'action') end);
exception when unique_violation then raise exception 'attendance_operation_conflict';
  when foreign_key_violation then raise exception 'attendance_scope_target_invalid';
  when invalid_text_representation then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_scopes_v1(text,uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_scopes_v1(text,uuid,uuid,jsonb,uuid) to service_role;

create function public.faolla_attendance_records_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype; v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype; v_scope public.merchant_attendance_scopes%rowtype;
  v_from timestamptz; v_to timestamptz; v_as_of timestamptz; v_now timestamptz; v_cursor_at timestamptz;
  v_cursor_id uuid; v_worker uuid; v_location uuid; v_access text; v_rows jsonb; v_next jsonb:='null'::jsonb;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['access','fromAt','toAt','workerId','locationId','asOf','cursorAt','cursorId'])
    or coalesce(p_query->>'access','') not in ('owner','manager') then raise exception 'attendance_invalid_request'; end if;
  v_access:=p_query->>'access'; v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt'); v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
  if v_to<=v_from or v_to-v_from>interval '31 days' then raise exception 'attendance_invalid_request'; end if;
  if (p_query->'workerId'<>'null'::jsonb and coalesce(p_query->>'workerId','') !~ v_uuid)
    or (p_query->'locationId'<>'null'::jsonb and coalesce(p_query->>'locationId','') !~ v_uuid)
    or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid)
    or ((p_query->'cursorId'='null'::jsonb)<>(p_query->'cursorAt'='null'::jsonb))
    or (p_query->'cursorId'<>'null'::jsonb and p_query->'asOf'='null'::jsonb) then raise exception 'attendance_invalid_request'; end if;
  v_worker:=(p_query->>'workerId')::uuid; v_location:=(p_query->>'locationId')::uuid; v_cursor_id:=(p_query->>'cursorId')::uuid;
  if v_cursor_id is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt'); end if;
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if v_access='owner' then
    if not coalesce(p_auth_user_id=any(array[v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,v_merchant.owner_id,
      v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false) then raise exception 'attendance_access_denied'; end if;
  else
    select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied'; end if;
    select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
    if not found or v_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
      or not ('attendance.records.view'=any(v_role.permissions)) then raise exception 'attendance_access_denied'; end if;
    select * into v_scope from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=v_employee.id for share;
    if not found then raise exception 'attendance_access_denied'; end if;
  end if;
  -- Clock taken after authorization locks, so expiry cannot be extended by waiting.
  v_now:=clock_timestamp();
  v_as_of:=case when p_query->'asOf'='null'::jsonb then v_now else public.faolla_attendance_instant_v1(p_query->>'asOf') end;
  if v_as_of>v_now or (v_cursor_id is not null and (v_cursor_at<v_from or v_cursor_at>=least(v_to,v_as_of)))
    then raise exception 'attendance_invalid_request'; end if;
  select coalesce(jsonb_agg(j order by occurred_at desc,id desc),'[]'::jsonb) into v_rows from (
    select e.id,e.occurred_at,jsonb_build_object('id',e.id,'workerId',e.worker_id,'locationId',e.location_id,
      'workerName',w.display_name,'workerNo',w.worker_no,'locationName',l.name,'sequence',e.sequence,'action',e.action,
      'source',e.source,'timeZone',e.time_zone,'breakPaid',e.break_paid,
      'occurredAt',to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) j
    from public.merchant_attendance_events e
    join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.id=e.worker_id
    join public.merchant_attendance_locations l on l.merchant_id=e.merchant_id and l.id=e.location_id
    where e.merchant_id=p_site_id and e.occurred_at>=v_from and e.occurred_at<least(v_to,v_as_of)
      and (v_cursor_id is null or (e.occurred_at,e.id)<(v_cursor_at,v_cursor_id))
      and (v_worker is null or e.worker_id=v_worker) and (v_location is null or e.location_id=v_location)
      and (v_access='owner' or e.worker_id in (select sw.worker_id from public.merchant_attendance_scope_workers sw
        where sw.merchant_id=p_site_id and sw.employee_id=v_employee.id))
      and (v_access='owner' or exists(select 1 from public.merchant_attendance_scope_grants g
        join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
        join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
        where g.merchant_id=p_site_id and g.employee_id=v_employee.id and g.valid_from<=v_now and (g.valid_until is null or v_now<g.valid_until)
          and sw.worker_id=e.worker_id and sl.location_id=e.location_id))
    order by e.occurred_at desc,e.id desc limit 51) page;
  if jsonb_array_length(v_rows)>50 then
    v_rows:=v_rows-50; v_next:=jsonb_build_object('occurredAt',v_rows->49->>'occurredAt','id',v_rows->49->>'id');
  end if;
  return jsonb_build_object('siteId',p_site_id,'access',v_access,'scopeRevision',case when v_access='owner' then null else v_scope.revision end,
    'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_rows,'nextCursor',v_next);
exception when invalid_text_representation then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_records_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_records_v1(text,uuid,jsonb) to service_role;

insert into public.faolla_schema_migrations(version,name) values(202609290066,'merchant_attendance_scopes_records') on conflict(version) do nothing;
commit;
