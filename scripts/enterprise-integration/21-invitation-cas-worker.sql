\set ON_ERROR_STOP on
set role service_role;

select public.faolla_reserve_merchant_employee_invitation_v1(
  jsonb_build_object(
    'merchant_id', '10000001',
    'employee_id', (
      select id::text
        from public.merchant_enterprise_employees
       where merchant_id = '10000001'
         and email = 'cas-invite@example.test'
    ),
    'expected_version', 1,
    'token_hash', :'worker_token_hash',
    'expires_at', (now() + interval '1 day')::text,
    'actor_type', 'owner',
    'actor_id', '10000000-0000-4000-8000-000000000001'
  )
);
