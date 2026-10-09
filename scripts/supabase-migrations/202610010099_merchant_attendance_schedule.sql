-- Unreleased/default-off planned shifts. No automatic punches, absence or payroll.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_schedule_commands (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740989),
  operation_id uuid not null, actor_auth_user_id uuid not null,
  query jsonb not null, command jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
  primary key(merchant_id,revision), unique(merchant_id,operation_id)
);
create table public.merchant_attendance_schedule_slots (
  merchant_id text not null, id uuid not null default gen_random_uuid(), revision bigint not null,
  worker_id uuid not null, employee_id uuid not null, worker_name text not null, location_id uuid not null, location_name text not null,
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)), work_date date not null,
  start_at timestamptz not null, end_at timestamptz not null,
  primary key(merchant_id,id),
  foreign key(merchant_id,revision) references public.merchant_attendance_schedule_commands(merchant_id,revision),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at-start_at<=interval '24 hours'),
  check(work_date between date '2000-01-01' and date '2100-12-31')
);
create index attendance_schedule_worker_date_idx on public.merchant_attendance_schedule_slots(merchant_id,worker_id,work_date,start_at,id);
create index attendance_schedule_worker_time_idx on public.merchant_attendance_schedule_slots(merchant_id,worker_id,start_at,end_at);
create table public.merchant_attendance_schedule_cancellations (
  merchant_id text not null, slot_id uuid not null, revision bigint not null,
  primary key(merchant_id,slot_id),
  foreign key(merchant_id,slot_id) references public.merchant_attendance_schedule_slots(merchant_id,id),
  foreign key(merchant_id,revision) references public.merchant_attendance_schedule_commands(merchant_id,revision)
);
alter table public.merchant_attendance_schedule_commands enable row level security;
alter table public.merchant_attendance_schedule_slots enable row level security;
alter table public.merchant_attendance_schedule_cancellations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_schedule_cancellations'::regclass,
      'public.merchant_attendance_schedule_commands'::regclass,
      'public.merchant_attendance_schedule_slots'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_schedule_commands,public.merchant_attendance_schedule_slots,public.merchant_attendance_schedule_cancellations from public,anon,authenticated,service_role;
create trigger attendance_schedule_commands_immutable before update or delete on public.merchant_attendance_schedule_commands for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_schedule_commands_no_truncate before truncate on public.merchant_attendance_schedule_commands for each statement execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_schedule_slots_immutable before update or delete on public.merchant_attendance_schedule_slots for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_schedule_slots_no_truncate before truncate on public.merchant_attendance_schedule_slots for each statement execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_schedule_cancellations_immutable before update or delete on public.merchant_attendance_schedule_cancellations for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_schedule_cancellations_no_truncate before truncate on public.merchant_attendance_schedule_cancellations for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_schedule_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;mode text;worker uuid;op uuid;first_day date;last_day date;rev bigint;now_at timestamptz;v_reason text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;l public.merchant_attendance_locations%rowtype;
  receipt public.merchant_attendance_schedule_commands%rowtype;old_slot public.merchant_attendance_schedule_slots%rowtype;
  item jsonb;a timestamptz;b timestamptz;prior_end timestamptz;day date;last_work_day date;k text;result_entries jsonb;count_entries integer;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or jsonb_typeof(p_query) is distinct from 'object'
    or not(p_query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or (select count(*) from jsonb_object_keys(p_query))<>6 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode:=p_query->>'access';
  if jsonb_typeof(p_query->'siteId')<>'string' or coalesce(site,'') !~ '^\d{8}$' or coalesce(mode,'') not in ('owner','self')
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or (p_query->>'fromDate') !~ '^\d{4}-\d{2}-\d{2}$' or (p_query->>'throughDate') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_query->'workerId'<>'null'::jsonb and coalesce(p_query->>'workerId','') !~ uuid_pattern)
    or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ uuid_pattern)
    or (mode='self' and (p_query->'workerId'<>'null'::jsonb or p_query->'operationId'<>'null'::jsonb or p_command is not null)) then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;op:=(p_query->>'operationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day<first_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site and (mode='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if mode='self' then
    select * into e from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    select id into worker from public.merchant_attendance_workers where merchant_id=site and employee_id=e.id;
    if not found then raise exception 'attendance_access_denied';end if;
  end if;
  if worker is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
    select * into l from public.merchant_attendance_locations where merchant_id=site and id=w.default_location_id for share;
  end if;
  select coalesce(max(revision),0) into rev from public.merchant_attendance_schedule_commands where merchant_id=site;
  now_at:=clock_timestamp();
  if p_command is not null then
    if mode<>'owner' or worker is null or op is not null or jsonb_typeof(p_command)<>'object'
      or coalesce(p_command->>'action','') not in ('publish','cancel')
      or not(p_command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action'])
      or coalesce(p_command->>'operationId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    foreach k in array array['expectedRevision','expectedSettingsVersion'] loop
      if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^(0|[1-9][0-9]{0,15})$'
        or (p_command->>k)::numeric>9007199254740989 or (k='expectedSettingsVersion' and (p_command->>k)::numeric<1) then raise exception 'attendance_invalid_request';end if;
    end loop;
    v_reason:=p_command->>'reason';
    if jsonb_typeof(p_command->'reason')<>'string' or char_length(v_reason) not between 1 and 200 or v_reason<>btrim(v_reason) or v_reason ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    if p_command->>'action'='publish' then
      if (select count(*) from jsonb_object_keys(p_command))<>8 or not(p_command ?& array['locationId','timeZone','slots'])
        or coalesce(p_command->>'locationId','') !~ uuid_pattern or jsonb_typeof(p_command->'timeZone')<>'string'
        or jsonb_typeof(p_command->'slots')<>'array' or jsonb_array_length(p_command->'slots') not between 1 and 32 then raise exception 'attendance_invalid_request';end if;
    elsif (select count(*) from jsonb_object_keys(p_command))<>6 or not(p_command ? 'slotId') or coalesce(p_command->>'slotId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  if mode='owner' and op is not null then
    select * into receipt from public.merchant_attendance_schedule_commands where merchant_id=site and operation_id=op;
    if receipt.revision is not null and (receipt.actor_auth_user_id<>p_auth_user_id or receipt.query<>jsonb_set(p_query,'{operationId}','null'::jsonb)) then
      if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
    end if;
  end if;
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not p_allow_write then raise exception 'attendance_platform_paused';end if;
      if (p_command->>'expectedRevision')::bigint<>rev or (p_command->>'expectedSettingsVersion')::bigint<>s.version then raise exception 'attendance_version_conflict';end if;
      if p_command->>'action'='publish' then
        select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
        if not found or e.status<>'active' or not w.active then raise exception 'attendance_schedule_worker_invalid';end if;
        if l.id is null or not l.active or l.id<>(p_command->>'locationId')::uuid or l.time_zone<>p_command->>'timeZone' then raise exception 'attendance_schedule_location_changed';end if;
        prior_end:=null;
        for item in select value from jsonb_array_elements(p_command->'slots') loop
          if jsonb_typeof(item)<>'array' or jsonb_array_length(item)<>2 or jsonb_typeof(item->0)<>'string' or jsonb_typeof(item->1)<>'string'
            or coalesce(item->>0,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' or coalesce(item->>1,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' then raise exception 'attendance_invalid_request';end if;
          a:=(item->>0)::timestamptz;b:=(item->>1)::timestamptz;
          if to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>0 or to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>1
            or b<=a or b-a>interval '24 hours' or a<prior_end then raise exception 'attendance_invalid_request';end if;
          day:=(a at time zone l.time_zone)::date;last_work_day:=((b-interval '1 millisecond') at time zone l.time_zone)::date;
          if day<first_day or day>last_day then raise exception 'attendance_invalid_request';end if;
          if a<=now_at or a>now_at+interval '180 days' then raise exception 'attendance_schedule_past';end if;
          if not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=site and worker_id=worker and starts_on<=day and (ends_on is null or ends_on>=last_work_day)) then raise exception 'attendance_schedule_outside_employment';end if;
          if exists(select 1 from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=worker and x.start_at<b and x.end_at>a
            and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=site and c.slot_id=x.id)) then raise exception 'attendance_schedule_overlap';end if;
          prior_end:=b;
        end loop;
      else
        select * into old_slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=(p_command->>'slotId')::uuid and x.worker_id=worker
          and x.work_date between first_day and last_day and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=site and c.slot_id=x.id);
        if not found then raise exception 'attendance_schedule_not_active';end if;
        if old_slot.start_at<=now_at then raise exception 'attendance_schedule_past';end if;
      end if;
      rev:=rev+1;
      insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command)
        values(site,rev,op,p_auth_user_id,p_query,p_command) returning * into receipt;
      if p_command->>'action'='publish' then
        insert into public.merchant_attendance_schedule_slots(merchant_id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
          select site,rev,worker,w.employee_id,w.display_name,l.id,l.name,l.time_zone,((value->>0)::timestamptz at time zone l.time_zone)::date,(value->>0)::timestamptz,(value->>1)::timestamptz from jsonb_array_elements(p_command->'slots');
      else insert into public.merchant_attendance_schedule_cancellations(merchant_id,slot_id,revision) values(site,old_slot.id,rev);end if;
    end if;
  end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',x.id,'workerId',x.worker_id,'workerName',x.worker_name,'locationId',x.location_id,'locationName',x.location_name,
    'timeZone',x.time_zone,'workDate',x.work_date,'startAt',to_char(x.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt',to_char(x.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',x.revision,'cancelled',x.cancel_revision is not null,
    'reason',x.publish_reason,'cancelReason',x.cancel_reason) order by x.start_at,x.id),'[]'::jsonb) into count_entries,result_entries
    from (select t.*,c.revision cancel_revision,p.command->>'reason' publish_reason,d.command->>'reason' cancel_reason
      from public.merchant_attendance_schedule_slots t join public.merchant_attendance_schedule_commands p on p.merchant_id=t.merchant_id and p.revision=t.revision
      left join public.merchant_attendance_schedule_cancellations c on c.merchant_id=t.merchant_id and c.slot_id=t.id
      left join public.merchant_attendance_schedule_commands d on d.merchant_id=c.merchant_id and d.revision=c.revision
      where t.merchant_id=site and t.worker_id=worker and (mode='owner' or t.employee_id=e.id)
        and t.work_date between first_day and last_day order by t.start_at,t.id limit 101) x;
  -- An oversized list must not hide a successful write receipt. No partial list or false totals.
  if count_entries>100 then result_entries:='[]'::jsonb;end if;
  return jsonb_build_object('siteId',site,'access',mode,'fromDate',first_day,'throughDate',last_day,'revision',rev,'settingsVersion',s.version,'timeZone',s.time_zone,
    'worker',case when w.id is null then null else jsonb_build_object('id',w.id,'name',w.display_name,'active',w.active,'location',case when l.id is null then null
      else jsonb_build_object('id',l.id,'name',l.name,'timeZone',l.time_zone,'active',l.active) end) end,
    'entries',result_entries,'rangeLimited',count_entries>100,'receipt',case when receipt.revision is null then null else jsonb_build_object('operationId',receipt.operation_id,'revision',receipt.revision,'command',receipt.command) end);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010099,'merchant_attendance_schedule') on conflict(version) do nothing;
commit;
