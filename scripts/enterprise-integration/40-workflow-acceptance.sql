\set ON_ERROR_STOP on
\pset pager off

-- Migration 020 must enrich only future default bootstrap roles, while custom
-- roles remain opt-in and author/publisher duties stay separable.
select enterprise_integration.assert_true(
  (
    select permissions @> array[
      'workflows.view', 'workflows.manage', 'workflows.publish'
    ]::text[]
    from public.merchant_enterprise_roles
    where merchant_id = '10000001' and system_key = 'administrator'
  ),
  'administrator default workflow permissions are incomplete'
);
select enterprise_integration.assert_true(
  (
    select permissions @> array['workflows.view', 'workflows.manage']::text[]
      and not ('workflows.publish' = any(permissions))
    from public.merchant_enterprise_roles
    where merchant_id = '10000001' and system_key = 'supervisor'
  ),
  'supervisor default workflow permissions violate author-review separation'
);
select enterprise_integration.assert_true(
  (
    select 'workflows.view' = any(permissions)
      and not ('workflows.manage' = any(permissions))
      and not ('workflows.publish' = any(permissions))
    from public.merchant_enterprise_roles
    where merchant_id = '10000001' and system_key = 'employee'
  ),
  'employee default workflow permissions are not view-only'
);
select enterprise_integration.assert_true(
  (
    select not (permissions && array[
      'workflows.view', 'workflows.manage', 'workflows.publish'
    ]::text[])
    from public.merchant_enterprise_roles
    where merchant_id = '10000001' and name = 'Scoped role manager'
  ),
  'custom role was implicitly granted workflow permissions'
);

select id::text as workflow_author_role
  from public.merchant_enterprise_roles
 where merchant_id = '10000001' and system_key = 'supervisor'
\gset

insert into public.merchant_enterprise_roles (
  id, merchant_id, name, description, permissions, status, is_system
)
values
  (
    '70000000-0000-4000-8000-000000000001'::uuid,
    '10000001', 'Workflow publisher', 'Publish-only integration role',
    array['enterprise.view', 'workflows.view', 'workflows.publish']::text[],
    'active', false
  ),
  (
    '70000000-0000-4000-8000-000000000002'::uuid,
    '10000001', 'Workflow viewer', 'View-only integration role',
    array['enterprise.view', 'workflows.view']::text[],
    'active', false
  ),
  (
    '70000000-0000-4000-8000-000000000003'::uuid,
    '10000001', 'Task-only viewer', 'Notification filtering fixture',
    array['enterprise.view', 'tasks.view']::text[],
    'active', false
  ),
  (
    '70000000-0000-4000-8000-000000000004'::uuid,
    '10000001', 'Dual viewer', 'Historical notification fixture',
    array['enterprise.view', 'tasks.view', 'workflows.view']::text[],
    'active', false
  );

insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id,
  status, invited_at, accepted_at, last_active_at
)
values
  (
    '71000000-0000-4000-8000-000000000001'::uuid,
    '10000001', '71000000-0000-4000-8000-000000000101'::uuid,
    'workflow-author@example.test', 'Workflow Author',
    :'workflow_author_role'::uuid, 'active', now(), now(), now()
  ),
  (
    '71000000-0000-4000-8000-000000000002'::uuid,
    '10000001', '71000000-0000-4000-8000-000000000102'::uuid,
    'workflow-publisher@example.test', 'Workflow Publisher',
    '70000000-0000-4000-8000-000000000001'::uuid,
    'active', now(), now(), now()
  ),
  (
    '71000000-0000-4000-8000-000000000003'::uuid,
    '10000001', '71000000-0000-4000-8000-000000000103'::uuid,
    'workflow-viewer@example.test', 'Workflow Viewer',
    '70000000-0000-4000-8000-000000000002'::uuid,
    'active', now(), now(), now()
  ),
  (
    '71000000-0000-4000-8000-000000000004'::uuid,
    '10000001', '71000000-0000-4000-8000-000000000104'::uuid,
    'dual-viewer@example.test', 'Dual Viewer',
    '70000000-0000-4000-8000-000000000004'::uuid,
    'active', now(), now(), now()
  );

-- A publish-only employee cannot create or save drafts.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_workflow_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "operation_id":"integration-publisher-create-denied",
        "title":"Publisher-created draft",
        "scenario":"Must be denied",
        "description":"",
        "category":"",
        "tags":[],
        "steps":[]
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);

select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000001",
    "operation_id":"integration-workflow-main-create",
    "title":"Published support workflow",
    "scenario":"A customer reports a damaged item",
    "description":"Original published description",
    "category":"Support",
    "tags":["support","returns"],
    "steps":[
      {
        "id":"72000000-0000-4000-8000-000000000001",
        "title":"Verify order",
        "instruction":"Confirm the order and damaged item.",
        "position":0
      },
      {
        "id":"72000000-0000-4000-8000-000000000002",
        "title":"Offer resolution",
        "instruction":"Offer replacement or refund according to policy.",
        "position":1
      }
    ]
  }'::jsonb
);
reset role;

select id::text as workflow_main_id, version as workflow_main_version
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001' and title = 'Published support workflow'
\gset

select enterprise_integration.assert_true(
  :workflow_main_version = 1
  and (
    select count(*) = 2
    from public.merchant_enterprise_workflow_steps
    where merchant_id = '10000001'
      and workflow_id = :'workflow_main_id'::uuid
      and status = 'active'
  ),
  'workflow create did not preserve ordered client step UUIDs'
);

-- Required JSON fields must fail closed rather than falling through SQL NULL
-- three-valued logic or producing an unbounded notification query.
set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 1,
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'operation_id', 'integration-workflow-missing-action'
        )
      )
    $sql$,
    :'workflow_main_id'
  ),
  'invalid_workflow_action'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_workflow_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000001",
        "operation_id":"integration-workflow-missing-scenario",
        "title":"Missing scenario",
        "description":"",
        "category":"",
        "tags":[],
        "steps":[]
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_payload'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_workflow_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000001",
        "operation_id":"integration-workflow-missing-step-instruction",
        "title":"Missing step instruction",
        "scenario":"A required step field is absent",
        "description":"",
        "category":"",
        "tags":[],
        "steps":[{
          "id":"72400000-0000-4000-8000-000000000001",
          "title":"Incomplete step",
          "position":0
        }]
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_payload'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_notifications_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003"
      }'::jsonb
    )
  $sql$,
  'invalid_notification_request'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_mark_merchant_enterprise_notifications_read_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003",
        "notification_id":null
      }'::jsonb
    )
  $sql$,
  'invalid_notification_request'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_notifications_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":null,
        "actor_id":"71000000-0000-4000-8000-000000000003",
        "limit":20
      }'::jsonb
    )
  $sql$,
  'invalid_notification_actor'
);
reset role;

select enterprise_integration.assert_true(
  not public.faolla_valid_merchant_workflow_notification_payload_v1('{}'::jsonb)
  and not public.faolla_valid_merchant_workflow_notification_payload_v1('null'::jsonb)
  and not public.faolla_valid_merchant_workflow_notification_payload_v1('"scalar"'::jsonb),
  'workflow notification payload validator returned NULL or accepted malformed JSON'
);

-- View-only employees see no draft; publisher and manager roles do see it.
set role service_role;
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003"
      }'::jsonb
    ) -> 'workflows'
  ) = 0,
  'view-only employee saw an unpublished workflow draft'
);
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002"
      }'::jsonb
    ) -> 'workflows'
  ) = 1,
  'publisher could not review the current workflow draft'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 1,
          'action', 'publish',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000001',
          'operation_id', 'integration-author-publish-denied'
        )
      )
    $sql$,
    :'workflow_main_id'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 1,
          'action', 'save',
          'title', 'Publisher smuggled edit',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'operation_id', 'integration-publisher-save-denied'
        )
      )
    $sql$,
    :'workflow_main_id'
  ),
  'permission_denied'
);
reset role;

select task_id::text as workflow_notification_task
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-main-task-create'
\gset

-- Seed a historical task notification for a workflow-only employee. Current
-- permissions, not historical delivery, must decide inbox visibility.
insert into public.merchant_enterprise_notifications (
  merchant_id, recipient_employee_id, task_id, workflow_id,
  notification_type, event_key, actor_type, actor_id, payload
)
values (
  '10000001',
  '71000000-0000-4000-8000-000000000003'::uuid,
  :'workflow_notification_task'::uuid,
  null,
  'task_assigned',
  'integration-workflow-viewer-historical-task',
  'system',
  '',
  '{}'::jsonb
);

-- Publish once, then replay the exact operation. The immutable revision,
-- notification fan-out and audit event must each remain singletons.
set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 1,
    'action', 'publish',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-main-publish-1'
  )
);
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 1,
    'action', 'publish',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-main-publish-1'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'published' and version = 2
      and published_version = 1 and not has_unpublished_changes
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001' and id = :'workflow_main_id'::uuid
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001' and workflow_id = :'workflow_main_id'::uuid
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'workflow_main_id'::uuid
      and event_type = 'workflow.published'
  ),
  'publish replay duplicated or lost workflow transaction state'
);

set role service_role;
select enterprise_integration.assert_true(
  (
    select
      item ->> 'created_at' = item ->> 'published_at'
      and item ->> 'updated_at' = item ->> 'published_at'
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_workflows_v1(
        '{
          "merchant_id":"10000001",
          "actor_type":"employee",
          "actor_id":"71000000-0000-4000-8000-000000000003"
        }'::jsonb
      ) -> 'workflows'
    ) as published(item)
    where item ->> 'id' = :'workflow_main_id'
  ),
  'published-only projection leaked draft creation or update timestamps'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1
    from public.merchant_enterprise_notifications
    where merchant_id = '10000001'
      and workflow_id = :'workflow_main_id'::uuid
      and recipient_employee_id = '71000000-0000-4000-8000-000000000002'::uuid
  )
  and exists (
    select 1
    from public.merchant_enterprise_notifications
    where merchant_id = '10000001'
      and workflow_id = :'workflow_main_id'::uuid
      and recipient_employee_id = '71000000-0000-4000-8000-000000000003'::uuid
      and notification_type = 'workflow_published'
      and payload = jsonb_build_object(
        'workflowTitle', 'Published support workflow',
        'publishedVersion', 1
      )
  ),
  'workflow publication fan-out included publisher or stored unsafe payload'
);

set role service_role;
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      and bool_and(item ->> 'notification_type' = 'workflow_published')
      and bool_and(item ->> 'task_id' is null)
      and bool_and(item ->> 'workflow_id' = :'workflow_main_id')
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_notifications_v1(
        '{
          "merchant_id":"10000001",
          "actor_type":"employee",
          "actor_id":"71000000-0000-4000-8000-000000000003",
          "limit":20,
          "cursor_created_at":null,
          "cursor_id":null
        }'::jsonb
      ) -> 'notifications'
    ) as notification(item)
  ),
  'workflow-only employee could read a historical task notification'
);
select public.faolla_mark_merchant_enterprise_notifications_read_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000003",
    "mark_all":true,
    "notification_id":null
  }'::jsonb
);
reset role;

select enterprise_integration.assert_true(
  (
    select read_at is null
    from public.merchant_enterprise_notifications
    where event_key = 'integration-workflow-viewer-historical-task'
  )
  and (
    select read_at is not null
    from public.merchant_enterprise_notifications
    where merchant_id = '10000001'
      and workflow_id = :'workflow_main_id'::uuid
      and recipient_employee_id = '71000000-0000-4000-8000-000000000003'::uuid
      and event_key like '%:published:1'
  ),
  'mark-read crossed the current notification permission boundary'
);

-- A dual viewer received publication while authorized. After changing to a
-- task-only role, the historical workflow notification must disappear.
update public.merchant_enterprise_employees
   set role_id = '70000000-0000-4000-8000-000000000003'::uuid
 where merchant_id = '10000001'
   and id = '71000000-0000-4000-8000-000000000004'::uuid;
insert into public.merchant_enterprise_notifications (
  merchant_id, recipient_employee_id, task_id, workflow_id,
  notification_type, event_key, actor_type, actor_id, payload
)
values (
  '10000001',
  '71000000-0000-4000-8000-000000000004'::uuid,
  :'workflow_notification_task'::uuid,
  null,
  'task_assigned',
  'integration-task-viewer-current-task',
  'system',
  '',
  '{}'::jsonb
);

set role service_role;
select enterprise_integration.assert_true(
  (
    select count(*) = 1
      and bool_and(item ->> 'notification_type' = 'task_assigned')
      and bool_and(item ->> 'workflow_id' is null)
    from jsonb_array_elements(
      public.faolla_list_merchant_enterprise_notifications_v1(
        '{
          "merchant_id":"10000001",
          "actor_type":"employee",
          "actor_id":"71000000-0000-4000-8000-000000000004",
          "limit":20,
          "cursor_created_at":null,
          "cursor_id":null
        }'::jsonb
      ) -> 'notifications'
    ) as notification(item)
  ),
  'task-only employee could read a historical workflow notification'
);
reset role;

-- Save a changed draft after publication. View-only projection must remain the
-- immutable revision while author and publisher roles see the new draft.
set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 2,
    'action', 'save',
    'title', 'Published support workflow draft two',
    'scenario', 'A customer reports a damaged item',
    'description', 'Unpublished changed description',
    'category', 'Support',
    'tags', jsonb_build_array('support', 'returns'),
    'steps', jsonb_build_array(
      jsonb_build_object(
        'id', '72000000-0000-4000-8000-000000000001',
        'title', 'Verify order',
        'instruction', 'Confirm the order, item, and evidence.',
        'position', 0
      ),
      jsonb_build_object(
        'id', '72000000-0000-4000-8000-000000000002',
        'title', 'Offer resolution',
        'instruction', 'Offer replacement or refund according to policy.',
        'position', 1
      )
    ),
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-workflow-main-save-2'
  )
);
select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003"
      }'::jsonb
    ) -> 'workflows' -> 0 ->> 'title'
  ) = 'Published support workflow',
  'view-only employee saw unpublished title changes'
);
select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002"
      }'::jsonb
    ) -> 'workflows' -> 0 ->> 'title'
  ) = 'Published support workflow draft two',
  'publisher could not review unpublished draft changes'
);
reset role;

select enterprise_integration.assert_true(
  (
    select version = 3 and published_version = 1 and has_unpublished_changes
    from public.merchant_enterprise_workflows
    where id = :'workflow_main_id'::uuid
  )
  and (
    select snapshot ->> 'title' = 'Published support workflow'
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001'
      and workflow_id = :'workflow_main_id'::uuid
      and revision_no = 1
  ),
  'draft save mutated the published revision or publication pointer'
);

-- Republish, archive and restore all require publish permission. View-only
-- employees lose the archived item and regain exactly the current revision.
set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 3,
    'action', 'publish',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-main-publish-2'
  )
);
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 4,
    'action', 'archive',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-main-archive'
  )
);
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003"
      }'::jsonb
    ) -> 'workflows'
  ) = 0,
  'view-only employee saw an archived workflow'
);
select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "include_archived":true
      }'::jsonb
    ) -> 'workflows' -> 0 ->> 'status'
  ) = 'archived',
  'publisher could not reload an archived workflow for restoration'
);
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'workflow_main_id',
    'expected_version', 5,
    'action', 'restore',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-main-restore'
  )
);
select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003"
      }'::jsonb
    ) -> 'workflows' -> 0 ->> 'title'
  ) = 'Published support workflow draft two',
  'restored workflow did not expose the current published revision'
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'published' and version = 6
      and published_version = 2 and not has_unpublished_changes
    from public.merchant_enterprise_workflows
    where id = :'workflow_main_id'::uuid
  )
  and (
    select count(*) = 2
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001' and workflow_id = :'workflow_main_id'::uuid
  ),
  'republish/archive/restore state machine is inconsistent'
);

-- More than 200 archived rows must never crowd active drafts/publications out
-- of a manager's include-archived response. Active rows come first, followed
-- by the most recently updated archived rows, with a bounded total of 400.
insert into public.merchant_enterprise_workflows (
  id, merchant_id, title, scenario, description, category, tags,
  status, position, created_at, updated_at
)
select
  gen_random_uuid(),
  '10000001',
  'Archived workflow fixture ' || fixture.number::text,
  'Archived pagination fixture',
  '',
  'Integration',
  '{}'::text[],
  'archived',
  fixture.number,
  statement_timestamp() - ((451 - fixture.number) * interval '1 second'),
  statement_timestamp() - ((451 - fixture.number) * interval '1 second')
from generate_series(1, 450) as fixture(number);

set role service_role;
select enterprise_integration.assert_true(
  (
    select
      jsonb_array_length(payload.workflows) = 400
      and payload.workflows -> 0 ->> 'id' = :'workflow_main_id'
      and payload.workflows -> 0 ->> 'status' = 'published'
      and exists (
        select 1
        from jsonb_array_elements(payload.workflows) as item(value)
        where item.value ->> 'title' = 'Archived workflow fixture 450'
      )
      and not exists (
        select 1
        from jsonb_array_elements(payload.workflows) as item(value)
        where item.value ->> 'title' = 'Archived workflow fixture 1'
      )
    from (
      select public.faolla_list_merchant_enterprise_workflows_v1(
        '{
          "merchant_id":"10000001",
          "actor_type":"employee",
          "actor_id":"71000000-0000-4000-8000-000000000002",
          "include_archived":true
        }'::jsonb
      ) -> 'workflows' as workflows
    ) as payload
  ),
  'archived workflow history crowded out active rows or ignored recent-first limit'
);
reset role;

-- Published revisions are immutable even to the migration owner.
select enterprise_integration.expect_error(
  format(
    'update public.merchant_enterprise_workflow_revisions set snapshot = %L::jsonb where merchant_id = %L and workflow_id = %L::uuid',
    '{}', '10000001', :'workflow_main_id'
  ),
  'workflow_revisions_append_only'
);
select enterprise_integration.expect_error(
  format(
    'delete from public.merchant_enterprise_workflow_revisions where merchant_id = %L and workflow_id = %L::uuid',
    '10000001', :'workflow_main_id'
  ),
  'workflow_revisions_append_only'
);

-- Audit data is restricted to the five safe summary keys and the extended
-- query accepts workflow filters.
select enterprise_integration.assert_true(
  (
    select count(*) = 6
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'workflow_main_id'::uuid
      and event_type in (
        'workflow.created', 'workflow.updated', 'workflow.published',
        'workflow.archived', 'workflow.restored'
      )
  )
  and not exists (
    select 1
    from public.merchant_enterprise_audit_events as audit_event
    cross join lateral jsonb_object_keys(
      audit_event.before_data || audit_event.after_data
    ) as audit_key(key)
    where audit_event.merchant_id = '10000001'
      and audit_event.entity_id = :'workflow_main_id'::uuid
      and audit_key.key not in (
        'title', 'category', 'status', 'published_version', 'step_count'
      )
  ),
  'workflow audit events are missing, duplicated, or contain draft content'
);

set role service_role;
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'entity_type', 'workflow',
        'event_type', 'workflow.published',
        'limit', 20
      )
    ) -> 'events'
  ) >= 2,
  'workflow audit filter omitted publication events'
);

-- Cross-merchant actors cannot list or mutate tenant A workflows.
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"50000000-0000-4000-8000-000000000005"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"",
        "actor_id":"71000000-0000-4000-8000-000000000001"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"",
        "actor_id":"30000000-0000-4000-8000-000000000003",
        "limit":20
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 6,
          'action', 'archive',
          'actor_type', 'owner',
          'actor_id', '20000000-0000-4000-8000-000000000002',
          'operation_id', 'integration-workflow-cross-tenant'
        )
      )
    $sql$,
    :'workflow_main_id'
  ),
  'permission_denied'
);
reset role;

-- Exact replay returns one workflow and one audit event even with client UUIDs.
set role service_role;
select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000001",
    "operation_id":"integration-workflow-idempotent-create",
    "title":"Idempotent workflow",
    "scenario":"The same request is retried",
    "description":"",
    "category":"Integration",
    "tags":[],
    "steps":[{
      "id":"72100000-0000-4000-8000-000000000001",
      "title":"Handle once",
      "instruction":"Create exactly one workflow and step.",
      "position":0
    }]
  }'::jsonb
);
select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000001",
    "operation_id":"integration-workflow-idempotent-create",
    "title":"Idempotent workflow",
    "scenario":"The same request is retried",
    "description":"",
    "category":"Integration",
    "tags":[],
    "steps":[{
      "id":"72100000-0000-4000-8000-000000000001",
      "title":"Handle once",
      "instruction":"Create exactly one workflow and step.",
      "position":0
    }]
  }'::jsonb
);
reset role;

select enterprise_integration.assert_true(
  (select count(*) = 1 from public.merchant_enterprise_workflows
    where merchant_id = '10000001' and title = 'Idempotent workflow')
  and (select count(*) = 1 from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and dedupe_key = 'workflow.create:integration-workflow-idempotent-create')
  and (select count(*) = 1 from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key = 'enterprise-workflow-create-v1:integration-workflow-idempotent-create'),
  'workflow create replay was not exactly-once'
);

-- Force notification failure during publication. Revision, pointer, audit and
-- idempotency claim must all roll back in the same transaction.
set role service_role;
select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000001",
    "operation_id":"integration-workflow-rollback-create",
    "title":"Workflow notification rollback",
    "scenario":"Publication notification fails",
    "description":"",
    "category":"Integration",
    "tags":[],
    "steps":[{
      "id":"72300000-0000-4000-8000-000000000001",
      "title":"Rollback",
      "instruction":"No publication state may survive.",
      "position":0
    }]
  }'::jsonb
);
reset role;

select id::text as workflow_rollback_id
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001' and title = 'Workflow notification rollback'
\gset

create trigger aaa_enterprise_integration_reject_workflow_notification
before insert on public.merchant_enterprise_notifications
for each row execute function enterprise_integration.reject_notification_insert();
set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_version', 1,
          'action', 'publish',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'operation_id', 'integration-workflow-rollback-publish'
        )
      )
    $sql$,
    :'workflow_rollback_id'
  ),
  'integration_forced_notification_failure'
);
reset role;
drop trigger aaa_enterprise_integration_reject_workflow_notification
  on public.merchant_enterprise_notifications;

select enterprise_integration.assert_true(
  (
    select status = 'draft' and version = 1 and published_version = 0
      and current_revision_id is null
    from public.merchant_enterprise_workflows
    where id = :'workflow_rollback_id'::uuid
  )
  and not exists (
    select 1 from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001'
      and workflow_id = :'workflow_rollback_id'::uuid
  )
  and not exists (
    select 1 from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'workflow_rollback_id'::uuid
      and event_type = 'workflow.published'
  )
  and not exists (
    select 1 from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key = 'enterprise-workflow-update-v1:integration-workflow-rollback-publish'
  ),
  'notification failure did not roll back the complete workflow publication'
);

-- Prepare a dedicated row for two independent psql CAS sessions.
set role service_role;
select public.faolla_create_merchant_enterprise_workflow_v1(
  '{
    "merchant_id":"10000001",
    "actor_type":"employee",
    "actor_id":"71000000-0000-4000-8000-000000000001",
    "operation_id":"integration-workflow-cas-create",
    "title":"Workflow CAS target",
    "scenario":"Two writers save the same version",
    "description":"",
    "category":"Integration",
    "tags":[],
    "steps":[{
      "id":"72200000-0000-4000-8000-000000000001",
      "title":"Serialize",
      "instruction":"Only one writer may commit.",
      "position":0
    }]
  }'::jsonb
);
reset role;

create or replace function enterprise_integration.delay_workflow_cas_row()
returns trigger
language plpgsql
as $$
begin
  if old.title = 'Workflow CAS target'
     and new.title like 'Workflow CAS worker %' then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$;
create trigger aaa_enterprise_integration_delay_workflow_cas
before update on public.merchant_enterprise_workflows
for each row execute function enterprise_integration.delay_workflow_cas_row();

-- Low privilege roles cannot bypass the RPC boundary or read draft tables.
set role authenticated;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_workflow_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_workflows_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
reset role;
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select count(*) from public.merchant_enterprise_workflows
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select count(*) from public.merchant_enterprise_workflow_revisions
  $sql$,
  'permission denied'
);
reset role;

\echo 'Serial workflow PostgreSQL acceptance checks passed.'
