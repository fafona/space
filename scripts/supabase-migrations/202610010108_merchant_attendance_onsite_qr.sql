-- Local/default-off onsite QR candidate. No existing writer, setting or data is
-- changed. The server signs issuance metadata and verifies signatures before
-- supplying claims to this service-only writer. A QR is NOT employee identity.
begin;
set local lock_timeout='3s';

create table public.merchant_attendance_onsite_receipts (
  event_id uuid primary key references public.merchant_attendance_events(id) on delete restrict,
  merchant_id text not null, worker_id uuid not null, employee_id uuid not null,
  terminal_id uuid not null, operation_id uuid not null, nonce uuid not null,
  claims jsonb not null check(jsonb_typeof(claims)='object'),
  command jsonb not null check(jsonb_typeof(command)='object'),
  unique(merchant_id,worker_id,operation_id),
  -- A store code is shared across employees, not globally single-use. A given
  -- employee must scan a newly issued code for a second business event.
  unique(merchant_id,worker_id,nonce),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  foreign key(merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict
);
alter table public.merchant_attendance_onsite_receipts enable row level security;
revoke all on public.merchant_attendance_onsite_receipts from public,anon,authenticated,service_role;
create trigger attendance_onsite_receipts_no_rewrite before update or delete
  on public.merchant_attendance_onsite_receipts for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_onsite_receipts_no_truncate before truncate
  on public.merchant_attendance_onsite_receipts for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Read-only issuance. Never return a pairing/device hash, employee identity or
-- signing key. The original device RPC authenticates only a paired credential.
create function public.faolla_attendance_onsite_issue_v1(p_site text,p_terminal uuid,p_secret_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  device jsonb; t public.merchant_attendance_terminals%rowtype;
  l public.merchant_attendance_locations%rowtype; now_at timestamptz; issued_ms bigint;
begin
  device:=public.faolla_attendance_terminal_device_v1(p_site,p_terminal,p_secret_hash,null,false);
  if device->>'attendanceEnabled' is distinct from 'true' then raise exception 'attendance_disabled'; end if;
  select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_terminal for share;
  select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=t.location_id for share;
  now_at:=date_trunc('milliseconds',clock_timestamp());
  -- Re-date after every lock wait. Owner/location revocation is checked again.
  if public.faolla_attendance_terminal_snapshot_v1(p_site,p_terminal,now_at)->>'state' is distinct from 'active'
    then raise exception 'attendance_terminal_denied'; end if;
  if l.id is null or not l.active then raise exception 'attendance_location_denied'; end if;
  if l.radius_meters is not null then raise exception 'attendance_location_verification_required'; end if;
  if now_at+interval '45 seconds'>t.device_expires_at then raise exception 'attendance_qr_expired'; end if;
  issued_ms:=floor(extract(epoch from now_at)*1000)::bigint;
  return jsonb_build_object('siteId',p_site,'terminalId',t.id,'locationId',t.location_id,
    'pairedAtMs',floor(extract(epoch from t.paired_at)*1000)::bigint,
    'issuedAtMs',issued_ms,'expiresAtMs',issued_ms+45000);
end; $$;
revoke all on function public.faolla_attendance_onsite_issue_v1(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_onsite_issue_v1(text,uuid,text) to service_role;

create function public.faolla_attendance_onsite_clock_v1(
  p_site text,p_auth uuid,p_claims jsonb,p_command jsonb,p_operation uuid,p_allow_new boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;
  e public.merchant_enterprise_employees%rowtype; r public.merchant_enterprise_roles%rowtype;
  w public.merchant_attendance_workers%rowtype; l public.merchant_attendance_locations%rowtype;
  t public.merchant_attendance_terminals%rowtype;
  last_row public.merchant_attendance_events%rowtype; receipt public.merchant_attendance_events%rowtype;
  binding public.merchant_attendance_onsite_receipts%rowtype;
  op uuid; terminal_now uuid; nonce_now uuid; loc_now uuid; action_now text; expected bigint;
  seq bigint; status_now text; now_at timestamptz; now_ms bigint; today date;
  issued_ms bigint; expires_ms bigint; paired_ms bigint; key_now text; replayed boolean:=false;
  valid_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site is null or p_site !~ '^\d{8}$' or p_auth is null or p_allow_new is null
    then raise exception 'attendance_invalid_request'; end if;
  if p_command is null then
    if p_claims is not null then raise exception 'attendance_invalid_request'; end if;
    op:=p_operation;
  else
    if p_operation is not null or jsonb_typeof(p_command)<>'object'
      or (select count(*) from jsonb_object_keys(p_command))<>6
      or not(p_command ?& array['operationId','locationId','action','expectedSequence','expectedWorkerId','expectedEmployeeId'])
      or coalesce(p_command->>'operationId','') !~ valid_uuid or coalesce(p_command->>'locationId','') !~ valid_uuid
      or coalesce(p_command->>'expectedWorkerId','') !~ valid_uuid or coalesce(p_command->>'expectedEmployeeId','') !~ valid_uuid
      or coalesce(p_command->>'action','') not in ('clock_in','break_start','break_end','clock_out')
      or jsonb_typeof(p_command->'expectedSequence')<>'number'
      or coalesce(p_command->>'expectedSequence','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedSequence')::numeric>9007199254740990
      then raise exception 'attendance_invalid_request'; end if;
    op:=(p_command->>'operationId')::uuid; loc_now:=(p_command->>'locationId')::uuid;
    action_now:=p_command->>'action'; expected:=(p_command->>'expectedSequence')::bigint;
    -- Structural claims are strict even for retries. Freshness is deliberately
    -- checked only for a new event, after all authorization and worker locks.
    if p_claims is null or jsonb_typeof(p_claims)<>'object'
      or (select count(*) from jsonb_object_keys(p_claims))<>9
      or not(p_claims ?& array['v','purpose','siteId','terminalId','locationId','pairedAtMs','issuedAtMs','expiresAtMs','nonce'])
      or p_claims->'v' is distinct from '1'::jsonb
      or p_claims->>'purpose' is distinct from 'faolla.attendance.onsite'
      or jsonb_typeof(p_claims->'siteId')<>'string'
      or p_claims->>'siteId' is distinct from p_site
      or coalesce(p_claims->>'terminalId','') !~ valid_uuid
      or coalesce(p_claims->>'locationId','') !~ valid_uuid
      or coalesce(p_claims->>'nonce','') !~ valid_uuid
      then raise exception 'attendance_qr_invalid'; end if;
    foreach key_now in array array['pairedAtMs','issuedAtMs','expiresAtMs'] loop
      if jsonb_typeof(p_claims->key_now)<>'number'
        or coalesce(p_claims->>key_now,'') !~ '^(0|[1-9][0-9]{0,15})$'
        or (p_claims->>key_now)::numeric>9007199254740991
        then raise exception 'attendance_qr_invalid'; end if;
    end loop;
    terminal_now:=(p_claims->>'terminalId')::uuid; nonce_now:=(p_claims->>'nonce')::uuid;
    paired_ms:=(p_claims->>'pairedAtMs')::bigint; issued_ms:=(p_claims->>'issuedAtMs')::bigint;
    expires_ms:=(p_claims->>'expiresAtMs')::bigint;
    if expires_ms-issued_ms<>45000 or issued_ms<paired_ms then raise exception 'attendance_qr_invalid'; end if;
  end if;

  -- All configuration/terminal administration takes settings FOR UPDATE;
  -- existing employee and role writers use the same membership lock order.
  perform 1 from public.merchants where id=p_site for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site and auth_user_id=p_auth for share;
  if not found or e.status<>'active' then raise exception 'attendance_access_denied'; end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share;
  if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
    or not('attendance.self.view'=any(r.permissions))
    or (p_command is not null and not('attendance.self.clock'=any(r.permissions)))
    then raise exception 'attendance_access_denied'; end if;
  if p_command is null then
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and employee_id=e.id for share;
  else
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and employee_id=e.id for update;
  end if;
  if not found then raise exception 'attendance_access_denied'; end if;
  if p_command is not null and (w.id<>(p_command->>'expectedWorkerId')::uuid
    or e.id<>(p_command->>'expectedEmployeeId')::uuid) then raise exception 'attendance_worker_changed'; end if;
  select * into last_row from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
  -- A rebound worker must not leak the previous employee's receipt/state.
  if last_row.id is not null and last_row.actor_employee_id is distinct from e.id
    then raise exception 'attendance_access_denied'; end if;
  seq:=coalesce(last_row.sequence,0);
  status_now:=case when last_row.id is null or last_row.action='clock_out' then 'off'
    when last_row.action='break_start' then 'break' else 'working' end;
  select * into receipt from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=op;
  if receipt.id is not null then
    select * into binding from public.merchant_attendance_onsite_receipts where event_id=receipt.id;
    if binding.event_id is null or binding.merchant_id<>p_site or binding.worker_id<>w.id
      or binding.operation_id<>op or binding.employee_id<>e.id
      or receipt.actor_employee_id is distinct from e.id or receipt.source<>'web'
      or (p_command is not null and binding.command<>p_command)
      then raise exception 'attendance_operation_conflict'; end if;
    -- An authenticated original receipt remains recoverable after code/device
    -- expiry, revocation, employment or policy changes. This never inserts.
    replayed:=p_command is not null;
  end if;

  if p_command is not null and not replayed then
    if not s.enabled then raise exception 'attendance_disabled'; end if;
    if not w.active then raise exception 'attendance_access_denied'; end if;
    if not p_allow_new and action_now in ('clock_in','break_start') then raise exception 'attendance_platform_paused'; end if;
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=loc_now for share;
    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=terminal_now for share;
    -- Do not use transaction-start time or the earlier server signature check:
    -- waiting for the worker/role/location lock can outlive a displayed code.
    now_at:=date_trunc('milliseconds',clock_timestamp()); now_ms:=floor(extract(epoch from now_at)*1000)::bigint;
    today:=(now_at at time zone s.time_zone)::date;
    if now_ms<issued_ms then raise exception 'attendance_qr_invalid'; end if;
    if now_ms>=expires_ms then raise exception 'attendance_qr_expired'; end if;
    if t.id is null or t.location_id<>(p_claims->>'locationId')::uuid
      or t.location_id<>loc_now or t.paired_at is null
      or floor(extract(epoch from t.paired_at)*1000)::bigint<>paired_ms
      or expires_ms>floor(extract(epoch from t.device_expires_at)*1000)::bigint
      or public.faolla_attendance_terminal_snapshot_v1(p_site,terminal_now,now_at)->>'state' is distinct from 'active'
      then raise exception 'attendance_qr_invalid'; end if;
    if l.id is null or not l.active or w.default_location_id is distinct from loc_now
      then raise exception 'attendance_location_denied'; end if;
    if l.radius_meters is not null then raise exception 'attendance_location_verification_required'; end if;
    if (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id
      and starts_on<=today and (ends_on is null or ends_on>=today))<>1 then raise exception 'attendance_not_employed'; end if;
    if exists(select 1 from public.merchant_attendance_onsite_receipts where merchant_id=p_site and worker_id=w.id and nonce=nonce_now)
      then raise exception 'attendance_qr_used'; end if;
    if seq<>expected then raise exception 'attendance_sequence_conflict'; end if;
    if last_row.id is not null and now_at<last_row.occurred_at then raise exception 'attendance_time_reversed'; end if;
    if action_now='clock_in' and status_now<>'off' then raise exception 'attendance_already_clocked_in'; end if;
    if action_now='break_start' and status_now<>'working' then raise exception 'attendance_not_working'; end if;
    if action_now='break_end' and status_now<>'break' then raise exception 'attendance_not_on_break'; end if;
    if action_now='clock_out' and status_now='break' then raise exception 'attendance_break_must_end'; end if;
    if action_now='clock_out' and status_now='off' then raise exception 'attendance_not_clocked_in'; end if;
    -- Phone-authenticated collection remains source=web so established history,
    -- correction and report contracts remain unchanged. QR provenance is here.
    insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,
      break_paid,occurred_at,received_at,time_zone,actor_employee_id)
      values(p_site,w.id,loc_now,op,seq+1,action_now,'web',case when action_now='break_start' then s.web_break_paid else null end,
        now_at,now_at,l.time_zone,e.id) returning * into receipt;
    insert into public.merchant_attendance_onsite_receipts(event_id,merchant_id,worker_id,employee_id,terminal_id,operation_id,nonce,claims,command)
      values(receipt.id,p_site,w.id,e.id,terminal_now,op,nonce_now,p_claims,p_command);
    last_row:=receipt; seq:=receipt.sequence;
    status_now:=case when action_now='clock_out' then 'off' when action_now='break_start' then 'break' else 'working' end;
  end if;
  return jsonb_build_object('workerId',w.id,'employeeId',e.id,'locationId',w.default_location_id,
    'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),
    'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean) to service_role;

comment on table public.merchant_attendance_onsite_receipts is
  'Immutable onsite QR origin binding for authenticated web events. No signature, device secret or employee credential is stored. Per-worker code consumption, not global QR consumption; current employee authorization required for receipt recovery.';
insert into public.faolla_schema_migrations(version,name) values(202610010108,'merchant_attendance_onsite_qr');
commit;
