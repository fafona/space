import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateMaintenanceAttemptRecoveryInspection, encodeMaintenanceAttemptRecoveryEvidence,
  decodeMaintenanceAttemptRecoveryEvidence, MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION,
  MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION_DIGEST,
  MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT } from "./production-maintenance-attempt-recovery.mjs";
import { MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP as ADDITIONAL,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST } from "./production-maintenance-build-recovery.mjs";
import { validateMaintenanceAttemptRecoveryPriorBindings, inspectMaintenanceAttemptRecoveryHistory,
  createMaintenanceAttemptRecoveryWorkflowEvidence, validateMaintenanceAttemptRecoveryAdditionalBackup,
  readMaintenanceAttemptRecoveryAdditionalBackup, MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS } from "./production-maintenance-attempt-recovery-workflow.mjs";
import { buildProductionMaintenanceBinding } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";

// Synthetic authenticated API responses; no GitHub, host, build, or state writes.
const OLD = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf";
const EARLIER = "46f007fbd9e417f93c01e398c77cf38ec814547d", PREVIOUS = INCIDENT.previousTargetSha, TARGET = "a".repeat(40);
const NOW = Date.parse("2026-09-13T23:00:00Z");
const baseline = { version: 1, stateDigest: INCIDENT.stateDigest, candidateDigest: "a".repeat(64), launchDiskDigest: "b".repeat(64),
  launchJournalDigest: "c".repeat(64), runtimeDigest: "d".repeat(64), current: {
    target: "/srv/faolla.releases/f3104de19aa5-20260913204100", linkIdentity: "1:2:3:4:5:1:0:41471", runtimeIdentity: "1:2:3:4:5:2:0:16877" },
  bootId: INCIDENT.bootId, pm2RegistryDigest: "e".repeat(64), observedAt: NOW - 1000 };
const inspection = validateMaintenanceAttemptRecoveryInspection({
  version: 1, state: "attempt-recovery-inspected", operationId: INCIDENT.operationId, targetSha: TARGET, previousTargetSha: PREVIOUS,
  expectedOldSha: INCIDENT.expectedOldSha, revision: 15, stateDigest: INCIDENT.stateDigest, createdAt: INCIDENT.createdAt, activeAttempt: 1,
  sourceDiffDigest: "f".repeat(64), migrationDigest: "a".repeat(64), predecessorJournalDigest: baseline.launchJournalDigest,
  stoppedBaselineDigest: createHash("sha256").update(JSON.stringify(baseline)).digest("hex"), stoppedBaseline: baseline,
  deadlineAuthorizationDigest: MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION_DIGEST,
  ...Object.fromEntries(["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt",
    "failedDeployRunId", "failedDeployRunAttempt"].map(key => [key, INCIDENT[key]])),
});
const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "34729000000", GITHUB_SHA: TARGET, TARGET_SHA: TARGET,
  PREVIOUS_TARGET_SHA: PREVIOUS, EXPECTED_OLD_SHA: inspection.expectedOldSha, MAINTENANCE_OPERATION_ID: inspection.operationId,
  ACTION: "recover-attempt", CONFIRMATION: "RECOVER_ATTEMPT_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z" };
const files = ["database-backup.yml", "database-migrate.yml", "ordinary-account-cutover-readiness.yml", "deploy.yml"];
const names = ["Encrypted Database Backup", "Apply Production Database Migrations", "Ordinary Account Cutover Readiness", "Deploy Production"];
const incidents = [
  ["34715932102", 0, OLD, "2026-09-12T20:03:00Z", "2026-09-12T21:50:30Z"],
  ["34721155156", 1, OLD, "2026-09-12T21:51:00Z", "2026-09-12T21:53:00Z"],
  ["34721256683", 2, OLD, "2026-09-12T21:54:00Z", "2026-09-12T21:55:30Z"],
  ["34721317710", 3, OLD, "2026-09-12T21:55:40Z", "2026-09-12T21:56:10Z"],
  ["34724943157", 0, EARLIER, "2026-09-12T22:20:00Z", "2026-09-13T00:00:00Z"],
  ["34728212357", 2, EARLIER, "2026-09-13T00:10:00Z", "2026-09-13T00:30:00Z"],
  ["34728263285", 3, EARLIER, "2026-09-13T00:35:00Z", "2026-09-13T00:36:45Z"],
  ["34778579797", 0, PREVIOUS, "2026-09-13T19:43:01Z", "2026-09-13T20:34:00Z"],
  ["34781336277", 2, PREVIOUS, "2026-09-13T20:37:16Z", "2026-09-13T20:38:19Z"],
  ["34781392661", 3, PREVIOUS, "2026-09-13T20:38:22Z", "2026-09-13T20:44:33Z"],
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
    if (endpoint === "repos/fafona/space/actions/runs/34745334237/artifacts?per_page=100") return transform("artifacts", { total_count: 6,
      artifacts: MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS.map(artifact => ({ id: Number(artifact.id), name: artifact.name, size_in_bytes: artifact.bytes,
        digest: "sha256:" + artifact.sha256, expired: false, workflow_run: { id: Number(ADDITIONAL.runId), head_sha: ADDITIONAL.sourceSha, head_branch: "main" } }))
        .concat(["faolla-encrypted-backup-attestation-bundle-34745334237-1", "faolla-encrypted-disaster-recovery-34745334237-1",
          "faolla-production-backup-attestation-bundle-34745334237-1"].map((name, index) => ({ id: 100 + index, name }))) }, calls);
    for (const [id, key] of [["34778424264", "prior-recovery"], ["34777790522", "prior-ci"]]) {
      if (endpoint === "repos/fafona/space/actions/runs/" + id) return transform(key, priorRun(key), calls);
      if (endpoint === "repos/fafona/space/actions/runs/" + id + "/attempts/1/jobs?per_page=100") return transform(key + "-jobs", priorJobs(key), calls);
    }
    const jobs = endpoint.match(/^repos\/fafona\/space\/actions\/runs\/([0-9]+)\/attempts\/1\/jobs\?per_page=100$/);
    if (jobs) {
      if (jobs[1] === ADDITIONAL.runId) return transform("job:" + ADDITIONAL.runId, { total_count: 1, jobs: [additionalJob()] }, calls);
      const spec = incidents.find(value => value[0] === jobs[1]); assert.ok(spec, endpoint);
      return transform("job:" + spec[0], { total_count: 1, jobs: [job(spec)] }, calls);
    }
    const match = endpoint.match(/^repos\/fafona\/space\/actions\/workflows\/([^/]+)\/runs\?(.+)$/);
    assert.ok(match, endpoint); const file = match[1], query = new URLSearchParams(match[2]);
    assert.equal(query.get("per_page"), "100");
    if (file === "ci.yml") return transform(file, { workflow_runs: [{ ...run(incidents[0]), id: 34728900000, run_attempt: 1,
      name: "CI", path: ".github/workflows/ci.yml", event: "push", head_sha: TARGET }] }, calls);
    const rows = incidents.filter(spec => files[spec[1]] === file).map(spec => run(spec)).reverse();
    if (file === files[0]) rows.unshift(additionalRun());
    return transform(file, { total_count: rows.length, workflow_runs: rows }, calls, Number(query.get("page")));
  };
  return { api, calls };
}
function priorRun(key) {
  const recovery = key === "prior-recovery";
  return { ...run(incidents[0]), id: recovery ? 34778424264 : 34777790522, name: recovery ? "Production Maintenance" : "CI",
    path: recovery ? ".github/workflows/production-maintenance.yml" : ".github/workflows/ci.yml", head_sha: PREVIOUS,
    event: recovery ? "workflow_dispatch" : "push", created_at: recovery ? "2026-09-13T19:40:42Z" : "2026-09-13T19:00:00Z",
    run_started_at: recovery ? "2026-09-13T19:40:42Z" : "2026-09-13T19:00:01Z",
    updated_at: recovery ? "2026-09-13T19:42:59Z" : "2026-09-13T19:30:00Z" };
}
function priorJobs(key) {
  if (key === "prior-ci") return { total_count: 10, jobs: Array.from({ length: 10 }, (_, index) => ({
    id: 90000000000 + index, name: "Synthetic CI " + index, run_id: 34777790522, head_sha: PREVIOUS,
    status: "completed", conclusion: "success", started_at: "2026-09-13T19:00:01Z", completed_at: "2026-09-13T19:29:59Z" })) };
  const required = ["Validate Fixed Manual Transition", "Checkout Exact Maintenance Source", "Require Current Main And Exact Successful Push CI",
    "Setup Pinned SSH Trust", "Prepare Remote Detached Exact Control Source", "Inspect Failed Unlaunched Build Recovery State",
    "Verify Build Incident Signed Backup And Readiness Bindings", "Verify Fixed Additional Scheduled Backup Evidence",
    "Verify Exact Build Recovery History Under Production Lock", "Execute Fixed Maintenance Transition", "Remove Exact Temporary Control Source",
    "Remove Runner Build Recovery Evidence", "Remove Fixed Additional Scheduled Backup Evidence", "Remove Runner SSH Material"];
  const skipped = ["Require Exact Successful Maintenance Deploy Before End", "Verify Signed Deploy Maintenance Binding",
    "Inspect Original Failed Held Recovery State", "Verify Complete Recovery History Under Production Lock",
    "Inspect Migrated Unlaunched Continuation State", "Verify Original Signed Backup And Readiness Bindings",
    "Verify Exact Continuation History Under Production Lock", "Verify Real Public Release After End", "Reclose Entry And Fail Held If End Is Unconfirmed"];
  return { total_count: 1, jobs: [{ id: 103780842827, run_id: 34778424264, head_sha: PREVIOUS, status: "completed", conclusion: "success",
    started_at: "2026-09-13T19:40:46Z", completed_at: "2026-09-13T19:42:58Z", steps: [
      ...required.map(name => ({ name, status: "completed", conclusion: "success", started_at: "2026-09-13T19:40:46Z", completed_at: "2026-09-13T19:40:47Z" })),
      ...skipped.map(name => ({ name, status: "completed", conclusion: "skipped", started_at: null, completed_at: null }))] }] };
}
function additionalRun() {
  return run(incidents[0], { id: Number(ADDITIONAL.runId), head_sha: ADDITIONAL.sourceSha, event: "schedule",
    created_at: ADDITIONAL.createdAt, run_started_at: ADDITIONAL.runStartedAt, updated_at: ADDITIONAL.updatedAt });
}
function additionalJob() {
  const names = ["Verify Current Main And Exact Successful Push CI", "Create Encrypted Database Backup From Exact Source", "Transfer Complete Encrypted Backup",
    "Verify Backup Configuration From Exact Source", "Generate Backup Attestation Predicate", "Upload Canonical Backup Attestation Input",
    "Verify Encrypted Backup", "Rehearse Isolated Restore", "Confirm Backup Is Ready For Upload", "Verify Uploaded Backup Artifact Identity",
    "Attest Verified Encrypted Backup", "Attest Canonical Backup Attestation Input", "Upload Backup Verification And Attestation Inputs",
    "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding", "Remove Temporary Backup And Exact Source"];
  return { id: Number(ADDITIONAL.jobId), run_id: Number(ADDITIONAL.runId), head_sha: ADDITIONAL.sourceSha, status: "completed", conclusion: "success",
    started_at: ADDITIONAL.jobStartedAt, completed_at: ADDITIONAL.jobCompletedAt,
    steps: names.map(name => ({ name, status: "completed", conclusion: "success", started_at: ADDITIONAL.jobStartedAt, completed_at: ADDITIONAL.jobStartedAt }))
      .concat(["Verify Held Maintenance Before Backup", "Verify Held Maintenance After Backup Capture", "Verify Held Maintenance Before Backup Attestation"]
        .map(name => ({ name, status: "completed", conclusion: "skipped", started_at: null, completed_at: null }))) };
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function additionalProvenance(bytes, name) {
  return [{ verificationResult: { statement: { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name, digest: { sha256: digest(bytes) } }], predicate: {
      buildDefinition: { buildType: "https://actions.github.io/buildtypes/workflow/v1",
        externalParameters: { workflow: { path: ADDITIONAL.workflowPath, ref: "refs/heads/main", repository: "https://github.com/fafona/space" } },
        internalParameters: { github: { event_name: "schedule", runner_environment: "github-hosted" } },
        resolvedDependencies: [{ digest: { gitCommit: ADDITIONAL.sourceSha }, uri: "git+https://github.com/fafona/space@refs/heads/main" }] },
      runDetails: { builder: { id: "https://github.com/fafona/space/.github/workflows/database-backup.yml@refs/heads/main" },
        metadata: { invocationId: "https://github.com/fafona/space/actions/runs/34745334237/attempts/1" } } } } } }];
}
// Entirely synthetic report bodies. Actual production bytes are independently
// hard-pinned by readMaintenanceAttemptRecoveryAdditionalBackup, not this fixture.
function additionalRecords() {
  const baseline = Object.fromEntries(["merchantRecordCount", "merchantAuthoritativeBindingCount", "merchantInvalidBindingCount", "personalCanonicalBindingCount",
    "personalCanonicalOrphanCount", "personalInvalidCanonicalCount", "personalDuplicateAuthUserCount", "personalDuplicateAccountIdCount", "crossAccountTypeOverlapCount",
    "accountIdentifierCollisionCount", "staffRegistryOverlapCount", "systemSitePrincipalOverlapCount"].map(key => [key, "0"]));
  baseline.ordinaryIdentityContentSha256 = "1".repeat(64);
  const database = { containerName: "supabase-db", containerId: "b".repeat(64), dbName: "postgres", dbOid: "16384", systemId: "7612345678901234567", primary: true };
  const source = { repository: "fafona/space", sha: ADDITIONAL.sourceSha, originMainSha: ADDITIONAL.sourceSha, detached: true, treeState: "clean",
    stability: { source: "matched_before_after", database: "matched_before_after" }, database: { baseline, recoveryContent: { synthetic: true } } };
  const predicate = { schemaVersion: 1, kind: "faolla.production-backup.v1", repository: "fafona/space", targetSha: ADDITIONAL.sourceSha,
    run: { id: ADDITIONAL.runId, attempt: "1", workflowPath: ADDITIONAL.workflowPath, event: "schedule", headSha: ADDITIONAL.sourceSha, headBranch: "main" },
    remoteSource: { headSha: ADDITIONAL.sourceSha, originMainSha: ADDITIONAL.sourceSha, detached: true, cleanBefore: true, cleanAfter: true }, database, baseline,
    backupArtifact: { id: "9001", name: "faolla-encrypted-disaster-recovery-34745334237-1", digest: "sha256:" + "c".repeat(64), sizeBytes: "2048",
      createdAt: "2026-09-13T08:12:10.000Z", expiresAt: "2026-09-20T08:12:10.000Z", expired: false, workflowRunId: ADDITIONAL.runId, workflowRunAttempt: "1", headSha: ADDITIONAL.sourceSha,
      file: { name: "faolla-database-backup.tar.enc", sizeBytes: "1024", sha256: "d".repeat(64) } },
    issuedAt: "2026-09-13T08:12:11.000Z", validUntil: "2026-09-14T08:12:11.000Z" };
  const binding = canonicalJsonBytes(buildProductionMaintenanceBinding("backup", { MAINTENANCE_MODE: "off", TARGET_SHA: ADDITIONAL.sourceSha,
    GITHUB_RUN_ID: ADDITIONAL.runId, GITHUB_RUN_ATTEMPT: "1", BACKUP_RUN_ID: ADDITIONAL.runId, BACKUP_RUN_ATTEMPT: "1" }));
  const reports = {
    readiness: Buffer.from(JSON.stringify({ backupReady: true, recoveryRehearsalReady: true, blockers: [], recoveryBlockers: [] })),
    create: Buffer.from(JSON.stringify({ schemaVersion: 2, status: "created", outputBytes: 1024, outputSha256: "d".repeat(64), source })),
    transfer: Buffer.from("synthetic transfer report\n"),
    verify: Buffer.from(JSON.stringify({ schemaVersion: 2, status: "verified", inputBytes: 1024, source })),
    restore: Buffer.from(JSON.stringify({ schemaVersion: 2, status: "restored", backupStatus: "verified", inputBytes: 1024, source,
      isolation: "ephemeral_docker_no_network", recoveryContentStatus: "verified", restoredBaseline: baseline, restoredRecoveryContent: source.database.recoveryContent })),
  };
  const subject = { schemaVersion: 1, backupWorkflow: { repository: "fafona/space", runId: ADDITIONAL.runId, runAttempt: "1", event: "schedule" }, source,
    subject: { bytes: 1024, digest: "sha256:" + "d".repeat(64) },
    reports: Object.fromEntries(Object.entries(reports).map(([key, bytes]) => [key, { bytes: bytes.length, sha256: digest(bytes) }])) };
  reports.subject = Buffer.from(JSON.stringify(subject, null, 2));
  const bytes = canonicalJsonBytes(predicate);
  return { binding: { bytes: binding, provenance: additionalProvenance(binding, "production-maintenance-binding.json") },
    predicate: { bytes, provenance: additionalProvenance(bytes, "production-backup-attestation.json") }, reports };
}
function record(bytes) {
  const binding = JSON.parse(bytes), results = additionalProvenance(bytes, "production-maintenance-binding.json");
  const predicate = results[0].verificationResult.statement.predicate;
  const path = binding.phase === "backup" ? ".github/workflows/database-backup.yml" : ".github/workflows/ordinary-account-cutover-readiness.yml";
  predicate.buildDefinition.externalParameters.workflow.path = path;
  predicate.buildDefinition.internalParameters.github.event_name = "workflow_dispatch";
  predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = PREVIOUS;
  predicate.runDetails.builder.id = "https://github.com/fafona/space/" + path + "@refs/heads/main";
  predicate.runDetails.metadata.invocationId = "https://github.com/fafona/space/actions/runs/" + binding.runId + "/attempts/1";
  return { bytes, provenance: results };
}
function bindings() {
  return Object.fromEntries(["backup", "readiness"].map(phase => [phase, record(canonicalJsonBytes(buildProductionMaintenanceBinding(phase, {
    MAINTENANCE_MODE: "maintenance", TARGET_SHA: PREVIOUS, EXPECTED_OLD_SHA: inspection.expectedOldSha,
    MAINTENANCE_OPERATION_ID: inspection.operationId, GITHUB_RUN_ID: phase === "backup" ? inspection.backupRunId : inspection.readinessRunId,
    GITHUB_RUN_ATTEMPT: "1", BACKUP_RUN_ID: inspection.backupRunId, BACKUP_RUN_ATTEMPT: "1", READINESS_RUN_ID: inspection.readinessRunId, READINESS_RUN_ATTEMPT: "1",
  })))]));
}
const history = transform => inspectMaintenanceAttemptRecoveryHistory(inspection, fixture(transform).api, NOW);
const evidence = (transform, patch = {}, prior = bindings()) => createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, fixture(transform).api, prior, NOW, additionalRecords());
const changeRun = (id, patch) => (_key, value) => {
  if (Array.isArray(value.workflow_runs)) value.workflow_runs = value.workflow_runs.map(row => String(row.id) === id ? { ...row, ...patch } : row);
  return value;
};
const changeJob = (id, mutate) => (key, value) => { if (key === "job:" + id) mutate(value); return value; };

test("all ten exact incidents produce canonical evidence without relabelling the T5 signed subjects", async () => {
  const f = fixture(), prior = bindings(), result = await createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW, additionalRecords());
  assert.equal(result.attemptRecoveryRunId, env.GITHUB_RUN_ID); assert.equal(result.attemptRecoveryRunAttempt, 1);
  assert.equal(result.mainCIrunId, "34728900000"); assert.equal(result.toolsSha, TARGET); assert.equal(result.historyCheckedAt, NOW);
  assert.equal(result.deadlineAuthorizationDigest, MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION_DIGEST);
  assert.match(result.historyDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(decodeMaintenanceAttemptRecoveryEvidence(encodeMaintenanceAttemptRecoveryEvidence(result)), result);
  assert.equal(f.calls.filter(value => value.endsWith("commits/main")).length, 2);
  assert.equal(f.calls.filter(value => value.includes("/attempts/1/jobs?")).length, 13);
  assert.deepEqual((await history()).incidents.map(value => value.id), incidents.map(value => value[0]));
  assert.equal(validateMaintenanceAttemptRecoveryPriorBindings(inspection, prior).backup.binding.targetSha, PREVIOUS);
  assert.equal(validateMaintenanceAttemptRecoveryPriorBindings(inspection, prior).readiness.binding.backupRunId, inspection.backupRunId);
});

test("fixed action, confirmation, repository, run attempt and target binding reject before any API request", async () => {
  for (const patch of [{ ACTION: "continue-held" }, { CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE" },
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE" }, { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100034Z" },
    { GITHUB_REPOSITORY: "other/space" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "00" }, { GITHUB_SHA: PREVIOUS }, { TARGET_SHA: PREVIOUS },
    { PREVIOUS_TARGET_SHA: OLD }, { EXPECTED_OLD_SHA: TARGET }, { MAINTENANCE_OPERATION_ID: "invalid" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, f.api, bindings(), NOW, additionalRecords()));
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
    [...value.workflow_runs, ...Array.from({ length: 96 }, (_, i) => old(files[0], i + 1))] : [old(files[0], 98)] } : value);
  const result = await createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW, additionalRecords());
  assert.ok(f.calls.some(value => value.endsWith("page=2")));
  assert.notEqual(result.historyDigest, (await evidence()).historyDigest);
});

test("missing tail, duplicate, changing total, unsupported count and exhausted page bounds fail closed", async () => {
  const first = incidents.filter(spec => spec[1] === 0).map(spec => run(spec)).concat(Array.from({ length: 97 }, (_, i) => old(files[0], i + 1)));
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
    { run_started_at: "2026-09-12T16:00:00Z" }, { updated_at: "2026-09-13T23:01:00Z" },
    { updated_at: "2026-09-12T18:00:00Z" }, { status: "in_progress" }])
    await assert.rejects(history(changeRun(inspection.failedDeployRunId, patch)));
  for (const now of [NaN, Infinity, 1.5, inspection.createdAt - 1, MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION.authorizedAt - 1,
    MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION.expiresAt])
    await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, fixture().api, bindings(), now, additionalRecords()));
});

test("the additional attempt uses actual 22:15:38 to 04 UTC clock and a fresh stopped baseline", async () => {
  const auth = MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION;
  assert.equal(auth.authorizedAt, Date.parse("2026-09-13T22:15:38Z"));
  assert.equal(auth.previousExpiresAt, Date.parse("2026-09-13T22:00:00Z"));
  assert.equal(auth.expiresAt, Date.parse("2026-09-14T04:00:00Z"));
  for (const now of [auth.authorizedAt - 1, auth.previousExpiresAt, auth.expiresAt, auth.expiresAt + 1, NOW + 300000, NOW - 1001]) {
    const f = fixture();
    await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), now, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await evidence()).deadlineAuthorizationDigest, inspection.deadlineAuthorizationDigest);
  assert.throws(() => validateMaintenanceAttemptRecoveryAdditionalBackup(additionalRecords(), auth.expiresAt));
});

test("extension does not erase new scheduled activity after the original deadline or change the seven exceptions", async () => {
  await assert.rejects(history((key, value) => key === files[0] ? { total_count: value.total_count + 1,
    workflow_runs: [...value.workflow_runs, old(files[0], 100, { event: "schedule", created_at: "2026-09-13T06:30:00Z",
      run_started_at: "2026-09-13T06:30:01Z", updated_at: "2026-09-13T06:30:02Z" })] } : value));
  for (const digest of [undefined, "0".repeat(64), "bad"]) {
    const f = fixture();
    await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence({ ...inspection, deadlineAuthorizationDigest: digest }, env, f.api, bindings(), NOW, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
});

test("all ten genuine snake-case jobs, one-job inventories and required successful guard steps are checked", async () => {
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

test("all three failed deployments fail only Deploy To Server; later candidate, public and attestation steps stay skipped", async () => {
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

test("the full B2-M-R2-D2 then B3-R3-D3 and B5-R5-D5 order is checked independently of API enumeration order", async () => {
  for (let i = 1; i < incidents.length; i++)
    await assert.rejects(history(changeRun(incidents[i][0], { created_at: iso(Date.parse(incidents[i - 1][4]) - 1000) })));
  for (const patch of [{ completed_at: null }, { status: "queued" }, { conclusion: "timed_out" },
    { started_at: "2026-09-12T16:00:00Z" }, { completed_at: "2026-09-13T03:00:00Z" }])
    await assert.rejects(history(changeJob(inspection.failedDeployRunId, value => Object.assign(value.jobs[0].steps[0], patch))));
});

test("only signed B5/R5 subjects match; neither T2 evidence nor T4 relabelling is accepted", async () => {
  for (const phase of ["backup", "readiness"]) for (const patch of [
    { targetSha: OLD }, { targetSha: TARGET }, { operationId: "11111111-1111-4111-8111-111111111111" },
    { expectedOldSha: TARGET }, { mode: "off" }, { phase: "deploy" }, { runId: "34715932102" }, { runAttempt: "2" },
    { backupRunId: "34715932102" }, { backupRunAttempt: "2" }, { readinessRunId: "34721256683" }, { readinessRunAttempt: "2" },
  ]) {
    const prior = bindings(); prior[phase] = record(canonicalJsonBytes({ ...JSON.parse(prior[phase].bytes), ...patch }));
    const f = fixture(); await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW, additionalRecords()));
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
  ]) { const prior = bindings(); mutate(prior); assert.throws(() => validateMaintenanceAttemptRecoveryPriorBindings(inspection, prior)); }
});

test("malformed fixed inspection starts zero requests and any API failure returns no grant", async () => {
  for (const patch of [{ targetSha: PREVIOUS }, { backupRunAttempt: 2 }, { migrationRunId: "123" }, { revision: 8 },
    { predecessorJournalDigest: "bad" }, { stateDigest: "0".repeat(64) }, { extra: "PRIVATE_SENTINEL" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence({ ...inspection, ...patch }, env, f.api, bindings(), NOW, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
  let requests = 0;
  await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, async () => { requests++; throw new Error("offline"); }, bindings(), NOW, additionalRecords()), /offline/);
  assert.equal(requests, 1);
});

test("input bindings remain unchanged and original historic job details remain in the history digest", async () => {
  const prior = bindings(), before = structuredClone(inspection), backup = Buffer.from(prior.backup.bytes);
  await createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, fixture().api, prior, NOW, additionalRecords());
  assert.deepEqual(inspection, before); assert.deepEqual(prior.backup.bytes, backup);
  const altered = await evidence(changeJob("34715932102", value => { value.jobs[0].steps[0].completed_at = value.jobs[0].steps[0].started_at; }));
  assert.notEqual(altered.historyDigest, (await evidence()).historyDigest);
});

test("CLI rejects invalid invocation with only the fixed error, without credential or source output", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./production-maintenance-attempt-recovery-workflow.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", FAOLLA_TEST_SECRET: "PRIVATE_SENTINEL" }, windowsHide: true,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "maintenance_attempt_recovery_workflow_unverified\n");
});

test("the sole scheduled exception requires the exact run, job, times and all three held steps skipped", async () => {
  assert.equal((await history()).additionalBackup.id, ADDITIONAL.runId);
  for (const patch of [{ run_attempt: 2 }, { event: "workflow_dispatch" }, { head_sha: PREVIOUS }, { conclusion: "failure" },
    { created_at: "2026-09-13T07:28:49Z" }, { run_started_at: "2026-09-13T07:28:51Z" }, { updated_at: "2026-09-13T08:12:23Z" }])
    await assert.rejects(history(changeRun(ADDITIONAL.runId, patch)));
  await assert.rejects(history((key, value) => key === files[0] ? { total_count: value.total_count - 1, workflow_runs: value.workflow_runs.filter(row => row.id !== Number(ADDITIONAL.runId)) } : value));
  for (const mutate of [value => { value.jobs[0].id++; }, value => { value.jobs[0].started_at = ADDITIONAL.runStartedAt; },
    value => { value.jobs[0].completed_at = ADDITIONAL.updatedAt; },
    ...additionalJob().steps.map((_, index) => value => { value.jobs[0].steps[index].conclusion = value.jobs[0].steps[index].conclusion === "skipped" ? "success" : "skipped"; })])
    await assert.rejects(history(changeJob(ADDITIONAL.runId, mutate)));
});

test("fixed small artifact inventory binds live IDs, names, sizes, digests and source without fetching payload bytes", async () => {
  for (const mutate of [value => { value.total_count++; }, value => { value.artifacts.pop(); }, value => { value.artifacts[3].name = value.artifacts[0].name; },
    value => { value.artifacts[3].id = value.artifacts[0].id; }, value => { value.artifacts[3].name = "unknown"; },
    ...[0, 1, 2].flatMap(index => [
      value => { value.artifacts[index].id++; }, value => { value.artifacts[index].size_in_bytes++; }, value => { value.artifacts[index].digest = "sha256:" + "0".repeat(64); },
      value => { value.artifacts[index].expired = true; }, value => { value.artifacts[index].workflow_run.id++; },
      value => { value.artifacts[index].workflow_run.head_sha = TARGET; }, value => { value.artifacts[index].workflow_run.head_branch = "feature"; }])])
    await assert.rejects(evidence((key, value) => { if (key === "artifacts") mutate(value); return value; }));
  const f = fixture(), result = await createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW, additionalRecords());
  assert.match(result.historyDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.backupRunId, "34778579797"); assert.equal(result.readinessRunId, "34781336277");
  assert.equal(f.calls.filter(call => call.includes("/artifacts?")).length, 1);
  assert.ok(f.calls.every(call => !call.endsWith("/zip")));
});

test("additional off binding, hosted schedule provenance and exact report hashes must all match", async () => {
  const summary = validateMaintenanceAttemptRecoveryAdditionalBackup(additionalRecords(), NOW);
  assert.equal(summary.specDigest, MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST);
  for (const mutate of [
    value => { value.extra = true; }, value => { delete value.predicate; }, value => { value.binding.provenance = []; },
    ...["binding", "predicate"].flatMap(key => [
      value => { value[key].provenance[0].verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64); },
      value => { value[key].provenance[0].verificationResult.statement.predicate.runDetails.metadata.invocationId = "https://github.com/fafona/space/actions/runs/34745334237/attempts/2"; },
      value => { value[key].provenance[0].verificationResult.statement.predicate.buildDefinition.internalParameters.github.runner_environment = "self-hosted"; },
      value => { value[key].provenance[0].verificationResult.statement.predicate.buildDefinition.internalParameters.github.event_name = "workflow_dispatch"; },
      value => { value[key].provenance[0].verificationResult.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = TARGET; }]),
    value => { const binding = JSON.parse(value.binding.bytes); binding.operationId = inspection.operationId;
      value.binding.bytes = canonicalJsonBytes(binding); value.binding.provenance = additionalProvenance(value.binding.bytes, "production-maintenance-binding.json"); },
    value => { value.reports.transfer = Buffer.from("substituted"); }, value => { value.reports.restore = Buffer.alloc(65537); },
    value => { const subject = JSON.parse(value.reports.subject); subject.source.sha = TARGET; value.reports.subject = Buffer.from(JSON.stringify(subject)); },
    value => { const subject = JSON.parse(value.reports.subject); subject.reports.restore.sha256 = "0".repeat(64); value.reports.subject = Buffer.from(JSON.stringify(subject)); },
  ]) { const records = additionalRecords(); mutate(records); assert.throws(() => validateMaintenanceAttemptRecoveryAdditionalBackup(records, NOW)); }
  const f = fixture(); await assert.rejects(createMaintenanceAttemptRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW)); assert.equal(f.calls.length, 0);
  assert.throws(() => readMaintenanceAttemptRecoveryAdditionalBackup(fileURLToPath(new URL(".", import.meta.url))));
});
test("the exact prior recovery and its original ten-job main CI are read fresh, never relabelled", async () => {
  for (const key of ["prior-recovery", "prior-ci"]) for (const patch of [
    { id: 1 }, { run_attempt: 2 }, { head_sha: TARGET }, { status: "queued" }, { conclusion: "failure" }, { event: "pull_request" },
    { repository: null }, { head_repository: null }, { path: ".github/workflows/deploy.yml" }]) {
    await assert.rejects(evidence((k, value) => k === key ? { ...value, ...patch } : value));
  }
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].id++, v => v.jobs[0].head_sha = TARGET,
    ...priorJobs("prior-recovery").jobs[0].steps.map((_, index) => v => { v.jobs[0].steps[index].conclusion = v.jobs[0].steps[index].conclusion === "success" ? "skipped" : "success"; })])
    await assert.rejects(evidence((key, value) => { if (key === "prior-recovery-jobs") mutate(value); return value; }));
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].run_id++, v => v.jobs[0].conclusion = "failure",
    v => v.jobs[0].id = v.jobs[1].id, v => v.jobs[0].name = v.jobs[1].name])
    await assert.rejects(evidence((key, value) => { if (key === "prior-ci-jobs") mutate(value); return value; }));
});

test("B5 and R5 require hosted exact workflow/source/invocation in addition to their byte subject", () => {
  for (const phase of ["backup", "readiness"]) for (const mutate of [
    p => p.buildDefinition.internalParameters.github.runner_environment = "self-hosted",
    p => p.buildDefinition.internalParameters.github.event_name = "schedule",
    p => p.buildDefinition.externalParameters.workflow.path = ".github/workflows/deploy.yml",
    p => p.buildDefinition.resolvedDependencies[0].digest.gitCommit = TARGET,
    p => p.runDetails.metadata.invocationId += "2",
    p => p.runDetails.builder.id = "https://example.invalid/fake"]) {
    const prior = bindings(); mutate(prior[phase].provenance[0].verificationResult.statement.predicate);
    assert.throws(() => validateMaintenanceAttemptRecoveryPriorBindings(inspection, prior));
  }
});
