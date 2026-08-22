import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = new URL(
  "./recover-failed-pre-forward-production-runtime.sh",
  import.meta.url,
);
const source = readFileSync(scriptPath, "utf8");
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const relativeScriptPath = "scripts/recover-failed-pre-forward-production-runtime.sh";

function occurrences(needle) {
  return source.split(needle).length - 1;
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("recovery is immutable to the one failed pre-forward incident", () => {
  assert.match(
    source,
    /EXPECTED_INCIDENT_DEPLOY_RUN_ID="32574586077"/,
  );
  assert.match(
    source,
    /EXPECTED_INCIDENT_SHA="4381e6b555262d7fba696825c125c7793d6515f5"/,
  );
  assert.match(
    source,
    /EXPECTED_INCIDENT_READINESS_RUN_ID="32574534420"/,
  );
  assert.match(source, /EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT="1"/);
  assert.match(
    source,
    /EXPECTED_OLD_BUILD_ID="2a121454a18a16ae30e356977ca82b24a310e8e5"/,
  );
  assert.match(
    source,
    /EXPECTED_CONFIRMATION="RECOVER_FAILED_PRE_FORWARD_DEPLOY_32574586077"/,
  );
  assert.match(source, /git -C "\$APP_DIR" rev-parse HEAD/);
  assert.match(source, /"\$EXPECTED_INCIDENT_SHA:\$helper_path"/);
  assert.match(source, /git -C "\$APP_DIR" hash-object/);
  assert.match(source, /git -C "\$APP_DIR" diff --quiet/);
  assert.match(source, /git -C "\$APP_DIR" diff --cached --quiet/);
});

test("payload is canonical, owner-only, exact-keyed, and database-bound", () => {
  for (const key of [
    "APP_DIR",
    "APP_NAME",
    "APP_PORT",
    "CONFIRMATION",
    "DATABASE_CONTAINER_ID",
    "DATABASE_CONTAINER_NAME",
    "DATABASE_NAME",
    "DATABASE_OID",
    "DATABASE_PRIMARY",
    "DATABASE_SYSTEM_ID",
    "FAILED_RUN_COMPLETED_EPOCH",
    "FAILED_RUN_STARTED_EPOCH",
    "INCIDENT_DEPLOY_RUN_ID",
    "INCIDENT_SHA",
    "READINESS_RUN_ATTEMPT",
    "READINESS_RUN_ID",
  ]) {
    assert.match(source, new RegExp(`"${key}"`));
  }
  assert.match(source, /before\.uid !== BigInt\(process\.getuid\(\)\)/);
  assert.match(source, /\(before\.mode & 0o777n\) !== 0o600n/);
  assert.match(source, /before\.nlink !== 1n/);
  assert.match(source, /constants\.O_NOFOLLOW/);
  assert.match(source, /current\.ino !== opened\.ino/);
  assert.match(source, /const canonical = Buffer\.from/);
  assert.match(source, /if \(!bytes\.equals\(canonical\)\) fail\(\)/);
  assert.match(source, /\[ "\$loaded_count" -eq 16 \]/);
  assert.match(source, /\[\[ "\$DATABASE_OID" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/);
  assert.match(source, /\[ "\$DATABASE_PRIMARY" = "true" \]/);
  assert.match(source, /18_446_744_073_709_551_615n/);
  assert.match(source, /FAILED_RUN_COMPLETED_EPOCH \+ 1390/);
});

test("current release, environment, helper blobs, and deploy lock remain frozen", () => {
  assert.match(source, /\[ -L "\$CURRENT_LINK" \]/);
  assert.match(source, /\^2a121454a18a-\[0-9\]\{14\}\$/);
  assert.match(source, /rollback-snapshot/);
  assert.match(
    source,
    /capture_trusted_environment_helper_output current_snapshot 5 snapshot \\\n+    "\$PREVIOUS_RUNTIME_DIR\/\.env\.local"/,
  );
  assert.match(source, /ENVIRONMENT_DIRECTORY_IDENTITY/);
  assert.match(source, /ENVIRONMENT_FILE_IDENTITY/);
  assert.match(source, /ENVIRONMENT_SHA256/);
  assert.match(source, /createHash\("sha256"\)\.update\(bytes\)/);
  assert.match(source, /identity\(after\) !== expectedIdentity/);
  assert.match(source, /identity\(current\) !== expectedIdentity/);
  assert.match(source, /revalidate_frozen_runtime/);
  assert.ok(occurrences("revalidate_frozen_runtime || exit 1") >= 7);
  assert.match(source, /DEPLOY_LOCK_IDENTITY/);
  assert.match(source, /\/proc\/\$\$\/fd\/9/);
  assert.match(source, /revalidate_deploy_lock/);
  const lockValidated = source.indexOf("DEPLOY_LOCK_IDENTITY=");
  const environmentHelperFrozen = source.indexOf(
    'ENV_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot',
  );
  const fenceHelperFrozen = source.indexOf(
    'FENCE_HELPER_FROZEN_SNAPSHOT="$(trusted_helper_snapshot',
  );
  assert.ok(lockValidated >= 0);
  assert.ok(environmentHelperFrozen > lockValidated);
  assert.ok(fenceHelperFrozen > environmentHelperFrozen);
  assert.match(source, /trusted_helper_snapshot\(\)/);
  assert.match(source, /trusted_helper_matches\(\)/);
  assert.match(source, /constants\.O_RDONLY \| constants\.O_NOFOLLOW/);
  assert.match(source, /before\.isSymbolicLink\(\) \|\| !before\.isFile\(\)/);
  assert.match(source, /before\.uid !== BigInt\(process\.getuid\(\)\)/);
  assert.match(source, /\(before\.mode & 0o022n\) !== 0n/);
  assert.match(source, /!sameIdentity\(opened, current\)/);
  assert.match(source, /actualBlob !== expectedBlob/);
  assert.match(source, /git -C "\$APP_DIR" diff --quiet -- "\$helper_relative"/);
  assert.match(source, /git -C "\$APP_DIR" diff --cached --quiet -- "\$helper_relative"/);
  assert.match(
    source,
    /readonly ENV_HELPER_FROZEN_SNAPSHOT FENCE_HELPER_FROZEN_SNAPSHOT/,
  );
  assert.equal(occurrences("capture_trusted_environment_helper_output "), 3);
  const environmentWrapper = sourceBetween(
    "capture_trusted_environment_helper_output() {",
    "\n\nRELEASES_REAL=",
  );
  const environmentPrecheck = environmentWrapper.indexOf("trusted_helper_matches");
  const environmentInvocation = environmentWrapper.indexOf('node "$ENV_HELPER"');
  const environmentPostcheck = environmentWrapper.indexOf(
    "trusted_helper_matches",
    environmentPrecheck + 1,
  );
  assert.ok(environmentPrecheck >= 0);
  assert.ok(environmentInvocation > environmentPrecheck);
  assert.ok(environmentPostcheck > environmentInvocation);
  assert.match(source, /unset ROLLBACK_SNAPSHOT ROLLBACK_PARTS/);
  assert.match(source, /PREVIOUS_RUNTIME_DIR\/\.runtime/);
  assert.match(source, /\[ ! -L "\$PREVIOUS_RUNTIME_DIR\/\.next" \]/);
  assert.match(source, /8#\$protected_mode & 8#022/);
});

test("environment helper replacement or failure is rejected after invocation", () => {
  const wrapper = sourceBetween(
    "capture_trusted_environment_helper_output() {",
    "\n\nRELEASES_REAL=",
  );
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe"]
    : ["bash"];
  const shell = candidates.find(existsSync) ?? candidates[0];
  const script = [
    "set +e",
    'temporary_directory="$(mktemp -d)"',
    'case "$temporary_directory" in /tmp/*) ;; *) exit 1 ;; esac',
    'cleanup_test_directory() { rm -f -- "$ENV_HELPER" "$events"; rmdir -- "$temporary_directory"; }',
    "trap cleanup_test_directory EXIT",
    'ENV_HELPER="$temporary_directory/helper.mjs"',
    'ENV_HELPER_RELATIVE="scripts/helper.mjs"',
    'ENV_HELPER_FROZEN_SNAPSHOT="frozen"',
    'events="$temporary_directory/events"',
    'printf %s trusted > "$ENV_HELPER"',
    wrapper,
    "trusted_helper_matches() {",
    '  printf \'%s\\n\' verify >> "$events"',
    '  [ "$(<"$ENV_HELPER")" = trusted ]',
    "}",
    "timeout() {",
    '  printf %s replaced > "$ENV_HELPER"',
    '  printf %s captured',
    "  return 0",
    "}",
    "captured_output=unchanged",
    "capture_trusted_environment_helper_output captured_output 5 snapshot value",
    "replacement_status=$?",
    '[ "$replacement_status" -ne 0 ]',
    '[ "$captured_output" = unchanged ]',
    '[ "$(wc -l < "$events" | tr -d \'[:space:]\')" = 2 ]',
    'printf %s trusted > "$ENV_HELPER"',
    ': > "$events"',
    "timeout() { return 42; }",
    "captured_output=unchanged",
    "capture_trusted_environment_helper_output captured_output 5 snapshot value",
    "failure_status=$?",
    '[ "$failure_status" -ne 0 ]',
    '[ "$captured_output" = unchanged ]',
    '[ "$(wc -l < "$events" | tr -d \'[:space:]\')" = 2 ]',
    "",
  ].join("\n");
  const result = spawnSync(shell, ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("fence cleanup is observational, unambiguous, canonical, and non-recursive", () => {
  assert.equal(occurrences("verify_database_fence_clear || exit 1"), 3);
  assert.match(source, /FAOLLA_EXPECTED_DATABASE_OID/);
  assert.match(source, /FAOLLA_EXPECTED_DATABASE_NAME/);
  assert.match(source, /FAOLLA_EXPECTED_DATABASE_SYSTEM_ID/);
  assert.match(source, /pg_catalog\.pg_control_system/);
  assert.match(source, /pg_catalog\.pg_is_in_recovery/);
  assert.match(source, /\.Id}}\|\{\{\.Name}}\|\{\{\.State\.Running/);
  assert.match(
    source,
    /docker exec --interactive \\\n+      --env[\s\S]+?"\$DATABASE_CONTAINER_ID" sh -c/,
  );
  assert.match(source, /\^faolla_readiness_fence_/);
  assert.match(source, /pg_catalog\.pg_blocking_pids/);
  assert.doesNotMatch(source, /pg_(?:terminate|cancel)_backend/);
  assert.doesNotMatch(source, /\bkill\s+-/);
  assert.doesNotMatch(source, /rm\s+-rf/);
  assert.match(source, /\[ "\$\{#fence_entries\[@\]\}" -le 1 \]/);
  assert.match(source, /\.readiness-fence\\\.\[A-Za-z0-9\]\{6\}/);
  assert.match(source, /\[ "\$\{#stale_children\[@\]\}" -eq 1 \]/);
  assert.match(source, /\[ "\$stale_log" = "\$stale_dir\/helper\.log" \]/);
  assert.match(source, /stale_log_mode" = "600"/);
  assert.match(source, /stale_dir_mode" = "700"/);
  assert.match(source, /FAILED_RUN_COMPLETED_EPOCH \+ 1500/);
  assert.match(
    source,
    /readOrdinaryAccountCutoverReadinessFenceFailureRecord\(logPath\)/,
  );
  const fenceImport = source.indexOf(
    "readOrdinaryAccountCutoverReadinessFenceFailureRecord(logPath)",
  );
  const fencePrecheck = source.lastIndexOf("trusted_helper_matches", fenceImport);
  const fencePostcheck = source.indexOf("trusted_helper_matches", fenceImport);
  assert.ok(fencePrecheck >= 0);
  assert.ok(fenceImport > fencePrecheck);
  assert.ok(fencePostcheck > fenceImport);
  assert.match(
    source.slice(fencePrecheck, fencePostcheck + 300),
    /"\$FENCE_HELPER" "\$FENCE_HELPER_RELATIVE" "\$FENCE_HELPER_FROZEN_SNAPSHOT"/,
  );
  assert.match(source, /unlink -- "\$stale_log"/);
  assert.match(source, /rmdir -- "\$stale_dir"/);
  assert.match(source, /__faolla_fence_inventory_complete__/);
  assert.match(source, /__faolla_stale_inventory_complete__/);
  assert.match(source, /__faolla_post_cleanup_inventory_complete__/);
  assert.match(source, /FENCE_CLEANUP_STARTED=0/);
  assert.match(source, /FENCE_CLEANUP_VERIFIED=0/);
  const cleanupStarted = source.indexOf("FENCE_CLEANUP_STARTED=1");
  const firstInventory = source.indexOf("mapfile -d '' -t fence_entries", cleanupStarted);
  const postInventoryProof = source.indexOf(
    '[ "${#post_cleanup_fence_entries[@]}" -eq 0 ] || exit 1',
    firstInventory,
  );
  const postCleanupDatabaseProof = source.indexOf(
    "verify_database_fence_clear || exit 1",
    postInventoryProof,
  );
  const cleanupVerified = source.indexOf(
    "FENCE_CLEANUP_VERIFIED=1",
    postCleanupDatabaseProof,
  );
  assert.ok(cleanupStarted >= 0);
  assert.ok(firstInventory > cleanupStarted);
  assert.ok(postInventoryProof > firstInventory);
  assert.ok(postCleanupDatabaseProof > postInventoryProof);
  assert.ok(cleanupVerified > postCleanupDatabaseProof);
  assert.match(
    source,
    /if \[ "\$FENCE_CLEANUP_STARTED" -eq 1 \] \\\n+      && \[ "\$FENCE_CLEANUP_VERIFIED" -ne 1 \]; then\n      cleanup_status=1/,
  );
});

test("runtime mutation requires inactive web, a free port, and identity-bound rollback", () => {
  assert.match(source, /remove_inactive_process "\$APP_NAME"/);
  assert.match(source, /case "\$worker_state" in absent\|inactive/);
  assert.match(source, /ss -H -ltn/);
  assert.match(source, /\[ -z "\$port_state" \]/);
  assert.match(source, /capture_started_process_identity STARTED_WEB/);
  assert.match(source, /capture_started_process_identity STARTED_WORKER/);
  assert.match(source, /linux_process_start_ticks/);
  assert.match(source, /STARTED_WEB_PROCESS_IDENTITY/);
  assert.match(source, /STARTED_WEB_CWD_IDENTITY/);
  assert.match(source, /started_process_identity_matches/);
  assert.match(source, /process-snapshot/);
  assert.match(source, /"\$\{parts\[1\]\}" = "\$expected_start_ticks"/);
  assert.match(source, /verify_worker_flags/);
  assert.match(source, /MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED/);
  assert.match(source, /MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED/);
  assert.match(source, /stable_health_checks/);
  assert.match(source, /\[ "\$stable_health_checks" -ge 3 \]/);
  assert.match(source, /stable_worker_checks/);
  assert.match(source, /pm2 save/);
  assert.match(source, /\[ -d "\$PREVIOUS_RUNTIME_DIR\/node_modules" \]/);
  assert.match(source, /cleanup_started_process/);
  assert.match(source, /WEB_START_ATTEMPTED=1/);
  assert.match(source, /WORKER_START_ATTEMPTED=1/);
  assert.match(source, /PM2_SAVE_ATTEMPTED=1/);
  assert.match(source, /cleanup_unverified/);
  assert.match(source, /port_is_free/);
  assert.match(source, /wait_for_port_free_bounded/);
  assert.equal(occurrences("verify_stable_local_old_build || exit 1"), 2);
  assert.match(source, /verify_worker_command_line/);
  assert.match(source, /"\$STARTED_WEB_START_TICKS"/);
  assert.match(source, /"\$STARTED_WORKER_START_TICKS"/);
  const exitHandler = source.slice(
    source.indexOf("finish_recovery()"),
    source.indexOf("trap finish_recovery EXIT"),
  );
  assert.match(
    exitHandler,
    /if \[ "\$PM2_SAVE_ATTEMPTED" -eq 1 \] && \[ "\$cleanup_status" -eq 0 \]; then\n      timeout[\s\S]*?pm2 save/,
  );
  assert.doesNotMatch(
    exitHandler,
    /if \[ "\$PM2_SAVE_ATTEMPTED" -eq 1 \]; then[\s\S]*?pm2 save/,
  );
});

test("operator-visible output is a fixed allowlist", () => {
  assert.doesNotMatch(source, /\becho\b/);
  const literalMarkers = [...source.matchAll(/printf '%s\\n' '([^']+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(literalMarkers, [
    "recovery_failed",
    "cleanup_unverified",
    "fence_cleanup_verified",
    "frozen_runtime_restored",
    "worker_state_restored",
    "recovery_complete",
  ]);
  assert.doesNotMatch(source, /<<<[^\n]*<<|<<[^\n]*<</);
});

test("shell parses and an unconfigured invocation fails with only the safe marker", () => {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe"]
    : ["bash"];
  const shell = candidates.find(existsSync) ?? candidates[0];
  const syntax = spawnSync(shell, ["-n", relativeScriptPath], {
    encoding: "utf8",
    cwd: repositoryDirectory,
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const invoked = spawnSync(shell, [relativeScriptPath], {
    encoding: "utf8",
    cwd: repositoryDirectory,
    env: { ...process.env, FAOLLA_RECOVERY_PAYLOAD_FILE: "" },
  });
  assert.notEqual(invoked.status, 0);
  assert.equal(invoked.stdout, "");
  assert.equal(invoked.stderr, "recovery_failed\n");
});
