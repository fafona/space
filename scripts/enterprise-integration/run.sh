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

export PGOPTIONS="-c statement_timeout=60000 -c lock_timeout=15000 ${PGOPTIONS:-}"
PSQL_BASE=(psql -X --set ON_ERROR_STOP=1 --no-psqlrc)

run_psql() {
  "${PSQL_BASE[@]}" "$@" "${DATABASE_URL}"
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

run_sql_file "${SCRIPT_DIR}/00-supabase-stubs.sql"
run_psql --command \
  "create schema if not exists auth; create table if not exists auth.users (id uuid primary key, email text null, raw_app_meta_data jsonb not null default '{}'::jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-init.sql"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250001_core_transaction_foundation.sql"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250004_booking_shadow_write_rpc.sql"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250007_reliable_outbox_runtime.sql"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250008_scoped_outbox_claim.sql"

mapfile -t enterprise_migrations < <(
  find "${REPOSITORY_ROOT}/scripts/supabase-migrations" -maxdepth 1 -type f \
    \( -name '*_merchant_enterprise_*.sql' -o -name '*_merchant_order_task_link.sql' -o -name '*_ordinary_account_authorization_foundation.sql' \) \
    -print | sort
)

if [[ "${#enterprise_migrations[@]}" -ne 30 ]]; then
  echo "Expected 30 enterprise/identity migrations (001-026 plus 032-035), found ${#enterprise_migrations[@]}" >&2
  printf '  %s\n' "${enterprise_migrations[@]}" >&2
  exit 1
fi

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
  else
    run_sql_file "${migration}"
  fi
done

registry_count="$(
  run_psql --tuples-only --no-align --command \
    "select count(*) from public.faolla_schema_migrations where version in (202607250001, 202607250004, 202607250007, 202607250008, 202608180032, 202608190033, 202608190034, 202608190035) or version between 202607310001 and 202608040026;"
)"
if [[ "${registry_count}" -ne 34 ]]; then
  echo "Expected 34 applied prerequisite/enterprise/identity versions, found ${registry_count}" >&2
  exit 1
fi

run_sql_file "${SCRIPT_DIR}/10-serial-acceptance.sql"
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
run_sql_file "${SCRIPT_DIR}/54-ordinary-account-authorization.sql"

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

run_pair task enterprise_version_conflict task_worker
run_pair invitation enterprise_version_conflict invitation_worker
run_pair workflow enterprise_version_conflict workflow_worker
run_pair workflow-restore-limit workflow_limit_reached restore_limit_worker
run_sql_file "${SCRIPT_DIR}/30-post-concurrency.sql"
run_sql_file "${SCRIPT_DIR}/42-workflow-post-concurrency.sql"
run_sql_file "${SCRIPT_DIR}/45-workflow-restore-limit-post.sql"

echo '[enterprise-integration] all PostgreSQL migration, security, transaction, and CAS checks passed'
