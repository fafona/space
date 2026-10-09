-- Unreleased, additive terminal pairing ONLY. No employee credentials or punches.
begin;
set local lock_timeout = '3s';

create table public.merchant_attendance_terminals (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  id uuid not null,
  location_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 80 and label !~ '[[:cntrl:]]'),
  time_zone text not null check (public.faolla_attendance_valid_zone_v1(time_zone)),
  created_by uuid not null,
  created_at timestamptz not null check (isfinite(created_at)),
  pair_hash text not null check (pair_hash ~ '^[0-9a-f]{64}$'),
  pair_expires_at timestamptz not null,
  paired_at timestamptz,
  device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  device_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  primary key (merchant_id,id),
  foreign key (merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id) on delete restrict,
  check (pair_expires_at = created_at + interval '5 minutes'),
  check ((paired_at is null and device_hash is null and device_expires_at is null)
    or (paired_at is not null and device_hash is not null and device_expires_at is not null
      and paired_at >= created_at and paired_at < pair_expires_at and device_expires_at = paired_at + interval '720 hours')),
  check ((revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null and isfinite(revoked_at)
      and revoked_at >= coalesce(paired_at,created_at)))
);
create index merchant_attendance_terminal_created_idx on public.merchant_attendance_terminals(merchant_id,created_at);
alter table public.merchant_attendance_terminals enable row level security;
revoke all on public.merchant_attendance_terminals from public,anon,authenticated,service_role;

create table public.merchant_attendance_terminal_audit (
  merchant_id text not null,
  terminal_id uuid not null,
  action text not null check (action in ('create','pair','revoke')),
  actor_auth_user_id uuid,
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  primary key (merchant_id,terminal_id,action),
  foreign key (merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict,
  check ((action='pair')=(actor_auth_user_id is null))
);
alter table public.merchant_attendance_terminal_audit enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_terminal_audit'::regclass,
      'public.merchant_attendance_terminals'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_terminal_audit from public,anon,authenticated,service_role;
create trigger merchant_attendance_terminal_audit_no_rewrite before update or delete
on public.merchant_attendance_terminal_audit for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_terminal_audit_no_truncate before truncate
on public.merchant_attendance_terminal_audit for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Private projection: never expose pair/device hashes, issuer IDs or employee data.
create function public.faolla_attendance_terminal_snapshot_v1(p_site text,p_id uuid,p_now timestamptz)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('id',t.id,'label',t.label,'locationId',t.location_id,'locationName',l.name,'timeZone',t.time_zone,
    'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairExpiresAt',to_char(t.pair_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pairedAt',to_char(t.paired_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deviceExpiresAt',to_char(t.device_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt',to_char(t.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'state',case when t.revoked_at is not null then 'revoked'
      when not l.active or l.time_zone<>t.time_zone or not coalesce(t.created_by=any(array[
        m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then 'blocked'
      when p_now<t.created_at or p_now<coalesce(t.paired_at,t.created_at) then 'blocked'
      when t.paired_at is null then case when p_now>=t.pair_expires_at then 'expired' else 'pending' end
      when p_now>=t.device_expires_at then 'expired' else 'active' end)
  from public.merchant_attendance_terminals t join public.merchant_attendance_locations l on l.merchant_id=t.merchant_id and l.id=t.location_id
    join public.merchants m on m.id=t.merchant_id where t.merchant_id=p_site and t.id=p_id;
$$;
revoke all on function public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.faolla_attendance_terminal_admin_v1(p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_allow_create boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; t public.merchant_attendance_terminals%rowtype; l public.merchant_attendance_locations%rowtype;
  now_at timestamptz; target uuid; cursor_id uuid; rows_json jsonb; next_id uuid;
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_auth is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>2 or not(p_query ?& array['cursor','terminalId'])
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ uuid_pattern)
    or (p_query->'terminalId'<>'null'::jsonb and coalesce(p_query->>'terminalId','') !~ uuid_pattern)
    or (p_query->>'cursor' is not null and p_query->>'terminalId' is not null)
  then raise exception 'attendance_invalid_request'; end if;
  target:=(p_query->>'terminalId')::uuid; cursor_id:=(p_query->>'cursor')::uuid;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or target is not null or cursor_id is not null
      or coalesce(p_command->>'terminalId','') !~ uuid_pattern
      or coalesce(p_command->>'action','') not in ('create','revoke') then raise exception 'attendance_invalid_request'; end if;
    target:=(p_command->>'terminalId')::uuid;
    if p_command->>'action'='create' then
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','terminalId','locationId','label','pairHash'])
        or coalesce(p_command->>'locationId','') !~ uuid_pattern or jsonb_typeof(p_command->'label')<>'string'
        or char_length(btrim(p_command->>'label')) not between 1 and 80 or (p_command->>'label') ~ '[[:cntrl:]]'
        or coalesce(p_command->>'pairHash','') !~ '^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request'; end if;
    elsif (select count(*) from jsonb_object_keys(p_command))<>2 then raise exception 'attendance_invalid_request'; end if;
  end if;
  select * into m from public.merchants where id=p_site for share;
  if not found or not coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  -- Consistent lock order: merchant -> settings -> location -> terminal.
  -- Configuration writes already use settings FOR UPDATE; no old writer changes.
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update; end if;
  if not found then raise exception 'attendance_settings_required'; end if;
  now_at:=clock_timestamp();
  if p_command is not null then
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=target for update;
    if p_command->>'action'='create' then
      if t.id is not null then
        if t.created_by<>p_auth or t.location_id<>(p_command->>'locationId')::uuid or t.label<>btrim(p_command->>'label') or t.pair_hash<>p_command->>'pairHash'
          then raise exception 'attendance_operation_conflict'; end if;
        -- Same intent returns CURRENT metadata only; never renew an expiry or resurrect.
      else
        if p_allow_create is distinct from true then raise exception 'attendance_platform_paused'; end if;
        select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
        if not found or not l.active then raise exception 'attendance_location_denied'; end if;
        if (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and revoked_at is null
            and coalesce(device_expires_at,pair_expires_at)>now_at)>=20
          or (select count(*) from public.merchant_attendance_terminals where merchant_id=p_site and created_at>now_at-interval '1 hour')>=10
          then raise exception 'attendance_terminal_limit'; end if;
        insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at)
          values(p_site,target,l.id,btrim(p_command->>'label'),l.time_zone,p_auth,now_at,p_command->>'pairHash',now_at+interval '5 minutes');
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'create',p_auth,now_at);
      end if;
    else
      if t.id is null then raise exception 'attendance_terminal_not_found'; end if;
      if t.revoked_at is null then
        if now_at<coalesce(t.paired_at,t.created_at) then raise exception 'attendance_time_reversed'; end if;
        update public.merchant_attendance_terminals set revoked_at=now_at,revoked_by=p_auth where merchant_id=p_site and id=target;
        insert into public.merchant_attendance_terminal_audit values(p_site,target,'revoke',p_auth,now_at);
      end if;
    end if;
  end if;
  select coalesce(jsonb_agg(public.faolla_attendance_terminal_snapshot_v1(p_site,page.id,now_at) order by page.id),'[]'::jsonb)
    into rows_json from (select id from public.merchant_attendance_terminals where merchant_id=p_site
      and (target is null or id=target) and (cursor_id is null or id>cursor_id) order by id limit 26) page;
  if jsonb_array_length(rows_json)>25 then rows_json:=rows_json-25; next_id:=(rows_json->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site,'items',rows_json,'nextCursor',next_id);
end;
$$;
revoke all on function public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_terminal_admin_v1(text,uuid,jsonb,jsonb,boolean) to service_role;

-- The server hashes high-entropy secrets before this call. No owner session is
-- accepted as a terminal credential. This RPC intentionally cannot create punches.
create function public.faolla_attendance_terminal_device_v1(p_site text,p_id uuid,p_secret_hash text,p_device_hash text,p_allow_pair boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.merchant_attendance_terminals%rowtype; now_at timestamptz; snapshot jsonb; attendance_enabled boolean;
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
    or (p_device_hash is not null and p_device_hash !~ '^[0-9a-f]{64}$') then raise exception 'attendance_terminal_denied'; end if;
  perform 1 from public.merchants where id=p_site for share;
  if not found then raise exception 'attendance_terminal_denied'; end if;
  if p_device_hash is not null then
    select enabled into attendance_enabled from public.merchant_attendance_settings where merchant_id=p_site for update;
  else select enabled into attendance_enabled from public.merchant_attendance_settings where merchant_id=p_site for share; end if;
  if not found then raise exception 'attendance_terminal_denied'; end if;
  select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_id;
  if not found then raise exception 'attendance_terminal_denied'; end if;
  perform 1 from public.merchant_attendance_locations where merchant_id=p_site and id=t.location_id for share;
  if p_device_hash is not null then
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_id for update;
  end if;
  now_at:=clock_timestamp(); snapshot:=public.faolla_attendance_terminal_snapshot_v1(p_site,p_id,now_at);
  if p_device_hash is not null then
    if p_allow_pair is distinct from true or snapshot->>'state'<>'pending' or t.pair_hash<>p_secret_hash
      or p_secret_hash=p_device_hash then raise exception 'attendance_terminal_denied'; end if;
    update public.merchant_attendance_terminals set paired_at=now_at,device_hash=p_device_hash,device_expires_at=now_at+interval '720 hours'
      where merchant_id=p_site and id=p_id;
    insert into public.merchant_attendance_terminal_audit values(p_site,p_id,'pair',null,now_at);
    snapshot:=public.faolla_attendance_terminal_snapshot_v1(p_site,p_id,now_at);
  elsif snapshot->>'state'<>'active' or t.device_hash is null or t.device_hash<>p_secret_hash then
    raise exception 'attendance_terminal_denied';
  end if;
  return jsonb_build_object('siteId',p_site,'terminal',snapshot,'attendanceEnabled',attendance_enabled,'clockEnabled',false);
end;
$$;
revoke all on function public.faolla_attendance_terminal_device_v1(text,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_terminal_device_v1(text,uuid,text,text,boolean) to service_role;

insert into public.faolla_schema_migrations(version,name) values(202610010104,'merchant_attendance_terminals');
commit;
