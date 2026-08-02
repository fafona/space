-- Keep every enterprise task write behind a database authorization boundary.
-- Existing JSON inputs and public RPC names stay stable; the original mutation
-- implementations become private transaction-local delegates.

begin;

alter function public.faolla_create_merchant_task_v1(jsonb)
  rename to faolla_create_merchant_task_v1_unchecked_015;
alter function public.faolla_update_merchant_task_v1(jsonb)
  rename to faolla_update_merchant_task_v1_unchecked_015;
alter function public.faolla_move_merchant_task_v1(jsonb)
  rename to faolla_move_merchant_task_v1_unchecked_015;
alter function public.faolla_add_merchant_task_comment_v1(jsonb)
  rename to faolla_add_merchant_task_comment_v1_unchecked_015;
alter function public.faolla_create_merchant_task_checklist_item_v1(jsonb)
  rename to faolla_create_task_checklist_item_v1_unchecked_015;
alter function public.faolla_update_merchant_task_checklist_item_v1(jsonb)
  rename to faolla_update_task_checklist_item_v1_unchecked_015;

revoke all on function public.faolla_create_merchant_task_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_move_merchant_task_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_add_merchant_task_comment_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_task_checklist_item_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_task_checklist_item_v1_unchecked_015(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.faolla_authorize_merchant_task_write_v1(
  p_input jsonb,
  p_task_id uuid,
  p_board_id uuid,
  p_required_permissions text[],
  p_assignee_ids uuid[],
  p_scope_error text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_effective_board_id uuid;
  v_assignee_ids uuid[] := '{}'::uuid[];
  v_participant_ids uuid[] := '{}'::uuid[];
  v_participant_role_ids uuid[] := '{}'::uuid[];
  v_valid_assignee_count integer := 0;
  v_merchant public.merchants%rowtype;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if not (p_input ? 'merchant_id')
     or jsonb_typeof(p_input -> 'merchant_id') <> 'string'
     or v_site_id is null
     or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_site_id';
  end if;
  if not (p_input ? 'actor_type')
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or v_actor_type not in ('owner', 'employee')
     or not (p_input ? 'actor_id')
     or jsonb_typeof(p_input -> 'actor_id') <> 'string'
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_actor';
  end if;
  if p_required_permissions is null
     or cardinality(p_required_permissions) = 0
     or not (
       p_required_permissions <@ array[
         'tasks.create',
         'tasks.update',
         'tasks.assign',
         'tasks.archive'
       ]::text[]
     )
     or p_scope_error not in ('board_not_found', 'task_not_found')
     or (p_task_id is null) = (p_board_id is null) then
    raise exception 'invalid_task_authorization';
  end if;

  v_actor_id := v_actor_id_text::uuid;
  select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
    into v_assignee_ids
    from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) as requested(employee_id);

  -- Owner identity uses the same authoritative merchant columns as the
  -- actor-aware role RPCs. This row lock remains held through the delegated
  -- mutation.
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
    raise exception 'permission_denied';
  end if;

  -- Existing-task writes lock the task before employees and roles, matching
  -- employee offboarding and role-transition lock order.
  if p_task_id is not null then
    select task.board_id
      into v_effective_board_id
      from public.merchant_tasks as task
     where task.merchant_id = v_site_id
       and task.id = p_task_id
     for update;
    if not found then
      raise exception '%', p_scope_error;
    end if;
  else
    v_effective_board_id := p_board_id;
  end if;

  select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
    into v_participant_ids
    from unnest(
      case
        when v_actor_type = 'employee'
          then array_append(v_assignee_ids, v_actor_id)
        else v_assignee_ids
      end
    ) as participant(employee_id);

  if cardinality(v_participant_ids) > 0 then
    perform 1
      from public.merchant_enterprise_employees as employee
     where employee.merchant_id = v_site_id
       and employee.id = any(v_participant_ids)
     order by employee.id
     for share of employee;
  end if;

  if cardinality(v_assignee_ids) > 0 then
    select count(*)::integer
      into v_valid_assignee_count
      from public.merchant_enterprise_employees as employee
     where employee.merchant_id = v_site_id
       and employee.id = any(v_assignee_ids)
       and employee.status = 'active';
    if v_valid_assignee_count <> cardinality(v_assignee_ids) then
      raise exception 'invalid_task_assignees';
    end if;
  end if;

  select coalesce(array_agg(distinct employee.role_id order by employee.role_id), '{}'::uuid[])
    into v_participant_role_ids
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = any(v_participant_ids)
     and employee.role_id is not null;
  if cardinality(v_participant_role_ids) > 0 then
    perform 1
      from public.merchant_enterprise_roles as role_row
     where role_row.merchant_id = v_site_id
       and role_row.id = any(v_participant_role_ids)
     order by role_row.id
     for share of role_row;
  end if;

  if v_actor_type = 'employee' then
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id;
    if not found
       or v_actor_employee.status <> 'active'
       or v_actor_employee.role_id is null then
      raise exception 'permission_denied';
    end if;

    select *
      into v_actor_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_actor_employee.role_id;
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
    if v_actor_role.access_scope = 'restricted' and not exists (
      select 1
        from public.merchant_enterprise_role_boards as role_board
       where role_board.merchant_id = v_site_id
         and role_board.role_id = v_actor_role.id
         and role_board.board_id = v_effective_board_id
    ) then
      raise exception '%', p_scope_error;
    end if;
  end if;

  perform 1
    from public.merchant_task_boards as board
   where board.merchant_id = v_site_id
     and board.id = v_effective_board_id
   for share of board;
  if not found then
    raise exception '%', p_scope_error;
  end if;

  return v_effective_board_id;
end;
$$;

create or replace function public.faolla_create_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id_text text;
  v_board_id uuid;
  v_assignee_ids uuid[] := '{}'::uuid[];
  v_required_permissions text[] := array['tasks.create']::text[];
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_payload';
  end if;
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  if v_board_id_text is null
     or v_board_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task';
  end if;
  if jsonb_typeof(coalesce(p_input -> 'assignee_ids', '[]'::jsonb)) <> 'array'
     or exists (
       select 1
         from jsonb_array_elements(
           coalesce(p_input -> 'assignee_ids', '[]'::jsonb)
         ) as item(value)
        where jsonb_typeof(item.value) <> 'string'
           or (item.value #>> '{}') !~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) then
    raise exception 'invalid_task_assignees';
  end if;
  select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
    into v_assignee_ids
    from (
      select (item.value #>> '{}')::uuid as employee_id
        from jsonb_array_elements(
          coalesce(p_input -> 'assignee_ids', '[]'::jsonb)
        ) as item(value)
    ) as requested;
  if cardinality(v_assignee_ids) > 0 then
    v_required_permissions := array_append(
      v_required_permissions,
      'tasks.assign'
    );
  end if;
  v_board_id := v_board_id_text::uuid;
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    null,
    v_board_id,
    v_required_permissions,
    v_assignee_ids,
    'board_not_found'
  );
  return public.faolla_create_merchant_task_v1_unchecked_015(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id_text text;
  v_task_id uuid;
  v_replace_assignees boolean := false;
  v_assignee_ids uuid[] := '{}'::uuid[];
  v_required_permissions text[] := '{}'::text[];
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_payload';
  end if;
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_update';
  end if;
  if p_input ? 'replace_assignees' then
    if jsonb_typeof(p_input -> 'replace_assignees') <> 'boolean' then
      raise exception 'invalid_task_assignees';
    end if;
    v_replace_assignees := (p_input ->> 'replace_assignees')::boolean;
  end if;
  if v_replace_assignees then
    if jsonb_typeof(coalesce(p_input -> 'assignee_ids', '[]'::jsonb)) <> 'array'
       or exists (
         select 1
           from jsonb_array_elements(
             coalesce(p_input -> 'assignee_ids', '[]'::jsonb)
           ) as item(value)
          where jsonb_typeof(item.value) <> 'string'
             or (item.value #>> '{}') !~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'invalid_task_assignees';
    end if;
    select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
      into v_assignee_ids
      from (
        select (item.value #>> '{}')::uuid as employee_id
          from jsonb_array_elements(
            coalesce(p_input -> 'assignee_ids', '[]'::jsonb)
          ) as item(value)
      ) as requested;
    v_required_permissions := array_append(
      v_required_permissions,
      'tasks.assign'
    );
  end if;
  if p_input ? 'archived' then
    v_required_permissions := array_append(
      v_required_permissions,
      'tasks.archive'
    );
  end if;
  if p_input ? 'column_id'
     or p_input ? 'title'
     or p_input ? 'description'
     or p_input ? 'priority'
     or p_input ? 'due_at'
     or p_input ? 'position' then
    v_required_permissions := array_append(
      v_required_permissions,
      'tasks.update'
    );
  end if;
  if cardinality(v_required_permissions) = 0 then
    v_required_permissions := array['tasks.update']::text[];
  end if;
  v_task_id := v_task_id_text::uuid;
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id,
    null,
    v_required_permissions,
    v_assignee_ids,
    'task_not_found'
  );
  return public.faolla_update_merchant_task_v1_unchecked_015(p_input);
end;
$$;

create or replace function public.faolla_move_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_task_id uuid;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_move_payload';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_move';
  end if;
  v_task_id := v_task_id_text::uuid;
  -- The unchecked mover takes this advisory lock before task rows. Taking the
  -- same re-entrant lock here preserves that ordering around authorization.
  perform pg_advisory_xact_lock(
    hashtextextended('faolla-enterprise-task-order:' || v_site_id, 0)
  );
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id,
    null,
    array['tasks.update']::text[],
    '{}'::uuid[],
    'task_not_found'
  );
  return public.faolla_move_merchant_task_v1_unchecked_015(p_input);
end;
$$;

create or replace function public.faolla_add_merchant_task_comment_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id_text text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_comment_payload';
  end if;
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_comment';
  end if;
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id_text::uuid,
    null,
    array['tasks.update']::text[],
    '{}'::uuid[],
    'task_not_found'
  );
  return public.faolla_add_merchant_task_comment_v1_unchecked_015(p_input);
end;
$$;

create or replace function public.faolla_create_merchant_task_checklist_item_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id_text text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_checklist_payload';
  end if;
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_checklist_create';
  end if;
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id_text::uuid,
    null,
    array['tasks.update']::text[],
    '{}'::uuid[],
    'task_not_found'
  );
  return public.faolla_create_task_checklist_item_v1_unchecked_015(p_input);
end;
$$;

create or replace function public.faolla_update_merchant_task_checklist_item_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id_text text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_checklist_payload';
  end if;
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_checklist_update';
  end if;
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id_text::uuid,
    null,
    array['tasks.update']::text[],
    '{}'::uuid[],
    'task_not_found'
  );
  return public.faolla_update_task_checklist_item_v1_unchecked_015(p_input);
end;
$$;

revoke all on function public.faolla_authorize_merchant_task_write_v1(
  jsonb, uuid, uuid, text[], uuid[], text
) from public, anon, authenticated, service_role;

revoke all on function public.faolla_create_merchant_task_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_move_merchant_task_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_add_merchant_task_comment_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_checklist_item_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_checklist_item_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_create_merchant_task_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_v1(jsonb)
  to service_role;
grant execute on function public.faolla_move_merchant_task_v1(jsonb)
  to service_role;
grant execute on function public.faolla_add_merchant_task_comment_v1(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_task_checklist_item_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_checklist_item_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608020015, 'merchant_enterprise_task_atomic_authorization')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
