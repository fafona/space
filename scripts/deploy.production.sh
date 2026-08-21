#!/usr/bin/env bash
set -euo pipefail

# Keep deployment sources, server output, runtime state, and secret-bearing
# files private. The immutable Next.js static subtree is opened explicitly
# after the build so the unprivileged reverse proxy can read only that content.
umask 077

DEPLOY_PAYLOAD_FILE="${FAOLLA_DEPLOY_PAYLOAD_FILE:-}"
DEPLOY_ATTESTATION_FILE=""
DEPLOY_RELEASE_BINDING_FILE=""
DEPLOY_PAYLOAD_KEYS=(
  APP_DIR
  APP_NAME
  APP_PORT
  APP_BRANCH
  EXPECTED_DEPLOY_SHA
  SUPABASE_INTERNAL_URL_B64
  NEXT_PUBLIC_SUPABASE_URL_B64
  NEXT_PUBLIC_SUPABASE_ANON_KEY_B64
  SUPABASE_SERVICE_ROLE_KEY_B64
  GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64
  GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64
  GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64
  GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64
  GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS
  MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED
  MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE
  MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED
  MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS
  MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS
  MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64
  MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64
  MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64
  MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64
  MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64
  ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED
  ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64
  ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64
  RESEND_API_KEY_B64
  WEB_PUSH_PUBLIC_KEY
  WEB_PUSH_PRIVATE_KEY
  WEB_PUSH_SUBJECT
  SUPER_ADMIN_ACCOUNT
  SUPER_ADMIN_PASSWORD
  SUPER_ADMIN_VERIFICATION_EMAIL
  SUPER_ADMIN_VERIFICATION_SECRET
)

load_deploy_payload() {
  local payload_key
  local payload_value
  local loaded_count=0
  if [ -z "$DEPLOY_PAYLOAD_FILE" ] \
    || [ ! -f "$DEPLOY_PAYLOAD_FILE" ] \
    || [ -L "$DEPLOY_PAYLOAD_FILE" ]; then
    echo "[deploy] a regular deployment payload file is required"
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[deploy] node is required to validate the deployment payload"
    exit 1
  fi
  DEPLOY_ATTESTATION_FILE="${DEPLOY_PAYLOAD_FILE}.readiness-attestation.json"
  DEPLOY_RELEASE_BINDING_FILE="${DEPLOY_PAYLOAD_FILE}.release-binding.json"
  if [ -e "$DEPLOY_ATTESTATION_FILE" ] \
    || [ -L "$DEPLOY_ATTESTATION_FILE" ] \
    || [ -e "$DEPLOY_RELEASE_BINDING_FILE" ] \
    || [ -L "$DEPLOY_RELEASE_BINDING_FILE" ]; then
    echo "[deploy] deployment evidence output path already exists"
    exit 1
  fi
  while IFS= read -r -d '' payload_key \
    && IFS= read -r -d '' payload_value; do
    case "$payload_key" in
      APP_DIR|APP_NAME|APP_PORT|APP_BRANCH|EXPECTED_DEPLOY_SHA|\
      SUPABASE_INTERNAL_URL_B64|NEXT_PUBLIC_SUPABASE_URL_B64|\
      NEXT_PUBLIC_SUPABASE_ANON_KEY_B64|SUPABASE_SERVICE_ROLE_KEY_B64|\
      GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64|\
      GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64|\
      GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64|\
      GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64|\
      GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS|\
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED|\
      MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE|\
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED|\
      MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS|\
      MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS|\
      MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64|\
      MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64|\
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64|\
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64|\
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64|\
      ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64|\
      RESEND_API_KEY_B64|WEB_PUSH_PUBLIC_KEY|WEB_PUSH_PRIVATE_KEY|\
      WEB_PUSH_SUBJECT|SUPER_ADMIN_ACCOUNT|SUPER_ADMIN_PASSWORD|\
      SUPER_ADMIN_VERIFICATION_EMAIL|SUPER_ADMIN_VERIFICATION_SECRET)
        printf -v "$payload_key" '%s' "$payload_value"
        loaded_count=$((loaded_count + 1))
        ;;
      RELEASE_REPOSITORY|RELEASE_TARGET_SHA|\
      RELEASE_READINESS_RUN_ID|RELEASE_READINESS_RUN_ATTEMPT|\
      RELEASE_READINESS_REPORT_ARTIFACT_ID|\
      RELEASE_READINESS_REPORT_ARTIFACT_DIGEST|\
      RELEASE_READINESS_ATTESTATION_ARTIFACT_ID|\
      RELEASE_READINESS_ATTESTATION_ARTIFACT_DIGEST|\
      RELEASE_BACKUP_RUN_ID|RELEASE_BACKUP_RUN_ATTEMPT|\
      RELEASE_BACKUP_ARTIFACT_ID|RELEASE_BACKUP_ARTIFACT_DIGEST|\
      RELEASE_BACKUP_ATTESTATION_ARTIFACT_ID|\
      RELEASE_BACKUP_ATTESTATION_ARTIFACT_DIGEST|\
      RELEASE_CANONICAL_SHA256|RELEASE_CANONICAL_SIZE_BYTES|\
      RELEASE_DATABASE_CONTAINER_NAME|RELEASE_DATABASE_CONTAINER_ID|\
      RELEASE_DATABASE_OID|\
      DEPLOY_ATTESTATION_DEVICE|DEPLOY_ATTESTATION_INODE|\
      DEPLOY_ATTESTATION_SIZE|DEPLOY_ATTESTATION_MTIME_NS|\
      DEPLOY_RELEASE_BINDING_DEVICE|DEPLOY_RELEASE_BINDING_INODE|\
      DEPLOY_RELEASE_BINDING_SIZE|DEPLOY_RELEASE_BINDING_MTIME_NS|\
      DEPLOY_RELEASE_BINDING_SHA256)
        # These values are emitted directly by the process that securely read
        # the one-shot outer payload. They are the trust root for every later
        # check; the generated sidecars are never allowed to self-pin.
        printf -v "$payload_key" '%s' "$payload_value"
        ;;
      *)
        echo "[deploy] deployment payload contains an unexpected key"
        exit 1
        ;;
    esac
  done < <(
    node --input-type=module - \
      "$DEPLOY_PAYLOAD_FILE" \
      "$DEPLOY_ATTESTATION_FILE" \
      "$DEPLOY_RELEASE_BINDING_FILE" <<'NODE'
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const expectedKeys = [
  "APP_DIR",
  "APP_NAME",
  "APP_PORT",
  "APP_BRANCH",
  "EXPECTED_DEPLOY_SHA",
  "SUPABASE_INTERNAL_URL_B64",
  "NEXT_PUBLIC_SUPABASE_URL_B64",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY_B64",
  "SUPABASE_SERVICE_ROLE_KEY_B64",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64",
  "GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64",
  "GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64",
  "GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS",
  "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED",
  "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE",
  "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED",
  "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS",
  "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS",
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64",
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64",
  "MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64",
  "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64",
  "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64",
  "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64",
  "RESEND_API_KEY_B64",
  "WEB_PUSH_PUBLIC_KEY",
  "WEB_PUSH_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
  "SUPER_ADMIN_ACCOUNT",
  "SUPER_ADMIN_PASSWORD",
  "SUPER_ADMIN_VERIFICATION_EMAIL",
  "SUPER_ADMIN_VERIFICATION_SECRET",
];
const fail = () => process.exit(1);
const isPlainRecord = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exactKeys = (value, keys) => {
  if (!isPlainRecord(value)) fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) fail();
};
const canonicalValue = (value) => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail();
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainRecord(value)) fail();
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
};
const canonicalBytes = (value) =>
  Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, "utf8");
const positiveDecimal = /^[1-9][0-9]*$/;
const sha256Digest = /^sha256:[0-9a-f]{64}$/;
const sha256 = /^[0-9a-f]{64}$/;
const targetSha = /^[0-9a-f]{40}$/;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const strictBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
let payload;
let payloadBytes;
let payloadDescriptor;
let payloadIdentity;
try {
  const before = lstatSync(process.argv[2], { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size <= 0n || before.size > 4n * 1024n * 1024n ||
    (process.platform !== "win32" && (before.mode & 0o777n) !== 0o600n)
  ) fail();
  payloadDescriptor = openSync(
    process.argv[2],
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const opened = fstatSync(payloadDescriptor, { bigint: true });
  if (
    !opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
    opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.nlink !== 1n
  ) fail();
  payloadBytes = readFileSync(payloadDescriptor);
  const after = fstatSync(payloadDescriptor, { bigint: true });
  const current = lstatSync(process.argv[2], { bigint: true });
  if (
    after.dev !== opened.dev || after.ino !== opened.ino ||
    after.size !== BigInt(payloadBytes.length) || after.mtimeNs !== opened.mtimeNs ||
    current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n ||
    current.dev !== opened.dev || current.ino !== opened.ino ||
    current.size !== after.size || current.mtimeNs !== after.mtimeNs
  ) fail();
  payloadIdentity = opened;
  payload = JSON.parse(payloadBytes.toString("utf8"));
} catch {
  fail();
} finally {
  if (payloadDescriptor !== undefined) closeSync(payloadDescriptor);
}
if (!payloadBytes.equals(canonicalBytes(payload))) fail();
exactKeys(payload, ["schemaVersion", "values", "releaseAttestation"]);
if (payload.schemaVersion !== 1) fail();
exactKeys(payload.values, expectedKeys);
const actualKeys = Object.keys(payload.values).sort();
const sortedExpected = [...expectedKeys].sort();
if (
  actualKeys.length !== sortedExpected.length ||
  actualKeys.some((key, index) => key !== sortedExpected[index])
) fail();
for (const key of expectedKeys) {
  const value = payload.values[key];
  if (typeof value !== "string" || value.includes("\0")) fail();
}
const releaseKeys = [
  "schemaVersion",
  "repository",
  "targetSha",
  "readinessRunId",
  "readinessRunAttempt",
  "readinessReportArtifactId",
  "readinessReportArtifactDigest",
  "readinessAttestationArtifactId",
  "readinessAttestationArtifactDigest",
  "backupRunId",
  "backupRunAttempt",
  "backupArtifactId",
  "backupArtifactDigest",
  "backupAttestationArtifactId",
  "backupAttestationArtifactDigest",
  "canonicalSha256",
  "canonicalBytesBase64",
];
const release = payload.releaseAttestation;
exactKeys(release, releaseKeys);
if (
  release.schemaVersion !== 1 ||
  typeof release.repository !== "string" ||
  !repository.test(release.repository) ||
  release.repository !== "fafona/space" ||
  typeof release.targetSha !== "string" ||
  !targetSha.test(release.targetSha) ||
  release.targetSha !== payload.values.EXPECTED_DEPLOY_SHA ||
  !positiveDecimal.test(release.readinessRunId) ||
  !positiveDecimal.test(release.readinessRunAttempt) ||
  !positiveDecimal.test(release.readinessReportArtifactId) ||
  !sha256Digest.test(release.readinessReportArtifactDigest) ||
  !positiveDecimal.test(release.readinessAttestationArtifactId) ||
  !sha256Digest.test(release.readinessAttestationArtifactDigest) ||
  !positiveDecimal.test(release.backupRunId) ||
  !positiveDecimal.test(release.backupRunAttempt) ||
  !positiveDecimal.test(release.backupArtifactId) ||
  !sha256Digest.test(release.backupArtifactDigest) ||
  !positiveDecimal.test(release.backupAttestationArtifactId) ||
  !sha256Digest.test(release.backupAttestationArtifactDigest) ||
  typeof release.canonicalSha256 !== "string" ||
  !sha256.test(release.canonicalSha256) ||
  typeof release.canonicalBytesBase64 !== "string" ||
  release.canonicalBytesBase64.length === 0 ||
  !strictBase64.test(release.canonicalBytesBase64)
) fail();
const attestationBytes = Buffer.from(release.canonicalBytesBase64, "base64");
if (
  attestationBytes.length === 0 ||
  attestationBytes.length > 1024 * 1024 ||
  attestationBytes.toString("base64") !== release.canonicalBytesBase64 ||
  createHash("sha256").update(attestationBytes).digest("hex") !==
    release.canonicalSha256
) fail();
let attestation;
try {
  attestation = JSON.parse(attestationBytes.toString("utf8"));
} catch {
  fail();
}
if (!attestationBytes.equals(canonicalBytes(attestation))) fail();
if (
  attestation?.repository !== release.repository ||
  attestation?.targetSha !== release.targetSha ||
  attestation?.run?.id !== release.readinessRunId ||
  attestation?.run?.attempt !== release.readinessRunAttempt ||
  attestation?.run?.event !== "workflow_dispatch" ||
  attestation?.readinessArtifact?.id !== release.readinessReportArtifactId ||
  attestation?.readinessArtifact?.digest !==
    release.readinessReportArtifactDigest ||
  attestation?.backup?.attestation?.run?.id !== release.backupRunId ||
  attestation?.backup?.attestation?.run?.attempt !== release.backupRunAttempt ||
  attestation?.backup?.attestation?.backupArtifact?.id !==
    release.backupArtifactId ||
  attestation?.backup?.attestation?.backupArtifact?.digest !==
    release.backupArtifactDigest ||
  attestation?.backup?.attestationArtifact?.id !==
    release.backupAttestationArtifactId ||
  attestation?.backup?.attestationArtifact?.digest !==
    release.backupAttestationArtifactDigest ||
  typeof attestation?.database?.containerName !== "string" ||
  attestation.database.containerName.length === 0 ||
  !/^[0-9a-f]{64}$/.test(attestation?.database?.containerId ?? "") ||
  !positiveDecimal.test(attestation?.database?.dbOid ?? "")
) fail();
const binding = {
  schemaVersion: 1,
  ...Object.fromEntries(
    releaseKeys
      .filter((key) => key !== "schemaVersion" && key !== "canonicalBytesBase64")
      .map((key) => [key, release[key]]),
  ),
  canonicalSizeBytes: String(attestationBytes.length),
  databaseContainerName: attestation.database.containerName,
  databaseContainerId: attestation.database.containerId,
  databaseOid: attestation.database.dbOid,
};
const bindingBytes = canonicalBytes(binding);
let attestationFileIdentity;
let bindingFileIdentity;
try {
  const currentPayload = lstatSync(process.argv[2], { bigint: true });
  if (
    currentPayload.isSymbolicLink() || !currentPayload.isFile() ||
    currentPayload.dev !== payloadIdentity.dev || currentPayload.ino !== payloadIdentity.ino ||
    currentPayload.size !== payloadIdentity.size || currentPayload.mtimeNs !== payloadIdentity.mtimeNs ||
    currentPayload.nlink !== 1n
  ) fail();
  writeFileSync(process.argv[3], attestationBytes, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(process.argv[4], bindingBytes, {
    flag: "wx",
    mode: 0o600,
  });
  attestationFileIdentity = lstatSync(process.argv[3], { bigint: true });
  bindingFileIdentity = lstatSync(process.argv[4], { bigint: true });
  for (const identity of [attestationFileIdentity, bindingFileIdentity]) {
    if (
      identity.isSymbolicLink() || !identity.isFile() || identity.nlink !== 1n ||
      (process.platform !== "win32" && (identity.mode & 0o777n) !== 0o600n)
    ) fail();
  }
  unlinkSync(process.argv[2]);
} catch {
  try { unlinkSync(process.argv[3]); } catch {}
  try { unlinkSync(process.argv[4]); } catch {}
  fail();
}
for (const key of expectedKeys) {
  process.stdout.write(`${key}\0${payload.values[key]}\0`);
}
const trustedReleaseValues = [
  ["RELEASE_REPOSITORY", release.repository],
  ["RELEASE_TARGET_SHA", release.targetSha],
  ["RELEASE_READINESS_RUN_ID", release.readinessRunId],
  ["RELEASE_READINESS_RUN_ATTEMPT", release.readinessRunAttempt],
  ["RELEASE_READINESS_REPORT_ARTIFACT_ID", release.readinessReportArtifactId],
  ["RELEASE_READINESS_REPORT_ARTIFACT_DIGEST", release.readinessReportArtifactDigest],
  ["RELEASE_READINESS_ATTESTATION_ARTIFACT_ID", release.readinessAttestationArtifactId],
  ["RELEASE_READINESS_ATTESTATION_ARTIFACT_DIGEST", release.readinessAttestationArtifactDigest],
  ["RELEASE_BACKUP_RUN_ID", release.backupRunId],
  ["RELEASE_BACKUP_RUN_ATTEMPT", release.backupRunAttempt],
  ["RELEASE_BACKUP_ARTIFACT_ID", release.backupArtifactId],
  ["RELEASE_BACKUP_ARTIFACT_DIGEST", release.backupArtifactDigest],
  ["RELEASE_BACKUP_ATTESTATION_ARTIFACT_ID", release.backupAttestationArtifactId],
  ["RELEASE_BACKUP_ATTESTATION_ARTIFACT_DIGEST", release.backupAttestationArtifactDigest],
  ["RELEASE_CANONICAL_SHA256", release.canonicalSha256],
  ["RELEASE_CANONICAL_SIZE_BYTES", String(attestationBytes.length)],
  ["RELEASE_DATABASE_CONTAINER_NAME", attestation.database.containerName],
  ["RELEASE_DATABASE_CONTAINER_ID", attestation.database.containerId],
  ["RELEASE_DATABASE_OID", attestation.database.dbOid],
  ["DEPLOY_ATTESTATION_DEVICE", String(attestationFileIdentity.dev)],
  ["DEPLOY_ATTESTATION_INODE", String(attestationFileIdentity.ino)],
  ["DEPLOY_ATTESTATION_SIZE", String(attestationFileIdentity.size)],
  ["DEPLOY_ATTESTATION_MTIME_NS", String(attestationFileIdentity.mtimeNs)],
  ["DEPLOY_RELEASE_BINDING_DEVICE", String(bindingFileIdentity.dev)],
  ["DEPLOY_RELEASE_BINDING_INODE", String(bindingFileIdentity.ino)],
  ["DEPLOY_RELEASE_BINDING_SIZE", String(bindingFileIdentity.size)],
  ["DEPLOY_RELEASE_BINDING_MTIME_NS", String(bindingFileIdentity.mtimeNs)],
  ["DEPLOY_RELEASE_BINDING_SHA256", createHash("sha256").update(bindingBytes).digest("hex")],
];
for (const [key, value] of trustedReleaseValues) {
  process.stdout.write(`${key}\0${value}\0`);
}
NODE
  )
  rm -f -- "$DEPLOY_PAYLOAD_FILE"
  unset FAOLLA_DEPLOY_PAYLOAD_FILE DEPLOY_PAYLOAD_FILE payload_key payload_value
  if [ "$loaded_count" -ne "${#DEPLOY_PAYLOAD_KEYS[@]}" ]; then
    rm -f -- "$DEPLOY_ATTESTATION_FILE" "$DEPLOY_RELEASE_BINDING_FILE"
    echo "[deploy] deployment payload is incomplete"
    exit 1
  fi
}

load_deploy_payload
cleanup_initial_release_evidence() {
  rm -f -- "$DEPLOY_ATTESTATION_FILE" "$DEPLOY_RELEASE_BINDING_FILE"
}
trap cleanup_initial_release_evidence EXIT
APP_DIR="${APP_DIR:-/var/www/merchant-space}"
APP_NAME="${APP_NAME:-merchant-space}"
APP_PORT="${APP_PORT:-3000}"
APP_BRANCH="${APP_BRANCH:-main}"
EXPECTED_DEPLOY_SHA="${EXPECTED_DEPLOY_SHA:-}"
AUTOMATION_WORKER_NAME="${AUTOMATION_WORKER_NAME:-${APP_NAME}-enterprise-automation-worker}"
AUTOMATION_WORKER_KILL_TIMEOUT_MS="${AUTOMATION_WORKER_KILL_TIMEOUT_MS:-180000}"
MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="${MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:-false}"
MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE="${MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE:-legacy}"
MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="${MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:-false}"
MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS="${MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS:-3600}"
MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS="${MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS:-3900}"
ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED="${ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED:-false}"
RELEASES_DIR="${RELEASES_DIR:-${APP_DIR}.releases}"
CURRENT_LINK="${CURRENT_LINK:-${APP_DIR}.current}"
SHARED_DIR="${SHARED_DIR:-${APP_DIR}.shared}"
SHARED_RUNTIME_DIR="$SHARED_DIR/.runtime"
RELEASE_KEEP_COUNT="${RELEASE_KEEP_COUNT:-2}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"
RELEASE_SMOKE_ORIGIN="${RELEASE_SMOKE_ORIGIN:-http://127.0.0.1:${APP_PORT}}"
RELEASE_SMOKE_PATHS="${RELEASE_SMOKE_PATHS:-/,/login,/10909094}"
RELEASE_SMOKE_ATTEMPTS="${RELEASE_SMOKE_ATTEMPTS:-4}"
RELEASE_SMOKE_DELAY_MS="${RELEASE_SMOKE_DELAY_MS:-1000}"
RELEASE_SMOKE_TIMEOUT_MS="${RELEASE_SMOKE_TIMEOUT_MS:-12000}"
RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS="${RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS:-180}"
BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS="${BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS:-60}"
RELEASE_PROCESS_START_TIMEOUT_SECONDS="${RELEASE_PROCESS_START_TIMEOUT_SECONDS:-30}"
GIT_FETCH_ATTEMPTS="${GIT_FETCH_ATTEMPTS:-4}"
GIT_FETCH_DELAY_SECONDS="${GIT_FETCH_DELAY_SECONDS:-8}"
GIT_FETCH_LOW_SPEED_TIME_SECONDS="${GIT_FETCH_LOW_SPEED_TIME_SECONDS:-30}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-${APP_DIR}.deploy.lock}"
DEPLOY_LOCK_WAIT_SECONDS="${DEPLOY_LOCK_WAIT_SECONDS:-120}"
NPM_CI_TIMEOUT_SECONDS="${NPM_CI_TIMEOUT_SECONDS:-1800}"
NPM_CI_KILL_AFTER_SECONDS="${NPM_CI_KILL_AFTER_SECONDS:-30}"
NPM_CI_ATTEMPTS="${NPM_CI_ATTEMPTS:-3}"
NPM_CI_RETRY_DELAY_SECONDS="${NPM_CI_RETRY_DELAY_SECONDS:-15}"
NPM_FETCH_RETRIES="${NPM_FETCH_RETRIES:-5}"
NPM_FETCH_RETRY_MIN_TIMEOUT_MS="${NPM_FETCH_RETRY_MIN_TIMEOUT_MS:-10000}"
NPM_FETCH_RETRY_MAX_TIMEOUT_MS="${NPM_FETCH_RETRY_MAX_TIMEOUT_MS:-120000}"
BUILD_TIMEOUT_SECONDS="${BUILD_TIMEOUT_SECONDS:-1800}"
BUILD_KILL_AFTER_SECONDS="${BUILD_KILL_AFTER_SECONDS:-30}"
RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS="${RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS:-5700}"
READINESS_FENCE_MAXIMUM_HOLD_SECONDS="${READINESS_FENCE_MAXIMUM_HOLD_SECONDS:-900}"
READINESS_FENCE_MINIMUM_TTL_SECONDS="${READINESS_FENCE_MINIMUM_TTL_SECONDS:-1440}"
READINESS_FENCE_STARTUP_WAIT_SECONDS="${READINESS_FENCE_STARTUP_WAIT_SECONDS:-255}"
READINESS_FENCE_RELEASE_WAIT_SECONDS="${READINESS_FENCE_RELEASE_WAIT_SECONDS:-30}"
READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS="${READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS:-15}"
READINESS_FENCE_ROLLBACK_RESERVE_SECONDS="${READINESS_FENCE_ROLLBACK_RESERVE_SECONDS:-480}"
READINESS_FENCE_OPERATION_MARGIN_SECONDS="${READINESS_FENCE_OPERATION_MARGIN_SECONDS:-10}"
RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS="${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS:-60}"
WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS="${WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS:-40}"
PORT_RELEASE_TOTAL_TIMEOUT_SECONDS="${PORT_RELEASE_TOTAL_TIMEOUT_SECONDS:-60}"
NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS="${NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS:-180}"
NGINX_RUNTIME_USER="${NGINX_RUNTIME_USER:-www}"
EXPECTED_RELEASE_REPOSITORY="fafona/space"
STALE_BUILD_MINUTES="${STALE_BUILD_MINUTES:-45}"
DISK_WARNING_THRESHOLD="${DISK_WARNING_THRESHOLD:-75}"
DISK_CACHE_CLEANUP_THRESHOLD="${DISK_CACHE_CLEANUP_THRESHOLD:-80}"
DISK_ABORT_THRESHOLD="${DISK_ABORT_THRESHOLD:-90}"
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-5120}"

if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git is required on the server"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[deploy] npm is required on the server"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[deploy] pm2 is required on the server"
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "[deploy] tar is required on the server"
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "[deploy] flock is required on the server"
  exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "[deploy] timeout is required on the server"
  exit 1
fi

if ! command -v ss >/dev/null 2>&1; then
  echo "[deploy] ss is required to prove that a replaced web process is offline"
  exit 1
fi

if ! command -v runuser >/dev/null 2>&1; then
  echo "[deploy] runuser is required to prove reverse-proxy release access"
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  echo "[deploy] APP_DIR must already contain a git checkout: $APP_DIR"
  exit 1
fi

if [ "$APP_BRANCH" != "main" ]; then
  echo "[deploy] APP_BRANCH must be main"
  exit 1
fi

if ! [[ "$EXPECTED_DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[deploy] EXPECTED_DEPLOY_SHA must be an exact lowercase 40-hex commit"
  exit 1
fi

cd "$APP_DIR"

echo "[deploy] working directory: $APP_DIR"
echo "[deploy] branch: $APP_BRANCH"

validate_disk_thresholds() {
  local name
  local value
  for name in \
    DISK_WARNING_THRESHOLD \
    DISK_CACHE_CLEANUP_THRESHOLD \
    DISK_ABORT_THRESHOLD \
    MIN_FREE_DISK_MB \
    RELEASE_KEEP_COUNT \
    HEALTHCHECK_ATTEMPTS \
    RELEASE_SMOKE_ATTEMPTS \
    RELEASE_SMOKE_DELAY_MS \
    RELEASE_SMOKE_TIMEOUT_MS \
    RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS \
    BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS \
    RELEASE_PROCESS_START_TIMEOUT_SECONDS \
    GIT_FETCH_ATTEMPTS \
    GIT_FETCH_DELAY_SECONDS \
    GIT_FETCH_LOW_SPEED_TIME_SECONDS \
    DEPLOY_LOCK_WAIT_SECONDS \
    NPM_CI_TIMEOUT_SECONDS \
    NPM_CI_KILL_AFTER_SECONDS \
    NPM_CI_ATTEMPTS \
    NPM_CI_RETRY_DELAY_SECONDS \
    NPM_FETCH_RETRIES \
    NPM_FETCH_RETRY_MIN_TIMEOUT_MS \
    NPM_FETCH_RETRY_MAX_TIMEOUT_MS \
    BUILD_TIMEOUT_SECONDS \
    BUILD_KILL_AFTER_SECONDS \
    RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS \
    READINESS_FENCE_MAXIMUM_HOLD_SECONDS \
    READINESS_FENCE_MINIMUM_TTL_SECONDS \
    READINESS_FENCE_STARTUP_WAIT_SECONDS \
    READINESS_FENCE_RELEASE_WAIT_SECONDS \
    READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS \
    READINESS_FENCE_ROLLBACK_RESERVE_SECONDS \
    READINESS_FENCE_OPERATION_MARGIN_SECONDS \
    RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS \
    WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS \
    PORT_RELEASE_TOTAL_TIMEOUT_SECONDS \
    NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS \
    STALE_BUILD_MINUTES \
    AUTOMATION_WORKER_KILL_TIMEOUT_MS; do
    value="${!name}"
    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
      echo "[deploy] $name must be a non-negative integer: $value"
      exit 1
    fi
  done
  if [ "$DISK_WARNING_THRESHOLD" -gt 100 ] \
    || [ "$DISK_CACHE_CLEANUP_THRESHOLD" -gt 100 ] \
    || [ "$DISK_ABORT_THRESHOLD" -gt 100 ] \
    || [ "$DISK_WARNING_THRESHOLD" -ge "$DISK_CACHE_CLEANUP_THRESHOLD" ] \
    || [ "$DISK_CACHE_CLEANUP_THRESHOLD" -ge "$DISK_ABORT_THRESHOLD" ]; then
    echo "[deploy] disk thresholds must be ordered warning < cleanup < abort <= 100"
    exit 1
  fi
  if [ "$RELEASE_KEEP_COUNT" -lt 2 ]; then
    echo "[deploy] RELEASE_KEEP_COUNT must be at least 2"
    exit 1
  fi
  if [ "$HEALTHCHECK_ATTEMPTS" -lt 1 ] || [ "$HEALTHCHECK_ATTEMPTS" -gt 30 ]; then
    echo "[deploy] HEALTHCHECK_ATTEMPTS must stay within the protected health budget"
    exit 1
  fi
  if [ "$RELEASE_SMOKE_ATTEMPTS" -lt 1 ]; then
    echo "[deploy] RELEASE_SMOKE_ATTEMPTS must be at least 1"
    exit 1
  fi
  if [ "$RELEASE_SMOKE_TIMEOUT_MS" -lt 250 ]; then
    echo "[deploy] RELEASE_SMOKE_TIMEOUT_MS must be at least 250"
    exit 1
  fi
  if [ "$GIT_FETCH_ATTEMPTS" -lt 1 ] || [ "$GIT_FETCH_LOW_SPEED_TIME_SECONDS" -lt 1 ]; then
    echo "[deploy] Git fetch attempts and low-speed timeout must be at least 1"
    exit 1
  fi
  if [ "$DEPLOY_LOCK_WAIT_SECONDS" -lt 1 ] \
    || [ "$NPM_CI_TIMEOUT_SECONDS" -lt 60 ] \
    || [ "$NPM_CI_KILL_AFTER_SECONDS" -lt 1 ] \
    || [ "$NPM_CI_ATTEMPTS" -lt 1 ] \
    || [ "$NPM_FETCH_RETRIES" -lt 1 ] \
    || [ "$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" -lt 1 ] \
    || [ "$NPM_FETCH_RETRY_MAX_TIMEOUT_MS" -lt "$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" ] \
    || [ "$BUILD_TIMEOUT_SECONDS" -lt 60 ] \
    || [ "$BUILD_KILL_AFTER_SECONDS" -lt 1 ] \
    || [ "$STALE_BUILD_MINUTES" -lt 1 ]; then
    echo "[deploy] deploy lock, install/build timeouts, and stale-build limits are invalid"
    exit 1
  fi
  if [ "$AUTOMATION_WORKER_KILL_TIMEOUT_MS" -lt 10000 ]; then
    echo "[deploy] AUTOMATION_WORKER_KILL_TIMEOUT_MS must be at least 10000"
    exit 1
  fi
  if [ "$AUTOMATION_WORKER_KILL_TIMEOUT_MS" -gt 180000 ]; then
    echo "[deploy] AUTOMATION_WORKER_KILL_TIMEOUT_MS must not exceed the protected stop budget"
    exit 1
  fi
  if [ "$READINESS_FENCE_MAXIMUM_HOLD_SECONDS" -ne 900 ] \
    || [ "$READINESS_FENCE_MINIMUM_TTL_SECONDS" -lt $((240 + READINESS_FENCE_MAXIMUM_HOLD_SECONDS + 300)) ] \
    || [ "$READINESS_FENCE_STARTUP_WAIT_SECONDS" -lt 245 ] \
    || [ "$READINESS_FENCE_STARTUP_WAIT_SECONDS" -gt 300 ] \
    || [ "$READINESS_FENCE_RELEASE_WAIT_SECONDS" -lt 15 ] \
    || [ "$READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS" -ne 15 ] \
    || [ "$READINESS_FENCE_ROLLBACK_RESERVE_SECONDS" -ne 480 ] \
    || [ "$READINESS_FENCE_OPERATION_MARGIN_SECONDS" -ne 10 ] \
    || [ "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" -ne 60 ] \
    || [ "$WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS" -ne 40 ] \
    || [ "$PORT_RELEASE_TOTAL_TIMEOUT_SECONDS" -ne 60 ] \
    || [ "$NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS" -ne 180 ] \
    || [ "$RELEASE_PROCESS_START_TIMEOUT_SECONDS" -ne 30 ] \
    || [ "$RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS" -lt 60 ] \
    || [ "$RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS" -gt 180 ] \
    || [ "$BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS" -lt 30 ] \
    || [ "$BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS" -gt 60 ] \
    || [ $((WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS + PORT_RELEASE_TOTAL_TIMEOUT_SECONDS + RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS + RELEASE_PROCESS_START_TIMEOUT_SECONDS + HEALTHCHECK_ATTEMPTS * 5 + 6 * READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS + READINESS_FENCE_RELEASE_WAIT_SECONDS + 20)) -gt "$READINESS_FENCE_ROLLBACK_RESERVE_SECONDS" ] \
    || [ "$RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS" -lt $((NPM_CI_TIMEOUT_SECONDS + BUILD_TIMEOUT_SECONDS + READINESS_FENCE_MINIMUM_TTL_SECONDS + 600)) ]; then
    echo "[deploy] release evidence TTL does not cover install, build, fence, and rollback budgets"
    exit 1
  fi
  if [ "$NGINX_RUNTIME_USER" != "www" ]; then
    echo "[deploy] NGINX_RUNTIME_USER must match the production nginx worker identity"
    exit 1
  fi
  case "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED must be true or false"
      exit 1
      ;;
  esac
  case "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" in
    legacy|outbox) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE must be legacy or outbox"
      exit 1
      ;;
  esac
  case "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED must be true or false"
      exit 1
      ;;
  esac
  case "$ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" in
    true|false) ;;
    *)
      echo "[deploy] ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED must be true or false"
      exit 1
      ;;
  esac
  if [ "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" = "outbox" ] \
    && [ "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" != "true" ]; then
    echo "[deploy] outbox invitation delivery requires the invitation worker"
    exit 1
  fi
  if ! [[ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" =~ ^[0-9]{2,5}$ ]] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" -lt 60 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" -gt 86100 ]; then
    echo "[deploy] MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS is invalid"
    exit 1
  fi
  if ! [[ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" =~ ^[0-9]{2,5}$ ]] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -lt 60 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -gt 86400 ] \
    || [ "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -lt $((MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS + 300)) ]; then
    echo "[deploy] invitation issuance lease must cover the Auth link TTL plus 300 seconds"
    exit 1
  fi
}

acquire_deploy_lock() {
  if [ -L "$DEPLOY_LOCK_FILE" ]; then
    echo "[deploy] refusing to use a symlink as the deploy lock: $DEPLOY_LOCK_FILE"
    exit 1
  fi
  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -w "$DEPLOY_LOCK_WAIT_SECONDS" 9; then
    echo "[deploy] another deployment still owns the lock: $DEPLOY_LOCK_FILE"
    exit 1
  fi
  echo "[deploy] acquired exclusive deployment lock"
}

disk_usage_percent() {
  df -P "$APP_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

disk_available_mb() {
  df -Pk "$APP_DIR" | awk 'NR == 2 { print int($4 / 1024) }'
}

report_disk_status() {
  local disk_usage
  local disk_available
  disk_usage="$(disk_usage_percent)"
  disk_available="$(disk_available_mb)"
  echo "[deploy] disk usage: ${disk_usage}% (${disk_available} MB available)"
  if [ "$disk_usage" -ge "$DISK_WARNING_THRESHOLD" ]; then
    echo "[deploy] warning: disk usage has reached the ${DISK_WARNING_THRESHOLD}% warning threshold"
  fi
}

cleanup_cache_dir() {
  local expected_path="$1"
  local resolved_path
  if [ ! -d "$expected_path" ]; then
    return 0
  fi
  resolved_path="$(readlink -f "$expected_path" 2>/dev/null || true)"
  if [ -z "$resolved_path" ] || [ "$resolved_path" != "$expected_path" ]; then
    echo "[deploy] warning: refusing to clean unexpected cache path: $expected_path -> ${resolved_path:-missing}"
    return 0
  fi
  find "$resolved_path" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

cleanup_rebuildable_caches() {
  local home_dir="${HOME:-/root}"
  local disk_usage
  cleanup_cache_dir "$home_dir/.cache/ffmpeg-static-nodejs"
  disk_usage="$(disk_usage_percent)"
  if [ -n "$disk_usage" ] && [ "$disk_usage" -ge "$DISK_CACHE_CLEANUP_THRESHOLD" ]; then
    echo "[deploy] disk usage is ${disk_usage}%; clearing the rebuildable npm cache"
    cleanup_cache_dir "$home_dir/.npm/_cacache"
  fi
}

ensure_disk_headroom() {
  local disk_usage
  local disk_available
  disk_usage="$(disk_usage_percent)"
  disk_available="$(disk_available_mb)"
  if [ "$disk_usage" -ge "$DISK_ABORT_THRESHOLD" ]; then
    echo "[deploy] refusing to deploy at ${disk_usage}% disk usage; limit is ${DISK_ABORT_THRESHOLD}%"
    exit 1
  fi
  if [ "$disk_available" -lt "$MIN_FREE_DISK_MB" ]; then
    echo "[deploy] refusing to deploy with ${disk_available} MB free; minimum is ${MIN_FREE_DISK_MB} MB"
    exit 1
  fi
}

fetch_deploy_branch() {
  local attempt
  for attempt in $(seq 1 "$GIT_FETCH_ATTEMPTS"); do
    if git \
      -c http.lowSpeedLimit=1024 \
      -c "http.lowSpeedTime=$GIT_FETCH_LOW_SPEED_TIME_SECONDS" \
      fetch origin "$APP_BRANCH" --prune; then
      return 0
    fi
    if [ "$attempt" = "$GIT_FETCH_ATTEMPTS" ]; then
      echo "[deploy] Git fetch failed after $GIT_FETCH_ATTEMPTS attempts"
      return 1
    fi
    echo "[deploy] Git fetch attempt $attempt failed; retrying in ${GIT_FETCH_DELAY_SECONDS}s"
    sleep "$GIT_FETCH_DELAY_SECONDS"
  done
}

validate_release_attestation_preflight() {
  if [ ! -f "$DEPLOY_ATTESTATION_FILE" ] \
    || [ -L "$DEPLOY_ATTESTATION_FILE" ] \
    || [ ! -f "$DEPLOY_RELEASE_BINDING_FILE" ] \
    || [ -L "$DEPLOY_RELEASE_BINDING_FILE" ]; then
    echo "[deploy] canonical release evidence is missing"
    exit 1
  fi
  if [ "$(stat -c '%a' "$DEPLOY_ATTESTATION_FILE")" != "600" ] \
    || [ "$(stat -c '%a' "$DEPLOY_RELEASE_BINDING_FILE")" != "600" ]; then
    echo "[deploy] canonical release evidence permissions are invalid"
    exit 1
  fi
  if [ "$RELEASE_TARGET_SHA" != "$EXPECTED_DEPLOY_SHA" ] \
    || [ "$RELEASE_REPOSITORY" != "$EXPECTED_RELEASE_REPOSITORY" ]; then
    echo "[deploy] canonical release evidence trust root is invalid"
    exit 1
  fi
  if ! node --input-type=module - \
    "$DEPLOY_ATTESTATION_FILE" \
    "$DEPLOY_RELEASE_BINDING_FILE" \
    "$APP_DIR/scripts/production-release-attestation.mjs" \
    "$EXPECTED_RELEASE_REPOSITORY" "$EXPECTED_DEPLOY_SHA" \
    "$RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS" \
    "$RELEASE_READINESS_RUN_ID" "$RELEASE_READINESS_RUN_ATTEMPT" \
    "$RELEASE_READINESS_REPORT_ARTIFACT_ID" \
    "$RELEASE_READINESS_REPORT_ARTIFACT_DIGEST" \
    "$RELEASE_READINESS_ATTESTATION_ARTIFACT_ID" \
    "$RELEASE_READINESS_ATTESTATION_ARTIFACT_DIGEST" \
    "$RELEASE_BACKUP_RUN_ID" "$RELEASE_BACKUP_RUN_ATTEMPT" \
    "$RELEASE_BACKUP_ARTIFACT_ID" "$RELEASE_BACKUP_ARTIFACT_DIGEST" \
    "$RELEASE_BACKUP_ATTESTATION_ARTIFACT_ID" \
    "$RELEASE_BACKUP_ATTESTATION_ARTIFACT_DIGEST" \
    "$RELEASE_CANONICAL_SHA256" "$RELEASE_CANONICAL_SIZE_BYTES" \
    "$RELEASE_DATABASE_CONTAINER_NAME" "$RELEASE_DATABASE_CONTAINER_ID" \
    "$RELEASE_DATABASE_OID" \
    "$DEPLOY_ATTESTATION_DEVICE" "$DEPLOY_ATTESTATION_INODE" \
    "$DEPLOY_ATTESTATION_SIZE" "$DEPLOY_ATTESTATION_MTIME_NS" \
    "$DEPLOY_RELEASE_BINDING_DEVICE" "$DEPLOY_RELEASE_BINDING_INODE" \
    "$DEPLOY_RELEASE_BINDING_SIZE" "$DEPLOY_RELEASE_BINDING_MTIME_NS" \
    "$DEPLOY_RELEASE_BINDING_SHA256" <<'NODE'
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";

const values = process.argv.slice(2);
if (values.length !== 32) process.exit(1);
const [
  attestationPath, bindingPath, validatorPath, expectedRepository,
  expectedTargetSha, minimumRemainingSeconds, readinessRunId,
  readinessRunAttempt, readinessReportArtifactId,
  readinessReportArtifactDigest, readinessAttestationArtifactId,
  readinessAttestationArtifactDigest, backupRunId, backupRunAttempt,
  backupArtifactId, backupArtifactDigest, backupAttestationArtifactId,
  backupAttestationArtifactDigest, canonicalSha256, canonicalSizeBytes,
  databaseContainerName, databaseContainerId, databaseOid,
  attestationDevice, attestationInode, attestationSize,
  attestationMtimeNs, bindingDevice, bindingInode, bindingSize,
  bindingMtimeNs, bindingSha256,
] = values;
const fail = () => process.exit(1);
const canonical = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) fail();
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readFrozenFile = (path, identity, expectedSha256) => {
  let descriptor;
  try {
    const before = lstatSync(path, { bigint: true });
    if (
      before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
      (process.platform !== "win32" && (before.mode & 0o777n) !== 0o600n) ||
      String(before.dev) !== identity.device || String(before.ino) !== identity.inode ||
      String(before.size) !== identity.size || String(before.mtimeNs) !== identity.mtimeNs
    ) fail();
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size || opened.mtimeNs !== before.mtimeNs ||
      opened.nlink !== 1n
    ) fail();
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== BigInt(bytes.length) || after.mtimeNs !== opened.mtimeNs ||
      current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n ||
      current.dev !== opened.dev || current.ino !== opened.ino ||
      current.size !== after.size || current.mtimeNs !== after.mtimeNs ||
      digest(bytes) !== expectedSha256
    ) fail();
    return { descriptor, bytes, identity: opened };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    fail();
  }
};
const finalIdentityMatches = ({ identity }, path) => {
  const current = lstatSync(path, { bigint: true });
  return !current.isSymbolicLink() && current.isFile() && current.nlink === 1n &&
    current.dev === identity.dev && current.ino === identity.ino &&
    current.size === identity.size && current.mtimeNs === identity.mtimeNs;
};

const attestation = readFrozenFile(attestationPath, {
  device: attestationDevice, inode: attestationInode,
  size: attestationSize, mtimeNs: attestationMtimeNs,
}, canonicalSha256);
const binding = readFrozenFile(bindingPath, {
  device: bindingDevice, inode: bindingInode,
  size: bindingSize, mtimeNs: bindingMtimeNs,
}, bindingSha256);
try {
  if (String(attestation.bytes.length) !== canonicalSizeBytes) fail();
  const expectedBinding = {
    schemaVersion: 1,
    repository: expectedRepository,
    targetSha: expectedTargetSha,
    readinessRunId,
    readinessRunAttempt,
    readinessReportArtifactId,
    readinessReportArtifactDigest,
    readinessAttestationArtifactId,
    readinessAttestationArtifactDigest,
    backupRunId,
    backupRunAttempt,
    backupArtifactId,
    backupArtifactDigest,
    backupAttestationArtifactId,
    backupAttestationArtifactDigest,
    canonicalSha256,
    canonicalSizeBytes,
    databaseContainerName,
    databaseContainerId,
    databaseOid,
  };
  if (!binding.bytes.equals(canonicalBytes(expectedBinding))) fail();
  const childInput = process.platform === "linux"
    ? "/proc/self/fd/3"
    : attestationPath;
  const child = spawnSync(process.execPath, [
    validatorPath, "validate", "--input", childInput, "--kind", "readiness",
    "--expected-repository", expectedRepository,
    "--expected-target-sha", expectedTargetSha,
    "--expected-run-id", readinessRunId,
    "--expected-run-attempt", readinessRunAttempt,
    "--expected-readiness-run-id", readinessRunId,
    "--expected-artifact-id", readinessReportArtifactId,
    "--expected-artifact-digest", readinessReportArtifactDigest,
    "--expected-readiness-artifact-id", readinessReportArtifactId,
    "--expected-readiness-artifact-digest", readinessReportArtifactDigest,
    "--expected-backup-run-id", backupRunId,
    "--expected-backup-artifact-id", backupArtifactId,
    "--expected-backup-artifact-digest", backupArtifactDigest,
    "--expected-backup-attestation-artifact-id", backupAttestationArtifactId,
    "--expected-backup-attestation-artifact-digest", backupAttestationArtifactDigest,
    "--minimum-remaining-seconds", minimumRemainingSeconds,
  ], {
    stdio: ["ignore", "pipe", "pipe", attestation.descriptor],
    timeout: 60_000,
    killSignal: "SIGKILL",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (child.status !== 0 || child.signal !== null) fail();
  let summary;
  try { summary = JSON.parse(child.stdout.toString("utf8")); } catch { fail(); }
  if (
    summary.valid !== true || summary.repository !== expectedRepository ||
    summary.targetSha !== expectedTargetSha || summary.runId !== readinessRunId ||
    summary.runAttempt !== readinessRunAttempt || summary.readinessRunId !== readinessRunId ||
    summary.artifactId !== readinessReportArtifactId ||
    summary.artifactDigest !== readinessReportArtifactDigest ||
    summary.readinessArtifactId !== readinessReportArtifactId ||
    summary.readinessArtifactDigest !== readinessReportArtifactDigest ||
    summary.backupRunId !== backupRunId || summary.backupRunAttempt !== backupRunAttempt ||
    summary.backupArtifactId !== backupArtifactId ||
    summary.backupArtifactDigest !== backupArtifactDigest ||
    summary.backupAttestationArtifactId !== backupAttestationArtifactId ||
    summary.backupAttestationArtifactDigest !== backupAttestationArtifactDigest ||
    summary.canonicalSha256 !== canonicalSha256 ||
    !finalIdentityMatches(attestation, attestationPath) ||
    !finalIdentityMatches(binding, bindingPath)
  ) fail();
} finally {
  closeSync(attestation.descriptor);
  closeSync(binding.descriptor);
}
NODE
  then
    echo "[deploy] canonical release evidence preflight failed"
    exit 1
  fi
}

validate_disk_thresholds
AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS=$((
  (AUTOMATION_WORKER_KILL_TIMEOUT_MS + 999) / 1000 + 25
))
acquire_deploy_lock
fetch_deploy_branch
REMOTE_DEPLOY_SHA="$(git rev-parse "origin/$APP_BRANCH")"
if [ "$REMOTE_DEPLOY_SHA" != "$EXPECTED_DEPLOY_SHA" ]; then
  echo "[deploy] origin/$APP_BRANCH no longer matches EXPECTED_DEPLOY_SHA"
  exit 1
fi
git checkout "$APP_BRANCH"
git reset --hard "$EXPECTED_DEPLOY_SHA"
if [ "$(git rev-parse HEAD)" != "$EXPECTED_DEPLOY_SHA" ]; then
  echo "[deploy] checked out revision does not match EXPECTED_DEPLOY_SHA"
  exit 1
fi
validate_release_attestation_preflight

# Capture rollback identity before any persistent environment or cache mutation.
# In the legacy layout APP_DIR itself is the live runtime, so reading this after
# write_env_value would substitute the new build ID into the rollback proof.
PREVIOUS_LINK_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
if [ -n "$PREVIOUS_LINK_TARGET" ] && [ -d "$PREVIOUS_LINK_TARGET/.next" ]; then
  PREVIOUS_RUNTIME_DIR="$PREVIOUS_LINK_TARGET"
elif [ -d "$APP_DIR/.next" ]; then
  PREVIOUS_RUNTIME_DIR="$APP_DIR"
else
  PREVIOUS_RUNTIME_DIR=""
fi
PREVIOUS_RUNTIME_PARENT="$(readlink -f "$(dirname "$PREVIOUS_RUNTIME_DIR")" 2>/dev/null || true)"
PREVIOUS_RELEASE_NAME="$(basename -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)"
PREVIOUS_BUILD_PREFIX=""
PREVIOUS_WEB_PID="$(timeout --signal=TERM --kill-after=1s 2s \
  pm2 pid "$APP_NAME" 2>/dev/null | tail -n 1 | tr -d '[:space:]' || true)"
PREVIOUS_RUNTIME_IDENTITY=""
PREVIOUS_WEB_CWD_IDENTITY=""
PREVIOUS_WEB_PROCESS_IDENTITY=""
if [[ "$PREVIOUS_WEB_PID" =~ ^[1-9][0-9]*$ ]]; then
  PREVIOUS_RUNTIME_IDENTITY="$(stat -Lc '%d:%i:%Z' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)"
  PREVIOUS_WEB_CWD_IDENTITY="$(stat -Lc '%d:%i:%Z' -- "/proc/$PREVIOUS_WEB_PID/cwd" 2>/dev/null || true)"
  PREVIOUS_WEB_PROCESS_IDENTITY="$(stat -Lc '%d:%i' -- "/proc/$PREVIOUS_WEB_PID" 2>/dev/null || true)"
fi
if [[ "$PREVIOUS_RELEASE_NAME" =~ ^([0-9a-f]{12})-[0-9]{14}$ ]]; then
  PREVIOUS_BUILD_PREFIX="${BASH_REMATCH[1]}"
fi
if [ -z "$PREVIOUS_LINK_TARGET" ] \
  || [ "$PREVIOUS_RUNTIME_DIR" = "$APP_DIR" ] \
  || [ "$PREVIOUS_RUNTIME_PARENT" != "$(readlink -f "$RELEASES_DIR" 2>/dev/null || true)" ] \
  || [ -z "$PREVIOUS_BUILD_PREFIX" ] \
  || ! [[ "$PREVIOUS_RUNTIME_IDENTITY" =~ ^[0-9]+:[0-9]+:[0-9]+$ ]] \
  || [ "$PREVIOUS_WEB_CWD_IDENTITY" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
  || ! [[ "$PREVIOUS_WEB_PROCESS_IDENTITY" =~ ^[0-9]+:[0-9]+$ ]] \
  || [ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_DIR" ]; then
  echo "[deploy] an exact previous atomic release is required before environment mutation"
  exit 1
fi
if ! PREVIOUS_BUILD_ID="$(
  timeout --signal=TERM --kill-after=1s 5s \
    node scripts/read-production-supabase-environment.mjs build-id \
      "$PREVIOUS_RUNTIME_DIR/.env.local" "$PREVIOUS_BUILD_PREFIX" 2>/dev/null
)" \
  || ! [[ "$PREVIOUS_BUILD_ID" =~ ^[0-9a-f]{40}$ ]] \
  || [ "${PREVIOUS_BUILD_ID:0:12}" != "$PREVIOUS_BUILD_PREFIX" ] \
  || [ "$(stat -Lc '%d:%i:%Z' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
  || [ "$(stat -Lc '%d:%i:%Z' -- "/proc/$PREVIOUS_WEB_PID/cwd" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
  || [ "$(stat -Lc '%d:%i' -- "/proc/$PREVIOUS_WEB_PID" 2>/dev/null || true)" != "$PREVIOUS_WEB_PROCESS_IDENTITY" ] \
  || [ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_DIR" ]; then
  echo "[deploy] an exact previous atomic release is required before environment mutation"
  exit 1
fi
unset PREVIOUS_RUNTIME_PARENT PREVIOUS_RELEASE_NAME PREVIOUS_BUILD_PREFIX

FAOLLA_WEB_BUILD_ID="$EXPECTED_DEPLOY_SHA"
FAOLLA_WEB_RELEASED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
report_disk_status
cleanup_rebuildable_caches
report_disk_status
ensure_disk_headroom

write_env_value() {
  local key="$1"
  local value="$2"
  local file="${3:-.env.local}"
  if [ -z "$key" ] || [ -z "$value" ]; then
    return 0
  fi
  local temp_file
  temp_file="$(mktemp)" || return 1
  chmod 600 "$temp_file" || return 1
  if [ -f "$file" ]; then
    grep -v "^${key}=" "$file" > "$temp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$temp_file" || return 1
  mv "$temp_file" "$file" || return 1
  chmod 600 "$file" || return 1
}

remove_env_value() {
  local key="$1"
  local file="${2:-.env.local}"
  if [ -z "$key" ] || [ ! -f "$file" ]; then
    return 0
  fi
  local temp_file
  temp_file="$(mktemp)" || return 1
  chmod 600 "$temp_file" || return 1
  grep -v "^${key}=" "$file" > "$temp_file" || true
  mv "$temp_file" "$file" || return 1
  chmod 600 "$file" || return 1
}

decode_base64_value() {
  local value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  printf '%s' "$value" | base64 -d
}

write_env_value "WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY" "${WEB_PUSH_PUBLIC_KEY:-}"
write_env_value "WEB_PUSH_PRIVATE_KEY" "${WEB_PUSH_PRIVATE_KEY:-}"
write_env_value "WEB_PUSH_SUBJECT" "${WEB_PUSH_SUBJECT:-}"
FINAL_NEXT_PUBLIC_SUPABASE_URL="$(decode_base64_value "${NEXT_PUBLIC_SUPABASE_URL_B64:-}")"
SUPABASE_INTERNAL_URL_FROM_B64="$(decode_base64_value "${SUPABASE_INTERNAL_URL_B64:-}")"
FINAL_SUPABASE_INTERNAL_URL="${SUPABASE_INTERNAL_URL_FROM_B64:-http://127.0.0.1:8000}"
FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY="$(decode_base64_value "${NEXT_PUBLIC_SUPABASE_ANON_KEY_B64:-}")"
if [ -z "$FINAL_NEXT_PUBLIC_SUPABASE_URL" ]; then
  echo "[deploy] the current Supabase public URL is unavailable"
  exit 1
fi
if [ -z "$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then
  if [ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_DIR" ] \
    || [ "$(stat -Lc '%d:%i:%Z' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
    || [ "$(stat -Lc '%d:%i:%Z' -- "/proc/$PREVIOUS_WEB_PID/cwd" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
    || [ "$(stat -Lc '%d:%i' -- "/proc/$PREVIOUS_WEB_PID" 2>/dev/null || true)" != "$PREVIOUS_WEB_PROCESS_IDENTITY" ] \
    || ! PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64="$(
      timeout --signal=TERM --kill-after=1s 5s \
        node scripts/read-production-supabase-environment.mjs anon-key \
          "$PREVIOUS_RUNTIME_DIR/.env.local" "$PREVIOUS_BUILD_ID" \
          "$FINAL_NEXT_PUBLIC_SUPABASE_URL" 2>/dev/null
    )" \
    || [ "$(stat -Lc '%d:%i:%Z' -- "$PREVIOUS_RUNTIME_DIR" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
    || [ "$(stat -Lc '%d:%i:%Z' -- "/proc/$PREVIOUS_WEB_PID/cwd" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_IDENTITY" ] \
    || [ "$(stat -Lc '%d:%i' -- "/proc/$PREVIOUS_WEB_PID" 2>/dev/null || true)" != "$PREVIOUS_WEB_PROCESS_IDENTITY" ] \
    || [ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$PREVIOUS_RUNTIME_DIR" ]; then
    echo "[deploy] the previous atomic release Supabase environment is unavailable"
    exit 1
  fi
  if [ -z "$PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" ] \
    || ! [[ "$PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
    echo "[deploy] the previous atomic release Supabase environment is unavailable"
    exit 1
  fi
  if ! PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY="$(
    decode_base64_value "$PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64"
  )"; then
    echo "[deploy] the previous atomic release Supabase environment is unavailable"
    exit 1
  fi
  FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY="$PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY"
  unset PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64 \
    PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY
fi
unset PREVIOUS_WEB_PID PREVIOUS_RUNTIME_IDENTITY \
  PREVIOUS_WEB_CWD_IDENTITY PREVIOUS_WEB_PROCESS_IDENTITY
export SUPABASE_INTERNAL_URL="$FINAL_SUPABASE_INTERNAL_URL"
export NEXT_PUBLIC_SUPABASE_URL="$FINAL_NEXT_PUBLIC_SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY"
write_env_value "NEXT_PUBLIC_SUPABASE_URL" "$FINAL_NEXT_PUBLIC_SUPABASE_URL"
write_env_value "SUPABASE_INTERNAL_URL" "$FINAL_SUPABASE_INTERNAL_URL"
write_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY"
write_env_value "SUPABASE_SERVICE_ROLE_KEY" "$(decode_base64_value "${SUPABASE_SERVICE_ROLE_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_ID" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_TOKEN_KEY" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_REDIRECT_URI" "$(decode_base64_value "${GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64:-}")"
write_env_value "GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS" "${GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS:-}"
write_env_value "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" "$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO" "$(decode_base64_value "${MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64:-}")"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS" "$MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS"
write_env_value "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" "$MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS"
# Reset the persisted one-time gate and erase any prior case before validating
# a newly requested enablement. A failed deploy therefore stays closed, and
# the gate is written true only after both fresh secrets are safely persisted.
write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "false"
remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON"
remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET"
if [ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" = "true" ]; then
  if [ -z "${ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64:-}" ] \
    || [ -z "${ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64:-}" ]; then
    echo "[deploy] enabled ordinary legacy personal recovery requires fresh case and HMAC secrets"
    exit 1
  fi
  ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE="$(decode_base64_value "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64")"
  ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE="$(decode_base64_value "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64")"
  if [ -z "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE" ] \
    || [[ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE" =~ [[:space:]#] ]] \
    || ! [[ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE" =~ ^[0-9a-f]{64}$ ]]; then
    echo "[deploy] ordinary legacy personal recovery requires compact case JSON and a lowercase 64-hex HMAC secret"
    exit 1
  fi
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE"
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE"
  write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "true"
fi
write_env_value "RESEND_API_KEY" "$(decode_base64_value "${RESEND_API_KEY_B64:-}")"
write_env_value "SUPER_ADMIN_ACCOUNT" "${SUPER_ADMIN_ACCOUNT:-}"
write_env_value "SUPER_ADMIN_PASSWORD" "${SUPER_ADMIN_PASSWORD:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_EMAIL" "${SUPER_ADMIN_VERIFICATION_EMAIL:-}"
write_env_value "SUPER_ADMIN_VERIFICATION_SECRET" "${SUPER_ADMIN_VERIFICATION_SECRET:-}"

if [ -f "$APP_DIR/scripts/configure-production-log-retention.sh" ]; then
  if ! bash "$APP_DIR/scripts/configure-production-log-retention.sh"; then
    echo "[deploy] warning: production log retention configuration failed"
  fi
fi

write_env_value "FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID" "$FAOLLA_WEB_BUILD_ID"
write_env_value "FAOLLA_WEB_RELEASED_AT" "$FAOLLA_WEB_RELEASED_AT"

resolve_current_runtime_dir() {
  local linked_dir
  linked_dir="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  if [ -n "$linked_dir" ] && [ -d "$linked_dir/.next" ]; then
    printf '%s\n' "$linked_dir"
    return 0
  fi
  if [ -d "$APP_DIR/.next" ]; then
    printf '%s\n' "$APP_DIR"
    return 0
  fi
  printf '\n'
}

safe_remove_release_path() {
  local target="$1"
  local parent
  local resolved_parent
  if [ -z "$target" ]; then
    return 0
  fi
  parent="$(dirname "$target")"
  resolved_parent="$(readlink -f "$parent" 2>/dev/null || true)"
  if [ -z "$resolved_parent" ] || [ "$resolved_parent" != "$(readlink -f "$RELEASES_DIR")" ]; then
    echo "[deploy] refusing to remove unexpected release path: $target"
    exit 1
  fi
  rm -rf -- "$target"
}

release_path_in_use() {
  local target="$1"
  local resolved_target
  local cwd_link
  local process_cwd
  resolved_target="$(readlink -f "$target" 2>/dev/null || true)"
  if [ -z "$resolved_target" ]; then
    return 1
  fi
  for cwd_link in /proc/[0-9]*/cwd; do
    process_cwd="$(readlink -f "$cwd_link" 2>/dev/null || true)"
    if [ "$process_cwd" = "$resolved_target" ] || [[ "$process_cwd" == "$resolved_target/"* ]]; then
      return 0
    fi
  done
  return 1
}

cleanup_stale_build_dirs() {
  local release_dir
  while IFS= read -r -d '' release_dir; do
    if release_path_in_use "$release_dir"; then
      echo "[deploy] warning: stale build is still in use and was not removed: $release_dir"
      continue
    fi
    echo "[deploy] removing stale incomplete build: $release_dir"
    safe_remove_release_path "$release_dir"
  done < <(
    find "$RELEASES_DIR" \
      -mindepth 1 \
      -maxdepth 1 \
      -type d \
      -name '.*.building' \
      -mmin "+$STALE_BUILD_MINUTES" \
      -print0
  )
}

copy_previous_static_assets() {
  local previous_runtime_dir="$1"
  local next_release_dir="$2"
  local previous_static_dir="$previous_runtime_dir/.next/static"
  local next_static_dir="$next_release_dir/.next/static"
  local previous_manifest="$previous_runtime_dir/.faolla-current-static-files"
  local relative_path

  if [ ! -d "$previous_static_dir" ] || [ ! -d "$next_static_dir" ]; then
    return 0
  fi

  echo "[deploy] preserving previous release assets for open browser tabs"
  if [ -f "$previous_manifest" ]; then
    while IFS= read -r relative_path; do
      relative_path="${relative_path#./}"
      if [ -z "$relative_path" ] || [ ! -f "$previous_static_dir/$relative_path" ]; then
        continue
      fi
      mkdir -p "$(dirname "$next_static_dir/$relative_path")"
      cp -p -n -- "$previous_static_dir/$relative_path" "$next_static_dir/$relative_path"
    done < "$previous_manifest"
    return 0
  fi

  cp -a -n -- "$previous_static_dir/." "$next_static_dir/"
}

normalize_and_verify_release_permissions() {
  local release_root="$1"
  local static_root="$release_root/.next/static"
  local server_root="$release_root/.next/server"
  local env_file="$release_root/.env.local"
  local invalid_path
  if [ -L "$RELEASES_DIR" ] \
    || [ -L "$release_root" ] \
    || [ -L "$release_root/.next" ] \
    || [ -L "$static_root" ] \
    || [ -L "$env_file" ] \
    || [ ! -d "$RELEASES_DIR" ] \
    || [ ! -d "$release_root" ] \
    || [ ! -d "$release_root/.next" ] \
    || [ ! -d "$static_root" ] \
    || [ ! -f "$env_file" ]; then
    return 1
  fi
  invalid_path="$(find "$static_root" ! -type d ! -type f -print -quit)"
  [ -z "$invalid_path" ] || return 1
  chmod 755 "$RELEASES_DIR" "$release_root" "$release_root/.next" "$static_root" || return 1
  find "$static_root" -type d -exec chmod 755 {} + || return 1
  find "$static_root" -type f -exec chmod 644 {} + || return 1
  if [ -e "$server_root" ]; then
    [ -d "$server_root" ] && [ ! -L "$server_root" ] || return 1
    invalid_path="$(find "$server_root" ! -type d ! -type f -print -quit)"
    [ -z "$invalid_path" ] || return 1
    find "$server_root" -type d -exec chmod 700 {} + || return 1
    find "$server_root" -type f -exec chmod 600 {} + || return 1
  fi
  chmod 600 "$env_file" || return 1
  node --input-type=module - "$release_root" <<'NODE'
import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

const releaseRoot = resolve(process.argv[2]);
const envPath = join(releaseRoot, ".env.local");
const staticRoot = join(releaseRoot, ".next", "static");
const exactMode = (path, mode) => {
  const value = lstatSync(path);
  if (value.isSymbolicLink() || (value.mode & 0o777) !== mode) process.exit(1);
  return value;
};
if (!exactMode(releaseRoot, 0o755).isDirectory()) process.exit(1);
if (!exactMode(join(releaseRoot, ".next"), 0o755).isDirectory()) process.exit(1);
if (!exactMode(envPath, 0o600).isFile()) process.exit(1);
const visit = (path) => {
  const value = lstatSync(path);
  if (value.isSymbolicLink()) process.exit(1);
  if (value.isDirectory()) {
    if ((value.mode & 0o777) !== 0o755) process.exit(1);
    for (const entry of readdirSync(path)) visit(join(path, entry));
    return;
  }
  if (!value.isFile() || (value.mode & 0o777) !== 0o644) process.exit(1);
};
visit(staticRoot);
const serverRoot = join(releaseRoot, ".next", "server");
try {
  const visitPrivateServer = (path) => {
    const value = lstatSync(path);
    if (value.isSymbolicLink()) process.exit(1);
    if (value.isDirectory()) {
      if ((value.mode & 0o777) !== 0o700) process.exit(1);
      for (const entry of readdirSync(path)) visitPrivateServer(join(path, entry));
      return;
    }
    if (!value.isFile() || (value.mode & 0o777) !== 0o600) process.exit(1);
  };
  visitPrivateServer(serverRoot);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
let ancestor = dirname(releaseRoot);
const filesystemRoot = parse(ancestor).root;
for (;;) {
  const value = lstatSync(ancestor);
  if (!value.isDirectory() || value.isSymbolicLink() || (value.mode & 0o001) === 0) {
    process.exit(1);
  }
  if (ancestor === filesystemRoot) break;
  ancestor = dirname(ancestor);
}
NODE
}

verify_public_static_access_for_nginx() {
  local release_path="$1"
  local static_path="$release_path/.next/static"
  local ancestor="$release_path"
  local static_file
  local checked=0
  if [ "$(id -u)" != "0" ] \
    || ! id -u "$NGINX_RUNTIME_USER" >/dev/null 2>&1; then
    echo "[deploy] the production nginx runtime identity cannot be verified"
    return 1
  fi
  while :; do
    if ! runuser -u "$NGINX_RUNTIME_USER" -- test -x "$ancestor"; then
      echo "[deploy] nginx cannot traverse the release path"
      return 1
    fi
    [ "$ancestor" = "/" ] && break
    ancestor="$(dirname "$ancestor")"
  done
  while IFS= read -r -d '' static_file; do
    if ! runuser -u "$NGINX_RUNTIME_USER" -- test -r "$static_file"; then
      echo "[deploy] nginx cannot read a release static file"
      return 1
    fi
    checked=$((checked + 1))
  done < <(find "$static_path" -type f -print0)
  if [ "$checked" -lt 1 ]; then
    echo "[deploy] release static tree is empty"
    return 1
  fi
}

prepare_shared_runtime() {
  mkdir -p "$SHARED_RUNTIME_DIR" || return 1
  if [ "$PREVIOUS_RUNTIME_DIR" = "$APP_DIR" ] && [ -d "$APP_DIR/.runtime" ]; then
    echo "[deploy] migrating persistent runtime data into the shared directory"
    timeout --signal=TERM --kill-after=5s \
      "${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS}s" \
      cp -a -- "$APP_DIR/.runtime/." "$SHARED_RUNTIME_DIR/" || return 1
  fi
}

prepare_legacy_static_bridge() {
  if [ "$PREVIOUS_RUNTIME_DIR" != "$APP_DIR" ]; then
    return 0
  fi
  if [ ! -d "$APP_DIR/.next/static" ] || [ ! -d "$RELEASE_DIR/.next/static" ]; then
    return 0
  fi
  echo "[deploy] adding new assets to the legacy static path before the first atomic switch"
  cp -a -n -- "$RELEASE_DIR/.next/static/." "$APP_DIR/.next/static/"
}

install_runtime_compatibility_links() {
  local next_link="$APP_DIR/.next"
  local modules_link="$APP_DIR/node_modules"
  local next_backup="$APP_DIR/.next.pre-atomic-deploy"
  local modules_backup="$APP_DIR/node_modules.pre-atomic-deploy"

  if [ "$(readlink "$next_link" 2>/dev/null || true)" = "$CURRENT_LINK/.next" ] \
    && [ "$(readlink "$modules_link" 2>/dev/null || true)" = "$CURRENT_LINK/node_modules" ]; then
    return 0
  fi
  if ! timeout --signal=TERM --kill-after=5s \
    "${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS}s" \
    bash -c '
      set -euo pipefail
      next_link="$1"
      modules_link="$2"
      next_backup="$3"
      modules_backup="$4"
      current_link="$5"
      if [ -e "$next_backup" ] || [ -L "$next_backup" ] \
        || [ -e "$modules_backup" ] || [ -L "$modules_backup" ]; then
        exit 1
      fi
      if [ -e "$next_link" ] || [ -L "$next_link" ]; then
        mv -- "$next_link" "$next_backup"
      fi
      if [ -e "$modules_link" ] || [ -L "$modules_link" ]; then
        if ! mv -- "$modules_link" "$modules_backup"; then
          if [ -e "$next_backup" ] || [ -L "$next_backup" ]; then
            mv -- "$next_backup" "$next_link" || true
          fi
          exit 1
        fi
      fi
      if ! ln -s "$current_link/.next" "$next_link" \
        || ! ln -s "$current_link/node_modules" "$modules_link"; then
        rm -f -- "$next_link" "$modules_link"
        if [ -e "$next_backup" ] || [ -L "$next_backup" ]; then
          mv -- "$next_backup" "$next_link"
        fi
        if [ -e "$modules_backup" ] || [ -L "$modules_backup" ]; then
          mv -- "$modules_backup" "$modules_link"
        fi
        exit 1
      fi
    ' bash "$next_link" "$modules_link" "$next_backup" "$modules_backup" "$CURRENT_LINK"; then
    echo "[deploy] failed to install bounded runtime compatibility links"
    return 1
  fi
  LEGACY_COMPATIBILITY_LINKS_INSTALLED=1
}

restore_legacy_runtime_compatibility_paths() {
  local next_link="$APP_DIR/.next"
  local modules_link="$APP_DIR/node_modules"
  local next_backup="$APP_DIR/.next.pre-atomic-deploy"
  local modules_backup="$APP_DIR/node_modules.pre-atomic-deploy"
  if [ "${LEGACY_COMPATIBILITY_LINKS_INSTALLED:-0}" != "1" ]; then return 0; fi
  if [ "$(readlink "$next_link" 2>/dev/null || true)" != "$CURRENT_LINK/.next" ] \
    || [ "$(readlink "$modules_link" 2>/dev/null || true)" != "$CURRENT_LINK/node_modules" ] \
    || [ ! -d "$next_backup" ] \
    || [ ! -d "$modules_backup" ]; then
    return 1
  fi
  if ! timeout --signal=TERM --kill-after=5s \
    "${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS}s" \
    bash -c '
      set -euo pipefail
      rm -f -- "$1" "$2"
      mv -- "$3" "$1"
      mv -- "$4" "$2"
    ' bash "$next_link" "$modules_link" "$next_backup" "$modules_backup"; then
    return 1
  fi
  LEGACY_COMPATIBILITY_LINKS_INSTALLED=0
}

finalize_legacy_runtime_compatibility_paths() {
  local next_backup="$APP_DIR/.next.pre-atomic-deploy"
  local modules_backup="$APP_DIR/node_modules.pre-atomic-deploy"
  if [ "${LEGACY_COMPATIBILITY_LINKS_INSTALLED:-0}" != "1" ]; then return 0; fi
  timeout --signal=TERM --kill-after=5s \
    "${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS}s" \
    rm -rf -- "$next_backup" "$modules_backup" || return 1
  LEGACY_COMPATIBILITY_LINKS_INSTALLED=0
}

wait_for_port_release() {
  local socket_state
  for _ in $(seq 1 20); do
    if ! socket_state="$(timeout --signal=TERM --kill-after=1s 2s ss -ltn "( sport = :$APP_PORT )")"; then
      return 1
    fi
    if ! printf '%s\n' "$socket_state" | grep -Fq ":$APP_PORT"; then
      return 0
    fi
    sleep 1
  done
  echo "[deploy] port $APP_PORT is still in use after waiting"
  return 1
}

read_runtime_automation_worker_enabled() {
  local runtime_dir="$1"
  local configured_value=""
  if [ -f "$runtime_dir/.env.local" ]; then
    configured_value="$(grep '^MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED=' "$runtime_dir/.env.local" \
      | tail -n 1 \
      | cut -d= -f2- || true)"
  fi
  if [ "$configured_value" = "true" ]; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

read_runtime_invitation_worker_enabled() {
  local runtime_dir="$1"
  local configured_value=""
  if [ -f "$runtime_dir/.env.local" ]; then
    configured_value="$(grep '^MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED=' "$runtime_dir/.env.local" \
      | tail -n 1 \
      | cut -d= -f2- || true)"
  fi
  if [ "$configured_value" = "true" ]; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

read_runtime_build_id() {
  local runtime_dir="$1"
  local build_id=""
  if [ -n "$runtime_dir" ] && [ -f "$runtime_dir/.env.local" ]; then
    build_id="$(grep '^FAOLLA_WEB_BUILD_ID=' "$runtime_dir/.env.local" \
      | tail -n 1 \
      | cut -d= -f2- || true)"
  fi
  if [[ "$build_id" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' "$build_id"
  else
    printf '\n'
  fi
}

start_release() {
  local runtime_dir="$1"
  local automation_worker_enabled
  if [ -z "$runtime_dir" ] || [ ! -f "$runtime_dir/package.json" ] || [ ! -d "$runtime_dir/.next" ]; then
    return 1
  fi
  automation_worker_enabled="$(read_runtime_automation_worker_enabled "$runtime_dir")"
  (
    cd "$runtime_dir"
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$automation_worker_enabled" \
      PORT="$APP_PORT" timeout --signal=TERM --kill-after=5s \
        "${RELEASE_PROCESS_START_TIMEOUT_SECONDS}s" \
        pm2 start npm --name "$APP_NAME" -- start -- -p "$APP_PORT"
  )
}

pm2_process_has_pid() {
  local process_name="$1"
  local process_pid
  process_pid="$(timeout --signal=TERM --kill-after=1s 2s \
    pm2 pid "$process_name" 2>/dev/null | tail -n 1 | tr -d '[:space:]')" || return 1
  [[ "$process_pid" =~ ^[1-9][0-9]*$ ]]
}

stop_pm2_process_bounded() {
  local process_name="$1"
  local total_timeout_seconds="$2"
  local describe_status=0
  local delete_timeout_seconds
  local observed_pid=""
  if ! [[ "$total_timeout_seconds" =~ ^[1-9][0-9]*$ ]] \
    || [ "$total_timeout_seconds" -lt 20 ]; then
    return 1
  fi
  timeout --signal=TERM --kill-after=2s 5s \
    pm2 describe "$process_name" >/dev/null 2>&1 || describe_status=$?
  case "$describe_status" in
    0) ;;
    124|137) return 1 ;;
    *) return 0 ;;
  esac
  delete_timeout_seconds=$((total_timeout_seconds - 10))
  timeout --signal=TERM --kill-after=5s "${delete_timeout_seconds}s" \
    pm2 delete "$process_name" >/dev/null 2>&1 || return 1
  if ! observed_pid="$(
    timeout --signal=TERM --kill-after=2s 5s pm2 pid "$process_name" 2>/dev/null \
      | tail -n 1 \
      | tr -d '[:space:]'
  )"; then
    return 1
  fi
  ! [[ "$observed_pid" =~ ^[1-9][0-9]*$ ]]
}

start_automation_worker_process() {
  local runtime_dir="$1"
  local tsx_entry="$runtime_dir/node_modules/tsx/dist/cli.mjs"
  local worker_entry="$runtime_dir/scripts/run-merchant-enterprise-automation-worker.ts"
  local automation_worker_enabled
  local invitation_worker_enabled
  if [ -z "$runtime_dir" ] \
    || [ ! -f "$runtime_dir/package.json" ] \
    || [ ! -f "$tsx_entry" ] \
    || [ ! -f "$worker_entry" ]; then
    return 1
  fi
  automation_worker_enabled="$(read_runtime_automation_worker_enabled "$runtime_dir")"
  invitation_worker_enabled="$(read_runtime_invitation_worker_enabled "$runtime_dir")"
  if [ "$automation_worker_enabled" != "true" ] \
    && [ "$invitation_worker_enabled" != "true" ]; then
    return 1
  fi
  (
    cd "$runtime_dir"
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="$automation_worker_enabled" \
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="$invitation_worker_enabled" \
      timeout --signal=TERM --kill-after=5s 30s \
        pm2 start "$tsx_entry" \
        --name "$AUTOMATION_WORKER_NAME" \
        --interpreter node \
        --cwd "$runtime_dir" \
        --kill-timeout "$AUTOMATION_WORKER_KILL_TIMEOUT_MS" \
        --restart-delay 5000 \
        --wait-ready \
        --listen-timeout 20000 \
        -- "$worker_entry"
  )
}

wait_for_automation_worker_online() {
  local previous_pid=""
  local current_pid=""
  local stable_checks=0
  for _ in $(seq 1 20); do
    current_pid="$(timeout --signal=TERM --kill-after=1s 2s \
      pm2 pid "$AUTOMATION_WORKER_NAME" 2>/dev/null | tail -n 1 | tr -d '[:space:]')" || return 1
    if [[ "$current_pid" =~ ^[1-9][0-9]*$ ]]; then
      if [ "$current_pid" = "$previous_pid" ]; then
        stable_checks=$((stable_checks + 1))
      else
        previous_pid="$current_pid"
        stable_checks=1
      fi
      if [ "$stable_checks" -ge 3 ]; then
        return 0
      fi
    else
      previous_pid=""
      stable_checks=0
    fi
    sleep 1
  done
  return 1
}

wait_for_release_health() {
  local expected_build_id="$1"
  local response
  for _ in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
    response="$(curl -fsS --max-time 4 "http://127.0.0.1:${APP_PORT}/api/app-web-version" 2>/dev/null || true)"
    if [ -n "$response" ] && printf '%s' "$response" | grep -Fq "\"buildId\":\"$expected_build_id\""; then
      return 0
    fi
    sleep 1
  done
  return 1
}

run_local_release_smoke() {
  (
    cd "$RELEASE_DIR"
    FAOLLA_LOCAL_SMOKE_NETWORK_ORIGIN="$RELEASE_SMOKE_ORIGIN" \
    FAOLLA_LOCAL_SMOKE_PATHS="$RELEASE_SMOKE_PATHS" \
    FAOLLA_LOCAL_SMOKE_EXPECTED_BUILD="$FAOLLA_WEB_BUILD_ID" \
    FAOLLA_LOCAL_SMOKE_ATTEMPTS="$RELEASE_SMOKE_ATTEMPTS" \
    FAOLLA_LOCAL_SMOKE_DELAY_MS="$RELEASE_SMOKE_DELAY_MS" \
    FAOLLA_LOCAL_SMOKE_TIMEOUT_MS="$RELEASE_SMOKE_TIMEOUT_MS" \
    timeout --signal=TERM --kill-after=5s \
      "${RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS}s" \
      node --input-type=module <<'NODE'
import { runProductionSmoke } from "./scripts/check-production-smoke.mjs";

const publicOrigin = new URL("https://www.faolla.com");
const networkOrigin = new URL(process.env.FAOLLA_LOCAL_SMOKE_NETWORK_ORIGIN ?? "");
const configuredSmokePaths = (process.env.FAOLLA_LOCAL_SMOKE_PATHS ?? "")
  .split(/[\n,]/)
  .map((value) => value.trim())
  .filter(Boolean);
const allowedTenantOrigins = new Set(
  configuredSmokePaths.flatMap((value) => {
    let path;
    try { path = new URL(value, publicOrigin).pathname; } catch { return []; }
    const match = /^\/([0-9]{8})(?:\/|$)/.exec(path);
    return match ? [`https://${match[1]}.faolla.com`] : [];
  }),
);
if (
  networkOrigin.protocol !== "http:" ||
  !["127.0.0.1", "[::1]"].includes(networkOrigin.hostname) ||
  networkOrigin.username || networkOrigin.password ||
  networkOrigin.pathname !== "/" || networkOrigin.search || networkOrigin.hash
) throw new Error("local smoke network origin must be an exact loopback HTTP origin");
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  let requested = new URL(input instanceof Request ? input.url : String(input));
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const allowedLogicalOrigin =
      !requested.username && !requested.password &&
      (requested.origin === publicOrigin.origin ||
        allowedTenantOrigins.has(requested.origin));
    if (!allowedLogicalOrigin) {
      throw new Error("local smoke refused a non-production external request");
    }
    const networkUrl = new URL(`${requested.pathname}${requested.search}`, networkOrigin);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [key, value] of new Headers(init.headers ?? {})) headers.set(key, value);
    headers.set("host", requested.host);
    headers.set("x-forwarded-host", requested.host);
    headers.set("x-forwarded-proto", publicOrigin.protocol.slice(0, -1));
    const response = await nativeFetch(networkUrl, {
      ...init,
      headers,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("local smoke redirect omitted its location");
      requested = new URL(location, requested);
      continue;
    }
    Object.defineProperty(response, "url", {
      configurable: true,
      enumerable: true,
      value: requested.href,
    });
    return response;
  }
  throw new Error("local smoke exceeded its redirect limit");
};

const result = await runProductionSmoke({
  origin: publicOrigin.href,
  paths: process.env.FAOLLA_LOCAL_SMOKE_PATHS,
  expectedBuildId: process.env.FAOLLA_LOCAL_SMOKE_EXPECTED_BUILD,
  attempts: process.env.FAOLLA_LOCAL_SMOKE_ATTEMPTS,
  delayMs: process.env.FAOLLA_LOCAL_SMOKE_DELAY_MS,
  timeoutMs: process.env.FAOLLA_LOCAL_SMOKE_TIMEOUT_MS,
});
console.log(JSON.stringify(result));
NODE
  )
}

verify_nginx_release_static_access() {
  local resolved_current
  resolved_current="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  if [ "$resolved_current" != "$RELEASE_DIR" ] \
    || [ "$(readlink "$APP_DIR/.next" 2>/dev/null || true)" != "$CURRENT_LINK/.next" ]; then
    return 1
  fi
  FAOLLA_NGINX_RELEASE_DIR="$RELEASE_DIR" \
  FAOLLA_NGINX_APP_DIR="$APP_DIR" \
  FAOLLA_NGINX_CURRENT_LINK="$CURRENT_LINK" \
  FAOLLA_NGINX_RUNTIME_USER="$NGINX_RUNTIME_USER" \
  FAOLLA_NGINX_EXPECTED_BUILD="$FAOLLA_WEB_BUILD_ID" \
    timeout --signal=TERM --kill-after=5s \
      "${NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS}s" \
      bash -c '
        set -euo pipefail
        manifest="$FAOLLA_NGINX_RELEASE_DIR/.faolla-current-static-files"
        static_root="$FAOLLA_NGINX_RELEASE_DIR/.next/static"
        test -f "$manifest"
        test ! -L "$manifest"
        ancestor="$FAOLLA_NGINX_RELEASE_DIR"
        while :; do
          runuser -u "$FAOLLA_NGINX_RUNTIME_USER" -- test -x "$ancestor"
          test "$ancestor" != / || break
          ancestor="$(dirname "$ancestor")"
        done
        checked=0
        while IFS= read -r relative_path; do
          test -n "$relative_path"
          case "$relative_path" in
            /*|*..*|*[!A-Za-z0-9._/-]*) exit 1 ;;
          esac
          runuser -u "$FAOLLA_NGINX_RUNTIME_USER" -- \
            test -r "$static_root/$relative_path"
          curl --fail --silent --show-error --insecure \
            --noproxy "*" \
            --connect-timeout 3 --max-time 8 \
            --resolve "www.faolla.com:443:127.0.0.1" \
            --header "Cache-Control: no-cache" \
            --output /dev/null \
            "https://www.faolla.com/_next/static/$relative_path?__faollaNginxGate=$FAOLLA_NGINX_EXPECTED_BUILD"
          checked=$((checked + 1))
        done < "$manifest"
        test "$checked" -gt 0
        version="$(
          curl --fail --silent --show-error --insecure \
            --noproxy "*" \
            --connect-timeout 3 --max-time 8 \
            --resolve "www.faolla.com:443:127.0.0.1" \
            --header "Cache-Control: no-cache" \
            "https://www.faolla.com/api/app-web-version?__faollaNginxGate=$FAOLLA_NGINX_EXPECTED_BUILD"
        )"
        printf "%s" "$version" | grep -Fq "\"buildId\":\"$FAOLLA_NGINX_EXPECTED_BUILD\""
      '
}

verify_supabase_health() {
  local attempt
  local status
  for attempt in 1 2 3; do
    status=0
    node scripts/check-supabase-health.mjs || status=$?
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" != "3" ]; then
      echo "[deploy] Supabase health check attempt $attempt failed with status $status; retrying"
      sleep 5
    fi
  done
  return "$status"
}

verify_booking_persistence() {
  (
    cd "$RELEASE_DIR"
    BOOKING_PERSISTENCE_CHECK_ATTEMPTS="${BOOKING_PERSISTENCE_CHECK_ATTEMPTS:-3}" \
      BOOKING_PERSISTENCE_CHECK_DELAY_MS="${BOOKING_PERSISTENCE_CHECK_DELAY_MS:-2000}" \
      BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS="${BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS:-10000}" \
      timeout --signal=TERM --kill-after=5s \
        "${BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS}s" \
        node --env-file=.env.local scripts/check-booking-persistence.mjs
  )
}

switch_current_release() {
  local release_dir="$1"
  timeout --signal=TERM --kill-after=5s \
    "${RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS}s" \
    bash -c '
      set -euo pipefail
      release_dir="$1"
      current_link="$2"
      pending_link="${current_link}.pending"
      rm -f -- "$pending_link"
      ln -s "$release_dir" "$pending_link"
      mv -Tf -- "$pending_link" "$current_link"
    ' bash "$release_dir" "$CURRENT_LINK"
}

validate_readiness_fence_marker() {
  local marker_key
  local marker_value
  local marker_value_count=0
  local minimum_hold_remaining_seconds="${1:-0}"
  if [ -z "${READINESS_FENCE_PID:-}" ] \
    || [ -z "${READINESS_FENCE_MARKER:-}" ] \
    || [ -z "${READINESS_FENCE_RELEASE_REQUEST:-}" ] \
    || [ -z "${READINESS_FENCE_RELEASE_TOKEN:-}" ] \
    || ! [[ "$minimum_hold_remaining_seconds" =~ ^[0-9]+$ ]] \
    || [ "$minimum_hold_remaining_seconds" -gt "$READINESS_FENCE_MAXIMUM_HOLD_SECONDS" ]; then
    return 1
  fi
  while IFS= read -r -d '' marker_key \
    && IFS= read -r -d '' marker_value; do
    case "$marker_key" in
      READINESS_FENCE_BACKEND_PID|READINESS_FENCE_APPLICATION_NAME|READINESS_FENCE_MARKER_SHA256)
        printf -v "$marker_key" '%s' "$marker_value"
        marker_value_count=$((marker_value_count + 1))
        ;;
      *) return 1 ;;
    esac
  done < <(
    FAOLLA_EXPECTED_HOLDER_PID="$READINESS_FENCE_PID" \
    FAOLLA_EXPECTED_TARGET_SHA="$EXPECTED_DEPLOY_SHA" \
    FAOLLA_EXPECTED_READINESS_RUN_ID="$RELEASE_READINESS_RUN_ID" \
    FAOLLA_EXPECTED_READINESS_RUN_ATTEMPT="$RELEASE_READINESS_RUN_ATTEMPT" \
    FAOLLA_EXPECTED_READINESS_ARTIFACT_ID="$RELEASE_READINESS_REPORT_ARTIFACT_ID" \
    FAOLLA_EXPECTED_READINESS_ARTIFACT_DIGEST="$RELEASE_READINESS_REPORT_ARTIFACT_DIGEST" \
    FAOLLA_EXPECTED_ATTESTATION_SHA256="$RELEASE_CANONICAL_SHA256" \
    FAOLLA_EXPECTED_DATABASE_CONTAINER_NAME="$RELEASE_DATABASE_CONTAINER_NAME" \
    FAOLLA_EXPECTED_DATABASE_CONTAINER_ID="$RELEASE_DATABASE_CONTAINER_ID" \
    FAOLLA_EXPECTED_DATABASE_OID="$RELEASE_DATABASE_OID" \
    FAOLLA_EXPECTED_RELEASE_TOKEN="$READINESS_FENCE_RELEASE_TOKEN" \
    FAOLLA_EXPECTED_MARKER_SHA256="${READINESS_FENCE_MARKER_SHA256:-}" \
    FAOLLA_EXPECTED_MAXIMUM_HOLD_SECONDS="$READINESS_FENCE_MAXIMUM_HOLD_SECONDS" \
    FAOLLA_EXPECTED_MINIMUM_HOLD_REMAINING_SECONDS="$minimum_hold_remaining_seconds" \
    FAOLLA_SUPABASE_INTERNAL_URL="$FINAL_SUPABASE_INTERNAL_URL" \
    FAOLLA_NEXT_PUBLIC_SUPABASE_URL="$FINAL_NEXT_PUBLIC_SUPABASE_URL" \
    timeout --signal=TERM --kill-after=1s 5s \
      node --input-type=module - \
      "$READINESS_FENCE_MARKER" "$READINESS_FENCE_RELEASE_REQUEST" <<'NODE'
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";

const fail = () => process.exit(1);
const markerPath = process.argv[2];
const releaseRequestPath = process.argv[3];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isRecord = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exact = (value, keys) => {
  if (!isRecord(value)) fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  return value;
};
const canonical = (value) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) fail();
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
let descriptor;
let before;
let opened;
let after;
let current;
let bytes;
try {
  before = lstatSync(markerPath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o777n) !== 0o600n || before.size <= 0n || before.size > 1024n * 1024n) fail();
  descriptor = openSync(markerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  opened = fstatSync(descriptor, { bigint: true });
  if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail();
  bytes = readFileSync(descriptor);
  after = fstatSync(descriptor, { bigint: true });
  current = lstatSync(markerPath, { bigint: true });
  if (
    after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
    !current.isFile() || current.isSymbolicLink() || current.nlink !== 1n ||
    current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size || current.mtimeNs !== opened.mtimeNs
  ) fail();
} catch {
  fail();
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
let marker;
try { marker = JSON.parse(bytes.toString("utf8")); } catch { fail(); }
if (!bytes.equals(canonicalBytes(marker))) fail();
exact(marker, [
  "schemaVersion", "kind", "targetSha", "readinessRunId", "readinessRunAttempt",
  "readinessArtifactId", "readinessArtifactDigest", "attestationSha256", "database",
  "holderPid", "backendPid", "applicationName", "releaseToken", "releaseTokenSha256",
  "releaseRequestPathSha256", "endpointEvidence", "holdLocks", "startedAt", "validUntil",
]);
const decimal = /^[1-9][0-9]*$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const hex = /^[0-9a-f]{64}$/;
const application = /^faolla_readiness_fence_[1-9][0-9]*_[0-9a-f]{24}$/;
const expectedToken = Buffer.from(process.env.FAOLLA_EXPECTED_RELEASE_TOKEN ?? "", "ascii");
const actualToken = Buffer.from(marker.releaseToken ?? "", "ascii");
const startedAtMilliseconds = Date.parse(marker.startedAt);
const validUntilMilliseconds = Date.parse(marker.validUntil);
const maximumHoldSeconds = Number(process.env.FAOLLA_EXPECTED_MAXIMUM_HOLD_SECONDS);
const minimumHoldRemainingSeconds = Number(process.env.FAOLLA_EXPECTED_MINIMUM_HOLD_REMAINING_SECONDS);
const nowMilliseconds = Date.now();
if (
  marker.schemaVersion !== 1 ||
  marker.kind !== "faolla.ordinary-account-cutover-readiness-fence.v1" ||
  marker.targetSha !== process.env.FAOLLA_EXPECTED_TARGET_SHA ||
  marker.readinessRunId !== process.env.FAOLLA_EXPECTED_READINESS_RUN_ID ||
  marker.readinessRunAttempt !== process.env.FAOLLA_EXPECTED_READINESS_RUN_ATTEMPT ||
  marker.readinessArtifactId !== process.env.FAOLLA_EXPECTED_READINESS_ARTIFACT_ID ||
  marker.readinessArtifactDigest !== process.env.FAOLLA_EXPECTED_READINESS_ARTIFACT_DIGEST ||
  marker.attestationSha256 !== process.env.FAOLLA_EXPECTED_ATTESTATION_SHA256 ||
  marker.holderPid !== process.env.FAOLLA_EXPECTED_HOLDER_PID ||
  !decimal.test(marker.backendPid ?? "") ||
  !application.test(marker.applicationName ?? "") ||
  !marker.applicationName.startsWith(`faolla_readiness_fence_${marker.holderPid}_`) ||
  expectedToken.length !== 64 || actualToken.length !== 64 ||
  !timingSafeEqual(expectedToken, actualToken) ||
  !hex.test(marker.releaseTokenSha256 ?? "") ||
  marker.releaseTokenSha256 !== sha256(actualToken) ||
  marker.releaseRequestPathSha256 !== sha256(Buffer.from(releaseRequestPath, "utf8")) ||
  Number.isNaN(startedAtMilliseconds) || Number.isNaN(validUntilMilliseconds) ||
  new Date(startedAtMilliseconds).toISOString() !== marker.startedAt ||
  new Date(validUntilMilliseconds).toISOString() !== marker.validUntil ||
  !Number.isSafeInteger(maximumHoldSeconds) || maximumHoldSeconds !== 900 ||
  !Number.isSafeInteger(minimumHoldRemainingSeconds) || minimumHoldRemainingSeconds < 0 ||
  startedAtMilliseconds > nowMilliseconds + 5_000 ||
  startedAtMilliseconds + maximumHoldSeconds * 1000 - nowMilliseconds < minimumHoldRemainingSeconds * 1000
) fail();
const database = exact(marker.database, ["containerName", "containerId", "dbName", "dbOid", "systemId", "primary"]);
if (
  database.containerName !== process.env.FAOLLA_EXPECTED_DATABASE_CONTAINER_NAME ||
  database.containerId !== process.env.FAOLLA_EXPECTED_DATABASE_CONTAINER_ID ||
  database.dbOid !== process.env.FAOLLA_EXPECTED_DATABASE_OID ||
  typeof database.dbName !== "string" || database.dbName.length === 0 ||
  !decimal.test(database.systemId ?? "") || database.primary !== true
) fail();
const holdLocks = exact(marker.holdLocks, [
  "authShareLockCount", "authAccessExclusiveLockCount",
  "pagesAccessExclusiveLockCount", "registryAccessExclusiveLockCount",
]);
if (
  holdLocks.authShareLockCount !== "1" ||
  holdLocks.authAccessExclusiveLockCount !== "0" ||
  holdLocks.pagesAccessExclusiveLockCount !== "0" ||
  holdLocks.registryAccessExclusiveLockCount !== "1"
) fail();
if (!Array.isArray(marker.endpointEvidence) || marker.endpointEvidence.length !== 4) fail();
const normalizeBase = (raw) => {
  let value;
  try { value = new URL(raw); } catch { fail(); }
  if (!/^https?:$/.test(value.protocol) || value.username || value.password || value.search || value.hash) fail();
  return value.href;
};
const internalBaseSha = sha256(Buffer.from(normalizeBase(process.env.FAOLLA_SUPABASE_INTERNAL_URL ?? ""), "utf8"));
const publicBaseSha = sha256(Buffer.from(normalizeBase(process.env.FAOLLA_NEXT_PUBLIC_SUPABASE_URL ?? ""), "utf8"));
const expectedProbes = [
  ["internalRest", "public", "pages", internalBaseSha],
  ["internalAuth", "auth", "users", internalBaseSha],
  ["publicRest", "public", "pages", publicBaseSha],
  ["publicAuth", "auth", "users", publicBaseSha],
];
marker.endpointEvidence.forEach((entry, index) => {
  exact(entry, [
    "probe", "baseEndpointSha256", "endpointSha256", "serviceIdentitySha256",
    "databaseQuerySha256", "databaseOid", "relationOid", "schemaName", "relationName",
    "waiterPid", "databaseClockEpochMilliseconds", "queryStartedAtEpochMilliseconds", "blockingPids",
  ]);
  const [probe, schemaName, relationName, baseSha] = expectedProbes[index];
  if (
    entry.probe !== probe || entry.schemaName !== schemaName || entry.relationName !== relationName ||
    entry.baseEndpointSha256 !== baseSha || !hex.test(entry.endpointSha256 ?? "") ||
    !hex.test(entry.serviceIdentitySha256 ?? "") || !hex.test(entry.databaseQuerySha256 ?? "") ||
    entry.databaseOid !== database.dbOid || !decimal.test(entry.relationOid ?? "") ||
    !decimal.test(entry.waiterPid ?? "") || !decimal.test(entry.databaseClockEpochMilliseconds ?? "") ||
    !decimal.test(entry.queryStartedAtEpochMilliseconds ?? "") ||
    BigInt(entry.queryStartedAtEpochMilliseconds) < BigInt(entry.databaseClockEpochMilliseconds) ||
    !Array.isArray(entry.blockingPids) || entry.blockingPids.length !== 1 ||
    entry.blockingPids[0] !== marker.backendPid
  ) fail();
});
const markerSha256 = sha256(bytes);
const expectedMarkerSha256 = process.env.FAOLLA_EXPECTED_MARKER_SHA256 ?? "";
if (expectedMarkerSha256 && markerSha256 !== expectedMarkerSha256) fail();
for (const [key, value] of [
  ["READINESS_FENCE_BACKEND_PID", marker.backendPid],
  ["READINESS_FENCE_APPLICATION_NAME", marker.applicationName],
  ["READINESS_FENCE_MARKER_SHA256", markerSha256],
]) process.stdout.write(`${key}\0${value}\0`);
NODE
  )
  [ "$marker_value_count" -eq 3 ]
}

assert_readiness_fence_database_locks() {
  local lock_state
  lock_state="$(
    timeout --signal=TERM --kill-after=5s \
      "${READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS}s" \
    docker exec --interactive \
      --env "FAOLLA_FENCE_APPLICATION_NAME=$READINESS_FENCE_APPLICATION_NAME" \
      --env "FAOLLA_FENCE_BACKEND_PID=$READINESS_FENCE_BACKEND_PID" \
      "$RELEASE_DATABASE_CONTAINER_ID" sh -c '
        set -eu
        : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
        : "${POSTGRES_DB:?POSTGRES_DB is required}"
        : "${FAOLLA_FENCE_APPLICATION_NAME:?FAOLLA_FENCE_APPLICATION_NAME is required}"
        : "${FAOLLA_FENCE_BACKEND_PID:?FAOLLA_FENCE_BACKEND_PID is required}"
        export PGPASSWORD="$POSTGRES_PASSWORD"
        exec psql --host=localhost --username=supabase_admin --dbname="$POSTGRES_DB" \
          --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
          --set=fence_application_name="$FAOLLA_FENCE_APPLICATION_NAME" \
          --set=fence_backend_pid="$FAOLLA_FENCE_BACKEND_PID" \
          --quiet --tuples-only --no-align
      ' <<'SQL'
WITH target AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.pid = :'fence_backend_pid'::integer
    AND activity.application_name = :'fence_application_name'::text
    AND activity.datid = (
      SELECT database.oid
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = pg_catalog.current_database()
    )
), lock_counts AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'ShareLock' AND lock.granted
    ) AS auth_share,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS auth_ax,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'public.pages'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS pages_ax,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'public.faolla_schema_migrations'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS registry_ax
  FROM target
  LEFT JOIN pg_catalog.pg_locks AS lock ON lock.pid = target.pid
), blocked_waiters AS MATERIALIZED (
  SELECT DISTINCT activity.pid
  FROM target
  JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid <> target.pid
  JOIN pg_catalog.pg_locks AS waiting_lock ON waiting_lock.pid = activity.pid
  WHERE NOT waiting_lock.granted
    AND target.pid = ANY(pg_catalog.pg_blocking_pids(activity.pid))
), cancelled_waiters AS MATERIALIZED (
  SELECT pg_catalog.pg_cancel_backend(blocked_waiters.pid) AS cancelled
  FROM blocked_waiters
)
SELECT
  (
    (SELECT pg_catalog.count(*) FROM target) = 1
    AND lock_counts.auth_share = 1
    AND lock_counts.auth_ax = 0
    AND lock_counts.pages_ax = 0
    AND lock_counts.registry_ax = 1
  ) AS locks_held,
  ((SELECT pg_catalog.count(*) FROM blocked_waiters) <> 0) AS had_waiters,
  pg_catalog.coalesce(
    (SELECT pg_catalog.bool_and(cancelled_waiters.cancelled) FROM cancelled_waiters),
    true
  ) AS all_cancelled
FROM lock_counts
\gset fence_

\if :fence_had_waiters
SELECT pg_catalog.pg_sleep(1) AS cancellation_wait
\gset fence_wait_
SELECT pg_catalog.pg_stat_clear_snapshot() AS cleared
\gset fence_snapshot_
\endif

WITH target AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.pid = :'fence_backend_pid'::integer
    AND activity.application_name = :'fence_application_name'::text
    AND activity.datid = (
      SELECT database.oid
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = pg_catalog.current_database()
    )
), lock_counts AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'ShareLock' AND lock.granted
    ) AS auth_share,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'auth.users'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS auth_ax,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'public.pages'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS pages_ax,
    pg_catalog.count(*) FILTER (
      WHERE lock.relation = 'public.faolla_schema_migrations'::pg_catalog.regclass
        AND lock.mode = 'AccessExclusiveLock' AND lock.granted
    ) AS registry_ax
  FROM target
  LEFT JOIN pg_catalog.pg_locks AS lock ON lock.pid = target.pid
), blocked_waiters AS MATERIALIZED (
  SELECT DISTINCT activity.pid
  FROM target
  JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid <> target.pid
  JOIN pg_catalog.pg_locks AS waiting_lock ON waiting_lock.pid = activity.pid
  WHERE NOT waiting_lock.granted
    AND target.pid = ANY(pg_catalog.pg_blocking_pids(activity.pid))
)
SELECT CASE
  WHEN NOT :'fence_locks_held'::boolean
    OR (SELECT pg_catalog.count(*) FROM target) <> 1
    OR lock_counts.auth_share <> 1
    OR lock_counts.auth_ax <> 0
    OR lock_counts.pages_ax <> 0
    OR lock_counts.registry_ax <> 1
    OR NOT :'fence_all_cancelled'::boolean
    OR (SELECT pg_catalog.count(*) FROM blocked_waiters) <> 0
  THEN 'not_held'
  WHEN :'fence_had_waiters'::boolean THEN 'blocked_cancelled'
  ELSE 'held'
END
FROM lock_counts;
SQL
  )"
  case "$lock_state" in
    held) return 0 ;;
    blocked_cancelled)
      echo "[deploy] readiness fence cancelled a newly queued database waiter; deployment will fail closed"
      return 1
      ;;
    *) return 1 ;;
  esac
}

readiness_fence_process_identity_sha256() {
  timeout --signal=TERM --kill-after=1s 2s \
    node --input-type=module - "$READINESS_FENCE_PID" "$RELEASE_DIR" <<'NODE'
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";

const pid = process.argv[2];
if (!/^[1-9][0-9]*$/.test(pid ?? "")) process.exit(1);
const proc = `/proc/${pid}`;
let rawStat;
let executable;
let cwd;
let executableIdentity;
let cwdIdentity;
try {
  rawStat = readFileSync(`${proc}/stat`, "utf8");
  executable = realpathSync(readlinkSync(`${proc}/exe`));
  cwd = realpathSync(readlinkSync(`${proc}/cwd`));
  executableIdentity = statSync(executable, { bigint: true });
  cwdIdentity = statSync(cwd, { bigint: true });
} catch { process.exit(1); }
const close = rawStat.lastIndexOf(")");
const fields = close >= 0 ? rawStat.slice(close + 2).trim().split(/\s+/) : [];
const startTicks = fields[19];
if (
  !/^[1-9][0-9]*$/.test(startTicks ?? "") ||
  fields[0] === "Z" ||
  !/^node(?:js)?$/.test(basename(executable)) ||
  cwd !== realpathSync(process.argv[3])
) process.exit(1);
const identity = JSON.stringify({
  pid,
  startTicks,
  executable,
  executableDev: String(executableIdentity.dev),
  executableIno: String(executableIdentity.ino),
  cwd,
  cwdDev: String(cwdIdentity.dev),
  cwdIno: String(cwdIdentity.ino),
});
process.stdout.write(createHash("sha256").update(identity).digest("hex"));
NODE
}

readiness_fence_process_start_ticks() {
  timeout --signal=TERM --kill-after=1s 2s \
    node --input-type=module - "$READINESS_FENCE_PID" "$RELEASE_DIR" <<'NODE'
import { readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename } from "node:path";

const pid = process.argv[2];
if (!/^[1-9][0-9]*$/.test(pid ?? "")) process.exit(1);
let rawStat;
let cwd;
let executable;
try {
  rawStat = readFileSync(`/proc/${pid}/stat`, "utf8");
  cwd = realpathSync(readlinkSync(`/proc/${pid}/cwd`));
  executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
} catch { process.exit(1); }
const close = rawStat.lastIndexOf(")");
const fields = close >= 0 ? rawStat.slice(close + 2).trim().split(/\s+/) : [];
const startTicks = fields[19];
if (
  !/^[1-9][0-9]*$/.test(startTicks ?? "") || fields[0] === "Z" ||
  !/^(?:bash|node|nodejs)$/.test(basename(executable)) ||
  cwd !== realpathSync(process.argv[3])
) process.exit(1);
process.stdout.write(startTicks);
NODE
}

readiness_fence_original_process_matches() {
  local current_start_ticks
  if [ -z "${READINESS_FENCE_PROCESS_START_TICKS:-}" ] \
    || ! current_start_ticks="$(readiness_fence_process_start_ticks)"; then
    return 1
  fi
  [ "$current_start_ticks" = "$READINESS_FENCE_PROCESS_START_TICKS" ]
}

readiness_fence_process_identity_matches() {
  local current_identity
  if [ -z "${READINESS_FENCE_PROCESS_IDENTITY_SHA256:-}" ] \
    || ! current_identity="$(readiness_fence_process_identity_sha256)"; then
    return 1
  fi
  [ "$current_identity" = "$READINESS_FENCE_PROCESS_IDENTITY_SHA256" ]
}

assert_readiness_fence_held() {
  local minimum_hold_remaining_seconds="${1:-0}"
  [ "${READINESS_FENCE_ACTIVE:-0}" = "1" ] \
    && [ "${READINESS_FENCE_RELEASED:-0}" = "0" ] \
    && readiness_fence_process_identity_matches \
    && validate_readiness_fence_marker "$minimum_hold_remaining_seconds" \
    && assert_readiness_fence_database_locks \
    && readiness_fence_process_identity_matches
}

assert_readiness_fence_forward_checkpoint() {
  assert_readiness_fence_held "$((
    READINESS_FENCE_ROLLBACK_RESERVE_SECONDS +
    READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS
  ))"
}

assert_readiness_fence_before_forward_operation() {
  local operation_timeout_seconds="$1"
  if ! [[ "$operation_timeout_seconds" =~ ^[0-9]+$ ]]; then return 1; fi
  assert_readiness_fence_held "$((
    READINESS_FENCE_ROLLBACK_RESERVE_SECONDS +
    READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS +
    operation_timeout_seconds +
    READINESS_FENCE_OPERATION_MARGIN_SECONDS
  ))"
}

cleanup_readiness_fence_files() {
  local cleanup_status=0
  if [ -n "${READINESS_FENCE_DIR:-}" ]; then
    case "$READINESS_FENCE_DIR" in
      "$SHARED_RUNTIME_DIR"/.readiness-fence.*) ;;
      *) return 1 ;;
    esac
  fi
  if [ -n "${READINESS_FENCE_MARKER:-}" ]; then
    rm -f -- "$READINESS_FENCE_MARKER" || cleanup_status=1
  fi
  if [ -n "${READINESS_FENCE_RELEASE_REQUEST:-}" ]; then
    rm -f -- "$READINESS_FENCE_RELEASE_REQUEST" || cleanup_status=1
  fi
  if [ -n "${READINESS_FENCE_LOG:-}" ]; then
    rm -f -- "$READINESS_FENCE_LOG" || cleanup_status=1
  fi
  if [ -n "${READINESS_FENCE_DIR:-}" ] && [ -d "$READINESS_FENCE_DIR" ]; then
    rmdir -- "$READINESS_FENCE_DIR" 2>/dev/null || cleanup_status=1
  fi
  unset READINESS_FENCE_RELEASE_TOKEN
  return "$cleanup_status"
}

fail_readiness_fence_start() {
  READINESS_FENCE_ACTIVE=0
  READINESS_FENCE_RELEASED=0
  READINESS_FENCE_RELEASE_REQUESTED=0
  if ! cleanup_readiness_fence_files >/dev/null 2>&1; then
    echo "[deploy] readiness fence cleanup could not be proven: readiness_fence_cleanup_unverified"
  fi
  READINESS_FENCE_PID=""
  READINESS_FENCE_DIR=""
  READINESS_FENCE_MARKER=""
  READINESS_FENCE_RELEASE_REQUEST=""
  READINESS_FENCE_LOG=""
  READINESS_FENCE_MARKER_SHA256=""
  READINESS_FENCE_BACKEND_PID=""
  READINESS_FENCE_APPLICATION_NAME=""
  READINESS_FENCE_PROCESS_IDENTITY_SHA256=""
  READINESS_FENCE_PROCESS_START_TICKS=""
  return 1
}

readiness_fence_safe_failure_record() {
  local helper_module="$RELEASE_DIR/scripts/hold-ordinary-account-cutover-readiness-fence.mjs"
  if [ -z "${READINESS_FENCE_LOG:-}" ] \
    || [ -z "${RELEASE_DIR:-}" ] \
    || [ ! -f "$helper_module" ] \
    || [ -L "$helper_module" ]; then
    return 1
  fi
  timeout --signal=TERM --kill-after=1s 2s \
    node --input-type=module - "$READINESS_FENCE_LOG" "$helper_module" <<'NODE'
import { pathToFileURL } from "node:url";

const [logPath, modulePath] = process.argv.slice(2);
try {
  const module = await import(pathToFileURL(modulePath).href);
  const record =
    await module.readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath);
  if (record === null) process.exit(1);
  const bytes = Buffer.from(JSON.stringify(record), "utf8");
  if (bytes.length === 0 || bytes.length > 512 || bytes.includes(0x0a)) {
    process.exit(1);
  }
  process.stdout.write(bytes);
} catch {
  process.exit(1);
}
NODE
}

report_readiness_fence_failure() {
  local failure_record=""
  if failure_record="$(readiness_fence_safe_failure_record 2>/dev/null)" \
    && [ -n "$failure_record" ] \
    && [ "${#failure_record}" -le 512 ] \
    && [[ "$failure_record" != *$'\n'* ]]; then
    echo "[deploy] readiness fence helper failure $failure_record"
  else
    echo "[deploy] readiness fence helper failure readiness_fence_diagnostic_unavailable"
  fi
}

reject_failed_readiness_fence() {
  report_readiness_fence_failure
  if discard_failed_readiness_fence; then
    echo "[deploy] readiness fence cleanup completed"
  else
    echo "[deploy] readiness fence cleanup could not be proven: readiness_fence_cleanup_unverified"
  fi
  return 1
}

start_readiness_fence() {
  local attempt
  local identity_deadline
  local startup_deadline
  local readiness_fence_parent
  READINESS_FENCE_PID=""
  READINESS_FENCE_DIR=""
  READINESS_FENCE_MARKER=""
  READINESS_FENCE_RELEASE_REQUEST=""
  READINESS_FENCE_LOG=""
  READINESS_FENCE_RELEASE_TOKEN=""
  READINESS_FENCE_PROCESS_IDENTITY_SHA256=""
  READINESS_FENCE_PROCESS_START_TICKS=""
  if ! READINESS_FENCE_DIR="$(mktemp -d "$SHARED_RUNTIME_DIR/.readiness-fence.XXXXXX")"; then
    echo "[deploy] failed to create the private readiness fence directory"
    fail_readiness_fence_start
    return 1
  fi
  readiness_fence_parent="$(readlink -f "$(dirname "$READINESS_FENCE_DIR")" 2>/dev/null || true)"
  if [ -z "$READINESS_FENCE_DIR" ] \
    || [ -L "$READINESS_FENCE_DIR" ] \
    || [ ! -d "$READINESS_FENCE_DIR" ] \
    || [ "$readiness_fence_parent" != "$(readlink -f "$SHARED_RUNTIME_DIR" 2>/dev/null || true)" ]; then
    echo "[deploy] private readiness fence directory identity is invalid"
    fail_readiness_fence_start
    return 1
  fi
  if ! chmod 700 "$READINESS_FENCE_DIR"; then
    echo "[deploy] failed to protect the readiness fence directory"
    fail_readiness_fence_start
    return 1
  fi
  READINESS_FENCE_MARKER="$READINESS_FENCE_DIR/ready.json"
  READINESS_FENCE_RELEASE_REQUEST="$READINESS_FENCE_DIR/release.json"
  READINESS_FENCE_LOG="$READINESS_FENCE_DIR/helper.log"
  if ! READINESS_FENCE_RELEASE_TOKEN="$(timeout --signal=TERM --kill-after=1s 5s node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"));')" \
    || ! [[ "$READINESS_FENCE_RELEASE_TOKEN" =~ ^[0-9a-f]{64}$ ]]; then
    echo "[deploy] failed to create the private readiness fence release token"
    fail_readiness_fence_start
    return 1
  fi
  if ! : > "$READINESS_FENCE_LOG" || ! chmod 600 "$READINESS_FENCE_LOG"; then
    echo "[deploy] failed to create the private readiness fence log"
    fail_readiness_fence_start
    return 1
  fi
  READINESS_FENCE_MARKER_SHA256=""
  READINESS_FENCE_BACKEND_PID=""
  READINESS_FENCE_APPLICATION_NAME=""
  (
    cd "$RELEASE_DIR"
    export SUPABASE_INTERNAL_URL="$FINAL_SUPABASE_INTERNAL_URL"
    export NEXT_PUBLIC_SUPABASE_URL="$FINAL_NEXT_PUBLIC_SUPABASE_URL"
    export NEXT_PUBLIC_SUPABASE_ANON_KEY="$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY"
    export FAOLLA_READINESS_FENCE_RELEASE_TOKEN="$READINESS_FENCE_RELEASE_TOKEN"
    exec node scripts/hold-ordinary-account-cutover-readiness-fence.mjs hold \
      --attestation "$DEPLOY_ATTESTATION_FILE" \
      --expected-target-sha "$EXPECTED_DEPLOY_SHA" \
      --expected-run-id "$RELEASE_READINESS_RUN_ID" \
      --expected-run-attempt "$RELEASE_READINESS_RUN_ATTEMPT" \
      --expected-artifact-id "$RELEASE_READINESS_REPORT_ARTIFACT_ID" \
      --expected-artifact-digest "$RELEASE_READINESS_REPORT_ARTIFACT_DIGEST" \
      --expected-attestation-sha256 "$RELEASE_CANONICAL_SHA256" \
      --expected-container-id "$RELEASE_DATABASE_CONTAINER_ID" \
      --minimum-remaining-ttl-seconds "$READINESS_FENCE_MINIMUM_TTL_SECONDS" \
      --ready-marker "$READINESS_FENCE_MARKER" \
      --release-request "$READINESS_FENCE_RELEASE_REQUEST" \
      --maximum-hold-seconds "$READINESS_FENCE_MAXIMUM_HOLD_SECONDS"
  ) > "$READINESS_FENCE_LOG" 2>&1 &
  READINESS_FENCE_PID=$!
  if ! [[ "$READINESS_FENCE_PID" =~ ^[1-9][0-9]*$ ]]; then
    echo "[deploy] readiness fence helper did not expose an exact process id"
    fail_readiness_fence_start
    return 1
  fi
  identity_deadline=$((SECONDS + 10))
  while [ "$SECONDS" -lt "$identity_deadline" ]; do
    if READINESS_FENCE_PROCESS_START_TICKS="$(readiness_fence_process_start_ticks 2>/dev/null)" \
      && [[ "$READINESS_FENCE_PROCESS_START_TICKS" =~ ^[1-9][0-9]*$ ]]; then
      break
    fi
    READINESS_FENCE_PROCESS_START_TICKS=""
    if ! kill -0 "$READINESS_FENCE_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [ -z "$READINESS_FENCE_PROCESS_START_TICKS" ]; then
    echo "[deploy] readiness fence helper start identity could not be frozen"
    READINESS_FENCE_ACTIVE=1
    reject_failed_readiness_fence
    return 1
  fi
  identity_deadline=$((SECONDS + 10))
  while [ "$SECONDS" -lt "$identity_deadline" ]; do
    if READINESS_FENCE_PROCESS_IDENTITY_SHA256="$(readiness_fence_process_identity_sha256 2>/dev/null)" \
      && [[ "$READINESS_FENCE_PROCESS_IDENTITY_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
      break
    fi
    READINESS_FENCE_PROCESS_IDENTITY_SHA256=""
    if ! kill -0 "$READINESS_FENCE_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [ -z "$READINESS_FENCE_PROCESS_IDENTITY_SHA256" ]; then
    echo "[deploy] readiness fence helper process identity could not be frozen"
    READINESS_FENCE_ACTIVE=1
    reject_failed_readiness_fence
    return 1
  fi
  READINESS_FENCE_ACTIVE=1
  READINESS_FENCE_RELEASED=0
  READINESS_FENCE_RELEASE_REQUESTED=0
  startup_deadline=$((SECONDS + READINESS_FENCE_STARTUP_WAIT_SECONDS))
  while [ "$SECONDS" -lt "$startup_deadline" ]; do
    if [ -e "$READINESS_FENCE_MARKER" ] || [ -L "$READINESS_FENCE_MARKER" ]; then
      if assert_readiness_fence_before_forward_operation "$((
        AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS +
        WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS +
        PORT_RELEASE_TOTAL_TIMEOUT_SECONDS
      ))"; then
        return 0
      fi
      break
    fi
    if ! readiness_fence_process_identity_matches; then
      echo "[deploy] readiness fence exited or changed identity before its ready marker"
      # The helper may have died while its docker/psql descendant and database
      # transaction remained alive. Keep the holder PID trust root and use the
      # exact prefix cleanup path; failure is not returned until the database
      # proves that no matching session remains.
      reject_failed_readiness_fence
      return 1
    fi
    sleep 1
  done
  echo "[deploy] readiness fence failed to produce verifiable held evidence"
  reject_failed_readiness_fence
  return 1
}

release_readiness_fence() {
  local helper_status
  local release_deadline
  if ! assert_readiness_fence_held; then
    echo "[deploy] refusing to release an unverified readiness fence"
    return 1
  fi
  READINESS_FENCE_RELEASE_REQUESTED=1
  if ! (
    cd "$RELEASE_DIR"
    FAOLLA_READINESS_FENCE_RELEASE_TOKEN="$READINESS_FENCE_RELEASE_TOKEN" \
      timeout --signal=TERM --kill-after=1s 5s \
        node --input-type=module - \
        "$READINESS_FENCE_RELEASE_REQUEST" "$READINESS_FENCE_MARKER_SHA256" <<'NODE'
import { canonicalJsonBytes } from "./scripts/production-release-attestation.mjs";
import { writeAtomicReadinessFenceMarker } from "./scripts/hold-ordinary-account-cutover-readiness-fence.mjs";

const token = process.env.FAOLLA_READINESS_FENCE_RELEASE_TOKEN ?? "";
const markerSha256 = process.argv[3];
if (!/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(markerSha256)) process.exit(1);
await writeAtomicReadinessFenceMarker(
  process.argv[2],
  canonicalJsonBytes({
    schemaVersion: 1,
    kind: "faolla.ordinary-account-cutover-readiness-fence-release.v1",
    markerSha256,
    releaseToken: token,
  }),
);
NODE
  ); then
    echo "[deploy] failed to publish the canonical readiness fence release request"
    return 1
  fi
  release_deadline=$((SECONDS + READINESS_FENCE_RELEASE_WAIT_SECONDS))
  while [ "$SECONDS" -lt "$release_deadline" ]; do
    if ! readiness_fence_process_identity_matches; then break; fi
    sleep 1
  done
  if readiness_fence_process_identity_matches; then
    echo "[deploy] readiness fence did not exit after its authorized release request"
    return 1
  fi
  if wait "$READINESS_FENCE_PID"; then helper_status=0; else helper_status=$?; fi
  if [ "$helper_status" -ne 0 ]; then
    echo "[deploy] readiness fence rejected its release request"
    return 1
  fi
  if ! (
    cd "$RELEASE_DIR"
    timeout --signal=TERM --kill-after=1s 5s \
      node --input-type=module - \
      "$READINESS_FENCE_LOG" "$READINESS_FENCE_BACKEND_PID" "$READINESS_FENCE_MARKER_SHA256" <<'NODE'
import { readFileSync } from "node:fs";
import { canonicalJsonBytes } from "./scripts/production-release-attestation.mjs";

const bytes = readFileSync(process.argv[2]);
let value;
try { value = JSON.parse(bytes.toString("utf8")); } catch { process.exit(1); }
const keys = Object.keys(value).sort();
const expected = ["backendPid", "markerSha256", "markerSizeBytes", "ok"].sort();
if (
  !bytes.equals(canonicalJsonBytes(value)) ||
  keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
  value.ok !== true || value.backendPid !== process.argv[3] ||
  value.markerSha256 !== process.argv[4] || !/^[1-9][0-9]*$/.test(value.markerSizeBytes ?? "")
) process.exit(1);
NODE
  ); then
    echo "[deploy] readiness fence success evidence is invalid"
    return 1
  fi
  if [ -e "$READINESS_FENCE_MARKER" ] || [ -L "$READINESS_FENCE_MARKER" ] \
    || [ -e "$READINESS_FENCE_RELEASE_REQUEST" ] || [ -L "$READINESS_FENCE_RELEASE_REQUEST" ]; then
    echo "[deploy] readiness fence left private marker or release-request state behind"
    return 1
  fi
  READINESS_FENCE_ACTIVE=0
  READINESS_FENCE_RELEASED=1
  READINESS_FENCE_RELEASE_REQUESTED=0
  cleanup_readiness_fence_files || return 1
}

terminate_readiness_fence_database_session() {
  local cleanup_output
  if [ -z "${READINESS_FENCE_PID:-}" ]; then
    return 0
  fi
  if ! [[ "$READINESS_FENCE_PID" =~ ^[1-9][0-9]*$ ]] \
    || [ -z "${RELEASE_DATABASE_CONTAINER_ID:-}" ]; then
    return 1
  fi
  if [ -n "${READINESS_FENCE_APPLICATION_NAME:-}" ] \
    && { ! [[ "$READINESS_FENCE_APPLICATION_NAME" =~ ^faolla_readiness_fence_${READINESS_FENCE_PID}_[0-9a-f]{24}$ ]] \
      || ! [[ "${READINESS_FENCE_BACKEND_PID:-}" =~ ^[1-9][0-9]*$ ]]; }; then
    return 1
  fi
  if ! cleanup_output="$(
    timeout --signal=TERM --kill-after=5s \
      "${READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS}s" \
      docker exec --interactive \
        --env "FAOLLA_FENCE_HOLDER_PID=$READINESS_FENCE_PID" \
        --env "FAOLLA_FENCE_APPLICATION_NAME=${READINESS_FENCE_APPLICATION_NAME:-}" \
        --env "FAOLLA_FENCE_BACKEND_PID=${READINESS_FENCE_BACKEND_PID:-}" \
        "$RELEASE_DATABASE_CONTAINER_ID" sh -c '
          set -eu
          : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
          : "${POSTGRES_DB:?POSTGRES_DB is required}"
          : "${FAOLLA_FENCE_HOLDER_PID:?FAOLLA_FENCE_HOLDER_PID is required}"
          export PGPASSWORD="$POSTGRES_PASSWORD"
          export PGOPTIONS="-c lock_timeout=5s -c statement_timeout=12s"
          exec psql --host=localhost --username=supabase_admin --dbname="$POSTGRES_DB" \
            --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
            --set=fence_holder_pid="$FAOLLA_FENCE_HOLDER_PID" \
            --set=fence_application_name="$FAOLLA_FENCE_APPLICATION_NAME" \
            --set=fence_backend_pid="$FAOLLA_FENCE_BACKEND_PID" \
            --quiet --tuples-only --no-align
        ' <<'SQL'
WITH matching_sessions AS MATERIALIZED (
  SELECT activity.pid
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.datid = (
      SELECT database.oid
      FROM pg_catalog.pg_database AS database
      WHERE database.datname = pg_catalog.current_database()
    )
    AND activity.pid <> pg_catalog.pg_backend_pid()
    AND (
      (
        :'fence_application_name'::text <> ''::text
        AND activity.application_name = :'fence_application_name'::text
        AND activity.pid = NULLIF(:'fence_backend_pid'::text, ''::text)::integer
      )
      OR (
        :'fence_application_name'::text = ''::text
        AND activity.application_name OPERATOR(pg_catalog.~)
          ('^faolla_readiness_fence_'::text || :'fence_holder_pid'::text || '_[0-9a-f]{24}$'::text)
      )
    )
), matching_count AS MATERIALIZED (
  SELECT pg_catalog.count(*) AS value FROM matching_sessions
), blocked_waiters AS MATERIALIZED (
  SELECT DISTINCT activity.pid
  FROM matching_sessions
  JOIN pg_catalog.pg_stat_activity AS activity
    ON activity.pid <> matching_sessions.pid
  JOIN pg_catalog.pg_locks AS waiting_lock ON waiting_lock.pid = activity.pid
  WHERE NOT waiting_lock.granted
    AND matching_sessions.pid = ANY(pg_catalog.pg_blocking_pids(activity.pid))
), terminated_waiters AS MATERIALIZED (
  SELECT pg_catalog.pg_terminate_backend(blocked_waiters.pid, 5000) AS ok
  FROM blocked_waiters
), waiter_counts AS MATERIALIZED (
  SELECT
    (SELECT pg_catalog.count(*) FROM blocked_waiters) AS blocked_count,
    pg_catalog.count(*) FILTER (WHERE terminated_waiters.ok) AS terminated_count
  FROM terminated_waiters
), terminated AS MATERIALIZED (
  SELECT pg_catalog.pg_terminate_backend(matching_sessions.pid, 5000) AS ok
  FROM matching_sessions
  WHERE (SELECT matching_count.value FROM matching_count) = 1
    AND (SELECT waiter_counts.blocked_count FROM waiter_counts) =
        (SELECT waiter_counts.terminated_count FROM waiter_counts)
)
SELECT pg_catalog.json_build_object(
  'matchedCount', (SELECT matching_count.value::text FROM matching_count),
  'terminatedCount', pg_catalog.count(*) FILTER (WHERE terminated.ok)::text,
  'blockedWaiterCount', (SELECT waiter_counts.blocked_count::text FROM waiter_counts),
  'terminatedWaiterCount', (SELECT waiter_counts.terminated_count::text FROM waiter_counts)
)::text
FROM terminated;

SELECT pg_catalog.json_build_object(
  'remainingCount', pg_catalog.count(*)::text
)::text
FROM pg_catalog.pg_stat_activity AS activity
WHERE activity.datid = (
    SELECT database.oid
    FROM pg_catalog.pg_database AS database
    WHERE database.datname = pg_catalog.current_database()
  )
  AND activity.pid <> pg_catalog.pg_backend_pid()
  AND (
    (
      :'fence_application_name'::text <> ''::text
      AND activity.application_name = :'fence_application_name'::text
      AND activity.pid = NULLIF(:'fence_backend_pid'::text, ''::text)::integer
    )
    OR (
      :'fence_application_name'::text = ''::text
      AND activity.application_name OPERATOR(pg_catalog.~)
        ('^faolla_readiness_fence_'::text || :'fence_holder_pid'::text || '_[0-9a-f]{24}$'::text)
    )
  );
SQL
  )"; then
    return 1
  fi
  FAOLLA_FENCE_CLEANUP_OUTPUT="$cleanup_output" node --input-type=module <<'NODE'
const lines = (process.env.FAOLLA_FENCE_CLEANUP_OUTPUT ?? "")
  .split(/\r?\n/)
  .filter(Boolean);
if (lines.length !== 2) process.exit(1);
let counts;
let remaining;
try {
  counts = JSON.parse(lines[0]);
  remaining = JSON.parse(lines[1]);
} catch { process.exit(1); }
const exact = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
if (
  !exact(counts, ["matchedCount", "terminatedCount", "blockedWaiterCount", "terminatedWaiterCount"]) ||
  !exact(remaining, ["remainingCount"]) ||
  !/^[01]$/.test(counts.matchedCount ?? "") ||
  !/^(?:0|[1-9][0-9]*)$/.test(counts.blockedWaiterCount ?? "") ||
  counts.terminatedWaiterCount !== counts.blockedWaiterCount ||
  counts.terminatedCount !== counts.matchedCount ||
  remaining.remainingCount !== "0"
) process.exit(1);
NODE
}

discard_failed_readiness_fence() {
  local cleanup_status=0
  local process_deadline
  local original_process_alive=0
  if readiness_fence_original_process_matches; then
    original_process_alive=1
    kill -TERM "$READINESS_FENCE_PID" 2>/dev/null || cleanup_status=1
    process_deadline=$((SECONDS + 15))
    while [ "$SECONDS" -lt "$process_deadline" ]; do
      if ! readiness_fence_original_process_matches; then
        original_process_alive=0
        break
      fi
      sleep 1
    done
  fi
  # The helper may have died before publishing (or after its release request),
  # so independently bind cleanup to its random holder-PID application name and
  # require the attested database to contain zero matching sessions afterward.
  terminate_readiness_fence_database_session || cleanup_status=1
  if readiness_fence_original_process_matches; then
    kill -KILL "$READINESS_FENCE_PID" 2>/dev/null || cleanup_status=1
    process_deadline=$((SECONDS + 5))
    while [ "$SECONDS" -lt "$process_deadline" ]; do
      if ! readiness_fence_original_process_matches; then
        original_process_alive=0
        break
      fi
      sleep 1
    done
  fi
  if readiness_fence_original_process_matches; then original_process_alive=1; fi
  if [ "$original_process_alive" = "1" ]; then
    cleanup_status=1
  elif [ -n "${READINESS_FENCE_PID:-}" ]; then
    wait "$READINESS_FENCE_PID" 2>/dev/null || true
  fi
  READINESS_FENCE_ACTIVE=0
  cleanup_readiness_fence_files || cleanup_status=1
  return "$cleanup_status"
}

ensure_readiness_fence_for_rollback() {
  local attempt
  if [ "${READINESS_FENCE_ACTIVE:-0}" = "1" ] \
    && [ "${READINESS_FENCE_RELEASE_REQUESTED:-0}" = "0" ]; then
    for attempt in $(seq 1 3); do
      if assert_readiness_fence_held "$((READINESS_FENCE_ROLLBACK_RESERVE_SECONDS + READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS))"; then return 0; fi
      sleep 1
    done
  fi
  echo "[deploy] readiness fence exited unexpectedly; revalidating and reacquiring before rollback"
  discard_failed_readiness_fence || return 1
  start_readiness_fence || return 1
  assert_readiness_fence_held "$((READINESS_FENCE_ROLLBACK_RESERVE_SECONDS + READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS))" || return 1
}

cleanup_old_releases() {
  local current_release
  local index=0
  local release_dir
  current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  while IFS= read -r release_dir; do
    [ -n "$release_dir" ] || continue
    if [ "$release_dir" = "$current_release" ]; then
      continue
    fi
    index=$((index + 1))
    if [ "$index" -ge "$RELEASE_KEEP_COUNT" ]; then
      safe_remove_release_path "$release_dir"
    fi
  done < <(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*.building' -printf '%T@ %p\n' \
      | sort -nr \
      | cut -d' ' -f2-
  )
}

mkdir -p "$RELEASES_DIR" "$SHARED_RUNTIME_DIR"
chmod 755 "$RELEASES_DIR"
cleanup_stale_build_dirs
RELEASE_STAMP="$(date -u +"%Y%m%d%H%M%S")"
RELEASE_NAME="${FAOLLA_WEB_BUILD_ID:0:12}-${RELEASE_STAMP}"
RELEASE_BUILD_DIR="$RELEASES_DIR/.${RELEASE_NAME}.building"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
PREVIOUS_AUTOMATION_WORKER_RUNNING=0
if pm2_process_has_pid "$AUTOMATION_WORKER_NAME"; then
  PREVIOUS_AUTOMATION_WORKER_RUNNING=1
fi
SWITCH_COMPLETED=0
PROCESSES_STOPPED=0
DEPLOY_HEALTHY=0
WEB_COMMITTED=0
ROLLBACK_COMPLETED=0
READINESS_FENCE_ACTIVE=0
READINESS_FENCE_RELEASED=0
READINESS_FENCE_RELEASE_REQUESTED=0
READINESS_FENCE_PID=""
READINESS_FENCE_DIR=""
READINESS_FENCE_MARKER=""
READINESS_FENCE_RELEASE_REQUEST=""
READINESS_FENCE_LOG=""
READINESS_FENCE_RELEASE_TOKEN=""
READINESS_FENCE_PROCESS_IDENTITY_SHA256=""
READINESS_FENCE_PROCESS_START_TICKS=""
LEGACY_COMPATIBILITY_LINKS_INSTALLED=0

rollback_release() {
  if { [ "$SWITCH_COMPLETED" != "1" ] && [ "$PROCESSES_STOPPED" != "1" ]; } \
    || [ "$WEB_COMMITTED" = "1" ]; then
    return 0
  fi
  if [ -z "$PREVIOUS_RUNTIME_DIR" ] \
    || [ ! -d "$PREVIOUS_RUNTIME_DIR/.next" ] \
    || ! [[ "$PREVIOUS_BUILD_ID" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[deploy] previous runtime evidence is unavailable for rollback"
    return 1
  fi
  assert_readiness_fence_held "$((READINESS_FENCE_ROLLBACK_RESERVE_SECONDS + READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS))" || return 1
  echo "[deploy] new release failed verification; restoring previous runtime while the readiness fence is held"
  stop_pm2_process_bounded "$AUTOMATION_WORKER_NAME" "$AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS" || return 1
  stop_pm2_process_bounded "$APP_NAME" "$WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS" || return 1
  wait_for_port_release || return 1
  assert_readiness_fence_held || return 1
  restore_legacy_runtime_compatibility_paths || return 1
  assert_readiness_fence_held || return 1
  if [ -n "$PREVIOUS_LINK_TARGET" ] && [ -d "$PREVIOUS_LINK_TARGET/.next" ]; then
    switch_current_release "$PREVIOUS_LINK_TARGET" || return 1
  else
    rm -f -- "$CURRENT_LINK" || return 1
  fi
  assert_readiness_fence_held || return 1
  start_release "$PREVIOUS_RUNTIME_DIR" >/dev/null 2>&1 || return 1
  wait_for_release_health "$PREVIOUS_BUILD_ID" || return 1
  assert_readiness_fence_held || return 1
  ROLLBACK_COMPLETED=1
}

cleanup_failed_build() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  trap '' HUP TERM INT
  set +e
  if [ -d "$RELEASE_BUILD_DIR" ]; then
    safe_remove_release_path "$RELEASE_BUILD_DIR"
  fi
  if [ "$WEB_COMMITTED" = "1" ]; then
    echo "[deploy] post-commit failure: the verified web release remains active and will not be rolled back without a fence"
    if ! stop_pm2_process_bounded "$AUTOMATION_WORKER_NAME" "$AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS"; then
      echo "[deploy] post-commit worker cleanup could not prove the worker offline"
      cleanup_status=1
    fi
  elif [ "$SWITCH_COMPLETED" = "1" ] || [ "$PROCESSES_STOPPED" = "1" ]; then
    if ! ensure_readiness_fence_for_rollback; then
      echo "[deploy] unable to reacquire a readiness fence; refusing an uncertified rollback"
      cleanup_status=1
    elif ! rollback_release; then
      echo "[deploy] rollback failed while the readiness fence was held"
      cleanup_status=1
    elif ! release_readiness_fence; then
      echo "[deploy] rollback restored the previous web process, but fence release failed"
      if ! discard_failed_readiness_fence; then
        echo "[deploy] failed to prove the rejected rollback fence session was removed"
      fi
      cleanup_status=1
    elif [ "$PREVIOUS_AUTOMATION_WORKER_RUNNING" = "1" ]; then
      if ! start_automation_worker_process "$PREVIOUS_RUNTIME_DIR" >/dev/null 2>&1 \
        || ! wait_for_automation_worker_online; then
        echo "[deploy] previous worker failed to restart after the rollback fence was released"
        cleanup_status=1
      fi
    fi
    if [ "$ROLLBACK_COMPLETED" = "1" ]; then
      pm2 save >/dev/null 2>&1 || cleanup_status=1
    fi
  elif [ "$READINESS_FENCE_ACTIVE" = "1" ]; then
    if [ "$READINESS_FENCE_RELEASE_REQUESTED" = "0" ] \
      && assert_readiness_fence_held \
      && release_readiness_fence; then
      :
    else
      discard_failed_readiness_fence
      cleanup_status=1
    fi
  fi
  if [ "$WEB_COMMITTED" != "1" ] \
    && { [ "$SWITCH_COMPLETED" != "1" ] || [ "$ROLLBACK_COMPLETED" = "1" ]; } \
    && [ -d "$RELEASE_DIR" ]; then
    safe_remove_release_path "$RELEASE_DIR" || cleanup_status=1
  fi
  rm -f -- "$DEPLOY_ATTESTATION_FILE" "$DEPLOY_RELEASE_BINDING_FILE"
  if [ "$original_status" -eq 0 ]; then original_status=1; fi
  if [ "$cleanup_status" -ne 0 ]; then original_status=1; fi
  exit "$original_status"
}

handle_deploy_signal() {
  local signal_status="$1"
  # A disconnected SSH channel may deliver more than one signal. Ignore
  # repeats while the EXIT trap performs its bounded database/web cleanup.
  trap '' HUP TERM INT
  exit "$signal_status"
}

trap cleanup_failed_build EXIT
trap 'handle_deploy_signal 129' HUP
trap 'handle_deploy_signal 143' TERM
trap 'handle_deploy_signal 130' INT
safe_remove_release_path "$RELEASE_BUILD_DIR"
mkdir -p "$RELEASE_BUILD_DIR"

echo "[deploy] building isolated release: $RELEASE_DIR"
git archive --format=tar "$EXPECTED_DEPLOY_SHA" | tar -xf - -C "$RELEASE_BUILD_DIR"
cp -p -- "$APP_DIR/.env.local" "$RELEASE_BUILD_DIR/.env.local"

cd "$RELEASE_BUILD_DIR"
echo "[deploy] installing dependencies with up to ${NPM_CI_ATTEMPTS} attempts and a ${NPM_CI_TIMEOUT_SECONDS}s total timeout"
npm_ci_started_at=$SECONDS
npm_status=1
for ((npm_attempt = 1; npm_attempt <= NPM_CI_ATTEMPTS; npm_attempt++)); do
  npm_elapsed_seconds=$((SECONDS - npm_ci_started_at))
  npm_remaining_seconds=$((NPM_CI_TIMEOUT_SECONDS - npm_elapsed_seconds))
  if [ "$npm_remaining_seconds" -lt 1 ]; then
    npm_status=124
    break
  fi

  echo "[deploy] npm ci attempt ${npm_attempt}/${NPM_CI_ATTEMPTS}"
  set +e
  timeout \
    --signal=TERM \
    --kill-after="${NPM_CI_KILL_AFTER_SECONDS}s" \
    "${npm_remaining_seconds}s" \
    npm ci \
      --prefer-offline \
      --no-audit \
      --fetch-retries="$NPM_FETCH_RETRIES" \
      --fetch-retry-mintimeout="$NPM_FETCH_RETRY_MIN_TIMEOUT_MS" \
      --fetch-retry-maxtimeout="$NPM_FETCH_RETRY_MAX_TIMEOUT_MS"
  npm_status=$?
  set -e

  if [ "$npm_status" -eq 0 ]; then
    break
  fi
  if [ "$npm_status" -eq 124 ] || [ "$npm_status" -eq 137 ]; then
    break
  fi
  if [ "$npm_attempt" -ge "$NPM_CI_ATTEMPTS" ]; then
    break
  fi

  npm_elapsed_seconds=$((SECONDS - npm_ci_started_at))
  npm_remaining_seconds=$((NPM_CI_TIMEOUT_SECONDS - npm_elapsed_seconds))
  if [ "$npm_remaining_seconds" -le "$NPM_CI_RETRY_DELAY_SECONDS" ]; then
    npm_status=124
    break
  fi
  echo "[deploy] npm ci attempt ${npm_attempt} failed with status ${npm_status}; retrying in ${NPM_CI_RETRY_DELAY_SECONDS}s"
  sleep "$NPM_CI_RETRY_DELAY_SECONDS"
done

if [ "$npm_status" -ne 0 ]; then
  if [ "$npm_status" -eq 124 ] || [ "$npm_status" -eq 137 ]; then
    echo "[deploy] npm ci exceeded the ${NPM_CI_TIMEOUT_SECONDS}s total timeout"
  else
    echo "[deploy] npm ci failed after ${NPM_CI_ATTEMPTS} attempts with status $npm_status"
  fi
  exit "$npm_status"
fi

if [ -f "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" ]; then
  chmod +x "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" || true
  write_env_value "FFMPEG_PATH" "$RELEASE_BUILD_DIR/node_modules/ffmpeg-static/ffmpeg" "$RELEASE_BUILD_DIR/.env.local"
elif command -v ffmpeg >/dev/null 2>&1; then
  write_env_value "FFMPEG_PATH" "$(command -v ffmpeg)" "$RELEASE_BUILD_DIR/.env.local"
else
  echo "[deploy] warning: ffmpeg binary not found; intro video uploads will not transcode"
fi

SUPABASE_HEALTH_STATUS=0
verify_supabase_health || SUPABASE_HEALTH_STATUS=$?
if [ "$SUPABASE_HEALTH_STATUS" -eq 2 ]; then
  echo "[deploy] warning: Supabase preflight was unreachable after retries; continuing because no configuration or backend validation error was returned"
elif [ "$SUPABASE_HEALTH_STATUS" -ne 0 ]; then
  echo "[deploy] Supabase health check failed with status $SUPABASE_HEALTH_STATUS"
  exit 1
fi
echo "[deploy] building application with a ${BUILD_TIMEOUT_SECONDS}s timeout"
if timeout \
  --signal=TERM \
  --kill-after="${BUILD_KILL_AFTER_SECONDS}s" \
  "${BUILD_TIMEOUT_SECONDS}s" \
  npm run build; then
  :
else
  build_status=$?
  if [ "$build_status" -eq 124 ] || [ "$build_status" -eq 137 ]; then
    echo "[deploy] application build exceeded the ${BUILD_TIMEOUT_SECONDS}s timeout"
  else
    echo "[deploy] application build failed with status $build_status"
  fi
  exit "$build_status"
fi

if [ ! -f "$RELEASE_BUILD_DIR/.next/BUILD_ID" ]; then
  echo "[deploy] isolated build did not produce .next/BUILD_ID"
  exit 1
fi

find "$RELEASE_BUILD_DIR/.next/static" -type f -printf '%P\n' | sort > "$RELEASE_BUILD_DIR/.faolla-current-static-files"
copy_previous_static_assets "$PREVIOUS_RUNTIME_DIR" "$RELEASE_BUILD_DIR"
cleanup_cache_dir "$RELEASE_BUILD_DIR/.next/cache"
if [ -e "$RELEASE_BUILD_DIR/.runtime" ] || [ -L "$RELEASE_BUILD_DIR/.runtime" ]; then
  echo "[deploy] isolated build unexpectedly created a .runtime path"
  exit 1
fi
ln -s "$SHARED_RUNTIME_DIR" "$RELEASE_BUILD_DIR/.runtime"
normalize_and_verify_release_permissions "$RELEASE_BUILD_DIR"
verify_public_static_access_for_nginx "$RELEASE_BUILD_DIR"
mv -- "$RELEASE_BUILD_DIR" "$RELEASE_DIR"

cd "$APP_DIR"
cleanup_rebuildable_caches
report_disk_status
ensure_disk_headroom
prepare_legacy_static_bridge

if [ -z "$PREVIOUS_RUNTIME_DIR" ] \
  || [ ! -d "$PREVIOUS_RUNTIME_DIR/.next" ] \
  || ! [[ "$PREVIOUS_BUILD_ID" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[deploy] a previous release with an exact build id is required before protected process mutation"
  exit 1
fi
echo "[deploy] acquiring ordinary-account cutover readiness fence"
start_readiness_fence || exit 1
assert_readiness_fence_before_forward_operation "$((
  AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS +
  WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS +
  PORT_RELEASE_TOTAL_TIMEOUT_SECONDS
))" || exit 1

PROCESSES_STOPPED=1
stop_pm2_process_bounded "$AUTOMATION_WORKER_NAME" "$AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS" || exit 1
stop_pm2_process_bounded "$APP_NAME" "$WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS" || exit 1
wait_for_port_release || exit 1
assert_readiness_fence_forward_checkpoint || exit 1
assert_readiness_fence_before_forward_operation "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" || exit 1
prepare_shared_runtime || exit 1
assert_readiness_fence_forward_checkpoint || exit 1
assert_readiness_fence_before_forward_operation "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" || exit 1
switch_current_release "$RELEASE_DIR" || exit 1
SWITCH_COMPLETED=1
assert_readiness_fence_forward_checkpoint || exit 1

assert_readiness_fence_before_forward_operation "$RELEASE_PROCESS_START_TIMEOUT_SECONDS" || exit 1
if ! start_release "$RELEASE_DIR"; then
  echo "[deploy] failed to start isolated release"
  exit 1
fi
assert_readiness_fence_forward_checkpoint || exit 1

assert_readiness_fence_before_forward_operation "$((HEALTHCHECK_ATTEMPTS * 5))" || exit 1
if ! wait_for_release_health "$FAOLLA_WEB_BUILD_ID"; then
  echo "[deploy] release health check failed"
  exit 1
fi
assert_readiness_fence_forward_checkpoint || exit 1

BOOKING_PERSISTENCE_STATUS=0
assert_readiness_fence_before_forward_operation "$BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS" || exit 1
verify_booking_persistence || BOOKING_PERSISTENCE_STATUS=$?
if [ "$BOOKING_PERSISTENCE_STATUS" -ne 0 ]; then
  echo "[deploy] booking persistence check failed with status $BOOKING_PERSISTENCE_STATUS"
  exit 1
fi
assert_readiness_fence_forward_checkpoint || exit 1

assert_readiness_fence_before_forward_operation "$RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS" || exit 1
if ! run_local_release_smoke; then
  echo "[deploy] local release smoke check failed"
  exit 1
fi
assert_readiness_fence_forward_checkpoint || exit 1

assert_readiness_fence_before_forward_operation "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" || exit 1
install_runtime_compatibility_links || exit 1
assert_readiness_fence_forward_checkpoint || exit 1
assert_readiness_fence_before_forward_operation "$NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS" || exit 1
verify_nginx_release_static_access || exit 1
assert_readiness_fence_forward_checkpoint || exit 1
echo "[deploy] releasing ordinary-account cutover readiness fence after all web checks"
release_readiness_fence || exit 1
WEB_COMMITTED=1
DEPLOY_HEALTHY=1
finalize_legacy_runtime_compatibility_paths || exit 1
rm -f -- "$DEPLOY_ATTESTATION_FILE" "$DEPLOY_RELEASE_BINDING_FILE" || exit 1

if [ "$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" = "true" ] \
  || [ "$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" = "true" ]; then
  echo "[deploy] starting enterprise worker supervisor"
  if ! start_automation_worker_process "$RELEASE_DIR"; then
    echo "[deploy] failed to start enterprise worker supervisor"
    exit 1
  fi
  if ! wait_for_automation_worker_online; then
    echo "[deploy] enterprise worker supervisor did not remain online"
    exit 1
  fi
else
  echo "[deploy] enterprise worker supervisor is disabled"
fi

if ! pm2 save; then
  echo "[deploy] warning: pm2 save failed after the healthy release was activated"
fi

safe_remove_release_path "$RELEASE_BUILD_DIR"
cleanup_old_releases

trap - EXIT
report_disk_status
echo "[deploy] deploy finished: $RELEASE_NAME"
