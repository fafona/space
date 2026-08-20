#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:?Set ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 after creating an empty test database}"

if [[ "${ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE}" != 1 ]]; then
  echo 'ENTERPRISE_INTEGRATION_ALLOW_DISPOSABLE_DATABASE must equal 1' >&2
  exit 1
fi

export PGOPTIONS="-c lc_messages=C -c statement_timeout=60000 -c lock_timeout=15000 ${PGOPTIONS:-}"
PSQL_BASE=(psql -X --set ON_ERROR_STOP=1 --no-psqlrc)

run_psql() {
  "${PSQL_BASE[@]}" "$@" "${DATABASE_URL}"
}

capture_ordinary_identity_content_sha256() {
  node "${REPOSITORY_ROOT}/scripts/ordinary-account-identity-content-contract.mjs" \
    --select-sql | run_psql --tuples-only --no-align --file -
}

existing_relations="$(
  run_psql --tuples-only --no-align --command \
    "select count(*) from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace where namespace.nspname not in ('pg_catalog', 'information_schema') and namespace.nspname !~ '^pg_toast' and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f');"
)"
if [[ "${existing_relations}" -ne 0 ]]; then
  echo "Refusing to run against a non-empty database (${existing_relations} user relation(s) found)" >&2
  exit 1
fi

run_sql_file() {
  local file="$1"
  echo "[enterprise-integration] applying ${file#"${REPOSITORY_ROOT}/"}"
  run_psql --file "${file}"
}

expect_sql_file_error() {
  local file="$1"
  local expected_message="$2"
  local output
  echo "[enterprise-integration] expecting ${expected_message} from ${file#"${REPOSITORY_ROOT}/"}"
  if output="$(run_psql --file "${file}" 2>&1)"; then
    echo "Expected migration failure containing ${expected_message}" >&2
    exit 1
  fi
  if [[ "${output}" != *"${expected_message}"* ]]; then
    echo "Expected migration failure containing ${expected_message}, got:" >&2
    echo "${output}" >&2
    exit 1
  fi
}

run_sql_file_as_role() {
  local file="$1"
  local role="$2"
  echo "[enterprise-integration] applying ${file#"${REPOSITORY_ROOT}/"} as ${role}"
  run_psql --command "set role \"${role}\"" --file "${file}"
}

expect_sql_file_error_as_role() {
  local file="$1"
  local role="$2"
  local expected_message="$3"
  local output
  echo "[enterprise-integration] expecting ${expected_message} from ${file#"${REPOSITORY_ROOT}/"} as ${role}"
  if output="$(run_psql --command "set role \"${role}\"" --file "${file}" 2>&1)"; then
    echo "Expected migration failure containing ${expected_message}" >&2
    exit 1
  fi
  if [[ "${output}" != *"${expected_message}"* ]]; then
    echo "Expected migration failure containing ${expected_message}, got:" >&2
    echo "${output}" >&2
    exit 1
  fi
}

wait_for_sql_true() {
  local label="$1"
  local query="$2"
  local attempt result
  for ((attempt = 1; attempt <= 200; attempt += 1)); do
    result="$(run_psql --tuples-only --no-align --command "${query}")"
    if [[ "${result}" == 't' ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for ${label}" >&2
  return 1
}

assert_rpc_acl_catalog_writer_waits() {
  local application_name="$1"
  local catalog_name="$2"
  local statement="$3"
  local writer_log writer_pid
  writer_log="$(mktemp)"
  rpc_acl_temp_logs+=("${writer_log}")
  (
    run_psql --command \
      "set application_name = '${application_name}'; ${statement}"
  ) >"${writer_log}" 2>&1 &
  writer_pid=$!
  rpc_acl_background_pids+=("${writer_pid}")
  wait_for_sql_true "${catalog_name} RowExclusive wait barrier" \
    "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = '${application_name}' and lock_state.relation = ('pg_catalog.${catalog_name}'::regclass) and lock_state.mode = 'RowExclusiveLock' and not lock_state.granted);"
  run_psql --command \
    "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = '${application_name}';" \
    >/dev/null
  if wait "${writer_pid}"; then
    echo "${catalog_name} writer unexpectedly completed through the catalog gate" >&2
    exit 1
  fi
  rm -f -- "${writer_log}"
}

rpc_acl_background_pids=()
rpc_acl_temp_logs=()
cleanup_rpc_acl_early_processes() {
  run_psql --command \
    "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where (application_name in ('enterprise_rpc_acl_gate_039', 'enterprise_rpc_acl_ddl_first_039', 'enterprise_rpc_acl_database_owner_039', 'enterprise_rpc_acl_cross_database_039', 'enterprise_rpc_acl_controlled_writer_039', 'enterprise_rpc_acl_registry_blocker_039', 'enterprise_rpc_acl_migration_barrier_039', 'enterprise_rpc_acl_second_migration_039', 'enterprise_rpc_acl_postlock_ddl_039') or application_name like 'enterprise_rpc_acl_catalog_%_039') and pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  if [[ "$(run_psql --tuples-only --no-align --command \
    "select exists (select 1 from pg_catalog.pg_prepared_xacts where gid = 'enterprise_rpc_acl_prepared_039');" \
    2>/dev/null || true)" == 't' ]]; then
    run_psql --command "rollback prepared 'enterprise_rpc_acl_prepared_039';" \
      >/dev/null 2>&1 || true
  fi
  run_psql --command \
    "drop database if exists enterprise_rpc_acl_shared_039 with (force);" \
    >/dev/null 2>&1 || true
  run_psql --command \
    "drop function if exists public.redteam_rpc_acl_proc_probe_039(); drop function if exists public.faolla_rpc_acl_postlock_canary_039(); drop type if exists public.redteam_rpc_acl_type_probe_039;" \
    >/dev/null 2>&1 || true
  run_psql --command \
    "drop role if exists redteam_rpc_acl_database_owner_039;" \
    >/dev/null 2>&1 || true
  local background_pid temporary_log
  for background_pid in "${rpc_acl_background_pids[@]}"; do
    kill "${background_pid}" >/dev/null 2>&1 || true
  done
  for temporary_log in "${rpc_acl_temp_logs[@]}"; do
    rm -f -- "${temporary_log}" || true
  done
}
trap cleanup_rpc_acl_early_processes EXIT

run_pre_cutover_acceptance() {
  run_sql_file "${SCRIPT_DIR}/40-workflow-acceptance.sql"
  run_sql_file "${SCRIPT_DIR}/43-workflow-archive-pagination.sql"
  run_sql_file "${SCRIPT_DIR}/46-workflow-execution.sql"
  run_sql_file "${SCRIPT_DIR}/47-workflow-revisions.sql"
  run_sql_file "${SCRIPT_DIR}/48-task-workflow-binding.sql"
  run_sql_file "${SCRIPT_DIR}/49-enterprise-todos.sql"
  run_sql_file "${SCRIPT_DIR}/50-workflow-automations.sql"
  run_sql_file "${SCRIPT_DIR}/51-audit-query-security.sql"
  run_sql_file "${SCRIPT_DIR}/52-invitation-delivery-outbox.sql"
  run_sql_file "${SCRIPT_DIR}/53-current-operations.sql"
  run_sql_file "${SCRIPT_DIR}/55-ordinary-account-authorization-bootstrap.sql"
}

run_sql_file "${SCRIPT_DIR}/00-supabase-stubs.sql"
run_psql --command \
  "create schema if not exists auth; create table if not exists auth.users (id uuid primary key, email text null, raw_app_meta_data jsonb not null default '{}'::jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-init.sql"
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250001_core_transaction_foundation.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250002_order_shadow_write_rpc.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250003_membership_ledger_shadow_write_rpc.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250004_booking_shadow_write_rpc.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250005_coupon_shadow_write_rpc.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250006_conversation_shadow_write_rpc.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250007_reliable_outbox_runtime.sql" supabase_admin
run_sql_file_as_role "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250008_scoped_outbox_claim.sql" supabase_admin

mapfile -t enterprise_migrations < <(
  find "${REPOSITORY_ROOT}/scripts/supabase-migrations" -maxdepth 1 -type f \
    \( -name '*_merchant_enterprise_*.sql' -o -name '*_merchant_order_task_link.sql' -o -name '*_ordinary_account_authorization_*.sql' -o -name '*_ordinary_account_system_site_principal_isolation.sql' -o -name '*_ordinary_account_recovery_observer.sql' -o -name '*_runtime_rpc_execute_acl_hardening.sql' \) \
    -print | sort
)

isolation_migration_path="${REPOSITORY_ROOT}/scripts/supabase-migrations/202608190037_ordinary_account_system_site_principal_isolation.sql"
recovery_observer_migration_path="${REPOSITORY_ROOT}/scripts/supabase-migrations/202608190038_ordinary_account_recovery_observer.sql"
rpc_acl_hardening_migration_path="${REPOSITORY_ROOT}/scripts/supabase-migrations/202608190039_runtime_rpc_execute_acl_hardening.sql"
cutover_migration_path="${REPOSITORY_ROOT}/scripts/supabase-migrations/202608190037_ordinary_account_authorization_cutover.sql"
expected_enterprise_migration_count=31
expected_registry_count=39
isolation_present=0
recovery_observer_present=0
rpc_acl_hardening_present=0
cutover_present=0
if [[ -f "${isolation_migration_path}" ]]; then
  expected_enterprise_migration_count=32
  expected_registry_count=40
  isolation_present=1
fi
if [[ -f "${recovery_observer_migration_path}" ]]; then
  if [[ "${isolation_present}" -ne 1 ]]; then
    echo 'Recovery observer 038 requires the exact 037 isolation migration' >&2
    exit 1
  fi
  expected_enterprise_migration_count=$((expected_enterprise_migration_count + 1))
  expected_registry_count=41
  recovery_observer_present=1
fi
if [[ -f "${rpc_acl_hardening_migration_path}" ]]; then
  if [[ "${recovery_observer_present}" -ne 1 ]]; then
    echo 'Runtime RPC ACL hardening 039 requires the exact 038 recovery observer migration' >&2
    exit 1
  fi
  expected_enterprise_migration_count=$((expected_enterprise_migration_count + 1))
  expected_registry_count=42
  rpc_acl_hardening_present=1
fi
if [[ -f "${cutover_migration_path}" ]]; then
  if [[ "${isolation_present}" -eq 1 ]]; then
    echo 'Refusing colliding 202608190037 isolation and cutover migrations' >&2
    exit 1
  fi
  expected_enterprise_migration_count=32
  expected_registry_count=40
  cutover_present=1
fi

if [[ "${#enterprise_migrations[@]}" -ne "${expected_enterprise_migration_count}" ]]; then
  echo "Expected ${expected_enterprise_migration_count} enterprise/identity migrations (001-026 plus staged 032-039), found ${#enterprise_migrations[@]}" >&2
  printf '  %s\n' "${enterprise_migrations[@]}" >&2
  exit 1
fi

pre_cutover_acceptance_ran=0
isolation_retry_updated_at_unchanged=0
isolation_absent_site_retry_verified=0

for migration in "${enterprise_migrations[@]}"; do
  if [[ "$(basename -- "${migration}")" == \
    "202608180032_merchant_enterprise_audit_query_security.sql" ]]; then
    echo '[enterprise-integration] seeding a conflicting audit index for retry coverage'
    run_psql --command \
      "create index merchant_enterprise_audit_events_actor_created_idx on public.merchant_enterprise_audit_events(merchant_id);"
  fi
  if [[ "$(basename -- "${migration}")" == \
    "202608190033_merchant_enterprise_invitation_delivery_outbox.sql" ]]; then
    echo '[enterprise-integration] seeding conflicting invitation indexes for retry coverage'
    run_psql --command \
      "create index merchant_enterprise_employees_invitation_exchange_idx on public.merchant_enterprise_employees(merchant_id); create index merchant_outbox_enterprise_invitation_due_idx on public.merchant_outbox_events(merchant_id); create index merchant_outbox_enterprise_invitation_lease_idx on public.merchant_outbox_events(merchant_id);"
  fi
  if [[ "$(basename -- "${migration}")" == \
    "202608190034_merchant_enterprise_current_operations.sql" ]]; then
    echo '[enterprise-integration] seeding conflicting current-operations indexes for retry coverage'
    run_psql --command \
      "create index merchant_tasks_current_operations_idx on public.merchant_tasks(merchant_id); create index merchant_task_assignees_employee_task_idx on public.merchant_task_assignees(merchant_id);"
    echo '[enterprise-integration] applying 034 with quote_all_identifiers=on'
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
  elif [[ "$(basename -- "${migration}")" == \
    "202608190035_ordinary_account_authorization_foundation.sql" ]]; then
    run_sql_file "${migration}"
    echo '[enterprise-integration] seeding conflicting identity indexes for unregistered retry coverage'
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190035; drop index public.faolla_personal_accounts_auth_user_id_uidx; drop index public.faolla_personal_accounts_personal_account_id_uidx; create unique index faolla_personal_accounts_auth_user_id_uidx on public.faolla_personal_accounts(created_at); create unique index faolla_personal_accounts_personal_account_id_uidx on public.faolla_personal_accounts(personal_account_id, created_at);"
    echo '[enterprise-integration] retrying 035 with quote_all_identifiers=on'
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    echo '[enterprise-integration] seeding the non-ordinary site-main platform sentinel'
    run_psql --command \
      "insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ('d3500000-0000-4000-8000-000000000001'::uuid, 'system-site@example.test', '{}'::jsonb, '{}'::jsonb); insert into public.merchants(id, name, owner_user_id) values ('site-main', 'Platform system site', 'd3500000-0000-4000-8000-000000000001'::uuid);"
    echo '[enterprise-integration] establishing the serial enterprise fixtures before the identity hardening stage'
    run_sql_file "${SCRIPT_DIR}/10-serial-acceptance.sql"
    echo '[enterprise-integration] validating the 035 shadow contract before 036 narrows positive authorization'
    run_sql_file "${SCRIPT_DIR}/54-ordinary-account-authorization.sql"
  elif [[ "$(basename -- "${migration}")" == \
    "202608190036_ordinary_account_authorization_bootstrap.sql" ]]; then
    run_psql --command \
      "do \$\$ begin if not exists (select 1 from pg_catalog.pg_roles where rolname = 'redteam_custom_api') then create role redteam_custom_api nologin noinherit; end if; if not exists (select 1 from pg_catalog.pg_roles where rolname = 'redteam_custom_child') then create role redteam_custom_child nologin noinherit; end if; end \$\$; grant usage on schema public to redteam_custom_api, redteam_custom_child; grant execute on function public.faolla_resolve_ordinary_account_authorization_v1(uuid) to redteam_custom_api; grant execute on function public.faolla_get_ordinary_account_authorization_readiness_v1() to redteam_custom_api with grant option; grant execute on function public.faolla_guard_personal_account_binding_v1() to redteam_custom_api; grant select on table public.faolla_personal_accounts to redteam_custom_api with grant option; grant update(personal_account_id) on table public.faolla_personal_accounts to redteam_custom_api with grant option; set role redteam_custom_api; grant execute on function public.faolla_get_ordinary_account_authorization_readiness_v1() to redteam_custom_child; grant select on table public.faolla_personal_accounts to redteam_custom_child; grant update(personal_account_id) on table public.faolla_personal_accounts to redteam_custom_child; reset role;"
    echo '[enterprise-integration] rejecting a conflicting 036 registry name before function DDL'
    run_psql --command \
      "insert into public.faolla_schema_migrations(version, name) values (202608190036, 'redteam_wrong_036');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_bootstrap_registry_conflict'
    bootstrap_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and to_regprocedure('public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)') is null and to_regprocedure('public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)') is null and not exists (select 1 from (values ('public.faolla_resolve_ordinary_account_authorization_v1(uuid)'), ('public.faolla_get_ordinary_account_authorization_readiness_v1()'), ('public.faolla_guard_personal_account_binding_v1()')) as protected_function(signature) where not has_function_privilege('redteam_custom_api', protected_function.signature, 'EXECUTE')) and has_function_privilege('redteam_custom_child', 'public.faolla_get_ordinary_account_authorization_readiness_v1()', 'EXECUTE') and has_table_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'SELECT') and has_table_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'SELECT') and has_column_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE') and has_column_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE') from public.faolla_schema_migrations where version = 202608190036 and name = 'redteam_wrong_036';"
    )"
    if [[ "${bootstrap_conflict_state}" != 't' ]]; then
      echo '036 registry conflict changed functions or the registry row' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190036 and name = 'redteam_wrong_036';"
    run_sql_file "${migration}"
    bootstrap_custom_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from (values ('redteam_custom_api', 'public.faolla_resolve_ordinary_account_authorization_v1(uuid)'), ('redteam_custom_api', 'public.faolla_get_ordinary_account_authorization_readiness_v1()'), ('redteam_custom_api', 'public.faolla_guard_personal_account_binding_v1()'), ('redteam_custom_child', 'public.faolla_get_ordinary_account_authorization_readiness_v1()')) as protected_function(role_name, signature) where has_function_privilege(protected_function.role_name, protected_function.signature, 'EXECUTE')) and not has_table_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'SELECT') and not has_table_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'SELECT') and not has_column_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE') and not has_column_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE');"
    )"
    if [[ "${bootstrap_custom_acl_state}" != 't' ]]; then
      echo '036 did not remove a pre-existing custom resolver grant' >&2
      exit 1
    fi
    bootstrap_guard_search_path_state="$(
      run_psql --tuples-only --no-align --command \
        "select function_metadata.proconfig is not distinct from array['search_path=pg_catalog, public']::text[] from pg_catalog.pg_proc as function_metadata where function_metadata.oid = 'public.faolla_guard_personal_account_binding_v1()'::regprocedure;"
    )"
    if [[ "${bootstrap_guard_search_path_state}" != 't' ]]; then
      echo '036 did not normalize the quote_all_identifiers guard search_path' >&2
      exit 1
    fi
    echo '[enterprise-integration] rejecting semantically different quoted search_path drift'
    run_psql --command \
      "alter function public.faolla_get_ordinary_account_authorization_readiness_v1() set search_path = \"PG_CATALOG\", public;"
    bootstrap_search_path_drift_state="$(
      run_psql --tuples-only --no-align --command \
        "select not (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() #>> '{invariants,aclReady}')::boolean;"
    )"
    if [[ "${bootstrap_search_path_drift_state}" != 't' ]]; then
      echo '036 readiness accepted a semantically different quoted search_path' >&2
      exit 1
    fi
    run_psql --command \
      "alter function public.faolla_get_ordinary_account_authorization_readiness_v1() set search_path = pg_catalog, public;"
    echo '[enterprise-integration] rejecting same-named fake identity schema objects'
    run_psql --command \
      "drop index public.faolla_personal_accounts_auth_user_id_uidx; create unique index faolla_personal_accounts_auth_user_id_uidx on public.faolla_personal_accounts(created_at); alter table public.faolla_personal_accounts drop constraint faolla_personal_accounts_status_valid; alter table public.faolla_personal_accounts add constraint faolla_personal_accounts_status_valid check (status is not null); drop trigger faolla_personal_accounts_binding_guard on public.faolla_personal_accounts; create trigger faolla_personal_accounts_binding_guard before insert on public.faolla_personal_accounts for each row execute function public.faolla_guard_personal_account_binding_v1(); alter table public.faolla_personal_accounts enable always trigger faolla_personal_accounts_binding_guard;"
    fake_schema_ready="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() #>> '{invariants,schemaReady}')::boolean;"
    )"
    if [[ "${fake_schema_ready}" != 'f' ]]; then
      echo 'Authoritative readiness accepted same-named fake schema objects' >&2
      exit 1
    fi
    run_psql --command \
      "drop index public.faolla_personal_accounts_auth_user_id_uidx; create unique index faolla_personal_accounts_auth_user_id_uidx on public.faolla_personal_accounts(auth_user_id); alter table public.faolla_personal_accounts drop constraint faolla_personal_accounts_status_valid; alter table public.faolla_personal_accounts add constraint faolla_personal_accounts_status_valid check (status in ('active', 'disabled')); drop trigger faolla_personal_accounts_binding_guard on public.faolla_personal_accounts; create trigger faolla_personal_accounts_binding_guard before update or delete on public.faolla_personal_accounts for each row execute function public.faolla_guard_personal_account_binding_v1(); alter table public.faolla_personal_accounts enable always trigger faolla_personal_accounts_binding_guard;"
    restored_schema_ready="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() #>> '{invariants,schemaReady}')::boolean;"
    )"
    if [[ "${restored_schema_ready}" != 't' ]]; then
      echo 'Authoritative readiness did not accept restored exact schema objects' >&2
      exit 1
    fi
    echo '[enterprise-integration] rejecting null-bearing personal rows and exact column-catalog drift'
    personal_invalid_before="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() #>> '{personal,invalidCanonicalCount}')::integer;"
    )"
    run_psql --command \
      "alter table public.faolla_personal_accounts alter column auth_user_id drop not null, alter column personal_account_id drop not null, alter column status drop not null, alter column status drop default, alter column version drop not null, alter column version drop default, alter column created_at drop not null, alter column created_at drop default, alter column updated_at drop not null, alter column updated_at drop default; insert into public.faolla_personal_accounts(auth_user_id, personal_account_id, status, version, created_at, updated_at) values (null, null, null, null, null, null);"
    null_column_drift_state="$(
      run_psql --tuples-only --no-align --command \
        "select not (readiness ->> 'readyForCutover')::boolean and not (readiness #>> '{invariants,schemaReady}')::boolean and (readiness #>> '{personal,invalidCanonicalCount}')::integer = ${personal_invalid_before} + 1 from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${null_column_drift_state}" != 't' ]]; then
      echo 'Authoritative readiness accepted null data or personal-account column drift' >&2
      exit 1
    fi
    run_psql --command \
      "alter table public.faolla_personal_accounts disable trigger faolla_personal_accounts_binding_guard; delete from public.faolla_personal_accounts where auth_user_id is null and personal_account_id is null and status is null and version is null and created_at is null and updated_at is null; alter table public.faolla_personal_accounts alter column auth_user_id set not null, alter column personal_account_id set not null, alter column status set not null, alter column status set default 'active', alter column version set not null, alter column version set default 1, alter column created_at set not null, alter column created_at set default now(), alter column updated_at set not null, alter column updated_at set default now(); alter table public.faolla_personal_accounts enable always trigger faolla_personal_accounts_binding_guard;"
    restored_column_catalog_state="$(
      run_psql --tuples-only --no-align --command \
        "select (readiness #>> '{invariants,schemaReady}')::boolean and (readiness #>> '{personal,invalidCanonicalCount}')::integer = ${personal_invalid_before} from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${restored_column_catalog_state}" != 't' ]]; then
      echo 'Authoritative readiness did not accept the restored exact personal-account column catalog' >&2
      exit 1
    fi
    echo '[enterprise-integration] retrying unregistered 036 with quote_all_identifiers=on'
    run_psql --command \
      "grant execute on function public.faolla_resolve_ordinary_account_authorization_v1(uuid) to redteam_custom_api; grant execute on function public.faolla_get_ordinary_account_authorization_readiness_v1() to redteam_custom_api with grant option; grant execute on function public.faolla_create_ordinary_account_authorization_v1(uuid,text,text) to redteam_custom_api; grant execute on function public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text) to redteam_custom_api; grant execute on function public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() to redteam_custom_api; grant execute on function public.faolla_guard_personal_account_binding_v1() to redteam_custom_api; grant execute on function public.faolla_guard_staff_identity_ordinary_exclusion_v1() to redteam_custom_api; grant execute on function public.faolla_guard_auth_user_ordinary_account_delete_v1() to redteam_custom_api; grant select on table public.faolla_personal_accounts to redteam_custom_api with grant option; grant update(personal_account_id) on table public.faolla_personal_accounts to redteam_custom_api with grant option; set role redteam_custom_api; grant execute on function public.faolla_get_ordinary_account_authorization_readiness_v1() to redteam_custom_child; grant select on table public.faolla_personal_accounts to redteam_custom_child; grant update(personal_account_id) on table public.faolla_personal_accounts to redteam_custom_child; reset role; delete from public.faolla_schema_migrations where version = 202608190036;"
    bootstrap_polluted_table_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() #>> '{invariants,aclReady}')::boolean and has_table_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'SELECT') and has_table_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'SELECT') and has_column_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE') and has_column_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE');"
    )"
    if [[ "${bootstrap_polluted_table_acl_state}" != 't' ]]; then
      echo '036 readiness accepted a custom canonical-table grant chain' >&2
      exit 1
    fi
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    bootstrap_retry_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from (values ('public.faolla_resolve_ordinary_account_authorization_v1(uuid)'), ('public.faolla_get_ordinary_account_authorization_readiness_v1()'), ('public.faolla_create_ordinary_account_authorization_v1(uuid,text,text)'), ('public.faolla_bootstrap_ordinary_account_authorization_v1(uuid,text)'), ('public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1()'), ('public.faolla_guard_personal_account_binding_v1()'), ('public.faolla_guard_staff_identity_ordinary_exclusion_v1()'), ('public.faolla_guard_auth_user_ordinary_account_delete_v1()')) as protected_function(signature) where has_function_privilege('redteam_custom_api', protected_function.signature, 'EXECUTE')) and not has_function_privilege('redteam_custom_child', 'public.faolla_get_ordinary_account_authorization_readiness_v1()', 'EXECUTE') and not has_table_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'SELECT') and not has_table_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'SELECT') and not has_column_privilege('redteam_custom_api', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE') and not has_column_privilege('redteam_custom_child', 'public.faolla_personal_accounts', 'personal_account_id', 'UPDATE');"
    )"
    if [[ "${bootstrap_retry_acl_state}" != 't' ]]; then
      echo '036 retry retained a custom SECURITY DEFINER function grant' >&2
      exit 1
    fi
    system_site_ready="$(
      run_psql --tuples-only --no-align --command \
        "select not (readiness ->> 'readyForCutover')::boolean and (readiness #>> '{merchant,recordCount}')::integer = 2 and (readiness #>> '{merchant,invalidBindingCount}')::integer = 2 from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${system_site_ready}" != 't' ]]; then
      echo 'Authoritative readiness treated site-main as an ordinary merchant' >&2
      exit 1
    fi
    echo '[enterprise-integration] proving only exact site-main is excluded from ordinary readiness'
    run_psql --command \
      "insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ('d3500000-0000-4000-8000-000000000002'::uuid, 'illegal-site@example.test', '{}'::jsonb, '{}'::jsonb); insert into public.merchants(id, name, user_id, auth_user_id, owner_user_id, owner_id, auth_id, created_by, created_by_user_id) values ('site-illegal', 'Illegal ordinary site', 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid, 'd3500000-0000-4000-8000-000000000002'::uuid);"
    illegal_site_state="$(
      run_psql --tuples-only --no-align --command \
        "select not (readiness ->> 'readyForCutover')::boolean and (readiness #>> '{merchant,recordCount}')::integer = 3 and (readiness #>> '{merchant,invalidBindingCount}')::integer = 3 from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${illegal_site_state}" != 't' ]]; then
      echo 'Authoritative readiness hid a non-sentinel invalid merchant ID' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.merchants where id = 'site-illegal'; delete from auth.users where id = 'd3500000-0000-4000-8000-000000000002'::uuid;"
  elif [[ "$(basename -- "${migration}")" == \
    "202608190037_ordinary_account_system_site_principal_isolation.sql" ]]; then
    echo '[enterprise-integration] running all additive acceptance before 037 exists in the registry'
    run_pre_cutover_acceptance
    pre_cutover_acceptance_ran=1

    echo '[enterprise-integration] seeding a selective system-site overlap fixture'
    run_psql --command \
      "grant select, insert, update on table public.merchants to service_role; insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ('d3500000-0000-4000-8000-000000000003'::uuid, 'independent-system@example.test', '{}'::jsonb, '{}'::jsonb); update public.merchants set user_id = 'd3500000-0000-4000-8000-000000000001'::uuid, auth_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid, owner_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid, owner_id = 'd3500000-0000-4000-8000-000000000001'::uuid, auth_id = 'd3500000-0000-4000-8000-000000000001'::uuid, created_by = 'd3500000-0000-4000-8000-000000000001'::uuid, created_by_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid where id = '10000001'; update public.merchants set email = 'owner-a@example.test', user_id = 'd3500000-0000-4000-8000-000000000001'::uuid, auth_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid, owner_user_id = 'd3500000-0000-4000-8000-000000000003'::uuid, owner_id = null, auth_id = null, created_by = null, created_by_user_id = null where id = 'site-main';"
    isolation_fixture_state="$(
      run_psql --tuples-only --no-align --command \
        "select readiness #>> '{security,systemSitePrincipalOverlapCount}' = '1' and readiness #>> '{security,crossAccountTypeOverlapCount}' = '0' and readiness #>> '{security,accountIdentifierCollisionCount}' = '0' and readiness #>> '{security,staffRegistryOverlapCount}' = '0' and readiness #>> '{merchant,recordCount}' = '2' and readiness #>> '{merchant,authoritativeBindingCount}' = '1' and readiness #>> '{merchant,invalidBindingCount}' = '1' and readiness #>> '{personal,canonicalBindingCount}' = '0' and (select count(distinct site_alias.auth_user_id) = 2 from public.merchants as site cross join lateral unnest(array[site.user_id, site.auth_user_id, site.owner_user_id, site.owner_id, site.auth_id, site.created_by, site.created_by_user_id]::uuid[]) as site_alias(auth_user_id) where site.id = 'site-main' and site_alias.auth_user_id is not null) from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${isolation_fixture_state}" != 't' ]]; then
      echo 'Selective system-site fixture did not isolate one overlap from one independent principal' >&2
      exit 1
    fi

    echo '[enterprise-integration] rejecting a conflicting 037 isolation registry name'
    run_psql --command \
      "insert into public.faolla_schema_migrations(version, name) values (202608190037, 'redteam_wrong_037');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_system_site_isolation_registry_conflict'
    isolation_registry_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_system_site_principal_isolation', 'merchants_system_site_principal_insert_isolation')) and (select user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and auth_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and owner_user_id = 'd3500000-0000-4000-8000-000000000003'::uuid from public.merchants where id = 'site-main') from public.faolla_schema_migrations where version = 202608190037 and name = 'redteam_wrong_037';"
    )"
    if [[ "${isolation_registry_conflict_state}" != 't' ]]; then
      echo '037 isolation registry conflict changed aliases, policy, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190037 and name = 'redteam_wrong_037';"

    echo '[enterprise-integration] rejecting a same-named permissive policy'
    run_psql --command \
      "create policy merchants_system_site_principal_isolation on public.merchants as permissive for update to authenticated using (id <> 'site-main') with check (id <> 'site-main');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_system_site_isolation_policy_conflict'
    isolation_policy_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and policy.permissive = 'PERMISSIVE' and (select user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and auth_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and owner_user_id = 'd3500000-0000-4000-8000-000000000003'::uuid from public.merchants where id = 'site-main') from pg_catalog.pg_policies as policy where policy.schemaname = 'public' and policy.tablename = 'merchants' and policy.policyname = 'merchants_system_site_principal_isolation';"
    )"
    if [[ "${isolation_policy_conflict_state}" != 't' ]]; then
      echo '037 isolation policy conflict changed aliases, policy, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "drop policy merchants_system_site_principal_isolation on public.merchants;"

    echo '[enterprise-integration] rejecting a same-named permissive INSERT isolation policy'
    run_psql --command \
      "create policy merchants_system_site_principal_isolation on public.merchants as restrictive for update to authenticated using (id <> 'site-main') with check (id <> 'site-main'); create policy merchants_system_site_principal_insert_isolation on public.merchants as permissive for insert to authenticated with check (id <> 'site-main');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_system_site_isolation_policy_conflict'
    isolation_insert_policy_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and (select count(*) = 2 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_system_site_principal_isolation', 'merchants_system_site_principal_insert_isolation')) and (select permissive = 'PERMISSIVE' and cmd = 'INSERT' from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname = 'merchants_system_site_principal_insert_isolation') and (select user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and auth_user_id = 'd3500000-0000-4000-8000-000000000001'::uuid and owner_user_id = 'd3500000-0000-4000-8000-000000000003'::uuid from public.merchants where id = 'site-main');"
    )"
    if [[ "${isolation_insert_policy_conflict_state}" != 't' ]]; then
      echo '037 INSERT isolation policy conflict changed aliases, policies, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "drop policy merchants_system_site_principal_isolation on public.merchants; drop policy merchants_system_site_principal_insert_isolation on public.merchants;"

    run_sql_file "${migration}"
    isolation_updated_at_before_retry="$(
      run_psql --tuples-only --no-align --command \
        "select updated_at::text from public.merchants where id = 'site-main';"
    )"
    echo '[enterprise-integration] retrying unregistered 037 isolation with quote_all_identifiers=on'
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190037 and name = 'ordinary_account_system_site_principal_isolation';"
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    isolation_updated_at_after_retry="$(
      run_psql --tuples-only --no-align --command \
        "select updated_at::text from public.merchants where id = 'site-main';"
    )"
    if [[ "${isolation_updated_at_before_retry}" != "${isolation_updated_at_after_retry}" ]]; then
      echo '037 isolation no-op retry changed site-main updated_at' >&2
      exit 1
    fi
    isolation_post_state="$(
      run_psql --tuples-only --no-align --command \
        "select readiness #>> '{security,systemSitePrincipalOverlapCount}' = '0' and readiness #>> '{security,crossAccountTypeOverlapCount}' = '0' and readiness #>> '{security,accountIdentifierCollisionCount}' = '0' and readiness #>> '{security,staffRegistryOverlapCount}' = '0' and readiness #>> '{merchant,recordCount}' = '2' and readiness #>> '{merchant,authoritativeBindingCount}' = '1' and readiness #>> '{merchant,invalidBindingCount}' = '1' and readiness #>> '{personal,canonicalBindingCount}' = '0' and (select user_id is null and auth_user_id is null and owner_user_id = 'd3500000-0000-4000-8000-000000000003'::uuid and owner_id is null and auth_id is null and created_by is null and created_by_user_id is null from public.merchants where id = 'site-main') and exists (select 1 from public.faolla_schema_migrations where version = 202608190037 and name = 'ordinary_account_system_site_principal_isolation') and (select count(*) = 2 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_system_site_principal_isolation', 'merchants_system_site_principal_insert_isolation') and permissive = 'RESTRICTIVE' and roles = array['authenticated']::name[] and ((policyname = 'merchants_system_site_principal_isolation' and cmd = 'UPDATE') or (policyname = 'merchants_system_site_principal_insert_isolation' and cmd = 'INSERT'))) from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${isolation_post_state}" != 't' ]]; then
      echo '037 isolation did not preserve the independent alias or readiness invariants' >&2
      exit 1
    fi
    isolation_retry_updated_at_unchanged=1

    echo '[enterprise-integration] retrying unregistered 037 with site-main absent'
    run_psql --command \
      "delete from public.merchants where id = 'site-main'; delete from public.faolla_schema_migrations where version = 202608190037 and name = 'ordinary_account_system_site_principal_isolation';"
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    isolation_absent_site_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.merchants where id = 'site-main') and readiness #>> '{security,systemSitePrincipalOverlapCount}' = '0' and exists (select 1 from public.faolla_schema_migrations where version = 202608190037 and name = 'ordinary_account_system_site_principal_isolation') and (select count(*) = 2 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_system_site_principal_isolation', 'merchants_system_site_principal_insert_isolation') and permissive = 'RESTRICTIVE' and roles = array['authenticated']::name[] and ((policyname = 'merchants_system_site_principal_isolation' and cmd = 'UPDATE') or (policyname = 'merchants_system_site_principal_insert_isolation' and cmd = 'INSERT'))) from (select public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() as readiness) as result;"
    )"
    if [[ "${isolation_absent_site_state}" != 't' ]]; then
      echo '037 isolation did not safely retry with site-main absent' >&2
      exit 1
    fi
    run_psql --command \
      "insert into public.merchants(id, name, email, owner_user_id) values ('site-main', 'Platform system site', 'owner-a@example.test', 'd3500000-0000-4000-8000-000000000003'::uuid);"
    isolation_absent_site_retry_verified=1
  elif [[ "$(basename -- "${migration}")" == \
    "202608190038_ordinary_account_recovery_observer.sql" ]]; then
    echo '[enterprise-integration] rejecting a conflicting 038 recovery-observer registry name'
    run_psql --command \
      "insert into public.faolla_schema_migrations(version, name) values (202608190038, 'redteam_wrong_038');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_recovery_observer_registry_conflict'
    recovery_observer_registry_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and to_regprocedure('public.faolla_observe_ordinary_account_recovery_v1(uuid,text)') is null from public.faolla_schema_migrations where version = 202608190038 and name = 'redteam_wrong_038';"
    )"
    if [[ "${recovery_observer_registry_conflict_state}" != 't' ]]; then
      echo '038 recovery observer registry conflict changed function or registry state' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190038 and name = 'redteam_wrong_038';"

    run_sql_file "${migration}"

    echo '[enterprise-integration] retrying unregistered 038 after custom delegated grants'
    run_psql --command \
      "grant execute on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) to redteam_custom_api with grant option; set role redteam_custom_api; grant execute on function public.faolla_observe_ordinary_account_recovery_v1(uuid,text) to redteam_custom_child; reset role; delete from public.faolla_schema_migrations where version = 202608190038 and name = 'ordinary_account_recovery_observer';"
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    recovery_observer_retry_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and has_function_privilege('service_role', 'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)', 'EXECUTE') and not has_function_privilege('anon', 'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)', 'EXECUTE') and not has_function_privilege('redteam_custom_api', 'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)', 'EXECUTE') and not has_function_privilege('redteam_custom_child', 'public.faolla_observe_ordinary_account_recovery_v1(uuid,text)', 'EXECUTE') from public.faolla_schema_migrations where version = 202608190038 and name = 'ordinary_account_recovery_observer';"
    )"
    if [[ "${recovery_observer_retry_state}" != 't' ]]; then
      echo '038 recovery observer retry retained a non-service function grant' >&2
      exit 1
    fi
  elif [[ "$(basename -- "${migration}")" == \
    "202608190039_runtime_rpc_execute_acl_hardening.sql" ]]; then
    echo '[enterprise-integration] verifying the production supabase_admin creator and historical default exposure'
    rpc_acl_precondition_state="$(
      run_psql --tuples-only --no-align --command \
        "select (select relowner = to_regrole('supabase_admin') from pg_catalog.pg_class where oid = 'public.faolla_schema_migrations'::regclass) and (select count(*) = 16 and bool_and(function_metadata.proowner = to_regrole('supabase_admin')) from pg_catalog.pg_proc as function_metadata where function_metadata.pronamespace = 'public'::regnamespace and function_metadata.proname in ('faolla_is_merchant_owner','faolla_upsert_merchant_order_v1','faolla_upsert_merchant_orders_v1','faolla_upsert_merchant_membership_ledger_v1','faolla_upsert_merchant_bookings_v1','faolla_resolve_merchant_customer_v1','faolla_upsert_merchant_coupons_v1','faolla_upsert_merchant_conversations_v1','faolla_enqueue_merchant_outbox_v1','faolla_claim_merchant_outbox_v1','faolla_renew_merchant_outbox_lease_v1','faolla_complete_merchant_outbox_v1','faolla_fail_merchant_outbox_v1','faolla_replay_merchant_outbox_v1','faolla_claim_merchant_outbox_scoped_v1','faolla_get_merchant_outbox_health_v1')) and (select count(*) = 15 from (values ('public.faolla_is_merchant_owner(text)'), ('public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)'), ('public.faolla_upsert_merchant_orders_v1(jsonb)'), ('public.faolla_upsert_merchant_membership_ledger_v1(jsonb)'), ('public.faolla_upsert_merchant_bookings_v1(jsonb)'), ('public.faolla_resolve_merchant_customer_v1(text,jsonb,text)'), ('public.faolla_upsert_merchant_coupons_v1(jsonb)'), ('public.faolla_upsert_merchant_conversations_v1(jsonb)'), ('public.faolla_enqueue_merchant_outbox_v1(jsonb)'), ('public.faolla_claim_merchant_outbox_v1(text,integer,integer,text[])'), ('public.faolla_renew_merchant_outbox_lease_v1(uuid,text,integer)'), ('public.faolla_complete_merchant_outbox_v1(uuid,text,jsonb)'), ('public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)'), ('public.faolla_replay_merchant_outbox_v1(uuid,text,text)'), ('public.faolla_claim_merchant_outbox_scoped_v1(text,text[],text[],integer,integer)')) as exposed(signature) where pg_catalog.has_function_privilege('anon', exposed.signature, 'EXECUTE')) and not pg_catalog.has_function_privilege('anon', 'public.faolla_get_merchant_outbox_health_v1(text,integer)', 'EXECUTE') and pg_catalog.has_function_privilege('service_role', 'public.faolla_get_merchant_outbox_health_v1(text,integer)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_precondition_state}" != 't' ]]; then
      echo '039 fixture did not reproduce the exact hosted owner/default ACL state' >&2
      exit 1
    fi

    echo '[enterprise-integration] seeding custom, delegated, global, and schema function ACL drift'
    run_psql --command \
      "do \$\$ begin if to_regrole('\"redteam rpc acl 039\"') is null then create role \"redteam rpc acl 039\" nologin noinherit; end if; if to_regrole('redteam_rpc_acl_child_039') is null then create role redteam_rpc_acl_child_039 nologin noinherit; end if; if to_regrole('redteam_rpc_acl_transitive_039') is null then create role redteam_rpc_acl_transitive_039 nologin inherit; end if; if to_regrole('redteam_rpc_acl_untrusted_039') is null then create role redteam_rpc_acl_untrusted_039 nologin noinherit; end if; if to_regrole('redteam_rpc_acl_database_owner_039') is null then create role redteam_rpc_acl_database_owner_039 nologin noinherit createdb; else alter role redteam_rpc_acl_database_owner_039 nologin noinherit createdb; end if; end \$\$; grant usage, create on schema public to \"redteam rpc acl 039\"; grant execute on function public.faolla_is_merchant_owner(text), public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb), public.faolla_enqueue_merchant_outbox_v1(jsonb), public.faolla_get_merchant_outbox_health_v1(text,integer) to \"redteam rpc acl 039\" with grant option; set role supabase_admin; grant execute on function public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb) to supabase_admin with grant option; reset role; set role \"redteam rpc acl 039\"; grant execute on function public.faolla_is_merchant_owner(text), public.faolla_enqueue_merchant_outbox_v1(jsonb) to redteam_rpc_acl_child_039; reset role; alter default privileges for role postgres grant execute on functions to public; alter default privileges for role postgres in schema public grant execute on functions to \"redteam rpc acl 039\" with grant option; alter default privileges for role supabase_admin grant execute on functions to public, anon, authenticated, service_role; alter default privileges for role supabase_admin grant execute on functions to supabase_admin with grant option; alter default privileges for role supabase_admin in schema public grant execute on functions to supabase_admin with grant option; alter default privileges for role supabase_admin in schema public grant execute on functions to \"redteam rpc acl 039\" with grant option; alter default privileges for role \"redteam rpc acl 039\" grant execute on functions to public, anon; alter default privileges for role \"redteam rpc acl 039\" in schema public grant execute on functions to authenticated, service_role;"
    run_psql --command \
      "grant select on table public.faolla_schema_migrations to public; grant select on table public.faolla_schema_migrations to \"redteam rpc acl 039\" with grant option; grant update(applied_at) on table public.faolla_schema_migrations to \"redteam rpc acl 039\" with grant option; grant select(version) on table public.faolla_schema_migrations to authenticated; grant update, delete, truncate on table public.faolla_schema_migrations to service_role with grant option; set role supabase_admin; grant select on table public.faolla_schema_migrations to supabase_admin with grant option; reset role; set role \"redteam rpc acl 039\"; grant select on table public.faolla_schema_migrations to redteam_rpc_acl_child_039, service_role; grant update(applied_at) on table public.faolla_schema_migrations to redteam_rpc_acl_child_039; reset role;"
    run_psql --command \
      "do \$\$ begin if exists (select 1 from pg_catalog.pg_auth_members where roleid = to_regrole('supabase_admin') and member = to_regrole('authenticator')) then revoke supabase_admin from authenticator; end if; end \$\$; alter default privileges for role pg_monitor revoke execute on functions from anon;"

    echo '[enterprise-integration] rejecting a conflicting 039 registry row before ACL mutation'
    run_psql --command \
      "insert into public.faolla_schema_migrations(version, name) values (202608190039, 'redteam_wrong_039');"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_registry_conflict'
    rpc_acl_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and has_function_privilege('redteam_rpc_acl_child_039', 'public.faolla_enqueue_merchant_outbox_v1(jsonb)', 'EXECUTE') and has_table_privilege('redteam_rpc_acl_child_039', 'public.faolla_schema_migrations', 'SELECT') and has_column_privilege('redteam_rpc_acl_child_039', 'public.faolla_schema_migrations', 'applied_at', 'UPDATE') and has_table_privilege('service_role', 'public.faolla_schema_migrations', 'TRUNCATE') and has_column_privilege('authenticated', 'public.faolla_schema_migrations', 'version', 'SELECT') and exists (select 1 from pg_catalog.pg_class as registry_metadata cross join lateral pg_catalog.aclexplode(registry_metadata.relacl) as acl where registry_metadata.oid = 'public.faolla_schema_migrations'::regclass and acl.grantee = 0 and acl.privilege_type = 'SELECT') and exists (select 1 from pg_catalog.pg_class as registry_metadata cross join lateral pg_catalog.aclexplode(registry_metadata.relacl) as acl where registry_metadata.oid = 'public.faolla_schema_migrations'::regclass and acl.grantee = registry_metadata.relowner and acl.privilege_type = 'SELECT' and acl.is_grantable) from public.faolla_schema_migrations where version = 202608190039 and name = 'redteam_wrong_039';"
    )"
    if [[ "${rpc_acl_conflict_state}" != 't' ]]; then
      echo '039 registry conflict changed ACL or registry state' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190039;"

    echo '[enterprise-integration] rejecting an untrusted migration actor atomically'
    expect_sql_file_error_as_role "${migration}" redteam_rpc_acl_untrusted_039 \
      'runtime_rpc_execute_acl_hardening_untrusted_migrator'
    rpc_acl_untrusted_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_untrusted_state}" != 't' ]]; then
      echo 'Untrusted 039 attempt changed registry or ACL state' >&2
      exit 1
    fi

    echo '[enterprise-integration] rejecting a demoted supabase_admin before mutation'
    run_psql --command "alter role supabase_admin nosuperuser;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_untrusted_migrator'
    rpc_acl_demoted_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    run_psql --command "alter role supabase_admin superuser;"
    if [[ "${rpc_acl_demoted_state}" != 't' ]]; then
      echo 'Demoted supabase_admin attempt changed registry or ACL state' >&2
      exit 1
    fi

    echo '[enterprise-integration] rejecting partial and custom role graphs'
    run_psql --command "revoke anon from postgres;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command "grant anon to postgres; grant service_role to redteam_rpc_acl_transitive_039;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command "revoke service_role from redteam_rpc_acl_transitive_039;"
    run_psql --command "revoke postgres from cli_login_postgres;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "set role supabase_admin; grant postgres to cli_login_postgres; reset role;"
    run_psql --command \
      "revoke postgres from cli_login_postgres; grant postgres to cli_login_postgres;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "revoke postgres from cli_login_postgres; set role supabase_admin; grant postgres to cli_login_postgres with admin option; reset role;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "revoke postgres from cli_login_postgres; set role supabase_admin; grant postgres to cli_login_postgres; reset role; grant service_role to cli_login_postgres;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "revoke service_role from cli_login_postgres; grant cli_login_postgres to redteam_rpc_acl_transitive_039;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "revoke cli_login_postgres from redteam_rpc_acl_transitive_039; grant postgres to redteam_rpc_acl_transitive_039;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "revoke postgres from redteam_rpc_acl_transitive_039;"
    run_psql --command "alter role cli_login_postgres bypassrls;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command "alter role cli_login_postgres nobypassrls;"

    echo '[enterprise-integration] rejecting an unexpected custom CREATEROLE actor'
    run_psql --command \
      "do \$\$ begin if to_regrole('redteam_rpc_acl_privileged_039') is null then create role redteam_rpc_acl_privileged_039 nologin noinherit createrole; else alter role redteam_rpc_acl_privileged_039 nologin noinherit createrole; end if; end \$\$;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_role_attribute_mismatch'
    run_psql --command \
      "alter role redteam_rpc_acl_privileged_039 nocreaterole;"

    echo '[enterprise-integration] rejecting an idle-in-transaction function DDL by its cluster XID'
    rpc_acl_gate_log="$(mktemp)"
    rpc_acl_race_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_gate_log}" "${rpc_acl_race_log}")
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_gate_039'; select pg_catalog.pg_advisory_lock(20260819, 3901); select pg_sleep(30);"
    ) >"${rpc_acl_gate_log}" 2>&1 &
    rpc_acl_gate_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_gate_pid}")
    wait_for_sql_true 'DDL commit-gate advisory barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_gate_039' and lock_state.locktype = 'advisory' and lock_state.granted);"
    (
      run_psql \
        --command "set application_name = 'enterprise_rpc_acl_ddl_first_039'; set track_activities = off;" \
        --command "begin; create function public.faolla_is_merchant_owner(jsonb) returns boolean language sql stable as \$\$ select false \$\$; select pg_catalog.pg_advisory_xact_lock(20260819, 3901); commit;"
    ) >"${rpc_acl_race_log}" 2>&1 &
    rpc_acl_race_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_race_pid}")
    wait_for_sql_true 'DDL-first assigned-XID and commit-gate wait barrier' \
      "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.application_name = 'enterprise_rpc_acl_ddl_first_039' and activity.backend_xid is not null and activity.state = 'disabled' and activity.xact_start is null and exists (select 1 from pg_catalog.pg_locks as lock_state where lock_state.pid = activity.pid and lock_state.locktype = 'advisory' and not lock_state.granted) and not exists (select 1 from pg_catalog.pg_locks as proc_lock where proc_lock.pid = activity.pid and proc_lock.relation = 'pg_catalog.pg_proc'::regclass and proc_lock.mode = 'RowExclusiveLock' and proc_lock.granted));"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_concurrent_transaction'
    rpc_acl_xid_failure_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and has_function_privilege('redteam_rpc_acl_child_039', 'public.faolla_enqueue_merchant_outbox_v1(jsonb)', 'EXECUTE') and exists (select 1 from pg_catalog.pg_default_acl as defaults cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl where defaults.defaclrole = to_regrole('supabase_admin') and defaults.defaclnamespace = 0 and defaults.defaclobjtype = 'f' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') and pg_catalog.pg_has_role('authenticator', 'anon', 'MEMBER') and pg_catalog.pg_has_role('cli_login_postgres', 'postgres', 'MEMBER');"
    )"
    if [[ "${rpc_acl_xid_failure_state}" != 't' ]]; then
      echo 'Concurrent-XID rejection changed registry, ACL, default, or role state' >&2
      exit 1
    fi
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = 'enterprise_rpc_acl_gate_039';"
    if wait "${rpc_acl_gate_pid}"; then
      echo 'DDL commit-gate blocker unexpectedly completed' >&2
      exit 1
    fi
    if ! wait "${rpc_acl_race_pid}"; then
      echo 'Concurrent function-DDL writer failed' >&2
      cat "${rpc_acl_race_log}" >&2
      rm -f -- "${rpc_acl_gate_log}" "${rpc_acl_race_log}"
      exit 1
    fi
    rm -f -- "${rpc_acl_gate_log}" "${rpc_acl_race_log}"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_definition_mismatch'
    rpc_acl_race_state="$(
      run_psql --tuples-only --no-align --command \
        "select to_regprocedure('public.faolla_is_merchant_owner(jsonb)') is not null and not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_race_state}" != 't' ]]; then
      echo '039 retry did not observe the committed concurrent overload atomically' >&2
      exit 1
    fi
    run_psql --command "drop function public.faolla_is_merchant_owner(jsonb);"

    echo '[enterprise-integration] rejecting an idle database-owner writer at the catalog lock gate'
    rpc_acl_database_identifier="$(
      run_psql --tuples-only --no-align --command \
        "select pg_catalog.format('%I', pg_catalog.current_database());"
    )"
    rpc_acl_gate_log="$(mktemp)"
    rpc_acl_database_owner_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_gate_log}" "${rpc_acl_database_owner_log}")
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_gate_039'; select pg_catalog.pg_advisory_lock(20260819, 3904); select pg_sleep(30);"
    ) >"${rpc_acl_gate_log}" 2>&1 &
    rpc_acl_gate_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_gate_pid}")
    wait_for_sql_true 'database-owner commit-gate advisory barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_gate_039' and lock_state.locktype = 'advisory' and lock_state.granted);"
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_database_owner_039'; set lock_timeout = 0; begin; alter database ${rpc_acl_database_identifier} owner to redteam_rpc_acl_database_owner_039; select pg_catalog.pg_advisory_xact_lock(20260819, 3904); commit;"
    ) >"${rpc_acl_database_owner_log}" 2>&1 &
    rpc_acl_database_owner_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_database_owner_pid}")
    wait_for_sql_true 'database-owner catalog-lock barrier' \
      "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.application_name = 'enterprise_rpc_acl_database_owner_039' and activity.backend_xid is not null and exists (select 1 from pg_catalog.pg_locks as lock_state where lock_state.pid = activity.pid and lock_state.locktype = 'advisory' and not lock_state.granted) and exists (select 1 from pg_catalog.pg_locks as database_lock where database_lock.pid = activity.pid and database_lock.relation = 'pg_catalog.pg_database'::regclass and database_lock.mode = 'RowExclusiveLock' and database_lock.granted));"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'canceling statement due to lock timeout'
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name in ('enterprise_rpc_acl_database_owner_039', 'enterprise_rpc_acl_gate_039');"
    if wait "${rpc_acl_database_owner_pid}"; then
      echo 'Database-owner writer unexpectedly committed' >&2
      exit 1
    fi
    if wait "${rpc_acl_gate_pid}"; then
      echo 'Database-owner commit-gate blocker unexpectedly completed' >&2
      exit 1
    fi
    rpc_acl_database_owner_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and (select datdba = to_regrole('postgres') from pg_catalog.pg_database where datname = pg_catalog.current_database()) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_database_owner_state}" != 't' ]]; then
      echo 'Database-owner catalog-lock rejection changed database owner, registry, or ACL state' >&2
      exit 1
    fi
    rm -f -- "${rpc_acl_gate_log}" "${rpc_acl_database_owner_log}"

    echo '[enterprise-integration] rejecting an ordinary uncommitted write from a second database'
    run_psql --command "create database enterprise_rpc_acl_shared_039;"
    run_psql \
      --command "\\connect enterprise_rpc_acl_shared_039" \
      --command "create table public.enterprise_rpc_acl_cross_database_probe_039(id integer primary key);"
    rpc_acl_gate_log="$(mktemp)"
    rpc_acl_cross_database_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_gate_log}" "${rpc_acl_cross_database_log}")
    (
      run_psql \
        --command "\\connect enterprise_rpc_acl_shared_039" \
        --command "set application_name = 'enterprise_rpc_acl_gate_039'; select pg_catalog.pg_advisory_lock(20260819, 3902); select pg_sleep(30);"
    ) >"${rpc_acl_gate_log}" 2>&1 &
    rpc_acl_gate_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_gate_pid}")
    wait_for_sql_true 'cross-database rollback-gate advisory barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_gate_039' and lock_state.locktype = 'advisory' and lock_state.granted);"
    (
      run_psql \
        --command "\\connect enterprise_rpc_acl_shared_039" \
        --command "set application_name = 'enterprise_rpc_acl_cross_database_039'; begin; insert into public.enterprise_rpc_acl_cross_database_probe_039(id) values (1); select pg_catalog.pg_advisory_xact_lock(20260819, 3902); commit;"
    ) >"${rpc_acl_cross_database_log}" 2>&1 &
    rpc_acl_cross_database_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_cross_database_pid}")
    wait_for_sql_true 'cross-database assigned-XID barrier' \
      "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.datname = 'enterprise_rpc_acl_shared_039' and activity.application_name = 'enterprise_rpc_acl_cross_database_039' and activity.backend_xid is not null and exists (select 1 from pg_catalog.pg_locks as lock_state where lock_state.pid = activity.pid and lock_state.locktype = 'advisory' and not lock_state.granted));"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_concurrent_transaction'
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = 'enterprise_rpc_acl_gate_039';"
    if wait "${rpc_acl_gate_pid}"; then
      echo 'Cross-database rollback-gate blocker unexpectedly completed' >&2
      exit 1
    fi
    if ! wait "${rpc_acl_cross_database_pid}"; then
      echo 'Cross-database ordinary writer failed to commit after the XID rejection' >&2
      cat "${rpc_acl_cross_database_log}" >&2
      exit 1
    fi
    run_psql \
      --command "\\connect enterprise_rpc_acl_shared_039" \
      --command "do \$\$ begin if (select count(*) from public.enterprise_rpc_acl_cross_database_probe_039) <> 1 then raise exception 'enterprise_rpc_acl_cross_database_write_missing'; end if; end \$\$;"
    rpc_acl_cross_database_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_cross_database_state}" != 't' ]]; then
      echo 'Cross-database XID rejection changed registry or ACL state, or lost the queued write' >&2
      exit 1
    fi
    run_psql --command "drop database enterprise_rpc_acl_shared_039;"
    rm -f -- "${rpc_acl_gate_log}" "${rpc_acl_cross_database_log}"

    rpc_acl_prepared_limit="$(
      run_psql --tuples-only --no-align --command \
        "select current_setting('max_prepared_transactions')::integer;"
    )"
    if [[ "${rpc_acl_prepared_limit}" -gt 0 ]]; then
      echo '[enterprise-integration] rejecting an unrelated prepared transaction cluster-wide'
      run_psql \
        --command "create table public.redteam_rpc_acl_prepared_probe_039(id integer primary key);" \
        --command "begin; insert into public.redteam_rpc_acl_prepared_probe_039(id) values (1); prepare transaction 'enterprise_rpc_acl_prepared_039';"
      wait_for_sql_true 'prepared-transaction catalog barrier' \
        "select exists (select 1 from pg_catalog.pg_prepared_xacts where gid = 'enterprise_rpc_acl_prepared_039');"
      expect_sql_file_error_as_role "${migration}" supabase_admin \
        'runtime_rpc_execute_acl_hardening_concurrent_transaction'
      rpc_acl_prepared_state="$(
        run_psql --tuples-only --no-align --command \
          "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and not exists (select 1 from public.redteam_rpc_acl_prepared_probe_039) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
      )"
      if [[ "${rpc_acl_prepared_state}" != 't' ]]; then
        echo 'Prepared-XID rejection changed registry, ACL, or visible probe state' >&2
        exit 1
      fi
      run_psql \
        --command "rollback prepared 'enterprise_rpc_acl_prepared_039';" \
        --command "drop table public.redteam_rpc_acl_prepared_probe_039;"
    else
      echo '[enterprise-integration] max_prepared_transactions=0; static contract covers the prepared-transaction gate'
    fi

    echo '[enterprise-integration] rejecting a registry-owning XID before waiting on the registry lock'
    rpc_acl_gate_log="$(mktemp)"
    rpc_acl_registry_writer_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_gate_log}" "${rpc_acl_registry_writer_log}")
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_gate_039'; select pg_catalog.pg_advisory_lock(20260819, 3903); select pg_sleep(30);"
    ) >"${rpc_acl_gate_log}" 2>&1 &
    rpc_acl_gate_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_gate_pid}")
    wait_for_sql_true 'registry-writer rollback-gate advisory barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_gate_039' and lock_state.locktype = 'advisory' and lock_state.granted);"
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_controlled_writer_039'; begin; insert into public.faolla_schema_migrations(version, name) values (209608190039, 'redteam_registry_writer_039'); select pg_catalog.pg_advisory_xact_lock(20260819, 3903); commit;"
    ) >"${rpc_acl_registry_writer_log}" 2>&1 &
    rpc_acl_registry_writer_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_registry_writer_pid}")
    wait_for_sql_true 'registry-owning assigned-XID barrier' \
      "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.application_name = 'enterprise_rpc_acl_controlled_writer_039' and activity.backend_xid is not null and exists (select 1 from pg_catalog.pg_locks as lock_state where lock_state.pid = activity.pid and lock_state.relation = 'public.faolla_schema_migrations'::regclass and lock_state.mode = 'RowExclusiveLock' and lock_state.granted));"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_concurrent_transaction'
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name in ('enterprise_rpc_acl_controlled_writer_039', 'enterprise_rpc_acl_gate_039');"
    if wait "${rpc_acl_registry_writer_pid}"; then
      echo 'Registry-owning writer unexpectedly committed' >&2
      exit 1
    fi
    if wait "${rpc_acl_gate_pid}"; then
      echo 'Registry-writer rollback-gate blocker unexpectedly completed' >&2
      exit 1
    fi
    rpc_acl_registry_writer_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version in (202608190039, 209608190039)) and has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_registry_writer_state}" != 't' ]]; then
      echo 'Registry-owning XID rejection changed registry or ACL state' >&2
      exit 1
    fi
    rm -f -- "${rpc_acl_gate_log}" "${rpc_acl_registry_writer_log}"

    echo '[enterprise-integration] rejecting same-OID definition drift'
    run_psql --command \
      "create table public.redteam_rpc_definition_backup_039(source text not null); insert into public.redteam_rpc_definition_backup_039(source) select prosrc from pg_catalog.pg_proc where oid = 'public.faolla_is_merchant_owner(text)'::regprocedure; create or replace function public.faolla_is_merchant_owner(target_merchant_id text) returns boolean language sql stable security definer set search_path = public as \$\$ select true \$\$;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_definition_mismatch'
    run_psql --command \
      "do \$\$ declare v_source text; begin select source into strict v_source from public.redteam_rpc_definition_backup_039; execute format('create or replace function public.faolla_is_merchant_owner(target_merchant_id text) returns boolean language sql stable security definer set search_path = public as %L', v_source); end \$\$; drop table public.redteam_rpc_definition_backup_039;"

    echo '[enterprise-integration] proving postcondition failure rolls back all ACL and role mutations'
    run_psql --command \
      "alter default privileges for role pg_monitor grant execute on functions to anon; grant supabase_admin to authenticator;"
    expect_sql_file_error_as_role "${migration}" supabase_admin \
      'runtime_rpc_execute_acl_hardening_default_acl_invariant_failed'
    rpc_acl_atomic_rollback_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190039) and pg_catalog.pg_has_role('authenticator', 'supabase_admin', 'MEMBER') and pg_catalog.has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and exists (select 1 from pg_catalog.pg_default_acl as defaults cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl where defaults.defaclrole = to_regrole('pg_monitor') and defaults.defaclnamespace = 0 and defaults.defaclobjtype = 'f' and acl.grantee = to_regrole('anon') and acl.privilege_type = 'EXECUTE') and has_table_privilege('redteam_rpc_acl_child_039', 'public.faolla_schema_migrations', 'SELECT') and has_column_privilege('redteam_rpc_acl_child_039', 'public.faolla_schema_migrations', 'applied_at', 'UPDATE') and has_table_privilege('service_role', 'public.faolla_schema_migrations', 'TRUNCATE') and exists (select 1 from pg_catalog.pg_class as registry_metadata cross join lateral pg_catalog.aclexplode(registry_metadata.relacl) as acl where registry_metadata.oid = 'public.faolla_schema_migrations'::regclass and acl.grantee = to_regrole('service_role') and acl.grantor = to_regrole('\"redteam rpc acl 039\"') and acl.privilege_type = 'SELECT');"
    )"
    if [[ "${rpc_acl_atomic_rollback_state}" != 't' ]]; then
      echo '039 postcondition failure did not atomically restore pre-migration state' >&2
      exit 1
    fi
    run_psql --command \
      "alter default privileges for role pg_monitor revoke execute on functions from anon; revoke supabase_admin from authenticator;"

    echo '[enterprise-integration] applying 039 under the current official role topology'
    rpc_acl_database_identifier="$(
      run_psql --tuples-only --no-align --command \
        "select pg_catalog.format('%I', pg_catalog.current_database());"
    )"
    run_psql --command \
      "create type public.redteam_rpc_acl_type_probe_039 as enum ('a');"
    rpc_acl_registry_blocker_log="$(mktemp)"
    rpc_acl_migration_log="$(mktemp)"
    rpc_acl_second_migration_log="$(mktemp)"
    rpc_acl_postlock_ddl_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_registry_blocker_log}"
      "${rpc_acl_migration_log}" "${rpc_acl_second_migration_log}"
      "${rpc_acl_postlock_ddl_log}")
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_registry_blocker_039'; begin; lock table public.faolla_schema_migrations in row exclusive mode; select pg_sleep(30); commit;"
    ) >"${rpc_acl_registry_blocker_log}" 2>&1 &
    rpc_acl_registry_blocker_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_registry_blocker_pid}")
    wait_for_sql_true 'registry RowExclusiveLock barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.datname = current_database() and activity.application_name = 'enterprise_rpc_acl_registry_blocker_039' and activity.xact_start is not null and lock_state.relation = 'public.faolla_schema_migrations'::regclass and lock_state.mode = 'RowExclusiveLock' and lock_state.granted);"
    (
      PGAPPNAME=enterprise_rpc_acl_migration_barrier_039 \
        PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" \
        run_psql \
          --command "select pg_catalog.pg_advisory_lock(20260731, 1);" \
          --command "set role supabase_admin" \
          --file "${migration}" \
          --command "reset role" \
          --command "do \$\$ begin if not pg_catalog.pg_advisory_unlock(20260731, 1) then raise exception 'runtime_rpc_execute_acl_wrapper_unlock_failed'; end if; if exists (select 1 from pg_catalog.pg_locks where pid = pg_catalog.pg_backend_pid() and locktype = 'advisory') then raise exception 'runtime_rpc_execute_acl_wrapper_lock_leaked'; end if; end \$\$;"
    ) >"${rpc_acl_migration_log}" 2>&1 &
    rpc_acl_migration_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_migration_pid}")
    wait_for_sql_true 'migration ten-catalog gate and registry wait barrier' \
      "select exists (select 1 from pg_catalog.pg_stat_activity as activity where activity.datname = current_database() and activity.application_name = 'enterprise_rpc_acl_migration_barrier_039' and activity.backend_xid is null and 10 = (select count(*) from pg_catalog.pg_locks as catalog_lock where catalog_lock.pid = activity.pid and catalog_lock.relation in ('pg_catalog.pg_database'::regclass, 'pg_catalog.pg_authid'::regclass, 'pg_catalog.pg_auth_members'::regclass, 'pg_catalog.pg_namespace'::regclass, 'pg_catalog.pg_language'::regclass, 'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_proc'::regclass, 'pg_catalog.pg_default_acl'::regclass, 'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_attribute'::regclass) and catalog_lock.mode = 'ShareRowExclusiveLock' and catalog_lock.granted) and exists (select 1 from pg_catalog.pg_locks as registry_lock where registry_lock.pid = activity.pid and registry_lock.relation = 'public.faolla_schema_migrations'::regclass and registry_lock.mode = 'ShareRowExclusiveLock' and not registry_lock.granted));"
    rpc_acl_catalog_read_state="$(
      run_psql --quiet --tuples-only --no-align --command \
        "set statement_timeout = '2s'; select (select count(*) from pg_catalog.pg_database) > 0 and (select count(*) from pg_catalog.pg_authid) > 0 and (select count(*) from pg_catalog.pg_auth_members) >= 0 and (select count(*) from pg_catalog.pg_namespace) > 0 and (select count(*) from pg_catalog.pg_language) > 0 and (select count(*) from pg_catalog.pg_type) > 0 and (select count(*) from pg_catalog.pg_proc) > 0 and (select count(*) from pg_catalog.pg_default_acl) >= 0 and (select count(*) from pg_catalog.pg_class) > 0 and (select count(*) from pg_catalog.pg_attribute) > 0;"
    )"
    if [[ "${rpc_acl_catalog_read_state}" != 't' ]]; then
      echo 'Catalog SHARE ROW EXCLUSIVE gates blocked an ordinary catalog read' >&2
      exit 1
    fi
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_database_039' 'pg_database' \
      "alter database ${rpc_acl_database_identifier} owner to redteam_rpc_acl_database_owner_039;"
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_authid_039' 'pg_authid' \
      'alter role redteam_rpc_acl_untrusted_039 login;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_auth_members_039' 'pg_auth_members' \
      'grant service_role to redteam_rpc_acl_untrusted_039;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_namespace_039' 'pg_namespace' \
      'grant create on schema public to redteam_rpc_acl_untrusted_039;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_language_039' 'pg_language' \
      'alter language plpgsql owner to supabase_admin;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_type_039' 'pg_type' \
      'alter type public.redteam_rpc_acl_type_probe_039 owner to supabase_admin;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_proc_039' 'pg_proc' \
      "create function public.redteam_rpc_acl_proc_probe_039() returns integer language sql as 'select 1';"
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_default_acl_039' 'pg_default_acl' \
      'alter default privileges for role redteam_rpc_acl_untrusted_039 grant execute on functions to authenticated;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_class_table_grant_039' 'pg_class' \
      'grant update on table public.faolla_schema_migrations to redteam_rpc_acl_untrusted_039;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_class_column_grant_039' 'pg_class' \
      'grant update(applied_at) on table public.faolla_schema_migrations to redteam_rpc_acl_untrusted_039;'
    assert_rpc_acl_catalog_writer_waits \
      'enterprise_rpc_acl_catalog_attribute_lock_039' 'pg_attribute' \
      'lock table pg_catalog.pg_attribute in row exclusive mode;'
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_postlock_ddl_039'; create function public.faolla_rpc_acl_postlock_canary_039() returns integer language sql as \$\$ select 1 \$\$;"
    ) >"${rpc_acl_postlock_ddl_log}" 2>&1 &
    rpc_acl_postlock_ddl_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_postlock_ddl_pid}")
    wait_for_sql_true 'post-lock function DDL wait barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.datname = current_database() and activity.application_name = 'enterprise_rpc_acl_postlock_ddl_039' and activity.backend_xid is null and lock_state.relation = 'pg_catalog.pg_proc'::regclass and lock_state.mode = 'RowExclusiveLock' and not lock_state.granted);"
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname = current_database() and application_name = 'enterprise_rpc_acl_registry_blocker_039';"
    if wait "${rpc_acl_registry_blocker_pid}"; then
      echo 'Registry blocker unexpectedly committed instead of being released' >&2
      exit 1
    fi
    if ! wait "${rpc_acl_migration_pid}"; then
      echo '039 migration failed after the reverse DDL barrier' >&2
      cat "${rpc_acl_migration_log}" >&2
      exit 1
    fi
    if ! wait "${rpc_acl_postlock_ddl_pid}"; then
      echo 'Post-lock function DDL failed after 039 committed' >&2
      cat "${rpc_acl_postlock_ddl_log}" >&2
      exit 1
    fi
    rpc_acl_gate_log="$(mktemp)"
    rpc_acl_temp_logs+=("${rpc_acl_gate_log}")
    (
      run_psql --command \
        "set application_name = 'enterprise_rpc_acl_gate_039'; select pg_catalog.pg_advisory_lock(20260731, 1); select pg_sleep(30);"
    ) >"${rpc_acl_gate_log}" 2>&1 &
    rpc_acl_gate_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_gate_pid}")
    wait_for_sql_true 'deployment-mutex session blocker barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_gate_039' and lock_state.locktype = 'advisory' and lock_state.granted);"
    (
      PGAPPNAME=enterprise_rpc_acl_second_migration_039 \
        run_sql_file_as_role "${migration}" supabase_admin
    ) >"${rpc_acl_second_migration_log}" 2>&1 &
    rpc_acl_second_migration_pid=$!
    rpc_acl_background_pids+=("${rpc_acl_second_migration_pid}")
    wait_for_sql_true 'second migration deployment-mutex wait barrier' \
      "select exists (select 1 from pg_catalog.pg_locks as lock_state join pg_catalog.pg_stat_activity as activity using (pid) where activity.application_name = 'enterprise_rpc_acl_second_migration_039' and activity.backend_xid is null and lock_state.locktype = 'advisory' and not lock_state.granted);"
    run_psql --command \
      "select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = 'enterprise_rpc_acl_gate_039';"
    if wait "${rpc_acl_gate_pid}"; then
      echo 'Deployment-mutex session blocker unexpectedly completed' >&2
      exit 1
    fi
    if ! wait "${rpc_acl_second_migration_pid}"; then
      echo 'Second serialized 039 retry failed' >&2
      cat "${rpc_acl_second_migration_log}" >&2
      exit 1
    fi
    rm -f -- "${rpc_acl_registry_blocker_log}" \
      "${rpc_acl_migration_log}" "${rpc_acl_second_migration_log}" \
      "${rpc_acl_postlock_ddl_log}" "${rpc_acl_gate_log}"
    rpc_acl_postlock_state="$(
      run_psql --tuples-only --no-align --command \
        "select exists (select 1 from public.faolla_schema_migrations where version = 202608190039 and name = 'runtime_rpc_execute_acl_hardening') and to_regprocedure('public.faolla_rpc_acl_postlock_canary_039()') is not null and not has_function_privilege('anon', 'public.faolla_rpc_acl_postlock_canary_039()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.faolla_rpc_acl_postlock_canary_039()', 'EXECUTE') and not has_function_privilege('service_role', 'public.faolla_rpc_acl_postlock_canary_039()', 'EXECUTE') and 1 = (select count(*) from pg_catalog.pg_proc as metadata cross join lateral pg_catalog.aclexplode(coalesce(metadata.proacl, pg_catalog.acldefault('f', metadata.proowner))) as acl where metadata.oid = 'public.faolla_rpc_acl_postlock_canary_039()'::regprocedure) and 1 = (select count(*) from pg_catalog.pg_proc as metadata cross join lateral pg_catalog.aclexplode(coalesce(metadata.proacl, pg_catalog.acldefault('f', metadata.proowner))) as acl where metadata.oid = 'public.faolla_rpc_acl_postlock_canary_039()'::regprocedure and acl.grantee = metadata.proowner and acl.grantor = metadata.proowner and acl.privilege_type = 'EXECUTE' and not acl.is_grantable);"
    )"
    if [[ "${rpc_acl_postlock_state}" != 't' ]]; then
      echo 'Post-lock function DDL inherited a non-owner runtime ACL' >&2
      exit 1
    fi
    run_psql --command \
      "drop function public.faolla_rpc_acl_postlock_canary_039(); drop type public.redteam_rpc_acl_type_probe_039;"

    rpc_acl_normalized_state="$(
      run_psql --tuples-only --no-align --command \
        "select not has_function_privilege('redteam rpc acl 039', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and not has_function_privilege('redteam_rpc_acl_child_039', 'public.faolla_enqueue_merchant_outbox_v1(jsonb)', 'EXECUTE') and has_function_privilege('authenticated', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and not has_function_privilege('service_role', 'public.faolla_upsert_merchant_order_v1(jsonb,jsonb,jsonb)', 'EXECUTE') and has_function_privilege('service_role', 'public.faolla_enqueue_merchant_outbox_v1(jsonb)', 'EXECUTE');"
    )"
    if [[ "${rpc_acl_normalized_state}" != 't' ]]; then
      echo '039 did not normalize exact runtime RPC ACLs' >&2
      exit 1
    fi
    rpc_acl_registry_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "with registry as (select relowner, relacl from pg_catalog.pg_class where oid = 'public.faolla_schema_migrations'::regclass), actual as (select acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable from registry cross join lateral pg_catalog.aclexplode(coalesce(registry.relacl, pg_catalog.acldefault('r', registry.relowner))) as acl), expected as (select owner_acl.grantee, owner_acl.grantor, owner_acl.privilege_type, owner_acl.is_grantable from registry cross join lateral pg_catalog.aclexplode(pg_catalog.acldefault('r', registry.relowner)) as owner_acl union all select to_regrole('service_role'), registry.relowner, 'SELECT'::text, false from registry), delta as ((select * from actual except select * from expected) union all (select * from expected except select * from actual)) select not exists (select 1 from delta) and not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.faolla_schema_migrations'::regclass and attnum > 0 and not attisdropped and attacl is not null);"
    )"
    if [[ "${rpc_acl_registry_acl_state}" != 't' ]]; then
      echo '039 did not normalize the exact registry table and column ACLs' >&2
      exit 1
    fi

    echo '[enterprise-integration] retrying unregistered 039 under the removable legacy role topology'
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190039; revoke anon, authenticated, service_role from postgres; revoke authenticator from supabase_storage_admin; revoke postgres from cli_login_postgres; drop role cli_login_postgres; grant supabase_admin to authenticator; alter role anon noinherit; alter role authenticated noinherit; alter role service_role noinherit;"
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" \
      run_sql_file_as_role "${migration}" supabase_admin
    legacy_edge_state="$(
      run_psql --tuples-only --no-align --command \
        "select not pg_catalog.pg_has_role('authenticator', 'supabase_admin', 'MEMBER') and exists (select 1 from public.faolla_schema_migrations where version = 202608190039 and name = 'runtime_rpc_execute_acl_hardening');"
    )"
    if [[ "${legacy_edge_state}" != 't' ]]; then
      echo '039 did not remove the legacy authenticator-to-superuser edge' >&2
      exit 1
    fi
    run_psql --command "drop role redteam_rpc_acl_database_owner_039;"
  elif [[ "$(basename -- "${migration}")" == \
    "202608190037_ordinary_account_authorization_cutover.sql" ]]; then
    echo '[enterprise-integration] running all pre-cutover acceptance before 037 exists in the registry'
    run_pre_cutover_acceptance
    pre_cutover_acceptance_ran=1
    echo '[enterprise-integration] applying the controlled authoritative fixture backfill'
    run_psql --command \
      "insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ('10000000-0000-4000-8000-000000000001'::uuid, 'owner-a@example.test', '{}'::jsonb, '{}'::jsonb), ('20000000-0000-4000-8000-000000000002'::uuid, 'owner-b@example.test', '{}'::jsonb, '{}'::jsonb) on conflict (id) do nothing; update public.merchants set user_id = '10000000-0000-4000-8000-000000000001'::uuid, auth_user_id = '10000000-0000-4000-8000-000000000001'::uuid, owner_user_id = '10000000-0000-4000-8000-000000000001'::uuid, owner_id = '10000000-0000-4000-8000-000000000001'::uuid, auth_id = '10000000-0000-4000-8000-000000000001'::uuid, created_by = '10000000-0000-4000-8000-000000000001'::uuid, created_by_user_id = '10000000-0000-4000-8000-000000000001'::uuid where id = '10000001'; update public.merchants set user_id = '20000000-0000-4000-8000-000000000002'::uuid, auth_user_id = '20000000-0000-4000-8000-000000000002'::uuid, owner_user_id = '20000000-0000-4000-8000-000000000002'::uuid, owner_id = '20000000-0000-4000-8000-000000000002'::uuid, auth_id = '20000000-0000-4000-8000-000000000002'::uuid, created_by = '20000000-0000-4000-8000-000000000002'::uuid, created_by_user_id = '20000000-0000-4000-8000-000000000002'::uuid where id = '10000002';"
    pre_cutover_ready="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() ->> 'readyForCutover')::boolean;"
    )"
    if [[ "${pre_cutover_ready}" != 't' ]]; then
      echo 'Controlled fixture backfill did not satisfy authoritative cutover readiness' >&2
      exit 1
    fi
    echo '[enterprise-integration] proving mutable metadata is observation-only for authoritative cutover readiness'
    run_psql --command \
      "insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data) values ('c7000000-0000-4000-8000-000000000001'::uuid, 'mutable-readiness-noise@example.test', '{}'::jsonb, '{\"account_type\":\"personal\",\"personal_id\":\"mutable-readiness-noise\"}'::jsonb);"
    shadow_ready="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authorization_readiness_v1() ->> 'readyForCutover')::boolean;"
    )"
    authoritative_ready="$(
      run_psql --tuples-only --no-align --command \
        "select (public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() ->> 'readyForCutover')::boolean;"
    )"
    if [[ "${shadow_ready}" != 'f' || "${authoritative_ready}" != 't' ]]; then
      echo 'Mutable metadata did not remain observation-only for authoritative readiness' >&2
      exit 1
    fi

    echo '[enterprise-integration] rejecting a conflicting 037 registry name before behavior DDL'
    run_psql --command \
      "grant execute on function public.faolla_is_merchant_owner(text) to redteam_custom_api with grant option; grant select on table public.merchants to redteam_custom_api with grant option; grant update(name) on table public.merchants to redteam_custom_api with grant option; set role redteam_custom_api; grant execute on function public.faolla_is_merchant_owner(text) to redteam_custom_child; grant select on table public.merchants to redteam_custom_child; grant update(name) on table public.merchants to redteam_custom_child; reset role;"
    run_psql --command \
      "insert into public.faolla_schema_migrations(version, name) values (202608190037, 'redteam_wrong_037');"
    expect_sql_file_error "${migration}" \
      'ordinary_account_rls_cutover_registry_conflict'
    cutover_registry_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select count(*) = 1 and position('auth.jwt' in lower(pg_get_functiondef('public.faolla_is_merchant_owner(text)'::regprocedure))) > 0 and has_function_privilege('redteam_custom_api', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and has_function_privilege('redteam_custom_child', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and has_table_privilege('redteam_custom_api', 'public.merchants', 'SELECT') and has_table_privilege('redteam_custom_child', 'public.merchants', 'SELECT') and has_column_privilege('redteam_custom_api', 'public.merchants', 'name', 'UPDATE') and has_column_privilege('redteam_custom_child', 'public.merchants', 'name', 'UPDATE') from public.faolla_schema_migrations where version = 202608190037 and name = 'redteam_wrong_037';"
    )"
    if [[ "${cutover_registry_conflict_state}" != 't' ]]; then
      echo '037 registry conflict changed owner behavior or the registry row' >&2
      exit 1
    fi
    run_psql --command \
      "delete from public.faolla_schema_migrations where version = 202608190037 and name = 'redteam_wrong_037';"

    echo '[enterprise-integration] rejecting a custom protected-table ACL before behavior DDL'
    expect_sql_file_error "${migration}" \
      'ordinary_account_rls_cutover_table_acl_invalid'
    cutover_table_acl_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and position('auth.jwt' in lower(pg_get_functiondef('public.faolla_is_merchant_owner(text)'::regprocedure))) > 0 and has_table_privilege('redteam_custom_api', 'public.merchants', 'SELECT') and has_table_privilege('redteam_custom_child', 'public.merchants', 'SELECT') and has_column_privilege('redteam_custom_api', 'public.merchants', 'name', 'UPDATE') and has_column_privilege('redteam_custom_child', 'public.merchants', 'name', 'UPDATE') and (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_insert_self', 'merchants_update_own')) = 2;"
    )"
    if [[ "${cutover_table_acl_conflict_state}" != 't' ]]; then
      echo 'Custom table-ACL rejection changed owner behavior, policies, grants, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "revoke all privileges on table public.merchants from redteam_custom_api cascade; revoke all privileges on table public.merchants from redteam_custom_child cascade; revoke all privileges (name) on table public.merchants from redteam_custom_api cascade; revoke all privileges (name) on table public.merchants from redteam_custom_child cascade;"

    echo '[enterprise-integration] rejecting an extra known-role table privilege before behavior DDL'
    run_psql --command \
      "grant truncate on table public.merchants to authenticated;"
    expect_sql_file_error "${migration}" \
      'ordinary_account_rls_cutover_table_acl_invalid'
    cutover_known_role_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and position('auth.jwt' in lower(pg_get_functiondef('public.faolla_is_merchant_owner(text)'::regprocedure))) > 0 and has_table_privilege('authenticated', 'public.merchants', 'TRUNCATE') and (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_insert_self', 'merchants_update_own')) = 2;"
    )"
    if [[ "${cutover_known_role_acl_state}" != 't' ]]; then
      echo 'Known-role table-ACL rejection changed owner behavior, policies, grants, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "revoke truncate on table public.merchants from authenticated;"

    echo '[enterprise-integration] rejecting extra permissive policies before behavior DDL'
    run_psql --command \
      "create policy redteam_extra_merchants on public.merchants for select to authenticated using (true); create policy redteam_extra_pages on public.pages for select to authenticated using (true); create policy redteam_extra_orders on public.merchant_orders for select to authenticated using (true);"
    expect_sql_file_error "${migration}" \
      'ordinary_account_rls_cutover_policy_allowlist_invalid'
    cutover_policy_conflict_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and position('auth.jwt' in lower(pg_get_functiondef('public.faolla_is_merchant_owner(text)'::regprocedure))) > 0 and (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and policyname in ('redteam_extra_merchants', 'redteam_extra_pages', 'redteam_extra_orders')) = 3 and (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname in ('merchants_insert_self', 'merchants_update_own')) = 2;"
    )"
    if [[ "${cutover_policy_conflict_state}" != 't' ]]; then
      echo 'Extra-policy rejection changed owner behavior, legacy policies, or registry' >&2
      exit 1
    fi
    run_psql --command \
      "drop policy redteam_extra_merchants on public.merchants; drop policy redteam_extra_pages on public.pages; drop policy redteam_extra_orders on public.merchant_orders;"

    echo '[enterprise-integration] rejecting a broadened anonymous page policy before behavior DDL'
    run_psql --command \
      "drop policy pages_public_home_read on public.pages; create policy pages_public_home_read on public.pages for select to anon using (true);"
    expect_sql_file_error "${migration}" \
      'ordinary_account_rls_cutover_public_page_policy_invalid'
    cutover_page_policy_state="$(
      run_psql --tuples-only --no-align --command \
        "select not exists (select 1 from public.faolla_schema_migrations where version = 202608190037) and position('auth.jwt' in lower(pg_get_functiondef('public.faolla_is_merchant_owner(text)'::regprocedure))) > 0 and regexp_replace(lower(coalesce(qual, '')), '[[:space:]()]', '', 'g') = 'true' from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'pages' and policyname = 'pages_public_home_read';"
    )"
    if [[ "${cutover_page_policy_state}" != 't' ]]; then
      echo 'Anonymous-page-policy rejection changed owner behavior or registry' >&2
      exit 1
    fi
    run_psql --command \
      "drop policy pages_public_home_read on public.pages; create policy pages_public_home_read on public.pages for select to anon using (merchant_id is null and slug = 'home');"

    run_sql_file "${migration}"
    cutover_custom_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not has_function_privilege('redteam_custom_api', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and not has_function_privilege('redteam_custom_child', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${cutover_custom_acl_state}" != 't' ]]; then
      echo '037 did not remove a pre-existing custom owner-helper grant' >&2
      exit 1
    fi
    echo '[enterprise-integration] retrying unregistered 037 with quote_all_identifiers=on'
    run_psql --command \
      "grant execute on function public.faolla_is_merchant_owner(text) to redteam_custom_api with grant option; set role redteam_custom_api; grant execute on function public.faolla_is_merchant_owner(text) to redteam_custom_child; reset role; delete from public.faolla_schema_migrations where version = 202608190037;"
    PGOPTIONS="${PGOPTIONS} -c quote_all_identifiers=on" run_sql_file "${migration}"
    cutover_retry_acl_state="$(
      run_psql --tuples-only --no-align --command \
        "select not has_function_privilege('redteam_custom_api', 'public.faolla_is_merchant_owner(text)', 'EXECUTE') and not has_function_privilege('redteam_custom_child', 'public.faolla_is_merchant_owner(text)', 'EXECUTE');"
    )"
    if [[ "${cutover_retry_acl_state}" != 't' ]]; then
      echo '037 retry retained a custom owner-helper grant' >&2
      exit 1
    fi
  else
    run_sql_file "${migration}"
  fi
done

if [[ "${pre_cutover_acceptance_ran}" -ne 1 ]]; then
  echo '[enterprise-integration] running additive 036 acceptance without a 037 cutover file'
  run_pre_cutover_acceptance
  pre_cutover_acceptance_ran=1
fi

registry_count="$(
  run_psql --tuples-only --no-align --command \
    "select count(*) from public.faolla_schema_migrations where version in (202607250001, 202607250002, 202607250003, 202607250004, 202607250005, 202607250006, 202607250007, 202607250008, 202608180032, 202608190033, 202608190034, 202608190035, 202608190036, 202608190037, 202608190038, 202608190039) or version between 202607310001 and 202608040026;"
)"
if [[ "${registry_count}" -ne "${expected_registry_count}" ]]; then
  echo "Expected ${expected_registry_count} applied prerequisite/enterprise/identity versions, found ${registry_count}" >&2
  exit 1
fi

if [[ "${cutover_present}" -eq 1 ]]; then
  run_sql_file "${SCRIPT_DIR}/55-ordinary-account-authorization-cutover.sql"
fi
if [[ "${isolation_present}" -eq 1 ]]; then
  if [[ "${isolation_retry_updated_at_unchanged}" -ne 1 ]]; then
    echo '037 isolation retry verification did not run' >&2
    exit 1
  fi
  if [[ "${isolation_absent_site_retry_verified}" -ne 1 ]]; then
    echo '037 absent-site retry verification did not run' >&2
    exit 1
  fi
  PGOPTIONS="${PGOPTIONS} -c enterprise_integration.system_site_retry_updated_at_unchanged=true -c enterprise_integration.system_site_absent_retry_verified=true" \
    run_sql_file "${SCRIPT_DIR}/59-ordinary-account-system-site-principal-isolation.sql"
  if [[ "${recovery_observer_present}" -eq 1 ]]; then
    run_sql_file "${SCRIPT_DIR}/60-ordinary-account-recovery-observer.sql"
  fi
  if [[ "${rpc_acl_hardening_present}" -eq 1 ]]; then
    run_sql_file "${SCRIPT_DIR}/61-runtime-rpc-execute-acl-hardening.sql"
  fi
  echo '[enterprise-integration] restoring serial and system-site race fixtures after isolation acceptance'
  run_psql --command \
    "update public.merchants set user_id = '10000000-0000-4000-8000-000000000001'::uuid, auth_user_id = '10000000-0000-4000-8000-000000000001'::uuid, owner_user_id = '10000000-0000-4000-8000-000000000001'::uuid, owner_id = '10000000-0000-4000-8000-000000000001'::uuid, auth_id = '10000000-0000-4000-8000-000000000001'::uuid, created_by = '10000000-0000-4000-8000-000000000001'::uuid, created_by_user_id = '10000000-0000-4000-8000-000000000001'::uuid where id = '10000001'; update public.merchants set user_id = 'd3500000-0000-4000-8000-000000000001'::uuid where id = 'site-main';"
fi
run_sql_file "${SCRIPT_DIR}/56-ordinary-account-lock-race-setup.sql"

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

run_pair() {
  local kind="$1"
  local expected_error="$2"
  shift 2
  local log_a="${work_dir}/${kind}-a.log"
  local log_b="${work_dir}/${kind}-b.log"
  local status_a status_b

  set +e
  "$@" A >"${log_a}" 2>&1 &
  local pid_a=$!
  "$@" B >"${log_b}" 2>&1 &
  local pid_b=$!
  wait "${pid_a}"
  status_a=$?
  wait "${pid_b}"
  status_b=$?
  set -e

  if ! { [[ "${status_a}" -eq 0 && "${status_b}" -ne 0 ]] || \
         [[ "${status_b}" -eq 0 && "${status_a}" -ne 0 ]]; }; then
    echo "${kind} expected one success and one ${expected_error}; got A=${status_a}, B=${status_b}" >&2
    cat "${log_a}" >&2
    cat "${log_b}" >&2
    return 1
  fi

  local loser_log="${log_a}"
  if [[ "${status_b}" -ne 0 ]]; then
    loser_log="${log_b}"
  fi
  if ! grep -q "${expected_error}" "${loser_log}"; then
    echo "${kind} losing session did not report ${expected_error}" >&2
    cat "${loser_log}" >&2
    return 1
  fi
}

run_both_fail() {
  local kind="$1"
  local expected_error="$2"
  shift 2
  local log_a="${work_dir}/${kind}-a.log"
  local log_b="${work_dir}/${kind}-b.log"
  local status_a status_b

  set +e
  "$@" A >"${log_a}" 2>&1 &
  local pid_a=$!
  "$@" B >"${log_b}" 2>&1 &
  local pid_b=$!
  wait "${pid_a}"
  status_a=$?
  wait "${pid_b}"
  status_b=$?
  set -e

  if [[ "${status_a}" -eq 0 || "${status_b}" -eq 0 ]]; then
    echo "${kind} expected two ${expected_error} failures; got A=${status_a}, B=${status_b}" >&2
    cat "${log_a}" >&2
    cat "${log_b}" >&2
    return 1
  fi
  if ! grep -q "${expected_error}" "${log_a}" ||
     ! grep -q "${expected_error}" "${log_b}"; then
    echo "${kind} sessions did not both report ${expected_error}" >&2
    cat "${log_a}" >&2
    cat "${log_b}" >&2
    return 1
  fi
}

task_worker() {
  local worker="$1"
  run_psql \
    --set "worker_title=CAS task worker ${worker}" \
    --set "worker_operation=integration-task-cas-${worker,,}" \
    --file "${SCRIPT_DIR}/20-task-cas-worker.sql"
}

invitation_worker() {
  local worker="$1"
  local token_hash
  if [[ "${worker}" == A ]]; then
    token_hash="$(printf 'b%.0s' {1..64})"
  else
    token_hash="$(printf 'c%.0s' {1..64})"
  fi
  run_psql \
    --set "worker_token_hash=${token_hash}" \
    --file "${SCRIPT_DIR}/21-invitation-cas-worker.sql"
}

workflow_worker() {
  local worker="$1"
  run_psql \
    --set "worker_title=Workflow CAS worker ${worker}" \
    --set "worker_operation=integration-workflow-cas-${worker,,}" \
    --file "${SCRIPT_DIR}/41-workflow-cas-worker.sql"
}

restore_limit_worker() {
  local worker="$1"
  local restore_target restore_operation
  if [[ "${worker}" == A ]]; then
    restore_target='73000000-0000-4000-8000-000000000001'
    restore_operation='integration-workflow-restore-limit-a'
  else
    restore_target='73000000-0000-4000-8000-000000000002'
    restore_operation='integration-workflow-restore-limit-b'
  fi
  run_psql \
    --set "restore_target=${restore_target}" \
    --set "restore_operation=${restore_operation}" \
    --file "${SCRIPT_DIR}/44-workflow-restore-limit-worker.sql"
}

ordinary_staff_worker() {
  local worker="$1"
  local ordinary_staff_writer=false
  local staff_ordinary_writer=false
  if [[ "${worker}" == A ]]; then
    ordinary_staff_writer=true
  else
    staff_ordinary_writer=true
  fi
  run_psql \
    --set "ordinary_staff_writer=${ordinary_staff_writer}" \
    --set "staff_ordinary_writer=${staff_ordinary_writer}" \
    --set "ordinary_delete_writer=false" \
    --set "delete_ordinary_writer=false" \
    --set "bound_bootstrap_writer=false" \
    --set "delete_bound_writer=false" \
    --set "system_ordinary_writer=false" \
    --set "system_staff_writer=false" \
    --file "${SCRIPT_DIR}/57-ordinary-account-lock-race-worker.sql"
}

ordinary_auth_delete_worker() {
  local worker="$1"
  local ordinary_delete_writer=false
  local delete_ordinary_writer=false
  if [[ "${worker}" == A ]]; then
    ordinary_delete_writer=true
  else
    delete_ordinary_writer=true
  fi
  run_psql \
    --set "ordinary_staff_writer=false" \
    --set "staff_ordinary_writer=false" \
    --set "ordinary_delete_writer=${ordinary_delete_writer}" \
    --set "delete_ordinary_writer=${delete_ordinary_writer}" \
    --set "bound_bootstrap_writer=false" \
    --set "delete_bound_writer=false" \
    --set "system_ordinary_writer=false" \
    --set "system_staff_writer=false" \
    --file "${SCRIPT_DIR}/57-ordinary-account-lock-race-worker.sql"
}

bound_auth_delete_worker() {
  local worker="$1"
  local bound_bootstrap_writer=false
  local delete_bound_writer=false
  if [[ "${worker}" == A ]]; then
    bound_bootstrap_writer=true
  else
    delete_bound_writer=true
  fi
  run_psql \
    --set "ordinary_staff_writer=false" \
    --set "staff_ordinary_writer=false" \
    --set "ordinary_delete_writer=false" \
    --set "delete_ordinary_writer=false" \
    --set "bound_bootstrap_writer=${bound_bootstrap_writer}" \
    --set "delete_bound_writer=${delete_bound_writer}" \
    --set "system_ordinary_writer=false" \
    --set "system_staff_writer=false" \
    --file "${SCRIPT_DIR}/57-ordinary-account-lock-race-worker.sql"
}

system_site_exclusion_worker() {
  local worker="$1"
  local system_ordinary_writer=false
  local system_staff_writer=false
  if [[ "${worker}" == A ]]; then
    system_ordinary_writer=true
  else
    system_staff_writer=true
  fi
  run_psql \
    --set "ordinary_staff_writer=false" \
    --set "staff_ordinary_writer=false" \
    --set "ordinary_delete_writer=false" \
    --set "delete_ordinary_writer=false" \
    --set "bound_bootstrap_writer=false" \
    --set "delete_bound_writer=false" \
    --set "system_ordinary_writer=${system_ordinary_writer}" \
    --set "system_staff_writer=${system_staff_writer}" \
    --file "${SCRIPT_DIR}/57-ordinary-account-lock-race-worker.sql"
}

run_pair task enterprise_version_conflict task_worker
run_pair invitation enterprise_version_conflict invitation_worker
run_pair workflow enterprise_version_conflict workflow_worker
run_pair workflow-restore-limit workflow_limit_reached restore_limit_worker
run_pair ordinary-staff ordinary_staff_race_conflict ordinary_staff_worker
run_pair ordinary-auth-delete \
  ordinary_auth_delete_race_conflict ordinary_auth_delete_worker
run_pair bound-auth-delete \
  ordinary_bound_delete_race_conflict bound_auth_delete_worker
run_both_fail system-site-exclusion \
  ordinary_system_site_race_conflict system_site_exclusion_worker
run_sql_file "${SCRIPT_DIR}/30-post-concurrency.sql"
run_sql_file "${SCRIPT_DIR}/42-workflow-post-concurrency.sql"
run_sql_file "${SCRIPT_DIR}/45-workflow-restore-limit-post.sql"
run_sql_file "${SCRIPT_DIR}/58-ordinary-account-lock-race-post.sql"
run_psql --command \
  "revoke select, insert, update on table public.merchants from service_role;"
export FAOLLA_EXPECTED_DATABASE_NAME="$(
  run_psql --tuples-only --no-align --command \
    "select pg_catalog.current_database();"
)"
export FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER="$(
  run_psql --tuples-only --no-align --command \
    "select system_identifier::numeric::text from pg_catalog.pg_control_system();"
)"
export FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT="$(
  run_psql --tuples-only --no-align --command \
    "select count(*)::text from public.merchants where id <> 'site-main';"
)"
export FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT="$(
  run_psql --tuples-only --no-align --command \
    "select count(*)::text from public.faolla_personal_accounts;"
)"
export FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256="$(
  capture_ordinary_identity_content_sha256
)"
FAOLLA_EXPECTED_READINESS_STATUS=blocked \
  node "${SCRIPT_DIR}/check-ordinary-account-cutover-readiness.mjs"
. "${SCRIPT_DIR}/62-ordinary-account-cutover-readiness-gate.sh"

echo '[enterprise-integration] all PostgreSQL migration, security, transaction, and CAS checks passed'
