-- Add a bounded, current-state operations projection for the enterprise
-- overview and employee account detail. This is deliberately not a
-- performance or historical attribution API: tasks remain multi-assignee,
-- mutable current-state records and every aggregate is evaluated as of the
-- database statement timestamp.

begin;

do $$
begin
  if to_regclass('public.merchants') is null
     or to_regclass('public.merchant_enterprise_roles') is null
     or to_regclass('public.merchant_enterprise_role_boards') is null
     or to_regclass('public.merchant_enterprise_employees') is null
     or to_regclass('public.merchant_task_boards') is null
     or to_regclass('public.merchant_task_columns') is null
     or to_regclass('public.merchant_tasks') is null
     or to_regclass('public.merchant_task_assignees') is null
     or to_regclass('public.faolla_schema_migrations') is null
     or to_regprocedure(
       'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'
     ) is null then
    raise exception 'merchant_enterprise_current_operations_prerequisite_missing';
  end if;
  if exists (
    select 1
      from (values
        ('merchants', 'id'),
        ('merchants', 'user_id'),
        ('merchants', 'auth_user_id'),
        ('merchants', 'owner_user_id'),
        ('merchants', 'owner_id'),
        ('merchants', 'auth_id'),
        ('merchants', 'created_by'),
        ('merchants', 'created_by_user_id'),
        ('merchant_enterprise_roles', 'id'),
        ('merchant_enterprise_roles', 'merchant_id'),
        ('merchant_enterprise_roles', 'permissions'),
        ('merchant_enterprise_roles', 'access_scope'),
        ('merchant_enterprise_roles', 'status'),
        ('merchant_enterprise_role_boards', 'merchant_id'),
        ('merchant_enterprise_role_boards', 'role_id'),
        ('merchant_enterprise_role_boards', 'board_id'),
        ('merchant_enterprise_employees', 'id'),
        ('merchant_enterprise_employees', 'merchant_id'),
        ('merchant_enterprise_employees', 'role_id'),
        ('merchant_enterprise_employees', 'status'),
        ('merchant_task_boards', 'id'),
        ('merchant_task_boards', 'merchant_id'),
        ('merchant_task_boards', 'name'),
        ('merchant_task_boards', 'position'),
        ('merchant_task_boards', 'status'),
        ('merchant_task_columns', 'id'),
        ('merchant_task_columns', 'merchant_id'),
        ('merchant_task_columns', 'board_id'),
        ('merchant_task_columns', 'name'),
        ('merchant_tasks', 'id'),
        ('merchant_tasks', 'merchant_id'),
        ('merchant_tasks', 'board_id'),
        ('merchant_tasks', 'column_id'),
        ('merchant_tasks', 'title'),
        ('merchant_tasks', 'priority'),
        ('merchant_tasks', 'due_at'),
        ('merchant_tasks', 'updated_at'),
        ('merchant_tasks', 'archived_at'),
        ('merchant_tasks', 'completed_at'),
        ('merchant_task_assignees', 'merchant_id'),
        ('merchant_task_assignees', 'task_id'),
        ('merchant_task_assignees', 'employee_id')
      ) as required_column(table_name, column_name)
     where not exists (
       select 1
         from pg_catalog.pg_class as table_relation
         join pg_catalog.pg_namespace as table_namespace
           on table_namespace.oid = table_relation.relnamespace
         join pg_catalog.pg_attribute as table_attribute
           on table_attribute.attrelid = table_relation.oid
          and table_attribute.attname = required_column.column_name
          and not table_attribute.attisdropped
        where table_namespace.nspname = 'public'
          and table_relation.relname = required_column.table_name
     )
  ) then
    raise exception 'merchant_enterprise_current_operations_prerequisite_missing';
  end if;
end;
$$;

commit;

-- A cancelled concurrent build can leave an invalid same-named index. The
-- migration runner keeps its session advisory lock across these transaction
-- boundaries, so an unregistered retry can safely replace the exact targets.
drop index concurrently if exists
  public.merchant_tasks_current_operations_idx;
create index concurrently
  merchant_tasks_current_operations_idx
  on public.merchant_tasks(
    merchant_id, board_id, due_at, updated_at desc, id
  )
  where archived_at is null and completed_at is null;

drop index concurrently if exists
  public.merchant_task_assignees_employee_task_idx;
create index concurrently
  merchant_task_assignees_employee_task_idx
  on public.merchant_task_assignees(merchant_id, employee_id, task_id);

begin;

-- Keep catalog-expression rendering stable even when a deployment session
-- inherits quote_all_identifiers=on from PGOPTIONS or an operator profile.
set local quote_all_identifiers = off;

create or replace function public.faolla_get_merchant_enterprise_current_operations_v1(
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
  v_requested_employee_id_text text := null;
  v_requested_employee_id uuid := null;
  v_effective_employee_id uuid := null;
  v_scope text;
  v_scope_restricted boolean := false;
  v_actor_employee public.merchant_enterprise_employees%rowtype;
  v_actor_role public.merchant_enterprise_roles%rowtype;
  v_merchant public.merchants%rowtype;
  v_as_of timestamptz := statement_timestamp();
  v_result jsonb;
begin
  if p_input is null or coalesce(jsonb_typeof(p_input), '') <> 'object' then
    raise exception 'invalid_current_operations_query';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_input) as input_key(key)
     where input_key.key not in (
       'merchant_id', 'actor_type', 'actor_id', 'employee_id'
     )
  ) then
    raise exception 'invalid_current_operations_query';
  end if;
  if coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_type'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_id'), '') <> 'string'
     or (p_input ? 'employee_id'
       and coalesce(jsonb_typeof(p_input -> 'employee_id'), '') <> 'string') then
    raise exception 'invalid_current_operations_query';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id <> p_input ->> 'merchant_id'
     or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type is null
     or v_actor_type <> p_input ->> 'actor_type'
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text <> p_input ->> 'actor_id'
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_current_operations_query';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  if p_input ? 'employee_id' then
    v_requested_employee_id_text := nullif(
      btrim(p_input ->> 'employee_id'), ''
    );
    if v_requested_employee_id_text is null
       or v_requested_employee_id_text <> p_input ->> 'employee_id'
       or v_requested_employee_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid_current_operations_query';
    end if;
    v_requested_employee_id := v_requested_employee_id_text::uuid;
  end if;

  select *
    into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'permission_denied';
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
    if v_requested_employee_id is null then
      v_scope := 'enterprise';
    else
      v_scope := 'employee';
      v_effective_employee_id := v_requested_employee_id;
    end if;
  else
    select *
      into v_actor_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id
       and status = 'active'
     for share;
    if not found or v_actor_employee.role_id is null then
      raise exception 'permission_denied';
    end if;

    select *
      into v_actor_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_actor_employee.role_id
       and status = 'active'
     for share;
    if not found
       or not public.faolla_valid_merchant_enterprise_permissions_v1(
         v_actor_role.permissions
       )
       or not ('enterprise.view' = any(v_actor_role.permissions))
       or not ('tasks.view' = any(v_actor_role.permissions)) then
      raise exception 'permission_denied';
    end if;

    v_scope := 'employee';
    v_effective_employee_id := coalesce(
      v_requested_employee_id,
      v_actor_employee.id
    );
    if v_effective_employee_id <> v_actor_employee.id
       and not ('employees.view' = any(v_actor_role.permissions)) then
      -- Check the permission before looking up the requested target so a
      -- low-privilege actor cannot enumerate employee UUIDs.
      raise exception 'permission_denied';
    end if;
    v_scope_restricted := v_actor_role.access_scope = 'restricted';
  end if;

  if v_effective_employee_id is not null
     and not exists (
       select 1
         from public.merchant_enterprise_employees as target_employee
        where target_employee.merchant_id = v_site_id
          and target_employee.id = v_effective_employee_id
     ) then
    raise exception 'employee_not_found';
  end if;

  -- One SQL statement builds every count and list from the same statement
  -- snapshot. Joining assignees into the task cardinality would multiply a
  -- shared task, so the employee scope and shared/unassigned flags use EXISTS
  -- or one lateral count while current_tasks remains exactly one row per task.
  with visible_boards as materialized (
    select
      board.id,
      board.name,
      board.position
    from public.merchant_task_boards as board
    where board.merchant_id = v_site_id
      and board.status = 'active'
      and (
        not v_scope_restricted
        or exists (
          select 1
            from public.merchant_enterprise_role_boards as role_board
           where role_board.merchant_id = v_site_id
             and role_board.role_id = v_actor_role.id
             and role_board.board_id = board.id
        )
      )
  ), current_tasks as materialized (
    select
      task.id,
      task.board_id,
      task.column_id,
      task.title,
      task.priority,
      task.due_at,
      task.updated_at,
      board.name as board_name,
      coalesce(assignee_totals.assignee_count, 0)::integer as assignee_count
    from public.merchant_tasks as task
    join visible_boards as board
      on board.id = task.board_id
    left join lateral (
      select count(*)::integer as assignee_count
        from public.merchant_task_assignees as assignee
       where assignee.merchant_id = task.merchant_id
         and assignee.task_id = task.id
    ) as assignee_totals on true
    where task.merchant_id = v_site_id
      and task.archived_at is null
      and task.completed_at is null
      and (
        v_effective_employee_id is null
        or exists (
          select 1
            from public.merchant_task_assignees as target_assignment
           where target_assignment.merchant_id = task.merchant_id
             and target_assignment.task_id = task.id
             and target_assignment.employee_id = v_effective_employee_id
        )
      )
  ), summary as (
    select
      count(*)::integer as open_task_count,
      count(*) filter (
        where due_at is not null and due_at < v_as_of
      )::integer as overdue_task_count,
      count(*) filter (
        where due_at is not null
          and due_at >= v_as_of
          and due_at < v_as_of + interval '168 hours'
      )::integer as due_soon_task_count,
      count(*) filter (where assignee_count = 0)::integer
        as unassigned_task_count,
      count(*) filter (where assignee_count > 1)::integer
        as shared_assignment_task_count,
      count(distinct board_id)::integer as involved_board_count
    from current_tasks
  ), board_counts as materialized (
    select
      board.id as board_id,
      board.name as board_name,
      board.position,
      count(task.id)::integer as open_task_count,
      count(task.id) filter (
        where task.due_at is not null and task.due_at < v_as_of
      )::integer as overdue_task_count,
      count(task.id) filter (
        where task.due_at is not null
          and task.due_at >= v_as_of
          and task.due_at < v_as_of + interval '168 hours'
      )::integer as due_soon_task_count
    from visible_boards as board
    left join current_tasks as task
      on task.board_id = board.id
    group by board.id, board.name, board.position
  ), selected_boards as (
    select *
      from board_counts
     order by
       overdue_task_count desc,
       open_task_count desc,
       board_name,
       board_id
     limit 100
  ), selected_priority_tasks as (
    select
      task.id,
      task.board_id,
      task.board_name,
      task.column_id,
      coalesce(column_row.name, '') as column_name,
      task.title,
      task.priority,
      task.due_at,
      task.updated_at,
      task.assignee_count
    from current_tasks as task
    left join public.merchant_task_columns as column_row
      on column_row.merchant_id = v_site_id
     and column_row.id = task.column_id
     and column_row.board_id = task.board_id
    order by
      (task.due_at is null),
      task.due_at asc nulls last,
      case task.priority
        when 'urgent' then 0
        when 'high' then 1
        when 'normal' then 2
        else 3
      end,
      task.updated_at desc,
      task.id
    limit 6
  )
  select jsonb_build_object(
    'asOf', to_char(
      v_as_of at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', v_scope,
    'employeeId', v_effective_employee_id,
    'scopeRestricted', v_scope_restricted,
    'boardSummaryTotalCount', (select count(*)::integer from board_counts),
    'boardsTruncated', (select count(*) > 100 from board_counts),
    'summary', (
      select jsonb_build_object(
        'openTaskCount', summary.open_task_count,
        'overdueTaskCount', summary.overdue_task_count,
        'dueSoonTaskCount', summary.due_soon_task_count,
        'unassignedTaskCount', case
          when v_scope = 'enterprise' then summary.unassigned_task_count
          else null
        end,
        'involvedBoardCount', summary.involved_board_count,
        'sharedAssignmentTaskCount', case
          when v_scope = 'employee' then summary.shared_assignment_task_count
          else null
        end
      )
      from summary
    ),
    'boards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'boardId', selected_board.board_id,
          'boardName', selected_board.board_name,
          'openTaskCount', selected_board.open_task_count,
          'overdueTaskCount', selected_board.overdue_task_count,
          'dueSoonTaskCount', selected_board.due_soon_task_count
        )
        order by
          selected_board.overdue_task_count desc,
          selected_board.open_task_count desc,
          selected_board.board_name,
          selected_board.board_id
      )
      from selected_boards as selected_board
    ), '[]'::jsonb),
    'priorityTasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', priority_task.id,
          'boardId', priority_task.board_id,
          'boardName', priority_task.board_name,
          'columnId', priority_task.column_id,
          'columnName', priority_task.column_name,
          'title', priority_task.title,
          'priority', priority_task.priority,
          'dueAt', case
            when priority_task.due_at is null then null
            else to_char(
              priority_task.due_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          end,
          'updatedAt', to_char(
            priority_task.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'assigneeCount', priority_task.assignee_count
        )
        order by
          (priority_task.due_at is null),
          priority_task.due_at asc nulls last,
          case priority_task.priority
            when 'urgent' then 0
            when 'high' then 1
            when 'normal' then 2
            else 3
          end,
          priority_task.updated_at desc,
          priority_task.id
      )
      from selected_priority_tasks as priority_task
    ), '[]'::jsonb)
  ) into v_result
  from summary;

  return v_result;
end;
$$;

revoke all on function public.faolla_get_merchant_enterprise_current_operations_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.faolla_get_merchant_enterprise_current_operations_v1(jsonb)
  to service_role;

-- Register only after both exact concurrent builds are live and usable.
do $$
declare
  v_current_tasks_index_valid boolean := false;
  v_employee_task_index_valid boolean := false;
begin
  select
    index_metadata.indisready
    and index_metadata.indisvalid
    and index_metadata.indislive
    and not index_metadata.indisunique
    and not index_metadata.indisprimary
    and not index_metadata.indisexclusion
    and index_metadata.indpred is not null
    and index_metadata.indexprs is null
    and index_metadata.indnatts = 5
    and index_metadata.indnkeyatts = 5
    and index_relation.relkind = 'i'
    and table_namespace.nspname = 'public'
    and table_relation.relname = 'merchant_tasks'
    and access_method.amname = 'btree'
    and index_metadata.indkey[0] = merchant_id_attribute.attnum
    and index_metadata.indkey[1] = board_id_attribute.attnum
    and index_metadata.indkey[2] = due_at_attribute.attnum
    and index_metadata.indkey[3] = updated_at_attribute.attnum
    and index_metadata.indkey[4] = id_attribute.attnum
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 1, 'desc'),
      false
    )
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 2, 'desc'),
      false
    )
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 3, 'desc'),
      false
    )
    and coalesce(
      pg_index_column_has_property(index_relation.oid, 4, 'desc'),
      false
    )
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 5, 'desc'),
      false
    )
    and pg_get_expr(
      index_metadata.indpred,
      index_metadata.indrelid,
      false
    ) =
      '((archived_at IS NULL) AND (completed_at IS NULL))'
    into v_current_tasks_index_valid
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
    join pg_catalog.pg_am as access_method
      on access_method.oid = index_relation.relam
    join pg_catalog.pg_attribute as merchant_id_attribute
      on merchant_id_attribute.attrelid = table_relation.oid
     and merchant_id_attribute.attname = 'merchant_id'
     and not merchant_id_attribute.attisdropped
    join pg_catalog.pg_attribute as board_id_attribute
      on board_id_attribute.attrelid = table_relation.oid
     and board_id_attribute.attname = 'board_id'
     and not board_id_attribute.attisdropped
    join pg_catalog.pg_attribute as due_at_attribute
      on due_at_attribute.attrelid = table_relation.oid
     and due_at_attribute.attname = 'due_at'
     and not due_at_attribute.attisdropped
    join pg_catalog.pg_attribute as updated_at_attribute
      on updated_at_attribute.attrelid = table_relation.oid
     and updated_at_attribute.attname = 'updated_at'
     and not updated_at_attribute.attisdropped
    join pg_catalog.pg_attribute as id_attribute
      on id_attribute.attrelid = table_relation.oid
     and id_attribute.attname = 'id'
     and not id_attribute.attisdropped
   where index_namespace.nspname = 'public'
     and index_relation.relname = 'merchant_tasks_current_operations_idx';

  select
    index_metadata.indisready
    and index_metadata.indisvalid
    and index_metadata.indislive
    and not index_metadata.indisunique
    and not index_metadata.indisprimary
    and not index_metadata.indisexclusion
    and index_metadata.indpred is null
    and index_metadata.indexprs is null
    and index_metadata.indnatts = 3
    and index_metadata.indnkeyatts = 3
    and index_relation.relkind = 'i'
    and table_namespace.nspname = 'public'
    and table_relation.relname = 'merchant_task_assignees'
    and access_method.amname = 'btree'
    and index_metadata.indkey[0] = merchant_id_attribute.attnum
    and index_metadata.indkey[1] = employee_id_attribute.attnum
    and index_metadata.indkey[2] = task_id_attribute.attnum
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 1, 'desc'),
      false
    )
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 2, 'desc'),
      false
    )
    and not coalesce(
      pg_index_column_has_property(index_relation.oid, 3, 'desc'),
      false
    )
    into v_employee_task_index_valid
    from pg_catalog.pg_class as index_relation
    join pg_catalog.pg_namespace as index_namespace
      on index_namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index as index_metadata
      on index_metadata.indexrelid = index_relation.oid
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
    join pg_catalog.pg_am as access_method
      on access_method.oid = index_relation.relam
    join pg_catalog.pg_attribute as merchant_id_attribute
      on merchant_id_attribute.attrelid = table_relation.oid
     and merchant_id_attribute.attname = 'merchant_id'
     and not merchant_id_attribute.attisdropped
    join pg_catalog.pg_attribute as employee_id_attribute
      on employee_id_attribute.attrelid = table_relation.oid
     and employee_id_attribute.attname = 'employee_id'
     and not employee_id_attribute.attisdropped
    join pg_catalog.pg_attribute as task_id_attribute
      on task_id_attribute.attrelid = table_relation.oid
     and task_id_attribute.attname = 'task_id'
     and not task_id_attribute.attisdropped
   where index_namespace.nspname = 'public'
     and index_relation.relname = 'merchant_task_assignees_employee_task_idx';

  if not coalesce(v_current_tasks_index_valid, false)
     or not coalesce(v_employee_task_index_valid, false) then
    raise exception 'merchant_enterprise_current_operations_index_invalid';
  end if;
end;
$$;

insert into public.faolla_schema_migrations (version, name)
values (202608190034, 'merchant_enterprise_current_operations')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
