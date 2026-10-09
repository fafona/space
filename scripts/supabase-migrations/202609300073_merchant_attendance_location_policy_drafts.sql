-- Owner-only policy preparation; deliberately cannot activate location or edit
-- operational fences. Immutable revisions are also the before/after audit trail.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_location_policy_drafts (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  location_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at)),
  primary key(merchant_id,location_id,revision),
  unique(merchant_id,operation_id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id) on delete restrict
);
alter table public.merchant_attendance_location_policy_drafts enable row level security;
revoke all on public.merchant_attendance_location_policy_drafts from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_policy_no_rewrite before update or delete
  on public.merchant_attendance_location_policy_drafts for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_policy_no_truncate before truncate
  on public.merchant_attendance_location_policy_drafts for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_policy_draft_v1(
  p_site_id text,p_auth_user_id uuid,p_location_id uuid,p_command jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype; v_settings public.merchant_attendance_settings%rowtype;
  v_location public.merchant_attendance_locations%rowtype;
  v_current public.merchant_attendance_location_policy_drafts%rowtype;
  v_previous public.merchant_attendance_location_policy_drafts%rowtype;
  v_receipt public.merchant_attendance_location_policy_drafts%rowtype;
  v_values jsonb; v_key text; v_max integer; v_operation uuid; v_revision bigint; v_now timestamptz;
  v_current_json jsonb; v_previous_json jsonb;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_location_id is null or p_allow_write is null
    then raise exception 'attendance_invalid_request'; end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array[
      'operationId','expectedRevision','expectedSettingsVersion','expectedLocationVersion','values'])
      or coalesce(p_command->>'operationId','') !~ v_uuid or jsonb_typeof(p_command->'values')<>'object'
      then raise exception 'attendance_invalid_request'; end if;
    foreach v_key in array array['expectedRevision','expectedSettingsVersion','expectedLocationVersion'] loop
      if jsonb_typeof(p_command->v_key)<>'number' or coalesce(p_command->>v_key,'') !~ '^(0|[1-9][0-9]{0,15})$'
        then raise exception 'attendance_invalid_request'; end if;
      if (p_command->>v_key)::numeric>=9007199254740991 or
        (v_key='expectedRevision' and (p_command->>v_key)::numeric>=9007199254740990) or
        (v_key<>'expectedRevision' and (p_command->>v_key)::numeric=0) then raise exception 'attendance_invalid_request'; end if;
    end loop;
    v_values:=p_command->'values';
    if (select count(*) from jsonb_object_keys(v_values))<>8 or not(v_values ?& array[
      'purpose','notice','contact','alternative','retentionDays','latitude','longitude','radiusMeters']) then raise exception 'attendance_invalid_request'; end if;
    foreach v_key in array array['purpose','notice','contact','alternative'] loop
      v_max:=case v_key when 'purpose' then 160 when 'notice' then 400 when 'contact' then 120 else 240 end;
      if jsonb_typeof(v_values->v_key)<>'string' or char_length(btrim(v_values->>v_key)) not between 1 and v_max
        or (v_values->>v_key) ~ '[[:cntrl:]]' or (v_values->>v_key)<>btrim(v_values->>v_key) then raise exception 'attendance_invalid_request'; end if;
    end loop;
    foreach v_key in array array['retentionDays','latitude','longitude','radiusMeters'] loop
      if jsonb_typeof(v_values->v_key)<>'number' then raise exception 'attendance_invalid_request'; end if;
    end loop;
    if (v_values->>'latitude')::numeric not between -90 and 90 or (v_values->>'longitude')::numeric not between -180 and 180
      or (v_values->>'retentionDays') !~ '^[1-9][0-9]{0,3}$' or (v_values->>'retentionDays')::numeric>3650
      or (v_values->>'radiusMeters') !~ '^[1-9][0-9]{0,5}$' or (v_values->>'radiusMeters')::numeric>100000
      then raise exception 'attendance_invalid_request'; end if;
    v_operation:=(p_command->>'operationId')::uuid;
  end if;
  -- Current owner on every read, recovery and write; an owner transfer cannot
  -- interleave between authorization and revision insertion.
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,
    v_merchant.owner_id,v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  -- Rare saves serialize on settings, in the same lock order as existing admin.
  -- No settings update, version bump or operational fence change is performed.
  if p_command is null then
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for update;
  end if;
  if not found then raise exception 'attendance_settings_required'; end if;
  select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=p_location_id for share;
  if not found then raise exception 'attendance_location_denied'; end if;
  select * into v_current from public.merchant_attendance_location_policy_drafts
    where merchant_id=p_site_id and location_id=p_location_id order by revision desc limit 1;
  select * into v_receipt from public.merchant_attendance_location_policy_drafts
    where merchant_id=p_site_id and operation_id=coalesce(v_operation,p_operation_id);
  if v_receipt.operation_id is not null and (v_receipt.location_id<>p_location_id or v_receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict'; end if;
    v_receipt:=null;
  end if;
  if p_command is not null then
    if v_receipt.operation_id is not null then
      if v_receipt.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
    else
      if not p_allow_write then raise exception 'attendance_platform_paused'; end if;
      if not v_location.active then raise exception 'attendance_location_denied'; end if;
      if (p_command->>'expectedRevision')::bigint<>coalesce(v_current.revision,0)
        or (p_command->>'expectedSettingsVersion')::bigint<>v_settings.version
        or (p_command->>'expectedLocationVersion')::bigint<>v_location.version then raise exception 'attendance_version_conflict'; end if;
      v_revision:=coalesce(v_current.revision,0)+1;
      v_now:=date_trunc('milliseconds',clock_timestamp());
      if v_current.recorded_at>v_now then raise exception 'attendance_version_conflict'; end if;
      insert into public.merchant_attendance_location_policy_drafts(merchant_id,location_id,revision,operation_id,actor_auth_user_id,command,recorded_at)
        values(p_site_id,p_location_id,v_revision,v_operation,p_auth_user_id,p_command,v_now) returning * into v_receipt;
      v_current:=v_receipt;
    end if;
  end if;
  if v_current.revision is not null then
    select * into v_previous from public.merchant_attendance_location_policy_drafts
      where merchant_id=p_site_id and location_id=p_location_id and revision=v_current.revision-1;
    v_current_json:=jsonb_build_object('revision',v_current.revision,'recordedAt',to_char(v_current.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'settingsVersion',v_current.command->'expectedSettingsVersion','locationVersion',v_current.command->'expectedLocationVersion','values',v_current.command->'values');
  end if;
  if v_previous.revision is not null then
    v_previous_json:=jsonb_build_object('revision',v_previous.revision,'recordedAt',to_char(v_previous.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'settingsVersion',v_previous.command->'expectedSettingsVersion','locationVersion',v_previous.command->'expectedLocationVersion','values',v_previous.command->'values');
  end if;
  return jsonb_build_object('siteId',p_site_id,'locationId',p_location_id,'draftOnly',true,'settingsVersion',v_settings.version,
    'location',jsonb_build_object('name',v_location.name,'active',v_location.active,'version',v_location.version),
    'current',v_current_json,'previous',v_previous_json,'receipt',case when v_receipt.operation_id is null then null else
      jsonb_build_object('operationId',v_receipt.operation_id,'revision',v_receipt.revision,'recordedAt',to_char(v_receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_policy_draft_v1(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_policy_draft_v1(text,uuid,uuid,jsonb,uuid,boolean) to service_role;
comment on table public.merchant_attendance_location_policy_drafts is
  'Unpublished owner policy revisions, not employee location samples, activated fences, consent or configured retention enforcement. No existing policy is changed.';
insert into public.faolla_schema_migrations(version,name) values(202609300073,'merchant_attendance_location_policy_drafts') on conflict(version) do nothing;
commit;
