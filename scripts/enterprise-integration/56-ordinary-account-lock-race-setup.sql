\set ON_ERROR_STOP on
\pset pager off

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    'd6000000-0000-4000-8000-000000000001'::uuid,
    'ordinary-staff-race@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'ordinary-delete-race@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'd6000000-0000-4000-8000-000000000003'::uuid,
    'bound-delete-race@example.test',
    '{}'::jsonb,
    '{}'::jsonb
  );

set role service_role;
select public.faolla_create_ordinary_account_authorization_v1(
  'd6000000-0000-4000-8000-000000000003'::uuid,
  'personal',
  '50010107'
);
reset role;

\echo 'Ordinary-account lock race fixtures created.'
