\set ON_ERROR_STOP on
\pset pager off

-- The current-operations projection is current state, not historical
-- attribution. Keep every fixture inside one transaction so the later CAS
-- checks remain isolated from these synthetic boards, employees, and tasks.
begin;

select id::text as current_ops_employee_role
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and system_key = 'employee'
\gset

with next_position as (
  select coalesce(max(position), -1) + 1 as value
    from public.merchant_task_boards
   where merchant_id = '10000001'
     and status = 'active'
), fixture(id, name, status, position_offset) as (
  values
    ('93000000-0000-4000-8000-000000000001'::uuid,
      'Current operations visible', 'active', 0),
    ('93000000-0000-4000-8000-000000000002'::uuid,
      'Current operations hidden', 'active', 1),
    ('93000000-0000-4000-8000-000000000003'::uuid,
      'Current operations archived', 'active', 2)
)
insert into public.merchant_task_boards (
  id, merchant_id, name, status, position
)
select
  fixture.id,
  '10000001',
  fixture.name,
  fixture.status,
  next_position.value + fixture.position_offset
from fixture
cross join next_position;

insert into public.merchant_task_columns (
  id, merchant_id, board_id, name, position, is_done, status
)
values
  (
    '94000000-0000-4000-8000-000000000001'::uuid,
    '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    'Visible current work', 0, false, 'active'
  ),
  (
    '94000000-0000-4000-8000-000000000002'::uuid,
    '10000001',
    '93000000-0000-4000-8000-000000000002'::uuid,
    'Hidden current work', 0, false, 'active'
  ),
  (
    '94000000-0000-4000-8000-000000000003'::uuid,
    '10000001',
    '93000000-0000-4000-8000-000000000003'::uuid,
    'Archived current work', 0, false, 'active'
  );

insert into public.merchant_enterprise_roles (
  id, merchant_id, name, permissions, status, access_scope
)
values
  (
    '92000000-0000-4000-8000-000000000001'::uuid,
    '10000001',
    'Current operations restricted viewer',
    array[
      'enterprise.view', 'tasks.view', 'roles.view', 'employees.view'
    ]::text[],
    'active',
    'restricted'
  ),
  (
    '92000000-0000-4000-8000-000000000002'::uuid,
    '10000001',
    'Current operations self-only viewer',
    array['enterprise.view', 'tasks.view']::text[],
    'active',
    'all'
  );

insert into public.merchant_enterprise_role_boards (
  merchant_id, role_id, board_id
)
values (
  '10000001',
  '92000000-0000-4000-8000-000000000001'::uuid,
  '93000000-0000-4000-8000-000000000001'::uuid
);

insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id,
  status, invited_at, accepted_at, last_active_at
)
values
  (
    '96000000-0000-4000-8000-000000000001'::uuid,
    '10000001',
    '96100000-0000-4000-8000-000000000001'::uuid,
    'current-operations-target@example.test',
    'Current operations target',
    :'current_ops_employee_role'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000002'::uuid,
    '10000001',
    '96100000-0000-4000-8000-000000000002'::uuid,
    'current-operations-partner@example.test',
    'Current operations assignment partner',
    :'current_ops_employee_role'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000003'::uuid,
    '10000001',
    '96100000-0000-4000-8000-000000000003'::uuid,
    'current-operations-restricted@example.test',
    'Current operations restricted viewer',
    '92000000-0000-4000-8000-000000000001'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000004'::uuid,
    '10000001',
    '96100000-0000-4000-8000-000000000004'::uuid,
    'current-operations-self-only@example.test',
    'Current operations self-only viewer',
    '92000000-0000-4000-8000-000000000002'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  ),
  (
    '96000000-0000-4000-8000-000000000005'::uuid,
    '10000001',
    null,
    'current-operations-invited@example.test',
    'Current operations invited target',
    :'current_ops_employee_role'::uuid,
    'invited', statement_timestamp(), null, null
  ),
  (
    '96000000-0000-4000-8000-000000000006'::uuid,
    '10000001',
    null,
    'current-operations-disabled@example.test',
    'Current operations disabled target',
    :'current_ops_employee_role'::uuid,
    'disabled', statement_timestamp(), null, null
  );

insert into public.merchant_tasks (
  id, merchant_id, board_id, column_id, title, priority, due_at,
  completed_at, archived_at, position, updated_at
)
values
  ('95000000-0000-4000-8000-000000000001'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible overdue shared', 'low', statement_timestamp() - interval '7 hours',
    null, null, 1, statement_timestamp() - interval '7 minutes'),
  ('95000000-0000-4000-8000-000000000002'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible overdue', 'high', statement_timestamp() - interval '6 hours',
    null, null, 2, statement_timestamp() - interval '6 minutes'),
  ('95000000-0000-4000-8000-000000000003'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible due soon one', 'normal', statement_timestamp() + interval '1 hour',
    null, null, 3, statement_timestamp() - interval '5 minutes'),
  ('95000000-0000-4000-8000-000000000004'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible due soon two', 'urgent', statement_timestamp() + interval '2 hours',
    null, null, 4, statement_timestamp() - interval '4 minutes'),
  ('95000000-0000-4000-8000-000000000005'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible due soon three', 'normal', statement_timestamp() + interval '3 hours',
    null, null, 5, statement_timestamp() - interval '3 minutes'),
  ('95000000-0000-4000-8000-000000000006'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible later', 'normal', statement_timestamp() + interval '200 hours',
    null, null, 6, statement_timestamp() - interval '2 minutes'),
  ('95000000-0000-4000-8000-000000000007'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible no due date', 'normal', null,
    null, null, 7, statement_timestamp() - interval '1 minute'),
  ('95000000-0000-4000-8000-000000000008'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000002'::uuid,
    '94000000-0000-4000-8000-000000000002'::uuid,
    'Hidden overdue', 'urgent', statement_timestamp() - interval '5 hours',
    null, null, 1, statement_timestamp()),
  ('95000000-0000-4000-8000-000000000009'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Enterprise unassigned', 'normal', statement_timestamp() + interval '4 hours',
    null, null, 8, statement_timestamp()),
  ('95000000-0000-4000-8000-000000000010'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Completed excluded', 'urgent', statement_timestamp() - interval '4 hours',
    statement_timestamp(), null, 9, statement_timestamp()),
  ('95000000-0000-4000-8000-000000000011'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Archived excluded', 'urgent', statement_timestamp() - interval '3 hours',
    null, statement_timestamp(), 10, statement_timestamp()),
  ('95000000-0000-4000-8000-000000000012'::uuid, '10000001',
    '93000000-0000-4000-8000-000000000003'::uuid,
    '94000000-0000-4000-8000-000000000003'::uuid,
    'Archived board excluded', 'urgent', statement_timestamp() - interval '2 hours',
    null, null, 1, statement_timestamp());

insert into public.merchant_task_assignees (
  merchant_id, task_id, employee_id
)
select
  '10000001',
  fixture.task_id,
  '96000000-0000-4000-8000-000000000001'::uuid
from (values
  ('95000000-0000-4000-8000-000000000001'::uuid),
  ('95000000-0000-4000-8000-000000000002'::uuid),
  ('95000000-0000-4000-8000-000000000003'::uuid),
  ('95000000-0000-4000-8000-000000000004'::uuid),
  ('95000000-0000-4000-8000-000000000005'::uuid),
  ('95000000-0000-4000-8000-000000000006'::uuid),
  ('95000000-0000-4000-8000-000000000007'::uuid),
  ('95000000-0000-4000-8000-000000000008'::uuid),
  ('95000000-0000-4000-8000-000000000010'::uuid),
  ('95000000-0000-4000-8000-000000000011'::uuid),
  ('95000000-0000-4000-8000-000000000012'::uuid)
) as fixture(task_id);

insert into public.merchant_task_assignees (
  merchant_id, task_id, employee_id
)
values (
  '10000001',
  '95000000-0000-4000-8000-000000000001'::uuid,
  '96000000-0000-4000-8000-000000000002'::uuid
);

-- Create and assign the archived-board fixture while its structure is active;
-- the table guard intentionally rejects new live tasks on archived boards.
update public.merchant_task_boards
   set status = 'archived'
 where merchant_id = '10000001'
   and id = '93000000-0000-4000-8000-000000000003'::uuid;

-- Owner enterprise scope: compare the projection with an independent
-- one-row-per-task aggregate so shared assignments cannot inflate totals.
do $test$
declare
  v_payload jsonb;
  v_as_of timestamptz := statement_timestamp();
  v_open integer;
  v_overdue integer;
  v_due_soon integer;
  v_unassigned integer;
  v_involved integer;
  v_board_total integer;
begin
  select
    count(*)::integer,
    count(*) filter (
      where task.due_at is not null and task.due_at < v_as_of
    )::integer,
    count(*) filter (
      where task.due_at is not null
        and task.due_at >= v_as_of
        and task.due_at < v_as_of + interval '168 hours'
    )::integer,
    count(*) filter (
      where not exists (
        select 1
          from public.merchant_task_assignees as assignment
         where assignment.merchant_id = task.merchant_id
           and assignment.task_id = task.id
      )
    )::integer,
    count(distinct task.board_id)::integer
    into v_open, v_overdue, v_due_soon, v_unassigned, v_involved
    from public.merchant_tasks as task
    join public.merchant_task_boards as board
      on board.merchant_id = task.merchant_id
     and board.id = task.board_id
   where task.merchant_id = '10000001'
     and board.status = 'active'
     and task.archived_at is null
     and task.completed_at is null;

  select count(*)::integer
    into v_board_total
    from public.merchant_task_boards
   where merchant_id = '10000001'
     and status = 'active';

  v_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  );

  perform enterprise_integration.assert_true(
    v_payload ->> 'scope' = 'enterprise'
      and v_payload -> 'employeeId' = 'null'::jsonb
      and (v_payload ->> 'scopeRestricted')::boolean = false,
    'owner current operations did not return enterprise scope'
  );
  perform enterprise_integration.assert_true(
    (v_payload #>> '{summary,openTaskCount}')::integer = v_open
      and (v_payload #>> '{summary,overdueTaskCount}')::integer = v_overdue
      and (v_payload #>> '{summary,dueSoonTaskCount}')::integer = v_due_soon
      and (v_payload #>> '{summary,unassignedTaskCount}')::integer = v_unassigned
      and (v_payload #>> '{summary,involvedBoardCount}')::integer = v_involved
      and v_payload #> '{summary,sharedAssignmentTaskCount}' = 'null'::jsonb,
    'enterprise current-state summary changed task cardinality or null contract'
  );
  perform enterprise_integration.assert_true(
    (v_payload ->> 'boardSummaryTotalCount')::integer = v_board_total
      and (v_payload ->> 'boardsTruncated')::boolean = (v_board_total > 100)
      and jsonb_array_length(v_payload -> 'boards') = least(v_board_total, 100)
      and jsonb_array_length(v_payload -> 'priorityTasks') = least(v_open, 6),
    'enterprise current operations bounds or truncation metadata are wrong'
  );
end;
$test$;

-- `statement_timestamp()` is stable for the outer DO statement and every
-- nested RPC call. This makes both ends of the documented half-open window
-- exact: due_at = asOf is included, while due_at = asOf + 168h is excluded.
do $test$
declare
  v_as_of timestamptz := statement_timestamp();
  v_before jsonb;
  v_after_lower_bound jsonb;
  v_payload jsonb;
begin
  v_before := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  );

  insert into public.merchant_tasks (
    id, merchant_id, board_id, column_id, title, priority, due_at,
    completed_at, archived_at, position, updated_at
  )
  values (
    '95000000-0000-4000-8000-000000000013'::uuid,
    '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible exactly at as-of',
    'normal',
    v_as_of,
    null,
    null,
    11,
    v_as_of
  );

  v_after_lower_bound := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  );

  perform enterprise_integration.assert_true(
    (v_after_lower_bound #>> '{summary,openTaskCount}')::integer
        = (v_before #>> '{summary,openTaskCount}')::integer + 1
      and (v_after_lower_bound #>> '{summary,overdueTaskCount}')::integer
        = (v_before #>> '{summary,overdueTaskCount}')::integer
      and (v_after_lower_bound #>> '{summary,dueSoonTaskCount}')::integer
        = (v_before #>> '{summary,dueSoonTaskCount}')::integer + 1,
    'current operations excluded the inclusive asOf boundary'
  );

  insert into public.merchant_tasks (
    id, merchant_id, board_id, column_id, title, priority, due_at,
    completed_at, archived_at, position, updated_at
  )
  values (
    '95000000-0000-4000-8000-000000000014'::uuid,
    '10000001',
    '93000000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'Visible exactly at 168 hours',
    'normal',
    v_as_of + interval '168 hours',
    null,
    null,
    12,
    v_as_of
  );

  v_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  );

  perform enterprise_integration.assert_true(
    (v_payload #>> '{summary,openTaskCount}')::integer
        = (v_after_lower_bound #>> '{summary,openTaskCount}')::integer + 1
      and (v_payload #>> '{summary,overdueTaskCount}')::integer
        = (v_after_lower_bound #>> '{summary,overdueTaskCount}')::integer
      and (v_payload #>> '{summary,dueSoonTaskCount}')::integer
        = (v_after_lower_bound #>> '{summary,dueSoonTaskCount}')::integer,
    'current operations included the exclusive asOf + 168h boundary'
  );
end;
$test$;

set role service_role;

-- Owner-selected employee scope and employee self scope both count each task
-- once even when it has multiple assignees. Completed, archived, and
-- archived-board tasks are excluded.
do $test$
declare
  v_payload jsonb;
  v_self_payload jsonb;
  v_invited_payload jsonb;
  v_disabled_payload jsonb;
  v_visible_board jsonb;
  v_hidden_board jsonb;
begin
  v_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001",
      "employee_id":"96000000-0000-4000-8000-000000000001"
    }'::jsonb
  );
  perform enterprise_integration.assert_true(
    v_payload ->> 'scope' = 'employee'
      and v_payload ->> 'employeeId' =
        '96000000-0000-4000-8000-000000000001'
      and (v_payload #>> '{summary,openTaskCount}')::integer = 8
      and (v_payload #>> '{summary,overdueTaskCount}')::integer = 3
      and (v_payload #>> '{summary,dueSoonTaskCount}')::integer = 3
      and v_payload #> '{summary,unassignedTaskCount}' = 'null'::jsonb
      and (v_payload #>> '{summary,involvedBoardCount}')::integer = 2
      and (v_payload #>> '{summary,sharedAssignmentTaskCount}')::integer = 1,
    'owner employee scope did not preserve unique multi-assignee task counts'
  );
  perform enterprise_integration.assert_true(
    jsonb_array_length(v_payload -> 'priorityTasks') = 6
      and v_payload #>> '{priorityTasks,0,id}' =
        '95000000-0000-4000-8000-000000000001'
      and v_payload #>> '{priorityTasks,2,id}' =
        '95000000-0000-4000-8000-000000000008'
      and v_payload #>> '{priorityTasks,5,id}' =
        '95000000-0000-4000-8000-000000000005',
    'employee priority tasks are not bounded and due-date deterministic'
  );

  select board
    into v_visible_board
    from jsonb_array_elements(v_payload -> 'boards') as item(board)
   where board ->> 'boardId' = '93000000-0000-4000-8000-000000000001';
  select board
    into v_hidden_board
    from jsonb_array_elements(v_payload -> 'boards') as item(board)
   where board ->> 'boardId' = '93000000-0000-4000-8000-000000000002';
  perform enterprise_integration.assert_true(
    (v_visible_board ->> 'openTaskCount')::integer = 7
      and (v_hidden_board ->> 'openTaskCount')::integer = 1,
    'employee board summary did not retain empty-visible-board semantics'
  );

  v_self_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"employee",
      "actor_id":"96000000-0000-4000-8000-000000000001"
    }'::jsonb
  );
  perform enterprise_integration.assert_true(
    v_self_payload ->> 'employeeId' =
        '96000000-0000-4000-8000-000000000001'
      and (v_self_payload #>> '{summary,openTaskCount}')::integer = 8
      and (v_self_payload ->> 'scopeRestricted')::boolean = false,
    'employee no-target request did not default to self'
  );

  v_invited_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001",
      "employee_id":"96000000-0000-4000-8000-000000000005"
    }'::jsonb
  );
  v_disabled_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001",
      "employee_id":"96000000-0000-4000-8000-000000000006"
    }'::jsonb
  );
  perform enterprise_integration.assert_true(
    (v_invited_payload #>> '{summary,openTaskCount}')::integer = 0
      and (v_disabled_payload #>> '{summary,openTaskCount}')::integer = 0,
    'invited or disabled employee target was rejected or misrepresented'
  );
end;
$test$;

-- A restricted caller may inspect another employee only with employees.view,
-- and the result remains scoped to the caller's one allowed board.
do $test$
declare
  v_payload jsonb;
begin
  v_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"employee",
      "actor_id":"96000000-0000-4000-8000-000000000003",
      "employee_id":"96000000-0000-4000-8000-000000000001"
    }'::jsonb
  );
  perform enterprise_integration.assert_true(
    (v_payload ->> 'scopeRestricted')::boolean
      and (v_payload ->> 'boardSummaryTotalCount')::integer = 1
      and (v_payload ->> 'boardsTruncated')::boolean = false
      and jsonb_array_length(v_payload -> 'boards') = 1
      and v_payload #>> '{boards,0,boardId}' =
        '93000000-0000-4000-8000-000000000001'
      and (v_payload #>> '{summary,openTaskCount}')::integer = 7
      and (v_payload #>> '{summary,overdueTaskCount}')::integer = 2
      and (v_payload #>> '{summary,dueSoonTaskCount}')::integer = 3
      and (v_payload #>> '{summary,involvedBoardCount}')::integer = 1
      and (v_payload #>> '{summary,sharedAssignmentTaskCount}')::integer = 1,
    'restricted current operations leaked a disallowed board or task'
  );
  perform enterprise_integration.assert_true(
    jsonb_array_length(v_payload -> 'priorityTasks') = 6
      and v_payload #>> '{priorityTasks,0,id}' =
        '95000000-0000-4000-8000-000000000001'
      and v_payload #>> '{priorityTasks,5,id}' =
        '95000000-0000-4000-8000-000000000006',
    'restricted priority list is not deterministic and bounded'
  );
end;
$test$;

-- Self remains available without employees.view, but any other target is
-- denied before target existence can be used for employee enumeration.
do $test$
declare
  v_payload jsonb;
begin
  v_payload := public.faolla_get_merchant_enterprise_current_operations_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"employee",
      "actor_id":"96000000-0000-4000-8000-000000000004"
    }'::jsonb
  );
  perform enterprise_integration.assert_true(
    v_payload ->> 'employeeId' =
        '96000000-0000-4000-8000-000000000004'
      and (v_payload #>> '{summary,openTaskCount}')::integer = 0,
    'self-only current operations actor could not inspect self'
  );
end;
$test$;

select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"96000000-0000-4000-8000-000000000004",
        "employee_id":"96000000-0000-4000-8000-000000000001"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"96000000-0000-4000-8000-000000000004",
        "employee_id":"96999999-0000-4000-8000-000000000099"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"owner",
        "actor_id":"10000000-0000-4000-8000-000000000001",
        "employee_id":"50000000-0000-4000-8000-000000000005"
      }'::jsonb
    )
  $sql$,
  'employee_not_found'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"owner",
        "actor_id":"20000000-0000-4000-8000-000000000002"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"50000000-0000-4000-8000-000000000005"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);

reset role;

-- Authorization is evaluated from the current employee and role rows on
-- every call. A previously valid actor must stop reading immediately after
-- either half of that relationship becomes inactive.
update public.merchant_enterprise_roles
   set status = 'archived'
 where merchant_id = '10000001'
   and id = '92000000-0000-4000-8000-000000000002'::uuid;
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"96000000-0000-4000-8000-000000000004"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
reset role;
update public.merchant_enterprise_roles
   set status = 'active'
 where merchant_id = '10000001'
   and id = '92000000-0000-4000-8000-000000000002'::uuid;

update public.merchant_enterprise_employees
   set status = 'disabled'
 where merchant_id = '10000001'
   and id = '96000000-0000-4000-8000-000000000004'::uuid;
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"96000000-0000-4000-8000-000000000004"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
reset role;
update public.merchant_enterprise_employees
   set status = 'active'
 where merchant_id = '10000001'
   and id = '96000000-0000-4000-8000-000000000004'::uuid;

-- The database function is an internal service bridge, not a browser RPC.
set role authenticated;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_current_operations_v1(
      '{}'::jsonb
    )
  $sql$,
  'permission denied for function'
);
reset role;

do $test$
begin
  perform enterprise_integration.assert_true(
    has_function_privilege(
      'service_role',
      'public.faolla_get_merchant_enterprise_current_operations_v1(jsonb)',
      'EXECUTE'
    )
      and not has_function_privilege(
        'authenticated',
        'public.faolla_get_merchant_enterprise_current_operations_v1(jsonb)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'public.faolla_get_merchant_enterprise_current_operations_v1(jsonb)',
        'EXECUTE'
      ),
    'current operations RPC grant surface is not service-role only'
  );
  perform enterprise_integration.assert_true(
    (select count(*) = 1
       from public.faolla_schema_migrations
      where version = 202608190034
        and name = 'merchant_enterprise_current_operations'),
    'current operations migration registry entry is missing or duplicated'
  );
  perform enterprise_integration.assert_true(
    (select index_metadata.indisready
            and index_metadata.indisvalid
            and index_metadata.indislive
       from pg_catalog.pg_index as index_metadata
      where index_metadata.indexrelid =
        'public.merchant_tasks_current_operations_idx'::regclass)
      and
    (select index_metadata.indisready
            and index_metadata.indisvalid
            and index_metadata.indislive
       from pg_catalog.pg_index as index_metadata
      where index_metadata.indexrelid =
        'public.merchant_task_assignees_employee_task_idx'::regclass),
    'current operations replacement indexes are not live and valid'
  );
end;
$test$;

rollback;
