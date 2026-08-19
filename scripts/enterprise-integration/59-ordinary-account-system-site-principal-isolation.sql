\set ON_ERROR_STOP on
\pset pager off

-- The runner builds a production-shaped overlap and retries 037 before this
-- transaction. All behavioral probes below roll back, including temporary
-- grants and updated_at changes.
begin;

\set shared_ordinary_auth 'd3500000-0000-4000-8000-000000000001'
\set independent_system_auth 'd3500000-0000-4000-8000-000000000003'

select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.faolla_schema_migrations
    where version = 202608190037
      and name = 'ordinary_account_system_site_principal_isolation'),
  '037 isolation registry row is missing or conflicting'
);

select enterprise_integration.assert_true(
  (select user_id is null
          and auth_user_id is null
          and owner_user_id = :'independent_system_auth'::uuid
          and owner_id is null
          and auth_id is null
          and created_by is null
          and created_by_user_id is null
          and name = 'Platform system site'
          and email = 'owner-a@example.test'
     from public.merchants
    where id = 'site-main'),
  '037 did not selectively clear overlap aliases or preserve site content'
);

select enterprise_integration.assert_true(
  (select count(*) = 1
     from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'merchants'
      and policy.policyname =
        'merchants_system_site_principal_isolation'
      and policy.permissive = 'RESTRICTIVE'
      and policy.roles = array['authenticated']::name[]
      and policy.cmd = 'UPDATE'
      and regexp_replace(
        lower(coalesce(policy.qual, '')),
        '[[:space:]()]', '', 'g'
      ) = 'id<>''site-main''::text'
      and regexp_replace(
        lower(coalesce(policy.with_check, '')),
        '[[:space:]()]', '', 'g'
      ) = 'id<>''site-main''::text'),
  '037 restrictive site-main UPDATE policy catalog drifted'
);

select enterprise_integration.assert_true(
  (select count(*) = 1
     from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'merchants'
      and policy.policyname =
        'merchants_system_site_principal_insert_isolation'
      and policy.permissive = 'RESTRICTIVE'
      and policy.roles = array['authenticated']::name[]
      and policy.cmd = 'INSERT'
      and policy.qual is null
      and regexp_replace(
        lower(coalesce(policy.with_check, '')),
        '[[:space:]()]', '', 'g'
      ) = 'id<>''site-main''::text'),
  '037 restrictive site-main INSERT policy catalog drifted'
);

select enterprise_integration.assert_true(
  (select readiness #>> '{security,systemSitePrincipalOverlapCount}' = '0'
          and readiness #>> '{security,crossAccountTypeOverlapCount}' = '0'
          and readiness #>> '{security,accountIdentifierCollisionCount}' = '0'
          and readiness #>> '{security,staffRegistryOverlapCount}' = '0'
          and readiness #>> '{merchant,recordCount}' = '2'
          and readiness #>> '{merchant,authoritativeBindingCount}' = '1'
          and readiness #>> '{merchant,invalidBindingCount}' = '1'
          and readiness #>> '{personal,canonicalBindingCount}' = '0'
          and readiness #>> '{personal,canonicalOrphanCount}' = '0'
          and readiness #>> '{personal,invalidCanonicalCount}' = '0'
     from (
       select public
         .faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
           as readiness
     ) as current_state),
  '037 changed readiness outside the system-site overlap dimension'
);

select enterprise_integration.assert_true(
  has_table_privilege(
    'service_role', 'public.merchants', 'SELECT, INSERT, UPDATE'
  )
    and (select role_metadata.rolbypassrls
           from pg_catalog.pg_roles as role_metadata
          where role_metadata.rolname = 'service_role'),
  'service_role platform ACL or BYPASSRLS prerequisite is missing'
);

set role service_role;
select enterprise_integration.assert_true(
  public.faolla_resolve_ordinary_account_authorization_v1(
    :'shared_ordinary_auth'::uuid
  ) @> '{"status":"resolved","accountType":"merchant","merchantIds":["10000001"]}'::jsonb,
  'cleared overlap principal did not resolve to its ordinary merchant'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_resolve_ordinary_account_authorization_v1(%L::uuid)',
    :'independent_system_auth'
  ),
  'ordinary_account_system_site_forbidden'
);
reset role;

-- A missing sentinel must not let the still-additive authenticated INSERT
-- surface recreate site-main. Ordinary merchant insertion remains unchanged,
-- while the platform service role retains its privileged lifecycle path.
savepoint absent_site_insert_probes;
delete from public.merchants where id = 'site-main';
select set_config(
  'request.jwt.claim.sub', :'shared_ordinary_auth', true
);
select set_config(
  'request.jwt.claim.email', 'owner-a@example.test', true
);
set role authenticated;
select enterprise_integration.expect_error(
  format(
    'insert into public.merchants(id, name, user_id) values (%L, %L, %L::uuid)',
    'site-main', 'Forbidden authenticated sentinel', :'shared_ordinary_auth'
  ),
  'new row violates row-level security policy'
);
with inserted as (
  insert into public.merchants(id, name, user_id)
  values (
    '19880003', 'Allowed ordinary insert', :'shared_ordinary_auth'::uuid
  )
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 1,
  'authenticated ordinary merchant insert was blocked'
)
from inserted;
reset role;

set role service_role;
with inserted as (
  insert into public.merchants(id, name, owner_user_id)
  values (
    'site-main', 'Privileged platform sentinel',
    :'independent_system_auth'::uuid
  )
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 1,
  'service_role could not insert a missing site-main sentinel'
)
from inserted;
reset role;
rollback to savepoint absent_site_insert_probes;

select enterprise_integration.assert_true(
  (select user_id is null
          and auth_user_id is null
          and owner_user_id = :'independent_system_auth'::uuid
     from public.merchants
    where id = 'site-main'),
  'absent-site role probes did not roll back completely'
);

-- Email fallback deliberately remains until the later RLS cutover. The new
-- restrictive UPDATE policy must still turn that visible legacy row into a
-- non-updatable system sentinel.
select set_config(
  'request.jwt.claim.sub', :'shared_ordinary_auth', true
);
select set_config(
  'request.jwt.claim.email', 'owner-a@example.test', true
);
set role authenticated;
select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.merchants
    where id = 'site-main'),
  'legacy email fallback unexpectedly stopped reading site-main before cutover'
);
with updated as (
  update public.merchants
     set user_id = :'shared_ordinary_auth'::uuid
   where id = 'site-main'
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 0,
  'authenticated session updated site-main through legacy RLS'
)
from updated;
with updated as (
  update public.merchants
     set name = name
   where id = '10000001'
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 1,
  'authenticated ordinary merchant update was blocked'
)
from updated;
reset role;

select set_config(
  'request.jwt.claim.sub', :'independent_system_auth', true
);
select set_config(
  'request.jwt.claim.email', 'independent-system@example.test', true
);
set role authenticated;
select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.merchants
    where id = 'site-main'),
  'independent site alias was not preserved for legacy reads'
);
with updated as (
  update public.merchants
     set name = name
   where id = 'site-main'
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 0,
  'independent system alias bypassed the restrictive UPDATE policy'
)
from updated;
reset role;

set role service_role;
with updated as (
  update public.merchants
     set name = name
   where id = 'site-main'
  returning 1
)
select enterprise_integration.assert_true(
  count(*) = 1,
  'service_role could not update site-main despite BYPASSRLS'
)
from updated;
reset role;

select enterprise_integration.assert_true(
  (select user_id is null
          and auth_user_id is null
          and owner_user_id = :'independent_system_auth'::uuid
     from public.merchants
    where id = 'site-main'),
  'role probes reattached an overlap alias to site-main'
);

select enterprise_integration.assert_true(
  current_setting(
    'enterprise_integration.system_site_retry_updated_at_unchanged',
    true
  ) = 'true',
  'migration retry changed site-main updated_at'
);

select enterprise_integration.assert_true(
  current_setting(
    'enterprise_integration.system_site_absent_retry_verified',
    true
  ) = 'true',
  'migration retry with site-main absent was not verified'
);

rollback;
