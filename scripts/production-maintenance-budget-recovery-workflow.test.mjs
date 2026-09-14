import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateMaintenanceBudgetRecoveryInspection, encodeMaintenanceBudgetRecoveryEvidence,
  decodeMaintenanceBudgetRecoveryEvidence, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION,
  MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION_DIGEST,
  MAINTENANCE_BUDGET_RECOVERY_INCIDENT as INCIDENT } from "./production-maintenance-budget-recovery.mjs";
import { MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP as ADDITIONAL,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST } from "./production-maintenance-build-recovery.mjs";
import { validateMaintenanceBudgetRecoveryPriorBindings, inspectMaintenanceBudgetRecoveryHistory,
  createMaintenanceBudgetRecoveryWorkflowEvidence, validateMaintenanceBudgetRecoveryAdditionalBackup,
  readMaintenanceBudgetRecoveryAdditionalBackup, MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS,
  MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS, MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION } from "./production-maintenance-budget-recovery-workflow.mjs";
import { buildProductionMaintenanceBinding } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";

// Synthetic authenticated API responses; no GitHub, host, build, or state writes.
const OLD = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf";
const EARLIER = "46f007fbd9e417f93c01e398c77cf38ec814547d", PREVIOUS = INCIDENT.previousTargetSha, TARGET = "a".repeat(40);
const SECOND = "3af8fa6ba6644593e10bef0a391389b2b34e926a";
const LAUNCHED = "f3104de19aa59e527c7b94a99850d151448da8cd";
const NOW = Date.parse("2026-09-14T08:30:00Z");
const baseline = { version: 3, stateDigest: INCIDENT.stateDigest, candidateDigest: "a".repeat(64), launchDiskDigest: "b".repeat(64),
  launchJournalDigest: "c".repeat(64), runtimeDigest: "d".repeat(64), current: {
    target: "/srv/faolla.releases/d9de5fe68922-20260914032500", linkIdentity: "1:2:3:4:5:1:0:41471", runtimeIdentity: "1:2:3:4:5:2:0:16877" },
  bootId: INCIDENT.bootId, pm2RegistryDigest: "e".repeat(64), observedAt: NOW - 1000 };
const inspection = validateMaintenanceBudgetRecoveryInspection({
  version: 1, state: "budget-recovery-inspected", operationId: INCIDENT.operationId, targetSha: TARGET, previousTargetSha: PREVIOUS,
  expectedOldSha: INCIDENT.expectedOldSha, revision: 31, stateDigest: INCIDENT.stateDigest, createdAt: INCIDENT.createdAt, activeAttempt: 3,
  sourceDiffDigest: "f".repeat(64), migrationDigest: "a".repeat(64), predecessorJournalDigest: baseline.launchJournalDigest,
  stoppedBaselineDigest: createHash("sha256").update(JSON.stringify(baseline)).digest("hex"), stoppedBaseline: baseline,
  authorizationDigest: MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION_DIGEST,
  ...Object.fromEntries(["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt",
    "failedDeployRunId", "failedDeployRunAttempt"].map(key => [key, INCIDENT[key]])),
});

test("the two complete real failed-run projections and separate history authorization are immutable", async () => {
  assert.equal(createHash("sha256").update(JSON.stringify(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS)).digest("hex"),
    "ce4b662e7428878970eef8ff04899a636f10af6404e116a604857c7d96b8b6e8");
  const auth = MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION;
  assert.deepEqual(auth, { version: 1, authorizedAt: Date.parse("2026-09-14T08:24:49Z") });
  assert.throws(() => { MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[0].steps[3][2] = "success"; });
  const result = await history();
  assert.deepEqual(result.failedHistoryAuthorization, auth);
  assert.equal(result.failedScheduledBackup.run.id, 34820083043);
  assert.equal(result.failedBudgetRecovery.run.id, 34821029270);
  assert.equal(result.failedScheduledBackup.job.steps.length, 30);
  assert.equal(result.failedBudgetRecovery.job.steps.length, 43);
  assert.deepEqual(result.failedScheduledBackup.artifacts, { total_count: 0, artifacts: [] });
  assert.deepEqual(result.failedBudgetRecovery.artifacts, { total_count: 0, artifacts: [] });
  assert.ok(!result.incidents.some(value => ["34820083043", "34821029270"].includes(value.id)));
  await assert.rejects(inspectMaintenanceBudgetRecoveryHistory(inspection, fixture().api, auth.authorizedAt - 1));
  await inspectMaintenanceBudgetRecoveryHistory(inspection, fixture().api, auth.authorizedAt);
  for (const spec of MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS)
    await assert.rejects(evidence(undefined, { GITHUB_RUN_ID: String(spec.run.id) }));
});

test("each failed run refuses wrong event SHA retry terminal time identity or missing history row", async () => {
  for (let index = 0; index < 2; index++) for (const patch of [
    { id: 1 }, { event: "push" }, { head_sha: TARGET }, { head_branch: "feature" }, { run_attempt: 2 },
    { status: "in_progress" }, { conclusion: "success" }, { repository: null }, { head_repository: null },
    { created_at: "2026-09-14T07:54:59Z" }, { run_started_at: "2026-09-14T07:55:01Z" },
    { updated_at: "2026-09-14T08:07:29Z" }, { path: ".github/workflows/other.yml" },
  ]) await assert.rejects(history((key, value) => key === "fixed-failed-" + index + "-run" ? { ...value, ...patch } : value));
  await assert.rejects(history((key, value) => key === files[0] ? { total_count: value.total_count - 1,
    workflow_runs: value.workflow_runs.filter(run => run.id !== 34820083043) } : value));
  await assert.rejects(history((key, value) => key === files[0] ? { ...value,
    workflow_runs: value.workflow_runs.map(run => run.id === 34820083043 ? { ...run, event: "workflow_dispatch" } : run) } : value));
});

test("every fixed failed-run step, especially remote and transition skips, is required exactly", async () => {
  for (let index = 0; index < 2; index++) {
    const keyName = "fixed-failed-" + index + "-jobs";
    for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].id++, v => v.jobs[0].head_sha = TARGET,
      v => v.jobs[0].started_at = "2026-09-14T07:55:00Z", v => v.jobs[0].steps.pop(),
      v => v.jobs[0].steps.push({ ...v.jobs[0].steps[0] })])
      await assert.rejects(history((key, value) => { if (key === keyName) mutate(value); return value; }));
    for (let step = 0; step < MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[index].steps.length; step++) {
      for (const mutate of [s => s.conclusion = s.conclusion === "success" ? "skipped" : "success", s => s.number++,
        s => s.name += " altered", s => s.status = "in_progress", s => s.completed_at = "2026-09-14T08:07:29Z"])
        await assert.rejects(history((key, value) => { if (key === keyName) mutate(value.jobs[0].steps[step]); return value; }));
    }
  }
});

test("zero artifacts and the second observation of both failed histories cannot be substituted", async () => {
  for (let index = 0; index < 2; index++) {
    for (const patch of [{ total_count: 1, artifacts: [{ id: 1 }] }, { total_count: 0, artifacts: [{ id: 1 }] },
      { total_count: 1, artifacts: [] }, { total_count: 0, artifacts: null }])
      await assert.rejects(history((key, value) => key === "fixed-failed-" + index + "-artifacts" ? patch : value));
    for (const suffix of ["run", "jobs", "artifacts"]) {
      let seen = 0;
      await assert.rejects(history((key, value) => {
        if (key === "fixed-failed-" + index + "-" + suffix && ++seen === 2) {
          if (suffix === "run") value.run_attempt = 2;
          if (suffix === "jobs") value.jobs[0].steps[0].conclusion = "failure";
          if (suffix === "artifacts") value.artifacts.push({ id: 1 });
        }
        return value;
      }));
      assert.equal(seen, 2);
    }
  }
});

test("the expired fixed scheduled subject is historical only and must have been valid at actual completion", () => {
  const records = additionalRecords(), predicate = JSON.parse(records.predicate.bytes);
  assert.ok(Date.parse(predicate.validUntil) < NOW);
  const result = validateMaintenanceBudgetRecoveryAdditionalBackup(records, NOW);
  assert.equal(result.historicalValidationAt, Date.parse(ADDITIONAL.updatedAt));
  for (const patch of [
    { validUntil: "2026-09-13T08:12:21.000Z" },
    { issuedAt: "2026-09-13T08:12:23.000Z" },
  ]) {
    const bad = additionalRecords(), value = { ...JSON.parse(bad.predicate.bytes), ...patch };
    bad.predicate.bytes = canonicalJsonBytes(value);
    bad.predicate.provenance = additionalProvenance(bad.predicate.bytes, "production-backup-attestation.json");
    assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(bad, NOW));
  }
  const bytesChanged = additionalRecords();
  bytesChanged.predicate.bytes = Buffer.from(bytesChanged.predicate.bytes.toString().replace("08:12:11", "08:12:10"));
  assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(bytesChanged, NOW));
  const signatureChanged = additionalRecords();
  signatureChanged.predicate.provenance[0].verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64);
  assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(signatureChanged, NOW));
  assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(records, MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION.authorizedAt - 1));
  assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(records, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.expiresAt));
});

const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "34729000000", GITHUB_SHA: TARGET, TARGET_SHA: TARGET,
  PREVIOUS_TARGET_SHA: PREVIOUS, EXPECTED_OLD_SHA: inspection.expectedOldSha, MAINTENANCE_OPERATION_ID: inspection.operationId,
  ACTION: "recover-budget", CONFIRMATION: "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z" };
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
  ["34778579797", 0, LAUNCHED, "2026-09-13T19:43:01Z", "2026-09-13T20:34:00Z"],
  ["34781336277", 2, LAUNCHED, "2026-09-13T20:37:16Z", "2026-09-13T20:38:19Z"],
  ["34781392661", 3, LAUNCHED, "2026-09-13T20:38:22Z", "2026-09-13T20:44:33Z"],
  ["34789894868", 0, SECOND, "2026-09-13T23:30:29Z", "2026-09-13T23:47:14Z"],
  ["34790775352", 2, SECOND, "2026-09-13T23:48:52Z", "2026-09-13T23:49:59Z"],
  ["34790827235", 3, SECOND, "2026-09-13T23:50:01Z", "2026-09-13T23:57:59Z"],
  ["34800653808", 0, PREVIOUS, "2026-09-14T02:52:25Z", "2026-09-14T03:15:43Z"],
  ["34802075500", 2, PREVIOUS, "2026-09-14T03:16:58Z", "2026-09-14T03:18:04Z"],
  ["34802138869", 3, PREVIOUS, "2026-09-14T03:18:05Z", "2026-09-14T03:27:36Z"],
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
    status: "completed", conclusion: index === 3 ? "failure" : "success", created_at: ["34789894868", "34790775352", "34790827235", "34800653808", "34802075500", "34802138869"].includes(id) ? started : iso(Date.parse(started) - 1000),
    run_started_at: started, updated_at: ended, ...patch };
}
const realLatestJobs = {"34800653808":{"completed_at":"2026-09-14T03:15:42Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103842504637,"name":"backup","run_id":34800653808,"started_at":"2026-09-14T02:52:31Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:52:33Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:52:32Z","status":"completed"},{"completed_at":"2026-09-14T02:52:42Z","conclusion":"success","name":"Checkout Exact Backup Source","number":2,"started_at":"2026-09-14T02:52:33Z","status":"completed"},{"completed_at":"2026-09-14T02:52:44Z","conclusion":"success","name":"Verify Current Main And Exact Successful Push CI","number":3,"started_at":"2026-09-14T02:52:42Z","status":"completed"},{"completed_at":"2026-09-14T02:52:46Z","conclusion":"success","name":"Setup Pinned SSH Host Trust","number":4,"started_at":"2026-09-14T02:52:44Z","status":"completed"},{"completed_at":"2026-09-14T02:52:48Z","conclusion":"success","name":"Prepare Remote Detached Exact Source","number":5,"started_at":"2026-09-14T02:52:46Z","status":"completed"},{"completed_at":"2026-09-14T02:53:04Z","conclusion":"success","name":"Verify Held Maintenance Before Backup","number":6,"started_at":"2026-09-14T02:52:48Z","status":"completed"},{"completed_at":"2026-09-14T02:53:05Z","conclusion":"success","name":"Verify Backup Configuration From Exact Source","number":7,"started_at":"2026-09-14T02:53:04Z","status":"completed"},{"completed_at":"2026-09-14T02:53:35Z","conclusion":"success","name":"Create Encrypted Database Backup From Exact Source","number":8,"started_at":"2026-09-14T02:53:05Z","status":"completed"},{"completed_at":"2026-09-14T02:53:48Z","conclusion":"success","name":"Verify Held Maintenance After Backup Capture","number":9,"started_at":"2026-09-14T02:53:35Z","status":"completed"},{"completed_at":"2026-09-14T03:13:35Z","conclusion":"success","name":"Transfer Complete Encrypted Backup","number":10,"started_at":"2026-09-14T02:53:48Z","status":"completed"},{"completed_at":"2026-09-14T03:13:41Z","conclusion":"success","name":"Verify Encrypted Backup","number":11,"started_at":"2026-09-14T03:13:35Z","status":"completed"},{"completed_at":"2026-09-14T03:15:04Z","conclusion":"success","name":"Rehearse Isolated Restore","number":12,"started_at":"2026-09-14T03:13:41Z","status":"completed"},{"completed_at":"2026-09-14T03:15:05Z","conclusion":"success","name":"Confirm Backup Is Ready For Upload","number":13,"started_at":"2026-09-14T03:15:04Z","status":"completed"},{"completed_at":"2026-09-14T03:15:11Z","conclusion":"success","name":"Upload Verified Encrypted Backup","number":14,"started_at":"2026-09-14T03:15:05Z","status":"completed"},{"completed_at":"2026-09-14T03:15:11Z","conclusion":"success","name":"Verify Uploaded Backup Artifact Identity","number":15,"started_at":"2026-09-14T03:15:11Z","status":"completed"},{"completed_at":"2026-09-14T03:15:12Z","conclusion":"success","name":"Generate Backup Attestation Predicate","number":16,"started_at":"2026-09-14T03:15:11Z","status":"completed"},{"completed_at":"2026-09-14T03:15:13Z","conclusion":"success","name":"Upload Canonical Backup Attestation Input","number":17,"started_at":"2026-09-14T03:15:12Z","status":"completed"},{"completed_at":"2026-09-14T03:15:14Z","conclusion":"success","name":"Upload Backup Verification And Attestation Inputs","number":18,"started_at":"2026-09-14T03:15:13Z","status":"completed"},{"completed_at":"2026-09-14T03:15:17Z","conclusion":"success","name":"Attest Verified Encrypted Backup","number":19,"started_at":"2026-09-14T03:15:14Z","status":"completed"},{"completed_at":"2026-09-14T03:15:19Z","conclusion":"success","name":"Attest Canonical Backup Attestation Input","number":20,"started_at":"2026-09-14T03:15:17Z","status":"completed"},{"completed_at":"2026-09-14T03:15:20Z","conclusion":"success","name":"Upload Encrypted Backup Attestation Bundle","number":21,"started_at":"2026-09-14T03:15:19Z","status":"completed"},{"completed_at":"2026-09-14T03:15:21Z","conclusion":"success","name":"Upload Canonical Backup Attestation Bundle","number":22,"started_at":"2026-09-14T03:15:20Z","status":"completed"},{"completed_at":"2026-09-14T03:15:35Z","conclusion":"success","name":"Verify Held Maintenance Before Backup Attestation","number":23,"started_at":"2026-09-14T03:15:21Z","status":"completed"},{"completed_at":"2026-09-14T03:15:35Z","conclusion":"success","name":"Build Canonical Maintenance Binding","number":24,"started_at":"2026-09-14T03:15:35Z","status":"completed"},{"completed_at":"2026-09-14T03:15:36Z","conclusion":"success","name":"Upload Canonical Maintenance Binding","number":25,"started_at":"2026-09-14T03:15:35Z","status":"completed"},{"completed_at":"2026-09-14T03:15:38Z","conclusion":"success","name":"Attest Canonical Maintenance Binding","number":26,"started_at":"2026-09-14T03:15:36Z","status":"completed"},{"completed_at":"2026-09-14T03:15:38Z","conclusion":"skipped","name":"Upload Backup Failure Diagnostics","number":27,"started_at":"2026-09-14T03:15:38Z","status":"completed"},{"completed_at":"2026-09-14T03:15:39Z","conclusion":"success","name":"Remove Temporary Backup And Exact Source","number":28,"started_at":"2026-09-14T03:15:38Z","status":"completed"},{"completed_at":"2026-09-14T03:15:39Z","conclusion":"success","name":"Post Checkout Exact Backup Source","number":56,"started_at":"2026-09-14T03:15:39Z","status":"completed"},{"completed_at":"2026-09-14T03:15:39Z","conclusion":"success","name":"Complete job","number":57,"started_at":"2026-09-14T03:15:39Z","status":"completed"}]},"34802075500":{"completed_at":"2026-09-14T03:18:03Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103846573075,"name":"readiness","run_id":34802075500,"started_at":"2026-09-14T03:17:01Z","status":"completed","steps":[{"completed_at":"2026-09-14T03:17:03Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T03:17:02Z","status":"completed"},{"completed_at":"2026-09-14T03:17:05Z","conclusion":"success","name":"Validate Manual Release Chain","number":2,"started_at":"2026-09-14T03:17:03Z","status":"completed"},{"completed_at":"2026-09-14T03:17:11Z","conclusion":"success","name":"Checkout Exact Readiness Source","number":3,"started_at":"2026-09-14T03:17:05Z","status":"completed"},{"completed_at":"2026-09-14T03:17:12Z","conclusion":"success","name":"Verify Exact Current Main Checkout","number":4,"started_at":"2026-09-14T03:17:11Z","status":"completed"},{"completed_at":"2026-09-14T03:17:13Z","conclusion":"success","name":"Resolve Exact Successful Backup Artifact Inventory","number":5,"started_at":"2026-09-14T03:17:12Z","status":"completed"},{"completed_at":"2026-09-14T03:17:17Z","conclusion":"success","name":"Verify Recursive Backup Attestation Chain","number":6,"started_at":"2026-09-14T03:17:13Z","status":"completed"},{"completed_at":"2026-09-14T03:17:21Z","conclusion":"success","name":"Verify Signed Backup Maintenance Binding","number":7,"started_at":"2026-09-14T03:17:17Z","status":"completed"},{"completed_at":"2026-09-14T03:17:21Z","conclusion":"success","name":"Setup Pinned SSH Host Trust","number":8,"started_at":"2026-09-14T03:17:21Z","status":"completed"},{"completed_at":"2026-09-14T03:17:25Z","conclusion":"success","name":"Prepare Remote Detached Exact Source","number":9,"started_at":"2026-09-14T03:17:21Z","status":"completed"},{"completed_at":"2026-09-14T03:17:37Z","conclusion":"success","name":"Verify Held Maintenance Before Readiness","number":10,"started_at":"2026-09-14T03:17:25Z","status":"completed"},{"completed_at":"2026-09-14T03:17:40Z","conclusion":"success","name":"Inspect Locked Production Readiness From Exact Source","number":11,"started_at":"2026-09-14T03:17:37Z","status":"completed"},{"completed_at":"2026-09-14T03:17:41Z","conclusion":"success","name":"Upload Canonical Readiness Report","number":12,"started_at":"2026-09-14T03:17:40Z","status":"completed"},{"completed_at":"2026-09-14T03:17:41Z","conclusion":"success","name":"Verify Uploaded Readiness Report Artifact","number":13,"started_at":"2026-09-14T03:17:41Z","status":"completed"},{"completed_at":"2026-09-14T03:17:41Z","conclusion":"success","name":"Enforce Ready Cutover State","number":14,"started_at":"2026-09-14T03:17:41Z","status":"completed"},{"completed_at":"2026-09-14T03:17:41Z","conclusion":"success","name":"Build Canonical Readiness Attestation","number":15,"started_at":"2026-09-14T03:17:41Z","status":"completed"},{"completed_at":"2026-09-14T03:17:42Z","conclusion":"success","name":"Upload Canonical Readiness Attestation","number":16,"started_at":"2026-09-14T03:17:41Z","status":"completed"},{"completed_at":"2026-09-14T03:17:42Z","conclusion":"success","name":"Verify Uploaded Readiness Attestation Artifact","number":17,"started_at":"2026-09-14T03:17:42Z","status":"completed"},{"completed_at":"2026-09-14T03:17:44Z","conclusion":"success","name":"Attest Canonical Readiness Report","number":18,"started_at":"2026-09-14T03:17:42Z","status":"completed"},{"completed_at":"2026-09-14T03:17:45Z","conclusion":"success","name":"Attest Canonical Readiness Attestation","number":19,"started_at":"2026-09-14T03:17:44Z","status":"completed"},{"completed_at":"2026-09-14T03:17:57Z","conclusion":"success","name":"Verify Held Maintenance After Readiness","number":20,"started_at":"2026-09-14T03:17:45Z","status":"completed"},{"completed_at":"2026-09-14T03:17:57Z","conclusion":"success","name":"Build Canonical Maintenance Binding","number":21,"started_at":"2026-09-14T03:17:57Z","status":"completed"},{"completed_at":"2026-09-14T03:17:58Z","conclusion":"success","name":"Upload Canonical Maintenance Binding","number":22,"started_at":"2026-09-14T03:17:57Z","status":"completed"},{"completed_at":"2026-09-14T03:17:59Z","conclusion":"success","name":"Attest Canonical Maintenance Binding","number":23,"started_at":"2026-09-14T03:17:58Z","status":"completed"},{"completed_at":"2026-09-14T03:18:00Z","conclusion":"success","name":"Confirm Exact Successful Readiness Artifact Inventory","number":24,"started_at":"2026-09-14T03:17:59Z","status":"completed"},{"completed_at":"2026-09-14T03:18:01Z","conclusion":"success","name":"Remove Remote Exact Readiness Source","number":25,"started_at":"2026-09-14T03:18:00Z","status":"completed"},{"completed_at":"2026-09-14T03:18:02Z","conclusion":"success","name":"Post Checkout Exact Readiness Source","number":50,"started_at":"2026-09-14T03:18:01Z","status":"completed"},{"completed_at":"2026-09-14T03:18:02Z","conclusion":"success","name":"Complete job","number":51,"started_at":"2026-09-14T03:18:02Z","status":"completed"}]},"34802138869":{"completed_at":"2026-09-14T03:27:35Z","conclusion":"failure","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103846763201,"name":"deploy","run_id":34802138869,"started_at":"2026-09-14T03:18:09Z","status":"completed","steps":[{"completed_at":"2026-09-14T03:18:11Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T03:18:10Z","status":"completed"},{"completed_at":"2026-09-14T03:18:11Z","conclusion":"success","name":"Validate Readiness Workflow Run","number":2,"started_at":"2026-09-14T03:18:11Z","status":"completed"},{"completed_at":"2026-09-14T03:18:15Z","conclusion":"success","name":"Checkout Tested Commit","number":3,"started_at":"2026-09-14T03:18:11Z","status":"completed"},{"completed_at":"2026-09-14T03:18:15Z","conclusion":"success","name":"Resolve Deploy Commit","number":4,"started_at":"2026-09-14T03:18:15Z","status":"completed"},{"completed_at":"2026-09-14T03:18:16Z","conclusion":"success","name":"Resolve Readiness Artifacts","number":5,"started_at":"2026-09-14T03:18:15Z","status":"completed"},{"completed_at":"2026-09-14T03:18:23Z","conclusion":"success","name":"Verify Readiness Evidence","number":6,"started_at":"2026-09-14T03:18:16Z","status":"completed"},{"completed_at":"2026-09-14T03:18:25Z","conclusion":"success","name":"Revalidate Live Recursive Backup Evidence","number":7,"started_at":"2026-09-14T03:18:23Z","status":"completed"},{"completed_at":"2026-09-14T03:18:30Z","conclusion":"success","name":"Verify Signed Readiness Maintenance Binding","number":8,"started_at":"2026-09-14T03:18:25Z","status":"completed"},{"completed_at":"2026-09-14T03:18:30Z","conclusion":"success","name":"Export Verified Maintenance Binding","number":9,"started_at":"2026-09-14T03:18:30Z","status":"completed"},{"completed_at":"2026-09-14T03:18:30Z","conclusion":"success","name":"Setup SSH","number":10,"started_at":"2026-09-14T03:18:30Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"failure","name":"Deploy To Server","number":11,"started_at":"2026-09-14T03:18:30Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"skipped","name":"Verify Public Release","number":12,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"skipped","name":"Verify Candidate While Public Entry Remains Held","number":13,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"skipped","name":"Build Canonical Maintenance Binding","number":14,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"skipped","name":"Upload Canonical Maintenance Binding","number":15,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"skipped","name":"Attest Canonical Maintenance Binding","number":16,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"success","name":"Post Checkout Tested Commit","number":32,"started_at":"2026-09-14T03:27:33Z","status":"completed"},{"completed_at":"2026-09-14T03:27:33Z","conclusion":"success","name":"Complete job","number":33,"started_at":"2026-09-14T03:27:33Z","status":"completed"}]}};
function job(spec) {
  if (["34800653808", "34802075500", "34802138869"].includes(spec[0])) return structuredClone(realLatestJobs[spec[0]]);
  const r = run(spec), index = spec[1], base = Date.parse(r.id === 34790827235 ? "2026-09-13T23:50:04Z" : r.run_started_at);
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
  if (r.id === 34790827235) Object.assign(steps.find(step => step.name === "Deploy To Server"), { started_at: "2026-09-13T23:50:26Z", completed_at: "2026-09-13T23:57:57Z" });
  return { id: r.id === 34790827235 ? 103814590377 : r.id + 100000000000, run_id: r.id, head_sha: r.head_sha, status: "completed", conclusion: r.conclusion,
    started_at: r.id === 34790827235 ? "2026-09-13T23:50:04Z" : r.run_started_at, completed_at: r.id === 34790827235 ? "2026-09-13T23:57:58Z" : r.updated_at, steps };
}
function fixedFailedFixture(index) {
  const spec = structuredClone(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[index]);
  return { run: { ...spec.run, repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } },
    jobs: { total_count: 1, jobs: [{ ...spec.job, steps: spec.steps.map(([number, name, conclusion, started_at, completed_at]) =>
      ({ number, name, status: "completed", conclusion, started_at, completed_at })) }] }, artifacts: { total_count: 0, artifacts: [] } };
}
function fixture(transform = (_key, value) => value) {
  const calls = [];
  const api = async endpoint => {
    calls.push(endpoint);
    if (endpoint === "repos/fafona/space/commits/main") return transform("main", { sha: TARGET }, calls);
    for (let index = 0; index < MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS.length; index++) {
      const value = fixedFailedFixture(index), prefix = "repos/fafona/space/actions/runs/" + value.run.id, key = "fixed-failed-" + index;
      if (endpoint === prefix) return transform(key + "-run", value.run, calls);
      if (endpoint === prefix + "/attempts/1/jobs?per_page=100") return transform(key + "-jobs", value.jobs, calls);
      if (endpoint === prefix + "/artifacts?per_page=100") return transform(key + "-artifacts", value.artifacts, calls);
    }
    if (endpoint === "repos/fafona/space/actions/runs/34745334237/artifacts?per_page=100") return transform("artifacts", { total_count: 6,
      artifacts: MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS.map(artifact => ({ id: Number(artifact.id), name: artifact.name, size_in_bytes: artifact.bytes,
        digest: "sha256:" + artifact.sha256, expired: false, workflow_run: { id: Number(ADDITIONAL.runId), head_sha: ADDITIONAL.sourceSha, head_branch: "main" } }))
        .concat(["faolla-encrypted-backup-attestation-bundle-34745334237-1", "faolla-encrypted-disaster-recovery-34745334237-1",
          "faolla-production-backup-attestation-bundle-34745334237-1"].map((name, index) => ({ id: 100 + index, name }))) }, calls);
    for (const [id, key] of [["34800461043", "prior-second-recovery"], ["34799821827", "prior-second-ci"]]) {
      if (endpoint === "repos/fafona/space/actions/runs/" + id) return transform(key, priorSecondRun(key), calls);
      if (endpoint === "repos/fafona/space/actions/runs/" + id + "/attempts/1/jobs?per_page=100") return transform(key + "-jobs", priorSecondJobs(key), calls);
    }
    for (const [id, key] of [["34789744074", "prior-attempt-recovery"], ["34789133814", "prior-attempt-ci"]]) {
      if (endpoint === "repos/fafona/space/actions/runs/" + id) return transform(key, priorAttemptRun(key), calls);
      if (endpoint === "repos/fafona/space/actions/runs/" + id + "/attempts/1/jobs?per_page=100") return transform(key + "-jobs", priorAttemptJobs(key), calls);
    }
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
    if (file === files[0]) rows.unshift(fixedFailedFixture(0).run, additionalRun());
    return transform(file, { total_count: rows.length, workflow_runs: rows }, calls, Number(query.get("page")));
  };
  return { api, calls };
}
function priorRun(key) {
  const recovery = key === "prior-recovery";
  return { ...run(incidents[0]), id: recovery ? 34778424264 : 34777790522, name: recovery ? "Production Maintenance" : "CI",
    path: recovery ? ".github/workflows/production-maintenance.yml" : ".github/workflows/ci.yml", head_sha: LAUNCHED,
    event: recovery ? "workflow_dispatch" : "push", created_at: recovery ? "2026-09-13T19:40:42Z" : "2026-09-13T19:00:00Z",
    run_started_at: recovery ? "2026-09-13T19:40:42Z" : "2026-09-13T19:00:01Z",
    updated_at: recovery ? "2026-09-13T19:42:59Z" : "2026-09-13T19:30:00Z" };
}
function priorJobs(key) {
  if (key === "prior-ci") return { total_count: 10, jobs: Array.from({ length: 10 }, (_, index) => ({
    id: 90000000000 + index, name: "Synthetic CI " + index, run_id: 34777790522, head_sha: LAUNCHED,
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
  return { total_count: 1, jobs: [{ id: 103780842827, run_id: 34778424264, head_sha: LAUNCHED, status: "completed", conclusion: "success",
    started_at: "2026-09-13T19:40:46Z", completed_at: "2026-09-13T19:42:58Z", steps: [
      ...required.map(name => ({ name, status: "completed", conclusion: "success", started_at: "2026-09-13T19:40:46Z", completed_at: "2026-09-13T19:40:47Z" })),
      ...skipped.map(name => ({ name, status: "completed", conclusion: "skipped", started_at: null, completed_at: null }))] }] };
}

function priorAttemptRun(key) {
  const recovery = key === "prior-attempt-recovery";
  return { ...priorRun(recovery ? "prior-recovery" : "prior-ci"), id: recovery ? 34789744074 : 34789133814,
    head_sha: SECOND, created_at: recovery ? "2026-09-13T23:27:15Z" : "2026-09-13T23:14:38Z",
    run_started_at: recovery ? "2026-09-13T23:27:15Z" : "2026-09-13T23:14:38Z",
    updated_at: recovery ? "2026-09-13T23:29:37Z" : "2026-09-13T23:26:04Z" };
}
function priorAttemptJobs(key) {
  if (key === "prior-attempt-ci") return { total_count: 10, jobs: Array.from({ length: 10 }, (_, index) => ({
    id: 91000000000 + index, name: "Synthetic CI " + index, run_id: 34789133814, head_sha: SECOND,
    status: "completed", conclusion: "success", started_at: "2026-09-13T23:14:40Z", completed_at: "2026-09-13T23:25:59Z" })) };
  const required = ["Validate Fixed Manual Transition","Checkout Exact Maintenance Source","Require Current Main And Exact Successful Push CI","Setup Pinned SSH Trust","Prepare Remote Detached Exact Control Source","Verify Launched Incident Signed Backup And Readiness Bindings","Verify Attempt Recovery Historical Additional Backup","Inspect Stopped Launched Candidate Recovery State","Verify Exact Single Attempt Recovery History Under Production Lock","Execute Fixed Maintenance Transition","Remove Exact Temporary Control Source","Remove Runner Attempt Recovery Evidence","Remove Runner SSH Material"];
  const skipped = ["Require Exact Successful Maintenance Deploy Before End","Verify Signed Deploy Maintenance Binding","Inspect Original Failed Held Recovery State","Verify Complete Recovery History Under Production Lock","Inspect Migrated Unlaunched Continuation State","Verify Original Signed Backup And Readiness Bindings","Verify Exact Continuation History Under Production Lock","Inspect Failed Unlaunched Build Recovery State","Verify Build Incident Signed Backup And Readiness Bindings","Verify Fixed Additional Scheduled Backup Evidence","Verify Exact Build Recovery History Under Production Lock","Verify Real Public Release After End","Reclose Entry And Fail Held If End Is Unconfirmed","Remove Runner Recovery Inspection","Remove Runner Continuation Evidence","Remove Runner Build Recovery Evidence","Remove Fixed Additional Scheduled Backup Evidence"];
  return { total_count: 1, jobs: [{ id: 103811645002, run_id: 34789744074, head_sha: SECOND, status: "completed", conclusion: "success",
    started_at: "2026-09-13T23:27:20Z", completed_at: "2026-09-13T23:29:36Z", steps: [
      ...required.map(name => ({ name, status: "completed", conclusion: "success", started_at: "2026-09-13T23:27:22Z", completed_at: "2026-09-13T23:27:23Z" })),
      ...skipped.map(name => ({ name, status: "completed", conclusion: "skipped", started_at: null, completed_at: null }))] }] };
}

const realPriorSecond = {"recovery":{"run":{"conclusion":"success","created_at":"2026-09-14T02:48:54Z","event":"workflow_dispatch","head_branch":"main","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":34800461043,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","run_attempt":1,"run_started_at":"2026-09-14T02:48:54Z","status":"completed","updated_at":"2026-09-14T02:51:21Z","repository":{"full_name":"fafona/space"},"head_repository":{"full_name":"fafona/space"}},"jobs":{"jobs":[{"completed_at":"2026-09-14T02:51:20Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841938845,"name":"maintenance","run_id":34800461043,"started_at":"2026-09-14T02:48:58Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:49:00Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:48:59Z","status":"completed"},{"completed_at":"2026-09-14T02:49:00Z","conclusion":"success","name":"Validate Fixed Manual Transition","number":2,"started_at":"2026-09-14T02:49:00Z","status":"completed"},{"completed_at":"2026-09-14T02:49:04Z","conclusion":"success","name":"Checkout Exact Maintenance Source","number":3,"started_at":"2026-09-14T02:49:00Z","status":"completed"},{"completed_at":"2026-09-14T02:49:05Z","conclusion":"success","name":"Require Current Main And Exact Successful Push CI","number":4,"started_at":"2026-09-14T02:49:04Z","status":"completed"},{"completed_at":"2026-09-14T02:49:05Z","conclusion":"skipped","name":"Require Exact Successful Maintenance Deploy Before End","number":5,"started_at":"2026-09-14T02:49:05Z","status":"completed"},{"completed_at":"2026-09-14T02:49:05Z","conclusion":"skipped","name":"Verify Signed Deploy Maintenance Binding","number":6,"started_at":"2026-09-14T02:49:05Z","status":"completed"},{"completed_at":"2026-09-14T02:49:05Z","conclusion":"success","name":"Setup Pinned SSH Trust","number":7,"started_at":"2026-09-14T02:49:05Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"success","name":"Prepare Remote Detached Exact Control Source","number":8,"started_at":"2026-09-14T02:49:05Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Inspect Original Failed Held Recovery State","number":9,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Complete Recovery History Under Production Lock","number":10,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Inspect Migrated Unlaunched Continuation State","number":11,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Original Signed Backup And Readiness Bindings","number":12,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Exact Continuation History Under Production Lock","number":13,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Inspect Failed Unlaunched Build Recovery State","number":14,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Build Incident Signed Backup And Readiness Bindings","number":15,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Fixed Additional Scheduled Backup Evidence","number":16,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Exact Build Recovery History Under Production Lock","number":17,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Launched Incident Signed Backup And Readiness Bindings","number":18,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Attempt Recovery Historical Additional Backup","number":19,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Inspect Stopped Launched Candidate Recovery State","number":20,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:10Z","conclusion":"skipped","name":"Verify Exact Single Attempt Recovery History Under Production Lock","number":21,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:20Z","conclusion":"success","name":"Verify Second Launched Incident Signed Backup And Readiness Bindings","number":22,"started_at":"2026-09-14T02:49:10Z","status":"completed"},{"completed_at":"2026-09-14T02:49:27Z","conclusion":"success","name":"Verify Second Attempt Recovery Historical Additional Backup","number":23,"started_at":"2026-09-14T02:49:20Z","status":"completed"},{"completed_at":"2026-09-14T02:49:41Z","conclusion":"success","name":"Inspect Stopped Second Launched Candidate Recovery State","number":24,"started_at":"2026-09-14T02:49:27Z","status":"completed"},{"completed_at":"2026-09-14T02:50:51Z","conclusion":"success","name":"Verify Exact Second Attempt Recovery History Under Production Lock","number":25,"started_at":"2026-09-14T02:49:41Z","status":"completed"},{"completed_at":"2026-09-14T02:51:16Z","conclusion":"success","name":"Execute Fixed Maintenance Transition","number":26,"started_at":"2026-09-14T02:50:51Z","status":"completed"},{"completed_at":"2026-09-14T02:51:16Z","conclusion":"skipped","name":"Verify Real Public Release After End","number":27,"started_at":"2026-09-14T02:51:16Z","status":"completed"},{"completed_at":"2026-09-14T02:51:16Z","conclusion":"skipped","name":"Reclose Entry And Fail Held If End Is Unconfirmed","number":28,"started_at":"2026-09-14T02:51:16Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"success","name":"Remove Exact Temporary Control Source","number":29,"started_at":"2026-09-14T02:51:16Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"skipped","name":"Remove Runner Recovery Inspection","number":30,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"skipped","name":"Remove Runner Continuation Evidence","number":31,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"skipped","name":"Remove Runner Build Recovery Evidence","number":32,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"skipped","name":"Remove Fixed Additional Scheduled Backup Evidence","number":33,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"skipped","name":"Remove Runner Attempt Recovery Evidence","number":34,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"success","name":"Remove Runner Second Attempt Recovery Evidence","number":35,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"success","name":"Remove Runner SSH Material","number":36,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"success","name":"Post Checkout Exact Maintenance Source","number":72,"started_at":"2026-09-14T02:51:18Z","status":"completed"},{"completed_at":"2026-09-14T02:51:18Z","conclusion":"success","name":"Complete job","number":73,"started_at":"2026-09-14T02:51:18Z","status":"completed"}]}],"total_count":1}},"ci":{"run":{"conclusion":"success","created_at":"2026-09-14T02:37:14Z","event":"push","head_branch":"main","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":34799821827,"name":"CI","path":".github/workflows/ci.yml","run_attempt":1,"run_started_at":"2026-09-14T02:37:14Z","status":"completed","updated_at":"2026-09-14T02:47:49Z","repository":{"full_name":"fafona/space"},"head_repository":{"full_name":"fafona/space"}},"jobs":{"jobs":[{"completed_at":"2026-09-14T02:37:54Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103840041497,"name":"Isolated Maintenance Ingress Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:37:17Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:37:18Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:37:17Z","status":"completed"},{"completed_at":"2026-09-14T02:37:21Z","conclusion":"success","name":"Checkout","number":2,"started_at":"2026-09-14T02:37:18Z","status":"completed"},{"completed_at":"2026-09-14T02:37:26Z","conclusion":"success","name":"Setup Node","number":3,"started_at":"2026-09-14T02:37:21Z","status":"completed"},{"completed_at":"2026-09-14T02:37:35Z","conclusion":"success","name":"Install Isolated Acceptance Tools Without Starting Services","number":4,"started_at":"2026-09-14T02:37:26Z","status":"completed"},{"completed_at":"2026-09-14T02:37:35Z","conclusion":"success","name":"Initialize Bridge Netfilter Module on Disposable CI Host Only","number":5,"started_at":"2026-09-14T02:37:35Z","status":"completed"},{"completed_at":"2026-09-14T02:37:53Z","conclusion":"success","name":"Run Real Ingress Rules Only Inside New Network Namespace","number":6,"started_at":"2026-09-14T02:37:35Z","status":"completed"},{"completed_at":"2026-09-14T02:37:53Z","conclusion":"success","name":"Post Setup Node","number":11,"started_at":"2026-09-14T02:37:53Z","status":"completed"},{"completed_at":"2026-09-14T02:37:53Z","conclusion":"success","name":"Post Checkout","number":12,"started_at":"2026-09-14T02:37:53Z","status":"completed"},{"completed_at":"2026-09-14T02:37:53Z","conclusion":"success","name":"Complete job","number":13,"started_at":"2026-09-14T02:37:53Z","status":"completed"}]},{"completed_at":"2026-09-14T02:38:38Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103840041726,"name":"Isolated Supabase Scheduler Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:37:17Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:37:18Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:37:17Z","status":"completed"},{"completed_at":"2026-09-14T02:37:22Z","conclusion":"success","name":"Checkout","number":2,"started_at":"2026-09-14T02:37:18Z","status":"completed"},{"completed_at":"2026-09-14T02:37:26Z","conclusion":"success","name":"Setup Node","number":3,"started_at":"2026-09-14T02:37:22Z","status":"completed"},{"completed_at":"2026-09-14T02:37:27Z","conclusion":"success","name":"Scheduler Acceptance Safety Contracts","number":4,"started_at":"2026-09-14T02:37:26Z","status":"completed"},{"completed_at":"2026-09-14T02:38:37Z","conclusion":"success","name":"Real Supabase 15.8.1.085 Scheduler SQL in Owned Disposable Container","number":5,"started_at":"2026-09-14T02:37:27Z","status":"completed"},{"completed_at":"2026-09-14T02:38:37Z","conclusion":"success","name":"Post Setup Node","number":9,"started_at":"2026-09-14T02:38:37Z","status":"completed"},{"completed_at":"2026-09-14T02:38:37Z","conclusion":"success","name":"Post Checkout","number":10,"started_at":"2026-09-14T02:38:37Z","status":"completed"},{"completed_at":"2026-09-14T02:38:37Z","conclusion":"success","name":"Complete job","number":11,"started_at":"2026-09-14T02:38:37Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:01Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103840041870,"name":"Quality","run_id":34799821827,"started_at":"2026-09-14T02:37:17Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:37:18Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:37:18Z","status":"completed"},{"completed_at":"2026-09-14T02:37:22Z","conclusion":"success","name":"Checkout","number":2,"started_at":"2026-09-14T02:37:18Z","status":"completed"},{"completed_at":"2026-09-14T02:37:29Z","conclusion":"success","name":"Setup Node","number":3,"started_at":"2026-09-14T02:37:22Z","status":"completed"},{"completed_at":"2026-09-14T02:37:40Z","conclusion":"success","name":"Install Dependencies","number":4,"started_at":"2026-09-14T02:37:29Z","status":"completed"},{"completed_at":"2026-09-14T02:37:40Z","conclusion":"success","name":"CI Workflow Contract","number":5,"started_at":"2026-09-14T02:37:40Z","status":"completed"},{"completed_at":"2026-09-14T02:37:41Z","conclusion":"success","name":"Encoding Check (Strict)","number":6,"started_at":"2026-09-14T02:37:40Z","status":"completed"},{"completed_at":"2026-09-14T02:37:41Z","conclusion":"success","name":"Maintenance Topology Diagnostic Tests","number":7,"started_at":"2026-09-14T02:37:41Z","status":"completed"},{"completed_at":"2026-09-14T02:38:17Z","conclusion":"success","name":"Maintenance Control and Pages ACL Contract Tests","number":8,"started_at":"2026-09-14T02:37:41Z","status":"completed"},{"completed_at":"2026-09-14T02:38:27Z","conclusion":"success","name":"Isolated PM2 6.0.14 Maintenance Transport Acceptance","number":9,"started_at":"2026-09-14T02:38:17Z","status":"completed"},{"completed_at":"2026-09-14T02:39:25Z","conclusion":"success","name":"Lint","number":10,"started_at":"2026-09-14T02:38:27Z","status":"completed"},{"completed_at":"2026-09-14T02:42:36Z","conclusion":"success","name":"Tests","number":11,"started_at":"2026-09-14T02:39:25Z","status":"completed"},{"completed_at":"2026-09-14T02:43:58Z","conclusion":"success","name":"Build","number":12,"started_at":"2026-09-14T02:42:36Z","status":"completed"},{"completed_at":"2026-09-14T02:43:58Z","conclusion":"success","name":"Post Setup Node","number":23,"started_at":"2026-09-14T02:43:58Z","status":"completed"},{"completed_at":"2026-09-14T02:43:59Z","conclusion":"success","name":"Post Checkout","number":24,"started_at":"2026-09-14T02:43:58Z","status":"completed"},{"completed_at":"2026-09-14T02:43:59Z","conclusion":"success","name":"Complete job","number":25,"started_at":"2026-09-14T02:43:59Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:59Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150061,"name":"Checkout Context PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:03Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:05Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:18Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:05Z","status":"completed"},{"completed_at":"2026-09-14T02:44:23Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:18Z","status":"completed"},{"completed_at":"2026-09-14T02:44:28Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:23Z","status":"completed"},{"completed_at":"2026-09-14T02:44:28Z","conclusion":"success","name":"Check PostgreSQL client","number":5,"started_at":"2026-09-14T02:44:28Z","status":"completed"},{"completed_at":"2026-09-14T02:44:28Z","conclusion":"success","name":"Bind checkout PostgreSQL service identity","number":6,"started_at":"2026-09-14T02:44:28Z","status":"completed"},{"completed_at":"2026-09-14T02:44:54Z","conclusion":"success","name":"Run checkout context database acceptance","number":7,"started_at":"2026-09-14T02:44:28Z","status":"completed"},{"completed_at":"2026-09-14T02:44:54Z","conclusion":"success","name":"Post Setup Node","number":12,"started_at":"2026-09-14T02:44:54Z","status":"completed"},{"completed_at":"2026-09-14T02:44:55Z","conclusion":"success","name":"Post Checkout","number":13,"started_at":"2026-09-14T02:44:54Z","status":"completed"},{"completed_at":"2026-09-14T02:44:56Z","conclusion":"success","name":"Stop containers","number":14,"started_at":"2026-09-14T02:44:55Z","status":"completed"},{"completed_at":"2026-09-14T02:44:56Z","conclusion":"success","name":"Complete job","number":15,"started_at":"2026-09-14T02:44:56Z","status":"completed"}]},{"completed_at":"2026-09-14T02:45:06Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150098,"name":"Redemption PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:03Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:04Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:37Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:42Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:37Z","status":"completed"},{"completed_at":"2026-09-14T02:44:47Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:42Z","status":"completed"},{"completed_at":"2026-09-14T02:44:47Z","conclusion":"success","name":"Check PostgreSQL client","number":5,"started_at":"2026-09-14T02:44:47Z","status":"completed"},{"completed_at":"2026-09-14T02:45:00Z","conclusion":"success","name":"Run redemption atomic database acceptance","number":6,"started_at":"2026-09-14T02:44:47Z","status":"completed"},{"completed_at":"2026-09-14T02:45:00Z","conclusion":"success","name":"Post Setup Node","number":10,"started_at":"2026-09-14T02:45:00Z","status":"completed"},{"completed_at":"2026-09-14T02:45:00Z","conclusion":"success","name":"Post Checkout","number":11,"started_at":"2026-09-14T02:45:00Z","status":"completed"},{"completed_at":"2026-09-14T02:45:04Z","conclusion":"success","name":"Stop containers","number":12,"started_at":"2026-09-14T02:45:00Z","status":"completed"},{"completed_at":"2026-09-14T02:45:04Z","conclusion":"success","name":"Complete job","number":13,"started_at":"2026-09-14T02:45:04Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:38Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150102,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:03Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:05Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:03Z","status":"completed"},{"completed_at":"2026-09-14T02:44:23Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:05Z","status":"completed"},{"completed_at":"2026-09-14T02:44:27Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:23Z","status":"completed"},{"completed_at":"2026-09-14T02:44:31Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:27Z","status":"completed"},{"completed_at":"2026-09-14T02:44:31Z","conclusion":"success","name":"Check PostgreSQL client","number":5,"started_at":"2026-09-14T02:44:31Z","status":"completed"},{"completed_at":"2026-09-14T02:44:31Z","conclusion":"success","name":"Bind pages ACL PostgreSQL service identity","number":6,"started_at":"2026-09-14T02:44:31Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Run pages client-write ACL database acceptance","number":7,"started_at":"2026-09-14T02:44:31Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Post Setup Node","number":12,"started_at":"2026-09-14T02:44:33Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Post Checkout","number":13,"started_at":"2026-09-14T02:44:33Z","status":"completed"},{"completed_at":"2026-09-14T02:44:36Z","conclusion":"success","name":"Stop containers","number":14,"started_at":"2026-09-14T02:44:33Z","status":"completed"},{"completed_at":"2026-09-14T02:44:36Z","conclusion":"success","name":"Complete job","number":15,"started_at":"2026-09-14T02:44:36Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:36Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150123,"name":"Recovery Content PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:03Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:05Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:21Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:05Z","status":"completed"},{"completed_at":"2026-09-14T02:44:25Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:21Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:25Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Create empty disposable restore target","number":5,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Check PostgreSQL clients","number":6,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Bind recovery PostgreSQL service identity","number":7,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:32Z","conclusion":"success","name":"Run database dump and restore content acceptance","number":8,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:32Z","conclusion":"success","name":"Post Setup Node","number":14,"started_at":"2026-09-14T02:44:32Z","status":"completed"},{"completed_at":"2026-09-14T02:44:32Z","conclusion":"success","name":"Post Checkout","number":15,"started_at":"2026-09-14T02:44:32Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Stop containers","number":16,"started_at":"2026-09-14T02:44:32Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Complete job","number":17,"started_at":"2026-09-14T02:44:33Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150149,"name":"QR Atomic PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:03Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:04Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:19Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:04Z","status":"completed"},{"completed_at":"2026-09-14T02:44:23Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:19Z","status":"completed"},{"completed_at":"2026-09-14T02:44:27Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:23Z","status":"completed"},{"completed_at":"2026-09-14T02:44:27Z","conclusion":"success","name":"Check PostgreSQL client","number":5,"started_at":"2026-09-14T02:44:27Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Run QR atomic database acceptance","number":6,"started_at":"2026-09-14T02:44:27Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Post Setup Node","number":10,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:30Z","conclusion":"success","name":"Post Checkout","number":11,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:31Z","conclusion":"success","name":"Stop containers","number":12,"started_at":"2026-09-14T02:44:30Z","status":"completed"},{"completed_at":"2026-09-14T02:44:31Z","conclusion":"success","name":"Complete job","number":13,"started_at":"2026-09-14T02:44:31Z","status":"completed"}]},{"completed_at":"2026-09-14T02:44:59Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150151,"name":"Order Membership PostgreSQL Acceptance","run_id":34799821827,"started_at":"2026-09-14T02:44:04Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:05Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:05Z","status":"completed"},{"completed_at":"2026-09-14T02:44:28Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:05Z","status":"completed"},{"completed_at":"2026-09-14T02:44:33Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:44:28Z","status":"completed"},{"completed_at":"2026-09-14T02:44:38Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:44:33Z","status":"completed"},{"completed_at":"2026-09-14T02:44:38Z","conclusion":"success","name":"Check PostgreSQL client","number":5,"started_at":"2026-09-14T02:44:38Z","status":"completed"},{"completed_at":"2026-09-14T02:44:52Z","conclusion":"success","name":"Run order membership atomic database acceptance","number":6,"started_at":"2026-09-14T02:44:38Z","status":"completed"},{"completed_at":"2026-09-14T02:44:52Z","conclusion":"success","name":"Post Setup Node","number":10,"started_at":"2026-09-14T02:44:52Z","status":"completed"},{"completed_at":"2026-09-14T02:44:52Z","conclusion":"success","name":"Post Checkout","number":11,"started_at":"2026-09-14T02:44:52Z","status":"completed"},{"completed_at":"2026-09-14T02:44:57Z","conclusion":"success","name":"Stop containers","number":12,"started_at":"2026-09-14T02:44:52Z","status":"completed"},{"completed_at":"2026-09-14T02:44:57Z","conclusion":"success","name":"Complete job","number":13,"started_at":"2026-09-14T02:44:57Z","status":"completed"}]},{"completed_at":"2026-09-14T02:47:49Z","conclusion":"success","head_sha":"d9de5fe689226fcdd13a1e95039901b5d0f39167","id":103841150154,"name":"Enterprise Browser Journeys","run_id":34799821827,"started_at":"2026-09-14T02:44:39Z","status":"completed","steps":[{"completed_at":"2026-09-14T02:44:41Z","conclusion":"success","name":"Set up job","number":1,"started_at":"2026-09-14T02:44:40Z","status":"completed"},{"completed_at":"2026-09-14T02:45:05Z","conclusion":"success","name":"Initialize containers","number":2,"started_at":"2026-09-14T02:44:41Z","status":"completed"},{"completed_at":"2026-09-14T02:45:09Z","conclusion":"success","name":"Checkout","number":3,"started_at":"2026-09-14T02:45:05Z","status":"completed"},{"completed_at":"2026-09-14T02:45:17Z","conclusion":"success","name":"Setup Node","number":4,"started_at":"2026-09-14T02:45:09Z","status":"completed"},{"completed_at":"2026-09-14T02:45:30Z","conclusion":"success","name":"Install Dependencies","number":5,"started_at":"2026-09-14T02:45:17Z","status":"completed"},{"completed_at":"2026-09-14T02:47:23Z","conclusion":"success","name":"Build","number":6,"started_at":"2026-09-14T02:45:30Z","status":"completed"},{"completed_at":"2026-09-14T02:47:47Z","conclusion":"success","name":"Enterprise Browser Journeys","number":7,"started_at":"2026-09-14T02:47:23Z","status":"completed"},{"completed_at":"2026-09-14T02:47:47Z","conclusion":"success","name":"Post Setup Node","number":12,"started_at":"2026-09-14T02:47:47Z","status":"completed"},{"completed_at":"2026-09-14T02:47:47Z","conclusion":"success","name":"Post Checkout","number":13,"started_at":"2026-09-14T02:47:47Z","status":"completed"},{"completed_at":"2026-09-14T02:47:47Z","conclusion":"success","name":"Stop containers","number":14,"started_at":"2026-09-14T02:47:47Z","status":"completed"},{"completed_at":"2026-09-14T02:47:47Z","conclusion":"success","name":"Complete job","number":15,"started_at":"2026-09-14T02:47:47Z","status":"completed"}]}],"total_count":10}}};
function priorSecondRun(key) { return structuredClone(realPriorSecond[key === "prior-second-recovery" ? "recovery" : "ci"].run); }
function priorSecondJobs(key) { return structuredClone(realPriorSecond[key === "prior-second-recovery" ? "recovery" : "ci"].jobs); }

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
// hard-pinned by readMaintenanceBudgetRecoveryAdditionalBackup, not this fixture.
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
const history = transform => inspectMaintenanceBudgetRecoveryHistory(inspection, fixture(transform).api, NOW);
const evidence = (transform, patch = {}, prior = bindings()) => createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, fixture(transform).api, prior, NOW, additionalRecords());
const changeRun = (id, patch) => (_key, value) => {
  if (Array.isArray(value.workflow_runs)) value.workflow_runs = value.workflow_runs.map(row => String(row.id) === id ? { ...row, ...patch } : row);
  return value;
};
const changeJob = (id, mutate) => (key, value) => { if (key === "job:" + id) mutate(value); return value; };

test("all sixteen exact incidents produce canonical evidence without relabelling the T7 signed subjects", async () => {
  const f = fixture(), prior = bindings(), result = await createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW, additionalRecords());
  assert.equal(result.budgetRecoveryRunId, env.GITHUB_RUN_ID); assert.equal(result.budgetRecoveryRunAttempt, 1);
  assert.equal(result.mainCIrunId, "34728900000"); assert.equal(result.toolsSha, TARGET); assert.equal(result.historyCheckedAt, NOW);
  assert.equal(result.authorizationDigest, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION_DIGEST);
  assert.match(result.historyDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(decodeMaintenanceBudgetRecoveryEvidence(encodeMaintenanceBudgetRecoveryEvidence(result)), result);
  assert.equal(f.calls.filter(value => value.endsWith("commits/main")).length, 2);
  assert.equal(f.calls.filter(value => value.includes("/attempts/1/jobs?")).length, 27);
  assert.deepEqual((await history()).incidents.map(value => value.id), incidents.map(value => value[0]));
  assert.equal(validateMaintenanceBudgetRecoveryPriorBindings(inspection, prior).backup.binding.targetSha, PREVIOUS);
  assert.equal(validateMaintenanceBudgetRecoveryPriorBindings(inspection, prior).readiness.binding.backupRunId, inspection.backupRunId);
});

test("fixed action, confirmation, repository, run attempt and target binding reject before any API request", async () => {
  for (const patch of [{ ACTION: "continue-held" }, { CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE" },
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE" }, { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100034Z" },
    { GITHUB_REPOSITORY: "other/space" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "00" }, { GITHUB_SHA: PREVIOUS }, { TARGET_SHA: PREVIOUS },
    { PREVIOUS_TARGET_SHA: OLD }, { EXPECTED_OLD_SHA: TARGET }, { MAINTENANCE_OPERATION_ID: "invalid" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, { ...env, ...patch }, f.api, bindings(), NOW, additionalRecords()));
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
    [...value.workflow_runs, ...Array.from({ length: 100 - value.workflow_runs.length }, (_, i) => old(files[0], i + 1))] : [old(files[0], 98)] } : value);
  const result = await createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW, additionalRecords());
  assert.ok(f.calls.some(value => value.endsWith("page=2")));
  assert.notEqual(result.historyDigest, (await evidence()).historyDigest);
});

test("missing tail, duplicate, changing total, unsupported count and exhausted page bounds fail closed", async () => {
  const first = incidents.filter(spec => spec[1] === 0).map(spec => run(spec)).concat(Array.from({ length: 100 - incidents.filter(spec => spec[1] === 0).length }, (_, i) => old(files[0], i + 1)));
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
  for (const now of [NaN, Infinity, 1.5, inspection.createdAt - 1, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.authorizedAt - 1,
    MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.expiresAt])
    await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, fixture().api, bindings(), now, additionalRecords()));
});

test("the additional attempt uses actual 07:13:57 to 10 UTC clock and a fresh stopped baseline", async () => {
  const auth = MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION;
  assert.equal(auth.authorizedAt, Date.parse("2026-09-14T07:13:57Z"));

  assert.equal(auth.expiresAt, Date.parse("2026-09-14T10:00:00Z"));
  for (const now of [auth.authorizedAt - 1, Date.parse("2026-09-14T01:12:17Z"), auth.expiresAt, auth.expiresAt + 1, NOW + 300000, NOW - 1001]) {
    const f = fixture();
    await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), now, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await evidence()).authorizationDigest, inspection.authorizationDigest);
  assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(additionalRecords(), auth.expiresAt));
});

test("extension does not erase new scheduled activity after the original deadline or expand the fixed history", async () => {
  await assert.rejects(history((key, value) => key === files[0] ? { total_count: value.total_count + 1,
    workflow_runs: [...value.workflow_runs, old(files[0], 100, { event: "schedule", created_at: "2026-09-13T06:30:00Z",
      run_started_at: "2026-09-13T06:30:01Z", updated_at: "2026-09-13T06:30:02Z" })] } : value));
  for (const digest of [undefined, "0".repeat(64), "bad"]) {
    const f = fixture();
    await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence({ ...inspection, authorizationDigest: digest }, env, f.api, bindings(), NOW, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
});

test("all sixteen genuine snake-case jobs, one-job inventories and required successful guard steps are checked", async () => {
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

test("all five failed deployments fail only Deploy To Server; later candidate, public and attestation steps stay skipped", async () => {
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

test("only signed B7/R7 subjects match; neither T2 evidence nor T4 relabelling is accepted", async () => {
  for (const phase of ["backup", "readiness"]) for (const patch of [
    { targetSha: OLD }, { targetSha: TARGET }, { operationId: "11111111-1111-4111-8111-111111111111" },
    { expectedOldSha: TARGET }, { mode: "off" }, { phase: "deploy" }, { runId: "34715932102" }, { runAttempt: "2" },
    { backupRunId: "34715932102" }, { backupRunAttempt: "2" }, { readinessRunId: "34721256683" }, { readinessRunAttempt: "2" },
  ]) {
    const prior = bindings(); prior[phase] = record(canonicalJsonBytes({ ...JSON.parse(prior[phase].bytes), ...patch }));
    const f = fixture(); await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, prior, NOW, additionalRecords()));
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
  ]) { const prior = bindings(); mutate(prior); assert.throws(() => validateMaintenanceBudgetRecoveryPriorBindings(inspection, prior)); }
});

test("malformed fixed inspection starts zero requests and any API failure returns no grant", async () => {
  for (const patch of [{ targetSha: PREVIOUS }, { backupRunAttempt: 2 }, { migrationRunId: "123" }, { revision: 8 },
    { predecessorJournalDigest: "bad" }, { stateDigest: "0".repeat(64) }, { extra: "PRIVATE_SENTINEL" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence({ ...inspection, ...patch }, env, f.api, bindings(), NOW, additionalRecords()));
    assert.equal(f.calls.length, 0);
  }
  let requests = 0;
  await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, async () => { requests++; throw new Error("offline"); }, bindings(), NOW, additionalRecords()), /offline/);
  assert.equal(requests, 1);
});

test("input bindings remain unchanged and original historic job details remain in the history digest", async () => {
  const prior = bindings(), before = structuredClone(inspection), backup = Buffer.from(prior.backup.bytes);
  await createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, fixture().api, prior, NOW, additionalRecords());
  assert.deepEqual(inspection, before); assert.deepEqual(prior.backup.bytes, backup);
  const altered = await evidence(changeJob("34715932102", value => { value.jobs[0].steps[0].completed_at = value.jobs[0].steps[0].started_at; }));
  assert.notEqual(altered.historyDigest, (await evidence()).historyDigest);
});

test("CLI rejects invalid invocation with only the fixed error, without credential or source output", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./production-maintenance-budget-recovery-workflow.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 5000, maxBuffer: 4096, env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", FAOLLA_TEST_SECRET: "PRIVATE_SENTINEL" }, windowsHide: true,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "maintenance_budget_recovery_workflow_unverified\n");
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
  const f = fixture(), result = await createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW, additionalRecords());
  assert.match(result.historyDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.backupRunId, "34800653808"); assert.equal(result.readinessRunId, "34802075500");
  assert.equal(f.calls.filter(call => call.includes("/artifacts?")).length, 5);
  assert.ok(f.calls.every(call => !call.endsWith("/zip")));
});

test("additional off binding, hosted schedule provenance and exact report hashes must all match", async () => {
  const summary = validateMaintenanceBudgetRecoveryAdditionalBackup(additionalRecords(), NOW);
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
  ]) { const records = additionalRecords(); mutate(records); assert.throws(() => validateMaintenanceBudgetRecoveryAdditionalBackup(records, NOW)); }
  const f = fixture(); await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, f.api, bindings(), NOW)); assert.equal(f.calls.length, 0);
  assert.throws(() => readMaintenanceBudgetRecoveryAdditionalBackup(fileURLToPath(new URL(".", import.meta.url))));
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

test("B7 and R7 require hosted exact workflow/source/invocation in addition to their byte subject", () => {
  for (const phase of ["backup", "readiness"]) for (const mutate of [
    p => p.buildDefinition.internalParameters.github.runner_environment = "self-hosted",
    p => p.buildDefinition.internalParameters.github.event_name = "schedule",
    p => p.buildDefinition.externalParameters.workflow.path = ".github/workflows/deploy.yml",
    p => p.buildDefinition.resolvedDependencies[0].digest.gitCommit = TARGET,
    p => p.runDetails.metadata.invocationId += "2",
    p => p.runDetails.builder.id = "https://example.invalid/fake"]) {
    const prior = bindings(); mutate(prior[phase].provenance[0].verificationResult.statement.predicate);
    assert.throws(() => validateMaintenanceBudgetRecoveryPriorBindings(inspection, prior));
  }
});

test("the earlier T6 attempt CAS and ten-job CI are still immutable and required", async () => {
  for (const key of ["prior-attempt-recovery", "prior-attempt-ci"]) for (const patch of [
    { id: 1 }, { run_attempt: 2 }, { head_sha: LAUNCHED }, { status: "queued" }, { conclusion: "failure" }, { event: "pull_request" },
    { repository: null }, { head_repository: null }, { path: ".github/workflows/deploy.yml" }])
    await assert.rejects(evidence((k, value) => k === key ? { ...value, ...patch } : value));
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].id++, v => v.jobs[0].head_sha = LAUNCHED,
    ...priorAttemptJobs("prior-attempt-recovery").jobs[0].steps.map((_, index) => v => {
      v.jobs[0].steps[index].conclusion = v.jobs[0].steps[index].conclusion === "success" ? "skipped" : "success";
    })]) await assert.rejects(evidence((key, value) => { if (key === "prior-attempt-recovery-jobs") mutate(value); return value; }));
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].run_id++, v => v.jobs[0].conclusion = "failure",
    v => v.jobs[0].id = v.jobs[1].id, v => v.jobs[0].name = v.jobs[1].name])
    await assert.rejects(evidence((key, value) => { if (key === "prior-attempt-ci-jobs") mutate(value); return value; }));
});
test("the budget confirmation cannot reuse an earlier grant and an unknown 02:17 schedule is refused", async () => {
  await assert.rejects(evidence(undefined, { ACTION: "recover-attempt" }));
  await assert.rejects(evidence(undefined, { CONFIRMATION: "RECOVER_ATTEMPT_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z" }));
  // Use a later valid authorization clock so the unreviewed run is rejected by
  // the original history cutoff/allowlist, not merely as a future timestamp.
  await assert.rejects(inspectMaintenanceBudgetRecoveryHistory(inspection, fixture((key, value) => key === files[0] ? {
    total_count: value.total_count + 1, workflow_runs: [...value.workflow_runs,
      old(files[0], 34799000111, { event: "schedule", created_at: "2026-09-14T02:17:00Z", run_started_at: "2026-09-14T02:17:00Z", updated_at: "2026-09-14T02:17:01Z" })],
  } : value).api, Date.parse("2026-09-14T08:30:00Z")));
  for (const patch of [{ id: 103814590378 }, { started_at: "2026-09-13T23:50:03Z" }, { completed_at: "2026-09-13T23:57:59Z" }])
    await assert.rejects(history(changeJob("34790827235", value => Object.assign(value.jobs[0], patch))));
  for (const patch of [{ started_at: "2026-09-13T23:50:25Z" }, { completed_at: "2026-09-13T23:57:58Z" }])
    await assert.rejects(history(changeJob("34790827235", value => Object.assign(value.jobs[0].steps.find(step => step.name === "Deploy To Server"), patch))));
});

test("the exact T7 recovery and all original main CI jobs remain immutable historical evidence", async () => {
  for (const key of ["prior-second-recovery", "prior-second-ci"]) for (const patch of [
    { id: 1 }, { run_attempt: 2 }, { head_sha: SECOND }, { status: "queued" }, { conclusion: "failure" },
    { event: "pull_request" }, { repository: null }, { head_repository: null }, { path: ".github/workflows/deploy.yml" },
  ]) await assert.rejects(evidence((k, value) => k === key ? { ...value, ...patch } : value));
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].id++, v => v.jobs[0].head_sha = SECOND,
    v => v.jobs[0].started_at = "2026-09-14T02:48:57Z", v => v.jobs[0].completed_at = "2026-09-14T02:51:21Z",
    ...priorSecondJobs("prior-second-recovery").jobs[0].steps.map((_, index) => v => {
      v.jobs[0].steps[index].conclusion = v.jobs[0].steps[index].conclusion === "success" ? "skipped" : "success";
    }).filter((_value, index) => !["Set up job", "Post Checkout Exact Maintenance Source", "Complete job"]
      .includes(priorSecondJobs("prior-second-recovery").jobs[0].steps[index].name))])
    await assert.rejects(evidence((key, value) => { if (key === "prior-second-recovery-jobs") mutate(value); return value; }));
  for (const mutate of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].run_id++, v => v.jobs[0].conclusion = "failure",
    v => v.jobs[0].id = v.jobs[1].id, v => v.jobs[0].name = v.jobs[1].name,
    v => v.jobs[0].started_at = "2026-09-14T02:37:13Z"])
    await assert.rejects(evidence((key, value) => { if (key === "prior-second-ci-jobs") mutate(value); return value; }));
});

test("D7 metadata and its exact server failure window cannot be replaced or described as success", async () => {
  for (const patch of [{ id: 103846763202 }, { started_at: "2026-09-14T03:18:08Z" }, { completed_at: "2026-09-14T03:27:36Z" }])
    await assert.rejects(history(changeJob("34802138869", value => Object.assign(value.jobs[0], patch))));
  for (const patch of [{ started_at: "2026-09-14T03:18:29Z" }, { completed_at: "2026-09-14T03:27:34Z" }, { conclusion: "success" }])
    await assert.rejects(history(changeJob("34802138869", value => Object.assign(value.jobs[0].steps.find(step => step.name === "Deploy To Server"), patch))));
  for (const id of ["34800653808", "34802075500", "34802138869"]) {
    for (const field of ["created_at", "run_started_at", "updated_at"])
      await assert.rejects(history(changeRun(id, { [field]: iso(Date.parse(run(incidents.find(s => s[0] === id))[field]) + 1000) })));
  }
});

test("old 04 UTC grants and any new delayed schedule cannot authorize the budget attempt", async () => {
  for (const patch of [{ ACTION: "recover-second-attempt" },
    { CONFIRMATION: "RECOVER_SECOND_ATTEMPT_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z" },
    { CONFIRMATION: "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T040000Z" }]) {
    const f = fixture(); await assert.rejects(createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, { ...env, ...patch },
      f.api, bindings(), NOW, additionalRecords())); assert.equal(f.calls.length, 0);
  }
  await assert.rejects(inspectMaintenanceBudgetRecoveryHistory(inspection, fixture((key, value) => key === files[0] ? {
    total_count: value.total_count + 1, workflow_runs: [...value.workflow_runs,
      old(files[0], 34809999999, { event: "schedule", head_sha: PREVIOUS, created_at: "2026-09-14T07:17:00Z",
        run_started_at: "2026-09-14T07:17:00Z", updated_at: "2026-09-14T07:17:01Z" })],
  } : value).api, NOW));
});
