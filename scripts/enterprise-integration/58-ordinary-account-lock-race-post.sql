\set ON_ERROR_STOP on
\pset pager off

select enterprise_integration.assert_true(
  exists (
    select 1
      from auth.users
     where id = 'd6000000-0000-4000-8000-000000000001'::uuid
  )
    and (
      (
        exists (
          select 1
            from public.faolla_personal_accounts
           where auth_user_id =
             'd6000000-0000-4000-8000-000000000001'::uuid
        )
        and not exists (
          select 1
            from public.merchant_enterprise_staff_identities
           where auth_user_id =
             'd6000000-0000-4000-8000-000000000001'::uuid
        )
      )
      or (
        not exists (
          select 1
            from public.faolla_personal_accounts
           where auth_user_id =
             'd6000000-0000-4000-8000-000000000001'::uuid
        )
        and exists (
          select 1
            from public.merchant_enterprise_staff_identities
           where auth_user_id =
             'd6000000-0000-4000-8000-000000000001'::uuid
        )
      )
    ),
  'staff/ordinary race did not commit exactly one principal type'
);

select enterprise_integration.assert_true(
  (
    exists (
      select 1
        from auth.users
       where id = 'd6000000-0000-4000-8000-000000000002'::uuid
    )
    and exists (
      select 1
        from public.faolla_personal_accounts
       where auth_user_id =
         'd6000000-0000-4000-8000-000000000002'::uuid
    )
  )
  or (
    not exists (
      select 1
        from auth.users
       where id = 'd6000000-0000-4000-8000-000000000002'::uuid
    )
    and not exists (
      select 1
        from public.faolla_personal_accounts
       where auth_user_id =
         'd6000000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'new ordinary/Auth DELETE race left an orphan or phantom binding'
);

select enterprise_integration.assert_true(
  exists (
    select 1
      from auth.users
     where id = 'd6000000-0000-4000-8000-000000000003'::uuid
  )
    and exists (
      select 1
        from public.faolla_personal_accounts
       where auth_user_id =
         'd6000000-0000-4000-8000-000000000003'::uuid
        and personal_account_id = '50010107'
    ),
  'idempotent bootstrap/Auth DELETE race deleted a bound principal'
);

select enterprise_integration.assert_true(
  exists (
    select 1
      from auth.users
     where id = 'd3500000-0000-4000-8000-000000000001'::uuid
  )
    and not exists (
      select 1
        from public.faolla_personal_accounts
       where auth_user_id =
         'd3500000-0000-4000-8000-000000000001'::uuid
    )
    and not exists (
      select 1
        from public.merchant_enterprise_staff_identities
       where auth_user_id =
         'd3500000-0000-4000-8000-000000000001'::uuid
    )
    and not exists (
      select 1
        from public.merchants as merchant
       where merchant.id <> 'site-main'
         and 'd3500000-0000-4000-8000-000000000001'::uuid = any(array[
           merchant.user_id,
           merchant.auth_user_id,
           merchant.owner_user_id,
           merchant.owner_id,
           merchant.auth_id,
           merchant.created_by,
           merchant.created_by_user_id
         ]::uuid[])
    )
    and public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
      #>> '{security,systemSitePrincipalOverlapCount}' = '0',
  'concurrent system-site writers established an ordinary or staff identity'
);

\echo 'Ordinary-account lock race checks passed.'
