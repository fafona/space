-- Unreleased, explicitly enabled record-and-review prototype. No policy backfill.
-- Device coordinates never enter SQL; a server-only classification is bound to
-- a locked policy fingerprint and re-dated against the commit-side server clock.
begin;
set local lock_timeout='3s';
alter table public.merchant_attendance_settings add column location_clock_enabled boolean not null default false;
create table public.merchant_attendance_location_results (
  event_id uuid primary key references public.merchant_attendance_events(id) on delete restrict,
  settings_version bigint not null check(settings_version between 1 and 9007199254740991),
  worker_version bigint not null check(worker_version between 1 and 9007199254740991),
  location_version bigint not null check(location_version between 1 and 9007199254740991),
  algorithm_version integer not null check(algorithm_version=1),
  reason text not null check(reason in ('inside','outside','uncertain','stale','future','denied','timeout','unavailable','unsupported','not_provided')),
  needs_review boolean not null,
  captured_at timestamptz null check(captured_at is null or isfinite(captured_at)),
  accuracy_meters double precision null check(accuracy_meters between 0 and 40100000),
  distance_meters integer null check(distance_meters between 0 and 20100000),
  check(needs_review=(reason<>'inside')),
  check(case when reason in ('inside','outside','uncertain','stale','future') then
    captured_at is not null and accuracy_meters is not null and distance_meters is not null
    else captured_at is null and accuracy_meters is null and distance_meters is null end)
);
alter table public.merchant_attendance_location_results enable row level security;
revoke all on public.merchant_attendance_location_results from public,anon,authenticated,service_role;
-- No direct service SELECT: summaries are returned only alongside an authorized
-- self receipt. Future manager review/retention needs its own permissioned path.
create trigger merchant_attendance_location_results_no_rewrite before update or delete
  on public.merchant_attendance_location_results for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_results_no_truncate before truncate
  on public.merchant_attendance_location_results for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_clock_v1(
  p_site_id text,p_auth_user_id uuid,p_expected_worker_id uuid,p_command jsonb default null,p_operation_id uuid default null,
  p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_settings public.merchant_attendance_settings%rowtype; v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype; v_worker public.merchant_attendance_workers%rowtype;
  v_location public.merchant_attendance_locations%rowtype; v_last public.merchant_attendance_events%rowtype;
  v_receipt public.merchant_attendance_events%rowtype; v_result public.merchant_attendance_location_results%rowtype;
  v_sequence bigint; v_status text; v_operation uuid; v_location_id uuid; v_action text; v_expected bigint;
  v_key text; v_now timestamptz; v_date date; v_employed boolean; v_channel_enabled boolean; v_replayed boolean:=false;
  v_fingerprint text; v_reason text; v_captured timestamptz; v_accuracy double precision; v_distance integer;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_expected_worker_id is null
    or p_allow_new_sessions is null or p_require_clock is null then raise exception 'attendance_invalid_request'; end if;
  if p_command is null then
    if p_assertion is not null then raise exception 'attendance_invalid_request'; end if;
  else
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array[
      'operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion'])
      or jsonb_typeof(p_command->'action')<>'string' or coalesce(p_command->>'action','') not in ('clock_in','clock_out','break_start','break_end')
      or coalesce(p_command->>'operationId','') !~ v_uuid or coalesce(p_command->>'locationId','') !~ v_uuid
      then raise exception 'attendance_invalid_request'; end if;
    foreach v_key in array array['expectedSequence','settingsVersion','workerVersion','locationVersion'] loop
      if jsonb_typeof(p_command->v_key)<>'number' or coalesce(p_command->>v_key,'') !~ '^(0|[1-9][0-9]{0,15})$'
        then raise exception 'attendance_invalid_request'; end if;
      if (p_command->>v_key)::numeric>9007199254740991 or
        (v_key='expectedSequence' and (p_command->>v_key)::numeric>=9007199254740991) or
        (v_key<>'expectedSequence' and (p_command->>v_key)::numeric=0) then raise exception 'attendance_invalid_request'; end if;
    end loop;
    v_operation:=(p_command->>'operationId')::uuid; v_location_id:=(p_command->>'locationId')::uuid;
    v_action:=p_command->>'action'; v_expected:=(p_command->>'expectedSequence')::bigint;
  end if;

  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_disabled'; end if;
  select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into v_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=v_employee.role_id for share;
  if not found or v_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
    or not('attendance.self.view'=any(v_role.permissions)) or
    ((p_command is not null or p_require_clock) and not('attendance.self.clock'=any(v_role.permissions)))
    then raise exception 'attendance_access_denied'; end if;
  if p_command is not null then
    select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=v_employee.id for update;
  else
    select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=v_employee.id for share;
  end if;
  if not found then raise exception 'attendance_access_denied'; end if;
  if v_worker.id<>p_expected_worker_id then raise exception 'attendance_worker_changed'; end if;
  select * into v_last from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=v_worker.id order by sequence desc limit 1;
  v_sequence:=coalesce(v_last.sequence,0);
  v_status:=case when v_last.id is null or v_last.action='clock_out' then 'off' when v_last.action='break_start' then 'break' else 'working' end;
  select * into v_receipt from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=v_worker.id
    and operation_id=coalesce(v_operation,p_operation_id);
  if v_receipt.id is not null then
    select * into v_result from public.merchant_attendance_location_results where event_id=v_receipt.id;
    if v_result.event_id is null or v_receipt.actor_employee_id is distinct from v_employee.id then
      if p_command is not null or p_require_clock then raise exception 'attendance_operation_conflict'; end if;
      v_receipt:=null; v_result:=null;
    elsif p_command is not null then
      if v_receipt.action<>v_action or v_receipt.location_id<>v_location_id then raise exception 'attendance_operation_conflict'; end if;
      -- Identity/role revocation remains a hard denial, but an existing successful
      -- operation is not invalidated by later switches, position or policy age.
      v_replayed:=true;
    end if;
  end if;

  select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=v_worker.default_location_id for share;
  if v_location.id is not null then
    -- Fixed JSONB encoding on both reads/writes; includes values as well as
    -- versions so even an unversioned configuration edit cannot slip through.
    v_fingerprint:=md5(jsonb_build_array(v_settings.version,v_settings.time_zone,v_settings.web_break_paid,
      v_worker.id,v_worker.version,v_worker.employee_id,v_worker.default_location_id,
      v_location.id,v_location.version,v_location.time_zone,v_location.latitude,v_location.longitude,v_location.radius_meters)::text);
  end if;
  v_now:=date_trunc('milliseconds',clock_timestamp());
  v_date:=(v_now at time zone v_settings.time_zone)::date;
  v_employed:=(select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=v_worker.id
    and starts_on<=v_date and (ends_on is null or ends_on>=v_date))=1;
  v_channel_enabled:=v_settings.enabled and v_settings.web_clock_enabled and v_settings.location_clock_enabled and v_worker.active
    and coalesce(v_location.active,false) and v_location.radius_meters is not null and v_employed and 'attendance.self.clock'=any(v_role.permissions);
  if p_command is not null and not v_replayed then
    if not v_settings.enabled then raise exception 'attendance_disabled'; end if;
    if not v_settings.web_clock_enabled then raise exception 'attendance_web_disabled'; end if;
    if not v_settings.location_clock_enabled then raise exception 'attendance_location_clock_disabled'; end if;
    if not v_worker.active then raise exception 'attendance_access_denied'; end if;
    if not p_allow_new_sessions and v_action in ('clock_in','break_start') then raise exception 'attendance_platform_paused'; end if;
    if v_sequence<>v_expected then raise exception 'attendance_sequence_conflict'; end if;
    if v_location_id is distinct from v_worker.default_location_id or v_location.id is null or not v_location.active then raise exception 'attendance_location_denied'; end if;
    if v_location.radius_meters is null then raise exception 'attendance_location_not_configured'; end if;
    if not v_employed then raise exception 'attendance_not_employed'; end if;
    if (p_command->>'settingsVersion')::bigint<>v_settings.version or (p_command->>'workerVersion')::bigint<>v_worker.version
      or (p_command->>'locationVersion')::bigint<>v_location.version then raise exception 'attendance_location_policy_changed'; end if;
    if v_last.id is not null and v_now<v_last.occurred_at then raise exception 'attendance_time_reversed'; end if;
    if v_action='clock_in' and v_status<>'off' then raise exception 'attendance_already_clocked_in'; end if;
    if v_action='break_start' and v_status<>'working' then raise exception 'attendance_not_working'; end if;
    if v_action='break_end' and v_status<>'break' then raise exception 'attendance_not_on_break'; end if;
    if v_action='clock_out' and v_status='break' then raise exception 'attendance_break_must_end'; end if;
    if v_action='clock_out' and v_status='off' then raise exception 'attendance_not_clocked_in'; end if;
    if p_assertion is null or jsonb_typeof(p_assertion)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_assertion))<>6 or not(p_assertion ?& array[
      'policyFingerprint','algorithmVersion','reason','capturedAt','accuracyMeters','distanceMeters'])
      or coalesce(p_assertion->>'algorithmVersion','')<>'1' or jsonb_typeof(p_assertion->'algorithmVersion')<>'number'
      or coalesce(p_assertion->>'policyFingerprint','') !~ '^[0-9a-f]{32}$'
      or jsonb_typeof(p_assertion->'reason')<>'string' then raise exception 'attendance_invalid_request'; end if;
    if p_assertion->>'policyFingerprint'<>v_fingerprint then raise exception 'attendance_location_policy_changed'; end if;
    v_reason:=p_assertion->>'reason';
    if v_reason in ('inside','outside','uncertain') then
      if jsonb_typeof(p_assertion->'capturedAt')<>'string' or length(p_assertion->>'capturedAt')<>24
        or jsonb_typeof(p_assertion->'accuracyMeters')<>'number' or jsonb_typeof(p_assertion->'distanceMeters')<>'number'
        or coalesce(p_assertion->>'distanceMeters','') !~ '^(0|[1-9][0-9]{0,7})$' then raise exception 'attendance_invalid_request'; end if;
      v_captured:=public.faolla_attendance_instant_v1(p_assertion->>'capturedAt');
      if v_captured<'2000-01-01T00:00:00Z'::timestamptz or v_captured>='2101-01-01T00:00:00Z'::timestamptz
        or (p_assertion->>'accuracyMeters')::numeric not between 0 and 40100000
        or (p_assertion->>'distanceMeters')::numeric>20100000 then raise exception 'attendance_invalid_request'; end if;
      v_accuracy:=(p_assertion->>'accuracyMeters')::double precision; v_distance:=(p_assertion->>'distanceMeters')::integer;
      if v_captured>v_now+interval '5 seconds' then v_reason:='future';
      elsif v_now-v_captured>interval '60 seconds' then v_reason:='stale'; end if;
    elsif v_reason in ('denied','timeout','unavailable','unsupported','not_provided') then
      if p_assertion->'capturedAt'<>'null'::jsonb or p_assertion->'accuracyMeters'<>'null'::jsonb or p_assertion->'distanceMeters'<>'null'::jsonb
        then raise exception 'attendance_invalid_request'; end if;
    else raise exception 'attendance_invalid_request'; end if;
    -- Same transaction: failure of either INSERT rolls back both. One worker
    -- serialization lock and the original (worker, operation)/(worker, sequence)
    -- unique indexes are shared with ordinary web and all future channels.
    insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,
      break_paid,occurred_at,received_at,time_zone,actor_employee_id) values(p_site_id,v_worker.id,v_location_id,v_operation,
      v_sequence+1,v_action,'web',case when v_action='break_start' then v_settings.web_break_paid else null end,
      v_now,v_now,v_location.time_zone,v_employee.id) returning * into v_receipt;
    insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,
      algorithm_version,reason,needs_review,captured_at,accuracy_meters,distance_meters)
      values(v_receipt.id,v_settings.version,v_worker.version,v_location.version,1,v_reason,v_reason<>'inside',v_captured,v_accuracy,v_distance)
      returning * into v_result;
    v_last:=v_receipt; v_sequence:=v_receipt.sequence;
    v_status:=case when v_action='clock_out' then 'off' when v_action='break_start' then 'break' else 'working' end;
  end if;
  return jsonb_build_object('siteId',p_site_id,'employeeId',v_employee.id,'workerId',v_worker.id,'locationId',v_worker.default_location_id,
    'state',jsonb_build_object('sequence',v_sequence,'status',v_status,'lastEvent',public.faolla_attendance_event_receipt_v1(v_last)),
    'receipt',public.faolla_attendance_event_receipt_v1(v_receipt),'replayed',v_replayed,'channelEnabled',v_channel_enabled,
    'policy',case when v_location.id is null or v_location.radius_meters is null then null else jsonb_build_object(
      'settingsVersion',v_settings.version,'workerVersion',v_worker.version,'locationVersion',v_location.version,
      'mode','record_and_review','maxAgeMs',60000,'algorithmVersion',1) end,
    'locationResult',case when v_result.event_id is null then null else jsonb_build_object('eventId',v_result.event_id,
      'settingsVersion',v_result.settings_version,'workerVersion',v_result.worker_version,'locationVersion',v_result.location_version,
      'algorithmVersion',v_result.algorithm_version,'reason',v_result.reason,'needsReview',v_result.needs_review,
      'capturedAt',case when v_result.captured_at is null then null else to_char(v_result.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'accuracyMeters',v_result.accuracy_meters,'distanceMeters',v_result.distance_meters) end,
    'internalPolicyFingerprint',v_fingerprint,'internalFence',case when v_location.radius_meters is null then null else
      jsonb_build_object('latitude',v_location.latitude,'longitude',v_location.longitude,'radiusMeters',v_location.radius_meters,'maxAgeMs',60000) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean) to service_role;
comment on table public.merchant_attendance_location_results is
  'Append-only minimal result for a web location attendance event, no raw coordinates. Unreleased record-and-review policy, not presence proof or approved wages. Separate authorized review/retention workflow required before production.';
insert into public.faolla_schema_migrations(version,name) values(202609300072,'merchant_attendance_location_clock') on conflict(version) do nothing;
commit;
