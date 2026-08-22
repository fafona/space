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
const deploySource = readFileSync(
  new URL("./deploy.production.sh", import.meta.url),
  "utf8",
);
const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
const relativeScriptPath = "scripts/recover-failed-pre-forward-production-runtime.sh";

function occurrences(needle) {
  return source.split(needle).length - 1;
}

function sourceBetweenIn(input, startMarker, endMarker) {
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return input.slice(start, end);
}

function sourceBetween(startMarker, endMarker) {
  return sourceBetweenIn(source, startMarker, endMarker);
}

function resolveBashExecutable() {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe"]
    : ["bash"];
  return candidates.find(existsSync) ?? candidates[0];
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

test("recovery is immutable to the one failed pre-forward incident", () => {
  assert.match(
    source,
    /EXPECTED_INCIDENT_DEPLOY_RUN_ID="32597015446"/,
  );
  assert.match(
    source,
    /EXPECTED_INCIDENT_SHA="a628380757ccb5989702e42cb2868b2a48333be4"/,
  );
  assert.match(
    source,
    /EXPECTED_INCIDENT_READINESS_RUN_ID="32596977165"/,
  );
  assert.match(source, /EXPECTED_INCIDENT_READINESS_RUN_ATTEMPT="1"/);
  assert.match(
    source,
    /EXPECTED_OLD_BUILD_ID="2a121454a18a16ae30e356977ca82b24a310e8e5"/,
  );
  assert.match(
    source,
    /EXPECTED_CONFIRMATION="RECOVER_FAILED_PRE_FORWARD_DEPLOY_32597015446"/,
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
  const lockNormalization = sourceBetween(
    "normalize_deploy_lock_permissions() {",
    '\n\nRECOVERY_FAILURE_STAGE="deploy_lock"',
  );
  const deployLockNormalization = sourceBetweenIn(
    deploySource,
    "normalize_deploy_lock_permissions() {",
    "\n\nacquire_deploy_lock() {",
  );
  assert.equal(lockNormalization, deployLockNormalization);
  assert.match(lockNormalization, /\[ -f "\$DEPLOY_LOCK_FILE" \]/);
  assert.match(lockNormalization, /\[ ! -L "\$DEPLOY_LOCK_FILE" \]/);
  assert.match(lockNormalization, /\[ -f "\/proc\/\$\$\/fd\/9" \]/);
  assert.match(lockNormalization, /%d:%i:%h:%u:%f:%a/);
  assert.match(lockNormalization, /deploy_lock_links" = "1"/);
  assert.match(lockNormalization, /deploy_lock_uid" = "\$\(id -u\)"/);
  assert.match(
    lockNormalization,
    /600\|644\) ;;[\s\S]+if \[ "\$deploy_lock_mode" = "644" \]; then\n    chmod 600 -- "\/proc\/\$\$\/fd\/9"/,
  );
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
  const lockAcquisition = sourceBetween(
    'RECOVERY_FAILURE_STAGE="deploy_lock"',
    "\n\nrevalidate_deploy_lock()",
  );
  assert.match(lockAcquisition, /exec 9<>"\$DEPLOY_LOCK_FILE"/);
  assert.doesNotMatch(lockAcquisition, /exec 9>(?!<)/);
  assert.match(lockAcquisition, /flock -w 1 9/);
  assert.match(lockAcquisition, /normalize_deploy_lock_permissions \|\| exit 1/);
  assert.ok(
    lockAcquisition.indexOf("flock -w 1 9") <
      lockAcquisition.indexOf("normalize_deploy_lock_permissions || exit 1"),
  );
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
  assert.match(source, /verify_worker_launch_contract/);
  assert.doesNotMatch(source, /verify_worker_command_line/);
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

test("worker restore failures are assigned to the exact operation substage", () => {
  const frozenMarker = "printf '%s\\n' 'frozen_runtime_restored'";
  const workerMarker = "printf '%s\\n' 'worker_state_restored'";
  const frozenMarkerIndex = source.indexOf(frozenMarker);
  const workerMarkerIndex = source.indexOf(workerMarker, frozenMarkerIndex + 1);
  assert.ok(frozenMarkerIndex >= 0);
  assert.ok(workerMarkerIndex > frozenMarkerIndex);
  const workerRestore = source.slice(frozenMarkerIndex, workerMarkerIndex);
  const enabledStart = workerRestore.indexOf(
    'if [ "$AUTOMATION_WORKER_ENABLED" = "true" ]',
  );
  const disabledStart = workerRestore.indexOf("\nelse\n", enabledStart);
  assert.ok(enabledStart >= 0);
  assert.ok(disabledStart > enabledStart);
  const enabledRestore = workerRestore.slice(0, disabledStart);
  const disabledRestore = workerRestore.slice(disabledStart);

  const effectiveStageAt = (region, operationIndex) => {
    const assignmentStart = region.lastIndexOf(
      'RECOVERY_FAILURE_STAGE="',
      operationIndex,
    );
    assert.ok(assignmentStart >= 0, "operation is missing a failure stage");
    const valueStart = assignmentStart + 'RECOVERY_FAILURE_STAGE="'.length;
    const valueEnd = region.indexOf('"', valueStart);
    assert.ok(valueEnd > valueStart, "failure stage assignment is malformed");
    return region.slice(valueStart, valueEnd);
  };
  const assertEveryOperationUsesStage = (region, operation, expectedStage) => {
    let found = 0;
    let operationIndex = region.indexOf(operation);
    while (operationIndex >= 0) {
      found += 1;
      assert.equal(
        effectiveStageAt(region, operationIndex),
        expectedStage,
        `${operation} must run under ${expectedStage}`,
      );
      operationIndex = region.indexOf(operation, operationIndex + operation.length);
    }
    assert.ok(found > 0, `missing worker restore operation: ${operation}`);
  };

  assertEveryOperationUsesStage(
    enabledRestore,
    'remove_inactive_process "$AUTOMATION_WORKER_NAME"',
    "worker_preflight",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    "WORKER_START_ATTEMPTED=1",
    "worker_start",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'pm2 start "$tsx_entry"',
    "worker_start",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'worker_state="$(pm2_process_snapshot "$AUTOMATION_WORKER_NAME")"',
    "worker_stability",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    "capture_started_process_identity STARTED_WORKER",
    "worker_identity",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'started_process_identity_matches "$AUTOMATION_WORKER_NAME"',
    "worker_identity",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'verify_process_environment "$worker_pid"',
    "worker_environment",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'verify_worker_flags "$worker_pid"',
    "worker_flags",
  );
  assertEveryOperationUsesStage(
    enabledRestore,
    'verify_worker_launch_contract "$worker_pid"',
    "worker_launch_contract",
  );
  assertEveryOperationUsesStage(
    disabledRestore,
    'remove_inactive_process "$AUTOMATION_WORKER_NAME"',
    "worker_disabled_absence",
  );
  assertEveryOperationUsesStage(
    disabledRestore,
    'pm2_process_snapshot "$AUTOMATION_WORKER_NAME"',
    "worker_disabled_absence",
  );

  const firstStagePositions = [
    "worker_preflight",
    "worker_start",
    "worker_stability",
    "worker_identity",
    "worker_environment",
    "worker_flags",
    "worker_launch_contract",
    "worker_disabled_absence",
  ].map((stage) => {
    const position = workerRestore.indexOf(`RECOVERY_FAILURE_STAGE="${stage}"`);
    assert.ok(position >= 0, `missing worker restore stage: ${stage}`);
    return position;
  });
  for (let index = 1; index < firstStagePositions.length; index += 1) {
    assert.ok(
      firstStagePositions[index] > firstStagePositions[index - 1],
      "worker restore substages must first appear in control-flow order",
    );
  }

  assert.doesNotMatch(workerRestore, /printf '%s\\n' 'worker_state_restored'/);
  const recoveryCompleteIndex = source.indexOf(
    "printf '%s\\n' 'recovery_complete'",
    workerMarkerIndex + workerMarker.length,
  );
  assert.ok(recoveryCompleteIndex > workerMarkerIndex);
  const markerPositions = [
    "fence_cleanup_verified",
    "frozen_runtime_restored",
    "worker_state_restored",
    "recovery_complete",
  ].map((marker) => source.indexOf(`printf '%s\\n' '${marker}'`));
  assert.ok(markerPositions.every((position) => position >= 0));
  assert.deepEqual([...markerPositions].sort((left, right) => left - right), markerPositions);
});

test("worker launch contract replaces proc cmdline checks with strict PM2 metadata", () => {
  assert.doesNotMatch(source, /\/proc\/[^"]*\/cmdline/);
  const launchContract = sourceBetween(
    "verify_worker_launch_contract() {",
    '\n}\n\nverify_process_environment "$web_pid"',
  );
  assert.match(launchContract, /pm2 jlist/);
  for (const field of [
    "name",
    "pid",
    "pm_id",
    "status",
    "pm_exec_path",
    "pm_cwd",
    "exec_interpreter",
    "exec_mode",
    "args",
    "node_args",
  ]) {
    assert.match(launchContract, new RegExp(`\\b${field}\\b`));
  }
  assert.equal(
    launchContract.split("started_process_identity_matches").length - 1,
    2,
    "PM2 metadata must be identity-bound before and after parsing",
  );
  assert.match(launchContract, /matches\.length !== 1/);
  assert.doesNotMatch(launchContract, /process\.stdout\.write/);
  assert.doesNotMatch(launchContract, /console\.(?:log|error)/);
});

test("worker launch contract accepts only the exact identity-bound PM2 fixture", () => {
  const launchContract = `${sourceBetween(
    "verify_worker_launch_contract() {",
    '\n}\n\nverify_process_environment "$web_pid"',
  )}\n}`;
  const workerName = "merchant-enterprise-automation-worker";
  const runtimeDirectory = "/srv/faolla/releases/incident-runtime";
  const workerPid = 731;
  const canonicalWorker = {
    name: workerName,
    pid: workerPid,
    pm_id: 7,
    pm2_env: {
      name: workerName,
      pm_id: 7,
      status: "online",
      pm_exec_path: `${runtimeDirectory}/node_modules/tsx/dist/cli.mjs`,
      pm_cwd: runtimeDirectory,
      exec_interpreter: "node",
      exec_mode: "fork_mode",
      args: [
        `${runtimeDirectory}/scripts/run-merchant-enterprise-automation-worker.ts`,
      ],
      node_args: [],
    },
  };
  const unrelatedWeb = {
    name: "faolla-web",
    pid: 419,
    pm_id: 2,
    pm2_env: { name: "faolla-web", pm_id: 2, status: "online" },
  };
  const parserStartMarker = "node -e '\n";
  const parserEndMarker = "\n    ' >/dev/null";
  const parserStart = launchContract.indexOf(parserStartMarker);
  const parserEnd = launchContract.indexOf(
    parserEndMarker,
    parserStart + parserStartMarker.length,
  );
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = launchContract.slice(
    parserStart + parserStartMarker.length,
    parserEnd,
  );
  const parserEnvironment = {
    ...process.env,
    FAOLLA_EXPECTED_WORKER_NAME: workerName,
    FAOLLA_EXPECTED_WORKER_PID: String(workerPid),
    FAOLLA_EXPECTED_TSX: canonicalWorker.pm2_env.pm_exec_path,
    FAOLLA_EXPECTED_WORKER: canonicalWorker.pm2_env.args[0],
    FAOLLA_EXPECTED_CWD: runtimeDirectory,
  };
  const parsed = spawnSync(process.execPath, ["-e", parser], {
    encoding: "utf8",
    env: parserEnvironment,
    input: JSON.stringify([unrelatedWeb, canonicalWorker]),
  });
  assert.equal(parsed.status, 0, `${parsed.stdout}\n${parsed.stderr}`);
  assert.equal(parsed.stdout, "");
  assert.equal(parsed.stderr, "");
  const runFixture = (
    fixture,
    { identityFailureAt = 0, pm2Status = 0 } = {},
  ) => spawnSync(resolveBashExecutable(), ["-s"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CONTRACT_IDENTITY_FAILURE_AT: String(identityFailureAt),
      CONTRACT_PM2_FIXTURE: typeof fixture === "string"
        ? fixture
        : JSON.stringify(fixture),
      CONTRACT_PM2_STATUS: String(pm2Status),
      MSYS2_ENV_CONV_EXCL: "*",
      MSYS_NO_PATHCONV: "1",
    },
    input: [
      "set -Eeuo pipefail",
      launchContract,
      `PREVIOUS_RUNTIME_DIR=${shellSingleQuote(runtimeDirectory)}`,
      `AUTOMATION_WORKER_NAME=${shellSingleQuote(workerName)}`,
      `STARTED_WORKER_PID=${shellSingleQuote(workerPid)}`,
      'STARTED_WORKER_START_TICKS="987654"',
      'STARTED_WORKER_PROCESS_IDENTITY="8:15"',
      'STARTED_WORKER_CWD_IDENTITY="8:21:1700000000"',
      "identity_calls=0",
      "started_process_identity_matches() {",
      "  identity_calls=$((identity_calls + 1))",
      '  [ "$CONTRACT_IDENTITY_FAILURE_AT" != "$identity_calls" ]',
      "}",
      "pm2() {",
      '  [ "${1:-}" = "jlist" ] || return 97',
      '  [ "$CONTRACT_PM2_STATUS" = "0" ] || return "$CONTRACT_PM2_STATUS"',
      "  printf '%s' \"$CONTRACT_PM2_FIXTURE\"",
      "}",
      "timeout() {",
      '  while [ "$#" -gt 0 ]; do',
      '    case "$1" in',
      "      --signal=*|--kill-after=*) shift ;;",
      "      --signal|--kill-after) shift 2 ;;",
      "      [0-9]*s) shift; break ;;",
      "      *) break ;;",
      "    esac",
      "  done",
      '  if [ "${1:-}" = "node" ]; then',
      '    printf \'%s\' "$CONTRACT_PM2_FIXTURE" | env \\',
      '      FAOLLA_EXPECTED_WORKER_NAME="$FAOLLA_EXPECTED_WORKER_NAME" \\',
      '      FAOLLA_EXPECTED_WORKER_PID="$FAOLLA_EXPECTED_WORKER_PID" \\',
      '      FAOLLA_EXPECTED_TSX="$FAOLLA_EXPECTED_TSX" \\',
      '      FAOLLA_EXPECTED_WORKER="$FAOLLA_EXPECTED_WORKER" \\',
      '      FAOLLA_EXPECTED_CWD="$FAOLLA_EXPECTED_CWD" "$@"',
      "  else",
      '    "$@"',
      "  fi",
      "}",
      'verify_worker_launch_contract "$STARTED_WORKER_PID"',
      '[ "$identity_calls" -eq 2 ]',
      "",
    ].join("\n"),
  });

  const accepted = runFixture([unrelatedWeb, canonicalWorker]);
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.equal(accepted.stdout, "");
  assert.equal(accepted.stderr, "");

  const rejectedFixtures = [
    ["invalid JSON", "not-json"],
    ["non-array JSON", { worker: canonicalWorker }],
    ["missing worker", [unrelatedWeb]],
    ["duplicate worker", [canonicalWorker, structuredClone(canonicalWorker)]],
    ["wrong top-level name", [{ ...canonicalWorker, name: "renamed-worker" }]],
    ["wrong pid", [{ ...canonicalWorker, pid: workerPid + 1 }]],
    ["invalid pm id", [{ ...canonicalWorker, pm_id: -1, pm2_env: { ...canonicalWorker.pm2_env, pm_id: -1 } }]],
    ["pm id mismatch", [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, pm_id: 8 } }]],
    [
      "wrong status",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, status: "stopped" } }],
    ],
    [
      "wrong executable",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, pm_exec_path: "/tmp/tsx" } }],
    ],
    [
      "wrong cwd",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, pm_cwd: "/tmp" } }],
    ],
    [
      "wrong interpreter",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, exec_interpreter: "bash" } }],
    ],
    [
      "wrong execution mode",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, exec_mode: "cluster_mode" } }],
    ],
    [
      "missing worker argument",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, args: [] } }],
    ],
    [
      "extra worker argument",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, args: [...canonicalWorker.pm2_env.args, "--extra"] } }],
    ],
    [
      "unexpected node argument",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, node_args: ["--inspect"] } }],
    ],
    [
      "node arguments are not an array",
      [{ ...canonicalWorker, pm2_env: { ...canonicalWorker.pm2_env, node_args: "" } }],
    ],
  ];
  for (const [label, fixture] of rejectedFixtures) {
    const rejected = runFixture(fixture);
    assert.notEqual(rejected.status, 0, label);
    assert.equal(rejected.stdout, "", `${label} leaked stdout`);
    assert.equal(rejected.stderr, "", `${label} leaked stderr`);
  }

  for (const identityFailureAt of [1, 2]) {
    const rejected = runFixture([canonicalWorker], { identityFailureAt });
    assert.notEqual(rejected.status, 0, `identity check ${identityFailureAt}`);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "");
  }
  const pm2Failure = runFixture([canonicalWorker], { pm2Status: 42 });
  assert.notEqual(pm2Failure.status, 0);
  assert.equal(pm2Failure.stdout, "");
  assert.equal(pm2Failure.stderr, "");
});

test("operator-visible output is a fixed allowlist", () => {
  assert.doesNotMatch(source, /\becho\b/);
  const failureStages = [...source.matchAll(/RECOVERY_FAILURE_STAGE="([a-z_]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(failureStages, [
    "input",
    "repository",
    "deploy_lock",
    "helpers",
    "legacy_release",
    "legacy_environment",
    "database_preflight",
    "runtime",
    "worker_preflight",
    "worker_start",
    "worker_stability",
    "worker_identity",
    "worker_identity",
    "worker_environment",
    "worker_flags",
    "worker_environment",
    "worker_flags",
    "worker_launch_contract",
    "worker_disabled_absence",
    "runtime",
  ]);
  const exitHandler = source.slice(
    source.indexOf("finish_recovery()"),
    source.indexOf("trap finish_recovery EXIT"),
  );
  assert.ok(
    exitHandler.indexOf('if [ "$cleanup_status" -ne 0 ]') <
      exitHandler.indexOf('case "$RECOVERY_FAILURE_STAGE" in'),
    "cleanup uncertainty must take precedence over failure phase reporting",
  );
  for (const stage of [
    "worker_preflight",
    "worker_start",
    "worker_stability",
    "worker_identity",
    "worker_environment",
    "worker_flags",
    "worker_launch_contract",
    "worker_disabled_absence",
  ]) {
    assert.match(
      exitHandler,
      new RegExp(
        `${stage}\\)\\s+printf '%s\\\\n' ` +
          `'recovery_failed_runtime_${stage}' >&2`,
      ),
      `failure stage ${stage} must emit only its matching fixed code`,
    );
  }
  assert.doesNotMatch(exitHandler, /printf[^\n]*\$RECOVERY_FAILURE_STAGE/);
  const literalMarkers = [...source.matchAll(/printf '%s\\n' '([^']+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(literalMarkers, [
    "cleanup_unverified",
    "recovery_failed_pre_runtime_input",
    "recovery_failed_pre_runtime_repository",
    "recovery_failed_pre_runtime_deploy_lock",
    "recovery_failed_pre_runtime_helpers",
    "recovery_failed_pre_runtime_legacy_release",
    "recovery_failed_pre_runtime_legacy_environment",
    "recovery_failed_pre_runtime_database_preflight",
    "recovery_failed_runtime_worker_preflight",
    "recovery_failed_runtime_worker_start",
    "recovery_failed_runtime_worker_stability",
    "recovery_failed_runtime_worker_identity",
    "recovery_failed_runtime_worker_environment",
    "recovery_failed_runtime_worker_flags",
    "recovery_failed_runtime_worker_launch_contract",
    "recovery_failed_runtime_worker_disabled_absence",
    "recovery_failed",
    "recovery_failed_stage_invalid",
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
  assert.equal(invoked.stderr, "recovery_failed_pre_runtime_input\n");
});
