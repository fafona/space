-- Unified enterprise todo read model. The RPC recalculates the current actor,
-- role permissions and board scope on every request, then returns one stable
-- keyset page plus full counts for the same permission-filtered result set.

begin;

create index if not exists merchant_enterprise_workflow_execution_open_employee_idx
  on public.merchant_enterprise_workflow_executions(
    merchant_id, employee_id, updated_at, id
  ) where status = 'in_progress';

create or replace function public.faolla_list_merchant_enterprise_todos_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth jsonb;
  v_actor_type text;
  v_employee_id uuid;
  v_role_id uuid;
  v_permissions text[] := '{}'::text[];
  v_access_scope text := 'restricted';
  v_can_view_tasks boolean := false;
  v_can_assign_tasks boolean := false;
  v_can_view_workflows boolean := false;
  v_can_manage_workflows boolean := false;
  v_category text;
  v_limit integer;
  v_cursor_bucket integer;
  v_cursor_sort_at timestamptz;
  v_cursor_kind text;
  v_cursor_id uuid;
  v_has_cursor boolean := false;
  v_now timestamptz := statement_timestamp();
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'category', 'limit',
      'cursor_bucket', 'cursor_sort_at', 'cursor_kind', 'cursor_id'
    ]::text[]
  )
  or not (
    p_input ?& array[
      'merchant_id', 'actor_type', 'actor_id', 'category', 'limit',
      'cursor_bucket', 'cursor_sort_at', 'cursor_kind', 'cursor_id'
    ]::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'category'), '') <> 'string'
  or btrim(p_input ->> 'category') not in ('all', 'tasks', 'workflows')
  or coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number'
  or (p_input ->> 'limit') !~ '^[1-9][0-9]?$' then
    raise exception 'invalid_enterprise_todo_query';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_category := btrim(p_input ->> 'category');
  begin
    v_limit := (p_input ->> 'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_enterprise_todo_query';
  end;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_enterprise_todo_query';
  end if;

  v_has_cursor := (p_input -> 'cursor_bucket') <> 'null'::jsonb
    or (p_input -> 'cursor_sort_at') <> 'null'::jsonb
    or (p_input -> 'cursor_kind') <> 'null'::jsonb
    or (p_input -> 'cursor_id') <> 'null'::jsonb;
  if v_has_cursor then
    if coalesce(jsonb_typeof(p_input -> 'cursor_bucket'), '') <> 'number'
       or (p_input ->> 'cursor_bucket') !~ '^[0-5]$'
       or coalesce(jsonb_typeof(p_input -> 'cursor_sort_at'), '') <> 'string'
       or char_length(p_input ->> 'cursor_sort_at') not between 1 and 80
       or coalesce(jsonb_typeof(p_input -> 'cursor_kind'), '') <> 'string'
       or btrim(p_input ->> 'cursor_kind') not in (
         'task', 'workflow_acknowledgement', 'workflow_execution', 'workflow_feedback'
       )
       or coalesce(jsonb_typeof(p_input -> 'cursor_id'), '') <> 'string'
       or (p_input ->> 'cursor_id') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid_enterprise_todo_query';
    end if;
    begin
      v_cursor_bucket := (p_input ->> 'cursor_bucket')::integer;
      v_cursor_sort_at := (p_input ->> 'cursor_sort_at')::timestamptz;
      v_cursor_id := (p_input ->> 'cursor_id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow
        or numeric_value_out_of_range then
        raise exception 'invalid_enterprise_todo_query';
    end;
    v_cursor_kind := btrim(p_input ->> 'cursor_kind');
  elsif (p_input -> 'cursor_bucket') <> 'null'::jsonb
     or (p_input -> 'cursor_sort_at') <> 'null'::jsonb
     or (p_input -> 'cursor_kind') <> 'null'::jsonb
     or (p_input -> 'cursor_id') <> 'null'::jsonb then
    raise exception 'invalid_enterprise_todo_query';
  end if;

  -- This helper validates merchant ownership or an active employee/role and
  -- never returns the owner's authentication UUID.
  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view']::text[]
  );
  v_actor_type := v_auth ->> 'actor_type';
  if v_actor_type = 'owner' then
    v_can_view_tasks := true;
    v_can_assign_tasks := true;
    v_can_view_workflows := true;
    v_can_manage_workflows := true;
    v_access_scope := 'all';
  else
    v_employee_id := (v_auth ->> 'actor_id')::uuid;
    select employee.role_id, role_row.permissions, role_row.access_scope
      into v_role_id, v_permissions, v_access_scope
      from public.merchant_enterprise_employees as employee
      join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
     where employee.merchant_id = v_site_id
       and employee.id = v_employee_id
       and employee.status = 'active'
       and role_row.status = 'active'
       and public.faolla_valid_merchant_enterprise_permissions_v1(
         role_row.permissions
       );
    if not found then raise exception 'permission_denied'; end if;
    v_can_view_tasks := 'tasks.view' = any(v_permissions);
    v_can_assign_tasks := 'tasks.assign' = any(v_permissions);
    v_can_view_workflows := 'workflows.view' = any(v_permissions);
    v_can_manage_workflows := 'workflows.manage' = any(v_permissions)
      or 'workflows.publish' = any(v_permissions);
  end if;

  with all_candidates as materialized (
    select
      'task'::text as kind,
      task.id as entity_id,
      case
        when task.due_at < v_now then 0
        when task.due_at <= v_now + interval '72 hours' then 1
        else 5
      end as bucket,
      coalesce(task.due_at, task.updated_at) as sort_at,
      task.title,
      board.name || ' · ' || task_column.name as subtitle,
      case
        when task.due_at < v_now then 'overdue'
        when task.due_at <= v_now + interval '72 hours' then 'due_soon'
        else 'normal'
      end as urgency,
      to_jsonb(array_remove(array[
        case when assignment.assigned_to_me then 'assigned_to_me' end,
        case when task.due_at < v_now then 'overdue' end,
        case when task.due_at >= v_now
                    and task.due_at <= v_now + interval '72 hours'
          then 'due_soon' end,
        case when assignment.assignee_count = 0 then 'unassigned' end
      ]::text[], null::text)) as reasons,
      task.due_at,
      task.id as task_id,
      task.board_id,
      board.name as board_name,
      task.priority,
      task.version,
      null::uuid as workflow_id,
      null::uuid as execution_id,
      null::integer as revision_no,
      null::integer as completed_steps,
      null::integer as total_steps,
      null::text as employee_name
    from public.merchant_tasks as task
    join public.merchant_task_boards as board
      on board.merchant_id = task.merchant_id
     and board.id = task.board_id
     and board.status = 'active'
    join public.merchant_task_columns as task_column
      on task_column.merchant_id = task.merchant_id
     and task_column.board_id = task.board_id
     and task_column.id = task.column_id
     and task_column.status = 'active'
    left join lateral (
      select
        count(*)::integer as assignee_count,
        coalesce(bool_or(assignee.employee_id = v_employee_id), false)
          as assigned_to_me
      from public.merchant_task_assignees as assignee
      where assignee.merchant_id = task.merchant_id
        and assignee.task_id = task.id
    ) as assignment on true
    where v_can_view_tasks
      and task.merchant_id = v_site_id
      and task.archived_at is null
      and task.completed_at is null
      and (
        v_actor_type = 'owner'
        or v_access_scope = 'all'
        or exists (
          select 1
          from public.merchant_enterprise_role_boards as role_board
          where role_board.merchant_id = v_site_id
            and role_board.role_id = v_role_id
            and role_board.board_id = task.board_id
        )
      )
      and (
        (v_actor_type = 'employee' and assignment.assigned_to_me)
        or (
          v_can_assign_tasks
          and (assignment.assignee_count = 0 or task.due_at < v_now)
        )
      )

    union all

    select
      'workflow_feedback'::text,
      execution.id,
      2,
      execution.feedback_submitted_at,
      execution.workflow_snapshot ->> 'title',
      employee.display_name || ' 提交了待处理反馈',
      'normal',
      '["feedback_open"]'::jsonb,
      null::timestamptz,
      execution.task_id,
      null::uuid,
      null::text,
      null::text,
      execution.version,
      execution.workflow_id,
      execution.id,
      execution.revision_no,
      execution.completed_steps,
      execution.total_steps,
      employee.display_name
    from public.merchant_enterprise_workflow_executions as execution
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = execution.merchant_id
     and employee.id = execution.employee_id
    where v_can_view_workflows
      and v_can_manage_workflows
      and execution.merchant_id = v_site_id
      and execution.feedback_status = 'open'

    union all

    select
      'workflow_acknowledgement'::text,
      workflow.id,
      3,
      revision.published_at,
      revision.snapshot ->> 'title',
      revision.snapshot ->> 'scenario',
      'normal',
      '["acknowledgement_required"]'::jsonb,
      null::timestamptz,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::bigint,
      workflow.id,
      null::uuid,
      revision.revision_no,
      null::integer,
      null::integer,
      null::text
    from public.merchant_enterprise_workflows as workflow
    join public.merchant_enterprise_workflow_revisions as revision
      on revision.merchant_id = workflow.merchant_id
     and revision.workflow_id = workflow.id
     and revision.id = workflow.current_revision_id
    where v_actor_type = 'employee'
      and v_can_view_workflows
      and workflow.merchant_id = v_site_id
      and workflow.status = 'published'
      and not exists (
        select 1
        from public.merchant_enterprise_workflow_acknowledgements as acknowledgement
        where acknowledgement.merchant_id = workflow.merchant_id
          and acknowledgement.workflow_id = workflow.id
          and acknowledgement.revision_id = workflow.current_revision_id
          and acknowledgement.employee_id = v_employee_id
      )

    union all

    select
      'workflow_execution'::text,
      execution.id,
      4,
      execution.updated_at,
      execution.workflow_snapshot ->> 'title',
      case when execution.subject <> '' then execution.subject
        else execution.completed_steps::text || '/' || execution.total_steps::text || ' 步已完成'
      end,
      'normal',
      '["execution_in_progress"]'::jsonb,
      null::timestamptz,
      execution.task_id,
      null::uuid,
      null::text,
      null::text,
      execution.version,
      execution.workflow_id,
      execution.id,
      execution.revision_no,
      execution.completed_steps,
      execution.total_steps,
      null::text
    from public.merchant_enterprise_workflow_executions as execution
    where v_actor_type = 'employee'
      and v_can_view_workflows
      and execution.merchant_id = v_site_id
      and execution.employee_id = v_employee_id
      and execution.status = 'in_progress'
  ),
  category_candidates as materialized (
    select *
    from all_candidates
    where v_category = 'all'
       or (v_category = 'tasks' and kind = 'task')
       or (v_category = 'workflows' and kind <> 'task')
  ),
  filtered_candidates as materialized (
    select *
    from category_candidates
    where not v_has_cursor
       or (bucket, sort_at, kind, entity_id) >
          (v_cursor_bucket, v_cursor_sort_at, v_cursor_kind, v_cursor_id)
  ),
  page_plus as materialized (
    select *
    from filtered_candidates
    order by bucket, sort_at, kind, entity_id
    limit v_limit + 1
  ),
  page as materialized (
    select *
    from page_plus
    order by bucket, sort_at, kind, entity_id
    limit v_limit
  )
  select jsonb_build_object(
    'merchantId', v_site_id,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.kind || ':' || item.entity_id::text,
          'entityId', item.entity_id,
          'siteId', v_site_id,
          'kind', item.kind,
          'title', item.title,
          'subtitle', item.subtitle,
          'urgency', item.urgency,
          'reasons', item.reasons,
          'attentionAt', item.sort_at,
          'dueAt', item.due_at,
          'taskId', item.task_id,
          'boardId', item.board_id,
          'boardName', item.board_name,
          'priority', item.priority,
          'version', item.version,
          'workflowId', item.workflow_id,
          'executionId', item.execution_id,
          'revisionNo', item.revision_no,
          'completedSteps', item.completed_steps,
          'totalSteps', item.total_steps,
          'employeeName', item.employee_name
        ) order by item.bucket, item.sort_at, item.kind, item.entity_id
      )
      from page as item
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'openCount', (select count(*) from all_candidates),
      'taskCount', (select count(*) from all_candidates where kind = 'task'),
      'overdueCount', (select count(*) from all_candidates where urgency = 'overdue'),
      'dueSoonCount', (select count(*) from all_candidates where urgency = 'due_soon'),
      'acknowledgementCount', (
        select count(*) from all_candidates where kind = 'workflow_acknowledgement'
      ),
      'executionCount', (
        select count(*) from all_candidates where kind = 'workflow_execution'
      ),
      'feedbackCount', (
        select count(*) from all_candidates where kind = 'workflow_feedback'
      )
    ),
    'nextCursor', case
      when (select count(*) from page_plus) <= v_limit then null
      else (
        select jsonb_build_object(
          'category', v_category,
          'bucket', item.bucket,
          'sortAt', item.sort_at,
          'kind', item.kind,
          'entityId', item.entity_id
        )
        from page as item
        order by item.bucket desc, item.sort_at desc, item.kind desc, item.entity_id desc
        limit 1
      )
    end
  ) into v_response;

  return v_response;
end;
$$;

revoke all on function public.faolla_list_merchant_enterprise_todos_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.faolla_list_merchant_enterprise_todos_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608040025, 'merchant_enterprise_todos')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
