import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";
import { inspectMaintenanceRecoveryHistory, createMaintenanceRecoveryWorkflowEvidence } from "./production-maintenance-recovery-workflow.mjs";
import { encodeMaintenanceRecoveryEvidence, decodeMaintenanceRecoveryEvidence } from "./production-maintenance-recovery.mjs";

const createdAt = Date.parse("2026-09-12T18:00:00Z");
const inspection = { version: 1, state: "recovery-inspected", operationId: "12345678-1234-4123-8123-123456789abc",
  targetSha: "a".repeat(40), previousTargetSha: "b".repeat(40), expectedOldSha: "c".repeat(40), revision: 3,
  stateDigest: "d".repeat(64), createdAt, sourceDiffDigest: "e".repeat(64), migrationDigest: "f".repeat(64) };
const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "1234", GITHUB_SHA: inspection.targetSha, TARGET_SHA: inspection.targetSha,
  PREVIOUS_TARGET_SHA: inspection.previousTargetSha, EXPECTED_OLD_SHA: inspection.expectedOldSha,
  MAINTENANCE_OPERATION_ID: inspection.operationId, ACTION: "recover-held", CONFIRMATION: "RECOVER_PRODUCTION_MAINTENANCE" };
const names = { "database-backup.yml": "Encrypted Database Backup", "database-migrate.yml": "Apply Production Database Migrations",
  "ordinary-account-cutover-readiness.yml": "Ordinary Account Cutover Readiness", "deploy.yml": "Deploy Production", "ci.yml": "CI" };
const run = (file, patch = {}) => ({ id: 10, run_attempt: 1, name: names[file], path: `.github/workflows/${file}`,
  repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" }, head_sha: inspection.targetSha,
  head_branch: "main", event: "workflow_dispatch", status: "completed", conclusion: "success",
  created_at: "2026-09-12T16:00:00Z", run_started_at: "2026-09-12T16:01:00Z", updated_at: "2026-09-12T16:05:00Z", ...patch });
function apiFixture(transform = (_file, result) => result) {
  const calls = [];
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint === "repos/fafona/space/commits/main") return transform("main", { sha: inspection.targetSha }, calls);
    const match = endpoint.match(/^repos\/fafona\/space\/actions\/workflows\/([^/]+)\/runs\?(.+)$/);
    assert.ok(match, endpoint);
    const file = match[1], query = new URLSearchParams(match[2]);
    if (file === "ci.yml") return transform(file, { total_count: 1, workflow_runs: [run(file, { id: 99, event: "push" })] }, calls);
    assert.equal(query.get("per_page"), "100");
    return transform(file, { total_count: 1, workflow_runs: [run(file)] }, calls, Number(query.get("page")));
  };
  return { api, calls };
}

test("recovery evidence binds exact inspection, fresh main CI, authenticated complete history and workflow identity", async () => {
  const { api, calls } = apiFixture();
  const result = await createMaintenanceRecoveryWorkflowEvidence(inspection, env, api, createdAt + 60000);
  assert.equal(result.mainCIrunId, "99");
  assert.equal(result.toolsSha, inspection.targetSha);
  assert.equal(result.recoveryRunId, "1234");
  assert.equal(result.historyCheckedAt, createdAt + 60000);
  assert.match(result.historyDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(decodeMaintenanceRecoveryEvidence(encodeMaintenanceRecoveryEvidence(result)), result);
  assert.equal(calls.filter(value => value.endsWith("commits/main")).length, 2);
  assert.equal(calls.filter(value => value.includes("per_page=100&page=1")).length, 4);
});

test("every workflow identity, operation, target and confirmation mismatch refuses before API", async () => {
  for (const key of Object.keys(env)) {
    const { api, calls } = apiFixture();
    await assert.rejects(createMaintenanceRecoveryWorkflowEvidence(inspection, { ...env, [key]: "invalid" }, api, createdAt + 1));
    assert.equal(calls.length, 0, key);
  }
  for (const now of [createdAt - 1, NaN, Infinity, 1.5, createdAt + 12 * 3600000 + 1]) {
    await assert.rejects(createMaintenanceRecoveryWorkflowEvidence(inspection, env, apiFixture().api, now));
  }
});

test("unknown API, changed main and non-exact CI never grant recovery", async () => {
  for (const modify of [
    (file, value) => file === "main" ? { sha: inspection.previousTargetSha } : value,
    (file, value, calls) => file === "main" && calls.length > 1 ? { sha: inspection.previousTargetSha } : value,
    (file, value) => file === "ci.yml" ? { workflow_runs: [] } : value,
    (file, value) => file === "ci.yml" ? { workflow_runs: [run(file, { event: "pull_request" })] } : value,
    (file, value) => file === "ci.yml" ? { workflow_runs: [run(file, { event: "push", conclusion: "failure" })] } : value,
    (file, value) => file === "ci.yml" ? { workflow_runs: [run(file, { event: "push", id: 0 })] } : value,
  ]) await assert.rejects(createMaintenanceRecoveryWorkflowEvidence(inspection, env, apiFixture(modify).api, createdAt + 1));
  await assert.rejects(createMaintenanceRecoveryWorkflowEvidence(inspection, env, async () => { throw new Error("offline"); }, createdAt + 1));
});

test("any downstream activity or latest rerun metadata in original window rejects regardless of outcome", async () => {
  for (const file of Object.keys(names).filter(value => value !== "ci.yml")) {
    for (const patch of [
      { created_at: "2026-09-12T18:00:00Z", run_started_at: "2026-09-12T18:00:00Z", updated_at: "2026-09-12T18:00:00Z" },
      { run_attempt: 2, run_started_at: "2026-09-12T18:01:00Z", updated_at: "2026-09-12T18:02:00Z", conclusion: "failure" },
      { updated_at: "2026-09-12T18:01:00Z", conclusion: "cancelled" },
      { status: "queued", conclusion: null }, { status: "in_progress", conclusion: null },
    ]) await assert.rejects(inspectMaintenanceRecoveryHistory(inspection, apiFixture((current, value) => current === file
      ? { total_count: 1, workflow_runs: [run(file, patch)] } : value).api));
  }
});

test("GitHub second-resolution timestamps reject the entire operation-creation second, including an old run rerun", async () => {
  const fractional = { ...inspection, createdAt: createdAt + 500 };
  for (const patch of [
    { created_at: "2026-09-12T18:00:00Z", run_started_at: "2026-09-12T18:00:00Z", updated_at: "2026-09-12T18:00:00Z" },
    { run_attempt: 2, run_started_at: "2026-09-12T18:00:00Z", updated_at: "2026-09-12T18:00:00Z" },
    { updated_at: "2026-09-12T18:00:00Z", conclusion: "cancelled" },
  ]) await assert.rejects(inspectMaintenanceRecoveryHistory(fractional, apiFixture((file, value) => file === "deploy.yml"
    ? { total_count: 1, workflow_runs: [run(file, patch)] } : value).api));
  const earlier = apiFixture((file, value) => file === "deploy.yml" ? { total_count: 1, workflow_runs: [run(file,
    { run_attempt: 2, run_started_at: "2026-09-12T17:59:59Z", updated_at: "2026-09-12T17:59:59Z" })] } : value);
  assert.match(await inspectMaintenanceRecoveryHistory(fractional, earlier.api), /^[a-f0-9]{64}$/);
});

test("history rejects impossible calendar dates instead of normalizing their timestamp", async () => {
  await assert.rejects(inspectMaintenanceRecoveryHistory(inspection, apiFixture((file, value) => file === "deploy.yml"
    ? { total_count: 1, workflow_runs: [run(file, { created_at: "2026-02-30T16:00:00Z",
      run_started_at: "2026-02-30T16:01:00Z", updated_at: "2026-02-30T16:05:00Z" })] } : value).api));
});

test("history requires bounded complete pagination and stable unique inventory", async () => {
  const { api, calls } = apiFixture((file, value, _calls, page) => file === "database-backup.yml"
    ? { total_count: 101, workflow_runs: page === 1 ? Array.from({ length: 100 }, (_, index) => run(file, { id: index + 1 })) : [run(file, { id: 101 })] }
    : value);
  assert.match(await inspectMaintenanceRecoveryHistory(inspection, api), /^[a-f0-9]{64}$/);
  assert.ok(calls.some(value => value.endsWith("page=2")));
  for (const transform of [
    () => ({ total_count: 2, workflow_runs: [run("database-backup.yml")] }),
    () => ({ total_count: 2, workflow_runs: [run("database-backup.yml"), run("database-backup.yml")] }),
    () => ({ total_count: 2001, workflow_runs: [] }),
    () => ({ total_count: 1, workflow_runs: null }),
    (_file, _value, _calls, page) => ({ total_count: page === 1 ? 101 : 102, workflow_runs: page === 1
      ? Array.from({ length: 100 }, (_, index) => run("database-backup.yml", { id: index + 1 })) : [run("database-backup.yml", { id: 101 })] }),
    (_file, _value, _calls, page) => ({ total_count: 2000, workflow_runs: Array.from({ length: 100 }, (_, index) => run("database-backup.yml", { id: (page - 1) * 100 + index + 1 })) }),
  ]) await assert.rejects(inspectMaintenanceRecoveryHistory(inspection, apiFixture((file, ...args) => file === "database-backup.yml" ? transform(file, ...args) : args[0]).api));
});

test("history rejects malformed or foreign metadata and hashes accepted full inventory", async () => {
  const baseline = await inspectMaintenanceRecoveryHistory(inspection, apiFixture().api);
  const other = await inspectMaintenanceRecoveryHistory(inspection, apiFixture((file, value) => file === "deploy.yml"
    ? { total_count: 1, workflow_runs: [run(file, { id: 11 })] } : value).api);
  assert.notEqual(baseline, other);
  for (const patch of [{ name: "other" }, { path: "wrong" }, { head_branch: "other" }, { head_sha: "bad" },
    { repository: { full_name: "foreign/space" } }, { head_repository: null }, { id: -1 }, { run_attempt: 0 },
    { created_at: "not-time" }, { updated_at: "2026-09-12T15:00:00Z" }, { run_started_at: "2026-09-12T17:00:00Z" },
    { conclusion: "unknown" }]) {
    await assert.rejects(inspectMaintenanceRecoveryHistory(inspection, apiFixture((file, value) => file === "deploy.yml"
      ? { total_count: 1, workflow_runs: [run(file, patch)] } : value).api));
  }
});

const workflow = yaml.load(readFileSync(new URL("../.github/workflows/production-maintenance.yml", import.meta.url), "utf8"));
const steps = workflow.jobs.maintenance.steps;
const step = name => { const result = steps.find(item => item.name === name); assert.ok(result, name); return result; };
test("fixed recovery workflow input requires original UUID, T1, distinct T2, confirmation and attempt 1", () => {
  assert.equal(workflow.concurrency.group, "production-deploy");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.ok(Object.keys(workflow.on.workflow_dispatch.inputs).length <= 10);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const base = { ...env, SystemRoot: process.env.SystemRoot ?? "", CHECK_STATE: "held", DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "" };
  const execute = patch => spawnSync(bash, ["-s"], { input: step("Validate Fixed Manual Transition").run, encoding: "utf8", env: { ...base, ...patch } }).status;
  assert.equal(execute({}), 0);
  for (const patch of [{ PREVIOUS_TARGET_SHA: "" }, { PREVIOUS_TARGET_SHA: inspection.targetSha },
    { PREVIOUS_TARGET_SHA: inspection.expectedOldSha }, { MAINTENANCE_OPERATION_ID: "" }, { CONFIRMATION: "PREPARE_PRODUCTION_MAINTENANCE" },
    { GITHUB_RUN_ATTEMPT: "2" }, { DEPLOY_RUN_ID: "12" }, { DEPLOY_RUN_ATTEMPT: "1" },
    { ACTION: "prepare", MAINTENANCE_OPERATION_ID: "", CONFIRMATION: "PREPARE_PRODUCTION_MAINTENANCE" }]) assert.notEqual(execute(patch), 0);
});

test("remote read-only inspection precedes authenticated history and sole recovery mutation", () => {
  const inspectionStep = step("Inspect Original Failed Held Recovery State"), history = step("Verify Complete Recovery History Under Production Lock"), transition = step("Execute Fixed Maintenance Transition");
  assert.equal(inspectionStep.if, "inputs.action == 'recover-held'");
  assert.equal(history.if, "inputs.action == 'recover-held'");
  assert.ok(steps.indexOf(inspectionStep) < steps.indexOf(history) && steps.indexOf(history) < steps.indexOf(transition));
  assert.match(inspectionStep.run, /node %q inspect-recovery/);
  for (const token of ["--previous-target-sha %q", "--expected-old-sha %q", "--expected-operation-id %q", "StrictHostKeyChecking=yes"]) assert.ok(inspectionStep.run.includes(token));
  assert.doesNotMatch(inspectionStep.run, /cat |tee |recover-held --app|fail-held|prepare --app/);
  assert.match(history.run, /production-maintenance-recovery-workflow\.mjs --inspection/);
  assert.equal(transition.env.RECOVERY_EVIDENCE, "${{ steps.recovery-evidence.outputs.recovery_evidence }}");
  assert.match(transition.run, /recover-held\) command=recover-held; expected_state=held/);
  assert.match(transition.run, /operation_args\+=\(--previous-target-sha "\$PREVIOUS_TARGET_SHA" --recovery-evidence "\$RECOVERY_EVIDENCE"\)/);
  assert.match(transition.run, /--state "\$expected_state" --target-sha "\$TARGET_SHA"/);
  assert.match(step("Reclose Entry And Fail Held If End Is Unconfirmed").if, /inputs.action == 'end'/);
  assert.equal(step("Remove Runner Recovery Inspection").if, "always() && inputs.action == 'recover-held' && steps.recovery-inspection.outputs.capture_dir != ''");
});
