-- Atomically authorize enterprise role mutations before delegating to the
-- existing v1 mutation implementation. The v1 RPCs remain available for
-- compatibility while application callers migrate to these actor-aware v2
-- entry points.

begin;

create or replace function public.faolla_create_merchant_enterprise_role_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_access_scope text;
  v_permissions text[];
  v_allowed_board_ids uuid[] := '{}'::uuid[];
  v_actor_allowed_board_ids uuid[] := '{}'::uuid[];
  v_allowed_count integer;
  v_merchant public.merchants%rowtype;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_role';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_role';
  end if;
  if not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type not in ('owner', 'employee')
     or not (p_input ? 'actor_id')
     or jsonb_typeof(p_input -> 'actor_id') <> 'string'
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_role_actor';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  if not (p_input ? 'permissions')
     or jsonb_typeof(p_input -> 'permissions') <> 'array' then
    raise exception 'invalid_permissions';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_input -> 'permissions') as item(value)
     where jsonb_typeof(item.value) <> 'string'
  ) then
    raise exception 'invalid_permissions';
  end if;
  select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
    into v_permissions
    from jsonb_array_elements_text(p_input -> 'permissions')
      as requested_permission(permission);
  if cardinality(v_permissions) <> jsonb_array_length(p_input -> 'permissions')
     or not public.faolla_valid_merchant_enterprise_permissions_v1(v_permissions) then
    raise exception 'invalid_permissions';
  end if;

  v_access_scope := coalesce(
    nullif(btrim(p_input ->> 'access_scope'), ''),
    'all'
  );
  if v_access_scope not in ('all', 'restricted')
     or jsonb_typeof(coalesce(
       p_input -> 'allowed_board_ids',
       '[]'::jsonb
     )) <> 'array' then
    raise exception 'invalid_role_board_access';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(
        coalesce(p_input -> 'allowed_board_ids', '[]'::jsonb)
      ) as item(value)
     where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid_role_board_access';
  end if;
  select coalesce(array_agg(distinct board_id order by board_id), '{}'::uuid[])
    into v_allowed_board_ids
    from (
      select (value #>> '{}')::uuid as board_id
        from jsonb_array_elements(
          coalesce(p_input -> 'allowed_board_ids', '[]'::jsonb)
        ) as item(value)
    ) as requested_boards;
  if cardinality(v_allowed_board_ids) > 100
     or cardinality(v_allowed_board_ids) <>
       jsonb_array_length(coalesce(
         p_input -> 'allowed_board_ids',
         '[]'::jsonb
       ))
     or (
       v_access_scope = 'all'
       and cardinality(v_allowed_board_ids) <> 0
     ) then
    raise exception 'invalid_role_board_access';
  end if;

  -- Serialize actor-aware role changes for one merchant. Row locks below still
  -- revalidate every authorization input before the v1 write starts.
  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
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
      raise exception 'permission_escalation_denied';
    end if;
  else
    -- Employee rows precede role rows in the shared enterprise lock order.
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id
     for update;
    if not found or v_actor_employee.status <> 'active' then
      raise exception 'permission_escalation_denied';
    end if;

    select *
      into v_actor_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_actor_employee.role_id
     for update;
    if not found
       or v_actor_role.status <> 'active'
       or not ('roles.manage' = any(v_actor_role.permissions)) then
      raise exception 'permission_escalation_denied';
    end if;

    perform 1
      from public.merchant_enterprise_role_boards as role_board
     where role_board.merchant_id = v_site_id
       and role_board.role_id = v_actor_role.id
     order by role_board.role_id, role_board.board_id
     for share of role_board;
    select coalesce(array_agg(board_id order by board_id), '{}'::uuid[])
      into v_actor_allowed_board_ids
      from public.merchant_enterprise_role_boards
     where merchant_id = v_site_id
       and role_id = v_actor_role.id;

    if not (v_permissions <@ v_actor_role.permissions)
       or (
         v_actor_role.access_scope = 'restricted'
         and (
           v_access_scope <> 'restricted'
           or not (v_allowed_board_ids <@ v_actor_allowed_board_ids)
         )
       ) then
      raise exception 'permission_escalation_denied';
    end if;
  end if;

  if cardinality(v_allowed_board_ids) > 0 then
    perform 1
      from public.merchant_task_boards as board
     where board.merchant_id = v_site_id
       and board.id = any(v_allowed_board_ids)
     order by board.id
     for share of board;
    select count(*)::integer
      into v_allowed_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_allowed_board_ids);
    if v_allowed_count <> cardinality(v_allowed_board_ids) then
      raise exception 'invalid_role_board_access';
    end if;
  end if;

  -- No exception is caught here: v1 validation or writes fail the same database
  -- transaction and therefore roll back together with this authorization step.
  return public.faolla_create_merchant_enterprise_role_v1(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_enterprise_role_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_role_id_text text;
  v_role_id uuid;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_actor_role_id uuid;
  v_next_access_scope text;
  v_next_permissions text[];
  v_current_allowed_board_ids uuid[] := '{}'::uuid[];
  v_next_allowed_board_ids uuid[] := '{}'::uuid[];
  v_actor_allowed_board_ids uuid[] := '{}'::uuid[];
  v_allowed_count integer;
  v_merchant public.merchants%rowtype;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
  v_target_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_role_update';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_role_id_text is null
     or v_role_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_role_update';
  end if;
  if not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type not in ('owner', 'employee')
     or not (p_input ? 'actor_id')
     or jsonb_typeof(p_input -> 'actor_id') <> 'string'
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_role_actor';
  end if;
  v_role_id := v_role_id_text::uuid;
  v_actor_id := v_actor_id_text::uuid;

  perform pg_advisory_xact_lock(
    hashtextextended('faolla:enterprise:role:' || v_site_id, 0)
  );

  select *
    into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;
  if v_actor_type = 'owner' and not coalesce(
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

  -- Match the employee transition workflow's lock order: affected open tasks,
  -- participating employees, then all role rows in UUID order.
  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_tasks as task
      on task.merchant_id = assignee.merchant_id
     and task.id = assignee.task_id
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = assignee.merchant_id
     and employee.id = assignee.employee_id
   where employee.merchant_id = v_site_id
     and employee.role_id = v_role_id
     and task.archived_at is null
     and task.completed_at is null
   order by task.id
   for update of task;

  perform 1
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and (
       employee.role_id = v_role_id
       or (
         v_actor_type = 'employee'
         and employee.id = v_actor_id
       )
     )
   order by employee.id
   for update of employee;

  if v_actor_type = 'employee' then
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id;
    if not found or v_actor_employee.status <> 'active' then
      raise exception 'permission_escalation_denied';
    end if;
    v_actor_role_id := v_actor_employee.role_id;
  end if;

  perform 1
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = any(array_remove(
       array[v_role_id, v_actor_role_id],
       null::uuid
     ))
   order by role_row.id
   for update of role_row;

  select *
    into v_target_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_role_id;
  if not found then
    raise exception 'role_not_found';
  end if;

  if v_actor_type = 'employee' then
    select *
      into v_actor_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_actor_role_id;
    if not found
       or v_actor_role.status <> 'active'
       or not ('roles.manage' = any(v_actor_role.permissions))
       or v_actor_role.id = v_target_role.id
       or v_target_role.is_system then
      raise exception 'permission_escalation_denied';
    end if;
  end if;

  perform 1
    from public.merchant_enterprise_role_boards as role_board
   where role_board.merchant_id = v_site_id
     and role_board.role_id = any(array_remove(
       array[v_role_id, v_actor_role_id],
       null::uuid
     ))
   order by role_board.role_id, role_board.board_id
   for share of role_board;
  select coalesce(array_agg(board_id order by board_id), '{}'::uuid[])
    into v_current_allowed_board_ids
    from public.merchant_enterprise_role_boards
   where merchant_id = v_site_id
     and role_id = v_role_id;
  if v_actor_type = 'employee' then
    select coalesce(array_agg(board_id order by board_id), '{}'::uuid[])
      into v_actor_allowed_board_ids
      from public.merchant_enterprise_role_boards
     where merchant_id = v_site_id
       and role_id = v_actor_role_id;
  end if;

  v_next_permissions := v_target_role.permissions;
  if p_input ? 'permissions' then
    if jsonb_typeof(p_input -> 'permissions') <> 'array' then
      raise exception 'invalid_permissions';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_input -> 'permissions') as item(value)
       where jsonb_typeof(item.value) <> 'string'
    ) then
      raise exception 'invalid_permissions';
    end if;
    select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
      into v_next_permissions
      from jsonb_array_elements_text(p_input -> 'permissions')
        as requested_permission(permission);
    if cardinality(v_next_permissions) <>
       jsonb_array_length(p_input -> 'permissions')
       or not public.faolla_valid_merchant_enterprise_permissions_v1(
         v_next_permissions
       ) then
      raise exception 'invalid_permissions';
    end if;
  end if;

  v_next_access_scope := v_target_role.access_scope;
  v_next_allowed_board_ids := v_current_allowed_board_ids;
  if p_input ? 'access_scope' then
    if jsonb_typeof(p_input -> 'access_scope') <> 'string'
       or btrim(p_input ->> 'access_scope') not in ('all', 'restricted') then
      raise exception 'invalid_role_board_access';
    end if;
    v_next_access_scope := btrim(p_input ->> 'access_scope');
    if v_next_access_scope = 'all'
       and not (p_input ? 'allowed_board_ids') then
      v_next_allowed_board_ids := '{}'::uuid[];
    elsif v_target_role.access_scope = 'all'
       and v_next_access_scope = 'restricted'
       and not (p_input ? 'allowed_board_ids') then
      v_next_allowed_board_ids := '{}'::uuid[];
    end if;
  end if;

  if p_input ? 'allowed_board_ids' then
    if jsonb_typeof(p_input -> 'allowed_board_ids') <> 'array' then
      raise exception 'invalid_role_board_access';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_input -> 'allowed_board_ids') as item(value)
       where jsonb_typeof(item.value) <> 'string'
          or (item.value #>> '{}') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'invalid_role_board_access';
    end if;
    select coalesce(array_agg(distinct board_id order by board_id), '{}'::uuid[])
      into v_next_allowed_board_ids
      from (
        select (value #>> '{}')::uuid as board_id
          from jsonb_array_elements(
            p_input -> 'allowed_board_ids'
          ) as item(value)
      ) as requested_boards;
    if cardinality(v_next_allowed_board_ids) <>
       jsonb_array_length(p_input -> 'allowed_board_ids') then
      raise exception 'invalid_role_board_access';
    end if;
  end if;

  if cardinality(v_next_allowed_board_ids) > 100
     or (
       v_next_access_scope = 'all'
       and cardinality(v_next_allowed_board_ids) <> 0
     ) then
    raise exception 'invalid_role_board_access';
  end if;

  if v_actor_type = 'employee' and (
    not (v_target_role.permissions <@ v_actor_role.permissions)
    or not (v_next_permissions <@ v_actor_role.permissions)
    or (
      v_actor_role.access_scope = 'restricted'
      and (
        v_target_role.access_scope <> 'restricted'
        or not (
          v_current_allowed_board_ids <@ v_actor_allowed_board_ids
        )
        or v_next_access_scope <> 'restricted'
        or not (
          v_next_allowed_board_ids <@ v_actor_allowed_board_ids
        )
      )
    )
  ) then
    raise exception 'permission_escalation_denied';
  end if;

  if cardinality(v_next_allowed_board_ids) > 0 then
    perform 1
      from public.merchant_task_boards as board
     where board.merchant_id = v_site_id
       and board.id = any(v_next_allowed_board_ids)
     order by board.id
     for share of board;
    select count(*)::integer
      into v_allowed_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_next_allowed_board_ids);
    if v_allowed_count <> cardinality(v_next_allowed_board_ids) then
      raise exception 'invalid_role_board_access';
    end if;
  end if;

  return public.faolla_update_merchant_enterprise_role_v1(p_input);
end;
$$;

revoke all on function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608010013, 'merchant_enterprise_role_atomic_authorization')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
