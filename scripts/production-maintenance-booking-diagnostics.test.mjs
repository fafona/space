import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const stages = ("current_capture current_capture_preconditions current_capture_stat current_capture_environment current_capture_build current_capture_shape current_capture_staff_mode current_capture_staff_sites current_capture_portal current_capture_rollout current_capture_final " +
  "web_capture web_capture_preconditions web_capture_snapshot web_capture_ticks web_capture_identity web_capture_state " +
  "state_preconditions state_worker_before state_web_before state_process_before state_environment state_build state_file_comparison state_process_environment state_environment_comparison state_current_after state_worker_after state_web_after state_process_after " +
  "retry_deadline retry_state_before retry_remaining retry_fence_before retry_state_after_fence retry_health_before retry_state_after_health retry_reserve query retry_state_after_query retry_fence_after retry_state_final_fence retry_health_after retry_state_final_health retry_attempts retry_delay_budget retry_delay retry_exhausted").split(" ");
const codes = "start passed failed hard_failed transient invocation_failed integrity_failed unexpected_status".split(" ");
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function body(name) {
  const start = source.indexOf(name + "() {");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 3);
}
const helpers = [body("booking_persistence_diagnostic"), body("booking_persistence_observe"), body("booking_persistence_retry_budget_seconds")].join("\n");
function shell(script, functions = "") {
  const result = spawnSync(bash, ["-s"], { input: "set +e\nunset SECONDS; SECONDS=0\n" + helpers + "\n" + functions + "\n" + script,
    encoding: "utf8", timeout: 5000, maxBuffer: 65536,
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "" } });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  const diagnostics = result.stderr.trim() ? result.stderr.trimEnd().split("\n").map(line => {
    const match = /^\[deploy\] booking_persistence_diagnostic stage=([a-z_]+) code=([a-z_]+) elapsed_seconds=(0|[1-9][0-9]{0,4})$/.exec(line);
    assert.ok(match, line); assert.ok(stages.includes(match[1]), line); assert.ok(codes.includes(match[2]), line);
    assert.ok(Number(match[3]) <= 86400, line);
    return { stage: match[1], code: match[2], elapsed: Number(match[3]) };
  }) : [];
  assert.doesNotMatch(result.stderr, /SECRET|Bearer|\/private|postgres:|12345|running:/);
  return { ...result, diagnostics };
}
const failed = (result, stage) => assert.ok(result.diagnostics.some(row => row.stage === stage && row.code === "failed"), stage);

test("booking diagnostics accept only exact stages, codes and bounded integer durations, never arbitrary fields", () => {
  for (const stage of stages) {
    const result = shell(`SECONDS=7; booking_persistence_diagnostic ${quote(stage)} passed 2`);
    assert.equal(result.stdout, ""); assert.deepEqual(result.diagnostics, [{ stage, code: "passed", elapsed: 5 }]);
  }
  for (const args of [["SECRET/private", "failed", "0"], ["query", "SECRET", "0"], ["query\nSECRET", "passed", "0"],
    ["query", "passed", "SECRET"], ["query", "passed", "-1"], ["query", "passed", "00"], ["query", "passed", "9999999999"]]) {
    const result = shell(`booking_persistence_diagnostic ${args.map(quote).join(" ")}`);
    assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  }
  assert.equal(shell("SECONDS=86401; booking_persistence_diagnostic query passed 0").stderr, "");
  assert.equal(shell("SECONDS=1; booking_persistence_diagnostic query passed 2").stderr, "");
});

test("observer preserves private command-substitution stdout and exact return code while stderr survives", () => {
  for (const status of [0, 1, 2, 4, 124]) {
    const result = shell(`producer() { printf 'SECRET/private\\nsecond\\n'; SECONDS=3; return ${status}; }
value="$(booking_persistence_observe state_environment producer)"; status=$?
printf '%s\\n%s\\n' "$status" "$value"`);
    assert.equal(result.stdout, `${status}\nSECRET/private\nsecond\n`);
    assert.deepEqual(result.diagnostics, [{ stage: "state_environment", code: "start", elapsed: 0 },
      { stage: "state_environment", code: status === 0 ? "passed" : "failed", elapsed: 3 }]);
  }
});

const retryFunctions = body("verify_booking_persistence_with_bounded_retry") + `
calls=(); state_calls=0; health_calls=0; query_calls=0
BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_POST_PROOF_RESERVE_SECONDS=20
BOOKING_PERSISTENCE_FD_POST_PROOF_RESERVE_SECONDS=5
record() { calls+=("$1"); [ "$FAIL" != "$1" ]; }
assert_booking_persistence_retry_state() {
  state_calls=$((state_calls+1)); record "state$state_calls" || return 1
  case "$CLOCK_AT:$state_calls" in remaining:1) SECONDS=60 ;; reserve:3) SECONDS=35 ;; post:4) SECONDS=60 ;; esac
  [ "$1" = 60 ]
}
assert_readiness_fence_before_forward_operation() { record fence_before && [ "$1" = 60 ] && [ "$2" = 60 ]; }
assert_readiness_fence_forward_checkpoint() { record fence_after && [ "$1" = 60 ]; }
assert_candidate_web_health() { health_calls=$((health_calls+1)); record "health$health_calls" && [ "$1" = 60 ]; }
verify_booking_persistence() {
  query_calls=$((query_calls+1)); calls+=(query)
  printf 'SECRET query/private'; printf 'SECRET raw error' >&2
  [ "$1" = 60 ] && [ "$2" = 60 ] || return 99
  return "$QUERY_STATUS"
}
sleep() { calls+=(delay); SECONDS=$((SECONDS+1)); }
`;
function retry({ fail = "", clock = "", status = 0, deadline = 60 } = {}) {
  return shell(`FAIL=${quote(fail)}; CLOCK_AT=${quote(clock)}; QUERY_STATUS=${status}
if verify_booking_persistence_with_bounded_retry ${quote(deadline)}; then status=0; else status=$?; fi
printf '__result__ %s %s\\n' "$status" "$query_calls"
printf '__calls__ %s\\n' "\${calls[*]}"`, retryFunctions);
}

test("successful retry preserves the original ordered checks and emits no new stdout", () => {
  const result = retry();
  assert.equal(result.stdout, "__result__ 0 1\n__calls__ state1 fence_before state2 health1 state3 query state4 fence_after state5 health2 state6\n");
  assert.ok(result.diagnostics.some(row => row.stage === "query" && row.code === "passed"));
});

test("every original retry state-failed branch identifies its fixed failing substep and short-circuits", () => {
  const cases = [
    [{ deadline: 0 }, "retry_deadline", 0], [{ deadline: 61 }, "retry_deadline", 0],
    [{ fail: "state1" }, "retry_state_before", 0], [{ clock: "remaining" }, "retry_remaining", 0],
    [{ fail: "fence_before" }, "retry_fence_before", 0], [{ fail: "state2" }, "retry_state_after_fence", 0],
    [{ fail: "health1" }, "retry_health_before", 0], [{ fail: "state3" }, "retry_state_after_health", 0],
    [{ clock: "reserve" }, "retry_reserve", 0], [{ fail: "state4" }, "retry_state_after_query", 1],
    [{ fail: "fence_after" }, "retry_fence_after", 1], [{ fail: "state5" }, "retry_state_final_fence", 1],
    [{ fail: "health2" }, "retry_health_after", 1], [{ fail: "state6" }, "retry_state_final_health", 1],
  ];
  for (const [options, stage, queryCount] of cases) {
    const result = retry(options); failed(result, stage);
    assert.match(result.stdout, new RegExp(`^\\[deploy\\] deploy_forward_booking_persistence_state_failed\\n__result__ 1 ${queryCount}\\n`));
    if (options.fail) assert.ok(result.stdout.trimEnd().endsWith(options.fail), options.fail);
  }
});

test("query status class is retained outside suppressed child channels even when a post-proof check fails", () => {
  for (const [status, code] of [[0, "passed"], [1, "hard_failed"], [2, "transient"], [3, "invocation_failed"], [4, "integrity_failed"], [124, "unexpected_status"]]) {
    const result = retry({ status, fail: "state4" });
    assert.ok(result.diagnostics.some(row => row.stage === "query" && row.code === code));
    failed(result, "retry_state_after_query");
    assert.match(result.stdout, /^\[deploy\] deploy_forward_booking_persistence_state_failed\n/);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET/);
  }
});

const identities = `
RELEASE_DIR=/__faolla_diagnostics_missing__/release; CURRENT_LINK=/__faolla_diagnostics_missing__/current
APP_NAME=web; AUTOMATION_WORKER_NAME=worker
SWITCH_COMPLETED=1; WEB_COMMITTED=0; PROCESSES_STOPPED=1; FORWARD_MUTATION_STARTED=1
READINESS_FENCE_ACTIVE=1; READINESS_FENCE_RELEASED=0; READINESS_FENCE_RELEASE_REQUESTED=0; READINESS_FENCE_FORWARD_READY=1; LEGACY_COMPATIBILITY_LINKS_INSTALLED=0
CANDIDATE_WEB_HANDOFF_STATE=exact; CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64=cHJvb2Y=
CANDIDATE_WEB_PID=12345; CANDIDATE_WEB_PROCESS_START_TICKS=456
CANDIDATE_WEB_PROCESS_IDENTITY=70:80; CANDIDATE_WEB_CWD_IDENTITY=40:50:60
CANDIDATE_CURRENT_LINK_IDENTITY=10:20:30; CANDIDATE_RUNTIME_IDENTITY=40:50:60
CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY=1:2:3:4:5:6:7
CANDIDATE_ENVIRONMENT_FILE_IDENTITY=1:2:3:4:5:6:7:8
CANDIDATE_ENVIRONMENT_SHA256=${"a".repeat(64)}
CANDIDATE_SUPABASE_INTERNAL_URL_B64=aW50ZXJuYWw=; CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64=cHVibGlj; CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64=U0VDUkVU
CANDIDATE_STAFF_ROLLOUT_STATUS=explicit; CANDIDATE_STAFF_MODE_B64=b2Zm; CANDIDATE_STAFF_SITE_IDS_B64=-; CANDIDATE_PORTAL_ORIGIN_B64=cG9ydGFs
CANDIDATE_BUILD_FILE_IDENTITY=8:7:6:5:4:3:2:1; CANDIDATE_BUILD_FILE_SHA256=${"b".repeat(64)}
readlink() { [ "$FAIL" != current ] || return 1; printf '%s\\n' "$RELEASE_DIR"; }
stat() {
  case "\${@: -1}" in
    "$CURRENT_LINK") printf '%s\\n' "$CANDIDATE_CURRENT_LINK_IDENTITY" ;;
    "$RELEASE_DIR"|"/proc/$CANDIDATE_WEB_PID/cwd") printf '%s\\n' "$CANDIDATE_RUNTIME_IDENTITY" ;;
    "/proc/$CANDIDATE_WEB_PID") [ "$FAIL" != identity ] && printf '%s\\n' "$CANDIDATE_WEB_PROCESS_IDENTITY" ;;
    *) return 1 ;;
  esac
}
pm2_process_snapshot() {
  [ "$FAIL" != snapshot ] || return 4
  if [ "$1" = worker ]; then printf '%s\\n' "\${WORKER_STATE:-absent}"
  elif [ "$FAIL" = snapshot_shape ]; then printf 'SECRET/private\\n'
  else printf 'running:%s\\n' "$CANDIDATE_WEB_PID"; fi
}
linux_process_start_ticks() { [ "$FAIL" != ticks ] || return 1; printf '%s\\n' "$CANDIDATE_WEB_PROCESS_START_TICKS"; }
read_candidate_environment_snapshot_for_booking_retry() {
  [ "$FAIL" != environment ] || return 1
  printf '%s\\n' "$CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY" "$CANDIDATE_ENVIRONMENT_FILE_IDENTITY" "$CANDIDATE_ENVIRONMENT_SHA256" "$CANDIDATE_SUPABASE_INTERNAL_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" "$CANDIDATE_STAFF_ROLLOUT_STATUS" "$CANDIDATE_STAFF_MODE_B64" "$CANDIDATE_STAFF_SITE_IDS_B64" "$CANDIDATE_PORTAL_ORIGIN_B64"
}
read_candidate_build_id_snapshot_for_booking_retry() {
  [ "$FAIL" != build ] || return 1
  printf '%s\\n' "$CANDIDATE_BUILD_FILE_IDENTITY" "$CANDIDATE_BUILD_FILE_SHA256"
}
read_candidate_process_environment_snapshot_for_booking_retry() {
  [ "$FAIL" != process_environment ] || return 1
  printf '%s\\n' present present "$CANDIDATE_WEB_PROCESS_START_TICKS" "$CANDIDATE_SUPABASE_INTERNAL_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" "$CANDIDATE_STAFF_MODE_B64" "$CANDIDATE_STAFF_SITE_IDS_B64" "$CANDIDATE_PORTAL_ORIGIN_B64"
}
`;
function capture(fail = "", setup = "") {
  return shell(`${identities}\nFAIL=${quote(fail)}\n${setup}
if booking_persistence_observe web_capture capture_candidate_web_identity_for_booking_retry 60; then status=0; else status=$?; fi
printf '__result__ %s\\n' "$status"`, body("capture_candidate_web_identity_for_booking_retry") + "\n" + body("assert_booking_persistence_retry_state"));
}
test("candidate capture and its real state preconditions identify failures without revealing private identities", () => {
  const good = capture(); assert.equal(good.stdout, "__result__ 0\n");
  for (const [fault, setup, stage] of [["", "CANDIDATE_WEB_HANDOFF_STATE=unverified", "web_capture_preconditions"],
    ["snapshot", "", "web_capture_snapshot"], ["snapshot_shape", "", "web_capture_snapshot"], ["ticks", "", "web_capture_ticks"],
    ["identity", "", "web_capture_identity"], ["current", "", "web_capture_identity"],
    ["", "PROCESSES_STOPPED=0", "state_preconditions"],
    ["", "WORKER_STATE=inactive", "state_worker_before"], ["environment", "", "state_environment"],
    ["build", "", "state_build"], ["process_environment", "", "state_process_environment"]]) {
    const result = capture(fault, setup); assert.equal(result.stdout, "__result__ 1\n"); failed(result, stage); failed(result, "web_capture");
    assert.doesNotMatch(result.stderr, /U0VDUkVU|70:80|40:50:60/);
  }
});

test("current-link capture diagnostics keep all original selected fields private and reject malformed snapshots", () => {
  const current = body("capture_candidate_current_identity_for_booking_retry");
  const fixture = identities + `
MERCHANT_STAFF_BUSINESS_RBAC_MODE=off; MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS=; FAOLLA_CANONICAL_PORTAL_ORIGIN=https://launch.faolla.com
decode_frozen_environment_value() {
  case "$1" in b2Zm) printf off ;; -) printf '' ;; cG9ydGFs) printf https://launch.faolla.com ;; *) return 1 ;; esac
}
staff_business_rollout_values_valid() { return 0; }
`;
  for (const [fault, setup, stage] of [["", "", null], ["current", "", "current_capture_preconditions"],
    ["environment", "", "current_capture_environment"], ["build", "", "current_capture_build"],
    ["", "CANDIDATE_ENVIRONMENT_SHA256=SECRET", "current_capture_shape"],
    ["", "MERCHANT_STAFF_BUSINESS_RBAC_MODE=enforce", "current_capture_rollout"]]) {
    const result = shell(`${fixture}\nFAIL=${quote(fault)}\n${setup}
if booking_persistence_observe current_capture capture_candidate_current_identity_for_booking_retry 60; then status=0; else status=$?; fi
printf '__result__ %s\\n' "$status"`, current);
    assert.equal(result.stdout, `__result__ ${stage ? 1 : 0}\n`); if (stage) failed(result, stage);
  }
});

test("diagnostic changes leave the query supervisor byte-identical and retain its suppressed raw channels", () => {
  const begin = source.indexOf("verify_booking_persistence() {"), end = source.indexOf("\nswitch_current_release() {", begin);
  const original = source.slice(begin, end);
  // Filled from the reviewed T5 source, not generated from the modified function.
  assert.equal(createHash("sha256").update(original).digest("hex"), "08239b7bee7bb6948889d9147ee23051d34416c1a902fe6869b6fd30f4f6c974");
  assert.match(body("verify_booking_persistence_with_bounded_retry"), /verify_booking_persistence \\\n\s+"\$remaining_seconds" "\$absolute_deadline_seconds" >\/dev\/null 2>&1; then/);
  const call = source.slice(source.indexOf('BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS="$((\n'));
  assert.match(call, /SECONDS \+ BOOKING_PERSISTENCE_EFFECTIVE_RETRY_TIMEOUT_SECONDS/);
  assert.match(call, /booking_persistence_observe web_capture capture_candidate_web_identity_for_booking_retry \\\n\s+"\$BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS"/);
  assert.match(call, /verify_booking_persistence_with_bounded_retry \\\n\s+"\$BOOKING_PERSISTENCE_ABSOLUTE_DEADLINE_SECONDS" \|\| exit 1/);
});
