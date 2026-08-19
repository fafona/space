import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    assert.match(deployWorkflow, new RegExp(`${secret}_B64='\\$${secret}_B64'`));
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
