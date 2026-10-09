-- First online employee-self channel. No employee/configuration backfill.
-- API must authenticate a password session and check current enterprise entitlement.
-- Only service_role can call this RPC; authenticated clients cannot choose auth identity.
begin;
set local lock_timeout = '3s';

alter table public.merchant_attendance_settings
  add column if not exists web_clock_enabled boolean not null default false,
  add column if not exists web_break_paid boolean not null default false;
alter table public.merchant_attendance_events
  add column if not exists actor_employee_id uuid null;
alter table public.merchant_attendance_events
  add constraint merchant_attendance_event_actor_fk foreign key (merchant_id, actor_employee_id)
  references public.merchant_enterprise_employees(merchant_id,id) on delete restrict;

-- Serialize all employment edits with punches, including INSERT phantoms.
-- Future administration RPCs must use settings -> employee -> role -> worker lock order.
create or replace function public.faolla_attendance_employment_guard_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and (new.merchant_id, new.worker_id) is distinct from (old.merchant_id, old.worker_id) then
    raise exception 'attendance_employment_identity_immutable';
  end if;
  if tg_op = 'DELETE' then
    perform 1 from public.merchant_attendance_workers where merchant_id=old.merchant_id and id=old.worker_id for update;
    return old;
  end if;
  perform 1 from public.merchant_attendance_workers where merchant_id=new.merchant_id and id=new.worker_id for update;
  if new.starts_on is not null and (new.ends_on is null or new.ends_on >= new.starts_on) and exists (
    select 1 from public.merchant_attendance_employment_periods p
    where p.merchant_id=new.merchant_id and p.worker_id=new.worker_id and p.id<>new.id
      and daterange(p.starts_on,p.ends_on,'[]') && daterange(new.starts_on,new.ends_on,'[]')
  ) then raise exception 'attendance_employment_overlap'; end if;
  return new;
end;
$$;
revoke all on function public.faolla_attendance_employment_guard_v1() from public,anon,authenticated,service_role;
create trigger merchant_attendance_employment_guard
before insert or update or delete on public.merchant_attendance_employment_periods
for each row execute function public.faolla_attendance_employment_guard_v1();

create or replace function public.faolla_attendance_event_receipt_v1(p_event public.merchant_attendance_events)
returns jsonb language sql stable set search_path = pg_catalog as $$
  select case when p_event.id is null then null else jsonb_build_object(
    'id',p_event.id,'siteId',p_event.merchant_id,'workerId',p_event.worker_id,
    'operationId',p_event.operation_id,'locationId',p_event.location_id,
    'sequence',p_event.sequence,'action',p_event.action,'breakPaid',p_event.break_paid,
    'occurredAt',to_char(p_event.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timeZone',p_event.time_zone) end;
$$;
revoke all on function public.faolla_attendance_event_receipt_v1(public.merchant_attendance_events) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_self_v1(
  p_site_id text, p_auth_user_id uuid, p_command jsonb default null, p_operation_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_settings public.merchant_attendance_settings%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;
  v_location public.merchant_attendance_locations%rowtype;
  v_last public.merchant_attendance_events%rowtype;
  v_receipt public.merchant_attendance_events%rowtype;
  v_sequence bigint;
  v_status text;
  v_action text;
  v_operation uuid;
  v_location_id uuid;
  v_expected bigint;
  v_now timestamptz;
  v_date date;
  v_replayed boolean := false;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null then
    raise exception 'attendance_invalid_request';
  end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command) <> 'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command)) <> 5
      or not (p_command ?& array['operationId','locationId','action','expectedSequence','expectedWorkerId'])
      or jsonb_typeof(p_command->'action') <> 'string'
      or coalesce(p_command->>'action','') not in ('clock_in','clock_out','break_start','break_end')
      or jsonb_typeof(p_command->'expectedSequence') <> 'number'
      or (p_command->>'expectedSequence') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedSequence')::numeric > 9007199254740990
      or coalesce(p_command->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_command->>'locationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_command->>'expectedWorkerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then raise exception 'attendance_invalid_request'; end if;
    v_operation := (p_command->>'operationId')::uuid;
    v_location_id := (p_command->>'locationId')::uuid;
    v_action := p_command->>'action';
    v_expected := (p_command->>'expectedSequence')::bigint;
  end if;

  select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found or not v_settings.enabled then raise exception 'attendance_disabled'; end if;
  -- Re-read current binding and authorization INSIDE the transaction. No cached actor grants.
  select * into v_employee from public.merchant_enterprise_employees
    where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or v_employee.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into v_role from public.merchant_enterprise_roles
    where merchant_id=p_site_id and id=v_employee.role_id for share;
  if not found or v_role.status<>'active'
    or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
    or not ('attendance.self.view'=any(v_role.permissions))
    or (p_command is not null and not ('attendance.self.clock'=any(v_role.permissions)))
  then raise exception 'attendance_access_denied'; end if;
  -- All channels will serialize on this same worker row. No mutable state cache required.
  if p_command is not null then
    select * into v_worker from public.merchant_attendance_workers
      where merchant_id=p_site_id and employee_id=v_employee.id for update;
  else
    select * into v_worker from public.merchant_attendance_workers
      where merchant_id=p_site_id and employee_id=v_employee.id for share;
  end if;
  if not found or not v_worker.active then raise exception 'attendance_access_denied'; end if;
  -- This is only a precondition, never the target lookup: identity above is
  -- resolved from the current authenticated membership, not a client worker ID.
  if p_command is not null and v_worker.id <> (p_command->>'expectedWorkerId')::uuid then
    raise exception 'attendance_worker_changed';
  end if;

  select * into v_last from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id order by sequence desc limit 1;
  v_sequence := coalesce(v_last.sequence,0);
  v_status := case when v_last.id is null or v_last.action='clock_out' then 'off'
    when v_last.action='break_start' then 'break' else 'working' end;

  select * into v_receipt from public.merchant_attendance_events
    where merchant_id=p_site_id and worker_id=v_worker.id
      and operation_id=coalesce(v_operation,p_operation_id);
  if p_command is not null then
    if v_receipt.id is not null then
      if v_receipt.action<>v_action or v_receipt.location_id<>v_location_id then
        raise exception 'attendance_operation_conflict';
      end if;
      -- A successful prior command remains successful after a lost response, even
      -- if the current sequence, location or break policy has since changed.
      v_replayed := true;
    else
      if not v_settings.web_clock_enabled then raise exception 'attendance_web_disabled'; end if;
      if v_sequence<>v_expected then raise exception 'attendance_sequence_conflict'; end if;
      if v_location_id is distinct from v_worker.default_location_id then raise exception 'attendance_location_denied'; end if;
      select * into v_location from public.merchant_attendance_locations
        where merchant_id=p_site_id and id=v_location_id for share;
      if not found or not v_location.active then raise exception 'attendance_location_denied'; end if;
      -- Geofenced/QR/kiosk channels are not implemented by this first web endpoint.
      -- Fail closed instead of silently bypassing the configured location check.
      if v_location.radius_meters is not null then raise exception 'attendance_location_verification_required'; end if;
      v_now := date_trunc('milliseconds',clock_timestamp());
      v_date := (v_now at time zone v_settings.time_zone)::date;
      if (select count(*) from public.merchant_attendance_employment_periods
        where merchant_id=p_site_id and worker_id=v_worker.id and starts_on<=v_date and (ends_on is null or ends_on>=v_date))<>1
      then raise exception 'attendance_not_employed'; end if;
      if v_last.id is not null and v_now<v_last.occurred_at then raise exception 'attendance_time_reversed'; end if;
      if v_action='clock_in' and v_status<>'off' then raise exception 'attendance_already_clocked_in'; end if;
      if v_action='break_start' and v_status<>'working' then raise exception 'attendance_not_working'; end if;
      if v_action='break_end' and v_status<>'break' then raise exception 'attendance_not_on_break'; end if;
      if v_action='clock_out' and v_status='break' then raise exception 'attendance_break_must_end'; end if;
      if v_action='clock_out' and v_status='off' then raise exception 'attendance_not_clocked_in'; end if;
      insert into public.merchant_attendance_events(
        merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id
      ) values (
        p_site_id,v_worker.id,v_location_id,v_operation,v_sequence+1,v_action,'web',
        case when v_action='break_start' then v_settings.web_break_paid else null end,
        v_now,v_now,v_location.time_zone,v_employee.id
      ) returning * into v_receipt;
      v_last := v_receipt;
      v_sequence := v_receipt.sequence;
      v_status := case when v_action='clock_out' then 'off' when v_action='break_start' then 'break' else 'working' end;
    end if;
  end if;
  return jsonb_build_object('workerId',v_worker.id,'locationId',v_worker.default_location_id,
    'state',jsonb_build_object('sequence',v_sequence,'status',v_status,'lastEvent',public.faolla_attendance_event_receipt_v1(v_last)),
    'receipt',public.faolla_attendance_event_receipt_v1(v_receipt),'replayed',v_replayed);
end;
$$;
revoke all on function public.faolla_attendance_self_v1(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_v1(text,uuid,jsonb,uuid) to service_role;

comment on function public.faolla_attendance_self_v1(text,uuid,jsonb,uuid) is
  'Service-only self attendance: authenticated password principal supplied by server. Settings and web channel default off. Current role/membership lock, per-worker serialization, idempotent immutable receipts. No direct event DML grant.';
comment on table public.merchant_attendance_events is
  'Immutable attendance facts. Runtime writes only through authorized atomic RPCs; no direct service DML. Corrections and lawful retention/erasure require separately authorized workflows.';
insert into public.faolla_schema_migrations(version,name)
values (202609290063,'merchant_attendance_self_clock') on conflict(version) do nothing;
commit;
