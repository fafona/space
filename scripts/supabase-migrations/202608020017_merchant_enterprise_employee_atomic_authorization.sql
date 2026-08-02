-- Keep employee and managerial invitation writes behind one database
-- authorization boundary. Existing public RPC names stay stable while their
-- original implementations become transaction-local delegates.

begin;

alter function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  rename to faolla_create_merchant_enterprise_employee_v1_unchecked_017;
alter function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  rename to faolla_update_merchant_enterprise_employee_v1_unchecked_017;
alter function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  rename to faolla_reserve_merchant_employee_invitation_v1_unchecked_017;
alter function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  rename to faolla_revoke_merchant_employee_invitation_v1_unchecked_017;
alter function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  rename to faolla_remove_merchant_employee_invitation_v1_unchecked_017;

revoke all on function public.faolla_create_merchant_enterprise_employee_v1_unchecked_017(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1_unchecked_017(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_reserve_merchant_employee_invitation_v1_unchecked_017(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_revoke_merchant_employee_invitation_v1_unchecked_017(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_remove_merchant_employee_invitation_v1_unchecked_017(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.faolla_authorize_merchant_enterprise_employee_actor_v1(
  p_input jsonb,
  p_target_employee_id uuid,
  p_require_employee_manager boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_merchant public.merchants%rowtype;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_target_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_type'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_id'), '') <> 'string'
     or p_require_employee_manager is null then
    raise exception 'permission_escalation_denied';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_site_id';
  end if;
  if v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_escalation_denied';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  -- The authoritative enterprise entitlement remains an API precondition.
  -- This row lock makes mutable owner identity part of the write transaction.
  select *
    into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  if v_actor_type = 'owner' then
    if not coalesce(
      v_actor_id = any(array_remove(array[
        v_merchant.user_id,
        v_merchant.auth_user_id,
        v_merchant.owner_user_id,
        v_merchant.owner_id,
        v_merchant.auth_id,
        v_merchant.created_by,
        v_merchant.created_by_user_id
      ]::uuid[], null::uuid)),
      false
    ) then
      raise exception 'permission_escalation_denied';
    end if;
    return;
  end if;

  -- Employee create/update keeps using the established implementation's
  -- task -> employee -> role lock order and its full atomic authorization.
  if not p_require_employee_manager then
    raise exception 'permission_escalation_denied';
  end if;
  if p_target_employee_id is null then
    raise exception 'invalid_employee_invitation';
  end if;
  if v_actor_id = p_target_employee_id then
    raise exception 'permission_escalation_denied';
  end if;

  -- Invitation management has no task locks. Lock every participating
  -- employee first, followed by every role and role-board mapping.
  perform 1
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = any(array[v_actor_id, p_target_employee_id])
   order by employee.id
   for update of employee;

  select *
    into v_actor_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_actor_id;
  if not found or v_actor_employee.status <> 'active' then
    raise exception 'permission_escalation_denied';
  end if;

  select *
    into v_target_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = p_target_employee_id;
  if not found then
    raise exception 'employee_not_found';
  end if;

  perform 1
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = any(array_remove(array[
       v_actor_employee.role_id,
       v_target_employee.role_id
     ], null::uuid))
   order by role_row.id
   for share of role_row;

  select *
    into v_actor_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_actor_employee.role_id
     and status = 'active'
     and 'employees.manage' = any(permissions);
  if not found then
    raise exception 'permission_escalation_denied';
  end if;

  perform 1
    from public.merchant_enterprise_role_boards as role_board
   where role_board.merchant_id = v_site_id
     and role_board.role_id = any(array_remove(array[
       v_actor_employee.role_id,
       v_target_employee.role_id
     ], null::uuid))
   order by role_board.role_id, role_board.board_id
   for share of role_board;

  if not public.faolla_merchant_enterprise_role_fits_actor_v1(
    v_site_id,
    v_actor_role.id,
    v_target_employee.role_id
  ) then
    raise exception 'permission_escalation_denied';
  end if;
end;
$$;

create or replace function public.faolla_create_merchant_enterprise_employee_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text;
begin
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  if v_actor_type = 'owner' then
    perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
      p_input,
      null,
      false
    );
  end if;
  return public.faolla_create_merchant_enterprise_employee_v1_unchecked_017(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_enterprise_employee_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text;
begin
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  if v_actor_type = 'owner' then
    perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
      p_input,
      null,
      false
    );
  end if;
  return public.faolla_update_merchant_enterprise_employee_v1_unchecked_017(p_input);
end;
$$;

create or replace function public.faolla_reserve_merchant_employee_invitation_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id_text text;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'employee_id'), '') <> 'string' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  if v_employee_id_text is null
     or v_employee_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_employee_invitation';
  end if;

  perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
    p_input,
    v_employee_id_text::uuid,
    true
  );
  return public.faolla_reserve_merchant_employee_invitation_v1_unchecked_017(p_input);
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
  v_employee_id_text text;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'employee_id'), '') <> 'string' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  if v_employee_id_text is null
     or v_employee_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_employee_invitation';
  end if;

  perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
    p_input,
    v_employee_id_text::uuid,
    true
  );
  return public.faolla_revoke_merchant_employee_invitation_v1_unchecked_017(p_input);
end;
$$;

create or replace function public.faolla_remove_merchant_employee_invitation_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id_text text;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'employee_id'), '') <> 'string' then
    raise exception 'invalid_employee_invitation';
  end if;
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  if v_employee_id_text is null
     or v_employee_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_employee_invitation';
  end if;

  perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(
    p_input,
    v_employee_id_text::uuid,
    true
  );
  return public.faolla_remove_merchant_employee_invitation_v1_unchecked_017(p_input);
end;
$$;

revoke all on function public.faolla_authorize_merchant_enterprise_employee_actor_v1(
  jsonb, uuid, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  to service_role;
grant execute on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  to service_role;
grant execute on function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608020017, 'merchant_enterprise_employee_atomic_authorization')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
