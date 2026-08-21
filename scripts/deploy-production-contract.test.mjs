import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
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

async function runDeployTransportScenario({
  statuses,
  expectedStatus,
  expectedSshCalls = 1,
  evidenceEnvironment = {},
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
  const fakeSsh = String.raw`
ssh() {
  fake_index="$(wc -l < "$FAKE_SSH_CALLS")"
  fake_index=$((fake_index + 1))
  printf '%s\n' "$fake_index" >> "$FAKE_SSH_CALLS"
  printf '%s\0' "$@" > "$FAKE_SSH_CAPTURE_DIR/argv-$fake_index"
  env > "$FAKE_SSH_CAPTURE_DIR/env-$fake_index"
  cat > "$FAKE_SSH_CAPTURE_DIR/stdin-$fake_index"
  IFS=',' read -r -a fake_statuses <<< "$FAKE_SSH_STATUSES"
  fake_status_index=$((fake_index - 1))
  if [ "$fake_status_index" -ge "${"$"}{#fake_statuses[@]}" ]; then
    fake_status_index=$((${"$"}{#fake_statuses[@]} - 1))
  fi
  fake_status="${"$"}{fake_statuses[$fake_status_index]}"
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
      FAKE_REMOTE_COMPLETION_MARKER: toBashPath(
        join(captureDirectory, "remote-completed-before-status-loss"),
      ),
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
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
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
  assert.match(
    deployScript,
    /flock -w "\$DEPLOY_LOCK_WAIT_SECONDS" 9/,
  );

  const lockIndex = deployScript.indexOf("acquire_deploy_lock\n");
  const cacheIndex = deployScript.indexOf("cleanup_rebuildable_caches\n");
  const fetchIndex = deployScript.indexOf("\nfetch_deploy_branch\n");
  assert.ok(lockIndex >= 0);
  assert.ok(lockIndex < cacheIndex);
  assert.ok(lockIndex < fetchIndex);
});

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
  const fenceIndex = deployScript.lastIndexOf("start_readiness_fence || exit 1");
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
  assert.match(deployWorkflow, /--minimum-remaining-seconds 6000/);
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
    "start_readiness_fence || exit 1",
    "PROCESSES_STOPPED=1",
    'switch_current_release "$RELEASE_DIR" || exit 1',
    'wait_for_release_health "$FAOLLA_WEB_BUILD_ID"',
    "verify_booking_persistence || BOOKING_PERSISTENCE_STATUS=$?",
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
  assert.match(sequence, /BOOKING_PERSISTENCE_STATUS" -ne 0[\s\S]+exit 1/);
  assert.match(sequence, /assert_readiness_fence_forward_checkpoint \|\| exit 1/g);
  assert.match(deployScript, /blocked_cancelled[\s\S]+deployment will fail closed/);
  assert.match(deployScript, /pg_catalog\.pg_cancel_backend\(blocked_waiters\.pid\)/);
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
    /ensure_readiness_fence_for_rollback[\s\S]+rollback_release[\s\S]+release_readiness_fence[\s\S]+start_automation_worker_process "\$PREVIOUS_RUNTIME_DIR"/,
  );
  assert.match(
    deployScript,
    /rollback restored the previous web process, but fence release failed[\s\S]+discard_failed_readiness_fence/,
  );
  assert.match(deployScript, /readiness_fence_original_process_matches[\s\S]+kill -TERM/);
  assert.match(deployScript, /terminate_readiness_fence_database_session \|\| cleanup_status=1/);
  assert.match(deployScript, /remaining\.remainingCount !== "0"/);
  assert.match(deployScript, /READINESS_FENCE_MINIMUM_TTL_SECONDS="\$\{[^}]+:-1440\}"/);
  assert.match(deployScript, /RELEASE_ATTESTATION_PREFLIGHT_MINIMUM_SECONDS="\$\{[^}]+:-5700\}"/);
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
  assert.match(
    deployScript,
    /reject_failed_readiness_fence\(\)[\s\S]+report_readiness_fence_failure[\s\S]+discard_failed_readiness_fence/,
  );
  assert.match(
    deployScript,
    /readiness fence cleanup completed[\s\S]+readiness fence cleanup could not be proven/,
  );
  assert.doesNotMatch(deployScript, /cat\s+[^\n]*READINESS_FENCE_LOG|tail\s+[^\n]*READINESS_FENCE_LOG/);
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
    childExitCode: "3",
    childResult: "exit",
    childSignal: null,
    error: "readiness_fence_child_failed",
    ok: false,
    sqlstate: "P0001",
    sqlstateStatus: "exact",
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

    for (const [discardStatus, expectedMarker] of [
      [0, "readiness fence cleanup completed"],
      [1, "readiness_fence_cleanup_unverified"],
    ]) {
      const cleanupScript = [
        "set +e",
        functions,
        "readiness_fence_safe_failure_record() { return 1; }",
        `discard_failed_readiness_fence() { return ${discardStatus}; }`,
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
    'start_release() { printf "start\\n" >> "$CALLS"; return 0; }',
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

test("PID reuse never signals an unrelated process while database cleanup still runs", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "faolla-fence-pid-reuse-contract-"),
  );
  const callsPath = join(temporaryDirectory, "calls");
  const discardFunction = extractShellRegion(
    "discard_failed_readiness_fence() {",
    "\nensure_readiness_fence_for_rollback() {",
  );
  const script = [
    "set +e",
    `CALLS='${toBashPath(callsPath)}'`,
    "READINESS_FENCE_PID=4242",
    "READINESS_FENCE_ACTIVE=1",
    "readiness_fence_original_process_matches() { return 1; }",
    'terminate_readiness_fence_database_session() { printf "database-zero\\n" >> "$CALLS"; return 0; }',
    "cleanup_readiness_fence_files() { return 0; }",
    'kill() { printf "signal:%s\\n" "$*" >> "$CALLS"; return 0; }',
    discardFunction,
    "discard_failed_readiness_fence",
    '[ "$READINESS_FENCE_ACTIVE" = 0 ]',
    'grep -Fxq database-zero "$CALLS"',
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
    /rollback_release\(\)[\s\S]+stop_pm2_process_bounded "\$AUTOMATION_WORKER_NAME"[\s\S]+ROLLBACK_COMPLETED=1[\s\S]+PREVIOUS_AUTOMATION_WORKER_RUNNING[\s\S]+start_automation_worker_process "\$PREVIOUS_RUNTIME_DIR"/,
  );
  const workerStartIndex = deployScript.indexOf(
    'start_automation_worker_process "$RELEASE_DIR"',
  );
  const saveIndex = deployScript.lastIndexOf("pm2 save");
  assert.ok(workerStartIndex >= 0);
  assert.ok(workerStartIndex < saveIndex);
});
