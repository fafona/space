-- Independent owner-approved personal rule candidates. No employee application,
-- dual approval, rule application, historical rewrite or existing writer change.
begin;
set local lock_timeout='3s';

do $personal_rules_prerequisites$
declare installed boolean;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_workers') is null or to_regclass('public.merchant_enterprise_employees') is null then
    raise exception 'merchant_attendance_personal_rules_prerequisite_required';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290064 and name='merchant_attendance_owner_configuration')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610040127 and name='merchant_attendance_rule_versions') then
    raise exception 'merchant_attendance_personal_rules_prerequisite_required';end if;
  foreach p in array array['public.faolla_attendance_rule_values_v1(jsonb)','public.faolla_attendance_rule_day_start_v1(text,text)',
    'public.faolla_attendance_group_text_v1(text,integer,integer)','public.faolla_attendance_group_date_v1(text,text)',
    'public.faolla_attendance_valid_zone_v1(text)','public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_personal_rules_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040129 and name='merchant_attendance_personal_rules') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040129 and name<>'merchant_attendance_personal_rules') then
    raise exception 'merchant_attendance_personal_rules_installation_conflict';end if;
  foreach t in array array['merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_personal_rules_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_personal_rule_end_v1(text,text)',
    'public.faolla_attendance_personal_rule_command_v1(jsonb)','public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_personal_rules_installation_conflict';end if;
  end loop;
end;
$personal_rules_prerequisites$;

-- Inclusive final date, matching attendanceDayUtcRange(...).endAt. Validate the
-- selected end date itself with127, then find the first instant ON OR AFTER the
-- following label. That following date may be skipped or the2101 sentinel.
create or replace function public.faolla_attendance_personal_rule_end_v1(p text,z text)
returns timestamptz language plpgsql stable set search_path=pg_catalog as $$
declare d date;lo bigint;hi bigint;middle bigint;instant timestamptz;epoch constant timestamptz:='1970-01-01 00:00:00+00';
begin
  if public.faolla_attendance_rule_day_start_v1(p,z) is null then return null;end if;
  d:=p::date+1;lo:=(extract(epoch from (d::timestamp at time zone 'UTC'))*1000)::bigint-129600000;hi:=lo+259200000;
  while lo<hi loop
    middle:=lo+(hi-lo)/2;
    instant:=epoch+(middle/1000)*interval '1 second'+(middle%1000)*interval '1 millisecond';
    if (instant at time zone z)::date<d then lo:=middle+1;else hi:=middle;end if;
  end loop;
  return epoch+(lo/1000)*interval '1 second'+(lo%1000)*interval '1 millisecond';
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then return null;
end;
$$;

create or replace function public.faolla_attendance_personal_rule_command_v1(p jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare a text;k text;n integer;u text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['operationId','action','expectedRevision','reason'])
    or jsonb_typeof(p->'operationId')<>'string' or coalesce(p->>'operationId','') !~ u
    or jsonb_typeof(p->'action')<>'string' or jsonb_typeof(p->'reason')<>'string' or not public.faolla_attendance_group_text_v1(p->>'reason',1,200)
    or jsonb_typeof(p->'expectedRevision')<>'number' or coalesce(p->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
    or (p->>'expectedRevision')::numeric>9007199254740989 then return false;end if;
  a:=p->>'action';select count(*) into n from jsonb_object_keys(p);
  if a='approve' then
    if n<>12 or not(p ?& array['expectedWorkerVersion','expectedSettingsVersion','employeeId','employeeAuthUserId','timeZone','startsOn','endsOn','rules']) then return false;end if;
    foreach k in array array['expectedWorkerVersion','expectedSettingsVersion'] loop
      if jsonb_typeof(p->k)<>'number' or coalesce(p->>k,'') !~ '^[1-9][0-9]{0,15}$' or (p->>k)::numeric>9007199254740990 then return false;end if;
    end loop;
    foreach k in array array['employeeId','employeeAuthUserId'] loop
      if jsonb_typeof(p->k)<>'string' or coalesce(p->>k,'') !~ u then return false;end if;
    end loop;
    if jsonb_typeof(p->'timeZone')<>'string' or not public.faolla_attendance_valid_zone_v1(p->>'timeZone')
      or jsonb_typeof(p->'startsOn')<>'string' or not public.faolla_attendance_group_date_v1(p->>'startsOn')
      or jsonb_typeof(p->'endsOn')<>'string' or not public.faolla_attendance_group_date_v1(p->>'endsOn')
      or (p->>'endsOn')::date-(p->>'startsOn')::date not between 0 and 30
      or not public.faolla_attendance_rule_values_v1(p->'rules') then return false;end if;
    if not exists(select 1 from jsonb_each(p->'rules') choices where choices.value->>'mode'<>'inherit') then return false;end if;
  elsif a='withdraw' then
    if n<>5 or not(p ? 'approvedRevision') or jsonb_typeof(p->'approvedRevision')<>'number'
      or coalesce(p->>'approvedRevision','') !~ '^[1-9][0-9]{0,15}$' or (p->>'approvedRevision')::numeric>9007199254740990
      or (p->>'approvedRevision')::numeric>(p->>'expectedRevision')::numeric then return false;end if;
  else return false;end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then return false;
end;
$$;

create table if not exists public.merchant_attendance_personal_rule_streams (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),worker_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(merchant_id,worker_id),unique(merchant_id,worker_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create table if not exists public.merchant_attendance_personal_rule_operations (
  merchant_id text not null,worker_id uuid not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  action text not null check(action in('approve','withdraw')),actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,
  recorded_at timestamptz not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  worker_version bigint not null check(worker_version between 1 and 9007199254740990),settings_version bigint not null check(settings_version between 1 and 9007199254740990),
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),starts_on date not null,ends_on date not null,
  from_at timestamptz not null,to_at timestamptz not null,rules jsonb not null,approved_revision bigint null,
  approved_action text not null default 'approve' check(approved_action='approve'),
  primary key(merchant_id,operation_id),unique(merchant_id,worker_id,revision),unique(merchant_id,worker_id,revision,action),
  foreign key(merchant_id,worker_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_personal_rule_streams(merchant_id,worker_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,worker_id,approved_revision,approved_action)
    references public.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision,action),
  check(public.faolla_attendance_personal_rule_command_v1(command)),check(jsonb_typeof(snapshot)='object'),
  check(command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
  check(starts_on between date '2000-01-01' and date '2100-12-31' and ends_on between starts_on and date '2100-12-31' and ends_on-starts_on<=30),
  check(isfinite(recorded_at) and isfinite(from_at) and isfinite(to_at) and to_at>from_at and recorded_at<from_at),
  check(public.faolla_attendance_rule_values_v1(rules)),
  check((action='approve' and approved_revision is null) or (action='withdraw' and approved_revision is not null and approved_revision between 1 and revision-1)),
  check(revision<>1 or action='approve')
);
create index if not exists attendance_personal_rule_history_idx on public.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision desc);
create index if not exists attendance_personal_rule_interval_idx on public.merchant_attendance_personal_rule_operations(merchant_id,worker_id,from_at,to_at) where action='approve';
create unique index if not exists attendance_personal_rule_withdrawals_idx on public.merchant_attendance_personal_rule_operations(merchant_id,worker_id,approved_revision) where action='withdraw';

do $personal_rules_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_personal_rule_streams'::regclass and conname='attendance_personal_rule_head_receipt_fk') then
    alter table public.merchant_attendance_personal_rule_streams add constraint attendance_personal_rule_head_receipt_fk foreign key(merchant_id,worker_id,revision)
      references public.merchant_attendance_personal_rule_operations(merchant_id,worker_id,revision) deferrable initially deferred;end if;
end;
$personal_rules_constraints$;
alter table public.merchant_attendance_personal_rule_streams enable row level security;
alter table public.merchant_attendance_personal_rule_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_personal_rule_operations'::regclass,
      'public.merchant_attendance_personal_rule_streams'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_personal_rule_streams,public.merchant_attendance_personal_rule_operations from public,anon,authenticated,service_role;
do $personal_rules_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_personal_rule_operations'::regclass and tgname='attendance_personal_rule_operations_immutable') then
    create trigger attendance_personal_rule_operations_immutable before update or delete on public.merchant_attendance_personal_rule_operations
      for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_personal_rule_operations'::regclass and tgname='attendance_personal_rule_operations_no_truncate') then
    create trigger attendance_personal_rule_operations_no_truncate before truncate on public.merchant_attendance_personal_rule_operations
      for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$personal_rules_triggers$;

create or replace function public.faolla_attendance_personal_rule_item_v1(p public.merchant_attendance_personal_rule_operations)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('revision',p.revision,'operationId',p.operation_id,'actorId',p.actor_auth_user_id,'action',p.action,'reason',p.command->>'reason',
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerVersion',p.worker_version,'settingsVersion',p.settings_version,
    'timeZone',p.time_zone,'startsOn',to_char(p.starts_on,'YYYY-MM-DD'),'endsOn',to_char(p.ends_on,'YYYY-MM-DD'),
    'fromAt',to_char(p.from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'toAt',to_char(p.to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'rules',p.rules,'approvedRevision',p.approved_revision);
$$;

-- Constant-depth validation. Original snapshots never acquire a later derived
-- withdrawnByRevision marker, or get rebound to today's employee/settings.
create or replace function public.faolla_attendance_personal_rule_receipt_v1(p public.merchant_attendance_personal_rule_operations)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare previous public.merchant_attendance_personal_rule_operations%rowtype;target public.merchant_attendance_personal_rule_operations%rowtype;
  expected jsonb;context public.merchant_attendance_personal_rule_operations%rowtype;
begin
  if p.operation_id is null or not public.faolla_attendance_personal_rule_command_v1(p.command)
    or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.action
    or (p.command->>'expectedRevision')::bigint is distinct from p.revision-1 then raise exception 'attendance_personal_rule_invalid';end if;
  expected:=public.faolla_attendance_personal_rule_item_v1(p);
  if p.snapshot is distinct from expected then raise exception 'attendance_personal_rule_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at or not public.faolla_attendance_personal_rule_command_v1(previous.command)
      or previous.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(previous)
      or previous.employee_id is distinct from p.employee_id or previous.employee_auth_user_id is distinct from p.employee_auth_user_id then
      raise exception 'attendance_personal_rule_invalid';end if;
  elsif p.action<>'approve' then raise exception 'attendance_personal_rule_invalid';end if;
  if p.action='approve' then context:=p;
  elsif p.action='withdraw' then
    select * into target from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=p.approved_revision;
    if target.operation_id is null or target.action<>'approve' or target.revision>=p.revision or target.recorded_at>p.recorded_at
      or p.recorded_at>=target.from_at or target.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(target)
      or not public.faolla_attendance_personal_rule_command_v1(target.command)
      or target.command->>'operationId' is distinct from target.operation_id::text or target.command->>'action' is distinct from target.action
      or (target.command->>'expectedRevision')::bigint is distinct from target.revision-1
      or p.command->'approvedRevision' is distinct from to_jsonb(p.approved_revision)
      or row(p.employee_id,p.employee_auth_user_id,p.worker_version,p.settings_version,p.time_zone,p.starts_on,p.ends_on,p.from_at,p.to_at,p.rules)
        is distinct from row(target.employee_id,target.employee_auth_user_id,target.worker_version,target.settings_version,target.time_zone,target.starts_on,target.ends_on,target.from_at,target.to_at,target.rules) then
      raise exception 'attendance_personal_rule_invalid';end if;
    context:=target;
  else raise exception 'attendance_personal_rule_invalid';end if;
  if context.command->'expectedWorkerVersion' is distinct from to_jsonb(context.worker_version)
    or context.command->'expectedSettingsVersion' is distinct from to_jsonb(context.settings_version)
    or context.command->>'employeeId' is distinct from context.employee_id::text
    or context.command->>'employeeAuthUserId' is distinct from context.employee_auth_user_id::text
    or context.command->>'timeZone' is distinct from context.time_zone or context.rules is distinct from context.command->'rules'
    or context.command->>'startsOn' is distinct from to_char(context.starts_on,'YYYY-MM-DD')
    or context.command->>'endsOn' is distinct from to_char(context.ends_on,'YYYY-MM-DD')
    or context.from_at is distinct from public.faolla_attendance_rule_day_start_v1(context.command->>'startsOn',context.time_zone)
    or context.to_at is distinct from public.faolla_attendance_personal_rule_end_v1(context.command->>'endsOn',context.time_zone)
    or context.starts_on<=(context.recorded_at at time zone context.time_zone)::date or context.from_at<=context.recorded_at then
    raise exception 'attendance_personal_rule_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'command',p.command,'item',expected);
end;
$$;

create or replace function public.faolla_attendance_personal_rule_stream_checked_v1(p public.merchant_attendance_personal_rule_streams)
returns void language plpgsql set search_path=pg_catalog as $$
declare first_op public.merchant_attendance_personal_rule_operations%rowtype;last_op public.merchant_attendance_personal_rule_operations%rowtype;
begin
  select * into first_op from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=1;
  select * into last_op from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=p.revision;
  if first_op.operation_id is null or last_op.operation_id is null or first_op.recorded_at<>p.created_at or last_op.recorded_at<>p.updated_at
    or first_op.employee_id is distinct from p.employee_id or first_op.employee_auth_user_id is distinct from p.employee_auth_user_id
    or last_op.employee_id is distinct from p.employee_id or last_op.employee_auth_user_id is distinct from p.employee_auth_user_id
    or exists(select 1 from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision>p.revision) then
    raise exception 'attendance_personal_rule_invalid';end if;
  perform public.faolla_attendance_personal_rule_receipt_v1(first_op);perform public.faolla_attendance_personal_rule_receipt_v1(last_op);
end;
$$;

create or replace function public.faolla_attendance_personal_rules_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;op uuid;before_rev bigint;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  stream public.merchant_attendance_personal_rule_streams%rowtype;existing public.merchant_attendance_personal_rule_operations%rowtype;
  entry public.merchant_attendance_personal_rule_operations%rowtype;target public.merchant_attendance_personal_rule_operations%rowtype;
  withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
  worker_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;read_at timestamptz;start_at timestamptz;end_at timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','workerId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ uuid_pattern
    or p_query->'operationId'<>'null'::jsonb and (jsonb_typeof(p_query->'operationId')<>'string' or coalesce(p_query->>'operationId','') !~ uuid_pattern)
    or p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
      or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_personal_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Current owner -> serialized settings -> worker -> actual employee binding.
  -- Locks remain held through identity validation, original recovery and writes.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_valid_zone_v1(s.time_zone) or not public.faolla_attendance_group_text_v1(w.display_name,1,120)
    or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_personal_rule_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',coalesce(e.status='active',false));
  select * into stream from public.merchant_attendance_personal_rule_streams where merchant_id=site and worker_id=wid;
  if found then
    if stream.employee_id is distinct from w.employee_id or stream.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_personal_rule_identity_changed';end if;
    current_rev:=stream.revision;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);
  end if;
  if op is not null then
    select * into existing from public.merchant_attendance_personal_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.worker_id<>wid or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_personal_rule_invalid';end if;
      receipt:=public.faolla_attendance_personal_rule_receipt_v1(existing);
    end if;
  end if;

  -- Same-owner, same-identity original receipts precede new pause/activity/CAS
  -- eligibility. A rebound worker cannot recover another person's history.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name='approve' then
      if not w.active or e.id is null or e.status<>'active' or e.auth_user_id is null then raise exception 'attendance_personal_rule_worker_inactive';end if;
      if (p_command->>'employeeId')::uuid is distinct from w.employee_id or (p_command->>'employeeAuthUserId')::uuid is distinct from e.auth_user_id then
        raise exception 'attendance_personal_rule_identity_changed';end if;
      if (p_command->>'expectedWorkerVersion')::bigint<>w.version or (p_command->>'expectedSettingsVersion')::bigint<>s.version
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      start_at:=public.faolla_attendance_rule_day_start_v1(p_command->>'startsOn',s.time_zone);
      end_at:=public.faolla_attendance_personal_rule_end_v1(p_command->>'endsOn',s.time_zone);
      if start_at is null or end_at is null or end_at<=start_at then raise exception 'attendance_invalid_request';end if;
      if exists(select 1 from public.merchant_attendance_personal_rule_operations approved where approved.merchant_id=site and approved.worker_id=wid and approved.action='approve'
        and approved.from_at<end_at and approved.to_at>start_at and not exists(select 1 from public.merchant_attendance_personal_rule_operations withdrawn
          where withdrawn.merchant_id=approved.merchant_id and withdrawn.worker_id=approved.worker_id and withdrawn.action='withdraw' and withdrawn.approved_revision=approved.revision)) then
        raise exception 'attendance_personal_rule_overlap';end if;
    else
      select * into target from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and revision=(p_command->>'approvedRevision')::bigint and action='approve';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_personal_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=target.revision) then
        raise exception 'attendance_personal_rule_already_withdrawn';end if;
    end if;
    -- Recheck with the wall clock AFTER waiting for all identity/settings locks.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
    if action_name='approve' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'startsOn')::date<=today or start_at<=stamp then
        raise exception 'attendance_personal_rule_future_required';end if;
      entry.employee_id:=w.employee_id;entry.employee_auth_user_id:=e.auth_user_id;entry.worker_version:=w.version;entry.settings_version:=s.version;
      entry.time_zone:=s.time_zone;entry.starts_on:=(p_command->>'startsOn')::date;entry.ends_on:=(p_command->>'endsOn')::date;
      entry.from_at:=start_at;entry.to_at:=end_at;entry.rules:=p_command->'rules';
    else
      if stamp>=target.from_at then raise exception 'attendance_personal_rule_future_required';end if;
      -- Withdrawal changes only the operation envelope; all original identity,
      -- versions, values and interval facts remain exactly the approved snapshot.
      entry.employee_id:=target.employee_id;entry.employee_auth_user_id:=target.employee_auth_user_id;
      entry.worker_version:=target.worker_version;entry.settings_version:=target.settings_version;entry.time_zone:=target.time_zone;
      entry.starts_on:=target.starts_on;entry.ends_on:=target.ends_on;entry.from_at:=target.from_at;entry.to_at:=target.to_at;
      entry.rules:=target.rules;entry.approved_revision:=target.revision;
    end if;
    entry.merchant_id:=site;entry.worker_id:=wid;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.approved_action:='approve';entry.snapshot:=public.faolla_attendance_personal_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_personal_rule_streams(merchant_id,worker_id,employee_id,employee_auth_user_id,revision,created_at,updated_at)
        values(site,wid,w.employee_id,e.auth_user_id,new_rev,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_personal_rule_streams set revision=new_rev,updated_at=stamp where merchant_id=site and worker_id=wid returning * into stream;
    end if;
    insert into public.merchant_attendance_personal_rule_operations select entry.*;
    current_rev:=new_rev;perform public.faolla_attendance_personal_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_personal_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_personal_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='approve' then
      select * into withdrawal from public.merchant_attendance_personal_rule_operations where merchant_id=site and worker_id=wid and action='withdraw' and approved_revision=entry.revision;
      if found then perform public.faolla_attendance_personal_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  read_at:=clock_timestamp();
  if stream.updated_at is not null and read_at<stream.updated_at then raise exception 'attendance_personal_rule_invalid';end if;
  result:=jsonb_build_object('protocol','personal-rules-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt,
    'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(result::text)>131072 then raise exception 'attendance_personal_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;

do $personal_rules_acl$
declare p regprocedure;
begin
  foreach p in array array['public.faolla_attendance_personal_rule_end_v1(text,text)'::regprocedure,
    'public.faolla_attendance_personal_rule_command_v1(jsonb)'::regprocedure,
    'public.faolla_attendance_personal_rule_item_v1(public.merchant_attendance_personal_rule_operations)'::regprocedure,
    'public.faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)'::regprocedure,
    'public.faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)'::regprocedure,
    'public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
  end loop;
end;
$personal_rules_acl$;
grant execute on function public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040129,'merchant_attendance_personal_rules') on conflict(version) do nothing;

do $personal_rules_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040129 and name='merchant_attendance_personal_rules') then
    raise exception 'merchant_attendance_personal_rules_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_personal_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'merchant_attendance_personal_rules_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_personal_rule_streams'::regclass,'public.merchant_attendance_personal_rule_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_personal_rules_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_personal_rules_acl_postcondition_failed';end if;
    end loop;
  end loop;
  for p in select oid::regprocedure from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_personal_rule_streams'::regclass)
    and proname in('faolla_attendance_personal_rule_end_v1','faolla_attendance_personal_rule_command_v1','faolla_attendance_personal_rule_item_v1',
      'faolla_attendance_personal_rule_receipt_v1','faolla_attendance_personal_rule_stream_checked_v1') loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_personal_rules_acl_postcondition_failed';end if;
    end loop;
  end loop;
end;
$personal_rules_postconditions$;
notify pgrst, 'reload schema';
commit;
