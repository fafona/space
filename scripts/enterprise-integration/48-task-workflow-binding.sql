\set ON_ERROR_STOP on
\pset pager off

-- This acceptance slice expects the disposable integration fixture from
-- 10-serial-acceptance.sql and the workflow permissions introduced by 020.
-- All local fixtures roll back after the acceptance assertions complete.
begin;

select enterprise_integration.assert_true(
  to_regprocedure(
    'public.faolla_list_merchant_enterprise_published_workflow_choices_v1(jsonb)'
  ) is not null
  and to_regprocedure(
    'public.faolla_get_merchant_task_workflow_binding_v1(jsonb)'
  ) is not null
  and to_regprocedure(
    'public.faolla_bind_merchant_task_workflow_v1(jsonb)'
  ) is not null,
  'task workflow migration 024 is not installed'
);

select id::text as binding_board_id
  from public.merchant_task_boards
 where merchant_id = '10000001' and system_key = 'default'
\gset
select id::text as binding_todo_id
  from public.merchant_task_columns
 where merchant_id = '10000001' and system_key = 'todo'
\gset
select id::text as binding_worker_id
  from public.merchant_enterprise_employees
 where merchant_id = '10000001' and email = 'worker@example.test'
\gset

insert into public.merchant_enterprise_roles (
  id, merchant_id, name, description, permissions, status, is_system
)
values (
  '74900000-0000-4000-8000-000000000001'::uuid,
  '10000001',
  'Task binding workflow-only viewer',
  'Cannot update tasks',
  array['enterprise.view', 'workflows.view']::text[],
  'active',
  false
);
insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id,
  status, invited_at, accepted_at, last_active_at
)
values (
  '74900000-0000-4000-8000-000000000002'::uuid,
  '10000001',
  '74900000-0000-4000-8000-000000000102'::uuid,
  'task-binding-viewer@example.test',
  'Task binding viewer',
  '74900000-0000-4000-8000-000000000001'::uuid,
  'active', now(), now(), now()
);

-- Create and publish revision 1, then save a newer mutable draft. Published
-- choices must continue to expose only the immutable revision 1 projection.
set role service_role;
select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"owner",
    "actor_id":"10000000-0000-4000-8000-000000000001",
    "operation_id":"integration-task-binding-workflow-create",
    "title":"Task binding published v1",
    "scenario":"A customer reports a delivery problem",
    "description":"Published v1 description",
    "category":"Support",
    "tags":["delivery","support"],
    "steps":[
      {
        "id":"74800000-0000-4000-8000-000000000001",
        "title":"Verify delivery",
        "instruction":"Confirm the order and delivery status.",
        "position":0
      },
      {
        "id":"74800000-0000-4000-8000-000000000002",
        "title":"Resolve delivery",
        "instruction":"Choose the approved replacement or refund path.",
        "position":1
      }
    ]
  }'::jsonb
);
reset role;

select id::text as binding_workflow_id, version::text as binding_workflow_version
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and title = 'Task binding published v1'
\gset

set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'binding_workflow_id',
    'expected_version', :'binding_workflow_version'::bigint,
    'action', 'publish',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-workflow-publish-1'
  )
);
reset role;

select current_revision_id::text as binding_revision_one,
       version::text as binding_published_version
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and id = :'binding_workflow_id'::uuid
\gset

set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'binding_workflow_id',
    'expected_version', :'binding_published_version'::bigint,
    'action', 'save',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-workflow-draft-2',
    'title', 'UNPUBLISHED task binding draft v2',
    'scenario', 'UNPUBLISHED scenario must never reach choices or tasks',
    'description', 'UNPUBLISHED description',
    'category', 'Draft',
    'tags', jsonb_build_array('draft'),
    'steps', jsonb_build_array(
      jsonb_build_object(
        'id', '74800000-0000-4000-8000-000000000001',
        'title', 'UNPUBLISHED verify delivery',
        'instruction', 'UNPUBLISHED instruction',
        'position', 0
      ),
      jsonb_build_object(
        'id', '74800000-0000-4000-8000-000000000002',
        'title', 'UNPUBLISHED resolve delivery',
        'instruction', 'UNPUBLISHED instruction',
        'position', 1
      )
    )
  )
);

select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001'
      )
    ) ->> 'merchantId' = '10000001'
  )
  and (
    select count(*) = 1
      and bool_and(choice ->> 'title' = 'Task binding published v1')
      and bool_and(choice ->> 'scenario' = 'A customer reports a delivery problem')
      and bool_and(choice ->> 'revision_id' = :'binding_revision_one')
      and bool_and(choice ->> 'revision_no' = '1')
      and bool_and(choice ->> 'step_count' = '2')
      and bool_and((select count(*) = 6 from jsonb_object_keys(choice)))
      and bool_and(not (choice ? 'description'))
      and bool_and(not (choice ? 'steps'))
      and bool_and(not (choice ? 'has_unpublished_changes'))
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      ) -> 'choices'
    ) as listed(choice)
    where choice ->> 'id' = :'binding_workflow_id'
  ),
  'owner published choices leaked the mutable draft or omitted revision metadata'
);

select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', :'binding_worker_id'
      )
    ) ->> 'merchantId' = '10000001'
  )
  and (
    select count(*) = 1
      and bool_and(choice ->> 'revision_id' = :'binding_revision_one')
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', :'binding_worker_id'
        )
      ) -> 'choices'
    ) as listed(choice)
    where choice ->> 'id' = :'binding_workflow_id'
  ),
  'employee could not read the immutable published choice'
);

select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
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

-- Four fresh tasks cover owner binding/idempotency, employee binding, a
-- 99-item capacity rejection, and execution-first source exclusivity. The
-- owner task begins with one manual item to prove that SOP items append rather
-- than replace existing work.
set role service_role;
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'binding_board_id',
    'column_id', :'binding_todo_id',
    'title', 'Task workflow owner binding',
    'description', '',
    'priority', 'normal',
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-owner-task',
    'event_payload', '{}'::jsonb
  )
);
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'binding_board_id',
    'column_id', :'binding_todo_id',
    'title', 'Task workflow employee binding',
    'description', '',
    'priority', 'normal',
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', jsonb_build_array(:'binding_worker_id'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-employee-task',
    'event_payload', '{}'::jsonb
  )
);
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'binding_board_id',
    'column_id', :'binding_todo_id',
    'title', 'Task workflow capacity binding',
    'description', '',
    'priority', 'normal',
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-capacity-task',
    'event_payload', '{}'::jsonb
  )
);
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'binding_board_id',
    'column_id', :'binding_todo_id',
    'title', 'Task workflow execution-first source',
    'description', '',
    'priority', 'normal',
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', jsonb_build_array(:'binding_worker_id'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-execution-first-task',
    'event_payload', '{}'::jsonb
  )
);
reset role;

select task_id::text as binding_owner_task
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-task-binding-owner-task'
\gset
select task_id::text as binding_employee_task
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-task-binding-employee-task'
\gset
select task_id::text as binding_capacity_task
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-task-binding-capacity-task'
\gset
select task_id::text as binding_execution_first_task
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-task-binding-execution-first-task'
\gset

set role service_role;
select public.faolla_create_merchant_task_checklist_item_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'binding_owner_task',
    'text', 'Existing manual checklist item',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-manual-item'
  )
);

select public.faolla_bind_merchant_task_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'binding_owner_task',
    'workflow_id', :'binding_workflow_id',
    'expected_task_version', 1,
    'expected_revision_id', :'binding_revision_one',
    'operation_id', 'integration-task-binding-owner-bind',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
-- Exact replay must return the stored response without duplicating any row.
select public.faolla_bind_merchant_task_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'binding_owner_task',
    'workflow_id', :'binding_workflow_id',
    'expected_task_version', 1,
    'expected_revision_id', :'binding_revision_one',
    'operation_id', 'integration-task-binding-owner-bind',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);

select public.faolla_bind_merchant_task_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'binding_employee_task',
    'workflow_id', :'binding_workflow_id',
    'expected_task_version', 1,
    'expected_revision_id', :'binding_revision_one',
    'operation_id', 'integration-task-binding-employee-bind',
    'actor_type', 'employee',
    'actor_id', :'binding_worker_id'
  )
);

select enterprise_integration.assert_true(
  public.faolla_get_merchant_task_workflow_binding_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'task_id', :'binding_owner_task',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) ->> 'merchantId' = '10000001'
  and public.faolla_get_merchant_task_workflow_binding_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'task_id', :'binding_owner_task',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) -> 'binding' ->> 'merchant_id' = '10000001',
  'task binding DTO omitted its authenticated tenant marker'
);

select enterprise_integration.assert_true(
  public.faolla_get_merchant_task_workflow_binding_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'task_id', :'binding_capacity_task',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) ->> 'merchantId' = '10000001'
  and public.faolla_get_merchant_task_workflow_binding_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'task_id', :'binding_capacity_task',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001'
    )
  ) -> 'binding' = 'null'::jsonb,
  'unbound task GET omitted its authenticated tenant marker or non-null binding guard'
);
reset role;

select enterprise_integration.assert_true(
  (
    select count(*) = 1
      and bool_and(workflow_revision_id = :'binding_revision_one'::uuid)
      and bool_and(bound_by_actor_type = 'owner')
      and bool_and(bound_by_actor_id is null)
    from public.merchant_task_workflow_bindings
    where merchant_id = '10000001'
      and task_id = :'binding_owner_task'::uuid
  )
  and (
    select count(*) = 3
      and count(*) filter (where source_workflow_revision_id is null) = 1
      and count(*) filter (
        where source_workflow_revision_id = :'binding_revision_one'::uuid
      ) = 2
      and min(position) filter (
        where source_workflow_revision_id = :'binding_revision_one'::uuid
      ) > min(position) filter (where source_workflow_revision_id is null)
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'binding_owner_task'::uuid
      and archived_at is null
  )
  and (
    select count(*) = 1
    from public.merchant_task_events
    where merchant_id = '10000001'
      and task_id = :'binding_owner_task'::uuid
      and event_type = 'workflow_bound'
      and operation_id = 'integration-task-binding-owner-bind'
      and actor_type = 'owner'
      and actor_id = ''
  ),
  'owner bind/replay replaced manual work or duplicated binding, checklist, or event rows'
);

select enterprise_integration.assert_true(
  (
    select count(*) = 1
      and bool_and(bound_by_actor_type = 'employee')
      and bool_and(bound_by_actor_id = :'binding_worker_id'::uuid)
    from public.merchant_task_workflow_bindings
    where merchant_id = '10000001'
      and task_id = :'binding_employee_task'::uuid
  )
  and (
    select count(*) = 2
      and bool_and(source_workflow_revision_id = :'binding_revision_one'::uuid)
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'binding_employee_task'::uuid
  )
  and (
    select count(*) = 1
    from public.merchant_task_events
    where merchant_id = '10000001'
      and task_id = :'binding_employee_task'::uuid
      and event_type = 'workflow_bound'
      and operation_id = 'integration-task-binding-employee-bind'
      and actor_type = 'employee'
      and actor_id = :'binding_worker_id'
  ),
  'authorized employee bind did not atomically generate the revision checklist'
);

-- Workflow execution and manager binding are two alternative ways to generate
-- a task checklist. They must remain mutually exclusive in both directions,
-- including when the calls race; the 024 storage triggers serialize both on
-- the same parent task row used by both RPC authorization paths.
set role service_role;
select public.faolla_acknowledge_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'binding_workflow_id',
    'expected_revision_no', 1,
    'actor_type', 'employee',
    'actor_id', :'binding_worker_id',
    'operation_id', 'integration-task-binding-worker-ack'
  )
);

select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_start_merchant_enterprise_workflow_execution_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_revision_no', 1,
          'subject', 'Binding-first source exclusion',
          'task_id', %L,
          'generate_checklist', true,
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-task-binding-bound-first-execution'
        )
      )
    $sql$,
    :'binding_workflow_id', :'binding_employee_task', :'binding_worker_id'
  ),
  'task_workflow_checklist_source_exists'
);

select public.faolla_start_merchant_enterprise_workflow_execution_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'binding_workflow_id',
    'expected_revision_no', 1,
    'subject', 'Execution-first source exclusion',
    'task_id', :'binding_execution_first_task',
    'generate_checklist', true,
    'actor_type', 'employee',
    'actor_id', :'binding_worker_id',
    'operation_id', 'integration-task-binding-execution-first-start'
  )
);

select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_task_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'workflow_id', %L,
          'expected_task_version', 1,
          'expected_revision_id', %L,
          'operation_id', 'integration-task-binding-execution-first-bind',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'binding_execution_first_task', :'binding_workflow_id', :'binding_revision_one'
  ),
  'task_workflow_checklist_source_exists'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_workflow_executions
     where merchant_id = '10000001'
       and task_id = :'binding_employee_task'::uuid
       and generated_checklist_count > 0
  )
  and (
    select count(*) = 2
      from public.merchant_task_checklist_items
     where merchant_id = '10000001'
       and task_id = :'binding_employee_task'::uuid
  )
  and not exists (
    select 1
      from public.merchant_idempotency_keys
     where merchant_id = '10000001'
       and idempotency_key =
         'enterprise-workflow-execution-start-v1:integration-task-binding-bound-first-execution'
  )
  and (
    select count(*) = 1
       and bool_and(generated_checklist_count = 2)
      from public.merchant_enterprise_workflow_executions
     where merchant_id = '10000001'
       and task_id = :'binding_execution_first_task'::uuid
  )
  and not exists (
    select 1
      from public.merchant_task_workflow_bindings
     where merchant_id = '10000001'
       and task_id = :'binding_execution_first_task'::uuid
  )
  and (
    select count(*) = 2
      from public.merchant_task_checklist_items
     where merchant_id = '10000001'
       and task_id = :'binding_execution_first_task'::uuid
  )
  and not exists (
    select 1
      from public.merchant_idempotency_keys
     where merchant_id = '10000001'
       and idempotency_key =
         'enterprise-task:integration-task-binding-execution-first-bind'
  ),
  'cross-source rejection left a duplicate checklist source or partial operation state'
);

-- A new operation cannot silently replace an existing immutable binding.
set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_task_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'workflow_id', %L,
          'expected_task_version', 1,
          'expected_revision_id', %L,
          'operation_id', 'integration-task-binding-owner-duplicate',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'binding_owner_task', :'binding_workflow_id', :'binding_revision_one'
  ),
  'task_workflow_already_bound'
);

-- Cross-tenant and missing-task-permission employees are rejected by the
-- database, even though calls arrive through the service role.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_task_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'workflow_id', %L,
          'expected_task_version', 1,
          'expected_revision_id', %L,
          'operation_id', 'integration-task-binding-cross-tenant',
          'actor_type', 'employee',
          'actor_id', '50000000-0000-4000-8000-000000000005'
        )
      )
    $sql$,
    :'binding_capacity_task', :'binding_workflow_id', :'binding_revision_one'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_task_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'workflow_id', %L,
          'expected_task_version', 1,
          'expected_revision_id', %L,
          'operation_id', 'integration-task-binding-missing-task-permission',
          'actor_type', 'employee',
          'actor_id', '74900000-0000-4000-8000-000000000002'
        )
      )
    $sql$,
    :'binding_capacity_task', :'binding_workflow_id', :'binding_revision_one'
  ),
  'permission_denied'
);
reset role;

-- Direct fixture rows exercise the exact 99 + 2 capacity boundary. The failed
-- RPC must leave no binding, generated item, event, or idempotency claim.
insert into public.merchant_task_checklist_items (
  merchant_id, task_id, text, position
)
select
  '10000001',
  :'binding_capacity_task'::uuid,
  'Capacity fixture ' || candidate::text,
  candidate::bigint * 1024::bigint
from generate_series(1, 99) as candidate;

set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_bind_merchant_task_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'workflow_id', %L,
          'expected_task_version', 1,
          'expected_revision_id', %L,
          'operation_id', 'integration-task-binding-capacity-failure',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'binding_capacity_task', :'binding_workflow_id', :'binding_revision_one'
  ),
  'task_checklist_limit_reached'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_task_workflow_bindings
    where merchant_id = '10000001'
      and task_id = :'binding_capacity_task'::uuid
  )
  and (
    select count(*) = 99
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'binding_capacity_task'::uuid
  )
  and not exists (
    select 1 from public.merchant_task_events
    where merchant_id = '10000001'
      and operation_id = 'integration-task-binding-capacity-failure'
  )
  and not exists (
    select 1 from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key = 'enterprise-task:integration-task-binding-capacity-failure'
  ),
  'capacity failure left partial binding, checklist, event, or idempotency state'
);

-- Publish the mutable draft as revision 2. Existing tasks and their generated
-- provenance must remain fixed to revision 1, while choices move to revision 2.
select version::text as binding_draft_version
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and id = :'binding_workflow_id'::uuid
\gset

set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'binding_workflow_id',
    'expected_version', :'binding_draft_version'::bigint,
    'action', 'publish',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-binding-workflow-publish-2'
  )
);
reset role;

select current_revision_id::text as binding_revision_two
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and id = :'binding_workflow_id'::uuid
\gset

set role service_role;
select enterprise_integration.assert_true(
  (
    select binding ->> 'revision_id' = :'binding_revision_one'
      and binding ->> 'revision_no' = '1'
      and binding ->> 'title' = 'Task binding published v1'
      and binding -> 'steps' -> 0 ->> 'title' = 'Verify delivery'
      and binding ->> 'generated_checklist_count' = '2'
    from (
      select public.faolla_get_merchant_task_workflow_binding_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', :'binding_owner_task',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      ) -> 'binding' as binding
    ) as loaded
  ),
  'republish rewrote the task binding instead of retaining revision 1'
);
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      and bool_and(choice ->> 'revision_id' = :'binding_revision_two')
      and bool_and(choice ->> 'revision_no' = '2')
      and bool_and(choice ->> 'title' = 'UNPUBLISHED task binding draft v2')
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      ) -> 'choices'
    ) as listed(choice)
    where choice ->> 'id' = :'binding_workflow_id'
  ),
  'published choices did not advance to revision 2 after publication'
);
reset role;

select enterprise_integration.assert_true(
  (
    select count(*) = 2
      and bool_and(source_workflow_revision_id = :'binding_revision_one'::uuid)
      and bool_and(text in ('Verify delivery', 'Resolve delivery'))
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'binding_owner_task'::uuid
      and source_workflow_revision_id is not null
  ),
  'republish changed the generated revision 1 checklist provenance or text'
);

rollback;
