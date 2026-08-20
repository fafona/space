import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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
const PID_PATTERN = /^[1-9][0-9]{0,9}$/;
const MAX_PID = 2_147_483_647n;
const MAX_HOLD_SECONDS = 120;
const MAX_TTL_SECONDS = 2 * 60 * 60;
const MAX_OUTPUT_BYTES = 256 * 1024;
const FENCE_KIND = "faolla.ordinary-account-cutover-readiness-fence.v1";
const ROLLBACK_SUFFIX = "\n\nROLLBACK;";
const REPORT_SUFFIX = ")::text;";

const PSQL_CONTAINER_SCRIPT = [
  "set -eu",
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
  "export PGOPTIONS='-c lock_timeout=15s -c statement_timeout=120s'",
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
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=terse " +
    '--set=fence_application_name="$FAOLLA_FENCE_APPLICATION_NAME" ' +
    "--quiet --tuples-only --no-align",
].join("\n");

const TERMINATE_FENCE_SQL = String.raw`SELECT pg_catalog.pg_terminate_backend(activity.pid)
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.application_name = :'fence_application_name'::text
  AND activity.pid <> pg_catalog.pg_backend_pid();`;

export class OrdinaryAccountCutoverReadinessFenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "OrdinaryAccountCutoverReadinessFenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new OrdinaryAccountCutoverReadinessFenceError(code);
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
    String.raw`SELECT '{"backendPid":"'
  || pg_catalog.pg_backend_pid()::text
  || '","report":'
  || :'fence_report'::text
  || '}' AS fence_result;`,
    `SELECT pg_catalog.pg_sleep(GREATEST(0::double precision, ${seconds}::double precision - EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp()))));`,
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
    fail("readiness_fence_child_spawn_failed");
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

export async function terminateOrdinaryAccountCutoverReadinessFenceSession(
  input,
) {
  const child = spawnDocker(
    input.spawnProcess ?? spawn,
    dockerExecArguments(
      input.containerId,
      { FAOLLA_FENCE_APPLICATION_NAME: input.applicationName },
      TERMINATE_PSQL_CONTAINER_SCRIPT,
    ),
  );
  child.stderr?.resume();
  const completion = childCompletion(child);
  child.stdin.end(TERMINATE_FENCE_SQL);
  const result = await completion;
  if (result.error || result.code !== 0) {
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

async function removeReadinessFenceMarker(markerPath, identity) {
  let current;
  try {
    current = await lstat(markerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
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

function markerBytes(attestation, validation, backendPid, startedAt) {
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
    backendPid,
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
      "expectedContainerId",
      "minimumRemainingTtlSeconds",
      "markerPath",
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
  if (minimumRemainingTtlSeconds < maximumHoldSeconds) {
    fail("readiness_fence_ttl_below_hold");
  }
  if (
    typeof source.expectedContainerId !== "string" ||
    !CONTAINER_ID_PATTERN.test(source.expectedContainerId)
  ) {
    fail("readiness_fence_container_id_invalid");
  }
  const attestationPath = path.resolve(source.attestationPath);
  const markerPath = path.resolve(source.markerPath);
  if (attestationPath === markerPath) fail("readiness_fence_path_reused");
  return {
    ...source,
    attestationPath,
    markerPath,
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
  if (attestation.database.containerId !== normalized.expectedContainerId) {
    fail("readiness_fence_container_id_mismatch");
  }
  if (attestation.backup.attestation.run.event !== "workflow_dispatch") {
    fail("readiness_fence_backup_event_invalid");
  }

  const applicationName =
    `faolla_readiness_fence_${process.pid}_` +
    (dependencies.randomHex?.() ?? randomBytes(12).toString("hex"));
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
  const stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
  let nonemptyLineCount = 0;
  let terminalCode = null;
  let markerIdentity = null;
  let markerResult = null;
  let terminationPromise = null;
  let forceTimer = null;
  const scheduleTimer = dependencies.setTimer ?? setTimeout;
  const cancelTimer = dependencies.clearTimer ?? clearTimeout;
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

  const stop = (code) => {
    if (terminalCode === null) terminalCode = code;
    if (terminationPromise === null) {
      try {
        child.kill("SIGTERM");
      } catch {}
      terminationPromise = Promise.resolve(
        terminateSession({
          containerId: normalized.expectedContainerId,
          applicationName,
        }),
      ).catch(() => {
        if (terminalCode === null) {
          terminalCode = "readiness_fence_termination_failed";
        }
      });
      forceTimer = scheduleTimer(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 5_000);
    }
  };

  let lineQueue = Promise.resolve();
  const processLine = async (line) => {
    if (line.trim() === "") return;
    nonemptyLineCount += 1;
    if (nonemptyLineCount !== 1) {
      fail("readiness_fence_output_invalid");
    }
    const parsed = parseFenceOutputLine(line);
    validateLiveReport(parsed.report, attestation);
    const startedAt = new Date(
      dependencies.clockMs?.() ?? Date.now(),
    ).toISOString();
    const bytes = markerBytes(
      attestation,
      validation,
      parsed.backendPid,
      startedAt,
    );
    markerIdentity = await markerWriter(normalized.markerPath, bytes);
    markerResult = {
      backendPid: parsed.backendPid,
      markerSha256: sha256Hex(bytes),
      markerSizeBytes: String(bytes.length),
    };
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
  child.stderr?.resume();

  const interrupt = () => stop("readiness_fence_interrupted");
  signalSource.on("SIGTERM", interrupt);
  signalSource.on("SIGINT", interrupt);
  const timeoutTimer = scheduleTimer(
    () => stop("readiness_fence_timeout"),
    normalized.maximumHoldSeconds * 1000,
  );

  try {
    child.stdin.end(
      buildOrdinaryAccountCutoverReadinessFenceSql(
        String(normalized.maximumHoldSeconds),
      ),
    );
    const childResult = await completion;
    await lineQueue;
    if (terminationPromise) await terminationPromise;
    if (terminalCode === null) {
      if (childResult.error || childResult.code !== 0) {
        terminalCode = "readiness_fence_child_failed";
      } else if (!markerIdentity || !markerResult) {
        terminalCode = "readiness_fence_output_missing";
      }
    }
    if (terminalCode !== null) fail(terminalCode);
    return markerResult;
  } finally {
    cancelTimer(timeoutTimer);
    if (forceTimer !== null) cancelTimer(forceTimer);
    signalSource.removeListener("SIGTERM", interrupt);
    signalSource.removeListener("SIGINT", interrupt);
    if (markerIdentity !== null) {
      await removeReadinessFenceMarker(normalized.markerPath, markerIdentity);
    }
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
    "--expected-container-id",
    "--minimum-remaining-ttl-seconds",
    "--ready-marker",
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
    expectedContainerId: values.get("--expected-container-id"),
    minimumRemainingTtlSeconds: values.get("--minimum-remaining-ttl-seconds"),
    markerPath: values.get("--ready-marker"),
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
    const code = fenceErrorCode(error, "readiness_fence_unexpected_error");
    process.stderr.write(canonicalJsonBytes({ ok: false, error: code }));
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) {
  await main();
}
