\set ON_ERROR_STOP on
\pset pager off

-- Stage one is a shadow authorization source. Every synthetic binding and
-- readiness defect remains inside this transaction and is rolled back before
-- the later concurrency workers run.
begin;

create temporary table ordinary_account_readiness_baseline (
  payload jsonb not null
) on commit drop;

insert into ordinary_account_readiness_baseline (payload)
values (
  public.faolla_get_ordinary_account_authorization_readiness_v1()
);

insert into auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data
)
values
  ('a2000000-0000-4000-8000-000000000001'::uuid,
    'positive-owner@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000002'::uuid,
    'personal@example.test',
    '{"account_type":"personal","personal_id":"personal alpha-01"}'::jsonb,
    '{"account_type":"personal","personal_id":"personal alpha-01"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000003'::uuid,
    'unbound@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000004'::uuid,
    'conflict-a@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000005'::uuid,
    'conflict-b@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000007'::uuid,
    'duplicate-a@example.test',
    '{"account_type":"personal","personal_id":"duplicate-personal"}'::jsonb,
    '{"account_type":"personal","personal_id":"duplicate-personal"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000008'::uuid,
    'duplicate-b@example.test',
    '{"account_type":"personal","personal_id":"duplicate-personal"}'::jsonb,
    '{"account_type":"personal","personal_id":"duplicate-personal"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000009'::uuid,
    'divergent@example.test',
    '{"account_type":"personal","account_id":"legacy-account-priority","personal_id":"canonical-personal-priority"}'::jsonb,
    '{"account_type":"personal","account_id":"legacy-account-priority","personal_id":"canonical-personal-priority"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000010'::uuid,
    'staff-overlap@example.test',
    '{"principal_type":"merchant_staff"}'::jsonb,
    '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000011'::uuid,
    'cross-type@example.test',
    '{"account_type":"personal","personal_id":"personal-cross"}'::jsonb,
    '{"account_type":"personal","personal_id":"personal-cross"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000012'::uuid,
    'invalid-merchant-id@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000013'::uuid,
    'missing-personal-id@example.test',
    jsonb_build_object('account_type', E'\tpersonal\t'),
    jsonb_build_object('account_type', E'\tpersonal\t')),
  ('a2000000-0000-4000-8000-000000000014'::uuid,
    'unsafe-personal-id@example.test',
    jsonb_build_object(
      'account_type', 'personal', 'personal_id', E'unsafe\nid'
    ),
    jsonb_build_object(
      'account_type', 'personal', 'personal_id', E'unsafe\nid'
    )),
  ('a2000000-0000-4000-8000-000000000015'::uuid,
    'email-only@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000016'::uuid,
    'disabled-personal@example.test',
    '{"account_type":"personal","personal_id":"personal-disabled"}'::jsonb,
    '{"account_type":"personal","personal_id":"personal-disabled"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000017'::uuid,
    'explicit-merchant-residual-personal@example.test',
    '{"account_type":"merchant","account_id":"18000001","merchant_id":"18000001","personal_id":"personal-type-conflict"}'::jsonb,
    '{"account_type":"merchant","account_id":"18000001","merchant_id":"18000001","personal_id":"personal-type-conflict"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000018'::uuid,
    'forged-merchant-metadata@example.test', '{}'::jsonb,
    jsonb_build_object('merchant_id', E'\t18000001\t')),
  ('a2000000-0000-4000-8000-000000000019'::uuid,
    'multi-owner@example.test', '{}'::jsonb, '{}'::jsonb),
  ('a2000000-0000-4000-8000-000000000020'::uuid,
    'cross-identifier@example.test',
    '{"account_type":"personal","account_id":"18000001","personal_id":"18000001"}'::jsonb,
    '{"account_type":"personal","account_id":"18000001","personal_id":"18000001"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000021'::uuid,
    'numeric-json-alias@example.test',
    '{"account_type":"personal","account_id":42}'::jsonb,
    '{"account_type":"personal","account_id":42}'::jsonb);

insert into public.merchants (
  id, name, email, user_id, auth_user_id, owner_user_id, owner_id,
  auth_id, created_by, created_by_user_id
)
values
  ('18000001', 'Multi merchant A',
    U&'\00A0Multi-Owner@Example.Test\00A0',
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid),
  ('18000002', 'Multi merchant B',
    U&'\00A0Multi-Owner@Example.Test\00A0',
    'a2000000-0000-4000-8000-000000000001'::uuid,
    null, null, null, null, null, null),
  ('18000003', 'Conflicting aliases', 'conflict-a@example.test',
    'a2000000-0000-4000-8000-000000000004'::uuid,
    'a2000000-0000-4000-8000-000000000005'::uuid,
    null, null, null, null, null),
  ('18000004', 'Email only', 'email-only@example.test',
    null, null, null, null, null, null, null),
  ('18000005', 'Orphan UUID', 'orphan@example.test',
    'a2000000-0000-4000-8000-000000000006'::uuid,
    null, null, null, null, null, null),
  ('18000006', 'Staff overlap', 'staff-overlap@example.test',
    'a2000000-0000-4000-8000-000000000010'::uuid,
    null, null, null, null, null, null),
  ('18000007', 'Cross account type', 'cross-type@example.test',
    'a2000000-0000-4000-8000-000000000011'::uuid,
    null, null, null, null, null, null),
  ('merchant-invalid', 'Invalid merchant ID',
    'invalid-merchant-id@example.test',
    'a2000000-0000-4000-8000-000000000012'::uuid,
    null, null, null, null, null, null),
  ('18000008', 'Completely unbound', null,
    null, null, null, null, null, null, null);

insert into public.faolla_personal_accounts (
  auth_user_id, personal_account_id, status
)
values
  ('a2000000-0000-4000-8000-000000000002'::uuid,
    'personal alpha-01', 'active'),
  ('a2000000-0000-4000-8000-000000000009'::uuid,
    'canonical-personal-priority', 'active'),
  ('a2000000-0000-4000-8000-000000000011'::uuid,
    'personal-cross', 'disabled'),
  ('a2000000-0000-4000-8000-000000000016'::uuid,
    'personal-disabled', 'active'),
  ('a2000000-0000-4000-8000-000000000017'::uuid,
    'personal-type-conflict', 'active'),
  ('a2000000-0000-4000-8000-000000000020'::uuid,
    '18000001', 'active'),
  ('a2000000-0000-4000-8000-000000000021'::uuid,
    '42', 'active'),
  ('a2000000-0000-4000-8000-000000000022'::uuid,
    'personal-orphan', 'active');

update public.faolla_personal_accounts
   set status = 'disabled',
       version = version + 1
 where auth_user_id = 'a2000000-0000-4000-8000-000000000016'::uuid;

select enterprise_integration.assert_true(
  (select personal_account.status = 'disabled'
          and personal_account.version = 2
          and personal_account.updated_at >= personal_account.created_at
     from public.faolla_personal_accounts as personal_account
    where personal_account.auth_user_id =
      'a2000000-0000-4000-8000-000000000016'::uuid),
  'versioned personal binding disable transition was not applied atomically'
);

insert into public.merchant_enterprise_staff_identities (
  auth_user_id, email_hash
)
values (
  'a2000000-0000-4000-8000-000000000010'::uuid,
  repeat('d', 64)
);

-- The canonical table accepts bounded safe text rather than imposing the
-- legacy eight-digit personal range, while both directions remain unique.
select enterprise_integration.expect_error(
  $sql$
    insert into public.faolla_personal_accounts (
      auth_user_id, personal_account_id
    ) values (
      'a2000000-0000-4000-8000-000000000003'::uuid,
      'personal alpha-01'
    )
  $sql$,
  'duplicate key'
);
select enterprise_integration.expect_error(
  $sql$
    insert into public.faolla_personal_accounts (
      auth_user_id, personal_account_id
    ) values (
      'a2000000-0000-4000-8000-000000000002'::uuid,
      'another-personal-id'
    )
  $sql$,
  'duplicate key'
);
select enterprise_integration.expect_error(
  $sql$
    insert into public.faolla_personal_accounts (
      auth_user_id, personal_account_id
    ) values (
      'a2000000-0000-4000-8000-000000000003'::uuid,
      E'unsafe\nid'
    )
  $sql$,
  'faolla_personal_accounts_personal_account_id_safe'
);
select enterprise_integration.expect_error(
  $sql$
    insert into public.faolla_personal_accounts (
      auth_user_id, personal_account_id
    ) values (
      'a2000000-0000-4000-8000-000000000003'::uuid,
      U&'\00A0edge-personal-id\00A0'
    )
  $sql$,
  'faolla_personal_accounts_personal_account_id_safe'
);
select enterprise_integration.expect_error(
  $sql$
    insert into public.faolla_personal_accounts (
      auth_user_id, personal_account_id
    ) values (
      'a2000000-0000-4000-8000-000000000003'::uuid,
      U&'unsafe\0085id'
    )
  $sql$,
  'faolla_personal_accounts_personal_account_id_safe'
);
select enterprise_integration.expect_error(
  $sql$
    update public.faolla_personal_accounts
       set personal_account_id = 'tampered-personal',
           status = 'disabled',
           version = 2
     where auth_user_id =
       'a2000000-0000-4000-8000-000000000002'::uuid
  $sql$,
  'personal_account_binding_identity_immutable'
);
select enterprise_integration.expect_error(
  $sql$
    update public.faolla_personal_accounts
       set status = 'disabled',
           version = 3
     where auth_user_id =
       'a2000000-0000-4000-8000-000000000002'::uuid
  $sql$,
  'personal_account_binding_version_conflict'
);
select enterprise_integration.expect_error(
  $sql$
    delete from public.faolla_personal_accounts
     where auth_user_id =
       'a2000000-0000-4000-8000-000000000002'::uuid
  $sql$,
  'personal_account_binding_delete_forbidden'
);

set role service_role;

do $test$
declare
  v_payload jsonb;
begin
  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000001'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload = '{
      "schemaVersion":1,
      "status":"resolved",
      "accountType":"merchant",
      "merchantIds":["18000001","18000002"],
      "personalAccountId":null
    }'::jsonb,
    'one Auth owner did not retain every sorted merchant binding'
  );

  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000002'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload = '{
      "schemaVersion":1,
      "status":"resolved",
      "accountType":"personal",
      "merchantIds":[],
      "personalAccountId":"personal alpha-01"
    }'::jsonb,
    'safe non-eight-digit canonical personal binding was not resolved'
  );

  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000016'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload = '{
      "schemaVersion":1,
      "status":"disabled",
      "accountType":"personal",
      "merchantIds":[],
      "personalAccountId":"personal-disabled"
    }'::jsonb,
    'disabled personal binding remained positively authorized or became unbound'
  );

  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000003'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload #>> '{status}' = 'unbound'
      and v_payload -> 'accountType' = 'null'::jsonb
      and v_payload -> 'merchantIds' = '[]'::jsonb
      and v_payload -> 'personalAccountId' = 'null'::jsonb,
    'unbound Auth identity was not represented without a guessed account'
  );

  -- Matching a legacy email must never create a positive merchant binding.
  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000015'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload ->> 'status' = 'unbound',
    'email-only merchant row authorized an Auth user'
  );

  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000018'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload ->> 'status' = 'unbound',
    'legacy merchant metadata authorized an Auth user without a UUID binding'
  );

  v_payload := public.faolla_resolve_ordinary_account_authorization_v1(
    'a2000000-0000-4000-8000-000000000019'::uuid
  );
  perform enterprise_integration.assert_true(
    v_payload ->> 'status' = 'unbound',
    'another owner merchant email authorized an Auth user'
  );
end;
$test$;

select enterprise_integration.expect_error(
  $sql$
    select public.faolla_resolve_ordinary_account_authorization_v1(
      'a2000000-0000-4000-8000-000000000004'::uuid
    )
  $sql$,
  'ordinary_account_merchant_binding_conflict'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_resolve_ordinary_account_authorization_v1(
      'a2000000-0000-4000-8000-000000000010'::uuid
    )
  $sql$,
  'ordinary_account_staff_identity_forbidden'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_resolve_ordinary_account_authorization_v1(
      'a2000000-0000-4000-8000-000000000011'::uuid
    )
  $sql$,
  'ordinary_account_principal_type_conflict'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_resolve_ordinary_account_authorization_v1(
      'a2ff0000-0000-4000-8000-000000000099'::uuid
    )
  $sql$,
  'ordinary_account_auth_user_not_found'
);

reset role;

-- The readiness RPC is aggregate-only. Compare against the pre-fixture
-- snapshot so persistent acceptance merchants do not make this test brittle.
do $test$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select payload into v_before
    from ordinary_account_readiness_baseline;
  v_after :=
    public.faolla_get_ordinary_account_authorization_readiness_v1();

  perform enterprise_integration.assert_true(
    (v_after #>> '{merchant,recordCount}')::integer =
      (v_before #>> '{merchant,recordCount}')::integer + 9
      and (v_after #>> '{merchant,consistentBindingCount}')::integer =
        (v_before #>> '{merchant,consistentBindingCount}')::integer + 4
      and (v_after #>> '{merchant,multiMerchantAuthUserCount}')::integer =
        (v_before #>> '{merchant,multiMerchantAuthUserCount}')::integer + 1
      and (v_after #>> '{merchant,aliasConflictCount}')::integer =
        (v_before #>> '{merchant,aliasConflictCount}')::integer + 1
      and (v_after #>> '{merchant,emailOnlyCount}')::integer =
        (v_before #>> '{merchant,emailOnlyCount}')::integer + 1
      and (v_after #>> '{merchant,unboundCount}')::integer =
        (v_before #>> '{merchant,unboundCount}')::integer + 1
      and (v_after #>> '{merchant,orphanBindingCount}')::integer =
        (v_before #>> '{merchant,orphanBindingCount}')::integer + 1
      and (v_after #>> '{merchant,invalidMerchantIdCount}')::integer =
        (v_before #>> '{merchant,invalidMerchantIdCount}')::integer + 1
      and (v_after #>> '{merchant,metadataWithoutPositiveBindingAuthUserCount}')::integer =
        (v_before #>> '{merchant,metadataWithoutPositiveBindingAuthUserCount}')::integer + 2
      and (v_after #>> '{merchant,emailWithoutPositiveBindingAuthUserCount}')::integer =
        (v_before #>> '{merchant,emailWithoutPositiveBindingAuthUserCount}')::integer + 3
      and (v_after #>> '{merchant,legacyWithoutPositiveBindingAuthUserCount}')::integer =
        (v_before #>> '{merchant,legacyWithoutPositiveBindingAuthUserCount}')::integer + 5,
    'merchant readiness did not detect UUID, metadata, email, orphan, or multi-owner defects'
  );

  perform enterprise_integration.assert_true(
    (v_after #>> '{personal,canonicalBindingCount}')::integer =
      (v_before #>> '{personal,canonicalBindingCount}')::integer + 8
      and (v_after #>> '{personal,canonicalActiveBindingCount}')::integer =
        (v_before #>> '{personal,canonicalActiveBindingCount}')::integer + 6
      and (v_after #>> '{personal,canonicalDisabledBindingCount}')::integer =
        (v_before #>> '{personal,canonicalDisabledBindingCount}')::integer + 2
      and (v_after #>> '{personal,canonicalOrphanCount}')::integer =
        (v_before #>> '{personal,canonicalOrphanCount}')::integer + 1
      and (v_after #>> '{personal,metadataPrincipalCount}')::integer =
        (v_before #>> '{personal,metadataPrincipalCount}')::integer + 10
      and (v_after #>> '{personal,metadataWithoutCanonicalBindingCount}')::integer =
        (v_before #>> '{personal,metadataWithoutCanonicalBindingCount}')::integer + 4
      and (v_after #>> '{personal,canonicalWithoutMetadataCount}')::integer =
        (v_before #>> '{personal,canonicalWithoutMetadataCount}')::integer + 2
      and (v_after #>> '{personal,duplicateMetadataIdGroupCount}')::integer =
        (v_before #>> '{personal,duplicateMetadataIdGroupCount}')::integer + 1
      and (v_after #>> '{personal,metadataDivergenceCount}')::integer =
        (v_before #>> '{personal,metadataDivergenceCount}')::integer + 4
      and (v_after #>> '{personal,metadataTypeConflictCount}')::integer =
        (v_before #>> '{personal,metadataTypeConflictCount}')::integer + 1
      and (v_after #>> '{personal,metadataMissingIdCount}')::integer =
        (v_before #>> '{personal,metadataMissingIdCount}')::integer + 2
      and (v_after #>> '{personal,unsafeMetadataIdCount}')::integer =
        (v_before #>> '{personal,unsafeMetadataIdCount}')::integer + 1,
    'personal readiness did not exactly detect legacy parsing and canonical defects'
  );

  perform enterprise_integration.assert_true(
    (v_after #>> '{security,crossAccountTypeOverlapCount}')::integer =
      (v_before #>> '{security,crossAccountTypeOverlapCount}')::integer + 1
      and (v_after #>> '{security,accountIdentifierCollisionCount}')::integer =
        (v_before #>> '{security,accountIdentifierCollisionCount}')::integer + 1
      and (v_after #>> '{security,staffRegistryOverlapCount}')::integer =
        (v_before #>> '{security,staffRegistryOverlapCount}')::integer + 1
      and (v_after ->> 'readyForCutover')::boolean = false,
    'readiness did not block account-type, identifier, or staff overlap'
  );

  perform enterprise_integration.assert_true(
    position('a2000000-0000-4000-8000-000000000001' in v_after::text) = 0
      and position('multi-owner@example.test' in v_after::text) = 0
      and position('personal alpha-01' in v_after::text) = 0,
    'aggregate readiness response exposed an Auth UUID, email, or account ID'
  );
end;
$test$;

-- Neither the shadow table nor its definer RPCs are browser-accessible.
set role authenticated;
select enterprise_integration.expect_error(
  $sql$
    select * from public.faolla_personal_accounts
  $sql$,
  'permission denied for table'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_resolve_ordinary_account_authorization_v1(
      'a2000000-0000-4000-8000-000000000001'::uuid
    )
  $sql$,
  'permission denied for function'
);
select enterprise_integration.expect_error(
  $sql$
    select public.faolla_get_ordinary_account_authorization_readiness_v1()
  $sql$,
  'permission denied for function'
);
reset role;

set role service_role;
select enterprise_integration.expect_error(
  $sql$
    select * from public.faolla_personal_accounts
  $sql$,
  'permission denied for table'
);
reset role;

do $test$
begin
  perform enterprise_integration.assert_true(
    has_function_privilege(
      'service_role',
      'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
      'EXECUTE'
    )
      and has_function_privilege(
        'service_role',
        'public.faolla_get_ordinary_account_authorization_readiness_v1()',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.faolla_resolve_ordinary_account_authorization_v1(uuid)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'public.faolla_get_ordinary_account_authorization_readiness_v1()',
        'EXECUTE'
      ),
    'ordinary account RPC grants are not service-role only'
  );
  perform enterprise_integration.assert_true(
    not has_table_privilege(
      'service_role', 'public.faolla_personal_accounts', 'SELECT'
    )
      and not has_table_privilege(
        'authenticated', 'public.faolla_personal_accounts', 'SELECT'
      )
      and (select table_relation.relrowsecurity
             from pg_catalog.pg_class as table_relation
            where table_relation.oid =
              'public.faolla_personal_accounts'::regclass),
    'canonical personal binding table is not isolated behind RLS and grants'
  );
  perform enterprise_integration.assert_true(
    (select count(*) = 1
       from public.faolla_schema_migrations
      where version = 202608190035
        and name = 'ordinary_account_authorization_foundation'),
    'ordinary account authorization migration registry entry is missing or duplicated'
  );
  perform enterprise_integration.assert_true(
    (select index_metadata.indisready
            and index_metadata.indisvalid
            and index_metadata.indislive
            and index_metadata.indisunique
       from pg_catalog.pg_index as index_metadata
      where index_metadata.indexrelid =
        'public.faolla_personal_accounts_auth_user_id_uidx'::regclass)
      and
    (select index_metadata.indisready
            and index_metadata.indisvalid
            and index_metadata.indislive
            and index_metadata.indisunique
       from pg_catalog.pg_index as index_metadata
      where index_metadata.indexrelid =
        'public.faolla_personal_accounts_personal_account_id_uidx'::regclass),
    'ordinary account replacement indexes are not live, valid, and unique'
  );
end;
$test$;

rollback;
