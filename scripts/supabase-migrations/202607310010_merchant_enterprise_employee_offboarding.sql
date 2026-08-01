-- Make employee creation, role assignment, and offboarding transactional.
-- Existing employee and task rows are intentionally left unchanged. The new
-- guards apply only to future writes and fail closed around open assignments.
-- Both mutation RPCs are executable only by service_role. Owner actor identity
-- is authenticated and merchant-bound by the API before this trusted call;
-- employee actors are revalidated against mutable database authorization here.

begin;

create or replace function public.faolla_merchant_enterprise_role_fits_actor_v1(
  p_merchant_id text,
  p_actor_role_id uuid,
  p_target_role_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.merchant_enterprise_roles as actor_role
      join public.merchant_enterprise_roles as target_role
        on target_role.merchant_id = actor_role.merchant_id
       and target_role.id = p_target_role_id
     where actor_role.merchant_id = p_merchant_id
       and actor_role.id = p_actor_role_id
       and actor_role.status = 'active'
       and target_role.status = 'active'
       and target_role.permissions <@ actor_role.permissions
       and (
         actor_role.access_scope = 'all'
         or (
           target_role.access_scope = 'restricted'
           and not exists (
             select 1
               from public.merchant_enterprise_role_boards as target_board
               left join public.merchant_enterprise_role_boards as actor_board
                 on actor_board.merchant_id = target_board.merchant_id
                and actor_board.role_id = actor_role.id
                and actor_board.board_id = target_board.board_id
              where target_board.merchant_id = p_merchant_id
                and target_board.role_id = target_role.id
                and actor_board.board_id is null
           )
         )
       )
  );
$$;

create or replace function public.faolla_guard_merchant_employee_open_task_disable_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active'
     and new.status <> 'active'
     and exists (
       select 1
         from public.merchant_task_assignees as assignee
         join public.merchant_tasks as task
           on task.merchant_id = assignee.merchant_id
          and task.id = assignee.task_id
        where assignee.merchant_id = new.merchant_id
          and assignee.employee_id = new.id
          and task.archived_at is null
          and task.completed_at is null
     ) then
    raise exception 'employee_open_tasks_require_resolution';
  end if;

  if old.status <> 'invited' and new.status = 'invited' then
    raise exception 'invalid_employee_status_transition';
  end if;

  return new;
end;
$$;

drop trigger if exists merchant_enterprise_employees_open_task_disable_guard
  on public.merchant_enterprise_employees;
create trigger merchant_enterprise_employees_open_task_disable_guard
before update of status on public.merchant_enterprise_employees
for each row execute function public.faolla_guard_merchant_employee_open_task_disable_v1();

-- Replace the 009 reactivation guard so a disabled employee or inactive role
-- is invalid rather than silently skipped by an active-only inner join.
create or replace function public.faolla_guard_merchant_task_reactivation_assignees_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    new.archived_at is null
    and new.completed_at is null
    and (
      old.archived_at is not null
      or old.completed_at is not null
    )
  ) then
    return new;
  end if;

  -- Lock employee and role rows after the task row. Task and assignment RPCs
  -- use the same task-before-employee order.
  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = assignee.merchant_id
     and employee.id = assignee.employee_id
   where assignee.merchant_id = new.merchant_id
     and assignee.task_id = new.id
   order by employee.id
   for share of employee;

  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = assignee.merchant_id
     and employee.id = assignee.employee_id
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id
     and role_row.id = employee.role_id
   where assignee.merchant_id = new.merchant_id
     and assignee.task_id = new.id
   order by role_row.id
   for share of role_row;

  if exists (
    select 1
      from public.merchant_task_assignees as assignee
      left join public.merchant_enterprise_employees as employee
        on employee.merchant_id = assignee.merchant_id
       and employee.id = assignee.employee_id
      left join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
      left join public.merchant_enterprise_role_boards as role_board
        on role_board.merchant_id = role_row.merchant_id
       and role_board.role_id = role_row.id
       and role_board.board_id = new.board_id
     where assignee.merchant_id = new.merchant_id
       and assignee.task_id = new.id
       and (
         employee.id is null
         or employee.status <> 'active'
         or role_row.id is null
         or role_row.status <> 'active'
         or not ('tasks.view' = any(role_row.permissions))
         or (
           role_row.access_scope = 'restricted'
           and role_board.board_id is null
         )
       )
  ) then
    raise exception 'task_assignee_board_access_denied';
  end if;

  return new;
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
  v_site_id text;
  v_email text;
  v_display_name text;
  v_role_id_text text;
  v_role_id uuid;
  v_actor_type text;
  v_actor_id text;
  v_actor_employee_id uuid;
  v_actor_role public.merchant_enterprise_roles%rowtype;
  v_target_role public.merchant_enterprise_roles%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_email := lower(nullif(btrim(p_input ->> 'email'), ''));
  v_display_name := nullif(btrim(p_input ->> 'display_name'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id := nullif(btrim(p_input ->> 'actor_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_email is null
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or v_display_name is null
     or char_length(v_display_name) > 120
     or v_role_id_text is null
     or v_role_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id is null
     or char_length(v_actor_id) > 120 then
    raise exception 'invalid_employee';
  end if;
  if v_actor_type = 'employee'
     and v_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_escalation_denied';
  end if;

  v_role_id := v_role_id_text::uuid;
  perform 1
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  if v_actor_type = 'employee' then
    v_actor_employee_id := v_actor_id::uuid;
    select role_row.*
      into v_actor_role
      from public.merchant_enterprise_employees as employee
      join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
     where employee.merchant_id = v_site_id
       and employee.id = v_actor_employee_id
       and employee.status = 'active'
       and role_row.status = 'active'
       and 'employees.manage' = any(role_row.permissions)
     for share of employee, role_row;
    if not found then
      raise exception 'permission_escalation_denied';
    end if;
  end if;

  select *
    into v_target_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_role_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_employee_role';
  end if;

  if v_actor_type = 'employee'
     and not public.faolla_merchant_enterprise_role_fits_actor_v1(
       v_site_id,
       v_actor_role.id,
       v_target_role.id
     ) then
    raise exception 'permission_escalation_denied';
  end if;

  begin
    insert into public.merchant_enterprise_employees (
      merchant_id,
      email,
      display_name,
      role_id,
      status,
      invited_at
    )
    values (
      v_site_id,
      v_email,
      v_display_name,
      v_target_role.id,
      'invited',
      statement_timestamp()
    )
    returning * into v_employee;
  exception
    when unique_violation then
      raise exception 'employee_email_in_use';
  end;

  return jsonb_build_object(
    'employee', to_jsonb(v_employee) - 'invitation_token_hash'
  );
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
  v_site_id text;
  v_employee_id_text text;
  v_employee_id uuid;
  v_expected_version bigint;
  v_actor_type text;
  v_actor_id text;
  v_actor_employee_id uuid;
  v_actor_role public.merchant_enterprise_roles%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_current_role public.merchant_enterprise_roles%rowtype;
  v_next_role public.merchant_enterprise_roles%rowtype;
  v_next_role_id uuid;
  v_next_display_name text;
  v_next_status text;
  v_offboarding_mode text;
  v_replacement_employee_id_text text;
  v_replacement_employee_id uuid;
  v_replacement_employee public.merchant_enterprise_employees%rowtype;
  v_replacement_role public.merchant_enterprise_roles%rowtype;
  v_open_task_ids uuid[] := '{}'::uuid[];
  v_open_task_count integer := 0;
  v_task_id uuid;
  v_final_assignee_ids jsonb;
  v_event_prefix text;
  v_event_payload jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_update';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id_text := nullif(btrim(p_input ->> 'employee_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_employee_id_text is null
     or v_employee_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'expected_version')
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id is null
     or char_length(v_actor_id) > 120
     or not (
       p_input ? 'display_name'
       or p_input ? 'role_id'
       or p_input ? 'status'
     ) then
    raise exception 'invalid_employee_update';
  end if;
  if v_actor_type = 'employee'
     and v_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_escalation_denied';
  end if;

  if p_input ? 'display_name' and (
    jsonb_typeof(p_input -> 'display_name') <> 'string'
    or nullif(btrim(p_input ->> 'display_name'), '') is null
    or char_length(btrim(p_input ->> 'display_name')) > 120
  ) then
    raise exception 'invalid_employee';
  end if;
  if p_input ? 'role_id' and (
    jsonb_typeof(p_input -> 'role_id') <> 'string'
    or btrim(p_input ->> 'role_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid_employee_role';
  end if;
  if p_input ? 'status' and (
    jsonb_typeof(p_input -> 'status') <> 'string'
    or btrim(p_input ->> 'status') not in ('invited', 'active', 'disabled')
  ) then
    raise exception 'invalid_employee_status';
  end if;
  if p_input ? 'offboarding_mode' and (
    jsonb_typeof(p_input -> 'offboarding_mode') <> 'string'
    or btrim(p_input ->> 'offboarding_mode') not in ('unassign', 'reassign')
  ) then
    raise exception 'invalid_employee_offboarding';
  end if;
  if p_input ? 'replacement_employee_id' and (
    jsonb_typeof(p_input -> 'replacement_employee_id') <> 'string'
    or btrim(p_input ->> 'replacement_employee_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'employee_offboarding_replacement_invalid';
  end if;

  v_employee_id := v_employee_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  if v_actor_type = 'employee' then
    v_actor_employee_id := v_actor_id::uuid;
  end if;
  v_offboarding_mode := case
    when p_input ? 'offboarding_mode' then btrim(p_input ->> 'offboarding_mode')
    else null
  end;
  v_replacement_employee_id_text := case
    when p_input ? 'replacement_employee_id'
      then btrim(p_input ->> 'replacement_employee_id')
    else null
  end;
  if v_offboarding_mode = 'reassign' and v_replacement_employee_id_text is null then
    raise exception 'employee_offboarding_replacement_invalid';
  end if;
  if v_offboarding_mode is distinct from 'reassign'
     and v_replacement_employee_id_text is not null then
    raise exception 'employee_offboarding_replacement_invalid';
  end if;
  if v_replacement_employee_id_text is not null then
    v_replacement_employee_id := v_replacement_employee_id_text::uuid;
    if v_replacement_employee_id = v_employee_id then
      raise exception 'employee_offboarding_replacement_invalid';
    end if;
  end if;

  -- Match the task RPC lock order: task rows precede employee and role rows.
  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_tasks as task
      on task.merchant_id = assignee.merchant_id
     and task.id = assignee.task_id
   where assignee.merchant_id = v_site_id
     and assignee.employee_id = v_employee_id
     and task.archived_at is null
     and task.completed_at is null
   order by task.id
   for update of task;

  -- Lock every employee participating in this mutation in one stable order.
  -- This prevents crossed operations such as employee A disabling B while B
  -- disables A from taking the same employee rows in the opposite order.
  perform 1
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = any(array_remove(
       array[v_employee_id, v_actor_employee_id, v_replacement_employee_id],
       null::uuid
     ))
   order by employee.id
   for update of employee;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id;
  if not found then
    raise exception 'employee_not_found';
  end if;
  if v_employee.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;

  -- An assignment that committed before the employee lock is now visible;
  -- lock that final set before changing assignees or task versions.
  perform 1
    from public.merchant_task_assignees as assignee
    join public.merchant_tasks as task
      on task.merchant_id = assignee.merchant_id
     and task.id = assignee.task_id
   where assignee.merchant_id = v_site_id
     and assignee.employee_id = v_employee_id
     and task.archived_at is null
     and task.completed_at is null
   order by task.id
   for update of task;

  if v_actor_type = 'employee' then
    if v_actor_employee_id = v_employee_id then
      raise exception 'permission_escalation_denied';
    end if;
    select role_row.*
      into v_actor_role
      from public.merchant_enterprise_employees as employee
      join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
     where employee.merchant_id = v_site_id
       and employee.id = v_actor_employee_id
       and employee.status = 'active'
       and role_row.status = 'active'
       and 'employees.manage' = any(role_row.permissions)
     for share of employee, role_row;
    if not found then
      raise exception 'permission_escalation_denied';
    end if;
  end if;

  if v_employee.role_id is not null then
    select *
      into v_current_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_employee.role_id
     for share;
  end if;
  if v_actor_type = 'employee' and (
    v_current_role.id is null
    or not public.faolla_merchant_enterprise_role_fits_actor_v1(
      v_site_id,
      v_actor_role.id,
      v_current_role.id
    )
  ) then
    raise exception 'permission_escalation_denied';
  end if;

  v_next_display_name := case
    when p_input ? 'display_name' then btrim(p_input ->> 'display_name')
    else v_employee.display_name
  end;
  v_next_role_id := case
    when p_input ? 'role_id' then btrim(p_input ->> 'role_id')::uuid
    else v_employee.role_id
  end;
  v_next_status := case
    when p_input ? 'status' then btrim(p_input ->> 'status')
    else v_employee.status
  end;

  if v_next_role_id is null then
    raise exception 'invalid_employee_role';
  end if;
  select *
    into v_next_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_next_role_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_employee_role';
  end if;
  if v_actor_type = 'employee'
     and not public.faolla_merchant_enterprise_role_fits_actor_v1(
       v_site_id,
       v_actor_role.id,
       v_next_role.id
     ) then
    raise exception 'permission_escalation_denied';
  end if;

  if v_next_status = 'active' and v_employee.accepted_at is null then
    raise exception 'employee_invitation_not_accepted';
  end if;
  if v_employee.status = 'invited' and v_next_status = 'disabled' then
    raise exception 'employee_invitation_revoke_required';
  end if;
  if v_next_status = 'invited' and v_employee.status <> 'invited' then
    raise exception 'invalid_employee_status_transition';
  end if;
  if v_offboarding_mode is not null and not (
    v_employee.status = 'active'
    and v_next_status = 'disabled'
  ) then
    raise exception 'invalid_employee_offboarding';
  end if;

  select coalesce(array_agg(task.id order by task.id), '{}'::uuid[])
    into v_open_task_ids
    from public.merchant_task_assignees as assignee
    join public.merchant_tasks as task
      on task.merchant_id = assignee.merchant_id
     and task.id = assignee.task_id
   where assignee.merchant_id = v_site_id
     and assignee.employee_id = v_employee_id
     and task.archived_at is null
     and task.completed_at is null;
  v_open_task_count := cardinality(v_open_task_ids);

  if v_employee.status = 'active' and v_next_status = 'disabled' then
    if v_open_task_count > 0 and v_offboarding_mode is null then
      raise exception 'employee_open_tasks_require_resolution';
    end if;

    if v_open_task_count > 0 and v_actor_type = 'employee' then
      if not ('tasks.assign' = any(v_actor_role.permissions)) then
        raise exception 'employee_offboarding_scope_denied';
      end if;
      if v_actor_role.access_scope = 'restricted' and exists (
        select 1
          from public.merchant_tasks as task
          left join public.merchant_enterprise_role_boards as actor_board
            on actor_board.merchant_id = task.merchant_id
           and actor_board.role_id = v_actor_role.id
           and actor_board.board_id = task.board_id
         where task.merchant_id = v_site_id
           and task.id = any(v_open_task_ids)
           and actor_board.board_id is null
      ) then
        raise exception 'employee_offboarding_scope_denied';
      end if;
    end if;

    if v_offboarding_mode = 'reassign' then
      select *
        into v_replacement_employee
        from public.merchant_enterprise_employees
       where merchant_id = v_site_id
         and id = v_replacement_employee_id
         and status = 'active';
      if not found then
        raise exception 'employee_offboarding_replacement_invalid';
      end if;

      select *
        into v_replacement_role
        from public.merchant_enterprise_roles
       where merchant_id = v_site_id
         and id = v_replacement_employee.role_id
         and status = 'active'
         and 'tasks.view' = any(permissions)
       for share;
      if not found then
        raise exception 'employee_offboarding_replacement_invalid';
      end if;

      if v_open_task_count > 0
         and v_replacement_role.access_scope = 'restricted'
         and exists (
        select 1
          from public.merchant_tasks as task
          left join public.merchant_enterprise_role_boards as replacement_board
            on replacement_board.merchant_id = task.merchant_id
           and replacement_board.role_id = v_replacement_role.id
           and replacement_board.board_id = task.board_id
         where task.merchant_id = v_site_id
            and task.id = any(v_open_task_ids)
            and replacement_board.board_id is null
      ) then
        raise exception 'employee_offboarding_replacement_invalid';
      end if;

      if v_open_task_count > 0 then
        insert into public.merchant_task_assignees (
          merchant_id,
          task_id,
          employee_id,
          assigned_by_employee_id
        )
        select
          v_site_id,
          requested_task.task_id,
          v_replacement_employee.id,
          case
            when v_actor_type = 'employee' then v_actor_employee_id
            else null
          end
          from unnest(v_open_task_ids) as requested_task(task_id)
        on conflict (merchant_id, task_id, employee_id) do nothing;
      end if;
    end if;

    if v_open_task_count > 0 and v_offboarding_mode in ('unassign', 'reassign') then
      delete from public.merchant_task_assignees
       where merchant_id = v_site_id
         and employee_id = v_employee_id
         and task_id = any(v_open_task_ids);

      v_event_prefix := 'employee-offboard:' || gen_random_uuid()::text;
      foreach v_task_id in array v_open_task_ids loop
        update public.merchant_tasks
           set updated_at = updated_at
         where merchant_id = v_site_id
           and id = v_task_id;

        select coalesce(
          jsonb_agg(assignee.employee_id::text order by assignee.employee_id::text),
          '[]'::jsonb
        )
          into v_final_assignee_ids
          from public.merchant_task_assignees as assignee
         where assignee.merchant_id = v_site_id
           and assignee.task_id = v_task_id;

        v_event_payload := jsonb_build_object(
          'fields', jsonb_build_array('assigneeIds'),
          'assigneeIds', v_final_assignee_ids,
          'offboardedEmployeeId', v_employee_id::text
        );
        if v_offboarding_mode = 'reassign' then
          v_event_payload := v_event_payload || jsonb_build_object(
            'replacementEmployeeId', v_replacement_employee_id::text
          );
        end if;

        insert into public.merchant_task_events (
          merchant_id,
          task_id,
          operation_id,
          event_type,
          actor_type,
          actor_id,
          payload
        )
        values (
          v_site_id,
          v_task_id,
          v_event_prefix || ':' || v_task_id::text,
          'employee_offboarded',
          v_actor_type,
          v_actor_id,
          v_event_payload
        );
      end loop;
    end if;
  end if;

  update public.merchant_enterprise_employees
     set display_name = v_next_display_name,
         role_id = v_next_role.id,
         status = v_next_status,
         updated_at = updated_at
   where merchant_id = v_site_id
     and id = v_employee_id
     and version = v_expected_version
  returning * into v_employee;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  return jsonb_build_object(
    'employee', to_jsonb(v_employee) - 'invitation_token_hash',
    'affected_task_count', v_open_task_count,
    'offboarding_mode', v_offboarding_mode,
    'replacement_employee_id', case
      when v_offboarding_mode = 'reassign' then v_replacement_employee_id::text
      else null
    end
  );
end;
$$;

revoke all on function public.faolla_merchant_enterprise_role_fits_actor_v1(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.faolla_guard_merchant_employee_open_task_disable_v1()
  from public, anon, authenticated;
revoke all on function public.faolla_guard_merchant_task_reactivation_assignees_v1()
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310010, 'merchant_enterprise_employee_offboarding')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
