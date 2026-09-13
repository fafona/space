import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateMaintenanceBuildRecoveryInspection, encodeMaintenanceBuildRecoveryEvidence,
  decodeMaintenanceBuildRecoveryEvidence, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST } from "./production-maintenance-build-recovery.mjs";
import { validateMaintenanceBuildRecoveryPriorBindings, inspectMaintenanceBuildRecoveryHistory,
  createMaintenanceBuildRecoveryWorkflowEvidence } from "./production-maintenance-build-recovery-workflow.mjs";
import { buildProductionMaintenanceBinding } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";

// Synthetic authenticated API responses; no GitHub, host, build, or state writes.
const OLD = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf";
const PREVIOUS = "46f007fbd9e417f93c01e398c77cf38ec814547d", TARGET = "a".repeat(40);
const NOW = Date.parse("2026-09-13T07:00:00Z");
const inspection = validateMaintenanceBuildRecoveryInspection({
  version: 1, state: "build-recovery-inspected", operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  targetSha: TARGET, previousTargetSha: PREVIOUS, expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  revision: 7, createdAt: 1789236034129,
  stateDigest: "56d5c39c287ec24ce96fb40943d283bee19a950462e7c384934b6461b42c5ffa",
  sourceDiffDigest: "c".repeat(64), migrationDigest: "d".repeat(64), recoveryDigest: "e".repeat(64), continuationDigest: "f".repeat(64),
  deadlineExtensionDigest: MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST,
  backupRunId: "34724943157", backupRunAttempt: 1, migrationRunId: "34721155156", migrationRunAttempt: 1,
  readinessRunId: "34728212357", readinessRunAttempt: 1, failedDeployRunId: "34728263285", failedDeployRunAttempt: 1,
});
const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "34729000000", GITHUB_SHA: TARGET, TARGET_SHA: TARGET,
  PREVIOUS_TARGET_SHA: PREVIOUS, EXPECTED_OLD_SHA: inspection.expectedOldSha, MAINTENANCE_OPERATION_ID: inspection.operationId,
  ACTION: "recover-build", CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100000Z" };
const files = ["database-backup.yml", "database-migrate.yml", "ordinary-account-cutover-readiness.yml", "deploy.yml"];
const names = ["Encrypted Database Backup", "Apply Production Database Migrations", "Ordinary Account Cutover Readiness", "Deploy Production"];
const incidents = [
  ["34715932102", 0, OLD, "2026-09-12T20:03:00Z", "2026-09-12T21:50:30Z"],
  ["34721155156", 1, OLD, "2026-09-12T21:51:00Z", "2026-09-12T21:53:00Z"],
  ["34721256683", 2, OLD, "2026-09-12T21:54:00Z", "2026-09-12T21:55:30Z"],
  ["34721317710", 3, OLD, "2026-09-12T21:55:40Z", "2026-09-12T21:56:10Z"],
  ["34724943157", 0, PREVIOUS, "2026-09-12T22:20:00Z", "2026-09-13T00:00:00Z"],
  ["34728212357", 2, PREVIOUS, "2026-09-13T00:10:00Z", "2026-09-13T00:30:00Z"],
  ["34728263285", 3, PREVIOUS, "2026-09-13T00:35:00Z", "2026-09-13T00:36:45Z"],
];
const required = [
  ["Verify Held Maintenance Before Backup", "Verify Encrypted Backup", "Rehearse Isolated Restore", "Attest Canonical Maintenance Binding", "Verify Held Maintenance Before Backup Attestation"],
  ["Verify Recursive Backup Attestation Chain", "Verify Signed Backup Maintenance Binding", "Verify Held Maintenance Before Migration", "Revalidate Evidence And Apply Exact Through", "Verify Held Maintenance After Migration"],
  ["Verify Signed Backup Maintenance Binding", "Inspect Locked Production Readiness From Exact Source", "Enforce Ready Cutover State", "Verify Held Maintenance After Readiness", "Attest Canonical Maintenance Binding", "Confirm Exact Successful Readiness Artifact Inventory"],
  ["Validate Readiness Workflow Run", "Verify Readiness Evidence", "Revalidate Live Recursive Backup Evidence", "Verify Signed Readiness Maintenance Binding", "Export Verified Maintenance Binding", "Setup SSH"],
];
const postDeploy = ["Verify Public Release", "Verify Candidate While Public Entry Remains Held", "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding"];
const iso = value => new Date(value).toISOString().replace(".000Z", "Z");
function run(spec, patch = {}) {
  const [id, index, sha, started, ended] = spec;
  return { id: Number(id), run_attempt: 1, name: names[index], path: ".github/workflows/" + files[index],
    repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" },
    head_sha: sha, head_branch: "main", event: index === 3 ? "workflow_run" : "workflow_dispatch",
    status: "completed", conclusion: index === 3 ? "failure" : "success", created_at: iso(Date.parse(started) - 1000),
    run_started_at: started, updated_at: ended, ...patch };
}
function job(spec) {
  const r = run(spec), index = spec[1], base = Date.parse(r.run_started_at);
  const steps = required[index].map((name, i) => ({ name, number: i + 1, status: "completed", conclusion: "success",
    started_at: iso(base + i * 1000), completed_at: iso(base + (i + 1) * 1000) }));
  if (index === 1) {
    Object.assign(steps[3], { started_at: "2026-09-12T21:52:38Z", completed_at: "2026-09-12T21:52:45Z" });
    Object.assign(steps[4], { started_at: "2026-09-12T21:52:46Z", completed_at: "2026-09-12T21:52:47Z" });
  }
  if (index === 3) {
    steps.push({ name: "Deploy To Server", number: 7, status: "completed", conclusion: "failure",
      started_at: iso(base + 10000), completed_at: iso(base + 15000) });
    steps.push(...postDeploy.map((name, i) => ({ name, number: i + 8, status: "completed", conclusion: "skipped", started_at: null, completed_at: null })));
  }
  return { id: r.id + 100000000000, run_id: r.id, head_sha: r.head_sha, status: "completed", conclusion: r.conclusion,
    started_at: r.run_started_at, completed_at: r.updated_at, steps };
}
function fixture(transform = (_key, value) => value) {
  const calls = [];
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint === "repos/fafona/space/commits/main") return transform("main", { sha: TARGET }, calls);
    const jobs = endpoint.match(/^repos\/fafona\/space\/actions\/runs\/([0-9]+)\/attempts\/1\/jobs\?per_page=100$/);
    if (jobs) {
      const spec = incidents.find(value => value[0] === jobs[1]); assert.ok(spec, endpoint);
      return transform("job:" + spec[0], { total_count: 1, jobs: [job(spec)] }, calls);
    }
    const match = endpoint.match(/^repos\/fafona\/space\/actions\/workflows\/([^/]+)\/runs\?(.+)$/);
    assert.ok(match, endpoint); const file = match[1], query = new URLSearchParams(match[2]);
    assert.equal(query.get("per_page"), "100");
    if (file === "ci.yml") return transform(file, { workflow_runs: [{ ...run(incidents[0]), id: 34728900000, run_attempt: 1,
      name: "CI", path: ".github/workflows/ci.yml", event: "push", head_sha: TARGET }] }, calls);
    const rows = incidents.filter(spec => files[spec[1]] === file).map(spec => run(spec)).reverse();
    return transform(file, { total_count: rows.length, workflow_runs: rows }, calls, Number(query.get("page")));
  };
  return { api, calls };
}
function record(bytes) {
  return { bytes, provenance: [{ verificationResult: { statement: { subject: [{ name: "production-maintenance-binding.json",
    digest: { sha256: createHash("sha256").update(bytes).digest("hex") } }] } } }] };
}
function bindings() {
  return Object.fromEntries(["backup", "readiness"].map(phase => [phase, record(canonicalJsonBytes(buildProductionMaintenanceBinding(phase, {
    MAINTENANCE_MODE: "maintenance", TARGET_SHA: PREVIOUS, EXPECTED_OLD_SHA: inspection.expectedOldSha,
    MAINTENANCE_OPERATION_ID: inspection.operationId, GITHUB_RUN_ID: phase === "backup" ? inspection.backupRunId : inspection.readinessRunId,
    GITHUB_RUN_ATTEMPT: "1", BACKUP_RUN_ID: inspection.backupRunId, BACKUP_RUN_ATTEMPT: "1", READINESS_RUN_ID: inspection.readinessRunId, READINESS_RUN_ATTEMPT: "1",
  })))]));
}
const history = transform => inspectMaintenanceBuildRecoveryHistory(inspection, fixture(transform).api, NOW);
const evidence = (transform, patch = {}, prior = bindings()) => createMaintenanceBuildRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, fixture(transform).api, prior, NOW);
const changeRun = (id, patch) => (_key, value) => {
  if (Array.isArray(value.workflow_runs)) value.workflow_runs = value.workflow_runs.map(row => String(row.id) === id ? { ...row, ...patch } : row);
  return value;
};
const changeJob = (id, mutate) => (key, value) => { if (key === "job:" + id) mutate(value); return value; };

test("all seven exact incidents produce canonical evidence without relabelling the T3 signed subjects", async () => {
  const f = fixture(), prior = bindings(), result = await createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW);
  assert.equal(result.buildRecoveryRunId, env.GITHUB_RUN_ID); assert.equal(result.buildRecoveryRunAttempt, 1);
  assert.equal(result.mainCIrunId, "34728900000"); assert.equal(result.toolsSha, TARGET); assert.equal(result.historyCheckedAt, NOW);
  assert.equal(result.deadlineExtensionDigest, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST);
  assert.match(result.historyDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(decodeMaintenanceBuildRecoveryEvidence(encodeMaintenanceBuildRecoveryEvidence(result)), result);
  assert.equal(f.calls.filter(value => value.endsWith("commits/main")).length, 2);
  assert.equal(f.calls.filter(value => value.includes("/attempts/1/jobs?")).length, 7);
  assert.deepEqual((await history()).incidents.map(value => value.id), incidents.map(value => value[0]));
  assert.equal(validateMaintenanceBuildRecoveryPriorBindings(inspection, prior).backup.binding.targetSha, PREVIOUS);
  assert.equal(validateMaintenanceBuildRecoveryPriorBindings(inspection, prior).readiness.binding.backupRunId, inspection.backupRunId);
});

test("fixed action, confirmation, repository, run attempt and target binding reject before any API request", async () => {
  for (const patch of [{ ACTION: "continue-held" }, { CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE" },
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE" }, { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100034Z" },
    { GITHUB_REPOSITORY: "other/space" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "00" }, { GITHUB_SHA: PREVIOUS }, { TARGET_SHA: PREVIOUS },
    { PREVIOUS_TARGET_SHA: OLD }, { EXPECTED_OLD_SHA: TARGET }, { MAINTENANCE_OPERATION_ID: "invalid" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, f.api, bindings(), NOW));
    assert.equal(f.calls.length, 0);
  }
});

test("main before and after, and exact successful same-repository push CI, remain mandatory", async () => {
  for (const transform of [
    key => key === "main" ? { sha: PREVIOUS } : {},
    (key, value, calls) => key === "main" && calls.length > 1 ? { sha: PREVIOUS } : value,
    (key, value) => key === "ci.yml" ? { workflow_runs: [] } : value,
    ...[{ id: 0 }, { run_attempt: 0 }, { head_sha: PREVIOUS }, { name: "Fake CI" }, { path: ".github/workflows/deploy.yml" },
      { head_branch: "feature" }, { event: "pull_request" }, { status: "queued" }, { conclusion: "failure" }, { repository: null }, { head_repository: null }]
      .map(patch => (key, value) => key === "ci.yml" ? { workflow_runs: [{ ...value.workflow_runs[0], ...patch }] } : value),
  ]) await assert.rejects(evidence(transform));
});

test("each old and new run is required once with exact SHA, attempt one, event and conclusion", async () => {
  for (const spec of incidents) {
    for (const patch of [{ run_attempt: 2 }, { head_sha: TARGET }, { event: "push" }, { conclusion: "cancelled" }, { id: Number(spec[0]) + 1 }])
      await assert.rejects(history(changeRun(spec[0], patch)), spec[0] + JSON.stringify(patch));
    for (const duplicate of [false, true]) await assert.rejects(history((key, value) => key === files[spec[1]] ? {
      total_count: value.total_count + (duplicate ? 1 : -1),
      workflow_runs: duplicate ? [...value.workflow_runs, run(spec)] : value.workflow_runs.filter(row => String(row.id) !== spec[0]),
    } : value));
  }
});

function old(file, id, patch = {}) {
  return run(incidents.find(spec => files[spec[1]] === file), { id, created_at: "2026-09-12T16:00:00Z",
    run_started_at: "2026-09-12T16:00:01Z", updated_at: "2026-09-12T16:00:02Z", ...patch });
}
test("the original creation second is still the cutoff, including old run new attempts and activity before B3", async () => {
  const second = iso(Math.floor(inspection.createdAt / 1000) * 1000);
  for (const file of files) for (const patch of [
    { created_at: second, run_started_at: second, updated_at: second },
    { created_at: "2026-09-12T19:00:00Z", run_started_at: "2026-09-12T19:00:00Z", updated_at: "2026-09-12T19:00:00Z" },
    { run_attempt: 2, run_started_at: second, updated_at: second }, { updated_at: second },
    { status: "queued", conclusion: null, run_started_at: null },
  ]) await assert.rejects(history((key, value) => key === file ? { total_count: value.total_count + 1,
    workflow_runs: [...value.workflow_runs, old(file, 100, patch)] } : value));
});

test("two complete pages commit the old tail to history, not just the newest fixed incidents", async () => {
  const f = fixture((key, value, _calls, page) => key === files[0] ? { total_count: 101, workflow_runs: page === 1 ?
    [...value.workflow_runs, ...Array.from({ length: 98 }, (_, i) => old(files[0], i + 1))] : [old(files[0], 99)] } : value);
  const result = await createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW);
  assert.ok(f.calls.some(value => value.endsWith("page=2")));
  assert.notEqual(result.historyDigest, (await evidence()).historyDigest);
});

test("missing tail, duplicate, changing total, unsupported count and exhausted page bounds fail closed", async () => {
  const first = incidents.filter(spec => spec[1] === 0).map(spec => run(spec)).concat(Array.from({ length: 98 }, (_, i) => old(files[0], i + 1)));
  for (const make of [
    () => ({ total_count: 3, workflow_runs: first.slice(0, 2) }), () => ({ total_count: 2001, workflow_runs: [] }),
    () => ({ total_count: -1, workflow_runs: [] }), () => ({ total_count: 2, workflow_runs: null }),
    page => ({ total_count: 101, workflow_runs: page === 1 ? first : [] }),
    page => ({ total_count: page === 1 ? 101 : 102, workflow_runs: page === 1 ? first : [old(files[0], 99)] }),
    page => ({ total_count: 101, workflow_runs: page === 1 ? first : [old(files[0], 98)] }),
    page => ({ total_count: 2000, workflow_runs: page === 1 ? first : Array.from({ length: 100 }, (_, i) => old(files[0], page * 100 + i)) }),
  ]) await assert.rejects(history((key, value, _calls, page) => key === files[0] ? make(page) : value));
});

test("foreign identity, invalid dates, future or inverted timestamps, and in-progress activity reject", async () => {
  for (const patch of [{ name: "wrong" }, { path: "wrong" }, { head_branch: "feature" }, { repository: null }, { head_repository: null },
    { head_sha: "bad" }, { id: 0 }, { run_attempt: 0 }, { created_at: "2026-02-30T00:00:00Z" },
    { run_started_at: "2026-09-12T16:00:00Z" }, { updated_at: "2026-09-13T07:01:00Z" },
    { updated_at: "2026-09-12T18:00:00Z" }, { status: "in_progress" }])
    await assert.rejects(history(changeRun(inspection.failedDeployRunId, patch)));
  for (const now of [NaN, Infinity, 1.5, inspection.createdAt - 1, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION.authorizedAt - 1,
    MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION.expiresAt])
    await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, fixture().api, bindings(), now));
});

test("the one authorized extension uses actual time and ends exactly at 10 UTC with zero grace", async () => {
  const extension = MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION;
  assert.equal(extension.authorizedAt, Date.parse("2026-09-13T05:45:22Z"));
  assert.equal(extension.previousExpiresAt, inspection.createdAt + 12 * 3600000);
  assert.equal(extension.expiresAt, Date.parse("2026-09-13T10:00:00.000Z"));
  for (const now of [extension.authorizedAt, extension.previousExpiresAt + 1, extension.expiresAt - 1]) {
    const result = await createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, fixture().api, bindings(), now);
    assert.equal(result.historyCheckedAt, now);
    assert.equal(result.deadlineExtensionDigest, inspection.deadlineExtensionDigest);
  }
  for (const now of [extension.authorizedAt - 1, extension.expiresAt, extension.expiresAt + 34129]) {
    const f = fixture();
    await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), now));
    await assert.rejects(inspectMaintenanceBuildRecoveryHistory(inspection, f.api, now));
    assert.equal(f.calls.length, 0);
  }
});

test("extension does not erase new scheduled activity after the original deadline or change the seven exceptions", async () => {
  await assert.rejects(history((key, value) => key === files[0] ? { total_count: value.total_count + 1,
    workflow_runs: [...value.workflow_runs, old(files[0], 100, { event: "schedule", created_at: "2026-09-13T06:30:00Z",
      run_started_at: "2026-09-13T06:30:01Z", updated_at: "2026-09-13T06:30:02Z" })] } : value));
  for (const digest of [undefined, "0".repeat(64), "bad"]) {
    const f = fixture();
    await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence({ ...inspection, deadlineExtensionDigest: digest }, env, f.api, bindings(), NOW));
    assert.equal(f.calls.length, 0);
  }
});

test("all seven genuine snake-case jobs, one-job inventories and required successful guard steps are checked", async () => {
  for (const spec of incidents) {
    for (const patch of [{ run_id: 1 }, { head_sha: TARGET }, { status: "in_progress" }, { conclusion: "cancelled" },
      { started_at: "2026-09-12T00:00:00Z" }, { completed_at: "2026-09-13T03:00:00Z" }, { steps: [] }])
      await assert.rejects(history(changeJob(spec[0], value => Object.assign(value.jobs[0], patch))));
    for (const mutate of [value => { value.total_count = 2; }, value => { value.jobs = []; },
      value => { value.jobs.push(value.jobs[0]); }, value => { value.jobs[0].steps.push({ ...value.jobs[0].steps[0] }); }])
      await assert.rejects(history(changeJob(spec[0], mutate)));
    for (const name of required[spec[1]]) await assert.rejects(history(changeJob(spec[0], value => {
      value.jobs[0].steps.find(step => step.name === name).conclusion = "skipped";
    })));
  }
});

test("both failed deployments fail only Deploy To Server; later candidate, public and attestation steps stay skipped", async () => {
  for (const spec of incidents.filter(value => value[1] === 3)) for (const mutate of [
    steps => { steps.find(step => step.name === "Deploy To Server").name = "Other Failure"; },
    steps => { steps[0].conclusion = "failure"; },
    steps => { steps.find(step => step.name === "Deploy To Server").conclusion = "success"; },
    ...postDeploy.map(name => steps => { Object.assign(steps.find(step => step.name === name), { conclusion: "success",
      started_at: spec[3], completed_at: spec[3] }); }),
  ]) await assert.rejects(history(changeJob(spec[0], value => mutate(value.jobs[0].steps))));
});

test("migration's original exact apply window is not changed to the later backup or build time", async () => {
  for (const patch of [{ started_at: "2026-09-12T21:52:37Z" }, { completed_at: "2026-09-12T21:52:46Z" },
    { started_at: undefined, startedAt: "2026-09-12T21:52:38Z" }])
    await assert.rejects(history(changeJob(inspection.migrationRunId, value => Object.assign(value.jobs[0].steps[3], patch))));
});

test("the full B2-M-R2-D2 then B3-R3-D3 order is checked independently of API enumeration order", async () => {
  for (let i = 1; i < incidents.length; i++)
    await assert.rejects(history(changeRun(incidents[i][0], { created_at: iso(Date.parse(incidents[i - 1][4]) - 1000) })));
  for (const patch of [{ completed_at: null }, { status: "queued" }, { conclusion: "timed_out" },
    { started_at: "2026-09-12T16:00:00Z" }, { completed_at: "2026-09-13T03:00:00Z" }])
    await assert.rejects(history(changeJob(inspection.failedDeployRunId, value => Object.assign(value.jobs[0].steps[0], patch))));
});

test("only signed B3/R3 subjects match; neither T2 evidence nor T4 relabelling is accepted", async () => {
  for (const phase of ["backup", "readiness"]) for (const patch of [
    { targetSha: OLD }, { targetSha: TARGET }, { operationId: "11111111-1111-4111-8111-111111111111" },
    { expectedOldSha: TARGET }, { mode: "off" }, { phase: "deploy" }, { runId: "34715932102" }, { runAttempt: "2" },
    { backupRunId: "34715932102" }, { backupRunAttempt: "2" }, { readinessRunId: "34721256683" }, { readinessRunAttempt: "2" },
  ]) {
    const prior = bindings(); prior[phase] = record(canonicalJsonBytes({ ...JSON.parse(prior[phase].bytes), ...patch }));
    const f = fixture(); await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW));
    assert.equal(f.calls.length, 0);
  }
});

test("malformed, noncanonical, oversized and missing subjects or wrong provenance never yield an evidence", () => {
  for (const phase of ["backup", "readiness"]) for (const mutate of [
    prior => { delete prior[phase]; }, prior => { prior.extra = prior[phase]; }, prior => { prior[phase].extra = "PRIVATE_SENTINEL"; },
    prior => { prior[phase].bytes = Buffer.from("not-json"); }, prior => { prior[phase].bytes = Buffer.alloc(4097); },
    prior => { prior[phase].bytes = Buffer.concat([prior[phase].bytes, Buffer.from("\n")]); }, prior => { prior[phase].bytes = "not-bytes"; },
    prior => { prior[phase].provenance = []; }, prior => { prior[phase].provenance[0].verificationResult.statement.subject.push({}); },
    prior => { prior[phase].provenance[0].verificationResult.statement.subject[0].name = "other.json"; },
    prior => { prior[phase].provenance[0].verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64); },
  ]) { const prior = bindings(); mutate(prior); assert.throws(() => validateMaintenanceBuildRecoveryPriorBindings(inspection, prior)); }
});

test("malformed fixed inspection starts zero requests and any API failure returns no grant", async () => {
  for (const patch of [{ targetSha: PREVIOUS }, { backupRunAttempt: 2 }, { migrationRunId: "123" }, { revision: 8 },
    { continuationDigest: "bad" }, { stateDigest: "0".repeat(64) }, { extra: "PRIVATE_SENTINEL" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence({ ...inspection, ...patch }, env, f.api, bindings(), NOW));
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, async () => { throw new Error("offline"); }, bindings(), NOW));
});

test("input bindings remain unchanged and original historic job details remain in the history digest", async () => {
  const prior = bindings(), before = structuredClone(inspection), backup = Buffer.from(prior.backup.bytes);
  await createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, fixture().api, prior, NOW);
  assert.deepEqual(inspection, before); assert.deepEqual(prior.backup.bytes, backup);
  const altered = await evidence(changeJob("34715932102", value => { value.jobs[0].steps[0].completed_at = value.jobs[0].steps[0].started_at; }));
  assert.notEqual(altered.historyDigest, (await evidence()).historyDigest);
});

test("CLI rejects invalid invocation with only the fixed error, without credential or source output", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./production-maintenance-build-recovery-workflow.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", FAOLLA_TEST_SECRET: "PRIVATE_SENTINEL" }, windowsHide: true,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "maintenance_build_recovery_workflow_unverified\n");
});
