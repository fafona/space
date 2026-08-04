\set ON_ERROR_STOP on
\pset pager off

-- Unified todo acceptance runs in an isolated, rolled-back merchant so exact
-- counts and keyset order do not depend on fixtures created earlier in suite.
begin;

insert into public.merchants (
  id,
  name,
  email,
  owner_user_id
)
values (
  '10000003',
  'Integration Todo Merchant',
  'todo-owner@example.test',
  '83000000-0000-4000-8000-000000000001'::uuid
);

set role service_role;
select public.faolla_bootstrap_merchant_enterprise_v2(
  '{
    "merchant_id":"10000003",
    "actor_type":"owner",
    "actor_id":"83000000-0000-4000-8000-000000000001",
    "operation_id":"integration-todo-bootstrap"
  }'::jsonb
);
reset role;

-- The employee can see tasks and workflows, but only on the explicitly mapped
-- board and without manager-level task or workflow permissions.
insert into public.merchant_enterprise_roles (
  id,
  merchant_id,
  name,
  description,
  permissions,
  access_scope,
  status,
  is_system
)
values (
  '83100000-0000-4000-8000-000000000001'::uuid,
  '10000003',
  'Restricted todo employee',
  'Unified todo board-scope fixture',
  array['enterprise.view', 'tasks.view', 'workflows.view']::text[],
  'restricted',
  'active',
  false
);

insert into public.merchant_enterprise_employees (
  id,
  merchant_id,
  auth_user_id,
  email,
  display_name,
  role_id,
  status,
  invited_at,
  accepted_at,
  last_active_at
)
values (
  '83200000-0000-4000-8000-000000000001'::uuid,
  '10000003',
  '83200000-0000-4000-8000-000000000101'::uuid,
  'todo-worker@example.test',
  'Todo Worker',
  '83100000-0000-4000-8000-000000000001'::uuid,
  'active',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp()
);

insert into public.merchant_task_boards (
  id,
  merchant_id,
  name,
  description,
  position,
  status
)
values
  (
    '83300000-0000-4000-8000-000000000001'::uuid,
    '10000003',
    'Todo visible board',
    'Mapped to the restricted employee role',
    1,
    'active'
  ),
  (
    '83300000-0000-4000-8000-000000000002'::uuid,
    '10000003',
    'Todo hidden board',
    'Must remain invisible to the restricted employee',
    2,
    'active'
  );

insert into public.merchant_task_columns (
  id,
  merchant_id,
  board_id,
  name,
  color,
  position,
  is_done,
  status
)
values
  (
    '83400000-0000-4000-8000-000000000001'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000001'::uuid,
    'Todo',
    '#64748b',
    0,
    false,
    'active'
  ),
  (
    '83400000-0000-4000-8000-000000000002'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000002'::uuid,
    'Todo',
    '#64748b',
    0,
    false,
    'active'
  );

insert into public.merchant_enterprise_role_boards (
  merchant_id,
  role_id,
  board_id
)
values (
  '10000003',
  '83100000-0000-4000-8000-000000000001'::uuid,
  '83300000-0000-4000-8000-000000000001'::uuid
);

-- Two visible assigned tasks form the employee's two deterministic keyset
-- pages. The hidden overdue task and explicit unassigned task are owner-only
-- team exceptions, and the completed task must never become a todo.
insert into public.merchant_tasks (
  id,
  merchant_id,
  board_id,
  column_id,
  title,
  description,
  priority,
  due_at,
  completed_at,
  position,
  updated_at
)
values
  (
    '83500000-0000-4000-8000-000000000001'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000001'::uuid,
    '83400000-0000-4000-8000-000000000001'::uuid,
    'Visible overdue task',
    '',
    'urgent',
    statement_timestamp() - interval '2 days',
    null,
    10,
    statement_timestamp() - interval '2 hours'
  ),
  (
    '83500000-0000-4000-8000-000000000002'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000001'::uuid,
    '83400000-0000-4000-8000-000000000001'::uuid,
    'Visible due-soon task',
    '',
    'high',
    statement_timestamp() + interval '1 hour',
    null,
    20,
    statement_timestamp() - interval '1 hour'
  ),
  (
    '83500000-0000-4000-8000-000000000003'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000002'::uuid,
    '83400000-0000-4000-8000-000000000002'::uuid,
    'Hidden overdue task',
    '',
    'high',
    statement_timestamp() - interval '1 day',
    null,
    10,
    statement_timestamp() - interval '90 minutes'
  ),
  (
    '83500000-0000-4000-8000-000000000004'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000001'::uuid,
    '83400000-0000-4000-8000-000000000001'::uuid,
    'Completed assigned task',
    '',
    'normal',
    statement_timestamp() - interval '3 days',
    statement_timestamp() - interval '1 day',
    30,
    statement_timestamp() - interval '1 day'
  ),
  (
    '83500000-0000-4000-8000-000000000005'::uuid,
    '10000003',
    '83300000-0000-4000-8000-000000000001'::uuid,
    '83400000-0000-4000-8000-000000000001'::uuid,
    'Unassigned team exception',
    '',
    'normal',
    null,
    null,
    40,
    statement_timestamp() - interval '30 minutes'
  );

insert into public.merchant_task_assignees (
  merchant_id,
  task_id,
  employee_id
)
values
  (
    '10000003',
    '83500000-0000-4000-8000-000000000001'::uuid,
    '83200000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '10000003',
    '83500000-0000-4000-8000-000000000002'::uuid,
    '83200000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '10000003',
    '83500000-0000-4000-8000-000000000004'::uuid,
    '83200000-0000-4000-8000-000000000001'::uuid
  );

-- Publish two immutable revisions but acknowledge only revision one. The todo
-- must still request acknowledgement of the current revision two.
insert into public.merchant_enterprise_workflows (
  id,
  merchant_id,
  title,
  scenario,
  description,
  category,
  tags,
  status,
  position
)
values (
  '83600000-0000-4000-8000-000000000001'::uuid,
  '10000003',
  'Todo acceptance workflow',
  'When an integration todo needs handling',
  'Current acknowledgement and execution fixture',
  'integration',
  array['todo']::text[],
  'draft',
  0
);

insert into public.merchant_enterprise_workflow_revisions (
  id,
  merchant_id,
  workflow_id,
  revision_no,
  snapshot,
  published_at
)
values
  (
    '83700000-0000-4000-8000-000000000001'::uuid,
    '10000003',
    '83600000-0000-4000-8000-000000000001'::uuid,
    1,
    jsonb_build_object(
      'title', 'Todo acceptance workflow v1',
      'scenario', 'Old acknowledgement scenario',
      'description', '',
      'category', 'integration',
      'tags', jsonb_build_array('todo'),
      'position', 0,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'id', '83700000-0000-4000-8000-000000000101',
          'title', 'Read the old process',
          'instruction', 'Review revision one.',
          'position', 0
        )
      )
    ),
    statement_timestamp() - interval '2 days'
  ),
  (
    '83700000-0000-4000-8000-000000000002'::uuid,
    '10000003',
    '83600000-0000-4000-8000-000000000001'::uuid,
    2,
    jsonb_build_object(
      'title', 'Todo acceptance workflow v2',
      'scenario', 'Current acknowledgement scenario',
      'description', '',
      'category', 'integration',
      'tags', jsonb_build_array('todo'),
      'position', 0,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'id', '83700000-0000-4000-8000-000000000201',
          'title', 'Read the current process',
          'instruction', 'Review revision two.',
          'position', 0
        ),
        jsonb_build_object(
          'id', '83700000-0000-4000-8000-000000000202',
          'title', 'Apply the current process',
          'instruction', 'Complete the second step.',
          'position', 1
        )
      )
    ),
    statement_timestamp() - interval '1 day'
  );

update public.merchant_enterprise_workflows
   set status = 'published',
       current_revision_id = '83700000-0000-4000-8000-000000000002'::uuid,
       published_version = 2,
       has_unpublished_changes = false
 where merchant_id = '10000003'
   and id = '83600000-0000-4000-8000-000000000001'::uuid;

insert into public.merchant_enterprise_workflow_acknowledgements (
  id,
  merchant_id,
  workflow_id,
  revision_id,
  revision_no,
  employee_id,
  acknowledged_at
)
values (
  '83800000-0000-4000-8000-000000000001'::uuid,
  '10000003',
  '83600000-0000-4000-8000-000000000001'::uuid,
  '83700000-0000-4000-8000-000000000001'::uuid,
  1,
  '83200000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '36 hours'
);

insert into public.merchant_enterprise_workflow_executions (
  id,
  merchant_id,
  workflow_id,
  revision_id,
  revision_no,
  employee_id,
  subject,
  status,
  workflow_snapshot,
  completed_steps,
  total_steps,
  feedback_rating,
  feedback_text,
  feedback_status,
  feedback_submitted_at,
  started_at,
  completed_at,
  updated_at
)
values
  (
    '83900000-0000-4000-8000-000000000001'::uuid,
    '10000003',
    '83600000-0000-4000-8000-000000000001'::uuid,
    '83700000-0000-4000-8000-000000000002'::uuid,
    2,
    '83200000-0000-4000-8000-000000000001'::uuid,
    '',
    'in_progress',
    jsonb_build_object(
      'title', 'Todo acceptance workflow v2',
      'scenario', 'Current acknowledgement scenario',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Read', 'position', 0),
        jsonb_build_object('title', 'Apply', 'position', 1)
      )
    ),
    1,
    2,
    null,
    '',
    'none',
    null,
    statement_timestamp() - interval '4 hours',
    null,
    statement_timestamp() - interval '2 hours'
  ),
  (
    '83900000-0000-4000-8000-000000000002'::uuid,
    '10000003',
    '83600000-0000-4000-8000-000000000001'::uuid,
    '83700000-0000-4000-8000-000000000002'::uuid,
    2,
    '83200000-0000-4000-8000-000000000001'::uuid,
    'Completed employee execution',
    'completed',
    jsonb_build_object(
      'title', 'Todo acceptance workflow v2',
      'scenario', 'Current acknowledgement scenario',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Read', 'position', 0),
        jsonb_build_object('title', 'Apply', 'position', 1)
      )
    ),
    2,
    2,
    3,
    'Manager follow-up is required.',
    'open',
    statement_timestamp() - interval '3 hours',
    statement_timestamp() - interval '8 hours',
    statement_timestamp() - interval '4 hours',
    statement_timestamp() - interval '3 hours'
  );

set role service_role;

select enterprise_integration.assert_true(
  has_function_privilege(
    'service_role',
    'public.faolla_list_merchant_enterprise_todos_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_list_merchant_enterprise_todos_v1(jsonb)',
    'EXECUTE'
  ),
  'todo RPC privilege boundary is incorrect'
);

select enterprise_integration.assert_true(
  exists (
    select 1
      from public.merchant_enterprise_employees
     where merchant_id = '10000002'
       and id = '50000000-0000-4000-8000-000000000005'::uuid
  ),
  'cross-tenant todo actor fixture is missing'
);

select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_todos_v1(
      '{
        "merchant_id":"10000003",
        "actor_type":"employee",
        "actor_id":"50000000-0000-4000-8000-000000000005",
        "category":"all",
        "limit":50,
        "cursor_bucket":null,
        "cursor_sort_at":null,
        "cursor_kind":null,
        "cursor_id":null
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);

create temporary table enterprise_todo_fixture_pages (
  name text primary key,
  payload jsonb not null
) on commit drop;

insert into enterprise_todo_fixture_pages (name, payload)
values
  (
    'owner_all',
    public.faolla_list_merchant_enterprise_todos_v1(
      '{
        "merchant_id":"10000003",
        "actor_type":"owner",
        "actor_id":"83000000-0000-4000-8000-000000000001",
        "category":"all",
        "limit":50,
        "cursor_bucket":null,
        "cursor_sort_at":null,
        "cursor_kind":null,
        "cursor_id":null
      }'::jsonb
    )
  ),
  (
    'employee_all',
    public.faolla_list_merchant_enterprise_todos_v1(
      '{
        "merchant_id":"10000003",
        "actor_type":"employee",
        "actor_id":"83200000-0000-4000-8000-000000000001",
        "category":"all",
        "limit":50,
        "cursor_bucket":null,
        "cursor_sort_at":null,
        "cursor_kind":null,
        "cursor_id":null
      }'::jsonb
    )
  ),
  (
    'employee_tasks_page_1',
    public.faolla_list_merchant_enterprise_todos_v1(
      '{
        "merchant_id":"10000003",
        "actor_type":"employee",
        "actor_id":"83200000-0000-4000-8000-000000000001",
        "category":"tasks",
        "limit":1,
        "cursor_bucket":null,
        "cursor_sort_at":null,
        "cursor_kind":null,
        "cursor_id":null
      }'::jsonb
    )
  );

insert into enterprise_todo_fixture_pages (name, payload)
select
  'employee_tasks_page_2',
  public.faolla_list_merchant_enterprise_todos_v1(
    jsonb_build_object(
      'merchant_id', '10000003',
      'actor_type', 'employee',
      'actor_id', '83200000-0000-4000-8000-000000000001',
      'category', 'tasks',
      'limit', 1,
      'cursor_bucket', (payload #>> '{nextCursor,bucket}')::integer,
      'cursor_sort_at', payload #>> '{nextCursor,sortAt}',
      'cursor_kind', payload #>> '{nextCursor,kind}',
      'cursor_id', payload #>> '{nextCursor,entityId}'
    )
  )
  from enterprise_todo_fixture_pages
 where name = 'employee_tasks_page_1';

select enterprise_integration.assert_true(
  (
    select payload ->> 'merchantId' = '10000003'
      and jsonb_array_length(payload -> 'items') = 4
      and (payload #>> '{counts,openCount}')::integer = 4
      and (payload #>> '{counts,taskCount}')::integer = 3
      and (payload #>> '{counts,overdueCount}')::integer = 2
      and (payload #>> '{counts,dueSoonCount}')::integer = 0
      and (payload #>> '{counts,acknowledgementCount}')::integer = 0
      and (payload #>> '{counts,executionCount}')::integer = 0
      and (payload #>> '{counts,feedbackCount}')::integer = 1
      and payload -> 'nextCursor' = 'null'::jsonb
      from enterprise_todo_fixture_pages
     where name = 'owner_all'
  ),
  'owner todo counts or page shape are incorrect'
);

select enterprise_integration.assert_true(
  (
    select exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'task'
         and item ->> 'entityId' = '83500000-0000-4000-8000-000000000003'
    )
    and exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'task'
         and item ->> 'entityId' = '83500000-0000-4000-8000-000000000005'
         and item -> 'reasons' ? 'unassigned'
    )
    and exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'workflow_feedback'
         and item ->> 'entityId' = '83900000-0000-4000-8000-000000000002'
    )
      from enterprise_todo_fixture_pages
     where name = 'owner_all'
  ),
  'owner team exceptions or workflow feedback are missing'
);

select enterprise_integration.assert_true(
  (
    select jsonb_array_length(payload -> 'items') = 4
      and (payload #>> '{counts,openCount}')::integer = 4
      and (payload #>> '{counts,taskCount}')::integer = 2
      and (payload #>> '{counts,overdueCount}')::integer = 1
      and (payload #>> '{counts,dueSoonCount}')::integer = 1
      and (payload #>> '{counts,acknowledgementCount}')::integer = 1
      and (payload #>> '{counts,executionCount}')::integer = 1
      and (payload #>> '{counts,feedbackCount}')::integer = 0
      from enterprise_todo_fixture_pages
     where name = 'employee_all'
  ),
  'employee todo counts are incorrect'
);

select enterprise_integration.assert_true(
  (
    select not exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'entityId' = '83500000-0000-4000-8000-000000000003'
    )
    and not exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'entityId' = '83500000-0000-4000-8000-000000000005'
    )
    and exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'workflow_acknowledgement'
         and item ->> 'entityId' = '83600000-0000-4000-8000-000000000001'
         and (item ->> 'revisionNo')::integer = 2
    )
    and exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'workflow_execution'
         and item ->> 'entityId' = '83900000-0000-4000-8000-000000000001'
    )
      from enterprise_todo_fixture_pages
     where name = 'employee_all'
  ),
  'restricted employee scope or workflow todos are incorrect'
);

select enterprise_integration.assert_true(
  (
    select exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'task'
         and item ->> 'entityId' = '83500000-0000-4000-8000-000000000001'
         and item ->> 'subtitle' = 'Todo visible board · Todo'
    )
    and exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'workflow_execution'
         and item ->> 'entityId' = '83900000-0000-4000-8000-000000000001'
         and item ->> 'subtitle' = '1/2 步已完成'
    )
      from enterprise_todo_fixture_pages
     where name = 'employee_all'
  )
  and (
    select exists (
      select 1
        from jsonb_array_elements(payload -> 'items') as item
       where item ->> 'kind' = 'workflow_feedback'
         and item ->> 'entityId' = '83900000-0000-4000-8000-000000000002'
         and item ->> 'subtitle' = 'Todo Worker 提交了待处理反馈'
    )
      from enterprise_todo_fixture_pages
     where name = 'owner_all'
  ),
  'todo subtitles contain mojibake or lost their deterministic fallback'
);

select enterprise_integration.assert_true(
  exists (
    select 1
      from public.merchant_enterprise_workflow_acknowledgements
     where merchant_id = '10000003'
       and workflow_id = '83600000-0000-4000-8000-000000000001'::uuid
       and revision_id = '83700000-0000-4000-8000-000000000001'::uuid
       and revision_no = 1
       and employee_id = '83200000-0000-4000-8000-000000000001'::uuid
  )
  and not exists (
    select 1
      from public.merchant_enterprise_workflow_acknowledgements
     where merchant_id = '10000003'
       and workflow_id = '83600000-0000-4000-8000-000000000001'::uuid
       and revision_id = '83700000-0000-4000-8000-000000000002'::uuid
       and employee_id = '83200000-0000-4000-8000-000000000001'::uuid
  ),
  'old workflow acknowledgement fixture does not prove current-revision behavior'
);

select enterprise_integration.assert_true(
  not exists (
    select 1
      from enterprise_todo_fixture_pages as page,
           lateral jsonb_array_elements(page.payload -> 'items') as item
     where page.name in ('owner_all', 'employee_all')
       and item ->> 'kind' = 'task'
       and item ->> 'entityId' = '83500000-0000-4000-8000-000000000004'
  )
  and not exists (
    select 1
      from enterprise_todo_fixture_pages as page,
           lateral jsonb_array_elements(page.payload -> 'items') as item
     where page.name in ('owner_all', 'employee_all')
       and item ->> 'kind' = 'workflow_execution'
       and item ->> 'entityId' = '83900000-0000-4000-8000-000000000002'
  ),
  'completed task or execution leaked into open todos'
);

select enterprise_integration.assert_true(
  (
    select jsonb_array_length(payload -> 'items') = 1
      and payload #>> '{items,0,entityId}' =
        '83500000-0000-4000-8000-000000000001'
      and payload #>> '{items,0,urgency}' = 'overdue'
      and payload -> 'nextCursor' <> 'null'::jsonb
      and payload #>> '{nextCursor,category}' = 'tasks'
      and (payload #>> '{counts,openCount}')::integer = 4
      and (payload #>> '{counts,taskCount}')::integer = 2
      and (payload #>> '{counts,acknowledgementCount}')::integer = 1
      and (payload #>> '{counts,executionCount}')::integer = 1
      from enterprise_todo_fixture_pages
     where name = 'employee_tasks_page_1'
  ),
  'first task keyset page or global counts are incorrect'
);

select enterprise_integration.assert_true(
  (
    select jsonb_array_length(payload -> 'items') = 1
      and payload #>> '{items,0,entityId}' =
        '83500000-0000-4000-8000-000000000002'
      and payload #>> '{items,0,urgency}' = 'due_soon'
      and payload -> 'nextCursor' = 'null'::jsonb
      and (payload #>> '{counts,openCount}')::integer = 4
      and (payload #>> '{counts,taskCount}')::integer = 2
      from enterprise_todo_fixture_pages
     where name = 'employee_tasks_page_2'
  ),
  'second task keyset page is incorrect'
);

select enterprise_integration.assert_true(
  (
    select count(*) = 2
      from (
        select item ->> 'entityId' as entity_id
          from enterprise_todo_fixture_pages as page,
               lateral jsonb_array_elements(page.payload -> 'items') as item
         where page.name in ('employee_tasks_page_1', 'employee_tasks_page_2')
         group by item ->> 'entityId'
      ) as distinct_task_pages
  ),
  'task keyset pages overlap or omit an accessible task'
);

reset role;
rollback;

\echo '[enterprise-integration] unified enterprise todo checks passed'
