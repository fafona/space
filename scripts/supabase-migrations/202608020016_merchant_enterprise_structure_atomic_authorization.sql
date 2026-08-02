-- Keep every enterprise workspace, board, and column write behind one
-- database authorization boundary. The authoritative enterprise entitlement
-- lives in the platform snapshot and remains an API precondition; no database
-- entitlement mirror is invented here.

begin;

alter function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  rename to faolla_bootstrap_merchant_enterprise_v2_unchecked_016;
alter function public.faolla_create_merchant_task_board_v1(jsonb)
  rename to faolla_create_merchant_task_board_v1_unchecked_016;
alter function public.faolla_update_merchant_task_board_v1(jsonb)
  rename to faolla_update_merchant_task_board_v1_unchecked_016;
alter function public.faolla_create_merchant_task_column_v1(jsonb)
  rename to faolla_create_merchant_task_column_v1_unchecked_016;
alter function public.faolla_update_merchant_task_column_v1(jsonb)
  rename to faolla_update_merchant_task_column_v1_unchecked_016;

revoke all on function public.faolla_bootstrap_merchant_enterprise_v2_unchecked_016(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_task_board_v1_unchecked_016(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_board_v1_unchecked_016(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_task_column_v1_unchecked_016(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_column_v1_unchecked_016(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.faolla_authorize_merchant_enterprise_structure_write_v1(
  p_input jsonb,
  p_board_id uuid,
  p_column_id uuid,
  p_require_all_boards boolean,
  p_required_permissions text[]
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
  v_actor_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_enterprise_structure_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if not (p_input ? 'merchant_id')
     or jsonb_typeof(p_input -> 'merchant_id') <> 'string'
     or v_site_id is null
     or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_site_id';
  end if;

  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type not in ('owner', 'employee')
     or not (p_input ? 'actor_id')
     or jsonb_typeof(p_input -> 'actor_id') <> 'string'
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_enterprise_actor';
  end if;
  if p_require_all_boards is null
     or (not p_require_all_boards and p_board_id is null)
     or (
       p_column_id is not null
       and (p_board_id is null or p_require_all_boards)
     )
     or p_required_permissions is null
     or cardinality(p_required_permissions) = 0
     or not (
       p_required_permissions <@ array[
         'boards.manage',
         'roles.manage'
       ]::text[]
     ) then
    raise exception 'invalid_enterprise_structure_authorization';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  -- Every unchecked implementation takes this lock before mutating structure.
  -- Taking the same transaction lock first makes authorization and mutation one
  -- serialized unit while remaining re-entrant in the delegated function.
  perform pg_advisory_xact_lock(
    hashtextextended('faolla-enterprise-structure:' || v_site_id, 0)
  );

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
      raise exception 'permission_denied';
    end if;
  else
    -- Follow the shared enterprise lock order: employee, role, role-board
    -- mappings, target board, then target column.
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id
     for share;
    if not found
       or v_actor_employee.status <> 'active'
       or v_actor_employee.role_id is null then
      raise exception 'permission_denied';
    end if;

    select *
      into v_actor_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_actor_employee.role_id
     for share;
    if not found
       or v_actor_role.status <> 'active'
       or not public.faolla_valid_merchant_enterprise_permissions_v1(
         v_actor_role.permissions
       )
       or not (p_required_permissions <@ v_actor_role.permissions) then
      raise exception 'permission_denied';
    end if;

    perform 1
      from public.merchant_enterprise_role_boards as role_board
     where role_board.merchant_id = v_site_id
       and role_board.role_id = v_actor_role.id
     order by role_board.role_id, role_board.board_id
     for share of role_board;

  end if;

  if p_board_id is not null then
    perform 1
      from public.merchant_task_boards as board
     where board.merchant_id = v_site_id
       and board.id = p_board_id
     for share of board;
    if not found then
      raise exception 'board_not_found';
    end if;

    if v_actor_type = 'employee'
       and v_actor_role.access_scope = 'restricted'
       and not exists (
         select 1
           from public.merchant_enterprise_role_boards as role_board
          where role_board.merchant_id = v_site_id
            and role_board.role_id = v_actor_role.id
            and role_board.board_id = p_board_id
       ) then
      raise exception 'board_not_found';
    end if;
  end if;

  if p_column_id is not null then
    perform 1
      from public.merchant_task_columns as task_column
     where task_column.merchant_id = v_site_id
       and task_column.board_id = p_board_id
       and task_column.id = p_column_id
     for share of task_column;
    if not found then
      raise exception 'column_not_found';
    end if;
  end if;

  if v_actor_type = 'employee'
     and p_require_all_boards
     and v_actor_role.access_scope <> 'all' then
    raise exception 'permission_denied';
  end if;
end;
$$;

create or replace function public.faolla_bootstrap_merchant_enterprise_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.faolla_authorize_merchant_enterprise_structure_write_v1(
    p_input,
    null,
    null,
    true,
    array['boards.manage', 'roles.manage']::text[]
  );
  return public.faolla_bootstrap_merchant_enterprise_v2_unchecked_016(p_input);
end;
$$;

create or replace function public.faolla_create_merchant_task_board_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.faolla_authorize_merchant_enterprise_structure_write_v1(
    p_input,
    null,
    null,
    true,
    array['boards.manage']::text[]
  );
  return public.faolla_create_merchant_task_board_v1_unchecked_016(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_task_board_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id_text text;
  v_require_all_boards boolean;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_board_update_payload';
  end if;
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  if v_board_id_text is null
     or v_board_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_board_update';
  end if;
  v_require_all_boards := p_input ? 'position';
  perform public.faolla_authorize_merchant_enterprise_structure_write_v1(
    p_input,
    v_board_id_text::uuid,
    null,
    v_require_all_boards,
    array['boards.manage']::text[]
  );
  return public.faolla_update_merchant_task_board_v1_unchecked_016(p_input);
end;
$$;

create or replace function public.faolla_create_merchant_task_column_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id_text text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_column_payload';
  end if;
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  if v_board_id_text is null
     or v_board_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_column';
  end if;
  perform public.faolla_authorize_merchant_enterprise_structure_write_v1(
    p_input,
    v_board_id_text::uuid,
    null,
    false,
    array['boards.manage']::text[]
  );
  return public.faolla_create_merchant_task_column_v1_unchecked_016(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_task_column_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id_text text;
  v_column_id_text text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_column_update_payload';
  end if;
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  v_column_id_text := nullif(btrim(p_input ->> 'column_id'), '');
  if v_board_id_text is null
     or v_board_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_column_update';
  end if;
  if v_column_id_text is null
     or v_column_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_column_update';
  end if;
  perform public.faolla_authorize_merchant_enterprise_structure_write_v1(
    p_input,
    v_board_id_text::uuid,
    v_column_id_text::uuid,
    false,
    array['boards.manage']::text[]
  );
  return public.faolla_update_merchant_task_column_v1_unchecked_016(p_input);
end;
$$;

revoke all on function public.faolla_authorize_merchant_enterprise_structure_write_v1(
  jsonb, uuid, uuid, boolean, text[]
) from public, anon, authenticated, service_role;

revoke all on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_board_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_board_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_column_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_column_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_task_board_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_board_v1(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_task_column_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_column_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608020016, 'merchant_enterprise_structure_atomic_authorization')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
