import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
function body(name) {
  const start = source.indexOf(name + "() {\n");
  const end = source.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 3);
}
const functions = ["booking_persistence_retry_budget_seconds", "booking_persistence_diagnostic",
  "booking_persistence_observe", "verify_booking_persistence_with_bounded_retry",
  "assert_readiness_fence_before_forward_operation", "assert_readiness_fence_forward_checkpoint"].map(body).join("\n");
const start = source.indexOf('BOOKING_PERSISTENCE_EFFECTIVE_RETRY_TIMEOUT_SECONDS="$(booking_persistence_retry_budget_seconds)"');
const end = source.indexOf('\nassert_readiness_fence_before_forward_operation "$RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS"', start);
assert.ok(start > 0 && end > start);
const entry = source.slice(start, end);
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function run({ mode = "maintenance", hold = 1320, capture = 0, stateCost = 0, queryStatus = 0, command = entry } = {}) {
  const script = `
set -uo pipefail
unset SECONDS; SECONDS=0
${functions}
PRODUCTION_MAINTENANCE_MODE=${quote(mode)}
BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_POST_PROOF_RESERVE_SECONDS=20
BOOKING_PERSISTENCE_FD_POST_PROOF_RESERVE_SECONDS=5
READINESS_FENCE_FORWARD_READY=1
READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780
READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15
READINESS_FENCE_OPERATION_MARGIN_SECONDS=10
queries=0; states=0
assert_readiness_fence_held_with_bounded_retry() {
  printf 'fence:%s:%s:%s\\n' "$1" "$2" "$3"
  [ "$1" -le ${hold} ] && [ "$SECONDS" -lt "$3" ]
}
capture_candidate_web_identity_for_booking_retry() {
  printf 'capture:%s\\n' "$1"
  SECONDS=$((SECONDS + ${capture}))
  [ "$SECONDS" -lt "$1" ]
}
assert_booking_persistence_retry_state() {
  states=$((states + 1)); SECONDS=$((SECONDS + ${stateCost}))
  printf 'state:%s\\n' "$1"
  [ "$SECONDS" -lt "$1" ]
}
assert_candidate_web_health() { printf 'health:%s\\n' "$1"; [ "$SECONDS" -lt "$1" ]; }
verify_booking_persistence() {
  queries=$((queries + 1))
  printf 'query:%s:%s\\n' "$1" "$2" >&3
  [ "$1" -le 60 ] && [ "$SECONDS" -lt "$2" ] || return 99
  return ${queryStatus}
}
sleep() { [ "$1" = 1 ] || return 99; SECONDS=$((SECONDS + 1)); }
${command}
printf 'success:%s:%s:%s\\n' "$SECONDS" "$queries" "$states"
`;
  const result = spawnSync(bash, ["-s"], {
    input: "exec 3>&1\n" + script, encoding: "utf8", timeout: 5000, maxBuffer: 65536, windowsHide: true,
    env: { PATH: process.platform === "win32" ? "C:/Program Files/Git/usr/bin" : "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.ok(result.stderr.split("\n").filter(Boolean).every(line =>
    /^\[deploy\] booking_persistence_diagnostic stage=[a-z_]+ code=[a-z_]+ elapsed_seconds=[0-9]+$/.test(line)), result.stderr);
  return result;
}
test("fixed selector permits maintenance 120 and ordinary 60 only, regardless ambient requested budget", () => {
  for (const [mode, value] of [["maintenance", 120], ["off", 60]]) {
    const result = run({ mode, command: "BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=999; booking_persistence_retry_budget_seconds" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, value + "\nsuccess:0:0:0\n");
  }
  for (const mode of ["unknown", "MAINTENANCE", "maintenance "]) {
    const result = run({ mode });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});
test("actual maintenance call site first reserves 925 seconds and shares one 120-second deadline including capture", () => {
  const result = run({ capture: 10, stateCost: 10 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.deepEqual(lines.slice(0, 2), ["fence:925:15:120", "capture:120"]);
  assert.equal(lines.filter(line => line.startsWith("state:")).length, 6);
  assert.equal(lines.filter(line => line.startsWith("health:")).length, 2);
  assert.ok(lines.includes("fence:905:15:120"));
  assert.ok(lines.includes("fence:795:15:120"));
  assert.ok(lines.includes("query:60:120"));
  assert.equal(lines.at(-1), "success:70:1:6");
  const denied = run({ hold: 924 });
  assert.equal(denied.status, 1);
  assert.equal(denied.stdout, "fence:925:15:120\n");
});
test("ordinary call site preserves 60 seconds and has no new initial fence check", () => {
  const result = run({ mode: "off" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.startsWith("capture:60\nstate:60\nfence:865:15:60\n"));
  assert.ok(result.stdout.includes("query:60:60\n"));
  assert.ok(result.stdout.endsWith("success:0:1:6\n"));
});
test("default and maximum use the same mode selector; absolute deadlines never reset", () => {
  for (const [mode, value] of [["maintenance", 120], ["off", 60]]) {
    const result = run({ mode, command: "verify_booking_persistence_with_bounded_retry || exit 1" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes("query:60:" + value + "\n"));
    const rejected = run({ mode, command: "verify_booking_persistence_with_bounded_retry " + (value + 1) + " || exit 1" });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout.includes("query:"), false);
  }
  for (const elapsed of [120, 121]) {
    const result = run({ capture: elapsed });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes("query:"), false);
    assert.equal(result.stdout.includes("success:"), false);
  }
  const reserve = run({ capture: 95 });
  assert.equal(reserve.status, 1);
  assert.match(reserve.stderr, /stage=retry_reserve code=failed/);
  assert.equal(reserve.stdout.includes("query:"), false);
  const after = run({ stateCost: 20 });
  assert.equal(after.status, 1);
  assert.equal(after.stdout.split("\n").filter(line => line.startsWith("query:")).length, 1);
});
test("larger aggregate window still permits at most two read-only queries and retains every guard", () => {
  const result = run({ queryStatus: 2 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.split("\n").filter(line => line.startsWith("query:")).length, 2);
  assert.equal(result.stdout.split("\n").filter(line => line.startsWith("state:")).length, 12);
  assert.equal(result.stdout.split("\n").filter(line => line.startsWith("health:")).length, 4);
  assert.match(result.stdout, /deploy_forward_booking_persistence_transient_exhausted/);
  assert.match(source, /BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS=10000/);
  assert.match(source, /READINESS_FENCE_MAXIMUM_HOLD_SECONDS="\$\{READINESS_FENCE_MAXIMUM_HOLD_SECONDS:-1320\}"/);
  assert.equal(entry.match(/BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS=/g)?.length, 1);
});
