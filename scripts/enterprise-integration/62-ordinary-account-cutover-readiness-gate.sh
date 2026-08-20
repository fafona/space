#!/usr/bin/env bash

assert_ordinary_readiness_status() {
  local expected_status="$1"
  echo "[enterprise-integration] expecting ordinary readiness ${expected_status}"
  FAOLLA_EXPECTED_READINESS_STATUS="${expected_status}" \
    node "${SCRIPT_DIR}/check-ordinary-account-cutover-readiness.mjs"
}

assert_ordinary_readiness_ready() {
  assert_ordinary_readiness_status ready
}

echo '[enterprise-integration] normalizing the disposable fixture to the production readiness contract'
run_psql <<'SQL'
alter table public.merchants owner to supabase_admin;
alter table public.faolla_personal_accounts owner to supabase_admin;

revoke all privileges on table public.merchants
  from public, anon, authenticated, service_role,
       redteam_custom_api, redteam_custom_child cascade;
grant select, insert, update on table public.merchants to authenticated;
revoke all privileges on table public.faolla_personal_accounts
  from public, anon, authenticated, service_role,
       redteam_custom_api, redteam_custom_child cascade;

alter function public.faolla_resolve_ordinary_account_authorization_v1(uuid)
  owner to supabase_admin;
alter function public.faolla_get_ordinary_account_authorization_readiness_v1()
  owner to supabase_admin;
alter function public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)
  owner to supabase_admin;
alter function public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)
  owner to supabase_admin;
alter function public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()
  owner to supabase_admin;
alter function public.faolla_observe_ordinary_account_recovery_v1(uuid,text)
  owner to supabase_admin;
alter function public.faolla_guard_personal_account_binding_v1()
  owner to supabase_admin;
alter function public.faolla_guard_staff_identity_ordinary_exclusion_v1()
  owner to supabase_admin;
alter function public.faolla_guard_auth_user_ordinary_account_delete_v1()
  owner to supabase_admin;

revoke all privileges on function
  public.faolla_resolve_ordinary_account_authorization_v1(uuid),
  public.faolla_get_ordinary_account_authorization_readiness_v1(),
  public.faolla_create_ordinary_account_authorization_v1(uuid,text,text),
  public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text),
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1(),
  public.faolla_observe_ordinary_account_recovery_v1(uuid,text),
  public.faolla_guard_personal_account_binding_v1(),
  public.faolla_guard_staff_identity_ordinary_exclusion_v1(),
  public.faolla_guard_auth_user_ordinary_account_delete_v1()
  from public, anon, authenticated, service_role,
       redteam_custom_api, redteam_custom_child cascade;
grant execute on function
  public.faolla_resolve_ordinary_account_authorization_v1(uuid),
  public.faolla_get_ordinary_account_authorization_readiness_v1(),
  public.faolla_create_ordinary_account_authorization_v1(uuid,text,text),
  public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text),
  public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1(),
  public.faolla_observe_ordinary_account_recovery_v1(uuid,text)
  to service_role;

insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001'::uuid,
   'owner-a@example.test', '{}'::jsonb, '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000002'::uuid,
   'owner-b@example.test', '{}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

update public.merchants
   set user_id = '10000000-0000-4000-8000-000000000001'::uuid,
       auth_user_id = '10000000-0000-4000-8000-000000000001'::uuid,
       owner_user_id = '10000000-0000-4000-8000-000000000001'::uuid,
       owner_id = '10000000-0000-4000-8000-000000000001'::uuid,
       auth_id = '10000000-0000-4000-8000-000000000001'::uuid,
       created_by = '10000000-0000-4000-8000-000000000001'::uuid,
       created_by_user_id = '10000000-0000-4000-8000-000000000001'::uuid
 where id = '10000001';
update public.merchants
   set user_id = '20000000-0000-4000-8000-000000000002'::uuid,
       auth_user_id = '20000000-0000-4000-8000-000000000002'::uuid,
       owner_user_id = '20000000-0000-4000-8000-000000000002'::uuid,
       owner_id = '20000000-0000-4000-8000-000000000002'::uuid,
       auth_id = '20000000-0000-4000-8000-000000000002'::uuid,
       created_by = '20000000-0000-4000-8000-000000000002'::uuid,
       created_by_user_id = '20000000-0000-4000-8000-000000000002'::uuid
 where id = '10000002';
SQL
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a guard body drift and restoring its exact definition'
run_psql <<'SQL'
create or replace function public.faolla_guard_personal_account_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return new;
end;
$$;
SQL
assert_ordinary_readiness_status blocked
run_psql <<'SQL'
create or replace function
  public.faolla_guard_personal_account_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'personal_account_binding_delete_forbidden';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id
     or new.personal_account_id is distinct from old.personal_account_id
     or new.created_at is distinct from old.created_at then
    raise exception 'personal_account_binding_identity_immutable';
  end if;
  if new.status is not distinct from old.status then
    raise exception 'personal_account_binding_status_transition_invalid';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'personal_account_binding_version_conflict';
  end if;
  new.updated_at := greatest(statement_timestamp(), old.updated_at);
  return new;
end;
$$;
SQL
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking observer ACL drift'
run_psql --command \
  "set role supabase_admin; grant execute on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) to authenticated;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "set role supabase_admin; revoke execute on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) from authenticated;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking exact restrictive-policy expression drift'
run_psql --command \
  "alter policy merchants_system_site_principal_isolation on public.merchants using (id <> 'site-main' and id <> 'redteam-readiness') with check (id <> 'site-main' and id <> 'redteam-readiness');"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter policy merchants_system_site_principal_isolation on public.merchants using (id <> 'site-main') with check (id <> 'site-main');"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking merchant TRUNCATE and custom table grants'
run_psql --command \
  "set role supabase_admin; grant truncate on table public.merchants to authenticated; grant select on table public.merchants to redteam_custom_api;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "set role supabase_admin; revoke truncate on table public.merchants from authenticated; revoke select on table public.merchants from redteam_custom_api;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a referenced 038 column rename'
run_psql --command \
  "alter table public.merchant_enterprise_employees rename column auth_user_id to auth_user_id_redteam_readiness;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter table public.merchant_enterprise_employees rename column auth_user_id_redteam_readiness to auth_user_id;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking exact personal CHECK-expression drift'
run_psql --command \
  "alter table public.faolla_personal_accounts drop constraint faolla_personal_accounts_personal_account_id_safe; alter table public.faolla_personal_accounts add constraint faolla_personal_accounts_personal_account_id_safe check (personal_account_id = btrim(personal_account_id) and char_length(personal_account_id) between 1 and 128 and octet_length(personal_account_id) <= 512 and personal_account_id !~ '[[:cntrl:]]' and personal_account_id !~ U&'[\007F-\009F]');"
assert_ordinary_readiness_status blocked
run_psql <<'SQL'
alter table public.faolla_personal_accounts
  drop constraint faolla_personal_accounts_personal_account_id_safe;
alter table public.faolla_personal_accounts
  add constraint faolla_personal_accounts_personal_account_id_safe
  check (
    personal_account_id = btrim(
      personal_account_id,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    and char_length(personal_account_id) between 1 and 128
    and octet_length(personal_account_id) <= 512
    and personal_account_id !~ '[[:cntrl:]]'
    and personal_account_id !~ U&'[\007F-\009F]'
  );
do $$
begin
  if (
    select pg_catalog.md5(pg_catalog.pg_get_expr(
      constraint_metadata.conbin,
      constraint_metadata.conrelid,
      false
    ))
      from pg_catalog.pg_constraint as constraint_metadata
     where constraint_metadata.conrelid =
       'public.faolla_personal_accounts'::regclass
       and constraint_metadata.conname =
         'faolla_personal_accounts_personal_account_id_safe'
  ) <> '6c6a7472c2d303e319253578fc2a745a' then
    raise exception 'ordinary_readiness_personal_safe_restore_hash_invalid';
  end if;
end;
$$;
SQL
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking an extra NOT VALID personal CHECK'
run_psql --command \
  "alter table public.faolla_personal_accounts add constraint redteam_personal_extra_check check (true) not valid;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter table public.faolla_personal_accounts drop constraint redteam_personal_extra_check;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a personal rule'
run_psql --command \
  "create rule redteam_personal_insert_rule as on insert to public.faolla_personal_accounts do also nothing;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "drop rule redteam_personal_insert_rule on public.faolla_personal_accounts;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a personal inheritance child'
run_psql --command \
  "create table public.redteam_personal_inheritance_child () inherits (public.faolla_personal_accounts);"
assert_ordinary_readiness_status blocked
run_psql --command \
  "drop table public.redteam_personal_inheritance_child;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking an unlogged registry'
run_psql --command \
  "alter table public.faolla_schema_migrations set unlogged;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter table public.faolla_schema_migrations set logged;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a registry rule'
run_psql --command \
  "create rule redteam_registry_insert_rule as on insert to public.faolla_schema_migrations do also nothing;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "drop rule redteam_registry_insert_rule on public.faolla_schema_migrations;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a deferrable registry primary key'
run_psql --command \
  "alter table public.faolla_schema_migrations drop constraint faolla_schema_migrations_pkey; alter table public.faolla_schema_migrations add constraint faolla_schema_migrations_pkey primary key (version) deferrable initially immediate;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter table public.faolla_schema_migrations drop constraint faolla_schema_migrations_pkey; alter table public.faolla_schema_migrations add constraint faolla_schema_migrations_pkey primary key (version) not deferrable;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking every public forbidden-binder signature'
run_psql --command \
  "create function public.faolla_bind_ordinary_account_authorization_v1(integer) returns integer language sql immutable as 'select \$1';"
assert_ordinary_readiness_status blocked
run_psql --command \
  "drop function public.faolla_bind_ordinary_account_authorization_v1(integer);"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a non-public unsafe function default ACL'
run_psql --command \
  "create schema redteam_readiness_defaults authorization supabase_admin; alter default privileges for role supabase_admin in schema redteam_readiness_defaults grant execute on functions to public;"
assert_ordinary_readiness_status blocked
run_psql --command \
  "alter default privileges for role supabase_admin in schema redteam_readiness_defaults revoke execute on functions from public; drop schema redteam_readiness_defaults;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] blocking a +1 merchant baseline drift and restoring -1'
run_psql <<'SQL'
insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
values ('30000000-0000-4000-8000-000000000003'::uuid,
        'baseline-drift@example.test', '{}'::jsonb, '{}'::jsonb);
insert into public.merchants(
  id, name, user_id, auth_user_id, owner_user_id, owner_id, auth_id,
  created_by, created_by_user_id
) values (
  '30000003', 'Baseline drift',
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid
);
SQL
assert_ordinary_readiness_status blocked
run_psql --command \
  "delete from public.merchants where id = '30000003'; delete from auth.users where id = '30000000-0000-4000-8000-000000000003'::uuid;"
assert_ordinary_readiness_ready

echo '[enterprise-integration] staying ready with hostile client GUCs and a public shadow'
PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" \
  assert_ordinary_readiness_ready
run_psql --command \
  "create function public.to_regrole(text) returns regrole language sql immutable as 'select null::regrole';"
PGOPTIONS="${PGOPTIONS} -c search_path=public,pg_catalog" \
  assert_ordinary_readiness_ready
run_psql --command "drop function public.to_regrole(text);"
assert_ordinary_readiness_ready

assert_ordinary_readiness_writer_waits() {
  local label="$1"
  local writer_statement="$2"
  local blocker_application="enterprise_readiness_${label}_catalog_blocker"
  local readiness_application="enterprise_readiness_${label}_gate"
  local writer_application="enterprise_readiness_${label}_writer"
  local blocker_log="${work_dir}/${label}-catalog-blocker.log"
  local readiness_log="${work_dir}/${label}-readiness.log"
  local writer_log="${work_dir}/${label}-writer.log"

  (
    run_psql --command \
      "set application_name = '${blocker_application}'; begin; lock table pg_catalog.pg_inherits in row exclusive mode; select pg_catalog.pg_sleep(30); rollback;"
  ) >"${blocker_log}" 2>&1 &
  local blocker_pid=$!
  wait_for_sql_true "${label} catalog blocker" \
    "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = '${blocker_application}' and lock_state.relation = 'pg_catalog.pg_inherits'::regclass and lock_state.mode = 'RowExclusiveLock' and lock_state.granted);"

  (
    PGAPPNAME="${readiness_application}" \
      FAOLLA_EXPECTED_READINESS_STATUS=ready \
      node "${SCRIPT_DIR}/check-ordinary-account-cutover-readiness.mjs"
  ) >"${readiness_log}" 2>&1 &
  local readiness_pid=$!
  wait_for_sql_true "${label} readiness business-lock barrier" \
    "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.application_name = '${readiness_application}' and 5 = (select count(*) from pg_catalog.pg_locks as business_lock where business_lock.pid = activity.pid and business_lock.relation in ('auth.users'::regclass, 'public.merchant_enterprise_employees'::regclass, 'public.merchant_enterprise_staff_identities'::regclass, 'public.faolla_personal_accounts'::regclass, 'public.merchants'::regclass) and business_lock.mode = 'ShareLock' and business_lock.granted) and exists (select 1 from pg_catalog.pg_locks as catalog_lock where catalog_lock.pid = activity.pid and catalog_lock.relation = 'pg_catalog.pg_inherits'::regclass and catalog_lock.mode = 'ShareRowExclusiveLock' and not catalog_lock.granted));"

  (
    run_psql --command \
      "set application_name = '${writer_application}'; ${writer_statement}"
  ) >"${writer_log}" 2>&1 &
  local writer_pid=$!
  wait_for_sql_true "${label} writer wait barrier" \
    "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = '${writer_application}' and lock_state.relation = 'public.merchants'::regclass and not lock_state.granted);"

  run_psql --command \
    "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name in ('${writer_application}', '${blocker_application}');" \
    >/dev/null
  set +e
  wait "${writer_pid}"
  wait "${blocker_pid}"
  set -e
  if ! wait "${readiness_pid}"; then
    echo "${label} readiness did not complete after the waiting writer was removed" >&2
    return 1
  fi
}

echo '[enterprise-integration] proving readiness-held locks block business DML'
assert_ordinary_readiness_writer_waits business_dml \
  "update public.merchants set name = name where id = '10000001';"
assert_ordinary_readiness_ready

echo '[enterprise-integration] proving readiness-held locks block ALTER POLICY'
assert_ordinary_readiness_writer_waits alter_policy \
  "alter policy merchants_select_own on public.merchants using (true);"
assert_ordinary_readiness_ready

echo '[enterprise-integration] ordinary-account cutover readiness drift matrix passed'
