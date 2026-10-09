-- Additive, read-only provenance enrichment. Existing event.source values,
-- projections, writers and raw-table grants are deliberately unchanged.
begin;
set local lock_timeout='3s';

create function public.faolla_attendance_event_channels_v1(
  p_site_id text,p_auth_user_id uuid,p_query jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;
  viewer public.merchant_enterprise_employees%rowtype;
  viewer_role public.merchant_enterprise_roles%rowtype;
  viewer_scope public.merchant_attendance_scopes%rowtype;
  w public.merchant_attendance_workers%rowtype;
  ev public.merchant_attendance_events%rowtype;
  origin record;
  access_mode text; worker uuid; target_location uuid; requested_event uuid;
  requested_events uuid[]; requested_count integer; authorized_count integer;
  now_at timestamptz; access_until timestamptz; granted boolean;
  channel_now text; terminal_now uuid;
  items jsonb:='[]'::jsonb; result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  -- Validate containers before invoking object/array functions and all UUID
  -- strings before casts. JSON null is required for non-manager locationId.
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query) is distinct from 'object'
    then raise exception 'attendance_invalid_request';end if;
  if octet_length(p_query::text)>16384
    or (select count(*) from jsonb_object_keys(p_query))<>4
    or not(p_query ?& array['access','workerId','locationId','eventIds'])
    or jsonb_typeof(p_query->'access') is distinct from 'string'
    or coalesce(p_query->>'access','') not in ('self','manager','owner')
    or jsonb_typeof(p_query->'workerId') is distinct from 'string'
    or coalesce(p_query->>'workerId','') !~ uuid_pattern
    or jsonb_typeof(p_query->'eventIds') is distinct from 'array'
    then raise exception 'attendance_invalid_request';end if;
  access_mode:=p_query->>'access';
  if access_mode='manager' then
    if jsonb_typeof(p_query->'locationId') is distinct from 'string'
      or coalesce(p_query->>'locationId','') !~ uuid_pattern
      then raise exception 'attendance_invalid_request';end if;
  elsif p_query->'locationId' is distinct from 'null'::jsonb then
    raise exception 'attendance_invalid_request';
  end if;
  requested_count:=jsonb_array_length(p_query->'eventIds');
  if requested_count<1 or requested_count>202 then raise exception 'attendance_invalid_request';end if;
  if exists(select 1 from jsonb_array_elements(p_query->'eventIds') as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'string'
      or coalesce(entry.value #>> '{}','') !~ uuid_pattern)
    then raise exception 'attendance_invalid_request';end if;
  if (select count(distinct entry.value) from jsonb_array_elements_text(p_query->'eventIds') as entry(value))<>requested_count
    then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;
  target_location:=(p_query->>'locationId')::uuid;
  select array_agg(entry.value::uuid order by entry.ordinality) into requested_events
    from jsonb_array_elements_text(p_query->'eventIds') with ordinality as entry(value,ordinality);

  -- Match existing supported writer lock order. Ownership uses ONLY the
  -- current canonical merchant user_id, never a legacy owner alias.
  perform 1 from public.merchants
    where id=p_site_id and (access_mode<>'owner' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if access_mode<>'owner' then
    select * into viewer from public.merchant_enterprise_employees
      where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or viewer.status is distinct from 'active' then raise exception 'attendance_access_denied';end if;
    select * into viewer_role from public.merchant_enterprise_roles
      where merchant_id=p_site_id and id=viewer.role_id for share;
    if not found or viewer_role.status is distinct from 'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(viewer_role.permissions) is distinct from true
      or ('enterprise.view'=any(viewer_role.permissions)) is distinct from true
      or ((case when access_mode='self' then 'attendance.self.view' else 'attendance.records.view' end)=any(viewer_role.permissions)) is distinct from true
      then raise exception 'attendance_access_denied';end if;
  end if;
  -- Reveal missing setup only to an already authenticated current viewer.
  -- Historical evidence remains readable while admission/module is paused.
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if access_mode='self' then
    select * into w from public.merchant_attendance_workers
      where merchant_id=p_site_id and employee_id=viewer.id for share;
    if not found or w.id is distinct from worker then raise exception 'attendance_access_denied';end if;
  else
    if access_mode='manager' then
      select * into viewer_scope from public.merchant_attendance_scopes
        where merchant_id=p_site_id and employee_id=viewer.id for share;
      if not found then raise exception 'attendance_access_denied';end if;
      -- Require the worker AND location from the SAME currently valid grant
      -- before taking the caller-selected worker lock. The scope-row lock
      -- serializes supported grant changes through the entire read.
      if not exists(select 1 from public.merchant_attendance_scope_grants g
        join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
        join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
        where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
          and g.valid_from<=clock_timestamp() and (g.valid_until is null or clock_timestamp()<g.valid_until))
        then raise exception 'attendance_access_denied';end if;
    end if;
    select * into w from public.merchant_attendance_workers
      where merchant_id=p_site_id and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
  end if;
  -- Lock waits cannot prolong authorization. A union of matching active grants
  -- lasts until its latest expiry, or indefinitely if one is unbounded.
  now_at:=clock_timestamp();
  if access_mode='manager' then
    select count(*)>0,case when bool_or(g.valid_until is null) then null else max(g.valid_until) end
      into granted,access_until
      from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
        and g.valid_from<=now_at and (g.valid_until is null or now_at<g.valid_until);
    if not granted then raise exception 'attendance_access_denied';end if;
  end if;

  -- Authorize the WHOLE requested batch before consulting private provenance.
  -- Unknown IDs, another tenant/worker, a previous binding's employee, and a
  -- manager's foreign location are deliberately the same all-or-nothing error.
  select count(*) into authorized_count from public.merchant_attendance_events e
    where e.id=any(requested_events) and e.merchant_id=p_site_id and e.worker_id=worker
      and (access_mode<>'self' or e.actor_employee_id is not distinct from viewer.id)
      and (access_mode<>'manager' or e.location_id=target_location);
  if authorized_count<>requested_count then raise exception 'attendance_access_denied';end if;

  foreach requested_event in array requested_events loop
    select * into ev from public.merchant_attendance_events
      where id=requested_event and merchant_id=p_site_id and worker_id=worker;
    if not found then raise exception 'attendance_access_denied';end if;
    if ev.source not in ('web','kiosk') or ev.occurred_at>now_at
      then raise exception 'attendance_unavailable';end if;
    channel_now:=ev.source;terminal_now:=null;
    -- Lookup by event_id alone: a corrupt cross-tenant binding must fail closed,
    -- not disappear from a tenant-filtered join and be mislabeled ordinary web.
    -- No current terminal lookup: immutable attribution survives revocation.
    select r.merchant_id,r.worker_id,r.employee_id,r.terminal_id,r.operation_id,
      r.claims->>'siteId' as claim_site,r.claims->>'terminalId' as claim_terminal,
      r.claims->>'locationId' as claim_location
      into origin from public.merchant_attendance_onsite_receipts r where r.event_id=ev.id;
    if found then
      if origin.merchant_id is distinct from ev.merchant_id
        or origin.worker_id is distinct from ev.worker_id
        or origin.employee_id is distinct from ev.actor_employee_id
        or origin.operation_id is distinct from ev.operation_id
        or origin.terminal_id is null or ev.source is distinct from 'web'
        or origin.claim_site is distinct from ev.merchant_id
        or origin.claim_terminal is distinct from origin.terminal_id::text
        or origin.claim_location is distinct from ev.location_id::text
        then raise exception 'attendance_unavailable';end if;
      channel_now:='onsite_qr';terminal_now:=origin.terminal_id;
    end if;
    items:=items||jsonb_build_array(jsonb_build_object(
      'eventId',ev.id,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'channel',channel_now,'terminalId',terminal_now));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'access',access_mode,'workerId',worker,
    'locationId',target_location,'viewerEmployeeId',case when access_mode='owner' then null else viewer.id end,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'accessValidUntil',case when access_until is null then null else to_char(access_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'items',items);
  if octet_length(result::text)>65536 then raise exception 'attendance_unavailable';end if;
  -- Recheck after evidence reads AND serialization, while the scope is locked.
  if access_until is not null and clock_timestamp()>=access_until then raise exception 'attendance_access_denied';end if;
  return result;
end; $$;

revoke all on function public.faolla_attendance_event_channels_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_event_channels_v1(text,uuid,jsonb) to service_role;
comment on function public.faolla_attendance_event_channels_v1(text,uuid,jsonb) is
  'Read-only authorized event-channel enrichment. Original web/kiosk event sources remain immutable; onsite_qr derives only from consistent private immutable origin evidence. No current terminal validity is required for history.';
insert into public.faolla_schema_migrations(version,name) values(202610020109,'merchant_attendance_event_channels');
commit;
