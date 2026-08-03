\set ON_ERROR_STOP on
\pset pager off

create schema if not exists enterprise_integration;

create or replace function enterprise_integration.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'integration_assertion_failed: %', p_message;
  end if;
end;
$$;

create or replace function enterprise_integration.expect_error(
  p_sql text,
  p_expected_message text
)
returns void
language plpgsql
as $$
declare
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_message = message_text;
    if position(p_expected_message in coalesce(v_message, '')) = 0 then
      raise exception 'integration_unexpected_error: expected %, got %',
        p_expected_message,
        coalesce(v_message, '<null>');
    end if;
    return;
  end;
  raise exception 'integration_expected_error_missing: %', p_expected_message;
end;
$$;

grant usage on schema enterprise_integration
  to anon, authenticated, service_role;
grant execute on function enterprise_integration.assert_true(boolean, text)
  to anon, authenticated, service_role;
grant execute on function enterprise_integration.expect_error(text, text)
  to anon, authenticated, service_role;

insert into public.merchants (
  id,
  name,
  email,
  owner_user_id
)
values
  (
    '10000001',
    'Integration Merchant A',
    'owner-a@example.test',
    '10000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '10000002',
    'Integration Merchant B',
    'owner-b@example.test',
    '20000000-0000-4000-8000-000000000002'::uuid
  );

-- The service bridge is callable, but a valid UUID cannot impersonate a
-- different merchant owner. No bootstrap rows may leak into merchant B.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_bootstrap_merchant_enterprise_v2(
      '{
        "merchant_id":"10000002",
        "actor_type":"owner",
        "actor_id":"10000000-0000-4000-8000-000000000001",
        "operation_id":"integration-forged-bootstrap"
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_task_boards where merchant_id = '10000002'
  ),
  'forged owner bootstrap wrote merchant B data'
);

-- Bootstrap both isolated workspaces through the final audited RPC.
set role service_role;
select public.faolla_bootstrap_merchant_enterprise_v2(
  '{
    "merchant_id":"10000001",
    "actor_type":"owner",
    "actor_id":"10000000-0000-4000-8000-000000000001",
    "operation_id":"integration-bootstrap-a"
  }'::jsonb
);
select public.faolla_bootstrap_merchant_enterprise_v2(
  '{
    "merchant_id":"10000002",
    "actor_type":"owner",
    "actor_id":"20000000-0000-4000-8000-000000000002",
    "operation_id":"integration-bootstrap-b"
  }'::jsonb
);
reset role;

select enterprise_integration.assert_true(
  (select count(*) = 3 from public.merchant_enterprise_roles where merchant_id = '10000001'),
  'bootstrap did not create three default roles'
);
select enterprise_integration.assert_true(
  (select count(*) = 4 from public.merchant_task_columns where merchant_id = '10000001'),
  'bootstrap did not create four default columns'
);
select enterprise_integration.assert_true(
  (select count(*) = 1 from public.merchant_enterprise_audit_events
    where merchant_id = '10000001' and event_type = 'workspace.bootstrapped'),
  'bootstrap audit event missing or duplicated'
);

select id::text as board_a
  from public.merchant_task_boards
 where merchant_id = '10000001' and system_key = 'default'
\gset
select id::text as todo_a
  from public.merchant_task_columns
 where merchant_id = '10000001' and system_key = 'todo'
\gset
select id::text as progress_a
  from public.merchant_task_columns
 where merchant_id = '10000001' and system_key = 'in_progress'
\gset
select id::text as employee_role_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001' and system_key = 'employee'
\gset
select id::text as employee_role_b
  from public.merchant_enterprise_roles
 where merchant_id = '10000002' and system_key = 'employee'
\gset

-- Owner-created role plus an active synthetic manager fixture are used to
-- prove that employees cannot delegate permissions they do not themselves own.
set role service_role;
select public.faolla_create_merchant_enterprise_role_v2(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Scoped role manager',
    'description', 'Integration privilege-boundary fixture',
    'permissions', jsonb_build_array(
      'enterprise.view', 'roles.view', 'roles.manage', 'audit.view'
    ),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

select id::text as role_manager_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001' and name = 'Scoped role manager'
\gset

insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id,
  status, invited_at, accepted_at, last_active_at
)
values (
  '30000000-0000-4000-8000-000000000003'::uuid,
  '10000001',
  '30000000-0000-4000-8000-000000000103'::uuid,
  'role-manager@example.test',
  'Role manager',
  :'role_manager_a'::uuid,
  'active', now(), now(), now()
);

-- Full employee lifecycle: create -> reserve -> delivery finalization -> auth
-- binding -> acceptance. Every step uses the final service-role RPC surface.
set role service_role;
select public.faolla_create_merchant_enterprise_employee_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'email', 'worker@example.test',
    'display_name', 'Worker One',
    'role_id', :'employee_role_a',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

select id::text as worker_a, version as worker_version
  from public.merchant_enterprise_employees
 where merchant_id = '10000001' and email = 'worker@example.test'
\gset

set role service_role;
select public.faolla_reserve_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'worker_a',
    'expected_version', :worker_version,
    'token_hash', repeat('a', 64),
    'expires_at', (now() + interval '1 day')::text,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

select version as worker_version, invitation_version as worker_invitation_version
  from public.merchant_enterprise_employees
 where id = :'worker_a'::uuid
\gset

set role service_role;
select public.faolla_finalize_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'worker_a',
    'invitation_version', :worker_invitation_version,
    'delivery_status', 'sent'
  )
);
reset role;

select version as worker_version, invitation_version as worker_invitation_version
  from public.merchant_enterprise_employees
 where id = :'worker_a'::uuid
\gset

set role service_role;
select public.faolla_bind_merchant_employee_auth_user_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', :'worker_a',
    'auth_user_id', '40000000-0000-4000-8000-000000000004',
    'expected_version', :worker_version,
    'invitation_version', :worker_invitation_version
  )
);
select public.faolla_accept_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'auth_user_id', '40000000-0000-4000-8000-000000000004',
    'invitation_version', :worker_invitation_version,
    'token_hash', repeat('a', 64)
  )
);
reset role;

select enterprise_integration.assert_true(
  (select status = 'active' and accepted_at is not null
     from public.merchant_enterprise_employees where id = :'worker_a'::uuid),
  'employee invitation lifecycle did not activate the employee'
);
select enterprise_integration.assert_true(
  (select count(*) >= 5 from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'worker_a'::uuid),
  'employee invitation lifecycle audit trail is incomplete'
);

-- A second employee is reserved concurrently later. It starts at version 1.
set role service_role;
select public.faolla_create_merchant_enterprise_employee_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'email', 'cas-invite@example.test',
    'display_name', 'CAS Invitation',
    'role_id', :'employee_role_a',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
reset role;

-- Merchant B employee fixture supports an actual cross-merchant actor test.
insert into public.merchant_enterprise_employees (
  id, merchant_id, auth_user_id, email, display_name, role_id,
  status, invited_at, accepted_at, last_active_at
)
values (
  '50000000-0000-4000-8000-000000000005'::uuid,
  '10000002',
  '50000000-0000-4000-8000-000000000105'::uuid,
  'worker-b@example.test',
  'Worker B',
  :'employee_role_b'::uuid,
  'active', now(), now(), now()
);

-- Owner creates and assigns the task; employee advances it, writes a
-- checklist item, and the owner comment produces a second notification.
set role service_role;
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'board_a',
    'column_id', :'todo_a',
    'title', 'Integration main task',
    'description', 'Created by the PostgreSQL integration suite',
    'priority', 'high',
    'due_at', (now() + interval '2 days')::text,
    'source_type', '',
    'source_id', '',
    'created_by_employee_id', null,
    'assignee_ids', jsonb_build_array(:'worker_a'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-main-task-create',
    'event_payload', jsonb_build_object('source', 'postgres-integration')
  )
);
reset role;

select task_id::text as main_task_a
  from public.merchant_task_events
 where merchant_id = '10000001' and operation_id = 'integration-main-task-create'
\gset

set role service_role;
select public.faolla_update_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'main_task_a',
    'expected_version', 1,
    'column_id', :'progress_a',
    'replace_assignees', false,
    'actor_type', 'employee',
    'actor_id', :'worker_a',
    'operation_id', 'integration-main-task-progress',
    'event_type', 'moved',
    'event_payload', jsonb_build_object('source', 'postgres-integration')
  )
);
select public.faolla_create_merchant_task_checklist_item_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'main_task_a',
    'text', 'Verify database acceptance',
    'actor_type', 'employee',
    'actor_id', :'worker_a',
    'operation_id', 'integration-main-checklist-create'
  )
);
select public.faolla_add_merchant_task_comment_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'task_id', :'main_task_a',
    'text', 'Owner integration comment',
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-main-comment'
  )
);
reset role;

select enterprise_integration.assert_true(
  (select version = 2 and column_id = :'progress_a'::uuid
     from public.merchant_tasks where id = :'main_task_a'::uuid),
  'employee task update did not commit exactly once'
);
select enterprise_integration.assert_true(
  (select count(*) = 1 from public.merchant_task_checklist_items
    where task_id = :'main_task_a'::uuid and archived_at is null),
  'task checklist write missing'
);
select enterprise_integration.assert_true(
  (select count(*) = 2 from public.merchant_enterprise_notifications
    where merchant_id = '10000001'
      and recipient_employee_id = :'worker_a'::uuid
      and task_id = :'main_task_a'::uuid),
  'assignment and comment notifications were not emitted once each'
);
select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_notifications
     where merchant_id = '10000001'
       and payload::text like '%Owner integration comment%'
  ),
  'notification payload persisted comment text'
);
select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_audit_events
     where merchant_id = '10000001'
       and (
         before_data::text like '%worker@example.test%'
         or after_data::text like '%worker@example.test%'
         or before_data::text like '%' || repeat('a', 64) || '%'
         or after_data::text like '%' || repeat('a', 64) || '%'
       )
  ),
  'audit snapshots persisted employee email or invitation token material'
);

set role service_role;
select enterprise_integration.assert_true(
  (
    public.faolla_list_merchant_enterprise_notifications_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', :'worker_a',
        'limit', 20,
        'cursor_created_at', null,
        'cursor_id', null
      )
    ) ->> 'unread_count'
  )::bigint = 2,
  'authorized employee notification list returned the wrong unread count'
);
select enterprise_integration.assert_true(
  (
    public.faolla_mark_merchant_enterprise_notifications_read_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', :'worker_a',
        'mark_all', true,
        'notification_id', null
      )
    ) ->> 'unread_count'
  )::bigint = 0,
  'authorized employee could not mark its notifications read'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_enterprise_notifications
     where merchant_id = '10000001'
       and recipient_employee_id = :'worker_a'::uuid
       and read_at is null
  ),
  'notification read state did not persist'
);

-- Cross-merchant employee, forged owner, and employee role escalation are
-- denied by the database in the same statement as the attempted mutation.
set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_task_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'task_id', %L,
          'expected_version', 2,
          'title', 'Cross merchant overwrite',
          'replace_assignees', false,
          'actor_type', 'employee',
          'actor_id', '50000000-0000-4000-8000-000000000005',
          'operation_id', 'integration-cross-merchant-task',
          'event_type', 'updated',
          'event_payload', '{}'::jsonb
        )
      )
    $sql$,
    :'main_task_a'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_create_merchant_task_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'board_id', %L,
          'column_id', %L,
          'title', 'Forged owner task',
          'assignee_ids', '[]'::jsonb,
          'actor_type', 'owner',
          'actor_id', '90000000-0000-4000-8000-000000000009',
          'operation_id', 'integration-forged-owner-task',
          'event_payload', '{}'::jsonb
        )
      )
    $sql$,
    :'board_a',
    :'todo_a'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v2(
      jsonb_build_object(
        'merchant_id', '10000001',
        'name', 'Escalated task role',
        'description', '',
        'permissions', jsonb_build_array(
          'enterprise.view', 'tasks.view', 'tasks.create'
        ),
        'access_scope', 'all',
        'allowed_board_ids', '[]'::jsonb,
        'actor_type', 'employee',
        'actor_id', '30000000-0000-4000-8000-000000000003'
      )
    )
  $sql$,
  'permission_escalation_denied'
);
reset role;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_tasks
     where merchant_id = '10000001' and title in (
       'Cross merchant overwrite', 'Forged owner task'
     )
  ),
  'a rejected actor mutation left business data behind'
);
select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_enterprise_roles
     where merchant_id = '10000001' and name = 'Escalated task role'
  ),
  'employee created a role outside its permission envelope'
);

-- Audit is readable by the real owner, but not by a normal employee.
set role service_role;
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'limit', 100
      )
    ) -> 'events'
  ) >= 8,
  'owner audit list omitted committed administration events'
);
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', '30000000-0000-4000-8000-000000000003',
        'limit', 20
      )
    ) -> 'events'
  ) > 0,
  'employee with audit.view could not read the merchant audit trail'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_list_merchant_enterprise_audit_events_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', %L,
          'limit', 20
        )
      )
    $sql$,
    :'worker_a'
  ),
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000002',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'limit', 20
      )
    )
  $sql$,
  'permission_denied'
);
reset role;

-- Exercise the ACLs as the actual low-privilege roles, not by inspecting SQL
-- source text or relying only on has_function_privilege().
set role authenticated;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_task_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_notifications_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_mark_merchant_enterprise_notifications_read_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
reset role;

set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select count(*) from public.merchant_enterprise_notifications
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select count(*) from public.merchant_enterprise_audit_events
  $sql$,
  'permission denied'
);
reset role;

-- Even the database owner cannot rewrite immutable audit history through a
-- normal UPDATE because the append-only trigger rejects it.
select enterprise_integration.expect_error(
  $sql$
    update public.merchant_enterprise_audit_events
       set target_label = 'tampered'
     where merchant_id = '10000001'
  $sql$,
  'enterprise_audit_events_append_only'
);

-- A notification insertion failure must roll back task, event, assignment,
-- idempotency claim, and notification together.
create or replace function enterprise_integration.reject_notification_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'integration_forced_notification_failure';
end;
$$;
create trigger aaa_enterprise_integration_reject_notification
before insert on public.merchant_enterprise_notifications
for each row execute function enterprise_integration.reject_notification_insert();

set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_create_merchant_task_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'board_id', %L,
          'column_id', %L,
          'title', 'Notification rollback sentinel',
          'assignee_ids', jsonb_build_array(%L),
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001',
          'operation_id', 'integration-notification-rollback',
          'event_payload', '{}'::jsonb
        )
      )
    $sql$,
    :'board_a',
    :'todo_a',
    :'worker_a'
  ),
  'integration_forced_notification_failure'
);
reset role;
drop trigger aaa_enterprise_integration_reject_notification
  on public.merchant_enterprise_notifications;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_tasks
     where merchant_id = '10000001' and title = 'Notification rollback sentinel'
  )
  and not exists (
    select 1 from public.merchant_task_events
     where merchant_id = '10000001'
       and operation_id = 'integration-notification-rollback'
  )
  and not exists (
    select 1 from public.merchant_idempotency_keys
     where merchant_id = '10000001'
       and idempotency_key = 'enterprise-task:integration-notification-rollback'
  ),
  'notification failure did not roll back the complete task transaction'
);

-- Likewise, failure to append an administration audit record must roll back
-- the audited business mutation and its idempotency claim.
create or replace function enterprise_integration.reject_audit_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'integration_forced_audit_failure';
end;
$$;
create trigger aaa_enterprise_integration_reject_audit
before insert on public.merchant_enterprise_audit_events
for each row execute function enterprise_integration.reject_audit_insert();

set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_task_board_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"owner",
        "actor_id":"10000000-0000-4000-8000-000000000001",
        "name":"Audit rollback sentinel",
        "description":"must not survive",
        "operation_id":"integration-audit-rollback"
      }'::jsonb
    )
  $sql$,
  'integration_forced_audit_failure'
);
reset role;
drop trigger aaa_enterprise_integration_reject_audit
  on public.merchant_enterprise_audit_events;

select enterprise_integration.assert_true(
  not exists (
    select 1 from public.merchant_task_boards
     where merchant_id = '10000001' and name = 'Audit rollback sentinel'
  )
  and not exists (
    select 1 from public.merchant_idempotency_keys
     where merchant_id = '10000001'
       and idempotency_key = 'enterprise-board-create:integration-audit-rollback'
  ),
  'audit failure did not roll back the administration transaction'
);

-- Dedicated rows for two independent psql sessions. A trigger holds the first
-- writer briefly so the second connection genuinely waits on the same row.
set role service_role;
select public.faolla_create_merchant_task_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'board_id', :'board_a',
    'column_id', :'todo_a',
    'title', 'CAS task target',
    'assignee_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-task-cas-create',
    'event_payload', '{}'::jsonb
  )
);
reset role;

create or replace function enterprise_integration.delay_task_cas_row()
returns trigger
language plpgsql
as $$
begin
  if old.title = 'CAS task target'
     and new.title like 'CAS task worker %' then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$;

create or replace function enterprise_integration.delay_invitation_cas_row()
returns trigger
language plpgsql
as $$
begin
  if old.email = 'cas-invite@example.test'
     and old.invitation_version = 0
     and new.invitation_version = 1 then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$;

create trigger aaa_enterprise_integration_delay_task_cas
before update on public.merchant_tasks
for each row execute function enterprise_integration.delay_task_cas_row();
create trigger aaa_enterprise_integration_delay_invitation_cas
before update on public.merchant_enterprise_employees
for each row execute function enterprise_integration.delay_invitation_cas_row();

\echo 'Serial enterprise PostgreSQL acceptance checks passed.'
