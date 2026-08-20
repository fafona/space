import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

async function runDeployTransportScenario({ statuses, expectedStatus }) {
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
  const script = `set -uo pipefail\n${fakeSsh}\n: > "$FAKE_SSH_CALLS"\n${transport}\n`;
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
      APP_DIR: "contract-app-dir",
      APP_NAME: "merchant-space",
      APP_PORT: "3000",
      APP_BRANCH: "main",
      EXPECTED_DEPLOY_SHA: "a".repeat(40),
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
    },
  });

  try {
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const calls = (await readFile(callsPath, "utf8")).trim().split(/\r?\n/);
    const expectedCalls = 1;
    assert.equal(calls.length, expectedCalls);
    if (statuses[0] === 255) {
      assert.equal(
        await pathExists(
          join(captureDirectory, "remote-completed-before-status-loss"),
        ),
        true,
      );
    }
    for (let index = 1; index <= expectedCalls; index += 1) {
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
      assert.match(remoteCommand, /set -eu; umask 077;/);
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
    /DEPLOY_PAYLOAD_B64="\$\(node <<'NODE'/,
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
    JSON.stringify({ schemaVersion: 1, values }),
    "utf8",
  );
  await writeFile(
    bashEnvironmentPath,
    "pm2() { :; }\nflock() { :; }\n",
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
    JSON.stringify({ schemaVersion: 1, values }),
    "utf8",
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

test("production deployment accepts only the exact tested current main commit", () => {
  assert.doesNotMatch(deployWorkflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(deployWorkflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(
    deployWorkflow,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(deployWorkflow, /github\.event\.workflow_run\.head_branch == 'main'/);
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
  assert.match(deployWorkflow, /timeout-minutes:\s*70/);
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
    /rollback_release\(\)[\s\S]+pm2 delete "\$AUTOMATION_WORKER_NAME"[\s\S]+PREVIOUS_AUTOMATION_WORKER_RUNNING[\s\S]+start_automation_worker_process "\$PREVIOUS_RUNTIME_DIR"/,
  );
  const workerStartIndex = deployScript.indexOf(
    'start_automation_worker_process "$RELEASE_DIR"',
  );
  const saveIndex = deployScript.lastIndexOf("pm2 save");
  assert.ok(workerStartIndex >= 0);
  assert.ok(workerStartIndex < saveIndex);
});
