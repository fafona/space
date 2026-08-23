import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const workflowPath = join(repositoryRoot, ".github", "workflows", "recover-failed-post-switch-deploy.yml");
const runtimePath = join(repositoryRoot, "scripts", "recover-failed-post-switch-production-runtime.sh");
const workflow = await readFile(workflowPath, "utf8");
const runtime = await readFile(runtimePath, "utf8");
const expectedRecoveryScriptMaxBytes = 262_144;

function loadYaml() {
  const require = createRequire(import.meta.url);
  try { return require("js-yaml"); } catch (error) {
    try { return require(join(dirname(repositoryRoot), "merchant-space", "node_modules", "js-yaml")); }
    catch { throw error; }
  }
}

function bashPath() {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"]
    : ["bash"];
  for (const candidate of candidates) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) return candidate;
  }
  throw new Error("bash unavailable");
}

function runBlocks(job) {
  return (job.steps ?? []).map((step) => step?.run).filter((value) => typeof value === "string");
}

function heredocs(source, tag) {
  const pattern = new RegExp(`<<-?["']?${tag}["']?\\r?\\n([\\s\\S]*?)\\r?\\n[\\t ]*${tag}(?=\\r?\\n|$)`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1].split(/\r?\n/).map((line) => line.replace(/^\t/, "")).join("\n"));
}

const parsed = loadYaml().load(workflow);
const jobs = Object.values(parsed.jobs ?? {});
assert.equal(jobs.length, 1);
const [job] = jobs;
const runs = runBlocks(job);
const allRuns = runs.join("\n");
const candidateEnvStages = [
  "candidate_env_file_identity",
  "candidate_env_encoding",
  "candidate_env_server_build_binding",
  "candidate_env_public_build_binding",
  "candidate_env_snapshot_contract",
];
const preRuntimeTrustedIdentityStages = [
  "incident_env_helper_identity",
  "frozen_scripts_identity",
  "frozen_smoke_helper_identity",
  "frozen_package_identity",
  "frozen_worker_identity",
];
const removedPreRuntimeIdentityStages = [
  "candidate_source_identity",
  "candidate_env_helper_identity",
];
const cleanupFailureReasons = [
  ["cleanup_failed_reason_switch_temp", "remote_cleanup_failed_reason_switch_temp"],
  ["cleanup_failed_reason_compensation_temp", "remote_cleanup_failed_reason_compensation_temp"],
  ["cleanup_failed_reason_fence_incomplete", "remote_cleanup_failed_reason_fence_incomplete"],
  ["cleanup_failed_reason_worker_cleanup", "remote_cleanup_failed_reason_worker_cleanup"],
  ["cleanup_failed_reason_web_cleanup", "remote_cleanup_failed_reason_web_cleanup"],
  ["cleanup_failed_reason_candidate_restore", "remote_cleanup_failed_reason_candidate_restore"],
  ["cleanup_failed_reason_precommit_verify", "remote_cleanup_failed_reason_precommit_verify"],
  ["cleanup_failed_reason_pm2_save", "remote_cleanup_failed_reason_pm2_save"],
];

test("workflow, shell, and embedded Node parse", () => {
  assert.equal(parsed.name, "Recover Failed Post-Switch Production Runtime");
  const bash = bashPath();
  for (const [index, source] of runs.entries()) {
    const result = spawnSync(bash, ["-n"], { input: source, encoding: "utf8" });
    assert.equal(result.status, 0, `bash block ${index + 1}: ${result.stderr}`);
  }
  const runtimeResult = spawnSync(bash, ["-n", runtimePath], { encoding: "utf8" });
  assert.equal(runtimeResult.status, 0, runtimeResult.stderr);
  const nodes = runs.flatMap((source) => heredocs(source, "NODE"));
  assert.ok(nodes.length >= 6);
  for (const [index, source] of nodes.entries()) {
    const result = spawnSync(process.execPath, ["--check", "--input-type=module", "-"], { input: source, encoding: "utf8" });
    assert.equal(result.status, 0, `node block ${index + 1}: ${result.stderr}`);
  }
});

test("manual entry is current-main-only, unique, attempt-one, and serialized", () => {
  const trigger = parsed.on ?? parsed.true;
  assert.deepEqual(Object.keys(trigger), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(trigger.workflow_dispatch.inputs).sort(), ["confirmation", "recovery_source_sha"]);
  assert.equal(parsed.concurrency.group, "production-deploy");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.deepEqual(parsed.permissions, { actions: "read", attestations: "read", contents: "read" });
  assert.match(allRuns, /GITHUB_REF" = "refs\/heads\/main/);
  assert.match(allRuns, /RECOVERY_SOURCE_SHA" = "\$GITHUB_SHA/);
  assert.match(allRuns, /GITHUB_RUN_ATTEMPT" = "1/);
  assert.match(allRuns, /workflow_runs\.length !== 1|page\.workflow_runs\.length !== 1/);
  assert.match(allRuns, /head_sha !== process\.env\.RECOVERY_SOURCE_SHA/);
  assert.match(allRuns, /run_attempt !== 1/);
  assert.doesNotMatch(workflow, /^\s*workflow_run:/m);
});

test("only the new machine interface is dispatchable", () => {
  assert.match(workflow, /RECOVER_FAILED_POST_SWITCH_DEPLOY_32625801433/);
  assert.match(workflow, /recover-failed-post-switch-deploy\.yml/);
  assert.match(workflow, /recover-failed-post-switch-production-runtime\.sh/);
  assert.match(workflow, /FAOLLA_FAILED_POST_SWITCH_RECOVERY_ENVELOPE_V1/);
  assert.doesNotMatch(runtime, /PRE[_-]FORWARD|PREFORWARD/i);
  assert.doesNotMatch(workflow, /PRE[_-]FORWARD|PREFORWARD/i);
  assert.match(workflow, /PRIOR_FAILED_RECOVERY_WORKFLOW_NAME: Recover Failed Post-Switch Production Runtime/);
  assert.match(workflow, /PRIOR_FAILED_RECOVERY_WORKFLOW_PATH: \.github\/workflows\/recover-failed-post-switch-deploy\.yml/);
});

test("new source has exactly one successful push CI and one recovery dispatch", () => {
  assert.match(allRuns, /actions\/workflows\/ci\.yml\/runs\?branch=main&event=push&head_sha=\$RECOVERY_SOURCE_SHA&per_page=2&page=1/);
  assert.match(allRuns, /actions\/workflows\/recover-failed-post-switch-deploy\.yml\/runs\?branch=main&event=workflow_dispatch&head_sha=\$RECOVERY_SOURCE_SHA&per_page=2&page=1/);
  assert.match(allRuns, /ci\.status !== "completed"/);
  assert.match(allRuns, /ci\.conclusion !== "success"/);
  assert.match(allRuns, /ci\.run_attempt !== 1/);
  assert.match(allRuns, /git rev-parse origin\/main/);
  assert.match(allRuns, /git status --porcelain=v1 --untracked-files=all/);
});

test("incident, readiness, and failed prior recovery metadata are exact", () => {
  assert.deepEqual(
    {
      runId: job.env.PRIOR_FAILED_RECOVERY_RUN_ID,
      runAttempt: job.env.PRIOR_FAILED_RECOVERY_RUN_ATTEMPT,
      sha: job.env.PRIOR_FAILED_RECOVERY_SHA,
    },
    {
      runId: "32630861830",
      runAttempt: "1",
      sha: "fe1be992a48204e8f2426615762273f14331ab83",
    },
  );
  for (const value of [
    "32625801433", "58c26e178faeb3eee0172a2e0aa487084f6910e4", "32625773494",
    "32630861830", "fe1be992a48204e8f2426615762273f14331ab83",
    "2a121454a18a16ae30e356977ca82b24a310e8e5",
  ]) assert.ok(workflow.includes(value));
  for (const obsolete of [
    "32613111789", "02db02135d2a376d624985831f5f0180cf813a29",
    "32615785237", "f1e565d39fbadf4429a1ed9d91b327528c37f6f8",
    "32627378516", "870e79ac1b5fd036bfd08b895284bc6a754a102a",
    "32597015446", "a628380757ccb5989702e42cb2868b2a48333be4", "32596977165",
  ]) {
    assert.ok(!workflow.includes(obsolete));
    assert.ok(!runtime.includes(obsolete));
  }
  assert.match(allRuns, /deploy\.conclusion !== "failure"/);
  assert.match(allRuns, /\[9, "Deploy To Server", "failure"\]/);
  assert.match(allRuns, /readiness\.conclusion !== "success"/);
  assert.match(allRuns, /failedRecovery\.conclusion !== "failure"/);
  assert.match(allRuns, /failedRecovery\.run_attempt !== 1/);
  const expectedFailedRecoverySteps = [
    [1, "Set up job", "success"],
    [2, "Validate Unique Manual Recovery Chain", "success"],
    [3, "Checkout Exact Recovery Source", "success"],
    [4, "Verify Exact Current Main Checkout", "success"],
    [5, "Validate Incident Deploy Readiness And Failed Recovery Boundary", "success"],
    [6, "Resolve Exact Readiness Artifact Inventory", "success"],
    [7, "Verify Canonical Historical Readiness Evidence", "success"],
    [8, "Setup Pinned SSH Recovery Alias", "success"],
    [9, "Revalidate Main And CI Immediately Before Recovery", "success"],
    [10, "Recover Frozen Production Runtime", "failure"],
    [11, "Verify Public Frozen Runtime Recovery", "skipped"],
    [22, "Post Checkout Exact Recovery Source", "success"],
    [23, "Complete job", "success"],
  ];
  for (const [number, name, conclusion] of expectedFailedRecoverySteps) {
    assert.ok(allRuns.includes(`[${number}, "${name}", "${conclusion}"]`));
  }
  assert.match(allRuns, /failedRecoveryStarted <= completedEpoch/);
  assert.doesNotMatch(allRuns, /failedRecoveryCompleted >= startedEpoch/);
  assert.match(allRuns, /values\.PRIOR_FAILED_RECOVERY_RUN_ID !== "32630861830"/);
  assert.match(allRuns, /values\.PRIOR_FAILED_RECOVERY_RUN_ATTEMPT !== "1"/);
  assert.match(
    allRuns,
    /values\.PRIOR_FAILED_RECOVERY_SHA !==\s+"fe1be992a48204e8f2426615762273f14331ab83"/,
  );
  const timeGate = allRuns.match(
    /if \(\s*(failedRecoveryCompleted <= failedRecoveryStarted \|\|[\s\S]*?failedRecoveryStarted <= completedEpoch)\s*\) fail\("prior_failed_recovery_time_window_invalid"\)/,
  );
  assert.ok(timeGate, "prior recovery temporal gate missing");
  assert.equal(
    timeGate[1].replace(/\s+/g, " ").trim(),
    "failedRecoveryCompleted <= failedRecoveryStarted || "
      + "failedRecoveryCompleted - failedRecoveryStarted > 1_800 || "
      + "failedRecoveryStarted <= completedEpoch",
  );
  const rejectsBoundary = (failedRecoveryStarted, failedRecoveryCompleted, completedEpoch) => (
    failedRecoveryCompleted <= failedRecoveryStarted
    || failedRecoveryCompleted - failedRecoveryStarted > 1_800
    || failedRecoveryStarted <= completedEpoch
  );
  assert.equal(rejectsBoundary(2_001, 2_100, 2_000), false);
  assert.equal(rejectsBoundary(2_000, 2_100, 2_000), true);
  assert.equal(rejectsBoundary(1_999, 2_100, 2_000), true);
  assert.equal(rejectsBoundary(2_001, 2_001, 2_000), true);
  assert.equal(rejectsBoundary(2_001, 3_802, 2_000), true);
  assert.equal(rejectsBoundary(1_787_477_010, 1_787_477_067, 1_787_470_436), false);
});

test("payload has nineteen exact keys including prior recovery and database identity", () => {
  assert.match(allRuns, /keys\.length !== 19/);
  for (const key of [
    "PRIOR_FAILED_RECOVERY_RUN_ID", "PRIOR_FAILED_RECOVERY_RUN_ATTEMPT",
    "PRIOR_FAILED_RECOVERY_SHA", "DATABASE_CONTAINER_ID", "DATABASE_CONTAINER_NAME",
    "DATABASE_NAME", "DATABASE_OID", "DATABASE_SYSTEM_ID", "DATABASE_PRIMARY",
  ]) assert.match(allRuns, new RegExp(`${key}:`));
  assert.match(allRuns, /JSON\.stringify\(Object\.fromEntries/);
  assert.match(allRuns, /writeFileSync[\s\S]*O_EXCL/);
  assert.match(allRuns, /payloadBytes\.length > 65_536/);
  assert.match(allRuns, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}\$/);
});

test("local and remote recovery envelopes share one bounded script budget", () => {
  const runtimeBytes = Buffer.byteLength(runtime, "utf8");
  assert.equal(job.env.RECOVERY_SCRIPT_MAX_BYTES, String(expectedRecoveryScriptMaxBytes));
  assert.ok(runtimeBytes > 0);
  assert.ok(runtimeBytes <= expectedRecoveryScriptMaxBytes);
  assert.ok(expectedRecoveryScriptMaxBytes <= 262_144);
  assert.match(allRuns, /test "\$expected_payload_bytes" -le 65536/);
  assert.match(allRuns, /ulimit -f 16/);
  assert.doesNotMatch(allRuns, /131072/);

  const remoteCaps = [...allRuns.matchAll(
    /test "\$expected_script_bytes" -le ([1-9][0-9]*)/g,
  )].map((match) => Number(match[1]));
  assert.deepEqual(remoteCaps, [expectedRecoveryScriptMaxBytes]);

  const validator = allRuns.match(
    /validate_recovery_script_size\(\) \{[\s\S]*?\n\s*\}/,
  )?.[0];
  assert.ok(validator, "local script-size validator missing");
  assert.equal(
    (validator.match(/recovery_failed_pre_transport_script_size/g) ?? []).length,
    1,
  );
  const invocation = allRuns.match(
    /if ! validate_recovery_script_size \\\n\s*"\$scriptBytes" "\$RECOVERY_SCRIPT_MAX_BYTES"; then\n\s*exit 1\n\s*fi/,
  )?.[0];
  assert.ok(invocation, "local script-size gate missing");
  assert.ok(allRuns.indexOf(invocation) < allRuns.indexOf('} > "$RECOVERY_ENVELOPE_PATH"'));
  assert.ok(allRuns.indexOf(invocation) < allRuns.indexOf("ssh -T -F"));
  assert.ok(!allRuns.includes("remote_recovery_failed_phase_pre_transport_script_size"));

  const exercise = (scriptBytes) => spawnSync(
    bashPath(),
    [
      "-c",
      `${validator}\nif ! validate_recovery_script_size "$1" "$2"; then exit 1; fi\nprintf '%s\\n' transport_called`,
      "recovery-size-test",
      String(scriptBytes),
      String(expectedRecoveryScriptMaxBytes),
    ],
    { encoding: "utf8" },
  );
  for (const size of [runtimeBytes, 138_146, expectedRecoveryScriptMaxBytes]) {
    const result = exercise(size);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "transport_called\n");
    assert.equal(result.stderr, "");
  }
  for (const size of [expectedRecoveryScriptMaxBytes + 1, 0, "not-a-number"]) {
    const result = exercise(size);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "recovery_failed_pre_transport_script_size\n");
    assert.equal(result.stderr, "");
  }
});

test("readiness evidence remains canonical, historical, and database-bound", () => {
  assert.match(allRuns, /total_count !== 2|page\.total_count !== 2/);
  assert.match(allRuns, /production-readiness-report/);
  assert.match(allRuns, /production-readiness-attestation/);
  assert.match(allRuns, /canonicalJsonBytes/);
  assert.match(allRuns, /database\.containerId/);
  assert.match(allRuns, /database\.systemId/);
  assert.match(allRuns, /database\.primary/);
  assert.match(allRuns, /nowMs:\s*Date\.parse\(issuedAt\)/);
});

test("SSH is pinned and all raw remote output stays hidden", () => {
  assert.match(allRuns, /Host faolla-incident-recovery/);
  assert.match(allRuns, /StrictHostKeyChecking yes/);
  assert.match(allRuns, /IdentitiesOnly yes/);
  assert.match(allRuns, /ForwardAgent no/);
  assert.match(allRuns, /ssh -T -F "\$SSH_CONFIG_PATH" "\$SSH_ALIAS"/);
  assert.match(allRuns, /> "\$RECOVERY_STDOUT_PATH" 2> "\$RECOVERY_STDERR_PATH"/);
  assert.match(allRuns, /2>\/dev\/null <<'NODE'[\s\S]*classification="recovery_output_invalid"/);
  assert.doesNotMatch(allRuns, /(?:cat|head|tail)\s+"?\$RECOVERY_STD(?:OUT|ERR)_PATH/);
  assert.doesNotMatch(allRuns, /set\s+-[A-Za-z]*x/);
  assert.doesNotMatch(allRuns, /upload-artifact/);
});

test("remote classifier exposes only the fixed post-switch phase allowlist", () => {
  const markers = [
    "fence_cleanup_verified", "candidate_state_verified", "candidate_processes_stopped",
    "current_frozen_release_verified", "frozen_web_restored",
    "worker_state_restored", "recovery_complete",
  ];
  for (const marker of markers) {
    assert.ok(allRuns.includes(`"${marker}"`));
    assert.ok(runtime.includes(`'${marker}'`));
  }
  for (const phase of [
    "pre_runtime_candidate_inventory", "pre_runtime_frozen_inventory",
    "pre_runtime_initial_current_target", "pre_runtime_initial_current_identity",
    "pre_runtime_initial_current_compatibility", "pre_runtime_initial_current_temporary_links",
    "pre_runtime_candidate_structure",
    ...preRuntimeTrustedIdentityStages.map((stage) => `pre_runtime_${stage}`),
    ...candidateEnvStages.map((stage) => `pre_runtime_${stage}`),
    "pre_runtime_candidate_next_build_identity",
    "pre_runtime_frozen_release_structure", "pre_runtime_frozen_env_build_binding",
    "pre_runtime_frozen_next_build_identity",
    "fence_cleanup", "fence_unlink", "fence_rmdir",
    "fence_post_inventory", "fence_post_database",
    "candidate_process_preflight", "candidate_stop", "current_switch", "current_resume",
    "web_restore_start", "web_restore_stability", "web_restore_identity",
    "web_restore_environment", "web_restore_launch_contract", "local_smoke",
    "worker_restore_start", "worker_restore_launch_contract", "persist_and_verify",
  ]) assert.ok(allRuns.includes(`remote_recovery_failed_phase_${phase}`), phase);
  const obsoleteCandidateEnvCode = [
    "remote_recovery_failed_phase_pre_runtime_candidate_env",
    "build_binding",
  ].join("_");
  assert.ok(!allRuns.includes(obsoleteCandidateEnvCode));
  for (const stage of removedPreRuntimeIdentityStages) {
    assert.ok(!allRuns.includes(stage), `workflow still exposes removed stage ${stage}`);
    assert.ok(!runtime.includes(stage), `runtime still emits removed stage ${stage}`);
  }
  assert.match(allRuns, /stdout\.equals\(expected\)/);
  assert.match(allRuns, /const cleanupFailureReasons = new Map/);
  assert.match(allRuns, /const firstNewline = stderr\.indexOf\(0x0a\)/);
  assert.doesNotMatch(allRuns, /cleanup_unverified/);
  assert.doesNotMatch(runtime, /cleanup_unverified/);
  assert.ok(!allRuns.includes("pre_runtime_candidate_current_link"));
  assert.ok(!runtime.includes("candidate_current_link"));
  assert.ok(!allRuns.includes("current_switched_to_frozen_release"));
  assert.ok(!runtime.includes("current_switched_to_frozen_release"));
  assert.match(allRuns, /recovery_output_invalid/);
  const runtimeCodes = new Set(
    [...runtime.matchAll(/'((?:recovery_failed_(?:pre_)?runtime)_[a-z_]+)'/g)]
      .map((match) => match[1]),
  );
  const classifiedCodes = new Set(
    [...allRuns.matchAll(/\["((?:recovery_failed_(?:pre_)?runtime)_[a-z_]+)",\s*"remote_recovery_failed_phase_/g)]
      .map((match) => match[1]),
  );
  assert.deepEqual(classifiedCodes, runtimeCodes);
  const runtimeCleanupReasons = new Set(
    [...runtime.matchAll(/'(cleanup_failed_reason_[a-z0-9_]+)'/g)]
      .map((match) => match[1])
      .filter((code) => code !== "cleanup_failed_reason_invalid"),
  );
  const classifiedCleanupReasons = new Set(
    [...allRuns.matchAll(/\["(cleanup_failed_reason_[a-z0-9_]+)", "remote_cleanup_failed_reason_[a-z0-9_]+"\]/g)]
      .map((match) => match[1]),
  );
  assert.equal(classifiedCleanupReasons.size, 8);
  assert.deepEqual(classifiedCleanupReasons, runtimeCleanupReasons);
});

test("every remote phase accepts only its uniquely bound stdout prefix", () => {
  const classifier = runs.flatMap((source) => heredocs(source, "NODE"))
    .find((source) => source.includes("const failureCodes = new Map"));
  assert.ok(classifier, "classifier missing");
  const mappings = [...classifier.matchAll(
    /\["(recovery_failed_(?:pre_)?runtime_[a-z_]+)", "(remote_recovery_failed_phase_[a-z_]+)", ([0-6])\]/g,
  )].map((match) => ({ remote: match[1], public: match[2], prefix: Number(match[3]) }));
  assert.equal(mappings.length, 51);
  assert.equal(new Set(mappings.map(({ remote }) => remote)).size, mappings.length);
  assert.equal(new Set(mappings.map(({ public: publicCode }) => publicCode)).size, mappings.length);
  const candidateEnvMappings = candidateEnvStages.map((stage) => ({
    remote: `recovery_failed_pre_runtime_${stage}`,
    public: `remote_recovery_failed_phase_pre_runtime_${stage}`,
    prefix: 0,
  }));
  for (const expected of candidateEnvMappings) {
    assert.deepEqual(mappings.find(({ remote }) => remote === expected.remote), expected);
  }
  const sourceIdentityMappings = preRuntimeTrustedIdentityStages.map((stage) => ({
    remote: `recovery_failed_pre_runtime_${stage}`,
    public: `remote_recovery_failed_phase_pre_runtime_${stage}`,
    prefix: 0,
  }));
  for (const expected of sourceIdentityMappings) {
    assert.deepEqual(mappings.find(({ remote }) => remote === expected.remote), expected);
  }
  const currentStateMappings = [
    "initial_current_target",
    "initial_current_identity",
    "initial_current_compatibility",
    "initial_current_temporary_links",
  ].map((stage) => ({
    remote: `recovery_failed_pre_runtime_${stage}`,
    public: `remote_recovery_failed_phase_pre_runtime_${stage}`,
    prefix: 0,
  }));
  currentStateMappings.push(
    {
      remote: "recovery_failed_runtime_current_switch",
      public: "remote_recovery_failed_phase_current_switch",
      prefix: 3,
    },
    {
      remote: "recovery_failed_runtime_current_resume",
      public: "remote_recovery_failed_phase_current_resume",
      prefix: 3,
    },
  );
  for (const expected of currentStateMappings) {
    assert.deepEqual(mappings.find(({ remote }) => remote === expected.remote), expected);
  }
  const phaseAllowlist = allRuns.match(
    /is_allowed_remote_failure_phase\(\) \{[\s\S]*?case "\$1" in([\s\S]*?)\n\s+\*\) return 1/,
  )?.[1];
  assert.ok(phaseAllowlist, "public phase allowlist missing");
  const allowlistCodes = phaseAllowlist.match(
    /remote_recovery_failed_phase_[a-z_]+/g,
  ) ?? [];
  assert.equal(allowlistCodes.length, mappings.length);
  assert.deepEqual(
    new Set(allowlistCodes),
    new Set(mappings.map(({ public: publicCode }) => publicCode)),
  );
  const cleanupAllowlist = allRuns.match(
    /is_allowed_remote_cleanup_reason\(\) \{[\s\S]*?case "\$1" in([\s\S]*?)\n\s+\*\) return 1/,
  )?.[1];
  assert.ok(cleanupAllowlist, "public cleanup-reason allowlist missing");
  const cleanupAllowlistCodes = cleanupAllowlist.match(
    /remote_cleanup_failed_reason_[a-z0-9_]+/g,
  ) ?? [];
  assert.equal(cleanupAllowlistCodes.length, cleanupFailureReasons.length);
  assert.deepEqual(
    new Set(cleanupAllowlistCodes),
    new Set(cleanupFailureReasons.map(([, publicCode]) => publicCode)),
  );
  const markers = [
    "fence_cleanup_verified", "candidate_state_verified", "candidate_processes_stopped",
    "current_frozen_release_verified", "frozen_web_restored",
    "worker_state_restored", "recovery_complete",
  ];
  const directory = mkdtempSync(join(tmpdir(), "faolla-classifier-"));
  const stdoutPath = join(directory, "stdout");
  const stderrPath = join(directory, "stderr");
  try {
    const classify = (stdout, stderr, status = 1) => {
      writeFileSync(stdoutPath, stdout, { mode: 0o600 });
      writeFileSync(stderrPath, stderr, { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-", stdoutPath, stderrPath, String(status)],
        { input: classifier, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    for (const mapping of mappings) {
      for (let prefix = 0; prefix < markers.length; prefix += 1) {
        const stdout = prefix === 0 ? "" : `${markers.slice(0, prefix).join("\n")}\n`;
        assert.equal(
          classify(stdout, `${mapping.remote}\n`),
          prefix === mapping.prefix ? mapping.public : "recovery_output_invalid",
          `${mapping.remote} with prefix ${prefix}`,
        );
      }
    }
    for (const mapping of mappings) {
      const stdout = mapping.prefix === 0
        ? ""
        : `${markers.slice(0, mapping.prefix).join("\n")}\n`;
      for (const [remoteReason, publicReason] of cleanupFailureReasons) {
        assert.equal(
          classify(stdout, `${mapping.remote}\n${remoteReason}\n`),
          `${mapping.public}\n${publicReason}`,
          `${mapping.remote} lost cleanup reason ${remoteReason}`,
        );
      }
      for (let prefix = 0; prefix < markers.length; prefix += 1) {
        if (prefix === mapping.prefix) continue;
        const wrongStdout = prefix === 0
          ? ""
          : `${markers.slice(0, prefix).join("\n")}\n`;
        assert.equal(
          classify(
            wrongStdout,
            `${mapping.remote}\n${cleanupFailureReasons[0][0]}\n`,
          ),
          "recovery_output_invalid",
          `${mapping.remote} accepted cleanup with prefix ${prefix}`,
        );
      }
    }
    const representative = mappings[0];
    const fullStdout = `${markers.join("\n")}\n`;
    for (const malformedStderr of [
      "cleanup_unverified\n",
      `${representative.remote}\n${cleanupFailureReasons[0][0]}`,
      `${representative.remote}\r\n${cleanupFailureReasons[0][0]}\r\n`,
      `${representative.remote}\n${cleanupFailureReasons[0][0]}\nextra\n`,
      `${representative.remote}\n${cleanupFailureReasons[0][0]}\n${cleanupFailureReasons[0][0]}\n`,
      `${representative.remote}\n${cleanupFailureReasons[0][1]}\n`,
    ]) {
      assert.equal(classify("", malformedStderr), "recovery_output_invalid");
    }
    assert.equal(
      classify(
        fullStdout,
        `${representative.remote}\n${cleanupFailureReasons[0][0]}\n`,
      ),
      "recovery_output_invalid",
    );
    assert.equal(
      classify(
        "",
        `${representative.remote}\n${cleanupFailureReasons[0][0]}\n`,
        0,
      ),
      "recovery_output_invalid",
    );
    for (const mapping of [...sourceIdentityMappings, ...candidateEnvMappings]) {
      for (const injectedStderr of [
        mapping.remote,
        `${mapping.remote}\r\n`,
        `${mapping.remote}\n${mapping.remote}\n`,
        `${mapping.public}\n`,
      ]) {
        assert.equal(
          classify("", injectedStderr),
          "recovery_output_invalid",
          `${mapping.remote} accepted injected stderr`,
        );
      }
      assert.equal(
        classify("injected\n", `${mapping.remote}\n`),
        "recovery_output_invalid",
        `${mapping.remote} accepted injected stdout`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remote execution strips shell and Node preload injection before runtime parsing", () => {
  assert.match(runtime, /^unset NODE_OPTIONS NODE_PATH npm_config_node_options NPM_CONFIG_NODE_OPTIONS \\\n  BASH_ENV ENV/m);
  assert.match(allRuns, /env -u NODE_OPTIONS -u NODE_PATH -u npm_config_node_options -u NPM_CONFIG_NODE_OPTIONS -u BASH_ENV -u ENV/);
  assert.match(allRuns, /bash --noprofile --norc "\$recovery_script"/);
  const remote = allRuns.match(/REMOTE_RECOVERY_COMMAND='([^'\r\n]+)'/)?.[1];
  assert.ok(remote, "remote recovery command missing");
  const payload = Buffer.from("{}\n", "utf8");
  const recovery = Buffer.from(`#!/usr/bin/env bash
set -eu
test -z "\${NODE_OPTIONS+x}"
test -z "\${NODE_PATH+x}"
test -z "\${npm_config_node_options+x}"
test -z "\${NPM_CONFIG_NODE_OPTIONS+x}"
test -z "\${BASH_ENV+x}"
test -z "\${ENV+x}"
node -e "process.exit(0)"
`, "utf8");
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const envelope = Buffer.concat([
    Buffer.from(
      `FAOLLA_FAILED_POST_SWITCH_RECOVERY_ENVELOPE_V1\n${payload.length}\n${sha256(payload)}\n${recovery.length}\n${sha256(recovery)}\n`,
      "utf8",
    ),
    payload,
    recovery,
  ]);
  const command = `export NODE_OPTIONS='--faolla-invalid-preload'; export NODE_PATH='/faolla-invalid'; export npm_config_node_options='--faolla-invalid'; export NPM_CONFIG_NODE_OPTIONS='--faolla-invalid'; export BASH_ENV='/faolla-missing-bash-env'; export ENV='/faolla-missing-env'; ${remote}`;
  const result = spawnSync(bashPath(), ["-c", command], { input: envelope, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("remote envelope accepts the observed size and cap but rejects cap plus one", () => {
  const remote = allRuns.match(/REMOTE_RECOVERY_COMMAND='([^'\r\n]+)'/)?.[1];
  assert.ok(remote, "remote recovery command missing");
  const payload = Buffer.from("{}\n", "utf8");
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const makeScript = (size) => {
    const prefix = Buffer.from("#!/usr/bin/env bash\nexit 0\n", "utf8");
    assert.ok(size >= prefix.length);
    return Buffer.concat([prefix, Buffer.alloc(size - prefix.length, 0x23)]);
  };
  const makeEnvelope = (script) => Buffer.concat([
    Buffer.from(
      `FAOLLA_FAILED_POST_SWITCH_RECOVERY_ENVELOPE_V1\n${payload.length}\n${sha256(payload)}\n${script.length}\n${sha256(script)}\n`,
      "utf8",
    ),
    payload,
    script,
  ]);
  for (const size of [138_146, expectedRecoveryScriptMaxBytes]) {
    const result = spawnSync(
      bashPath(),
      ["-c", remote],
      { input: makeEnvelope(makeScript(size)), encoding: "utf8", maxBuffer: 1_048_576 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }

  const oversizedScript = makeScript(expectedRecoveryScriptMaxBytes + 1);
  const rejected = spawnSync(
    bashPath(),
    ["-c", remote],
    { input: makeEnvelope(oversizedScript), encoding: "utf8", maxBuffer: 1_048_576 },
  );
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "");
});

test("public verification covers all four routes and the frozen build", () => {
  assert.match(allRuns, /--origin https:\/\/faolla\.com/);
  assert.match(allRuns, /--paths \/,\/login,\/10909094,\/admin/);
  assert.match(allRuns, /--expected-build "\$INCIDENT_OLD_BUILD_ID"/);
  assert.match(allRuns, /public_smoke_failed/);
  assert.match(allRuns, /public_smoke_verified/);
});

test("workflow cannot dispatch, deploy, upload logs, or mutate production broadly", () => {
  assert.doesNotMatch(workflow, /\bgh\s+api\b[^\n]*(?:--method|-X)\s+POST\b/);
  assert.doesNotMatch(workflow, /\bgh\s+workflow\s+run\b/);
  assert.doesNotMatch(workflow, /\bgit\s+(?:reset|clean|checkout|switch|merge|rebase)\b/);
  assert.doesNotMatch(workflow, /\bdocker\s+(?:rm|stop|kill|restart)\b/);
  assert.doesNotMatch(workflow, /pg_(?:cancel|terminate)_backend/);
  assert.doesNotMatch(workflow, /\b(?:npm|pnpm|yarn)\s+(?:ci|install|run build)\b/);
});
