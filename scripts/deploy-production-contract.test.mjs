import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  canonicalJsonBytes,
  parseProductionReleaseAttestation,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_READINESS_ATTESTATION_KIND,
  sha256Hex,
} from "./production-release-attestation.mjs";
import {
  readFrozenProductionSupabaseEnvironmentSnapshot,
} from "./read-production-supabase-environment.mjs";

const deployScript = await readFile(
  new URL("./deploy.production.sh", import.meta.url),
  "utf8",
);
const retentionScript = await readFile(
  new URL("./configure-production-log-retention.sh", import.meta.url),
  "utf8",
);
const deployWorkflow = await readFile(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const automationWorker = await readFile(
  new URL("./run-merchant-enterprise-automation-worker.ts", import.meta.url),
  "utf8",
);
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const envCheckUrl = new URL("./check-env.mjs", import.meta.url);
const envCheckScript = await readFile(envCheckUrl, "utf8");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const DEPLOY_ENVELOPE_MAGIC = "FAOLLA_DEPLOY_ENVELOPE_V2";
const DEPLOY_SAFE_DIAGNOSTIC_LINES = Object.freeze([
  "[deploy] deploy_failed_readiness_fence_nonretryable",
  "[deploy] deploy_forward_booking_persistence_hard_failed",
  "[deploy] deploy_forward_booking_persistence_transient_exhausted",
  "[deploy] deploy_forward_booking_persistence_transient_retry",
  "[deploy] deploy_rollback_failed_compatibility_restore",
  "[deploy] deploy_rollback_failed_current_restore",
  "[deploy] deploy_rollback_failed_evidence",
  "[deploy] deploy_rollback_failed_fence_checkpoint",
  "[deploy] deploy_rollback_failed_fence_cleanup",
  "[deploy] deploy_rollback_failed_fence_reacquire",
  "[deploy] deploy_rollback_failed_fence_release",
  "[deploy] deploy_rollback_failed_pm2_save",
  "[deploy] deploy_rollback_failed_port_quiesce",
  "[deploy] deploy_rollback_failed_previous_web_health",
  "[deploy] deploy_rollback_failed_previous_web_start",
  "[deploy] deploy_rollback_failed_release_cleanup",
  "[deploy] deploy_rollback_failed_runtime_restore",
  "[deploy] deploy_rollback_failed_unknown",
  "[deploy] deploy_rollback_failed_web_quiesce",
  "[deploy] deploy_rollback_failed_worker_quiesce",
  "[deploy] deploy_rollback_failed_worker_restart",
  "[deploy] readiness_fence_waiter_cancelled_retry",
  "[deploy] readiness_fence_waiter_retry_exhausted",
]);
const DEPLOY_PAYLOAD_KEYS = [
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
const FIXTURE_NOW_MS = Date.now();
const FIXTURE_TARGET_SHA = "a".repeat(40);
const FIXTURE_CONTAINER_ID = "b".repeat(64);
const fixtureIso = (offsetMs) => new Date(FIXTURE_NOW_MS + offsetMs).toISOString();
const fixtureBaseline = () => ({
  merchantRecordCount: "10",
  merchantAuthoritativeBindingCount: "10",
  merchantInvalidBindingCount: "0",
  personalCanonicalBindingCount: "5",
  personalCanonicalOrphanCount: "0",
  personalInvalidCanonicalCount: "0",
  personalDuplicateAuthUserCount: "0",
  personalDuplicateAccountIdCount: "0",
  crossAccountTypeOverlapCount: "0",
  accountIdentifierCollisionCount: "0",
  staffRegistryOverlapCount: "0",
  systemSitePrincipalOverlapCount: "0",
  ordinaryIdentityContentSha256: "1".repeat(64),
});
const fixtureDatabase = () => ({
  containerName: "supabase-db",
  containerId: FIXTURE_CONTAINER_ID,
  dbName: "postgres",
  dbOid: "16384",
  systemId: "7612345678901234567",
  primary: true,
});
const fixtureArtifact = ({
  id,
  runId,
  runAttempt,
  name,
  fileName,
  digestCharacter,
  fileHashCharacter,
  createdAt,
  artifactSize = "2048",
  fileSize = "1024",
}) => ({
  id,
  name,
  digest: `sha256:${digestCharacter.repeat(64)}`,
  sizeBytes: artifactSize,
  createdAt,
  expiresAt: fixtureIso(7 * 24 * 60 * 60 * 1000),
  expired: false,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  headSha: FIXTURE_TARGET_SHA,
  file: {
    name: fileName,
    sizeBytes: fileSize,
    sha256: fileHashCharacter.repeat(64),
  },
});
const backupFixture = {
  schemaVersion: 1,
  kind: PRODUCTION_BACKUP_ATTESTATION_KIND,
  repository: "fafona/space",
  targetSha: FIXTURE_TARGET_SHA,
  run: {
    id: "8001",
    attempt: "2",
    workflowPath: ".github/workflows/database-backup.yml",
    event: "workflow_dispatch",
    headSha: FIXTURE_TARGET_SHA,
    headBranch: "main",
  },
  remoteSource: {
    headSha: FIXTURE_TARGET_SHA,
    originMainSha: FIXTURE_TARGET_SHA,
    detached: true,
    cleanBefore: true,
    cleanAfter: true,
  },
  database: fixtureDatabase(),
  baseline: fixtureBaseline(),
  backupArtifact: fixtureArtifact({
    id: "9001",
    runId: "8001",
    runAttempt: "2",
    name: "faolla-encrypted-disaster-recovery-8001-2",
    fileName: "faolla-database-backup.tar.enc",
    digestCharacter: "c",
    fileHashCharacter: "7",
    createdAt: fixtureIso(-6 * 60 * 1000),
  }),
  issuedAt: fixtureIso(-5 * 60 * 1000),
  validUntil: fixtureIso(23 * 60 * 60 * 1000),
};
const parsedBackupFixture = parseProductionReleaseAttestation(backupFixture, {
  nowMs: FIXTURE_NOW_MS,
});
const backupFixtureBytes = canonicalJsonBytes(parsedBackupFixture);
const readinessFixture = {
  schemaVersion: 1,
  kind: PRODUCTION_READINESS_ATTESTATION_KIND,
  repository: "fafona/space",
  targetSha: FIXTURE_TARGET_SHA,
  run: {
    id: "8002",
    attempt: "1",
    workflowPath: ".github/workflows/ordinary-account-cutover-readiness.yml",
    event: "workflow_dispatch",
    headSha: FIXTURE_TARGET_SHA,
    headBranch: "main",
  },
  remoteSource: {
    headSha: FIXTURE_TARGET_SHA,
    originMainSha: FIXTURE_TARGET_SHA,
    detached: true,
    cleanBefore: true,
    cleanAfter: true,
  },
  database: fixtureDatabase(),
  baseline: fixtureBaseline(),
  readinessArtifact: fixtureArtifact({
    id: "9003",
    runId: "8002",
    runAttempt: "1",
    name: "faolla-production-readiness-report-8002-1",
    fileName: "production-readiness-report.json",
    digestCharacter: "e",
    fileHashCharacter: "f",
    createdAt: fixtureIso(-60 * 1000),
  }),
  backup: {
    attestation: parsedBackupFixture,
    attestationArtifact: fixtureArtifact({
      id: "9002",
      runId: "8001",
      runAttempt: "2",
      name: "faolla-production-backup-attestation-8001-2",
      fileName: "production-backup-attestation.json",
      digestCharacter: "d",
      fileHashCharacter: "0",
      artifactSize: "4096",
      fileSize: String(backupFixtureBytes.length),
      createdAt: fixtureIso(-4 * 60 * 1000),
    }),
  },
  issuedAt: fixtureIso(0),
  validUntil: fixtureIso(2 * 60 * 60 * 1000),
};
readinessFixture.backup.attestationArtifact.file.sha256 = sha256Hex(backupFixtureBytes);
const READINESS_ATTESTATION_CANONICAL_BYTES = canonicalJsonBytes(
  parseProductionReleaseAttestation(readinessFixture, { nowMs: FIXTURE_NOW_MS }),
);
const RELEASE_ATTESTATION_ENV_KEYS = [
  "PRODUCTION_READINESS_ATTESTATION_FILE",
  "PRODUCTION_READINESS_ATTESTATION_SHA256",
  "PRODUCTION_READINESS_RUN_ID",
  "PRODUCTION_READINESS_RUN_ATTEMPT",
  "PRODUCTION_READINESS_REPORT_ARTIFACT_ID",
  "PRODUCTION_READINESS_REPORT_ARTIFACT_DIGEST",
  "PRODUCTION_READINESS_ATTESTATION_ARTIFACT_ID",
  "PRODUCTION_READINESS_ATTESTATION_ARTIFACT_DIGEST",
  "PRODUCTION_BACKUP_RUN_ID",
  "PRODUCTION_BACKUP_RUN_ATTEMPT",
  "PRODUCTION_BACKUP_ARTIFACT_ID",
  "PRODUCTION_BACKUP_ARTIFACT_DIGEST",
  "PRODUCTION_BACKUP_ATTESTATION_ARTIFACT_ID",
  "PRODUCTION_BACKUP_ATTESTATION_ARTIFACT_DIGEST",
];
const EXPECTED_RELEASE_ATTESTATION = Object.freeze({
  schemaVersion: 1,
  repository: "fafona/space",
  targetSha: "a".repeat(40),
  readinessRunId: "8002",
  readinessRunAttempt: "1",
  readinessReportArtifactId: "9003",
  readinessReportArtifactDigest: `sha256:${"e".repeat(64)}`,
  readinessAttestationArtifactId: "9004",
  readinessAttestationArtifactDigest: `sha256:${"9".repeat(64)}`,
  backupRunId: "8001",
  backupRunAttempt: "2",
  backupArtifactId: "9001",
  backupArtifactDigest: `sha256:${"c".repeat(64)}`,
  backupAttestationArtifactId: "9002",
  backupAttestationArtifactDigest: `sha256:${"d".repeat(64)}`,
  canonicalSha256: createHash("sha256")
    .update(READINESS_ATTESTATION_CANONICAL_BYTES)
    .digest("hex"),
  canonicalBytesBase64: READINESS_ATTESTATION_CANONICAL_BYTES.toString("base64"),
});

function extractDeployTransport() {
  const startMarker =
    "          unset ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON";
  const endMarker = "\n\n      - name: Verify Public Release";
  const start = deployWorkflow.indexOf(startMarker);
  const end = deployWorkflow.indexOf(endMarker, start);
  assert.ok(start >= 0, "deploy transport start marker is missing");
  assert.ok(end > start, "deploy transport end marker is missing");
  return deployWorkflow
    .slice(start, end)
    .split(/\r?\n/)
    .map((line) => line.slice(10))
    .join("\n");
}

function extractWorkflowHeredoc(commandMarker) {
  const commandStart = deployWorkflow.indexOf(commandMarker);
  assert.ok(commandStart >= 0, `workflow command marker is missing: ${commandMarker}`);
  const bodyStart = deployWorkflow.indexOf("\n", commandStart) + 1;
  const bodyEnd = deployWorkflow.indexOf("\n          NODE", bodyStart);
  assert.ok(bodyStart > 0 && bodyEnd > bodyStart, "workflow heredoc is incomplete");
  return deployWorkflow
    .slice(bodyStart, bodyEnd)
    .split(/\r?\n/)
    .map((line) => line.slice(10))
    .join("\n");
}

function extractWorkflowRunBlocks() {
  const lines = deployWorkflow.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "        run: |") continue;
    const body = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line !== "" && !line.startsWith("          ")) {
        index -= 1;
        break;
      }
      body.push(line.startsWith("          ") ? line.slice(10) : line);
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

function extractWorkflowHeredocs(tag) {
  const pattern = new RegExp(
    `<<'${tag}'\\r?\\n([\\s\\S]*?)\\r?\\n          ${tag}(?=\\r?\\n)`,
    "g",
  );
  return [...deployWorkflow.matchAll(pattern)].map((match) =>
    match[1]
      .split(/\r?\n/)
      .map((line) => line.startsWith("          ") ? line.slice(10) : line)
      .join("\n"),
  );
}

function extractShellHeredocs(source, tag) {
  const pattern = new RegExp(
    `<<'${tag}'\\r?\\n([\\s\\S]*?)\\r?\\n${tag}(?=\\r?\\n|$)`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function resolveBashExecutable() {
  const candidates =
    process.platform === "win32"
      ? [
          process.env.BASH,
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        ]
      : [process.env.BASH, "bash"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("bash is required for the deploy transport contract");
}

function resolvePythonExecutable() {
  const candidates = process.platform === "win32"
    ? [["python"], ["py", "-3"]]
    : [["python3"], ["python"]];
  for (const [candidate, ...prefix] of candidates) {
    const probe = spawnSync(candidate, [...prefix, "--version"], { stdio: "ignore" });
    if (probe.status === 0) return { candidate, prefix };
  }
  throw new Error("python is required for the deploy workflow syntax contract");
}

function toBashPath(value) {
  if (process.platform !== "win32") return value;
  const normalized = value.replaceAll("\\", "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : normalized;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function canonicalDeployPayloadBytes(values, releaseOverrides = {}) {
  return canonicalJsonBytes({
    schemaVersion: 1,
    values,
    releaseAttestation: {
      ...EXPECTED_RELEASE_ATTESTATION,
      targetSha: values.EXPECTED_DEPLOY_SHA,
      ...releaseOverrides,
    },
  });
}

function earlyDeployValues(appDirectory, overrides = {}) {
  return {
    ...Object.fromEntries(DEPLOY_PAYLOAD_KEYS.map((key) => [key, ""])),
    APP_DIR: toBashPath(appDirectory),
    APP_NAME: "merchant-space",
    APP_PORT: "3000",
    APP_BRANCH: "main",
    EXPECTED_DEPLOY_SHA: FIXTURE_TARGET_SHA,
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "legacy",
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS: "3600",
    MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS: "3900",
    ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "false",
    ...overrides,
  };
}

function extractShellRegion(start, end) {
  const startIndex = deployScript.indexOf(start);
  const endIndex = deployScript.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing shell region ${start}`);
  return deployScript.slice(startIndex, endIndex);
}

function extractShellFunction(name) {
  const marker = `${name}() {`;
  const startIndex = deployScript.indexOf(marker);
  assert.ok(startIndex >= 0, `missing shell function ${name}`);
  const remainder = deployScript.slice(startIndex + marker.length);
  const nextFunction = remainder.match(/\n[a-z][a-z0-9_]*\(\) \{/);
  assert.ok(nextFunction?.index !== undefined, `unterminated shell function ${name}`);
  return deployScript.slice(
    startIndex,
    startIndex + marker.length + nextFunction.index,
  );
}

async function runDeployTransportScenario({
  statuses,
  expectedStatus,
  expectedSshCalls = 1,
  evidenceEnvironment = {},
  sshMode = "small-failure-output",
  expectedOutput,
  expectCompleteFrame = true,
  verifyCaptureBounds = false,
}) {
  const captureDirectory = await mkdtemp(
    join(tmpdir(), "faolla-deploy-transport-contract-"),
  );
  const caseJson = JSON.stringify({
    caseId: "transport_case_20260819",
    authUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    personalAccountId: "50010999",
    emailSha256: "b".repeat(64),
    expiresAt: "2026-08-20T12:00:00.000Z",
  });
  const hmacSecret = "fedcba9876543210".repeat(4);
  const serviceRoleKey = "service'role\nkey-contract-value";
  const webPushPrivateKey = "web'push\nprivate-contract-value";
  const superAdminPassword = "admin'password\nsecond-contract-line";
  const superAdminVerificationSecret =
    'verify"secret\nthird-contract-line';
  const caseBase64 = Buffer.from(caseJson, "utf8").toString("base64");
  const hmacBase64 = Buffer.from(hmacSecret, "utf8").toString("base64");
  const emptyBase64 = Buffer.from("contract-safe", "utf8").toString("base64");
  const serviceRoleKeyBase64 = Buffer.from(serviceRoleKey, "utf8").toString(
    "base64",
  );
  const expectedPayloadValues = {
    APP_DIR: "contract-app-dir",
    APP_NAME: "merchant-space",
    APP_PORT: "3000",
    APP_BRANCH: "main",
    EXPECTED_DEPLOY_SHA: "a".repeat(40),
    SUPABASE_INTERNAL_URL_B64: emptyBase64,
    NEXT_PUBLIC_SUPABASE_URL_B64: emptyBase64,
    NEXT_PUBLIC_SUPABASE_ANON_KEY_B64: emptyBase64,
    SUPABASE_SERVICE_ROLE_KEY_B64: serviceRoleKeyBase64,
    GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64: emptyBase64,
    GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64: emptyBase64,
    GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64: emptyBase64,
    GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64: emptyBase64,
    GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS: "",
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "legacy",
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS: "3600",
    MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS: "3900",
    MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64: emptyBase64,
    MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64: emptyBase64,
    MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64: emptyBase64,
    MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64: emptyBase64,
    MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64: emptyBase64,
    ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "true",
    ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64: caseBase64,
    ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64: hmacBase64,
    RESEND_API_KEY_B64: emptyBase64,
    WEB_PUSH_PUBLIC_KEY: "web-push-public-contract-value",
    WEB_PUSH_PRIVATE_KEY: webPushPrivateKey,
    WEB_PUSH_SUBJECT: "mailto:security@example.test",
    SUPER_ADMIN_ACCOUNT: "admin@example.test",
    SUPER_ADMIN_PASSWORD: superAdminPassword,
    SUPER_ADMIN_VERIFICATION_EMAIL: "verify@example.test",
    SUPER_ADMIN_VERIFICATION_SECRET: superAdminVerificationSecret,
  };
  assert.deepEqual(Object.keys(expectedPayloadValues), DEPLOY_PAYLOAD_KEYS);
  const readinessAttestationPath = join(
    captureDirectory,
    "production-readiness-attestation.json",
  );
  await writeFile(
    readinessAttestationPath,
    READINESS_ATTESTATION_CANONICAL_BYTES,
    { mode: 0o600 },
  );
  const transport = extractDeployTransport();
  const captureSizesPath = join(captureDirectory, "capture-sizes");
  const fakeSsh = String.raw`
grep() {
  local capture_path
  local capture_size
  if [ "$FAKE_RECORD_CAPTURE_SIZES" = "1" ]; then
    for capture_path in "$@"; do
      case "$capture_path" in
        */deploy-output.*/stdout.log|*/deploy-output.*/stderr.log)
          capture_size="$(wc -c < "$capture_path")"
          printf '%s %s\n' "$capture_path" "$capture_size" >> "$FAKE_CAPTURE_SIZES"
          ;;
      esac
    done
  fi
  command grep "$@"
}
ssh() {
  fake_index="$(wc -l < "$FAKE_SSH_CALLS")"
  fake_index=$((fake_index + 1))
  printf '%s\n' "$fake_index" >> "$FAKE_SSH_CALLS"
  printf '%s\0' "$@" > "$FAKE_SSH_CAPTURE_DIR/argv-$fake_index"
  env > "$FAKE_SSH_CAPTURE_DIR/env-$fake_index"
  if [ "$FAKE_SSH_MODE" = "partial-frame" ]; then
    head -c 1 > "$FAKE_SSH_CAPTURE_DIR/stdin-$fake_index" || true
  else
    cat > "$FAKE_SSH_CAPTURE_DIR/stdin-$fake_index"
  fi
  IFS=',' read -r -a fake_statuses <<< "$FAKE_SSH_STATUSES"
  fake_status_index=$((fake_index - 1))
  if [ "$fake_status_index" -ge "${"$"}{#fake_statuses[@]}" ]; then
    fake_status_index=$((${"$"}{#fake_statuses[@]} - 1))
  fi
  fake_status="${"$"}{fake_statuses[$fake_status_index]}"
  case "$FAKE_SSH_MODE" in
    partial-frame) return 0 ;;
    large-failure-output)
      head -c 1100000 /dev/zero | tr '\0' x
      printf '%s\n' \
        'prefix_[deploy] deploy_rollback_failed_evidence' \
        '[deploy] deploy_rollback_failed_evidence_suffix' \
        '[deploy] deploy_rollback_failed_evidenc' \
        'RAW_STDOUT_SENTINEL_path=/contract/private_pid=98765' \
        '[deploy] deploy_rollback_failed_evidence'
      head -c 1100000 /dev/zero | tr '\0' y >&2
      printf '%s\n' \
        'prefix_[deploy] readiness_fence_waiter_retry_exhausted' \
        '[deploy] readiness_fence_waiter_retry_exhausted_suffix' \
        '[deploy] readiness_fence_waiter_retry_exhauste' \
        'RAW_STDERR_SENTINEL_path=/contract/private_pid=98765' \
        '[deploy] readiness_fence_waiter_retry_exhausted' >&2
      ;;
    small-failure-output)
      if [ "$fake_status" != "0" ]; then
        printf '%s\n' '[deploy] deploy_rollback_failed_evidence'
        printf '%s\n' 'unsafe_remote_stdout_path=/contract/private pid=98765'
        printf '%s\n' 'unsafe_remote_stderr_path=/contract/private pid=98765' >&2
      fi
      ;;
  esac
  if [ "$fake_status" = "255" ]; then
    printf completed > "$FAKE_REMOTE_COMPLETION_MARKER"
  fi
  return "$fake_status"
}
sleep() { :; }
`;
  const callsPath = join(captureDirectory, "calls");
  const script = `set -euo pipefail\n${fakeSsh}\n: > "$FAKE_SSH_CALLS"\n${transport}\n`;
  const result = spawnSync(resolveBashExecutable(), ["-s"], {
    cwd: repositoryRoot,
    input: script,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      FAKE_SSH_CALLS: toBashPath(callsPath),
      FAKE_SSH_CAPTURE_DIR: toBashPath(captureDirectory),
      FAKE_SSH_STATUSES: statuses.join(","),
      FAKE_SSH_MODE: sshMode,
      FAKE_CAPTURE_SIZES: toBashPath(captureSizesPath),
      FAKE_RECORD_CAPTURE_SIZES: verifyCaptureBounds ? "1" : "0",
      FAKE_REMOTE_COMPLETION_MARKER: toBashPath(
        join(captureDirectory, "remote-completed-before-status-loss"),
      ),
      RUNNER_TEMP: toBashPath(captureDirectory),
      SSH_USER: "deployer",
      SSH_HOST: "production.invalid",
      SSH_PORT: "22",
      GITHUB_REPOSITORY: "fafona/space",
      APP_DIR: "contract-app-dir",
      APP_NAME: "merchant-space",
      APP_PORT: "3000",
      APP_BRANCH: "main",
      EXPECTED_DEPLOY_SHA: "a".repeat(40),
      PRODUCTION_READINESS_ATTESTATION_FILE: toBashPath(
        readinessAttestationPath,
      ),
      PRODUCTION_READINESS_ATTESTATION_SHA256:
        EXPECTED_RELEASE_ATTESTATION.canonicalSha256,
      PRODUCTION_READINESS_RUN_ID:
        EXPECTED_RELEASE_ATTESTATION.readinessRunId,
      PRODUCTION_READINESS_RUN_ATTEMPT:
        EXPECTED_RELEASE_ATTESTATION.readinessRunAttempt,
      PRODUCTION_READINESS_REPORT_ARTIFACT_ID:
        EXPECTED_RELEASE_ATTESTATION.readinessReportArtifactId,
      PRODUCTION_READINESS_REPORT_ARTIFACT_DIGEST:
        EXPECTED_RELEASE_ATTESTATION.readinessReportArtifactDigest,
      PRODUCTION_READINESS_ATTESTATION_ARTIFACT_ID:
        EXPECTED_RELEASE_ATTESTATION.readinessAttestationArtifactId,
      PRODUCTION_READINESS_ATTESTATION_ARTIFACT_DIGEST:
        EXPECTED_RELEASE_ATTESTATION.readinessAttestationArtifactDigest,
      PRODUCTION_BACKUP_RUN_ID: EXPECTED_RELEASE_ATTESTATION.backupRunId,
      PRODUCTION_BACKUP_RUN_ATTEMPT:
        EXPECTED_RELEASE_ATTESTATION.backupRunAttempt,
      PRODUCTION_BACKUP_ARTIFACT_ID:
        EXPECTED_RELEASE_ATTESTATION.backupArtifactId,
      PRODUCTION_BACKUP_ARTIFACT_DIGEST:
        EXPECTED_RELEASE_ATTESTATION.backupArtifactDigest,
      PRODUCTION_BACKUP_ATTESTATION_ARTIFACT_ID:
        EXPECTED_RELEASE_ATTESTATION.backupAttestationArtifactId,
      PRODUCTION_BACKUP_ATTESTATION_ARTIFACT_DIGEST:
        EXPECTED_RELEASE_ATTESTATION.backupAttestationArtifactDigest,
      SUPABASE_INTERNAL_URL_B64: emptyBase64,
      NEXT_PUBLIC_SUPABASE_URL_B64: emptyBase64,
      NEXT_PUBLIC_SUPABASE_ANON_KEY_B64: emptyBase64,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_SERVICE_ROLE_KEY_B64: serviceRoleKeyBase64,
      GOOGLE_BUSINESS_PROFILE_CLIENT_ID_B64: emptyBase64,
      GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET_B64: emptyBase64,
      GOOGLE_BUSINESS_PROFILE_TOKEN_KEY_B64: emptyBase64,
      GOOGLE_BUSINESS_PROFILE_REDIRECT_URI_B64: emptyBase64,
      GOOGLE_BUSINESS_PROFILE_SYNC_INTERVAL_MS: "",
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "false",
      MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "legacy",
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false",
      MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS: "3600",
      MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS: "3900",
      MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON_B64: emptyBase64,
      MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_B64: emptyBase64,
      MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN_B64: emptyBase64,
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM_B64: emptyBase64,
      MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO_B64: emptyBase64,
      ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "true",
      ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON: caseJson,
      ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET: hmacSecret,
      ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64: caseBase64,
      ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64: hmacBase64,
      RESEND_API_KEY_B64: emptyBase64,
      WEB_PUSH_PUBLIC_KEY: expectedPayloadValues.WEB_PUSH_PUBLIC_KEY,
      WEB_PUSH_PRIVATE_KEY: webPushPrivateKey,
      WEB_PUSH_SUBJECT: expectedPayloadValues.WEB_PUSH_SUBJECT,
      SUPER_ADMIN_ACCOUNT: expectedPayloadValues.SUPER_ADMIN_ACCOUNT,
      SUPER_ADMIN_PASSWORD: superAdminPassword,
      SUPER_ADMIN_VERIFICATION_EMAIL:
        expectedPayloadValues.SUPER_ADMIN_VERIFICATION_EMAIL,
      SUPER_ADMIN_VERIFICATION_SECRET: superAdminVerificationSecret,
      ...evidenceEnvironment,
    },
  });

  try {
    if (expectedStatus === "nonzero") {
      assert.notEqual(result.status, 0, result.stderr);
    } else {
      assert.equal(result.status, expectedStatus, result.stderr);
    }
    const resolvedExpectedOutput = expectedOutput ?? (
      expectedSshCalls === 1 && expectedStatus !== 0
        ? [
            "[deploy] deploy_rollback_failed_evidence",
            "[deploy] deploy_transport_or_remote_execution_failed",
            "",
          ].join("\n")
        : ""
    );
    assert.equal(result.stdout, resolvedExpectedOutput);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /unsafe_remote_|RAW_STD(?:OUT|ERR)_SENTINEL/);
    assert.doesNotMatch(result.stderr, /unsafe_remote_|RAW_STD(?:OUT|ERR)_SENTINEL/);
    assert.deepEqual(
      (await readdir(captureDirectory)).filter((entry) =>
        entry.startsWith("deploy-output.")),
      [],
    );
    const callsText = (await readFile(callsPath, "utf8")).trim();
    const calls = callsText === "" ? [] : callsText.split(/\r?\n/);
    assert.equal(calls.length, expectedSshCalls);
    if (statuses[0] === 255) {
      assert.equal(
        await pathExists(
          join(captureDirectory, "remote-completed-before-status-loss"),
        ),
        true,
      );
    }
    for (let index = 1; index <= expectedSshCalls; index += 1) {
      const argv = await readFile(
        join(captureDirectory, `argv-${index}`),
        "utf8",
      );
      const framedInput = await readFile(
        join(captureDirectory, `stdin-${index}`),
      );
      const childEnvironment = await readFile(
        join(captureDirectory, `env-${index}`),
        "utf8",
      );
      if (!expectCompleteFrame) {
        assert.ok(framedInput.length <= 1);
        continue;
      }
      const firstNewline = framedInput.indexOf(0x0a);
      const secondNewline = framedInput.indexOf(0x0a, firstNewline + 1);
      const thirdNewline = framedInput.indexOf(0x0a, secondNewline + 1);
      const fourthNewline = framedInput.indexOf(0x0a, thirdNewline + 1);
      assert.ok(firstNewline > 0 && secondNewline > firstNewline);
      assert.ok(
        thirdNewline > secondNewline && fourthNewline > thirdNewline,
      );
      assert.equal(
        framedInput.subarray(0, firstNewline).toString("utf8"),
        DEPLOY_ENVELOPE_MAGIC,
      );
      const payloadBase64 = framedInput
        .subarray(firstNewline + 1, secondNewline)
        .toString("utf8");
      const payload = JSON.parse(
        Buffer.from(payloadBase64, "base64").toString("utf8"),
      );
      assert.deepEqual(payload, {
        schemaVersion: 1,
        values: expectedPayloadValues,
        releaseAttestation: EXPECTED_RELEASE_ATTESTATION,
      });
      assert.equal(
        framedInput.subarray(secondNewline + 1, thirdNewline).toString("utf8"),
        String(Buffer.byteLength(deployScript, "utf8")),
      );
      assert.equal(
        framedInput.subarray(thirdNewline + 1, fourthNewline).toString("utf8"),
        createHash("sha256").update(deployScript, "utf8").digest("hex"),
      );
      assert.deepEqual(
        framedInput.subarray(fourthNewline + 1),
        Buffer.from(deployScript, "utf8"),
      );
      for (const sensitive of [
        caseJson,
        hmacSecret,
        caseBase64,
        hmacBase64,
        serviceRoleKey,
        serviceRoleKeyBase64,
        webPushPrivateKey,
        superAdminPassword,
        superAdminVerificationSecret,
        payloadBase64,
        READINESS_ATTESTATION_CANONICAL_BYTES.toString("utf8"),
        EXPECTED_RELEASE_ATTESTATION.canonicalBytesBase64,
      ]) {
        assert.equal(argv.includes(sensitive), false);
        assert.equal(childEnvironment.includes(sensitive), false);
        assert.equal(result.stdout.includes(sensitive), false);
        assert.equal(result.stderr.includes(sensitive), false);
      }
      assert.equal(framedInput.includes(Buffer.from(caseJson, "utf8")), false);
      assert.equal(framedInput.includes(Buffer.from(hmacSecret, "utf8")), false);
      const argvEntries = argv.split("\0").filter(Boolean);
      assert.ok(argvEntries.includes("-T"));
      const remoteCommand = argvEntries.at(-1) ?? "";
      for (const payloadKey of DEPLOY_PAYLOAD_KEYS) {
        assert.equal(remoteCommand.includes(payloadKey), false);
        assert.equal(
          childEnvironment
            .split(/\r?\n/)
            .some((entry) => entry.startsWith(`${payloadKey}=`)),
          false,
        );
      }
      for (const evidenceKey of RELEASE_ATTESTATION_ENV_KEYS) {
        assert.equal(remoteCommand.includes(evidenceKey), false);
        assert.equal(
          childEnvironment
            .split(/\r?\n/)
            .some((entry) => entry.startsWith(`${evidenceKey}=`)),
          false,
        );
      }
      assert.match(remoteCommand, /set -eu; umask 077;/);
      assert.match(
        remoteCommand,
        /chmod 700 "\$deploy_transport_dir\/deploy\.sh"; FAOLLA_DEPLOY_PAYLOAD_FILE=/,
      );
      assert.doesNotMatch(remoteCommand, /umask 022/);
      assert.match(remoteCommand, /IFS= read -r deploy_envelope_magic/);
      assert.match(remoteCommand, /IFS= read -r expected_deploy_bytes/);
      assert.match(remoteCommand, /actual_deploy_sha256/);
      assert.doesNotMatch(remoteCommand, /SUPABASE|SUPER_ADMIN|WEB_PUSH/);
      const executionMarker = join(
        captureDirectory,
        `remote-executed-${index}`,
      );
      const payloadCopy = join(captureDirectory, `remote-payload-${index}.json`);
      const remoteProbeScript = [
        "set -eu",
        '[ "$(umask)" = "0077" ]',
        'printf executed > "$FAKE_REMOTE_EXECUTION_MARKER"',
        'cp -- "$FAOLLA_DEPLOY_PAYLOAD_FILE" "$FAKE_REMOTE_PAYLOAD_COPY"',
        "",
      ].join("\n");
      const remoteProbeBytes = Buffer.byteLength(remoteProbeScript, "utf8");
      const remoteProbeSha256 = createHash("sha256")
        .update(remoteProbeScript, "utf8")
        .digest("hex");
      const remoteProbeInput = Buffer.from(
        `${DEPLOY_ENVELOPE_MAGIC}\n${payloadBase64}\n${remoteProbeBytes}\n${remoteProbeSha256}\n${remoteProbeScript}`,
        "utf8",
      );
      const remoteProbe = spawnSync(
        resolveBashExecutable(),
        ["-c", remoteCommand],
        {
          cwd: repositoryRoot,
          input: remoteProbeInput,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            FAKE_REMOTE_EXECUTION_MARKER: toBashPath(executionMarker),
            FAKE_REMOTE_PAYLOAD_COPY: toBashPath(payloadCopy),
          },
        },
      );
      assert.equal(remoteProbe.status, 0, remoteProbe.stderr);
      assert.equal(remoteProbe.stdout, "");
      assert.equal(remoteProbe.stderr, "");
      assert.equal(await pathExists(executionMarker), true);
      assert.deepEqual(
        JSON.parse(await readFile(payloadCopy, "utf8")),
        payload,
      );
      const rejectedMagic = spawnSync(
        resolveBashExecutable(),
        ["-c", remoteCommand],
        {
          cwd: repositoryRoot,
          input: Buffer.from(
            `FAOLLA_DEPLOY_ENVELOPE_V1\n${payloadBase64}\n${remoteProbeBytes}\n${remoteProbeSha256}\n${remoteProbeScript}`,
            "utf8",
          ),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            FAKE_REMOTE_EXECUTION_MARKER: toBashPath(
              `${executionMarker}-bad-magic`,
            ),
            FAKE_REMOTE_PAYLOAD_COPY: toBashPath(`${payloadCopy}-bad-magic`),
          },
        },
      );
      assert.notEqual(rejectedMagic.status, 0);
      assert.equal(rejectedMagic.stdout, "");
      assert.equal(rejectedMagic.stderr, "");
      assert.equal(await pathExists(`${executionMarker}-bad-magic`), false);

      const completeLineOffsets = [...remoteProbeScript.matchAll(/\n/g)].map(
        (match) => (match.index ?? 0) + 1,
      );
      for (const [truncationIndex, offset] of completeLineOffsets.entries()) {
        if (offset >= remoteProbeBytes) continue;
        const truncatedMarker = `${executionMarker}-truncated-${truncationIndex}`;
        const truncatedInput = Buffer.from(
          `${DEPLOY_ENVELOPE_MAGIC}\n${payloadBase64}\n${remoteProbeBytes}\n${remoteProbeSha256}\n${remoteProbeScript.slice(0, offset)}`,
          "utf8",
        );
        const truncated = spawnSync(
          resolveBashExecutable(),
          ["-c", remoteCommand],
          {
            cwd: repositoryRoot,
            input: truncatedInput,
            encoding: "utf8",
            timeout: 10_000,
            env: {
              ...process.env,
              FAKE_REMOTE_EXECUTION_MARKER: toBashPath(truncatedMarker),
              FAKE_REMOTE_PAYLOAD_COPY: toBashPath(
                `${payloadCopy}-truncated-${truncationIndex}`,
              ),
            },
          },
        );
        assert.notEqual(truncated.status, 0);
        assert.equal(truncated.stdout, "");
        assert.equal(truncated.stderr, "");
        assert.equal(await pathExists(truncatedMarker), false);
      }
    }
    if (verifyCaptureBounds) {
      const captureSizes = (await readFile(captureSizesPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const match = line.match(/\/(stdout|stderr)\.log (\d+)$/);
          assert.ok(match, line);
          return { channel: match[1], size: Number(match[2]) };
        });
      assert.ok(captureSizes.length >= 46);
      for (const { size } of captureSizes) {
        assert.ok(size >= 0 && size <= 1_048_576, String(size));
      }
      for (const channel of ["stdout", "stderr"]) {
        assert.equal(
          Math.max(...captureSizes
            .filter((entry) => entry.channel === channel)
            .map((entry) => entry.size)),
          1_048_576,
          channel,
        );
      }
    }
  } finally {
    await rm(captureDirectory, { recursive: true, force: true });
  }
}

function runRecoveryEnvCheck(caseJson, hmacSecret) {
  return spawnSync(process.execPath, [fileURLToPath(envCheckUrl), "--strict"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://contract-test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "contract-test-anon-key",
      SUPER_ADMIN_VERIFICATION_SECRET:
        "super-admin-contract-secret-that-is-not-the-recovery-key",
      ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "true",
      ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON: caseJson,
      ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET: hmacSecret,
    },
  });
}

test("one-time personal recovery deploy config is secret-only, fail-closed, and erased when disabled", () => {
  assert.match(
    envExample,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED=false/,
  );
  assert.match(
    deployWorkflow,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED:\s*\$\{\{ vars\.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED \}\}/,
  );
  assert.match(
    deployWorkflow,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON:\s*\$\{\{ secrets\.ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON \}\}/,
  );
  assert.match(
    deployWorkflow,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET:\s*\$\{\{ secrets\.ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET \}\}/,
  );
  const derivedSecretMaskIndex = deployWorkflow.indexOf(
    "for derived_secret in",
  );
  const deploySshIndex = deployWorkflow.indexOf(
    "ssh -T -o ConnectTimeout=20",
  );
  assert.ok(derivedSecretMaskIndex >= 0);
  assert.ok(derivedSecretMaskIndex < deploySshIndex);
  const derivedSecretMaskBlock = deployWorkflow.slice(
    derivedSecretMaskIndex,
    deployWorkflow.indexOf("unset derived_secret", derivedSecretMaskIndex) +
      "unset derived_secret".length,
  );
  assert.match(
    derivedSecretMaskBlock,
    /\$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64/,
  );
  assert.match(
    derivedSecretMaskBlock,
    /\$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64/,
  );
  assert.match(derivedSecretMaskBlock, /::add-mask::%s\\n/);
  for (const rawRecoverySecret of [
    "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON",
    "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET",
  ]) {
    const unsetIndex = deployWorkflow.indexOf(`unset ${rawRecoverySecret}`);
    assert.ok(unsetIndex > derivedSecretMaskIndex);
    assert.ok(unsetIndex < deploySshIndex);
  }
  const recoveryTransport = extractDeployTransport();
  assert.match(
    recoveryTransport,
    /DEPLOY_ENVELOPE_MAGIC="FAOLLA_DEPLOY_ENVELOPE_V2"/,
  );
  assert.match(
    recoveryTransport,
    /DEPLOY_PAYLOAD_B64="\$\(node --input-type=module <<'NODE'/,
  );
  assert.match(
    recoveryTransport,
    /FAOLLA_DEPLOY_PAYLOAD_FILE="\$deploy_transport_dir\/payload\.json" bash "\$deploy_transport_dir\/deploy\.sh"/,
  );
  assert.doesNotMatch(
    recoveryTransport,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64='\$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_B64'/,
  );
  assert.doesNotMatch(
    recoveryTransport,
    /ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64='\$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_B64'/,
  );
  assert.match(recoveryTransport, /transport_status=\("\$\{PIPESTATUS\[@\]\}"\)/);
  assert.match(recoveryTransport, /frame_status="\$\{transport_status\[0\]:-1\}"/);
  assert.match(recoveryTransport, /ssh_status="\$\{transport_status\[1\]:-1\}"/);
  assert.match(recoveryTransport, /ConnectionAttempts=1/);
  assert.doesNotMatch(recoveryTransport, /for attempt in|sleep 10/);
  assert.doesNotMatch(
    deployWorkflow,
    /NEXT_PUBLIC_ORDINARY_LEGACY_PERSONAL_RECOVERY/,
  );
  assert.match(
    deployScript,
    /enabled ordinary legacy personal recovery requires fresh case and HMAC secrets/,
  );
  assert.match(
    deployScript,
    /\[\[ "\$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE" =~ \[\[:space:\]#\] \]\]/,
  );
  assert.match(
    deployScript,
    /\^\[0-9a-f\]\{64\}\$/,
  );
  const recoveryBlock = deployScript.slice(
    deployScript.indexOf(
      'write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "false"',
    ),
    deployScript.indexOf('write_env_value "RESEND_API_KEY"'),
  );
  const enableBranchIndex = recoveryBlock.indexOf(
    'if [ "$ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" = "true" ]',
  );
  const caseRemovalIndex = recoveryBlock.indexOf(
    'remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON"',
  );
  const hmacRemovalIndex = recoveryBlock.indexOf(
    'remove_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET"',
  );
  const caseWriteIndex = recoveryBlock.indexOf(
    'write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON_VALUE"',
  );
  const hmacWriteIndex = recoveryBlock.indexOf(
    'write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET" "$ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET_VALUE"',
  );
  const gateEnableIndex = recoveryBlock.indexOf(
    'write_env_value "ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED" "true"',
  );
  assert.ok(caseRemovalIndex >= 0 && caseRemovalIndex < enableBranchIndex);
  assert.ok(hmacRemovalIndex >= 0 && hmacRemovalIndex < enableBranchIndex);
  assert.ok(caseWriteIndex > enableBranchIndex);
  assert.ok(hmacWriteIndex > caseWriteIndex);
  assert.ok(gateEnableIndex > hmacWriteIndex);
  assert.match(envCheckScript, /JSON\.stringify\(recoveryCase\) !== rawCase/);
  assert.match(envCheckScript, /!\/\^\[0-9a-f\]\{64\}\$\/\.test\(hmacSecret\)/);
});

test("deploy keeps every config value in an integrity-checked SSH stdin envelope", async (t) => {
  await t.test("success sends one complete frame", async () => {
    await runDeployTransportScenario({ statuses: [0], expectedStatus: 0 });
  });
  await t.test("ambiguous SSH 255 is never replayed", async () => {
    await runDeployTransportScenario({ statuses: [255], expectedStatus: 255 });
  });
  await t.test("non-255 SSH failure is returned without retry", async () => {
    await runDeployTransportScenario({ statuses: [37], expectedStatus: 37 });
  });
  await t.test("bounded capture drains large dual-channel output and emits only exact safe tail lines", async () => {
    await runDeployTransportScenario({
      statuses: [37],
      expectedStatus: 37,
      sshMode: "large-failure-output",
      expectedOutput: [
        "[deploy] deploy_rollback_failed_evidence",
        "[deploy] readiness_fence_waiter_retry_exhausted",
        "[deploy] deploy_transport_or_remote_execution_failed",
        "",
      ].join("\n"),
      verifyCaptureBounds: true,
    });
  });
  await t.test("a successful SSH that closes stdin early preserves frame SIGPIPE without replay", async () => {
    await runDeployTransportScenario({
      statuses: [0],
      expectedStatus: "nonzero",
      sshMode: "partial-frame",
      expectCompleteFrame: false,
      expectedOutput: "[deploy] deploy_transport_or_remote_execution_failed\n",
    });
  });
  await t.test("attestation byte substitution fails before SSH", async () => {
    await runDeployTransportScenario({
      statuses: [0],
      expectedStatus: 1,
      expectedSshCalls: 0,
      evidenceEnvironment: {
        PRODUCTION_READINESS_ATTESTATION_SHA256: "0".repeat(64),
      },
    });
  });
  await t.test("artifact ID substitution fails before SSH", async () => {
    await runDeployTransportScenario({
      statuses: [0],
      expectedStatus: 1,
      expectedSshCalls: 0,
      evidenceEnvironment: {
        PRODUCTION_READINESS_REPORT_ARTIFACT_ID: "0",
      },
    });
  });
  await t.test("backup run attempt substitution fails before SSH", async () => {
    await runDeployTransportScenario({
      statuses: [0],
      expectedStatus: 1,
      expectedSshCalls: 0,
      evidenceEnvironment: {
        PRODUCTION_BACKUP_RUN_ATTEMPT: "0",
      },
    });
  });
});

test("workflow diagnostic allowlist and deploy fixed echoes are one exact 23-code set", () => {
  assert.equal(DEPLOY_SAFE_DIAGNOSTIC_LINES.length, 23);
  assert.equal(new Set(DEPLOY_SAFE_DIAGNOSTIC_LINES).size, 23);
  const allowlistStart = deployWorkflow.indexOf("for deploy_diagnostic_code in");
  const allowlistEnd = deployWorkflow.indexOf("; do", allowlistStart);
  assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart);
  const allowlistRegion = deployWorkflow.slice(allowlistStart, allowlistEnd);
  const workflowLines = [...allowlistRegion.matchAll(
    /'(\[deploy\] [a-z0-9_]+)'/g,
  )].map((match) => match[1]);
  assert.equal(workflowLines.length, 23);
  assert.equal(new Set(workflowLines).size, 23);
  assert.deepEqual(workflowLines, DEPLOY_SAFE_DIAGNOSTIC_LINES);

  const scriptEchoLines = [...deployScript.matchAll(
    /\becho "(\[deploy\] [a-z0-9_]+)"/g,
  )].map((match) => match[1]);
  const uniqueScriptEchoLines = [...new Set(scriptEchoLines)].sort();
  assert.equal(uniqueScriptEchoLines.length, 23);
  assert.deepEqual(
    uniqueScriptEchoLines,
    [...DEPLOY_SAFE_DIAGNOSTIC_LINES].sort(),
  );
});

test("remote deploy consumes one exact payload file and erases it before validation", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-deploy-payload-contract-"),
  );
  const payloadPath = join(temporaryDirectory, "payload.json");
  const bashEnvironmentPath = join(temporaryDirectory, "bash-env");
  const missingAppPath = join(temporaryDirectory, "missing-app");
  const hostileSecret = "admin'payload\ncontract-second-line";
  const values = Object.fromEntries(
    DEPLOY_PAYLOAD_KEYS.map((key) => [key, ""]),
  );
  Object.assign(values, {
    APP_DIR: missingAppPath,
    APP_NAME: "merchant-space",
    APP_PORT: "3000",
    APP_BRANCH: "main",
    EXPECTED_DEPLOY_SHA: "a".repeat(40),
    SUPER_ADMIN_PASSWORD: hostileSecret,
  });
  await writeFile(
    payloadPath,
    canonicalDeployPayloadBytes(values),
    { mode: 0o600 },
  );
  await writeFile(
    bashEnvironmentPath,
    "pm2() { :; }\nflock() { :; }\nss() { :; }\nrunuser() { :; }\n",
    "utf8",
  );
  try {
    const result = spawnSync(
      resolveBashExecutable(),
      [toBashPath(fileURLToPath(new URL("./deploy.production.sh", import.meta.url)))],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          BASH_ENV: toBashPath(bashEnvironmentPath),
          FAOLLA_DEPLOY_PAYLOAD_FILE: toBashPath(payloadPath),
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /APP_DIR must already contain a git checkout/);
    assert.equal(result.stdout.includes(hostileSecret), false);
    assert.equal(result.stderr.includes(hostileSecret), false);
    assert.equal(await pathExists(payloadPath), false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("outer payload and frozen sidecars fail before environment or cache mutation", async (t) => {
  const cases = [
    ["extra root key", (payload) => { payload.extra = true; }, "none", true],
    ["missing release evidence", (payload) => { delete payload.releaseAttestation; }, "none", true],
    ["wrong fixed repository", (payload) => { payload.releaseAttestation.repository = "attacker/fork"; }, "none", true],
    ["target substitution", (payload) => { payload.releaseAttestation.targetSha = "c".repeat(40); }, "none", true],
    ["noncanonical outer bytes", () => {}, "none", false],
    ["attestation pathname replacement", () => {}, "attestation", true],
    ["binding pathname replacement", () => {}, "binding", true],
  ];
  for (const [name, mutate, swapSidecar, canonical] of cases) {
    await t.test(name, async () => {
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), "faolla-deploy-outer-payload-contract-"),
      );
      const appDirectory = join(temporaryDirectory, "app");
      const homeDirectory = join(temporaryDirectory, "home");
      const cacheDirectory = join(homeDirectory, ".cache", "ffmpeg-static-nodejs");
      const payloadPath = join(temporaryDirectory, "payload.json");
      const bashEnvironmentPath = join(temporaryDirectory, "bash-env");
      const gitCallsPath = join(temporaryDirectory, "git-calls");
      const envPath = join(appDirectory, ".env.local");
      const cacheSentinelPath = join(cacheDirectory, "sentinel");
      await mkdir(join(appDirectory, ".git"), { recursive: true });
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(envPath, "PRODUCTION_SENTINEL=unchanged\n", "utf8");
      await writeFile(cacheSentinelPath, "unchanged\n", "utf8");
      const values = earlyDeployValues(appDirectory);
      const payload = JSON.parse(canonicalDeployPayloadBytes(values).toString("utf8"));
      mutate(payload);
      const payloadBytes = canonical
        ? canonicalJsonBytes(payload)
        : Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await writeFile(payloadPath, payloadBytes, { mode: 0o600 });
      await writeFile(
        bashEnvironmentPath,
        [
          "git() {",
          '  printf \'%s\\n\' "$*" >> "$FAKE_GIT_CALLS"',
          '  if [ "$1" = "fetch" ] && [ "$FAKE_SWAP_SIDECAR" != "none" ]; then',
          '    if [ "$FAKE_SWAP_SIDECAR" = "attestation" ]; then suffix=".readiness-attestation.json"; else suffix=".release-binding.json"; fi',
          '    cp -p -- "$FAKE_PAYLOAD_PATH$suffix" "$FAKE_PAYLOAD_PATH$suffix.replacement"',
          '    mv -f -- "$FAKE_PAYLOAD_PATH$suffix.replacement" "$FAKE_PAYLOAD_PATH$suffix"',
          "  fi",
          '  if [ "$1" = "rev-parse" ]; then',
          `    printf '%s\\n' '${FIXTURE_TARGET_SHA}'`,
          "  fi",
          "  return 0",
          "}",
          "pm2() { :; }",
          "flock() { :; }",
          "ss() { :; }",
          "runuser() { :; }",
          "",
        ].join("\n"),
        "utf8",
      );
      try {
        const result = spawnSync(
          resolveBashExecutable(),
          [toBashPath(fileURLToPath(new URL("./deploy.production.sh", import.meta.url)))],
          {
            cwd: repositoryRoot,
            encoding: "utf8",
            timeout: 15_000,
            env: {
              ...process.env,
              BASH_ENV: toBashPath(bashEnvironmentPath),
              DEPLOY_LOCK_FILE: toBashPath(join(temporaryDirectory, "deploy.lock")),
              FAKE_GIT_CALLS: toBashPath(gitCallsPath),
              FAKE_PAYLOAD_PATH: toBashPath(payloadPath),
              FAKE_SWAP_SIDECAR: swapSidecar,
              FAOLLA_DEPLOY_PAYLOAD_FILE: toBashPath(payloadPath),
              HOME: toBashPath(homeDirectory),
            },
          },
        );
        assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
        assert.equal(await readFile(envPath, "utf8"), "PRODUCTION_SENTINEL=unchanged\n");
        assert.equal(await readFile(cacheSentinelPath, "utf8"), "unchanged\n");
        assert.equal(await pathExists(payloadPath), false);
        assert.equal(await pathExists(`${payloadPath}.readiness-attestation.json`), false);
        assert.equal(await pathExists(`${payloadPath}.release-binding.json`), false);
        if (swapSidecar === "none") {
          assert.equal(await pathExists(gitCallsPath), false);
        } else {
          assert.match(await readFile(gitCallsPath, "utf8"), /fetch origin main --prune/);
          assert.match(result.stdout, /canonical release evidence preflight failed/);
        }
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    });
  }
});

test("a moving main ref fails before production config or caches are mutated", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-deploy-sha-mismatch-contract-"),
  );
  const appDirectory = join(temporaryDirectory, "app");
  const homeDirectory = join(temporaryDirectory, "home");
  const cacheDirectory = join(
    homeDirectory,
    ".cache",
    "ffmpeg-static-nodejs",
  );
  const payloadPath = join(temporaryDirectory, "payload.json");
  const bashEnvironmentPath = join(temporaryDirectory, "bash-env");
  const gitCallsPath = join(temporaryDirectory, "git-calls");
  const envPath = join(appDirectory, ".env.local");
  const cacheSentinelPath = join(cacheDirectory, "sentinel");
  await mkdir(join(appDirectory, ".git"), { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(envPath, "PRODUCTION_SENTINEL=unchanged\n", "utf8");
  await writeFile(cacheSentinelPath, "unchanged\n", "utf8");
  const values = Object.fromEntries(
    DEPLOY_PAYLOAD_KEYS.map((key) => [key, ""]),
  );
  Object.assign(values, {
    APP_DIR: toBashPath(appDirectory),
    APP_NAME: "merchant-space",
    APP_PORT: "3000",
    APP_BRANCH: "main",
    EXPECTED_DEPLOY_SHA: "a".repeat(40),
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "legacy",
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false",
    MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS: "3600",
    MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS: "3900",
    ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED: "false",
  });
  await writeFile(
    payloadPath,
    canonicalDeployPayloadBytes(values),
    { mode: 0o600 },
  );
  await writeFile(
    bashEnvironmentPath,
    [
      "git() {",
      "  printf '%s\\n' \"$*\" >> \"$FAKE_GIT_CALLS\"",
      '  if [ "$1" = "rev-parse" ]; then',
      `    printf '%s\\n' '${"b".repeat(40)}'`,
      "  fi",
      "  return 0",
      "}",
      "npm() { :; }",
      "pm2() { :; }",
      "flock() { :; }",
      "ss() { :; }",
      "runuser() { :; }",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = spawnSync(
      resolveBashExecutable(),
      [toBashPath(fileURLToPath(new URL("./deploy.production.sh", import.meta.url)))],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          BASH_ENV: toBashPath(bashEnvironmentPath),
          DEPLOY_LOCK_FILE: toBashPath(
            join(temporaryDirectory, "deploy.lock"),
          ),
          FAKE_GIT_CALLS: toBashPath(gitCallsPath),
          FAOLLA_DEPLOY_PAYLOAD_FILE: toBashPath(payloadPath),
          HOME: toBashPath(homeDirectory),
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stdout,
      /origin\/main no longer matches EXPECTED_DEPLOY_SHA/,
    );
    assert.equal(
      await readFile(envPath, "utf8"),
      "PRODUCTION_SENTINEL=unchanged\n",
    );
    assert.equal(await readFile(cacheSentinelPath, "utf8"), "unchanged\n");
    const gitCalls = await readFile(gitCallsPath, "utf8");
    assert.match(gitCalls, /fetch origin main --prune/);
    assert.match(gitCalls, /rev-parse origin\/main/);
    assert.doesNotMatch(gitCalls, /checkout|reset/);
    assert.equal(await pathExists(payloadPath), false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("strict env gate accepts only compact case JSON and a safe lowercase 64-hex HMAC", () => {
  const recoveryCase = {
    caseId: "contract_case_20260819",
    authUserId: "11111111-1111-4111-8111-111111111111",
    personalAccountId: "50010105",
    emailSha256: "a".repeat(64),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  const compact = JSON.stringify(recoveryCase);
  const secret = "0123456789abcdef".repeat(4);
  const valid = runRecoveryEnvCheck(compact, secret);
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);

  for (const [name, caseJson, hmac] of [
    ["nonhex HMAC", compact, "z".repeat(64)],
    ["short HMAC", compact, "a".repeat(63)],
    ["pretty JSON", JSON.stringify(recoveryCase, null, 2), secret],
    ["leading whitespace", ` ${compact}`, secret],
    [
      "hash character",
      compact.replace("contract_case_20260819", "contract#case_20260819"),
      secret,
    ],
    [
      "numeric personal ID",
      JSON.stringify({ ...recoveryCase, personalAccountId: 50010105 }),
      secret,
    ],
    [
      "numeric case ID",
      JSON.stringify({ ...recoveryCase, caseId: 12345678 }),
      secret,
    ],
    [
      "numeric email hash",
      JSON.stringify({ ...recoveryCase, emailSha256: Number("1".repeat(64)) }),
      secret,
    ],
  ]) {
    const result = runRecoveryEnvCheck(caseJson, hmac);
    assert.equal(result.status, 1, `${name}: ${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(output.includes("50010105"), false);
    assert.equal(output.includes(secret), false);
  }
});

test("production deployment is serialized before mutable work", () => {
  assert.match(deployScript, /command -v flock/);
  const lockNormalization = extractShellRegion(
    "normalize_deploy_lock_permissions() {",
    "\nacquire_deploy_lock() {",
  );
  const lockAcquisition = extractShellRegion(
    "acquire_deploy_lock() {",
    "\ndisk_usage_percent() {",
  );
  assert.match(lockAcquisition, /exec 9<>"\$DEPLOY_LOCK_FILE"/);
  assert.doesNotMatch(lockAcquisition, /exec 9>(?!<)/);
  assert.match(lockAcquisition, /flock -w "\$DEPLOY_LOCK_WAIT_SECONDS" 9/);
  assert.match(lockAcquisition, /normalize_deploy_lock_permissions/);
  assert.ok(
    lockAcquisition.indexOf('flock -w "$DEPLOY_LOCK_WAIT_SECONDS" 9') <
      lockAcquisition.indexOf("normalize_deploy_lock_permissions"),
  );
  assert.match(lockNormalization, /\[ -f "\$DEPLOY_LOCK_FILE" \]/);
  assert.match(lockNormalization, /\[ ! -L "\$DEPLOY_LOCK_FILE" \]/);
  assert.match(lockNormalization, /\[ -f "\/proc\/\$\$\/fd\/9" \]/);
  assert.match(lockNormalization, /%d:%i:%h:%u:%f:%a/);
  assert.match(lockNormalization, /16#\$deploy_lock_raw_mode & 0170000/);
  assert.match(lockNormalization, /deploy_lock_links" = "1"/);
  assert.match(lockNormalization, /deploy_lock_uid" = "\$\(id -u\)"/);
  assert.match(lockNormalization, /600\|644\) ;;/);
  assert.equal((lockNormalization.match(/\bchmod\b/g) ?? []).length, 1);
  assert.match(lockNormalization, /chmod 600 -- "\/proc\/\$\$\/fd\/9"/);
  assert.doesNotMatch(lockNormalization, /chmod[^\n]*\$DEPLOY_LOCK_FILE/);
  const lockObserved = lockNormalization.indexOf("deploy_lock_observed_identity=");
  const lockPreMutationRecheck = lockNormalization.indexOf(
    '= "$deploy_lock_observed_identity" ]',
    lockObserved,
  );
  const lockNormalized = lockNormalization.indexOf('chmod 600 -- "/proc/$$/fd/9"');
  const lockPostObserved = lockNormalization.indexOf("deploy_lock_post_identity=");
  const lockFrozen = lockNormalization.indexOf("DEPLOY_LOCK_IDENTITY=");
  assert.ok(lockObserved >= 0);
  assert.ok(lockPreMutationRecheck > lockObserved);
  assert.ok(lockNormalized > lockPreMutationRecheck);
  assert.ok(lockPostObserved > lockNormalized);
  assert.ok(lockFrozen > lockPostObserved);

  const lockIndex = deployScript.indexOf("acquire_deploy_lock\n");
  const cacheIndex = deployScript.indexOf("cleanup_rebuildable_caches\n");
  const fetchIndex = deployScript.indexOf("\nfetch_deploy_branch\n");
  assert.ok(lockIndex >= 0);
  assert.ok(lockIndex < cacheIndex);
  assert.ok(lockIndex < fetchIndex);
});

test(
  "Linux deploy locking safely normalizes only the legacy lock inode",
  { skip: process.platform !== "linux" },
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-deploy-lock-contract-"));
    const lockFunctions = extractShellRegion(
      "normalize_deploy_lock_permissions() {",
      "\ndisk_usage_percent() {",
    );
    const recordedWrappers = [
      "flock() {",
      '  if command flock "$@"; then',
      '    printf \'%s\\n\' flock-acquired >> "$CONTRACT_EVENTS_PATH"',
      '    if [ -n "${CONTRACT_FD_IDENTITY_PATH:-}" ]; then',
      '      stat -Lc \'%d:%i\' -- "/proc/$$/fd/9" > "$CONTRACT_FD_IDENTITY_PATH"',
      "    fi",
      "    return 0",
      "  fi",
      "  return 1",
      "}",
      "chmod() {",
      '  printf \'%s\\n\' chmod >> "$CONTRACT_EVENTS_PATH"',
      '  command chmod "$@"',
      "}",
    ].join("\n");
    const runAcquire = ({ lockPath, eventsPath, wrappers = recordedWrappers, extraEnv = {} }) =>
      spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        env: {
          ...process.env,
          CONTRACT_EVENTS_PATH: eventsPath,
          CONTRACT_FD_IDENTITY_PATH: "",
          CONTRACT_LOCK_PATH: lockPath,
          ...extraEnv,
        },
        input: [
          "set -Eeuo pipefail",
          "umask 077",
          lockFunctions,
          'DEPLOY_LOCK_FILE="$CONTRACT_LOCK_PATH"',
          "DEPLOY_LOCK_WAIT_SECONDS=1",
          wrappers,
          "acquire_deploy_lock",
          "",
        ].join("\n"),
        timeout: 10_000,
      });
    const readEvents = async (eventsPath) => {
      try {
        const events = await readFile(eventsPath, "utf8");
        return events.trim() ? events.trim().split("\n") : [];
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
    };
    const fileMode = async (path) => Number((await stat(path, { bigint: true })).mode & 0o777n);
    const fileIdentity = async (path) => {
      const metadata = await stat(path, { bigint: true });
      return `${metadata.dev}:${metadata.ino}`;
    };
    const assertSafeFailure = (result, scenario) => {
      const details = `${scenario}\n${result.stdout}\n${result.stderr}`;
      assert.equal(result.error, undefined, details);
      assert.equal(result.signal, null, details);
      assert.equal(result.status, 1, details);
    };

    try {
      const newLock = join(temporaryDirectory, "new.lock");
      const newEvents = join(temporaryDirectory, "new.events");
      const newFdIdentity = join(temporaryDirectory, "new-fd-identity");
      let result = runAcquire({
        lockPath: newLock,
        eventsPath: newEvents,
        extraEnv: { CONTRACT_FD_IDENTITY_PATH: newFdIdentity },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(await readFile(newLock, "utf8"), "");
      assert.equal(await fileMode(newLock), 0o600);
      assert.equal((await readFile(newFdIdentity, "utf8")).trim(), await fileIdentity(newLock));
      assert.deepEqual(await readEvents(newEvents), ["flock-acquired"]);

      const legacyLock = join(temporaryDirectory, "legacy.lock");
      const legacyEvents = join(temporaryDirectory, "legacy.events");
      await writeFile(legacyLock, "legacy-canary");
      await chmod(legacyLock, 0o644);
      const legacyIdentity = await fileIdentity(legacyLock);
      result = runAcquire({
        lockPath: legacyLock,
        eventsPath: legacyEvents,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(await fileIdentity(legacyLock), legacyIdentity);
      assert.equal(await readFile(legacyLock, "utf8"), "legacy-canary");
      assert.equal(await fileMode(legacyLock), 0o600);
      assert.deepEqual(await readEvents(legacyEvents), ["flock-acquired", "chmod"]);

      await writeFile(legacyEvents, "");
      result = runAcquire({ lockPath: legacyLock, eventsPath: legacyEvents });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(await fileIdentity(legacyLock), legacyIdentity);
      assert.equal(await readFile(legacyLock, "utf8"), "legacy-canary");
      assert.equal(await fileMode(legacyLock), 0o600);
      assert.deepEqual(await readEvents(legacyEvents), ["flock-acquired"]);

      const unsupportedLock = join(temporaryDirectory, "unsupported.lock");
      const unsupportedEvents = join(temporaryDirectory, "unsupported.events");
      await writeFile(unsupportedLock, "unsupported-canary");
      await chmod(unsupportedLock, 0o640);
      const unsupportedIdentity = await fileIdentity(unsupportedLock);
      result = runAcquire({ lockPath: unsupportedLock, eventsPath: unsupportedEvents });
      assertSafeFailure(result, "unsupported mode");
      assert.equal(await fileIdentity(unsupportedLock), unsupportedIdentity);
      assert.equal(await readFile(unsupportedLock, "utf8"), "unsupported-canary");
      assert.equal(await fileMode(unsupportedLock), 0o640);
      assert.deepEqual(await readEvents(unsupportedEvents), ["flock-acquired"]);

      const hardlinkTarget = join(temporaryDirectory, "hardlink-target");
      const hardlinkLock = join(temporaryDirectory, "hardlink.lock");
      const hardlinkEvents = join(temporaryDirectory, "hardlink.events");
      await writeFile(hardlinkTarget, "hardlink-canary");
      await chmod(hardlinkTarget, 0o644);
      await link(hardlinkTarget, hardlinkLock);
      result = runAcquire({ lockPath: hardlinkLock, eventsPath: hardlinkEvents });
      assertSafeFailure(result, "hard link");
      assert.equal((await stat(hardlinkLock)).nlink, 2);
      assert.equal(await readFile(hardlinkLock, "utf8"), "hardlink-canary");
      assert.equal(await readFile(hardlinkTarget, "utf8"), "hardlink-canary");
      assert.equal(await fileMode(hardlinkLock), 0o644);
      assert.deepEqual(await readEvents(hardlinkEvents), ["flock-acquired"]);

      const symlinkTarget = join(temporaryDirectory, "symlink-target");
      const symlinkLock = join(temporaryDirectory, "symlink.lock");
      const symlinkEvents = join(temporaryDirectory, "symlink.events");
      await writeFile(symlinkTarget, "symlink-canary");
      await chmod(symlinkTarget, 0o644);
      await symlink(symlinkTarget, symlinkLock);
      result = runAcquire({ lockPath: symlinkLock, eventsPath: symlinkEvents });
      assertSafeFailure(result, "symbolic link");
      assert.equal(await readFile(symlinkTarget, "utf8"), "symlink-canary");
      assert.equal(await fileMode(symlinkTarget), 0o644);
      assert.deepEqual(await readEvents(symlinkEvents), []);

      const ownerLock = join(temporaryDirectory, "owner.lock");
      const ownerEvents = join(temporaryDirectory, "owner.events");
      await writeFile(ownerLock, "owner-canary");
      await chmod(ownerLock, 0o644);
      result = runAcquire({
        lockPath: ownerLock,
        eventsPath: ownerEvents,
        wrappers: [
          recordedWrappers,
          "id() {",
          '  if [ "${1:-}" = "-u" ]; then printf \'%s\\n\' 4294967294; else command id "$@"; fi',
          "}",
        ].join("\n"),
      });
      assertSafeFailure(result, "owner mismatch");
      assert.equal(await readFile(ownerLock, "utf8"), "owner-canary");
      assert.equal(await fileMode(ownerLock), 0o644);
      assert.deepEqual(await readEvents(ownerEvents), ["flock-acquired"]);

      const swappedLock = join(temporaryDirectory, "swapped.lock");
      const swappedOriginal = join(temporaryDirectory, "swapped-original");
      const swappedEvents = join(temporaryDirectory, "swapped.events");
      await writeFile(swappedLock, "swapped-canary");
      await chmod(swappedLock, 0o644);
      result = runAcquire({
        lockPath: swappedLock,
        eventsPath: swappedEvents,
        extraEnv: { CONTRACT_MOVED_PATH: swappedOriginal },
        wrappers: [
          "flock() {",
          '  if command flock "$@"; then',
          '    printf \'%s\\n\' flock-acquired >> "$CONTRACT_EVENTS_PATH"',
          '    mv -- "$DEPLOY_LOCK_FILE" "$CONTRACT_MOVED_PATH"',
          '    printf \'%s\' replacement > "$DEPLOY_LOCK_FILE"',
          '    command chmod 640 -- "$DEPLOY_LOCK_FILE"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          "chmod() {",
          '  printf \'%s\\n\' chmod >> "$CONTRACT_EVENTS_PATH"',
          '  command chmod "$@"',
          "}",
        ].join("\n"),
      });
      assertSafeFailure(result, "path replacement after flock");
      assert.equal(await readFile(swappedOriginal, "utf8"), "swapped-canary");
      assert.equal(await fileMode(swappedOriginal), 0o644);
      assert.equal(await readFile(swappedLock, "utf8"), "replacement");
      assert.equal(await fileMode(swappedLock), 0o640);
      assert.deepEqual(await readEvents(swappedEvents), ["flock-acquired"]);

      const chmodSwapLock = join(temporaryDirectory, "chmod-swap.lock");
      const chmodSwapOriginal = join(temporaryDirectory, "chmod-swap-original");
      const chmodSwapEvents = join(temporaryDirectory, "chmod-swap.events");
      await writeFile(chmodSwapLock, "chmod-swap-canary");
      await chmod(chmodSwapLock, 0o644);
      result = runAcquire({
        lockPath: chmodSwapLock,
        eventsPath: chmodSwapEvents,
        extraEnv: { CONTRACT_MOVED_PATH: chmodSwapOriginal },
        wrappers: [
          "flock() {",
          '  if command flock "$@"; then',
          '    printf \'%s\\n\' flock-acquired >> "$CONTRACT_EVENTS_PATH"',
          "    return 0",
          "  fi",
          "  return 1",
          "}",
          "chmod() {",
          '  printf \'%s\\n\' chmod >> "$CONTRACT_EVENTS_PATH"',
          '  mv -- "$DEPLOY_LOCK_FILE" "$CONTRACT_MOVED_PATH"',
          '  printf \'%s\' replacement > "$DEPLOY_LOCK_FILE"',
          '  command chmod 640 -- "$DEPLOY_LOCK_FILE"',
          '  command chmod "$@"',
          "}",
        ].join("\n"),
      });
      assertSafeFailure(result, "path replacement during chmod");
      assert.equal(await readFile(chmodSwapOriginal, "utf8"), "chmod-swap-canary");
      assert.equal(await fileMode(chmodSwapOriginal), 0o600);
      assert.equal(await readFile(chmodSwapLock, "utf8"), "replacement");
      assert.equal(await fileMode(chmodSwapLock), 0o640);
      assert.deepEqual(await readEvents(chmodSwapEvents), ["flock-acquired", "chmod"]);

      const ineffectiveLock = join(temporaryDirectory, "ineffective.lock");
      const ineffectiveEvents = join(temporaryDirectory, "ineffective.events");
      await writeFile(ineffectiveLock, "ineffective-canary");
      await chmod(ineffectiveLock, 0o644);
      result = runAcquire({
        lockPath: ineffectiveLock,
        eventsPath: ineffectiveEvents,
        wrappers: [
          recordedWrappers.slice(0, recordedWrappers.indexOf("chmod() {")),
          "chmod() {",
          '  printf \'%s\\n\' chmod >> "$CONTRACT_EVENTS_PATH"',
          "  return 0",
          "}",
        ].join("\n"),
      });
      assertSafeFailure(result, "ineffective chmod");
      assert.equal(await readFile(ineffectiveLock, "utf8"), "ineffective-canary");
      assert.equal(await fileMode(ineffectiveLock), 0o644);
      assert.deepEqual(await readEvents(ineffectiveEvents), ["flock-acquired", "chmod"]);

      const contendedLock = join(temporaryDirectory, "contended.lock");
      const contendedEvents = join(temporaryDirectory, "contended.events");
      await writeFile(contendedLock, "contended-canary");
      await chmod(contendedLock, 0o644);
      result = runAcquire({
        lockPath: contendedLock,
        eventsPath: contendedEvents,
        wrappers: [
          "flock() { return 1; }",
          "chmod() {",
          '  printf \'%s\\n\' chmod >> "$CONTRACT_EVENTS_PATH"',
          '  command chmod "$@"',
          "}",
        ].join("\n"),
      });
      assertSafeFailure(result, "lock contention");
      assert.equal(await readFile(contendedLock, "utf8"), "contended-canary");
      assert.equal(await fileMode(contendedLock), 0o644);
      assert.deepEqual(await readEvents(contendedEvents), []);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test("private deployment output exposes only immutable static assets to nginx before activation", () => {
  assert.match(deployScript, /^umask 077$/m);
  assert.doesNotMatch(deployScript, /^umask 022$/m);
  assert.doesNotMatch(deployWorkflow, /umask 022/);
  assert.match(deployScript, /normalize_and_verify_release_permissions "\$RELEASE_BUILD_DIR"/);
  assert.match(
    deployScript,
    /chmod 755 "\$RELEASES_DIR" "\$release_root" "\$release_root\/\.next" "\$static_root"/,
  );
  assert.match(deployScript, /find "\$static_root" -type d -exec chmod 755/);
  assert.match(deployScript, /find "\$static_root" -type f -exec chmod 644/);
  assert.match(deployScript, /find "\$static_root" ! -type d ! -type f/);
  assert.match(deployScript, /find "\$server_root" -type d -exec chmod 700/);
  assert.match(deployScript, /find "\$server_root" -type f -exec chmod 600/);
  assert.match(deployScript, /chmod 600 "\$env_file"/);
  assert.match(
    deployScript,
    /verify_public_static_access_for_nginx "\$RELEASE_BUILD_DIR"/,
  );
  assert.match(
    deployScript,
    /NGINX_RUNTIME_USER="\$\{NGINX_RUNTIME_USER:-www\}"/,
  );
  assert.match(deployScript, /if \[ "\$NGINX_RUNTIME_USER" != "www" \]/);
  assert.match(
    deployScript,
    /runuser -u "\$NGINX_RUNTIME_USER" -- test -x "\$ancestor"/,
  );
  assert.match(
    deployScript,
    /runuser -u "\$NGINX_RUNTIME_USER" -- test -r "\$static_file"/,
  );
  assert.match(deployScript, /find "\$static_(?:root|path)" -type f -print0/);
  assert.match(deployScript, /runuser -u "\$FAOLLA_NGINX_RUNTIME_USER" -- test -x/);
  assert.match(
    deployScript,
    /runuser -u "\$FAOLLA_NGINX_RUNTIME_USER" --[\s\\]+test -r/,
  );
  assert.match(deployScript, /--resolve "www\.faolla\.com:443:127\.0\.0\.1"/);
  assert.match(deployScript, /--noproxy "\*"/);
  const permissionIndex = deployScript.indexOf(
    'normalize_and_verify_release_permissions "$RELEASE_BUILD_DIR"',
  );
  const nginxPreMoveIndex = deployScript.indexOf(
    'verify_public_static_access_for_nginx "$RELEASE_BUILD_DIR"',
  );
  const moveIndex = deployScript.indexOf('mv -- "$RELEASE_BUILD_DIR" "$RELEASE_DIR"');
  const fenceIndex = deployScript.lastIndexOf("start_readiness_fence 1 || exit 1");
  const processMutationIndex = deployScript.indexOf("PROCESSES_STOPPED=1");
  assert.ok(permissionIndex >= 0 && permissionIndex < nginxPreMoveIndex);
  assert.ok(nginxPreMoveIndex < moveIndex);
  assert.ok(moveIndex < fenceIndex && fenceIndex < processMutationIndex);
});

test(
  "Linux release permissions expose only immutable static assets and reject special entries",
  { skip: process.platform === "win32" },
  async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "faolla-release-permissions-contract-"),
    );
    const releaseDirectory = join(temporaryDirectory, ".release.building");
    const permissionFunction = extractShellRegion(
      "normalize_and_verify_release_permissions() {",
      "\nprepare_shared_runtime() {",
    );
    const fixtureScript = [
      "set -euo pipefail",
      "umask 077",
      'RELEASES_DIR="$1"',
      'RELEASE_BUILD_DIR="$RELEASES_DIR/.release.building"',
      'mkdir -p "$RELEASE_BUILD_DIR/.next/static/chunks" "$RELEASE_BUILD_DIR/.next/server/app" "$RELEASE_BUILD_DIR/node_modules/private"',
      'printf secret > "$RELEASE_BUILD_DIR/.env.local"',
      'printf public > "$RELEASE_BUILD_DIR/.next/static/chunks/app.js"',
      'printf private > "$RELEASE_BUILD_DIR/.next/server/app/private.js"',
      'printf source > "$RELEASE_BUILD_DIR/package.json"',
      'printf module > "$RELEASE_BUILD_DIR/node_modules/private/index.js"',
      permissionFunction,
      'normalize_and_verify_release_permissions "$RELEASE_BUILD_DIR"',
      "",
    ].join("\n");
    try {
      const result = spawnSync(
        resolveBashExecutable(),
        ["-c", fixtureScript, "release-permission-fixture", temporaryDirectory],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const mode = async (path) => (await stat(path)).mode & 0o777;
      assert.equal(await mode(temporaryDirectory), 0o755);
      assert.equal(await mode(releaseDirectory), 0o755);
      assert.equal(await mode(join(releaseDirectory, ".next")), 0o755);
      assert.equal(await mode(join(releaseDirectory, ".next", "static", "chunks")), 0o755);
      assert.equal(await mode(join(releaseDirectory, ".next", "static", "chunks", "app.js")), 0o644);
      assert.equal(await mode(join(releaseDirectory, ".env.local")), 0o600);
      assert.equal(await mode(join(releaseDirectory, ".next", "server", "app")), 0o700);
      assert.equal(await mode(join(releaseDirectory, ".next", "server", "app", "private.js")), 0o600);
      assert.equal(await mode(join(releaseDirectory, "package.json")), 0o600);
      assert.equal(await mode(join(releaseDirectory, "node_modules", "private")), 0o700);
      assert.equal(await mode(join(releaseDirectory, "node_modules", "private", "index.js")), 0o600);

      const specialPath = join(
        releaseDirectory,
        ".next",
        "static",
        "private.fifo",
      );
      const createSpecial = spawnSync("mkfifo", [specialPath], {
        encoding: "utf8",
      });
      assert.equal(
        createSpecial.status,
        0,
        `${createSpecial.stdout}\n${createSpecial.stderr}`,
      );
      const specialProbe = spawnSync(
        resolveBashExecutable(),
        [
          "-c",
          [
            "set -euo pipefail",
            'RELEASES_DIR="$1"',
            permissionFunction,
            'normalize_and_verify_release_permissions "$RELEASES_DIR/.release.building"',
          ].join("\n"),
          "release-permission-special-fixture",
          temporaryDirectory,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.notEqual(specialProbe.status, 0);
      await unlink(specialPath);

      await symlink(
        "../../server/app/private.js",
        join(releaseDirectory, ".next", "static", "private-link.js"),
      );
      const symlinkProbe = spawnSync(
        resolveBashExecutable(),
        [
          "-c",
          [
            "set -euo pipefail",
            'RELEASES_DIR="$1"',
            permissionFunction,
            'normalize_and_verify_release_permissions "$RELEASES_DIR/.release.building"',
          ].join("\n"),
          "release-permission-symlink-fixture",
          temporaryDirectory,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.notEqual(symlinkProbe.status, 0);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test("deploy workflow bash and every embedded program have real syntax", () => {
  const bash = resolveBashExecutable();
  const runBlocks = extractWorkflowRunBlocks();
  assert.ok(runBlocks.length >= 6);
  for (const [index, source] of runBlocks.entries()) {
    const result = spawnSync(bash, ["-n"], { encoding: "utf8", input: source });
    assert.equal(result.status, 0, `workflow bash block ${index + 1}: ${result.stderr}`);
  }
  const nodeSources = extractWorkflowHeredocs("NODE");
  assert.ok(nodeSources.length >= 8);
  for (const [index, source] of nodeSources.entries()) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { encoding: "utf8", input: source },
    );
    assert.equal(result.status, 0, `workflow NODE heredoc ${index + 1}: ${result.stderr}`);
  }
  const deployNodeSources = extractShellHeredocs(deployScript, "NODE");
  assert.equal(deployNodeSources.length, 14);
  for (const [index, source] of deployNodeSources.entries()) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { encoding: "utf8", input: source },
    );
    assert.equal(result.status, 0, `deploy NODE heredoc ${index + 1}: ${result.stderr}`);
  }
  const pythonSources = extractWorkflowHeredocs("PY");
  assert.equal(pythonSources.length, 1);
  const { candidate, prefix } = resolvePythonExecutable();
  const python = spawnSync(
    candidate,
    [
      ...prefix,
      "-c",
      "import sys; compile(sys.stdin.read(), '<deploy-workflow>', 'exec')",
    ],
    { encoding: "utf8", input: pythonSources[0] },
  );
  assert.equal(python.status, 0, python.stderr);
});

test("actual workflow-run validator rejects every substituted trust dimension", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-readiness-run-contract-"));
  const runPath = join(directory, "run.json");
  const source = extractWorkflowHeredoc(
    'workflow_id="$(node --input-type=module - "$run_json" <<\'NODE\'',
  );
  const expected = {
    id: 8002,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    name: "Ordinary Account Cutover Readiness",
    path: ".github/workflows/ordinary-account-cutover-readiness.yml",
    head_branch: "main",
    head_sha: "a".repeat(40),
    repository: { full_name: "fafona/space" },
    head_repository: { full_name: "fafona/space" },
    workflow_id: 9001,
  };
  const run = async (value) => {
    await writeFile(runPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return spawnSync(process.execPath, ["--input-type=module", "-", runPath], {
      cwd: repositoryRoot,
      input: source,
      encoding: "utf8",
      env: {
        ...process.env,
        READINESS_RUN_ID: "8002",
        READINESS_RUN_ATTEMPT: "1",
        READINESS_WORKFLOW_NAME: "Ordinary Account Cutover Readiness",
        READINESS_WORKFLOW_PATH:
          ".github/workflows/ordinary-account-cutover-readiness.yml",
        DEPLOY_REF: "a".repeat(40),
        GITHUB_REPOSITORY: "fafona/space",
      },
    });
  };
  try {
    const accepted = await run(expected);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, "9001");
    for (const [name, mutate] of [
      ["run id", (value) => { value.id = 8003; }],
      ["attempt", (value) => { value.run_attempt = 2; }],
      ["status", (value) => { value.status = "in_progress"; }],
      ["conclusion", (value) => { value.conclusion = "failure"; }],
      ["event", (value) => { value.event = "push"; }],
      ["name", (value) => { value.name = "CI"; }],
      ["path", (value) => { value.path = ".github/workflows/ci.yml"; }],
      ["branch", (value) => { value.head_branch = "release"; }],
      ["head", (value) => { value.head_sha = "b".repeat(40); }],
      ["repository", (value) => { value.repository.full_name = "attacker/fork"; }],
      ["head repository", (value) => { value.head_repository.full_name = "attacker/fork"; }],
      ["workflow id", (value) => { value.workflow_id = 0; }],
    ]) {
      await t.test(name, async () => {
        const value = structuredClone(expected);
        mutate(value);
        const rejected = await run(value);
        assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`);
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual artifact inventory validator rejects ambiguity, expiry, emptiness, and run substitution", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-readiness-artifact-contract-"));
  const pagesPath = join(directory, "pages.json");
  const outputPath = join(directory, "outputs");
  const source = extractWorkflowHeredoc(
    'node --input-type=module - "$artifact_pages" <<\'NODE\'',
  );
  const artifact = (name, id, digestCharacter) => ({
    id,
    name,
    size_in_bytes: 4096,
    expired: false,
    expires_at: "2099-08-27T12:00:00Z",
    digest: `sha256:${digestCharacter.repeat(64)}`,
    workflow_run: {
      id: 8002,
      head_branch: "main",
      head_sha: "a".repeat(40),
    },
  });
  const expectedArtifacts = [
    artifact("faolla-production-readiness-report-8002-1", 9003, "e"),
    artifact("faolla-production-readiness-attestation-8002-1", 9004, "f"),
  ];
  const run = async (artifacts, totalCount = artifacts.length) => {
    await writeFile(
      pagesPath,
      `${JSON.stringify([{ total_count: totalCount, artifacts }])}\n`,
      { mode: 0o600 },
    );
    await writeFile(outputPath, "", { mode: 0o600 });
    return spawnSync(process.execPath, ["--input-type=module", "-", pagesPath], {
      cwd: repositoryRoot,
      input: source,
      encoding: "utf8",
      env: {
        ...process.env,
        READINESS_RUN_ID: "8002",
        READINESS_RUN_ATTEMPT: "1",
        DEPLOY_REF: "a".repeat(40),
        GITHUB_OUTPUT: outputPath,
      },
    });
  };
  try {
    const accepted = await run(structuredClone(expectedArtifacts));
    assert.equal(accepted.status, 0, accepted.stderr);
    const output = await readFile(outputPath, "utf8");
    assert.match(output, /report_id=9003/);
    assert.match(output, /attestation_id=9004/);
    const cases = [
      ["missing artifact", [structuredClone(expectedArtifacts[0])]],
      ["extra artifact", [...structuredClone(expectedArtifacts), artifact("extra", 9005, "1")]],
      ["duplicate name", [structuredClone(expectedArtifacts[0]), { ...structuredClone(expectedArtifacts[0]), id: 9004 }]],
    ];
    for (const [name, artifacts] of cases) {
      await t.test(name, async () => {
        const rejected = await run(artifacts);
        assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`);
      });
    }
    for (const [name, mutate] of [
      ["expired", (value) => { value.expired = true; }],
      ["past expiry", (value) => { value.expires_at = "2020-01-01T00:00:00Z"; }],
      ["zero bytes", (value) => { value.size_in_bytes = 0; }],
      ["missing digest", (value) => { value.digest = null; }],
      ["wrong run", (value) => { value.workflow_run.id = 8003; }],
      ["wrong branch", (value) => { value.workflow_run.head_branch = "release"; }],
      ["wrong head", (value) => { value.workflow_run.head_sha = "b".repeat(40); }],
    ]) {
      await t.test(name, async () => {
        const artifacts = structuredClone(expectedArtifacts);
        mutate(artifacts[0]);
        const rejected = await run(artifacts);
        assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`);
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("live nested backup revalidation rejects deleted, substituted, stale, and non-exact evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "faolla-deploy-backup-revalidation-"));
  const source = extractWorkflowHeredoc(
    '"$run_json" "$workflow_json" "$artifact_pages" "$details_dir" <<\'NODE\'',
  );
  const readinessValidUntil = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString();
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const artifact = (name, id, digestCharacter) => ({
    id,
    name,
    size_in_bytes: 8192 + id,
    expired: false,
    created_at: createdAt,
    expires_at: expiresAt,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    workflow_run: {
      id: 8001,
      head_branch: "main",
      head_sha: "a".repeat(40),
    },
  });
  const validState = () => ({
    run: {
      id: 8001,
      workflow_id: 7001,
      run_attempt: 2,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      name: "Encrypted Database Backup",
      path: ".github/workflows/database-backup.yml",
      head_branch: "main",
      head_sha: "a".repeat(40),
      repository: { full_name: "fafona/space" },
      head_repository: { full_name: "fafona/space" },
    },
    workflow: {
      id: 7001,
      name: "Encrypted Database Backup",
      path: ".github/workflows/database-backup.yml",
      state: "active",
    },
    pages: [{
      total_count: 5,
      artifacts: [
        artifact("faolla-encrypted-disaster-recovery-8001-2", 91001, "1"),
        artifact("faolla-production-backup-attestation-8001-2", 91002, "2"),
        artifact("faolla-backup-verification-reports-8001-2", 91003, "3"),
        artifact("faolla-encrypted-backup-attestation-bundle-8001-2", 91004, "4"),
        artifact("faolla-production-backup-attestation-bundle-8001-2", 91005, "5"),
      ],
    }],
  });
  const run = async ({
    mutate = () => {},
    mutateDirect = () => {},
    omitDetailId = null,
    extraDetail = false,
  } = {}) => {
    const directory = await mkdtemp(join(root, "case-"));
    try {
      const state = validState();
      mutate(state);
      const runPath = join(directory, "run.json");
      const workflowPath = join(directory, "workflow.json");
      const pagesPath = join(directory, "pages.json");
      const detailsDirectory = join(directory, "details");
      await mkdir(detailsDirectory);
      await Promise.all([
        writeFile(runPath, `${JSON.stringify(state.run)}\n`),
        writeFile(workflowPath, `${JSON.stringify(state.workflow)}\n`),
        writeFile(pagesPath, `${JSON.stringify(state.pages)}\n`),
      ]);
      const directArtifacts = structuredClone(state.pages[0].artifacts);
      mutateDirect(directArtifacts);
      for (const direct of directArtifacts) {
        if (direct.id === omitDetailId) continue;
        await writeFile(
          join(detailsDirectory, `${direct.id}.json`),
          `${JSON.stringify(direct)}\n`,
        );
      }
      if (extraDetail) {
        await writeFile(
          join(detailsDirectory, "99999.json"),
          `${JSON.stringify(artifact("unexpected", 99999, "a"))}\n`,
        );
      }
      return spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-",
          runPath,
          workflowPath,
          pagesPath,
          detailsDirectory,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          input: source,
          env: {
            ...process.env,
            BACKUP_RUN_ID: "8001",
            BACKUP_RUN_ATTEMPT: "2",
            BACKUP_PRIMARY_ARTIFACT_ID: "91001",
            BACKUP_PRIMARY_ARTIFACT_DIGEST: `sha256:${"1".repeat(64)}`,
            BACKUP_ATTESTATION_ARTIFACT_ID: "91002",
            BACKUP_ATTESTATION_ARTIFACT_DIGEST: `sha256:${"2".repeat(64)}`,
            BACKUP_WORKFLOW_NAME: "Encrypted Database Backup",
            BACKUP_WORKFLOW_PATH: ".github/workflows/database-backup.yml",
            DEPLOY_REF: "a".repeat(40),
            GITHUB_REPOSITORY: "fafona/space",
            READINESS_VALID_UNTIL: readinessValidUntil,
          },
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    const accepted = await run();
    assert.equal(accepted.status, 0, accepted.stderr);
    const cases = [
      ["deleted direct artifact", { omitDetailId: 91001 }],
      ["extra direct artifact", { extraDetail: true }],
      ["missing inventory artifact", {
        mutate: (state) => {
          state.pages[0].artifacts.pop();
          state.pages[0].total_count = 4;
        },
      }],
      ["extra inventory artifact", {
        mutate: (state) => {
          state.pages[0].artifacts.push(artifact("unexpected", 91006, "6"));
          state.pages[0].total_count = 6;
        },
      }],
      ["backup attempt", { mutate: (state) => { state.run.run_attempt = 3; } }],
      ["attempt-bound artifact name", {
        mutate: (state) => {
          state.pages[0].artifacts[0].name = "faolla-encrypted-disaster-recovery-8001-3";
        },
      }],
      ["backup run head", { mutate: (state) => { state.run.head_sha = "b".repeat(40); } }],
      ["artifact head", {
        mutate: (state) => { state.pages[0].artifacts[0].workflow_run.head_sha = "b".repeat(40); },
      }],
      ["primary digest", {
        mutate: (state) => { state.pages[0].artifacts[0].digest = `sha256:${"a".repeat(64)}`; },
      }],
      ["primary ID", { mutate: (state) => { state.pages[0].artifacts[0].id = 91999; } }],
      ["expired artifact", { mutate: (state) => { state.pages[0].artifacts[0].expired = true; } }],
      ["artifact TTL", {
        mutate: (state) => { state.pages[0].artifacts[0].expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); },
      }],
      ["direct digest substitution", {
        mutateDirect: (details) => { details[0].digest = `sha256:${"b".repeat(64)}`; },
      }],
      ["workflow path", {
        mutate: (state) => { state.workflow.path = ".github/workflows/other.yml"; },
      }],
      ["run event", { mutate: (state) => { state.run.event = "push"; } }],
      ["run success", { mutate: (state) => { state.run.conclusion = "failure"; } }],
    ];
    for (const [name, options] of cases) {
      await t.test(name, async () => {
        const rejected = await run(options);
        assert.notEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production deployment accepts only a successful exact readiness run for current main", () => {
  assert.doesNotMatch(deployWorkflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(
    deployWorkflow,
    /workflows:\s*\n\s*- Ordinary Account Cutover Readiness/,
  );
  assert.doesNotMatch(deployWorkflow, /workflows:\s*\n\s*- CI/);
  assert.match(
    deployWorkflow,
    /github\.event\.workflow_run\.conclusion == 'success'/,
  );
  assert.match(
    deployWorkflow,
    /github\.event\.workflow_run\.event == 'workflow_dispatch'/,
  );
  assert.doesNotMatch(
    deployWorkflow,
    /github\.event\.workflow_run\.event == 'push'/,
  );
  assert.match(
    deployWorkflow,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(deployWorkflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(deployWorkflow, /\[\[ "\$DEPLOY_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(
    deployWorkflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$READINESS_RUN_ID/,
  );
  assert.match(deployWorkflow, /run\.run_attempt !== expectedRunAttempt/);
  assert.match(
    deployWorkflow,
    /run\.path !== process\.env\.READINESS_WORKFLOW_PATH/,
  );
  assert.match(
    deployWorkflow,
    /workflow\.path !== process\.env\.READINESS_WORKFLOW_PATH/,
  );
  assert.match(deployWorkflow, /workflow\.state !== "active"/);
  assert.match(deployWorkflow, /actions:\s*read/);
  assert.match(deployWorkflow, /attestations:\s*read/);
  assert.match(deployWorkflow, /contents:\s*read/);

  const eligible = (run) =>
    run.conclusion === "success" &&
    run.event === "workflow_dispatch" &&
    run.headRepository === "fafona/space" &&
    run.repository === "fafona/space" &&
    run.headBranch === "main" &&
    /^[0-9a-f]{40}$/.test(run.headSha);
  const valid = {
    conclusion: "success",
    event: "workflow_dispatch",
    headRepository: "fafona/space",
    repository: "fafona/space",
    headBranch: "main",
    headSha: "a".repeat(40),
  };
  assert.equal(eligible(valid), true);
  for (const rejected of [
    { ...valid, conclusion: "failure" },
    { ...valid, event: "push" },
    { ...valid, headRepository: "attacker/fork" },
    { ...valid, headBranch: "release" },
    { ...valid, headSha: "a".repeat(39) },
    { ...valid, headSha: "A".repeat(40) },
    { ...valid, headSha: `${"a".repeat(40)}\nmalicious` },
  ]) {
    assert.equal(eligible(rejected), false);
  }

  assert.match(deployWorkflow, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(deployWorkflow, /EXPECTED_DEPLOY_SHA: \$\{\{ steps\.deploy-commit\.outputs\.sha \}\}/);
  assert.match(deployWorkflow, /"EXPECTED_DEPLOY_SHA"/);
  assert.doesNotMatch(deployWorkflow, /EXPECTED_DEPLOY_SHA='\$EXPECTED_DEPLOY_SHA'/);

  assert.match(deployScript, /APP_BRANCH must be main/);
  assert.match(deployScript, /EXPECTED_DEPLOY_SHA must be an exact lowercase 40-hex commit/);
  assert.match(deployScript, /REMOTE_DEPLOY_SHA="\$\(git rev-parse "origin\/\$APP_BRANCH"\)"/);
  assert.match(deployScript, /git reset --hard "\$EXPECTED_DEPLOY_SHA"/);
  assert.match(deployScript, /git archive --format=tar "\$EXPECTED_DEPLOY_SHA"/);
  assert.doesNotMatch(deployScript, /git archive --format=tar "origin\/\$APP_BRANCH"/);
});

test("readiness artifacts are exact, canonical, provenance-verified, and CLI-bound", () => {
  assert.match(deployWorkflow, /artifacts\.length !== 2/);
  assert.match(
    deployWorkflow,
    /faolla-production-readiness-report-\$\{process\.env\.READINESS_RUN_ID\}-\$\{process\.env\.READINESS_RUN_ATTEMPT\}/,
  );
  assert.match(
    deployWorkflow,
    /faolla-production-readiness-attestation-\$\{process\.env\.READINESS_RUN_ID\}-\$\{process\.env\.READINESS_RUN_ATTEMPT\}/,
  );
  assert.match(deployWorkflow, /artifact\.expired !== false/);
  assert.match(deployWorkflow, /artifact\.size_in_bytes <= 0/);
  assert.match(deployWorkflow, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(deployWorkflow, /artifact\.workflow_run\?\.id !== Number/);
  assert.match(deployWorkflow, /report_archive_sha.*READINESS_REPORT_ARTIFACT_DIGEST/);
  assert.match(
    deployWorkflow,
    /attestation_archive_sha.*READINESS_ATTESTATION_ARTIFACT_DIGEST/,
  );
  assert.match(deployWorkflow, /if len\(entries\) != 1/);
  assert.match(deployWorkflow, /entry\.filename != expected_name/);
  assert.match(deployWorkflow, /stat\.S_ISLNK\(mode\)/);
  assert.match(deployWorkflow, /os\.O_EXCL/);
  assert.match(deployWorkflow, /raw\.equals\(canonicalJsonBytes\(parsed\)\)/);

  assert.match(deployWorkflow, /gh attestation verify "\$subject_file"/);
  assert.match(deployWorkflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(deployWorkflow, /--signer-workflow "\$signer_workflow"/);
  assert.match(deployWorkflow, /--source-digest "\$DEPLOY_REF"/);
  assert.match(deployWorkflow, /--source-ref "refs\/heads\/main"/);
  assert.match(deployWorkflow, /--deny-self-hosted-runners/);
  assert.doesNotMatch(deployWorkflow, /--no-public-good/);
  assert.match(deployWorkflow, /results\.length !== 1/);
  assert.match(deployWorkflow, /"production-readiness-report\.json"/);
  assert.match(deployWorkflow, /"production-readiness-attestation\.json"/);

  assert.match(
    deployWorkflow,
    /node scripts\/production-release-attestation\.mjs validate/,
  );
  assert.match(deployWorkflow, /--kind readiness/);
  assert.match(deployWorkflow, /--expected-repository "\$GITHUB_REPOSITORY"/);
  assert.match(deployWorkflow, /--expected-target-sha "\$DEPLOY_REF"/);
  assert.match(deployWorkflow, /--expected-run-id "\$READINESS_RUN_ID"/);
  assert.match(
    deployWorkflow,
    /--expected-run-attempt "\$READINESS_RUN_ATTEMPT"/,
  );
  assert.match(
    deployWorkflow,
    /--expected-readiness-artifact-id "\$READINESS_REPORT_ARTIFACT_ID"/,
  );
  assert.match(
    deployWorkflow,
    /--expected-readiness-artifact-digest "\$READINESS_REPORT_ARTIFACT_DIGEST"/,
  );
  assert.match(deployWorkflow, /--minimum-remaining-seconds 6100/);
  assert.match(deployWorkflow, /summary\.backupRunId/);
  assert.match(deployWorkflow, /summary\.backupRunAttempt/);
  assert.match(deployWorkflow, /summary\.backupArtifactId/);
  assert.match(deployWorkflow, /summary\.backupAttestationArtifactId/);
});

test("nested backup evidence is re-fetched and exact-five validated immediately before SSH", () => {
  const revalidationIndex = deployWorkflow.indexOf(
    "      - name: Revalidate Live Recursive Backup Evidence",
  );
  const setupSshIndex = deployWorkflow.indexOf("      - name: Setup SSH");
  const deploySshIndex = deployWorkflow.indexOf("      - name: Deploy To Server");
  assert.ok(revalidationIndex >= 0);
  assert.ok(revalidationIndex < setupSshIndex && setupSshIndex < deploySshIndex);
  assert.match(
    deployWorkflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$BACKUP_RUN_ID"/,
  );
  assert.match(
    deployWorkflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/workflows\/\$workflow_id"/,
  );
  assert.match(
    deployWorkflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$BACKUP_RUN_ID\/artifacts\?per_page=100/,
  );
  assert.match(
    deployWorkflow,
    /repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$artifact_id"/,
  );
  assert.match(deployWorkflow, /run\.run_attempt !== expectedRunAttempt/);
  assert.match(deployWorkflow, /run\.event !== "workflow_dispatch"/);
  assert.match(deployWorkflow, /run\.conclusion !== "success"/);
  assert.match(deployWorkflow, /artifacts\.length !== 5/);
  assert.match(deployWorkflow, /page\.total_count !== 5/);
  for (const name of [
    "faolla-encrypted-disaster-recovery-",
    "faolla-production-backup-attestation-",
    "faolla-backup-verification-reports-",
    "faolla-encrypted-backup-attestation-bundle-",
    "faolla-production-backup-attestation-bundle-",
  ]) {
    assert.ok(deployWorkflow.includes(name), `missing exact backup artifact name: ${name}`);
  }
  assert.match(deployWorkflow, /ids\.has\(artifact\.id\)/);
  assert.match(deployWorkflow, /artifact\.size_in_bytes <= 0/);
  assert.match(deployWorkflow, /artifact\.expired !== false/);
  assert.match(deployWorkflow, /expiresAt\.milliseconds < readinessValidUntil\.milliseconds/);
  assert.match(deployWorkflow, /primary\.id !== expectedPrimaryId/);
  assert.match(deployWorkflow, /primary\.digest !== process\.env\.BACKUP_PRIMARY_ARTIFACT_DIGEST/);
  assert.match(deployWorkflow, /attestation\.id !== expectedAttestationId/);
  assert.match(deployWorkflow, /attestation\.digest !== process\.env\.BACKUP_ATTESTATION_ARTIFACT_DIGEST/);
  assert.match(deployWorkflow, /readinessValidUntil\.milliseconds - Date\.now\(\) < 6_000_000/);
});

test("verified readiness bytes and artifact references ride inside the V2 payload without changing 35 deploy values", () => {
  assert.equal(DEPLOY_PAYLOAD_KEYS.length, 35);
  assert.match(deployWorkflow, /releaseAttestation = \{/);
  for (const field of [
    "repository",
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
  ]) {
    assert.match(deployWorkflow, new RegExp(`\\b${field}\\b`));
  }
  assert.match(
    deployWorkflow,
    /canonicalJsonBytes\(\{ schemaVersion: 1, values, releaseAttestation \}\)\.toString\("base64"\)/,
  );
  assert.match(
    deployWorkflow,
    /canonicalSha256 !== required\("PRODUCTION_READINESS_ATTESTATION_SHA256", sha256\)/,
  );
  assert.match(
    deployWorkflow,
    /rm -f -- "\$PRODUCTION_READINESS_ATTESTATION_FILE"/,
  );
  assert.doesNotMatch(deployWorkflow, /cat "\$PRODUCTION_READINESS_ATTESTATION_FILE"/);
  assert.match(deployWorkflow, /DEPLOY_ENVELOPE_MAGIC="FAOLLA_DEPLOY_ENVELOPE_V2"/);
});

test("remote preflight is rooted in the original payload bytes rather than replaceable sidecars", () => {
  assert.match(deployScript, /release\.repository !== "fafona\/space"/);
  assert.match(deployScript, /const trustedReleaseValues = \[/);
  assert.match(deployScript, /\["RELEASE_READINESS_RUN_ATTEMPT", release\.readinessRunAttempt\]/);
  assert.match(deployScript, /\["DEPLOY_ATTESTATION_DEVICE", String\(attestationFileIdentity\.dev\)\]/);
  assert.match(deployScript, /\["DEPLOY_RELEASE_BINDING_SHA256", createHash\("sha256"\)/);
  assert.doesNotMatch(deployScript, /printf -v "\$binding_key"/);
  assert.match(deployScript, /constants\.O_RDONLY \| \(constants\.O_NOFOLLOW \?\? 0\)/);
  assert.match(deployScript, /const readFrozenFile = \(path, identity, expectedSha256\) =>/);
  assert.match(deployScript, /String\(before\.dev\) !== identity\.device/);
  assert.match(deployScript, /digest\(bytes\) !== expectedSha256/);
  assert.match(deployScript, /const expectedBinding = \{/);
  assert.match(deployScript, /"\/proc\/self\/fd\/3"/);
  assert.match(deployScript, /spawnSync\(process\.execPath/);
  assert.match(deployScript, /finalIdentityMatches\(attestation, attestationPath\)/);
  assert.match(deployScript, /EXPECTED_RELEASE_REPOSITORY="fafona\/space"/);
  assert.match(deployScript, /--expected-repository", expectedRepository/);
  assert.match(deployScript, /--expected-attestation-sha256 "\$RELEASE_CANONICAL_SHA256"/);
  const checkoutIndex = deployScript.indexOf('git reset --hard "$EXPECTED_DEPLOY_SHA"');
  const preflightIndex = deployScript.indexOf("validate_release_attestation_preflight\n", checkoutIndex);
  const firstEnvironmentMutationIndex = deployScript.indexOf('write_env_value "WEB_PUSH_PUBLIC_KEY"');
  assert.ok(checkoutIndex >= 0 && checkoutIndex < preflightIndex);
  assert.ok(preflightIndex < firstEnvironmentMutationIndex);
});

test("readiness fence lifecycle holds every web checkpoint and releases before workers", () => {
  const sequence = deployScript.slice(
    deployScript.indexOf('if [ ! -f "$RELEASE_BUILD_DIR/.next/BUILD_ID"'),
  );
  const ordered = [
    "previous_web_process_identity_matches || exit 1",
    "previous_runtime_recovery_identity_matches || exit 1",
    "start_readiness_fence 1 || exit 1",
    "assert_readiness_fence_before_process_quiescence",
    "PROCESSES_STOPPED=1",
    'stop_pm2_process_bounded "$APP_NAME" "$WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS" || exit 1',
    "wait_for_port_release || exit 1",
    "stop_previous_automation_worker_bounded || exit 1",
    "wait_for_readiness_fence_database_quiescence || exit 1",
    'assert_readiness_fence_before_forward_operation "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" || exit 1',
    "FORWARD_MUTATION_STARTED=1",
    "prepare_shared_runtime || exit 1",
    'switch_current_release "$RELEASE_DIR" || exit 1',
    "capture_candidate_current_identity_for_booking_retry",
    'wait_for_release_health "$FAOLLA_WEB_BUILD_ID"',
    "capture_candidate_web_identity_for_booking_retry",
    "verify_booking_persistence_with_bounded_retry",
    "run_local_release_smoke",
    "install_runtime_compatibility_links || exit 1",
    "verify_nginx_release_static_access || exit 1",
    "release_readiness_fence || exit 1",
    "WEB_COMMITTED=1",
    'start_automation_worker_process "$RELEASE_DIR"',
  ];
  let previousIndex = -1;
  for (const needle of ordered) {
    const index = sequence.indexOf(needle);
    assert.ok(index > previousIndex, `out-of-order lifecycle step: ${needle}`);
    previousIndex = index;
  }
  assert.doesNotMatch(sequence, /BOOKING_PERSISTENCE_STATUS/);
  assert.equal(
    sequence.match(/previous_web_process_identity_matches \|\| exit 1/g)?.length,
    2,
  );
  assert.equal(
    sequence.match(/previous_runtime_recovery_identity_matches \|\| exit 1/g)?.length,
    2,
  );
  assert.match(
    sequence,
    /assert_readiness_fence_before_process_quiescence[\s\S]+previous_web_process_identity_matches \|\| exit 1\s+previous_runtime_recovery_identity_matches \|\| exit 1\s+PROCESSES_STOPPED=1/,
  );
  assert.match(sequence, /assert_readiness_fence_forward_checkpoint \|\| exit 1/g);
  assert.match(deployScript, /blocked_cancelled[\s\S]{0,180}return 2/);
  assert.doesNotMatch(deployScript, /retrying protected quiescence/);
  assert.doesNotMatch(
    deployScript,
    /pg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
  assert.match(
    deployScript,
    /COALESCE\([\s\S]{0,160}pg_catalog\.bool_and\(cancelled_waiters\.cancelled\)/,
  );
  assert.match(deployScript, /pg_catalog\.pg_cancel_backend\(blocked_waiters\.pid\)/);
  assert.match(deployScript, /WHERE NOT :'fence_allow_waiters'::boolean/);
  assert.match(
    deployScript,
    /:'fence_had_waiters'::boolean[\s\S]{0,120}OR \(SELECT pg_catalog\.count\(\*\) FROM blocked_waiters\) <> 0/,
  );
  assert.match(deployScript, /\\if :fence_should_wait_for_cancellation/);
  assert.match(deployScript, /auth_share <> 1[\s\S]+auth_ax <> 0[\s\S]+pages_ax <> 0[\s\S]+registry_ax <> 1/);
  assert.match(deployScript, /trap 'handle_deploy_signal 129' HUP/);
  assert.match(deployScript, /trap 'handle_deploy_signal 143' TERM/);
  assert.match(deployScript, /trap 'handle_deploy_signal 130' INT/);
  assert.match(deployScript, /cleanup_failed_build\(\)[\s\S]+trap '' HUP TERM INT/);
  assert.match(deployScript, /SELECT pg_catalog\.pg_stat_clear_snapshot\(\) AS cleared/);
  assert.match(deployScript, /pg_catalog\.pg_terminate_backend\(blocked_waiters\.pid, 5000\)/);
  assert.match(
    deployScript,
    /exited or changed identity before its ready marker[\s\S]{0,500}reject_failed_readiness_fence/,
  );
  assert.match(
    deployScript,
    /ensure_readiness_fence_for_rollback[\s\S]+rollback_release[\s\S]+release_readiness_fence[\s\S]+start_frozen_previous_automation_worker_process/,
  );
  assert.match(
    deployScript,
    /deploy_rollback_failed_fence_release[\s\S]+discard_failed_readiness_fence/,
  );
  assert.match(deployScript, /readiness_fence_original_process_matches[\s\S]+kill -TERM/);
  assert.match(deployScript, /terminate_readiness_fence_database_session \|\| cleanup_status=1/);
  assert.match(deployScript, /remaining\.remainingCount !== "0"/);
  assert.match(deployScript, /READINESS_FENCE_MAXIMUM_HOLD_SECONDS="\$\{[^}]+:-1320\}"/);
  assert.match(deployScript, /READINESS_FENCE_MINIMUM_TTL_SECONDS="\$\{[^}]+:-1860\}"/);
  assert.match(deployScript, /READINESS_FENCE_ROLLBACK_RESERVE_SECONDS="\$\{[^}]+:-780\}"/);
  assert.match(deployScript, /PREVIOUS_RUNTIME_RECOVERY_IDENTITY_TIMEOUT_SECONDS="\$\{[^}]+:-5\}"/);
  assert.match(deployScript, /PREVIOUS_WEB_PROCESS_IDENTITY_TOTAL_TIMEOUT_SECONDS="\$\{[^}]+:-10\}"/);
  assert.match(deployScript, /RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS="\$\{[^}]+:-6100\}"/);
  assert.match(
    deployScript,
    /AUTOMATION_WORKER_KILL_TIMEOUT_MS[\s\S]{0,500}7 \* READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS[\s\S]{0,180}-gt "\$READINESS_FENCE_ROLLBACK_RESERVE_SECONDS"/,
  );
  assert.match(
    deployScript,
    /assert_readiness_fence_forward_checkpoint\(\) \{[\s\S]{0,160}READINESS_FENCE_FORWARD_READY/,
  );
  assert.match(
    deployScript,
    /assert_readiness_fence_before_forward_operation\(\) \{[\s\S]{0,220}READINESS_FENCE_FORWARD_READY/,
  );
  assert.match(
    deployScript,
    /ensure_readiness_fence_for_rollback[\s\S]+start_readiness_fence 0[\s\S]+discard_failed_readiness_fence/,
  );
  assert.match(
    deployScript,
    /recover_pre_forward_previous_runtime[\s\S]+ensure_readiness_fence_for_rollback/,
  );
  assert.match(
    deployScript,
    /the frozen previous release and candidate must target the same database service/,
  );
  assert.match(
    deployScript,
    /timeout --signal=TERM --kill-after=2s 10s pm2 save/,
  );
  assert.match(deployScript, /an exact previous atomic release is required before environment mutation/);
  const fenceStartup = extractShellRegion(
    "start_readiness_fence() {",
    "\nrelease_readiness_fence() {",
  );
  assert.doesNotMatch(fenceStartup, /discard_failed_readiness_fence \|\| true/);
  assert.match(
    fenceStartup,
    /reject_failed_readiness_fence/,
  );
  const rejection = extractShellRegion(
    "reject_failed_readiness_fence() {",
    "\nstart_readiness_fence() {",
  );
  const rejectionOrder = [
    "quiesce_failed_readiness_fence",
    "readiness_fence_safe_failure_record",
    "cleanup_readiness_fence_files",
    "report_readiness_fence_failure",
  ];
  let rejectionIndex = -1;
  for (const needle of rejectionOrder) {
    const index = rejection.indexOf(needle);
    assert.ok(index > rejectionIndex, `out-of-order fence rejection step: ${needle}`);
    rejectionIndex = index;
  }
  assert.doesNotMatch(rejection, /discard_failed_readiness_fence/);
  assert.match(fenceStartup, /readiness_fence_database_locks_invalid/);
  assert.match(fenceStartup, /readiness_fence_marker_invalid/);
  assert.match(fenceStartup, /readiness_fence_process_identity_invalid/);
  assert.match(fenceStartup, /readiness_fence_startup_timeout/);
  assert.match(
    deployScript,
    /readiness fence cleanup completed[\s\S]+readiness fence cleanup could not be proven/,
  );
  assert.doesNotMatch(deployScript, /cat\s+[^\n]*READINESS_FENCE_LOG|tail\s+[^\n]*READINESS_FENCE_LOG/);
});

test("a late frozen-runtime drift fails before any protected process is stopped", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-pre-stop-identity-"));
  const callsPath = join(temporaryDirectory, "calls");
  const transition = extractShellRegion(
    "previous_web_process_identity_matches || exit 1\nprevious_runtime_recovery_identity_matches || exit 1\nstart_readiness_fence 1 || exit 1",
    "\nFORWARD_MUTATION_STARTED=1",
  ).replaceAll("exit 1", "return 1");
  const script = [
    "set +e",
    `CALLS='${toBashPath(callsPath)}'`,
    "PROCESSES_STOPPED=0",
    "AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS=20",
    "WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS=40",
    "PORT_RELEASE_TOTAL_TIMEOUT_SECONDS=60",
    "RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS=60",
    "PREVIOUS_RUNTIME_RECOVERY_IDENTITY_TIMEOUT_SECONDS=5",
    "PREVIOUS_WEB_PROCESS_IDENTITY_TOTAL_TIMEOUT_SECONDS=10",
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
    "APP_NAME=web",
    "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
    "WEB_IDENTITY_CALLS=0",
    "RUNTIME_IDENTITY_CALLS=0",
    "previous_web_process_identity_matches() { WEB_IDENTITY_CALLS=$((WEB_IDENTITY_CALLS + 1)); record web-id; return 0; }",
    "previous_runtime_recovery_identity_matches() { RUNTIME_IDENTITY_CALLS=$((RUNTIME_IDENTITY_CALLS + 1)); record runtime-id; [ \"$RUNTIME_IDENTITY_CALLS\" -lt 2 ]; }",
    "start_readiness_fence() { record \"start-fence:$1\"; return 0; }",
    "assert_readiness_fence_before_process_quiescence() { record \"prequiesce:$1\"; return 0; }",
    "stop_pm2_process_bounded() { record stop-web; return 0; }",
    "wait_for_port_release() { record port; return 0; }",
    "stop_previous_automation_worker_bounded() { record stop-worker; return 0; }",
    "wait_for_readiness_fence_database_quiescence() { record database-quiet; return 0; }",
    "assert_readiness_fence_before_forward_operation() { record forward-check; return 0; }",
    "run_transition() {",
    transition,
    "}",
    "run_transition; status=$?",
    "printf '%s %s\\n' \"$status\" \"$PROCESSES_STOPPED\"",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, "1 0\n");
    assert.equal(
      await readFile(callsPath, "utf8"),
      "web-id\nruntime-id\nstart-fence:1\nprequiesce:255\nweb-id\nruntime-id\n",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("a pre-stop failure releases the provisional fence without cancelling waiters or restarting", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-pre-stop-cleanup-"));
  const callsPath = join(temporaryDirectory, "calls");
  const cleanupFunction = extractShellRegion(
    "cleanup_failed_build() {",
    "\ntrap cleanup_failed_build EXIT",
  );
  const script = [
    "set +e",
    cleanupFunction,
    `CALLS='${toBashPath(callsPath)}'`,
    `RELEASE_BUILD_DIR='${toBashPath(join(temporaryDirectory, "missing-build"))}'`,
    `RELEASE_DIR='${toBashPath(join(temporaryDirectory, "missing-release"))}'`,
    `DEPLOY_ATTESTATION_FILE='${toBashPath(join(temporaryDirectory, "missing-attestation"))}'`,
    `DEPLOY_RELEASE_BINDING_FILE='${toBashPath(join(temporaryDirectory, "missing-binding"))}'`,
    "WEB_COMMITTED=0",
    "PROCESSES_STOPPED=0",
    "SWITCH_COMPLETED=0",
    "FORWARD_MUTATION_STARTED=0",
    "ROLLBACK_COMPLETED=0",
    "READINESS_FENCE_ACTIVE=1",
    "READINESS_FENCE_RELEASE_REQUESTED=0",
    "READINESS_FENCE_CLEANUP_VERIFIED=0",
    "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
    "release_readiness_fence() { record \"release:$1\"; READINESS_FENCE_ACTIVE=0; return 0; }",
    "discard_failed_readiness_fence() { record discard; return 0; }",
    "recover_pre_forward_previous_runtime() { record restart; return 0; }",
    "ensure_readiness_fence_for_rollback() { record strict; return 0; }",
    "rollback_release() { record rollback; return 0; }",
    "safe_remove_release_path() { record remove; return 0; }",
    "false",
    "cleanup_failed_build",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(await readFile(callsPath, "utf8"), "release:1\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("a failed pre-forward runtime restore still proves fence cleanup independently", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-pre-forward-cleanup-"));
  const callsPath = join(temporaryDirectory, "calls");
  const cleanupFunction = extractShellRegion(
    "cleanup_failed_build() {",
    "\ntrap cleanup_failed_build EXIT",
  );
  const script = [
    "set +e",
    cleanupFunction,
    `CALLS='${toBashPath(callsPath)}'`,
    `RELEASE_BUILD_DIR='${toBashPath(join(temporaryDirectory, "missing-build"))}'`,
    `RELEASE_DIR='${toBashPath(join(temporaryDirectory, "missing-release"))}'`,
    `DEPLOY_ATTESTATION_FILE='${toBashPath(join(temporaryDirectory, "missing-attestation"))}'`,
    `DEPLOY_RELEASE_BINDING_FILE='${toBashPath(join(temporaryDirectory, "missing-binding"))}'`,
    "WEB_COMMITTED=0",
    "PROCESSES_STOPPED=1",
    "SWITCH_COMPLETED=0",
    "FORWARD_MUTATION_STARTED=0",
    "ROLLBACK_COMPLETED=0",
    "READINESS_FENCE_ACTIVE=0",
    "READINESS_FENCE_RELEASE_REQUESTED=0",
    "READINESS_FENCE_CLEANUP_VERIFIED=0",
    "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
    "release_readiness_fence() { record release; return 1; }",
    "discard_failed_readiness_fence() { record discard; READINESS_FENCE_ACTIVE=0; READINESS_FENCE_CLEANUP_VERIFIED=1; return 0; }",
    "recover_pre_forward_previous_runtime() { record restart; return 1; }",
    "cleanup_pre_forward_previous_runtime_attempts() { record cleanup-runtime; return 0; }",
    "ensure_readiness_fence_for_rollback() { record strict; return 1; }",
    "rollback_release() { record rollback; return 1; }",
    "safe_remove_release_path() { record remove; return 0; }",
    "false",
    "cleanup_failed_build",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      result.stdout,
      "[deploy] failed to restore the frozen previous runtime after pre-forward quiescence\n" +
        "[deploy] readiness fence cleanup completed\n",
    );
    assert.equal(result.stderr, "");
    assert.equal(await readFile(callsPath, "utf8"), "restart\ncleanup-runtime\ndiscard\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("unverified pre-forward PM2 cleanup is surfaced without persisting unknown state", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-pre-forward-unverified-"));
  const callsPath = join(temporaryDirectory, "calls");
  const cleanupFunction = extractShellRegion(
    "cleanup_failed_build() {",
    "\ntrap cleanup_failed_build EXIT",
  );
  const script = [
    "set +e",
    cleanupFunction,
    `CALLS='${toBashPath(callsPath)}'`,
    `RELEASE_BUILD_DIR='${toBashPath(join(temporaryDirectory, "missing-build"))}'`,
    `RELEASE_DIR='${toBashPath(join(temporaryDirectory, "missing-release"))}'`,
    `DEPLOY_ATTESTATION_FILE='${toBashPath(join(temporaryDirectory, "missing-attestation"))}'`,
    `DEPLOY_RELEASE_BINDING_FILE='${toBashPath(join(temporaryDirectory, "missing-binding"))}'`,
    "WEB_COMMITTED=0",
    "PROCESSES_STOPPED=1",
    "SWITCH_COMPLETED=0",
    "FORWARD_MUTATION_STARTED=0",
    "ROLLBACK_COMPLETED=0",
    "READINESS_FENCE_ACTIVE=0",
    "READINESS_FENCE_RELEASE_REQUESTED=0",
    "READINESS_FENCE_CLEANUP_VERIFIED=1",
    "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
    "recover_pre_forward_previous_runtime() { record restart; return 1; }",
    "cleanup_pre_forward_previous_runtime_attempts() { record cleanup-unverified; return 1; }",
    "discard_failed_readiness_fence() { record discard; return 1; }",
    "safe_remove_release_path() { record remove; return 0; }",
    "false",
    "cleanup_failed_build",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      result.stdout,
      "[deploy] failed to restore the frozen previous runtime after pre-forward quiescence\n" +
        "[deploy] pre-forward runtime recovery cleanup could not be proven: cleanup_unverified\n" +
        "[deploy] readiness fence cleanup completed\n",
    );
    assert.equal(result.stderr, "");
    assert.equal(await readFile(callsPath, "utf8"), "restart\ncleanup-unverified\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("only a missing Supabase anon key inherits from the URL-bound frozen previous release", () => {
  const resolution = extractShellRegion(
    'FINAL_NEXT_PUBLIC_SUPABASE_URL="$(decode_base64_value',
    'write_env_value "NEXT_PUBLIC_SUPABASE_URL"',
  );
  assert.match(
    resolution,
    /timeout --signal=TERM --kill-after=1s 5s[\s\S]+read-production-supabase-environment\.mjs anon-key[\s\S]+PREVIOUS_RUNTIME_DIR.*\.env\.local.*PREVIOUS_BUILD_ID[\s\S]+FINAL_NEXT_PUBLIC_SUPABASE_URL/,
  );
  assert.match(
    resolution,
    /if \[ -z "\$FINAL_NEXT_PUBLIC_SUPABASE_URL" \]; then[\s\S]+current Supabase public URL is unavailable[\s\S]+if \[ -z "\$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY" \]; then/,
  );
  assert.doesNotMatch(resolution, /FINAL_NEXT_PUBLIC_SUPABASE_URL="\$PERSISTED/);
  assert.match(
    resolution,
    /FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY="\$PERSISTED_NEXT_PUBLIC_SUPABASE_ANON_KEY"/,
  );
  assert.match(
    resolution,
    /FINAL_SUPABASE_INTERNAL_URL="\$\{SUPABASE_INTERNAL_URL_FROM_B64:-http:\/\/127\.0\.0\.1:8000\}"/,
  );
  assert.doesNotMatch(
    resolution,
    /FINAL_SUPABASE_INTERNAL_URL="\$\{SUPABASE_INTERNAL_URL_FROM_B64:-\$SUPABASE_INTERNAL_URL\}"/,
  );
  for (const assignment of [
    'export SUPABASE_INTERNAL_URL="$FINAL_SUPABASE_INTERNAL_URL"',
    'export NEXT_PUBLIC_SUPABASE_URL="$FINAL_NEXT_PUBLIC_SUPABASE_URL"',
    'export NEXT_PUBLIC_SUPABASE_ANON_KEY="$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY"',
  ]) {
    assert.ok(resolution.includes(assignment));
  }
  assert.match(
    deployScript,
    /write_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "\$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY"/,
  );
});

test("previous release identity is independently prefix-bound and rechecked around frozen reads", () => {
  const identity = extractShellRegion(
    'PREVIOUS_LINK_TARGET="$(readlink -f',
    'FAOLLA_WEB_BUILD_ID="$EXPECTED_DEPLOY_SHA"',
  );
  assert.doesNotMatch(identity, /grep '\^FAOLLA_WEB_BUILD_ID=/);
  assert.match(
    identity,
    /PREVIOUS_RELEASE_NAME="\$\(basename -- "\$PREVIOUS_RUNTIME_DIR"/,
  );
  assert.match(identity, /\^\(\[0-9a-f\]\{12\}\)-\[0-9\]\{14\}\$/);
  assert.match(
    identity,
    /timeout --signal=TERM --kill-after=1s 5s[\s\S]+read-production-supabase-environment\.mjs build-id/,
  );
  assert.match(identity, /pm2 pid "\$APP_NAME"/);
  assert.match(identity, /stat -Lc '%d:%i:%Z' -- "\$PREVIOUS_RUNTIME_DIR"/);
  assert.match(identity, /stat -Lc '%d:%i:%Z' -- "\/proc\/\$PREVIOUS_WEB_PID\/cwd"/);
  assert.match(identity, /PREVIOUS_WEB_CWD_IDENTITY" != "\$PREVIOUS_RUNTIME_IDENTITY"/);
  assert.match(
    identity,
    /read-production-supabase-environment\.mjs process-snapshot/,
  );
  assert.match(
    identity,
    /read-production-supabase-environment\.mjs rollback-snapshot/,
  );
  assert.match(identity, /PREVIOUS_WEB_PROCESS_START_TICKS/);
  assert.match(identity, /SUPABASE_INTERNAL_URL[\s\S]+NEXT_PUBLIC_SUPABASE_URL[\s\S]+NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(
    identity,
    /PREVIOUS_BUILD_ID" != "\$LEGACY_MISSING_PROCESS_ENVIRONMENT_BUILD_ID/,
  );
  assert.match(identity, /CURRENT_PREVIOUS_WEB_PID" != "\$PREVIOUS_WEB_PID/);
  assert.match(
    identity,
    /CURRENT_PREVIOUS_WEB_PROCESS_START_TICKS" != "\$PREVIOUS_WEB_PROCESS_START_TICKS/,
  );
  assert.ok(
    identity.match(/readlink -f "\$CURRENT_LINK"/g)?.length >= 2,
    "current release link must be checked before and after the frozen build read",
  );
  const captureIndex = deployScript.indexOf('PREVIOUS_ENVIRONMENT_CAPTURE="$(');
  const finalExportIndex = deployScript.indexOf('export SUPABASE_INTERNAL_URL="$FINAL_SUPABASE_INTERNAL_URL"');
  assert.ok(captureIndex >= 0 && captureIndex < finalExportIndex);
});

test("missing process environment compatibility is exact-build-only and reconciles frozen values", () => {
  const legacyBuild = "2a121454a18a16ae30e356977ca82b24a310e8e5";
  assert.match(
    deployScript,
    new RegExp(
      `LEGACY_MISSING_PROCESS_ENVIRONMENT_BUILD_ID="${legacyBuild}"[\\s\\S]+` +
        "readonly LEGACY_MISSING_PROCESS_ENVIRONMENT_BUILD_ID",
    ),
  );
  const gate = extractShellRegion(
    'PREVIOUS_PROCESS_ENVIRONMENT_STATUS="${PREVIOUS_ENVIRONMENT_PARTS[0]:-}"',
    "unset PREVIOUS_ENVIRONMENT_PARTS",
  );
  const presentValues = ["old-internal", "old-public", "old-anon"];
  const presentFrame = [
    "present",
    "4242",
    ...presentValues.map((value) => Buffer.from(value).toString("base64")),
  ];
  const fixtures = [
    {
      name: "known legacy build with all values absent",
      build: legacyBuild,
      frame: ["absent", "4242"],
      expectedStatus: 0,
    },
    {
      name: "modern build with all values absent",
      build: "b".repeat(40),
      frame: ["absent", "4242"],
      expectedStatus: 1,
    },
    {
      name: "unknown old build with all values absent",
      build: "c".repeat(40),
      frame: ["absent", "4242"],
      expectedStatus: 1,
    },
    {
      name: "malformed absent frame",
      build: legacyBuild,
      frame: ["absent", "4242", "unexpected"],
      expectedStatus: 1,
    },
    {
      name: "absent frame with invalid start ticks",
      build: legacyBuild,
      frame: ["absent", "0"],
      expectedStatus: 1,
    },
    {
      name: "present frame with invalid base64",
      build: "b".repeat(40),
      frame: ["present", "4242", "not_base64", presentFrame[3], presentFrame[4]],
      expectedStatus: 1,
    },
    {
      name: "present frame with missing field",
      build: "b".repeat(40),
      frame: presentFrame.slice(0, 4),
      expectedStatus: 1,
    },
    {
      name: "complete process environment on a modern build",
      build: "b".repeat(40),
      frame: presentFrame,
      expectedStatus: 0,
    },
  ];
  for (const fixture of fixtures) {
    const array = fixture.frame.map((value) => `'${value}'`).join(" ");
    const script = [
      "set -euo pipefail",
      `LEGACY_MISSING_PROCESS_ENVIRONMENT_BUILD_ID='${legacyBuild}'`,
      `PREVIOUS_BUILD_ID='${fixture.build}'`,
      `PREVIOUS_ENVIRONMENT_PARTS=(${array})`,
      gate,
      "printf 'accepted\\n'",
    ].join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(
      result.status,
      fixture.expectedStatus,
      `${fixture.name}\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.stderr, "", fixture.name);
    for (const value of presentValues) {
      assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
    }
  }

  const reconciliation = extractShellRegion(
    'if [ "$PREVIOUS_PROCESS_ENVIRONMENT_STATUS" = "present" ]; then',
    "\nunset PREVIOUS_PROCESS_SUPABASE_INTERNAL_URL_B64",
  );
  for (const fixture of [
    { name: "all values match", values: presentValues, expectedStatus: 0 },
    {
      name: "internal mismatch",
      values: ["different-internal", presentValues[1], presentValues[2]],
      expectedStatus: 1,
    },
    {
      name: "public mismatch",
      values: [presentValues[0], "different-public", presentValues[2]],
      expectedStatus: 1,
    },
    {
      name: "anon mismatch",
      values: [presentValues[0], presentValues[1], "different-anon"],
      expectedStatus: 1,
    },
  ]) {
    const encoded = fixture.values.map((value) => Buffer.from(value).toString("base64"));
    const script = [
      "set -euo pipefail",
      "PREVIOUS_PROCESS_ENVIRONMENT_STATUS=present",
      `PREVIOUS_PROCESS_SUPABASE_INTERNAL_URL_B64='${encoded[0]}'`,
      `PREVIOUS_PROCESS_NEXT_PUBLIC_SUPABASE_URL_B64='${encoded[1]}'`,
      `PREVIOUS_PROCESS_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64='${encoded[2]}'`,
      `PREVIOUS_SUPABASE_INTERNAL_URL='${presentValues[0]}'`,
      `PREVIOUS_NEXT_PUBLIC_SUPABASE_URL='${presentValues[1]}'`,
      `PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY='${presentValues[2]}'`,
      reconciliation,
      "printf 'accepted\\n'",
    ].join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(
      result.status,
      fixture.expectedStatus,
      `${fixture.name}\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.stderr, "", fixture.name);
    for (const value of [...presentValues, ...fixture.values]) {
      assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
    }
  }
});

test("rollback process launch receives the frozen previous Supabase environment", () => {
  const functions = extractShellRegion(
    "start_frozen_previous_release() {",
    "\nwait_for_automation_worker_online() {",
  );
  const script = [
    "set +e",
    functions,
    "PREVIOUS_RUNTIME_DIR=/frozen/runtime",
    "PREVIOUS_SUPABASE_INTERNAL_URL=old-internal",
    "PREVIOUS_NEXT_PUBLIC_SUPABASE_URL=old-public",
    "PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY=old-anon",
    "export SUPABASE_INTERNAL_URL=new-internal",
    "export NEXT_PUBLIC_SUPABASE_URL=new-public",
    "export NEXT_PUBLIC_SUPABASE_ANON_KEY=new-anon",
    "IDENTITY_OK=1",
    "previous_runtime_recovery_identity_matches() { [ \"$IDENTITY_OK\" = 1 ]; }",
    "start_release() {",
    "  [ \"$1\" = /frozen/runtime ] && [ \"$SUPABASE_INTERNAL_URL\" = old-internal ] && [ \"$NEXT_PUBLIC_SUPABASE_URL\" = old-public ] && [ \"$NEXT_PUBLIC_SUPABASE_ANON_KEY\" = old-anon ] || return 1",
    "  printf 'web\\n'",
    "}",
    "start_automation_worker_process() {",
    "  [ \"$1\" = /frozen/runtime ] && [ \"$SUPABASE_INTERNAL_URL\" = old-internal ] && [ \"$NEXT_PUBLIC_SUPABASE_URL\" = old-public ] && [ \"$NEXT_PUBLIC_SUPABASE_ANON_KEY\" = old-anon ] || return 1",
    "  printf 'worker\\n'",
    "}",
    "start_frozen_previous_release; web_status=$?",
    "start_frozen_previous_automation_worker_process; worker_status=$?",
    "printf '%s %s\\n' \"$web_status\" \"$worker_status\"",
    "IDENTITY_OK=0",
    "start_frozen_previous_release >/dev/null; identity_web_status=$?",
    "start_frozen_previous_automation_worker_process >/dev/null; identity_worker_status=$?",
    "printf '%s %s\\n' \"$identity_web_status\" \"$identity_worker_status\"",
    "unset PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "start_frozen_previous_release >/dev/null; missing_status=$?",
    "printf '%s\\n' \"$missing_status\"",
  ].join("\n");
  const result = spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: script,
    timeout: 10_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, "web\nworker\n0 0\n1 1\n1\n");
});

test("resolved probe inputs use the current public URL, frozen anon key, and literal internal default", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-deploy-probe-environment-contract-"),
  );
  const previousRuntime = join(temporaryDirectory, "previous-release");
  const previousEnvironment = join(previousRuntime, ".env.local");
  const currentUrl = "https://current.contract.supabase.co";
  const previousUrl = currentUrl;
  const persistedAnonKey = "persisted_contract_anon.key-safe_value";
  const resolution = extractShellRegion(
    'FINAL_NEXT_PUBLIC_SUPABASE_URL="$(decode_base64_value',
    'write_env_value "NEXT_PUBLIC_SUPABASE_URL"',
  );
  await mkdir(previousRuntime, { recursive: true });
  await writeFile(
    previousEnvironment,
    `FAOLLA_WEB_BUILD_ID=${FIXTURE_TARGET_SHA}\n` +
      `NEXT_PUBLIC_SUPABASE_URL=${previousUrl}\n` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${persistedAnonKey}\n`,
    { mode: 0o600 },
  );
  try {
    const script = [
      "set -euo pipefail",
      "decode_base64_value() {",
      '  local value="$1"',
      '  if [ -z "$value" ]; then return 0; fi',
      "  printf '%s' \"$value\" | base64 -d",
      "}",
      'NEXT_PUBLIC_SUPABASE_URL_B64="$CONTRACT_PUBLIC_URL_B64"',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY_B64=""',
      'SUPABASE_INTERNAL_URL_B64=""',
      'SUPABASE_INTERNAL_URL="https://ambient.invalid/?secret=must-not-win"',
      'PREVIOUS_SUPABASE_INTERNAL_URL="http://127.0.0.1:8000"',
      'PREVIOUS_NEXT_PUBLIC_SUPABASE_URL="$CONTRACT_PUBLIC_URL"',
      'PREVIOUS_RUNTIME_DIR="$CONTRACT_PREVIOUS_RUNTIME"',
      'PREVIOUS_BUILD_ID="$CONTRACT_PREVIOUS_BUILD_ID"',
      'PREVIOUS_WEB_PID="4321"',
      'PREVIOUS_RUNTIME_IDENTITY="10:20:30"',
      'PREVIOUS_WEB_PROCESS_IDENTITY="40:50"',
      'CURRENT_LINK="/contract/current"',
      'readlink() { printf \'%s\\n\' "$PREVIOUS_RUNTIME_DIR"; }',
      "stat() {",
      '  case "$*" in',
      '    *"/proc/$PREVIOUS_WEB_PID/cwd"*) printf \'%s\\n\' "$PREVIOUS_RUNTIME_IDENTITY" ;;',
      '    *"/proc/$PREVIOUS_WEB_PID"*) printf \'%s\\n\' "$PREVIOUS_WEB_PROCESS_IDENTITY" ;;',
      '    *) printf \'%s\\n\' "$PREVIOUS_RUNTIME_IDENTITY" ;;',
      "  esac",
      "}",
      resolution,
      'printf \'%s\\0%s\\0%s\\0\' "$FINAL_NEXT_PUBLIC_SUPABASE_URL" "$FINAL_NEXT_PUBLIC_SUPABASE_ANON_KEY" "$FINAL_SUPABASE_INTERNAL_URL"',
      "",
    ].join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: script,
      env: {
        ...process.env,
        CONTRACT_PUBLIC_URL_B64: Buffer.from(currentUrl).toString("base64"),
        CONTRACT_PUBLIC_URL: currentUrl,
        CONTRACT_PREVIOUS_RUNTIME: toBashPath(previousRuntime),
        CONTRACT_PREVIOUS_BUILD_ID: FIXTURE_TARGET_SHA,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(result.stdout.split("\0").slice(0, 3), [
      currentUrl,
      persistedAnonKey,
      "http://127.0.0.1:8000",
    ]);
    assert.equal(result.stdout.includes("ambient.invalid"), false);
    assert.equal(result.stderr, "");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deployment SSH trust is pinned and never learned from the live network", () => {
  assert.match(deployWorkflow, /SSH_KNOWN_HOSTS: \$\{\{ secrets\.SSH_KNOWN_HOSTS \}\}/);
  assert.match(deployWorkflow, /ssh-keygen -F "\$known_hosts_lookup"/);
  assert.match(deployWorkflow, /StrictHostKeyChecking=yes/);
  assert.match(deployWorkflow, /UserKnownHostsFile="\$HOME\/\.ssh\/known_hosts"/);
  assert.doesNotMatch(deployWorkflow, /ssh-keyscan|StrictHostKeyChecking=accept-new/);
});

test("dependency installation and workflow runtime are bounded", () => {
  assert.match(deployScript, /NPM_CI_TIMEOUT_SECONDS="\$\{[^}]+:-1800\}"/);
  assert.match(deployScript, /--kill-after="\$\{NPM_CI_KILL_AFTER_SECONDS\}s"/);
  assert.match(deployScript, /npm_remaining_seconds=\$\(\(NPM_CI_TIMEOUT_SECONDS - npm_elapsed_seconds\)\)/);
  assert.match(deployScript, /"\$\{npm_remaining_seconds\}s" \\\n    npm ci/);
  assert.match(deployScript, /BUILD_TIMEOUT_SECONDS="\$\{[^}]+:-1800\}"/);
  assert.match(deployScript, /--kill-after="\$\{BUILD_KILL_AFTER_SECONDS\}s"/);
  assert.match(
    deployScript,
    /"\$\{BUILD_TIMEOUT_SECONDS\}s" \\\n  npm run build/,
  );
  assert.match(deployWorkflow, /timeout-minutes:\s*120/);
});

test("dependency installation retries transient registry failures with bounded cache-aware fetches", () => {
  assert.match(deployScript, /NPM_CI_ATTEMPTS="\$\{[^}]+:-3\}"/);
  assert.match(deployScript, /NPM_CI_RETRY_DELAY_SECONDS="\$\{[^}]+:-15\}"/);
  assert.match(deployScript, /NPM_FETCH_RETRIES="\$\{[^}]+:-5\}"/);
  assert.match(
    deployScript,
    /for \(\(npm_attempt = 1; npm_attempt <= NPM_CI_ATTEMPTS; npm_attempt\+\+\)\)/,
  );
  assert.match(deployScript, /--prefer-offline/);
  assert.match(deployScript, /--no-audit/);
  assert.match(deployScript, /--fetch-retries="\$NPM_FETCH_RETRIES"/);
  assert.match(
    deployScript,
    /npm ci attempt \$\{npm_attempt\} failed with status \$\{npm_status\}; retrying/,
  );
});

test("fence startup remains fail-fast when invoked from cleanup set +e", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-fence-start-set-plus-e-contract-"),
  );
  const functions = extractShellRegion(
    "cleanup_readiness_fence_files() {",
    "\nrelease_readiness_fence() {",
  );
  const script = [
    "set +e",
    `SHARED_RUNTIME_DIR='${toBashPath(temporaryDirectory)}'`,
    `RELEASE_DIR='${toBashPath(temporaryDirectory)}'`,
    functions,
    "mktemp() { return 73; }",
    "if start_readiness_fence; then status=0; else status=$?; fi",
    '[ "$status" -ne 0 ]',
    '[ -z "${READINESS_FENCE_DIR:-}" ]',
    '[ -z "${READINESS_FENCE_MARKER:-}" ]',
    '[ ! -e /ready.json ]',
    "",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("PM2 state parsing and bounded deletion fail closed and prove the original process exited", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-pm2-state-contract-"),
  );
  const functions = extractShellRegion(
    "pm2_process_snapshot() {",
    "\nstart_automation_worker_process() {",
  );
  const snapshotFixtures = [
    { name: "absent", json: [], expectedStatus: 0, expectedOutput: "absent" },
    {
      name: "inactive",
      json: [{ pid: 0, pm2_env: { name: "target", status: "stopped" } }],
      expectedStatus: 0,
      expectedOutput: "inactive",
    },
    {
      name: "running",
      json: [{ pid: 4321, pm2_env: { name: "target", status: "online" } }],
      expectedStatus: 0,
      expectedOutput: "running:4321",
    },
    {
      name: "wrong name is absent",
      json: [{ pid: 4321, pm2_env: { name: "other" } }],
      expectedStatus: 0,
      expectedOutput: "absent",
    },
    {
      name: "duplicate name",
      json: [
        { pid: 4321, pm2_env: { name: "target", status: "online" } },
        { pid: 4322, pm2_env: { name: "target", status: "online" } },
      ],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "nonnumeric pid",
      json: [{ pid: "4321", pm2_env: { name: "target", status: "online" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "missing status with a live pid",
      json: [{ pid: 4321, pm2_env: { name: "target" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "errored status with a live pid",
      json: [{ pid: 4321, pm2_env: { name: "target", status: "errored" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "online status without a live pid",
      json: [{ pid: 0, pm2_env: { name: "target", status: "online" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "stopped status with a live pid",
      json: [{ pid: 4321, pm2_env: { name: "target", status: "stopped" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    {
      name: "transitional status is never treated as inactive",
      json: [{ pid: 0, pm2_env: { name: "target", status: "launching" } }],
      expectedStatus: 1,
      expectedOutput: "",
    },
    { name: "malformed JSON", raw: "not-json", expectedStatus: 1, expectedOutput: "" },
    {
      name: "producer failure",
      json: [],
      producerStatus: 7,
      expectedStatus: 1,
      expectedOutput: "",
    },
  ];

  try {
    for (const fixture of snapshotFixtures) {
      const raw = fixture.raw ?? JSON.stringify(fixture.json);
      const script = [
        "set +e",
        functions,
        `FIXTURE_B64='${Buffer.from(raw).toString("base64")}'`,
        `FIXTURE_STATUS='${fixture.producerStatus ?? 0}'`,
        "timeout() {",
        "  while [ \"$#\" -gt 0 ]; do",
        "    case \"$1\" in --signal=*|--kill-after=*) shift ;; *s) shift; break ;; *) break ;; esac",
        "  done",
        "  \"$@\"",
        "}",
        "pm2() {",
        "  [ \"$1\" = jlist ] || return 1",
        "  printf '%s' \"$FIXTURE_B64\" | base64 --decode",
        "  return \"$FIXTURE_STATUS\"",
        "}",
        "pm2_process_snapshot target; status=$?",
        "printf '\\nSTATUS:%s\\n' \"$status\"",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, `${fixture.name}\n${result.stdout}\n${result.stderr}`);
      const statusMarker = result.stdout.lastIndexOf("\nSTATUS:");
      assert.ok(statusMarker >= 0, fixture.name);
      assert.equal(
        result.stdout.slice(statusMarker + "\nSTATUS:".length).trim(),
        String(fixture.expectedStatus),
        fixture.name,
      );
      assert.equal(result.stdout.slice(0, statusMarker).trimEnd(), fixture.expectedOutput, fixture.name);
    }

    const stopFixtures = [
      { name: "already absent", snapshots: ["absent"], expectedStatus: 0, deleteCalls: 0 },
      { name: "inactive is deleted", snapshots: ["inactive", "absent"], expectedStatus: 0, deleteCalls: 1 },
      {
        name: "running process exits",
        snapshots: ["running:4321", "absent"],
        ticks: ["111", "GONE"],
        expectedStatus: 0,
        deleteCalls: 1,
      },
      {
        name: "pid reuse is distinguishable",
        snapshots: ["running:4321", "absent"],
        ticks: ["111", "222"],
        expectedStatus: 0,
        deleteCalls: 1,
      },
      {
        name: "original process identity remains",
        snapshots: ["running:4321", "absent"],
        ticks: ["111", "111"],
        expectedStatus: 1,
        deleteCalls: 1,
      },
      {
        name: "post-delete PM2 state remains running",
        snapshots: ["running:4321", "running:4321"],
        ticks: ["111"],
        expectedStatus: 1,
        deleteCalls: 1,
      },
      { name: "initial query failure", snapshots: ["ERROR"], expectedStatus: 1, deleteCalls: 0 },
      {
        name: "delete failure",
        snapshots: ["inactive"],
        deleteStatus: 9,
        expectedStatus: 1,
        deleteCalls: 1,
      },
      {
        name: "post-delete query failure",
        snapshots: ["inactive", "ERROR"],
        expectedStatus: 1,
        deleteCalls: 1,
      },
    ];
    for (const [index, fixture] of stopFixtures.entries()) {
      const snapshotsPath = join(temporaryDirectory, `snapshots-${index}`);
      const ticksPath = join(temporaryDirectory, `ticks-${index}`);
      const callsPath = join(temporaryDirectory, `delete-calls-${index}`);
      await writeFile(snapshotsPath, `${fixture.snapshots.join("\n")}\n`, { mode: 0o600 });
      await writeFile(ticksPath, `${(fixture.ticks ?? []).join("\n")}\n`, { mode: 0o600 });
      const script = [
        "set +e",
        functions,
        `SNAPSHOTS='${toBashPath(snapshotsPath)}'`,
        `TICKS='${toBashPath(ticksPath)}'`,
        `CALLS='${toBashPath(callsPath)}'`,
        `DELETE_STATUS='${fixture.deleteStatus ?? 0}'`,
        "next_fixture_value() {",
        "  local source=\"$1\"",
        "  local value",
        "  value=\"$(head -n 1 \"$source\")\" || return 1",
        "  tail -n +2 \"$source\" > \"${source}.next\" || return 1",
        "  mv \"${source}.next\" \"$source\" || return 1",
        "  printf '%s\\n' \"$value\"",
        "}",
        "pm2_process_snapshot() {",
        "  local value",
        "  value=\"$(next_fixture_value \"$SNAPSHOTS\")\" || return 1",
        "  [ \"$value\" != ERROR ] || return 1",
        "  printf '%s\\n' \"$value\"",
        "}",
        "linux_process_start_ticks() {",
        "  local value",
        "  value=\"$(next_fixture_value \"$TICKS\")\" || return 1",
        "  if [ \"$value\" = GONE ]; then return 2; fi",
        "  [ -n \"$value\" ] || return 1",
        "  printf '%s\\n' \"$value\"",
        "}",
        "timeout() {",
        "  while [ \"$#\" -gt 0 ]; do",
        "    case \"$1\" in --signal=*|--kill-after=*) shift ;; *s) shift; break ;; *) break ;; esac",
        "  done",
        "  \"$@\"",
        "}",
        "pm2() { [ \"$1\" = delete ] || return 1; printf x >> \"$CALLS\"; return \"$DELETE_STATUS\"; }",
        "unset SECONDS; SECONDS=0",
        "stop_pm2_process_bounded target 40; status=$?",
        "printf '%s\\n' \"$status\"",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, `${fixture.name}\n${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout.trim(), String(fixture.expectedStatus), fixture.name);
      let calls = "";
      try { calls = await readFile(callsPath, "utf8"); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      assert.equal(calls.length, fixture.deleteCalls, fixture.name);
    }

    const preservedInactive = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        "set +e",
        functions,
        "AUTOMATION_WORKER_NAME=worker",
        "AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS=205",
        "stop_pm2_process_bounded() { printf '%s\\n' \"$3\"; }",
        "PREVIOUS_AUTOMATION_WORKER_STATE=inactive",
        "stop_previous_automation_worker_bounded",
        "PREVIOUS_AUTOMATION_WORKER_STATE=running",
        "stop_previous_automation_worker_bounded",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(
      preservedInactive.status,
      0,
      `${preservedInactive.stdout}\n${preservedInactive.stderr}`,
    );
    assert.equal(preservedInactive.stdout, "0\n1\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("worker online proof requires three stable strict PM2 snapshots", async () => {
  const waitFunction = extractShellRegion(
    "wait_for_automation_worker_online() {",
    "\nwait_for_release_health() {",
  );
  assert.match(waitFunction, /pm2_process_snapshot "\$AUTOMATION_WORKER_NAME"/);
  assert.doesNotMatch(waitFunction, /pm2 pid/);

  const fixtures = [
    {
      name: "three stable running snapshots",
      snapshots: ["running:4321", "running:4321", "running:4321"],
      expectedStatus: 0,
      expectedCalls: 3,
    },
    {
      name: "PID drift restarts the stability proof",
      snapshots: ["running:4321", "running:4322", "running:4322", "running:4322"],
      expectedStatus: 0,
      expectedCalls: 4,
    },
    {
      name: "parser failure restarts the stability proof",
      snapshots: [
        "running:4321",
        "running:4321",
        "ERROR",
        "running:4321",
        "running:4321",
        "running:4321",
      ],
      expectedStatus: 0,
      expectedCalls: 6,
    },
    {
      name: "inactive and transitional snapshots never count",
      snapshots: [
        "inactive",
        "running:4321",
        "running:4321",
        "absent",
        "running:4321",
        "running:4321",
        "running:4321",
      ],
      expectedStatus: 0,
      expectedCalls: 7,
    },
    {
      name: "alternating running PIDs exhaust the bounded proof",
      snapshots: Array.from(
        { length: 20 },
        (_, index) => `running:${index % 2 === 0 ? 4321 : 4322}`,
      ),
      expectedStatus: 1,
      expectedCalls: 20,
    },
  ];
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-worker-online-proof-contract-"),
  );

  try {
    for (const [index, fixture] of fixtures.entries()) {
      const responsesPath = join(temporaryDirectory, `responses-${index}`);
      const callsPath = join(temporaryDirectory, `calls-${index}`);
      await writeFile(responsesPath, `${fixture.snapshots.join("\n")}\n`);
      const script = [
        "set +e",
        waitFunction,
        `RESPONSES='${toBashPath(responsesPath)}'`,
        `CALLS='${toBashPath(callsPath)}'`,
        "AUTOMATION_WORKER_NAME=worker",
        "next_fixture_value() {",
        "  local source=\"$1\"",
        "  local value",
        "  value=\"$(head -n 1 \"$source\")\" || return 1",
        "  tail -n +2 \"$source\" > \"${source}.next\" || return 1",
        "  mv \"${source}.next\" \"$source\" || return 1",
        "  printf x >> \"$CALLS\"",
        "  printf '%s\\n' \"$value\"",
        "}",
        "pm2_process_snapshot() {",
        "  local value",
        "  [ \"$1\" = \"$AUTOMATION_WORKER_NAME\" ] || return 1",
        "  value=\"$(next_fixture_value \"$RESPONSES\")\" || return 1",
        "  [ \"$value\" != ERROR ] || return 1",
        "  printf '%s\\n' \"$value\"",
        "}",
        "sleep() { :; }",
        "wait_for_automation_worker_online; status=$?",
        "printf '%s\\n' \"$status\"",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(
        result.status,
        0,
        `${fixture.name}\n${result.stdout}\n${result.stderr}`,
      );
      assert.equal(result.stdout.trim(), String(fixture.expectedStatus), fixture.name);
      assert.equal((await readFile(callsPath, "utf8")).length, fixture.expectedCalls);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the frozen previous web PID, start time, cwd, and PM2 identity are rechecked", () => {
  const identityFunction = extractShellRegion(
    "previous_web_process_identity_matches() {",
    "\nstop_pm2_process_bounded() {",
  );
  const fixtures = [
    { name: "exact identity", expectedStatus: 0 },
    { name: "PM2 PID drift", snapshot: "running:4322", expectedStatus: 1 },
    { name: "start time drift", currentTicks: "222", expectedStatus: 1 },
    { name: "runtime inode drift", runtimeStat: "1:2:4", expectedStatus: 1 },
    { name: "cwd drift", cwdStat: "1:2:4", expectedStatus: 1 },
    { name: "process inode drift", processStat: "5:7", expectedStatus: 1 },
    { name: "current link drift", link: "/release/other", expectedStatus: 1 },
  ];
  for (const fixture of fixtures) {
    const script = [
      "set +e",
      identityFunction,
      "type -t previous_web_process_identity_matches >/dev/null || exit 90",
      "APP_NAME=web",
      "PREVIOUS_WEB_PID=4321",
      "PREVIOUS_WEB_PROCESS_START_TICKS=111",
      "PREVIOUS_RUNTIME_DIR=/release/frozen",
      "PREVIOUS_RUNTIME_IDENTITY=1:2:3",
      "PREVIOUS_WEB_PROCESS_IDENTITY=5:6",
      "CURRENT_LINK=/release/current",
      `SNAPSHOT='${fixture.snapshot ?? "running:4321"}'`,
      `CURRENT_TICKS='${fixture.currentTicks ?? "111"}'`,
      `RUNTIME_STAT='${fixture.runtimeStat ?? "1:2:3"}'`,
      `CWD_STAT='${fixture.cwdStat ?? "1:2:3"}'`,
      `PROCESS_STAT='${fixture.processStat ?? "5:6"}'`,
      `LINK_TARGET='${fixture.link ?? "/release/frozen"}'`,
      'pm2_process_snapshot() { printf "%s\\n" "$SNAPSHOT"; }',
      'linux_process_start_ticks() { printf "%s\\n" "$CURRENT_TICKS"; }',
      "stat() {",
      "  local path=\"${@: -1}\"",
      "  case \"$path\" in",
      '    "$PREVIOUS_RUNTIME_DIR") printf "%s\\n" "$RUNTIME_STAT" ;;',
      '    "/proc/$PREVIOUS_WEB_PID/cwd") printf "%s\\n" "$CWD_STAT" ;;',
      '    "/proc/$PREVIOUS_WEB_PID") printf "%s\\n" "$PROCESS_STAT" ;;',
      "    *) return 1 ;;",
      "  esac",
      "}",
      'readlink() { printf "%s\\n" "$LINK_TARGET"; }',
      "previous_web_process_identity_matches; status=$?",
      "printf '%s\\n' \"$status\"",
    ].join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: script,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${fixture.name}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.trim(), String(fixture.expectedStatus), fixture.name);
  }
});

test("the frozen previous runtime verifier binds its link and complete environment file", async (t) => {
  const identityFunction = extractShellRegion(
    "previous_runtime_recovery_identity_matches() {",
    "\nstart_release() {",
  );
  const buildId = "a".repeat(40);
  const environment = (build = buildId, flag = "alpha") => Buffer.from(
    `FAOLLA_WEB_BUILD_ID=${build}\n` +
      "NEXT_PUBLIC_SUPABASE_URL=https://contract.supabase.co\n" +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=contract_anon.key-safe_value\n" +
      `RECOVERY_FLAG=${flag}\n`,
  );
  const fixtures = [
    { name: "exact frozen runtime", expectedStatus: 0 },
    {
      name: "same-length content change with restored mtime",
      expectedStatus: 1,
      mutate: async ({ environmentPath }) => {
        const before = await stat(environmentPath);
        const changed = environment(buildId, "omega");
        assert.equal(changed.length, environment().length);
        await writeFile(environmentPath, changed);
        await utimes(environmentPath, before.atime, before.mtime);
      },
    },
    {
      name: "same bytes at a replacement inode",
      expectedStatus: 1,
      mutate: async ({ environmentPath, temporaryDirectory }) => {
        const replacement = join(temporaryDirectory, "replacement.env");
        await writeFile(replacement, environment(), { mode: 0o600 });
        await rm(environmentPath);
        await rename(replacement, environmentPath);
      },
    },
    {
      name: "hard-linked environment",
      expectedStatus: 1,
      mutate: async ({ environmentPath, temporaryDirectory }) => {
        const original = join(temporaryDirectory, "original.env");
        await rename(environmentPath, original);
        await link(original, environmentPath);
      },
    },
    {
      name: "symbolic environment replacement",
      expectedStatus: 1,
      needsFileSymlink: true,
      mutate: async ({ environmentPath, temporaryDirectory }) => {
        const original = join(temporaryDirectory, "original.env");
        await rename(environmentPath, original);
        await symlink(original, environmentPath, "file");
      },
    },
    {
      name: "current release link drift",
      expectedStatus: 1,
      currentLinkDrift: true,
    },
    {
      name: "build id drift",
      expectedStatus: 1,
      mutate: async ({ environmentPath }) => {
        await writeFile(environmentPath, environment("b".repeat(40)), { mode: 0o600 });
      },
    },
    {
      name: "snapshot producer timeout",
      expectedStatus: 1,
      failTimeout: true,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async (subtest) => {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), "faolla-frozen-runtime-"));
      const runtimeDirectory = join(temporaryDirectory, "runtime");
      const otherRuntimeDirectory = join(temporaryDirectory, "other-runtime");
      const environmentPath = join(runtimeDirectory, ".env.local");
      const currentLink = join(temporaryDirectory, "current");
      try {
        await mkdir(join(runtimeDirectory, ".next"), { recursive: true });
        await mkdir(otherRuntimeDirectory, { recursive: true });
        await writeFile(environmentPath, environment(), { mode: 0o600 });
        await symlink(
          runtimeDirectory,
          currentLink,
          process.platform === "win32" ? "junction" : "dir",
        );
        const snapshot = readFrozenProductionSupabaseEnvironmentSnapshot(
          environmentPath,
          buildId,
        );
        if (fixture.mutate) {
          try {
            await fixture.mutate({ environmentPath, temporaryDirectory });
          } catch (error) {
            if (fixture.needsFileSymlink && process.platform === "win32" && error?.code === "EPERM") {
              subtest.skip("file symlink creation is not permitted on this Windows host");
              return;
            }
            throw error;
          }
        }
        const selectedCurrentLink = fixture.currentLinkDrift
          ? otherRuntimeDirectory
          : currentLink;
        const script = [
          "set +e",
          identityFunction,
          `APP_DIR='${toBashPath(repositoryRoot)}'`,
          `FROZEN_CURRENT_LINK='${toBashPath(currentLink)}'`,
          'PREVIOUS_RUNTIME_DIR="$(readlink -f "$FROZEN_CURRENT_LINK")"',
          `CURRENT_LINK='${toBashPath(selectedCurrentLink)}'`,
          `PREVIOUS_BUILD_ID='${buildId}'`,
          "PREVIOUS_RUNTIME_IDENTITY=\"$(stat -Lc '%d:%i:%Z' -- \"$PREVIOUS_RUNTIME_DIR\")\"",
          `PREVIOUS_ENVIRONMENT_DIRECTORY_IDENTITY='${snapshot.directoryIdentity}'`,
          `PREVIOUS_ENVIRONMENT_FILE_IDENTITY='${snapshot.fileIdentity}'`,
          `PREVIOUS_ENVIRONMENT_SHA256='${snapshot.sha256}'`,
          "PREVIOUS_RUNTIME_RECOVERY_IDENTITY_TIMEOUT_SECONDS=5",
          ...(fixture.failTimeout ? ["timeout() { return 124; }"] : []),
          "previous_runtime_recovery_identity_matches; status=$?",
          "printf '%s\\n' \"$status\"",
        ].join("\n");
        const result = spawnSync(resolveBashExecutable(), ["-s"], {
          encoding: "utf8",
          input: script,
          timeout: 10_000,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.equal(result.stdout, `${fixture.expectedStatus}\n`, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(`${result.stdout}${result.stderr}`.includes("contract_anon"), false);
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    });
  }
});

test("database lock checker accepts only exact held output from a successful producer", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-fence-lock-check-contract-"),
  );
  const lockFunction = extractShellRegion(
    "assert_readiness_fence_database_locks() {",
    "\nreadiness_fence_process_identity_sha256() {",
  );
  assert.match(lockFunction, /local absolute_deadline_seconds="\$\{3:-\}"/);
  assert.match(lockFunction, /deadline_bounded_command_timeout_seconds/);
  assert.match(
    lockFunction,
    /statement_timeout_milliseconds=\$\(\(command_timeout_seconds \* 1000 - 1\)\)/,
  );
  assert.match(
    lockFunction,
    /statement_timeout=\$\{FAOLLA_FENCE_STATEMENT_TIMEOUT_MILLISECONDS\}ms -c lock_timeout=\$\{FAOLLA_FENCE_STATEMENT_TIMEOUT_MILLISECONDS\}ms/,
  );
  const fixtures = [
    { name: "standard psql LF", stdout: "held\n", producerStatus: 0, expectedStatus: 0 },
    { name: "no trailing LF", stdout: "held", producerStatus: 0, expectedStatus: 0 },
    { name: "multiple trailing LF", stdout: "held\n\n", producerStatus: 0, expectedStatus: 0 },
    {
      name: "stderr does not contaminate stdout",
      stdout: "held\n",
      stderr: "NOTICE fake diagnostic\n",
      producerStatus: 0,
      expectedStatus: 0,
    },
    {
      name: "strict cancellation is a bounded pre-forward retry signal",
      stdout: "blocked_cancelled\n",
      producerStatus: 0,
      expectedStatus: 2,
    },
    {
      name: "relaxed held",
      stdout: "held\n",
      producerStatus: 0,
      allowWaiters: 1,
      expectedStatus: 0,
    },
    {
      name: "relaxed waiter is quiescing",
      stdout: "quiescing\n",
      producerStatus: 0,
      allowWaiters: 1,
      expectedStatus: 2,
    },
    {
      name: "strict mode rejects quiescing output",
      stdout: "quiescing\n",
      producerStatus: 0,
      expectedStatus: 1,
    },
    {
      name: "relaxed mode rejects a strict cancellation result",
      stdout: "blocked_cancelled\n",
      producerStatus: 0,
      allowWaiters: 1,
      expectedStatus: 1,
    },
    { name: "locks not held", stdout: "not_held\n", producerStatus: 0, expectedStatus: 1 },
    { name: "empty stdout", stdout: "", producerStatus: 0, expectedStatus: 1 },
    { name: "leading LF", stdout: "\nheld\n", producerStatus: 0, expectedStatus: 1 },
    { name: "trailing space", stdout: "held \n", producerStatus: 0, expectedStatus: 1 },
    {
      name: "multiple result lines",
      stdout: "held\nnot_held\n",
      producerStatus: 0,
      expectedStatus: 1,
    },
    { name: "psql script failure", stdout: "held\n", producerStatus: 3, expectedStatus: 1 },
    { name: "transport failure", stdout: "held\n", producerStatus: 7, expectedStatus: 1 },
    { name: "timeout", stdout: "held\n", producerStatus: 124, expectedStatus: 1 },
    {
      name: "invalid waiter mode fails before producer",
      stdout: "held\n",
      producerStatus: 0,
      allowWaiters: 2,
      expectedStatus: 1,
      expectedCalls: 0,
    },
    {
      name: "zero query timeout fails before producer",
      stdout: "held\n",
      producerStatus: 0,
      queryTimeout: 0,
      expectedStatus: 1,
      expectedCalls: 0,
    },
    {
      name: "oversized query timeout fails before producer",
      stdout: "held\n",
      producerStatus: 0,
      queryTimeout: 16,
      expectedStatus: 1,
      expectedCalls: 0,
    },
  ];

  try {
    for (const [index, fixture] of fixtures.entries()) {
      const callsPath = join(temporaryDirectory, `calls-${index}`);
      const stdoutBase64 = Buffer.from(fixture.stdout, "utf8").toString("base64");
      const stderrBase64 = Buffer.from(fixture.stderr ?? "", "utf8").toString("base64");
      const script = [
        "set -euo pipefail",
        lockFunction,
        `CALLS='${toBashPath(callsPath)}'`,
        `FIXTURE_STDOUT_B64='${stdoutBase64}'`,
        `FIXTURE_STDERR_B64='${stderrBase64}'`,
        `FIXTURE_STATUS='${fixture.producerStatus}'`,
        "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
        "READINESS_FENCE_APPLICATION_NAME=faolla_readiness_fence_1234_aaaaaaaaaaaaaaaaaaaaaaaa",
        "READINESS_FENCE_BACKEND_PID=4321",
        `RELEASE_DATABASE_CONTAINER_ID='${"b".repeat(64)}'`,
        "timeout() {",
        "  printf '%s\\n' \"$*\" > \"$CALLS\"",
        "  if [ -n \"$FIXTURE_STDOUT_B64\" ]; then",
        "    printf '%s' \"$FIXTURE_STDOUT_B64\" | base64 --decode",
        "  fi",
        "  if [ -n \"$FIXTURE_STDERR_B64\" ]; then",
        "    printf '%s' \"$FIXTURE_STDERR_B64\" | base64 --decode >&2",
        "  fi",
        "  return \"$FIXTURE_STATUS\"",
        "}",
        `if assert_readiness_fence_database_locks '${fixture.allowWaiters ?? 0}' '${fixture.queryTimeout ?? 15}'; then status=0; else status=$?; fi`,
        "printf '%s\\n' \"$status\"",
        "",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(
        result.status,
        0,
        `${fixture.name}\n${result.stdout}\n${result.stderr}`,
      );
      assert.equal(
        result.stdout,
        `${fixture.warning ?? ""}${fixture.expectedStatus}\n`,
        fixture.name,
      );
      assert.equal(result.stderr, fixture.stderr ?? "", fixture.name);
      if ((fixture.expectedCalls ?? 1) === 0) {
        await assert.rejects(
          readFile(callsPath, "utf8"),
          (error) => error?.code === "ENOENT",
          fixture.name,
        );
      } else {
        const call = await readFile(callsPath, "utf8");
        assert.match(
          call,
          new RegExp(`FAOLLA_FENCE_ALLOW_WAITERS=${fixture.allowWaiters ?? 0}`),
          fixture.name,
        );
        assert.match(call, new RegExp(`${fixture.queryTimeout ?? 15}s`), fixture.name);
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("provisional marker publication retries only the pure marker check", () => {
  const markerValidator = extractShellFunction("validate_readiness_fence_marker");
  assert.equal(
    markerValidator.match(/READINESS_FENCE_(?:BACKEND_PID|APPLICATION_NAME|MARKER_SHA256|VALIDATION_COMPLETE)\)/g)?.length,
    4,
  );
  assert.match(markerValidator, /marker_value_count" -ne 4/);
  assert.match(
    markerValidator,
    /NODE\n    then\n      printf 'READINESS_FENCE_VALIDATION_COMPLETE\\0complete\\0'/,
  );
  const markerProducerSources = extractShellHeredocs(markerValidator, "NODE");
  assert.equal(markerProducerSources.length, 1);
  assert.doesNotMatch(markerProducerSources[0], /READINESS_FENCE_VALIDATION_COMPLETE/);
  assert.equal(
    markerProducerSources[0].match(/\["READINESS_FENCE_(?:BACKEND_PID|APPLICATION_NAME|MARKER_SHA256)"/g)?.length,
    3,
  );
  const candidateFunction = extractShellRegion(
    "accept_readiness_fence_candidate() {",
    "\ncleanup_readiness_fence_files() {",
  );
  const run = (body) => spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: [
      "set +e",
      candidateFunction,
      "sleep() { :; }",
      body,
      "",
    ].join("\n"),
    timeout: 10_000,
  });

  const provisional = run([
    "identity_calls=0",
    "marker_calls=0",
    "lock_calls=0",
    "readiness_fence_process_identity_matches() { identity_calls=$((identity_calls + 1)); return 0; }",
    "validate_readiness_fence_marker() { marker_calls=$((marker_calls + 1)); [ \"$marker_calls\" -eq 2 ]; }",
    "assert_readiness_fence_database_locks() { lock_calls=$((lock_calls + 1)); [ \"$1\" = 1 ]; }",
    "accept_readiness_fence_candidate 690 1; status=$?",
    "printf '%s %s %s %s\\n' \"$status\" \"$marker_calls\" \"$lock_calls\" \"$identity_calls\"",
  ].join("\n"));
  assert.equal(provisional.status, 0, `${provisional.stdout}\n${provisional.stderr}`);
  assert.equal(provisional.stdout.trim(), "0 2 1 3");

  const permanentlyInvalid = run([
    "marker_calls=0",
    "lock_calls=0",
    "readiness_fence_process_identity_matches() { return 0; }",
    "validate_readiness_fence_marker() { marker_calls=$((marker_calls + 1)); return 1; }",
    "assert_readiness_fence_database_locks() { lock_calls=$((lock_calls + 1)); return 0; }",
    "accept_readiness_fence_candidate 690 1; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$marker_calls\" \"$lock_calls\"",
  ].join("\n"));
  assert.equal(
    permanentlyInvalid.status,
    0,
    `${permanentlyInvalid.stdout}\n${permanentlyInvalid.stderr}`,
  );
  assert.equal(permanentlyInvalid.stdout.trim(), "4 3 0");

  const lockFailure = run([
    "marker_calls=0",
    "lock_calls=0",
    "readiness_fence_process_identity_matches() { return 0; }",
    "validate_readiness_fence_marker() { marker_calls=$((marker_calls + 1)); return 0; }",
    "assert_readiness_fence_database_locks() { lock_calls=$((lock_calls + 1)); return 1; }",
    "accept_readiness_fence_candidate 690 1; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$marker_calls\" \"$lock_calls\"",
  ].join("\n"));
  assert.equal(lockFailure.status, 0, `${lockFailure.stdout}\n${lockFailure.stderr}`);
  assert.equal(lockFailure.stdout.trim(), "3 1 1");

  const quiescing = run([
    "identity_calls=0",
    "readiness_fence_process_identity_matches() { identity_calls=$((identity_calls + 1)); return 0; }",
    "validate_readiness_fence_marker() { return 0; }",
    "assert_readiness_fence_database_locks() { [ \"$1\" = 1 ] || return 1; return 2; }",
    "accept_readiness_fence_candidate 690 1; status=$?",
    "printf '%s %s\\n' \"$status\" \"$identity_calls\"",
  ].join("\n"));
  assert.equal(quiescing.status, 0, `${quiescing.stdout}\n${quiescing.stderr}`);
  assert.equal(quiescing.stdout.trim(), "0 2");

  const strictCannotAcceptQuiescing = run([
    "readiness_fence_process_identity_matches() { return 0; }",
    "validate_readiness_fence_marker() { return 0; }",
    "assert_readiness_fence_database_locks() { return 2; }",
    "accept_readiness_fence_candidate 690 0; status=$?",
    "printf '%s\\n' \"$status\"",
  ].join("\n"));
  assert.equal(
    strictCannotAcceptQuiescing.status,
    0,
    `${strictCannotAcceptQuiescing.stdout}\n${strictCannotAcceptQuiescing.stderr}`,
  );
  assert.equal(strictCannotAcceptQuiescing.stdout.trim(), "3");

  const identityDriftAfterQuiescing = run([
    "identity_calls=0",
    "readiness_fence_process_identity_matches() { identity_calls=$((identity_calls + 1)); [ \"$identity_calls\" -eq 1 ]; }",
    "validate_readiness_fence_marker() { return 0; }",
    "assert_readiness_fence_database_locks() { return 2; }",
    "accept_readiness_fence_candidate 690 1; status=$?",
    "printf '%s %s\\n' \"$status\" \"$identity_calls\"",
  ].join("\n"));
  assert.equal(
    identityDriftAfterQuiescing.status,
    0,
    `${identityDriftAfterQuiescing.stdout}\n${identityDriftAfterQuiescing.stderr}`,
  );
  assert.equal(identityDriftAfterQuiescing.stdout.trim(), "2 2");
});

test("strict fence proof retries only status two within one bounded deadline", () => {
  const retryFunctions = extractShellRegion(
    "assert_readiness_fence_held_with_bounded_retry() {",
    "\nreadiness_fence_process_quiescence_checkpoint() {",
  );
  assert.doesNotMatch(
    retryFunctions,
    /\b(?:rollback_release|stop_pm2_process_bounded|switch_current_release|start_frozen_previous_release|pm2|ln|mv|rm)\b/,
  );

  const run = ({
    statuses,
    sleepSeconds = 1,
    totalTimeout = 15,
    outerDeadline,
    includeArguments = false,
  }) => {
    const cases = statuses
      .map((status, index) => `    ${index + 1}) return ${status} ;;`)
      .join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        "set +e",
        retryFunctions,
        "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
        "unset SECONDS; SECONDS=0",
        "strict_calls=0",
        "strict_arguments=",
        "sleep_calls=0",
        "assert_readiness_fence_held() {",
        "  strict_calls=$((strict_calls + 1))",
        "  strict_arguments=\"${strict_arguments:+$strict_arguments;}$1,$2,$3\"",
        "  case \"$strict_calls\" in",
        cases,
        "    *) return 99 ;;",
        "  esac",
        "}",
        `SLEEP_SECONDS='${sleepSeconds}'`,
        "sleep() { sleep_calls=$((sleep_calls + 1)); SECONDS=$((SECONDS + SLEEP_SECONDS)); }",
        outerDeadline === undefined
          ? `if assert_readiness_fence_held_with_bounded_retry 900 '${totalTimeout}'; then status=0; else status=$?; fi`
          : `if assert_readiness_fence_held_with_bounded_retry 900 '${totalTimeout}' '${outerDeadline}'; then status=0; else status=$?; fi`,
        "printf '__result__ %s %s %s %s %s\\n' \"$status\" \"$strict_calls\" \"$sleep_calls\" \"$SECONDS\" \"$strict_arguments\"",
        "",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, "");
    const lines = result.stdout.trim().split("\n");
    const summary = lines.pop()?.match(/^__result__ (\d+) (\d+) (\d+) (\d+) ?(.*)$/);
    assert.ok(summary, result.stdout);
    const outcome = {
      codes: lines,
      status: Number(summary[1]),
      strictCalls: Number(summary[2]),
      sleepCalls: Number(summary[3]),
      elapsed: Number(summary[4]),
    };
    if (includeArguments) {
      outcome.strictArguments = summary[5] === "" ? [] : summary[5].split(";");
    }
    return outcome;
  };

  assert.deepEqual(run({ statuses: [0] }), {
    codes: [],
    status: 0,
    strictCalls: 1,
    sleepCalls: 0,
    elapsed: 0,
  });
  assert.deepEqual(run({ statuses: [2, 0] }), {
    codes: ["[deploy] readiness_fence_waiter_cancelled_retry"],
    status: 0,
    strictCalls: 2,
    sleepCalls: 1,
    elapsed: 1,
  });
  for (const nonretryableStatus of [1, 3, 124, 255]) {
    assert.deepEqual(
      run({ statuses: [nonretryableStatus] }),
      {
        codes: ["[deploy] deploy_failed_readiness_fence_nonretryable"],
        status: 1,
        strictCalls: 1,
        sleepCalls: 0,
        elapsed: 0,
      },
      `nonretryable status ${nonretryableStatus}`,
    );
  }
  assert.deepEqual(run({ statuses: [2, 2, 2] }), {
    codes: [
      "[deploy] readiness_fence_waiter_cancelled_retry",
      "[deploy] readiness_fence_waiter_cancelled_retry",
      "[deploy] readiness_fence_waiter_retry_exhausted",
    ],
    status: 1,
    strictCalls: 3,
    sleepCalls: 2,
    elapsed: 2,
  });

  const deadline = run({ statuses: [2, 0], sleepSeconds: 15 });
  assert.equal(deadline.status, 1);
  assert.ok(deadline.strictCalls <= 2);
  assert.ok(deadline.elapsed <= 15);
  assert.equal(deadline.codes.at(-1), "[deploy] readiness_fence_waiter_retry_exhausted");

  assert.deepEqual(run({
    statuses: [2, 0],
    outerDeadline: 7,
    includeArguments: true,
  }), {
    codes: ["[deploy] readiness_fence_waiter_cancelled_retry"],
    status: 0,
    strictCalls: 2,
    sleepCalls: 1,
    elapsed: 1,
    strictArguments: ["900,7,7", "900,6,7"],
  });
  const outerDeadlineExhausted = run({
    statuses: [2, 0],
    sleepSeconds: 7,
    outerDeadline: 7,
    includeArguments: true,
  });
  assert.equal(outerDeadlineExhausted.status, 1);
  assert.equal(outerDeadlineExhausted.strictCalls, 1);
  assert.equal(outerDeadlineExhausted.elapsed, 7);
  assert.deepEqual(outerDeadlineExhausted.strictArguments, ["900,7,7"]);
  assert.equal(
    outerDeadlineExhausted.codes.at(-1),
    "[deploy] readiness_fence_waiter_retry_exhausted",
  );
});

test("deadline-derived command windows reserve termination time and fail at the boundary", () => {
  const deadlineHelper = extractShellFunction(
    "deadline_bounded_command_timeout_seconds",
  );
  const result = spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: [
      "set -euo pipefail",
      deadlineHelper,
      "probe() { if value=\"$(deadline_bounded_command_timeout_seconds \"$@\")\"; then printf 'ok:%s\\n' \"$value\"; else printf 'fail\\n'; fi; }",
      "unset SECONDS",
      "SECONDS=10",
      "probe 70 60 5",
      "SECONDS=10",
      "probe 70 4 0",
      "SECONDS=10",
      "probe 17 20 5",
      "SECONDS=10",
      "probe 16 20 5",
      "SECONDS=10",
      "probe 15 20 5",
      "SECONDS=10",
      "probe 10 20 0",
      "SECONDS=10",
      "probe invalid 20 1",
      "",
    ].join("\n"),
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "ok:54",
    "ok:4",
    "ok:1",
    "fail",
    "fail",
    "fail",
    "fail",
  ]);
});

test("booking persistence retries only status two across fully revalidated read-only rounds", async () => {
  const environmentSnapshot = extractShellFunction(
    "read_candidate_environment_snapshot_for_booking_retry",
  );
  const buildIdSnapshot = extractShellFunction(
    "read_candidate_build_id_snapshot_for_booking_retry",
  );
  const processEnvironmentSnapshot = extractShellFunction(
    "read_candidate_process_environment_snapshot_for_booking_retry",
  );
  const currentCapture = extractShellFunction(
    "capture_candidate_current_identity_for_booking_retry",
  );
  const webCapture = extractShellFunction(
    "capture_candidate_web_identity_for_booking_retry",
  );
  const retryState = extractShellFunction("assert_booking_persistence_retry_state");
  const retryFunction = extractShellFunction(
    "verify_booking_persistence_with_bounded_retry",
  );
  const healthFunction = extractShellFunction("assert_candidate_web_health");
  const checkerFunction = extractShellFunction("verify_booking_persistence");
  const forbiddenMutations =
    /\b(?:ln|mv|rm|pm2|migrate|migration|release_readiness_fence|switch_current_release|start_release|install_runtime_compatibility_links|stop_pm2_process_bounded)\b/;
  const retryReadOnlyCallGraph = [
    retryFunction,
    retryState,
    environmentSnapshot,
    buildIdSnapshot,
    processEnvironmentSnapshot,
    healthFunction,
    checkerFunction,
  ].join("\n");
  assert.doesNotMatch(retryReadOnlyCallGraph, forbiddenMutations);
  assert.match(retryFunction, /local maximum_attempts=2/);
  assert.match(
    retryFunction,
    /assert_readiness_fence_before_forward_operation[\s\S]{0,120}"\$remaining_seconds" "\$absolute_deadline_seconds"/,
  );
  assert.match(
    retryFunction,
    /local absolute_deadline_seconds="\$\{1:-\$\(\([\s\S]{0,100}BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS[\s\S]{0,40}\)\)\}"/,
  );
  assert.match(
    retryFunction,
    /remaining_seconds=\$\(\(absolute_deadline_seconds - SECONDS\)\)/,
  );
  assert.match(
    retryFunction,
    /verify_booking_persistence[\s\S]{0,80}"\$remaining_seconds" "\$absolute_deadline_seconds"/,
  );
  assert.match(
    retryFunction,
    /assert_readiness_fence_forward_checkpoint[\s\S]{0,80}"\$absolute_deadline_seconds"/,
  );
  assert.equal(
    retryFunction.match(/assert_booking_persistence_retry_state "\$absolute_deadline_seconds"/g)?.length,
    6,
  );
  assert.equal(
    retryFunction.match(/assert_candidate_web_health "\$absolute_deadline_seconds"/g)?.length,
    2,
  );
  assert.match(
    deployScript,
    /BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS="\$\{BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS:-60\}"/,
  );
  assert.match(
    deployScript,
    /BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS" -ne 60/,
  );
  assert.doesNotMatch(deployScript, /BOOKING_PERSISTENCE_STATUS/);
  assert.doesNotMatch(
    deployScript,
    /booking persistence[^\n]*(?:continuing|failed with status)/i,
  );

  for (const [name, value] of [
    ["WEB_COMMITTED", "0"],
    ["SWITCH_COMPLETED", "1"],
    ["PROCESSES_STOPPED", "1"],
    ["FORWARD_MUTATION_STARTED", "1"],
    ["READINESS_FENCE_ACTIVE", "1"],
    ["READINESS_FENCE_RELEASED", "0"],
    ["READINESS_FENCE_RELEASE_REQUESTED", "0"],
    ["READINESS_FENCE_FORWARD_READY", "1"],
    ["LEGACY_COMPATIBILITY_LINKS_INSTALLED", "0"],
  ]) {
    assert.match(
      retryState,
      new RegExp(`\\$\\{${name}:-0\\}\\" != \\"${value}\\"`),
      name,
    );
  }
  assert.match(retryState, /readlink -- "\$CURRENT_LINK"[\s\S]{0,120}"\$RELEASE_DIR"/);
  assert.match(retryState, /readlink -f -- "\$CURRENT_LINK"[\s\S]{0,120}"\$RELEASE_DIR"/);
  assert.match(retryState, /-e "\$\{CURRENT_LINK\}\.pending"/);
  assert.match(retryState, /-L "\$\{CURRENT_LINK\}\.pending"/);
  assert.match(
    retryState,
    /pm2_process_snapshot[\s\S]{0,120}"\$AUTOMATION_WORKER_NAME" "\$absolute_deadline_seconds"[\s\S]{0,120}"\$process_snapshot" != "absent"/,
  );
  for (const identity of [
    "CANDIDATE_CURRENT_LINK_IDENTITY",
    "CANDIDATE_RUNTIME_IDENTITY",
    "CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY",
    "CANDIDATE_ENVIRONMENT_FILE_IDENTITY",
    "CANDIDATE_ENVIRONMENT_SHA256",
    "CANDIDATE_SUPABASE_INTERNAL_URL_B64",
    "CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64",
    "CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64",
    "CANDIDATE_BUILD_FILE_IDENTITY",
    "CANDIDATE_BUILD_FILE_SHA256",
    "CANDIDATE_WEB_PID",
    "CANDIDATE_WEB_PROCESS_START_TICKS",
    "CANDIDATE_WEB_PROCESS_IDENTITY",
    "CANDIDATE_WEB_CWD_IDENTITY",
  ]) {
    assert.match(retryState, new RegExp(identity), identity);
  }
  assert.match(currentCapture, /stat -c '%d:%i:%Z' -- "\$CURRENT_LINK"/);
  assert.match(currentCapture, /stat -Lc '%d:%i:%Z' -- "\$RELEASE_DIR"/);
  assert.match(
    currentCapture,
    /read_candidate_environment_snapshot_for_booking_retry/,
  );
  assert.match(currentCapture, /read_candidate_build_id_snapshot_for_booking_retry/);
  for (const frozenSnapshot of [
    "CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY",
    "CANDIDATE_ENVIRONMENT_FILE_IDENTITY",
    "CANDIDATE_ENVIRONMENT_SHA256",
    "CANDIDATE_SUPABASE_INTERNAL_URL_B64",
    "CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64",
    "CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64",
    "CANDIDATE_BUILD_FILE_IDENTITY",
    "CANDIDATE_BUILD_FILE_SHA256",
  ]) {
    assert.match(currentCapture, new RegExp(`${frozenSnapshot}=`), frozenSnapshot);
    assert.match(retryState, new RegExp(`\\$${frozenSnapshot}`), frozenSnapshot);
  }
  assert.match(
    environmentSnapshot,
    /read-production-supabase-environment\.mjs" rollback-snapshot[\s\S]{0,120}"\$RELEASE_DIR\/\.env\.local" "\$FAOLLA_WEB_BUILD_ID"/,
  );
  assert.match(
    processEnvironmentSnapshot,
    /process-snapshot "\$CANDIDATE_WEB_PID" "\$RELEASE_DIR"/,
  );
  assert.match(
    processEnvironmentSnapshot,
    /deadline_bounded_command_timeout_seconds[\s\S]{0,120}"\$absolute_deadline_seconds"/,
  );
  for (const boundedSnapshot of [environmentSnapshot, buildIdSnapshot]) {
    assert.match(boundedSnapshot, /deadline_bounded_command_timeout_seconds/);
    assert.match(boundedSnapshot, /"\$absolute_deadline_seconds"/);
  }
  assert.match(buildIdSnapshot, /"\$RELEASE_DIR\/\.next\/BUILD_ID" "\$FAOLLA_WEB_BUILD_ID"/);
  assert.match(buildIdSnapshot, /O_NOFOLLOW/);
  assert.match(buildIdSnapshot, /lstatSync/);
  assert.match(buildIdSnapshot, /fstatSync/);
  assert.match(buildIdSnapshot, /identity\.nlink !== 1n/);
  assert.match(buildIdSnapshot, /createHash\("sha256"\)/);
  assert.match(buildIdSnapshot, /text !== expectedBuildId/);
  assert.match(
    webCapture,
    /linux_process_start_ticks[\s\S]{0,100}"\$process_pid" "\$absolute_deadline_seconds"/,
  );
  assert.match(webCapture, /\/proc\/\$process_pid\/cwd/);
  assert.match(webCapture, /assert_booking_persistence_retry_state/);
  assert.match(
    webCapture,
    /pm2_process_snapshot[\s\S]{0,100}"\$APP_NAME" "\$absolute_deadline_seconds"/,
  );
  assert.match(healthFunction, /deadline_bounded_command_timeout_seconds/);
  assert.match(healthFunction, /"\$absolute_deadline_seconds" 4 0/);
  assert.match(
    healthFunction,
    /timeout --signal=KILL "\$\{command_timeout_seconds\}s" bash -c/,
  );
  assert.match(healthFunction, /"\$\{#response\}" -le 4096/);
  assert.match(checkerFunction, /cd "\$RELEASE_DIR" \|\| exit 1/);
  assert.equal(
    deployScript.match(/^\s*cd "\$RELEASE_DIR" \|\| exit 1$/gm)?.length,
    5,
  );
  assert.doesNotMatch(deployScript, /^\s*cd "\$RELEASE_DIR"\s*$/gm);
  assert.match(
    checkerFunction,
    /deadline_bounded_command_timeout_seconds[\s\S]{0,120}"\$absolute_deadline_seconds" "\$query_budget_seconds" 5/,
  );
  const checkerNodeSources = extractShellHeredocs(checkerFunction, "NODE");
  assert.equal(checkerNodeSources.length, 1);
  const checkerSupervisor = checkerNodeSources[0];
  assert.match(checkerSupervisor, /process\.platform !== "linux"/);
  for (const requiredFlag of ["O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK"]) {
    assert.match(
      checkerSupervisor,
      new RegExp(`!Number\\.isInteger\\(constants\\.${requiredFlag}\\)`),
      requiredFlag,
    );
  }
  assert.doesNotMatch(
    checkerSupervisor,
    /constants\.(?:O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK) \?\? 0/,
  );
  assert.match(
    checkerSupervisor,
    /constants\.O_RDONLY \| constants\.O_DIRECTORY[\s\S]{0,100}constants\.O_NOFOLLOW \| constants\.O_NONBLOCK/,
  );
  assert.match(
    checkerSupervisor,
    /constants\.O_RDONLY \| constants\.O_NOFOLLOW \| constants\.O_NONBLOCK/,
  );
  assert.match(
    checkerSupervisor,
    /"--env-file=\/proc\/self\/fd\/3"[\s\S]{0,100}"\/proc\/self\/fd\/4\/scripts\/check-booking-persistence\.mjs"/,
  );
  assert.match(
    checkerSupervisor,
    /stdio: \["ignore", "ignore", "ignore", childEnvironmentDescriptor, directoryDescriptor\]/,
  );
  assert.match(
    checkerSupervisor,
    /readSync\(descriptor, bytes, offset, size - offset, offset\)/,
  );
  assert.match(checkerSupervisor, /const readDescriptorBytes = \(descriptor, identity\) =>/);
  assert.equal(
    checkerSupervisor.match(/readDescriptorBytes\(/g)?.length,
    2,
  );

  const transition = extractShellRegion(
    'assert_readiness_fence_before_forward_operation "$RUNTIME_FILESYSTEM_MUTATION_TIMEOUT_SECONDS" || exit 1\nswitch_current_release "$RELEASE_DIR" || exit 1',
    '\nassert_readiness_fence_before_forward_operation "$RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS" || exit 1',
  );
  const ordered = [
    'switch_current_release "$RELEASE_DIR"',
    "SWITCH_COMPLETED=1",
    "capture_candidate_current_identity_for_booking_retry",
    "assert_readiness_fence_forward_checkpoint",
    'start_release "$RELEASE_DIR"',
    "assert_readiness_fence_forward_checkpoint",
    'wait_for_release_health "$FAOLLA_WEB_BUILD_ID"',
    "assert_readiness_fence_forward_checkpoint",
    "capture_candidate_web_identity_for_booking_retry",
    "verify_booking_persistence_with_bounded_retry",
  ];
  let orderedIndex = -1;
  for (const needle of ordered) {
    const index = transition.indexOf(needle, orderedIndex + 1);
    assert.ok(index > orderedIndex, `out-of-order booking retry boundary: ${needle}`);
    orderedIndex = index;
  }
  assert.equal(
    transition.match(/switch_current_release "\$RELEASE_DIR"/g)?.length,
    1,
  );
  assert.equal(transition.match(/start_release "\$RELEASE_DIR"/g)?.length, 1);
  const bookingDeadlineIndex = transition.indexOf(
    'BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS="$((',
  );
  const webCaptureIndex = transition.indexOf(
    "capture_candidate_web_identity_for_booking_retry",
    bookingDeadlineIndex,
  );
  const boundedRetryIndex = transition.indexOf(
    "verify_booking_persistence_with_bounded_retry",
    webCaptureIndex,
  );
  assert.ok(
    bookingDeadlineIndex >= 0 &&
      bookingDeadlineIndex < webCaptureIndex &&
      webCaptureIndex < boundedRetryIndex,
  );
  const bookingDeadlineRegion = transition.slice(
    bookingDeadlineIndex,
    boundedRetryIndex + "verify_booking_persistence_with_bounded_retry".length + 100,
  );
  assert.match(
    bookingDeadlineRegion,
    /capture_candidate_web_identity_for_booking_retry[\s\S]{0,100}"\$BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS"/,
  );
  assert.match(
    bookingDeadlineRegion,
    /verify_booking_persistence_with_bounded_retry[\s\S]{0,100}"\$BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS"/,
  );

  const failedDirectoryChange = spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: [
      "set -euo pipefail",
      checkerFunction,
      "unset SECONDS; SECONDS=0",
      "BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60",
      "RELEASE_DIR=/contract/definitely-missing-release",
      "CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY=1:2:3:4:5:6:7",
      "CANDIDATE_ENVIRONMENT_FILE_IDENTITY=1:2:3:4:5:6:7:8",
      `CANDIDATE_ENVIRONMENT_SHA256='${"a".repeat(64)}'`,
      "checker_process_calls=0",
      "deadline_bounded_command_timeout_seconds() { printf '%s\\n' 10; }",
      "timeout() { checker_process_calls=$((checker_process_calls + 1)); return 0; }",
      "node() { checker_process_calls=$((checker_process_calls + 1)); return 0; }",
      "if verify_booking_persistence 20 30 2>/dev/null; then status=0; else status=$?; fi",
      "printf '%s %s\\n' \"$status\" \"$checker_process_calls\"",
      "",
    ].join("\n"),
    timeout: 10_000,
  });
  assert.equal(failedDirectoryChange.status, 0, failedDirectoryChange.stderr);
  assert.equal(failedDirectoryChange.stderr, "");
  assert.equal(failedDirectoryChange.stdout, "1 0\n");

  const frozenEnvironmentDirectoryIdentity = "1:2:3:4:5:6:7";
  const frozenEnvironmentFileIdentity = "1:2:3:4:5:6:7:8";
  const frozenEnvironmentSha256 = "a".repeat(64);
  const frozenInternalUrlBase64 = Buffer.from("http://internal.test").toString("base64");
  const frozenPublicUrlBase64 = Buffer.from("https://public.test").toString("base64");
  const frozenAnonKeyBase64 = Buffer.from("anon-contract-key").toString("base64");
  const frozenBuildFileIdentity = "8:7:6:5:4:3:2:1";
  const frozenBuildFileSha256 = "b".repeat(64);
  const runFrozenState = (overrides = {}) => {
    const values = {
      environmentDirectoryIdentity: frozenEnvironmentDirectoryIdentity,
      environmentFileIdentity: frozenEnvironmentFileIdentity,
      environmentSha256: frozenEnvironmentSha256,
      environmentInternalUrlBase64: frozenInternalUrlBase64,
      environmentPublicUrlBase64: frozenPublicUrlBase64,
      environmentAnonKeyBase64: frozenAnonKeyBase64,
      buildFileIdentity: frozenBuildFileIdentity,
      buildFileSha256: frozenBuildFileSha256,
      processStatus: "present",
      processStartTicks: "456",
      processInternalUrlBase64: frozenInternalUrlBase64,
      processPublicUrlBase64: frozenPublicUrlBase64,
      processAnonKeyBase64: frozenAnonKeyBase64,
      ...overrides,
    };
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        "set +e",
        retryState,
        "WEB_COMMITTED=0",
        "SWITCH_COMPLETED=1",
        "PROCESSES_STOPPED=1",
        "FORWARD_MUTATION_STARTED=1",
        "READINESS_FENCE_ACTIVE=1",
        "READINESS_FENCE_RELEASED=0",
        "READINESS_FENCE_RELEASE_REQUESTED=0",
        "READINESS_FENCE_FORWARD_READY=1",
        "LEGACY_COMPATIBILITY_LINKS_INSTALLED=0",
        "unset SECONDS; SECONDS=0",
        "CURRENT_LINK=/contract/current",
        "RELEASE_DIR=/contract/release",
        "APP_NAME=contract-web",
        "AUTOMATION_WORKER_NAME=contract-worker",
        "CANDIDATE_CURRENT_LINK_IDENTITY=10:20:30",
        "CANDIDATE_RUNTIME_IDENTITY=40:50:60",
        `CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY='${frozenEnvironmentDirectoryIdentity}'`,
        `CANDIDATE_ENVIRONMENT_FILE_IDENTITY='${frozenEnvironmentFileIdentity}'`,
        `CANDIDATE_ENVIRONMENT_SHA256='${frozenEnvironmentSha256}'`,
        `CANDIDATE_SUPABASE_INTERNAL_URL_B64='${frozenInternalUrlBase64}'`,
        `CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64='${frozenPublicUrlBase64}'`,
        `CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64='${frozenAnonKeyBase64}'`,
        `CANDIDATE_BUILD_FILE_IDENTITY='${frozenBuildFileIdentity}'`,
        `CANDIDATE_BUILD_FILE_SHA256='${frozenBuildFileSha256}'`,
        "CANDIDATE_WEB_PID=123",
        "CANDIDATE_WEB_PROCESS_START_TICKS=456",
        "CANDIDATE_WEB_PROCESS_IDENTITY=70:80",
        "CANDIDATE_WEB_CWD_IDENTITY=40:50:60",
        "readlink() { printf '%s\\n' \"$RELEASE_DIR\"; }",
        "stat() {",
        "  case \"${@: -1}\" in",
        "    \"$CURRENT_LINK\") printf '%s\\n' \"$CANDIDATE_CURRENT_LINK_IDENTITY\" ;;",
        "    \"$RELEASE_DIR\"|\"/proc/$CANDIDATE_WEB_PID/cwd\") printf '%s\\n' \"$CANDIDATE_RUNTIME_IDENTITY\" ;;",
        "    \"/proc/$CANDIDATE_WEB_PID\") printf '%s\\n' \"$CANDIDATE_WEB_PROCESS_IDENTITY\" ;;",
        "    *) return 1 ;;",
        "  esac",
        "}",
        "pm2_process_snapshot() {",
        "  [ \"$2\" = 60 ] || return 1",
        "  if [ \"$1\" = \"$AUTOMATION_WORKER_NAME\" ]; then printf '%s\\n' absent; else printf 'running:%s\\n' \"$CANDIDATE_WEB_PID\"; fi",
        "}",
        "linux_process_start_ticks() { [ \"$2\" = 60 ] || return 1; printf '%s\\n' \"$CANDIDATE_WEB_PROCESS_START_TICKS\"; }",
        "read_candidate_environment_snapshot_for_booking_retry() {",
        "  [ \"$1\" = 60 ] || return 1",
        `  printf '%s\\n' '${values.environmentDirectoryIdentity}' '${values.environmentFileIdentity}' '${values.environmentSha256}' '${values.environmentInternalUrlBase64}' '${values.environmentPublicUrlBase64}' '${values.environmentAnonKeyBase64}'`,
        "}",
        "read_candidate_build_id_snapshot_for_booking_retry() {",
        "  [ \"$1\" = 60 ] || return 1",
        `  printf '%s\\n' '${values.buildFileIdentity}' '${values.buildFileSha256}'`,
        "}",
        "read_candidate_process_environment_snapshot_for_booking_retry() {",
        "  [ \"$1\" = 60 ] || return 1",
        `  printf '%s\\n' '${values.processStatus}' '${values.processStartTicks}' '${values.processInternalUrlBase64}' '${values.processPublicUrlBase64}' '${values.processAnonKeyBase64}'`,
        "}",
        "assert_booking_persistence_retry_state 60",
        "printf '__state__ %s\\n' \"$?\"",
        "",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    return Number(result.stdout.trim().match(/^__state__ (\d+)$/)?.[1]);
  };
  assert.equal(runFrozenState(), 0);
  for (const drift of [
    { environmentDirectoryIdentity: "9:2:3:4:5:6:7" },
    { environmentFileIdentity: "9:2:3:4:5:6:7:8" },
    { environmentSha256: "c".repeat(64) },
    { environmentInternalUrlBase64: Buffer.from("http://drift.test").toString("base64") },
    { environmentPublicUrlBase64: Buffer.from("https://drift.test").toString("base64") },
    { environmentAnonKeyBase64: Buffer.from("drift-anon").toString("base64") },
    { buildFileIdentity: "9:7:6:5:4:3:2:1" },
    { buildFileSha256: "d".repeat(64) },
    { processStatus: "absent" },
    { processStartTicks: "457" },
    { processInternalUrlBase64: Buffer.from("http://process-drift.test").toString("base64") },
    { processPublicUrlBase64: Buffer.from("https://process-drift.test").toString("base64") },
    { processAnonKeyBase64: Buffer.from("process-drift-anon").toString("base64") },
  ]) {
    assert.equal(runFrozenState(drift), 1, JSON.stringify(drift));
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-booking-retry-contract-"),
  );
  const oneRound = (checkerBudget, fenceBudget = 60, deadline = 60) => [
    `state:${deadline}`,
    `fence-before:${fenceBudget}:${deadline}`,
    `state:${deadline}`,
    `health:${deadline}`,
    `state:${deadline}`,
    `check:${checkerBudget}:${deadline}`,
    `state:${deadline}`,
    `fence-checkpoint:${deadline}`,
    `state:${deadline}`,
    `health:${deadline}`,
    `state:${deadline}`,
  ];
  const run = async ({
    statuses,
    absoluteDeadline = 60,
    elapsedPerCheck = 0,
    exhaustAt = 0,
    sleepToDeadline = false,
    name,
  }) => {
    const callsPath = join(temporaryDirectory, `${name}.calls`);
    const statusCases = statuses
      .map((status, index) => `    ${index + 1}) return ${status} ;;`)
      .join("\n");
    const result = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        "set +e",
        retryFunction,
        `CALLS='${toBashPath(callsPath)}'`,
        "BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60",
        "BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=60",
        "unset SECONDS; SECONDS=0",
        `ABSOLUTE_DEADLINE_SECONDS='${absoluteDeadline}'`,
        "checker_calls=0",
        "call_index=0",
        `EXHAUST_AT='${exhaustAt}'`,
        `SLEEP_TO_DEADLINE='${sleepToDeadline ? 1 : 0}'`,
        "record() { call_index=$((call_index + 1)); printf '%s\\n' \"$1\" >> \"$CALLS\"; if [ \"$EXHAUST_AT\" -eq \"$call_index\" ]; then SECONDS=\"$ABSOLUTE_DEADLINE_SECONDS\"; fi; }",
        "assert_booking_persistence_retry_state() { record \"state:$1\"; [ \"$1\" = \"$ABSOLUTE_DEADLINE_SECONDS\" ] && [ \"$SECONDS\" -lt \"$1\" ]; }",
        "assert_readiness_fence_before_forward_operation() {",
        "  local entry_seconds=\"$SECONDS\"",
        "  record \"fence-before:$1:$2\"",
        "  [ \"$2\" = \"$ABSOLUTE_DEADLINE_SECONDS\" ]",
        "  [ \"$1\" -eq $((ABSOLUTE_DEADLINE_SECONDS - entry_seconds)) ]",
        "  [ \"$1\" -gt 0 ] && [ \"$1\" -le 60 ]",
        "  [ \"$SECONDS\" -lt \"$2\" ]",
        "}",
        "assert_candidate_web_health() { record \"health:$1\"; [ \"$1\" = \"$ABSOLUTE_DEADLINE_SECONDS\" ] && [ \"$SECONDS\" -lt \"$1\" ]; }",
        "assert_readiness_fence_forward_checkpoint() { record \"fence-checkpoint:$1\"; [ \"$1\" = \"$ABSOLUTE_DEADLINE_SECONDS\" ] && [ \"$SECONDS\" -lt \"$1\" ]; }",
        "verify_booking_persistence() {",
        "  local entry_seconds=\"$SECONDS\"",
        "  checker_calls=$((checker_calls + 1))",
        "  record \"check:$1:$2\"",
        "  [ \"$2\" = \"$ABSOLUTE_DEADLINE_SECONDS\" ] || return 98",
        "  [ \"$1\" -eq $((ABSOLUTE_DEADLINE_SECONDS - entry_seconds)) ] || return 97",
        "  [ \"$1\" -gt 0 ] && [ \"$1\" -le 60 ] || return 96",
        `  SECONDS=$((SECONDS + ${elapsedPerCheck}))`,
        "  case \"$checker_calls\" in",
        statusCases,
        "    *) return 99 ;;",
        "  esac",
        "}",
        "sleep() { record \"sleep:$ABSOLUTE_DEADLINE_SECONDS\"; if [ \"$SLEEP_TO_DEADLINE\" = 1 ]; then SECONDS=\"$ABSOLUTE_DEADLINE_SECONDS\"; else SECONDS=$((SECONDS + 1)); fi; }",
        "if verify_booking_persistence_with_bounded_retry \"$ABSOLUTE_DEADLINE_SECONDS\"; then status=0; else status=$?; fi",
        "printf '__result__ %s %s %s\\n' \"$status\" \"$checker_calls\" \"$SECONDS\"",
        "",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${name}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, "", name);
    const lines = result.stdout.trim().split("\n");
    const summary = lines.pop()?.match(/^__result__ (\d+) (\d+) (\d+)$/);
    assert.ok(summary, `${name}\n${result.stdout}`);
    return {
      codes: lines,
      status: Number(summary[1]),
      checkerCalls: Number(summary[2]),
      elapsed: Number(summary[3]),
      calls: await pathExists(callsPath)
        ? (await readFile(callsPath, "utf8")).trim().split("\n")
        : [],
    };
  };

  try {
    assert.deepEqual(await run({ statuses: [0], name: "success" }), {
      codes: [],
      status: 0,
      checkerCalls: 1,
      elapsed: 0,
      calls: oneRound(60),
    });
    assert.deepEqual(await run({ statuses: [2, 0], name: "transient" }), {
      codes: ["[deploy] deploy_forward_booking_persistence_transient_retry"],
      status: 0,
      checkerCalls: 2,
      elapsed: 1,
      calls: [...oneRound(60), "sleep:60", ...oneRound(59, 59)],
    });
    assert.deepEqual(await run({ statuses: [2, 2], name: "exhausted" }), {
      codes: [
        "[deploy] deploy_forward_booking_persistence_transient_retry",
        "[deploy] deploy_forward_booking_persistence_transient_exhausted",
      ],
      status: 1,
      checkerCalls: 2,
      elapsed: 1,
      calls: [...oneRound(60), "sleep:60", ...oneRound(59, 59)],
    });
    for (const nonretryableStatus of [1, 3, 124, 255]) {
      assert.deepEqual(
        await run({
          statuses: [nonretryableStatus],
          name: `hard-${nonretryableStatus}`,
        }),
        {
          codes: ["[deploy] deploy_forward_booking_persistence_hard_failed"],
          status: 1,
          checkerCalls: 1,
          elapsed: 0,
          calls: oneRound(60),
        },
        `nonretryable booking status ${nonretryableStatus}`,
      );
    }
    for (const invalidDeadline of [0, 61]) {
      assert.deepEqual(
        await run({
          statuses: [0],
          absoluteDeadline: invalidDeadline,
          name: `invalid-absolute-deadline-${invalidDeadline}`,
        }),
        {
          codes: ["[deploy] deploy_forward_booking_persistence_hard_failed"],
          status: 1,
          checkerCalls: 0,
          elapsed: 0,
          calls: [],
        },
      );
    }

    const deadlineExhausted = await run({
      statuses: [2, 0],
      elapsedPerCheck: 60,
      name: "deadline-exhausted",
    });
    assert.equal(deadlineExhausted.status, 1);
    assert.equal(deadlineExhausted.checkerCalls, 1);
    assert.ok(deadlineExhausted.elapsed <= 60);
    assert.equal(
      deadlineExhausted.codes.at(-1),
      "[deploy] deploy_forward_booking_persistence_transient_exhausted",
    );
    assert.equal(
      deadlineExhausted.calls.filter((call) => call.startsWith("check:")).length,
      1,
    );

    const firstRound = oneRound(60);
    for (let exhaustAt = 1; exhaustAt <= firstRound.length; exhaustAt += 1) {
      const boundaryName = `absolute-deadline-boundary-${exhaustAt}`;
      const exhausted = await run({
        statuses: [0],
        exhaustAt,
        name: boundaryName,
      });
      assert.equal(exhausted.status, 1, boundaryName);
      assert.equal(exhausted.checkerCalls, exhaustAt >= 6 ? 1 : 0, boundaryName);
      assert.equal(exhausted.elapsed, 60, boundaryName);
      assert.deepEqual(
        exhausted.codes,
        ["[deploy] deploy_forward_booking_persistence_hard_failed"],
        boundaryName,
      );
      assert.deepEqual(
        exhausted.calls,
        firstRound.slice(0, exhaustAt + (exhaustAt === 6 ? 1 : 0)),
        boundaryName,
      );
    }

    const sleepExhausted = await run({
      statuses: [2, 0],
      sleepToDeadline: true,
      name: "sleep-consumes-shared-deadline",
    });
    assert.equal(sleepExhausted.status, 1);
    assert.equal(sleepExhausted.checkerCalls, 1);
    assert.equal(sleepExhausted.elapsed, 60);
    assert.deepEqual(sleepExhausted.calls, [...oneRound(60), "sleep:60"]);
    assert.deepEqual(sleepExhausted.codes, [
      "[deploy] deploy_forward_booking_persistence_transient_retry",
      "[deploy] deploy_forward_booking_persistence_transient_exhausted",
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test(
  "booking checker env fd keeps the frozen inode across pathname swap and restore",
  { skip: process.platform !== "linux" },
  async () => {
    assert.ok(Number.isInteger(fsConstants.O_NOFOLLOW));
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "faolla-booking-env-fd-contract-"),
    );
    const environmentPath = join(temporaryDirectory, ".env.local");
    const frozenPath = join(temporaryDirectory, ".env.frozen");
    const hostilePath = join(temporaryDirectory, ".env.hostile");
    let environmentHandle;
    try {
      await writeFile(environmentPath, "FROZEN_BOOKING_ENV=original\n", {
        mode: 0o600,
      });
      await writeFile(hostilePath, "FROZEN_BOOKING_ENV=hostile\n", {
        mode: 0o600,
      });
      environmentHandle = await openFile(
        environmentPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      await rename(environmentPath, frozenPath);
      await rename(hostilePath, environmentPath);
      const readFrozenDescriptor = () => spawnSync(
        process.execPath,
        [
          "--env-file=/proc/self/fd/3",
          "--input-type=module",
          "--eval",
          'process.stdout.write(process.env.FROZEN_BOOKING_ENV ?? "missing")',
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe", environmentHandle.fd],
          timeout: 10_000,
        },
      );
      const whileSwapped = readFrozenDescriptor();
      assert.equal(whileSwapped.status, 0, whileSwapped.stderr);
      assert.equal(whileSwapped.stdout, "original");
      assert.equal(whileSwapped.stderr, "");

      await rename(environmentPath, hostilePath);
      await rename(frozenPath, environmentPath);
      const afterRestore = readFrozenDescriptor();
      assert.equal(afterRestore.status, 0, afterRestore.stderr);
      assert.equal(afterRestore.stdout, "original");
      assert.equal(afterRestore.stderr, "");
    } finally {
      await environmentHandle?.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test("database quiescence uses a hard relaxed deadline and requires a final strict proof", () => {
  const strictFunction = extractShellRegion(
    "assert_readiness_fence_held() {",
    "\nreadiness_fence_process_quiescence_checkpoint() {",
  );
  const functions = extractShellRegion(
    "readiness_fence_process_quiescence_checkpoint() {",
    "\naccept_readiness_fence_candidate() {",
  );
  const run = (body) => spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: ["set +e", strictFunction, functions, body, ""].join("\n"),
    timeout: 10_000,
  });

  const eventuallyClean = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=5",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=0",
    "unset SECONDS; SECONDS=0",
    "checkpoint_calls=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() {",
    "  checkpoint_calls=$((checkpoint_calls + 1))",
    "  case \"$checkpoint_calls\" in 1|2) return 2 ;; *) return 0 ;; esac",
    "}",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); return 0; }",
    "sleep() { SECONDS=$((SECONDS + 1)); }",
    "wait_for_readiness_fence_database_quiescence; status=$?",
    "printf '%s %s %s %s\\n' \"$status\" \"$checkpoint_calls\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(eventuallyClean.status, 0, `${eventuallyClean.stdout}\n${eventuallyClean.stderr}`);
  assert.equal(eventuallyClean.stdout.trim(), "0 3 1 1");

  const strictCancellationThenClean = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=5",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=0",
    "unset SECONDS; SECONDS=0",
    "checkpoint_calls=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { checkpoint_calls=$((checkpoint_calls + 1)); return 0; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); if [ \"$strict_calls\" -eq 1 ]; then return 2; fi; return 0; }",
    "sleep() { SECONDS=$((SECONDS + 1)); }",
    "wait_for_readiness_fence_database_quiescence; status=$?",
    "printf '%s %s %s %s\\n' \"$status\" \"$checkpoint_calls\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(
    strictCancellationThenClean.status,
    0,
    `${strictCancellationThenClean.stdout}\n${strictCancellationThenClean.stderr}`,
  );
  assert.equal(strictCancellationThenClean.stdout.trim(), "0 2 2 1");

  const strictCancellationTimeout = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=3",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=1",
    "unset SECONDS; SECONDS=0",
    "checkpoint_calls=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { checkpoint_calls=$((checkpoint_calls + 1)); return 0; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); return 2; }",
    "sleep() { SECONDS=$((SECONDS + 1)); }",
    "wait_for_readiness_fence_database_quiescence >/dev/null; status=$?",
    "printf '%s %s %s %s\\n' \"$status\" \"$checkpoint_calls\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(
    strictCancellationTimeout.status,
    0,
    `${strictCancellationTimeout.stdout}\n${strictCancellationTimeout.stderr}`,
  );
  assert.equal(strictCancellationTimeout.stdout.trim(), "1 3 3 0");

  const strictCancellationStatus = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
    "READINESS_FENCE_ACTIVE=1",
    "READINESS_FENCE_RELEASED=0",
    "unset SECONDS; SECONDS=0",
    "identity_calls=0",
    "readiness_fence_process_identity_matches() { identity_calls=$((identity_calls + 1)); return 0; }",
    "validate_readiness_fence_marker() { return 0; }",
    "assert_readiness_fence_database_locks() { return 2; }",
    "assert_readiness_fence_held 720 5; status=$?",
    "printf '%s %s\\n' \"$status\" \"$identity_calls\"",
  ].join("\n"));
  assert.equal(
    strictCancellationStatus.status,
    0,
    `${strictCancellationStatus.stdout}\n${strictCancellationStatus.stderr}`,
  );
  assert.equal(strictCancellationStatus.stdout.trim(), "2 2");

  const strictFailure = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=5",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=1",
    "unset SECONDS; SECONDS=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { return 0; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); return 1; }",
    "wait_for_readiness_fence_database_quiescence; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(strictFailure.status, 0, `${strictFailure.stdout}\n${strictFailure.stderr}`);
  assert.equal(strictFailure.stdout.trim(), "1 1 0");

  const timedOut = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=3",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=1",
    "unset SECONDS; SECONDS=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { return 2; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); return 0; }",
    "sleep() { SECONDS=$((SECONDS + 1)); }",
    "wait_for_readiness_fence_database_quiescence >/dev/null; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(timedOut.status, 0, `${timedOut.stdout}\n${timedOut.stderr}`);
  assert.equal(timedOut.stdout.trim(), "1 0 0");

  const lateClean = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=5",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=1",
    "unset SECONDS; SECONDS=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { SECONDS=\"$3\"; return 0; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); return 0; }",
    "wait_for_readiness_fence_database_quiescence; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(lateClean.status, 0, `${lateClean.stdout}\n${lateClean.stderr}`);
  assert.equal(lateClean.stdout.trim(), "1 0 0");

  const lateStrict = run([
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=5",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_FORWARD_READY=1",
    "unset SECONDS; SECONDS=0",
    "strict_calls=0",
    "readiness_fence_process_quiescence_checkpoint() { return 0; }",
    "assert_readiness_fence_held() { strict_calls=$((strict_calls + 1)); SECONDS=5; return 0; }",
    "wait_for_readiness_fence_database_quiescence; status=$?",
    "printf '%s %s %s\\n' \"$status\" \"$strict_calls\" \"$READINESS_FENCE_FORWARD_READY\"",
  ].join("\n"));
  assert.equal(lateStrict.status, 0, `${lateStrict.stdout}\n${lateStrict.stderr}`);
  assert.equal(lateStrict.stdout.trim(), "1 1 0");

  for (const phase of ["identity", "marker", "database", "post_identity"]) {
    const deadline = run([
      "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
      "READINESS_FENCE_ACTIVE=1",
      "READINESS_FENCE_RELEASED=0",
      "unset SECONDS; SECONDS=0",
      "deadline=$((SECONDS + 5))",
      "identity_calls=0",
      "marker_calls=0",
      "database_calls=0",
      `PHASE='${phase}'`,
      "readiness_fence_process_identity_matches() {",
      "  identity_calls=$((identity_calls + 1))",
      "  if [ \"$PHASE\" = identity ] || { [ \"$PHASE\" = post_identity ] && [ \"$identity_calls\" -eq 2 ]; }; then SECONDS=\"$deadline\"; fi",
      "  return 0",
      "}",
      "validate_readiness_fence_marker() { marker_calls=$((marker_calls + 1)); if [ \"$PHASE\" = marker ]; then SECONDS=\"$deadline\"; fi; return 0; }",
      "assert_readiness_fence_database_locks() { database_calls=$((database_calls + 1)); if [ \"$PHASE\" = database ]; then SECONDS=\"$deadline\"; fi; return 0; }",
      "readiness_fence_process_quiescence_checkpoint 720 5 \"$deadline\"; status=$?",
      "printf '%s %s %s %s\\n' \"$status\" \"$identity_calls\" \"$marker_calls\" \"$database_calls\"",
    ].join("\n"));
    assert.equal(deadline.status, 0, `${phase}\n${deadline.stdout}\n${deadline.stderr}`);
    assert.match(deadline.stdout, /^1 /, phase);
  }

  const preStopAcceptsQuiescing = run([
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
    "READINESS_FENCE_OPERATION_MARGIN_SECONDS=10",
    "readiness_fence_process_quiescence_checkpoint() { return 2; }",
    "assert_readiness_fence_before_process_quiescence 335; status=$?",
    "printf '%s\\n' \"$status\"",
  ].join("\n"));
  assert.equal(
    preStopAcceptsQuiescing.status,
    0,
    `${preStopAcceptsQuiescing.stdout}\n${preStopAcceptsQuiescing.stderr}`,
  );
  assert.equal(preStopAcceptsQuiescing.stdout.trim(), "0");
});

test("fence failure reporting exposes only a frozen diagnostic and an explicit cleanup outcome", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-fence-diagnostic-contract-"),
  );
  const logPath = join(temporaryDirectory, "helper.log");
  const functions = extractShellRegion(
    "readiness_fence_safe_failure_record() {",
    "\nstart_readiness_fence() {",
  );
  const safeRecord = {
    addressEvidence: null,
    childExitCode: "3",
    childResult: "exit",
    childSignal: null,
    error: "readiness_fence_child_failed",
    ok: false,
    sqlstate: "P0001",
    sqlstateStatus: "exact",
  };
  const interruptedRecord = {
    addressEvidence: null,
    childExitCode: null,
    childResult: "not_observed",
    childSignal: null,
    error: "readiness_fence_interrupted",
    ok: false,
    sqlstate: null,
    sqlstateStatus: "absent",
  };
  const markerFailureRecord = {
    ...interruptedRecord,
    error: "readiness_fence_marker_invalid",
  };
  const run = (script) => spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    input: script,
    timeout: 10_000,
  });
  try {
    await writeFile(logPath, canonicalJsonBytes(safeRecord), { mode: 0o600 });
    const validScript = [
      "set -euo pipefail",
      `RELEASE_DIR='${toBashPath(repositoryRoot)}'`,
      `READINESS_FENCE_LOG='${toBashPath(logPath)}'`,
      functions,
      "report_readiness_fence_failure",
      "",
    ].join("\n");
    const valid = run(validScript);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    assert.equal(
      valid.stdout.trim(),
      `[deploy] readiness fence helper failure ${JSON.stringify(safeRecord)}`,
    );

    const secret = "do-not-log::error::private-value";
    await writeFile(
      logPath,
      Buffer.concat([canonicalJsonBytes(safeRecord), Buffer.from(secret)]),
      { mode: 0o600 },
    );
    const hostile = run(validScript);
    assert.equal(hostile.status, 0, `${hostile.stdout}\n${hostile.stderr}`);
    assert.equal(
      hostile.stdout.trim(),
      "[deploy] readiness fence helper failure readiness_fence_diagnostic_unavailable",
    );
    assert.doesNotMatch(`${hostile.stdout}\n${hostile.stderr}`, /do-not-log|::error::|private-value/);

    const eventsPath = join(temporaryDirectory, "events.log");
    const frozenAfterQuiesceScript = [
      "set +e",
      `RELEASE_DIR='${toBashPath(repositoryRoot)}'`,
      `READINESS_FENCE_LOG='${toBashPath(logPath)}'`,
      `EVENTS='${toBashPath(eventsPath)}'`,
      functions,
      "eval \"$(declare -f readiness_fence_safe_failure_record | sed '1s/readiness_fence_safe_failure_record/original_readiness_fence_safe_failure_record/')\"",
      "readiness_fence_safe_failure_record() { printf 'freeze\\n' >> \"$EVENTS\"; original_readiness_fence_safe_failure_record \"$@\"; }",
      `quiesce_failed_readiness_fence() { printf 'quiesce\\n' >> "$EVENTS"; printf '%s\\n' '${JSON.stringify(interruptedRecord)}' > "$READINESS_FENCE_LOG"; chmod 600 "$READINESS_FENCE_LOG"; return 0; }`,
      "cleanup_readiness_fence_files() { printf 'cleanup\\n' >> \"$EVENTS\"; rm -f -- \"$READINESS_FENCE_LOG\"; }",
      "if reject_failed_readiness_fence readiness_fence_marker_invalid; then status=0; else status=$?; fi",
      '[ "$status" -eq 1 ]',
      '[ ! -e "$READINESS_FENCE_LOG" ]',
      "",
    ].join("\n");
    const frozenAfterQuiesce = run(frozenAfterQuiesceScript);
    assert.equal(
      frozenAfterQuiesce.status,
      0,
      `${frozenAfterQuiesce.stdout}\n${frozenAfterQuiesce.stderr}`,
    );
    assert.equal(
      frozenAfterQuiesce.stdout.trim(),
      [
        `[deploy] readiness fence helper failure ${JSON.stringify(markerFailureRecord)}`,
        "[deploy] readiness fence cleanup completed",
      ].join("\n"),
    );
    assert.equal(await readFile(eventsPath, "utf8"), "quiesce\nfreeze\ncleanup\n");

    for (const [quiesceStatus, cleanupStatus, expectedMarker] of [
      [0, 0, "readiness fence cleanup completed"],
      [1, 0, "readiness_fence_cleanup_unverified"],
      [0, 1, "readiness_fence_cleanup_unverified"],
    ]) {
      const cleanupScript = [
        "set +e",
        functions,
        "readiness_fence_safe_failure_record() { return 1; }",
        `quiesce_failed_readiness_fence() { return ${quiesceStatus}; }`,
        `cleanup_readiness_fence_files() { return ${cleanupStatus}; }`,
        "if reject_failed_readiness_fence; then status=0; else status=$?; fi",
        '[ "$status" -eq 1 ]',
        "",
      ].join("\n");
      const cleanup = run(cleanupScript);
      assert.equal(cleanup.status, 0, `${cleanup.stdout}\n${cleanup.stderr}`);
      assert.match(cleanup.stdout, new RegExp(expectedMarker));
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rollback cleanup exposes a complete fixed-code map independent of failure values", async () => {
  const rollbackCodes = [
    "deploy_rollback_failed_evidence",
    "deploy_rollback_failed_fence_checkpoint",
    "deploy_rollback_failed_worker_quiesce",
    "deploy_rollback_failed_web_quiesce",
    "deploy_rollback_failed_port_quiesce",
    "deploy_rollback_failed_compatibility_restore",
    "deploy_rollback_failed_current_restore",
    "deploy_rollback_failed_previous_web_start",
    "deploy_rollback_failed_previous_web_health",
    "deploy_rollback_failed_fence_reacquire",
    "deploy_rollback_failed_runtime_restore",
    "deploy_rollback_failed_fence_release",
    "deploy_rollback_failed_worker_restart",
    "deploy_rollback_failed_pm2_save",
    "deploy_rollback_failed_fence_cleanup",
    "deploy_rollback_failed_release_cleanup",
    "deploy_rollback_failed_unknown",
  ];
  const exposedCodes = [...new Set(
    [...deployScript.matchAll(/\[deploy\] (deploy_rollback_failed_[a-z0-9_]+)/g)]
      .map((match) => match[1]),
  )].sort();
  assert.deepEqual(exposedCodes, [...rollbackCodes].sort());

  const cleanupFunction = extractShellRegion(
    "cleanup_failed_build() {",
    "\ntrap cleanup_failed_build EXIT",
  );
  assert.doesNotMatch(
    cleanupFunction,
    /deploy_rollback_failed_[a-z_]+[^\n]*\$(?:\?|\{|[A-Za-z_])/,
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-rollback-fixed-codes-"),
  );
  const runtimeRestoreCodes = [
    "deploy_rollback_failed_evidence",
    "deploy_rollback_failed_fence_checkpoint",
    "deploy_rollback_failed_worker_quiesce",
    "deploy_rollback_failed_web_quiesce",
    "deploy_rollback_failed_port_quiesce",
    "deploy_rollback_failed_compatibility_restore",
    "deploy_rollback_failed_current_restore",
    "deploy_rollback_failed_previous_web_start",
    "deploy_rollback_failed_previous_web_health",
  ];
  const fixtures = [
    {
      name: "fence reacquire",
      failAt: "ensure",
      codes: ["deploy_rollback_failed_fence_reacquire"],
      calls: ["ensure", "discard"],
    },
    ...runtimeRestoreCodes.map((rollbackCode) => ({
      name: `runtime restore ${rollbackCode}`,
      failAt: "rollback",
      rollbackCode,
      codes: [rollbackCode, "deploy_rollback_failed_runtime_restore"],
      calls: ["ensure", "rollback", "discard"],
    })),
    {
      name: "unknown runtime restore substage",
      failAt: "rollback",
      rollbackCode: "hostile_dynamic_value_987654321",
      codes: [
        "deploy_rollback_failed_unknown",
        "deploy_rollback_failed_runtime_restore",
      ],
      calls: ["ensure", "rollback", "discard"],
    },
    {
      name: "fence release",
      failAt: "release",
      codes: ["deploy_rollback_failed_fence_release"],
      calls: ["ensure", "rollback", "release", "discard", "pm2-save"],
    },
    {
      name: "worker start",
      failAt: "worker-start",
      previousWorkerRunning: 1,
      codes: ["deploy_rollback_failed_worker_restart"],
      calls: ["ensure", "rollback", "release", "worker-start", "pm2-save"],
    },
    {
      name: "worker online",
      failAt: "worker-online",
      previousWorkerRunning: 1,
      codes: ["deploy_rollback_failed_worker_restart"],
      calls: [
        "ensure", "rollback", "release", "worker-start", "worker-online", "pm2-save",
      ],
    },
    {
      name: "pm2 save",
      failAt: "pm2-save",
      codes: ["deploy_rollback_failed_pm2_save"],
      calls: ["ensure", "rollback", "release", "pm2-save"],
    },
    {
      name: "fence cleanup primary is not duplicated",
      failAt: "ensure+discard",
      ensureCode: "deploy_rollback_failed_fence_cleanup",
      codes: ["deploy_rollback_failed_fence_cleanup"],
      calls: ["ensure", "discard"],
    },
    {
      name: "fence reacquire primary retains one cleanup secondary",
      failAt: "ensure+discard",
      ensureCode: "deploy_rollback_failed_fence_reacquire",
      codes: [
        "deploy_rollback_failed_fence_reacquire",
        "deploy_rollback_failed_fence_cleanup",
      ],
      calls: ["ensure", "discard"],
    },
    {
      name: "unknown primary retains one cleanup secondary",
      failAt: "ensure+discard",
      ensureCode: "hostile_dynamic_value_987654321",
      codes: [
        "deploy_rollback_failed_unknown",
        "deploy_rollback_failed_fence_cleanup",
      ],
      calls: ["ensure", "discard"],
    },
    {
      name: "release cleanup",
      failAt: "release-cleanup",
      releaseExists: true,
      codes: ["deploy_rollback_failed_release_cleanup"],
      calls: ["ensure", "rollback", "release", "pm2-save", "remove-release"],
    },
  ];

  try {
    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      for (const failureStatus of [1, 2, 17, 255]) {
        const caseDirectory = join(temporaryDirectory, `${fixtureIndex}-${failureStatus}`);
        const releaseDirectory = join(caseDirectory, "release");
        const callsPath = join(caseDirectory, "calls");
        await mkdir(caseDirectory, { recursive: true });
        if (fixture.releaseExists) await mkdir(releaseDirectory);
        const script = [
          "set +e",
          cleanupFunction,
          `CALLS='${toBashPath(callsPath)}'`,
          `RELEASE_BUILD_DIR='${toBashPath(join(caseDirectory, "missing-build"))}'`,
          `RELEASE_DIR='${toBashPath(releaseDirectory)}'`,
          `DEPLOY_ATTESTATION_FILE='${toBashPath(join(caseDirectory, "missing-attestation"))}'`,
          `DEPLOY_RELEASE_BINDING_FILE='${toBashPath(join(caseDirectory, "missing-binding"))}'`,
          `FAIL_AT='${fixture.failAt}'`,
          `FAILURE_STATUS='${failureStatus}'`,
          `ROLLBACK_STUB_CODE='${fixture.rollbackCode ?? ""}'`,
          `ENSURE_STUB_CODE='${fixture.ensureCode ?? "deploy_rollback_failed_fence_reacquire"}'`,
          "WEB_COMMITTED=0",
          "PROCESSES_STOPPED=1",
          "SWITCH_COMPLETED=1",
          "FORWARD_MUTATION_STARTED=1",
          "ROLLBACK_COMPLETED=0",
          "READINESS_FENCE_ACTIVE=1",
          "READINESS_FENCE_RELEASE_REQUESTED=0",
          "READINESS_FENCE_CLEANUP_VERIFIED=0",
          `PREVIOUS_AUTOMATION_WORKER_RUNNING='${fixture.previousWorkerRunning ?? 0}'`,
          "AUTOMATION_WORKER_NAME=worker",
          "AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS=205",
          "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
          "fails_at() { [[ \"+$FAIL_AT+\" == *\"+$1+\"* ]]; }",
          "ensure_readiness_fence_for_rollback() { record ensure; if fails_at ensure; then ROLLBACK_FAILURE_CODE=\"$ENSURE_STUB_CODE\"; return \"$FAILURE_STATUS\"; fi; return 0; }",
          "rollback_release() { record rollback; if fails_at rollback; then ROLLBACK_FAILURE_CODE=\"$ROLLBACK_STUB_CODE\"; return \"$FAILURE_STATUS\"; fi; ROLLBACK_COMPLETED=1; return 0; }",
          "release_readiness_fence() { record release; fails_at release && return \"$FAILURE_STATUS\"; READINESS_FENCE_ACTIVE=0; return 0; }",
          "discard_failed_readiness_fence() { record discard; fails_at discard && return \"$FAILURE_STATUS\"; READINESS_FENCE_ACTIVE=0; return 0; }",
          "start_frozen_previous_automation_worker_process() { record worker-start; fails_at worker-start && return \"$FAILURE_STATUS\"; return 0; }",
          "wait_for_automation_worker_online() { record worker-online; fails_at worker-online && return \"$FAILURE_STATUS\"; return 0; }",
          "timeout() { while [ \"$#\" -gt 0 ]; do case \"$1\" in --signal=*|--kill-after=*) shift ;; *s) shift; break ;; *) break ;; esac; done; \"$@\"; }",
          "pm2() { [ \"$1\" = save ] || return 99; record pm2-save; fails_at pm2-save && return \"$FAILURE_STATUS\"; return 0; }",
          "safe_remove_release_path() { record remove-release; fails_at release-cleanup && return \"$FAILURE_STATUS\"; return 0; }",
          "false",
          "cleanup_failed_build",
          "",
        ].join("\n");
        const result = spawnSync(resolveBashExecutable(), ["-s"], {
          encoding: "utf8",
          input: script,
          timeout: 10_000,
        });
        assert.equal(result.status, 1, `${fixture.name}/${failureStatus}\n${result.stderr}`);
        assert.equal(result.stderr, "", `${fixture.name}/${failureStatus}`);
        assert.deepEqual(
          result.stdout.trim().split("\n").filter(Boolean),
          fixture.codes.map((code) => `[deploy] ${code}`),
          `${fixture.name}/${failureStatus}`,
        );
        assert.deepEqual(
          (await readFile(callsPath, "utf8")).trim().split("\n"),
          fixture.calls,
          `${fixture.name}/${failureStatus}`,
        );
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rollback primitive failures have fixed substages and never replay prior mutations", async () => {
  const retryFunctions = extractShellRegion(
    "assert_readiness_fence_held_with_bounded_retry() {",
    "\nreadiness_fence_process_quiescence_checkpoint() {",
  );
  const rollbackFenceFunctions = extractShellRegion(
    "assert_readiness_fence_held_for_rollback() {",
    "\ncleanup_old_releases() {",
  );
  const rollbackFunction = extractShellRegion(
    "rollback_release() {",
    "\ncleanup_failed_build() {",
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-rollback-substage-codes-"),
  );
  const previousRuntime = join(temporaryDirectory, "previous");
  const currentLink = join(temporaryDirectory, "current");
  await mkdir(join(previousRuntime, ".next"), { recursive: true });
  const successCalls = [
    "fence:1",
    "stop-worker",
    "stop-web",
    "port",
    "fence:2",
    "compat",
    "fence:3",
    "switch",
    "fence:4",
    "start-web",
    "health",
    "fence:5",
  ];
  const fixtures = [
    { failAt: "fence:1", code: "deploy_rollback_failed_fence_checkpoint" },
    { failAt: "stop-worker", code: "deploy_rollback_failed_worker_quiesce" },
    { failAt: "stop-web", code: "deploy_rollback_failed_web_quiesce" },
    { failAt: "port", code: "deploy_rollback_failed_port_quiesce" },
    { failAt: "fence:2", code: "deploy_rollback_failed_fence_checkpoint" },
    { failAt: "compat", code: "deploy_rollback_failed_compatibility_restore" },
    { failAt: "fence:3", code: "deploy_rollback_failed_fence_checkpoint" },
    { failAt: "switch", code: "deploy_rollback_failed_current_restore" },
    { failAt: "fence:4", code: "deploy_rollback_failed_fence_checkpoint" },
    { failAt: "start-web", code: "deploy_rollback_failed_previous_web_start" },
    { failAt: "health", code: "deploy_rollback_failed_previous_web_health" },
    { failAt: "fence:5", code: "deploy_rollback_failed_fence_checkpoint" },
  ];

  const baseScript = (callsPath) => [
    "set +e",
    rollbackFunction,
    `PREVIOUS_RUNTIME_DIR='${toBashPath(previousRuntime)}'`,
    `PREVIOUS_LINK_TARGET='${toBashPath(previousRuntime)}'`,
    `CURRENT_LINK='${toBashPath(currentLink)}'`,
    `CALLS='${toBashPath(callsPath)}'`,
    `PREVIOUS_BUILD_ID='${"a".repeat(40)}'`,
    "SWITCH_COMPLETED=1",
    "PROCESSES_STOPPED=1",
    "WEB_COMMITTED=0",
    "ROLLBACK_COMPLETED=0",
    "ROLLBACK_FAILURE_CODE=",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
    "APP_NAME=web",
    "WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS=40",
    "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
    "FENCE_CALLS=0",
    "assert_readiness_fence_held_for_rollback() { FENCE_CALLS=$((FENCE_CALLS + 1)); record \"fence:$FENCE_CALLS\"; [ \"$FAIL_AT\" != \"fence:$FENCE_CALLS\" ] || return \"$FAILURE_STATUS\"; return 0; }",
    "stop_previous_automation_worker_bounded() { record stop-worker; [ \"$FAIL_AT\" != stop-worker ] || return \"$FAILURE_STATUS\"; return 0; }",
    "stop_pm2_process_bounded() { record stop-web; [ \"$FAIL_AT\" != stop-web ] || return \"$FAILURE_STATUS\"; return 0; }",
    "wait_for_port_release() { record port; [ \"$FAIL_AT\" != port ] || return \"$FAILURE_STATUS\"; return 0; }",
    "restore_legacy_runtime_compatibility_paths() { record compat; [ \"$FAIL_AT\" != compat ] || return \"$FAILURE_STATUS\"; return 0; }",
    "switch_current_release() { record switch; [ \"$FAIL_AT\" != switch ] || return \"$FAILURE_STATUS\"; return 0; }",
    "start_frozen_previous_release() { record start-web; [ \"$FAIL_AT\" != start-web ] || return \"$FAILURE_STATUS\"; return 0; }",
    "wait_for_release_health() { record health; [ \"$FAIL_AT\" != health ] || return \"$FAILURE_STATUS\"; return 0; }",
  ];

  try {
    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      for (const failureStatus of [1, 2, 17, 255]) {
        const callsPath = join(temporaryDirectory, `calls-${fixtureIndex}-${failureStatus}`);
        const result = spawnSync(resolveBashExecutable(), ["-s"], {
          encoding: "utf8",
          input: [
            ...baseScript(callsPath),
            `FAIL_AT='${fixture.failAt}'`,
            `FAILURE_STATUS='${failureStatus}'`,
            "if rollback_release >/dev/null; then status=0; else status=$?; fi",
            "printf '%s %s %s\\n' \"$status\" \"$ROLLBACK_COMPLETED\" \"$ROLLBACK_FAILURE_CODE\"",
            "",
          ].join("\n"),
          timeout: 10_000,
        });
        assert.equal(result.status, 0, `${fixture.failAt}/${failureStatus}\n${result.stderr}`);
        assert.equal(result.stderr, "", `${fixture.failAt}/${failureStatus}`);
        assert.equal(
          result.stdout,
          `1 0 ${fixture.code}\n`,
          `${fixture.failAt}/${failureStatus}`,
        );
        const failureIndex = successCalls.indexOf(fixture.failAt);
        assert.deepEqual(
          (await readFile(callsPath, "utf8")).trim().split("\n"),
          successCalls.slice(0, failureIndex + 1),
          `${fixture.failAt}/${failureStatus}`,
        );
      }
    }

    const missingEvidenceCalls = join(temporaryDirectory, "missing-evidence-calls");
    const missingEvidence = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        ...baseScript(missingEvidenceCalls),
        "PREVIOUS_RUNTIME_DIR=/definitely/missing",
        "FAIL_AT=none",
        "FAILURE_STATUS=255",
        "if rollback_release >/dev/null; then status=0; else status=$?; fi",
        "printf '%s %s %s\\n' \"$status\" \"$ROLLBACK_COMPLETED\" \"$ROLLBACK_FAILURE_CODE\"",
        "",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(missingEvidence.status, 0, missingEvidence.stderr);
    assert.equal(
      missingEvidence.stdout,
      "1 0 deploy_rollback_failed_evidence\n",
    );
    await assert.rejects(
      readFile(missingEvidenceCalls, "utf8"),
      (error) => error?.code === "ENOENT",
    );

    const retryCallsPath = join(temporaryDirectory, "retry-calls");
    const retriedProofs = spawnSync(resolveBashExecutable(), ["-s"], {
      encoding: "utf8",
      input: [
        "set +e",
        retryFunctions,
        rollbackFenceFunctions,
        rollbackFunction,
        `PREVIOUS_RUNTIME_DIR='${toBashPath(previousRuntime)}'`,
        `PREVIOUS_LINK_TARGET='${toBashPath(previousRuntime)}'`,
        `CURRENT_LINK='${toBashPath(currentLink)}'`,
        `CALLS='${toBashPath(retryCallsPath)}'`,
        `PREVIOUS_BUILD_ID='${"a".repeat(40)}'`,
        "SWITCH_COMPLETED=1",
        "PROCESSES_STOPPED=1",
        "WEB_COMMITTED=0",
        "ROLLBACK_COMPLETED=0",
        "ROLLBACK_FAILURE_CODE=",
        "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780",
        "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
        "APP_NAME=web",
        "WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS=40",
        "unset SECONDS; SECONDS=0",
        "STRICT_CALLS=0",
        "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
        "assert_readiness_fence_held() { STRICT_CALLS=$((STRICT_CALLS + 1)); if [ $((STRICT_CALLS % 2)) -eq 1 ]; then return 2; fi; return 0; }",
        "sleep() { SECONDS=$((SECONDS + 1)); }",
        "stop_previous_automation_worker_bounded() { record stop-worker; return 0; }",
        "stop_pm2_process_bounded() { record stop-web; return 0; }",
        "wait_for_port_release() { record port; return 0; }",
        "restore_legacy_runtime_compatibility_paths() { record compat; return 0; }",
        "switch_current_release() { record switch; return 0; }",
        "start_frozen_previous_release() { record start-web; return 0; }",
        "wait_for_release_health() { record health; return 0; }",
        "if rollback_release >/dev/null; then status=0; else status=$?; fi",
        "printf '%s %s %s %s\\n' \"$status\" \"$ROLLBACK_COMPLETED\" \"$STRICT_CALLS\" \"$ROLLBACK_FAILURE_CODE\"",
        "",
      ].join("\n"),
      timeout: 10_000,
    });
    assert.equal(retriedProofs.status, 0, retriedProofs.stderr);
    assert.equal(retriedProofs.stdout, "0 1 10 \n");
    assert.deepEqual(
      (await readFile(retryCallsPath, "utf8")).trim().split("\n"),
      successCalls.filter((call) => !call.startsWith("fence:")),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rollback link failure cannot start or certify the previous runtime under set +e", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-rollback-set-plus-e-contract-"),
  );
  const previousRuntime = join(temporaryDirectory, "previous");
  const callsPath = join(temporaryDirectory, "calls");
  await mkdir(join(previousRuntime, ".next"), { recursive: true });
  const rollbackFunction = extractShellRegion(
    "rollback_release() {",
    "\ncleanup_failed_build() {",
  );
  const script = [
    "set +e",
    `PREVIOUS_RUNTIME_DIR='${toBashPath(previousRuntime)}'`,
    `PREVIOUS_LINK_TARGET='${toBashPath(previousRuntime)}'`,
    `CALLS='${toBashPath(callsPath)}'`,
    `PREVIOUS_BUILD_ID='${"a".repeat(40)}'`,
    "SWITCH_COMPLETED=1",
    "PROCESSES_STOPPED=1",
    "WEB_COMMITTED=0",
    "ROLLBACK_COMPLETED=0",
    "READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=480",
    "READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15",
    "AUTOMATION_WORKER_NAME=worker",
    "AUTOMATION_WORKER_STOP_TOTAL_TIMEOUT_SECONDS=205",
    "APP_NAME=web",
    "WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS=40",
    "assert_readiness_fence_held() { return 0; }",
    "stop_pm2_process_bounded() { return 0; }",
    "wait_for_port_release() { return 0; }",
    "restore_legacy_runtime_compatibility_paths() { return 0; }",
    'switch_current_release() { printf "switch\\n" >> "$CALLS"; return 42; }',
    'start_frozen_previous_release() { printf "start\\n" >> "$CALLS"; return 0; }',
    "wait_for_release_health() { return 0; }",
    rollbackFunction,
    "if rollback_release; then status=0; else status=$?; fi",
    '[ "$status" -ne 0 ]',
    '[ "$ROLLBACK_COMPLETED" = 0 ]',
    'grep -Fxq switch "$CALLS"',
    '! grep -Fxq start "$CALLS"',
    "",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-c", script], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("pre-forward recovery releases provisionally and restores only the frozen previous runtime", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-pre-forward-recovery-contract-"),
  );
  const previousRuntime = join(temporaryDirectory, "previous");
  const currentLink = join(temporaryDirectory, "current");
  await mkdir(join(previousRuntime, ".next"), { recursive: true });
  await symlink(previousRuntime, currentLink, process.platform === "win32" ? "junction" : "dir");
  const recoveryFunction = extractShellRegion(
    "recover_pre_forward_previous_runtime() {",
    "\nrollback_release() {",
  );
  const fixtures = [
    {
      name: "running worker is restored",
      expectedStatus: 0,
      expectedCalls: [
        "verify", "stop:web", "port", "stop:worker", "verify", "release:1", "verify",
        "start-web", "health",
        "start-worker", "worker-online", "verify", "save", "verify",
      ],
      expectedFlags: "0 1",
    },
    {
      name: "inactive or absent worker stays offline",
      previousWorkerRunning: 0,
      expectedStatus: 0,
      expectedCalls: [
        "verify", "stop:web", "port", "stop:worker", "verify", "release:1", "verify",
        "start-web", "health", "verify", "save", "verify",
      ],
      expectedFlags: "0 1",
    },
    {
      name: "failed graceful release falls back to verified discard",
      failAt: "release",
      expectedStatus: 0,
      expectedCalls: [
        "verify", "stop:web", "port", "stop:worker", "verify", "release:1", "discard", "verify",
        "start-web", "health",
        "start-worker", "worker-online", "verify", "save", "verify",
      ],
      expectedFlags: "0 1",
    },
    {
      name: "worker stop failure cannot certify recovery",
      failAt: "stop-worker",
      expectedStatus: 1,
      expectedCalls: ["verify", "stop:web", "port", "stop:worker"],
      expectedFlags: "1 0",
    },
    {
      name: "release-time identity drift cannot restart the previous runtime",
      failAt: "post-release-identity",
      expectedStatus: 1,
      expectedCalls: [
        "verify", "stop:web", "port", "stop:worker", "verify", "release:1", "verify",
      ],
      expectedFlags: "1 0",
    },
    {
      name: "web start failure cannot certify recovery",
      failAt: "start-web",
      expectedStatus: 1,
      expectedCalls: [
        "verify", "stop:web", "port", "stop:worker", "verify", "release:1", "verify", "start-web",
      ],
      expectedFlags: "1 0",
    },
    {
      name: "forward mutation forbids shortcut recovery",
      forwardMutation: 1,
      expectedStatus: 1,
      expectedCalls: [],
      expectedFlags: "1 0",
    },
  ];

  try {
    for (const [index, fixture] of fixtures.entries()) {
      const callsPath = join(temporaryDirectory, `recovery-calls-${index}`);
      const script = [
        "set +e",
        recoveryFunction,
        `PREVIOUS_RUNTIME_DIR='${toBashPath(previousRuntime)}'`,
        `CURRENT_LINK='${toBashPath(currentLink)}'`,
        `CALLS='${toBashPath(callsPath)}'`,
        `PREVIOUS_BUILD_ID='${"a".repeat(40)}'`,
        "PREVIOUS_RUNTIME_IDENTITY=\"$(stat -Lc '%d:%i:%Z' -- \"$PREVIOUS_RUNTIME_DIR\")\"",
        `PREVIOUS_AUTOMATION_WORKER_RUNNING='${fixture.previousWorkerRunning ?? 1}'`,
        `FORWARD_MUTATION_STARTED='${fixture.forwardMutation ?? 0}'`,
        "SWITCH_COMPLETED=0",
        "WEB_COMMITTED=0",
        "LEGACY_COMPATIBILITY_LINKS_INSTALLED=0",
        "PROCESSES_STOPPED=1",
        "ROLLBACK_COMPLETED=0",
        "READINESS_FENCE_ACTIVE=1",
        "READINESS_FENCE_RELEASE_REQUESTED=0",
        "READINESS_FENCE_CLEANUP_VERIFIED=0",
        "PRE_FORWARD_RECOVERY_WEB_START_ATTEMPTED=0",
        "PRE_FORWARD_RECOVERY_WORKER_START_ATTEMPTED=0",
        "PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED=0",
        "APP_NAME=web",
        "AUTOMATION_WORKER_NAME=worker",
        "WEB_PROCESS_STOP_TOTAL_TIMEOUT_SECONDS=40",
        `FAIL_AT='${fixture.failAt ?? "none"}'`,
        "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
        "RECOVERY_VERIFY_COUNT=0",
        "previous_runtime_recovery_identity_matches() { RECOVERY_VERIFY_COUNT=$((RECOVERY_VERIFY_COUNT + 1)); record verify; [ \"$FAIL_AT\" != post-release-identity ] || [ \"$RECOVERY_VERIFY_COUNT\" -lt 3 ]; }",
        "release_readiness_fence() { record \"release:$1\"; [ \"$FAIL_AT\" != release ] || return 1; READINESS_FENCE_ACTIVE=0; READINESS_FENCE_CLEANUP_VERIFIED=1; return 0; }",
        "discard_failed_readiness_fence() { record discard; [ \"$FAIL_AT\" != discard ] || return 1; READINESS_FENCE_ACTIVE=0; READINESS_FENCE_CLEANUP_VERIFIED=1; return 0; }",
        "assert_readiness_fence_held() { record strict; return 0; }",
        "stop_pm2_process_bounded() { record stop:web; [ \"$FAIL_AT\" != stop-web ]; }",
        "wait_for_port_release() { record port; [ \"$FAIL_AT\" != port ]; }",
        "stop_previous_automation_worker_bounded() { record stop:worker; [ \"$FAIL_AT\" != stop-worker ]; }",
        "start_frozen_previous_release() { record start-web; [ \"$FAIL_AT\" != start-web ]; }",
        "capture_pre_forward_recovery_process_identity() {",
        "  local prefix=\"$1\"",
        "  printf -v \"${prefix}_PID\" %s 101",
        "  printf -v \"${prefix}_START_TICKS\" %s 202",
        "  printf -v \"${prefix}_PROCESS_IDENTITY\" %s 1:2",
        "  printf -v \"${prefix}_CWD_IDENTITY\" %s 1:2:3",
        "}",
        "pre_forward_recovery_process_identity_matches() { return 0; }",
        "wait_for_release_health() { record health; [ \"$FAIL_AT\" != health ]; }",
        "start_frozen_previous_automation_worker_process() { record start-worker; [ \"$FAIL_AT\" != start-worker ]; }",
        "wait_for_automation_worker_online() { record worker-online; [ \"$FAIL_AT\" != worker-online ]; }",
        "timeout() {",
        "  while [ \"$#\" -gt 0 ]; do",
        "    case \"$1\" in --signal=*|--kill-after=*) shift ;; *s) shift; break ;; *) break ;; esac",
        "  done",
        "  \"$@\"",
        "}",
        "pm2() { [ \"$1\" = save ] || return 1; record save; [ \"$FAIL_AT\" != save ]; }",
        "recover_pre_forward_previous_runtime; status=$?",
        "printf '%s %s %s\\n' \"$status\" \"$PROCESSES_STOPPED\" \"$ROLLBACK_COMPLETED\"",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, `${fixture.name}\n${result.stdout}\n${result.stderr}`);
      const output = result.stdout.trim().split("\n").at(-1);
      let calls = "";
      try { calls = await readFile(callsPath, "utf8"); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      assert.equal(
        output,
        `${fixture.expectedStatus} ${fixture.expectedFlags}`,
        `${fixture.name}\n${calls}`,
      );
      assert.deepEqual(calls.trim() ? calls.trim().split("\n") : [], fixture.expectedCalls, fixture.name);
      assert.doesNotMatch(calls, /^strict$/m, fixture.name);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("partial pre-forward PM2 recovery is identity-cleaned and persistence-compensated", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-pre-forward-pm2-compensation-"),
  );
  const previousRuntime = join(temporaryDirectory, "previous");
  await mkdir(join(previousRuntime, ".next"), { recursive: true });
  const recoveryFunctions = extractShellRegion(
    "capture_pre_forward_recovery_process_identity() {",
    "\nrollback_release() {",
  );
  assert.match(
    recoveryFunctions,
    /PRE_FORWARD_RECOVERY_WEB_START_ATTEMPTED=1[\s\S]*?start_frozen_previous_release/,
  );
  assert.match(
    recoveryFunctions,
    /PRE_FORWARD_RECOVERY_WORKER_START_ATTEMPTED=1[\s\S]*?start_frozen_previous_automation_worker_process/,
  );
  assert.match(
    recoveryFunctions,
    /start_frozen_previous_release[\s\S]*?capture_pre_forward_recovery_process_identity[\s\S]*?PRE_FORWARD_RECOVERY_WEB/,
  );
  assert.match(
    recoveryFunctions,
    /PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED=1\n  timeout[\s\S]*?pm2 save/,
  );
  const cleanupFunction = extractShellRegion(
    "cleanup_pre_forward_previous_runtime_attempts() {",
    "\nrecover_pre_forward_previous_runtime() {",
  );
  const workerCleanupIndex = cleanupFunction.indexOf(
    'cleanup_pre_forward_recovery_started_process "$AUTOMATION_WORKER_NAME"',
  );
  const webCleanupIndex = cleanupFunction.indexOf(
    'cleanup_pre_forward_recovery_started_process "$APP_NAME"',
  );
  const compensatingSaveIndex = cleanupFunction.indexOf(
    'if [ "$PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED" = "1" ]',
  );
  assert.ok(workerCleanupIndex >= 0);
  assert.ok(webCleanupIndex > workerCleanupIndex);
  assert.ok(compensatingSaveIndex > webCleanupIndex);
  assert.match(
    cleanupFunction,
    /PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED" = "1" \][\s\S]*?"\$cleanup_status" -eq 0[\s\S]*?pm2 save/,
  );
  const fixtures = [
    {
      name: "web start returns nonzero after creating the exact process",
      failAt: "start-web-created",
      expected: "1 0 absent absent 0 1 0 0",
      calls: ["start:web", "capture:web", "delete:web", "port-free"],
    },
    {
      name: "web health fails after an exact start",
      failAt: "health",
      expected: "1 0 absent absent 0 1 0 0",
      calls: ["start:web", "capture:web", "health", "delete:web", "port-free"],
    },
    {
      name: "worker start returns nonzero after creating the exact process",
      failAt: "start-worker-created",
      expected: "1 0 absent absent 0 1 1 0",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "delete:worker", "delete:web", "port-free",
      ],
    },
    {
      name: "worker online proof fails after an exact start",
      failAt: "worker-online",
      expected: "1 0 absent absent 0 1 1 0",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "worker-online", "delete:worker", "delete:web", "port-free",
      ],
    },
    {
      name: "normal save failure is compensated after exact cleanup",
      failAt: "save",
      expected: "1 0 absent absent 2 1 1 1",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "worker-online", "save:1", "delete:worker", "delete:web", "port-free", "save:2",
      ],
    },
    {
      name: "post-save identity failure is cleaned then persisted again",
      failAt: "post-save-identity",
      expected: "1 0 absent absent 2 1 1 1",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "worker-online", "save:1", "delete:worker", "delete:web", "port-free", "save:2",
      ],
    },
    {
      name: "compensating save failure remains unverified",
      failAt: "compensation-save",
      expected: "1 1 absent absent 2 1 1 1",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "worker-online", "save:1", "delete:worker", "delete:web", "port-free", "save:2",
      ],
    },
    {
      name: "identity drift is never deleted",
      failAt: "start-web-created+cleanup-identity-drift",
      expected: "1 1 running:101 absent 0 1 0 0",
      calls: ["start:web", "capture:web"],
    },
    {
      name: "an unproven port suppresses compensating persistence",
      failAt: "cleanup-port-unverified",
      expected: "1 1 absent absent 1 1 1 1",
      calls: [
        "start:web", "capture:web", "health", "start:worker", "capture:worker",
        "worker-online", "save:1", "delete:worker", "delete:web", "port-free",
      ],
    },
  ];

  try {
    for (const [index, fixture] of fixtures.entries()) {
      const callsPath = join(temporaryDirectory, `calls-${index}`);
      const script = [
        "set +e",
        recoveryFunctions,
        `CALLS='${toBashPath(callsPath)}'`,
        `PREVIOUS_RUNTIME_DIR='${toBashPath(previousRuntime)}'`,
        `PREVIOUS_BUILD_ID='${"a".repeat(40)}'`,
        "PREVIOUS_RUNTIME_IDENTITY=1:2:3",
        "PREVIOUS_AUTOMATION_WORKER_RUNNING=1",
        "FORWARD_MUTATION_STARTED=0",
        "SWITCH_COMPLETED=0",
        "WEB_COMMITTED=0",
        "LEGACY_COMPATIBILITY_LINKS_INSTALLED=0",
        "PROCESSES_STOPPED=1",
        "ROLLBACK_COMPLETED=0",
        "READINESS_FENCE_ACTIVE=1",
        "READINESS_FENCE_RELEASE_REQUESTED=0",
        "READINESS_FENCE_CLEANUP_VERIFIED=0",
        "PRE_FORWARD_RECOVERY_WEB_START_ATTEMPTED=0",
        "PRE_FORWARD_RECOVERY_WORKER_START_ATTEMPTED=0",
        "PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED=0",
        "PRE_FORWARD_RECOVERY_WEB_PID=",
        "PRE_FORWARD_RECOVERY_WEB_START_TICKS=",
        "PRE_FORWARD_RECOVERY_WEB_PROCESS_IDENTITY=",
        "PRE_FORWARD_RECOVERY_WEB_CWD_IDENTITY=",
        "PRE_FORWARD_RECOVERY_WORKER_PID=",
        "PRE_FORWARD_RECOVERY_WORKER_START_TICKS=",
        "PRE_FORWARD_RECOVERY_WORKER_PROCESS_IDENTITY=",
        "PRE_FORWARD_RECOVERY_WORKER_CWD_IDENTITY=",
        "APP_NAME=web",
        "AUTOMATION_WORKER_NAME=worker",
        "WEB_STATE=absent",
        "WORKER_STATE=absent",
        "SAVE_COUNT=0",
        "CLEANUP_PHASE=0",
        `FAIL_AT='${fixture.failAt}'`,
        "record() { printf '%s\\n' \"$1\" >> \"$CALLS\"; }",
        "previous_runtime_recovery_identity_matches() { return 0; }",
        "stop_pm2_process_bounded() { return 0; }",
        "wait_for_port_release() {",
        "  if [ \"$CLEANUP_PHASE\" = 1 ]; then record port-free; [ \"$FAIL_AT\" != cleanup-port-unverified ]; else return 0; fi",
        "}",
        "stop_previous_automation_worker_bounded() { return 0; }",
        "release_readiness_fence() { READINESS_FENCE_ACTIVE=0; READINESS_FENCE_CLEANUP_VERIFIED=1; return 0; }",
        "discard_failed_readiness_fence() { READINESS_FENCE_ACTIVE=0; READINESS_FENCE_CLEANUP_VERIFIED=1; return 0; }",
        "start_frozen_previous_release() { WEB_STATE=running:101; record start:web; [[ \"$FAIL_AT\" != *start-web-created* ]]; }",
        "wait_for_release_health() { record health; [ \"$FAIL_AT\" != health ]; }",
        "start_frozen_previous_automation_worker_process() { WORKER_STATE=running:202; record start:worker; [ \"$FAIL_AT\" != start-worker-created ]; }",
        "wait_for_automation_worker_online() { record worker-online; [ \"$FAIL_AT\" != worker-online ]; }",
        "pm2_process_snapshot() { case \"$1\" in web) printf '%s\\n' \"$WEB_STATE\" ;; worker) printf '%s\\n' \"$WORKER_STATE\" ;; *) return 1 ;; esac; }",
        "capture_pre_forward_recovery_process_identity() {",
        "  local prefix=\"$1\" process_name=\"$2\" pid",
        "  case \"$process_name\" in web) pid=101 ;; worker) pid=202 ;; *) return 1 ;; esac",
        "  [ \"$(pm2_process_snapshot \"$process_name\")\" = \"running:$pid\" ] || return 1",
        "  record \"capture:$process_name\"",
        "  printf -v \"${prefix}_PID\" %s \"$pid\"",
        "  printf -v \"${prefix}_START_TICKS\" %s \"$((pid + 1000))\"",
        "  printf -v \"${prefix}_PROCESS_IDENTITY\" %s \"1:$pid\"",
        "  printf -v \"${prefix}_CWD_IDENTITY\" %s \"1:2:$pid\"",
        "}",
        "pre_forward_recovery_process_identity_matches() {",
        "  local process_name=\"$1\" process_pid=\"$2\" expected_pid",
        "  case \"$process_name\" in web) expected_pid=101 ;; worker) expected_pid=202 ;; *) return 1 ;; esac",
        "  if [ \"$CLEANUP_PHASE\" = 1 ] && [[ \"$FAIL_AT\" = *cleanup-identity-drift* ]] && [ \"$process_name\" = web ]; then return 1; fi",
        "  if [ \"$CLEANUP_PHASE\" = 0 ] && [ \"$FAIL_AT\" = post-save-identity ] && [ \"$SAVE_COUNT\" -ge 1 ] && [ \"$process_name\" = web ]; then return 1; fi",
        "  [ \"$process_pid\" = \"$expected_pid\" ] && [ \"$(pm2_process_snapshot \"$process_name\")\" = \"running:$expected_pid\" ]",
        "}",
        "pre_forward_recovery_original_process_is_gone() { return 0; }",
        "timeout() {",
        "  while [ \"$#\" -gt 0 ]; do",
        "    case \"$1\" in --signal=*|--kill-after=*) shift ;; *s) shift; break ;; *) break ;; esac",
        "  done",
        "  \"$@\"",
        "}",
        "pm2() {",
        "  case \"$1\" in",
        "    delete)",
        "      record \"delete:$2\"",
        "      case \"$2\" in web) WEB_STATE=absent ;; worker) WORKER_STATE=absent ;; *) return 1 ;; esac",
        "      ;;",
        "    save)",
        "      SAVE_COUNT=$((SAVE_COUNT + 1)); record \"save:$SAVE_COUNT\"",
        "      if [ \"$FAIL_AT\" = save ] && [ \"$SAVE_COUNT\" -eq 1 ]; then return 1; fi",
        "      if [ \"$FAIL_AT\" = compensation-save ]; then return 1; fi",
        "      if [ \"$FAIL_AT\" = cleanup-port-unverified ] && [ \"$SAVE_COUNT\" -eq 1 ]; then return 1; fi",
        "      ;;",
        "    *) return 1 ;;",
        "  esac",
        "}",
        "if recover_pre_forward_previous_runtime; then recovery_status=0; cleanup_status=0; else",
        "  recovery_status=$?; CLEANUP_PHASE=1",
        "  if cleanup_pre_forward_previous_runtime_attempts; then cleanup_status=0; else cleanup_status=$?; fi",
        "fi",
        "printf '%s %s %s %s %s %s %s %s\\n' \"$recovery_status\" \"$cleanup_status\" \"$WEB_STATE\" \"$WORKER_STATE\" \"$SAVE_COUNT\" \"$PRE_FORWARD_RECOVERY_WEB_START_ATTEMPTED\" \"$PRE_FORWARD_RECOVERY_WORKER_START_ATTEMPTED\" \"$PRE_FORWARD_RECOVERY_PM2_SAVE_ATTEMPTED\"",
      ].join("\n");
      const result = spawnSync(resolveBashExecutable(), ["-s"], {
        encoding: "utf8",
        input: script,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, `${fixture.name}\n${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout.trim().split("\n").at(-1), fixture.expected, fixture.name);
      assert.equal(result.stderr, "", fixture.name);
      assert.deepEqual(
        (await readFile(callsPath, "utf8")).trim().split("\n"),
        fixture.calls,
        fixture.name,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("PID reuse never signals an unrelated process while database cleanup still runs", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-fence-pid-reuse-contract-"),
  );
  const callsPath = join(temporaryDirectory, "calls");
  const fenceCleanupFunctions = extractShellRegion(
    "quiesce_failed_readiness_fence() {",
    "\nensure_readiness_fence_for_rollback() {",
  );
  const script = [
    "set -euo pipefail",
    `CALLS='${toBashPath(callsPath)}'`,
    "READINESS_FENCE_PID=4242",
    "READINESS_FENCE_ACTIVE=1",
    "readiness_fence_original_process_matches() { return 1; }",
    'terminate_readiness_fence_database_session() { printf "database-zero\\n" >> "$CALLS"; return 0; }',
    'cleanup_readiness_fence_files() { printf "cleanup-files\\n" >> "$CALLS"; return 0; }',
    'kill() { printf "signal:%s\\n" "$*" >> "$CALLS"; return 0; }',
    'wait() { printf "wait:%s\\n" "$*" >> "$CALLS"; return 0; }',
    fenceCleanupFunctions,
    "if discard_failed_readiness_fence; then status=0; else status=$?; fi",
    '[ "$status" -eq 0 ]',
    '[ "$READINESS_FENCE_ACTIVE" = 0 ]',
    '[ "$(grep -Fxc database-zero "$CALLS")" -eq 1 ]',
    '[ "$(grep -Fxc cleanup-files "$CALLS")" -eq 1 ]',
    '[ "$(grep -Fxc wait:4242 "$CALLS")" -eq 1 ]',
    '! grep -q "^signal:" "$CALLS"',
    "",
  ].join("\n");
  try {
    const result = spawnSync(resolveBashExecutable(), ["-c", script], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("stale incomplete releases are removed only when unused", () => {
  assert.match(deployScript, /cleanup_stale_build_dirs/);
  assert.match(deployScript, /-name '\.\*\.building'/);
  assert.match(deployScript, /release_path_in_use "\$release_dir"/);
  assert.match(
    deployScript,
    /warning: stale build is still in use and was not removed/,
  );
});

test("production journal retention preserves diagnostic history within bounds", () => {
  assert.match(retentionScript, /JOURNAL_SYSTEM_MAX_USE="\$\{[^}]+:-256M\}"/);
  assert.match(retentionScript, /JOURNAL_SYSTEM_KEEP_FREE="\$\{[^}]+:-8G\}"/);
  assert.match(retentionScript, /JOURNAL_MAX_RETENTION="\$\{[^}]+:-14day\}"/);
  assert.match(retentionScript, /--vacuum-size="\$JOURNAL_SYSTEM_MAX_USE"/);
  assert.match(retentionScript, /--vacuum-time="\$JOURNAL_MAX_RETENTION"/);
});

test("enterprise automation worker is fail-closed and receives the production gate", () => {
  assert.match(
    envExample,
    /MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED=false/,
  );
  assert.match(
    deployWorkflow,
    /MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:\s*\$\{\{ vars\.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED \}\}/,
  );
  assert.match(
    deployScript,
    /MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED="\$\{MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:-false\}"/,
  );
  assert.match(
    deployScript,
    /write_env_value "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" "\$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED"/,
  );
  assert.match(
    deployScript,
    /if \[ "\$MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED" = "true" \][\s\S]{0,120}\|\| \[ "\$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" = "true" \]; then[\s\S]+start_automation_worker_process "\$RELEASE_DIR"/,
  );
});

test("durable invitation settings deploy fail-closed without erasing existing secrets", () => {
  for (const entry of [
    "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE=legacy",
    "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED=false",
    "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON=",
    "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID=",
    "MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN=",
    "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM=",
    "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO=",
    "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS=3600",
    "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS=3900",
    "RESEND_API_KEY=",
  ]) {
    assert.match(envExample, new RegExp(`^${entry}$`, "m"));
  }
  assert.match(
    deployWorkflow,
    /MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE:\s*\$\{\{ vars\.MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE \}\}/,
  );
  assert.match(
    deployWorkflow,
    /MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:\s*\$\{\{ vars\.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED \}\}/,
  );
  for (const secret of [
    "MERCHANT_ENTERPRISE_INVITATION_HMAC_KEYRING_JSON",
    "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID",
    "MERCHANT_ENTERPRISE_INVITATION_EMAIL_FROM",
    "MERCHANT_ENTERPRISE_INVITATION_EMAIL_REPLY_TO",
    "RESEND_API_KEY",
  ]) {
    assert.match(
      deployWorkflow,
      new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.${secret} \\}\\}`),
    );
    assert.match(deployWorkflow, new RegExp(`${secret}_B64=`));
    assert.match(deployWorkflow, new RegExp(`"${secret}_B64"`));
    assert.doesNotMatch(
      deployWorkflow,
      new RegExp(`${secret}_B64='\\$${secret}_B64'`),
    );
    assert.match(
      deployScript,
      new RegExp(`write_env_value "${secret}" "\\$\\(decode_base64_value`),
    );
  }
  assert.match(
    deployWorkflow,
    /MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN:\s*\$\{\{ vars\.MERCHANT_ENTERPRISE_INVITATION_PUBLIC_ORIGIN \}\}/,
  );
  for (const setting of [
    "MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS",
    "MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS",
  ]) {
    assert.match(
      deployWorkflow,
      new RegExp(`${setting}:\\s*\\$\\{\\{ vars\\.${setting} \\}\\}`),
    );
    assert.match(
      deployScript,
      new RegExp(`write_env_value "${setting}" "\\$${setting}"`),
    );
  }
  assert.match(
    deployScript,
    /MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE="\$\{MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE:-legacy\}"/,
  );
  assert.match(
    deployScript,
    /MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="\$\{MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:-false\}"/,
  );
  assert.match(deployScript, /case "\$MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" in\s*legacy\|outbox\)/);
  assert.match(deployScript, /case "\$MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" in\s*true\|false\)/);
  assert.match(
    deployScript,
    /MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE" = "outbox"[\s\S]+MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED" != "true"[\s\S]+outbox invitation delivery requires the invitation worker/,
    "outbox mode must never enqueue invitations without a live delivery worker",
  );
  assert.match(
    deployScript,
    /MERCHANT_ENTERPRISE_INVITATION_ISSUANCE_LEASE_SECONDS" -lt \$\(\(MERCHANT_ENTERPRISE_INVITATION_AUTH_LINK_TTL_SECONDS \+ 300\)\)/,
  );
  assert.match(
    deployScript,
    /if \[ -z "\$key" \] \|\| \[ -z "\$value" \]; then\s*return 0/,
    "an omitted GitHub secret must preserve the value already stored on the server",
  );
  assert.match(
    deployScript,
    /read_runtime_invitation_worker_enabled[\s\S]+MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED="\$invitation_worker_enabled"[\s\S]+pm2 start/,
    "the shared supervisor must start when invitation delivery is explicitly enabled",
  );
});

test("enterprise automation worker stays online before migration and never claims before readiness", () => {
  const mainIndex = automationWorker.indexOf("async function main()");
  const onlineIndex = automationWorker.indexOf('process.send("ready")');
  const beforeOnline = automationWorker.slice(mainIndex, onlineIndex);
  const readinessIndex = automationWorker.indexOf(
    "waitForMerchantEnterpriseAutomationWorkerReady(",
    onlineIndex,
  );
  const processingIndex = automationWorker.indexOf(
    "runMerchantEnterpriseAutomationWorker({",
    readinessIndex,
  );
  assert.ok(mainIndex >= 0);
  assert.ok(onlineIndex >= 0);
  assert.doesNotMatch(
    beforeOnline,
    /assertMerchantEnterpriseAutomationWorkerReady|waitForMerchantEnterpriseAutomationWorkerReady/,
  );
  assert.ok(onlineIndex < readinessIndex);
  assert.ok(readinessIndex < processingIndex);
  assert.match(
    automationWorker,
    /while \(!signal\.aborted\)[\s\S]+assertReady\(runtime\)[\s\S]+resolveAutomationWorkerFailureBackoffMs/,
  );
});

test("enterprise automation worker deployment is graceful and rollback-safe", () => {
  assert.match(deployScript, /--kill-timeout "\$AUTOMATION_WORKER_KILL_TIMEOUT_MS"/);
  assert.match(deployScript, /--wait-ready/);
  assert.match(deployScript, /wait_for_automation_worker_online/);
  assert.match(
    deployScript,
    /rollback_release\(\)[\s\S]+stop_previous_automation_worker_bounded[\s\S]+ROLLBACK_COMPLETED=1[\s\S]+PREVIOUS_AUTOMATION_WORKER_RUNNING[\s\S]+start_frozen_previous_automation_worker_process/,
  );
  const workerStartIndex = deployScript.indexOf(
    'start_automation_worker_process "$RELEASE_DIR"',
  );
  const saveIndex = deployScript.lastIndexOf("pm2 save");
  assert.ok(workerStartIndex >= 0);
  assert.ok(workerStartIndex < saveIndex);
});
