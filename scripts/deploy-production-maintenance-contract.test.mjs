import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function shellFunction(name) {
  const start = source.indexOf(`${name}() {`); assert.ok(start >= 0, name);
  const lines = source.slice(start).split("\n"), captured = []; let heredoc = null;
  for (const line of lines) {
    captured.push(line);
    if (heredoc) { if (line === heredoc) heredoc = null; continue; }
    heredoc = line.match(/<<['"]?([A-Z_]+)['"]?/)?.[1] ?? null;
    if (!heredoc && line === "}") return captured.join("\n") + "\n";
  }
  assert.fail(`unterminated ${name}`);
}
function bashPath(value) { return value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => "/" + drive.toLowerCase()); }
const bash = (process.platform === "win32" ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"] : ["bash"])
  .find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
assert.ok(bash, "Bash required for synthetic shell contracts");
function execute(functions, body) {
  const result = spawnSync(bash, ["-s"], { input: "set -euo pipefail\n" + functions.map(shellFunction).join("\n") + "\n" + body,
    encoding: "utf8", timeout: 10000, windowsHide: true, env: { ...process.env, PRODUCTION_MAINTENANCE_MODE: "maintenance" } });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout;
}

test("deploy shell syntax remains valid", () => {
  const result = spawnSync(bash, ["-n"], { input: source, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test("maintenance old PM2 mutation and embedded proof helpers refuse before any command", () => {
  const functions = ["stop_frozen_previous_web_bounded", "stop_pm2_process_bounded", "start_automation_worker_process",
    "start_frozen_previous_release", "cleanup_pre_forward_recovery_started_process", "recover_pre_forward_previous_runtime",
    "rollback_release", "previous_web_listener_handoff_operation"];
  assert.equal(execute(functions, `
pm2() { echo forbidden; exit 90; }
node() { echo forbidden; exit 91; }
timeout() { echo forbidden; exit 92; }
${functions.map((name) => `if ${name}; then exit 93; fi`).join("\n")}
printf 'rejected'
`), "rejected");
});

test("maintenance snapshots only accept fixed web and worker names, with shared deadline bound", () => {
  assert.equal(execute(["pm2_process_snapshot"], `
APP_NAME=faolla
AUTOMATION_WORKER_NAME=faolla-enterprise-automation-worker
pm2() { exit 90; }
maintenance_deployment_read() { printf '%s:%s' "$1" "$2"; }
deadline_bounded_command_timeout_seconds() { [ "$1:$2:$3" = '100:30:1' ]; printf 7; }
[ "$(pm2_process_snapshot faolla 100)" = snapshot-web:7000 ]
[ "$(pm2_process_snapshot faolla-enterprise-automation-worker)" = snapshot-worker:30000 ]
if pm2_process_snapshot stranger; then exit 91; fi
printf verified
`), "verified");
});

test("maintenance rollout delegates all three expected values and refuses other names", () => {
  assert.equal(execute(["pm2_rollout_environment_pid"], `
APP_NAME=faolla
pm2() { exit 90; }
maintenance_deployment_read() { [ "$#" = 5 ] && [ "$1:$2:$3:$4:$5" = 'rollout-web:30000:enforce:12345678:https://launch.faolla.com' ]; printf 300; }
[ "$(pm2_rollout_environment_pid faolla enforce 12345678 https://launch.faolla.com)" = 300 ]
if pm2_rollout_environment_pid stranger enforce 12345678 https://launch.faolla.com; then exit 91; fi
printf verified
`), "verified");
});

test("validated maintenance start uses controller exactly once, never ambient PM2 or worker start", () => {
  const directory = mkdtempSync(join(tmpdir(), "faolla-maintenance-shell-"));
  try {
    const runtime = join(directory, "runtime"); mkdirSync(join(runtime, "node_modules/next/dist/bin"), { recursive: true });
    mkdirSync(join(runtime, ".next")); writeFileSync(join(runtime, "package.json"), "{}");
    writeFileSync(join(runtime, "node_modules/next/dist/bin/next"), "synthetic");
    assert.equal(execute(["start_release"], `
RELEASE_DIR='${bashPath(runtime)}'
CURRENT_LINK="$RELEASE_DIR"
staff_business_rollout_values_valid() { [ "$1:$2:$3:$4" = 'enforce:12345678:https://launch.faolla.com:0' ]; }
maintenance_control() { [ "$#" = 1 ] && [ "$1" = start-candidate ]; printf controlled; }
read_runtime_automation_worker_enabled() { echo forbidden; exit 91; }
pm2() { echo forbidden; exit 92; }
start_release "$RELEASE_DIR" enforce 12345678 https://launch.faolla.com 0
`), "controlled");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("maintenance candidate stop uses held controller, not old typed-proof decoder", () => {
  assert.equal(execute(["stop_frozen_candidate_web_bounded"], `
calls=''
maintenance_control() { calls="$calls $1"; }
previous_web_listener_handoff_operation() { exit 90; }
pm2() { exit 91; }
stop_frozen_candidate_web_bounded
[ "$calls" = ' fail-held check-held' ]
[ "$CANDIDATE_WEB_HANDOFF_STATE:$CANDIDATE_WEB_FROZEN_STOP_COMPLETED" = absent:1 ]
printf verified
`), "verified");
});

test("candidate handoff only becomes exact after five unique fields and matching current identity", () => {
  for (const kind of ["valid", "duplicate", "wrong-cwd", "truncated"]) {
    const fields = ["CANDIDATE_WEB_PID 300", "CANDIDATE_WEB_PROCESS_START_TICKS 400", "CANDIDATE_WEB_PROCESS_IDENTITY 1:2",
      `CANDIDATE_WEB_CWD_IDENTITY ${kind === "wrong-cwd" ? "3:4:6" : "3:4:5"}`, "CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64 eA=="];
    if (kind === "duplicate") fields[1] = fields[0];
    if (kind === "truncated") fields.pop();
    assert.equal(execute(["capture_candidate_web_listener_handoff_identity"], `
RELEASE_DIR=/srv/faolla.releases/synthetic
CURRENT_LINK=/srv/faolla.current
CANDIDATE_RUNTIME_IDENTITY=3:4:5
CANDIDATE_WEB_START_ATTEMPTED=1
SWITCH_COMPLETED=1
PREVIOUS_WEB_PROCESS_IDENTITY_TOTAL_TIMEOUT_SECONDS=30
readlink() { printf '%s' "$RELEASE_DIR"; }
stat() { printf '3:4:5'; }
deadline_bounded_command_timeout_seconds() { printf 5; }
maintenance_deployment_read() {
  [ "$1:$2" = candidate-handoff:5000 ]
  ${fields.map((field) => `printf '%s\\0%s\\0' ${field}`).join("\n  ")}
}
previous_web_listener_handoff_operation() { exit 95; }
if capture_candidate_web_listener_handoff_identity "$((SECONDS+30))"; then
  [ '${kind}' = valid ] && [ "$CANDIDATE_WEB_HANDOFF_STATE" = exact ] && [ "$CANDIDATE_WEB_PID" = 300 ]
else
  [ '${kind}' != valid ] && [ "$CANDIDATE_WEB_HANDOFF_STATE" = unverified ]
fi
printf verified
`), "verified");
  }
});

test("maintenance start reserves its actual control budget without enlarging the fence deadline", () => {
  assert.match(source, /CANDIDATE_WEB_START_RESERVE_SECONDS="\$RELEASE_PROCESS_START_TIMEOUT_SECONDS"\nif \[ "\$PRODUCTION_MAINTENANCE_MODE" = maintenance \]; then\n  CANDIDATE_WEB_START_RESERVE_SECONDS=120\nfi\nassert_readiness_fence_before_forward_operation "\$\(\(\n  CANDIDATE_WEB_START_RESERVE_SECONDS \+/);
  const control = shellFunction("maintenance_control");
  assert.match(control, /timeout --signal=TERM --kill-after=5s 120s/);
  assert.match(control, /start-candidate/);
});

test("maintenance failure releases only its own fence before controller cleanup", () => {
  for (const succeeds of [true, false]) {
    const result = spawnSync(bash, ["-s"], { input: `set -euo pipefail
${shellFunction("cleanup_failed_build")}
RELEASE_BUILD_DIR=/nonexistent-faolla-synthetic-build
READINESS_FENCE_ACTIVE=1
DEPLOY_ATTESTATION_FILE=/nonexistent-faolla-synthetic-attestation
DEPLOY_RELEASE_BINDING_FILE=/nonexistent-faolla-synthetic-binding
discard_failed_readiness_fence() { printf 'discard\\n'; ${succeeds ? "return 0" : "return 1"}; }
maintenance_control() { [ "$1" = fail-held ]; printf 'control\\n'; }
stop_frozen_candidate_web_bounded() { printf 'forbidden-old-stop\\n'; }
pm2() { printf 'forbidden-pm2\\n'; }
rm() { :; }
false || cleanup_failed_build
`, encoding: "utf8", timeout: 10000, env: { ...process.env, PRODUCTION_MAINTENANCE_MODE: "maintenance" } });
    assert.equal(result.status, 1); assert.equal(result.signal, null); assert.doesNotMatch(result.stdout, /forbidden/);
    // Fence output is deliberately suppressed; only a successful release permits fail-held.
    assert.equal(result.stdout.includes("control\n"), succeeds);
    assert.match(result.stdout, succeeds ? /ingress remains held/ : /cleanup is unverified/);
  }
  const cleanup = shellFunction("cleanup_failed_build");
  const maintenance = cleanup.slice(cleanup.indexOf('if [ "${PRODUCTION_MAINTENANCE_MODE:-off}" = maintenance ]'), cleanup.indexOf('if [ "$WEB_COMMITTED" = "1" ]'));
  assert.ok(maintenance.indexOf("discard_failed_readiness_fence") < maintenance.indexOf("maintenance_control fail-held"));
  assert.doesNotMatch(maintenance, /stop_frozen_candidate_web_bounded|pm2 |rollback_release/);
});

test("handoff uses standalone reader with complete keys and typed candidate never enters old decoder", () => {
  const previous = shellFunction("load_maintenance_previous_runtime"), candidate = shellFunction("capture_candidate_web_listener_handoff_identity");
  assert.match(previous, /production-maintenance-deploy-read\.mjs" runtime-handoff/);
  assert.doesNotMatch(previous, /--input-type=module|await import|<<'NODE'/);
  assert.match(previous, /count" -eq 27/); assert.match(previous, /seen\[\$key\]/);
  assert.match(candidate, /maintenance_deployment_read candidate-handoff/);
  assert.match(candidate, /count" -eq 5/); assert.match(candidate, /seen\[\$key\]/);
  const branch = candidate.slice(candidate.indexOf('if [ "${PRODUCTION_MAINTENANCE_MODE:-off}" = maintenance ]'), candidate.indexOf("while [", candidate.indexOf('if [ "${PRODUCTION_MAINTENANCE_MODE:-off}" = maintenance ]')));
  assert.doesNotMatch(branch, /previous_web_listener_handoff_operation/);
  assert.match(source, /if \[ "\$PRODUCTION_MAINTENANCE_MODE" = off \] && ! timeout[^\n]+pm2 save/);
});
