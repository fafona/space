import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const emitter = workflow.match(/^ {10}emit_safe_deploy_diagnostics\(\) \{[\s\S]*?^ {10}\}(?=\r?\n {10}trap cleanup_deploy_capture EXIT)/m)?.[0]
  .replace(/^ {10}/gm, "");
assert.ok(emitter, "exercise the actual workflow emitter, not a copied parser");
const verdict = workflow.match(/^ {10}set -e\r?\n {10}if \[ "\$ssh_status" != "0" \][\s\S]*?(?=\r?\n\r?\n {6}- name: Verify Public Release)/m)?.[0]
  .replace(/^ {10}/gm, "");
assert.ok(verdict, "exercise the actual saved transport verdict after optional diagnostics");
const stages = [
  "current_capture", "current_capture_preconditions", "current_capture_stat", "current_capture_environment",
  "current_capture_build", "current_capture_shape", "current_capture_staff_mode", "current_capture_staff_sites",
  "current_capture_portal", "current_capture_rollout", "current_capture_final", "web_capture",
  "web_capture_preconditions", "web_capture_snapshot", "web_capture_ticks", "web_capture_identity",
  "web_capture_state", "state_preconditions", "state_worker_before", "state_web_before", "state_process_before",
  "state_environment", "state_build", "state_file_comparison", "state_process_environment",
  "state_environment_comparison", "state_current_after", "state_worker_after", "state_web_after", "state_process_after",
  "retry_deadline", "retry_state_before", "retry_remaining", "retry_fence_before", "retry_state_after_fence",
  "retry_health_before", "retry_state_after_health", "retry_reserve", "query", "retry_state_after_query",
  "retry_fence_after", "retry_state_final_fence", "retry_health_after", "retry_state_final_health",
  "retry_attempts", "retry_delay_budget", "retry_delay", "retry_exhausted",
];
const codes = ["start", "passed", "failed", "hard_failed", "transient", "invocation_failed", "integrity_failed", "unexpected_status"];
const line = (stage = "retry_reserve", code = "failed", seconds = 35) =>
  `[deploy] booking_persistence_diagnostic stage=${stage} code=${code} elapsed_seconds=${seconds}`;
const fenceStages = ["checkpoint_arguments", "checkpoint_deadline", "checkpoint_state",
  "checkpoint_identity_before", "checkpoint_marker", "checkpoint_remaining", "checkpoint_database",
  "checkpoint_identity_after", "checkpoint_deadline_after", "database_arguments", "database_budget",
  "database_command", "database_deadline", "database_result", "marker_file", "marker_canonical", "marker_binding",
  "marker_hold_budget", "marker_database", "marker_locks", "marker_context", "marker_endpoint", "marker_digest"];
const fenceCodes = ["start", "passed", "failed", "held", "blocked_cancelled", "quiescing", "not_held", "unexpected_status"];
const fenceLine = (stage = "checkpoint_database", code = "failed", seconds = 1) =>
  `[deploy] readiness_fence_diagnostic stage=${stage} code=${code} elapsed_seconds=${seconds}`;
const bash = (process.platform === "win32"
  ? ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe"]
  : ["bash"]).find((path) => spawnSync(path, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0);
assert.ok(bash, "Bash is required; do not silently skip the log transport contract");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const shellPath = (value) => process.platform === "win32"
  ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`)
  : value;

async function emit(stderr, stdout = "", options = {}) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "faolla-diagnostic-transport-"));
  try {
    const stderrPath = join(directory, "stderr.log");
    const stdoutPath = join(directory, "stdout.log");
    await writeFile(stderrPath, stderr);
    await writeFile(stdoutPath, stdout);
    const result = spawnSync(bash, ["-s"], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 262144, windowsHide: true,
      input: ["set -euo pipefail", emitter,
        `deploy_stderr_file=${shellQuote(shellPath(stderrPath))}`,
        `deploy_stdout_file=${shellQuote(shellPath(stdoutPath))}`,
        options.nodeExit === undefined ? "" : `node() { printf 'PRIVATE_INTERPRETER_ERROR\\n' >&2; return ${options.nodeExit}; }`,
        ...(options.verdict ? [
          `ssh_status=${options.verdict.ssh}`,
          `frame_status=${options.verdict.frame}`,
          "stdout_capture_status=0", "stderr_capture_status=0", verdict,
        ] : ["emit_safe_deploy_diagnostics"]), ""].join("\n"),
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, options.expectedStatus ?? 0, result.stderr);
    assert.equal(result.stderr, "", "the filter must not expose raw errors on stderr");
    return result.stdout;
  } finally {
    assert.equal(dirname(resolve(directory)), parent);
    assert.ok(resolve(directory).startsWith(join(parent, "faolla-diagnostic-transport-")));
    await rm(directory, { recursive: true, force: true });
  }
}

test("workflow retains every fixed booking stage and code, including boundary seconds", async () => {
  const rows = stages.map((stage, index) => line(stage, codes[index % codes.length], index));
  rows.push(line("web_capture", "start", 0), line("web_capture", "failed", 86400));
  assert.equal(await emit(rows.join("\n") + "\n"), rows.join("\n") + "\n");
});

test("workflow rejects malformed, secret-bearing, binary, and workflow-command diagnostics", async () => {
  const valid = line();
  const invalid = [
    line("arbitrary_secret"), line("retry_reserve", "SECRET"),
    ...["-1", "01", "86401", "100000", "NaN", "Infinity", "1.5", "+1", "1e3", ""].map((seconds) => line("query", "failed", seconds)),
    `prefix ${valid}`, `${valid} suffix`, `${valid} token=PRIVATE`,
    `\u001b[31m${valid}\u001b[0m`, `${valid}\r`, `${valid}\0`, `\0${valid}`,
    valid.replace("stage=", "stage=\0"), valid.replace("elapsed_seconds=", "elapsed_seconds=\0"),
    "::error::PRIVATE", "::add-mask::PRIVATE", "PRIVATE_DO_NOT_PRINT", "x".repeat(200000),
  ];
  assert.equal(await emit(invalid.join("\n") + "\n" + valid + "\n"), valid + "\n");
});

test("workflow preserves every fixed fence stage and code interleaved with booking observations", async () => {
  for (let offset = 0; offset < fenceStages.length; offset += 14) {
    const rows = [line("retry_fence_before", "start", 0),
      ...fenceStages.slice(offset, offset + 14).flatMap((stage) => fenceCodes.map((code) => fenceLine(stage, code, 1))),
      fenceLine("checkpoint_marker", "failed", 86400), line("retry_fence_before", "failed", 1)];
    assert.equal(await emit(rows.join("\n") + "\n"), rows.join("\n") + "\n");
    assert.equal(await emit("", rows.join("\n") + "\n"), "", "details must only come from stderr");
  }
});

test("fence transport rejects arbitrary values and noncanonical lines without masking the saved failure", async () => {
  const valid = fenceLine();
  const invalid = [fenceLine("secret"), fenceLine("checkpoint_database", "secret"),
    fenceLine("query"), fenceLine("database_command", "hard_failed"),
    ...["-1", "01", "86401", "100000", "NaN", "Infinity", "1.5", "+1", "1e3", ""].map(
      (seconds) => fenceLine("database_command", "failed", seconds)),
    `prefix ${valid}`, `${valid} token=PRIVATE`, `${valid}\r`, `${valid}\0`,
    `\u001b[31m${valid}`, `::error::${valid}`, `\0${valid}`];
  assert.equal(await emit(invalid.join("\n") + "\n" + valid + "\n"), valid + "\n");
  assert.equal(await emit(valid + "\n", "", {
    verdict: { ssh: 23, frame: 0 }, expectedStatus: 23,
  }), valid + "\n[deploy] deploy_transport_or_remote_execution_failed\n");
});

test("mixed fence and booking diagnostics share the final-128 chronological limit", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => i % 2
    ? fenceLine("checkpoint_marker", "passed", i) : line("retry_fence_before", "start", i));
  assert.equal(await emit(rows.join("\n") + "\n"), rows.slice(-128).join("\n") + "\n");
});

test("workflow preserves repeated observation order and retains the final 128 valid lines", async () => {
  const rows = Array.from({ length: 300 }, (_, index) => line("state_worker_before", "passed", index));
  const failure = line("retry_reserve", "failed", 51);
  const all = [...rows, failure];
  const noisy = all.map((row) => `PRIVATE_NOISE\n${row}`).join("\n") + "\n";
  assert.equal(await emit(noisy), all.slice(-128).join("\n") + "\n");
});

test("legacy exact failure codes remain available while booking details only come from stderr", async () => {
  const legacy = "[deploy] deploy_forward_booking_persistence_state_failed";
  const detail = line();
  assert.equal(await emit(detail + "\n", legacy + "\n" + line("query", "passed", 0) + "\n"),
    legacy + "\n" + detail + "\n");
  assert.equal(await emit("", detail + "\n"), "");
  assert.equal(await emit(""), "");
});

test("oversized optional captures do not expose contents", async () => {
  assert.equal(await emit("x".repeat(1048576) + "\n" + line() + "\n"), "");
});

test("optional interpreter failure never replaces saved SSH or frame failure", async () => {
  const legacy = "[deploy] deploy_forward_booking_persistence_state_failed";
  for (const nodeExit of [42, 127, 137]) {
    for (const transport of [{ ssh: 23, frame: 0 }, { ssh: 0, frame: 31 }]) {
      assert.equal(await emit(line() + "\n", legacy + "\n", {
        nodeExit, verdict: transport, expectedStatus: transport.ssh || transport.frame,
      }), legacy + "\n[deploy] deploy_transport_or_remote_execution_failed\n");
    }
  }
});
