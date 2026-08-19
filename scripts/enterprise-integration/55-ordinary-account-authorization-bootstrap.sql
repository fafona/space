\set ON_ERROR_STOP on
\pset pager off

-- Stage 2A is independently deployable. Keep every synthetic binding inside
-- this transaction so the later controlled backfill starts from production-
-- shaped data rather than test principals.
begin;

\set lower_personal_auth 'b3600000-0000-4000-8000-000000000001'
\set upper_personal_auth 'b3600000-0000-4000-8000-000000000002'
\set invalid_low_auth 'b3600000-0000-4000-8000-000000000003'
\set invalid_high_auth 'b3600000-0000-4000-8000-000000000004'
\set invalid_text_auth 'b3600000-0000-4000-8000-000000000005'
\set merchant_auth 'b3600000-0000-4000-8000-000000000006'
\set disabled_auth 'b3600000-0000-4000-8000-000000000007'
\set invalid_canonical_auth 'b3600000-0000-4000-8000-000000000008'
\set system_target_auth 'b3600000-0000-4000-8000-000000000009'
\set system_site_auth 'd3500000-0000-4000-8000-000000000001'

insert into auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data
)
values
  (:'lower_personal_auth'::uuid, 'personal-lower@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'upper_personal_auth'::uuid, 'personal-upper@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'invalid_low_auth'::uuid, 'personal-low-invalid@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'invalid_high_auth'::uuid, 'personal-high-invalid@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'invalid_text_auth'::uuid, 'personal-text-invalid@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'merchant_auth'::uuid, 'bootstrap-merchant@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'disabled_auth'::uuid, 'personal-disabled-stage2a@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'invalid_canonical_auth'::uuid, 'personal-canonical-invalid@example.test', '{}'::jsonb, '{}'::jsonb),
  (:'system_target_auth'::uuid, 'system-target-stage2a@example.test', '{}'::jsonb, '{}'::jsonb);

select enterprise_integration.assert_true(
  exists (select 1 from public.merchants where id = 'site-main'),
  'site-main platform sentinel fixture is missing'
);

set role service_role;

select enterprise_integration.assert_true(
  public.faolla_bootstrap_ordinary_account_authorization_v1(
    :'lower_personal_auth'::uuid,
    'personal'
  ) @> '{"status":"resolved","accountType":"personal","personalAccountId":"50010105"}'::jsonb,
  'personal allocator did not start at the frozen lower boundary'
);

select enterprise_integration.assert_true(
  public.faolla_create_ordinary_account_authorization_v1(
    :'upper_personal_auth'::uuid,
    'personal',
    '59999999'
  ) @> '{"status":"resolved","accountType":"personal","personalAccountId":"59999999"}'::jsonb,
  'explicit personal create rejected the frozen upper boundary'
);

select enterprise_integration.expect_error(
  format(
    'select public.faolla_create_ordinary_account_authorization_v1(%L::uuid, %L, %L)',
    :'invalid_low_auth', 'personal', '50010104'
  ),
  'invalid_ordinary_personal_id'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_create_ordinary_account_authorization_v1(%L::uuid, %L, %L)',
    :'invalid_high_auth', 'personal', '60000000'
  ),
  'invalid_ordinary_personal_id'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_create_ordinary_account_authorization_v1(%L::uuid, %L, %L)',
    :'invalid_text_auth', 'personal', 'personal-not-canonical'
  ),
  'invalid_ordinary_personal_id'
);

select enterprise_integration.assert_true(
  public.faolla_create_ordinary_account_authorization_v1(
    :'merchant_auth'::uuid,
    'merchant',
    '19880001'
  ) @> '{"status":"resolved","accountType":"merchant","merchantIds":["19880001"]}'::jsonb,
  'service-only explicit merchant create did not establish all UUID aliases'
);

select enterprise_integration.assert_true(
  public.faolla_create_ordinary_account_authorization_v1(
    :'disabled_auth'::uuid,
    'personal',
    '50010106'
  ) @> '{"status":"resolved","accountType":"personal","personalAccountId":"50010106"}'::jsonb,
  'disabled fixture canonical personal create failed'
);

reset role;

update public.faolla_personal_accounts
   set status = 'disabled',
       version = version + 1
 where auth_user_id = :'disabled_auth'::uuid;

select status as disabled_status, version::text as disabled_version
  from public.faolla_personal_accounts
 where auth_user_id = :'disabled_auth'::uuid
\gset

set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_bootstrap_ordinary_account_authorization_v1(%L::uuid, %L)',
    :'disabled_auth', 'personal'
  ),
  'ordinary_account_personal_disabled'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_create_ordinary_account_authorization_v1(%L::uuid, %L, %L)',
    :'disabled_auth', 'personal', '50010106'
  ),
  'ordinary_account_personal_disabled'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_resolve_ordinary_account_authorization_v1(%L::uuid)',
    :'system_site_auth'
  ),
  'ordinary_account_system_site_forbidden'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_bootstrap_ordinary_account_authorization_v1(%L::uuid, %L)',
    :'system_site_auth', 'merchant'
  ),
  'ordinary_account_system_site_forbidden'
);
select enterprise_integration.expect_error(
  format(
    'select public.faolla_create_ordinary_account_authorization_v1(%L::uuid, %L, %L)',
    :'system_target_auth', 'merchant', 'site-main'
  ),
  'ordinary_account_system_site_forbidden'
);
reset role;

select enterprise_integration.expect_error(
  format(
    'insert into public.merchant_enterprise_staff_identities(auth_user_id, email_hash) values (%L::uuid, %L)',
    :'system_site_auth', repeat('9', 64)
  ),
  'merchant_enterprise_staff_identity_conflict'
);

savepoint system_site_merchant_overlap;
insert into public.merchants (
  id, name, user_id, auth_user_id, owner_user_id, owner_id,
  auth_id, created_by, created_by_user_id
) values (
  '19880002', 'Forbidden system overlap',
  :'system_site_auth'::uuid, :'system_site_auth'::uuid,
  :'system_site_auth'::uuid, :'system_site_auth'::uuid,
  :'system_site_auth'::uuid, :'system_site_auth'::uuid,
  :'system_site_auth'::uuid
);
select enterprise_integration.assert_true(
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    #>> '{security,systemSitePrincipalOverlapCount}' = '1'
    and not (
      public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
        ->> 'readyForCutover'
    )::boolean,
  'authoritative readiness did not hard-block a system/merchant overlap'
);
rollback to savepoint system_site_merchant_overlap;

savepoint system_site_personal_overlap;
insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
) values (
  :'system_site_auth'::uuid, '50010107', 'active'
);
select enterprise_integration.assert_true(
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    #>> '{security,systemSitePrincipalOverlapCount}' = '1'
    and not (
      public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
        ->> 'readyForCutover'
    )::boolean,
  'authoritative readiness did not hard-block a system/personal overlap'
);
rollback to savepoint system_site_personal_overlap;

-- Simulate a staff row that predates 036 (or a privileged legacy writer that
-- bypassed the new ALWAYS guard). Cutover readiness must still discover and
-- hard-block the system principal from entering the employee permission plane.
savepoint system_site_legacy_staff_overlap;
alter table public.merchant_enterprise_staff_identities
  disable trigger merchant_enterprise_staff_ordinary_exclusion;
insert into public.merchant_enterprise_staff_identities (
  auth_user_id, email_hash
) values (
  :'system_site_auth'::uuid, repeat('8', 64)
);
select enterprise_integration.assert_true(
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    #>> '{security,systemSitePrincipalOverlapCount}' = '1'
    and not (
      public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
        ->> 'readyForCutover'
    )::boolean,
  'authoritative readiness did not hard-block a legacy system/staff overlap'
);
rollback to savepoint system_site_legacy_staff_overlap;

select enterprise_integration.assert_true(
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    #>> '{security,systemSitePrincipalOverlapCount}' = '0',
  'rolled-back system-site overlap remained visible to readiness'
);

-- The system-site alias is intentionally outside the ordinary guard domain.
-- Its lifecycle remains owned by privileged platform operations, so the
-- ordinary Auth-delete trigger must neither classify nor mutate it.
delete from auth.users where id = :'system_site_auth'::uuid;
select enterprise_integration.assert_true(
  not exists (
    select 1 from auth.users where id = :'system_site_auth'::uuid
  )
    and exists (
      select 1 from public.merchants where id = 'site-main'
    ),
  'ordinary Auth-delete guard treated site-main as an ordinary merchant'
);

select enterprise_integration.assert_true(
  (select status = :'disabled_status'
          and version::text = :'disabled_version'
     from public.faolla_personal_accounts
    where auth_user_id = :'disabled_auth'::uuid),
  'disabled create/bootstrap changed status or version'
);

select enterprise_integration.expect_error(
  format(
    'insert into public.merchant_enterprise_staff_identities(auth_user_id, email_hash) values (%L::uuid, %L)',
    :'merchant_auth', repeat('6', 64)
  ),
  'merchant_enterprise_staff_identity_conflict'
);
select enterprise_integration.expect_error(
  format('delete from auth.users where id = %L::uuid', :'merchant_auth'),
  'ordinary_account_auth_user_delete_forbidden'
);

create temporary table authoritative_before_invalid (
  payload jsonb not null
) on commit drop;
insert into authoritative_before_invalid(payload)
values (
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
);

-- 035 keeps a broad discovery constraint, so inject an otherwise-safe row
-- just below the product range and prove Stage 2A classifies it as a hard
-- canonical blocker. The enclosing transaction rolls it back atomically.
insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
) values (
  :'invalid_canonical_auth'::uuid, '50010104', 'active'
);

select enterprise_integration.assert_true(
  not (
    public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
      ->> 'readyForCutover'
  )::boolean
    and (
      public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
        #>> '{personal,canonicalBindingCount}'
    )::integer = (
      select (payload #>> '{personal,canonicalBindingCount}')::integer + 1
        from authoritative_before_invalid
    )
    and (
      public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
        #>> '{personal,invalidCanonicalCount}'
    )::integer = (
      select (payload #>> '{personal,invalidCanonicalCount}')::integer + 1
        from authoritative_before_invalid
    ),
  'authoritative readiness did not hard-block an out-of-range canonical personal ID'
);

set role service_role;
select enterprise_integration.expect_error(
  format(
    'select public.faolla_resolve_ordinary_account_authorization_v1(%L::uuid)',
    :'invalid_canonical_auth'
  ),
  'ordinary_account_personal_binding_conflict'
);
reset role;

select enterprise_integration.assert_true(
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
    #>> '{invariants,schemaReady}' = 'true'
    and public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
      #>> '{invariants,aclReady}' = 'true'
    and not has_table_privilege(
      'authenticated', 'public.faolla_personal_accounts', 'INSERT'
    )
    and not has_function_privilege(
      'authenticated',
      'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)',
      'EXECUTE'
    ),
  'Stage 2A schema or service-only ACL invariants drifted'
);

select enterprise_integration.assert_true(
  (select count(*) = 1
     from public.faolla_schema_migrations
    where version = 202608190036
      and name = 'ordinary_account_authorization_bootstrap')
    and not exists (
      select 1
        from public.faolla_schema_migrations
       where version = 202608190037
    ),
  'Stage 2A acceptance did not run before the Stage 2C cutover registry row'
);

rollback;
