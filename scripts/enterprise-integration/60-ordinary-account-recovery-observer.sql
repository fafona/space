\set ON_ERROR_STOP on
\pset pager off

-- Every synthetic observation rolls back. The service-role probes deliberately
-- prove that the protected tables still return 42501 while the SECURITY
-- DEFINER observer can return only bounded aggregate counts.
begin;

\set target_auth 'e3800000-0000-4000-8000-000000000001'
\set other_auth 'e3800000-0000-4000-8000-000000000002'
\set target_personal_id '50010105'
\set other_personal_id '50010106'

insert into auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data
) values
  (:'target_auth'::uuid, 'recovery-observer-target@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'other_auth'::uuid, 'recovery-observer-other@example.test', '{}'::jsonb, '{}'::jsonb);

select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.faolla_schema_migrations
    where version = 202608190038
      and name = 'ordinary_account_recovery_observer'),
  '038 recovery observer registry row is missing or conflicting'
);

select enterprise_integration.assert_true(
  (select function_metadata.proowner = current_user::regrole
          and function_metadata.prosecdef
          and function_metadata.prokind = 'f'
          and not function_metadata.proretset
          and function_metadata.prorettype = 'jsonb'::regtype
          and function_metadata.provolatile = 's'
          and function_metadata.proconfig is not distinct from
            array['search_path=pg_catalog, public']::text[]
     from pg_catalog.pg_proc as function_metadata
    where function_metadata.oid = to_regprocedure(
      'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)'
    )),
  '038 recovery observer function catalog drifted'
);

select enterprise_integration.assert_true(
  has_function_privilege(
    'service_role',
    'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)',
      'EXECUTE'
    )
    and not exists (
      select 1
        from pg_catalog.pg_proc as function_metadata
        cross join lateral pg_catalog.aclexplode(coalesce(
          function_metadata.proacl,
          pg_catalog.acldefault('f', function_metadata.proowner)
        )) as function_acl
        left join pg_catalog.pg_roles as allowed_role
          on allowed_role.rolname = 'service_role'
       where function_metadata.oid = to_regprocedure(
         'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)'
       )
         and function_acl.privilege_type = 'EXECUTE'
         and function_acl.grantee <> function_metadata.proowner
         and function_acl.grantee <> allowed_role.oid
    ),
  '038 recovery observer EXECUTE ACL is not owner plus service_role only'
);

set role service_role;

select enterprise_integration.expect_error(
  'select auth_user_id from public.faolla_personal_accounts limit 1',
  'permission denied for table faolla_personal_accounts'
);
select enterprise_integration.expect_error(
  'select auth_user_id from public.merchant_enterprise_staff_identities limit 1',
  'permission denied for table merchant_enterprise_staff_identities'
);

select public.faolla_observe_ordinary_account_recovery_v1(
  :'target_auth'::uuid,
  :'target_personal_id'
) as unbound_observation
\gset

select enterprise_integration.assert_true(
  (select count(*) = 10
     from jsonb_object_keys(:'unbound_observation'::jsonb))
    and (:'unbound_observation'::jsonb ->> 'schemaVersion')::integer = 1
    and not exists (
      select 1
        from jsonb_each(:'unbound_observation'::jsonb) as envelope(key, value)
       where envelope.key <> 'schemaVersion'
         and (
           jsonb_typeof(envelope.value) <> 'number'
           or (envelope.value #>> '{}')::integer <> 0
         )
    )
    and not (:'unbound_observation' like '%' || :'target_auth' || '%')
    and not (:'unbound_observation' like '%' || :'target_personal_id' || '%'),
  'unbound recovery observation was not the exact PII-free zero envelope'
);

select enterprise_integration.expect_error(
  format(
    'select public.faolla_observe_ordinary_account_recovery_v1(%L::uuid, %L)',
    :'target_auth', 'not-an-id'
  ),
  'ordinary_account_recovery_observer_invalid_query'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_observe_ordinary_account_recovery_v1(%L::uuid, %L)',
    :'target_auth', '50010104'
  ),
  'ordinary_account_recovery_observer_invalid_query'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_observe_ordinary_account_recovery_v1(%L::uuid, %L)',
    'e3800000-0000-4000-8000-000000000099', :'target_personal_id'
  ),
  'ordinary_account_recovery_observer_auth_user_not_found'
);

reset role;

savepoint malformed_readiness;
create or replace function
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select '{
    "schemaVersion": "1",
    "invariants": {"schemaReady": "true", "aclReady": "true"},
    "security": {"systemSitePrincipalOverlapCount": "0"}
  }'::jsonb
$$;
set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_observe_ordinary_account_recovery_v1(%L::uuid, %L)',
    :'target_auth', :'target_personal_id'
  ),
  'ordinary_account_recovery_observer_readiness_invalid'
);
reset role;
rollback to savepoint malformed_readiness;

set role anon;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_observe_ordinary_account_recovery_v1(%L::uuid, %L)',
    :'target_auth', :'target_personal_id'
  ),
  'permission denied for function faolla_observe_ordinary_account_recovery_v1'
);
reset role;

savepoint non_site_merchant_conflict;
insert into public.merchants (
  id, name, user_id, auth_user_id, owner_user_id, owner_id,
  auth_id, created_by, created_by_user_id
) values (
  '19880004', 'Recovery observer merchant conflict',
  :'target_auth'::uuid, :'target_auth'::uuid, :'target_auth'::uuid,
  :'target_auth'::uuid, :'target_auth'::uuid, :'target_auth'::uuid,
  :'target_auth'::uuid
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"merchantBindingCount":1,"systemSiteBindingCount":0}'::jsonb,
  'observer missed the target non-site merchant alias conflict'
);
reset role;
rollback to savepoint non_site_merchant_conflict;

savepoint system_site_conflict;
update public.merchants
   set user_id = :'target_auth'::uuid
 where id = 'site-main';
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"merchantBindingCount":0,"systemSiteBindingCount":1}'::jsonb,
  'observer missed the target site-main alias conflict'
);
reset role;
rollback to savepoint system_site_conflict;

savepoint staff_conflict;
insert into public.merchant_enterprise_staff_identities (
  auth_user_id, email_hash
) values (
  :'target_auth'::uuid, repeat('a', 64)
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"staffBindingCount":1,"employeeBindingCount":0}'::jsonb,
  'observer missed the exact staff-registry UUID conflict'
);
reset role;
rollback to savepoint staff_conflict;

savepoint employee_conflict;
insert into public.merchant_enterprise_employees (
  merchant_id, auth_user_id, email, display_name, status
) values (
  '10000001', :'target_auth'::uuid,
  'recovery-observer-target@example.test',
  'Recovery Observer Target', 'invited'
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"staffBindingCount":1,"employeeBindingCount":1}'::jsonb,
  'observer missed the exact employee and synchronized staff UUID conflict'
);
reset role;
rollback to savepoint employee_conflict;

savepoint merchant_identifier_conflict;
insert into public.merchants (id, name)
values (:'target_personal_id', 'Recovery observer identifier conflict');
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"accountIdentifierCollisionCount":1}'::jsonb,
  'observer missed the exact merchant ID namespace collision'
);
reset role;
rollback to savepoint merchant_identifier_conflict;

savepoint other_personal_claimant;
insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
) values (
  :'other_auth'::uuid, :'target_personal_id', 'active'
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"personalAuthBindingCount":0,"personalIdBindingCount":1,"personalOtherAuthBindingCount":1,"exactCanonicalBindingCount":0}'::jsonb,
  'observer missed the exact personal ID claimant on another Auth UUID'
);
reset role;
rollback to savepoint other_personal_claimant;

savepoint target_other_personal;
insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
) values (
  :'target_auth'::uuid, :'other_personal_id', 'active'
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"personalAuthBindingCount":1,"personalIdBindingCount":0,"personalOtherAuthBindingCount":0,"exactCanonicalBindingCount":0}'::jsonb,
  'observer missed the target Auth UUID bound to another personal ID'
);
reset role;
rollback to savepoint target_other_personal;

savepoint exact_personal_binding;
insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
) values (
  :'target_auth'::uuid, :'target_personal_id', 'active'
);
set role service_role;
select enterprise_integration.assert_true(
  public.faolla_observe_ordinary_account_recovery_v1(
    :'target_auth'::uuid, :'target_personal_id'
  ) @> '{"personalAuthBindingCount":1,"personalIdBindingCount":1,"personalOtherAuthBindingCount":0,"exactCanonicalBindingCount":1}'::jsonb,
  'observer did not return the exact active canonical recovery binding'
);
reset role;
rollback to savepoint exact_personal_binding;

rollback;
