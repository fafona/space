import { randomBytes } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES,
  ProductionReleaseAttestationError,
  readProductionReleaseAttestationFile,
  sha256Hex,
} from "./production-release-attestation.mjs";
import { parseOrdinaryAccountCutoverDatabaseReport } from "./check-ordinary-account-cutover-readiness.mjs";
import { ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY } from "./ordinary-account-identity-content-contract.mjs";

const CHECKER_TOP_LEVEL_KEYS = Object.freeze([
  "ok",
  "schemaVersion",
  "mode",
  "databaseContainer",
  "databaseIdentity",
  "databaseActorReady",
  "databaseIdentityReady",
  "baselineReady",
  "runtimeRpcHardeningReady",
  "migrationsReady",
  "functionMetadataReady",
  "functionAclReady",
  "registryAclReady",
  "objectContractsReady",
  "readiness",
  "status",
]);
const CHECKER_DATABASE_REPORT_KEYS = Object.freeze([
  "databaseActorReady",
  "databaseIdentityReady",
  "baselineReady",
  "runtimeRpcHardeningReady",
  "migrationsReady",
  "functionMetadataReady",
  "functionAclReady",
  "registryAclReady",
  "objectContractsReady",
]);
const ARTIFACT_KEYS = Object.freeze([
  "id",
  "name",
  "digest",
  "sizeBytes",
  "createdAt",
  "expiresAt",
  "expired",
  "workflowRunId",
  "workflowRunAttempt",
  "headSha",
  "file",
]);
const ARTIFACT_FILE_KEYS = Object.freeze(["name", "sizeBytes", "sha256"]);
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class DatabaseReadinessAttestationError extends ProductionReleaseAttestationError {
  constructor(code) {
    super(code);
    this.name = "DatabaseReadinessAttestationError";
  }
}

function fail(code) {
  throw new DatabaseReadinessAttestationError(code);
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

function canonicalTimestampMs(value, code) {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    fail(code);
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    fail(code);
  }
  return timestamp;
}

async function readBoundedFile(filePath, code) {
  let details;
  let bytes;
  try {
    details = await stat(filePath);
    if (
      !details.isFile() ||
      details.size <= 0 ||
      details.size > PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES
    ) {
      fail(code);
    }
    bytes = await readFile(filePath);
  } catch (error) {
    if (error instanceof ProductionReleaseAttestationError) throw error;
    fail(code);
  }
  return bytes;
}

function parseUtf8Json(bytes, code) {
  let text;
  let value;
  try {
    text = UTF8_DECODER.decode(bytes);
    value = JSON.parse(text);
  } catch {
    fail(code);
  }
  return { text, value };
}

async function readCanonicalJsonFile(filePath, code) {
  const bytes = await readBoundedFile(filePath, `${code}_file_invalid`);
  const { value } = parseUtf8Json(bytes, `${code}_json_invalid`);
  let canonical;
  try {
    canonical = canonicalJsonBytes(value);
  } catch {
    fail(`${code}_json_invalid`);
  }
  if (!bytes.equals(canonical)) fail(`${code}_json_not_canonical`);
  return { value, bytes };
}

async function readExactCheckerReport(filePath) {
  const bytes = await readBoundedFile(
    filePath,
    "readiness_checker_file_invalid",
  );
  const { text, value } = parseUtf8Json(
    bytes,
    "readiness_checker_json_invalid",
  );
  if (`${JSON.stringify(value)}\n` !== text) {
    fail("readiness_checker_json_not_exact");
  }
  const source = exactRecord(
    value,
    CHECKER_TOP_LEVEL_KEYS,
    "readiness_checker_keys_invalid",
  );
  if (
    source.ok !== true ||
    source.schemaVersion !== 1 ||
    source.mode !== "read_only" ||
    source.status !== "ready" ||
    typeof source.databaseContainer !== "string" ||
    source.databaseContainer.length === 0
  ) {
    fail("readiness_checker_not_ready");
  }
  const databaseReport = Object.fromEntries([
    ...CHECKER_DATABASE_REPORT_KEYS.map((key) => [key, source[key]]),
    ["databaseIdentity", source.databaseIdentity],
    ["readiness", source.readiness],
  ]);
  let parsed;
  try {
    parsed = parseOrdinaryAccountCutoverDatabaseReport(
      `${JSON.stringify(databaseReport)}\n`,
    );
  } catch {
    fail("readiness_checker_report_invalid");
  }
  if (
    parsed.status !== "ready" ||
    CHECKER_DATABASE_REPORT_KEYS.some((key) => parsed[key] !== true)
  ) {
    fail("readiness_checker_not_ready");
  }
  return { value: source, parsed, bytes };
}

function computedFile(filePath, bytes) {
  return {
    name: path.basename(filePath),
    sizeBytes: String(bytes.length),
    sha256: sha256Hex(bytes),
  };
}

function validateArtifactFileBinding(artifact, expectedFile, code) {
  const source = exactRecord(artifact, ARTIFACT_KEYS, `${code}_invalid`);
  const file = exactRecord(
    source.file,
    ARTIFACT_FILE_KEYS,
    `${code}_file_invalid`,
  );
  if (
    file.name !== expectedFile.name ||
    file.sizeBytes !== expectedFile.sizeBytes ||
    file.sha256 !== expectedFile.sha256
  ) {
    fail(`${code}_file_mismatch`);
  }
  return source;
}

function readinessBaseline(readiness) {
  return {
    merchantRecordCount: String(readiness.merchantRecordCount),
    merchantAuthoritativeBindingCount: String(
      readiness.merchantAuthoritativeBindingCount,
    ),
    merchantInvalidBindingCount: String(readiness.merchantInvalidBindingCount),
    personalCanonicalBindingCount: String(
      readiness.personalCanonicalBindingCount,
    ),
    personalCanonicalOrphanCount: String(
      readiness.personalCanonicalOrphanCount,
    ),
    personalInvalidCanonicalCount: String(
      readiness.personalInvalidCanonicalCount,
    ),
    personalDuplicateAuthUserCount: String(
      readiness.personalDuplicateAuthUserCount,
    ),
    personalDuplicateAccountIdCount: String(
      readiness.personalDuplicateAccountIdCount,
    ),
    crossAccountTypeOverlapCount: String(
      readiness.crossAccountTypeOverlapCount,
    ),
    accountIdentifierCollisionCount: String(
      readiness.accountIdentifierCollisionCount,
    ),
    staffRegistryOverlapCount: String(readiness.staffRegistryOverlapCount),
    systemSitePrincipalOverlapCount: String(
      readiness.systemSitePrincipalOverlapCount,
    ),
    [ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY]:
      readiness[ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY],
  };
}

function normalizedNowMs(options) {
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("readiness_attestation_now_invalid");
  }
  return nowMs;
}

export async function createDatabaseReadinessAttestation(input, options = {}) {
  const nowMs = normalizedNowMs(options);
  const issuedAtMs = canonicalTimestampMs(
    input.issuedAt,
    "readiness_attestation_issued_at_invalid",
  );
  canonicalTimestampMs(
    input.validUntil,
    "readiness_attestation_valid_until_invalid",
  );
  if (
    typeof input.containerId !== "string" ||
    !CONTAINER_ID_PATTERN.test(input.containerId)
  ) {
    fail("readiness_attestation_container_id_invalid");
  }

  const backupRead = await readProductionReleaseAttestationFile(
    input.backupAttestationPath,
    { nowMs, expectedKind: "backup" },
  );
  if (backupRead.attestation.run.event !== "workflow_dispatch") {
    fail("readiness_backup_event_invalid");
  }
  const backupArtifactRead = await readCanonicalJsonFile(
    input.backupAttestationArtifactPath,
    "backup_attestation_artifact_metadata",
  );
  const checkerRead = await readExactCheckerReport(input.checkerReportPath);
  const readinessArtifactRead = await readCanonicalJsonFile(
    input.readinessArtifactPath,
    "readiness_artifact_metadata",
  );
  const runRead = await readCanonicalJsonFile(
    input.runPath,
    "readiness_run_metadata",
  );
  const remoteSourceRead = await readCanonicalJsonFile(
    input.remoteSourcePath,
    "readiness_remote_source_metadata",
  );

  const backupAttestationFile = computedFile(
    input.backupAttestationPath,
    backupRead.canonicalBytes,
  );
  const checkerFile = computedFile(input.checkerReportPath, checkerRead.bytes);
  const backupAttestationArtifact = validateArtifactFileBinding(
    backupArtifactRead.value,
    backupAttestationFile,
    "backup_attestation_artifact",
  );
  const readinessArtifact = validateArtifactFileBinding(
    readinessArtifactRead.value,
    checkerFile,
    "readiness_artifact",
  );

  const checkerAsOfMs = Date.parse(checkerRead.parsed.readiness.asOf);
  if (!Number.isFinite(checkerAsOfMs) || checkerAsOfMs > issuedAtMs) {
    fail("readiness_checker_as_of_invalid");
  }

  const candidate = {
    schemaVersion: 1,
    kind: PRODUCTION_READINESS_ATTESTATION_KIND,
    repository: backupRead.attestation.repository,
    targetSha: backupRead.attestation.targetSha,
    run: runRead.value,
    remoteSource: remoteSourceRead.value,
    database: {
      containerName: checkerRead.value.databaseContainer,
      containerId: input.containerId,
      ...checkerRead.parsed.databaseIdentity,
    },
    baseline: readinessBaseline(checkerRead.parsed.readiness),
    readinessArtifact,
    backup: {
      attestation: backupRead.attestation,
      attestationArtifact: backupAttestationArtifact,
    },
    issuedAt: input.issuedAt,
    validUntil: input.validUntil,
  };

  let attestation;
  try {
    attestation = parseProductionReleaseAttestation(candidate, {
      nowMs,
      expectedKind: "readiness",
      expectedRepository: backupRead.attestation.repository,
      expectedTargetSha: backupRead.attestation.targetSha,
      expectedDatabase: backupRead.attestation.database,
      expectedBaseline: candidate.baseline,
    });
  } catch (error) {
    if (error instanceof ProductionReleaseAttestationError) throw error;
    fail("readiness_attestation_invalid");
  }
  const canonicalBytes = canonicalJsonBytes(attestation);
  return {
    attestation,
    canonicalBytes,
    sizeBytes: String(canonicalBytes.length),
    sha256: sha256Hex(canonicalBytes),
  };
}

async function writeAtomic(filePath, bytes) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    if (error instanceof ProductionReleaseAttestationError) throw error;
    fail("readiness_attestation_output_write_failed");
  }
}

function parseCliArguments(argv) {
  if (argv[0] !== "create") fail("readiness_attestation_cli_command_invalid");
  const allowed = new Set([
    "--backup-attestation",
    "--backup-attestation-artifact",
    "--checker-report",
    "--readiness-artifact",
    "--run",
    "--remote-source",
    "--container-id",
    "--issued-at",
    "--valid-until",
    "--output",
    "--now",
  ]);
  const required = [...allowed].filter((key) => key !== "--now");
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || values.has(key)) {
      fail("readiness_attestation_cli_argument_invalid");
    }
    values.set(key, value);
  }
  if (required.some((key) => !values.has(key))) {
    fail("readiness_attestation_cli_argument_missing");
  }
  let nowMs;
  if (values.has("--now")) {
    nowMs = canonicalTimestampMs(
      values.get("--now"),
      "readiness_attestation_cli_now_invalid",
    );
  }
  const pathEntries = [
    ["backupAttestationPath", "--backup-attestation"],
    ["backupAttestationArtifactPath", "--backup-attestation-artifact"],
    ["checkerReportPath", "--checker-report"],
    ["readinessArtifactPath", "--readiness-artifact"],
    ["runPath", "--run"],
    ["remoteSourcePath", "--remote-source"],
    ["outputPath", "--output"],
  ].map(([name, key]) => [name, path.resolve(values.get(key))]);
  const resolvedPaths = pathEntries.map(([, value]) => value);
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    fail("readiness_attestation_cli_path_reused");
  }
  return {
    input: {
      ...Object.fromEntries(pathEntries),
      containerId: values.get("--container-id"),
      issuedAt: values.get("--issued-at"),
      validUntil: values.get("--valid-until"),
    },
    nowMs,
  };
}

export async function runDatabaseReadinessAttestationCli(argv, io = {}) {
  const write = io.write ?? ((value) => process.stdout.write(value));
  const { input, nowMs } = parseCliArguments(argv);
  const result = await createDatabaseReadinessAttestation(input, { nowMs });
  await writeAtomic(input.outputPath, result.canonicalBytes);
  write(
    canonicalJsonBytes({
      ok: true,
      outputFile: path.basename(input.outputPath),
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
    }),
  );
  return 0;
}

async function main() {
  try {
    await runDatabaseReadinessAttestationCli(process.argv.slice(2));
  } catch (error) {
    const code =
      error instanceof ProductionReleaseAttestationError
        ? error.code
        : "readiness_attestation_unexpected_error";
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
