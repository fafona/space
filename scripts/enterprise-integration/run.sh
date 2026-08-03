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
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-init.sql"
run_sql_file "${REPOSITORY_ROOT}/scripts/supabase-migrations/202607250001_core_transaction_foundation.sql"

mapfile -t enterprise_migrations < <(
  find "${REPOSITORY_ROOT}/scripts/supabase-migrations" -maxdepth 1 -type f \
    \( -name '*_merchant_enterprise_*.sql' -o -name '*_merchant_order_task_link.sql' \) \
    -print | sort
)

if [[ "${#enterprise_migrations[@]}" -ne 19 ]]; then
  echo "Expected 19 enterprise migrations (001-019), found ${#enterprise_migrations[@]}" >&2
  printf '  %s\n' "${enterprise_migrations[@]}" >&2
  exit 1
fi

for migration in "${enterprise_migrations[@]}"; do
  run_sql_file "${migration}"
done

registry_count="$(
  run_psql --tuples-only --no-align --command \
    "select count(*) from public.faolla_schema_migrations where version = 202607250001 or version between 202607310001 and 202608020019;"
)"
if [[ "${registry_count}" -ne 20 ]]; then
  echo "Expected 20 applied prerequisite/enterprise versions, found ${registry_count}" >&2
  exit 1
fi

run_sql_file "${SCRIPT_DIR}/10-serial-acceptance.sql"

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

run_pair() {
  local kind="$1"
  shift
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
    echo "${kind} CAS expected one success and one conflict; got A=${status_a}, B=${status_b}" >&2
    cat "${log_a}" >&2
    cat "${log_b}" >&2
    return 1
  fi

  local loser_log="${log_a}"
  if [[ "${status_b}" -ne 0 ]]; then
    loser_log="${log_b}"
  fi
  if ! grep -q 'enterprise_version_conflict' "${loser_log}"; then
    echo "${kind} losing session did not report enterprise_version_conflict" >&2
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

run_pair task task_worker
run_pair invitation invitation_worker
run_sql_file "${SCRIPT_DIR}/30-post-concurrency.sql"

echo '[enterprise-integration] all PostgreSQL migration, security, transaction, and CAS checks passed'
