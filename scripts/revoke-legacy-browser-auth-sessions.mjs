import path from "node:path";
import { pathToFileURL } from "node:url";

import { inspectSelfHostedSupabaseTopology } from "./check-database-backup-readiness.mjs";
import {
  acquireProductionMigrationLock,
  runMigrationCommand,
} from "./apply-production-database-migrations.mjs";

export const LEGACY_BROWSER_AUTH_SESSION_CUTOFF = "2026-08-20T03:01:52Z";
export const LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION =
  "REVOKE_LEGACY_BROWSER_AUTH_SESSIONS";

const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/;
const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const OPERATION_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(20260731, 1);";

const PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose " +
    "--quiet --tuples-only --no-align",
].join("\n");

const AUTH_SCHEMA_GUARD_SQL = `
DO $guard$
BEGIN
  IF to_regclass('auth.sessions') IS NULL OR
     to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION 'legacy_browser_auth_session_schema_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.sessions'::regclass
      AND attname = 'id'
      AND attnum > 0
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.sessions'::regclass
      AND attname = 'created_at'
      AND attnum > 0
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.refresh_tokens'::regclass
      AND attname = 'session_id'
      AND attnum > 0
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.refresh_tokens'::regclass
      AND attname = 'created_at'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'legacy_browser_auth_session_schema_invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.sessions WHERE created_at IS NULL) OR
     EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE created_at IS NULL) THEN
    RAISE EXCEPTION 'legacy_browser_auth_session_timestamp_invalid';
  END IF;
END
$guard$;
`;

const CANDIDATE_QUERY_SQL = `
${AUTH_SCHEMA_GUARD_SQL}
SELECT pg_catalog.json_build_object(
  'sessionCount', (
    SELECT count(*)
    FROM auth.sessions AS session_row
    WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
  ),
  'refreshTokenCount', (
    SELECT count(*)
    FROM auth.refresh_tokens AS refresh_row
    WHERE refresh_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
       OR refresh_row.session_id IN (
         SELECT session_row.id
         FROM auth.sessions AS session_row
         WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
       )
  )
)::text;
`;

const APPLY_SQL = `
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
${OPERATION_ADVISORY_LOCK_SQL}
LOCK TABLE auth.sessions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE auth.refresh_tokens IN SHARE ROW EXCLUSIVE MODE;
${AUTH_SCHEMA_GUARD_SQL}

DELETE FROM auth.refresh_tokens AS refresh_row
WHERE refresh_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
   OR refresh_row.session_id IN (
     SELECT session_row.id
     FROM auth.sessions AS session_row
     WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
   );

DELETE FROM auth.sessions AS session_row
WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}';

DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.sessions AS session_row
    WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
  ) OR EXISTS (
    SELECT 1
    FROM auth.refresh_tokens AS refresh_row
    WHERE refresh_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
       OR refresh_row.session_id IN (
         SELECT session_row.id
         FROM auth.sessions AS session_row
         WHERE session_row.created_at < timestamptz '${LEGACY_BROWSER_AUTH_SESSION_CUTOFF}'
       )
  ) THEN
    RAISE EXCEPTION 'legacy_browser_auth_session_revocation_incomplete';
  END IF;
END
$postcondition$;
COMMIT;
`;

export class LegacyBrowserAuthSessionRevocationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "LegacyBrowserAuthSessionRevocationError";
    this.code = code;
    this.details = details;
  }
}

function operationError(code, details = {}) {
  return new LegacyBrowserAuthSessionRevocationError(code, details);
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseLegacyBrowserAuthSessionArguments(argv = []) {
  let apply = false;
  let explicitDryRun = false;
  let json = false;
  let confirmation = "";
  const seen = new Set();

  for (let index = 0; index < argv.length; ) {
    const entry = argv[index];
    if (entry === "--apply") {
      if (seen.has("apply")) throw operationError("session_revocation_apply_duplicate");
      apply = true;
      seen.add("apply");
      index += 1;
      continue;
    }
    if (entry === "--dry-run") {
      if (seen.has("dry-run")) throw operationError("session_revocation_dry_run_duplicate");
      explicitDryRun = true;
      seen.add("dry-run");
      index += 1;
      continue;
    }
    if (entry === "--json") {
      if (seen.has("json")) throw operationError("session_revocation_json_duplicate");
      json = true;
      seen.add("json");
      index += 1;
      continue;
    }
    if (entry === "--confirmation" || entry.startsWith("--confirmation=")) {
      if (seen.has("confirmation")) {
        throw operationError("session_revocation_confirmation_duplicate");
      }
      if (entry === "--confirmation") {
        confirmation = trimText(argv[index + 1]);
        if (!confirmation || confirmation.startsWith("--")) {
          throw operationError("session_revocation_confirmation_missing");
        }
        index += 2;
      } else {
        confirmation = trimText(entry.slice("--confirmation=".length));
        if (!confirmation) throw operationError("session_revocation_confirmation_missing");
        index += 1;
      }
      seen.add("confirmation");
      continue;
    }
    throw operationError("session_revocation_argument_unknown", {
      argument: String(entry).slice(0, 80),
    });
  }

  if (apply && explicitDryRun) {
    throw operationError("session_revocation_apply_and_dry_run_conflict");
  }
  if (apply && confirmation !== LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION) {
    throw operationError("session_revocation_confirmation_invalid");
  }

  return {
    apply,
    dryRun: !apply,
    explicitDryRun,
    json,
    confirmation,
  };
}

function selectDatabaseContainer(topology, configuredName) {
  if (!topology?.available || !Array.isArray(topology.databaseCandidates)) {
    throw operationError("session_revocation_topology_unavailable");
  }
  const candidates = topology.databaseCandidates.filter(
    (candidate) =>
      candidate?.probeSucceeded === true &&
      candidate?.tools?.psql === true &&
      candidate?.tools?.databaseConfigured === true,
  );
  const requestedName = trimText(configuredName);
  let selected;
  if (requestedName) {
    if (!CONTAINER_NAME_PATTERN.test(requestedName)) {
      throw operationError("session_revocation_container_name_invalid");
    }
    selected = candidates.find((candidate) => candidate.name === requestedName);
    if (!selected) throw operationError("session_revocation_container_unavailable");
  } else {
    if (candidates.length !== 1) {
      throw operationError(
        candidates.length === 0
          ? "session_revocation_container_unavailable"
          : "session_revocation_container_ambiguous",
      );
    }
    [selected] = candidates;
  }
  if (!CONTAINER_NAME_PATTERN.test(trimText(selected.name))) {
    throw operationError("session_revocation_container_name_invalid");
  }
  return selected;
}

function dockerPsqlArguments(containerName) {
  return ["exec", "-i", containerName, "sh", "-lc", PSQL_CONTAINER_SCRIPT];
}

function parseCandidateReport(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) throw operationError("session_revocation_output_invalid");
  let parsed;
  try {
    parsed = JSON.parse(lines[0]);
  } catch {
    throw operationError("session_revocation_output_invalid");
  }
  const sessionCount = Number(parsed?.sessionCount);
  const refreshTokenCount = Number(parsed?.refreshTokenCount);
  if (
    !Number.isSafeInteger(sessionCount) ||
    sessionCount < 0 ||
    !Number.isSafeInteger(refreshTokenCount) ||
    refreshTokenCount < 0
  ) {
    throw operationError("session_revocation_output_invalid");
  }
  return { sessionCount, refreshTokenCount };
}

async function runPsql(input) {
  let result;
  try {
    result = await input.runCommand(
      "docker",
      dockerPsqlArguments(input.containerName),
      {
        input: input.sql,
        timeoutMs: input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      },
    );
  } catch {
    throw operationError(input.errorCode, { reason: "command_runner_threw" });
  }
  if (!result || result.status !== 0 || result.timedOut) {
    throw operationError(input.errorCode, {
      status: Number.isInteger(result?.status) ? result.status : null,
      timedOut: Boolean(result?.timedOut),
    });
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

async function queryCandidates(input) {
  return parseCandidateReport(
    await runPsql({
      ...input,
      sql: CANDIDATE_QUERY_SQL,
      errorCode: "session_revocation_candidate_query_failed",
    }),
  );
}

export async function revokeLegacyBrowserAuthSessions(input = {}) {
  const apply = input.apply === true;
  if (apply && input.dryRun === true) {
    throw operationError("session_revocation_apply_and_dry_run_conflict");
  }
  if (apply && input.confirmation !== LEGACY_BROWSER_AUTH_SESSION_CONFIRMATION) {
    throw operationError("session_revocation_confirmation_invalid");
  }

  const environment = input.env ?? process.env;
  const topology =
    input.selfHostedTopology ??
    (input.inspectTopology ?? inspectSelfHostedSupabaseTopology)();
  const container = selectDatabaseContainer(
    topology,
    input.containerName ?? environment.FAOLLA_DATABASE_CONTAINER,
  );
  const runCommand = input.runCommand ?? runMigrationCommand;
  const acquireLock = input.acquireLock ?? acquireProductionMigrationLock;
  const lock = await acquireLock(input.lockPath);

  try {
    const candidates = await queryCandidates({
      containerName: container.name,
      runCommand,
      timeoutMs: input.commandTimeoutMs,
    });
    const baseReport = {
      schemaVersion: 1,
      mode: apply ? "apply" : "dry_run",
      cutoff: LEGACY_BROWSER_AUTH_SESSION_CUTOFF,
      databaseContainer: container.name,
      candidates,
      remaining: candidates,
      executed: false,
    };
    if (!apply) return { ...baseReport, status: "dry_run" };
    if (candidates.sessionCount === 0 && candidates.refreshTokenCount === 0) {
      return { ...baseReport, status: "up_to_date" };
    }

    await runPsql({
      containerName: container.name,
      runCommand,
      timeoutMs: input.commandTimeoutMs,
      sql: APPLY_SQL,
      errorCode: "session_revocation_apply_failed",
    });
    const remaining = await queryCandidates({
      containerName: container.name,
      runCommand,
      timeoutMs: input.commandTimeoutMs,
    });
    if (remaining.sessionCount !== 0 || remaining.refreshTokenCount !== 0) {
      throw operationError("session_revocation_postcondition_failed");
    }
    return {
      ...baseReport,
      status: "revoked",
      remaining,
      executed: true,
    };
  } finally {
    await lock.release();
  }
}

function printTextReport(report, write) {
  write(
    `[legacy-browser-auth-sessions] ${report.status.toUpperCase()} ` +
      `mode=${report.mode} cutoff=${report.cutoff}\n`,
  );
  write(
    `[legacy-browser-auth-sessions] candidates.sessions=${report.candidates.sessionCount} ` +
      `candidates.refreshTokens=${report.candidates.refreshTokenCount} ` +
      `remaining.sessions=${report.remaining.sessionCount} ` +
      `remaining.refreshTokens=${report.remaining.refreshTokenCount}\n`,
  );
}

export async function runLegacyBrowserAuthSessionRevocationCli(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const writeStdout = input.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = input.writeStderr ?? ((value) => process.stderr.write(value));
  const wantsJson = argv.includes("--json");
  try {
    const options = parseLegacyBrowserAuthSessionArguments(argv);
    const execute = input.execute ?? revokeLegacyBrowserAuthSessions;
    const report = await execute({
      apply: options.apply,
      dryRun: options.dryRun,
      confirmation: options.confirmation,
    });
    if (options.json) writeStdout(`${JSON.stringify({ ok: true, ...report })}\n`);
    else printTextReport(report, writeStdout);
    return 0;
  } catch (error) {
    const code =
      error instanceof LegacyBrowserAuthSessionRevocationError
        ? error.code
        : "legacy_browser_auth_session_revocation_failed";
    if (wantsJson) writeStderr(`${JSON.stringify({ ok: false, error: code })}\n`);
    else writeStderr(`[legacy-browser-auth-sessions] ERROR ${code}\n`);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  process.exitCode = await runLegacyBrowserAuthSessionRevocationCli();
}
