import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MAINTENANCE_CONTINUATION_INCIDENT as INCIDENT, validateMaintenanceContinuationInspection,
  createMaintenanceContinuationInspection, buildMaintenanceContinuedState,
  encodeMaintenanceContinuationEvidence, decodeMaintenanceContinuationEvidence } from "./production-maintenance-continuation.mjs";
import { createMaintenanceRecoveryInspection, buildMaintenanceRecoveredState } from "./production-maintenance-recovery.mjs";
import { validateMaintenanceContinuationPriorBindings, inspectMaintenanceContinuationHistory,
  createMaintenanceContinuationWorkflowEvidence } from "./production-maintenance-continuation-workflow.mjs";
import { buildProductionMaintenanceBinding } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";

// Synthetic authenticated-API responses, never live GitHub or production state.
const TARGET = "a".repeat(40), NOW = Date.parse("2026-09-13T00:30:00Z");
const inspection = validateMaintenanceContinuationInspection({ version: 1, state: "continuation-inspected",
  operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha,
  revision: INCIDENT.revision, createdAt: INCIDENT.createdAt, targetSha: TARGET,
  stateDigest: "b".repeat(64), sourceDiffDigest: "c".repeat(64), migrationDigest: "d".repeat(64), recoveryDigest: "e".repeat(64),
  ...Object.fromEntries(Object.entries(INCIDENT).filter(([key]) => /Run(?:Id|Attempt)$/.test(key))) });
const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "34722000000", GITHUB_SHA: TARGET, TARGET_SHA: TARGET,
  PREVIOUS_TARGET_SHA: INCIDENT.previousTargetSha, EXPECTED_OLD_SHA: INCIDENT.expectedOldSha,
  MAINTENANCE_OPERATION_ID: INCIDENT.operationId, ACTION: "continue-held", CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE" };
const files = ["database-backup.yml", "database-migrate.yml", "ordinary-account-cutover-readiness.yml", "deploy.yml"];
const names = ["Encrypted Database Backup", "Apply Production Database Migrations", "Ordinary Account Cutover Readiness", "Deploy Production"];
const ids = [INCIDENT.backupRunId, INCIDENT.migrationRunId, INCIDENT.readinessRunId, INCIDENT.failedDeployRunId];
const times = [
  ["2026-09-12T20:02:59Z", "2026-09-12T20:03:00Z", "2026-09-12T21:50:30Z"],
  ["2026-09-12T21:51:00Z", "2026-09-12T21:51:01Z", "2026-09-12T21:53:00Z"],
  ["2026-09-12T21:54:00Z", "2026-09-12T21:54:01Z", "2026-09-12T21:55:30Z"],
  ["2026-09-12T21:55:39Z", "2026-09-12T21:55:40Z", "2026-09-12T21:56:10Z"],
];
const required = [
  ["Verify Held Maintenance Before Backup", "Verify Encrypted Backup", "Rehearse Isolated Restore", "Attest Canonical Maintenance Binding", "Verify Held Maintenance Before Backup Attestation"],
  ["Verify Recursive Backup Attestation Chain", "Verify Signed Backup Maintenance Binding", "Verify Held Maintenance Before Migration", "Revalidate Evidence And Apply Exact Through", "Verify Held Maintenance After Migration"],
  ["Verify Signed Backup Maintenance Binding", "Inspect Locked Production Readiness From Exact Source", "Enforce Ready Cutover State", "Verify Held Maintenance After Readiness", "Attest Canonical Maintenance Binding", "Confirm Exact Successful Readiness Artifact Inventory"],
  ["Validate Readiness Workflow Run", "Verify Readiness Evidence", "Revalidate Live Recursive Backup Evidence", "Verify Signed Readiness Maintenance Binding", "Export Verified Maintenance Binding", "Setup SSH"],
];
const postDeploy = ["Verify Public Release", "Verify Candidate While Public Entry Remains Held", "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding"];
const iso = value => new Date(value).toISOString().replace(".000Z", "Z");
function run(file, patch = {}) {
  const index = files.indexOf(file), time = index < 0 ? ["2026-09-13T00:00:00Z", "2026-09-13T00:00:01Z", "2026-09-13T00:10:00Z"] : times[index];
  return { id: index < 0 ? 34721900000 : Number(ids[index]), run_attempt: 1, name: index < 0 ? "CI" : names[index],
    path: `.github/workflows/${file}`, repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" },
    head_sha: index < 0 ? TARGET : INCIDENT.previousTargetSha, head_branch: "main", event: index < 0 ? "push" : index === 3 ? "workflow_run" : "workflow_dispatch",
    status: "completed", conclusion: index === 3 ? "failure" : "success", created_at: time[0], run_started_at: time[1], updated_at: time[2], ...patch };
}
function job(file) {
  const index = files.indexOf(file), incident = run(file), base = Date.parse(incident.run_started_at);
  const steps = required[index].map((name, i) => ({ name, number: i + 1, status: "completed", conclusion: "success",
    started_at: iso(base + i * 1000), completed_at: iso(base + (i + 1) * 1000) }));
  if (index === 1) {
    Object.assign(steps[3], { started_at: "2026-09-12T21:52:38Z", completed_at: "2026-09-12T21:52:45Z" });
    Object.assign(steps[4], { started_at: "2026-09-12T21:52:46Z", completed_at: "2026-09-12T21:52:47Z" });
  }
  if (index === 3) {
    steps.push({ name: "Deploy To Server", number: 7, status: "completed", conclusion: "failure", started_at: "2026-09-12T21:56:03Z", completed_at: "2026-09-12T21:56:08Z" });
    steps.push(...postDeploy.map((name, i) => ({ name, number: i + 8, status: "completed", conclusion: "skipped", started_at: null, completed_at: null })));
  }
  return { id: 103627590000 + index, run_id: incident.id, head_sha: INCIDENT.previousTargetSha, status: "completed", conclusion: incident.conclusion,
    started_at: incident.run_started_at, completed_at: incident.updated_at, steps };
}
function fixture(transform = (_key, value) => value) {
  const calls = [];
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint === "repos/fafona/space/commits/main") return transform("main", { sha: TARGET }, calls);
    const jobs = endpoint.match(/^repos\/fafona\/space\/actions\/runs\/([0-9]+)\/attempts\/1\/jobs\?per_page=100$/);
    if (jobs) { const file = files[ids.indexOf(jobs[1])]; assert.ok(file, endpoint); return transform(`job:${file}`, { total_count: 1, jobs: [job(file)] }, calls); }
    const match = endpoint.match(/^repos\/fafona\/space\/actions\/workflows\/([^/]+)\/runs\?(.+)$/);
    assert.ok(match, endpoint); const file = match[1], query = new URLSearchParams(match[2]);
    assert.equal(query.get("per_page"), "100");
    return transform(file, { total_count: 1, workflow_runs: [run(file)] }, calls, Number(query.get("page")));
  };
  return { api, calls };
}
function record(bytes) {
  return { bytes, provenance: [{ verificationResult: { statement: { subject: [{ name: "production-maintenance-binding.json",
    digest: { sha256: createHash("sha256").update(bytes).digest("hex") } }] } } }] };
}
function bindings() {
  return Object.fromEntries(["backup", "readiness"].map(phase => [phase, record(canonicalJsonBytes(buildProductionMaintenanceBinding(phase, {
    MAINTENANCE_MODE: "maintenance", TARGET_SHA: INCIDENT.previousTargetSha, EXPECTED_OLD_SHA: INCIDENT.expectedOldSha,
    MAINTENANCE_OPERATION_ID: INCIDENT.operationId, GITHUB_RUN_ID: phase === "backup" ? INCIDENT.backupRunId : INCIDENT.readinessRunId,
    GITHUB_RUN_ATTEMPT: "1", BACKUP_RUN_ID: INCIDENT.backupRunId, BACKUP_RUN_ATTEMPT: "1", READINESS_RUN_ID: INCIDENT.readinessRunId, READINESS_RUN_ATTEMPT: "1",
  })))]));
}
const history = transform => inspectMaintenanceContinuationHistory(inspection, fixture(transform).api, NOW);
const evidence = (transform, patch = {}, prior = bindings()) => createMaintenanceContinuationWorkflowEvidence(inspection, { ...env, ...patch }, fixture(transform).api, prior, NOW);
const changeRun = (file, patch) => (key, value) => key === file ? { ...value, workflow_runs: [{ ...value.workflow_runs[0], ...patch }] } : value;
const changeJob = (file, mutate) => (key, value) => { if (key === `job:${file}`) mutate(value); return value; };

test("exact four incidents with genuine GitHub snake-case jobs produce a bound canonical continuation evidence", async () => {
  const f = fixture(), prior = bindings();
  const result = await createMaintenanceContinuationWorkflowEvidence(inspection, env, f.api, prior, NOW);
  assert.equal(result.continuationRunId, env.GITHUB_RUN_ID); assert.equal(result.continuationRunAttempt, 1);
  assert.equal(result.mainCIrunId, "34721900000"); assert.equal(result.toolsSha, TARGET); assert.equal(result.historyCheckedAt, NOW);
  assert.match(result.historyDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(decodeMaintenanceContinuationEvidence(encodeMaintenanceContinuationEvidence(result)), result);
  assert.equal(f.calls.filter(value => value.endsWith("commits/main")).length, 2);
  assert.equal(f.calls.filter(value => value.includes("/attempts/1/jobs?")).length, 4);
  assert.deepEqual(validateMaintenanceContinuationPriorBindings(inspection, prior).backup.binding.targetSha, INCIDENT.previousTargetSha);
  const accepted = await history(); assert.deepEqual(accepted.incidents.map(value => value.id), ids);
});

test("workflow evidence from a valid recovered v3 inspection can continue without rewriting its original audit", async () => {
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const bootId = "11111111-2222-4333-8444-555555555555";
  const oldState = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: INCIDENT.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime: { synthetic: true }, ingress: { synthetic: true },
    database: { databaseOid: 5 }, publicSupabaseUrl: "https://example.invalid", tokenHash: "1".repeat(64),
    candidate: null, resumed: null, launchDisk: null, launchJournal: null, finalDump: null };
  const recoveryContext = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.originalTargetSha,
    targetSha: INCIDENT.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 3,
    expectedDigest: digest(oldState), bootId, now: INCIDENT.createdAt + 3600000, sourceDiffDigest: "2".repeat(64), migrationDigest: "3".repeat(64) };
  const recovery = { ...createMaintenanceRecoveryInspection(oldState, recoveryContext), toolsSha: INCIDENT.previousTargetSha,
    recoveryRunId: "34715768455", recoveryRunAttempt: 1, mainCIrunId: "34715352249", historyDigest: "4".repeat(64), historyCheckedAt: recoveryContext.now - 1000 };
  const state = buildMaintenanceRecoveredState(oldState, recovery, recoveryContext);
  const context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha, targetSha: TARGET,
    expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 4, expectedDigest: digest(state), bootId, now: NOW,
    sourceDiffDigest: "5".repeat(64), migrationDigest: "6".repeat(64) };
  const actualInspection = createMaintenanceContinuationInspection(state, context);
  const checked = await createMaintenanceContinuationWorkflowEvidence(actualInspection, env, fixture().api, bindings(), NOW);
  const continued = buildMaintenanceContinuedState(state, checked, context);
  assert.equal(continued.version, 4); assert.equal(continued.revision, 5); assert.equal(continued.phase, "held");
  assert.equal(JSON.stringify(continued.recovery), JSON.stringify(state.recovery));
  assert.equal(continued.createdAt, INCIDENT.createdAt); assert.equal(continued.operationId, INCIDENT.operationId);
  assert.equal(continued.continuation.evidence.stateDigest, digest(state));
});

test("each continuation workflow identity, source attempt and confirmation mismatch rejects before API", async () => {
  for (const key of Object.keys(env)) {
    const f = fixture(); await assert.rejects(createMaintenanceContinuationWorkflowEvidence(inspection, { ...env, [key]: "invalid" }, f.api, bindings(), NOW));
    assert.equal(f.calls.length, 0, key);
  }
  for (const patch of [{ GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_EVENT_NAME: "workflow_run" }, { ACTION: "recover-held" },
    { CONFIRMATION: "RECOVER_PRODUCTION_MAINTENANCE" }, { GITHUB_SHA: INCIDENT.previousTargetSha }, { GITHUB_RUN_ID: INCIDENT.failedDeployRunId }]) await assert.rejects(evidence(undefined, patch));
});

test("moving main before or after history and counterfeit CI never authorize continuation", async () => {
  for (const transform of [
    (key, value) => key === "main" ? { sha: INCIDENT.previousTargetSha } : value,
    (key, value, calls) => key === "main" && calls.length > 1 ? { sha: INCIDENT.previousTargetSha } : value,
    (key, value) => key === "ci.yml" ? { workflow_runs: [] } : value,
    ...[{ id: 0 }, { head_sha: INCIDENT.previousTargetSha }, { name: "Fake CI" }, { path: ".github/workflows/deploy.yml" },
      { head_branch: "feature" }, { event: "pull_request" }, { status: "queued" }, { conclusion: "failure" },
      { repository: { full_name: "other/space" } }, { head_repository: null }].map(patch => changeRun("ci.yml", patch)),
  ]) await assert.rejects(evidence(transform));
});

test("each required incident must exist exactly once at attempt one and its exact old SHA/event/outcome", async () => {
  for (const file of files) {
    for (const patch of [{ run_attempt: 2 }, { head_sha: TARGET }, { event: "push" }, { conclusion: "cancelled" }, { id: Number(run(file).id) + 1 }]) await assert.rejects(history(changeRun(file, patch)), `${file}:${JSON.stringify(patch)}`);
    await assert.rejects(history((key, value) => key === file ? { total_count: 0, workflow_runs: [] } : value));
    await assert.rejects(history((key, value) => key === file ? { total_count: 2, workflow_runs: [run(file), run(file)] } : value));
  }
});

test("other activity during the original creation second or any later timestamp always rejects", async () => {
  const second = iso(Math.floor(INCIDENT.createdAt / 1000) * 1000);
  for (const file of files) for (const patch of [
    { created_at: second, run_started_at: second, updated_at: second },
    { created_at: "2026-09-12T19:00:00Z", run_started_at: "2026-09-12T19:00:00Z", updated_at: "2026-09-12T19:00:00Z" },
    { run_attempt: 2, run_started_at: second, updated_at: second }, { updated_at: second },
  ]) await assert.rejects(history((key, value) => key === file ? { total_count: 2, workflow_runs: [run(file), run(file, {
    id: 100, created_at: "2026-09-12T16:00:00Z", run_started_at: "2026-09-12T16:00:01Z", updated_at: "2026-09-12T16:00:02Z", ...patch })] } : value));
});

function old(file, id) { return run(file, { id, created_at: "2026-09-12T16:00:00Z", run_started_at: "2026-09-12T16:00:01Z", updated_at: "2026-09-12T16:00:02Z" }); }
test("complete two-page history includes older runs and commits their metadata to evidence", async () => {
  const f = fixture((key, value, _calls, page) => key === files[0] ? { total_count: 101,
    workflow_runs: page === 1 ? [run(files[0]), ...Array.from({ length: 99 }, (_, i) => old(files[0], i + 1))] : [old(files[0], 100)] } : value);
  const full = await createMaintenanceContinuationWorkflowEvidence(inspection, env, f.api, bindings(), NOW);
  assert.ok(f.calls.some(value => value.endsWith("page=2")));
  assert.notEqual(full.historyDigest, (await evidence()).historyDigest);
});

test("missing pages, duplicate runs, inventory drift, unknown totals and exhausted bounds reject", async () => {
  const first = [run(files[0]), ...Array.from({ length: 99 }, (_, i) => old(files[0], i + 1))];
  for (const make of [
    () => ({ total_count: 2, workflow_runs: [run(files[0])] }), () => ({ total_count: 2001, workflow_runs: [] }),
    () => ({ total_count: -1, workflow_runs: [] }), () => ({ total_count: 1, workflow_runs: null }),
    page => ({ total_count: 101, workflow_runs: page === 1 ? first : [] }),
    page => ({ total_count: page === 1 ? 101 : 102, workflow_runs: page === 1 ? first : [old(files[0], 100)] }),
    page => ({ total_count: 101, workflow_runs: page === 1 ? first : [old(files[0], 99)] }),
    page => ({ total_count: 2000, workflow_runs: page === 1 ? first : Array.from({ length: 100 }, (_, i) => old(files[0], page * 100 + i)) }),
  ]) await assert.rejects(history((key, value, _calls, page) => key === files[0] ? make(page) : value));
});

test("invalid run identity, calendar and future/inverted timestamps reject", async () => {
  for (const patch of [{ name: "wrong" }, { path: "wrong" }, { head_branch: "feature" }, { repository: null },
    { head_repository: { full_name: "other/space" } }, { head_sha: "bad" }, { id: 0 }, { run_attempt: 0 },
    { created_at: "2026-02-30T00:00:00Z" }, { run_started_at: "2026-09-12T18:00:00Z" },
    { updated_at: "2026-09-13T00:31:00Z" }, { updated_at: "2026-09-12T18:00:00Z" }, { status: "in_progress" }]) await assert.rejects(history(changeRun(files[3], patch)));
  for (const now of [NaN, Infinity, 1.5, INCIDENT.createdAt - 1, INCIDENT.createdAt + 12 * 3600000 + 1]) {
    await assert.rejects(createMaintenanceContinuationWorkflowEvidence(inspection, env, fixture().api, bindings(), now));
  }
});

test("single exact successful incident jobs and all required guard steps are mandatory", async () => {
  for (const file of files) {
    for (const patch of [{ run_id: 1 }, { head_sha: TARGET }, { status: "in_progress" }, { conclusion: "cancelled" },
      { started_at: "2026-09-12T00:00:00Z" }, { completed_at: "2026-09-13T01:00:00Z" }, { steps: [] }]) await assert.rejects(history(changeJob(file, value => Object.assign(value.jobs[0], patch))));
    for (const mutate of [value => { value.total_count = 2; }, value => { value.jobs = []; }, value => { value.jobs.push(value.jobs[0]); },
      value => { value.jobs[0].steps.push({ ...value.jobs[0].steps[0] }); }]) await assert.rejects(history(changeJob(file, mutate)));
    for (const name of required[files.indexOf(file)]) await assert.rejects(history(changeJob(file, value => { value.jobs[0].steps.find(step => step.name === name).conclusion = "skipped"; })));
  }
});

test("failed deploy must fail only Deploy To Server and never report later verification or attestation success", async () => {
  for (const mutate of [
    steps => { steps.find(step => step.name === "Deploy To Server").name = "Other Failure"; },
    steps => { steps[0].conclusion = "failure"; }, steps => { steps.find(step => step.name === "Deploy To Server").conclusion = "success"; },
    ...postDeploy.map(name => steps => { Object.assign(steps.find(step => step.name === name), { conclusion: "success", started_at: "2026-09-12T21:56:08Z", completed_at: "2026-09-12T21:56:09Z" }); }),
  ]) await assert.rejects(history(changeJob(files[3], value => mutate(value.jobs[0].steps))));
});

test("step API timestamps are snake-case, bounded by the job, and migration apply window is exact", async () => {
  for (const patch of [{ status: "queued" }, { conclusion: "timed_out" }, { started_at: "2026-09-12T16:00:00Z" },
    { completed_at: "2026-09-13T01:00:00Z" }, { started_at: null }, { started_at: undefined, startedAt: "2026-09-12T21:55:40Z" }]) {
    await assert.rejects(history(changeJob(files[3], value => Object.assign(value.jobs[0].steps[0], patch))));
  }
  for (const patch of [{ started_at: "2026-09-12T21:52:37Z" }, { completed_at: "2026-09-12T21:52:46Z" }]) await assert.rejects(history(changeJob(files[1], value => Object.assign(value.jobs[0].steps[3], patch))));
});

test("B before M before R before D is required even when each job independently fits its run", async () => {
  for (const index of [1, 2, 3]) {
    const value = run(files[index]); value.created_at = iso(Date.parse(times[index - 1][2]) - 1000);
    await assert.rejects(history(changeRun(files[index], value)));
  }
});

test("backup/readiness canonical subjects stay bound to old target, operation and original runs", async () => {
  for (const phase of ["backup", "readiness"]) for (const patch of [
    { operationId: "11111111-1111-4111-8111-111111111111" }, { targetSha: TARGET }, { expectedOldSha: TARGET },
    { mode: "off" }, { phase: "deploy" }, { runId: "123" }, { runAttempt: "2" }, { backupRunId: "123" }, { backupRunAttempt: "2" },
    { readinessRunId: "123" }, { readinessRunAttempt: "2" },
  ]) {
    const prior = bindings(); prior[phase] = record(canonicalJsonBytes({ ...JSON.parse(prior[phase].bytes), ...patch }));
    const f = fixture(); await assert.rejects(createMaintenanceContinuationWorkflowEvidence(inspection, env, f.api, prior, NOW));
    assert.equal(f.calls.length, 0);
  }
});

test("malformed, noncanonical, oversized or missing prior subjects and polluted provenance reject", () => {
  for (const phase of ["backup", "readiness"]) for (const mutate of [
    prior => { delete prior[phase]; }, prior => { prior.extra = prior[phase]; },
    prior => { prior[phase].bytes = Buffer.from("not-json"); }, prior => { prior[phase].bytes = Buffer.alloc(4097); },
    prior => { prior[phase].bytes = Buffer.concat([prior[phase].bytes, Buffer.from("\n")]); },
    prior => { prior[phase].bytes = prior[phase].bytes.toString(); }, prior => { prior[phase].extra = "PRIVATE_SENTINEL"; },
    prior => { prior[phase].provenance = []; }, prior => { prior[phase].provenance[0].verificationResult.statement.subject.push({}); },
    prior => { prior[phase].provenance[0].verificationResult.statement.subject[0].name = "other.json"; },
    prior => { prior[phase].provenance[0].verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64); },
  ]) { const prior = bindings(); mutate(prior); assert.throws(() => validateMaintenanceContinuationPriorBindings(inspection, prior)); }
});

test("API failure never returns evidence and malformed inspection cannot start API reads", async () => {
  for (const patch of [{ targetSha: INCIDENT.previousTargetSha }, { backupRunAttempt: 2 }, { migrationRunId: "123" }, { extra: "PRIVATE_SENTINEL" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceContinuationWorkflowEvidence({ ...inspection, ...patch }, env, f.api, bindings(), NOW)); assert.equal(f.calls.length, 0);
  }
  await assert.rejects(createMaintenanceContinuationWorkflowEvidence(inspection, env, async () => { throw new Error("offline"); }, bindings(), NOW));
});

test("CLI rejects invalid invocation with only a fixed error and without an output artifact", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./production-maintenance-continuation-workflow.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", FAOLLA_TEST_SECRET: "PRIVATE_SENTINEL" }, windowsHide: true,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "maintenance_continuation_workflow_unverified\n");
});
