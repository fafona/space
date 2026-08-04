\set ON_ERROR_STOP on
\pset pager off

-- Workflow automation acceptance is isolated and rolled back. The fixture
-- proves reliable enqueueing, rule isolation/retry, opaque public references,
-- board-snapshot authorization, permission boundaries and the active-rule cap.
begin;

insert into public.merchants (id, name, email, owner_user_id)
values
  (
    '10000004',
    'Integration Automation Merchant',
    'automation-owner@example.test',
    '84000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '10000005',
    'Automation Cross Tenant',
    'automation-other@example.test',
    '84000000-0000-4000-8000-000000000002'::uuid
  );

set role service_role;
select public.faolla_bootstrap_merchant_enterprise_v2(
  '{
    "merchant_id":"10000004",
    "actor_type":"owner",
    "actor_id":"84000000-0000-4000-8000-000000000001",
    "operation_id":"integration-automation-bootstrap"
  }'::jsonb
);
reset role;

insert into public.merchant_enterprise_roles (
  id, merchant_id, name, description, permissions, access_scope, status,
  is_system
)
values
  (
    '84100000-0000-4000-8000-000000000001'::uuid,
    '10000004',
    'Restricted automation viewer',
    'May see automation runs only on the mapped board',
    array[
      'enterprise.view', 'tasks.view', 'workflows.view', 'automations.view'
    ]::text[],
    'restricted',
    'active',
    false
  ),
  (
    '84100000-0000-4000-8000-000000000002'::uuid,
    '10000004',
    'No automation access',
    'Used to prove permission denial',
    array['enterprise.view']::text[],
    'all',
    'active',
    false
  );

insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id, status,
  invited_at, accepted_at, last_active_at
)
values
  (
    '84200000-0000-4000-8000-000000000001'::uuid,
    '10000004',
    '84200000-0000-4000-8000-000000000101'::uuid,
    'automation-worker@example.test',
    'Automation Worker',
    '84100000-0000-4000-8000-000000000001'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  ),
  (
    '84200000-0000-4000-8000-000000000002'::uuid,
    '10000004',
    '84200000-0000-4000-8000-000000000102'::uuid,
    'automation-low@example.test',
    'Low Permission Employee',
    '84100000-0000-4000-8000-000000000002'::uuid,
    'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
  );

insert into public.merchant_task_boards (
  id, merchant_id, name, description, position, status
)
values
  (
    '84300000-0000-4000-8000-000000000001'::uuid,
    '10000004', 'Automation visible board', '', 1, 'active'
  ),
  (
    '84300000-0000-4000-8000-000000000002'::uuid,
    '10000004', 'Automation unavailable board', '', 2, 'active'
  );

insert into public.merchant_task_columns (
  id, merchant_id, board_id, name, color, position, is_done, status
)
values
  (
    '84400000-0000-4000-8000-000000000001'::uuid,
    '10000004',
    '84300000-0000-4000-8000-000000000001'::uuid,
    'Automation queue', '#2563eb', 0, false, 'active'
  ),
  (
    '84400000-0000-4000-8000-000000000002'::uuid,
    '10000004',
    '84300000-0000-4000-8000-000000000002'::uuid,
    'Unavailable queue', '#dc2626', 0, false, 'active'
  );

insert into public.merchant_enterprise_role_boards (
  merchant_id, role_id, board_id
)
values (
  '10000004',
  '84100000-0000-4000-8000-000000000001'::uuid,
  '84300000-0000-4000-8000-000000000001'::uuid
);

insert into public.merchant_enterprise_workflows (
  id, merchant_id, title, scenario, description, category, tags, status,
  position, current_revision_id, published_version, has_unpublished_changes
)
values (
  '84500000-0000-4000-8000-000000000001'::uuid,
  '10000004',
  'Order escalation playbook',
  'A new order needs a controlled handoff',
  '',
  'Operations',
  array['automation']::text[],
  'draft',
  0,
  null,
  0,
  false
);

insert into public.merchant_enterprise_workflow_revisions (
  id, merchant_id, workflow_id, revision_no, snapshot
)
values (
  '84600000-0000-4000-8000-000000000001'::uuid,
  '10000004',
  '84500000-0000-4000-8000-000000000001'::uuid,
  1,
  '{
    "title":"Order escalation playbook",
    "steps":[
      {
        "id":"84600000-0000-4000-8000-000000000101",
        "title":"Verify the order",
        "instruction":"Confirm the source event is valid.",
        "position":0
      },
      {
        "id":"84600000-0000-4000-8000-000000000102",
        "title":"Notify operations",
        "instruction":"Complete the internal handoff.",
        "position":1
      }
    ]
  }'::jsonb
);

update public.merchant_enterprise_workflows
   set status = 'published',
       current_revision_id = '84600000-0000-4000-8000-000000000001'::uuid,
       published_version = 1
 where merchant_id = '10000004'
   and id = '84500000-0000-4000-8000-000000000001'::uuid;

insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
values
  (
    '84700000-0000-4000-8000-000000000001'::uuid,
    '10000004', 'Good order automation', 'order', 'created', null, null,
    '84300000-0000-4000-8000-000000000001'::uuid,
    '84400000-0000-4000-8000-000000000001'::uuid,
    '84500000-0000-4000-8000-000000000001'::uuid,
    '84600000-0000-4000-8000-000000000001'::uuid,
    'Handle {eventRef}',
    'Transition {fromStatus} -> {toStatus}',
    'high', 30, 'active', statement_timestamp() - interval '1 minute'
  ),
  (
    '84700000-0000-4000-8000-000000000002'::uuid,
    '10000004', 'Temporarily bad order automation', 'order', 'created', null, null,
    '84300000-0000-4000-8000-000000000002'::uuid,
    '84400000-0000-4000-8000-000000000002'::uuid,
    '84500000-0000-4000-8000-000000000001'::uuid,
    '84600000-0000-4000-8000-000000000001'::uuid,
    'Recover {eventRef}', '', 'normal', null, 'active',
    statement_timestamp() - interval '1 minute'
  );

insert into public.merchant_enterprise_automation_rule_assignees (
  merchant_id, rule_id, employee_id
)
values
  (
    '10000004',
    '84700000-0000-4000-8000-000000000001'::uuid,
    '84200000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '10000004',
    '84700000-0000-4000-8000-000000000002'::uuid,
    '84200000-0000-4000-8000-000000000001'::uuid
  );

-- Created events have no transition status on either side. Both the table and
-- the service mutation validate the same shape.
do $$
begin
  begin
    insert into public.merchant_enterprise_automation_rules (
      id, merchant_id, name, source_type, event_type, from_status, to_status,
      board_id, column_id, workflow_id, workflow_revision_id, task_title,
      task_description, priority, status
    ) values (
      '84700000-0000-4000-8000-000000000099'::uuid,
      '10000004', 'Invalid created transition', 'order', 'created', null,
      'pending',
      '84300000-0000-4000-8000-000000000001'::uuid,
      '84400000-0000-4000-8000-000000000001'::uuid,
      '84500000-0000-4000-8000-000000000001'::uuid,
      '84600000-0000-4000-8000-000000000001'::uuid,
      'Invalid {eventRef}', '', 'normal', 'paused'
    );
    raise exception 'created rule with to_status passed table validation';
  exception when check_violation then
    null;
  end;
  begin
    perform public.faolla_create_merchant_enterprise_automation_rule_v1(
      '{
        "merchant_id":"10000004",
        "actor_type":"owner",
        "actor_id":"84000000-0000-4000-8000-000000000001",
        "name":"Invalid created transition",
        "source_type":"order",
        "event_type":"created",
        "from_status":null,
        "to_status":"pending",
        "board_id":"84300000-0000-4000-8000-000000000001",
        "column_id":"84400000-0000-4000-8000-000000000001",
        "workflow_id":"84500000-0000-4000-8000-000000000001",
        "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
        "task_title":"Invalid {eventRef}",
        "task_description":"",
        "priority":"normal",
        "due_offset_minutes":null,
        "status":"paused",
        "assignee_ids":[],
        "operation_id":"integration-automation-invalid-created-status"
      }'::jsonb
    );
    raise exception 'created rule with to_status passed mutation validation';
  exception when others then
    if sqlerrm not like '%invalid_automation_rule%' then raise; end if;
  end;
end;
$$;

-- The second rule remains valid relationally but cannot execute while its
-- target board is archived. The processor must isolate that failure.
update public.merchant_task_boards
   set status = 'archived'
 where merchant_id = '10000004'
   and id = '84300000-0000-4000-8000-000000000002'::uuid;

insert into public.merchant_orders (merchant_id, id, status)
values ('10000004', 'RAW-ORDER-PII-MARKER', 'pending');

insert into public.merchant_order_events (
  id, merchant_id, order_id, event_type, from_status, to_status,
  idempotency_key, payload, created_at
)
values (
  '84800000-0000-4000-8000-000000000001'::uuid,
  '10000004',
  'RAW-ORDER-PII-MARKER',
  'created',
  null,
  null,
  'integration-automation-order-created',
  '{"privateMarker":"RAW-ORDER-PII-MARKER"}'::jsonb,
  statement_timestamp()
);

do $$
begin
  if (select count(*) from public.merchant_outbox_events
       where merchant_id = '10000004'
         and event_key = 'enterprise-automation:order:84800000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'automation source event did not enqueue exactly once';
  end if;
  if exists (
    select 1 from public.merchant_tasks
     where merchant_id = '10000004' and source_type = 'automation'
  ) then
    raise exception 'source trigger executed tasks synchronously';
  end if;
end;
$$;

set role service_role;
select public.faolla_process_merchant_enterprise_automation_event_v1(
  '{
    "merchant_id":"10000004",
    "source_type":"order",
    "event_id":"84800000-0000-4000-8000-000000000001"
  }'::jsonb
);
reset role;

do $$
declare
  v_task_id uuid;
begin
  if (select count(*) from public.merchant_enterprise_automation_runs
       where merchant_id = '10000004' and status = 'completed') <> 1
     or (select count(*) from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004' and status = 'failed') <> 1 then
    raise exception 'good and bad automation rules were not isolated';
  end if;
  if (select status from public.merchant_enterprise_automation_rules
       where merchant_id = '10000004'
         and id = '84700000-0000-4000-8000-000000000002'::uuid) <> 'paused'
     or (select error_code from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000002'::uuid)
        <> 'automation_target_unavailable'
     or not exists (
       select 1 from public.merchant_enterprise_audit_events
        where merchant_id = '10000004'
          and entity_id = '84700000-0000-4000-8000-000000000002'::uuid
          and event_type = 'automation.paused'
          and after_data ->> 'reason_code' = 'execution_configuration_invalid'
     ) then
    raise exception 'persistent target failure was not terminally paused and audited';
  end if;
  select task_id into v_task_id
    from public.merchant_enterprise_automation_runs
   where merchant_id = '10000004'
     and rule_id = '84700000-0000-4000-8000-000000000001'::uuid;
  if v_task_id is null
     or (select count(*) from public.merchant_task_workflow_bindings
          where merchant_id = '10000004' and task_id = v_task_id) <> 1
     or (select count(*) from public.merchant_task_checklist_items
          where merchant_id = '10000004' and task_id = v_task_id) <> 2
     or (select count(*) from public.merchant_enterprise_notifications
          where merchant_id = '10000004' and task_id = v_task_id
            and notification_type = 'task_assigned') <> 1 then
    raise exception 'automation task, binding, checklist or notification missing';
  end if;
end;
$$;

-- Repair and explicitly resume through the CAS API. Resuming advances
-- enabled_at, so reprocessing the old event must not execute the new config.
set role service_role;
select public.faolla_update_merchant_enterprise_automation_rule_v1(
  '{
    "merchant_id":"10000004",
    "actor_type":"owner",
    "actor_id":"84000000-0000-4000-8000-000000000001",
    "rule_id":"84700000-0000-4000-8000-000000000002",
    "expected_version":2,
    "name":"Repaired order automation",
    "source_type":"order",
    "event_type":"created",
    "from_status":null,
    "to_status":null,
    "board_id":"84300000-0000-4000-8000-000000000001",
    "column_id":"84400000-0000-4000-8000-000000000001",
    "workflow_id":"84500000-0000-4000-8000-000000000001",
    "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
    "task_title":"Recover {eventRef}",
    "task_description":"",
    "priority":"normal",
    "due_offset_minutes":null,
    "status":"active",
    "assignee_ids":["84200000-0000-4000-8000-000000000001"],
    "operation_id":"integration-automation-repair-resume"
  }'::jsonb
);
reset role;

set role service_role;
select public.faolla_process_merchant_enterprise_automation_event_v1(
  '{
    "merchant_id":"10000004",
    "source_type":"order",
    "event_id":"84800000-0000-4000-8000-000000000001"
  }'::jsonb
);
reset role;

do $$
begin
  if (select count(*) from public.merchant_enterprise_automation_runs
       where merchant_id = '10000004' and status = 'completed') <> 1
     or (select count(*) from public.merchant_tasks
          where merchant_id = '10000004' and source_type = 'automation') <> 1
     or (select attempt_count from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000002'::uuid) <> 1
     or (select attempt_count from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000001'::uuid) <> 1
     or (select enabled_at from public.merchant_enterprise_automation_rules
          where merchant_id = '10000004'
            and id = '84700000-0000-4000-8000-000000000002'::uuid)
        <= (select created_at from public.merchant_order_events
             where merchant_id = '10000004'
               and id = '84800000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'terminal repair boundary or idempotency contract failed';
  end if;
end;
$$;

-- A new event created after the repair boundary executes both active rules.
-- The first terminal run remains immutable at attempt one.
insert into public.merchant_order_events (
  id, merchant_id, order_id, event_type, from_status, to_status,
  idempotency_key, payload, created_at
)
values (
  '84800000-0000-4000-8000-000000000002'::uuid,
  '10000004',
  'RAW-ORDER-PII-MARKER',
  'created',
  null,
  null,
  'integration-automation-order-created-after-repair',
  '{}'::jsonb,
  statement_timestamp()
);

set role service_role;
select public.faolla_process_merchant_enterprise_automation_event_v1(
  '{
    "merchant_id":"10000004",
    "source_type":"order",
    "event_id":"84800000-0000-4000-8000-000000000002"
  }'::jsonb
);
reset role;

do $$
begin
  if (select count(*) from public.merchant_enterprise_automation_runs
       where merchant_id = '10000004' and status = 'completed') <> 3
     or (select count(*) from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004' and status = 'failed') <> 1
     or (select count(*) from public.merchant_tasks
          where merchant_id = '10000004' and source_type = 'automation') <> 3
     or (select attempt_count from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000002'::uuid
            and source_event_key = 'order:84800000-0000-4000-8000-000000000001') <> 1
     or (select attempt_count from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000001'::uuid
            and source_event_key = 'order:84800000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'post-repair event or immutable terminal run contract failed';
  end if;
end;
$$;

-- A rule may later move to another board; historical run authorization must
-- remain anchored to the run's immutable board snapshot.
update public.merchant_enterprise_automation_rules
   set board_id = '84300000-0000-4000-8000-000000000002'::uuid,
       column_id = '84400000-0000-4000-8000-000000000002'::uuid
 where merchant_id = '10000004'
   and id = '84700000-0000-4000-8000-000000000001'::uuid;

do $$
declare
  v_page jsonb;
begin
  v_page := public.faolla_list_merchant_enterprise_automation_rules_v1(
    '{
      "merchant_id":"10000004",
      "actor_type":"employee",
      "actor_id":"84200000-0000-4000-8000-000000000001"
    }'::jsonb
  );
  if jsonb_array_length(v_page -> 'rules') <> 1
     or jsonb_array_length(v_page -> 'runs') <> 3
     or (v_page -> 'runs' -> 0) ? 'source_event_key' then
    raise exception 'automation board snapshot or public run projection failed';
  end if;
end;
$$;

-- An outbox event queued before an active rule's execution configuration
-- changes must never run under the newer config. A subsequent exact no-op save
-- preserves the first update's enabled_at boundary.
insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
values (
  '84700000-0000-4000-8000-000000000003'::uuid,
  '10000004', 'Status boundary automation', 'order', 'status_changed',
  'pending', 'confirmed',
  '84300000-0000-4000-8000-000000000001'::uuid,
  '84400000-0000-4000-8000-000000000001'::uuid,
  '84500000-0000-4000-8000-000000000001'::uuid,
  '84600000-0000-4000-8000-000000000001'::uuid,
  'Old boundary {eventRef}', '', 'normal', null, 'active',
  statement_timestamp() - interval '1 minute'
);
insert into public.merchant_enterprise_automation_rule_assignees (
  merchant_id, rule_id, employee_id
)
values (
  '10000004',
  '84700000-0000-4000-8000-000000000003'::uuid,
  '84200000-0000-4000-8000-000000000001'::uuid
);
insert into public.merchant_order_events (
  id, merchant_id, order_id, event_type, from_status, to_status,
  idempotency_key, payload, created_at
)
values (
  '84800000-0000-4000-8000-000000000090'::uuid,
  '10000004', 'RAW-ORDER-PII-MARKER', 'status_changed', 'pending', 'confirmed',
  'integration-automation-boundary-old', '{}'::jsonb, statement_timestamp()
);

set role service_role;
do $$
declare
  v_first_enabled_at timestamptz;
  v_rule_response jsonb;
begin
  v_rule_response := public.faolla_update_merchant_enterprise_automation_rule_v1(
    '{
      "merchant_id":"10000004",
      "actor_type":"owner",
      "actor_id":"84000000-0000-4000-8000-000000000001",
      "rule_id":"84700000-0000-4000-8000-000000000003",
      "expected_version":1,
      "name":"Status boundary automation",
      "source_type":"order",
      "event_type":"status_changed",
      "from_status":"pending",
      "to_status":"confirmed",
      "board_id":"84300000-0000-4000-8000-000000000001",
      "column_id":"84400000-0000-4000-8000-000000000001",
      "workflow_id":"84500000-0000-4000-8000-000000000001",
      "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
      "task_title":"New boundary {eventRef}",
      "task_description":"",
      "priority":"normal",
      "due_offset_minutes":null,
      "status":"active",
      "assignee_ids":[],
      "operation_id":"integration-automation-boundary-update"
    }'::jsonb
  );
  v_first_enabled_at := (v_rule_response #>> '{rule,enabled_at}')::timestamptz;
  v_rule_response := public.faolla_update_merchant_enterprise_automation_rule_v1(
    '{
      "merchant_id":"10000004",
      "actor_type":"owner",
      "actor_id":"84000000-0000-4000-8000-000000000001",
      "rule_id":"84700000-0000-4000-8000-000000000003",
      "expected_version":2,
      "name":"Status boundary automation",
      "source_type":"order",
      "event_type":"status_changed",
      "from_status":"pending",
      "to_status":"confirmed",
      "board_id":"84300000-0000-4000-8000-000000000001",
      "column_id":"84400000-0000-4000-8000-000000000001",
      "workflow_id":"84500000-0000-4000-8000-000000000001",
      "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
      "task_title":"New boundary {eventRef}",
      "task_description":"",
      "priority":"normal",
      "due_offset_minutes":null,
      "status":"active",
      "assignee_ids":[],
      "operation_id":"integration-automation-boundary-noop"
    }'::jsonb
  );
  if (v_rule_response #>> '{rule,enabled_at}')::timestamptz
       is distinct from v_first_enabled_at then
    raise exception 'exact no-op automation save changed enabled_at';
  end if;
end;
$$;
select public.faolla_process_merchant_enterprise_automation_event_v1(
  '{
    "merchant_id":"10000004",
    "source_type":"order",
    "event_id":"84800000-0000-4000-8000-000000000090"
  }'::jsonb
);
reset role;

do $$
begin
  if exists (
    select 1 from public.merchant_enterprise_automation_runs
     where merchant_id = '10000004'
       and rule_id = '84700000-0000-4000-8000-000000000003'::uuid
       and source_event_key = 'order:84800000-0000-4000-8000-000000000090'
  ) or (select enabled_at from public.merchant_enterprise_automation_rules
         where merchant_id = '10000004'
           and id = '84700000-0000-4000-8000-000000000003'::uuid)
       <= (select created_at from public.merchant_order_events
            where merchant_id = '10000004'
              and id = '84800000-0000-4000-8000-000000000090'::uuid) then
    raise exception 'pre-update event crossed the active configuration boundary';
  end if;
end;
$$;

insert into public.merchant_order_events (
  id, merchant_id, order_id, event_type, from_status, to_status,
  idempotency_key, payload, created_at
)
values (
  '84800000-0000-4000-8000-000000000091'::uuid,
  '10000004', 'RAW-ORDER-PII-MARKER', 'status_changed', 'pending', 'confirmed',
  'integration-automation-boundary-new', '{}'::jsonb, statement_timestamp()
);
set role service_role;
select public.faolla_process_merchant_enterprise_automation_event_v1(
  '{
    "merchant_id":"10000004",
    "source_type":"order",
    "event_id":"84800000-0000-4000-8000-000000000091"
  }'::jsonb
);
reset role;
do $$
begin
  if not exists (
    select 1
      from public.merchant_enterprise_automation_runs as run
      join public.merchant_tasks as task
        on task.merchant_id = run.merchant_id and task.id = run.task_id
     where run.merchant_id = '10000004'
       and run.rule_id = '84700000-0000-4000-8000-000000000003'::uuid
       and run.source_event_key = 'order:84800000-0000-4000-8000-000000000091'
       and run.status = 'completed'
       and run.rule_version = 3
       and task.title like 'New boundary order-%'
  ) then
    raise exception 'post-update event did not execute the current rule version';
  end if;
end;
$$;

-- Workflow archival is a persistent execution failure: the run is terminal,
-- the rule pauses in the same transaction, and the pause reason is audited.
insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
values (
  '84700000-0000-4000-8000-000000000004'::uuid,
  '10000004', 'Workflow lifecycle terminal', 'booking', 'created', null, null,
  '84300000-0000-4000-8000-000000000001'::uuid,
  '84400000-0000-4000-8000-000000000001'::uuid,
  '84500000-0000-4000-8000-000000000001'::uuid,
  '84600000-0000-4000-8000-000000000001'::uuid,
  'Workflow terminal {eventRef}', '', 'normal', null, 'active',
  statement_timestamp() - interval '1 minute'
);
update public.merchant_enterprise_workflows
   set status = 'archived'
 where merchant_id = '10000004'
   and id = '84500000-0000-4000-8000-000000000001'::uuid;
do $$
declare
  v_result jsonb;
begin
  v_result := public.faolla_apply_merchant_enterprise_automation_rule_v1(
    '84700000-0000-4000-8000-000000000004'::uuid,
    'booking',
    'booking:lifecycle-workflow',
    'booking-84800000-0000-4000-8000-000000000094',
    'created',
    null,
    null,
    statement_timestamp()
  );
  if v_result ->> 'status' <> 'failed'
     or v_result ->> 'errorCode' <> 'automation_workflow_unavailable'
     or coalesce((v_result ->> 'retryable')::boolean, true)
     or (select status from public.merchant_enterprise_automation_rules
          where merchant_id = '10000004'
            and id = '84700000-0000-4000-8000-000000000004'::uuid) <> 'paused'
     or not exists (
       select 1 from public.merchant_enterprise_audit_events
        where merchant_id = '10000004'
          and entity_id = '84700000-0000-4000-8000-000000000004'::uuid
          and event_type = 'automation.paused'
          and after_data ->> 'reason_code' = 'execution_configuration_invalid'
     ) then
    raise exception 'workflow lifecycle terminal policy failed';
  end if;
end;
$$;
update public.merchant_enterprise_workflows
   set status = 'published'
 where merchant_id = '10000004'
   and id = '84500000-0000-4000-8000-000000000001'::uuid;

-- A restricted assignee losing its board mapping follows the same terminal
-- policy. This exercises the role-board branch independently of employee state.
insert into public.merchant_enterprise_roles (
  id, merchant_id, name, description, permissions, access_scope, status,
  is_system
)
values (
  '84100000-0000-4000-8000-000000000003'::uuid,
  '10000004', 'Lifecycle restricted worker', '',
  array['enterprise.view', 'tasks.view']::text[],
  'restricted', 'active', false
);
insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id, status,
  invited_at, accepted_at, last_active_at
)
values (
  '84200000-0000-4000-8000-000000000003'::uuid,
  '10000004',
  '84200000-0000-4000-8000-000000000103'::uuid,
  'automation-lifecycle@example.test', 'Lifecycle Worker',
  '84100000-0000-4000-8000-000000000003'::uuid,
  'active', statement_timestamp(), statement_timestamp(), statement_timestamp()
);
insert into public.merchant_enterprise_role_boards (
  merchant_id, role_id, board_id
)
values (
  '10000004',
  '84100000-0000-4000-8000-000000000003'::uuid,
  '84300000-0000-4000-8000-000000000001'::uuid
);
insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
values (
  '84700000-0000-4000-8000-000000000005'::uuid,
  '10000004', 'Role scope lifecycle terminal', 'booking', 'created', null, null,
  '84300000-0000-4000-8000-000000000001'::uuid,
  '84400000-0000-4000-8000-000000000001'::uuid,
  '84500000-0000-4000-8000-000000000001'::uuid,
  '84600000-0000-4000-8000-000000000001'::uuid,
  'Scope terminal {eventRef}', '', 'normal', null, 'active',
  statement_timestamp() - interval '1 minute'
);
insert into public.merchant_enterprise_automation_rule_assignees (
  merchant_id, rule_id, employee_id
)
values (
  '10000004',
  '84700000-0000-4000-8000-000000000005'::uuid,
  '84200000-0000-4000-8000-000000000003'::uuid
);
delete from public.merchant_enterprise_role_boards
 where merchant_id = '10000004'
   and role_id = '84100000-0000-4000-8000-000000000003'::uuid
   and board_id = '84300000-0000-4000-8000-000000000001'::uuid;
do $$
declare
  v_result jsonb;
begin
  v_result := public.faolla_apply_merchant_enterprise_automation_rule_v1(
    '84700000-0000-4000-8000-000000000005'::uuid,
    'booking',
    'booking:lifecycle-role-scope',
    'booking-84800000-0000-4000-8000-000000000095',
    'created',
    null,
    null,
    statement_timestamp()
  );
  if v_result ->> 'status' <> 'failed'
     or v_result ->> 'errorCode' <> 'automation_assignee_unavailable'
     or coalesce((v_result ->> 'retryable')::boolean, true)
     or (select status from public.merchant_enterprise_automation_rules
          where merchant_id = '10000004'
            and id = '84700000-0000-4000-8000-000000000005'::uuid) <> 'paused'
     or not exists (
       select 1 from public.merchant_enterprise_audit_events
        where merchant_id = '10000004'
          and entity_id = '84700000-0000-4000-8000-000000000005'::uuid
          and event_type = 'automation.paused'
          and after_data ->> 'reason_code' = 'execution_configuration_invalid'
     ) then
    raise exception 'assignee role-board lifecycle terminal policy failed';
  end if;
end;
$$;

-- Replaying the same outbox identity is harmless, and no raw order/business
-- payload marker may escape the authentic source tables.
insert into public.merchant_outbox_events (
  merchant_id, event_key, event_type, aggregate_type, aggregate_id, payload
)
values (
  '10000004',
  'enterprise-automation:order:84800000-0000-4000-8000-000000000001',
  'enterprise.workflow_automation.process',
  'merchant_order_event',
  '84800000-0000-4000-8000-000000000001',
  '{"sourceType":"order","eventId":"84800000-0000-4000-8000-000000000001"}'::jsonb
)
on conflict (merchant_id, event_key) do nothing;

do $$
begin
  if (select count(*) from public.merchant_outbox_events
       where merchant_id = '10000004'
         and event_key = 'enterprise-automation:order:84800000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'automation outbox event was not idempotent';
  end if;
  if exists (
    select 1 from public.merchant_enterprise_automation_runs
     where merchant_id = '10000004'
       and to_jsonb(merchant_enterprise_automation_runs)::text like '%RAW-ORDER-PII-MARKER%'
  ) or exists (
    select 1 from public.merchant_task_events
     where merchant_id = '10000004'
       and to_jsonb(merchant_task_events)::text like '%RAW-ORDER-PII-MARKER%'
  ) or exists (
    select 1 from public.merchant_enterprise_audit_events
     where merchant_id = '10000004'
       and to_jsonb(merchant_enterprise_audit_events)::text like '%RAW-ORDER-PII-MARKER%'
  ) or exists (
    select 1 from public.merchant_outbox_events
     where merchant_id = '10000004'
       and to_jsonb(merchant_outbox_events)::text like '%RAW-ORDER-PII-MARKER%'
  ) then
    raise exception 'raw source business identifier escaped automation boundary';
  end if;
end;
$$;

-- Tenant and permission checks reject identities before returning any rule or
-- run data.
do $$
begin
  begin
    perform public.faolla_list_merchant_enterprise_automation_rules_v1(
      '{
        "merchant_id":"10000004",
        "actor_type":"employee",
        "actor_id":"84200000-0000-4000-8000-000000000002"
      }'::jsonb
    );
    raise exception 'low-permission automation access unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%permission_denied%' then raise; end if;
  end;
  begin
    perform public.faolla_list_merchant_enterprise_automation_rules_v1(
      '{
        "merchant_id":"10000005",
        "actor_type":"owner",
        "actor_id":"84000000-0000-4000-8000-000000000001"
      }'::jsonb
    );
    raise exception 'cross-tenant automation access unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%permission_denied%' then raise; end if;
  end;
end;
$$;

-- There are already two active order-created rules. Add eighteen valid direct
-- fixtures, then prove the serialized API mutation rejects the twenty-first.
insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
select
  gen_random_uuid(),
  '10000004',
  'Automation cap fixture ' || fixture.number::text,
  'order', 'created', null, null,
  '84300000-0000-4000-8000-000000000001'::uuid,
  '84400000-0000-4000-8000-000000000001'::uuid,
  '84500000-0000-4000-8000-000000000001'::uuid,
  '84600000-0000-4000-8000-000000000001'::uuid,
  'Cap {eventRef}', '', 'normal', null, 'active', statement_timestamp()
from generate_series(1, 18) as fixture(number);

do $$
begin
  begin
    perform public.faolla_create_merchant_enterprise_automation_rule_v1(
      '{
        "merchant_id":"10000004",
        "actor_type":"owner",
        "actor_id":"84000000-0000-4000-8000-000000000001",
        "name":"Twenty-first rule must fail",
        "source_type":"order",
        "event_type":"created",
        "from_status":null,
        "to_status":null,
        "board_id":"84300000-0000-4000-8000-000000000001",
        "column_id":"84400000-0000-4000-8000-000000000001",
        "workflow_id":"84500000-0000-4000-8000-000000000001",
        "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
        "task_title":"Cap {eventRef}",
        "task_description":"",
        "priority":"normal",
        "due_offset_minutes":null,
        "status":"active",
        "assignee_ids":["84200000-0000-4000-8000-000000000001"],
        "operation_id":"integration-automation-active-cap"
      }'::jsonb
    );
    raise exception 'twenty-first active automation rule unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%automation_active_rule_limit_reached%' then raise; end if;
  end;
end;
$$;

-- Paused rules count toward the merchant-wide list bound. Twenty active
-- order-created rules, the status-boundary rule and two paused lifecycle rules
-- leave seventy-seven slots.
insert into public.merchant_enterprise_automation_rules (
  id, merchant_id, name, source_type, event_type, from_status, to_status,
  board_id, column_id, workflow_id, workflow_revision_id, task_title,
  task_description, priority, due_offset_minutes, status, enabled_at
)
select
  gen_random_uuid(),
  '10000004',
  'Automation total cap fixture ' || fixture.number::text,
  'booking', 'created', null, null,
  '84300000-0000-4000-8000-000000000001'::uuid,
  '84400000-0000-4000-8000-000000000001'::uuid,
  '84500000-0000-4000-8000-000000000001'::uuid,
  '84600000-0000-4000-8000-000000000001'::uuid,
  'Paused {eventRef}', '', 'normal', null, 'paused', statement_timestamp()
from generate_series(1, 77) as fixture(number);

do $$
begin
  begin
    perform public.faolla_create_merchant_enterprise_automation_rule_v1(
      '{
        "merchant_id":"10000004",
        "actor_type":"owner",
        "actor_id":"84000000-0000-4000-8000-000000000001",
        "name":"One hundred first rule must fail",
        "source_type":"booking",
        "event_type":"created",
        "from_status":null,
        "to_status":null,
        "board_id":"84300000-0000-4000-8000-000000000001",
        "column_id":"84400000-0000-4000-8000-000000000001",
        "workflow_id":"84500000-0000-4000-8000-000000000001",
        "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
        "task_title":"Paused {eventRef}",
        "task_description":"",
        "priority":"normal",
        "due_offset_minutes":null,
        "status":"paused",
        "assignee_ids":[],
        "operation_id":"integration-automation-total-cap"
      }'::jsonb
    );
    raise exception 'one hundred first automation rule unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%automation_rule_limit_reached%' then raise; end if;
  end;
end;
$$;

-- Soft archive preserves historical runs/audit, is idempotent, disappears
-- from the default list, and releases exactly one merchant-wide rule slot.
set role service_role;
select public.faolla_archive_merchant_enterprise_automation_rule_v1(
  '{
    "merchant_id":"10000004",
    "actor_type":"owner",
    "actor_id":"84000000-0000-4000-8000-000000000001",
    "rule_id":"84700000-0000-4000-8000-000000000001",
    "expected_version":2,
    "operation_id":"integration-automation-archive"
  }'::jsonb
);
select public.faolla_archive_merchant_enterprise_automation_rule_v1(
  '{
    "merchant_id":"10000004",
    "actor_type":"owner",
    "actor_id":"84000000-0000-4000-8000-000000000001",
    "rule_id":"84700000-0000-4000-8000-000000000001",
    "expected_version":2,
    "operation_id":"integration-automation-archive"
  }'::jsonb
);
reset role;

do $$
declare
  v_page jsonb;
begin
  v_page := public.faolla_list_merchant_enterprise_automation_rules_v1(
    '{
      "merchant_id":"10000004",
      "actor_type":"owner",
      "actor_id":"84000000-0000-4000-8000-000000000001"
    }'::jsonb
  );
  if (select status from public.merchant_enterprise_automation_rules
       where merchant_id = '10000004'
         and id = '84700000-0000-4000-8000-000000000001'::uuid) <> 'archived'
     or (select archived_at from public.merchant_enterprise_automation_rules
          where merchant_id = '10000004'
            and id = '84700000-0000-4000-8000-000000000001'::uuid) is null
     or (select count(*) from public.merchant_enterprise_automation_runs
          where merchant_id = '10000004'
            and rule_id = '84700000-0000-4000-8000-000000000001'::uuid) <> 2
     or (select count(*) from public.merchant_enterprise_audit_events
          where merchant_id = '10000004'
            and entity_id = '84700000-0000-4000-8000-000000000001'::uuid
            and event_type = 'automation.archived') <> 1
     or exists (
       select 1 from jsonb_array_elements(v_page -> 'rules') as item(value)
        where item.value ->> 'id' = '84700000-0000-4000-8000-000000000001'
     ) then
    raise exception 'automation soft archive lifecycle failed';
  end if;
end;
$$;

set role service_role;
select public.faolla_create_merchant_enterprise_automation_rule_v1(
  '{
    "merchant_id":"10000004",
    "actor_type":"owner",
    "actor_id":"84000000-0000-4000-8000-000000000001",
    "name":"Replacement after archive",
    "source_type":"booking",
    "event_type":"created",
    "from_status":null,
    "to_status":null,
    "board_id":"84300000-0000-4000-8000-000000000001",
    "column_id":"84400000-0000-4000-8000-000000000001",
    "workflow_id":"84500000-0000-4000-8000-000000000001",
    "workflow_revision_id":"84600000-0000-4000-8000-000000000001",
    "task_title":"Replacement {eventRef}",
    "task_description":"",
    "priority":"normal",
    "due_offset_minutes":null,
    "status":"paused",
    "assignee_ids":[],
    "operation_id":"integration-automation-replacement-after-archive"
  }'::jsonb
);
reset role;

do $$
begin
  if (select count(*) from public.merchant_enterprise_automation_rules
       where merchant_id = '10000004' and status <> 'archived') <> 100 then
    raise exception 'archived automation did not release one total-cap slot';
  end if;
end;
$$;

-- A noisy tenant with 300 due events cannot crowd a second tenant's single
-- event out of the bounded discovery/claim batch. Cursor order wraps in the
-- same call, expired leases are reclaimed, and health recognizes the type.
delete from public.merchant_outbox_events
 where merchant_id in ('10000004', '10000005')
   and event_type = 'enterprise.workflow_automation.process';
insert into public.merchant_outbox_events (
  merchant_id, event_key, event_type, aggregate_type, aggregate_id, payload,
  available_at, max_attempts, priority
)
select
  '10000004',
  'enterprise-automation:fair-a:' || fixture.number::text,
  'enterprise.workflow_automation.process',
  'merchant_order_event',
  gen_random_uuid()::text,
  '{}'::jsonb,
  statement_timestamp() - interval '1 minute',
  12,
  40
from generate_series(1, 300) as fixture(number);
insert into public.merchant_outbox_events (
  merchant_id, event_key, event_type, aggregate_type, aggregate_id, payload,
  available_at, max_attempts, priority
)
values (
  '10000005', 'enterprise-automation:fair-b:1',
  'enterprise.workflow_automation.process', 'merchant_order_event',
  gen_random_uuid()::text, '{}'::jsonb,
  statement_timestamp() - interval '1 minute', 12, 40
);

set role service_role;
do $$
declare
  v_discovered text[];
  v_wrapped text[];
  v_claimed jsonb;
  v_health jsonb;
begin
  select array_agg(discovered.merchant_id)
    into v_discovered
    from public.faolla_discover_merchant_enterprise_automation_merchants_v1(
      null, 2
    ) as discovered;
  select array_agg(discovered.merchant_id)
    into v_wrapped
    from public.faolla_discover_merchant_enterprise_automation_merchants_v1(
      '10000004', 2
    ) as discovered;
  if v_discovered is distinct from array['10000004', '10000005']::text[]
     or v_wrapped is distinct from array['10000005', '10000004']::text[] then
    raise exception 'automation tenant discovery did not deduplicate or wrap';
  end if;

  select jsonb_agg(to_jsonb(claimed)) into v_claimed
    from public.faolla_claim_merchant_enterprise_automation_outbox_v1(
      'enterprise-automation:integration-fair',
      array['10000004', '10000005']::text[],
      array['enterprise.workflow_automation.process']::text[],
      2,
      30
    ) as claimed;
  if jsonb_array_length(v_claimed) <> 2
     or (select count(distinct item.value ->> 'merchant_id')
           from jsonb_array_elements(v_claimed) as item(value)) <> 2 then
    raise exception 'automation fair claim did not give each tenant one slot';
  end if;

  v_health := public.faolla_get_merchant_outbox_health_v1('10000004', 24);
  if (v_health ->> 'unknown_event_type_count')::integer <> 0 then
    raise exception 'automation outbox type was unknown to health monitoring';
  end if;
end;
$$;
reset role;

update public.merchant_outbox_events
   set lease_expires_at = statement_timestamp() - interval '1 second'
 where merchant_id = '10000005'
   and event_key = 'enterprise-automation:fair-b:1'
   and status = 'processing';
set role service_role;
select *
  from public.faolla_claim_merchant_enterprise_automation_outbox_v1(
    'enterprise-automation:integration-expired',
    array['10000005']::text[],
    array['enterprise.workflow_automation.process']::text[],
    1,
    30
  );
reset role;
do $$
begin
  if (select total_attempts from public.merchant_outbox_events
       where merchant_id = '10000005'
         and event_key = 'enterprise-automation:fair-b:1') <> 2
     or not exists (
       select 1
         from public.merchant_outbox_attempts as attempt
         join public.merchant_outbox_events as event on event.id = attempt.event_id
        where event.merchant_id = '10000005'
          and event.event_key = 'enterprise-automation:fair-b:1'
          and attempt.attempt_number = 1
          and attempt.outcome = 'lease_expired'
     ) then
    raise exception 'automation expired lease was not fairly reclaimed';
  end if;
end;
$$;

rollback;
