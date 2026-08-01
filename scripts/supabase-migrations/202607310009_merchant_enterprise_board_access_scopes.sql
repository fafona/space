-- Merchant enterprise role board-access scopes.
-- Existing roles retain full board access. Restricted roles store their allowed
-- boards in a merchant-scoped mapping table so board references remain valid.

begin;

alter table public.merchant_enterprise_roles
  add column if not exists access_scope text not null default 'all';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.merchant_enterprise_roles'::regclass
       and conname = 'merchant_enterprise_roles_access_scope_check'
  ) then
    alter table public.merchant_enterprise_roles
      add constraint merchant_enterprise_roles_access_scope_check
      check (access_scope in ('all', 'restricted'));
  end if;
end;
$$;

create table if not exists public.merchant_enterprise_role_boards (
  merchant_id text not null,
  role_id uuid not null,
  board_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (merchant_id, role_id, board_id),
  constraint merchant_enterprise_role_boards_role_fk
    foreign key (merchant_id, role_id)
    references public.merchant_enterprise_roles(merchant_id, id)
    on delete cascade,
  constraint merchant_enterprise_role_boards_board_fk
    foreign key (merchant_id, board_id)
    references public.merchant_task_boards(merchant_id, id)
    on delete cascade
);

create index if not exists merchant_enterprise_role_boards_board_role_idx
  on public.merchant_enterprise_role_boards(merchant_id, board_id, role_id);

alter table public.merchant_enterprise_role_boards enable row level security;
revoke all on public.merchant_enterprise_role_boards from public, anon, authenticated;
grant select on public.merchant_enterprise_role_boards to service_role;

create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p_permissions is not null
    and p_permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage'
    ]::text[]
    and (
      not ('tasks.view' = any(p_permissions))
      or 'enterprise.view' = any(p_permissions)
    )
    and (
      not ('tasks.create' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'tasks.view' = any(p_permissions)
      )
    )
    and (
      not ('tasks.update' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'tasks.view' = any(p_permissions)
      )
    )
    and (
      not ('tasks.assign' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'tasks.view' = any(p_permissions)
      )
    )
    and (
      not ('tasks.archive' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'tasks.view' = any(p_permissions)
      )
    )
    and (
      not ('boards.manage' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'tasks.view' = any(p_permissions)
      )
    )
    and (
      not ('roles.view' = any(p_permissions))
      or 'enterprise.view' = any(p_permissions)
    )
    and (
      not ('employees.view' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'roles.view' = any(p_permissions)
      )
    )
    and (
      not ('employees.manage' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'employees.view' = any(p_permissions)
        and 'roles.view' = any(p_permissions)
      )
    )
    and (
      not ('roles.manage' = any(p_permissions))
      or (
        'enterprise.view' = any(p_permissions)
        and 'roles.view' = any(p_permissions)
      )
    );
$$;

create or replace function public.faolla_employee_assignments_fit_role_v1(
  p_merchant_id text,
  p_employee_id uuid,
  p_role_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.merchant_enterprise_roles%rowtype;
begin
  select *
    into v_role
    from public.merchant_enterprise_roles
   where merchant_id = p_merchant_id
     and id = p_role_id
     and status = 'active'
   for share;

  if not found then
    return false;
  end if;

  if not ('tasks.view' = any(v_role.permissions)) then
    return not exists (
      select 1
        from public.merchant_task_assignees as assignee
        join public.merchant_tasks as task
          on task.merchant_id = assignee.merchant_id
         and task.id = assignee.task_id
       where assignee.merchant_id = p_merchant_id
         and assignee.employee_id = p_employee_id
         and task.archived_at is null
         and task.completed_at is null
    );
  end if;

  if v_role.access_scope = 'all' then
    return true;
  end if;

  return not exists (
    select 1
      from public.merchant_task_assignees as assignee
      join public.merchant_tasks as task
        on task.merchant_id = assignee.merchant_id
       and task.id = assignee.task_id
      left join public.merchant_enterprise_role_boards as role_board
        on role_board.merchant_id = p_merchant_id
       and role_board.role_id = v_role.id
       and role_board.board_id = task.board_id
     where assignee.merchant_id = p_merchant_id
       and assignee.employee_id = p_employee_id
       and task.archived_at is null
       and task.completed_at is null
       and role_board.board_id is null
  );
end;
$$;

create or replace function public.faolla_guard_merchant_task_assignee_board_access_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_id uuid;
  v_role public.merchant_enterprise_roles%rowtype;
begin
  select task.board_id
    into v_board_id
    from public.merchant_tasks as task
   where task.merchant_id = new.merchant_id
     and task.id = new.task_id
   for share;
  if not found then
    raise exception 'invalid_task_assignment';
  end if;

  select role_row.*
    into v_role
    from public.merchant_enterprise_employees as employee
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id
     and role_row.id = employee.role_id
   where employee.merchant_id = new.merchant_id
     and employee.id = new.employee_id
     and employee.status = 'active'
     and role_row.status = 'active'
   for share of employee, role_row;
  if not found
     or not ('tasks.view' = any(v_role.permissions)) then
    raise exception 'task_assignee_board_access_denied';
  end if;

  if v_role.access_scope = 'restricted' and not exists (
    select 1
      from public.merchant_enterprise_role_boards as role_board
     where role_board.merchant_id = new.merchant_id
       and role_board.role_id = v_role.id
       and role_board.board_id = v_board_id
  ) then
    raise exception 'task_assignee_board_access_denied';
  end if;

  return new;
end;
$$;

drop trigger if exists merchant_task_assignees_board_access_insert_guard
  on public.merchant_task_assignees;
create trigger merchant_task_assignees_board_access_insert_guard
before insert on public.merchant_task_assignees
for each row execute function public.faolla_guard_merchant_task_assignee_board_access_v1();

drop trigger if exists merchant_task_assignees_board_access_update_guard
  on public.merchant_task_assignees;
create trigger merchant_task_assignees_board_access_update_guard
before update of merchant_id, task_id, employee_id on public.merchant_task_assignees
for each row execute function public.faolla_guard_merchant_task_assignee_board_access_v1();

create or replace function public.faolla_guard_merchant_task_reactivation_assignees_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    (old.archived_at is not null and new.archived_at is null)
    or (old.completed_at is not null and new.completed_at is null)
  ) then
    return new;
  end if;

  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = assignee.merchant_id
     and employee.id = assignee.employee_id
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id
     and role_row.id = employee.role_id
    left join public.merchant_enterprise_role_boards as role_board
      on role_board.merchant_id = role_row.merchant_id
     and role_board.role_id = role_row.id
     and role_board.board_id = new.board_id
   where assignee.merchant_id = new.merchant_id
     and assignee.task_id = new.id
     and employee.status = 'active'
     and (
       role_row.status <> 'active'
       or not ('tasks.view' = any(role_row.permissions))
       or (
         role_row.access_scope = 'restricted'
         and role_board.board_id is null
       )
     )
   for share of employee, role_row;
  if found then
    raise exception 'task_assignee_board_access_denied';
  end if;

  return new;
end;
$$;

drop trigger if exists merchant_tasks_reactivation_assignee_access_guard
  on public.merchant_tasks;
create trigger merchant_tasks_reactivation_assignee_access_guard
before update of archived_at, completed_at on public.merchant_tasks
for each row execute function public.faolla_guard_merchant_task_reactivation_assignees_v1();

create or replace function public.faolla_guard_merchant_employee_role_assignments_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.role_id is distinct from old.role_id
    or (new.status = 'active' and old.status <> 'active')
  ) and (
    new.role_id is null
    or not public.faolla_employee_assignments_fit_role_v1(
      new.merchant_id,
      new.id,
      new.role_id
    )
  ) then
    raise exception 'employee_board_access_in_use';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_employees_role_assignments_guard
  on public.merchant_enterprise_employees;
create trigger merchant_enterprise_employees_role_assignments_guard
before update of role_id, status on public.merchant_enterprise_employees
for each row execute function public.faolla_guard_merchant_employee_role_assignments_v1();

create or replace function public.faolla_create_merchant_enterprise_role_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_name text;
  v_description text;
  v_access_scope text;
  v_permissions text[];
  v_allowed_board_ids uuid[] := '{}'::uuid[];
  v_allowed_count integer;
  v_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_role';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_name := nullif(btrim(p_input ->> 'name'), '');
  v_description := coalesce(p_input ->> 'description', '');
  v_access_scope := coalesce(nullif(btrim(p_input ->> 'access_scope'), ''), 'all');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_name is null
     or char_length(v_name) > 80
     or char_length(v_description) > 1000
     or v_access_scope not in ('all', 'restricted')
     or not (p_input ? 'permissions')
     or jsonb_typeof(p_input -> 'permissions') <> 'array'
     or jsonb_typeof(coalesce(p_input -> 'allowed_board_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_role';
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

  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_input -> 'allowed_board_ids', '[]'::jsonb)) as item(value)
     where jsonb_typeof(item.value) <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
        jsonb_array_length(coalesce(p_input -> 'allowed_board_ids', '[]'::jsonb))
     or (v_access_scope = 'all' and cardinality(v_allowed_board_ids) <> 0) then
    raise exception 'invalid_role_board_access';
  end if;

  perform 1
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  if cardinality(v_allowed_board_ids) > 0 then
    perform 1
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_allowed_board_ids)
     order by id
     for share;
    select count(*)::integer
      into v_allowed_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_allowed_board_ids);
    if v_allowed_count <> cardinality(v_allowed_board_ids) then
      raise exception 'invalid_role_board_access';
    end if;
  end if;

  insert into public.merchant_enterprise_roles (
    merchant_id,
    name,
    description,
    permissions,
    access_scope,
    status,
    is_system
  )
  values (
    v_site_id,
    v_name,
    v_description,
    v_permissions,
    v_access_scope,
    'active',
    false
  )
  returning * into v_role;

  if v_access_scope = 'restricted' then
    insert into public.merchant_enterprise_role_boards (
      merchant_id,
      role_id,
      board_id
    )
    select v_site_id, v_role.id, board_id
      from unnest(v_allowed_board_ids) as requested_board(board_id);
  end if;

  return jsonb_build_object(
    'role', to_jsonb(v_role) - 'system_key',
    'allowed_board_ids', to_jsonb(v_allowed_board_ids)
  );
end;
$$;

create or replace function public.faolla_update_merchant_enterprise_role_v1(
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
  v_expected_version bigint;
  v_role public.merchant_enterprise_roles%rowtype;
  v_next_name text;
  v_next_description text;
  v_next_status text;
  v_next_access_scope text;
  v_next_permissions text[];
  v_current_allowed_board_ids uuid[] := '{}'::uuid[];
  v_next_allowed_board_ids uuid[] := '{}'::uuid[];
  v_allowed_count integer;
  v_has_changes boolean;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_role_update';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_role_id_text is null
     or v_role_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'expected_version')
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18 then
    raise exception 'invalid_role_update';
  end if;
  v_role_id := v_role_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;

  select *
    into v_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_role_id
   for update;
  if not found then
    raise exception 'role_not_found';
  end if;
  if v_role.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;

  select coalesce(array_agg(board_id order by board_id), '{}'::uuid[])
    into v_current_allowed_board_ids
    from public.merchant_enterprise_role_boards
   where merchant_id = v_site_id
     and role_id = v_role_id;

  v_next_name := v_role.name;
  v_next_description := v_role.description;
  v_next_status := v_role.status;
  v_next_access_scope := v_role.access_scope;
  v_next_permissions := v_role.permissions;
  v_next_allowed_board_ids := v_current_allowed_board_ids;

  if p_input ? 'name' then
    if jsonb_typeof(p_input -> 'name') <> 'string'
       or nullif(btrim(p_input ->> 'name'), '') is null
       or char_length(btrim(p_input ->> 'name')) > 80 then
      raise exception 'invalid_role';
    end if;
    v_next_name := btrim(p_input ->> 'name');
  end if;

  if p_input ? 'description' then
    if jsonb_typeof(p_input -> 'description') <> 'string'
       or char_length(p_input ->> 'description') > 1000 then
      raise exception 'invalid_role';
    end if;
    v_next_description := btrim(p_input ->> 'description');
  end if;

  if p_input ? 'status' then
    if jsonb_typeof(p_input -> 'status') <> 'string'
       or btrim(p_input ->> 'status') not in ('active', 'archived') then
      raise exception 'invalid_role_status';
    end if;
    v_next_status := btrim(p_input ->> 'status');
  end if;

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
    if cardinality(v_next_permissions) <> jsonb_array_length(p_input -> 'permissions')
       or not public.faolla_valid_merchant_enterprise_permissions_v1(v_next_permissions) then
      raise exception 'invalid_permissions';
    end if;
  end if;

  if p_input ? 'access_scope' then
    if jsonb_typeof(p_input -> 'access_scope') <> 'string'
       or btrim(p_input ->> 'access_scope') not in ('all', 'restricted') then
      raise exception 'invalid_role_board_access';
    end if;
    v_next_access_scope := btrim(p_input ->> 'access_scope');
    if v_next_access_scope = 'all' and not (p_input ? 'allowed_board_ids') then
      v_next_allowed_board_ids := '{}'::uuid[];
    elsif v_role.access_scope = 'all'
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
          or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'invalid_role_board_access';
    end if;
    select coalesce(array_agg(distinct board_id order by board_id), '{}'::uuid[])
      into v_next_allowed_board_ids
      from (
        select (value #>> '{}')::uuid as board_id
          from jsonb_array_elements(p_input -> 'allowed_board_ids') as item(value)
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

  if cardinality(v_next_allowed_board_ids) > 0 then
    perform 1
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_next_allowed_board_ids)
     order by id
     for share;
    select count(*)::integer
      into v_allowed_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = any(v_next_allowed_board_ids);
    if v_allowed_count <> cardinality(v_next_allowed_board_ids) then
      raise exception 'invalid_role_board_access';
    end if;
  end if;

  v_has_changes :=
    p_input ? 'name'
    or p_input ? 'description'
    or p_input ? 'permissions'
    or p_input ? 'status'
    or p_input ? 'access_scope'
    or p_input ? 'allowed_board_ids';
  if not v_has_changes then
    raise exception 'invalid_role_update';
  end if;

  if v_next_status = 'archived' then
    if v_role.is_system then
      raise exception 'system_role_protected';
    end if;
    if exists (
      select 1
        from public.merchant_enterprise_employees
       where merchant_id = v_site_id
         and role_id = v_role_id
    ) then
      raise exception 'role_in_use';
    end if;
  end if;

  if exists (
    select 1
      from public.merchant_enterprise_employees as employee
      join public.merchant_task_assignees as assignee
        on assignee.merchant_id = employee.merchant_id
       and assignee.employee_id = employee.id
      join public.merchant_tasks as task
        on task.merchant_id = assignee.merchant_id
       and task.id = assignee.task_id
      left join unnest(v_next_allowed_board_ids) as allowed_board(board_id)
        on allowed_board.board_id = task.board_id
     where employee.merchant_id = v_site_id
       and employee.role_id = v_role_id
       and employee.status = 'active'
       and task.archived_at is null
       and task.completed_at is null
       and (
         not ('tasks.view' = any(v_next_permissions))
         or (
           v_next_access_scope = 'restricted'
           and allowed_board.board_id is null
         )
       )
  ) then
    raise exception 'role_board_access_in_use';
  end if;

  update public.merchant_enterprise_roles
     set name = v_next_name,
         description = v_next_description,
         permissions = v_next_permissions,
         status = v_next_status,
         access_scope = v_next_access_scope,
         updated_at = updated_at
   where merchant_id = v_site_id
     and id = v_role_id
     and version = v_expected_version
  returning * into v_role;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  delete from public.merchant_enterprise_role_boards
   where merchant_id = v_site_id
     and role_id = v_role_id;
  if v_next_access_scope = 'restricted' then
    insert into public.merchant_enterprise_role_boards (
      merchant_id,
      role_id,
      board_id
    )
    select v_site_id, v_role_id, board_id
      from unnest(v_next_allowed_board_ids) as requested_board(board_id);
  end if;

  return jsonb_build_object(
    'role', to_jsonb(v_role) - 'system_key',
    'allowed_board_ids', to_jsonb(v_next_allowed_board_ids)
  );
end;
$$;

revoke all on function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  from public, anon, authenticated;
revoke all on function public.faolla_employee_assignments_fit_role_v1(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.faolla_guard_merchant_task_assignee_board_access_v1()
  from public, anon, authenticated;
revoke all on function public.faolla_guard_merchant_task_reactivation_assignees_v1()
  from public, anon, authenticated;
revoke all on function public.faolla_guard_merchant_employee_role_assignments_v1()
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_enterprise_role_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_role_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_enterprise_role_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310009, 'merchant_enterprise_board_access_scopes')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
