-- Independent owner policy-candidate ledger only. Nothing here applies rules to
-- punches, schedules, reports, memberships, payroll or existing settings values.
begin;
set local lock_timeout='3s';
do $rules_prerequisites$
declare installed boolean;t text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_attendance_groups') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null
    or to_regprocedure('public.faolla_attendance_valid_zone_v1(text)') is null
    or to_regprocedure('public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)') is null then
    raise exception 'merchant_attendance_rule_versions_prerequisite_required';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609290064 and name='merchant_attendance_owner_configuration')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups') then
    raise exception 'merchant_attendance_rule_versions_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040127 and name='merchant_attendance_rule_versions') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040127 and name<>'merchant_attendance_rule_versions') then
    raise exception 'merchant_attendance_rule_versions_installation_conflict';end if;
  foreach t in array array['merchant_attendance_rule_streams','merchant_attendance_rule_operations'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_rule_versions_installation_conflict';end if;
  end loop;
  if installed<>(to_regprocedure('public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)') is not null) then
    raise exception 'merchant_attendance_rule_versions_installation_conflict';end if;
end;
$rules_prerequisites$;

create or replace function public.faolla_attendance_rule_values_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;v jsonb;n integer;lo integer;hi integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes']) then return false;end if;
  if (select count(*) from jsonb_object_keys(p))<>4 then return false;end if;
  foreach k in array array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'] loop
    v:=p->k;
    if jsonb_typeof(v)<>'object' or not(v ? 'mode') or jsonb_typeof(v->'mode')<>'string' then return false;end if;
    select count(*) into n from jsonb_object_keys(v);
    if v->>'mode' in('inherit','disabled') then
      if n<>1 then return false;end if;
    elsif v->>'mode'='value' then
      lo:=case when k in('lateGraceMinutes','earlyGraceMinutes') then 0 else 1 end;
      hi:=case when k='openSpanWarningMinutes' then 44640 else 1440 end;
      if n<>2 or not(v ? 'minutes') or jsonb_typeof(v->'minutes')<>'number' or coalesce(v->>'minutes','') !~ '^(0|[1-9][0-9]{0,4})$'
        or (v->>'minutes')::numeric not between lo and hi then return false;end if;
    else return false;end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Identical lower-bound algorithm to attendanceDayUtcRange: PostgreSQL's direct
-- local-midnight cast selects the wrong occurrence at some ambiguous midnights.
-- A skipped local date has no lower bound on that date and returns NULL.
create or replace function public.faolla_attendance_rule_day_start_v1(p text,z text)
returns timestamptz language plpgsql stable set search_path=pg_catalog as $$
declare d date;lo bigint;hi bigint;middle bigint;instant timestamptz;epoch constant timestamptz:='1970-01-01 00:00:00+00';
begin
  if not public.faolla_attendance_group_date_v1(p) or not public.faolla_attendance_valid_zone_v1(z) then return null;end if;
  d:=p::date;lo:=(extract(epoch from (d::timestamp at time zone 'UTC'))*1000)::bigint-129600000;hi:=lo+259200000;
  while lo<hi loop
    middle:=lo+(hi-lo)/2;
    instant:=epoch+(middle/1000)*interval '1 second'+(middle%1000)*interval '1 millisecond';
    if (instant at time zone z)::date<d then lo:=middle+1;else hi:=middle;end if;
  end loop;
  instant:=epoch+(lo/1000)*interval '1 second'+(lo%1000)*interval '1 millisecond';
  if (instant at time zone z)::date<>d then return null;end if;
  return instant;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then return null;
end;
$$;

create or replace function public.faolla_attendance_rule_command_v1(p jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare a text;k text;n integer;
begin
  if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['operationId','action','expectedRevision','reason'])
    or jsonb_typeof(p->'operationId')<>'string' or coalesce(p->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'action')<>'string' or jsonb_typeof(p->'reason')<>'string' or not public.faolla_attendance_group_text_v1(p->>'reason',1,200)
    or jsonb_typeof(p->'expectedRevision')<>'number' or coalesce(p->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
    or (p->>'expectedRevision')::numeric>9007199254740989 then return false;end if;
  a:=p->>'action';select count(*) into n from jsonb_object_keys(p);
  if a in('save_draft','publish') then
    if n<>8 or not(p ?& array['expectedSettingsVersion','expectedGroupRevision','timeZone'])
      or jsonb_typeof(p->'expectedSettingsVersion')<>'number' or coalesce(p->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$'
      or (p->>'expectedSettingsVersion')::numeric>9007199254740990
      or p->'expectedGroupRevision'<>'null'::jsonb and (jsonb_typeof(p->'expectedGroupRevision')<>'number'
        or coalesce(p->>'expectedGroupRevision','') !~ '^[1-9][0-9]{0,15}$' or (p->>'expectedGroupRevision')::numeric>9007199254740990)
      or jsonb_typeof(p->'timeZone')<>'string' or not public.faolla_attendance_valid_zone_v1(p->>'timeZone') then return false;end if;
    if a='save_draft' then
      if not(p ? 'rules') or not public.faolla_attendance_rule_values_v1(p->'rules') then return false;end if;
    else
      if not(p ? 'effectiveOn') or jsonb_typeof(p->'effectiveOn')<>'string'
        or not public.faolla_attendance_group_date_v1(p->>'effectiveOn') then return false;end if;
    end if;
  elsif a='withdraw' then
    if n<>5 or not(p ? 'publishedRevision') or jsonb_typeof(p->'publishedRevision')<>'number'
      or coalesce(p->>'publishedRevision','') !~ '^[1-9][0-9]{0,15}$' or (p->>'publishedRevision')::numeric>9007199254740990
      or (p->>'publishedRevision')::numeric>(p->>'expectedRevision')::numeric then return false;end if;
  else return false;end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then return false;
end;
$$;

create table if not exists public.merchant_attendance_rule_streams (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),stream_key text not null,group_id uuid null,
  revision bigint not null check(revision between 1 and 9007199254740990),draft_revision bigint null,
  draft_action text not null default 'save_draft' check(draft_action='save_draft'),
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(merchant_id,stream_key),foreign key(merchant_id,group_id) references public.merchant_attendance_groups(merchant_id,group_id),
  check(stream_key=coalesce(group_id::text,'enterprise')),check(draft_revision is null or draft_revision between 1 and revision),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create table if not exists public.merchant_attendance_rule_operations (
  merchant_id text not null,stream_key text not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  action text not null check(action in('save_draft','publish','withdraw')),actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,
  recorded_at timestamptz not null check(isfinite(recorded_at)),settings_version bigint null,group_revision bigint null,time_zone text null,rules jsonb null,
  effective_on date null,effective_at timestamptz null,published_revision bigint null,source_draft_revision bigint null,draft_revision_after bigint null,
  draft_action text not null default 'save_draft' check(draft_action='save_draft'),published_action text not null default 'publish' check(published_action='publish'),
  primary key(merchant_id,operation_id),unique(merchant_id,stream_key,revision),unique(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key) references public.merchant_attendance_rule_streams(merchant_id,stream_key),
  foreign key(merchant_id,stream_key,source_draft_revision,draft_action) references public.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key,published_revision,published_action) references public.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action),
  foreign key(merchant_id,stream_key,draft_revision_after,draft_action) references public.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action) deferrable initially deferred,
  check(public.faolla_attendance_rule_command_v1(command)),check(jsonb_typeof(snapshot)='object'),
  check(command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
  check(group_revision is null or group_revision between 1 and 9007199254740990),
  check((action in('save_draft','publish') and settings_version between 1 and 9007199254740990 and settings_version is not null
      and time_zone is not null and public.faolla_attendance_valid_zone_v1(time_zone) and rules is not null and public.faolla_attendance_rule_values_v1(rules)
      and ((stream_key='enterprise' and group_revision is null) or (stream_key<>'enterprise' and group_revision is not null)) and published_revision is null)
    or (action='withdraw' and settings_version is null and group_revision is null and time_zone is null and rules is null and published_revision is not null and published_revision<revision)),
  check((action='publish' and effective_on is not null and effective_on between date '2000-01-01' and date '2100-12-31'
      and effective_at is not null and isfinite(effective_at) and effective_at>recorded_at and source_draft_revision is not null and source_draft_revision<revision and draft_revision_after is null)
    or (action<>'publish' and effective_on is null and effective_at is null and source_draft_revision is null)),
  check(action<>'save_draft' or draft_revision_after is not null and draft_revision_after=revision),
  check(draft_revision_after is null or draft_revision_after between 1 and revision),check(revision<>1 or action='save_draft')
);
create index if not exists attendance_rule_operations_history_idx on public.merchant_attendance_rule_operations(merchant_id,stream_key,revision desc);
create index if not exists attendance_rule_publications_idx on public.merchant_attendance_rule_operations(merchant_id,stream_key,effective_at desc) where action='publish';
create unique index if not exists attendance_rule_withdrawals_idx on public.merchant_attendance_rule_operations(merchant_id,stream_key,published_revision) where action='withdraw';
do $rules_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_rule_streams'::regclass and conname='attendance_rule_head_receipt_fk') then
    alter table public.merchant_attendance_rule_streams add constraint attendance_rule_head_receipt_fk foreign key(merchant_id,stream_key,revision)
      references public.merchant_attendance_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred;end if;
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_rule_streams'::regclass and conname='attendance_rule_draft_receipt_fk') then
    alter table public.merchant_attendance_rule_streams add constraint attendance_rule_draft_receipt_fk foreign key(merchant_id,stream_key,draft_revision,draft_action)
      references public.merchant_attendance_rule_operations(merchant_id,stream_key,revision,action) deferrable initially deferred;end if;
end;
$rules_constraints$;
alter table public.merchant_attendance_rule_streams enable row level security;
alter table public.merchant_attendance_rule_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_rule_operations'::regclass,
      'public.merchant_attendance_rule_streams'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_rule_streams,public.merchant_attendance_rule_operations from public,anon,authenticated,service_role;
do $rules_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_rule_operations'::regclass and tgname='merchant_attendance_rule_operations_immutable') then
    create trigger merchant_attendance_rule_operations_immutable before update or delete on public.merchant_attendance_rule_operations
      for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_rule_operations'::regclass and tgname='merchant_attendance_rule_operations_no_truncate') then
    create trigger merchant_attendance_rule_operations_no_truncate before truncate on public.merchant_attendance_rule_operations
      for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$rules_triggers$;

create or replace function public.faolla_attendance_rule_item_v1(p public.merchant_attendance_rule_operations)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('revision',p.revision,'operationId',p.operation_id,'actorId',p.actor_auth_user_id,'action',p.action,'reason',p.command->>'reason',
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'settingsVersion',p.settings_version,'groupRevision',p.group_revision,'timeZone',p.time_zone,'rules',p.rules,
    'effectiveOn',to_char(p.effective_on,'YYYY-MM-DD'),'effectiveAt',to_char(p.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'publishedRevision',p.published_revision);
$$;

-- Constant-depth receipt validation: predecessor, saved source and withdrawal
-- target are indexed point reads. Never recursively replay the entire history.
create or replace function public.faolla_attendance_rule_receipt_v1(p public.merchant_attendance_rule_operations)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare previous public.merchant_attendance_rule_operations%rowtype;source public.merchant_attendance_rule_operations%rowtype;
  target public.merchant_attendance_rule_operations%rowtype;expected jsonb;
begin
  if p.operation_id is null or not public.faolla_attendance_rule_command_v1(p.command)
    or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.action
    or (p.command->>'expectedRevision')::bigint is distinct from p.revision-1 then raise exception 'attendance_rule_invalid';end if;
  expected:=public.faolla_attendance_rule_item_v1(p);
  if p.snapshot is distinct from expected then raise exception 'attendance_rule_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at or not public.faolla_attendance_rule_command_v1(previous.command)
      or previous.snapshot is distinct from public.faolla_attendance_rule_item_v1(previous) then raise exception 'attendance_rule_invalid';end if;
  elsif p.action<>'save_draft' then raise exception 'attendance_rule_invalid';end if;
  if p.action in('save_draft','publish') then
    if p.command->'expectedSettingsVersion' is distinct from to_jsonb(p.settings_version)
      or p.command->'expectedGroupRevision' is distinct from coalesce(to_jsonb(p.group_revision),'null'::jsonb)
      or p.command->>'timeZone' is distinct from p.time_zone then raise exception 'attendance_rule_invalid';end if;
    if p.action='save_draft' then
      if p.rules is distinct from p.command->'rules' or p.draft_revision_after is distinct from p.revision then raise exception 'attendance_rule_invalid';end if;
    else
      select * into source from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=p.source_draft_revision;
      if source.operation_id is null or source.action<>'save_draft' or previous.draft_revision_after is distinct from source.revision
        or source.snapshot is distinct from public.faolla_attendance_rule_item_v1(source) or not public.faolla_attendance_rule_command_v1(source.command)
        or source.rules is distinct from source.command->'rules'
        or source.command->'expectedSettingsVersion' is distinct from to_jsonb(source.settings_version)
        or source.command->'expectedGroupRevision' is distinct from coalesce(to_jsonb(source.group_revision),'null'::jsonb)
        or source.command->>'timeZone' is distinct from source.time_zone or source.settings_version is distinct from p.settings_version
        or source.group_revision is distinct from p.group_revision or source.time_zone is distinct from p.time_zone or source.rules is distinct from p.rules
        or p.command->>'effectiveOn' is distinct from to_char(p.effective_on,'YYYY-MM-DD')
        or p.effective_at is distinct from public.faolla_attendance_rule_day_start_v1(p.command->>'effectiveOn',p.time_zone)
        or p.effective_on<=(p.recorded_at at time zone p.time_zone)::date then raise exception 'attendance_rule_invalid';end if;
    end if;
  elsif p.action='withdraw' then
    select * into target from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=p.published_revision;
    if target.operation_id is null or target.action<>'publish' or target.revision>=p.revision or p.recorded_at>=target.effective_at
      or target.snapshot is distinct from public.faolla_attendance_rule_item_v1(target) or not public.faolla_attendance_rule_command_v1(target.command)
      or p.command->'publishedRevision' is distinct from to_jsonb(p.published_revision)
      or p.draft_revision_after is distinct from previous.draft_revision_after then raise exception 'attendance_rule_invalid';end if;
  else raise exception 'attendance_rule_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'command',p.command,'item',expected);
end;
$$;

create or replace function public.faolla_attendance_rule_stream_checked_v1(p public.merchant_attendance_rule_streams)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare first_op public.merchant_attendance_rule_operations%rowtype;last_op public.merchant_attendance_rule_operations%rowtype;
  draft_op public.merchant_attendance_rule_operations%rowtype;
begin
  select * into first_op from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=1;
  select * into last_op from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=p.revision;
  if first_op.operation_id is null or last_op.operation_id is null or first_op.recorded_at<>p.created_at or last_op.recorded_at<>p.updated_at
    or last_op.draft_revision_after is distinct from p.draft_revision
    or exists(select 1 from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision>p.revision) then
    raise exception 'attendance_rule_invalid';end if;
  perform public.faolla_attendance_rule_receipt_v1(first_op);perform public.faolla_attendance_rule_receipt_v1(last_op);
  if p.draft_revision is null then return null;end if;
  select * into draft_op from public.merchant_attendance_rule_operations where merchant_id=p.merchant_id and stream_key=p.stream_key and revision=p.draft_revision;
  if draft_op.operation_id is null or draft_op.action<>'save_draft' then raise exception 'attendance_rule_invalid';end if;
  perform public.faolla_attendance_rule_receipt_v1(draft_op);
  return jsonb_build_object('revision',draft_op.revision,'settingsVersion',draft_op.settings_version,'groupRevision',draft_op.group_revision,'timeZone',draft_op.time_zone,'rules',draft_op.rules);
end;
$$;

create or replace function public.faolla_attendance_rules_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;key text;gid uuid;op uuid;before_rev bigint;k text;action_name text;current_rev bigint:=0;new_rev bigint;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;stream public.merchant_attendance_rule_streams%rowtype;
  existing public.merchant_attendance_rule_operations%rowtype;entry public.merchant_attendance_rule_operations%rowtype;
  saved public.merchant_attendance_rule_operations%rowtype;target public.merchant_attendance_rule_operations%rowtype;withdrawal public.merchant_attendance_rule_operations%rowtype;
  group_item jsonb;draft_item jsonb;receipt jsonb;items jsonb:='[]';result jsonb;stamp timestamptz;boundary timestamptz;today date;
  count_seen integer:=0;next_before bigint;withdrawn_by bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','groupId','operationId','beforeRevision'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$' then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['groupId','operationId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision')<>'number'
    or coalesce(p_query->>'beforeRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740990) then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';gid:=(p_query->>'groupId')::uuid;key:=coalesce(gid::text,'enterprise');op:=(p_query->>'operationId')::uuid;before_rev:=(p_query->>'beforeRevision')::bigint;
  if op is not null and before_rev is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if op is not null or before_rev is not null or not public.faolla_attendance_rule_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    if p_command->>'action'<>'withdraw' and ((gid is null)<>(p_command->'expectedGroupRevision'='null'::jsonb)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;

  -- Reauthorize under the same lock order as owner configuration and group124.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version not between 1 and 9007199254740990 or not public.faolla_attendance_valid_zone_v1(s.time_zone) then raise exception 'attendance_rule_invalid';end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    perform public.faolla_attendance_group_checked_v1(g);
    group_item:=jsonb_build_object('groupId',g.group_id,'revision',g.revision,'name',g.name,'active',g.active);
  end if;
  select * into stream from public.merchant_attendance_rule_streams where merchant_id=site and stream_key=key;
  if found then current_rev:=stream.revision;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);end if;
  if op is not null then
    select * into existing from public.merchant_attendance_rule_operations where merchant_id=site and operation_id=op;
    if existing.operation_id is not null then
      if existing.stream_key<>key or existing.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and existing.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if existing.revision>current_rev then raise exception 'attendance_rule_invalid';end if;
      receipt:=public.faolla_attendance_rule_receipt_v1(existing);
    end if;
  end if;

  -- Pause/activity/context/CAS eligibility applies only to a NEW operation.
  -- An exact original command remains confirmable by the CURRENT owner.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_version_conflict';end if;
    new_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
      if gid is not null and not g.active then raise exception 'attendance_rule_group_inactive';end if;
      if (p_command->>'expectedSettingsVersion')::bigint<>s.version or (p_command->>'expectedGroupRevision')::bigint is distinct from g.revision
        or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
      if action_name='publish' then
        if stream.draft_revision is null then raise exception 'attendance_rule_draft_required';end if;
        select * into saved from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=stream.draft_revision;
        if saved.settings_version<>s.version or saved.group_revision is distinct from g.revision or saved.time_zone<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        boundary:=public.faolla_attendance_rule_day_start_v1(p_command->>'effectiveOn',s.time_zone);
        if boundary is null then raise exception 'attendance_rule_future_required';end if;
        if exists(select 1 from public.merchant_attendance_rule_operations pub where pub.merchant_id=site and pub.stream_key=key and pub.action='publish'
          and pub.effective_at>=boundary and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=pub.merchant_id and wd.stream_key=pub.stream_key and wd.action='withdraw' and wd.published_revision=pub.revision)) then
          raise exception 'attendance_rule_order_conflict';end if;
      end if;
    else
      select * into target from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and revision=(p_command->>'publishedRevision')::bigint and action='publish';
      if not found then raise exception 'attendance_not_available';end if;
      perform public.faolla_attendance_rule_receipt_v1(target);
      if exists(select 1 from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=target.revision) then
        raise exception 'attendance_rule_already_withdrawn';end if;
    end if;
    -- Never use transaction-start now(): settings/group locks can have waited.
    stamp:=clock_timestamp();
    if stream.updated_at is not null and stamp<stream.updated_at then raise exception 'attendance_rule_invalid';end if;
    if action_name='publish' then
      today:=(stamp at time zone s.time_zone)::date;
      if today not between date '2000-01-01' and date '2100-12-31' or (p_command->>'effectiveOn')::date<=today or boundary<=stamp then raise exception 'attendance_rule_future_required';end if;
    elsif action_name='withdraw' and stamp>=target.effective_at then raise exception 'attendance_rule_future_required';end if;

    entry.merchant_id:=site;entry.stream_key:=key;entry.operation_id:=op;entry.revision:=new_rev;entry.action:=action_name;entry.actor_auth_user_id:=p_auth_user_id;
    entry.command:=p_command;entry.recorded_at:=stamp;entry.draft_action:='save_draft';entry.published_action:='publish';
    if action_name in('save_draft','publish') then
      entry.settings_version:=s.version;entry.group_revision:=g.revision;entry.time_zone:=s.time_zone;
      if action_name='save_draft' then entry.rules:=p_command->'rules';entry.draft_revision_after:=new_rev;
      else entry.rules:=saved.rules;entry.effective_on:=(p_command->>'effectiveOn')::date;entry.effective_at:=boundary;entry.source_draft_revision:=saved.revision;end if;
    else entry.published_revision:=target.revision;entry.draft_revision_after:=stream.draft_revision;end if;
    entry.snapshot:=public.faolla_attendance_rule_item_v1(entry);
    if current_rev=0 then
      insert into public.merchant_attendance_rule_streams(merchant_id,stream_key,group_id,revision,draft_revision,created_at,updated_at)
        values(site,key,gid,new_rev,entry.draft_revision_after,stamp,stamp) returning * into stream;
    else
      update public.merchant_attendance_rule_streams set revision=new_rev,draft_revision=entry.draft_revision_after,updated_at=stamp
        where merchant_id=site and stream_key=key returning * into stream;
    end if;
    insert into public.merchant_attendance_rule_operations select entry.*;
    current_rev:=new_rev;draft_item:=public.faolla_attendance_rule_stream_checked_v1(stream);receipt:=public.faolla_attendance_rule_receipt_v1(entry);
  end if;

  for entry in select * from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key
    and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
    count_seen:=count_seen+1;exit when count_seen=26;
    perform public.faolla_attendance_rule_receipt_v1(entry);withdrawn_by:=null;
    if entry.action='publish' then
      select * into withdrawal from public.merchant_attendance_rule_operations where merchant_id=site and stream_key=key and action='withdraw' and published_revision=entry.revision;
      if found then perform public.faolla_attendance_rule_receipt_v1(withdrawal);withdrawn_by:=withdrawal.revision;end if;
    end if;
    items:=items||jsonb_build_array(entry.snapshot||jsonb_build_object('withdrawnByRevision',withdrawn_by));next_before:=entry.revision;
  end loop;
  result:=jsonb_build_object('protocol','rules-v1','siteId',site,'actorId',p_auth_user_id,'group',group_item,'settingsVersion',s.version,'timeZone',s.time_zone,
    'revision',current_rev,'draft',draft_item,'items',items,'nextBeforeRevision',case when count_seen=26 then next_before else null end,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;

do $rules_acl$
declare p regprocedure;
begin
  foreach p in array array['public.faolla_attendance_rule_values_v1(jsonb)'::regprocedure,'public.faolla_attendance_rule_day_start_v1(text,text)'::regprocedure,
    'public.faolla_attendance_rule_command_v1(jsonb)'::regprocedure,'public.faolla_attendance_rule_item_v1(public.merchant_attendance_rule_operations)'::regprocedure,
    'public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)'::regprocedure,
    'public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)'::regprocedure,'public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
  end loop;
end;
$rules_acl$;
grant execute on function public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040127,'merchant_attendance_rule_versions') on conflict(version) do nothing;
do $rules_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040127 and name='merchant_attendance_rule_versions') then
    raise exception 'merchant_attendance_rule_versions_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_rules_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'merchant_attendance_rule_versions_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_rule_streams'::regclass,'public.merchant_attendance_rule_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_rule_versions_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_rule_versions_acl_postcondition_failed';end if;
    end loop;
  end loop;
  for p in select oid::regprocedure from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_rule_streams'::regclass)
    and proname in('faolla_attendance_rule_values_v1','faolla_attendance_rule_day_start_v1','faolla_attendance_rule_command_v1',
      'faolla_attendance_rule_item_v1','faolla_attendance_rule_receipt_v1','faolla_attendance_rule_stream_checked_v1') loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_rule_versions_acl_postcondition_failed';end if;
    end loop;
  end loop;
end;
$rules_postconditions$;
notify pgrst, 'reload schema';
commit;
