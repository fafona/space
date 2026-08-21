import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import {
  ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL,
  parseOrdinaryAccountCutoverDatabaseReport,
} from "./check-ordinary-account-cutover-readiness.mjs";
import {
  canonicalJsonBytes,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  PRODUCTION_RELEASE_BASELINE_KEYS,
  PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES,
  sha256Hex,
  validateProductionReleaseAttestation,
} from "./production-release-attestation.mjs";
import { ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY } from "./ordinary-account-identity-content-contract.mjs";

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]{0,9}$/;
const EPOCH_MILLISECONDS_PATTERN = /^[1-9][0-9]{0,15}$/;
const PID_PATTERN = /^[1-9][0-9]{0,9}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PID = 2_147_483_647n;
const MAX_HOLD_SECONDS = 900;
const MAX_TTL_SECONDS = 2 * 60 * 60;
const MINIMUM_ROLLBACK_MARGIN_SECONDS = 300;
const DATABASE_TIMEOUT_MARGIN_SECONDS = 30;
const WATCHDOG_MARGIN_SECONDS = 60;
const STARTUP_WATCHDOG_SECONDS = 240;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RELEASE_REQUEST_BYTES = 8 * 1024;
const MAX_FAILURE_LOG_BYTES = 512;
const MAX_CHILD_STDERR_BYTES = 64 * 1024;
const ENDPOINT_PROBE_TIMEOUT_MS = 15_000;
const ENDPOINT_PROBE_POLL_MS = 50;
const EXTERNAL_OPERATION_TIMEOUT_MS = 10_000;
const QUERY_CANCEL_RESPONSE_TIMEOUT_MS = 5_000;

const PUBLIC_FAILURE_CODES = new Set([
  "attestation_json_not_canonical",
  "readiness_fence_application_name_invalid",
  "readiness_fence_attestation_file_changed",
  "readiness_fence_attestation_file_invalid",
  "readiness_fence_attestation_invalid",
  "readiness_fence_attestation_sha256_invalid",
  "readiness_fence_attestation_sha256_mismatch",
  "readiness_fence_attestation_symlink",
  "readiness_fence_backend_pid_invalid",
  "readiness_fence_backup_event_invalid",
  "readiness_fence_baseline_mismatch",
  "readiness_fence_child_exit_timeout",
  "readiness_fence_child_failed",
  "readiness_fence_child_spawn_failed",
  "readiness_fence_cli_argument_invalid",
  "readiness_fence_cli_argument_missing",
  "readiness_fence_cli_command_invalid",
  "readiness_fence_container_id_invalid",
  "readiness_fence_container_id_mismatch",
  "readiness_fence_database_identity_mismatch",
  "readiness_fence_ended_before_release",
  "readiness_fence_hold_locks_invalid",
  "readiness_fence_hold_output_invalid",
  "readiness_fence_input_invalid",
  "readiness_fence_interrupted",
  "readiness_fence_line_processing_timeout",
  "readiness_fence_marker_cleanup_failed",
  "readiness_fence_marker_exists",
  "readiness_fence_marker_invalid",
  "readiness_fence_marker_ttl_insufficient",
  "readiness_fence_marker_write_failed",
  "readiness_fence_max_hold_seconds_invalid",
  "readiness_fence_minimum_ttl_invalid",
  "readiness_fence_now_invalid",
  "readiness_fence_output_invalid",
  "readiness_fence_output_missing",
  "readiness_fence_output_too_large",
  "readiness_fence_path_reused",
  "readiness_fence_probe_abort_timeout",
  "readiness_fence_probe_cancelled",
  "readiness_fence_probe_database_mismatch",
  "readiness_fence_probe_environment_invalid",
  "readiness_fence_probe_evidence_invalid",
  "readiness_fence_probe_fetch_unavailable",
  "readiness_fence_probe_http_completed_early",
  "readiness_fence_probe_input_invalid",
  "readiness_fence_probe_observer_failed",
  "readiness_fence_probe_observer_invalid",
  "readiness_fence_probe_observer_timeout",
  "readiness_fence_probe_poll_timeout",
  "readiness_fence_probe_query_cancel_response_invalid",
  "readiness_fence_probe_query_cancel_response_timeout",
  "readiness_fence_probe_random_invalid",
  "readiness_fence_probe_service_application_invalid",
  "readiness_fence_probe_service_database_route_invalid",
  "readiness_fence_probe_service_identity_invalid",
  "readiness_fence_probe_service_invalid",
  "readiness_fence_probe_timeout",
  "readiness_fence_probe_waiter_cancel_failed",
  "readiness_fence_probe_waiter_cancel_timeout",
  "readiness_fence_probe_waiter_count_invalid",
  "readiness_fence_probe_waiter_invalid",
  "readiness_fence_probe_waiter_missing",
  "readiness_fence_probe_waiter_residual",
  "readiness_fence_release_request_binding_mismatch",
  "readiness_fence_release_request_changed",
  "readiness_fence_release_request_cleanup_failed",
  "readiness_fence_release_request_exists",
  "readiness_fence_release_request_file_invalid",
  "readiness_fence_release_request_invalid",
  "readiness_fence_release_request_path_invalid",
  "readiness_fence_release_token_invalid",
  "readiness_fence_release_wait_cancelled",
  "readiness_fence_release_wait_timeout",
  "readiness_fence_report_blocked",
  "readiness_fence_report_invalid",
  "readiness_fence_sql_source_invalid",
  "readiness_fence_startup_timeout",
  "readiness_fence_termination_failed",
  "readiness_fence_termination_input_invalid",
  "readiness_fence_termination_timeout",
  "readiness_fence_timeout",
  "readiness_fence_ttl_below_hold",
  "readiness_fence_unexpected_error",
]);
const ENDPOINT_PROBE_TOTAL_TIMEOUT_MS = 90_000;
const FENCE_KIND = "faolla.ordinary-account-cutover-readiness-fence.v1";
const RELEASE_REQUEST_KIND =
  "faolla.ordinary-account-cutover-readiness-fence-release.v1";
const ROLLBACK_SUFFIX = "\n\nROLLBACK;";
const REPORT_SUFFIX = ")::text;";

const PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  "export LC_ALL=C",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  ': "${FAOLLA_EXPECTED_DATABASE_NAME:?FAOLLA_EXPECTED_DATABASE_NAME is required}"',
  ': "${FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER:?FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER is required}"',
  ': "${FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT:?FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT is required}"',
  ': "${FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT:?FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT is required}"',
  ': "${FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256:?FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256 is required}"',
  ': "${FAOLLA_FENCE_APPLICATION_NAME:?FAOLLA_FENCE_APPLICATION_NAME is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  'export PGAPPNAME="$FAOLLA_FENCE_APPLICATION_NAME"',
  "export PGOPTIONS='-c lock_timeout=15s -c statement_timeout=960s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose " +
    '--set=expected_database_name="$FAOLLA_EXPECTED_DATABASE_NAME" ' +
    '--set=expected_database_system_identifier="$FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER" ' +
    '--set=expected_merchant_record_count="$FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT" ' +
    '--set=expected_personal_canonical_count="$FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT" ' +
    '--set=expected_ordinary_identity_content_sha256="$FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256" ' +
    "--quiet --tuples-only --no-align",
].join("\n");

const TERMINATE_PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  ': "${FAOLLA_FENCE_APPLICATION_NAME:?FAOLLA_FENCE_APPLICATION_NAME is required}"',
  ': "${FAOLLA_FENCE_BACKEND_PID:?FAOLLA_FENCE_BACKEND_PID is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=terse " +
    '--set=fence_application_name="$FAOLLA_FENCE_APPLICATION_NAME" ' +
    '--set=fence_backend_pid="$FAOLLA_FENCE_BACKEND_PID" ' +
    "--quiet --tuples-only --no-align",
].join("\n");

const TERMINATE_FENCE_SQL = String.raw`WITH matching_sessions AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.application_name = :'fence_application_name'::text
    AND (
      :'fence_backend_pid'::text = '0'::text
      OR activity.pid = :'fence_backend_pid'::integer
    )
    AND activity.pid <> pg_catalog.pg_backend_pid()
), terminated AS (
  SELECT pg_catalog.pg_terminate_backend(matching_sessions.pid, 5000) AS ok
  FROM matching_sessions
)
SELECT pg_catalog.json_build_object(
  'matchedCount', pg_catalog.count(*)::text,
  'terminatedCount',
    pg_catalog.count(*) FILTER (WHERE terminated.ok)::text
)::text
FROM terminated;

SELECT pg_catalog.json_build_object(
  'remainingCount', pg_catalog.count(*)::text
)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.application_name = :'fence_application_name'::text
  AND (
    :'fence_backend_pid'::text = '0'::text
    OR activity.pid = :'fence_backend_pid'::integer
  )
  AND activity.pid <> pg_catalog.pg_backend_pid();`;

const OBSERVE_WAITERS_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=10s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=terse " +
    "--quiet --tuples-only --no-align",
].join("\n");

const OBSERVE_WAITERS_SQL = String.raw`WITH waiters AS (
  SELECT
    activity.pid::text AS pid,
    lock.database::text AS database_oid,
    lock.relation::text AS relation_oid,
    namespace.nspname AS schema_name,
    relation.relname AS relation_name,
    activity.usename AS database_user,
    activity.application_name,
    COALESCE(activity.client_addr::text, '') AS client_address,
    activity.query,
    lock.mode,
    lock.granted,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM activity.query_start) * 1000::numeric
    )::bigint::text AS query_started_at_epoch_ms,
    ARRAY(
      SELECT blocker::text
      FROM pg_catalog.unnest(pg_catalog.pg_blocking_pids(activity.pid)) AS blocker
      ORDER BY blocker
    ) AS blocking_pids
  FROM pg_catalog.pg_locks AS lock
  JOIN pg_catalog.pg_stat_activity AS activity
    ON activity.pid = lock.pid
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = lock.relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE lock.locktype = 'relation'
    AND lock.database = (
      SELECT database.oid
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = pg_catalog.current_database()
    )
    AND NOT lock.granted
)
SELECT pg_catalog.json_build_object(
  'databaseOid', (
    SELECT database.oid::text
    FROM pg_catalog.pg_database AS database
    WHERE database.datname = pg_catalog.current_database()
  ),
  'clockEpochMilliseconds', pg_catalog.floor(
    EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()) * 1000::numeric
  )::bigint::text,
  'serviceSessions', COALESCE(
    (
      SELECT pg_catalog.json_agg(
        pg_catalog.json_build_object(
          'databaseUser', session.usename,
          'applicationName', session.application_name,
          'clientAddress', session.client_address
        )
        ORDER BY session.client_address, session.usename, session.application_name
      )
      FROM (
        SELECT DISTINCT
          activity.usename,
          activity.application_name,
          activity.client_addr::text AS client_address
        FROM pg_catalog.pg_stat_activity AS activity
        WHERE activity.client_addr IS NOT NULL
          AND activity.datid = (
            SELECT database.oid
            FROM pg_catalog.pg_database AS database
            WHERE database.datname = pg_catalog.current_database()
          )
      ) AS session
    ),
    '[]'::pg_catalog.json
  ),
  'waiters', COALESCE(
    (
      SELECT pg_catalog.json_agg(
        pg_catalog.json_build_object(
          'pid', waiters.pid,
          'databaseOid', waiters.database_oid,
          'relationOid', waiters.relation_oid,
          'schemaName', waiters.schema_name,
          'relationName', waiters.relation_name,
          'databaseUser', waiters.database_user,
          'applicationName', waiters.application_name,
          'clientAddress', waiters.client_address,
          'query', waiters.query,
          'mode', waiters.mode,
          'granted', waiters.granted,
          'queryStartedAtEpochMilliseconds', waiters.query_started_at_epoch_ms,
          'blockingPids', waiters.blocking_pids
        )
        ORDER BY waiters.pid::integer
      )
      FROM waiters
    ),
    '[]'::pg_catalog.json
  )
)::text;`;

const CANCEL_WAITER_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  ': "${FAOLLA_WAITER_PID:?FAOLLA_WAITER_PID is required}"',
  ': "${FAOLLA_DATABASE_OID:?FAOLLA_DATABASE_OID is required}"',
  ': "${FAOLLA_RELATION_OID:?FAOLLA_RELATION_OID is required}"',
  ': "${FAOLLA_SCHEMA_NAME:?FAOLLA_SCHEMA_NAME is required}"',
  ': "${FAOLLA_RELATION_NAME:?FAOLLA_RELATION_NAME is required}"',
  ': "${FAOLLA_DATABASE_USER:?FAOLLA_DATABASE_USER is required}"',
  ': "${FAOLLA_APPLICATION_NAME:?FAOLLA_APPLICATION_NAME is required}"',
  ': "${FAOLLA_CLIENT_ADDRESS:?FAOLLA_CLIENT_ADDRESS is required}"',
  ': "${FAOLLA_QUERY_STARTED_AT_EPOCH_MS:?FAOLLA_QUERY_STARTED_AT_EPOCH_MS is required}"',
  ': "${FAOLLA_FENCE_BACKEND_PID:?FAOLLA_FENCE_BACKEND_PID is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=10s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=terse " +
    '--set=waiter_pid="$FAOLLA_WAITER_PID" ' +
    '--set=database_oid="$FAOLLA_DATABASE_OID" ' +
    '--set=relation_oid="$FAOLLA_RELATION_OID" ' +
    '--set=schema_name="$FAOLLA_SCHEMA_NAME" ' +
    '--set=relation_name="$FAOLLA_RELATION_NAME" ' +
    '--set=database_user="$FAOLLA_DATABASE_USER" ' +
    '--set=application_name="$FAOLLA_APPLICATION_NAME" ' +
    '--set=client_address="$FAOLLA_CLIENT_ADDRESS" ' +
    '--set=query_started_at_epoch_ms="$FAOLLA_QUERY_STARTED_AT_EPOCH_MS" ' +
    '--set=fence_backend_pid="$FAOLLA_FENCE_BACKEND_PID" ' +
    "--quiet --tuples-only --no-align",
].join("\n");

const CANCEL_WAITER_SQL = String.raw`WITH candidate AS (
  SELECT activity.pid
  FROM pg_catalog.pg_locks AS lock
  JOIN pg_catalog.pg_stat_activity AS activity
    ON activity.pid = lock.pid
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = lock.relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE activity.pid = :'waiter_pid'::integer
    AND lock.database = :'database_oid'::oid
    AND lock.relation = :'relation_oid'::oid
    AND namespace.nspname = :'schema_name'::text
    AND relation.relname = :'relation_name'::text
    AND activity.usename = :'database_user'::text
    AND activity.application_name = :'application_name'::text
    AND COALESCE(activity.client_addr::text, '') = :'client_address'::text
    AND lock.mode = 'AccessShareLock'
    AND NOT lock.granted
    AND pg_catalog.floor(
      EXTRACT(EPOCH FROM activity.query_start) * 1000::numeric
    )::bigint = :'query_started_at_epoch_ms'::bigint
    AND pg_catalog.pg_blocking_pids(activity.pid)
      = ARRAY[:'fence_backend_pid'::integer]::integer[]
), cancelled AS (
  SELECT pg_catalog.pg_cancel_backend(candidate.pid) AS ok
  FROM candidate
)
SELECT CASE
  WHEN pg_catalog.count(*) = 1 AND pg_catalog.bool_and(cancelled.ok)
  THEN 'cancelled'
  ELSE 'not_cancelled'
END
FROM cancelled;`;

export class OrdinaryAccountCutoverReadinessFenceError extends Error {
  constructor(code, diagnostic = null) {
    super(code);
    this.name = "OrdinaryAccountCutoverReadinessFenceError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function fail(code, diagnostic = null) {
  throw new OrdinaryAccountCutoverReadinessFenceError(code, diagnostic);
}

function parsePositiveSeconds(value, maximum, code) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    fail(code);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) fail(code);
  return parsed;
}

function fenceErrorCode(error, fallback) {
  return error instanceof OrdinaryAccountCutoverReadinessFenceError
    ? error.code
    : fallback;
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const PUBLIC_FAILURE_RECORD_KEYS = [
  "childExitCode",
  "childResult",
  "childSignal",
  "error",
  "ok",
  "sqlstate",
  "sqlstateStatus",
];
const CHILD_RESULT_VALUES = new Set([
  "not_observed",
  "spawn_error",
  "exit",
  "signal",
]);
const CHILD_SIGNAL_VALUES = new Set(["SIGTERM", "SIGKILL", "OTHER"]);
const SQLSTATE_STATUS_VALUES = new Set([
  "absent",
  "ambiguous",
  "exact",
  "invalid_utf8",
  "overflow",
]);

function defaultChildFailureDiagnostic() {
  return {
    childExitCode: null,
    childResult: "not_observed",
    childSignal: null,
    sqlstate: null,
    sqlstateStatus: "absent",
  };
}

function normalizeChildSignal(signal) {
  if (signal === null || signal === undefined) return null;
  if (signal === "SIGTERM" || signal === "SIGKILL") return signal;
  return "OTHER";
}

function parseCompletePsqlSqlstate(stderr, overflow, complete = true) {
  if (overflow) return { sqlstate: null, sqlstateStatus: "overflow" };
  if (!complete) return { sqlstate: null, sqlstateStatus: "absent" };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stderr);
  } catch {
    return { sqlstate: null, sqlstateStatus: "invalid_utf8" };
  }
  const headers = [];
  const pattern = /^(?:(?:ERROR|FATAL|PANIC):|psql:[^\r\n]*:\s*(?:ERROR|FATAL|PANIC):)\s+([0-9A-Z]{5}):[^\r\n]*$/gm;
  for (const match of text.matchAll(pattern)) headers.push(match[1]);
  if (headers.length === 0) {
    return { sqlstate: null, sqlstateStatus: "absent" };
  }
  if (headers.length !== 1) {
    return { sqlstate: null, sqlstateStatus: "ambiguous" };
  }
  return { sqlstate: headers[0], sqlstateStatus: "exact" };
}

function childFailureDiagnostic(result, stderr, overflow, stderrComplete = true) {
  const source = isPlainRecord(result) ? result : null;
  let childResult = "not_observed";
  if (source?.error === true) {
    childResult = "spawn_error";
  } else if (source?.signal !== null && source?.signal !== undefined) {
    childResult = "signal";
  } else if (Number.isInteger(source?.code)) {
    childResult = "exit";
  }
  const childExitCode =
    childResult === "exit" &&
    Number.isSafeInteger(source.code) &&
    source.code >= 0 &&
    source.code <= 255
      ? String(source.code)
      : null;
  const childSignal = childResult === "signal"
    ? normalizeChildSignal(source.signal)
    : null;
  return {
    childExitCode,
    childResult,
    childSignal,
    ...parseCompletePsqlSqlstate(stderr, overflow, stderrComplete),
  };
}

function validateChildFailureDiagnostic(value) {
  if (!isPlainRecord(value)) return null;
  const keys = Reflect.ownKeys(value);
  const expected = [
    "childExitCode",
    "childResult",
    "childSignal",
    "sqlstate",
    "sqlstateStatus",
  ];
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== expected.length ||
    [...keys].sort().some((key, index) => key !== [...expected].sort()[index])
  ) {
    return null;
  }
  const candidate = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return null;
    }
    candidate[key] = descriptor.value;
  }
  if (
    candidate.childExitCode !== null &&
    (typeof candidate.childExitCode !== "string" ||
      !/^(?:0|[1-9][0-9]{0,2})$/.test(candidate.childExitCode) ||
      Number(candidate.childExitCode) > 255)
  ) {
    return null;
  }
  if (!CHILD_RESULT_VALUES.has(candidate.childResult)) return null;
  if (
    candidate.childSignal !== null &&
    !CHILD_SIGNAL_VALUES.has(candidate.childSignal)
  ) {
    return null;
  }
  if (
    (candidate.childResult === "exit") !==
      (candidate.childExitCode !== null) ||
    (candidate.childResult === "signal") !==
      (candidate.childSignal !== null)
  ) {
    return null;
  }
  if (
    candidate.sqlstate !== null &&
    (typeof candidate.sqlstate !== "string" ||
      !/^[0-9A-Z]{5}$/.test(candidate.sqlstate))
  ) {
    return null;
  }
  if (!SQLSTATE_STATUS_VALUES.has(candidate.sqlstateStatus)) return null;
  if (
    (candidate.sqlstateStatus === "exact") !==
    (candidate.sqlstate !== null)
  ) {
    return null;
  }
  return {
    childExitCode: candidate.childExitCode,
    childResult: candidate.childResult,
    childSignal: candidate.childSignal,
    sqlstate: candidate.sqlstate,
    sqlstateStatus: candidate.sqlstateStatus,
  };
}

function publicFailureRecord(error) {
  let code = "readiness_fence_unexpected_error";
  let diagnostic = defaultChildFailureDiagnostic();
  try {
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) {
      const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
      if (
        codeDescriptor &&
        "value" in codeDescriptor &&
        typeof codeDescriptor.value === "string" &&
        PUBLIC_FAILURE_CODES.has(codeDescriptor.value)
      ) {
        code = codeDescriptor.value;
      } else if (
        codeDescriptor &&
        "value" in codeDescriptor &&
        typeof codeDescriptor.value === "string" &&
        codeDescriptor.value.startsWith("attestation_")
      ) {
        code = "readiness_fence_attestation_invalid";
      }
      const diagnosticDescriptor = Object.getOwnPropertyDescriptor(
        error,
        "diagnostic",
      );
      if (diagnosticDescriptor && "value" in diagnosticDescriptor) {
        diagnostic =
          validateChildFailureDiagnostic(diagnosticDescriptor.value) ?? diagnostic;
      }
    }
  } catch {}
  return {
    childExitCode: diagnostic.childExitCode,
    childResult: diagnostic.childResult,
    childSignal: diagnostic.childSignal,
    error: code,
    ok: false,
    sqlstate: diagnostic.sqlstate,
    sqlstateStatus: diagnostic.sqlstateStatus,
  };
}

export function ordinaryAccountCutoverReadinessFenceFailureLogBytes(error) {
  return canonicalJsonBytes(publicFailureRecord(error));
}

export function parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes) {
  let source;
  try {
    source = Buffer.from(bytes);
  } catch {
    return null;
  }
  if (source.length === 0 || source.length > MAX_FAILURE_LOG_BYTES) return null;
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
  } catch {
    return null;
  }
  if (!isPlainRecord(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== PUBLIC_FAILURE_RECORD_KEYS.length ||
    [...keys]
      .sort()
      .some((key, index) => key !== [...PUBLIC_FAILURE_RECORD_KEYS].sort()[index]) ||
    value.ok !== false ||
    typeof value.error !== "string" ||
    !PUBLIC_FAILURE_CODES.has(value.error)
  ) {
    return null;
  }
  const diagnostic = validateChildFailureDiagnostic({
    childExitCode: value.childExitCode,
    childResult: value.childResult,
    childSignal: value.childSignal,
    sqlstate: value.sqlstate,
    sqlstateStatus: value.sqlstateStatus,
  });
  if (!diagnostic) return null;
  const projection = {
    childExitCode: diagnostic.childExitCode,
    childResult: diagnostic.childResult,
    childSignal: diagnostic.childSignal,
    error: value.error,
    ok: false,
    sqlstate: diagnostic.sqlstate,
    sqlstateStatus: diagnostic.sqlstateStatus,
  };
  const canonical = canonicalJsonBytes(projection);
  if (
    canonical.length !== source.length ||
    !timingSafeEqual(canonical, source)
  ) {
    return null;
  }
  return projection;
}

export async function readOrdinaryAccountCutoverReadinessFenceFailureRecord(
  filePath,
  fileOperations = {},
) {
  const operations = {
    lstat: fileOperations.lstat ?? lstat,
    open: fileOperations.open ?? open,
  };
  let handle;
  try {
    if (typeof filePath !== "string" || filePath.length === 0) return null;
    const expectedUid = typeof process.getuid === "function"
      ? BigInt(process.getuid())
      : null;
    const before = await operations.lstat(filePath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(MAX_FAILURE_LOG_BYTES) ||
      (process.platform !== "win32" &&
        ((before.mode & 0o777n) !== 0o600n || before.uid !== expectedUid))
    ) {
      return null;
    }
    handle = await operations.open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs ||
      (process.platform !== "win32" &&
        ((opened.mode & 0o777n) !== 0o600n || opened.uid !== expectedUid))
    ) {
      return null;
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await operations.lstat(filePath, { bigint: true });
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.nlink !== 1n ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.size !== opened.size ||
      current.mtimeNs !== opened.mtimeNs ||
      after.nlink !== 1n ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      (process.platform !== "win32" &&
        ((after.mode & 0o777n) !== 0o600n ||
          after.uid !== expectedUid ||
          (current.mode & 0o777n) !== 0o600n ||
          current.uid !== expectedUid)) ||
      BigInt(bytes.length) !== opened.size
    ) {
      return null;
    }
    return parseOrdinaryAccountCutoverReadinessFenceFailureLog(bytes);
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function exactRecord(value, keys, code) {
  if (!isPlainRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
  return value;
}

export function buildOrdinaryAccountCutoverReadinessFenceSql(
  maximumHoldSeconds,
) {
  const seconds = parsePositiveSeconds(
    String(maximumHoldSeconds),
    MAX_HOLD_SECONDS,
    "readiness_fence_max_hold_seconds_invalid",
  );
  if (!ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.endsWith(ROLLBACK_SUFFIX)) {
    fail("readiness_fence_sql_source_invalid");
  }
  const withoutRollback = ORDINARY_ACCOUNT_CUTOVER_READINESS_SQL.slice(
    0,
    -ROLLBACK_SUFFIX.length,
  );
  if (!withoutRollback.endsWith(REPORT_SUFFIX)) {
    fail("readiness_fence_sql_source_invalid");
  }
  const reportQuery = withoutRollback.slice(0, -1);
  return [
    `${reportQuery} AS report`,
    String.raw`\gset fence_`,
    `SET LOCAL statement_timeout = '${seconds + DATABASE_TIMEOUT_MARGIN_SECONDS}s';`,
    "LOCK TABLE public.faolla_schema_migrations IN ACCESS EXCLUSIVE MODE;",
    "SAVEPOINT endpoint_probe_locks;",
    "LOCK TABLE auth.users IN ACCESS EXCLUSIVE MODE;",
    "LOCK TABLE public.pages IN ACCESS EXCLUSIVE MODE;",
    String.raw`SELECT '{"backendPid":"'
  || pg_catalog.pg_backend_pid()::text
  || '","report":'
  || :'fence_report'::text
  || '}' AS fence_result;`,
    "ROLLBACK TO SAVEPOINT endpoint_probe_locks;",
    "RELEASE SAVEPOINT endpoint_probe_locks;",
    String.raw`SELECT pg_catalog.json_build_object(
  'backendPid', pg_catalog.pg_backend_pid()::text,
  'holdLocks', pg_catalog.json_build_object(
    'authShareLockCount', (
      SELECT pg_catalog.count(*)::text
      FROM pg_catalog.pg_locks AS lock
      WHERE lock.pid = pg_catalog.pg_backend_pid()
        AND lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'ShareLock'
        AND lock.granted
    ),
    'authAccessExclusiveLockCount', (
      SELECT pg_catalog.count(*)::text
      FROM pg_catalog.pg_locks AS lock
      WHERE lock.pid = pg_catalog.pg_backend_pid()
        AND lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock'
        AND lock.granted
    ),
    'pagesAccessExclusiveLockCount', (
      SELECT pg_catalog.count(*)::text
      FROM pg_catalog.pg_locks AS lock
      WHERE lock.pid = pg_catalog.pg_backend_pid()
        AND lock.relation = 'public.pages'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock'
        AND lock.granted
    ),
    'registryAccessExclusiveLockCount', (
      SELECT pg_catalog.count(*)::text
      FROM pg_catalog.pg_locks AS lock
      WHERE lock.pid = pg_catalog.pg_backend_pid()
        AND lock.relation = 'public.faolla_schema_migrations'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock'
        AND lock.granted
    )
  )
)::text AS fence_hold_result;`,
    `SELECT pg_catalog.pg_sleep(${seconds}::double precision);`,
    "ROLLBACK;",
  ].join("\n\n");
}

async function readCanonicalAttestation(filePath, options) {
  const operations = options.fileOperations ?? { lstat, open };
  const validationOptions = { ...options };
  delete validationOptions.fileOperations;
  let handle;
  let bytes;
  try {
    const before = await operations.lstat(filePath, { bigint: true });
    if (before.isSymbolicLink()) {
      fail("readiness_fence_attestation_symlink");
    }
    if (
      !before.isFile() ||
      before.size <= 0n ||
      before.size > BigInt(PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES)
    ) {
      fail("readiness_fence_attestation_file_invalid");
    }
    handle = await operations.open(filePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      fail("readiness_fence_attestation_file_changed");
    }
    bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await operations.lstat(filePath, { bigint: true });
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      after.size !== BigInt(bytes.length) ||
      current.size !== after.size ||
      after.mtimeNs !== opened.mtimeNs ||
      current.mtimeNs !== after.mtimeNs
    ) {
      fail("readiness_fence_attestation_file_changed");
    }
  } catch (error) {
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    fail("readiness_fence_attestation_file_invalid");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("readiness_fence_attestation_file_invalid");
  }
  const validation = validateProductionReleaseAttestation(
    value,
    validationOptions,
  );
  if (!validation.valid) fail(validation.error);
  if (!bytes.equals(validation.canonicalBytes)) {
    fail("attestation_json_not_canonical");
  }
  return validation;
}

function expectedEnvironment(attestation, applicationName) {
  return {
    FAOLLA_EXPECTED_DATABASE_NAME: attestation.database.dbName,
    FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: attestation.database.systemId,
    FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT:
      attestation.baseline.merchantRecordCount,
    FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT:
      attestation.baseline.personalCanonicalBindingCount,
    FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256:
      attestation.baseline[ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY],
    FAOLLA_FENCE_APPLICATION_NAME: applicationName,
  };
}

function dockerExecArguments(containerId, environment, shellScript) {
  return [
    "exec",
    "-i",
    ...Object.entries(environment).flatMap(([name, value]) => [
      "--env",
      `${name}=${value}`,
    ]),
    containerId,
    "sh",
    "-lc",
    shellScript,
  ];
}

function spawnDocker(spawnProcess, argumentsList) {
  try {
    return spawnProcess("docker", argumentsList, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    fail("readiness_fence_child_spawn_failed", {
      ...defaultChildFailureDiagnostic(),
      childResult: "spawn_error",
    });
  }
}

function childCompletion(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", () =>
      finish({ error: true, code: null, signal: null }),
    );
    child.once("close", (code, signal) =>
      finish({ error: false, code, signal }),
    );
  });
}

async function withWallClockDeadline(promise, milliseconds, code, onTimeout) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      reject(new OrdinaryAccountCutoverReadinessFenceError(code));
    }, milliseconds);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runDockerWaiterObservation(input) {
  const child = spawnDocker(
    input.spawnProcess ?? spawn,
    dockerExecArguments(
      input.containerId,
      {},
      OBSERVE_WAITERS_CONTAINER_SCRIPT,
    ),
  );
  let stdout = Buffer.alloc(0);
  let tooLarge = false;
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > MAX_OUTPUT_BYTES) {
      tooLarge = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  });
  child.stderr?.resume();
  const completion = childCompletion(child);
  child.stdin.end(OBSERVE_WAITERS_SQL);
  const result = await (input.deadline ?? withWallClockDeadline)(
    completion,
    EXTERNAL_OPERATION_TIMEOUT_MS,
    "readiness_fence_probe_observer_timeout",
    () => child.kill("SIGKILL"),
  );
  if (tooLarge || result.error || result.code !== 0) {
    fail("readiness_fence_probe_observer_failed");
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout));
  } catch {
    fail("readiness_fence_probe_observer_invalid");
  }
  return parseWaiterObservation(value);
}

async function cancelObservedWaiter(input) {
  const environment = {
    FAOLLA_WAITER_PID: input.waiter.pid,
    FAOLLA_DATABASE_OID: input.waiter.databaseOid,
    FAOLLA_RELATION_OID: input.waiter.relationOid,
    FAOLLA_SCHEMA_NAME: input.waiter.schemaName,
    FAOLLA_RELATION_NAME: input.waiter.relationName,
    FAOLLA_DATABASE_USER: input.waiter.databaseUser,
    FAOLLA_APPLICATION_NAME: input.waiter.applicationName,
    FAOLLA_CLIENT_ADDRESS: input.waiter.clientAddress,
    FAOLLA_QUERY_STARTED_AT_EPOCH_MS:
      input.waiter.queryStartedAtEpochMilliseconds,
    FAOLLA_FENCE_BACKEND_PID: input.fenceBackendPid,
  };
  const child = spawnDocker(
    input.spawnProcess ?? spawn,
    dockerExecArguments(
      input.containerId,
      environment,
      CANCEL_WAITER_CONTAINER_SCRIPT,
    ),
  );
  let stdout = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > 1024) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  });
  child.stderr?.resume();
  const completion = childCompletion(child);
  child.stdin.end(CANCEL_WAITER_SQL);
  const result = await (input.deadline ?? withWallClockDeadline)(
    completion,
    EXTERNAL_OPERATION_TIMEOUT_MS,
    "readiness_fence_probe_waiter_cancel_timeout",
    () => child.kill("SIGKILL"),
  );
  if (
    result.error ||
    result.code !== 0 ||
    new TextDecoder("utf-8", { fatal: true }).decode(stdout).trim() !==
      "cancelled"
  ) {
    fail("readiness_fence_probe_waiter_cancel_failed");
  }
}

async function captureDockerOutput(
  argumentsList,
  spawnProcess,
  code,
  deadline = withWallClockDeadline,
) {
  const child = spawnDocker(spawnProcess ?? spawn, argumentsList);
  let stdout = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > MAX_OUTPUT_BYTES) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  });
  child.stderr?.resume();
  child.stdin.end();
  const result = await deadline(
    childCompletion(child),
    EXTERNAL_OPERATION_TIMEOUT_MS,
    `${code}_timeout`,
    () => child.kill("SIGKILL"),
  );
  if (result.error || result.code !== 0 || stdout.length > MAX_OUTPUT_BYTES) {
    fail(code);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(stdout);
}

export async function resolveSupabaseServiceClientAddresses(
  service,
  databaseContainerId,
  expectedDatabaseName,
  spawnProcess,
  deadline = withWallClockDeadline,
) {
  if (service !== "rest" && service !== "auth") {
    fail("readiness_fence_probe_service_invalid");
  }
  let databaseInspect;
  try {
    databaseInspect = JSON.parse(
      await captureDockerOutput(
        ["inspect", databaseContainerId],
        spawnProcess,
        "readiness_fence_probe_service_identity_invalid",
        deadline,
      ),
    );
  } catch (error) {
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    fail("readiness_fence_probe_service_identity_invalid");
  }
  const database = databaseInspect?.[0];
  const project =
    database?.Config?.Labels?.["com.docker.compose.project"];
  const databaseNetworks = new Set(
    Object.keys(database?.NetworkSettings?.Networks ?? {}),
  );
  const databaseHosts = new Set(
    [
      typeof database?.Name === "string" ? database.Name.replace(/^\//, "") : null,
      ...Object.values(database?.NetworkSettings?.Networks ?? {}).flatMap(
        (identity) => [identity?.IPAddress, ...(identity?.Aliases ?? [])],
      ),
    ].filter((value) => typeof value === "string" && value !== ""),
  );
  if (
    database?.Id !== databaseContainerId ||
    typeof project !== "string" ||
    project.length === 0 ||
    project.length > 128 ||
    databaseNetworks.size === 0
  ) {
    fail("readiness_fence_probe_service_identity_invalid");
  }
  const databaseEnvironmentName =
    service === "rest" ? "PGRST_DB_URI" : "GOTRUE_DB_DATABASE_URL";
  const serviceIds = (
    await captureDockerOutput(
      [
        "ps",
        "--no-trunc",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--filter",
        `label=com.docker.compose.service=${service}`,
        "--filter",
        "status=running",
        "--format",
        "{{.ID}}",
      ],
      spawnProcess,
      "readiness_fence_probe_service_identity_invalid",
      deadline,
    )
  )
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (
    serviceIds.length !== 1 ||
    !CONTAINER_ID_PATTERN.test(serviceIds[0])
  ) {
    fail("readiness_fence_probe_service_identity_invalid");
  }
  let serviceInspect;
  try {
    serviceInspect = JSON.parse(
      await captureDockerOutput(
        ["inspect", serviceIds[0]],
        spawnProcess,
        "readiness_fence_probe_service_identity_invalid",
        deadline,
      ),
    );
  } catch (error) {
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    fail("readiness_fence_probe_service_identity_invalid");
  }
  const serviceContainer = serviceInspect?.[0];
  if (
    serviceContainer?.Config?.Labels?.["com.docker.compose.project"] !== project ||
    serviceContainer?.Config?.Labels?.["com.docker.compose.service"] !== service ||
    serviceContainer?.Id !== serviceIds[0] ||
    !/^sha256:[0-9a-f]{64}$/.test(serviceContainer?.Image ?? "")
  ) {
    fail("readiness_fence_probe_service_identity_invalid");
  }
  const databaseEnvironmentValues = (serviceContainer.Config.Env ?? [])
    .filter(
      (entry) =>
        typeof entry === "string" &&
        entry.startsWith(`${databaseEnvironmentName}=`),
    )
    .map((entry) => entry.slice(databaseEnvironmentName.length + 1));
  let databaseUrl;
  let databaseUser;
  let databaseName;
  try {
    if (databaseEnvironmentValues.length !== 1) throw new Error("invalid");
    databaseUrl = new URL(databaseEnvironmentValues[0]);
    databaseUser = decodeURIComponent(databaseUrl.username);
    databaseName = decodeURIComponent(
      databaseUrl.pathname.replace(/^\//, ""),
    );
  } catch {
    fail("readiness_fence_probe_service_database_route_invalid");
  }
  if (
    (databaseUrl.protocol !== "postgres:" &&
      databaseUrl.protocol !== "postgresql:") ||
    !databaseHosts.has(databaseUrl.hostname) ||
    databaseName !== expectedDatabaseName ||
    databaseUser.length === 0 ||
    (databaseUrl.port !== "" && databaseUrl.port !== "5432")
  ) {
    fail("readiness_fence_probe_service_database_route_invalid");
  }
  const addresses = Object.entries(
    serviceContainer?.NetworkSettings?.Networks ?? {},
  )
    .filter(([network]) => databaseNetworks.has(network))
    .map(([, identity]) => identity?.IPAddress)
    .filter((value) => typeof value === "string" && value !== "");
  if (
    addresses.length === 0 ||
    new Set(addresses).size !== addresses.length ||
    addresses.some(
      (value) =>
        value.length > 128 ||
        !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-fA-F:]+$/.test(value),
    )
  ) {
    fail("readiness_fence_probe_service_identity_invalid");
  }
  return {
    containerId: serviceIds[0],
    imageId: serviceContainer.Image,
    clientAddresses: addresses.sort(),
    databaseUser,
    databaseName: expectedDatabaseName,
    databasePort: databaseUrl.port || "5432",
  };
}

function parseWaiterObservation(value) {
  const source = exactRecord(
    value,
    ["databaseOid", "clockEpochMilliseconds", "serviceSessions", "waiters"],
    "readiness_fence_probe_observer_invalid",
  );
  if (
    typeof source.databaseOid !== "string" ||
    !POSITIVE_DECIMAL_PATTERN.test(source.databaseOid) ||
    typeof source.clockEpochMilliseconds !== "string" ||
    !EPOCH_MILLISECONDS_PATTERN.test(source.clockEpochMilliseconds) ||
    !Array.isArray(source.serviceSessions) ||
    !Array.isArray(source.waiters)
  ) {
    fail("readiness_fence_probe_observer_invalid");
  }
  const serviceSessions = source.serviceSessions.map((session) => {
    const row = exactRecord(
      session,
      ["databaseUser", "applicationName", "clientAddress"],
      "readiness_fence_probe_observer_invalid",
    );
    if (
      typeof row.databaseUser !== "string" ||
      row.databaseUser.length === 0 ||
      row.databaseUser.length > 128 ||
      typeof row.applicationName !== "string" ||
      row.applicationName.length > 256 ||
      typeof row.clientAddress !== "string" ||
      row.clientAddress.length === 0 ||
      row.clientAddress.length > 128
    ) {
      fail("readiness_fence_probe_observer_invalid");
    }
    return row;
  });
  const waiters = source.waiters.map((waiter) => {
    const row = exactRecord(
      waiter,
      [
        "pid",
        "databaseOid",
        "relationOid",
        "schemaName",
        "relationName",
        "databaseUser",
        "applicationName",
        "clientAddress",
        "query",
        "mode",
        "granted",
        "queryStartedAtEpochMilliseconds",
        "blockingPids",
      ],
      "readiness_fence_probe_observer_invalid",
    );
    if (
      typeof row.pid !== "string" ||
      !PID_PATTERN.test(row.pid) ||
      BigInt(row.pid) > MAX_PID ||
      typeof row.databaseOid !== "string" ||
      !POSITIVE_DECIMAL_PATTERN.test(row.databaseOid) ||
      typeof row.relationOid !== "string" ||
      !POSITIVE_DECIMAL_PATTERN.test(row.relationOid) ||
      typeof row.schemaName !== "string" ||
      row.schemaName.length === 0 ||
      typeof row.relationName !== "string" ||
      row.relationName.length === 0 ||
      typeof row.databaseUser !== "string" ||
      row.databaseUser.length === 0 ||
      row.databaseUser.length > 128 ||
      typeof row.applicationName !== "string" ||
      row.applicationName.length > 256 ||
      typeof row.clientAddress !== "string" ||
      row.clientAddress.length === 0 ||
      row.clientAddress.length > 128 ||
      typeof row.query !== "string" ||
      row.query.length === 0 ||
      row.query.length > 128 * 1024 ||
      typeof row.mode !== "string" ||
      typeof row.granted !== "boolean" ||
      typeof row.queryStartedAtEpochMilliseconds !== "string" ||
      !EPOCH_MILLISECONDS_PATTERN.test(row.queryStartedAtEpochMilliseconds) ||
      !Array.isArray(row.blockingPids) ||
      row.blockingPids.some(
        (pid) =>
          typeof pid !== "string" ||
          !PID_PATTERN.test(pid) ||
          BigInt(pid) > MAX_PID,
      )
    ) {
      fail("readiness_fence_probe_observer_invalid");
    }
    return row;
  });
  return { ...source, serviceSessions, waiters };
}

function requiredProbeEnvironment(environment) {
  const internalUrl = environment.SUPABASE_INTERNAL_URL;
  const publicUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    typeof internalUrl !== "string" ||
    internalUrl.length === 0 ||
    typeof publicUrl !== "string" ||
    publicUrl.length === 0 ||
    typeof anonKey !== "string" ||
    anonKey.length === 0 ||
    anonKey.length > 16 * 1024
  ) {
    fail("readiness_fence_probe_environment_invalid");
  }
  const parseBase = (raw) => {
    let value;
    try {
      value = new URL(raw);
    } catch {
      fail("readiness_fence_probe_environment_invalid");
    }
    if (
      (value.protocol !== "http:" && value.protocol !== "https:") ||
      value.username !== "" ||
      value.password !== "" ||
      value.search !== "" ||
      value.hash !== ""
    ) {
      fail("readiness_fence_probe_environment_invalid");
    }
    return value;
  };
  return {
    internalUrl: parseBase(internalUrl),
    publicUrl: parseBase(publicUrl),
    anonKey,
  };
}

function endpointUrl(base, relativePath) {
  const prefix = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return new URL(relativePath, prefix);
}

function probeRequestSpecifications(environment, randomHex) {
  const commonHeaders = {
    accept: "application/json",
    apikey: environment.anonKey,
    authorization: `Bearer ${environment.anonKey}`,
    "cache-control": "no-cache, no-store, max-age=0",
    pragma: "no-cache",
  };
  const nonce = (byteLength) => {
    const value = randomHex(byteLength);
    if (
      typeof value !== "string" ||
      !new RegExp(`^[0-9a-f]{${byteLength * 2}}$`).test(value)
    ) {
      fail("readiness_fence_probe_random_invalid");
    }
    return value;
  };
  const createPair = (base, scope) => {
    const baseEndpointSha256 = sha256Hex(Buffer.from(base.href, "utf8"));
    const pageIdentity = nonce(16);
    const queryMarker = `probe_${nonce(12)}`;
    const pageUuid = [
      pageIdentity.slice(0, 8),
      pageIdentity.slice(8, 12),
      pageIdentity.slice(12, 16),
      pageIdentity.slice(16, 20),
      pageIdentity.slice(20, 32),
    ].join("-");
    const emailNonce = nonce(16);
    const passwordNonce = nonce(16);
    return [
      {
        probe: `${scope}Rest`,
        service: "rest",
        baseEndpointSha256,
        url: endpointUrl(
          base,
          `rest/v1/pages?select=${queryMarker}:id&id=eq.${pageUuid}&limit=1`,
        ),
        queryMarker,
        schemaName: "public",
        relationName: "pages",
        request: {
          method: "GET",
          headers: commonHeaders,
          cache: "no-store",
          redirect: "error",
        },
      },
      {
        probe: `${scope}Auth`,
        service: "auth",
        baseEndpointSha256,
        url: endpointUrl(base, "auth/v1/token?grant_type=password"),
        schemaName: "auth",
        relationName: "users",
        queryMarker: null,
        request: {
          method: "POST",
          headers: {
            ...commonHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: `faolla-fence-${emailNonce}@invalid.example`,
            password: `Ff1!${passwordNonce}`,
          }),
          cache: "no-store",
          redirect: "error",
        },
      },
    ];
  };
  return [
    ...createPair(environment.internalUrl, "internal"),
    ...createPair(environment.publicUrl, "public"),
  ];
}

function validateCandidateWaiter(candidate, expected) {
  if (
    candidate.databaseOid !== expected.databaseOid ||
    candidate.schemaName !== expected.schemaName ||
    candidate.relationName !== expected.relationName ||
    candidate.mode !== "AccessShareLock" ||
    candidate.granted !== false ||
    BigInt(candidate.queryStartedAtEpochMilliseconds) <
      BigInt(expected.notBeforeEpochMilliseconds) ||
    candidate.blockingPids.length !== 1 ||
    candidate.blockingPids[0] !== expected.fenceBackendPid ||
    candidate.databaseUser !== expected.databaseUser ||
    !expected.clientAddresses.includes(candidate.clientAddress) ||
    (expected.applicationName !== null &&
      candidate.applicationName !== expected.applicationName) ||
    (expected.queryMarker !== null &&
      !candidate.query.includes(`"${expected.queryMarker}"`))
  ) {
    fail("readiness_fence_probe_waiter_invalid");
  }
}

async function validateQueryCancelledHttpResponse(
  specification,
  response,
  deadline,
) {
  if (
    typeof response !== "object" ||
    response === null ||
    !Number.isInteger(response.status) ||
    response.status < 500 ||
    response.status > 599 ||
    typeof response.text !== "function"
  ) {
    fail("readiness_fence_probe_query_cancel_response_invalid");
  }
  const body = await deadline(
    response.text(),
    QUERY_CANCEL_RESPONSE_TIMEOUT_MS,
    "readiness_fence_probe_query_cancel_response_timeout",
  );
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > 64 * 1024) {
    fail("readiness_fence_probe_query_cancel_response_invalid");
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    fail("readiness_fence_probe_query_cancel_response_invalid");
  }
  if (specification.service === "rest") {
    if (value?.code !== "57014") {
      fail("readiness_fence_probe_query_cancel_response_invalid");
    }
    return;
  }
  if (value?.error_code !== "unexpected_failure") {
    fail("readiness_fence_probe_query_cancel_response_invalid");
  }
}

export async function probeOrdinaryAccountCutoverReadinessFenceEndpoints(
  input,
  dependencies = {},
) {
  const source = exactRecord(
    input,
    ["containerId", "databaseName", "databaseOid", "fenceBackendPid"],
    "readiness_fence_probe_input_invalid",
  );
  if (
    typeof source.containerId !== "string" ||
    !CONTAINER_ID_PATTERN.test(source.containerId) ||
    typeof source.databaseOid !== "string" ||
    !POSITIVE_DECIMAL_PATTERN.test(source.databaseOid) ||
    typeof source.fenceBackendPid !== "string" ||
    !PID_PATTERN.test(source.fenceBackendPid) ||
    typeof source.databaseName !== "string" ||
    source.databaseName.length === 0 ||
    source.databaseName.length > 128
  ) {
    fail("readiness_fence_probe_input_invalid");
  }
  const environment = requiredProbeEnvironment(
    dependencies.environment ?? process.env,
  );
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    fail("readiness_fence_probe_fetch_unavailable");
  }
  const randomHex =
    dependencies.randomProbeHex ??
    ((byteLength) => randomBytes(byteLength).toString("hex"));
  const deadline = dependencies.deadline ?? withWallClockDeadline;
  const rawObserveWaiters =
    dependencies.observeWaiters ??
    (() =>
      runDockerWaiterObservation({
        containerId: source.containerId,
        spawnProcess: dependencies.spawnProcess,
        deadline,
      }));
  const rawCancelWaiter =
    dependencies.cancelWaiter ??
    ((waiter) =>
      cancelObservedWaiter({
        containerId: source.containerId,
        fenceBackendPid: source.fenceBackendPid,
        waiter,
        spawnProcess: dependencies.spawnProcess,
        deadline,
      }));
  const rawPoll =
    dependencies.poll ??
    (() =>
      new Promise((resolve) => setTimeout(resolve, ENDPOINT_PROBE_POLL_MS)));
  const observeWaiters = () =>
    dependencies.observeWaiters
      ? deadline(
          rawObserveWaiters(),
          EXTERNAL_OPERATION_TIMEOUT_MS,
          "readiness_fence_probe_observer_timeout",
        )
      : rawObserveWaiters();
  const cancelWaiter = (waiter) =>
    dependencies.cancelWaiter
      ? deadline(
          rawCancelWaiter(waiter),
          EXTERNAL_OPERATION_TIMEOUT_MS,
          "readiness_fence_probe_waiter_cancel_timeout",
        )
      : rawCancelWaiter(waiter);
  const poll = () =>
    deadline(
      rawPoll(),
      EXTERNAL_OPERATION_TIMEOUT_MS,
      "readiness_fence_probe_poll_timeout",
    );
  const serviceIdentities =
    dependencies.serviceIdentities ?? {
      rest: await resolveSupabaseServiceClientAddresses(
        "rest",
        source.containerId,
        source.databaseName,
        dependencies.spawnProcess,
        deadline,
      ),
      auth: await resolveSupabaseServiceClientAddresses(
        "auth",
        source.containerId,
        source.databaseName,
        dependencies.spawnProcess,
        deadline,
      ),
    };
  exactRecord(
    serviceIdentities,
    ["rest", "auth"],
    "readiness_fence_probe_service_identity_invalid",
  );
  for (const service of ["rest", "auth"]) {
    const identity = exactRecord(
      serviceIdentities[service],
      [
        "containerId",
        "imageId",
        "clientAddresses",
        "databaseUser",
        "databaseName",
        "databasePort",
      ],
      "readiness_fence_probe_service_identity_invalid",
    );
    if (
      !CONTAINER_ID_PATTERN.test(identity.containerId) ||
      !/^sha256:[0-9a-f]{64}$/.test(identity.imageId) ||
      !Array.isArray(identity.clientAddresses) ||
      identity.clientAddresses.length === 0 ||
      identity.clientAddresses.some(
        (address) => typeof address !== "string" || address.length === 0,
      ) ||
      typeof identity.databaseUser !== "string" ||
      identity.databaseUser.length === 0 ||
      identity.databaseName !== source.databaseName ||
      identity.databasePort !== "5432"
    ) {
      fail("readiness_fence_probe_service_identity_invalid");
    }
  }
  const maximumPolls = Math.ceil(
    ENDPOINT_PROBE_TIMEOUT_MS / ENDPOINT_PROBE_POLL_MS,
  );
  const evidence = [];

  for (const specification of probeRequestSpecifications(
    environment,
    randomHex,
  )) {
    const before = parseWaiterObservation(await observeWaiters());
    if (before.databaseOid !== source.databaseOid) {
      fail("readiness_fence_probe_database_mismatch");
    }
    const previousPids = new Set(before.waiters.map((waiter) => waiter.pid));
    const serviceIdentity = serviceIdentities[specification.service];
    const frozenApplicationNames = new Set(
      before.serviceSessions
        .filter(
          (session) =>
            session.databaseUser === serviceIdentity.databaseUser &&
            serviceIdentity.clientAddresses.includes(session.clientAddress),
        )
        .map((session) => session.applicationName),
    );
    if (frozenApplicationNames.size > 1) {
      fail("readiness_fence_probe_service_application_invalid");
    }
    const preexistingApplicationName =
      frozenApplicationNames.size === 1 ? [...frozenApplicationNames][0] : null;
    const abortController = new AbortController();
    const externalSignal = dependencies.signal;
    const abortFromExternalSignal = () => abortController.abort();
    if (externalSignal?.aborted) {
      fail("readiness_fence_probe_cancelled");
    }
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
    let requestSettled = false;
    let requestOutcome = null;
    const requestPromise = Promise.resolve()
      .then(() =>
        fetchImpl(specification.url, {
          ...specification.request,
          signal: abortController.signal,
        }),
      )
      .then(
        (response) => {
          requestSettled = true;
          requestOutcome = { response };
        },
        (error) => {
          requestSettled = true;
          requestOutcome = { error };
        },
      );
    let accepted = null;
    try {
      for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
        if (requestSettled) {
          fail("readiness_fence_probe_http_completed_early");
        }
        const observation = parseWaiterObservation(await observeWaiters());
        if (observation.databaseOid !== source.databaseOid) {
          fail("readiness_fence_probe_database_mismatch");
        }
        await new Promise((resolve) => setImmediate(resolve));
        if (requestSettled) {
          fail("readiness_fence_probe_http_completed_early");
        }
        const candidates = observation.waiters.filter(
          (waiter) => !previousPids.has(waiter.pid),
        );
        if (candidates.length > 1) {
          fail("readiness_fence_probe_waiter_count_invalid");
        }
        if (candidates.length === 1) {
          validateCandidateWaiter(candidates[0], {
            databaseOid: source.databaseOid,
            schemaName: specification.schemaName,
            relationName: specification.relationName,
            fenceBackendPid: source.fenceBackendPid,
            notBeforeEpochMilliseconds: before.clockEpochMilliseconds,
            clientAddresses: serviceIdentity.clientAddresses,
            databaseUser: serviceIdentity.databaseUser,
            applicationName: preexistingApplicationName,
            queryMarker: specification.queryMarker,
          });
          accepted = candidates[0];
          break;
        }
        await poll();
      }
      if (accepted === null) fail("readiness_fence_probe_waiter_missing");
      const applicationName = accepted.applicationName;
      await cancelWaiter(accepted);
      let responseError = null;
      try {
        await deadline(
          requestPromise,
          QUERY_CANCEL_RESPONSE_TIMEOUT_MS,
          "readiness_fence_probe_query_cancel_response_timeout",
          () => abortController.abort(),
        );
        if (!requestOutcome?.response || requestOutcome?.error) {
          fail("readiness_fence_probe_query_cancel_response_invalid");
        }
        await validateQueryCancelledHttpResponse(
          specification,
          requestOutcome.response,
          deadline,
        );
      } catch (error) {
        responseError = error;
      }
      let disappeared = false;
      for (let attempt = 0; attempt < maximumPolls; attempt += 1) {
        const observation = parseWaiterObservation(await observeWaiters());
        if (observation.databaseOid !== source.databaseOid) {
          fail("readiness_fence_probe_database_mismatch");
        }
        const newWaiters = observation.waiters.filter(
          (waiter) => !previousPids.has(waiter.pid),
        );
        if (newWaiters.length === 0) {
          disappeared = true;
          break;
        }
        if (
          newWaiters.length !== 1 ||
          newWaiters[0].pid !== accepted.pid
        ) {
          fail("readiness_fence_probe_waiter_count_invalid");
        }
        validateCandidateWaiter(newWaiters[0], {
          databaseOid: source.databaseOid,
          schemaName: specification.schemaName,
          relationName: specification.relationName,
          fenceBackendPid: source.fenceBackendPid,
          notBeforeEpochMilliseconds: before.clockEpochMilliseconds,
          clientAddresses: serviceIdentity.clientAddresses,
          databaseUser: serviceIdentity.databaseUser,
          applicationName,
          queryMarker: specification.queryMarker,
        });
        await poll();
      }
      if (!disappeared) fail("readiness_fence_probe_waiter_residual");
      if (responseError !== null) throw responseError;
    } catch (error) {
      if (!requestSettled) {
        abortController.abort();
        try {
          await deadline(
            requestPromise,
            QUERY_CANCEL_RESPONSE_TIMEOUT_MS,
            "readiness_fence_probe_abort_timeout",
          );
        } catch {}
      }
      throw error;
    } finally {
      externalSignal?.removeEventListener(
        "abort",
        abortFromExternalSignal,
      );
    }
    evidence.push({
      probe: specification.probe,
      baseEndpointSha256: specification.baseEndpointSha256,
      endpointSha256: sha256Hex(Buffer.from(specification.url.href, "utf8")),
      serviceIdentitySha256: sha256Hex(
        canonicalJsonBytes({
          ...serviceIdentity,
          applicationName: accepted.applicationName,
        }),
      ),
      databaseQuerySha256: sha256Hex(Buffer.from(accepted.query, "utf8")),
      databaseOid: accepted.databaseOid,
      relationOid: accepted.relationOid,
      schemaName: accepted.schemaName,
      relationName: accepted.relationName,
      waiterPid: accepted.pid,
      databaseClockEpochMilliseconds: before.clockEpochMilliseconds,
      queryStartedAtEpochMilliseconds:
        accepted.queryStartedAtEpochMilliseconds,
      blockingPids: accepted.blockingPids,
    });
  }
  return evidence;
}

export async function terminateOrdinaryAccountCutoverReadinessFenceSession(
  input,
) {
  if (
    typeof input.applicationName !== "string" ||
    !/^faolla_readiness_fence_[1-9][0-9]*_[0-9a-f]{24}$/.test(
      input.applicationName,
    ) ||
    (input.backendPid !== null &&
      input.backendPid !== undefined &&
      (!PID_PATTERN.test(input.backendPid) || BigInt(input.backendPid) > MAX_PID)) ||
    typeof input.requireExactOne !== "boolean"
  ) {
    fail("readiness_fence_termination_input_invalid");
  }
  const child = spawnDocker(
    input.spawnProcess ?? spawn,
    dockerExecArguments(
      input.containerId,
      {
        FAOLLA_FENCE_APPLICATION_NAME: input.applicationName,
        FAOLLA_FENCE_BACKEND_PID: input.backendPid ?? "0",
      },
      TERMINATE_PSQL_CONTAINER_SCRIPT,
    ),
  );
  let stdout = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
    if (stdout.length > 4096) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  });
  child.stderr?.resume();
  const completion = childCompletion(child);
  child.stdin.end(TERMINATE_FENCE_SQL);
  const result = await withWallClockDeadline(
    completion,
    EXTERNAL_OPERATION_TIMEOUT_MS,
    "readiness_fence_termination_timeout",
    () => child.kill("SIGKILL"),
  );
  if (result.error || result.code !== 0 || stdout.length > 4096) {
    fail("readiness_fence_termination_failed");
  }
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(stdout)
    .split(/\r?\n/)
    .filter((line) => line !== "");
  if (lines.length !== 2) fail("readiness_fence_termination_failed");
  let counts;
  let remaining;
  try {
    counts = exactRecord(
      JSON.parse(lines[0]),
      ["matchedCount", "terminatedCount"],
      "readiness_fence_termination_failed",
    );
    remaining = exactRecord(
      JSON.parse(lines[1]),
      ["remainingCount"],
      "readiness_fence_termination_failed",
    );
  } catch (error) {
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    fail("readiness_fence_termination_failed");
  }
  if (
    !/^[0-9]+$/.test(counts.matchedCount) ||
    !/^[0-9]+$/.test(counts.terminatedCount) ||
    !/^[0-9]+$/.test(remaining.remainingCount)
  ) {
    fail("readiness_fence_termination_failed");
  }
  const matchedCount = Number(counts.matchedCount);
  const terminatedCount = Number(counts.terminatedCount);
  if (
    !Number.isSafeInteger(matchedCount) ||
    !Number.isSafeInteger(terminatedCount) ||
    matchedCount > 1 ||
    terminatedCount !== matchedCount ||
    remaining.remainingCount !== "0" ||
    (input.requireExactOne && matchedCount !== 1)
  ) {
    fail("readiness_fence_termination_failed");
  }
}

function parseFenceOutputLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    fail("readiness_fence_output_invalid");
  }
  const source = exactRecord(
    value,
    ["backendPid", "report"],
    "readiness_fence_output_invalid",
  );
  if (
    typeof source.backendPid !== "string" ||
    !PID_PATTERN.test(source.backendPid) ||
    BigInt(source.backendPid) > MAX_PID
  ) {
    fail("readiness_fence_backend_pid_invalid");
  }
  let report;
  try {
    report = parseOrdinaryAccountCutoverDatabaseReport(
      `${JSON.stringify(source.report)}\n`,
    );
  } catch {
    fail("readiness_fence_report_invalid");
  }
  return { backendPid: source.backendPid, report };
}

function parseFenceHoldOutputLine(line, expectedBackendPid) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    fail("readiness_fence_hold_output_invalid");
  }
  const source = exactRecord(
    value,
    ["backendPid", "holdLocks"],
    "readiness_fence_hold_output_invalid",
  );
  const holdLocks = exactRecord(
    source.holdLocks,
    [
      "authShareLockCount",
      "authAccessExclusiveLockCount",
      "pagesAccessExclusiveLockCount",
      "registryAccessExclusiveLockCount",
    ],
    "readiness_fence_hold_output_invalid",
  );
  if (
    source.backendPid !== expectedBackendPid ||
    holdLocks.authShareLockCount !== "1" ||
    holdLocks.authAccessExclusiveLockCount !== "0" ||
    holdLocks.pagesAccessExclusiveLockCount !== "0" ||
    holdLocks.registryAccessExclusiveLockCount !== "1"
  ) {
    fail("readiness_fence_hold_locks_invalid");
  }
  return { backendPid: source.backendPid, holdLocks };
}

function validateLiveReport(report, attestation) {
  if (report.status !== "ready") fail("readiness_fence_report_blocked");
  const expectedIdentity = {
    dbName: attestation.database.dbName,
    dbOid: attestation.database.dbOid,
    systemId: attestation.database.systemId,
    primary: attestation.database.primary,
  };
  if (
    canonicalJsonBytes(report.databaseIdentity).compare(
      canonicalJsonBytes(expectedIdentity),
    ) !== 0
  ) {
    fail("readiness_fence_database_identity_mismatch");
  }
  const actualBaseline = Object.fromEntries(
    PRODUCTION_RELEASE_BASELINE_KEYS.map((key) => [
      key,
      key === ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY
        ? report.readiness[key]
        : String(report.readiness[key]),
    ]),
  );
  if (
    canonicalJsonBytes(actualBaseline).compare(
      canonicalJsonBytes(attestation.baseline),
    ) !== 0
  ) {
    fail("readiness_fence_baseline_mismatch");
  }
}

export async function writeAtomicReadinessFenceMarker(
  markerPath,
  bytes,
  options = {},
) {
  const operations = options.operations ?? { link, lstat, open, unlink };
  const temporaryPath = path.join(
    path.dirname(markerPath),
    `.${path.basename(markerPath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let handle;
  let linked = false;
  try {
    handle = await operations.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await operations.link(temporaryPath, markerPath);
    linked = true;
    const identity = await operations.lstat(markerPath);
    if (!identity.isFile() || identity.isSymbolicLink()) {
      fail("readiness_fence_marker_invalid");
    }
    return { dev: String(identity.dev), ino: String(identity.ino) };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (linked) await operations.unlink(markerPath).catch(() => {});
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    if (error?.code === "EEXIST") fail("readiness_fence_marker_exists");
    fail("readiness_fence_marker_write_failed");
  } finally {
    await operations.unlink(temporaryPath).catch(() => {});
  }
}

async function assertReleaseRequestPathAbsent(releaseRequestPath) {
  try {
    await lstat(releaseRequestPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail("readiness_fence_release_request_path_invalid");
  }
  fail("readiness_fence_release_request_exists");
}

export async function readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest(
  releaseRequestPath,
  expected,
  options = {},
) {
  const operations = options.fileOperations ?? { lstat, open };
  let handle;
  let bytes;
  let identity;
  try {
    const before = await operations.lstat(releaseRequestPath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(MAX_RELEASE_REQUEST_BYTES) ||
      (process.platform !== "win32" && (before.mode & 0o077n) !== 0n)
    ) {
      fail("readiness_fence_release_request_file_invalid");
    }
    handle = await operations.open(releaseRequestPath, "r");
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.nlink !== 1n
    ) {
      fail("readiness_fence_release_request_changed");
    }
    identity = { dev: String(opened.dev), ino: String(opened.ino) };
    bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await operations.lstat(releaseRequestPath, {
      bigint: true,
    });
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      after.size !== BigInt(bytes.length) ||
      current.size !== after.size ||
      after.mtimeNs !== opened.mtimeNs ||
      current.mtimeNs !== after.mtimeNs ||
      after.nlink !== 1n ||
      current.nlink !== 1n
    ) {
      fail("readiness_fence_release_request_changed");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof OrdinaryAccountCutoverReadinessFenceError) throw error;
    fail("readiness_fence_release_request_file_invalid");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("readiness_fence_release_request_invalid");
  }
  const source = exactRecord(
    value,
    ["schemaVersion", "kind", "markerSha256", "releaseToken"],
    "readiness_fence_release_request_invalid",
  );
  if (
    source.schemaVersion !== 1 ||
    source.kind !== RELEASE_REQUEST_KIND ||
    typeof source.markerSha256 !== "string" ||
    !SHA256_PATTERN.test(source.markerSha256) ||
    typeof source.releaseToken !== "string" ||
    !SHA256_PATTERN.test(source.releaseToken) ||
    !bytes.equals(canonicalJsonBytes(source))
  ) {
    fail("readiness_fence_release_request_invalid");
  }
  const actualMarkerSha = Buffer.from(source.markerSha256, "ascii");
  const expectedMarkerSha = Buffer.from(expected.markerSha256, "ascii");
  const actualToken = Buffer.from(source.releaseToken, "ascii");
  const expectedToken = Buffer.from(expected.releaseToken, "ascii");
  if (
    actualMarkerSha.length !== expectedMarkerSha.length ||
    actualToken.length !== expectedToken.length ||
    !timingSafeEqual(actualMarkerSha, expectedMarkerSha) ||
    !timingSafeEqual(actualToken, expectedToken)
  ) {
    fail("readiness_fence_release_request_binding_mismatch");
  }
  return { bytes, source, identity };
}

async function waitForAuthorizedReleaseRequest(
  releaseRequestPath,
  expected,
  signal,
  dependencies,
) {
  const poll =
    dependencies.releaseRequestPoll ??
    (() => new Promise((resolve) => setTimeout(resolve, 50)));
  while (!signal.aborted) {
    const request =
      await readAuthorizedOrdinaryAccountCutoverFenceReleaseRequest(
        releaseRequestPath,
        expected,
        { fileOperations: dependencies.releaseRequestFileOperations },
      );
    if (request !== null) return request;
    await poll();
  }
  fail("readiness_fence_release_wait_cancelled");
}

async function removeReadinessFenceMarker(markerPath, identity) {
  let current;
  try {
    current = await lstat(markerPath);
  } catch (error) {
    fail("readiness_fence_marker_cleanup_failed");
  }
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    String(current.dev) !== identity.dev ||
    String(current.ino) !== identity.ino
  ) {
    fail("readiness_fence_marker_cleanup_failed");
  }
  try {
    await unlink(markerPath);
  } catch {
    fail("readiness_fence_marker_cleanup_failed");
  }
}

async function removeBoundReleaseRequest(releaseRequestPath, identity) {
  let current;
  try {
    current = await lstat(releaseRequestPath, { bigint: true });
  } catch {
    fail("readiness_fence_release_request_cleanup_failed");
  }
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    String(current.dev) !== identity.dev ||
    String(current.ino) !== identity.ino
  ) {
    fail("readiness_fence_release_request_cleanup_failed");
  }
  try {
    await unlink(releaseRequestPath);
  } catch {
    fail("readiness_fence_release_request_cleanup_failed");
  }
}

function validateEndpointEvidence(value) {
  const expectedProbes = [
    ["internalRest", "public", "pages"],
    ["internalAuth", "auth", "users"],
    ["publicRest", "public", "pages"],
    ["publicAuth", "auth", "users"],
  ];
  if (!Array.isArray(value) || value.length !== expectedProbes.length) {
    fail("readiness_fence_probe_evidence_invalid");
  }
  return value.map((entry, index) => {
    const source = exactRecord(
      entry,
      [
        "probe",
        "baseEndpointSha256",
        "endpointSha256",
        "serviceIdentitySha256",
        "databaseQuerySha256",
        "databaseOid",
        "relationOid",
        "schemaName",
        "relationName",
        "waiterPid",
        "databaseClockEpochMilliseconds",
        "queryStartedAtEpochMilliseconds",
        "blockingPids",
      ],
      "readiness_fence_probe_evidence_invalid",
    );
    const [probe, schemaName, relationName] = expectedProbes[index];
    if (
      source.probe !== probe ||
      source.schemaName !== schemaName ||
      source.relationName !== relationName ||
      typeof source.baseEndpointSha256 !== "string" ||
      !SHA256_PATTERN.test(source.baseEndpointSha256) ||
      typeof source.endpointSha256 !== "string" ||
      !SHA256_PATTERN.test(source.endpointSha256) ||
      typeof source.serviceIdentitySha256 !== "string" ||
      !SHA256_PATTERN.test(source.serviceIdentitySha256) ||
      typeof source.databaseQuerySha256 !== "string" ||
      !SHA256_PATTERN.test(source.databaseQuerySha256) ||
      typeof source.databaseOid !== "string" ||
      !POSITIVE_DECIMAL_PATTERN.test(source.databaseOid) ||
      typeof source.relationOid !== "string" ||
      !POSITIVE_DECIMAL_PATTERN.test(source.relationOid) ||
      typeof source.waiterPid !== "string" ||
      !PID_PATTERN.test(source.waiterPid) ||
      typeof source.databaseClockEpochMilliseconds !== "string" ||
      !EPOCH_MILLISECONDS_PATTERN.test(
        source.databaseClockEpochMilliseconds,
      ) ||
      typeof source.queryStartedAtEpochMilliseconds !== "string" ||
      !EPOCH_MILLISECONDS_PATTERN.test(
        source.queryStartedAtEpochMilliseconds,
      ) ||
      BigInt(source.queryStartedAtEpochMilliseconds) <
        BigInt(source.databaseClockEpochMilliseconds) ||
      !Array.isArray(source.blockingPids) ||
      source.blockingPids.length !== 1 ||
      !PID_PATTERN.test(source.blockingPids[0])
    ) {
      fail("readiness_fence_probe_evidence_invalid");
    }
    return source;
  });
}

function markerBytes(
  attestation,
  validation,
  backendPid,
  startedAt,
  applicationName,
  releaseToken,
  releaseRequestPath,
  endpointEvidence,
  holdLocks,
) {
  return canonicalJsonBytes({
    schemaVersion: 1,
    kind: FENCE_KIND,
    targetSha: attestation.targetSha,
    readinessRunId: attestation.run.id,
    readinessRunAttempt: attestation.run.attempt,
    readinessArtifactId: attestation.readinessArtifact.id,
    readinessArtifactDigest: attestation.readinessArtifact.digest,
    attestationSha256: validation.sha256,
    database: attestation.database,
    holderPid: String(process.pid),
    backendPid,
    applicationName,
    releaseToken,
    releaseTokenSha256: sha256Hex(Buffer.from(releaseToken, "ascii")),
    releaseRequestPathSha256: sha256Hex(
      Buffer.from(releaseRequestPath, "utf8"),
    ),
    endpointEvidence,
    holdLocks,
    startedAt,
    validUntil: attestation.validUntil,
  });
}

function normalizeCoreInput(input) {
  const source = exactRecord(
    input,
    [
      "attestationPath",
      "expectedTargetSha",
      "expectedRunId",
      "expectedRunAttempt",
      "expectedArtifactId",
      "expectedArtifactDigest",
      "expectedAttestationSha256",
      "expectedContainerId",
      "minimumRemainingTtlSeconds",
      "markerPath",
      "releaseRequestPath",
      "maximumHoldSeconds",
    ],
    "readiness_fence_input_invalid",
  );
  const minimumRemainingTtlSeconds = parsePositiveSeconds(
    source.minimumRemainingTtlSeconds,
    MAX_TTL_SECONDS,
    "readiness_fence_minimum_ttl_invalid",
  );
  const maximumHoldSeconds = parsePositiveSeconds(
    source.maximumHoldSeconds,
    MAX_HOLD_SECONDS,
    "readiness_fence_max_hold_seconds_invalid",
  );
  if (
    minimumRemainingTtlSeconds <
    STARTUP_WATCHDOG_SECONDS +
      maximumHoldSeconds +
      MINIMUM_ROLLBACK_MARGIN_SECONDS
  ) {
    fail("readiness_fence_ttl_below_hold");
  }
  if (
    typeof source.expectedAttestationSha256 !== "string" ||
    !SHA256_PATTERN.test(source.expectedAttestationSha256)
  ) {
    fail("readiness_fence_attestation_sha256_invalid");
  }
  if (
    typeof source.expectedContainerId !== "string" ||
    !CONTAINER_ID_PATTERN.test(source.expectedContainerId)
  ) {
    fail("readiness_fence_container_id_invalid");
  }
  const attestationPath = path.resolve(source.attestationPath);
  const markerPath = path.resolve(source.markerPath);
  const releaseRequestPath = path.resolve(source.releaseRequestPath);
  if (
    new Set([attestationPath, markerPath, releaseRequestPath]).size !== 3
  ) {
    fail("readiness_fence_path_reused");
  }
  return {
    ...source,
    attestationPath,
    markerPath,
    releaseRequestPath,
    minimumRemainingTtlSeconds,
    maximumHoldSeconds,
  };
}

export async function holdOrdinaryAccountCutoverReadinessFence(
  input,
  dependencies = {},
) {
  const normalized = normalizeCoreInput(input);
  const nowMs = dependencies.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("readiness_fence_now_invalid");
  }
  const runtimeEnvironment = dependencies.environment ?? process.env;
  const validation = await readCanonicalAttestation(
    normalized.attestationPath,
    {
      nowMs,
      minimumRemainingTtlMs: normalized.minimumRemainingTtlSeconds * 1000,
      expectedKind: "readiness",
      expectedTargetSha: normalized.expectedTargetSha,
      expectedRunId: normalized.expectedRunId,
      expectedRunAttempt: normalized.expectedRunAttempt,
      expectedReadinessRunId: normalized.expectedRunId,
      expectedArtifactId: normalized.expectedArtifactId,
      expectedArtifactDigest: normalized.expectedArtifactDigest,
      expectedReadinessArtifactId: normalized.expectedArtifactId,
      expectedReadinessArtifactDigest: normalized.expectedArtifactDigest,
      fileOperations: dependencies.attestationFileOperations,
    },
  );
  const attestation = validation.attestation;
  if (validation.sha256 !== normalized.expectedAttestationSha256) {
    fail("readiness_fence_attestation_sha256_mismatch");
  }
  if (attestation.database.containerId !== normalized.expectedContainerId) {
    fail("readiness_fence_container_id_mismatch");
  }
  if (attestation.backup.attestation.run.event !== "workflow_dispatch") {
    fail("readiness_fence_backup_event_invalid");
  }
  const releaseToken = runtimeEnvironment.FAOLLA_READINESS_FENCE_RELEASE_TOKEN;
  if (
    typeof releaseToken !== "string" ||
    !SHA256_PATTERN.test(releaseToken)
  ) {
    fail("readiness_fence_release_token_invalid");
  }
  requiredProbeEnvironment(runtimeEnvironment);
  await assertReleaseRequestPathAbsent(normalized.releaseRequestPath);

  const applicationName =
    `faolla_readiness_fence_${process.pid}_` +
    (dependencies.randomHex?.() ?? randomBytes(12).toString("hex"));
  if (!/^faolla_readiness_fence_[1-9][0-9]*_[0-9a-f]{24}$/.test(applicationName)) {
    fail("readiness_fence_application_name_invalid");
  }
  const environment = expectedEnvironment(attestation, applicationName);
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const child = spawnDocker(
    spawnProcess,
    dockerExecArguments(
      normalized.expectedContainerId,
      environment,
      PSQL_CONTAINER_SCRIPT,
    ),
  );
  const completion = childCompletion(child);
  let stdoutBytes = 0;
  let stdoutBuffer = "";
  let childStderr = Buffer.alloc(0);
  let childStderrOverflow = false;
  let childStderrComplete = false;
  const stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
  let nonemptyLineCount = 0;
  let terminalCode = null;
  let markerIdentity = null;
  let markerResult = null;
  let releaseRequestIdentity = null;
  let backendPid = null;
  let pendingEndpointEvidence = null;
  let authorizedRelease = false;
  let terminationPromise = null;
  let forceTimer = null;
  let childExitTimer = null;
  let resolveChildExitFallback;
  const childExitFallback = new Promise((resolve) => {
    resolveChildExitFallback = resolve;
  });
  const releaseWaitAbort = new AbortController();
  const scheduleTimer = dependencies.setTimer ?? setTimeout;
  const cancelTimer = dependencies.clearTimer ?? clearTimeout;
  const operationDeadline = dependencies.deadline ?? withWallClockDeadline;
  const signalSource = dependencies.signalSource ?? process;
  const markerWriter =
    dependencies.markerWriter ?? writeAtomicReadinessFenceMarker;
  const terminateSession =
    dependencies.terminateSession ??
    ((terminationInput) =>
      terminateOrdinaryAccountCutoverReadinessFenceSession({
        ...terminationInput,
        spawnProcess,
      }));
  const probeEndpoints =
    dependencies.probeEndpoints ??
    ((probeInput) =>
      probeOrdinaryAccountCutoverReadinessFenceEndpoints(probeInput, {
        environment: runtimeEnvironment,
        spawnProcess,
        signal: releaseWaitAbort.signal,
        deadline: dependencies.deadline,
      }));
  const waitForReleaseRequest =
    dependencies.waitForReleaseRequest ??
    ((requestInput) =>
      waitForAuthorizedReleaseRequest(
        normalized.releaseRequestPath,
        requestInput,
        releaseWaitAbort.signal,
        dependencies,
      ));

  const stop = (code, options = {}) => {
    if (code !== null && terminalCode === null) terminalCode = code;
    if (options.authorized === true) authorizedRelease = true;
    releaseWaitAbort.abort();
    if (terminationPromise === null) {
      if (!options.authorized) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      terminationPromise = Promise.resolve()
        .then(() =>
          operationDeadline(
            terminateSession({
              containerId: normalized.expectedContainerId,
              applicationName,
              backendPid,
              requireExactOne: options.authorized === true,
            }),
            EXTERNAL_OPERATION_TIMEOUT_MS,
            "readiness_fence_termination_timeout",
            () => {
              try {
                child.kill("SIGKILL");
              } catch {}
            },
          ),
        )
        .catch(() => {
          terminalCode = "readiness_fence_termination_failed";
          try {
            child.kill("SIGTERM");
          } catch {}
        });
      forceTimer = scheduleTimer(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 5_000);
      childExitTimer = scheduleTimer(() => {
        if (terminalCode === null) {
          terminalCode = "readiness_fence_child_exit_timeout";
        }
        resolveChildExitFallback({ error: false, code: null, signal: "SIGKILL" });
      }, EXTERNAL_OPERATION_TIMEOUT_MS);
    }
  };

  let timeoutTimer = scheduleTimer(
    () => stop("readiness_fence_startup_timeout"),
    STARTUP_WATCHDOG_SECONDS * 1000,
  );
  completion.then((result) => {
    if (!authorizedRelease && terminalCode === null) {
      terminalCode =
        result.error || result.code !== 0
          ? "readiness_fence_child_failed"
          : "readiness_fence_ended_before_release";
      releaseWaitAbort.abort();
    }
  });

  let lineQueue = Promise.resolve();
  const processLine = async (line) => {
    if (line.trim() === "") return;
    nonemptyLineCount += 1;
    if (nonemptyLineCount > 2) {
      fail("readiness_fence_output_invalid");
    }
    const fullSql = buildOrdinaryAccountCutoverReadinessFenceSql(
      String(normalized.maximumHoldSeconds),
    );
    const downgradeBoundary =
      "\n\nROLLBACK TO SAVEPOINT endpoint_probe_locks;";
    const holdBoundary = "\n\nSELECT pg_catalog.pg_sleep(";
    const downgradeIndex = fullSql.indexOf(downgradeBoundary);
    const holdIndex = fullSql.indexOf(holdBoundary);
    if (
      downgradeIndex <= 0 ||
      holdIndex <= downgradeIndex
    ) {
      fail("readiness_fence_sql_source_invalid");
    }
    if (nonemptyLineCount === 1) {
      const parsed = parseFenceOutputLine(line);
      backendPid = parsed.backendPid;
      validateLiveReport(parsed.report, attestation);
      const endpointEvidence = validateEndpointEvidence(
        await operationDeadline(
          probeEndpoints({
            containerId: normalized.expectedContainerId,
            databaseName: attestation.database.dbName,
            databaseOid: attestation.database.dbOid,
            fenceBackendPid: parsed.backendPid,
          }),
          ENDPOINT_PROBE_TOTAL_TIMEOUT_MS,
          "readiness_fence_probe_timeout",
          () => releaseWaitAbort.abort(),
        ),
      );
      if (
        endpointEvidence.some(
          (entry) =>
            entry.databaseOid !== attestation.database.dbOid ||
            entry.blockingPids[0] !== parsed.backendPid,
        )
      ) {
        fail("readiness_fence_probe_evidence_invalid");
      }
      if (terminalCode !== null) fail(terminalCode);
      pendingEndpointEvidence = endpointEvidence;
      child.stdin.write(
        fullSql.slice(downgradeIndex + 2, holdIndex + 2),
      );
      return;
    }
    if (backendPid === null || pendingEndpointEvidence === null) {
      fail("readiness_fence_hold_output_invalid");
    }
    const holdProof = parseFenceHoldOutputLine(line, backendPid);
    if (terminalCode !== null) fail(terminalCode);
    await assertReleaseRequestPathAbsent(normalized.releaseRequestPath);
    const markerClockMs = dependencies.clockMs?.() ?? Date.now();
    if (
      Date.parse(attestation.validUntil) - markerClockMs <
      (normalized.maximumHoldSeconds + MINIMUM_ROLLBACK_MARGIN_SECONDS) * 1000
    ) {
      fail("readiness_fence_marker_ttl_insufficient");
    }
    const startedAt = new Date(markerClockMs).toISOString();
    const bytes = markerBytes(
      attestation,
      validation,
      backendPid,
      startedAt,
      applicationName,
      releaseToken,
      normalized.releaseRequestPath,
      pendingEndpointEvidence,
      holdProof.holdLocks,
    );
    markerIdentity = await markerWriter(normalized.markerPath, bytes);
    markerResult = {
      backendPid,
      markerSha256: sha256Hex(bytes),
      markerSizeBytes: String(bytes.length),
    };
    child.stdin.end(fullSql.slice(holdIndex + 2));
    cancelTimer(timeoutTimer);
    timeoutTimer = scheduleTimer(
      () => stop("readiness_fence_timeout"),
      (normalized.maximumHoldSeconds + WATCHDOG_MARGIN_SECONDS) * 1000,
    );
    const releaseRequest = await operationDeadline(
      waitForReleaseRequest({
        markerSha256: markerResult.markerSha256,
        releaseToken,
      }),
      (normalized.maximumHoldSeconds + WATCHDOG_MARGIN_SECONDS + 5) * 1000,
      "readiness_fence_release_wait_timeout",
      () => releaseWaitAbort.abort(),
    );
    releaseRequestIdentity = releaseRequest?.identity ?? null;
    if (terminalCode !== null) fail(terminalCode);
    stop(null, { authorized: true });
  };
  const queueLine = (line) => {
    lineQueue = lineQueue
      .then(() => processLine(line))
      .catch((error) =>
        stop(fenceErrorCode(error, "readiness_fence_output_invalid")),
      );
  };
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_OUTPUT_BYTES) {
      stop("readiness_fence_output_too_large");
      return;
    }
    try {
      stdoutBuffer += stdoutDecoder.decode(chunk, { stream: true });
    } catch {
      stop("readiness_fence_output_invalid");
      return;
    }
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      queueLine(line);
    }
  });
  child.stdout.on("end", () => {
    try {
      stdoutBuffer += stdoutDecoder.decode();
    } catch {
      stop("readiness_fence_output_invalid");
      return;
    }
    if (stdoutBuffer !== "") queueLine(stdoutBuffer.replace(/\r$/, ""));
    stdoutBuffer = "";
  });
  child.stderr?.on("data", (chunk) => {
    if (childStderrOverflow) return;
    const bytes = Buffer.from(chunk);
    if (childStderr.length + bytes.length > MAX_CHILD_STDERR_BYTES) {
      childStderr = Buffer.alloc(0);
      childStderrOverflow = true;
      return;
    }
    childStderr = Buffer.concat([childStderr, bytes]);
  });
  child.stderr?.once("end", () => {
    childStderrComplete = true;
  });

  const interrupt = () => stop("readiness_fence_interrupted");
  signalSource.on("SIGTERM", interrupt);
  signalSource.on("SIGINT", interrupt);
  signalSource.on("SIGHUP", interrupt);

  try {
    const fullSql = buildOrdinaryAccountCutoverReadinessFenceSql(
      String(normalized.maximumHoldSeconds),
    );
    const downgradeBoundary =
      "\n\nROLLBACK TO SAVEPOINT endpoint_probe_locks;";
    const downgradeIndex = fullSql.indexOf(downgradeBoundary);
    if (downgradeIndex <= 0) fail("readiness_fence_sql_source_invalid");
    child.stdin.write(fullSql.slice(0, downgradeIndex + 2));
    const childResult = await Promise.race([completion, childExitFallback]);
    await operationDeadline(
      lineQueue,
      ENDPOINT_PROBE_TOTAL_TIMEOUT_MS + EXTERNAL_OPERATION_TIMEOUT_MS,
      "readiness_fence_line_processing_timeout",
      () => releaseWaitAbort.abort(),
    );
    if (terminationPromise) await terminationPromise;
    if (terminalCode === null) {
      if (!authorizedRelease) {
        terminalCode =
          childResult.error || childResult.code !== 0
            ? "readiness_fence_child_failed"
            : "readiness_fence_ended_before_release";
      } else if (!markerIdentity || !markerResult) {
        terminalCode = "readiness_fence_output_missing";
      }
    }
    if (terminalCode !== null) {
      fail(
        terminalCode,
        childFailureDiagnostic(
          childResult,
          childStderr,
          childStderrOverflow,
          childStderrComplete,
        ),
      );
    }
    return markerResult;
  } finally {
    cancelTimer(timeoutTimer);
    if (forceTimer !== null) cancelTimer(forceTimer);
    if (childExitTimer !== null) cancelTimer(childExitTimer);
    signalSource.removeListener("SIGTERM", interrupt);
    signalSource.removeListener("SIGINT", interrupt);
    signalSource.removeListener("SIGHUP", interrupt);
    let cleanupError = null;
    if (releaseRequestIdentity !== null) {
      try {
        await removeBoundReleaseRequest(
          normalized.releaseRequestPath,
          releaseRequestIdentity,
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    if (markerIdentity !== null) {
      try {
        await removeReadinessFenceMarker(
          normalized.markerPath,
          markerIdentity,
        );
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
  }
}

function parseCliArguments(argv) {
  if (argv[0] !== "hold") fail("readiness_fence_cli_command_invalid");
  const flags = [
    "--attestation",
    "--expected-target-sha",
    "--expected-run-id",
    "--expected-run-attempt",
    "--expected-artifact-id",
    "--expected-artifact-digest",
    "--expected-attestation-sha256",
    "--expected-container-id",
    "--minimum-remaining-ttl-seconds",
    "--ready-marker",
    "--release-request",
    "--maximum-hold-seconds",
  ];
  const allowed = new Set(flags);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || values.has(flag)) {
      fail("readiness_fence_cli_argument_invalid");
    }
    values.set(flag, value);
  }
  if (flags.some((flag) => !values.has(flag))) {
    fail("readiness_fence_cli_argument_missing");
  }
  return {
    attestationPath: values.get("--attestation"),
    expectedTargetSha: values.get("--expected-target-sha"),
    expectedRunId: values.get("--expected-run-id"),
    expectedRunAttempt: values.get("--expected-run-attempt"),
    expectedArtifactId: values.get("--expected-artifact-id"),
    expectedArtifactDigest: values.get("--expected-artifact-digest"),
    expectedAttestationSha256: values.get("--expected-attestation-sha256"),
    expectedContainerId: values.get("--expected-container-id"),
    minimumRemainingTtlSeconds: values.get("--minimum-remaining-ttl-seconds"),
    markerPath: values.get("--ready-marker"),
    releaseRequestPath: values.get("--release-request"),
    maximumHoldSeconds: values.get("--maximum-hold-seconds"),
  };
}

export async function runOrdinaryAccountCutoverReadinessFenceCli(
  argv,
  dependencies = {},
) {
  const result = await holdOrdinaryAccountCutoverReadinessFence(
    parseCliArguments(argv),
    dependencies,
  );
  const write = dependencies.write ?? ((bytes) => process.stdout.write(bytes));
  write(canonicalJsonBytes({ ok: true, ...result }));
  return 0;
}

async function main() {
  try {
    await runOrdinaryAccountCutoverReadinessFenceCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      ordinaryAccountCutoverReadinessFenceFailureLogBytes(error),
    );
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) {
  await main();
}
