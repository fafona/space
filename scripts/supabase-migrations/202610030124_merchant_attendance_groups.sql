-- Owner-managed attendance-profile groups and date-label assignments only.
-- No existing clock, schedule, permission, payroll or worker/settings value changes.
begin;
set local lock_timeout='3s';
do $groups_prerequisites$
declare installed boolean;t text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_workers') is null or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null
    or to_regprocedure('public.faolla_attendance_valid_zone_v1(text)') is null then raise exception 'merchant_attendance_groups_prerequisite_required';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290061 and name='merchant_attendance_foundation') then
    raise exception 'merchant_attendance_groups_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name<>'merchant_attendance_groups') then
    raise exception 'merchant_attendance_groups_installation_conflict';end if;
  foreach t in array array['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_groups_installation_conflict';end if;
  end loop;
  if installed<>(to_regprocedure('public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)') is not null) then
    raise exception 'merchant_attendance_groups_installation_conflict';end if;
end;
$groups_prerequisites$;

create or replace function public.faolla_attendance_group_text_v1(p text,lo integer,hi integer)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select p is not null and char_length(p) between lo and hi
    and p=btrim(p,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and p !~ '[[:cntrl:]\u007f-\u009f]';
$$;
create or replace function public.faolla_attendance_group_date_v1(p text,z text default null)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare d date;
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return false;end if;
  d:=p::date;
  return d between date '2000-01-01' and date '2100-12-31' and to_char(d,'YYYY-MM-DD')=p
    and (z is null or public.faolla_attendance_valid_zone_v1(z) and ((d::timestamp at time zone z) at time zone z)::date=d);
exception when invalid_text_representation or datetime_field_overflow or invalid_parameter_value then return false;
end;
$$;
create or replace function public.faolla_attendance_group_command_v1(p jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare a text;k text;n integer;u text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['operationId','action','reason'])
    or jsonb_typeof(p->'operationId')<>'string' or coalesce(p->>'operationId','') !~ u or jsonb_typeof(p->'action')<>'string'
    or jsonb_typeof(p->'reason')<>'string' or not public.faolla_attendance_group_text_v1(p->>'reason',1,200) then return false;end if;
  a:=p->>'action';select count(*) into n from jsonb_object_keys(p);
  if a='save_group' then
    if n<>8 or not(p ?& array['groupId','expectedRevision','name','description','active']) or jsonb_typeof(p->'groupId')<>'string'
      or coalesce(p->>'groupId','') !~ u or jsonb_typeof(p->'expectedRevision')<>'number' or coalesce(p->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p->>'expectedRevision')::numeric>9007199254740989 or p->'expectedRevision'='0'::jsonb and p->>'groupId'<>p->>'operationId'
      or jsonb_typeof(p->'name')<>'string' or not public.faolla_attendance_group_text_v1(p->>'name',1,80)
      or jsonb_typeof(p->'description')<>'string' or not public.faolla_attendance_group_text_v1(p->>'description',0,200)
      or jsonb_typeof(p->'active')<>'boolean' then return false;end if;
  elsif a='assign' then
    if n<>11 or not(p ?& array['groupId','workerId','expectedGroupRevision','expectedWorkerVersion','expectedSettingsVersion','timeZone','startsOn','endsOn']) then return false;end if;
    foreach k in array array['groupId','workerId'] loop
      if jsonb_typeof(p->k)<>'string' or coalesce(p->>k,'') !~ u then return false;end if;
    end loop;
    foreach k in array array['expectedGroupRevision','expectedWorkerVersion','expectedSettingsVersion'] loop
      if jsonb_typeof(p->k)<>'number' or coalesce(p->>k,'') !~ '^[1-9][0-9]{0,15}$' or (p->>k)::numeric>9007199254740990 then return false;end if;
    end loop;
    if jsonb_typeof(p->'timeZone')<>'string' or not public.faolla_attendance_valid_zone_v1(p->>'timeZone')
      or jsonb_typeof(p->'startsOn')<>'string' or not public.faolla_attendance_group_date_v1(p->>'startsOn',p->>'timeZone')
      or p->'endsOn'<>'null'::jsonb and (jsonb_typeof(p->'endsOn')<>'string' or not public.faolla_attendance_group_date_v1(p->>'endsOn',p->>'timeZone')
        or p->>'endsOn'<p->>'startsOn') then return false;end if;
  elsif a in('end','cancel') then
    if n<>(case when a='end' then 6 else 5 end) or not(p ?& array['assignmentId','expectedRevision'])
      or jsonb_typeof(p->'assignmentId')<>'string' or coalesce(p->>'assignmentId','') !~ u
      or p->'expectedRevision' not in('1'::jsonb,'2'::jsonb) then return false;end if;
    if a='end' and (not(p ? 'endsOn') or p->'expectedRevision'<>'1'::jsonb or jsonb_typeof(p->'endsOn')<>'string'
      or not public.faolla_attendance_group_date_v1(p->>'endsOn')) then return false;end if;
  else return false;end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then return false;
end;
$$;

create table if not exists public.merchant_attendance_groups (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),group_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),name text not null,description text not null,active boolean not null,
  created_at timestamptz not null,updated_at timestamptz not null,actor_auth_user_id uuid not null,
  primary key(merchant_id,group_id),check(public.faolla_attendance_group_text_v1(name,1,80)),check(public.faolla_attendance_group_text_v1(description,0,200)),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create table if not exists public.merchant_attendance_group_operations (
  merchant_id text not null,operation_id uuid not null,group_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,group_id,revision),
  foreign key(merchant_id,group_id) references public.merchant_attendance_groups(merchant_id,group_id),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object'),check(revision<>1 or operation_id=group_id)
);
create table if not exists public.merchant_attendance_group_assignments (
  merchant_id text not null,assignment_id uuid not null,group_id uuid not null,group_name text not null,worker_id uuid not null,
  worker_name text not null,worker_no text not null,employee_id uuid null,group_revision bigint not null,worker_version bigint not null,settings_version bigint not null,
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),starts_on date not null,original_ends_on date null,ends_on date null,
  revision smallint not null,status text not null,created_at timestamptz not null,updated_at timestamptz not null,actor_auth_user_id uuid not null,
  primary key(merchant_id,assignment_id),foreign key(merchant_id,group_id) references public.merchant_attendance_groups(merchant_id,group_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  check(public.faolla_attendance_group_text_v1(group_name,1,80)),check(public.faolla_attendance_group_text_v1(worker_name,1,120)),check(public.faolla_attendance_group_text_v1(worker_no,1,40)),
  check(group_revision between 1 and 9007199254740990 and worker_version between 1 and 9007199254740990 and settings_version between 1 and 9007199254740990),
  check(starts_on between date '2000-01-01' and date '2100-12-31'),
  check(original_ends_on is null or original_ends_on between starts_on and date '2100-12-31'),check(ends_on is null or ends_on between starts_on and date '2100-12-31'),
  check((status='assigned' and revision=1 and ends_on is not distinct from original_ends_on)
    or (status='ended' and revision=2 and original_ends_on is null and ends_on is not null) or (status='cancelled' and revision in(2,3))),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create index if not exists attendance_group_assignments_group_idx on public.merchant_attendance_group_assignments(merchant_id,group_id,assignment_id desc);
create index if not exists attendance_group_assignments_worker_idx on public.merchant_attendance_group_assignments(merchant_id,worker_id,assignment_id desc);
create index if not exists attendance_group_assignments_overlap_idx on public.merchant_attendance_group_assignments(merchant_id,worker_id,starts_on,ends_on) where status<>'cancelled';
create table if not exists public.merchant_attendance_group_assignment_operations (
  merchant_id text not null,operation_id uuid not null,assignment_id uuid not null,revision smallint not null,action text not null,
  actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,assignment_id,revision),
  foreign key(merchant_id,assignment_id) references public.merchant_attendance_group_assignments(merchant_id,assignment_id),
  check((revision=1 and action='assign' and operation_id=assignment_id) or (revision=2 and action in('end','cancel')) or (revision=3 and action='cancel')),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object')
);
do $groups_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_groups'::regclass and conname='attendance_group_create_receipt_fk') then
    alter table public.merchant_attendance_groups add constraint attendance_group_create_receipt_fk foreign key(merchant_id,group_id)
      references public.merchant_attendance_group_operations(merchant_id,operation_id) deferrable initially deferred;end if;
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_group_assignments'::regclass and conname='attendance_group_assignment_receipt_fk') then
    alter table public.merchant_attendance_group_assignments add constraint attendance_group_assignment_receipt_fk foreign key(merchant_id,assignment_id)
      references public.merchant_attendance_group_assignment_operations(merchant_id,operation_id) deferrable initially deferred;end if;
end;
$groups_constraints$;
alter table public.merchant_attendance_groups enable row level security;
alter table public.merchant_attendance_group_operations enable row level security;
alter table public.merchant_attendance_group_assignments enable row level security;
alter table public.merchant_attendance_group_assignment_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_group_assignment_operations'::regclass,
      'public.merchant_attendance_group_assignments'::regclass,
      'public.merchant_attendance_group_operations'::regclass,
      'public.merchant_attendance_groups'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_groups,public.merchant_attendance_group_operations,public.merchant_attendance_group_assignments,public.merchant_attendance_group_assignment_operations from public,anon,authenticated,service_role;
do $groups_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_group_operations','merchant_attendance_group_assignment_operations'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);end if;
  end loop;
end;
$groups_triggers$;

create or replace function public.faolla_attendance_group_item_v1(p public.merchant_attendance_groups)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('groupId',p.group_id,'revision',p.revision,'name',p.name,'description',p.description,'active',p.active,
    'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updatedAt',to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create or replace function public.faolla_attendance_group_receipt_v1(p public.merchant_attendance_group_operations,g public.merchant_attendance_groups)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare expected jsonb;
begin
  if p.operation_id is null or p.merchant_id<>g.merchant_id or p.group_id<>g.group_id or p.revision>g.revision
    or not public.faolla_attendance_group_command_v1(p.command) or p.command->>'action'<>'save_group'
    or p.command->>'operationId'<>p.operation_id::text or p.command->>'groupId'<>g.group_id::text
    or (p.command->>'expectedRevision')::bigint<>p.revision-1 or p.recorded_at<g.created_at or p.recorded_at>g.updated_at
    or p.revision=1 and (p.operation_id<>g.group_id or p.actor_auth_user_id<>g.actor_auth_user_id or p.recorded_at<>g.created_at)
    or exists(select 1 from public.merchant_attendance_group_assignment_operations where merchant_id=p.merchant_id and operation_id=p.operation_id) then
    raise exception 'attendance_group_invalid';end if;
  expected:=jsonb_build_object('groupId',g.group_id,'revision',p.revision,'name',p.command->>'name','description',p.command->>'description','active',p.command->'active',
    'createdAt',to_char(g.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updatedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if p.snapshot is distinct from expected or p.revision=g.revision and expected is distinct from public.faolla_attendance_group_item_v1(g) then raise exception 'attendance_group_invalid';end if;
  return jsonb_build_object('command',p.command,'item',expected);
end;
$$;
create or replace function public.faolla_attendance_group_checked_v1(g public.merchant_attendance_groups)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare first_op public.merchant_attendance_group_operations%rowtype;last_op public.merchant_attendance_group_operations%rowtype;
begin
  select * into first_op from public.merchant_attendance_group_operations where merchant_id=g.merchant_id and group_id=g.group_id and revision=1;
  select * into last_op from public.merchant_attendance_group_operations where merchant_id=g.merchant_id and group_id=g.group_id order by revision desc limit 1;
  if last_op.revision is distinct from g.revision then raise exception 'attendance_group_invalid';end if;
  perform public.faolla_attendance_group_receipt_v1(first_op,g);perform public.faolla_attendance_group_receipt_v1(last_op,g);
  return public.faolla_attendance_group_item_v1(g);
end;
$$;
create or replace function public.faolla_attendance_group_assignment_item_v1(p public.merchant_attendance_group_assignments)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('assignmentId',p.assignment_id,'groupId',p.group_id,'groupName',p.group_name,'workerId',p.worker_id,'workerName',p.worker_name,'workerNo',p.worker_no,
    'employeeId',p.employee_id,'timeZone',p.time_zone,'startsOn',to_char(p.starts_on,'YYYY-MM-DD'),'endsOn',to_char(p.ends_on,'YYYY-MM-DD'),
    'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updatedAt',to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision',p.revision,'status',p.status);
$$;
create or replace function public.faolla_attendance_group_assignment_detail_v1(p public.merchant_attendance_group_assignments)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare o public.merchant_attendance_group_assignment_operations%rowtype;v public.merchant_attendance_group_assignments%rowtype;
  n integer:=0;item jsonb;history jsonb:='[]';previous_at timestamptz;
begin
  v:=p;v.ends_on:=p.original_ends_on;v.revision:=1;v.status:='assigned';v.updated_at:=p.created_at;
  for o in select * from public.merchant_attendance_group_assignment_operations where merchant_id=p.merchant_id and assignment_id=p.assignment_id order by revision limit 4 loop
    n:=n+1;
    if n>3 or o.revision<>n or not public.faolla_attendance_group_command_v1(o.command) or o.command->>'action'<>o.action
      or o.command->>'operationId'<>o.operation_id::text or o.recorded_at<p.created_at or o.recorded_at<previous_at
      or exists(select 1 from public.merchant_attendance_group_operations where merchant_id=o.merchant_id and operation_id=o.operation_id) then raise exception 'attendance_group_invalid';end if;
    if n=1 then
      if o.action<>'assign' or o.operation_id<>p.assignment_id or o.actor_auth_user_id<>p.actor_auth_user_id or o.recorded_at<>p.created_at
        or o.command->>'groupId'<>p.group_id::text or o.command->>'workerId'<>p.worker_id::text
        or o.command->'expectedGroupRevision' is distinct from to_jsonb(p.group_revision) or o.command->'expectedWorkerVersion' is distinct from to_jsonb(p.worker_version)
        or o.command->'expectedSettingsVersion' is distinct from to_jsonb(p.settings_version) or o.command->>'timeZone'<>p.time_zone
        or o.command->>'startsOn'<>to_char(p.starts_on,'YYYY-MM-DD') or o.command->'endsOn' is distinct from coalesce(to_jsonb(to_char(p.original_ends_on,'YYYY-MM-DD')),'null'::jsonb) then
        raise exception 'attendance_group_invalid';end if;
    else
      if o.command->>'assignmentId'<>p.assignment_id::text or o.command->'expectedRevision' is distinct from to_jsonb(n-1) or v.status='cancelled' then raise exception 'attendance_group_invalid';end if;
      if o.action='end' then
        if n<>2 or v.ends_on is not null or not public.faolla_attendance_group_date_v1(o.command->>'endsOn',p.time_zone)
          or (o.command->>'endsOn')::date<p.starts_on then raise exception 'attendance_group_invalid';end if;
        v.ends_on:=(o.command->>'endsOn')::date;v.status:='ended';
      elsif o.action='cancel' then v.status:='cancelled';else raise exception 'attendance_group_invalid';end if;
      v.revision:=n;v.updated_at:=o.recorded_at;
    end if;
    item:=public.faolla_attendance_group_assignment_item_v1(v);
    if o.snapshot is distinct from item then raise exception 'attendance_group_invalid';end if;
    history:=history||jsonb_build_array(jsonb_build_object('command',o.command,'item',item));previous_at:=o.recorded_at;
  end loop;
  if n<>p.revision or item is null or item is distinct from public.faolla_attendance_group_assignment_item_v1(p) then raise exception 'attendance_group_invalid';end if;
  return item||jsonb_build_object('history',history,'canEnd',p.status='assigned' and p.ends_on is null,'canCancel',p.status<>'cancelled');
end;
$$;

create or replace function public.faolla_attendance_groups_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;view_name text;gid uuid;wid uuid;aid uuid;op uuid;cursor_id uuid;on_day date;k text;action_name text;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;w public.merchant_attendance_workers%rowtype;
  target public.merchant_attendance_group_assignments%rowtype;gc public.merchant_attendance_groups%rowtype;ac public.merchant_attendance_group_assignments%rowtype;
  go public.merchant_attendance_group_operations%rowtype;ao public.merchant_attendance_group_assignment_operations%rowtype;
  group_item jsonb;worker_item jsonb;detail jsonb;receipt jsonb;items jsonb:='[]';next_cursor uuid;rows_seen integer:=0;result jsonb;stamp timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['siteId','view','groupId','workerId','onDate','assignmentId','operationId','cursorId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'view')<>'string' or coalesce(p_query->>'view','') not in('groups','members','context') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';view_name:=p_query->>'view';
  foreach k in array array['groupId','workerId','assignmentId','operationId','cursorId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'onDate'<>'null'::jsonb and (jsonb_typeof(p_query->'onDate')<>'string' or not public.faolla_attendance_group_date_v1(p_query->>'onDate')) then raise exception 'attendance_invalid_request';end if;
  gid:=(p_query->>'groupId')::uuid;wid:=(p_query->>'workerId')::uuid;aid:=(p_query->>'assignmentId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'cursorId')::uuid;on_day:=(p_query->>'onDate')::date;
  if view_name='groups' and (gid is not null or wid is not null or aid is not null or op is not null or on_day is not null)
    or view_name='members' and (gid is null and wid is null or aid is not null or op is not null)
    or view_name='context' and (on_day is not null or cursor_id is not null or aid is not null and (gid is null or wid is null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if view_name<>'context' or op is not null or not public.faolla_attendance_group_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if action_name='save_group' then
      if wid is not null or aid is not null or (p_command->'expectedRevision'='0'::jsonb and gid is not null)
        or (p_command->'expectedRevision'<>'0'::jsonb and gid is distinct from (p_command->>'groupId')::uuid) then raise exception 'attendance_invalid_request';end if;
    elsif action_name='assign' then
      if gid is distinct from (p_command->>'groupId')::uuid or wid is distinct from (p_command->>'workerId')::uuid or aid is not null then raise exception 'attendance_invalid_request';end if;
    elsif gid is null or wid is null or aid is distinct from (p_command->>'assignmentId')::uuid then raise exception 'attendance_invalid_request';end if;
  end if;

  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
  -- One operation namespace across both ledgers, serialized by the settings lock.
  if op is not null then
    select * into go from public.merchant_attendance_group_operations where merchant_id=site and operation_id=op;
    select * into ao from public.merchant_attendance_group_assignment_operations where merchant_id=site and operation_id=op;
    if go.operation_id is not null and ao.operation_id is not null then raise exception 'attendance_group_invalid';end if;
    if go.operation_id is not null then
      if go.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;go:=null;
      else
        if p_command is not null and go.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if wid is not null or aid is not null or gid is not null and gid<>go.group_id
          or gid is null and go.revision<>1 then raise exception 'attendance_group_not_found';end if;
        gid:=go.group_id;
      end if;
    elsif ao.operation_id is not null then
      if ao.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;ao:=null;
      else
        if p_command is not null and ao.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if gid is null or wid is null or aid is not null and aid<>ao.assignment_id then raise exception 'attendance_group_not_found';end if;
        aid:=ao.assignment_id;
      end if;
    end if;
  end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    group_item:=public.faolla_attendance_group_checked_v1(g);
  end if;
  if wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    if w.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
    if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_group_invalid';end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'version',w.version,'active',w.active);
  end if;
  if aid is not null then
    select * into target from public.merchant_attendance_group_assignments where merchant_id=site and assignment_id=aid;
    if target.assignment_id is null or target.group_id is distinct from gid or target.worker_id is distinct from wid then raise exception 'attendance_group_not_found';end if;
    detail:=public.faolla_attendance_group_assignment_detail_v1(target);
  end if;
  if go.operation_id is not null then receipt:=public.faolla_attendance_group_receipt_v1(go,g);
  elsif ao.operation_id is not null then receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);end if;

  -- Current ownership always precedes replay; current activity, pause and CAS do not invalidate a confirmed original command.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    stamp:=clock_timestamp();
    if action_name='save_group' then
      if p_command->'expectedRevision'='0'::jsonb then
        if exists(select 1 from public.merchant_attendance_groups where merchant_id=site and group_id=(p_command->>'groupId')::uuid) then raise exception 'attendance_operation_conflict';end if;
        insert into public.merchant_attendance_groups(merchant_id,group_id,revision,name,description,active,created_at,updated_at,actor_auth_user_id)
          values(site,(p_command->>'groupId')::uuid,1,p_command->>'name',p_command->>'description',(p_command->>'active')::boolean,stamp,stamp,p_auth_user_id) returning * into g;
      else
        if g.revision<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
        update public.merchant_attendance_groups set revision=revision+1,name=p_command->>'name',description=p_command->>'description',active=(p_command->>'active')::boolean,updated_at=stamp
          where merchant_id=site and group_id=gid returning * into g;
      end if;
      group_item:=public.faolla_attendance_group_item_v1(g);
      insert into public.merchant_attendance_group_operations(merchant_id,operation_id,group_id,revision,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,g.group_id,g.revision,p_auth_user_id,p_command,group_item,stamp) returning * into go;
      receipt:=public.faolla_attendance_group_receipt_v1(go,g);
    else
      if action_name='assign' then
        if not g.active then raise exception 'attendance_group_inactive';end if;
        if not w.active then raise exception 'attendance_group_worker_inactive';end if;
        if (p_command->>'expectedGroupRevision')::bigint<>g.revision or (p_command->>'expectedWorkerVersion')::bigint<>w.version
          or (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        if exists(select 1 from public.merchant_attendance_group_assignments x where x.merchant_id=site and x.worker_id=wid and x.status<>'cancelled'
          and (x.ends_on is null or x.ends_on>=(p_command->>'startsOn')::date)
          and (p_command->'endsOn'='null'::jsonb or x.starts_on<=(p_command->>'endsOn')::date)) then raise exception 'attendance_group_overlap';end if;
        insert into public.merchant_attendance_group_assignments(merchant_id,assignment_id,group_id,group_name,worker_id,worker_name,worker_no,employee_id,
          group_revision,worker_version,settings_version,time_zone,starts_on,original_ends_on,ends_on,revision,status,created_at,updated_at,actor_auth_user_id)
          values(site,op,gid,g.name,wid,w.display_name,w.worker_no,w.employee_id,g.revision,w.version,s.version,s.time_zone,
            (p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'endsOn')::date,1,'assigned',stamp,stamp,p_auth_user_id) returning * into target;
      else
        if target.status='cancelled' or action_name='end' and (target.status<>'assigned' or target.ends_on is not null) then raise exception 'attendance_group_closed';end if;
        if target.revision<>(p_command->>'expectedRevision')::integer then raise exception 'attendance_version_conflict';end if;
        if action_name='end' and ((p_command->>'endsOn')::date<target.starts_on or not public.faolla_attendance_group_date_v1(p_command->>'endsOn',target.time_zone)) then raise exception 'attendance_invalid_request';end if;
        update public.merchant_attendance_group_assignments set revision=revision+1,status=case when action_name='end' then 'ended' else 'cancelled' end,
          ends_on=case when action_name='end' then (p_command->>'endsOn')::date else ends_on end,updated_at=stamp where merchant_id=site and assignment_id=aid returning * into target;
      end if;
      insert into public.merchant_attendance_group_assignment_operations(merchant_id,operation_id,assignment_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,target.assignment_id,target.revision,action_name,p_auth_user_id,p_command,public.faolla_attendance_group_assignment_item_v1(target),stamp) returning * into ao;
      detail:=public.faolla_attendance_group_assignment_detail_v1(target);receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);
    end if;
  end if;
  if view_name='groups' then
    for gc in select * from public.merchant_attendance_groups where merchant_id=site and (cursor_id is null or group_id<cursor_id) order by group_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_group_checked_v1(gc));next_cursor:=gc.group_id;
    end loop;
  elsif view_name='members' then
    for ac in select * from public.merchant_attendance_group_assignments x where x.merchant_id=site and (gid is null or x.group_id=gid) and (wid is null or x.worker_id=wid)
      and (on_day is null or x.starts_on<=on_day and (x.ends_on is null or x.ends_on>=on_day)) and (cursor_id is null or x.assignment_id<cursor_id) order by x.assignment_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      perform public.faolla_attendance_group_assignment_detail_v1(ac);items:=items||jsonb_build_array(public.faolla_attendance_group_assignment_item_v1(ac));next_cursor:=ac.assignment_id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','groups-v1','siteId',site,'actorId',p_auth_user_id,'settingsVersion',s.version,'timeZone',s.time_zone,'view',view_name,
    'group',group_item,'worker',worker_item,'items',items,'nextCursor',case when rows_seen=26 then next_cursor else null end,'detail',detail,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_group_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
do $groups_acl$
declare p regprocedure;
begin
  foreach p in array array[
    'public.faolla_attendance_group_text_v1(text,integer,integer)'::regprocedure,'public.faolla_attendance_group_date_v1(text,text)'::regprocedure,
    'public.faolla_attendance_group_command_v1(jsonb)'::regprocedure,'public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)'::regprocedure,
    'public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)'::regprocedure,
    'public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)'::regprocedure,
    'public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)'::regprocedure,
    'public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)'::regprocedure,
    'public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
  end loop;
end;
$groups_acl$;
grant execute on function public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610030124,'merchant_attendance_groups') on conflict(version) do nothing;
do $groups_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups') then raise exception 'merchant_attendance_groups_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then raise exception 'merchant_attendance_groups_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_groups'::regclass,'public.merchant_attendance_group_operations'::regclass,
    'public.merchant_attendance_group_assignments'::regclass,'public.merchant_attendance_group_assignment_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_groups_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_groups_acl_postcondition_failed';end if;
    end loop;
  end loop;
  for p in select oid::regprocedure from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_groups'::regclass)
    and proname in('faolla_attendance_group_text_v1','faolla_attendance_group_date_v1','faolla_attendance_group_command_v1','faolla_attendance_group_item_v1',
      'faolla_attendance_group_receipt_v1','faolla_attendance_group_checked_v1','faolla_attendance_group_assignment_item_v1','faolla_attendance_group_assignment_detail_v1') loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_groups_acl_postcondition_failed';end if;
    end loop;
  end loop;
end;
$groups_postconditions$;
notify pgrst, 'reload schema';
commit;
