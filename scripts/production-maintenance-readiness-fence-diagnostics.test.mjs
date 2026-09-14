import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const stages = "checkpoint_arguments checkpoint_deadline checkpoint_state checkpoint_identity_before checkpoint_marker checkpoint_remaining checkpoint_database checkpoint_identity_after checkpoint_deadline_after database_arguments database_budget database_command database_deadline database_result marker_file marker_canonical marker_binding marker_hold_budget marker_database marker_locks marker_context marker_endpoint marker_digest".split(" ");
const codes = "start passed failed held blocked_cancelled quiescing not_held unexpected_status".split(" ");
function region(start, end) {
  const a = source.indexOf(start + "() {"), b = source.indexOf("\n" + end + "() {", a);
  assert(a >= 0 && b > a, start); return source.slice(a, b);
}
const logger = region("readiness_fence_diagnostic", "assert_readiness_fence_database_locks");
const budget = region("deadline_bounded_command_timeout_seconds", "linux_process_start_ticks");
const database = region("assert_readiness_fence_database_locks", "readiness_fence_process_identity_sha256");
const held = region("assert_readiness_fence_held", "assert_readiness_fence_held_with_bounded_retry");
const retry = region("assert_readiness_fence_held_with_bounded_retry", "readiness_fence_process_quiescence_checkpoint");
const forward = region("assert_readiness_fence_forward_checkpoint", "assert_readiness_fence_before_process_quiescence");
const defaults = `
READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS=15
READINESS_FENCE_ROLLBACK_RESERVE_SECONDS=780
READINESS_FENCE_OPERATION_MARGIN_SECONDS=10
READINESS_FENCE_FORWARD_READY=1
READINESS_FENCE_ACTIVE=1
READINESS_FENCE_RELEASED=0
READINESS_FENCE_APPLICATION_NAME=synthetic
READINESS_FENCE_BACKEND_PID=101
RELEASE_DATABASE_CONTAINER_ID=synthetic
identity_calls=0; marker_calls=0; database_calls=0
readiness_fence_process_identity_matches() { identity_calls=$((identity_calls+1)); return 0; }
validate_readiness_fence_marker() { marker_calls=$((marker_calls+1)); return 0; }
assert_readiness_fence_database_locks() { database_calls=$((database_calls+1)); return 0; }
`;
function run(script, functions = held, logging = true) {
  const result = spawnSync(bash, ["-s"], {
    input: ["set +e\nunset SECONDS; SECONDS=0", logging ? logger : "readiness_fence_diagnostic() { :; }", budget, defaults, functions, script].join("\n"),
    encoding: "utf8", timeout: 10000, maxBuffer: 65536, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  const lines = result.stderr.trimEnd() ? result.stderr.trimEnd().split("\n") : [];
  const diagnostics = lines.map(line => {
    const match = /^\[deploy\] readiness_fence_diagnostic stage=([a-z_]+) code=([a-z_]+) elapsed_seconds=(0|[1-9][0-9]{0,4})$/.exec(line);
    assert(match, line); assert(stages.includes(match[1]), line); assert(codes.includes(match[2]), line); assert(Number(match[3]) <= 86400);
    return { stage: match[1], code: match[2], seconds: Number(match[3]) };
  });
  assert.doesNotMatch(result.stderr, /SECRET|Bearer|\/private|postgres:|synthetic|101/);
  return { ...result, diagnostics };
}
const has = (result, stage, code) => assert(result.diagnostics.some(row => row.stage === stage && row.code === code), `${stage}:${code}`);
const verdict = command => `if ${command}; then status=0; else status=$?; fi\nprintf 'RESULT %s %s %s %s\\n' "$status" "$identity_calls" "$marker_calls" "$database_calls"\n`;

test("fence diagnostics are fixed, bounded, stderr-only and failure-insensitive Bash builtins", () => {
  assert.doesNotMatch(logger, /\b(?:node|docker|timeout|sleep|cat|date|stat|readlink)\b/);
  for (const stage of stages) {
    const result = run(`SECONDS=7; readiness_fence_diagnostic ${stage} passed 2`, "");
    assert.equal(result.stdout, ""); assert.deepEqual(result.diagnostics, [{ stage, code: "passed", seconds: 5 }]);
  }
  for (const args of ["unknown passed 0", "checkpoint_marker SECRET 0", "checkpoint_marker passed -1", "checkpoint_marker passed 01"]) {
    assert.equal(run("readiness_fence_diagnostic " + args, "").stderr, "");
  }
  assert.equal(run("SECONDS=86401; readiness_fence_diagnostic checkpoint_marker passed 0", "").stderr, "");
  assert.equal(run("SECONDS=1; readiness_fence_diagnostic checkpoint_marker passed 2", "").stderr, "");
  const broken = run("printf() { return 42; }; readiness_fence_diagnostic checkpoint_marker passed 0; [ \"$?\" -eq 0 ]", "");
  assert.equal(broken.stderr, "");
});

test("every checkpoint first-failure branch identifies its stage without changing call order", () => {
  const cases = [
    ["", "assert_readiness_fence_held 795 0", "checkpoint_arguments", "RESULT 1 0 0 0\n"],
    ["", "assert_readiness_fence_held 795 15 invalid", "checkpoint_deadline", "RESULT 1 0 0 0\n"],
    ["READINESS_FENCE_ACTIVE=0", "assert_readiness_fence_held 795 15", "checkpoint_state", "RESULT 1 0 0 0\n"],
    ["readiness_fence_process_identity_matches() { identity_calls=$((identity_calls+1)); return 1; }", "assert_readiness_fence_held 795 15", "checkpoint_identity_before", "RESULT 1 1 0 0\n"],
    ["validate_readiness_fence_marker() { marker_calls=$((marker_calls+1)); return 1; }", "assert_readiness_fence_held 795 15", "checkpoint_marker", "RESULT 1 1 1 0\n"],
    ["validate_readiness_fence_marker() { marker_calls=$((marker_calls+1)); SECONDS=15; return 0; }", "assert_readiness_fence_held 795 15", "checkpoint_remaining", "RESULT 1 1 1 0\n"],
    ["assert_readiness_fence_database_locks() { database_calls=$((database_calls+1)); return 1; }", "assert_readiness_fence_held 795 15", "checkpoint_database", "RESULT 1 1 1 1\n"],
    ["readiness_fence_process_identity_matches() { identity_calls=$((identity_calls+1)); [ \"$identity_calls\" -eq 1 ]; }", "assert_readiness_fence_held 795 15", "checkpoint_identity_after", "RESULT 1 2 1 1\n"],
    ["readiness_fence_process_identity_matches() { identity_calls=$((identity_calls+1)); if [ \"$identity_calls\" -eq 2 ]; then SECONDS=15; fi; return 0; }", "assert_readiness_fence_held 795 15", "checkpoint_deadline_after", "RESULT 1 2 1 1\n"],
  ];
  for (const [setup, command, stage, expected] of cases) {
    const result = run(setup + "\n" + verdict(command));
    assert.equal(result.stdout, expected, stage); has(result, stage, "failed");
    assert.equal(result.diagnostics.filter(row => row.code === "failed").length, 1, stage);
  }
  for (const status of [0, 2]) {
    const result = run(`assert_readiness_fence_database_locks() { database_calls=$((database_calls+1)); return ${status}; }\n` + verdict("assert_readiness_fence_held 795 15"));
    assert.equal(result.stdout, `RESULT ${status} 2 1 1\n`); has(result, "checkpoint_deadline_after", "passed");
  }
});

const databaseBoundary = `
timeout() { while [[ "$1" == --* || "$1" == [0-9]*s ]]; do shift; done; "$@"; }
docker() { printf '%s\\n' "$SYNTHETIC_DATABASE_RESULT"; return "$SYNTHETIC_DATABASE_EXIT"; }
SYNTHETIC_DATABASE_RESULT=held; SYNTHETIC_DATABASE_EXIT=0
`;
test("real database shell preserves all output/status mappings and never copies unknown output", () => {
  for (const [value, allow, status, code] of [
    ["held", 0, 0, "held"], ["held", 1, 0, "held"], ["quiescing", 1, 2, "quiescing"], ["quiescing", 0, 1, "quiescing"],
    ["blocked_cancelled", 0, 2, "blocked_cancelled"], ["blocked_cancelled", 1, 1, "blocked_cancelled"],
    ["not_held", 0, 1, "not_held"], ["SECRET/private", 0, 1, "unexpected_status"], ["", 0, 1, "unexpected_status"],
  ]) {
    const result = run(databaseBoundary + `\nSYNTHETIC_DATABASE_RESULT='${value}'\n` + verdict(`assert_readiness_fence_database_locks ${allow} 15 15`), database);
    assert.equal(result.stdout, `RESULT ${status} 0 0 0\n`); has(result, "database_result", code);
  }
  for (const status of [1, 42, 124, 137, 255]) {
    const result = run(databaseBoundary + `\nSYNTHETIC_DATABASE_EXIT=${status}; SYNTHETIC_DATABASE_RESULT=SECRET\n` + verdict("assert_readiness_fence_database_locks 0 15 15"), database);
    assert.equal(result.stdout, "RESULT 1 0 0 0\n"); has(result, "database_command", "failed");
    assert(!result.diagnostics.some(row => row.stage === "database_result"));
  }
});

test("database argument and budget failures still prevent command execution", () => {
  for (const [command, stage] of [["assert_readiness_fence_database_locks invalid 15", "database_arguments"],
    ["assert_readiness_fence_database_locks 0 16", "database_arguments"], ["assert_readiness_fence_database_locks 0 15 6", "database_budget"]]) {
    const result = run("timeout() { printf COMMAND_MUST_NOT_RUN; return 99; }\n" + verdict(command), database);
    assert.equal(result.stdout, "RESULT 1 0 0 0\n"); has(result, stage, "failed");
  }
  // The normal command allocation leaves six seconds of kill/launch reserve.
  const result = run(databaseBoundary + "\ntimeout() { sleep 1; printf held; }\n" + verdict("assert_readiness_fence_database_locks 0 1 7"), database);
  assert.equal(result.stdout, "RESULT 0 0 0 0\n"); has(result, "database_deadline", "passed");
  // This fixture uses a non-ticking SECONDS variable. Advance its injected
  // clock immediately after the synthetic command, before the original gate.
  const expired = run(databaseBoundary + `\nset -T\ntrap 'if [[ "$BASH_COMMAND" == "readiness_fence_diagnostic database_command passed "* ]]; then SECONDS=7; fi' DEBUG\n` + verdict("assert_readiness_fence_database_locks 0 1 7"), database);
  assert.equal(expired.stdout, "RESULT 1 0 0 0\n"); has(expired, "database_deadline", "failed");
});

test("real and no-op logger fault matrix preserves exact commands, counts, stdout and status", () => {
  const identity = `readiness_fence_process_identity_matches() {
    identity_calls=$((identity_calls+1)); printf 'IDENTITY %s\\n' "$identity_calls"
    [ "$identity_calls" -ne "$FAIL_IDENTITY" ]
  }`;
  const marker = `validate_readiness_fence_marker() {
    marker_calls=$((marker_calls+1)); printf 'MARKER %s %s\\n' "$1" "$2"
    [ "$FAIL_MARKER" -eq 0 ]
  }`;
  const boundary = `exec 3>&1
timeout() { printf 'COMMAND %s %s %s\\n' "$1" "$2" "$3" >&3; while [[ "$1" == --* || "$1" == [0-9]*s ]]; do shift; done; "$@"; }
docker() { printf 'DATABASE %s %s %s\\n' "$1" "$2" "$3" >&3; printf '%s\\n' "$SYNTHETIC_DATABASE_RESULT"; return "$SYNTHETIC_DATABASE_EXIT"; }
FAIL_IDENTITY=0; FAIL_MARKER=0; SYNTHETIC_DATABASE_RESULT=held; SYNTHETIC_DATABASE_EXIT=0
`;
  const cases = [
    ["", "795 15"], ["", "795 0"], ["", "795 15 invalid"],
    ["READINESS_FENCE_ACTIVE=0", "795 15"], ["READINESS_FENCE_RELEASED=1", "795 15"],
    ["FAIL_IDENTITY=1", "795 15"], ["FAIL_IDENTITY=2", "795 15"], ["FAIL_MARKER=1", "795 15"],
    ["SYNTHETIC_DATABASE_EXIT=42", "795 15"], ["SYNTHETIC_DATABASE_EXIT=124", "795 15"],
    ["SYNTHETIC_DATABASE_RESULT=blocked_cancelled", "795 15"], ["SYNTHETIC_DATABASE_RESULT=quiescing", "795 15"],
    ["SYNTHETIC_DATABASE_RESULT=not_held", "795 15"], ["SYNTHETIC_DATABASE_RESULT=SECRET", "795 15"],
  ];
  for (const [setup, args] of cases) {
    const script = [identity, marker, boundary, setup, verdict("assert_readiness_fence_held " + args)].join("\n");
    const real = run(script, [database, held].join("\n"));
    const noop = run(script, [database, held].join("\n"), false);
    assert.equal(noop.stderr, "");
    assert.equal(real.status, noop.status); assert.equal(real.stdout, noop.stdout, setup + args);
  }
});

test("full actual checkpoint SQL, marker plumbing, retry and observer compose without dynamic-local collisions", () => {
  const observer = region("booking_persistence_diagnostic", "capture_candidate_current_identity_for_booking_retry");
  const booking = region("verify_booking_persistence_with_bounded_retry", "validate_readiness_fence_marker");
  const marker = region("validate_readiness_fence_marker", "readiness_fence_diagnostic");
  const process = [region("readiness_fence_process_identity_sha256", "readiness_fence_process_start_ticks"),
    region("readiness_fence_process_identity_matches", "assert_readiness_fence_held")].join("\n");
  const setup = `
APP_DIR=/synthetic/app; PRODUCTION_MAINTENANCE_MODE=maintenance
READINESS_FENCE_PID=777; READINESS_FENCE_MAXIMUM_HOLD_SECONDS=1320
READINESS_FENCE_MARKER=/synthetic/ready.json; READINESS_FENCE_RELEASE_REQUEST=/synthetic/release.json
READINESS_FENCE_RELEASE_TOKEN=${"b".repeat(64)}
READINESS_FENCE_PROCESS_IDENTITY_SHA256=${"a".repeat(64)}
BOOKING_PERSISTENCE_RETRY_TOTAL_TIMEOUT_SECONDS=60; BOOKING_PERSISTENCE_TOTAL_TIMEOUT_SECONDS=60
BOOKING_PERSISTENCE_POST_PROOF_RESERVE_SECONDS=20; BOOKING_PERSISTENCE_FD_POST_PROOF_RESERVE_SECONDS=5
query_calls=0; state_calls=0
node() {
  if [ "$#" -eq 4 ]; then printf '%s' '${"a".repeat(64)}';
  elif [ "$#" -eq 6 ]; then printf 'READINESS_FENCE_BACKEND_PID\\0%s\\0READINESS_FENCE_APPLICATION_NAME\\0%s\\0READINESS_FENCE_MARKER_SHA256\\0%s\\0' 101 faolla_readiness_fence_777_${"b".repeat(24)} ${"d".repeat(64)};
  else return 97; fi
}
assert_booking_persistence_retry_state() { state_calls=$((state_calls+1)); [ "$1" = 60 ]; }
assert_candidate_web_health() { [ "$1" = 60 ]; }
verify_booking_persistence() { query_calls=$((query_calls+1)); [ "$2" = 60 ]; }
SECONDS=18
assert_readiness_fence_forward_checkpoint; prior=$?
# The booking diagnostics have their own dedicated tests; silence only that
# logging seam, preserving the actual observer and all checkpoint functions.
booking_persistence_diagnostic() { :; }
verify_booking_persistence_with_bounded_retry 60; status=$?
printf 'RESULT %s %s %s %s %s\\n' "$prior" "$status" "$query_calls" "$state_calls" "$READINESS_FENCE_BACKEND_PID"
`;
  const result = run(databaseBoundary + setup, [observer, booking, marker, database, process, held, retry, forward].join("\n"));
  assert.equal(result.stdout, "RESULT 0 0 1 6 101\n");
  assert.equal(result.diagnostics.filter(row => row.stage === "database_result" && row.code === "held").length, 3);
});

test("SQL bytes, checkpoint retry policy and cleanup behavior are unchanged", () => {
  const sql = database.slice(database.indexOf("<<'SQL'\n") + 8, database.indexOf("\nSQL\n"));
  assert.equal(Buffer.byteLength(sql), 4786);
  assert.equal(createHash("sha256").update(sql).digest("hex"), "6554b9d57438d986e88e43e0df3b4f5a4dc0a1d14216dec2ef9e20ee9023fb06");
  assert.match(retry, /local maximum_attempts=3/);
  assert.match(retry, /2\)[\s\S]*readiness_fence_waiter_cancelled_retry[\s\S]*sleep 1/);
  assert.match(forward, /READINESS_FENCE_ROLLBACK_RESERVE_SECONDS \+[\s\S]*READINESS_FENCE_CHECKPOINT_TIMEOUT_SECONDS \+[\s\S]*operation_timeout_seconds \+[\s\S]*READINESS_FENCE_OPERATION_MARGIN_SECONDS/);
  assert.doesNotMatch(held + database, /readiness_fence_safe_failure_record|report_readiness_fence_failure/);
  assert.doesNotMatch(region("discard_failed_readiness_fence", "assert_readiness_fence_held_for_rollback"), /readiness_fence_diagnostic|readiness_fence_safe_failure_record/);
});

const markerShell = region("validate_readiness_fence_marker", "readiness_fence_diagnostic");
const markerProgram = markerShell.slice(markerShell.indexOf("import { constants"), markerShell.indexOf("\nNODE\n"));
// Reverse only the reviewed diagnostic additions, then pin the exact original
// Node program. The old/new matrix runs both complete programs, not a rewritten
// predicate model, and does not require Git or a historical checkout in CI.
const oldMarkerProgram = markerProgram
  .replace(", realpathSync, writeSync }", ", realpathSync }")
  .replace(/let diagnosticStage = "marker_file";[\s\S]*?\nconst markerPath =/, "const fail = () => process.exit(1);\nconst markerPath =")
  .replace(/^diagnosticStage = "marker_[a-z_]+";\n/gm, "")
  .replace('marker.releaseRequestPathSha256 !== sha256(Buffer.from(releaseRequestPath, "utf8"))\n) fail();\nif (\n',
    'marker.releaseRequestPathSha256 !== sha256(Buffer.from(releaseRequestPath, "utf8")) ||\n')
  .replace('const maintenanceMode = process.argv[4] ?? "off";\ntry {\n', 'const maintenanceMode = process.argv[4] ?? "off";\n')
  .replace('} catch { fail(); }\nconst publicBaseSha =', 'const publicBaseSha =');
const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => value && typeof value === "object"
  ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))) : value;
function markerFixture() {
  const now = Date.parse("2026-09-14T01:00:00.000Z");
  const token = "b".repeat(64), markerPath = "/synthetic/marker.json", releasePath = "/synthetic/release.json";
  const env = {
    FAOLLA_EXPECTED_RELEASE_TOKEN: token, FAOLLA_EXPECTED_TARGET_SHA: "c".repeat(40),
    FAOLLA_EXPECTED_READINESS_RUN_ID: "123", FAOLLA_EXPECTED_READINESS_RUN_ATTEMPT: "1",
    FAOLLA_EXPECTED_READINESS_ARTIFACT_ID: "456", FAOLLA_EXPECTED_READINESS_ARTIFACT_DIGEST: "sha256:" + "d".repeat(64),
    FAOLLA_EXPECTED_ATTESTATION_SHA256: "e".repeat(64), FAOLLA_EXPECTED_HOLDER_PID: "777",
    FAOLLA_EXPECTED_MAXIMUM_HOLD_SECONDS: "1320", FAOLLA_EXPECTED_MINIMUM_HOLD_REMAINING_SECONDS: "865",
    FAOLLA_EXPECTED_DATABASE_CONTAINER_NAME: "synthetic", FAOLLA_EXPECTED_DATABASE_CONTAINER_ID: "f".repeat(64),
    FAOLLA_EXPECTED_DATABASE_OID: "5", FAOLLA_SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000/",
    FAOLLA_NEXT_PUBLIC_SUPABASE_URL: "https://faolla.com/",
  };
  const marker = {
    schemaVersion: 1, kind: "faolla.ordinary-account-cutover-readiness-fence.v1", targetSha: env.FAOLLA_EXPECTED_TARGET_SHA,
    readinessRunId: "123", readinessRunAttempt: "1", readinessArtifactId: "456",
    readinessArtifactDigest: env.FAOLLA_EXPECTED_READINESS_ARTIFACT_DIGEST, attestationSha256: env.FAOLLA_EXPECTED_ATTESTATION_SHA256,
    database: { containerName: "synthetic", containerId: "f".repeat(64), dbName: "postgres", dbOid: "5", systemId: "12345", primary: true },
    holderPid: "777", backendPid: "101", applicationName: "faolla_readiness_fence_777_" + "b".repeat(24),
    releaseToken: token, releaseTokenSha256: hash(token), releaseRequestPathSha256: hash(releasePath),
    endpointEvidence: ["internalRest", "internalAuth", "publicRest", "publicAuth"].map((probe, index) => ({
      probe, baseEndpointSha256: hash(index < 2 ? env.FAOLLA_SUPABASE_INTERNAL_URL : env.FAOLLA_NEXT_PUBLIC_SUPABASE_URL),
      endpointSha256: "a".repeat(64), serviceIdentitySha256: "a".repeat(64), databaseQuerySha256: "a".repeat(64),
      databaseOid: "5", relationOid: "123", schemaName: index % 2 ? "auth" : "public", relationName: index % 2 ? "users" : "pages",
      waiterPid: "456", databaseClockEpochMilliseconds: "1000", queryStartedAtEpochMilliseconds: "1000", blockingPids: ["101"],
    })),
    holdLocks: { authShareLockCount: "1", authAccessExclusiveLockCount: "0", pagesAccessExclusiveLockCount: "0", registryAccessExclusiveLockCount: "1" },
    startedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 1319000).toISOString(),
  };
  return { marker, env, now, markerPath, releasePath, mode: "maintenance", scripts: "/synthetic/scripts" };
}
function runMarker(program, fixture) {
  const bytes = fixture.bytes ?? JSON.stringify(canonical(fixture.marker)) + "\n";
  const config = { ...fixture, bytes: Buffer.from(bytes).toString("base64") };
  const control = `export function readMaintenanceProbeContext() {
    ${fixture.context === "throws" ? "throw new Error('SECRET private context');" : fixture.context === "null" ? "return null;" : "return { publicSupabaseUrl: 'https://faolla.com/' };"}
  }`;
  const gateway = `export function bindMaintenancePublicSupabaseUrl(raw, expected) {
    ${fixture.bindingThrows ? "throw new Error('SECRET gateway');" : "if (raw !== expected) throw new Error('SECRET mismatch'); return raw;"}
  }`;
  const dataUrl = text => "data:text/javascript;base64," + Buffer.from(text).toString("base64");
  // These two imports are the host-private-state I/O boundary. No production
  // controller, state file, credential or endpoint is accessed by this fixture.
  const executable = program
    .replace('import(pathToFileURL(`${scripts}/production-maintenance-control.mjs`).href)', `import(${JSON.stringify(dataUrl(control))})`)
    .replace('import(pathToFileURL(`${scripts}/maintenance-effective-public-gateway.mjs`).href)', `import(${JSON.stringify(dataUrl(gateway))})`);
  const bootstrap = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config = ${JSON.stringify(config)};
const originalWrite = fs.writeSync;
const calls = [];
process.on('exit', () => originalWrite(3, JSON.stringify(calls)));
const bytes = Buffer.from(config.bytes, 'base64');
const info = () => ({ dev: 1n, ino: 2n, nlink: config.links ? BigInt(config.links) : 1n, mode: config.modeBits ? BigInt(config.modeBits) : 0o100600n,
  size: BigInt(bytes.length), mtimeNs: 1n, isFile: () => !config.notFile, isSymbolicLink: () => !!config.symlink });
fs.lstatSync = () => { calls.push('lstat'); if (config.missing) throw new Error('SECRET missing'); const value = info(); if (config.drift && calls.filter(c => c === 'lstat').length > 1) value.ino = 3n; return value; };
fs.openSync = () => { calls.push('open'); return 99; };
fs.fstatSync = () => { calls.push('fstat'); return info(); };
fs.readFileSync = () => { calls.push('read'); return bytes; };
fs.closeSync = () => { calls.push('close'); };
fs.realpathSync = value => { calls.push('realpath'); return config.scriptsDrift ? '/other/scripts' : value; };
fs.writeSync = (fd, text) => { if (config.logFailure) throw new Error('SECRET log'); return originalWrite(fd, text); };
syncBuiltinESMExports();
Date.now = () => config.now;
process.env = config.env;
process.argv = ['node', '-', config.markerPath, config.releasePath, config.mode, config.scripts];
await import(${JSON.stringify(dataUrl(executable))});
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: bootstrap, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 131072,
    stdio: ["pipe", "pipe", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot ?? "" },
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { ...result, calls: JSON.parse(result.output[3]) };
}

test("actual old and new Node marker programs preserve gate verdicts, NUL bytes and I/O order", () => {
  assert.equal(Buffer.byteLength(oldMarkerProgram), 9552);
  assert.equal(hash(oldMarkerProgram), "c7ffcf057c1c5b8a4a87e32e775fc1be8c2c2473e9a078e5a1d61379cba66c0b");
  const cases = [
    ["valid maintenance", () => {}, null], ["valid off", f => { f.mode = "off"; }, null],
    ["missing", f => { f.missing = true; }, "marker_file"],
    ["links", f => { f.links = 2; }, "marker_file"], ["mode", f => { f.modeBits = 0o100644; }, "marker_file"],
    ["symlink", f => { f.symlink = true; }, "marker_file"], ["type", f => { f.notFile = true; }, "marker_file"],
    ["drift", f => { f.drift = true; }, "marker_file"],
    ["invalid JSON", f => { f.bytes = "SECRET"; }, "marker_canonical"],
    ["noncanonical", f => { f.bytes = JSON.stringify(f.marker); }, "marker_canonical"],
    ["extra key", f => { f.marker.extra = true; }, "marker_binding"],
    ["target", f => { f.marker.targetSha = "a".repeat(40); }, "marker_binding"],
    ["token", f => { f.env.FAOLLA_EXPECTED_RELEASE_TOKEN = "a".repeat(64); }, "marker_binding"],
    ["release path", f => { f.releasePath = "/synthetic/changed"; }, "marker_binding"],
    ["binding short circuits before invalid time", f => { f.marker.targetSha = "bad"; f.marker.startedAt = "bad"; }, "marker_binding"],
    ["invalid time", f => { f.marker.startedAt = "bad"; }, "marker_hold_budget"],
    ["wrong hold", f => { f.env.FAOLLA_EXPECTED_MAXIMUM_HOLD_SECONDS = "1321"; }, "marker_hold_budget"],
    ["future clock", f => { f.now -= 10000; }, "marker_hold_budget"],
    ["hold expired", f => { f.now += 500000; }, "marker_hold_budget"],
    ["database", f => { f.marker.database.dbOid = "6"; }, "marker_database"],
    ["locks", f => { f.marker.holdLocks.registryAccessExclusiveLockCount = "0"; }, "marker_locks"],
    ["endpoint count", f => { f.marker.endpointEvidence.pop(); }, "marker_endpoint"],
    ["internal URL", f => { f.env.FAOLLA_SUPABASE_INTERNAL_URL = "invalid"; }, "marker_endpoint"],
    ["context mode", f => { f.mode = "invalid"; }, "marker_context"],
    ["context path", f => { f.scriptsDrift = true; }, "marker_context"],
    ["context absent", f => { f.context = "null"; }, "marker_context"],
    ["context read/expiry exception", f => { f.context = "throws"; }, "marker_context"],
    ["context gateway exception", f => { f.bindingThrows = true; }, "marker_context"],
    ["endpoint digest", f => { f.marker.endpointEvidence[0].baseEndpointSha256 = "a".repeat(64); }, "marker_endpoint"],
    ["marker digest", f => { f.env.FAOLLA_EXPECTED_MARKER_SHA256 = "a".repeat(64); }, "marker_digest"],
    ["diagnostic write failure", f => { f.logFailure = true; f.missing = true; }, "silent"],
  ];
  for (const [name, mutate, stage] of cases) {
    const fixture = markerFixture(); mutate(fixture);
    const old = runMarker(oldMarkerProgram, fixture), current = runMarker(markerProgram, fixture);
    assert.equal(current.status, old.status, name); assert.equal(current.status, stage === null ? 0 : 1, name);
    assert.equal(current.stdout, old.stdout, name); assert.deepEqual(current.calls, old.calls, name);
    if (stage === null) {
      assert.equal(current.stderr, "", name);
      assert.equal(current.stdout.split("\0").length, 7, name);
    } else {
      assert.equal(current.stdout, "", name);
      if (stage === "silent") assert.equal(current.stderr, "", name);
      else assert.match(current.stderr, new RegExp(`^\\[deploy\\] readiness_fence_diagnostic stage=${stage} code=failed elapsed_seconds=(0|[1-9][0-9]{0,4})\\n$`), name);
    }
    assert.doesNotMatch(current.stderr, /SECRET|Bearer|\/synthetic|postgres|777|data:/, name);
  }
});
