begin;

alter table public.merchant_enterprise_employees
  add column if not exists initial_password_policy text;

-- Every invitation that existed before this migration keeps the legacy
-- password contract. Invitations inserted after the migration default to a
-- fail-closed requirement, including during the rolling app deployment.
update public.merchant_enterprise_employees
   set initial_password_policy = 'waived'
 where initial_password_policy is null;

alter table public.merchant_enterprise_employees
  alter column initial_password_policy set default 'required';
alter table public.merchant_enterprise_employees
  alter column initial_password_policy set not null;

do $initial_password_policy_constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_employees_initial_password_policy_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_employees_initial_password_policy_check
      check (initial_password_policy in ('required', 'waived', 'completed'));
  end if;
end;
$initial_password_policy_constraint$;

create table if not exists public.merchant_employee_initial_password_setups (
  employee_id uuid primary key
    references public.merchant_enterprise_employees(id) on delete cascade,
  merchant_id text not null,
  auth_user_id uuid not null,
  invitation_version bigint not null check (invitation_version > 0),
  invitation_token_hash text not null
    check (invitation_token_hash ~ '^[0-9a-f]{64}$'),
  operation_id uuid not null,
  password_fingerprint text not null
    check (password_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('claimed', 'completed')),
  claimed_at timestamptz not null default statement_timestamp(),
  claim_expires_at timestamptz,
  completed_at timestamptz,
  constraint merchant_employee_initial_password_setup_state_check check (
    (state = 'claimed' and claim_expires_at is not null and completed_at is null)
    or (state = 'completed' and claim_expires_at is null and completed_at is not null)
  ),
  unique (merchant_id, auth_user_id)
);

create unique index if not exists
  merchant_employee_initial_password_claim_auth_uidx
  on public.merchant_employee_initial_password_setups(auth_user_id)
  where state = 'claimed';

alter table public.merchant_employee_initial_password_setups enable row level security;
revoke all on table public.merchant_employee_initial_password_setups
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.merchant_employee_initial_password_setups to service_role;

create or replace function public.faolla_claim_merchant_employee_initial_password_setup_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth_user_id uuid;
  v_invitation_version bigint;
  v_token_hash text;
  v_operation_id uuid;
  v_password_fingerprint text;
  v_now timestamptz := statement_timestamp();
  v_claim_expires_at timestamptz := statement_timestamp() + interval '10 minutes';
  v_employee public.merchant_enterprise_employees%rowtype;
  v_setup public.merchant_employee_initial_password_setups%rowtype;
  v_other_setup public.merchant_employee_initial_password_setups%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_initial_password_setup_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth_user_id := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_invitation_version := nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  v_token_hash := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_operation_id := nullif(lower(btrim(p_input ->> 'operation_id')), '')::uuid;
  v_password_fingerprint :=
    nullif(lower(btrim(p_input ->> 'password_fingerprint')), '');

  if v_site_id is null
     or v_auth_user_id is null
     or v_invitation_version is null
     or v_invitation_version <= 0
     or v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_operation_id is null
     or v_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_password_fingerprint is null
     or v_password_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_employee_initial_password_setup';
  end if;

  -- The Auth password belongs to the user, not to one merchant. Serialize all
  -- password setup attempts for this Auth subject across enterprise rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'faolla:merchant-employee-initial-password:' || v_auth_user_id::text,
      202608310043
    )
  );

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
   for update;
  if not found then
    raise exception 'merchant_employee_not_invited';
  end if;
  if v_employee.status <> 'invited' or v_employee.accepted_at is not null then
    raise exception 'employee_invitation_not_pending';
  end if;
  if v_employee.invitation_revoked_at is not null then
    raise exception 'employee_invitation_revoked';
  end if;
  if v_employee.invitation_expires_at is null
     or v_employee.invitation_expires_at <= v_now then
    raise exception 'employee_invitation_expired';
  end if;
  if v_employee.invitation_version is distinct from v_invitation_version
     or v_employee.invitation_token_hash is null
     or v_employee.invitation_token_hash is distinct from v_token_hash then
    raise exception 'employee_invitation_superseded';
  end if;
  if v_employee.initial_password_policy <> 'required' then
    raise exception 'employee_initial_password_not_required';
  end if;

  perform 1
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_employee.role_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'merchant_access_denied';
  end if;

  select *
    into v_other_setup
    from public.merchant_employee_initial_password_setups
   where auth_user_id = v_auth_user_id
     and employee_id <> v_employee.id
     and state = 'claimed'
   order by claimed_at, employee_id
   limit 1
   for update;
  if found then
    if v_other_setup.claim_expires_at <= v_now then
      delete from public.merchant_employee_initial_password_setups
       where employee_id = v_other_setup.employee_id
         and state = 'claimed'
         and claim_expires_at <= v_now;
    else
      raise exception 'employee_initial_password_setup_in_progress';
    end if;
  end if;

  select *
    into v_setup
    from public.merchant_employee_initial_password_setups
   where employee_id = v_employee.id
   for update;

  if found
     and (
       v_setup.invitation_version is distinct from v_invitation_version
       or v_setup.invitation_token_hash is distinct from v_token_hash
     ) then
    delete from public.merchant_employee_initial_password_setups
     where employee_id = v_employee.id;
    v_setup := null;
  end if;

  if v_setup.employee_id is not null then
    if v_setup.state = 'completed' then
      if v_setup.operation_id = v_operation_id
         and v_setup.password_fingerprint = v_password_fingerprint then
        return jsonb_build_object(
          'state', v_setup.state,
          'resumed', true,
          'employee_id', v_setup.employee_id,
          'merchant_id', v_setup.merchant_id,
          'auth_user_id', v_setup.auth_user_id,
          'invitation_version', v_setup.invitation_version,
          'operation_id', v_setup.operation_id,
          'password_fingerprint', v_setup.password_fingerprint
        );
      end if;
      raise exception 'employee_password_already_initialized';
    end if;

    if v_setup.password_fingerprint = v_password_fingerprint then
      update public.merchant_employee_initial_password_setups
         set operation_id = v_operation_id,
             claimed_at = v_now,
             claim_expires_at = v_claim_expires_at
       where employee_id = v_setup.employee_id
         and state = 'claimed'
      returning * into v_setup;
      return jsonb_build_object(
        'state', v_setup.state,
        'resumed', true,
        'employee_id', v_setup.employee_id,
        'merchant_id', v_setup.merchant_id,
        'auth_user_id', v_setup.auth_user_id,
        'invitation_version', v_setup.invitation_version,
        'operation_id', v_setup.operation_id,
        'password_fingerprint', v_setup.password_fingerprint
      );
    end if;

    if v_setup.claim_expires_at <= v_now then
      update public.merchant_employee_initial_password_setups
         set operation_id = v_operation_id,
             password_fingerprint = v_password_fingerprint,
             claimed_at = v_now,
             claim_expires_at = v_claim_expires_at
       where employee_id = v_setup.employee_id
         and state = 'claimed'
         and claim_expires_at <= v_now
      returning * into v_setup;
      if not found then
        raise exception 'employee_initial_password_setup_in_progress';
      end if;
      return jsonb_build_object(
        'state', v_setup.state,
        'resumed', false,
        'employee_id', v_setup.employee_id,
        'merchant_id', v_setup.merchant_id,
        'auth_user_id', v_setup.auth_user_id,
        'invitation_version', v_setup.invitation_version,
        'operation_id', v_setup.operation_id,
        'password_fingerprint', v_setup.password_fingerprint
      );
    end if;
    raise exception 'employee_initial_password_setup_in_progress';
  end if;

  insert into public.merchant_employee_initial_password_setups (
    employee_id,
    merchant_id,
    auth_user_id,
    invitation_version,
    invitation_token_hash,
    operation_id,
    password_fingerprint,
    state,
    claimed_at,
    claim_expires_at,
    completed_at
  ) values (
    v_employee.id,
    v_site_id,
    v_auth_user_id,
    v_invitation_version,
    v_token_hash,
    v_operation_id,
    v_password_fingerprint,
    'claimed',
    v_now,
    v_claim_expires_at,
    null
  )
  returning * into v_setup;

  return jsonb_build_object(
    'state', v_setup.state,
    'resumed', false,
    'employee_id', v_setup.employee_id,
    'merchant_id', v_setup.merchant_id,
    'auth_user_id', v_setup.auth_user_id,
    'invitation_version', v_setup.invitation_version,
    'operation_id', v_setup.operation_id,
    'password_fingerprint', v_setup.password_fingerprint
  );
end;
$$;

create or replace function public.faolla_complete_merchant_employee_initial_password_setup_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth_user_id uuid;
  v_invitation_version bigint;
  v_token_hash text;
  v_operation_id uuid;
  v_password_fingerprint text;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
  v_setup public.merchant_employee_initial_password_setups%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_initial_password_setup_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth_user_id := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_invitation_version := nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  v_token_hash := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_operation_id := nullif(lower(btrim(p_input ->> 'operation_id')), '')::uuid;
  v_password_fingerprint :=
    nullif(lower(btrim(p_input ->> 'password_fingerprint')), '');

  if v_site_id is null
     or v_auth_user_id is null
     or v_invitation_version is null
     or v_invitation_version <= 0
     or v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_operation_id is null
     or v_password_fingerprint is null
     or v_password_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_employee_initial_password_setup';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
   for update;
  if not found then
    raise exception 'merchant_employee_not_invited';
  end if;
  if v_employee.status <> 'invited' or v_employee.accepted_at is not null then
    raise exception 'employee_invitation_not_pending';
  end if;
  if v_employee.invitation_revoked_at is not null then
    raise exception 'employee_invitation_revoked';
  end if;
  if v_employee.invitation_expires_at is null
     or v_employee.invitation_expires_at <= v_now then
    raise exception 'employee_invitation_expired';
  end if;
  if v_employee.invitation_version is distinct from v_invitation_version
     or v_employee.invitation_token_hash is null
     or v_employee.invitation_token_hash is distinct from v_token_hash then
    raise exception 'employee_invitation_superseded';
  end if;
  if v_employee.initial_password_policy not in ('required', 'completed') then
    raise exception 'employee_initial_password_not_required';
  end if;

  perform 1
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_employee.role_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'merchant_access_denied';
  end if;

  select *
    into v_setup
    from public.merchant_employee_initial_password_setups
   where employee_id = v_employee.id
     and merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
     and invitation_version = v_invitation_version
     and invitation_token_hash = v_token_hash
     and operation_id = v_operation_id
     and password_fingerprint = v_password_fingerprint
   for update;
  if not found then
    raise exception 'employee_initial_password_setup_claim_invalid';
  end if;

  if v_setup.state = 'claimed' then
    update public.merchant_employee_initial_password_setups
       set state = 'completed',
           claim_expires_at = null,
           completed_at = v_now
     where employee_id = v_setup.employee_id
       and state = 'claimed'
    returning * into v_setup;
    if not found then
      raise exception 'employee_initial_password_setup_conflict';
    end if;
  end if;

  update public.merchant_enterprise_employees
     set initial_password_policy = 'completed'
   where id = v_employee.id
     and merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
     and invitation_version = v_invitation_version
     and invitation_token_hash = v_token_hash
     and initial_password_policy in ('required', 'completed');
  if not found then
    raise exception 'employee_initial_password_setup_conflict';
  end if;

  return jsonb_build_object(
    'state', v_setup.state,
    'resumed', true,
    'employee_id', v_setup.employee_id,
    'merchant_id', v_setup.merchant_id,
    'auth_user_id', v_setup.auth_user_id,
    'invitation_version', v_setup.invitation_version,
    'operation_id', v_setup.operation_id,
    'password_fingerprint', v_setup.password_fingerprint
  );
end;
$$;

create or replace function public.faolla_release_merchant_employee_initial_password_setup_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  delete from public.merchant_employee_initial_password_setups setup
   using public.merchant_enterprise_employees employee
   where employee.id = setup.employee_id
     and employee.merchant_id = nullif(btrim(p_input ->> 'merchant_id'), '')
     and employee.auth_user_id = nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid
     and setup.invitation_version = nullif(btrim(p_input ->> 'invitation_version'), '')::bigint
     and setup.invitation_token_hash = nullif(lower(btrim(p_input ->> 'token_hash')), '')
     and setup.operation_id = nullif(lower(btrim(p_input ->> 'operation_id')), '')::uuid
     and setup.password_fingerprint = nullif(lower(btrim(p_input ->> 'password_fingerprint')), '')
     and setup.state = 'claimed'
  returning setup.employee_id into v_employee_id;

  return jsonb_build_object('released', v_employee_id is not null);
exception
  when invalid_text_representation then
    raise exception 'invalid_employee_initial_password_setup';
end;
$$;

create table if not exists public.auth_password_recovery_grants (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  auth_user_id uuid,
  session_id text,
  source text not null check (
    source in ('reset_email', 'reset_code', 'typed_recovery')
  ),
  state text not null check (
    state in ('requested', 'ready', 'claimed', 'completed')
  ),
  password_fingerprint text
    check (password_fingerprint is null or password_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  constraint auth_password_recovery_grant_state_check check (
    (state in ('requested', 'ready')
      and password_fingerprint is null
      and claimed_at is null
      and completed_at is null)
    or (state = 'claimed'
      and password_fingerprint is not null
      and claimed_at is not null
      and completed_at is null)
    or (state = 'completed'
      and password_fingerprint is not null
      and claimed_at is not null
      and completed_at is not null)
  )
);

alter table public.auth_password_recovery_grants enable row level security;
revoke all on table public.auth_password_recovery_grants
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.auth_password_recovery_grants to service_role;

create or replace function public.faolla_create_password_recovery_intent_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_email_hash text := nullif(lower(btrim(p_input ->> 'email_hash')), '');
  v_source text := nullif(lower(btrim(p_input ->> 'source')), '');
  v_now timestamptz := statement_timestamp();
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_email_hash is null
     or v_email_hash !~ '^[0-9a-f]{64}$'
     or v_source not in ('reset_email', 'reset_code') then
    raise exception 'invalid_password_recovery_intent';
  end if;

  delete from public.auth_password_recovery_grants
   where expires_at <= v_now - interval '1 day';

  insert into public.auth_password_recovery_grants (
    token_hash,
    email_hash,
    auth_user_id,
    session_id,
    source,
    state,
    password_fingerprint,
    created_at,
    expires_at,
    claimed_at,
    completed_at
  ) values (
    v_token_hash,
    v_email_hash,
    null,
    null,
    v_source,
    'requested',
    null,
    v_now,
    v_now + interval '30 minutes',
    null,
    null
  );

  return jsonb_build_object('created', true, 'state', 'requested');
exception
  when unique_violation then
    raise exception 'password_recovery_intent_conflict';
end;
$$;

create or replace function public.faolla_activate_password_recovery_grant_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_email_hash text := nullif(lower(btrim(p_input ->> 'email_hash')), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_session_id text := nullif(btrim(p_input ->> 'session_id'), '');
  v_proof_kind text := nullif(lower(btrim(p_input ->> 'proof_kind')), '');
  v_now timestamptz := statement_timestamp();
  v_grant public.auth_password_recovery_grants%rowtype;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_email_hash is null
     or v_email_hash !~ '^[0-9a-f]{64}$'
     or v_auth_user_id is null
     or v_session_id is null
     or length(v_session_id) > 160
     or v_proof_kind is null
     or v_proof_kind not in ('requested_intent', 'typed_recovery') then
    raise exception 'invalid_password_recovery_grant';
  end if;

  select *
    into v_grant
    from public.auth_password_recovery_grants
   where token_hash = v_token_hash
   for update;

  if not found then
    if v_proof_kind is distinct from 'typed_recovery' then
      raise exception 'password_recovery_intent_invalid_or_expired';
    end if;
    insert into public.auth_password_recovery_grants (
      token_hash,
      email_hash,
      auth_user_id,
      session_id,
      source,
      state,
      password_fingerprint,
      created_at,
      expires_at,
      claimed_at,
      completed_at
    ) values (
      v_token_hash,
      v_email_hash,
      v_auth_user_id,
      v_session_id,
      'typed_recovery',
      'ready',
      null,
      v_now,
      v_now + interval '30 minutes',
      null,
      null
    )
    returning * into v_grant;
  else
    if v_grant.expires_at <= v_now
       or v_grant.email_hash <> v_email_hash then
      raise exception 'password_recovery_intent_invalid_or_expired';
    end if;
    if v_grant.state = 'requested' then
      update public.auth_password_recovery_grants
         set auth_user_id = v_auth_user_id,
             session_id = v_session_id,
             state = 'ready',
             expires_at = least(expires_at, v_now + interval '30 minutes')
       where token_hash = v_token_hash
         and state = 'requested'
      returning * into v_grant;
    elsif v_grant.state = 'ready'
          and v_grant.auth_user_id = v_auth_user_id
          and v_grant.session_id = v_session_id then
      null;
    else
      raise exception 'password_recovery_grant_already_used';
    end if;
  end if;

  return jsonb_build_object(
    'state', v_grant.state,
    'auth_user_id', v_grant.auth_user_id,
    'session_id', v_grant.session_id
  );
exception
  when invalid_text_representation then
    raise exception 'invalid_password_recovery_grant';
end;
$$;

create or replace function public.faolla_validate_password_recovery_grant_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_session_id text := nullif(btrim(p_input ->> 'session_id'), '');
  v_grant public.auth_password_recovery_grants%rowtype;
begin
  select *
    into v_grant
    from public.auth_password_recovery_grants
   where token_hash = v_token_hash
     and auth_user_id = v_auth_user_id
     and session_id = v_session_id
     and state in ('ready', 'claimed')
     and expires_at > statement_timestamp();

  return jsonb_build_object(
    'valid', found,
    'state', case when found then v_grant.state else null end
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('valid', false, 'state', null);
end;
$$;

create or replace function public.faolla_claim_password_recovery_grant_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_session_id text := nullif(btrim(p_input ->> 'session_id'), '');
  v_password_fingerprint text :=
    nullif(lower(btrim(p_input ->> 'password_fingerprint')), '');
  v_now timestamptz := statement_timestamp();
  v_grant public.auth_password_recovery_grants%rowtype;
begin
  if v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_auth_user_id is null
     or v_session_id is null
     or v_password_fingerprint is null
     or v_password_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_password_recovery_grant';
  end if;

  select *
    into v_grant
    from public.auth_password_recovery_grants
   where token_hash = v_token_hash
     and auth_user_id = v_auth_user_id
     and session_id = v_session_id
   for update;
  if not found or v_grant.expires_at <= v_now then
    raise exception 'password_recovery_grant_invalid_or_expired';
  end if;

  if v_grant.state = 'ready' then
    update public.auth_password_recovery_grants
       set state = 'claimed',
           password_fingerprint = v_password_fingerprint,
           claimed_at = v_now
     where token_hash = v_token_hash
       and state = 'ready'
    returning * into v_grant;
    if not found then
      raise exception 'password_recovery_grant_conflict';
    end if;
    return jsonb_build_object('state', 'claimed', 'resumed', false);
  end if;

  if v_grant.password_fingerprint <> v_password_fingerprint then
    raise exception 'password_recovery_grant_in_progress';
  end if;
  if v_grant.state not in ('claimed', 'completed') then
    raise exception 'password_recovery_grant_invalid_or_expired';
  end if;
  return jsonb_build_object('state', v_grant.state, 'resumed', true);
exception
  when invalid_text_representation then
    raise exception 'invalid_password_recovery_grant';
end;
$$;

create or replace function public.faolla_complete_password_recovery_grant_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_session_id text := nullif(btrim(p_input ->> 'session_id'), '');
  v_password_fingerprint text :=
    nullif(lower(btrim(p_input ->> 'password_fingerprint')), '');
  v_grant public.auth_password_recovery_grants%rowtype;
begin
  select *
    into v_grant
    from public.auth_password_recovery_grants
   where token_hash = v_token_hash
     and auth_user_id = v_auth_user_id
     and session_id = v_session_id
     and password_fingerprint = v_password_fingerprint
   for update;
  if not found or v_grant.state not in ('claimed', 'completed') then
    raise exception 'password_recovery_grant_invalid_or_expired';
  end if;

  if v_grant.state = 'claimed' then
    update public.auth_password_recovery_grants
       set state = 'completed',
           completed_at = statement_timestamp()
     where token_hash = v_token_hash
       and state = 'claimed'
    returning * into v_grant;
  end if;
  return jsonb_build_object('state', v_grant.state);
exception
  when invalid_text_representation then
    raise exception 'invalid_password_recovery_grant';
end;
$$;

create or replace function public.faolla_release_password_recovery_grant_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_session_id text := nullif(btrim(p_input ->> 'session_id'), '');
  v_password_fingerprint text :=
    nullif(lower(btrim(p_input ->> 'password_fingerprint')), '');
  v_released boolean := false;
begin
  update public.auth_password_recovery_grants
     set state = 'ready',
         password_fingerprint = null,
         claimed_at = null
   where token_hash = v_token_hash
     and auth_user_id = v_auth_user_id
     and session_id = v_session_id
     and password_fingerprint = v_password_fingerprint
     and state = 'claimed'
     and expires_at > statement_timestamp();
  v_released := found;
  return jsonb_build_object('released', v_released);
exception
  when invalid_text_representation then
    raise exception 'invalid_password_recovery_grant';
end;
$$;

do $bind_wrapper_install$
begin
  if to_regprocedure(
    'public.faolla_bind_employee_invite_identity_pre043(jsonb)'
  ) is null then
    if to_regprocedure(
      'public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)'
    ) is null then
      raise exception 'merchant_employee_initial_password_bind_prerequisite_missing';
    end if;
    alter function
      public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)
      rename to faolla_bind_employee_invite_identity_pre043;
  end if;
end;
$bind_wrapper_install$;

-- ALTER FUNCTION ... RENAME preserves the historical owner. Pin the private
-- compatibility entry point to the trusted migration owner so it cannot retain
-- a legacy postgres owner in environments where 042 repaired only the public
-- binding entry point.
alter function public.faolla_bind_employee_invite_identity_pre043(jsonb)
  owner to supabase_admin;

create or replace function public.faolla_bind_merchant_employee_invitation_identity_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text := nullif(lower(btrim(p_input ->> 'initial_password_policy')), '');
  v_event_id uuid;
  v_worker_id text;
  v_event public.merchant_outbox_events%rowtype;
  v_employee_id uuid;
  v_result jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object'
     or (v_policy is not null and v_policy not in ('required', 'waived')) then
    raise exception 'invalid_employee_auth_binding';
  end if;

  v_result := public.faolla_bind_employee_invite_identity_pre043(p_input);
  if v_policy is null then
    return v_result;
  end if;

  v_event_id := nullif(lower(btrim(p_input ->> 'event_id')), '')::uuid;
  v_worker_id := nullif(btrim(p_input ->> 'worker_id'), '');
  select *
    into v_event
    from public.merchant_outbox_events
   where id = v_event_id
     and event_type = 'enterprise.employee_invitation.deliver'
     and status = 'processing'
     and locked_by = v_worker_id
     and lease_expires_at > statement_timestamp()
   for update;
  if not found then
    raise exception 'invitation_delivery_lease_lost';
  end if;

  v_employee_id := v_event.aggregate_id::uuid;
  update public.merchant_enterprise_employees as employee
     set initial_password_policy = case
       when exists (
         select 1
           from public.merchant_employee_initial_password_setups as setup
          where setup.employee_id = employee.id
            and setup.invitation_version = employee.invitation_version
            and setup.invitation_token_hash = employee.invitation_token_hash
            and setup.state = 'completed'
       ) then 'completed'
       when exists (
         select 1
           from public.merchant_employee_initial_password_setups as setup
          where setup.employee_id = employee.id
            and setup.invitation_version = employee.invitation_version
            and setup.invitation_token_hash = employee.invitation_token_hash
            and setup.state = 'claimed'
       ) then 'required'
       else v_policy
     end
   where employee.merchant_id = v_event.merchant_id
     and employee.id = v_employee_id
     and employee.auth_user_id =
       nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid
     and employee.invitation_version =
       (v_event.payload ->> 'invitation_version')::bigint
     and employee.status = 'invited'
     and employee.accepted_at is null
     and employee.invitation_revoked_at is null
     and employee.invitation_expires_at > statement_timestamp();
  if not found then
    raise exception 'invitation_delivery_lease_lost';
  end if;

  -- If a later invitation generation observes an already-initialized Auth
  -- subject, it may be waived without opening a new setup. Remove only an old
  -- in-flight claim so it cannot retain the global Auth-subject fence; keep
  -- completed rows as durable audit evidence.
  delete from public.merchant_employee_initial_password_setups as setup
  using public.merchant_enterprise_employees as employee
   where employee.id = v_employee_id
     and employee.merchant_id = v_event.merchant_id
     and employee.initial_password_policy = 'waived'
     and setup.employee_id = employee.id
     and setup.state = 'claimed'
     and (
       setup.invitation_version is distinct from employee.invitation_version
       or setup.invitation_token_hash is distinct from
          employee.invitation_token_hash
     );
  return v_result;
exception
  when invalid_text_representation then
    raise exception 'invalid_employee_auth_binding';
end;
$$;

create or replace function public.faolla_waive_employee_initial_password_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth_user_id uuid := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;
  v_invitation_version bigint :=
    nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  v_token_hash text := nullif(lower(btrim(p_input ->> 'token_hash')), '');
  v_employee public.merchant_enterprise_employees%rowtype;
  v_setup public.merchant_employee_initial_password_setups%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object'
     or v_site_id is null
     or v_auth_user_id is null
     or v_invitation_version is null
     or v_invitation_version <= 0
     or v_token_hash is null
     or v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_employee_initial_password_waiver';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
   for update;
  if not found then
    raise exception 'merchant_employee_not_invited';
  end if;
  if v_employee.status <> 'invited'
     or v_employee.accepted_at is not null
     or v_employee.invitation_revoked_at is not null
     or v_employee.invitation_expires_at is null
     or v_employee.invitation_expires_at <= statement_timestamp()
     or v_employee.invitation_version is distinct from v_invitation_version
     or v_employee.invitation_token_hash is distinct from v_token_hash then
    raise exception 'employee_invitation_invalid_or_expired';
  end if;

  if v_employee.initial_password_policy = 'waived' then
    return jsonb_build_object('policy', 'waived', 'changed', false);
  end if;

  select *
    into v_setup
    from public.merchant_employee_initial_password_setups
   where employee_id = v_employee.id
     and invitation_version = v_invitation_version
     and invitation_token_hash = v_token_hash
   for update;
  if found and v_setup.state = 'completed' then
    update public.merchant_enterprise_employees
       set initial_password_policy = 'completed'
     where id = v_employee.id;
    return jsonb_build_object('policy', 'completed', 'changed', false);
  end if;

  if found then
    delete from public.merchant_employee_initial_password_setups
     where employee_id = v_employee.id
       and state = 'claimed';
  end if;
  update public.merchant_enterprise_employees
     set initial_password_policy = 'waived'
   where id = v_employee.id
     and initial_password_policy in ('required', 'completed');
  if not found then
    raise exception 'employee_initial_password_waiver_conflict';
  end if;
  return jsonb_build_object('policy', 'waived', 'changed', true);
exception
  when invalid_text_representation then
    raise exception 'invalid_employee_initial_password_waiver';
end;
$$;

do $accept_wrapper_install$
begin
  if to_regprocedure(
    'public.faolla_accept_employee_invite_pre043(jsonb)'
  ) is null then
    if to_regprocedure(
      'public.faolla_accept_merchant_employee_invitation_v1(jsonb)'
    ) is null then
      raise exception 'merchant_employee_initial_password_accept_prerequisite_missing';
    end if;
    alter function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
      rename to faolla_accept_employee_invite_pre043;
  end if;
end;
$accept_wrapper_install$;

-- The pre-043 accept RPC predates the owner normalization performed for the
-- invitation-delivery RPCs. RENAME keeps that legacy owner, so normalize it
-- explicitly before the private function is called by the new policy wrapper.
alter function public.faolla_accept_employee_invite_pre043(jsonb)
  owner to supabase_admin;

create or replace function public.faolla_accept_merchant_employee_invitation_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth_user_id uuid;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_setup public.merchant_employee_initial_password_setups%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth_user_id := nullif(lower(btrim(p_input ->> 'auth_user_id')), '')::uuid;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
   for update;

  if found and v_employee.status = 'invited' and v_employee.accepted_at is null then
    select *
      into v_setup
      from public.merchant_employee_initial_password_setups
     where employee_id = v_employee.id
       and invitation_version = v_employee.invitation_version
       and invitation_token_hash = v_employee.invitation_token_hash
     for update;
    if v_employee.initial_password_policy = 'required'
       and (not found or v_setup.state <> 'completed') then
      raise exception 'employee_initial_password_setup_incomplete';
    end if;
    if v_employee.initial_password_policy = 'completed'
       and (not found or v_setup.state <> 'completed') then
      raise exception 'employee_initial_password_setup_incomplete';
    end if;
    if v_employee.initial_password_policy not in ('required', 'waived', 'completed') then
      raise exception 'employee_initial_password_policy_invalid';
    end if;
  end if;

  return public.faolla_accept_employee_invite_pre043(p_input);
end;
$$;

revoke all on function public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_complete_merchant_employee_initial_password_setup_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_release_merchant_employee_initial_password_setup_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_password_recovery_intent_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_activate_password_recovery_grant_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_validate_password_recovery_grant_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_claim_password_recovery_grant_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_complete_password_recovery_grant_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_release_password_recovery_grant_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_bind_employee_invite_identity_pre043(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_waive_employee_initial_password_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_accept_employee_invite_pre043(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)
  to service_role;
grant execute on function public.faolla_complete_merchant_employee_initial_password_setup_v1(jsonb)
  to service_role;
grant execute on function public.faolla_release_merchant_employee_initial_password_setup_v1(jsonb)
  to service_role;
grant execute on function public.faolla_create_password_recovery_intent_v1(jsonb)
  to service_role;
grant execute on function public.faolla_activate_password_recovery_grant_v1(jsonb)
  to service_role;
grant execute on function public.faolla_validate_password_recovery_grant_v1(jsonb)
  to service_role;
grant execute on function public.faolla_claim_password_recovery_grant_v1(jsonb)
  to service_role;
grant execute on function public.faolla_complete_password_recovery_grant_v1(jsonb)
  to service_role;
grant execute on function public.faolla_release_password_recovery_grant_v1(jsonb)
  to service_role;
grant execute on function public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)
  to service_role;
grant execute on function public.faolla_waive_employee_initial_password_v1(jsonb)
  to service_role;
grant execute on function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608310043, 'merchant_employee_initial_password_setup')
on conflict (version) do nothing;

do $registry_postcondition$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608310043
       and name = 'merchant_employee_initial_password_setup'
  ) then
    raise exception 'merchant_employee_initial_password_setup_registry_postcondition_failed';
  end if;
end;
$registry_postcondition$;

notify pgrst, 'reload schema';

commit;
