\set ON_ERROR_STOP on
\pset pager off

select enterprise_integration.assert_true(
  exists (
    select 1
      from public.faolla_schema_migrations
     where version = 202608280041
       and name = 'merchant_staff_business_permissions'
  ),
  'staff business permission migration is not registered'
);

select enterprise_integration.assert_true(
  public.faolla_valid_merchant_enterprise_permissions_v1(
    array['orders.view', 'orders.export']::text[]
  ),
  'valid business permission dependency set was rejected'
);
select enterprise_integration.assert_true(
  not public.faolla_valid_merchant_enterprise_permissions_v1(
    array['orders.export']::text[]
  ),
  'missing business permission dependency was accepted'
);
select enterprise_integration.assert_true(
  not public.faolla_valid_merchant_enterprise_permissions_v1(
    array['orders.view', 'orders.view']::text[]
  ),
  'duplicate business permissions were accepted'
);
select enterprise_integration.assert_true(
  not public.faolla_valid_merchant_enterprise_permissions_v1(
    array['orders.view', 'redteam.unknown']::text[]
  ),
  'unknown business permission was accepted'
);

select enterprise_integration.assert_true(
  not exists (
    select 1
      from public.merchant_enterprise_roles as role_row
     where role_row.is_system
       and public.faolla_role_has_staff_business_permissions_v1(
         role_row.permissions
       )
  ),
  'migration granted business permissions to a default system role'
);

select enterprise_integration.assert_true(
  has_function_privilege(
    'service_role',
    'public.faolla_create_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_update_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.faolla_create_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_create_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.faolla_update_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.faolla_update_merchant_enterprise_role_v3(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_create_merchant_enterprise_role_v2(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_update_merchant_enterprise_role_v2(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.faolla_create_merchant_enterprise_role_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.faolla_update_merchant_enterprise_role_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.faolla_create_merchant_enterprise_role_v2_core_041(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.faolla_update_merchant_enterprise_role_v2_core_041(jsonb)',
    'EXECUTE'
  ),
  'role RPC ACL did not preserve only the approved service entry points'
);

select enterprise_integration.assert_true(
  relation_metadata.relowner = to_regrole('supabase_admin')
  and not exists (
    with actual(grantee, grantor, privilege_type, is_grantable) as (
      select acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
        from pg_catalog.aclexplode(coalesce(
          relation_metadata.relacl,
          pg_catalog.acldefault('r', relation_metadata.relowner)
        )) as acl
    ), expected(grantee, grantor, privilege_type, is_grantable) as (
      select acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
        from pg_catalog.aclexplode(
          pg_catalog.acldefault('r', to_regrole('supabase_admin'))
        ) as acl
      union all
      select to_regrole('service_role'), to_regrole('supabase_admin'),
             'SELECT'::text, false
    ), delta as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from delta
  )
  and has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'INSERT'
  )
  and not has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'UPDATE'
  )
  and not has_table_privilege(
    'service_role', 'public.merchant_enterprise_roles', 'DELETE'
  ),
  'role table owner or exact service SELECT-only ACL is invalid'
)
from pg_catalog.pg_class as relation_metadata
where relation_metadata.oid =
  'public.merchant_enterprise_roles'::regclass;

select coalesce(
         owner_user_id,
         user_id,
         auth_user_id,
         owner_id,
         auth_id,
         created_by,
         created_by_user_id
       )::text as merchant_owner_a
  from public.merchants
 where id = '10000001'
\gset

select id::text as role_manager_a,
       version as role_manager_version_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and name = 'Scoped role manager'
\gset

-- Both v3 entry points reject missing and unknown actor types before setting
-- the transaction-local owner marker or reaching either legacy v2 delegate.
set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v1('{}'::jsonb)
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v2_core_041(
      '{}'::jsonb
    )
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    with marker as materialized (
      select set_config(
        'faolla.staff_business_role_internal_actor_type', 'owner', true
      )
    )
    insert into public.merchant_enterprise_roles (
      merchant_id, name, permissions
    )
    select '10000001', 'Forged marker business role 041',
           array['orders.view']::text[]
      from marker
  $sql$,
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v3(
      jsonb_build_object(
        'merchant_id', '10000001',
        'name', 'Missing actor business role 041',
        'permissions', jsonb_build_array('orders.view'),
        'actor_id', '10000000-0000-4000-8000-000000000001'
      )
    )
  $sql$,
  'invalid_role_actor'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v3(
      jsonb_build_object(
        'merchant_id', '10000001',
        'name', 'Unknown actor business role 041',
        'permissions', jsonb_build_array('orders.view'),
        'actor_type', 'manager',
        'actor_id', '10000000-0000-4000-8000-000000000001'
      )
    )
  $sql$,
  'invalid_role_actor'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'name', 'Missing actor role update 041',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'role_manager_a',
    :role_manager_version_a
  ),
  'invalid_role_actor'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'name', 'Unknown actor role update 041',
          'actor_type', 'manager',
          'actor_id', '10000000-0000-4000-8000-000000000001'
        )
      )
    $sql$,
    :'role_manager_a',
    :role_manager_version_a
  ),
  'invalid_role_actor'
);

-- The compatible v2 functions remain callable, but without the v3 owner marker
-- neither an INSERT nor an UPDATE may introduce a business permission.
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_create_merchant_enterprise_role_v2(
        jsonb_build_object(
          'merchant_id', '10000001',
          'name', 'Legacy v2 business role 041',
          'description', '',
          'permissions', jsonb_build_array('orders.view'),
          'access_scope', 'all',
          'allowed_board_ids', '[]'::jsonb,
          'actor_type', 'owner',
          'actor_id', %L
        )
      )
    $sql$,
    :'merchant_owner_a'
  ),
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v2(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'permissions', jsonb_build_array(
            'enterprise.view',
            'roles.view',
            'roles.manage',
            'audit.view',
            'orders.view'
          ),
          'actor_type', 'owner',
          'actor_id', %L
        )
      )
    $sql$,
    :'role_manager_a',
    :role_manager_version_a,
    :'merchant_owner_a'
  ),
  'permission_escalation_denied'
);
select public.faolla_create_merchant_enterprise_role_v2(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Legacy v2 collaboration role 041',
    'description', 'Rollback-compatible ordinary role fixture',
    'permissions', jsonb_build_array('enterprise.view'),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a'
  )
);
reset role;

select id::text as role_legacy_v2_a,
       version as role_legacy_v2_version_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and name = 'Legacy v2 collaboration role 041'
\gset

-- Alias drift must not block an emergency monotonic strip by a legacy-valid
-- owner, but it must block retaining any business permission. Employees may
-- never use the downgrade exception.
set role service_role;
select public.faolla_create_merchant_enterprise_role_v3(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Business downgrade role 041',
    'description', 'Emergency strip fixture',
    'permissions', jsonb_build_array(
      'enterprise.view', 'orders.view', 'conversations.view'
    ),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a'
  )
);
reset role;

select id::text as role_downgrade_a, version as role_downgrade_version_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and name = 'Business downgrade role 041'
\gset

update public.merchants
   set created_by_user_id =
     'f4100000-0000-4000-8000-000000000041'::uuid
 where id = '10000001';

set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'permissions', jsonb_build_array('enterprise.view'),
          'actor_type', 'employee',
          'actor_id', '30000000-0000-4000-8000-000000000003'
        )
      )
    $sql$,
    :'role_downgrade_a',
    :role_downgrade_version_a
  ),
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'permissions', jsonb_build_array(
            'enterprise.view', 'orders.view'
          ),
          'actor_type', 'owner',
          'actor_id', %L
        )
      )
    $sql$,
    :'role_downgrade_a',
    :role_downgrade_version_a,
    :'merchant_owner_a'
  ),
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'permissions', jsonb_build_array('enterprise.view'),
          'status', 'archived',
          'actor_type', 'owner',
          'actor_id', %L
        )
      )
    $sql$,
    :'role_downgrade_a',
    :role_downgrade_version_a,
    :'merchant_owner_a'
  ),
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'permissions', jsonb_build_array(
            'enterprise.view', 'roles.view', 'roles.manage'
          ),
          'actor_type', 'owner',
          'actor_id', %L
        )
      )
    $sql$,
    :'role_downgrade_a',
    :role_downgrade_version_a,
    :'merchant_owner_a'
  ),
  'permission_escalation_denied'
);
reset role;
select enterprise_integration.expect_error(
  format(
    $sql$
      delete from public.merchant_enterprise_roles
       where merchant_id = '10000001'
         and id = %L::uuid
    $sql$,
    :'role_downgrade_a'
  ),
  'permission_escalation_denied'
);
set role service_role;
select public.faolla_update_merchant_enterprise_role_v3(
  jsonb_build_object(
    'merchant_id', '10000001',
    'role_id', :'role_downgrade_a',
    'expected_version', :role_downgrade_version_a,
    'permissions', jsonb_build_array('enterprise.view'),
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a'
  )
);
reset role;

update public.merchants
   set created_by_user_id = :'merchant_owner_a'::uuid
 where id = '10000001';

select enterprise_integration.assert_true(
  nullif(
    current_setting(
      'faolla.staff_business_role_internal_actor_type', true
    ),
    ''
  ) is null,
  'rejected wrapper or v2 call leaked an owner marker'
);

-- Direct backend DML without a v3 owner marker fails closed for both NEW
-- business permissions and UPDATEs of rows that already contain them.
select enterprise_integration.expect_error(
  $sql$
    insert into public.merchant_enterprise_roles (
      merchant_id, name, permissions
    ) values (
      '10000001', 'Direct backend business role 041',
      array['orders.view']::text[]
    )
  $sql$,
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      update public.merchant_enterprise_roles
         set permissions = array[
           'enterprise.view',
           'roles.view',
           'roles.manage',
           'audit.view',
           'orders.view'
         ]::text[]
       where merchant_id = '10000001'
         and id = %L::uuid
    $sql$,
    :'role_manager_a'
  ),
  'permission_escalation_denied'
);
-- Give the existing role-manager fixture one business permission as the owner.
-- The employee can therefore pass the legacy v2 subset check; the v3 row guard
-- must still reserve all business-role creation and mutation for the owner.
set role service_role;
select public.faolla_update_merchant_enterprise_role_v3(
  jsonb_build_object(
    'merchant_id', '10000001',
    'role_id', :'role_manager_a',
    'expected_version', :role_manager_version_a,
    'permissions', jsonb_build_array(
      'enterprise.view',
      'roles.view',
      'roles.manage',
      'audit.view',
      'orders.view'
    ),
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a'
  )
);
select public.faolla_create_merchant_enterprise_role_v3(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Owner business role 041',
    'description', 'Integration owner-only business role fixture',
    'permissions', jsonb_build_array('enterprise.view', 'orders.view'),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a'
  )
);
reset role;

select id::text as role_business_a, version as role_business_version_a
  from public.merchant_enterprise_roles
 where merchant_id = '10000001'
   and name = 'Owner business role 041'
\gset

-- The legacy additive grant can mutate ordinary collaboration roles only.
-- A business-bearing role is rejected without changing its version or data,
-- even for the exact owner, and must be edited through v3 instead.
set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
        jsonb_build_object(
          'merchant_id', '10000001',
          'actor_type', 'owner',
          'actor_id', %L,
          'role_id', %L,
          'expected_version', %s,
          'workflow_permissions', jsonb_build_array('workflows.view'),
          'operation_id', 'staff-business-workflow-grant-041'
        )
      )
    $sql$,
    :'merchant_owner_a',
    :'role_business_a',
    :role_business_version_a
  ),
  'business_role_workflow_grant_requires_role_editor'
);
select public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'actor_type', 'owner',
    'actor_id', :'merchant_owner_a',
    'role_id', :'role_legacy_v2_a',
    'expected_version', :role_legacy_v2_version_a,
    'workflow_permissions', jsonb_build_array('workflows.view'),
    'operation_id', 'staff-ordinary-workflow-grant-041'
  )
);
reset role;

select enterprise_integration.assert_true(
  (select version = :role_business_version_a
          and permissions = array['enterprise.view', 'orders.view']::text[]
     from public.merchant_enterprise_roles
    where merchant_id = '10000001'
      and id = :'role_business_a'::uuid)
  and
  (select version = :role_legacy_v2_version_a + 1
          and permissions = array[
            'enterprise.view', 'workflows.view'
          ]::text[]
     from public.merchant_enterprise_roles
    where merchant_id = '10000001'
      and id = :'role_legacy_v2_a'::uuid),
  'workflow grant did not reject business roles and preserve ordinary roles'
);

select enterprise_integration.assert_true(
  nullif(
    current_setting(
      'faolla.staff_business_role_internal_actor_type', true
    ),
    ''
  ) is null,
  'successful owner v3 call leaked its owner marker'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      update public.merchant_enterprise_roles
         set name = 'Direct-renamed business role 041'
       where merchant_id = '10000001'
         and id = %L::uuid
    $sql$,
    :'role_business_a'
  ),
  'permission_escalation_denied'
);

set role service_role;
select enterprise_integration.expect_error(
  format(
    $sql$
      with marker as materialized (
        select set_config(
          'faolla.staff_business_role_internal_actor_type', 'owner', true
        )
      )
      update public.merchant_enterprise_roles as role_row
         set name = role_row.name
        from marker
       where role_row.merchant_id = '10000001'
         and role_row.id = %L::uuid
    $sql$,
    :'role_business_a'
  ),
  'permission denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      with marker as materialized (
        select set_config(
          'faolla.staff_business_role_internal_actor_type', 'owner', true
        )
      )
      delete from public.merchant_enterprise_roles as role_row
       using marker
       where role_row.merchant_id = '10000001'
         and role_row.id = %L::uuid
    $sql$,
    :'role_business_a'
  ),
  'permission denied'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_create_merchant_enterprise_role_v3(
      jsonb_build_object(
        'merchant_id', '10000001',
        'name', 'Employee business role 041',
        'description', '',
        'permissions', jsonb_build_array('orders.view'),
        'access_scope', 'all',
        'allowed_board_ids', '[]'::jsonb,
        'actor_type', 'employee',
        'actor_id', '30000000-0000-4000-8000-000000000003'
      )
    )
  $sql$,
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'name', 'Employee-renamed business role 041',
          'actor_type', 'employee',
          'actor_id', '30000000-0000-4000-8000-000000000003'
        )
      )
    $sql$,
    :'role_business_a',
    :role_business_version_a
  ),
  'permission_escalation_denied'
);
select enterprise_integration.expect_error(
  format(
    $sql$
      select public.faolla_update_merchant_enterprise_role_v3(
        jsonb_build_object(
          'merchant_id', '10000001',
          'role_id', %L,
          'expected_version', %s,
          'status', 'archived',
          'actor_type', 'employee',
          'actor_id', '30000000-0000-4000-8000-000000000003'
        )
      )
    $sql$,
    :'role_business_a',
    :role_business_version_a
  ),
  'permission_escalation_denied'
);
select public.faolla_create_merchant_enterprise_role_v3(
  jsonb_build_object(
    'merchant_id', '10000001',
    'name', 'Employee collaboration role 041',
    'description', 'Legacy collaboration behavior through v3',
    'permissions', jsonb_build_array('enterprise.view'),
    'access_scope', 'all',
    'allowed_board_ids', '[]'::jsonb,
    'actor_type', 'employee',
    'actor_id', '30000000-0000-4000-8000-000000000003'
  )
);
reset role;

select enterprise_integration.assert_true(
  exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and id = :'role_manager_a'::uuid
       and 'orders.view' = any(permissions)
  )
  and exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and id = :'role_business_a'::uuid
       and name = 'Owner business role 041'
       and permissions = array['enterprise.view', 'orders.view']::text[]
  )
  and not exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and name in (
         'Employee business role 041',
         'Employee-renamed business role 041',
         'Direct backend business role 041',
         'Direct-renamed business role 041',
         'Legacy v2 business role 041',
         'Missing actor business role 041',
         'Unknown actor business role 041'
       )
  )
  and exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and name = 'Employee collaboration role 041'
       and permissions = array['enterprise.view']::text[]
  )
  and exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and id = :'role_downgrade_a'::uuid
       and permissions = array['enterprise.view']::text[]
  )
  and exists (
    select 1
      from public.merchant_enterprise_roles
     where merchant_id = '10000001'
       and name = 'Legacy v2 collaboration role 041'
       and permissions = array[
         'enterprise.view', 'workflows.view'
       ]::text[]
  ),
  'v3 business owner boundary did not remain atomic and collaboration-compatible'
);
