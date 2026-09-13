import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

// These are composed shell-function tests, not PM2/HTTP/DB or production timing
// evidence. All external observations below are synthetic. The actual candidate
// capture, identity/state checks, retry decisions and diagnostic helpers run
// unchanged from the current deploy source (no historical Git object required).
const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8")
  .replaceAll("\r\n", "\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const names = [
  "booking_persistence_diagnostic",
  "booking_persistence_observe",
  "capture_candidate_web_identity_for_booking_retry",
  "assert_booking_persistence_retry_state",
  "verify_booking_persistence_with_bounded_retry",
];
function extract(name) {
  const start = source.indexOf(`${name}() {\n`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, `missing bounded shell function: ${name}`);
  return source.slice(start, end + 3);
}
const functions = names.map(extract).join("\n");
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const shellPath = (value) => value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function run({ snapshotSeconds = 0, initialSeconds = 0, drift = "none" } = {}) {
  assert.ok(Number.isSafeInteger(snapshotSeconds) && snapshotSeconds >= 0 && snapshotSeconds <= 4);
  assert.ok(Number.isSafeInteger(initialSeconds) && initialSeconds >= 0 && initialSeconds <= 1);
  assert.ok(["none", "cwd", "process", "fence", "environment"].includes(drift));
  if (process.platform === "win32") assert.ok(existsSync(bash), "Git Bash required; do not skip composition");
  const directory = mkdtempSync(join(tmpdir(), "faolla-booking-budget-"));
  const tracePath = join(directory, "trace");
  const clockPath = join(directory, "clock");
  writeFileSync(tracePath, "", { flag: "wx", mode: 0o600 });
  writeFileSync(clockPath, String(initialSeconds), { flag: "wx", mode: 0o600 });
  try {
    const script = `
set -uo pipefail
${functions}
TRACE=${quote(shellPath(tracePath))}
CLOCK=${quote(shellPath(clockPath))}
SNAPSHOT_SECONDS=${snapshotSeconds}
DRIFT=${quote(drift)}
CURRENT_LINK=${quote(shellPath(join(directory, "current")))}
RELEASE_DIR=${quote(shellPath(join(directory, "release")))}
APP_NAME=fixture-web
AUTOMATION_WORKER_NAME=fixture-worker
BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_POST_PROOF_RESERVE_SECONDS=20
BOOKING_PERSISTENCE_FD_POST_PROOF_RESERVE_SECONDS=5
WEB_COMMITTED=0
SWITCH_COMPLETED=1
PROCESSES_STOPPED=1
FORWARD_MUTATION_STARTED=1
READINESS_FENCE_ACTIVE=1
READINESS_FENCE_RELEASED=0
READINESS_FENCE_RELEASE_REQUESTED=0
READINESS_FENCE_FORWARD_READY=1
LEGACY_COMPATIBILITY_LINKS_INSTALLED=0
CANDIDATE_CURRENT_LINK_IDENTITY=10:20:30
CANDIDATE_RUNTIME_IDENTITY=40:50:60
CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY=1:2:3:4:5:6:7
CANDIDATE_ENVIRONMENT_FILE_IDENTITY=1:2:3:4:5:6:7:8
CANDIDATE_ENVIRONMENT_SHA256=${"a".repeat(64)}
CANDIDATE_SUPABASE_INTERNAL_URL_B64=aW50ZXJuYWw=
CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64=cHVibGlj
CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64=Zml4dHVyZQ==
CANDIDATE_STAFF_ROLLOUT_STATUS=explicit
CANDIDATE_STAFF_MODE_B64=b2Zm
CANDIDATE_STAFF_SITE_IDS_B64=-
CANDIDATE_PORTAL_ORIGIN_B64=cG9ydGFs
CANDIDATE_BUILD_FILE_IDENTITY=8:7:6:5:4:3:2:1
CANDIDATE_BUILD_FILE_SHA256=${"b".repeat(64)}
CANDIDATE_WEB_PID=123
CANDIDATE_WEB_PROCESS_START_TICKS=456
CANDIDATE_WEB_PROCESS_IDENTITY=70:80
CANDIDATE_WEB_CWD_IDENTITY=40:50:60
CANDIDATE_WEB_HANDOFF_STATE=exact
CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64=cHJvb2Y=
[ "$DRIFT" != fence ] || READINESS_FENCE_FORWARD_READY=0

record() { printf '%s\n' "$1" >> "$TRACE"; }
readlink() {
  local target; for target; do :; done
  case "$target" in "$CURRENT_LINK"|"/proc/123/cwd") printf '%s\n' "$RELEASE_DIR" ;; *) return 97 ;; esac
}
stat() {
  local target; for target; do :; done
  case "$target" in
    "$CURRENT_LINK") printf '%s\n' 10:20:30 ;;
    "$RELEASE_DIR") printf '%s\n' 40:50:60 ;;
    /proc/123/cwd) if [ "$DRIFT" = cwd ]; then printf '%s\n' 40:51:60; else printf '%s\n' 40:50:60; fi ;;
    /proc/123) if [ "$DRIFT" = process ]; then printf '%s\n' 70:81; else printf '%s\n' 70:80; fi ;;
    *) return 97 ;;
  esac
}
pm2_process_snapshot() {
  [ "$2" = 60 ] || return 97
  case "$1" in
    "$APP_NAME") record snapshot:web; printf '%s\n' running:123 ;;
    "$AUTOMATION_WORKER_NAME") record snapshot:worker; printf '%s\n' absent ;;
    *) return 97 ;;
  esac
  # A private file carries synthetic time across command-substitution subshells.
  # There is no sleep or claim that one real snapshot costs this many seconds.
  printf '%s' "$(( $(<"$CLOCK") + SNAPSHOT_SECONDS ))" > "$CLOCK"
}
linux_process_start_ticks() { [ "$1" = 123 ] && [ "$2" = 60 ] || return 97; printf '%s\n' 456; }
read_candidate_environment_snapshot_for_booking_retry() {
  [ "$1" = 60 ] || return 97
  local digest="$CANDIDATE_ENVIRONMENT_SHA256"
  [ "$DRIFT" != environment ] || digest=${"c".repeat(64)}
  printf '%s\n' "$CANDIDATE_ENVIRONMENT_DIRECTORY_IDENTITY" "$CANDIDATE_ENVIRONMENT_FILE_IDENTITY" \
    "$digest" "$CANDIDATE_SUPABASE_INTERNAL_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64" \
    "$CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" explicit "$CANDIDATE_STAFF_MODE_B64" - "$CANDIDATE_PORTAL_ORIGIN_B64"
}
read_candidate_build_id_snapshot_for_booking_retry() {
  [ "$1" = 60 ] || return 97
  printf '%s\n' "$CANDIDATE_BUILD_FILE_IDENTITY" "$CANDIDATE_BUILD_FILE_SHA256"
}
read_candidate_process_environment_snapshot_for_booking_retry() {
  [ "$1" = 60 ] || return 97
  printf '%s\n' present present 456 "$CANDIDATE_SUPABASE_INTERNAL_URL_B64" "$CANDIDATE_NEXT_PUBLIC_SUPABASE_URL_B64" \
    "$CANDIDATE_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64" "$CANDIDATE_STAFF_MODE_B64" - "$CANDIDATE_PORTAL_ORIGIN_B64"
}
assert_readiness_fence_before_forward_operation() {
  [ "$2" = 60 ] && [ "$1" -eq $((60 - SECONDS)) ] || return 97
  record fence:before
}
assert_readiness_fence_forward_checkpoint() { [ "$1" = 60 ] || return 97; record fence:after; }
assert_candidate_web_health() { [ "$1" = 60 ] || return 97; record health; }
verify_booking_persistence() {
  [ "$2" = 60 ] && [ "$1" -eq $((60 - SECONDS)) ] || return 97
  record "query:$1"
  return 0
}

# Unsetting Bash's special SECONDS creates a regular deterministic variable.
# DEBUG/functrace synchronizes only the parent shell before its actual checks;
# neither production function nor its state decision is replaced or rewritten.
unset SECONDS
SECONDS=$(<"$CLOCK")
set -T
trap 'if [ "$BASH_SUBSHELL" -eq 0 ]; then SECONDS=$(<"$CLOCK"); fi' DEBUG
status=1
if capture_candidate_web_identity_for_booking_retry 60; then
  if verify_booking_persistence_with_bounded_retry 60; then status=0; fi
fi
printf '__result__ %s %s\n' "$status" "$SECONDS"
`;
    const result = spawnSync(bash, ["-s"], {
      input: script, encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true,
      // No application environment or configured credentials are inherited.
      env: { PATH: process.platform === "win32" ? "C:/Program Files/Git/usr/bin" : "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stderr.split("\n").filter(Boolean).every((line) =>
      /^\[deploy\] booking_persistence_diagnostic stage=[a-z_]+ code=[a-z_]+ elapsed_seconds=[0-9]+$/.test(line)), result.stderr);
    const match = result.stdout.match(/__result__ ([01]) ([0-9]+)\n$/);
    assert.ok(match, result.stdout);
    return {
      status: Number(match[1]), seconds: Number(match[2]),
      trace: readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean),
      diagnostics: result.stderr, stdout: result.stdout,
    };
  } finally {
    // Exactly this mkdtemp-owned child; never a repository or runtime directory.
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("faolla-booking-budget-"));
    rmSync(target, { recursive: true });
  }
}

const snapshots = (trace) => trace.filter((item) => item.startsWith("snapshot:"));
test("actual composed capture/state/retry observes 17 snapshots before query and 29 for one success", () => {
  const result = run();
  assert.equal(result.status, 0);
  const query = result.trace.indexOf("query:60");
  assert.ok(query >= 0);
  assert.equal(snapshots(result.trace.slice(0, query)).length, 17);
  assert.equal(snapshots(result.trace).length, 29);
  assert.equal(result.trace.filter((item) => item.startsWith("query:")).length, 1);
  assert.equal(result.trace.filter((item) => item === "health").length, 2);
  assert.deepEqual(result.trace.filter((item) => item.startsWith("fence:")), ["fence:before", "fence:after"]);
  assert.equal(result.seconds, 0);
});

test("synthetic snapshot costs exercise the real 25-second pre-query reserve, not production elapsed time", () => {
  const fits = run({ snapshotSeconds: 2 });
  assert.equal(fits.status, 0);
  assert.ok(fits.trace.includes("query:26"));
  assert.equal(snapshots(fits.trace).length, 29);
  assert.equal(fits.seconds, 58);
  for (const options of [{ snapshotSeconds: 2, initialSeconds: 1 }, { snapshotSeconds: 3 }]) {
    const rejected = run(options);
    assert.equal(rejected.status, 1);
    assert.equal(snapshots(rejected.trace).length, 17);
    assert.equal(rejected.trace.some((item) => item.startsWith("query:")), false);
    assert.equal(rejected.seconds, 17 * options.snapshotSeconds + (options.initialSeconds ?? 0));
    assert.match(rejected.diagnostics, /stage=retry_reserve code=failed/);
    assert.match(rejected.stdout, /deploy_forward_booking_persistence_state_failed/);
  }
});

test("the composed state checks still reject synthetic cwd, process, fence and environment drift before query", () => {
  for (const drift of ["cwd", "process", "fence", "environment"]) {
    const result = run({ drift });
    assert.equal(result.status, 1, drift);
    assert.equal(result.trace.some((item) => item.startsWith("query:")), false, drift);
    assert.match(result.diagnostics, /code=failed/, drift);
  }
});
