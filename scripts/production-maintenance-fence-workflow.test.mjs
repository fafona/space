import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MAINTENANCE_FENCE_PRIOR_RUNS as SPECS, createMaintenanceFenceWorkflowEvidence } from "./production-maintenance-fence-workflow.mjs";
import { MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION as AUTH, MAINTENANCE_FENCE_RECOVERY_PREDECESSOR as PIN, validateMaintenanceLeaseInspection } from "./production-maintenance-lease.mjs";
const NOW = Date.parse("2026-09-15T00:00:00Z"), TARGET = "a".repeat(40), SELF = "99999999999", CI = "99999999998";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const repo = value => ({ ...structuredClone(value), repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } });
const files = ["database-backup.yml", "database-migrate.yml", "ordinary-account-cutover-readiness.yml", "deploy.yml", "production-maintenance.yml"];
function inspected() {
  const stoppedBaseline = { observedAt: NOW - 1000 };
  return validateMaintenanceLeaseInspection({ version: 1, state: "fence-recovery-inspected", operationId: AUTH.operationId, targetSha: TARGET,
    previousTargetSha: PIN.targetSha, expectedOldSha: PIN.expectedOldSha, revision: 42, stateDigest: PIN.stateDigest, stateBytes: PIN.stateBytes,
    activeAttempt: 3, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline, stoppedBaselineDigest: hash(stoppedBaseline), authorizationDigest: hash(AUTH) });
}
const env = () => ({ GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: SELF, GITHUB_SHA: TARGET, TARGET_SHA: TARGET, PREVIOUS_TARGET_SHA: PIN.targetSha,
  EXPECTED_OLD_SHA: PIN.expectedOldSha, MAINTENANCE_OPERATION_ID: AUTH.operationId, ACTION: "recover-fence", CONFIRMATION: "RECOVER_UNUSED_FENCE_PRODUCTION_MAINTENANCE" });
function fixture(mutate = (_key, value) => value) {
  const db = new Map(), calls = new Map();
  for (const spec of SPECS) {
    db.set("run:" + spec.run.id, repo(spec.run));
    db.set("jobs:" + spec.run.id, { total_count: spec.jobs.length, jobs: spec.jobs.map(j => ({ ...structuredClone(j), ...(j.steps ? {
      steps: j.steps.map(([number, name, conclusion, started_at, completed_at]) => ({ number, name, conclusion, started_at, completed_at, status: "completed" })) } : {}) })) });
    db.set("artifacts:" + spec.run.id, { total_count: spec.artifacts.length, artifacts: structuredClone(spec.artifacts) });
  }
  const self = repo({ ...SPECS[3].run, id: Number(SELF), head_sha: TARGET, status: "in_progress", conclusion: null,
    created_at: "2026-09-14T23:59:00Z", run_started_at: "2026-09-14T23:59:00Z", updated_at: "2026-09-14T23:59:01Z" });
  const ci = repo({ ...SPECS[4].run, id: Number(CI), head_sha: TARGET,
    created_at: "2026-09-14T23:40:00Z", run_started_at: "2026-09-14T23:40:00Z", updated_at: "2026-09-14T23:58:00Z" });
  db.set("run:" + SELF, self); db.set("ci", { total_count: 1, workflow_runs: [ci] }); db.set("main", { sha: TARGET });
  db.set("jobs:" + CI, { total_count: 10, jobs: SPECS[4].jobs.map((j, i) => ({ ...j, id: 10000 + i, run_id: Number(CI), head_sha: TARGET,
    started_at: "2026-09-14T23:40:05Z", completed_at: "2026-09-14T23:57:59Z" })) });
  for (const file of files) { const rows = SPECS.filter(x => x.run.path === ".github/workflows/" + file).map(x => db.get("run:" + x.run.id));
    if (file === "production-maintenance.yml") rows.push(self); db.set(file, { total_count: rows.length, workflow_runs: rows }); }
  return async endpoint => {
    let key;
    if (endpoint.endsWith("/commits/main")) key = "main";
    else if (endpoint.includes("ci.yml/runs?event=push")) key = "ci";
    else if (endpoint.includes("/workflows/")) { const m = endpoint.match(/workflows\/([^/]+)\/runs\?per_page=100&page=1$/); assert.ok(m); key = m[1]; }
    else { const m = endpoint.match(/runs\/([0-9]+)(.*)$/); assert.ok(m); key = (m[2].includes("/jobs") ? "jobs:" : m[2].includes("/artifacts") ? "artifacts:" : "run:") + m[1]; }
    assert.ok(db.has(key), key); const count = (calls.get(key) ?? 0) + 1; calls.set(key, count);
    return mutate(key, structuredClone(db.get(key)), count);
  };
}
const check = (mutate, patch = {}, now = NOW, clock = () => NOW) => createMaintenanceFenceWorkflowEvidence(inspected(), { ...env(), ...patch }, fixture(mutate), now, clock);
test("fence workflow binds failed deployment as history only and exact new main CI", async () => {
  const result = await check(); assert.equal(result.leaseRunId, SELF); assert.equal(result.activeAttempt, 3);
  assert.equal(SPECS[2].run.conclusion, "failure"); assert.equal(SPECS[2].run.id, 34901630408);
  assert.equal(result.historyCheckedAt, NOW);
});
test("artifact run identity ignores object key ordering but rejects every changed or missing identity field", async () => {
  const reordered = await check((key, value) => {
    if (key.startsWith("artifacts:")) for (const artifact of value.artifacts)
      artifact.workflow_run = Object.fromEntries(Object.entries(artifact.workflow_run).reverse());
    return value;
  });
  assert.equal(reordered.historyDigest, (await check()).historyDigest);
  for (const field of ["id", "repository_id", "head_repository_id", "head_branch", "head_sha"]) {
    for (const missing of [false, true]) await assert.rejects(check((key, value) => {
      if (key === "artifacts:" + SPECS[0].run.id) {
        if (missing) delete value.artifacts[0].workflow_run[field];
        else value.artifacts[0].workflow_run[field] = "changed";
      }
      return value;
    }));
  }
  assert.equal(SPECS[5].run.id, 34909485623);
  assert.equal(SPECS[5].jobs[0].steps.find(s => s[1] === "Execute Fixed Maintenance Transition")[2], "skipped");
});
test("lease refuses altered prior runs, steps, artifacts and concurrent history", async () => {
  for (const spec of SPECS) {
    for (const patch of [{ run_attempt: 2 }, { head_sha: TARGET }, { conclusion: "neutral" }, { repository: null }, { status: "in_progress" }])
      await assert.rejects(check((k, v) => k === "run:" + spec.run.id ? { ...v, ...patch } : v));
    await assert.rejects(check((k, v) => { if (k === "jobs:" + spec.run.id) v.jobs[0].id++; return v; }));
    await assert.rejects(check((k, v) => { if (k === "artifacts:" + spec.run.id) { v.total_count = 1; v.artifacts.push({ id: 42 }); } return v; }));
    if (spec.jobs[0].steps) await assert.rejects(check((k, v) => { if (k === "jobs:" + spec.run.id) v.jobs[0].steps[0].name += " changed"; return v; }));
  }
  for (const file of files) await assert.rejects(check((k, v) => { if (k === file) v.total_count++; return v; }));
  await assert.rejects(check((k, v) => { if (k === "database-backup.yml") v.workflow_runs[0].status = "in_progress"; return v; }));
});
test("lease requires all ten CI jobs, stable main, correct manual action and actual clock", async () => {
  for (const patch of [{ ACTION: "end" }, { CONFIRMATION: "anything" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REF: "refs/heads/other" },
    { TARGET_SHA: PIN.targetSha }, { EXPECTED_OLD_SHA: TARGET }, { PREVIOUS_TARGET_SHA: TARGET }]) await assert.rejects(check(undefined, patch));
  for (const change of [v => v.jobs.pop(), v => v.jobs[0].conclusion = "failure", v => v.jobs[0].name = "fake", v => v.jobs[0].head_sha = PIN.targetSha])
    await assert.rejects(check((k, v) => { if (k === "jobs:" + CI) change(v); return v; }));
  await assert.rejects(check((k, v, n) => k === "main" && n === 2 ? { sha: PIN.targetSha } : v));
  await assert.rejects(check((k, v, n) => { if (k === "run:" + SPECS[0].run.id && n === 2) v.run_attempt++; return v; }));
  await assert.rejects(check(undefined, {}, AUTH.authorizedAt - 1));
  await assert.rejects(check(undefined, {}, NOW, () => NOW + 300001));
  await assert.rejects(check(undefined, {}, NOW, () => NOW - 1));
});
