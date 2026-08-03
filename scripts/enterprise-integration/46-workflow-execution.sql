\set ON_ERROR_STOP on
\pset pager off

-- This acceptance slice runs after the workflow publication fixture and uses
-- only synthetic rows in the disposable integration database.
select workflow.id::text as execution_workflow_id,
       workflow.current_revision_id::text as execution_revision_id,
       workflow.published_version::text as execution_revision_no,
       workflow.version::text as execution_workflow_version
  from public.merchant_enterprise_workflows as workflow
 where workflow.merchant_id = '10000001'
   and workflow.title = 'Published support workflow draft two'
   and workflow.status = 'published'
\gset

select employee.id::text as execution_employee_id
  from public.merchant_enterprise_employees as employee
 where employee.merchant_id = '10000001'
   and employee.email = 'worker@example.test'
   and employee.status = 'active'
\gset

select employee.id::text as execution_manager_id
  from public.merchant_enterprise_employees as employee
 where employee.merchant_id = '10000001'
   and employee.email = 'workflow-author@example.test'
   and employee.status = 'active'
\gset

select event.task_id::text as execution_task_id
  from public.merchant_task_events as event
 where event.merchant_id = '10000001'
   and event.operation_id = 'integration-main-task-create'
\gset

select count(*)::text as execution_task_checklist_before
  from public.merchant_task_checklist_items
 where merchant_id = '10000001'
   and task_id = :'execution_task_id'::uuid
   and archived_at is null
\gset

-- RPCs stay behind the service bridge and the execution history tables are
-- not readable or writable through client database roles.
select enterprise_integration.assert_true(
  has_function_privilege(
    'service_role',
    'public.faolla_start_merchant_enterprise_workflow_execution_v1(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_update_merchant_enterprise_workflow_execution_step_v1(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_submit_merchant_enterprise_workflow_feedback_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_start_merchant_enterprise_workflow_execution_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.faolla_start_merchant_enterprise_workflow_execution_v1(jsonb)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'service_role',
    'public.merchant_enterprise_workflow_executions',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.merchant_enterprise_workflow_execution_steps',
    'UPDATE'
  ),
  'workflow execution RPC or table ACL is broader than the service bridge'
);

set role service_role;

-- Tenant identity and the current role are re-authorized inside every RPC.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_acknowledge_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_revision_no', %s,
          'actor_type', 'employee',
          'actor_id', '50000000-0000-4000-8000-000000000005',
          'operation_id', 'integration-workflow-execution-cross-tenant-ack'
        )
      )
    $sql$,
    :'execution_workflow_id',
    :'execution_revision_no'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_acknowledge_merchant_enterprise_workflow_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_revision_no', %s,
          'actor_type', 'employee',
          'actor_id', '30000000-0000-4000-8000-000000000003',
          'operation_id', 'integration-workflow-execution-no-view-ack'
        )
      )
    $sql$,
    :'execution_workflow_id',
    :'execution_revision_no'
  ),
  'permission_denied'
);

-- Acknowledgement is pinned to the exact immutable publication and replaying
-- the same operation returns the original row without duplication.
select (
  public.faolla_acknowledge_merchant_enterprise_workflow_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'workflow_id', :'execution_workflow_id',
      'expected_revision_no', :'execution_revision_no'::integer,
      'actor_type', 'employee',
      'actor_id', :'execution_employee_id',
      'operation_id', 'integration-workflow-execution-ack'
    )
  ) -> 'acknowledgement' ->> 'id'
) as execution_acknowledgement_id
\gset

select enterprise_integration.assert_true(
  (
    public.faolla_acknowledge_merchant_enterprise_workflow_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'workflow_id', :'execution_workflow_id',
        'expected_revision_no', :'execution_revision_no'::integer,
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-ack'
      )
    ) -> 'acknowledgement' ->> 'id'
  ) = :'execution_acknowledgement_id',
  'workflow acknowledgement replay returned a different row'
);

-- Starting with checklist generation copies only the immutable revision step
-- titles. The outer operation and every generated checklist write are replay
-- safe, while a new generated execution for the same task is rejected.
select response -> 'execution' ->> 'id' as workflow_execution_id,
       response -> 'execution' ->> 'version' as workflow_execution_version,
       response -> 'execution' -> 'steps' -> 0 ->> 'stepId' as execution_step_one_id,
       response -> 'execution' -> 'steps' -> 1 ->> 'stepId' as execution_step_two_id
  from (
    select public.faolla_start_merchant_enterprise_workflow_execution_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'workflow_id', :'execution_workflow_id',
        'expected_revision_no', :'execution_revision_no'::integer,
        'subject', 'Damaged order integration execution',
        'task_id', :'execution_task_id',
        'generate_checklist', true,
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-start'
      )
    ) as response
  ) as started
\gset

select enterprise_integration.assert_true(
  (
    public.faolla_start_merchant_enterprise_workflow_execution_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'workflow_id', :'execution_workflow_id',
        'expected_revision_no', :'execution_revision_no'::integer,
        'subject', 'Damaged order integration execution',
        'task_id', :'execution_task_id',
        'generate_checklist', true,
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-start'
      )
    ) -> 'execution' ->> 'id'
  ) = :'workflow_execution_id',
  'workflow execution start replay duplicated the execution'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_start_merchant_enterprise_workflow_execution_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_revision_no', %s,
          'subject', 'Duplicate generated checklist',
          'task_id', %L,
          'generate_checklist', true,
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-workflow-execution-duplicate-task'
        )
      )
    $sql$,
    :'execution_workflow_id',
    :'execution_revision_no',
    :'execution_task_id',
    :'execution_employee_id'
  ),
  'workflow_task_execution_exists'
);
reset role;

select enterprise_integration.assert_true(
  (
    select count(*) = 1
    from public.merchant_enterprise_workflow_acknowledgements
    where merchant_id = '10000001'
      and workflow_id = :'execution_workflow_id'::uuid
      and revision_id = :'execution_revision_id'::uuid
      and employee_id = :'execution_employee_id'::uuid
  )
  and (
    select execution.workflow_snapshot = revision.snapshot
      and execution.revision_no = :'execution_revision_no'::integer
      and execution.total_steps = 2
      and execution.generated_checklist_count = 2
      and execution.status = 'in_progress'
    from public.merchant_enterprise_workflow_executions as execution
    join public.merchant_enterprise_workflow_revisions as revision
      on revision.merchant_id = execution.merchant_id
     and revision.workflow_id = execution.workflow_id
     and revision.id = execution.revision_id
    where execution.merchant_id = '10000001'
      and execution.id = :'workflow_execution_id'::uuid
  )
  and (
    select count(*) = 2
    from public.merchant_enterprise_workflow_execution_steps
    where merchant_id = '10000001'
      and execution_id = :'workflow_execution_id'::uuid
  )
  and (
    select count(*) = 2
    from public.merchant_enterprise_workflow_execution_checklist_items
    where merchant_id = '10000001'
      and execution_id = :'workflow_execution_id'::uuid
  )
  and (
    select count(*) = :'execution_task_checklist_before'::integer + 2
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'execution_task_id'::uuid
      and archived_at is null
  )
  and (
    select count(*) = 1
    from public.merchant_task_events
    where merchant_id = '10000001'
      and task_id = :'execution_task_id'::uuid
      and event_type = 'workflow_execution_started'
      and payload ->> 'executionId' = :'workflow_execution_id'
  )
  and (
    select count(*) = 2
    from public.merchant_task_events
    where merchant_id = '10000001'
      and task_id = :'execution_task_id'::uuid
      and operation_id like
        'workflow-execution-checklist:' || :'workflow_execution_id' || ':%'
  ),
  'execution start did not atomically pin revision steps and generated checklist items'
);

set role service_role;

-- Feedback is unavailable until all steps complete. Step updates use the
-- execution version as a CAS token and replay the completed response.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_submit_merchant_enterprise_workflow_feedback_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'execution_id', %L,
          'expected_version', %s,
          'rating', 4,
          'text', 'Too early',
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-workflow-execution-feedback-too-early'
        )
      )
    $sql$,
    :'workflow_execution_id',
    :'workflow_execution_version',
    :'execution_employee_id'
  ),
  'workflow_execution_incomplete'
);

select response -> 'execution' ->> 'version' as execution_after_step_one_version
  from (
    select public.faolla_update_merchant_enterprise_workflow_execution_step_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'step_id', :'execution_step_one_id',
        'expected_version', :'workflow_execution_version'::bigint,
        'completed', true,
        'note', 'Order and evidence verified',
        'evidence', jsonb_build_array(jsonb_build_object(
          'kind', 'link',
          'label', 'CRM case 42',
          'reference', 'https://example.test/cases/42',
          'mediaType', 'text/html',
          'sizeBytes', null
        )),
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-step-one'
      )
    ) as response
  ) as updated
\gset

select enterprise_integration.assert_true(
  (
    public.faolla_update_merchant_enterprise_workflow_execution_step_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'step_id', :'execution_step_one_id',
        'expected_version', :'workflow_execution_version'::bigint,
        'completed', true,
        'note', 'Order and evidence verified',
        'evidence', jsonb_build_array(jsonb_build_object(
          'kind', 'link',
          'label', 'CRM case 42',
          'reference', 'https://example.test/cases/42',
          'mediaType', 'text/html',
          'sizeBytes', null
        )),
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-step-one'
      )
    ) -> 'execution' ->> 'version'
  ) = :'execution_after_step_one_version',
  'step update replay did not return its original CAS result'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_workflow_execution_step_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'execution_id', %L,
          'step_id', %L,
          'expected_version', %s,
          'note', 'Stale update must not commit',
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-workflow-execution-step-stale'
        )
      )
    $sql$,
    :'workflow_execution_id',
    :'execution_step_one_id',
    :'workflow_execution_version',
    :'execution_employee_id'
  ),
  'enterprise_version_conflict'
);

select response -> 'execution' ->> 'version' as execution_completed_version
  from (
    select public.faolla_update_merchant_enterprise_workflow_execution_step_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'step_id', :'execution_step_two_id',
        'expected_version', :'execution_after_step_one_version'::bigint,
        'completed', true,
        'note', 'Replacement accepted',
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-step-two'
      )
    ) as response
  ) as updated
\gset

select response -> 'execution' ->> 'version' as execution_feedback_version
  from (
    select public.faolla_submit_merchant_enterprise_workflow_feedback_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'expected_version', :'execution_completed_version'::bigint,
        'rating', 4,
        'text', 'Add a photograph example to the first step.',
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-feedback'
      )
    ) as response
  ) as submitted
\gset

select enterprise_integration.assert_true(
  (
    public.faolla_submit_merchant_enterprise_workflow_feedback_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'expected_version', :'execution_completed_version'::bigint,
        'rating', 4,
        'text', 'Add a photograph example to the first step.',
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id',
        'operation_id', 'integration-workflow-execution-feedback'
      )
    ) -> 'execution' ->> 'version'
  ) = :'execution_feedback_version',
  'workflow feedback replay did not return the original submission'
);

-- Publishing a later revision must not hide unresolved feedback from the
-- manager queue. Current-version execution, completion, feedback, and rating
-- totals stay scoped to the new publication. Roll back this publication so the
-- following revision-history fixture still starts from its expected revision.
begin;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'execution_workflow_id',
    'expected_version', :'execution_workflow_version'::bigint,
    'action', 'publish',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-workflow-execution-publish-next-revision'
  )
);

select enterprise_integration.assert_true(
  stats ->> 'merchantId' = '10000001'
  and (stats ->> 'currentRevisionNo')::integer = :'execution_revision_no'::integer + 1
  and (stats ->> 'acknowledgedEmployeeCount')::integer = 0
  and (stats ->> 'executionCount')::integer = 0
  and (stats ->> 'inProgressCount')::integer = 0
  and (stats ->> 'completedCount')::integer = 0
  and (stats ->> 'taskLinkedExecutionCount')::integer = 0
  and (stats ->> 'generatedChecklistCount')::integer = 0
  and (stats ->> 'feedbackCount')::integer = 0
  and (stats ->> 'openFeedbackCount')::integer = 1
  and stats -> 'averageRating' = 'null'::jsonb
  and jsonb_array_length(stats -> 'recentFeedback') = 1
  and stats -> 'recentFeedback' -> 0 ->> 'executionId' = :'workflow_execution_id'
  and (stats -> 'recentFeedback' -> 0 ->> 'revisionNo')::integer = :'execution_revision_no'::integer
  and stats -> 'recentFeedback' -> 0 ->> 'status' = 'open',
  'publishing a new revision hid unresolved feedback or mixed old execution totals into the current revision'
)
from (
  select public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'workflow_id', :'execution_workflow_id',
      'actor_type', 'employee',
      'actor_id', :'execution_manager_id'
    )
  ) -> 'stats' as stats
) as cross_revision_report;
rollback;

select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_resolve_merchant_enterprise_workflow_feedback_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'execution_id', %L,
          'expected_version', %s,
          'resolution_note', 'Self-resolution must be denied',
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-workflow-execution-feedback-self-resolve'
        )
      )
    $sql$,
    :'workflow_execution_id',
    :'execution_feedback_version',
    :'execution_employee_id'
  ),
  'permission_denied'
);

select response -> 'resolution' ->> 'version' as execution_resolved_version
  from (
    select public.faolla_resolve_merchant_enterprise_workflow_feedback_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'expected_version', :'execution_feedback_version'::bigint,
        'resolution_note', 'The next revision will include an evidence example.',
        'actor_type', 'employee',
        'actor_id', :'execution_manager_id',
        'operation_id', 'integration-workflow-execution-feedback-resolve'
      )
    ) as response
  ) as resolved
\gset

-- View-only employees cannot read aggregate employee activity. The manager
-- sees current-revision coverage, progress, feedback, and the CAS version used
-- for a future feedback action.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'actor_type', 'employee',
          'actor_id', %L
        )
      )
    $sql$,
    :'execution_workflow_id',
    :'execution_employee_id'
  ),
  'permission_denied'
);

select enterprise_integration.assert_true(
  stats ->> 'merchantId' = '10000001'
  and (stats ->> 'currentRevisionNo')::integer = :'execution_revision_no'::integer
  and (stats ->> 'acknowledgedEmployeeCount')::integer = 1
  and (stats ->> 'executionCount')::integer = 1
  and (stats ->> 'inProgressCount')::integer = 0
  and (stats ->> 'completedCount')::integer = 1
  and (stats ->> 'taskLinkedExecutionCount')::integer = 1
  and (stats ->> 'generatedChecklistCount')::integer = 2
  and (stats ->> 'feedbackCount')::integer = 1
  and (stats ->> 'openFeedbackCount')::integer = 0
  and (stats ->> 'averageRating')::numeric = 4
  and exists (
    select 1
    from jsonb_array_elements(stats -> 'participants') as participant(item)
    where participant.item ->> 'employeeId' = :'execution_employee_id'
      and (participant.item ->> 'executionCount')::integer = 1
      and (participant.item ->> 'completedCount')::integer = 1
      and participant.item ->> 'acknowledgedAt' is not null
  )
  and exists (
    select 1
    from jsonb_array_elements(stats -> 'recentFeedback') as feedback(item)
    where feedback.item ->> 'executionId' = :'workflow_execution_id'
      and (feedback.item ->> 'executionVersion')::bigint = :'execution_resolved_version'::bigint
      and feedback.item ->> 'status' = 'resolved'
      and feedback.item ->> 'resolverId' = :'execution_manager_id'
  ),
  'manager workflow execution statistics omitted coverage, progress, or feedback'
)
from (
  select public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'workflow_id', :'execution_workflow_id',
      'actor_type', 'employee',
      'actor_id', :'execution_manager_id'
    )
  ) -> 'stats' as stats
) as report;

select enterprise_integration.assert_true(
  state -> 'acknowledgement' ->> 'id' = :'execution_acknowledgement_id'
  and (state ->> 'currentRevisionNo')::integer = :'execution_revision_no'::integer
  and exists (
    select 1
    from jsonb_array_elements(state -> 'executions') as execution(item)
    where execution.item ->> 'id' = :'workflow_execution_id'
      and execution.item ->> 'status' = 'completed'
      and execution.item ->> 'feedbackStatus' = 'resolved'
  ),
  'employee workflow state omitted acknowledgement or completed execution'
)
from (
  select public.faolla_get_merchant_enterprise_workflow_employee_state_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'workflow_id', :'execution_workflow_id',
      'actor_type', 'employee',
      'actor_id', :'execution_employee_id'
    )
  ) as state
) as current_state;

select enterprise_integration.assert_true(
  (
    public.faolla_get_merchant_enterprise_workflow_execution_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'execution_id', :'workflow_execution_id',
        'actor_type', 'employee',
        'actor_id', :'execution_employee_id'
      )
    ) -> 'execution' ->> 'version'
  ) = :'execution_resolved_version',
  'employee exact execution read returned stale or foreign data'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_get_merchant_enterprise_workflow_execution_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'execution_id', %L,
          'actor_type', 'employee',
          'actor_id', '50000000-0000-4000-8000-000000000005'
        )
      )
    $sql$,
    :'workflow_execution_id'
  ),
  'permission_denied'
);
reset role;

select enterprise_integration.assert_true(
  (
    select status = 'completed'
      and completed_steps = total_steps
      and completed_at is not null
      and feedback_status = 'resolved'
      and feedback_rating = 4
      and feedback_resolver_type = 'employee'
      and feedback_resolver_id = :'execution_manager_id'::uuid
      and version = :'execution_resolved_version'::bigint
    from public.merchant_enterprise_workflow_executions
    where merchant_id = '10000001'
      and id = :'workflow_execution_id'::uuid
  )
  and (
    select completed_at is not null
      and note = 'Order and evidence verified'
      and evidence -> 0 ->> 'reference' = 'https://example.test/cases/42'
    from public.merchant_enterprise_workflow_execution_steps
    where merchant_id = '10000001'
      and execution_id = :'workflow_execution_id'::uuid
      and step_id = :'execution_step_one_id'::uuid
  )
  and not exists (
    select 1
    from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key in (
        'enterprise-workflow-feedback-v1:integration-workflow-execution-feedback-too-early',
        'enterprise-workflow-execution-step-v1:integration-workflow-execution-step-stale',
        'enterprise-workflow-feedback-resolve-v1:integration-workflow-execution-feedback-self-resolve'
      )
  ),
  'workflow execution CAS, evidence, feedback, or rollback state is inconsistent'
);

-- A task already at 99 active checklist rows cannot receive a two-step
-- generated workflow. The failed start rolls back the execution, mappings,
-- task event, and idempotency claim.
select board.id::text as execution_limit_board_id,
       todo.id::text as execution_limit_column_id
  from public.merchant_task_boards as board
  join public.merchant_task_columns as todo
    on todo.merchant_id = board.merchant_id
   and todo.board_id = board.id
   and todo.system_key = 'todo'
 where board.merchant_id = '10000001'
   and board.system_key = 'default'
\gset

set role service_role;
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'execution_limit_board_id',
    'column_id', :'execution_limit_column_id',
    'title', 'Workflow checklist limit fixture',
    'description', 'Must remain at 99 items after a rejected generated execution',
    'priority', 'normal',
    'due_at', null,
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', jsonb_build_array(:'execution_employee_id'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-workflow-execution-limit-task',
    'event_payload', jsonb_build_object('source', 'workflow-execution-integration')
  )
);
reset role;

select task_id::text as execution_limit_task_id
  from public.merchant_task_events
 where merchant_id = '10000001'
   and operation_id = 'integration-workflow-execution-limit-task'
\gset

insert into public.merchant_task_checklist_items (
  merchant_id, task_id, text, position
)
select
  '10000001',
  :'execution_limit_task_id'::uuid,
  'Workflow limit fixture ' || fixture.number::text,
  fixture.number::bigint * 1024
from generate_series(1, 99) as fixture(number);

set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_start_merchant_enterprise_workflow_execution_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'expected_revision_no', %s,
          'subject', 'Checklist capacity rejection',
          'task_id', %L,
          'generate_checklist', true,
          'actor_type', 'employee',
          'actor_id', %L,
          'operation_id', 'integration-workflow-execution-limit-start'
        )
      )
    $sql$,
    :'execution_workflow_id',
    :'execution_revision_no',
    :'execution_limit_task_id',
    :'execution_employee_id'
  ),
  'task_checklist_limit_reached'
);
reset role;

select enterprise_integration.assert_true(
  (
    select count(*) = 99
    from public.merchant_task_checklist_items
    where merchant_id = '10000001'
      and task_id = :'execution_limit_task_id'::uuid
      and archived_at is null
  )
  and not exists (
    select 1
    from public.merchant_enterprise_workflow_executions
    where merchant_id = '10000001'
      and task_id = :'execution_limit_task_id'::uuid
  )
  and not exists (
    select 1
    from public.merchant_enterprise_workflow_execution_checklist_items
    where merchant_id = '10000001'
      and task_id = :'execution_limit_task_id'::uuid
  )
  and not exists (
    select 1
    from public.merchant_task_events
    where merchant_id = '10000001'
      and task_id = :'execution_limit_task_id'::uuid
      and event_type = 'workflow_execution_started'
  )
  and not exists (
    select 1
    from public.merchant_idempotency_keys
    where merchant_id = '10000001'
      and idempotency_key =
        'enterprise-workflow-execution-start-v1:integration-workflow-execution-limit-start'
  ),
  'checklist capacity rejection left partial workflow execution state'
);

\echo 'Workflow acknowledgement, execution, checklist, feedback, and statistics fixtures passed.'
