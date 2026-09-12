import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
function region(start, end) {
  const at = source.indexOf(start); const until = source.indexOf(end, at + start.length);
  assert.ok(at >= 0 && until > at, `missing bounded region ${start}`); return source.slice(at, until);
}
const fn = (name) => region(`${name}() {`, "\n}\n") + "\n}\n";
function shell(body, env = {}) {
  assert.ok(process.platform !== "win32" || existsSync(bash));
  return spawnSync(bash, ["-c", "set -euo pipefail\n" + body], {
    encoding: "utf8", timeout: 10_000, env: { ...process.env, ...env },
  });
}

test("maintenance is an explicit bound mode and missing old process never invokes the live capture", () => {
  const mode = region('case "$PRODUCTION_MAINTENANCE_MODE" in', "maintenance_control() {");
  assert.match(mode, /off\)/); assert.match(mode, /maintenance\)/);
  assert.match(mode, /PRODUCTION_MAINTENANCE_OPERATION_ID/); assert.match(mode, /PRODUCTION_MAINTENANCE_EXPECTED_OLD_SHA/);
  assert.match(mode, /\*\).*maintenance binding is invalid/s);
  const capture = region("# Capture rollback identity", "# An enforce release");
  assert.match(capture, /if \[ "\$PRODUCTION_MAINTENANCE_MODE" = maintenance \]; then\s+if ! load_maintenance_previous_runtime; then\s+echo "\[deploy\] deploy_preflight_maintenance_handoff_failed"\s+exit 1\s+fi\s+else\s+PREVIOUS_LINK_TARGET=/);
  assert.match(capture, /\/proc\/\$PREVIOUS_WEB_PID\/cwd/);
});

test("maintenance handoff failure exits with one fixed diagnostic before any forward work", () => {
  const capture = region("# Capture rollback identity", "# An enforce release");
  const branch = capture.slice(capture.indexOf('if [ "$PRODUCTION_MAINTENANCE_MODE" = maintenance ]; then'), capture.indexOf("\nelse\n"));
  for (const status of ["0", "1"]) {
    const result = shell(`
load_maintenance_previous_runtime() { return "$HANDOFF_STATUS"; }
${branch}
fi
printf 'continued\\n'
`, { PRODUCTION_MAINTENANCE_MODE: "maintenance", HANDOFF_STATUS: status });
    assert.equal(result.status, Number(status), result.stderr);
    assert.equal(result.stdout, status === "0" ? "continued\n" : "[deploy] deploy_preflight_maintenance_handoff_failed\n");
    assert.equal(result.stderr, "");
  }
});

test("private handoff validates every binding and frozen proof before exposing selected fields", () => {
  const handoff = region("load_maintenance_previous_runtime() {", '\nif [ "$FAOLLA_CANONICAL_PORTAL_ORIGIN"');
  const reader = readFileSync(new URL("./production-maintenance-deploy-read.mjs", import.meta.url), "utf8");
  for (const text of ["runtime-handoff", "PRODUCTION_MAINTENANCE_EXPECTED_OLD_SHA", "PRODUCTION_MAINTENANCE_OPERATION_ID", "EXPECTED_DEPLOY_SHA", "check-held"]) {
    assert.ok(handoff.includes(text), text);
  }
  for (const text of ["expected-operation-id", "expectedOldSha", "operationId", "targetSha", "validateRuntimeProof", "readDeploymentHandoffFields"]) {
    assert.ok(reader.includes(text), text);
  }
  assert.match(handoff, /node "\$APP_DIR\/scripts\/production-maintenance-deploy-read\.mjs" runtime-handoff/);
  assert.match(handoff, /\[ "\$count" -eq 27 \]/);
  assert.match(handoff, /seen\[\$key\]\+present/);
  assert.doesNotMatch(handoff, /eval |source |readFileSync\([^\n]*environ|--input-type=module|await import/);
});

test("normal preflight still calls the original alive verifier, offline preflight requires held proof", () => {
  const body = fn("maintenance_preflight_checkpoint") + fn("previous_runtime_preflight_identity_matches") + fn("preflight_process_state_matches") + `
maintenance_control() { [ "$1" = check-held ] && [ "$HELD" = 1 ]; }
previous_runtime_recovery_identity_matches() { [ "$DISK" = 1 ]; }
previous_web_process_identity_matches() { [ "$ALIVE" = 1 ]; }
previous_runtime_preflight_identity_matches
preflight_process_state_matches
`;
  for (const [mode, stopped, alive, held, disk, success] of [
    ["off", "0", "1", "0", "1", true], ["off", "0", "0", "1", "1", false],
    ["maintenance", "1", "0", "1", "1", true], ["maintenance", "0", "1", "1", "1", false],
    ["maintenance", "1", "1", "0", "1", false], ["maintenance", "1", "1", "1", "0", false],
  ]) {
    const result = shell(body, { PRODUCTION_MAINTENANCE_MODE: mode, PROCESSES_STOPPED: stopped, ALIVE: alive, HELD: held, DISK: disk });
    assert.equal(result.status === 0, success, result.stderr);
  }
});

test("offline quiescence consumes real held evidence and does not fake a live listener", () => {
  const stop = region('DEPLOY_PRIMARY_FAILURE_CODE="deploy_stage_previous_web_quiesce_failed"\n', 'DEPLOY_PRIMARY_FAILURE_CODE="deploy_stage_forward_switch_failed"\n');
  assert.match(stop, /maintenance_preflight_checkpoint \|\| exit 1\s+PREVIOUS_WEB_FROZEN_STOP_COMPLETED=1\s+else\s+capture_previous_web_listener_handoff_identity/);
  assert.match(stop, /stop_frozen_previous_web_bounded/); assert.match(stop, /stop_previous_automation_worker_bounded/);
});

test("only the active exact fence may use the runtime-only checkpoint and both fence checks are required", () => {
  const body = fn("maintenance_preflight_checkpoint") + `
maintenance_control() { printf 'control:%s\\n' "$1"; [ "$CONTROL_OK" = 1 ]; }
CHECKS=0
assert_readiness_fence_before_process_quiescence() {
  CHECKS=$((CHECKS + 1)); printf 'fence:%s\\n' "$1"
  [ "$CHECKS" != "$FAIL_CHECK" ]
}
maintenance_preflight_checkpoint
`;
  const result = shell(body, { READINESS_FENCE_ACTIVE: "1", CONTROL_OK: "1", FAIL_CHECK: "0" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "fence:125\ncontrol:check-runtime-held\nfence:1\n");
  for (const failCheck of ["1", "2"]) {
    assert.notEqual(shell(body, { READINESS_FENCE_ACTIVE: "1", CONTROL_OK: "1", FAIL_CHECK: failCheck }).status, 0);
  }
  assert.notEqual(shell(body, { READINESS_FENCE_ACTIVE: "1", CONTROL_OK: "0", FAIL_CHECK: "0" }).status, 0);
  const before = shell(body, { READINESS_FENCE_ACTIVE: "0", CONTROL_OK: "1", FAIL_CHECK: "0" });
  assert.equal(before.status, 0); assert.equal(before.stdout, "control:check-held\n");
});

test("candidate is paused, registered only after health and cannot automatically resume workers", () => {
  assert.match(fn("start_release"), /FAOLLA_BACKGROUND_JOBS_PAUSED="\$background_jobs_paused"/);
  const forward = region('DEPLOY_PRIMARY_FAILURE_CODE="deploy_stage_candidate_start_failed"\n', 'DEPLOY_PRIMARY_FAILURE_CODE="deploy_stage_post_commit_finalize_failed"\n');
  assert.ok(forward.indexOf("register-candidate") > forward.indexOf('wait_for_release_health "$FAOLLA_WEB_BUILD_ID"'));
  assert.ok(forward.indexOf("register-candidate") > forward.indexOf('CANDIDATE_WEB_HANDOFF_STATE" != "exact"'));
  const tail = source.slice(source.lastIndexOf('DEPLOY_PRIMARY_FAILURE_CODE="deploy_stage_post_commit_finalize_failed"\n'));
  assert.match(tail, /if \[ "\$PRODUCTION_MAINTENANCE_MODE" = maintenance \]; then\s+maintenance_control check-candidate \|\| exit 1\s+echo[^\n]+independent end is required"\s+else\s+stop_pm2_process_bounded/);
  assert.match(tail, /if \[ "\$PRODUCTION_MAINTENANCE_MODE" = off \]; then cleanup_old_releases; fi/);
});

test("maintenance failure never falls through to legacy automatic rollback or previous writer restart", () => {
  const cleanup = fn("cleanup_failed_build");
  const branch = cleanup.slice(cleanup.indexOf('if [ "${PRODUCTION_MAINTENANCE_MODE:-off}" = maintenance ]; then'), cleanup.indexOf('if [ "$WEB_COMMITTED" = "1" ]; then'));
  assert.match(branch, /maintenance_control fail-held/);
  assert.match(branch, /discard_failed_readiness_fence/); assert.match(branch, /exit 1\s+fi/);
  assert.ok(branch.indexOf("discard_failed_readiness_fence") < branch.indexOf("maintenance_control fail-held"));
  assert.match(branch, /if \[ "\$cleanup_status" -eq 0 \]; then\s+maintenance_control fail-held/);
  assert.match(branch, /no held result is certified/);
  assert.doesNotMatch(branch, /stop_frozen_candidate_web_bounded|rollback_release|start_frozen_previous|recover_pre_forward|maintenance_control end/);
});

test("maintenance cleanup certifies held only after own-fence disposal and controller verification succeed", () => {
  const cleanup = fn("cleanup_failed_build");
  const branch = cleanup.slice(cleanup.indexOf('if [ "${PRODUCTION_MAINTENANCE_MODE:-off}" = maintenance ]; then'), cleanup.indexOf('if [ "$WEB_COMMITTED" = "1" ]; then'));
  for (const [active, discard, control, expected] of [["1", "0", "0", true], ["1", "1", "0", false], ["1", "0", "1", false], ["0", "0", "0", true]]) {
    const body = `
cleanup_status=0
PRODUCTION_MAINTENANCE_MODE=maintenance
CANDIDATE_WEB_HANDOFF_STATE=exact
DEPLOY_ATTESTATION_FILE=/synthetic-not-read
DEPLOY_RELEASE_BINDING_FILE=/synthetic-not-read
DISCARD_SEEN=0
stop_frozen_candidate_web_bounded() { printf 'forbidden-old-stop\\n'; return 90; }
discard_failed_readiness_fence() { DISCARD_SEEN=1; return "$DISCARD_STATUS"; }
maintenance_control() {
  [ "$1" = fail-held ] && { [ "$READINESS_FENCE_ACTIVE" = 0 ] || [ "$DISCARD_SEEN" = 1 ]; } || return 1
  printf 'controller-called\\n'
  [ "$CONTROL_STATUS" = 0 ] || return 1
  printf 'certified-held\\n'
}
rm() { :; }
${branch}
`;
    const result = shell(body, { READINESS_FENCE_ACTIVE: active, DISCARD_STATUS: discard, CONTROL_STATUS: control });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /forbidden-old-stop/);
    assert.equal(result.stdout.includes("controller-called"), active === "0" || discard === "0");
    assert.equal(result.stdout.includes("certified-held"), expected);
    assert.equal(result.stdout.includes("no held result is certified"), !expected);
  }
});

test("readiness remains real candidate code with explicit config and helper cwd outside candidate", () => {
  const fence = fn("start_readiness_fence");
  assert.match(fence, /cd "\$APP_DIR" \|\| exit 1/);
  assert.match(fence, /exec node "\$RELEASE_DIR\/scripts\/hold-ordinary-account-cutover-readiness-fence\.mjs" hold/);
  assert.doesNotMatch(fence, /cd "\$RELEASE_DIR"/);
  for (const name of ["readiness_fence_process_identity_sha256", "readiness_fence_process_start_ticks"]) {
    const identity = fn(name);
    assert.match(identity, /node --input-type=module - "\$READINESS_FENCE_PID" "\$APP_DIR"/);
    assert.match(identity, /cwd !== realpathSync\(process\.argv\[3\]\)/);
  }
  for (const key of ["FAOLLA_MAINTENANCE_APP_NAME", "FAOLLA_MAINTENANCE_OPERATION_ID", "FAOLLA_MAINTENANCE_TARGET_SHA"]) {
    assert.match(source, new RegExp(`export ${key}=`));
  }
  assert.doesNotMatch(fn("start_release"), /MAINTENANCE.*TOKEN/);
});

test("deployment shell parses after the explicit offline branch is added", () => {
  const result = spawnSync(bash, ["-n"], { input: source, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});
