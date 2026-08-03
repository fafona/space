\set ON_ERROR_STOP on
\pset pager off

-- Walk every archived fixture through the public keyset API. Keeping the
-- cursor as jsonb between calls proves clients can round-trip the database's
-- full timestamp representation without rebuilding it.
set role service_role;
do $$
declare
  v_response jsonb;
  v_input jsonb;
  v_cursor jsonb;
  v_next_cursor jsonb;
  v_item jsonb;
  v_last_item jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_seen_count integer := 0;
  v_page integer;
  v_page_size integer;
  v_expected_page_size integer;
  v_expected_title text;
begin
  for v_page in 1..5 loop
    v_input := jsonb_build_object(
      'merchant_id', '10000001',
      'actor_type', 'employee',
      'actor_id', '71000000-0000-4000-8000-000000000002',
      'limit', 100
    );
    if v_cursor is not null then
      v_input := v_input || jsonb_build_object('cursor', v_cursor);
    end if;

    v_response := public.faolla_list_merchant_enterprise_archived_workflows_v1(
      v_input
    );
    if not (v_response ? 'workflows' and v_response ? 'next_cursor')
       or (select count(*) from jsonb_object_keys(v_response)) <> 2 then
      raise exception 'integration_assertion_failed: archive page response shape changed';
    end if;

    v_page_size := jsonb_array_length(v_response -> 'workflows');
    v_expected_page_size := case when v_page < 5 then 100 else 50 end;
    if v_page_size <> v_expected_page_size then
      raise exception
        'integration_assertion_failed: archive page % returned %, expected %',
        v_page, v_page_size, v_expected_page_size;
    end if;

    for v_item in
      select item.value
      from jsonb_array_elements(v_response -> 'workflows') as item(value)
    loop
      if (v_item ->> 'id')::uuid = any(v_seen) then
        raise exception
          'integration_assertion_failed: duplicate archived workflow %',
          v_item ->> 'id';
      end if;
      v_seen := array_append(v_seen, (v_item ->> 'id')::uuid);
      v_seen_count := v_seen_count + 1;
      v_expected_title := 'Archived workflow fixture ' ||
        (451 - v_seen_count)::text;
      if v_item ->> 'title' <> v_expected_title
         or v_item ->> 'status' <> 'archived' then
        raise exception
          'integration_assertion_failed: archived keyset order/status mismatch at item %',
          v_seen_count;
      end if;
    end loop;

    v_next_cursor := v_response -> 'next_cursor';
    if v_page < 5 then
      if coalesce(jsonb_typeof(v_next_cursor), '') <> 'object' then
        raise exception
          'integration_assertion_failed: archive page % omitted next cursor',
          v_page;
      end if;
      v_last_item := v_response -> 'workflows' -> (v_page_size - 1);
      if v_next_cursor ->> 'updated_at' <> v_last_item ->> 'updated_at'
         or v_next_cursor ->> 'id' <> v_last_item ->> 'id' then
        raise exception
          'integration_assertion_failed: archive cursor lost timestamp/id precision';
      end if;
      v_cursor := v_next_cursor;
    elsif v_next_cursor <> 'null'::jsonb then
      raise exception
        'integration_assertion_failed: final archive page exposed a cursor';
    end if;
  end loop;

  if v_seen_count <> 450 or cardinality(v_seen) <> 450 then
    raise exception
      'integration_assertion_failed: archive pagination returned % distinct rows',
      cardinality(v_seen);
  end if;
end;
$$;

-- All three privileged identities can apply server-side filters. Each fixture
-- value is unique, so accidental client-side filtering or an ignored filter is
-- visible as a wrong row count.
select enterprise_integration.assert_true(
  (
    select jsonb_array_length(result -> 'workflows') = 1
      and result -> 'workflows' -> 0 ->> 'title' =
        'Archived workflow fixture 448'
      and result -> 'next_cursor' = 'null'::jsonb
    from (
      select public.faolla_list_merchant_enterprise_archived_workflows_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000001',
          'limit', 10,
          'cursor', 'null'::jsonb,
          'query', 'quarterLY recon'
        )
      ) as result
    ) as filtered
  ),
  'manager archive query filter was not case-insensitive/server-side'
);
select enterprise_integration.assert_true(
  (
    select jsonb_array_length(result -> 'workflows') = 1
      and result -> 'workflows' -> 0 ->> 'title' =
        'Archived workflow fixture 446'
    from (
      select public.faolla_list_merchant_enterprise_archived_workflows_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000001',
          'limit', 10,
          'query', 'STEP TITLE NEEDLE'
        )
      ) as result
    ) as filtered
  ),
  'archive query did not search active step titles'
);
select enterprise_integration.assert_true(
  (
    select jsonb_array_length(result -> 'workflows') = 1
      and result -> 'workflows' -> 0 ->> 'title' =
        'Archived workflow fixture 446'
    from (
      select public.faolla_list_merchant_enterprise_archived_workflows_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000001',
          'limit', 10,
          'query', 'INSTRUCTION NEEDLE'
        )
      ) as result
    ) as filtered
  ),
  'archive query did not search active step instructions'
);
select enterprise_integration.assert_true(
  (
    select jsonb_array_length(result -> 'workflows') = 1
      and result -> 'workflows' -> 0 ->> 'title' =
        'Archived workflow fixture 447'
    from (
      select public.faolla_list_merchant_enterprise_archived_workflows_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001',
          'limit', 10,
          'scenario', 'Exact archived scenario'
        )
      ) as result
    ) as filtered
  ),
  'owner archive scenario filter was not exact/server-side'
);
select enterprise_integration.assert_true(
  (
    select jsonb_array_length(result -> 'workflows') = 1
      and result -> 'workflows' -> 0 ->> 'title' =
        'Archived workflow fixture 449'
    from (
      select public.faolla_list_merchant_enterprise_archived_workflows_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'limit', 10,
          'tag', 'archive-special'
        )
      ) as result
    ) as filtered
  ),
  'publisher archive tag filter was not exact/server-side'
);

-- Exact lookup avoids scanning archive pages, remains tenant-scoped, and uses
-- the same current-role authorization/projection rules as the list APIs.
select enterprise_integration.assert_true(
  (
    public.faolla_get_merchant_enterprise_workflow_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', '71000000-0000-4000-8000-000000000002',
        'workflow_id', '74000000-0000-4000-8000-000000000450'
      )
    ) -> 'workflow' ->> 'status'
  ) = 'archived',
  'publisher exact lookup could not read an archived workflow'
);
select enterprise_integration.assert_true(
  (
    public.faolla_get_merchant_enterprise_workflow_v1(
      jsonb_build_object(
        'merchant_id', '10000001',
        'actor_type', 'employee',
        'actor_id', '71000000-0000-4000-8000-000000000003',
        'workflow_id', (
          select id::text
          from public.merchant_enterprise_workflows
          where merchant_id = '10000001'
            and title = 'Published support workflow draft two'
        )
      )
    ) -> 'workflow' ->> 'title'
  ) = 'Published support workflow draft two',
  'view-only exact lookup did not return the current publication'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_workflow_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003",
        "workflow_id":"74000000-0000-4000-8000-000000000450"
      }'::jsonb
    )
  $sql$,
  'workflow_not_found'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_merchant_enterprise_workflow_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "workflow_id":"74000000-0000-4000-8000-999999999999"
      }'::jsonb
    )
  $sql$,
  'workflow_not_found'
);

-- Cursor structure and filter types are validated before any query executes.
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "limit":50,
        "cursor":{"updated_at":"2026-08-03T10:00:00.123456+00:00"}
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_cursor'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "limit":50,
        "cursor":{
          "updated_at":"not-a-timestamp",
          "id":"00000000-0000-4000-8000-000000000001"
        }
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_cursor'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "limit":50,
        "cursor":{
          "updated_at":"2026-08-03T10:00:00.123456+00:00",
          "id":"not-a-uuid",
          "extra":true
        }
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_cursor'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000002",
        "limit":50,
        "query":false
      }'::jsonb
    )
  $sql$,
  'invalid_workflow_query'
);

-- Archive history is intentionally unavailable to view-only or foreign-tenant
-- actors, and blank actor types cannot fall through either workflow or audit
-- authorization.
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"71000000-0000-4000-8000-000000000003",
        "limit":50
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"employee",
        "actor_id":"50000000-0000-4000-8000-000000000005",
        "limit":50
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_list_merchant_enterprise_archived_workflows_v1(
      '{
        "merchant_id":"10000001",
        "actor_type":"",
        "actor_id":"10000000-0000-4000-8000-000000000001",
        "limit":50
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
        "actor_id":"10000000-0000-4000-8000-000000000001",
        "limit":20
      }'::jsonb
    )
  $sql$,
  'permission_denied'
);
reset role;

-- Only the service bridge may execute the public archive RPC.
select enterprise_integration.assert_true(
  has_function_privilege(
    'service_role',
    'public.faolla_list_merchant_enterprise_archived_workflows_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.faolla_list_merchant_enterprise_archived_workflows_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_list_merchant_enterprise_archived_workflows_v1(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_get_merchant_enterprise_workflow_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.faolla_get_merchant_enterprise_workflow_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_get_merchant_enterprise_workflow_v1(jsonb)',
    'EXECUTE'
  ),
  'workflow read RPC ACL is broader or narrower than service_role'
);

-- The statement trigger must reject TRUNCATE as well as row-level UPDATE and
-- DELETE. CASCADE avoids a foreign-key preflight error masking the trigger.
select enterprise_integration.expect_error(
  'truncate table public.merchant_enterprise_workflow_revisions cascade',
  'workflow_revisions_append_only'
);
select enterprise_integration.assert_true(
  (
    select count(*) >= 2
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001'
  ),
  'rejected revision TRUNCATE changed publication history'
);

-- Prepare a deterministic capacity race. Direct fixture inserts bring the
-- tenant to 199 active workflows; both archived targets then try to become the
-- 200th active workflow in independent sessions.
do $$
declare
  v_active_count integer;
  v_needed integer;
begin
  select count(*)::integer into v_active_count
  from public.merchant_enterprise_workflows
  where merchant_id = '10000001'
    and status <> 'archived';
  if v_active_count > 199 then
    raise exception
      'integration_assertion_failed: workflow capacity fixture starts at %',
      v_active_count;
  end if;
  v_needed := 199 - v_active_count;
  insert into public.merchant_enterprise_workflows (
    merchant_id, title, scenario, description, category, tags,
    status, position
  )
  select
    '10000001',
    'Active capacity fixture ' || fixture.number::text,
    'Restore concurrency capacity fixture',
    '',
    'Integration',
    '{}'::text[],
    'draft',
    10000 + fixture.number
  from generate_series(1, v_needed) as fixture(number);
end;
$$;

insert into public.merchant_enterprise_workflows (
  id, merchant_id, title, scenario, description, category, tags,
  status, position
)
values
  (
    '73000000-0000-4000-8000-000000000001'::uuid,
    '10000001', 'Restore capacity target A',
    'Only one archived workflow may be restored', '', 'Integration',
    '{}'::text[], 'archived', 20001
  ),
  (
    '73000000-0000-4000-8000-000000000002'::uuid,
    '10000001', 'Restore capacity target B',
    'Only one archived workflow may be restored', '', 'Integration',
    '{}'::text[], 'archived', 20002
  );

select enterprise_integration.assert_true(
  (
    select count(*) = 199
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001' and status <> 'archived'
  ),
  'restore capacity race was not prepared at 199 active workflows'
);

create or replace function enterprise_integration.delay_workflow_restore_row()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'archived'
     and new.status <> 'archived'
     and old.id in (
       '73000000-0000-4000-8000-000000000001'::uuid,
       '73000000-0000-4000-8000-000000000002'::uuid
     ) then
    perform pg_sleep(1.5);
  end if;
  return new;
end;
$$;

create trigger zzz_enterprise_integration_delay_workflow_restore
before update on public.merchant_enterprise_workflows
for each row execute function enterprise_integration.delay_workflow_restore_row();

\echo 'Archived workflow pagination and restore-capacity fixtures passed.'
