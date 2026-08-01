begin;

-- Close the employee role-change workflow without weakening the direct-write
-- assignment guard introduced by migration 009. Existing offboarding inputs
-- remain valid and continue to resolve every open task exactly as migration
-- 010 did; role transitions resolve only assignments the next role cannot see.

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
  v_expected_role_version bigint;
  v_actor_type text;
  v_actor_id text;
  v_actor_employee_id uuid;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_current_role public.merchant_enterprise_roles%rowtype;
  v_next_role public.merchant_enterprise_roles%rowtype;
  v_next_role_id uuid;
  v_next_display_name text;
  v_next_status text;
  v_role_is_changing boolean := false;
  v_role_transition_mode text;
  v_offboarding_mode text;
  v_replacement_employee_id_text text;
  v_replacement_employee_id uuid;
  v_replacement_employee public.merchant_enterprise_employees%rowtype;
  v_replacement_role public.merchant_enterprise_roles%rowtype;
  v_open_task_ids uuid[] := '{}'::uuid[];
  v_open_task_count integer := 0;
  v_role_task_ids uuid[] := '{}'::uuid[];
  v_role_task_count integer := 0;
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
  if p_input ? 'expected_role_version' and (
    jsonb_typeof(p_input -> 'expected_role_version') <> 'number'
    or (p_input ->> 'expected_role_version') !~ '^[1-9][0-9]*$'
    or char_length(p_input ->> 'expected_role_version') > 18
  ) then
    raise exception 'invalid_employee_role_transition';
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
  if p_input ? 'role_transition_mode' and (
    jsonb_typeof(p_input -> 'role_transition_mode') <> 'string'
    or btrim(p_input ->> 'role_transition_mode') not in ('unassign', 'reassign')
  ) then
    raise exception 'invalid_employee_role_transition';
  end if;
  if p_input ? 'replacement_employee_id' and (
    jsonb_typeof(p_input -> 'replacement_employee_id') <> 'string'
    or btrim(p_input ->> 'replacement_employee_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    if p_input ? 'role_transition_mode' then
      raise exception 'employee_role_transition_replacement_invalid';
    end if;
    raise exception 'employee_offboarding_replacement_invalid';
  end if;

  v_employee_id := v_employee_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  if p_input ? 'expected_role_version' then
    v_expected_role_version := (p_input ->> 'expected_role_version')::bigint;
  end if;
  if v_actor_type = 'employee' then
    v_actor_employee_id := v_actor_id::uuid;
  end if;
  v_offboarding_mode := case
    when p_input ? 'offboarding_mode' then btrim(p_input ->> 'offboarding_mode')
    else null
  end;
  v_role_transition_mode := case
    when p_input ? 'role_transition_mode' then btrim(p_input ->> 'role_transition_mode')
    else null
  end;
  if v_offboarding_mode is not null and v_role_transition_mode is not null then
    raise exception 'invalid_employee_role_transition';
  end if;
  v_replacement_employee_id_text := case
    when p_input ? 'replacement_employee_id'
      then btrim(p_input ->> 'replacement_employee_id')
    else null
  end;
  if v_offboarding_mode = 'reassign' and v_replacement_employee_id_text is null then
    raise exception 'employee_offboarding_replacement_invalid';
  end if;
  if v_role_transition_mode = 'reassign' and v_replacement_employee_id_text is null then
    raise exception 'employee_role_transition_replacement_invalid';
  end if;
  if v_offboarding_mode is distinct from 'reassign'
     and v_role_transition_mode is distinct from 'reassign'
     and v_replacement_employee_id_text is not null then
    if v_role_transition_mode is not null then
      raise exception 'employee_role_transition_replacement_invalid';
    end if;
    raise exception 'employee_offboarding_replacement_invalid';
  end if;
  if v_replacement_employee_id_text is not null then
    v_replacement_employee_id := v_replacement_employee_id_text::uuid;
    if v_replacement_employee_id = v_employee_id then
      if v_role_transition_mode is not null then
        raise exception 'employee_role_transition_replacement_invalid';
      end if;
      raise exception 'employee_offboarding_replacement_invalid';
    end if;
  end if;

  -- Keep the established lock order: all currently visible open task rows,
  -- then participating employee rows, then role rows in UUID order.
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

  if v_actor_type = 'employee' then
    if v_actor_employee_id = v_employee_id then
      raise exception 'permission_escalation_denied';
    end if;
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_employee_id
       and status = 'active';
    if not found then
      raise exception 'permission_escalation_denied';
    end if;
  end if;
  if v_replacement_employee_id is not null then
    select *
      into v_replacement_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_replacement_employee_id;
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
  v_role_is_changing := v_next_role_id is distinct from v_employee.role_id;
  if v_role_is_changing and v_expected_role_version is null then
    raise exception 'invalid_employee_role_transition';
  end if;
  if v_role_transition_mode is not null and not v_role_is_changing then
    raise exception 'invalid_employee_role_transition';
  end if;
  if v_role_transition_mode is not null and (
    v_employee.status = 'active' and v_next_status = 'disabled'
  ) then
    raise exception 'invalid_employee_role_transition';
  end if;

  -- Lock the current, next, actor, and replacement roles in one stable order.
  perform 1
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = any(array_remove(array[
       v_employee.role_id,
       v_next_role_id,
       v_actor_employee.role_id,
       v_replacement_employee.role_id
     ], null::uuid))
   order by role_row.id
   for share of role_row;

  if v_employee.role_id is not null then
    select *
      into v_current_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_employee.role_id;
  end if;
  select *
    into v_next_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_next_role_id
     and status = 'active';
  if not found then
    raise exception 'invalid_employee_role';
  end if;
  if v_role_is_changing and v_next_role.version <> v_expected_role_version then
    raise exception 'enterprise_version_conflict';
  end if;

  if v_actor_type = 'employee' then
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
    if v_current_role.id is null
       or not public.faolla_merchant_enterprise_role_fits_actor_v1(
         v_site_id,
         v_actor_role.id,
         v_current_role.id
       )
       or not public.faolla_merchant_enterprise_role_fits_actor_v1(
         v_site_id,
         v_actor_role.id,
         v_next_role.id
       ) then
      raise exception 'permission_escalation_denied';
    end if;
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

  -- Re-read and lock the final open assignment set after the employee lock.
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

  if v_role_is_changing and not (
    v_employee.status = 'active' and v_next_status = 'disabled'
  ) then
    select coalesce(array_agg(task.id order by task.id), '{}'::uuid[])
      into v_role_task_ids
      from public.merchant_task_assignees as assignee
      join public.merchant_tasks as task
        on task.merchant_id = assignee.merchant_id
       and task.id = assignee.task_id
      left join public.merchant_enterprise_role_boards as next_role_board
        on next_role_board.merchant_id = task.merchant_id
       and next_role_board.role_id = v_next_role.id
       and next_role_board.board_id = task.board_id
     where assignee.merchant_id = v_site_id
       and assignee.employee_id = v_employee_id
       and task.archived_at is null
       and task.completed_at is null
       and (
         not ('tasks.view' = any(v_next_role.permissions))
         or (
           v_next_role.access_scope = 'restricted'
           and next_role_board.board_id is null
         )
       );
    v_role_task_count := cardinality(v_role_task_ids);

    if v_role_task_count > 0 and v_role_transition_mode is null then
      raise exception 'employee_role_transition_required';
    end if;

    if v_role_task_count > 0 and v_actor_type = 'employee' then
      if not ('tasks.assign' = any(v_actor_role.permissions)) then
        raise exception 'employee_role_transition_scope_denied';
      end if;
      if v_actor_role.access_scope = 'restricted' and exists (
        select 1
          from public.merchant_tasks as task
          left join public.merchant_enterprise_role_boards as actor_board
            on actor_board.merchant_id = task.merchant_id
           and actor_board.role_id = v_actor_role.id
           and actor_board.board_id = task.board_id
         where task.merchant_id = v_site_id
           and task.id = any(v_role_task_ids)
           and actor_board.board_id is null
      ) then
        raise exception 'employee_role_transition_scope_denied';
      end if;
    end if;

    if v_role_transition_mode = 'reassign' then
      if v_replacement_employee.id is null
         or v_replacement_employee.status <> 'active' then
        raise exception 'employee_role_transition_replacement_invalid';
      end if;
      select *
        into v_replacement_role
        from public.merchant_enterprise_roles
       where merchant_id = v_site_id
         and id = v_replacement_employee.role_id
         and status = 'active'
         and 'tasks.view' = any(permissions);
      if not found then
        raise exception 'employee_role_transition_replacement_invalid';
      end if;
      if v_role_task_count > 0
         and v_replacement_role.access_scope = 'restricted'
         and exists (
        select 1
          from public.merchant_tasks as task
          left join public.merchant_enterprise_role_boards as replacement_board
            on replacement_board.merchant_id = task.merchant_id
           and replacement_board.role_id = v_replacement_role.id
           and replacement_board.board_id = task.board_id
         where task.merchant_id = v_site_id
           and task.id = any(v_role_task_ids)
           and replacement_board.board_id is null
      ) then
        raise exception 'employee_role_transition_replacement_invalid';
      end if;

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
        case when v_actor_type = 'employee' then v_actor_employee_id else null end
        from unnest(v_role_task_ids) as requested_task(task_id)
      on conflict (merchant_id, task_id, employee_id) do nothing;
    end if;

    if v_role_task_count > 0 and v_role_transition_mode in ('unassign', 'reassign') then
      delete from public.merchant_task_assignees
       where merchant_id = v_site_id
         and employee_id = v_employee_id
         and task_id = any(v_role_task_ids);

      v_event_prefix := 'employee-role-transition:' || gen_random_uuid()::text;
      foreach v_task_id in array v_role_task_ids loop
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
          'fields', jsonb_build_array('assigneeIds', 'roleId'),
          'assigneeIds', v_final_assignee_ids,
          'employeeId', v_employee_id::text,
          'oldRoleId', v_current_role.id::text,
          'newRoleId', v_next_role.id::text
        );
        if v_role_transition_mode = 'reassign' then
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
        ) values (
          v_site_id,
          v_task_id,
          v_event_prefix || ':' || v_task_id::text,
          'employee_role_transitioned',
          v_actor_type,
          v_actor_id,
          v_event_payload
        );
      end loop;
    end if;
  elsif v_role_transition_mode is not null then
    raise exception 'invalid_employee_role_transition';
  end if;

  -- Preserve migration 010's complete active-to-disabled flow.
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
      if v_replacement_employee.id is null
         or v_replacement_employee.status <> 'active' then
        raise exception 'employee_offboarding_replacement_invalid';
      end if;
      select *
        into v_replacement_role
        from public.merchant_enterprise_roles
       where merchant_id = v_site_id
         and id = v_replacement_employee.role_id
         and status = 'active'
         and 'tasks.view' = any(permissions);
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
        case when v_actor_type = 'employee' then v_actor_employee_id else null end
        from unnest(v_open_task_ids) as requested_task(task_id)
      on conflict (merchant_id, task_id, employee_id) do nothing;
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
        ) values (
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
    'role_transition_affected_task_count', v_role_task_count,
    'role_transition_mode', v_role_transition_mode,
    'replacement_employee_id', case
      when v_offboarding_mode = 'reassign' or v_role_transition_mode = 'reassign'
        then v_replacement_employee_id::text
      else null
    end
  );
end;
$$;

revoke all on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310011, 'merchant_enterprise_employee_role_transition')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
