-- Unreleased owner setup. No backfill, implicit publication or employee ACK.
begin;
set local lock_timeout='3s';
alter table public.merchant_attendance_settings add column location_channel_version bigint not null default 1
  check(location_channel_version between 1 and 9007199254740990);
create table public.merchant_attendance_location_setup_operations (
  merchant_id text not null,
  operation_id uuid not null,
  location_id uuid not null,
  actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  before_value jsonb not null check(jsonb_typeof(before_value)='object'),
  after_value jsonb not null check(jsonb_typeof(after_value)='object'),
  recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id) on delete restrict
);
alter table public.merchant_attendance_location_setup_operations enable row level security;
revoke all on public.merchant_attendance_location_setup_operations from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_setup_no_rewrite before update or delete on public.merchant_attendance_location_setup_operations
  for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_setup_no_truncate before truncate on public.merchant_attendance_location_setup_operations
  for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_setup_v1(p_site_id text,p_auth_user_id uuid,p_location_id uuid,
  p_command jsonb default null,p_operation_id uuid default null,p_allow_prepare boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype;s public.merchant_attendance_settings%rowtype;l public.merchant_attendance_locations%rowtype;
  d public.merchant_attendance_location_policy_drafts%rowtype;pd public.merchant_attendance_location_policy_drafts%rowtype;
  n public.merchant_attendance_location_notices%rowtype;receipt public.merchant_attendance_location_setup_operations%rowtype;
  op uuid;act text;k text;before_json jsonb;after_json jsonb;fence jsonb;notice_matches boolean;dirty boolean;can_prepare boolean;can_enable boolean;open_web_shift boolean;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_location_id is null or p_allow_prepare is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request';end if;
    if (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array['action','operationId','expectedSettingsVersion','expectedLocationVersion','expectedChannelVersion','draftRevision','reason'])
      or coalesce(p_command->>'action','') not in ('prepare','enable','pause')
      or coalesce(p_command->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 240
      or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    act:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    foreach k in array array['expectedSettingsVersion','expectedLocationVersion','expectedChannelVersion'] loop
      if jsonb_typeof(p_command->k)<>'number' or coalesce(p_command->>k,'') !~ '^[1-9][0-9]{0,15}$' or (p_command->>k)::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;
    end loop;
    if act='prepare' then
      if jsonb_typeof(p_command->'draftRevision')<>'number' or coalesce(p_command->>'draftRevision','') !~ '^[1-9][0-9]{0,15}$'
        or (p_command->>'draftRevision')::numeric>=9007199254740990 then raise exception 'attendance_invalid_request';end if;
    elsif p_command->'draftRevision'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  else op:=p_operation_id;end if;
  select * into m from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if p_command is null then select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=p_location_id for share;
  else select * into l from public.merchant_attendance_locations where merchant_id=p_site_id and id=p_location_id for update;end if;
  if not found then raise exception 'attendance_location_denied';end if;
  select * into d from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=p_location_id order by revision desc limit 1;
  select * into n from public.merchant_attendance_location_notices where merchant_id=p_site_id and location_id=p_location_id order by revision desc limit 1;
  if n.action='publish' then select * into pd from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=p_location_id and revision=n.draft_revision;end if;
  fence:=case when l.radius_meters is null then null else jsonb_build_object('latitude',l.latitude,'longitude',l.longitude,'radiusMeters',l.radius_meters) end;
  notice_matches:=coalesce(l.active and n.action='publish' and (n.command->>'expectedSettingsVersion')::bigint=s.version
    and (n.command->>'expectedLocationVersion')::bigint=l.version and fence is not null
    and (pd.command->'values'->>'latitude')::double precision=l.latitude and (pd.command->'values'->>'longitude')::double precision=l.longitude
    and (pd.command->'values'->>'radiusMeters')::double precision=l.radius_meters,false);
  dirty:=d.revision is not null and (fence is distinct from jsonb_build_object('latitude',d.command->'values'->'latitude','longitude',d.command->'values'->'longitude','radiusMeters',d.command->'values'->'radiusMeters')
    or (d.command->>'expectedSettingsVersion')::bigint<>s.version or (d.command->>'expectedLocationVersion')::bigint<>l.version);
  -- Basic web shifts have no location summary and cannot use v2 safe-finish.
  -- Hold the same settings lock as every clock write while checking each
  -- worker's indexed last event, so adding a fence cannot strand a new shift.
  -- Include inactive workers and both original/current-default locations.
  select exists(select 1 from public.merchant_attendance_workers w
    cross join lateral(select e.id,e.action,e.location_id from public.merchant_attendance_events e
      where e.merchant_id=p_site_id and e.worker_id=w.id order by e.sequence desc limit 1) last_event
    where w.merchant_id=p_site_id and (last_event.location_id=p_location_id or w.default_location_id=p_location_id)
      and last_event.action<>'clock_out'
      and not exists(select 1 from public.merchant_attendance_location_results lr where lr.event_id=last_event.id)) into open_web_shift;
  can_prepare:=p_allow_prepare and l.active and dirty and not open_web_shift and d.revision<9007199254740990 and l.version<9007199254740990;
  can_enable:=p_allow_prepare and s.enabled and s.web_clock_enabled and not s.location_clock_enabled and notice_matches and s.location_channel_version<9007199254740990;
  select * into receipt from public.merchant_attendance_location_setup_operations where merchant_id=p_site_id and operation_id=op;
  if receipt.operation_id is not null and (receipt.location_id<>p_location_id or receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  if p_command is not null then
    if receipt.operation_id is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if act<>'pause' and not p_allow_prepare then raise exception 'attendance_platform_paused';end if;
      -- A separate monotonic channel version permits reversible pause/resume
      -- without invalidating unchanged notices; it still fences delayed commands.
      if (p_command->>'expectedChannelVersion')::bigint<>s.location_channel_version then raise exception 'attendance_version_conflict';end if;
      if act<>'pause' and ((p_command->>'expectedSettingsVersion')::bigint<>s.version or (p_command->>'expectedLocationVersion')::bigint<>l.version)
        then raise exception 'attendance_version_conflict';end if;
      before_json:=jsonb_build_object('settingsVersion',s.version,'channelVersion',s.location_channel_version,'channelEnabled',s.location_clock_enabled,'locationVersion',l.version,'fence',fence,'draftRevision',d.revision);
      if act='prepare' then
        if d.revision is null or d.revision<>(p_command->>'draftRevision')::bigint then raise exception 'attendance_version_conflict';end if;
        if not l.active then raise exception 'attendance_location_denied';end if;
        if not dirty then raise exception 'attendance_setup_unchanged';end if;
        if open_web_shift then raise exception 'attendance_setup_open_web_shift';end if;
        if not can_prepare then raise exception 'attendance_version_conflict';end if;
        if exists(select 1 from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and operation_id=op) then raise exception 'attendance_operation_conflict';end if;
        update public.merchant_attendance_locations set latitude=(d.command->'values'->>'latitude')::double precision,
          longitude=(d.command->'values'->>'longitude')::double precision,radius_meters=(d.command->'values'->>'radiusMeters')::double precision,
          version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=p_location_id returning * into l;
        -- Rebase by creating a new immutable draft, never rewriting the selected
        -- draft or a published notice. Publication remains a separate owner action.
        perform public.faolla_attendance_location_policy_draft_v1(p_site_id,p_auth_user_id,p_location_id,
          jsonb_build_object('operationId',op,'expectedRevision',d.revision,'expectedSettingsVersion',s.version,'expectedLocationVersion',l.version,'values',d.command->'values'),null,true);
        select * into d from public.merchant_attendance_location_policy_drafts where merchant_id=p_site_id and location_id=p_location_id order by revision desc limit 1;
        fence:=jsonb_build_object('latitude',l.latitude,'longitude',l.longitude,'radiusMeters',l.radius_meters);
        notice_matches:=false;can_prepare:=false;can_enable:=false;
      else
        if s.location_clock_enabled=(act='enable') then raise exception 'attendance_setup_unchanged';end if;
        if s.location_channel_version>=9007199254740990 then raise exception 'attendance_version_conflict';end if;
        if act='enable' and not can_enable then raise exception 'attendance_setup_not_ready';end if;
        update public.merchant_attendance_settings set location_clock_enabled=(act='enable'),location_channel_version=location_channel_version+1,updated_at=clock_timestamp()
          where merchant_id=p_site_id returning * into s;
        can_enable:=p_allow_prepare and s.enabled and s.web_clock_enabled and not s.location_clock_enabled and notice_matches and s.location_channel_version<9007199254740990;
      end if;
      after_json:=jsonb_build_object('settingsVersion',s.version,'channelVersion',s.location_channel_version,'channelEnabled',s.location_clock_enabled,'locationVersion',l.version,'fence',fence,'draftRevision',d.revision);
      insert into public.merchant_attendance_location_setup_operations(merchant_id,operation_id,location_id,actor_auth_user_id,command,before_value,after_value)
        values(p_site_id,op,p_location_id,p_auth_user_id,p_command,before_json,after_json) returning * into receipt;
    end if;
  end if;
  return jsonb_build_object('siteId',p_site_id,'locationId',p_location_id,'ownerId',p_auth_user_id,'settingsVersion',s.version,'channelVersion',s.location_channel_version,
    'channelEnabled',s.location_clock_enabled,'attendanceEnabled',s.enabled,'webClockEnabled',s.web_clock_enabled,
    'location',jsonb_build_object('name',l.name,'active',l.active,'version',l.version,'fence',fence),
    'draft',case when d.revision is null then null else jsonb_build_object('revision',d.revision,'settingsVersion',d.command->'expectedSettingsVersion','locationVersion',d.command->'expectedLocationVersion','values',d.command->'values') end,
    'notice',case when n.revision is null then null else jsonb_build_object('revision',n.revision,'action',n.action) end,
    'noticeMatches',notice_matches,'openWebShift',open_web_shift,'canPrepare',coalesce(can_prepare,false),'canEnable',can_enable,'canPause',s.location_clock_enabled and s.location_channel_version<9007199254740990,
    'receipt',case when receipt.operation_id is null then null else jsonb_build_object('command',receipt.command,'before',receipt.before_value,'after',receipt.after_value,
      'recordedAt',to_char(receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_setup_v1(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_setup_v1(text,uuid,uuid,jsonb,uuid,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300078,'merchant_attendance_location_setup') on conflict(version) do nothing;
commit;
