\set ON_ERROR_STOP on
\pset pager off

select id::text as revision_workflow_id,
       version::text as revision_workflow_version,
       current_revision_id::text as revision_current_pointer
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and title = 'Published support workflow draft two'
\gset

-- Author/reviewer roles can inspect immutable history; view-only employees
-- stay on the current published projection and cannot enumerate old content.
set role service_role;
select enterprise_integration.assert_true(
  (
    select history ->> 'merchantId' = '10000001'
      and jsonb_array_length(history -> 'revisions') = 2
      and history -> 'revisions' -> 0 ->> 'revision_no' = '2'
      and history -> 'revisions' -> 1 ->> 'revision_no' = '1'
      and history ->> 'next_before_revision' is null
    from (
      select public.faolla_list_merchant_enterprise_workflow_revisions_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', :'revision_workflow_id',
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000002',
          'limit', 10
        )
      ) as history
    ) as listed
  ),
  'publisher could not read ordered workflow revision history'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_list_merchant_enterprise_workflow_revisions_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', %L,
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000003',
          'limit', 10
        )
      )
    $sql$,
    :'revision_workflow_id'
  ),
  'permission_denied'
);
select enterprise_integration.assert_true(
  (
    select detail ->> 'merchantId' = '10000001'
      and detail -> 'revision' ->> 'revision_no' = '1'
      and detail -> 'previous_revision' = 'null'::jsonb
      and detail -> 'revision' -> 'snapshot' ->> 'title' = 'Published support workflow'
      and detail -> 'working_draft' ->> 'title' = 'Published support workflow draft two'
      and (detail -> 'workflow' ->> 'can_restore')::boolean
    from (
      select public.faolla_get_merchant_enterprise_workflow_revision_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'workflow_id', :'revision_workflow_id',
          'revision_no', 1,
          'actor_type', 'employee',
          'actor_id', '71000000-0000-4000-8000-000000000001'
        )
      ) as detail
    ) as selected
  ),
  'revision detail omitted selected, previous, or working draft diff data'
);
reset role;

select md5(snapshot::text) as revision_one_hash
  from public.merchant_enterprise_workflow_revisions
 where merchant_id = '10000001'
   and workflow_id = :'revision_workflow_id'::uuid
   and revision_no = 1
\gset

-- Restore copies revision 1 into the mutable draft. It keeps the publication
-- pointer and immutable revision rows unchanged, then ordinary publish creates
-- revision 3.
set role service_role;
select public.faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'revision_workflow_id',
    'revision_no', 1,
    'expected_version', :'revision_workflow_version'::bigint,
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-workflow-revision-restore-1'
  )
);
select public.faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'revision_workflow_id',
    'revision_no', 1,
    'expected_version', :'revision_workflow_version'::bigint,
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-workflow-revision-restore-1'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select title = 'Published support workflow'
      and description = 'Original published description'
      and version = :'revision_workflow_version'::bigint + 1
      and published_version = 2
      and has_unpublished_changes
      and current_revision_id = :'revision_current_pointer'::uuid
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id = :'revision_workflow_id'::uuid
  )
  and (
    select count(*) = 2
      and max(case when revision_no = 1 then md5(snapshot::text) end) = :'revision_one_hash'
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001'
      and workflow_id = :'revision_workflow_id'::uuid
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'revision_workflow_id'::uuid
      and dedupe_key = 'workflow.restore_revision:integration-workflow-revision-restore-1'
  ),
  'history restore mutated a revision, publication pointer, or replayed audit state'
);

select version::text as restored_workflow_version
  from public.merchant_enterprise_workflows
 where merchant_id = '10000001'
   and id = :'revision_workflow_id'::uuid
\gset

set role service_role;
select public.faolla_update_merchant_enterprise_workflow_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'workflow_id', :'revision_workflow_id',
    'expected_version', :'restored_workflow_version'::bigint,
    'action', 'publish',
    'actor_type', 'employee',
    'actor_id', '71000000-0000-4000-8000-000000000002',
    'operation_id', 'integration-workflow-republish-restored-revision'
  )
);
reset role;

select enterprise_integration.assert_true(
  (
    select published_version = 3
      and not has_unpublished_changes
      and status = 'published'
    from public.merchant_enterprise_workflows
    where merchant_id = '10000001'
      and id = :'revision_workflow_id'::uuid
  )
  and (
    select count(*) = 3
      and max(case when revision_no = 1 then md5(snapshot::text) end) = :'revision_one_hash'
      and max(case when revision_no = 3 then snapshot ->> 'title' end) = 'Published support workflow'
    from public.merchant_enterprise_workflow_revisions
    where merchant_id = '10000001'
      and workflow_id = :'revision_workflow_id'::uuid
  ),
  'republish did not append a new immutable revision from the restored draft'
);

-- Existing custom roles are reported but never changed by detection. Only the
-- real owner can explicitly grant the submitted workflow permissions.
select id::text as role_manager_a,
       version::text as legacy_role_version
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and name = 'Scoped role manager'
\gset

set role service_role;
select enterprise_integration.assert_true(
  public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  ) ->> 'merchantId' = '10000001'
  and exists (
    select 1
      from jsonb_array_elements(
        public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(
          '{
            "merchant_id":"10000001",
            "actor_type":"owner",
            "actor_id":"10000000-0000-4000-8000-000000000001"
          }'::jsonb
        ) -> 'gaps'
      ) as gap(item)
     where gap.item ->> 'name' = 'Scoped role manager'
       and gap.item ->> 'classification' = 'custom_role_review'
       and gap.item -> 'missing_workflow_permissions' = '["workflows.view"]'::jsonb
  ),
  'legacy custom role workflow permission gap was not detected'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'workflow_permissions', jsonb_build_object('workflows.view', true),
          'actor_type', 'owner',
          'actor_id', '10000000-0000-4000-8000-000000000001',
          'operation_id', 'integration-malformed-workflow-grant'
        )
      )
    $sql$,
    :'role_manager_a',
    :'legacy_role_version'
  ),
  'invalid_workflow_permission_grant'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'workflow_permissions', jsonb_build_array('workflows.view'),
          'actor_type', 'employee',
          'actor_id', '30000000-0000-4000-8000-000000000003',
          'operation_id', 'integration-employee-workflow-grant-denied'
        )
      )
    $sql$,
    :'role_manager_a',
    :'legacy_role_version'
  ),
  'permission_denied'
);
select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'role_id', :'role_manager_a',
    'expected_version', :'legacy_role_version'::bigint,
    'workflow_permissions', jsonb_build_array('workflows.view'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-owner-grant-workflow-view'
  )
) ->> 'merchantId' as permission_grant_merchant_id
\gset
select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'role_id', :'role_manager_a',
    'expected_version', :'legacy_role_version'::bigint,
    'workflow_permissions', jsonb_build_array('workflows.view'),
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001',
    'operation_id', 'integration-owner-grant-workflow-view'
  )
);
reset role;

select enterprise_integration.assert_true(
  :'permission_grant_merchant_id' = '10000001'
  and (
    select 'workflows.view' = any(permissions)
      and not ('workflows.manage' = any(permissions))
      and not ('workflows.publish' = any(permissions))
      and version = :'legacy_role_version'::bigint + 1
    from public.merchant_enterprise_roles
    where merchant_id = '10000001'
      and id = :'role_manager_a'::uuid
  )
  and public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(
    '{
      "merchant_id":"10000001",
      "actor_type":"owner",
      "actor_id":"10000000-0000-4000-8000-000000000001"
    }'::jsonb
  ) ->> 'merchantId' = '10000001'
  and not exists (
    select 1
      from jsonb_array_elements(
        public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(
          '{
            "merchant_id":"10000001",
            "actor_type":"owner",
            "actor_id":"10000000-0000-4000-8000-000000000001"
          }'::jsonb
        ) -> 'gaps'
      ) as gap(item)
     where gap.item ->> 'name' = 'Scoped role manager'
  )
  and (
    select count(*) = 1
    from public.merchant_enterprise_audit_events
    where merchant_id = '10000001'
      and entity_id = :'role_manager_a'::uuid
      and event_type = 'role.updated'
      and operation_id = 'integration-owner-grant-workflow-view'
  ),
  'explicit permission grant elevated extra rights, failed replay, or left a false gap'
);

reset role;
