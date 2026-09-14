import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS as SPECS,
  inspectMaintenancePreflightRecoveryHistory, createMaintenancePreflightRecoveryWorkflowEvidence } from "./production-maintenance-preflight-recovery-workflow.mjs";
import { validateMaintenancePreflightRecoveryInspection, MAINTENANCE_PREFLIGHT_RECOVERY_INCIDENT as INCIDENT,
  MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION as AUTH, MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION_DIGEST,
  encodeMaintenancePreflightRecoveryEvidence, decodeMaintenancePreflightRecoveryEvidence } from "./production-maintenance-preflight-recovery.mjs";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET } from "./production-maintenance-budget-recovery.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => structuredClone(value);
const NOW = Date.parse("2026-09-14T18:10:00Z"), TARGET = "a".repeat(40), SELF = "99999999999", CI = "99999999998";
const FILES = ["database-backup.yml", "database-migrate.yml", "ordinary-account-cutover-readiness.yml", "deploy.yml", "production-maintenance.yml"];
const NAMES = ["Encrypted Database Backup", "Apply Production Database Migrations", "Ordinary Account Cutover Readiness", "Deploy Production", "Production Maintenance"];
function inspection() {
  const stoppedBaseline = { version: 3, stateDigest: BUDGET.stateDigest, candidateDigest: "a".repeat(64), launchDiskDigest: "b".repeat(64),
    launchJournalDigest: "c".repeat(64), runtimeDigest: "d".repeat(64), current: {
      target: "/srv/faolla.releases/d9de5fe68922-20260914032500", linkIdentity: "1:2:3:4:5:1:0:41471", runtimeIdentity: "1:2:3:4:5:2:0:16877" },
    bootId: INCIDENT.bootId, pm2RegistryDigest: "e".repeat(64), observedAt: NOW - 1000 };
  return validateMaintenancePreflightRecoveryInspection({ version: 1, state: "preflight-recovery-inspected",
    operationId: INCIDENT.operationId, targetSha: TARGET, previousTargetSha: INCIDENT.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha,
    revision: 38, stateDigest: INCIDENT.stateDigest, createdAt: INCIDENT.createdAt, activeAttempt: 3,
    sourceDiffDigest: "f".repeat(64), migrationDigest: "a".repeat(64), predecessorJournalDigest: hash(null),
    stoppedBaselineDigest: hash(stoppedBaseline), stoppedBaseline, authorizationDigest: MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION_DIGEST,
    ...Object.fromEntries(Object.keys(INCIDENT).filter(key => /Run(Id|Attempt)$|CIrun(Id|Attempt)$/.test(key)).map(key => [key, INCIDENT[key]])),
  });
}
const env = () => ({ GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: SELF, GITHUB_SHA: TARGET, TARGET_SHA: TARGET, PREVIOUS_TARGET_SHA: INCIDENT.previousTargetSha,
  EXPECTED_OLD_SHA: INCIDENT.expectedOldSha, MAINTENANCE_OPERATION_ID: INCIDENT.operationId, ACTION: "recover-preflight",
  CONFIRMATION: "RECOVER_PREFLIGHT_PRODUCTION_MAINTENANCE_UNTIL_20260914T200000Z" });
const addRepo = run => ({ ...clone(run), repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } });
function fixture(mutate = (_key, value) => value) {
  const db = new Map(), calls = new Map();
  for (const spec of SPECS) {
    db.set("run:" + spec.run.id, addRepo(spec.run));
    db.set("jobs:" + spec.run.id, { total_count: spec.jobs.length, jobs: spec.jobs.map(job => ({
      ...clone(job), ...(job.steps ? { steps: job.steps.map(([number, name, conclusion, started_at, completed_at]) =>
        ({ number, name, conclusion, started_at, completed_at, status: "completed" })) } : {}),
    })) });
    if (spec.artifacts) db.set("artifacts:" + spec.run.id, { total_count: spec.artifacts.length, artifacts: clone(spec.artifacts) });
  }
  const self = addRepo({ ...SPECS[3].run, id: Number(SELF), head_sha: TARGET, status: "in_progress", conclusion: null,
    created_at: "2026-09-14T18:00:00Z", run_started_at: "2026-09-14T18:00:00Z", updated_at: "2026-09-14T18:00:01Z" });
  const ci = addRepo({ ...SPECS[4].run, id: Number(CI), head_sha: TARGET,
    created_at: "2026-09-14T17:50:00Z", run_started_at: "2026-09-14T17:50:00Z", updated_at: "2026-09-14T17:59:00Z" });
  db.set("run:" + SELF, self);
  db.set("ci", { total_count: 1, workflow_runs: [ci] });
  db.set("jobs:" + CI, { total_count: 10, jobs: SPECS[4].jobs.map((job, index) => ({ ...clone(job), id: 9000 + index,
    run_id: Number(CI), head_sha: TARGET, started_at: "2026-09-14T17:50:05Z", completed_at: "2026-09-14T17:58:59Z" })) });
  db.set("main", { sha: TARGET });
  for (const [index, file] of FILES.entries()) {
    const runs = SPECS.filter(spec => spec.run.path === ".github/workflows/" + file).map(spec => db.get("run:" + spec.run.id));
    if (index === 4) runs.unshift(self);
    db.set(file + ":1", { total_count: runs.length, workflow_runs: runs });
  }
  const api = async endpoint => {
    let key;
    if (endpoint.endsWith("/commits/main")) key = "main";
    else if (endpoint.includes("ci.yml/runs?event=push")) key = "ci";
    else if (/\/workflows\/([^/]+)\/runs\?per_page=100&page=([0-9]+)$/.test(endpoint)) {
      const match = endpoint.match(/\/workflows\/([^/]+)\/runs\?per_page=100&page=([0-9]+)$/); key = match[1] + ":" + match[2];
    } else {
      const match = endpoint.match(/\/runs\/([0-9]+)(.*)$/); assert.ok(match, endpoint);
      key = (match[2].includes("/jobs") ? "jobs:" : match[2].includes("/artifacts") ? "artifacts:" : "run:") + match[1];
    }
    calls.set(key, (calls.get(key) ?? 0) + 1);
    const value = db.get(key); assert.notEqual(value, undefined, key);
    return mutate(key, clone(value), calls.get(key));
  };
  return { api, db, calls };
}
const history = mutate => inspectMaintenancePreflightRecoveryHistory(inspection(), fixture(mutate).api, NOW, SELF, () => NOW);
const evidence = (mutate, override = {}) => createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), { ...env(), ...override }, fixture(mutate).api, NOW, () => NOW);

test("preflight recovery binds exact B9/R9/failed D9, prior renewal and full CI without issuing a new deploy attempt", async () => {
  const result = await history();
  assert.equal(result.records.length, 5);
  assert.deepEqual(result.records.map(record => record.jobs[0].steps?.length ?? record.jobs.length), [30,27,18,49,10]);
  assert.equal(result.cutoff, Date.parse("2026-09-14T16:17:32Z"));
  assert.equal(result.predecessorStateDigest, INCIDENT.stateDigest);
  assert.equal(result.failedDeployPurpose, "historical-preflight-failure-not-successful-deploy");
  assert.deepEqual(result.records.map(record => record.artifacts.length), [6, 3, 0, 0, 0]);
  assert.equal(result.records[2].run.conclusion, "failure");
  const e = await evidence();
  assert.equal(e.activeAttempt, 3);
  assert.equal(e.preflightRecoveryRunId, SELF);
  assert.deepEqual(decodeMaintenancePreflightRecoveryEvidence(encodeMaintenancePreflightRecoveryEvidence(e)), e);
  assert.equal(SPECS[0].run.id, 34868191767);
  assert.throws(() => { SPECS[0].jobs[0].steps[0][2] = "failure"; });
});

test("every fixed run event, head, identity, attempt, terminal result and timestamp is exact", async () => {
  for (const spec of SPECS) for (const patch of [
    { id: 42 }, { event: "push" }, { head_sha: TARGET }, { head_branch: "other" }, { run_attempt: 2 },
    { status: "in_progress" }, { conclusion: "neutral" }, { repository: null }, { head_repository: null },
    { created_at: "2026-09-14T13:54:42Z" }, { run_started_at: "2026-09-14T13:54:42Z" },
    { updated_at: "2026-09-14T18:05:00Z" }, { path: ".github/workflows/other.yml" },
  ]) {
    if (Object.entries(patch).every(([key, value]) => spec.run[key] === value)) continue;
    await assert.rejects(history((key, value) => key === "run:" + spec.run.id ? { ...value, ...patch } : value));
  }
});

test("all fixed job identities and every recovery/backup step tuple are mandatory", async () => {
  for (const spec of SPECS) {
    for (const change of [v => v.total_count++, v => v.jobs.pop(), v => v.jobs[0].id++,
      v => v.jobs[0].head_sha = TARGET, v => v.jobs[0].status = "in_progress", v => v.jobs[0].conclusion = "cancelled"])
      await assert.rejects(history((key, value) => { if (key === "jobs:" + spec.run.id) change(value); return value; }));
    if (!spec.jobs[0].steps) continue;
    for (let index = 0; index < spec.jobs[0].steps.length; index++) {
      for (const change of [s => s.number++, s => s.name += " changed", s => s.status = "in_progress",
        s => s.conclusion = s.conclusion === "success" ? "skipped" : "success",
        s => s.started_at = "2026-09-14T18:05:00Z", s => s.completed_at = "2026-09-14T18:05:00Z"])
        await assert.rejects(history((key, value) => { if (key === "jobs:" + spec.run.id) change(value.jobs[0].steps[index]); return value; }));
    }
    await assert.rejects(history((key, value) => { if (key === "jobs:" + spec.run.id) value.jobs[0].steps.pop(); return value; }));
  }
});

test("historical B9 inventory cannot gain or change an identity, digest, expiry or byte count", async () => {
  for (const change of [v => v.total_count++, v => v.artifacts.pop(),
    v => v.artifacts.push({ name: "unexpected-extra-binding" }),
    v => v.artifacts[0].id++, v => v.artifacts[0].size_in_bytes++, v => v.artifacts[0].expired = true,
    v => v.artifacts[0].digest = "sha256:" + "a".repeat(64), v => v.artifacts[0].workflow_run.head_sha = TARGET])
    await assert.rejects(history((key, value) => { if (key === "artifacts:34868191767") change(value); return value; }));
});

test("failed D9 and prior renewal/CI must still have exactly zero artifacts; readiness bytes are also bound", async () => {
  for (const run of ["34873244708", "34867675835", "34865334166"]) {
    for (const change of [v => v.total_count++, v => v.artifacts.push({ id: 1 }),
      v => { v.total_count = 1; v.artifacts.push({ name: "unexpected-binding" }); }]) {
      await assert.rejects(history((key, value) => { if (key === "artifacts:" + run) change(value); return value; }));
    }
  }
  for (const change of [v => v.artifacts[0].digest = "sha256:" + "b".repeat(64),
    v => v.artifacts[0].workflow_run.id++, v => v.artifacts[0].size_in_bytes++]) {
    await assert.rejects(history((key, value) => { if (key === "artifacts:34873107909") change(value); return value; }));
  }
});

test("all five histories reject unknown same-second, later, old retried or nonterminal activity", async () => {
  for (const [index, file] of FILES.entries()) for (const time of ["2026-09-14T16:17:32Z", "2026-09-14T18:05:00Z"]) {
    const unknown = addRepo({ ...SPECS[0].run, id: 444, name: NAMES[index], path: ".github/workflows/" + file,
      created_at: time, run_started_at: time, updated_at: time });
    await assert.rejects(history((key, value) => {
      if (key === file + ":1") { value.total_count++; value.workflow_runs.push(unknown); } return value;
    }));
    unknown.created_at = "2026-09-12T12:00:00Z"; unknown.run_started_at = unknown.created_at; unknown.run_attempt = 2;
    await assert.rejects(history((key, value) => {
      if (key === file + ":1") { value.total_count++; value.workflow_runs.push(unknown); } return value;
    }));
  }
  for (const patch of [{ status: "in_progress", conclusion: null }, { run_attempt: 2 }, { head_sha: TARGET }])
    await assert.rejects(history((key, value) => {
      if (key === FILES[0] + ":1") Object.assign(value.workflow_runs[0], patch); return value;
    }));
});

test("pagination counts, duplicate IDs, missing pages and the complete second observation fail closed", async () => {
  for (const change of [v => v.total_count++, v => v.workflow_runs.pop(),
    v => { v.workflow_runs.push(v.workflow_runs[0]); v.total_count++; }])
    await assert.rejects(history((key, value) => { if (key === FILES[0] + ":1") change(value); return value; }));
  await assert.rejects(history((key, value, count) => {
    if (key === FILES[0] + ":1" && count === 2) { value.workflow_runs[0].updated_at = "2026-09-14T18:05:00Z"; } return value;
  }));
  for (const keyName of ["run:34868191767", "jobs:34867675835", "jobs:34865334166", "artifacts:34868191767", "artifacts:34873244708", "jobs:34873107909"])
    await assert.rejects(history((key, value, count) => {
      if (key === keyName && count === 2) { if (value.jobs) value.jobs[0].id++; else if (value.artifacts) { if (value.artifacts[0]) value.artifacts[0].id++; else value.total_count++; } else value.run_attempt++; } return value;
    }));
  const f = fixture();
  const older = number => addRepo({ ...SPECS[0].run, id: 5000 + number, name: NAMES[1], path: ".github/workflows/" + FILES[1],
    created_at: "2026-09-12T00:00:00Z", run_started_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:01:00Z" });
  f.db.set(FILES[1] + ":1", { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, i) => older(i)) });
  f.db.set(FILES[1] + ":2", { total_count: 101, workflow_runs: [older(100)] });
  assert.equal((await inspectMaintenancePreflightRecoveryHistory(inspection(), f.api, NOW, SELF, () => NOW)).rows.length, 106);
  f.db.get(FILES[1] + ":2").total_count = 102;
  await assert.rejects(inspectMaintenancePreflightRecoveryHistory(inspection(), f.api, NOW, SELF, () => NOW));
});

test("only exact active preflight recovery workflow env may authorize the same unused attempt", async () => {
  for (const patch of [{ GITHUB_REPOSITORY: "other/repo" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: INCIDENT.failedDeployRunId }, { GITHUB_SHA: INCIDENT.previousTargetSha },
    { TARGET_SHA: INCIDENT.previousTargetSha }, { PREVIOUS_TARGET_SHA: TARGET }, { EXPECTED_OLD_SHA: TARGET },
    { MAINTENANCE_OPERATION_ID: "other" }, { ACTION: "recover-budget" },
    { CONFIRMATION: "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z" },
    { CONFIRMATION: "RENEW_PRODUCTION_MAINTENANCE_UNTIL_20260914T160001Z" }])
    await assert.rejects(evidence(undefined, patch));
  for (const patch of [{ event: "schedule" }, { run_attempt: 2 }, { head_sha: INCIDENT.previousTargetSha },
    { status: "completed", conclusion: "success" }, { created_at: "2026-09-14T15:00:00Z" }])
    await assert.rejects(evidence((key, value) => key === "run:" + SELF ? { ...value, ...patch } : value));
});

test("current main must be stable with all ten exact successful CI jobs and prior completed CI", async () => {
  for (const change of [v => v.total_count++, v => v.workflow_runs.push(v.workflow_runs[0]),
    v => v.workflow_runs[0].run_attempt = 2, v => v.workflow_runs[0].head_sha = INCIDENT.previousTargetSha,
    v => v.workflow_runs[0].conclusion = "failure", v => v.workflow_runs[0].event = "pull_request"])
    await assert.rejects(evidence((key, value) => { if (key === "ci") change(value); return value; }));
  for (const change of [v => v.total_count--, v => v.jobs.pop(), v => v.jobs[0].name = "fake",
    v => v.jobs[0].conclusion = "skipped", v => v.jobs[0].run_id++, v => v.jobs[0].head_sha = INCIDENT.previousTargetSha,
    v => v.jobs[0].completed_at = "2026-09-14T18:00:00Z"])
    await assert.rejects(evidence((key, value) => { if (key === "jobs:" + CI) change(value); return value; }));
  await assert.rejects(evidence((key, value, count) => key === "main" && count === 2 ? { sha: "b".repeat(40) } : value));
  await assert.rejects(evidence((key, value, count) => { if (key === "jobs:" + CI && count === 2) value.jobs[0].id++; return value; }));
});

test("actual authorization bounds and five-minute baseline never use an old clock", async () => {
  for (const now of [AUTH.authorizedAt - 1, AUTH.expiresAt, AUTH.expiresAt + 1])
    await assert.rejects(createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), fixture().api, now));
  await assert.rejects(createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), fixture().api, NOW + 300001));
  await assert.rejects(createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), fixture().api, NOW - 1001));
});

test("current-run updates use each actual observation clock without moving the original history time", async () => {
  let elapsed = 0;
  const f = fixture((key, value, count) => {
    if (key === FILES[4] + ":1" && count === 2) {
      elapsed = 2000;
      value.workflow_runs.find(run => String(run.id) === SELF).updated_at = new Date(NOW + 1000).toISOString().replace(".000Z", "Z");
    }
    if (key === "run:" + SELF) {
      elapsed = 3000;
      value.updated_at = new Date(NOW + 2000).toISOString().replace(".000Z", "Z");
    }
    return value;
  });
  const value = await createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), f.api, NOW, () => NOW + elapsed);
  assert.equal(value.historyCheckedAt, NOW);
  for (const times of [[NOW + 3000, NOW + 2000], [NOW - 1], [NOW + 300001], [AUTH.expiresAt]]) {
    let index = 0;
    await assert.rejects(createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), fixture().api, NOW,
      () => times[Math.min(index++, times.length - 1)]));
  }
  const future = fixture((key, value) => {
    if (key === FILES[4] + ":1") value.workflow_runs.find(run => String(run.id) === SELF).updated_at = "2026-09-14T15:30:02Z";
    return value;
  });
  await assert.rejects(createMaintenancePreflightRecoveryWorkflowEvidence(inspection(), env(), future.api, NOW, () => NOW + 1000));
});

test("CLI remains GET-only, bounded, masks before output, and never downloads backup payloads or raw logs", () => {
  const source = readFileSync(new URL("./production-maintenance-preflight-recovery-workflow.mjs", import.meta.url), "utf8");
  assert.match(source, /\["api", "--method", "GET", endpoint\]/);
  assert.match(source, /maxBuffer: 8 \* 1024 \* 1024/);
  assert.match(source, /timeout: 15000/);
  assert.ok(source.indexOf("::add-mask::") < source.indexOf("appendFileSync(process.env.GITHUB_OUTPUT"));
  assert.doesNotMatch(source, /\/zip|\/logs|spawnSync\("(?:ssh|curl)"|"--method", "(?:POST|PUT|DELETE)"/);
  assert.match(source, /maintenance_preflight_recovery_workflow_unverified/);
});
