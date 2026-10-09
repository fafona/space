-- Additive exact-receipt recovery for an initial-password setup already completed.
-- Preserve the required-policy write path and all invitation/current-role guards.
-- Existing employee, setup, audit and Auth data are never repaired by this migration.
begin;
set local lock_timeout='3s';

do $initial_password_replay_prerequisites$
begin
  if to_regclass('public.faolla_schema_migrations') is null
     or to_regclass('public.merchant_enterprise_employees') is null
     or to_regclass('public.merchant_enterprise_roles') is null
     or to_regclass('public.merchant_employee_initial_password_setups') is null
     or to_regprocedure('public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)') is null then
    raise exception 'merchant_employee_initial_password_replay_prerequisite_required';
  end if;
  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608310043
       and name = 'merchant_employee_initial_password_setup'
  ) then
    raise exception 'merchant_employee_initial_password_replay_prerequisite_required';
  end if;
end;
$initial_password_replay_prerequisites$;

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
  -- BEGIN 114 exact completed receipt replay.
  -- Completion already changed the employee policy. Recover only the original
  -- completed operation, without renewing a lease or touching any other claim.
  if v_employee.initial_password_policy = 'completed' then
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
       and state = 'completed'
       and completed_at is not null
       and claim_expires_at is null
     for update;
    if found then
      -- A lock wait must not extend the invitation's real expiry.
      if v_employee.invitation_expires_at <= clock_timestamp() then
        raise exception 'employee_invitation_expired';
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
    end if;
  end if;
  -- END 114 exact completed receipt replay.
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

revoke all on function public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_claim_merchant_employee_initial_password_setup_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202610030114, 'merchant_employee_initial_password_replay')
on conflict (version) do nothing;

do $registry_postcondition$
begin
  if not exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202610030114
       and name = 'merchant_employee_initial_password_replay'
  ) then
    raise exception 'merchant_employee_initial_password_replay_registry_postcondition_failed';
  end if;
end;
$registry_postcondition$;

notify pgrst, 'reload schema';

commit;
