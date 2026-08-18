\set ON_ERROR_STOP on
\pset pager off

-- Create one deterministic employee-authored administration event after the
-- filtering migration is installed.
set role service_role;
select public.faolla_create_merchant_enterprise_role_v2(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Audit query security sentinel',
    'description', '',
    'permissions', jsonb_build_array('enterprise.view', 'roles.view'),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'employee',
    'actor_id', '30000000-0000-4000-8000-000000000003'
  )
);
reset role;

-- Pin one synthetic fixture to exact millisecond precision so both boundary
-- operators are exercised at equality rather than only around a live clock.
insert into public.merchant_enterprise_audit_events (
  id, merchant_id, event_type, entity_type, entity_id,
  actor_type, actor_id, actor_label, target_label,
  before_data, after_data, operation_id, dedupe_key, created_at
)
select
  '32000000-0000-4000-8000-000000000032'::uuid,
  '10000001',
  'role.updated',
  'role',
  role.id,
  'employee',
  '30000000-0000-4000-8000-000000000003'::uuid,
  'Role manager',
  'Audit query security sentinel',
  jsonb_build_object('description', ''),
  jsonb_build_object('description', 'boundary fixture'),
  'integration-audit-query-boundary',
  'integration-audit-query-boundary',
  '2026-08-18T12:34:56.789Z'::timestamptz
from public.merchant_enterprise_roles as role
where role.merchant_id = '10000001'
  and role.name = 'Audit query security sentinel';

select
  to_char(
    created_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) as audit_created_from,
  to_char(
    (created_at + interval '1 millisecond') at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) as audit_created_to_exclusive,
  to_char(
    (created_at - interval '1 millisecond') at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) as audit_created_before
from public.merchant_enterprise_audit_events
where merchant_id = '10000001'
  and event_type = 'role.updated'
  and target_label = 'Audit query security sentinel'
  and actor_type = 'employee'
  and actor_id = '30000000-0000-4000-8000-000000000003'::uuid
order by created_at desc, id desc
limit 1
\gset

-- Keep three rows inside one JavaScript millisecond, including two at the
-- exact same PostgreSQL microsecond, so the keyset must preserve all six
-- fractional digits and use UUID as its deterministic tiebreaker.
insert into public.merchant_enterprise_audit_events (
  id, merchant_id, event_type, entity_type, entity_id,
  actor_type, actor_id, actor_label, target_label,
  before_data, after_data, operation_id, dedupe_key, created_at
)
values
  (
    '32000000-0000-4000-8000-000000000035'::uuid,
    '10000001', 'automation.updated', 'automation',
    '42000000-0000-4000-8000-000000000001'::uuid,
    'employee', '30000000-0000-4000-8000-000000000003'::uuid,
    'Role manager', 'Microsecond automation', '{}'::jsonb, '{}'::jsonb,
    'integration-audit-microsecond-35', 'integration-audit-microsecond-35',
    '2026-08-18T12:34:56.789456Z'::timestamptz
  ),
  (
    '32000000-0000-4000-8000-000000000034'::uuid,
    '10000001', 'automation.updated', 'automation',
    '42000000-0000-4000-8000-000000000001'::uuid,
    'employee', '30000000-0000-4000-8000-000000000003'::uuid,
    'Role manager', 'Microsecond automation', '{}'::jsonb, '{}'::jsonb,
    'integration-audit-microsecond-34', 'integration-audit-microsecond-34',
    '2026-08-18T12:34:56.789456Z'::timestamptz
  ),
  (
    '32000000-0000-4000-8000-000000000036'::uuid,
    '10000001', 'automation.updated', 'automation',
    '42000000-0000-4000-8000-000000000001'::uuid,
    'employee', '30000000-0000-4000-8000-000000000003'::uuid,
    'Role manager', 'Microsecond automation', '{}'::jsonb, '{}'::jsonb,
    'integration-audit-microsecond-36', 'integration-audit-microsecond-36',
    '2026-08-18T12:34:56.789123Z'::timestamptz
  )
on conflict (id) do nothing;

-- The lower boundary is inclusive, the upper boundary is exclusive, and the
-- employee UUID is a filter rather than a replacement caller identity.
set role service_role;
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'filter_actor_type', 'employee',
        'filter_actor_id', '30000000-0000-4000-8000-000000000003',
        'event_type', 'role.updated',
        'created_from', :'audit_created_from',
        'created_to_exclusive', :'audit_created_to_exclusive',
        'limit', 10
      )
    ) -> 'events'
  ) = 1,
  'exact employee actor and inclusive lower audit boundary failed'
);
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'filter_actor_type', 'employee',
        'filter_actor_id', '30000000-0000-4000-8000-000000000003',
        'event_type', 'role.updated',
        'created_from', :'audit_created_before',
        'created_to_exclusive', :'audit_created_from',
        'limit', 10
      )
    ) -> 'events'
  ) = 0,
  'exclusive upper audit boundary included its endpoint'
);

select
  page -> 'next_cursor' ->> 'before_created_at' as audit_cursor_created_at,
  page -> 'next_cursor' ->> 'before_id' as audit_cursor_id
from (
  select public.faolla_list_merchant_enterprise_audit_events_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'filter_actor_type', 'employee',
      'filter_actor_id', '30000000-0000-4000-8000-000000000003',
      'event_type', 'role.updated',
      'created_from', :'audit_created_from',
      'created_to_exclusive', :'audit_created_to_exclusive',
      'limit', 1
    )
  ) as page
) as first_page
\gset
select enterprise_integration.assert_true(
  jsonb_array_length(
    public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'filter_actor_type', 'employee',
        'filter_actor_id', '30000000-0000-4000-8000-000000000003',
        'event_type', 'role.updated',
        'created_from', :'audit_created_from',
        'created_to_exclusive', :'audit_created_to_exclusive',
        'before_created_at', :'audit_cursor_created_at',
        'before_id', :'audit_cursor_id',
        'limit', 1
      )
    ) -> 'events'
  ) = 0,
  'filtered audit keyset cursor repeated its last row'
);

with first_page as (
  select public.faolla_list_merchant_enterprise_audit_events_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'event_type', 'automation.updated',
      'created_from', '2026-08-18T12:34:56.789Z',
      'created_to_exclusive', '2026-08-18T12:34:56.790Z',
      'limit', 1
    )
  ) as page
), second_page as (
  select public.faolla_list_merchant_enterprise_audit_events_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'event_type', 'automation.updated',
      'created_from', '2026-08-18T12:34:56.789Z',
      'created_to_exclusive', '2026-08-18T12:34:56.790Z',
      'before_created_at', first_page.page -> 'next_cursor' ->> 'before_created_at',
      'before_id', first_page.page -> 'next_cursor' ->> 'before_id',
      'limit', 1
    )
  ) as page
  from first_page
), third_page as (
  select public.faolla_list_merchant_enterprise_audit_events_v1(
    jsonb_build_object(
      'merchant_id', '10000001',
      'actor_type', 'owner',
      'actor_id', '10000000-0000-4000-8000-000000000001',
      'event_type', 'automation.updated',
      'created_from', '2026-08-18T12:34:56.789Z',
      'created_to_exclusive', '2026-08-18T12:34:56.790Z',
      'before_created_at', second_page.page -> 'next_cursor' ->> 'before_created_at',
      'before_id', second_page.page -> 'next_cursor' ->> 'before_id',
      'limit', 1
    )
  ) as page
  from second_page
)
select enterprise_integration.assert_true(
  (select page -> 'events' -> 0 ->> 'id' from first_page)
    = '32000000-0000-4000-8000-000000000035'
  and (select page -> 'next_cursor' ->> 'before_created_at' from first_page)
    = '2026-08-18T12:34:56.789456Z'
  and (select page -> 'events' -> 0 ->> 'id' from second_page)
    = '32000000-0000-4000-8000-000000000034'
  and (select page -> 'next_cursor' ->> 'before_created_at' from second_page)
    = '2026-08-18T12:34:56.789456Z'
  and (select page -> 'events' -> 0 ->> 'id' from third_page)
    = '32000000-0000-4000-8000-000000000036',
  'microsecond audit keyset skipped or repeated an event'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'filter_actor_type', 'owner',
        'filter_actor_id', '30000000-0000-4000-8000-000000000003'
      )
    )
  $sql$,
  'invalid_enterprise_audit_query'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'created_from', '2026-08-18T00:00:00+00:00'
      )
    )
  $sql$,
  'invalid_enterprise_audit_query'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_audit_events_v1(
      jsonb_build_object(
        'merchant_id', '10000002',
        'actor_type', 'owner',
        'actor_id', '10000000-0000-4000-8000-000000000001',
        'filter_actor_type', 'employee'
      )
    )
  $sql$,
  'permission_denied'
);
reset role;

-- The migration was installed before all acceptance writes. Existing events
-- prove INSERT remains available through the authorized task RPCs.
select enterprise_integration.assert_true(
  exists (
    select 1 from public.merchant_task_events
     where merchant_id = '10000001'
       and operation_id = 'integration-main-task-create'
  ),
  'task event INSERT was blocked by append-only protection'
);
select enterprise_integration.expect_error(
  $sql$
    update public.merchant_task_events
       set event_type = 'tampered'
     where merchant_id = '10000001'
       and operation_id = 'integration-main-task-create'
  $sql$,
  'merchant_task_events_append_only'
);
select enterprise_integration.expect_error(
  $sql$
    delete from public.merchant_task_events
     where merchant_id = '10000001'
       and operation_id = 'integration-main-task-create'
  $sql$,
  'merchant_task_events_append_only'
);
select enterprise_integration.expect_error(
  $sql$
    truncate table public.merchant_task_events
  $sql$,
  'merchant_task_events_append_only'
);

-- Preserve the original service-role read grant and RLS posture.
set role service_role;
select enterprise_integration.assert_true(
  exists (
    select 1 from public.merchant_task_events
     where merchant_id = '10000001'
       and operation_id = 'integration-main-task-create'
  ),
  'service role can no longer read task events'
);
reset role;
