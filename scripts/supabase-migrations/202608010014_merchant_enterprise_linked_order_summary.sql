-- Authorize an assigned employee to resolve the immutable order source linked
-- to a task. The application can then fetch a deliberately redacted order
-- summary without accepting an arbitrary order identifier from the employee.

begin;

-- Expand the role constraint without changing any existing role permission
-- arrays. The new permission remains opt-in for both existing and new roles.
alter table public.merchant_enterprise_roles
  drop constraint merchant_enterprise_roles_permissions_check;

alter table public.merchant_enterprise_roles
  add constraint merchant_enterprise_roles_permissions_check
  check (
    permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage'
    ]::text[]
  );

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
      'orders.linked.view',
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
      not ('orders.linked.view' = any(p_permissions))
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

create or replace function public.faolla_authorize_merchant_linked_order_summary_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_employee_id_text text;
  v_task_id uuid;
  v_employee_id uuid;
  v_source_id text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_linked_order_summary_request';
  end if;

  -- Reject extra keys so this RPC can never become an arbitrary-order lookup
  -- through caller-controlled identifiers or an accidental actor override.
  if (select count(*) from jsonb_object_keys(p_input)) <> 3
     or p_input - array[
       'merchant_id',
       'task_id',
       'employee_id'
     ]::text[] <> '{}'::jsonb
     or not (p_input ? 'merchant_id')
     or jsonb_typeof(p_input -> 'merchant_id') <> 'string'
     or not (p_input ? 'task_id')
     or jsonb_typeof(p_input -> 'task_id') <> 'string'
     or not (p_input ? 'employee_id')
     or jsonb_typeof(p_input -> 'employee_id') <> 'string' then
    raise exception 'invalid_linked_order_summary_request';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_employee_id_text is null
     or v_employee_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_linked_order_summary_request';
  end if;
  v_task_id := v_task_id_text::uuid;
  v_employee_id := v_employee_id_text::uuid;

  -- One statement takes one database snapshot for every visibility condition.
  -- Only the immutable source identifier leaves the authorization boundary.
  select task.source_id
    into v_source_id
    from public.merchant_enterprise_employees as employee
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id
     and role_row.id = employee.role_id
    join public.merchant_task_assignees as assignee
      on assignee.merchant_id = employee.merchant_id
     and assignee.employee_id = employee.id
    join public.merchant_tasks as task
      on task.merchant_id = assignee.merchant_id
     and task.id = assignee.task_id
    left join public.merchant_enterprise_role_boards as role_board
      on role_board.merchant_id = role_row.merchant_id
     and role_board.role_id = role_row.id
     and role_board.board_id = task.board_id
   where employee.merchant_id = v_site_id
     and employee.id = v_employee_id
     and employee.status = 'active'
     and role_row.status = 'active'
     and 'enterprise.view' = any(role_row.permissions)
     and 'tasks.view' = any(role_row.permissions)
     and 'orders.linked.view' = any(role_row.permissions)
     and task.merchant_id = v_site_id
     and task.id = v_task_id
     and task.source_type = 'order'
     and task.source_id <> ''
     and (
       role_row.access_scope = 'all'
       or (
         role_row.access_scope = 'restricted'
         and role_board.board_id is not null
       )
     );

  if not found then
    -- Do not disclose whether the task, assignment, employee, role, permission,
    -- source link, or board mapping was the missing visibility condition.
    raise exception 'task_not_found';
  end if;

  return jsonb_build_object('source_id', v_source_id);
end;
$$;

revoke all on function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  from public, anon, authenticated;
revoke all on function public.faolla_authorize_merchant_linked_order_summary_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_authorize_merchant_linked_order_summary_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608010014, 'merchant_enterprise_linked_order_summary')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
