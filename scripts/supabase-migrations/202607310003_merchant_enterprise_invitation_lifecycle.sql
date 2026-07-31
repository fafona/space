-- Add an application-level invitation generation and expiry gate. Supabase
-- authentication links may still establish a session after an invitation has
-- been superseded; these fields and RPCs decide whether that session may join
-- the merchant.

begin;

alter table public.merchant_enterprise_employees
  add column if not exists invitation_version bigint not null default 0;
alter table public.merchant_enterprise_employees
  add column if not exists invitation_token_hash text null;
alter table public.merchant_enterprise_employees
  add column if not exists invitation_expires_at timestamptz null;
alter table public.merchant_enterprise_employees
  add column if not exists invitation_revoked_at timestamptz null;
alter table public.merchant_enterprise_employees
  add column if not exists invitation_sent_at timestamptz null;
alter table public.merchant_enterprise_employees
  add column if not exists invitation_delivery_status text not null default 'none';

-- Pre-migration links have no application token. Keep only those version-zero
-- links usable for a bounded 72-hour rollout window.
update public.merchant_enterprise_employees
   set invitation_expires_at = statement_timestamp() + interval '72 hours',
       invitation_delivery_status = 'legacy'
 where status = 'invited'
   and accepted_at is null
   and invitation_version = 0
   and invitation_token_hash is null;

-- The old generic status endpoint could disable an invitation before it was
-- accepted. Such rows could neither be activated nor invited again while still
-- holding the merchant/email uniqueness slot. Preserve the row and its task
-- references, but represent it as a revoked invitation that may be renewed.
update public.merchant_enterprise_employees
   set status = 'invited',
       invitation_version = greatest(invitation_version, 0) + 1,
       invitation_token_hash = null,
       invitation_expires_at = statement_timestamp(),
       invitation_revoked_at = statement_timestamp(),
       invitation_delivery_status = 'revoked'
 where status = 'disabled'
   and accepted_at is null;

-- Keep legacy application instances safe during a rolling deployment. New
-- application code always writes an explicit expiry and delivery state.
alter table public.merchant_enterprise_employees
  alter column invitation_expires_at
  set default (statement_timestamp() + interval '72 hours');
alter table public.merchant_enterprise_employees
  alter column invitation_delivery_status
  set default 'legacy';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_version_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_version_check
      check (invitation_version >= 0);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_token_hash_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_token_hash_check
      check (
        invitation_token_hash is null
        or invitation_token_hash ~ '^[0-9a-f]{64}$'
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_delivery_status_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_delivery_status_check
      check (
        invitation_delivery_status in (
          'none',
          'legacy',
          'sending',
          'sent',
          'failed',
          'revoked'
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_token_shape_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_token_shape_check
      check (
        invitation_token_hash is null
        or (
          invitation_version > 0
          and invitation_expires_at is not null
          and invitation_revoked_at is null
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_revocation_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_revocation_check
      check (
        invitation_revoked_at is null
        or (
          status = 'invited'
          and invitation_token_hash is null
          and invitation_delivery_status = 'revoked'
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_employees'::regclass
       and conname = 'merchant_enterprise_employees_invitation_sent_check'
  ) then
    alter table public.merchant_enterprise_employees
      add constraint merchant_enterprise_employees_invitation_sent_check
      check (
        invitation_delivery_status <> 'sent'
        or invitation_sent_at is not null
      );
  end if;
end
$$;

create index if not exists merchant_enterprise_employees_pending_invitation_expiry_idx
  on public.merchant_enterprise_employees(
    merchant_id,
    invitation_expires_at,
    invitation_version
  )
  where status = 'invited' and accepted_at is null;

create or replace function public.faolla_reserve_merchant_employee_invitation_v1(
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
  v_expected_version bigint;
  v_token_hash text;
  v_expires_at timestamptz;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
  v_expected_version := nullif(btrim(p_input ->> 'expected_version'), '')::bigint;
  v_token_hash := lower(coalesce(btrim(p_input ->> 'token_hash'), ''));
  v_expires_at := nullif(btrim(p_input ->> 'expires_at'), '')::timestamptz;
  if v_site_id is null
     or v_employee_id is null
     or v_expected_version is null
     or v_expected_version <= 0
     or v_token_hash !~ '^[0-9a-f]{64}$'
     or v_expires_at is null
     or v_expires_at <= v_now
     or v_expires_at > v_now + interval '30 days' then
    raise exception 'invalid_employee_invitation';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
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

  update public.merchant_enterprise_employees
     set invitation_version = v_employee.invitation_version + 1,
         invitation_token_hash = v_token_hash,
         invitation_expires_at = v_expires_at,
         invitation_revoked_at = null,
         invitation_sent_at = null,
         invitation_delivery_status = 'sending',
         invited_at = v_now
   where merchant_id = v_site_id
     and id = v_employee_id
     and version = v_expected_version
     and status = 'invited'
     and accepted_at is null
  returning * into v_employee;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee) - 'invitation_token_hash',
    'invitation_version',
    v_employee.invitation_version
  );
end;
$$;

create or replace function public.faolla_revoke_merchant_employee_invitation_v1(
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
  v_expected_version bigint;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
  v_expected_version := nullif(btrim(p_input ->> 'expected_version'), '')::bigint;
  if v_site_id is null
     or v_employee_id is null
     or v_expected_version is null
     or v_expected_version <= 0 then
    raise exception 'invalid_employee_invitation';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
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
  if v_employee.invitation_revoked_at is not null then
    raise exception 'employee_invitation_revoked';
  end if;

  update public.merchant_enterprise_employees
     set invitation_version = v_employee.invitation_version + 1,
         invitation_token_hash = null,
         invitation_expires_at = v_now,
         invitation_revoked_at = v_now,
         invitation_delivery_status = 'revoked'
   where merchant_id = v_site_id
     and id = v_employee_id
     and version = v_expected_version
     and status = 'invited'
     and accepted_at is null
     and invitation_revoked_at is null
  returning * into v_employee;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee) - 'invitation_token_hash',
    'invitation_version',
    v_employee.invitation_version
  );
end;
$$;

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
  v_supplied_invitation_version bigint;
  v_supplied_token_hash text;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth_user_id := nullif(btrim(p_input ->> 'auth_user_id'), '')::uuid;
  v_supplied_invitation_version :=
    nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  v_supplied_token_hash :=
    nullif(lower(btrim(p_input ->> 'token_hash')), '');
  if v_site_id is null or v_auth_user_id is null then
    raise exception 'invalid_employee_invitation';
  end if;
  if v_supplied_invitation_version is not null
     and v_supplied_invitation_version < 0 then
    raise exception 'invalid_employee_invitation';
  end if;
  if v_supplied_token_hash is not null
     and v_supplied_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_employee_invitation';
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

  if v_employee.status = 'active' then
    return jsonb_build_object(
      'employee',
      to_jsonb(v_employee) - 'invitation_token_hash',
      'already_active',
      true
    );
  end if;
  if v_employee.status = 'disabled' then
    raise exception 'employee_account_disabled';
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

  if v_employee.invitation_version = 0
     and v_employee.invitation_token_hash is null then
    if coalesce(v_supplied_invitation_version, 0) <> 0
       or v_supplied_token_hash is not null then
      raise exception 'employee_invitation_superseded';
    end if;
  else
    if v_supplied_invitation_version is distinct from v_employee.invitation_version
       or v_supplied_token_hash is null
       or v_employee.invitation_token_hash is null
       or v_supplied_token_hash is distinct from v_employee.invitation_token_hash then
      raise exception 'employee_invitation_superseded';
    end if;
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

  update public.merchant_enterprise_employees
     set status = 'active',
         accepted_at = v_now,
         last_active_at = v_now,
         invitation_token_hash = null,
         invitation_sent_at = coalesce(invitation_sent_at, v_now),
         invitation_delivery_status = 'sent'
   where merchant_id = v_site_id
     and id = v_employee.id
     and auth_user_id = v_auth_user_id
     and version = v_employee.version
     and invitation_version = v_employee.invitation_version
     and status = 'invited'
     and accepted_at is null
     and invitation_revoked_at is null
     and invitation_expires_at > v_now
  returning * into v_employee;
  if not found then
    raise exception 'enterprise_invitation_accept_conflict';
  end if;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee) - 'invitation_token_hash',
    'already_active',
    false
  );
end;
$$;

create or replace function public.faolla_finalize_merchant_employee_invitation_v1(
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
  v_expected_invitation_version bigint;
  v_delivery_status text;
  v_sent_at timestamptz;
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
  v_expected_invitation_version :=
    nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  v_delivery_status := nullif(btrim(p_input ->> 'delivery_status'), '');
  v_sent_at := coalesce(
    nullif(btrim(p_input ->> 'sent_at'), '')::timestamptz,
    statement_timestamp()
  );
  if v_site_id is null
     or v_employee_id is null
     or v_expected_invitation_version is null
     or v_expected_invitation_version <= 0
     or v_delivery_status is null
     or v_delivery_status not in ('sent', 'failed') then
    raise exception 'invalid_employee_invitation_delivery';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;

  if v_employee.invitation_version <> v_expected_invitation_version
     or v_employee.status <> 'invited'
     or v_employee.accepted_at is not null
     or v_employee.invitation_revoked_at is not null then
    return jsonb_build_object(
      'employee',
      to_jsonb(v_employee) - 'invitation_token_hash',
      'applied',
      false
    );
  end if;

  if v_employee.invitation_delivery_status = v_delivery_status
     and (
       v_delivery_status = 'failed'
       or v_employee.invitation_sent_at is not null
     ) then
    return jsonb_build_object(
      'employee',
      to_jsonb(v_employee) - 'invitation_token_hash',
      'applied',
      true
    );
  end if;

  update public.merchant_enterprise_employees
     set invitation_delivery_status = v_delivery_status,
         invitation_sent_at = case
           when v_delivery_status = 'sent' then v_sent_at
           else null
         end
   where merchant_id = v_site_id
     and id = v_employee_id
     and version = v_employee.version
     and invitation_version = v_expected_invitation_version
     and status = 'invited'
     and accepted_at is null
     and invitation_revoked_at is null
  returning * into v_employee;
  if not found then
    raise exception 'enterprise_invitation_finalize_conflict';
  end if;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee) - 'invitation_token_hash',
    'applied',
    true
  );
end;
$$;

create or replace function public.faolla_bind_merchant_employee_auth_user_v1(
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
  v_expected_version bigint;
  v_expected_invitation_version bigint;
  v_now timestamptz := statement_timestamp();
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
  v_auth_user_id := nullif(btrim(p_input ->> 'auth_user_id'), '')::uuid;
  v_expected_version := nullif(btrim(p_input ->> 'expected_version'), '')::bigint;
  v_expected_invitation_version :=
    nullif(btrim(p_input ->> 'invitation_version'), '')::bigint;
  if v_site_id is null
     or v_employee_id is null
     or v_auth_user_id is null
     or v_expected_version is null
     or v_expected_version <= 0
     or v_expected_invitation_version is null
     or v_expected_invitation_version <= 0 then
    raise exception 'invalid_employee_auth_binding';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  if v_employee.invitation_version <> v_expected_invitation_version then
    raise exception 'employee_invitation_superseded';
  end if;
  if v_employee.invitation_revoked_at is not null then
    raise exception 'employee_invitation_revoked';
  end if;
  if v_employee.invitation_expires_at is null
     or v_employee.invitation_expires_at <= v_now then
    raise exception 'employee_invitation_expired';
  end if;

  if v_employee.auth_user_id = v_auth_user_id
     and v_employee.status in ('invited', 'active') then
    return jsonb_build_object(
      'employee',
      to_jsonb(v_employee) - 'invitation_token_hash',
      'already_bound',
      true
    );
  end if;
  if v_employee.auth_user_id is not null then
    raise exception 'employee_auth_binding_conflict';
  end if;
  if v_employee.status <> 'invited' or v_employee.accepted_at is not null then
    raise exception 'employee_invitation_not_pending';
  end if;
  if v_employee.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;

  perform 1
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and auth_user_id = v_auth_user_id
     and id <> v_employee_id
   for share;
  if found then
    raise exception 'employee_auth_binding_conflict';
  end if;

  begin
    update public.merchant_enterprise_employees
       set auth_user_id = v_auth_user_id
     where merchant_id = v_site_id
       and id = v_employee_id
       and version = v_expected_version
       and invitation_version = v_expected_invitation_version
       and status = 'invited'
       and accepted_at is null
       and auth_user_id is null
       and invitation_revoked_at is null
       and invitation_expires_at > v_now
    returning * into v_employee;
  exception
    when unique_violation then
      raise exception 'employee_auth_binding_conflict';
  end;
  if not found then
    raise exception 'enterprise_employee_auth_binding_conflict';
  end if;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee) - 'invitation_token_hash',
    'already_bound',
    false
  );
end;
$$;

revoke all on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_finalize_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_bind_merchant_employee_auth_user_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_finalize_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_bind_merchant_employee_auth_user_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310003, 'merchant_enterprise_invitation_lifecycle')
on conflict (version) do nothing;

commit;
