-- Durable employee-invitation delivery on the generic merchant outbox.
--
-- Delivery messages contain only the stable Faolla fragment credential. The
-- raw credential and provider action link never cross this database boundary:
-- workers deterministically derive the credential and prepare stores only its
-- SHA-256/HMAC digest on the employee invitation generation.

begin;

do $$
begin
  if to_regclass('public.merchant_enterprise_employees') is null
     or to_regclass('auth.users') is null
     or to_regclass('public.merchant_enterprise_audit_events') is null
     or to_regclass('public.merchant_outbox_events') is null
     or to_regclass('public.merchant_outbox_attempts') is null
     or to_regclass('public.merchant_outbox_replays') is null
     or to_regclass('public.merchant_idempotency_keys') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_create_merchant_enterprise_employee_v1(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_authorize_merchant_enterprise_employee_actor_v1(jsonb,uuid,boolean)'
     ) is null
     or to_regprocedure(
       'public.faolla_claim_enterprise_structure_operation_v1(text,text,text,text)'
     ) is null
     or to_regprocedure(
       'public.faolla_complete_enterprise_structure_operation_v1(text,text,jsonb)'
     ) is null
     or to_regprocedure('public.faolla_enqueue_merchant_outbox_v1(jsonb)') is null
     or to_regprocedure(
       'public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)'
     ) is null
     or to_regprocedure(
       'public.faolla_bind_merchant_employee_auth_user_v1(jsonb)'
     ) is null
     or to_regprocedure(
       'public.faolla_get_merchant_outbox_health_v1(text,integer)'
     ) is null then
    raise exception 'merchant_enterprise_invitation_delivery_prerequisite_missing';
  end if;
end;
$$;

commit;

-- A cancelled concurrent build can leave an invalid same-named index. Always
-- remove it before rebuilding, and do all potentially long scans before any
-- new invitation behaviour is installed.
drop index concurrently if exists
  public.merchant_enterprise_employees_invitation_exchange_idx;
create unique index concurrently
  merchant_enterprise_employees_invitation_exchange_idx
  on public.merchant_enterprise_employees(
    merchant_id,
    invitation_version,
    invitation_token_hash
  )
  where status = 'invited'
    and accepted_at is null
    and invitation_token_hash is not null;

drop index concurrently if exists
  public.merchant_outbox_enterprise_invitation_due_idx;
create index concurrently
  merchant_outbox_enterprise_invitation_due_idx
  on public.merchant_outbox_events(
    merchant_id,
    priority,
    available_at,
    created_at,
    id
  )
  where event_type = 'enterprise.employee_invitation.deliver'
    and status in ('pending', 'failed')
    and dead_lettered_at is null;

drop index concurrently if exists
  public.merchant_outbox_enterprise_invitation_lease_idx;
create index concurrently
  merchant_outbox_enterprise_invitation_lease_idx
  on public.merchant_outbox_events(
    merchant_id,
    lease_expires_at,
    id
  )
  where event_type = 'enterprise.employee_invitation.deliver'
    and status = 'processing';

begin;

-- Exact, global identity mapping for merchant staff. Only hashes of normalized
-- email addresses are retained; the employees table remains the sole source of
-- the delivery address.
create table if not exists public.merchant_enterprise_staff_identities (
  auth_user_id uuid primary key,
  email_hash text not null unique
    check (email_hash ~ '^[0-9a-f]{64}$'),
  principal_type text not null default 'merchant_staff'
    check (principal_type = 'merchant_staff'),
  created_at timestamptz not null default now()
);

-- Rate buckets contain no request fingerprint, address, token, or provider
-- material. Rows expire after 48 hours and are pruned in bounded batches.
create table if not exists
  public.merchant_enterprise_invitation_exchange_rate_buckets (
    merchant_id text not null,
    employee_id uuid not null,
    invitation_version bigint not null check (invitation_version > 0),
    window_kind text not null
      check (window_kind in ('ten_minute', 'utc_day')),
    window_started_at timestamptz not null,
    window_ends_at timestamptz not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    last_attempt_at timestamptz not null default now(),
    expires_at timestamptz not null,
    primary key (
      merchant_id,
      employee_id,
      invitation_version,
      window_kind,
      window_started_at
    ),
    foreign key (merchant_id, employee_id)
      references public.merchant_enterprise_employees(merchant_id, id)
      on delete cascade
  );

create index if not exists
  merchant_enterprise_invitation_exchange_rate_expiry_idx
  on public.merchant_enterprise_invitation_exchange_rate_buckets(expires_at);

-- Supabase magic links are single-current-link credentials. This global row
-- serializes issuance for one Auth user across all merchants/generations, so a
-- duplicate click cannot invalidate a link generated moments earlier.
create table if not exists
  public.merchant_enterprise_invitation_exchange_issuances (
    auth_user_id uuid primary key,
    merchant_id text not null,
    employee_id uuid not null,
    invitation_version bigint not null check (invitation_version > 0),
    issuance_id uuid not null unique,
    state text not null check (state in ('claimed', 'issued')),
    claimed_at timestamptz not null,
    issued_at timestamptz null,
    expires_at timestamptz not null,
    check (
      (state = 'claimed' and issued_at is null)
      or (state = 'issued' and issued_at is not null)
    )
  );

create index if not exists
  merchant_enterprise_invitation_exchange_issuance_expiry_idx
  on public.merchant_enterprise_invitation_exchange_issuances(expires_at);

alter table public.merchant_enterprise_staff_identities enable row level security;
alter table public.merchant_enterprise_invitation_exchange_rate_buckets
  enable row level security;
alter table public.merchant_enterprise_invitation_exchange_issuances
  enable row level security;

revoke all on table public.merchant_enterprise_staff_identities
  from public, anon, authenticated, service_role;
revoke all on table
  public.merchant_enterprise_invitation_exchange_rate_buckets
  from public, anon, authenticated, service_role;
revoke all on table public.merchant_enterprise_invitation_exchange_issuances
  from public, anon, authenticated, service_role;

create or replace function
  public.faolla_reject_merchant_enterprise_staff_identity_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'merchant_enterprise_staff_identity_immutable';
end;
$$;

drop trigger if exists merchant_enterprise_staff_identities_immutable
  on public.merchant_enterprise_staff_identities;
create trigger merchant_enterprise_staff_identities_immutable
before update or delete on public.merchant_enterprise_staff_identities
for each row execute function
  public.faolla_reject_merchant_enterprise_staff_identity_mutation_v1();
alter table public.merchant_enterprise_staff_identities
  enable always trigger merchant_enterprise_staff_identities_immutable;

-- Refuse rollout if historical rows already disagree about an Auth identity.
-- This happens before the trigger is attached to employee writes, preserving
-- the old V1 behaviour if migration cannot establish an exact registry.
do $$
begin
  if exists (
    select 1
      from (
        select
          encode(
            digest(convert_to(lower(btrim(email)), 'UTF8'), 'sha256'),
            'hex'
          ) as email_hash
        from public.merchant_enterprise_employees
        where auth_user_id is not null
        group by 1
        having count(distinct auth_user_id) > 1
      ) as conflict
  ) or exists (
    select 1
      from (
        select auth_user_id
        from public.merchant_enterprise_employees
        where auth_user_id is not null
        group by auth_user_id
        having count(distinct lower(btrim(email))) > 1
      ) as conflict
  ) then
    raise exception 'merchant_enterprise_staff_identity_backfill_conflict';
  end if;
end;
$$;

insert into public.merchant_enterprise_staff_identities (
  auth_user_id,
  email_hash
)
select distinct
  employee.auth_user_id,
  encode(
    digest(convert_to(lower(btrim(employee.email)), 'UTF8'), 'sha256'),
    'hex'
  )
from public.merchant_enterprise_employees as employee
where employee.auth_user_id is not null
on conflict (auth_user_id) do nothing;

create or replace function
  public.faolla_sync_merchant_enterprise_staff_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_hash text;
  v_existing public.merchant_enterprise_staff_identities%rowtype;
begin
  if new.auth_user_id is null then
    return new;
  end if;

  v_email_hash := encode(
    digest(convert_to(lower(btrim(new.email)), 'UTF8'), 'sha256'),
    'hex'
  );

  select *
    into v_existing
    from public.merchant_enterprise_staff_identities
   where auth_user_id = new.auth_user_id
      or email_hash = v_email_hash
   order by auth_user_id
   limit 1;

  if found then
    if v_existing.auth_user_id <> new.auth_user_id
       or v_existing.email_hash <> v_email_hash then
      raise exception 'merchant_enterprise_staff_identity_conflict';
    end if;
    return new;
  end if;

  begin
    insert into public.merchant_enterprise_staff_identities (
      auth_user_id,
      email_hash
    ) values (
      new.auth_user_id,
      v_email_hash
    );
  exception
    when unique_violation then
      select *
        into v_existing
        from public.merchant_enterprise_staff_identities
       where auth_user_id = new.auth_user_id
          or email_hash = v_email_hash
       order by auth_user_id
       limit 1;
      if not found
         or v_existing.auth_user_id <> new.auth_user_id
         or v_existing.email_hash <> v_email_hash then
        raise exception 'merchant_enterprise_staff_identity_conflict';
      end if;
  end;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_employees_staff_identity_sync
  on public.merchant_enterprise_employees;
create trigger merchant_enterprise_employees_staff_identity_sync
after insert or update of auth_user_id, email
on public.merchant_enterprise_employees
for each row execute function
  public.faolla_sync_merchant_enterprise_staff_identity_v1();

-- Invitation event seed fields are immutable, and every mutable diagnostic or
-- result is constrained to a bounded non-secret vocabulary. This also protects
-- against direct use of the generic outbox completion/failure RPCs.
create or replace function
  public.faolla_guard_merchant_enterprise_invitation_outbox_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation_version_text text;
  v_result_version_text text;
  v_allowed_result_keys text[] := array['invitation_version', 'status'];
begin
  if tg_op = 'DELETE' then
    if old.event_type = 'enterprise.employee_invitation.deliver' then
      raise exception 'merchant_enterprise_invitation_event_immutable';
    end if;
    return old;
  end if;

  if new.event_type <> 'enterprise.employee_invitation.deliver'
     and not (
       tg_op = 'UPDATE'
       and old.event_type = 'enterprise.employee_invitation.deliver'
     ) then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.merchant_id is distinct from old.merchant_id
    or new.event_key is distinct from old.event_key
    or new.event_type is distinct from old.event_type
    or new.aggregate_type is distinct from old.aggregate_type
    or new.aggregate_id is distinct from old.aggregate_id
    or new.payload is distinct from old.payload
    or new.max_attempts is distinct from old.max_attempts
    or new.priority is distinct from old.priority
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'merchant_enterprise_invitation_event_seed_immutable';
  end if;

  v_invitation_version_text := new.payload ->> 'invitation_version';
  if new.aggregate_type <> 'merchant_enterprise_employee'
     or new.aggregate_id !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or new.event_key <>
       'enterprise-invitation/' || lower(new.aggregate_id) || '/' ||
       coalesce(v_invitation_version_text, '')
     or jsonb_typeof(new.payload) <> 'object'
     or (select array_agg(key order by key)
           from jsonb_object_keys(new.payload) as payload_key(key)) <>
       array['hmac_key_id', 'invitation_version', 'schema_version']::text[]
     or jsonb_typeof(new.payload -> 'schema_version') <> 'number'
     or new.payload ->> 'schema_version' <> '1'
     or jsonb_typeof(new.payload -> 'invitation_version') <> 'number'
     or v_invitation_version_text !~ '^[1-9][0-9]{0,17}$'
     or jsonb_typeof(new.payload -> 'hmac_key_id') <> 'string'
     or coalesce(new.payload ->> 'hmac_key_id', '') !~
       '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' then
    raise exception 'invalid_merchant_enterprise_invitation_event';
  end if;

  if new.last_error_code is not null and (
    new.last_error is distinct from new.last_error_code
    or new.last_error_code not in (
      'invitation_email_unavailable',
      'invitation_identity_unavailable',
      'staff_identity_conflict',
      'resend_rate_limited',
      'task_timeout',
      'task_aborted',
      'lease_expired',
      'worker_unavailable',
      'provider_unavailable'
    )
  ) then
    raise exception 'invalid_merchant_enterprise_invitation_error';
  end if;
  if new.last_error_code is null and new.last_error is not null then
    raise exception 'invalid_merchant_enterprise_invitation_error';
  end if;

  if new.result is not null then
    v_result_version_text := new.result ->> 'invitation_version';
    if jsonb_typeof(new.result) <> 'object'
       or (select array_agg(key order by key)
             from jsonb_object_keys(new.result) as result_key(key)) <>
         v_allowed_result_keys
       or jsonb_typeof(new.result -> 'status') <> 'string'
       or new.result ->> 'status' not in (
         'sent', 'accepted', 'revoked', 'removed', 'superseded'
       )
       or jsonb_typeof(new.result -> 'invitation_version') <> 'number'
       or v_result_version_text !~ '^[1-9][0-9]{0,17}$'
       or v_result_version_text <> v_invitation_version_text then
      raise exception 'invalid_merchant_enterprise_invitation_result';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists merchant_enterprise_invitation_outbox_guard
  on public.merchant_outbox_events;
create trigger merchant_enterprise_invitation_outbox_guard
before insert or update or delete on public.merchant_outbox_events
for each row execute function
  public.faolla_guard_merchant_enterprise_invitation_outbox_v1();
alter table public.merchant_outbox_events
  enable always trigger merchant_enterprise_invitation_outbox_guard;

-- Terminal employee transitions cancel any still-runnable generation. This is
-- deliberately an employee trigger so legacy V1 accept/revoke/remove calls are
-- covered during the rolling deployment as well as the new outbox RPCs.
create or replace function
  public.faolla_cancel_merchant_enterprise_invitation_outbox_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terminal_status text;
  v_merchant_id text;
  v_employee_id uuid;
  v_max_generation bigint;
  v_auth_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_terminal_status := 'removed';
    v_merchant_id := old.merchant_id;
    v_employee_id := old.id;
    v_max_generation := old.invitation_version;
    v_auth_user_id := old.auth_user_id;
  elsif new.status = 'active' or new.accepted_at is not null then
    v_terminal_status := 'accepted';
    v_merchant_id := new.merchant_id;
    v_employee_id := new.id;
    v_max_generation := new.invitation_version;
    v_auth_user_id := new.auth_user_id;
  elsif new.invitation_revoked_at is not null
        and old.invitation_revoked_at is distinct from new.invitation_revoked_at then
    v_terminal_status := 'revoked';
    v_merchant_id := new.merchant_id;
    v_employee_id := new.id;
    v_max_generation := old.invitation_version;
    v_auth_user_id := coalesce(new.auth_user_id, old.auth_user_id);
  elsif new.invitation_version > old.invitation_version then
    v_terminal_status := 'superseded';
    v_merchant_id := new.merchant_id;
    v_employee_id := new.id;
    v_max_generation := old.invitation_version;
    v_auth_user_id := coalesce(new.auth_user_id, old.auth_user_id);
  else
    return null;
  end if;

  update public.merchant_outbox_attempts as attempt
     set outcome = 'completed',
         finished_at = now(),
         error_code = null,
         error_message = null,
         next_available_at = null
    from public.merchant_outbox_events as event
   where event.id = attempt.event_id
     and event.event_type = 'enterprise.employee_invitation.deliver'
     and event.merchant_id = v_merchant_id
     and event.aggregate_id = v_employee_id::text
     and event.status = 'processing'
     and attempt.attempt_number = event.total_attempts
     and attempt.outcome = 'processing'
     and (event.payload ->> 'invitation_version')::bigint <= v_max_generation;

  update public.merchant_outbox_events as event
     set status = 'completed',
         completed_at = now(),
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         dead_lettered_at = null,
         last_error = null,
         last_error_code = null,
         result = jsonb_build_object(
           'status', v_terminal_status,
           'invitation_version',
             (event.payload ->> 'invitation_version')::bigint
         )
   where event.event_type = 'enterprise.employee_invitation.deliver'
     and event.merchant_id = v_merchant_id
     and event.aggregate_id = v_employee_id::text
     and event.status in ('pending', 'processing', 'failed')
     and (event.payload ->> 'invitation_version')::bigint <= v_max_generation;

  if v_auth_user_id is not null then
    delete from public.merchant_enterprise_invitation_exchange_issuances
     where auth_user_id = v_auth_user_id
       and merchant_id = v_merchant_id
       and employee_id = v_employee_id
       and invitation_version = v_max_generation;
  end if;
  return null;
end;
$$;

drop trigger if exists merchant_enterprise_invitation_cancel_outbox
  on public.merchant_enterprise_employees;
create trigger merchant_enterprise_invitation_cancel_outbox
after update or delete on public.merchant_enterprise_employees
for each row execute function
  public.faolla_cancel_merchant_enterprise_invitation_outbox_v1();
alter table public.merchant_enterprise_employees
  enable always trigger merchant_enterprise_invitation_cancel_outbox;

create or replace function
  public.faolla_enqueue_merchant_enterprise_invitation_generation_v1(
    p_employee public.merchant_enterprise_employees,
    p_hmac_key_id text
  )
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enqueued jsonb;
begin
  if p_employee.id is null
     or p_employee.merchant_id is null
     or p_employee.invitation_version <= 0
     or p_hmac_key_id is null
     or p_hmac_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' then
    raise exception 'invalid_merchant_enterprise_invitation_event';
  end if;

  v_enqueued := public.faolla_enqueue_merchant_outbox_v1(
    jsonb_build_object(
      'merchant_id', p_employee.merchant_id,
      'event_key',
        'enterprise-invitation/' || p_employee.id::text || '/' ||
        p_employee.invitation_version::text,
      'event_type', 'enterprise.employee_invitation.deliver',
      'aggregate_type', 'merchant_enterprise_employee',
      'aggregate_id', p_employee.id::text,
      'payload', jsonb_build_object(
        'schema_version', 1,
        'invitation_version', p_employee.invitation_version,
        'hmac_key_id', p_hmac_key_id
      ),
      'max_attempts', 8,
      'priority', 40,
      'correlation_id',
        'enterprise-invitation/' || p_employee.id::text || '/' ||
        p_employee.invitation_version::text
    )
  );
  return (v_enqueued ->> 'id')::uuid;
end;
$$;

create or replace function
  public.faolla_recheck_merchant_employee_invitation_exchange_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_employee_id uuid;
  v_auth_user_id uuid;
  v_invitation_version bigint;
  v_issuance_id uuid;
  v_token_hash text;
  v_now timestamptz := statement_timestamp();
  v_email_hash text;
begin
  begin
    v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
    v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
    v_auth_user_id := nullif(btrim(p_input ->> 'auth_user_id'), '')::uuid;
    v_invitation_version :=
      nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
    v_issuance_id := nullif(btrim(p_input ->> 'issuance_id'), '')::uuid;
    v_token_hash := lower(coalesce(btrim(p_input ->> 'token_hash'), ''));
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('valid', false);
  end;
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_employee_id is null
     or v_auth_user_id is null
     or v_invitation_version is null or v_invitation_version <= 0
     or v_issuance_id is null
     or v_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('valid', false);
  end if;
  select encode(
           digest(convert_to(lower(btrim(employee.email)), 'UTF8'), 'sha256'),
           'hex'
         )
    into v_email_hash
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = v_employee_id
     and employee.auth_user_id = v_auth_user_id
     and employee.status = 'invited'
     and employee.accepted_at is null
     and employee.invitation_version = v_invitation_version
     and employee.invitation_token_hash = v_token_hash
     and employee.invitation_revoked_at is null
     and employee.invitation_expires_at > v_now;
  if not found then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object(
    'valid', exists (
      select 1
        from public.merchant_enterprise_staff_identities as identity
        join public.merchant_enterprise_invitation_exchange_issuances as issuance
          on issuance.auth_user_id = identity.auth_user_id
       where identity.auth_user_id = v_auth_user_id
         and identity.email_hash = v_email_hash
         and issuance.merchant_id = v_site_id
         and issuance.employee_id = v_employee_id
         and issuance.invitation_version = v_invitation_version
         and issuance.issuance_id = v_issuance_id
         and issuance.state = 'issued'
         and issuance.expires_at > v_now
    ),
    'issuance_id', v_issuance_id
  );
end;
$$;

revoke all on function
  public.faolla_enqueue_merchant_enterprise_invitation_generation_v1(
    public.merchant_enterprise_employees,
    text
  ) from public, anon, authenticated, service_role;

create or replace function
  public.faolla_create_merchant_enterprise_employee_invitation_v2(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_operation_id text;
  v_hmac_key_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_cache jsonb;
  v_created jsonb;
  v_employee_id uuid;
  v_event_id uuid;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_delivery_status text;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'hmac_key_id'), '') <> 'string' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_hmac_key_id := nullif(btrim(p_input ->> 'hmac_key_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_operation_id is null
     or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or v_hmac_key_id is null
     or v_hmac_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' then
    raise exception 'invalid_employee_invitation';
  end if;

  v_idempotency_key :=
    'enterprise-employee-invitation-create-v2:' || v_operation_id;
  v_request_hash := encode(digest(convert_to(jsonb_build_object(
    'merchant_id', v_site_id,
    'email', lower(btrim(p_input ->> 'email')),
    'display_name', btrim(p_input ->> 'display_name'),
    'role_id', lower(btrim(p_input ->> 'role_id')),
    'actor_type', btrim(p_input ->> 'actor_type'),
    'actor_id', lower(btrim(p_input ->> 'actor_id'))
  )::text, 'UTF8'), 'sha256'), 'hex');

  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_employee_invitation_create_v2',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    v_cache := v_claim -> 'response';
    v_employee_id := (v_cache ->> 'employee_id')::uuid;
    perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
      p_input,
      v_employee_id,
      true
    );
    select * into v_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id and id = v_employee_id;
    if not found then
      raise exception 'employee_not_found';
    end if;
    select status into v_delivery_status
      from public.merchant_outbox_events
     where id = (v_cache ->> 'event_id')::uuid
       and merchant_id = v_site_id
       and event_type = 'enterprise.employee_invitation.deliver'
       and aggregate_id = v_employee_id::text
       and (payload ->> 'invitation_version')::bigint =
         (v_cache ->> 'invitation_version')::bigint;
    if not found then
      raise exception 'enterprise_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'employee', to_jsonb(v_employee) - 'invitation_token_hash',
      'invitation_version', (v_cache ->> 'invitation_version')::bigint,
      'event_id', (v_cache ->> 'event_id')::uuid,
      'delivery_status', case
        when v_delivery_status in ('pending', 'processing', 'failed')
          then 'already_queued'
        else 'queued'
      end,
      'replayed', false
    );
  end if;

  -- The established V1 function remains the atomic authorization and role-fit
  -- boundary. Extra V2 fields are ignored by that rolling-compatible surface.
  v_created := public.faolla_create_merchant_enterprise_employee_v1(p_input);
  v_employee_id := (v_created -> 'employee' ->> 'id')::uuid;
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input,
    'invitation.reserve',
    'input'
  );
  update public.merchant_enterprise_employees
     set invitation_version = greatest(invitation_version, 0) + 1,
         invitation_token_hash = null,
         invitation_expires_at = statement_timestamp() + interval '7 days',
         invitation_revoked_at = null,
         invitation_sent_at = null,
         invitation_delivery_status = 'sending',
         invited_at = statement_timestamp()
   where merchant_id = v_site_id
     and id = v_employee_id
     and status = 'invited'
     and accepted_at is null
  returning * into v_employee;
  if not found then
    raise exception 'employee_invitation_not_pending';
  end if;

  v_event_id :=
    public.faolla_enqueue_merchant_enterprise_invitation_generation_v1(
      v_employee,
      v_hmac_key_id
    );
  v_cache := jsonb_build_object(
    'employee_id', v_employee.id,
    'event_id', v_event_id,
    'invitation_version', v_employee.invitation_version
  );
  perform public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_cache
  );

  return jsonb_build_object(
    'employee', to_jsonb(v_employee) - 'invitation_token_hash',
    'invitation_version', v_employee.invitation_version,
    'event_id', v_event_id,
    'delivery_status', 'queued',
    'replayed', false
  );
end;
$$;

create or replace function
  public.faolla_schedule_merchant_employee_invitation_delivery_v2(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_employee_id_text text;
  v_employee_id uuid;
  v_expected_version_text text;
  v_expected_version bigint;
  v_operation_id text;
  v_action text;
  v_hmac_key_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_cache jsonb;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_event public.merchant_outbox_events%rowtype;
  v_event_found boolean := false;
  v_event_id uuid;
  v_replay_number integer;
  v_replayed boolean := false;
  v_delivery_status text := 'queued';
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'employee_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'action'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'hmac_key_id'), '') <> 'string' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  v_expected_version_text := p_input ->> 'expected_version';
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_action := lower(coalesce(btrim(p_input ->> 'action'), ''));
  v_hmac_key_id := nullif(btrim(p_input ->> 'hmac_key_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_employee_id_text is null
     or v_employee_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_expected_version_text !~ '^[1-9][0-9]{0,17}$'
     or v_operation_id is null
     or v_operation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or v_action not in ('resend', 'renew')
     or v_hmac_key_id is null
     or v_hmac_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_employee_id := v_employee_id_text::uuid;
  v_expected_version := v_expected_version_text::bigint;

  -- Authorization deliberately precedes idempotency lookup, including cached
  -- retries, so a removed manager cannot replay another actor's response.
  perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
    p_input,
    v_employee_id,
    true
  );

  v_idempotency_key :=
    'enterprise-employee-invitation-schedule-v2:' || v_operation_id;
  v_request_hash := encode(digest(convert_to(jsonb_build_object(
    'merchant_id', v_site_id,
    'employee_id', v_employee_id,
    'expected_version', v_expected_version,
    'action', v_action,
    'actor_type', btrim(p_input ->> 'actor_type'),
    'actor_id', lower(btrim(p_input ->> 'actor_id'))
  )::text, 'UTF8'), 'sha256'), 'hex');
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_employee_invitation_schedule_v2',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    v_cache := v_claim -> 'response';
    select * into v_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id and id = v_employee_id;
    if not found then
      raise exception 'employee_not_found';
    end if;
    select * into v_event
      from public.merchant_outbox_events
     where id = (v_cache ->> 'event_id')::uuid
       and merchant_id = v_site_id
       and event_type = 'enterprise.employee_invitation.deliver'
       and aggregate_id = v_employee_id::text
       and (payload ->> 'invitation_version')::bigint =
         (v_cache ->> 'invitation_version')::bigint;
    if not found then
      raise exception 'enterprise_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'employee', to_jsonb(v_employee) - 'invitation_token_hash',
      'invitation_version', (v_cache ->> 'invitation_version')::bigint,
      'event_id', (v_cache ->> 'event_id')::uuid,
      'delivery_status', 'already_queued',
      'replayed', coalesce((v_cache ->> 'replayed')::boolean, false)
    );
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  if v_employee.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_employee.status <> 'invited' or v_employee.accepted_at is not null then
    raise exception 'employee_invitation_not_pending';
  end if;
  if v_action = 'resend' and (
    v_employee.invitation_revoked_at is not null
    or not coalesce(
      v_employee.invitation_expires_at > statement_timestamp(),
      false
    )
  ) then
    raise exception 'employee_invitation_renew_required';
  end if;

  select * into v_event
    from public.merchant_outbox_events
   where merchant_id = v_site_id
     and event_type = 'enterprise.employee_invitation.deliver'
     and aggregate_id = v_employee_id::text
     and (payload ->> 'invitation_version')::bigint =
       v_employee.invitation_version
   for update;
  v_event_found := found;

  if v_action = 'renew' then
    if v_event_found
       and v_employee.invitation_revoked_at is null
       and coalesce(v_employee.invitation_expires_at > statement_timestamp(), false) then
      raise exception 'employee_invitation_renew_not_required';
    end if;
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      p_input,
      'invitation.reserve',
      'input'
    );
    update public.merchant_enterprise_employees
       set invitation_version = invitation_version + 1,
           invitation_token_hash = null,
           invitation_expires_at = statement_timestamp() + interval '7 days',
           invitation_revoked_at = null,
           invitation_sent_at = null,
           invitation_delivery_status = 'sending',
           invited_at = statement_timestamp()
     where merchant_id = v_site_id
       and id = v_employee_id
       and version = v_expected_version
    returning * into v_employee;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
    v_event_id :=
      public.faolla_enqueue_merchant_enterprise_invitation_generation_v1(
        v_employee,
        v_hmac_key_id
      );
  elsif not v_event_found then
    -- A legacy/random-token generation cannot be deterministically rebuilt.
    -- Never turn an explicit resend into a silent generation rotation.
    raise exception 'employee_invitation_renew_required';
  elsif v_event.status in ('pending', 'processing')
        or (v_event.status = 'failed' and v_event.dead_lettered_at is null) then
    v_event_id := v_event.id;
    v_delivery_status := 'already_queued';
  else
    if coalesce(
      v_event.last_replayed_at,
      v_event.completed_at,
      v_event.updated_at
    ) > statement_timestamp() - interval '60 seconds' then
      raise exception 'invitation_delivery_cooldown';
    end if;

    v_replay_number := v_event.replay_count + 1;
    insert into public.merchant_outbox_replays (
      event_id,
      replay_number,
      replayed_by,
      reason_code
    ) values (
      v_event.id,
      v_replay_number,
      case lower(btrim(p_input ->> 'actor_type'))
        when 'owner' then 'enterprise-invitation-owner'
        else 'enterprise-invitation-employee'
      end,
      'employee_invitation_resend'
    );
    update public.merchant_outbox_events
       set status = 'pending',
           attempts = 0,
           available_at = statement_timestamp(),
           locked_at = null,
           locked_by = null,
           lease_expires_at = null,
           completed_at = null,
           dead_lettered_at = null,
           last_error = null,
           last_error_code = null,
           result = null,
           replay_count = v_replay_number,
           last_replayed_at = statement_timestamp(),
           last_replay_reason = 'employee_invitation_resend'
     where id = v_event.id;
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      p_input,
      'invitation.reserve',
      'input'
    );
    update public.merchant_enterprise_employees
       set invitation_delivery_status = 'sending',
           invitation_sent_at = null
     where merchant_id = v_site_id and id = v_employee_id
    returning * into v_employee;
    v_event_id := v_event.id;
    v_replayed := true;
  end if;

  v_cache := jsonb_build_object(
    'employee_id', v_employee.id,
    'event_id', v_event_id,
    'invitation_version', v_employee.invitation_version,
    'replayed', v_replayed
  );
  perform public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_cache
  );
  return jsonb_build_object(
    'employee', to_jsonb(v_employee) - 'invitation_token_hash',
    'invitation_version', v_employee.invitation_version,
    'event_id', v_event_id,
    'delivery_status', v_delivery_status,
    'replayed', v_replayed
  );
end;
$$;

create or replace function
  public.faolla_prepare_merchant_employee_invitation_delivery_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id_text text;
  v_event_id uuid;
  v_worker_id text;
  v_token_hash text;
  v_event public.merchant_outbox_events%rowtype;
  v_employee_id uuid;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_invitation_version bigint;
  v_email_hash text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_invitation_delivery_prepare';
  end if;
  v_event_id_text := nullif(btrim(p_input ->> 'event_id'), '');
  v_worker_id := nullif(btrim(p_input ->> 'worker_id'), '');
  v_token_hash := lower(coalesce(btrim(p_input ->> 'token_hash'), ''));
  if v_event_id_text is null
     or v_event_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invitation_delivery_prepare';
  end if;
  v_event_id := v_event_id_text::uuid;

  -- Read the immutable seed without a lock to discover the employee, then use
  -- the repository-wide employee -> event lock order and recheck all runtime
  -- state under lock.
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
     and event_type = 'enterprise.employee_invitation.deliver';
  if not found then
    raise exception 'invitation_delivery_event_not_found';
  end if;
  v_employee_id := v_event.aggregate_id::uuid;
  v_invitation_version := (v_event.payload ->> 'invitation_version')::bigint;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_event.merchant_id and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
   for update;
  if v_event.event_type <> 'enterprise.employee_invitation.deliver'
     or v_event.aggregate_id <> v_employee_id::text
     or (v_event.payload ->> 'invitation_version')::bigint <>
       v_invitation_version
     or v_event.status <> 'processing'
     or v_event.locked_by <> v_worker_id
     or not coalesce(v_event.lease_expires_at > statement_timestamp(), false) then
    raise exception 'invitation_delivery_lease_lost';
  end if;
  if v_employee.status <> 'invited'
     or v_employee.accepted_at is not null
     or v_employee.invitation_version <> v_invitation_version
     or v_employee.invitation_revoked_at is not null
     or not coalesce(
       v_employee.invitation_expires_at > statement_timestamp(),
       false
     ) then
    raise exception 'employee_invitation_superseded';
  end if;
  if v_employee.invitation_token_hash is not null
     and v_employee.invitation_token_hash <> v_token_hash then
    raise exception 'invitation_delivery_token_conflict';
  end if;

  if v_employee.invitation_token_hash is null then
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      '{}'::jsonb,
      'invitation.reserve',
      'system'
    );
    update public.merchant_enterprise_employees
       set invitation_token_hash = v_token_hash,
           invitation_delivery_status = 'sending'
     where merchant_id = v_employee.merchant_id
       and id = v_employee.id
       and version = v_employee.version
       and invitation_version = v_invitation_version
       and invitation_token_hash is null
    returning * into v_employee;
    if not found then
      raise exception 'invitation_delivery_prepare_conflict';
    end if;
  end if;

  v_email_hash := encode(
    digest(convert_to(lower(btrim(v_employee.email)), 'UTF8'), 'sha256'),
    'hex'
  );
  return jsonb_build_object(
    'event_id', v_event.id,
    'merchant_id', v_employee.merchant_id,
    'employee_id', v_employee.id,
    'employee_version', v_employee.version,
    'invitation_version', v_employee.invitation_version,
    'hmac_key_id', v_event.payload ->> 'hmac_key_id',
    'email', v_employee.email,
    'email_hash', v_email_hash,
    'auth_user_id', v_employee.auth_user_id,
    'invitation_expires_at', v_employee.invitation_expires_at
  );
end;
$$;

create or replace function
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(
    p_email_hash text
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email_hash text := lower(coalesce(btrim(p_email_hash), ''));
  v_auth_user_id uuid;
  v_match_count bigint := 0;
  v_is_staff_identity boolean := false;
begin
  if v_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_merchant_enterprise_staff_identity_hash';
  end if;
  select auth_user_id into v_auth_user_id
    from public.merchant_enterprise_staff_identities
   where email_hash = v_email_hash;
  if found then
    return jsonb_build_object(
      'found', true,
      'auth_user_id', v_auth_user_id,
      'source', 'registry'
    );
  end if;

  -- Recovery path for createUser success followed by a lost response. A plain
  -- Auth account is never adopted. The worker must have created one unique
  -- merchant_staff principal with an immutable copy of this exact email hash
  -- in app_metadata; bind will atomically materialize the registry row.
  select candidate.id,
         candidate.match_count,
         candidate.is_staff_identity
    into v_auth_user_id, v_match_count, v_is_staff_identity
    from (
      select
        auth_user.id,
        count(*) over () as match_count,
        coalesce(auth_user.raw_app_meta_data ->> 'principal_type', '') =
          'merchant_staff'
        and coalesce(
          auth_user.raw_app_meta_data ->> 'merchant_staff_email_hash',
          ''
        ) = v_email_hash as is_staff_identity
      from auth.users as auth_user
      where auth_user.email is not null
        and encode(
          digest(
            convert_to(lower(btrim(auth_user.email)), 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = v_email_hash
    ) as candidate
   limit 1;
  if not found then
    return jsonb_build_object(
      'found', false,
      'auth_user_id', null,
      'source', 'none'
    );
  end if;
  if v_match_count <> 1 or not v_is_staff_identity then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;
  return jsonb_build_object(
    'found', true,
    'auth_user_id', v_auth_user_id,
    'source', 'auth_recovery'
  );
end;
$$;

create or replace function
  public.faolla_bind_merchant_employee_invitation_identity_v2(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id_text text;
  v_event_id uuid;
  v_worker_id text;
  v_auth_user_id_text text;
  v_auth_user_id uuid;
  v_email_hash text;
  v_event public.merchant_outbox_events%rowtype;
  v_employee_id uuid;
  v_invitation_version bigint;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_identity public.merchant_enterprise_staff_identities%rowtype;
  v_response jsonb;
  v_auth_match_count bigint := 0;
  v_auth_is_staff boolean := false;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_auth_binding';
  end if;
  v_event_id_text := nullif(btrim(p_input ->> 'event_id'), '');
  v_worker_id := nullif(btrim(p_input ->> 'worker_id'), '');
  v_auth_user_id_text := nullif(btrim(p_input ->> 'auth_user_id'), '');
  v_email_hash := lower(coalesce(btrim(p_input ->> 'email_hash'), ''));
  if v_event_id_text is null
     or v_event_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or v_auth_user_id_text is null
     or v_auth_user_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_employee_auth_binding';
  end if;
  v_event_id := v_event_id_text::uuid;
  v_auth_user_id := v_auth_user_id_text::uuid;

  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
     and event_type = 'enterprise.employee_invitation.deliver';
  if not found then
    raise exception 'invitation_delivery_event_not_found';
  end if;
  v_employee_id := v_event.aggregate_id::uuid;
  v_invitation_version := (v_event.payload ->> 'invitation_version')::bigint;
  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_event.merchant_id and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
   for update;
  if v_event.status <> 'processing'
     or v_event.locked_by <> v_worker_id
     or not coalesce(v_event.lease_expires_at > statement_timestamp(), false)
     or v_employee.invitation_version <> v_invitation_version
     or v_employee.status <> 'invited'
     or v_employee.accepted_at is not null
     or v_employee.invitation_token_hash is null
     or v_employee.invitation_revoked_at is not null
     or not coalesce(
       v_employee.invitation_expires_at > statement_timestamp(),
       false
     ) then
    raise exception 'invitation_delivery_lease_lost';
  end if;
  if encode(
    digest(convert_to(lower(btrim(v_employee.email)), 'UTF8'), 'sha256'),
    'hex'
  ) <> v_email_hash then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;

  select * into v_identity
    from public.merchant_enterprise_staff_identities
   where auth_user_id = v_auth_user_id
      or email_hash = v_email_hash
   order by auth_user_id
   limit 1;
  if found and (
    v_identity.auth_user_id <> v_auth_user_id
    or v_identity.email_hash <> v_email_hash
  ) then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;
  if not found then
    select candidate.match_count, candidate.is_staff
      into v_auth_match_count, v_auth_is_staff
      from (
        select
          count(*) over () as match_count,
          coalesce(auth_user.raw_app_meta_data ->> 'principal_type', '') =
            'merchant_staff'
          and coalesce(
            auth_user.raw_app_meta_data ->> 'merchant_staff_email_hash',
            ''
          ) = v_email_hash as is_staff
        from auth.users as auth_user
        where auth_user.id = v_auth_user_id
          and auth_user.email is not null
          and encode(
            digest(
              convert_to(lower(btrim(auth_user.email)), 'UTF8'),
              'sha256'
            ),
            'hex'
          ) = v_email_hash
      ) as candidate
     limit 1;
    if not found
       or v_auth_match_count <> 1
       or not v_auth_is_staff
       or exists (
         select 1
           from auth.users as other_auth_user
          where other_auth_user.id <> v_auth_user_id
            and other_auth_user.email is not null
            and encode(
              digest(
                convert_to(lower(btrim(other_auth_user.email)), 'UTF8'),
                'sha256'
              ),
              'hex'
            ) = v_email_hash
       ) then
      raise exception 'merchant_enterprise_staff_identity_conflict';
    end if;
    begin
      insert into public.merchant_enterprise_staff_identities (
        auth_user_id,
        email_hash
      ) values (
        v_auth_user_id,
        v_email_hash
      );
    exception
      when unique_violation then
        raise exception 'merchant_enterprise_staff_identity_conflict';
    end;
  end if;

  v_response := public.faolla_bind_merchant_employee_auth_user_v1(
    jsonb_build_object(
      'merchant_id', v_employee.merchant_id,
      'employee_id', v_employee.id,
      'auth_user_id', v_auth_user_id,
      'expected_version', v_employee.version,
      'invitation_version', v_invitation_version
    )
  );
  return v_response;
end;
$$;

create or replace function
  public.faolla_complete_merchant_employee_invitation_delivery_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id_text text;
  v_event_id uuid;
  v_worker_id text;
  v_event public.merchant_outbox_events%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_employee_id uuid;
  v_invitation_version bigint;
  v_email_hash text;
  v_completed boolean;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_invitation_delivery_completion';
  end if;
  v_event_id_text := nullif(btrim(p_input ->> 'event_id'), '');
  v_worker_id := nullif(btrim(p_input ->> 'worker_id'), '');
  if v_event_id_text is null
     or v_event_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
    raise exception 'invalid_invitation_delivery_completion';
  end if;
  v_event_id := v_event_id_text::uuid;
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
     and event_type = 'enterprise.employee_invitation.deliver';
  if not found then
    raise exception 'invitation_delivery_event_not_found';
  end if;
  v_employee_id := v_event.aggregate_id::uuid;
  v_invitation_version := (v_event.payload ->> 'invitation_version')::bigint;
  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_event.merchant_id and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
   for update;
  if v_employee.auth_user_id is null then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;
  v_email_hash := encode(
    digest(convert_to(lower(btrim(v_employee.email)), 'UTF8'), 'sha256'),
    'hex'
  );
  if not exists (
    select 1
      from public.merchant_enterprise_staff_identities as identity
     where identity.auth_user_id = v_employee.auth_user_id
       and identity.email_hash = v_email_hash
  ) then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;
  if v_event.status = 'completed'
     and v_event.result = jsonb_build_object(
       'status', 'sent',
       'invitation_version', v_invitation_version
     ) then
    return jsonb_build_object(
      'employee', to_jsonb(v_employee) - 'invitation_token_hash',
      'event_id', v_event.id,
      'invitation_version', v_invitation_version,
      'delivery_status', 'sent',
      'already_completed', true
    );
  end if;
  if v_event.status <> 'processing'
     or v_event.locked_by <> v_worker_id
     or not coalesce(v_event.lease_expires_at > statement_timestamp(), false)
     or v_employee.status <> 'invited'
     or v_employee.accepted_at is not null
     or v_employee.invitation_version <> v_invitation_version
     or v_employee.invitation_token_hash is null
     or v_employee.invitation_revoked_at is not null
     or not coalesce(
       v_employee.invitation_expires_at > statement_timestamp(),
       false
     )
     or v_employee.auth_user_id is null then
    raise exception 'invitation_delivery_lease_lost';
  end if;

  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    '{}'::jsonb,
    'invitation.finalize',
    'system'
  );
  update public.merchant_enterprise_employees
     set invitation_delivery_status = 'sent',
         invitation_sent_at = statement_timestamp()
   where merchant_id = v_employee.merchant_id
     and id = v_employee.id
     and version = v_employee.version
     and invitation_version = v_invitation_version
  returning * into v_employee;
  if not found then
    raise exception 'invitation_delivery_completion_conflict';
  end if;

  v_completed := public.faolla_complete_merchant_outbox_v1(
    v_event.id,
    v_worker_id,
    jsonb_build_object(
      'status', 'sent',
      'invitation_version', v_invitation_version
    )
  );
  if not v_completed then
    raise exception 'invitation_delivery_lease_lost';
  end if;
  return jsonb_build_object(
    'employee', to_jsonb(v_employee) - 'invitation_token_hash',
    'event_id', v_event.id,
    'invitation_version', v_invitation_version,
    'delivery_status', 'sent',
    'already_completed', false
  );
end;
$$;

create or replace function
  public.faolla_fail_merchant_employee_invitation_delivery_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id_text text;
  v_event_id uuid;
  v_worker_id text;
  v_error_code text;
  v_retryable boolean;
  v_retry_after_seconds integer;
  v_event public.merchant_outbox_events%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_employee_id uuid;
  v_invitation_version bigint;
  v_result jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_invitation_delivery_failure';
  end if;
  v_event_id_text := nullif(btrim(p_input ->> 'event_id'), '');
  v_worker_id := nullif(btrim(p_input ->> 'worker_id'), '');
  v_error_code := lower(coalesce(btrim(p_input ->> 'error_code'), ''));
  if v_event_id_text is null
     or v_event_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or v_error_code not in (
       'invitation_email_unavailable',
       'invitation_identity_unavailable',
       'staff_identity_conflict',
       'resend_rate_limited',
       'task_timeout',
       'task_aborted',
       'lease_expired',
       'worker_unavailable',
       'provider_unavailable'
     ) then
    raise exception 'invalid_invitation_delivery_failure';
  end if;
  if p_input ? 'retryable'
     and jsonb_typeof(p_input -> 'retryable') <> 'boolean' then
    raise exception 'invalid_invitation_delivery_failure';
  end if;
  if p_input ? 'retry_after_seconds' and (
    jsonb_typeof(p_input -> 'retry_after_seconds') <> 'number'
    or (p_input ->> 'retry_after_seconds') !~ '^[0-9]{1,5}$'
  ) then
    raise exception 'invalid_invitation_delivery_failure';
  end if;
  v_retryable := coalesce((p_input ->> 'retryable')::boolean, true);
  v_retry_after_seconds := case
    when p_input ? 'retry_after_seconds'
      then (p_input ->> 'retry_after_seconds')::integer
    else null
  end;
  v_event_id := v_event_id_text::uuid;

  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
     and event_type = 'enterprise.employee_invitation.deliver';
  if not found then
    raise exception 'invitation_delivery_event_not_found';
  end if;
  v_employee_id := v_event.aggregate_id::uuid;
  v_invitation_version := (v_event.payload ->> 'invitation_version')::bigint;
  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_event.merchant_id and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  select * into v_event
    from public.merchant_outbox_events
   where id = v_event_id
   for update;
  if v_event.status = 'failed' and v_event.locked_by is null then
    v_result := public.faolla_fail_merchant_outbox_v1(
      v_event.id,
      v_worker_id,
      v_error_code,
      v_error_code,
      v_retryable,
      v_retry_after_seconds
    );
    if coalesce(v_result ->> 'status', '') not in (
      'retry_scheduled',
      'dead_lettered'
    ) then
      raise exception 'invitation_delivery_lease_lost';
    end if;
    return v_result || jsonb_build_object(
      'event_id', v_event.id,
      'invitation_version', v_invitation_version,
      'already_failed', true
    );
  end if;
  if v_event.status <> 'processing'
     or v_event.locked_by <> v_worker_id
     or not coalesce(v_event.lease_expires_at > statement_timestamp(), false) then
    raise exception 'invitation_delivery_lease_lost';
  end if;

  v_result := public.faolla_fail_merchant_outbox_v1(
    v_event.id,
    v_worker_id,
    v_error_code,
    v_error_code,
    v_retryable,
    v_retry_after_seconds
  );
  if v_result ->> 'status' = 'dead_lettered'
     and v_employee.status = 'invited'
     and v_employee.accepted_at is null
     and v_employee.invitation_version = v_invitation_version
     and v_employee.invitation_revoked_at is null
     and v_employee.invitation_delivery_status <> 'failed' then
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      '{}'::jsonb,
      'invitation.finalize',
      'system'
    );
    update public.merchant_enterprise_employees
       set invitation_delivery_status = 'failed',
           invitation_sent_at = null
     where merchant_id = v_employee.merchant_id
       and id = v_employee.id
       and version = v_employee.version
       and invitation_version = v_invitation_version;
  end if;
  return v_result || jsonb_build_object(
    'event_id', v_event.id,
    'invitation_version', v_invitation_version,
    'already_failed', false
  );
end;
$$;

create or replace function
  public.faolla_discover_merchant_enterprise_invitation_merchants_v1(
    p_after_merchant_id text default null,
    p_limit integer default 100
  )
returns table(merchant_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_after text := nullif(btrim(p_after_merchant_id), '');
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
begin
  if v_after is not null and v_after !~ '^[0-9]{8}$' then
    raise exception 'invalid_invitation_delivery_merchant_cursor';
  end if;
  return query
    select distinct event.merchant_id
      from public.merchant_outbox_events as event
     where event.event_type = 'enterprise.employee_invitation.deliver'
       and event.status in ('pending', 'failed', 'processing')
       and (
         (event.status in ('pending', 'failed')
          and event.dead_lettered_at is null
          and event.attempts < event.max_attempts
          and event.available_at <= statement_timestamp())
         or (event.status = 'processing'
             and event.lease_expires_at <= statement_timestamp())
       )
       and (v_after is null or event.merchant_id > v_after)
     order by event.merchant_id
     limit v_limit;
end;
$$;

create or replace function
  public.faolla_begin_merchant_employee_invitation_exchange_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_invitation_version_text text;
  v_invitation_version bigint;
  v_token_hash text;
  v_attempt_id_text text;
  v_attempt_id uuid;
  v_lease_seconds_text text;
  v_lease_seconds integer;
  v_now timestamptz := statement_timestamp();
  v_ten_start timestamptz;
  v_ten_end timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_ten_count integer;
  v_day_count integer;
  v_retry_after integer := 0;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_email_hash text;
  v_issuance public.merchant_enterprise_invitation_exchange_issuances%rowtype;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'invitation_version'), '') <> 'number'
     or coalesce(jsonb_typeof(p_input -> 'token_hash'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'attempt_id'), '') <> 'string'
     or coalesce(
       jsonb_typeof(p_input -> 'issuance_lease_seconds'),
       ''
     ) <> 'number' then
    raise exception 'invalid_invitation_exchange';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_invitation_version_text := p_input ->> 'invitation_version';
  v_token_hash := lower(coalesce(btrim(p_input ->> 'token_hash'), ''));
  v_attempt_id_text := lower(coalesce(btrim(p_input ->> 'attempt_id'), ''));
  v_lease_seconds_text := p_input ->> 'issuance_lease_seconds';
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_invitation_version_text !~ '^[1-9][0-9]{0,17}$'
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_attempt_id_text !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_lease_seconds_text !~ '^[0-9]{2,5}$' then
    raise exception 'invalid_invitation_exchange';
  end if;
  v_invitation_version := v_invitation_version_text::bigint;
  v_attempt_id := v_attempt_id_text::uuid;
  v_lease_seconds := v_lease_seconds_text::integer;
  if v_lease_seconds < 60 or v_lease_seconds > 86400 then
    raise exception 'invalid_invitation_exchange_lease';
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and invitation_version = v_invitation_version
     and invitation_token_hash = v_token_hash
     and status = 'invited'
     and accepted_at is null
     and invitation_revoked_at is null
     and invitation_expires_at > v_now
   for share;
  if not found or v_employee.auth_user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'invalid_or_expired',
      'retry_after_seconds', 0
    );
  end if;
  v_email_hash := encode(
    digest(convert_to(lower(btrim(v_employee.email)), 'UTF8'), 'sha256'),
    'hex'
  );
  if not exists (
    select 1
      from public.merchant_enterprise_staff_identities as identity
     where identity.auth_user_id = v_employee.auth_user_id
       and identity.email_hash = v_email_hash
  ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'identity_mismatch',
      'retry_after_seconds', 0
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'faolla-enterprise-invitation-issuance:' || v_employee.auth_user_id::text,
    0
  ));
  select * into v_issuance
    from public.merchant_enterprise_invitation_exchange_issuances
   where auth_user_id = v_employee.auth_user_id
   for update;
  if found and v_issuance.expires_at > v_now then
    v_retry_after := least(
      86400,
      greatest(1, ceil(extract(epoch from (v_issuance.expires_at - v_now)))::integer)
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'issuance_cooldown',
      'duplicate_attempt',
        v_issuance.issuance_id = v_attempt_id
        and v_issuance.merchant_id = v_site_id
        and v_issuance.employee_id = v_employee.id
        and v_issuance.invitation_version = v_invitation_version,
      'issuance_id', case
        when v_issuance.issuance_id = v_attempt_id
         and v_issuance.merchant_id = v_site_id
         and v_issuance.employee_id = v_employee.id
         and v_issuance.invitation_version = v_invitation_version
          then v_attempt_id
        else null
      end,
      'issuance_state', case
        when v_issuance.issuance_id = v_attempt_id
         and v_issuance.merchant_id = v_site_id
         and v_issuance.employee_id = v_employee.id
         and v_issuance.invitation_version = v_invitation_version
          then v_issuance.state
        else null
      end,
      'retry_after_seconds', v_retry_after
    );
  elsif found then
    delete from public.merchant_enterprise_invitation_exchange_issuances
     where auth_user_id = v_employee.auth_user_id
       and issuance_id = v_issuance.issuance_id;
  end if;

  if exists (
    select 1
      from public.merchant_enterprise_invitation_exchange_issuances
     where issuance_id = v_attempt_id
  ) then
    raise exception 'invitation_exchange_attempt_conflict';
  end if;

  -- Bounded retention cleanup. It never changes the security decision above.
  delete from public.merchant_enterprise_invitation_exchange_issuances
   where ctid in (
     select ctid
       from public.merchant_enterprise_invitation_exchange_issuances
      where expires_at <= v_now
      order by expires_at
      limit 100
   );
  delete from public.merchant_enterprise_invitation_exchange_rate_buckets
   where ctid in (
     select ctid
       from public.merchant_enterprise_invitation_exchange_rate_buckets
      where expires_at <= v_now
      order by expires_at
      limit 100
   );

  v_ten_start := to_timestamp(
    (floor(extract(epoch from v_now) / 600) * 600)::double precision
  );
  v_ten_end := v_ten_start + interval '10 minutes';
  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_end := v_day_start + interval '1 day';

  insert into public.merchant_enterprise_invitation_exchange_rate_buckets (
    merchant_id,
    employee_id,
    invitation_version,
    window_kind,
    window_started_at,
    window_ends_at,
    attempt_count,
    last_attempt_at,
    expires_at
  ) values (
    v_site_id,
    v_employee.id,
    v_invitation_version,
    'ten_minute',
    v_ten_start,
    v_ten_end,
    1,
    v_now,
    v_ten_end + interval '48 hours'
  )
  on conflict (
    merchant_id,
    employee_id,
    invitation_version,
    window_kind,
    window_started_at
  ) do update
     set attempt_count = least(
           public.merchant_enterprise_invitation_exchange_rate_buckets.attempt_count + 1,
           6
         ),
         last_attempt_at = excluded.last_attempt_at
  returning attempt_count into v_ten_count;

  insert into public.merchant_enterprise_invitation_exchange_rate_buckets (
    merchant_id,
    employee_id,
    invitation_version,
    window_kind,
    window_started_at,
    window_ends_at,
    attempt_count,
    last_attempt_at,
    expires_at
  ) values (
    v_site_id,
    v_employee.id,
    v_invitation_version,
    'utc_day',
    v_day_start,
    v_day_end,
    1,
    v_now,
    v_day_end + interval '48 hours'
  )
  on conflict (
    merchant_id,
    employee_id,
    invitation_version,
    window_kind,
    window_started_at
  ) do update
     set attempt_count = least(
           public.merchant_enterprise_invitation_exchange_rate_buckets.attempt_count + 1,
           21
         ),
         last_attempt_at = excluded.last_attempt_at
  returning attempt_count into v_day_count;

  if v_ten_count > 5 or v_day_count > 20 then
    v_retry_after := greatest(
      case when v_ten_count > 5 then
        ceil(extract(epoch from (v_ten_end - v_now)))::integer
      else 0 end,
      case when v_day_count > 20 then
        ceil(extract(epoch from (v_day_end - v_now)))::integer
      else 0 end
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'duplicate_attempt', false,
      'retry_after_seconds', least(86400, greatest(1, v_retry_after))
    );
  end if;

  begin
    insert into public.merchant_enterprise_invitation_exchange_issuances (
      auth_user_id,
      merchant_id,
      employee_id,
      invitation_version,
      issuance_id,
      state,
      claimed_at,
      issued_at,
      expires_at
    ) values (
      v_employee.auth_user_id,
      v_site_id,
      v_employee.id,
      v_invitation_version,
      v_attempt_id,
      'claimed',
      v_now,
      null,
      v_now + make_interval(secs => v_lease_seconds)
    );
  exception when unique_violation then
    raise exception 'invitation_exchange_attempt_conflict';
  end;

  return jsonb_build_object(
    'allowed', true,
    'duplicate_attempt', false,
    'issuance_id', v_attempt_id,
    'lease_until', v_now + make_interval(secs => v_lease_seconds),
    'retry_after_seconds', 0,
    'merchant_id', v_site_id,
    'employee_id', v_employee.id,
    'employee_version', v_employee.version,
    'invitation_version', v_invitation_version,
    'auth_user_id', v_employee.auth_user_id,
    'email', v_employee.email,
    'email_hash', v_email_hash
  );
end;
$$;

create or replace function
  public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_employee_id uuid;
  v_auth_user_id uuid;
  v_invitation_version bigint;
  v_issuance_id uuid;
  v_token_hash text;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
  v_issuance public.merchant_enterprise_invitation_exchange_issuances%rowtype;
  v_email_hash text;
begin
  -- The caller invokes this only after generateLink returned and its Auth user
  -- and target were checked exactly. Once generateLink has been invoked, even
  -- an exception must leave the claimed full-TTL lease in place; release is no
  -- longer part of that error path.
  begin
    v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
    v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
    v_auth_user_id := nullif(btrim(p_input ->> 'auth_user_id'), '')::uuid;
    v_invitation_version :=
      nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
    v_issuance_id := nullif(btrim(p_input ->> 'issuance_id'), '')::uuid;
    v_token_hash := lower(coalesce(btrim(p_input ->> 'token_hash'), ''));
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_invitation_exchange';
  end;
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_employee_id is null
     or v_auth_user_id is null
     or v_invitation_version is null or v_invitation_version <= 0
     or v_issuance_id is null
     or v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invitation_exchange';
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
     and auth_user_id = v_auth_user_id
     and status = 'invited'
     and accepted_at is null
     and invitation_version = v_invitation_version
     and invitation_token_hash = v_token_hash
     and invitation_revoked_at is null
     and invitation_expires_at > v_now
   for share;
  if not found then
    raise exception 'invitation_exchange_superseded';
  end if;
  v_email_hash := encode(
    digest(convert_to(lower(btrim(v_employee.email)), 'UTF8'), 'sha256'),
    'hex'
  );
  if not exists (
    select 1
      from public.merchant_enterprise_staff_identities as identity
     where identity.auth_user_id = v_auth_user_id
       and identity.email_hash = v_email_hash
  ) then
    raise exception 'merchant_enterprise_staff_identity_conflict';
  end if;
  select * into v_issuance
    from public.merchant_enterprise_invitation_exchange_issuances
   where auth_user_id = v_auth_user_id
     and merchant_id = v_site_id
     and employee_id = v_employee_id
     and invitation_version = v_invitation_version
     and issuance_id = v_issuance_id
   for update;
  if not found or v_issuance.expires_at <= v_now then
    raise exception 'invitation_exchange_lease_lost';
  end if;
  if v_issuance.state = 'issued' then
    return jsonb_build_object(
      'issued', true,
      'already_issued', true,
      'issuance_id', v_issuance_id,
      'lease_until', v_issuance.expires_at
    );
  end if;
  update public.merchant_enterprise_invitation_exchange_issuances
     set state = 'issued',
         issued_at = v_now
   where auth_user_id = v_auth_user_id
     and issuance_id = v_issuance_id
     and state = 'claimed'
  returning * into v_issuance;
  if not found then
    raise exception 'invitation_exchange_lease_lost';
  end if;
  return jsonb_build_object(
    'issued', true,
    'already_issued', false,
    'issuance_id', v_issuance_id,
    'lease_until', v_issuance.expires_at
  );
end;
$$;

create or replace function
  public.faolla_release_merchant_employee_invitation_exchange_v1(
    p_input jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_employee_id uuid;
  v_auth_user_id uuid;
  v_invitation_version bigint;
  v_issuance_id uuid;
  v_deleted integer := 0;
begin
  -- This is exclusively the pre-generate compensation. Issued rows are never
  -- releasable, and a claimed row is intentionally retained when generateLink
  -- may already have run.
  begin
    v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
    v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
    v_auth_user_id := nullif(btrim(p_input ->> 'auth_user_id'), '')::uuid;
    v_invitation_version :=
      nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
    v_issuance_id := nullif(btrim(p_input ->> 'issuance_id'), '')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_invitation_exchange';
  end;
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_employee_id is null
     or v_auth_user_id is null
     or v_invitation_version is null or v_invitation_version <= 0
     or v_issuance_id is null then
    raise exception 'invalid_invitation_exchange';
  end if;
  delete from public.merchant_enterprise_invitation_exchange_issuances
   where auth_user_id = v_auth_user_id
     and merchant_id = v_site_id
     and employee_id = v_employee_id
     and invitation_version = v_invitation_version
     and issuance_id = v_issuance_id
     and state = 'claimed';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object(
    'released', v_deleted = 1,
    'issuance_id', v_issuance_id
  );
end;
$$;

-- Preserve the current outbox health contract while registering the invitation
-- handler as known. Without this, every queued invitation is a false critical
-- unknown-event alarm even though the dedicated worker is installed.
create or replace function
  public.faolla_get_merchant_outbox_health_v1(
    p_merchant_id text default null,
    p_window_hours integer default 24
  )
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_merchant_id text := nullif(btrim(p_merchant_id), '');
  v_window_hours integer := least(168, greatest(1, coalesce(p_window_hours, 24)));
  v_result jsonb;
begin
  if v_merchant_id is not null and v_merchant_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_outbox_health_merchant_id';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'merchant_scope', coalesce(v_merchant_id, 'all'),
    'window_hours', v_window_hours,
    'pending_count', count(*) filter (
      where event.status = 'pending'
        and event.dead_lettered_at is null
    ),
    'retry_scheduled_count', count(*) filter (
      where event.status = 'failed'
        and event.dead_lettered_at is null
    ),
    'processing_count', count(*) filter (
      where event.status = 'processing'
    ),
    'completed_count', count(*) filter (
      where event.status = 'completed'
    ),
    'dead_letter_count', count(*) filter (
      where event.dead_lettered_at is not null
    ),
    'due_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.available_at <= now()
    ),
    'scheduled_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.available_at > now()
    ),
    'expired_lease_count', count(*) filter (
      where event.status = 'processing'
        and coalesce(event.lease_expires_at <= now(), true)
    ),
    'attempt_limit_risk_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.attempts >= greatest(1, event.max_attempts - 1)
    ),
    'unknown_event_type_count', count(*) filter (
      where event.event_type not in (
        'merchant.notification.deliver',
        'google.reviews.sync',
        'asset.convert',
        'site.publish.follow_up',
        'backup.create',
        'webhook.deliver',
        'enterprise.workflow_automation.process',
        'enterprise.employee_invitation.deliver'
      )
    ),
    'oldest_due_age_seconds', coalesce(
      extract(epoch from (
        now() - min(event.available_at) filter (
          where event.status in ('pending', 'failed')
            and event.dead_lettered_at is null
            and event.available_at <= now()
        )
      ))::bigint,
      0
    ),
    'attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'completed_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'completed'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'retry_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'retry_scheduled'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'dead_letter_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'dead_lettered'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'lease_expired_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'lease_expired'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    )
  )
    into v_result
    from public.merchant_outbox_events event
   where v_merchant_id is null or event.merchant_id = v_merchant_id;

  return v_result;
end;
$$;

revoke all on function
  public.faolla_reject_merchant_enterprise_staff_identity_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_sync_merchant_enterprise_staff_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_guard_merchant_enterprise_invitation_outbox_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_cancel_merchant_enterprise_invitation_outbox_v1()
  from public, anon, authenticated, service_role;

revoke all on function
  public.faolla_create_merchant_enterprise_employee_invitation_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_schedule_merchant_employee_invitation_delivery_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_prepare_merchant_employee_invitation_delivery_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_complete_merchant_employee_invitation_delivery_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_fail_merchant_employee_invitation_delivery_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_discover_merchant_enterprise_invitation_merchants_v1(
    text,
    integer
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_begin_merchant_employee_invitation_exchange_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_release_merchant_employee_invitation_exchange_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_recheck_merchant_employee_invitation_exchange_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.faolla_get_merchant_outbox_health_v1(text, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  public.faolla_create_merchant_enterprise_employee_invitation_v2(jsonb)
  to service_role;
grant execute on function
  public.faolla_schedule_merchant_employee_invitation_delivery_v2(jsonb)
  to service_role;
grant execute on function
  public.faolla_prepare_merchant_employee_invitation_delivery_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_lookup_merchant_enterprise_staff_identity_v1(text)
  to service_role;
grant execute on function
  public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)
  to service_role;
grant execute on function
  public.faolla_complete_merchant_employee_invitation_delivery_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_fail_merchant_employee_invitation_delivery_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_discover_merchant_enterprise_invitation_merchants_v1(
    text,
    integer
  ) to service_role;
grant execute on function
  public.faolla_begin_merchant_employee_invitation_exchange_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_release_merchant_employee_invitation_exchange_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_recheck_merchant_employee_invitation_exchange_v1(jsonb)
  to service_role;
grant execute on function
  public.faolla_get_merchant_outbox_health_v1(text, integer)
  to service_role;

-- Do not advertise 033 until every non-transactional index is live, valid,
-- attached to the expected table, and contains the canonical ordered keys and
-- partial predicate. This makes a failed concurrent build safely retryable.
do $$
declare
  v_definition text;
  v_predicate text;
  v_ready boolean;
begin
  select
    index_metadata.indisready
      and index_metadata.indisvalid
      and index_metadata.indislive
      and index_metadata.indisunique
      and index_metadata.indnkeyatts = 3
      and table_relation.relname = 'merchant_enterprise_employees',
    lower(pg_get_indexdef(index_relation.oid)),
    lower(pg_get_expr(index_metadata.indpred, index_metadata.indrelid))
    into v_ready, v_definition, v_predicate
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
   where index_namespace.nspname = 'public'
     and index_relation.relname =
       'merchant_enterprise_employees_invitation_exchange_idx';
  if not coalesce(v_ready, false)
     or position(
       '(merchant_id, invitation_version, invitation_token_hash)'
       in coalesce(v_definition, '')
     ) = 0
     or position('status' in coalesce(v_predicate, '')) = 0
     or position('invited' in coalesce(v_predicate, '')) = 0
     or position('accepted_at is null' in coalesce(v_predicate, '')) = 0
     or position(
       'invitation_token_hash is not null'
       in coalesce(v_predicate, '')
     ) = 0 then
    raise exception 'merchant_enterprise_invitation_exchange_index_invalid';
  end if;

  select
    index_metadata.indisready
      and index_metadata.indisvalid
      and index_metadata.indislive
      and index_metadata.indnkeyatts = 5
      and table_relation.relname = 'merchant_outbox_events',
    lower(pg_get_indexdef(index_relation.oid)),
    lower(pg_get_expr(index_metadata.indpred, index_metadata.indrelid))
    into v_ready, v_definition, v_predicate
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
   where index_namespace.nspname = 'public'
     and index_relation.relname =
       'merchant_outbox_enterprise_invitation_due_idx';
  if not coalesce(v_ready, false)
     or position(
       '(merchant_id, priority, available_at, created_at, id)'
       in coalesce(v_definition, '')
     ) = 0
     or position(
       'enterprise.employee_invitation.deliver'
       in coalesce(v_predicate, '')
     ) = 0
     or position('dead_lettered_at is null' in coalesce(v_predicate, '')) = 0
     or position('pending' in coalesce(v_predicate, '')) = 0
     or position('failed' in coalesce(v_predicate, '')) = 0 then
    raise exception 'merchant_enterprise_invitation_due_index_invalid';
  end if;

  select
    index_metadata.indisready
      and index_metadata.indisvalid
      and index_metadata.indislive
      and index_metadata.indnkeyatts = 3
      and table_relation.relname = 'merchant_outbox_events',
    lower(pg_get_indexdef(index_relation.oid)),
    lower(pg_get_expr(index_metadata.indpred, index_metadata.indrelid))
    into v_ready, v_definition, v_predicate
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
   where index_namespace.nspname = 'public'
     and index_relation.relname =
       'merchant_outbox_enterprise_invitation_lease_idx';
  if not coalesce(v_ready, false)
     or position(
       '(merchant_id, lease_expires_at, id)'
       in coalesce(v_definition, '')
     ) = 0
     or position(
       'enterprise.employee_invitation.deliver'
       in coalesce(v_predicate, '')
     ) = 0
     or position('processing' in coalesce(v_predicate, '')) = 0 then
    raise exception 'merchant_enterprise_invitation_lease_index_invalid';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (202608190033, 'merchant_enterprise_invitation_delivery_outbox')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
