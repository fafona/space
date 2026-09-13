import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateMaintenanceBuildRecoveryInspection, validateMaintenanceBuildRecoveryEvidence, encodeMaintenanceBuildRecoveryEvidence } from "./production-maintenance-build-recovery.mjs";
import { validateProductionMaintenanceBinding, assertProductionMaintenanceProvenance } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";

const REPOSITORY = "fafona/space";
const OLD_TARGET = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf";
const PREVIOUS_TARGET = "46f007fbd9e417f93c01e398c77cf38ec814547d";
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const LIMIT = 20;
// Preserve the ORIGINAL operation cutoff. Each later incident is an explicit
// exception, not permission to ignore activity before the latest failed build.
const WORKFLOWS = Object.freeze([
  ["database-backup.yml", "Encrypted Database Backup", "workflow_dispatch",
    [["34715932102", OLD_TARGET, "success"], ["34724943157", PREVIOUS_TARGET, "success"]]],
  ["database-migrate.yml", "Apply Production Database Migrations", "workflow_dispatch",
    [["34721155156", OLD_TARGET, "success"]]],
  ["ordinary-account-cutover-readiness.yml", "Ordinary Account Cutover Readiness", "workflow_dispatch",
    [["34721256683", OLD_TARGET, "success"], ["34728212357", PREVIOUS_TARGET, "success"]]],
  ["deploy.yml", "Deploy Production", "workflow_run",
    [["34721317710", OLD_TARGET, "failure"], ["34728263285", PREVIOUS_TARGET, "failure"]]],
]);
const INCIDENT_ORDER = Object.freeze(["34715932102", "34721155156", "34721256683", "34721317710",
  "34724943157", "34728212357", "34728263285"]);
const fail = () => { throw new Error("maintenance_build_recovery_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = value => Number.isSafeInteger(value) && value > 0 ? String(value) : fail();
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || new Date(result).toISOString() !== value.slice(0, -1) + ".000Z") fail();
  return result;
}

/** These bytes must also be verified cryptographically by gh attestation verify
 * using the fixed old workflow, source SHA/ref and hosted-runner restriction.
 * This function binds the verified subjects to the original operation and the fixed T3 backup/readiness runs;
 * it never relabels old backup/readiness evidence for the new target.
 */
export function validateMaintenanceBuildRecoveryPriorBindings(inspection, records) {
  const checked = validateMaintenanceBuildRecoveryInspection(inspection);
  if (!records || Object.keys(records).sort().join(",") !== "backup,readiness") fail();
  const result = {};
  for (const phase of ["backup", "readiness"]) {
    const record = records[phase];
    if (!record || Object.keys(record).sort().join(",") !== "bytes,provenance" || !Buffer.isBuffer(record.bytes) ||
        record.bytes.length < 1 || record.bytes.length > 4096) fail();
    const runId = phase === "backup" ? checked.backupRunId : checked.readinessRunId;
    const expected = { phase, mode: "maintenance", targetSha: checked.previousTargetSha, expectedOldSha: checked.expectedOldSha,
      operationId: checked.operationId, runId, runAttempt: "1", backupRunId: checked.backupRunId, backupRunAttempt: "1",
      readinessRunId: phase === "backup" ? null : checked.readinessRunId, readinessRunAttempt: phase === "backup" ? null : "1" };
    const binding = validateProductionMaintenanceBinding(JSON.parse(record.bytes.toString("utf8")), expected);
    if (!record.bytes.equals(canonicalJsonBytes(binding))) fail();
    assertProductionMaintenanceProvenance(record.provenance, record.bytes);
    result[phase] = { binding, subjectDigest: createHash("sha256").update(record.bytes).digest("hex"), provenanceDigest: hash(record.provenance) };
  }
  return result;
}

async function inspectIncidentJob(file, run, api) {
  const response = await api(`repos/${REPOSITORY}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const job = response.jobs[0];
  if (job.run_id !== run.id || job.head_sha !== run.head_sha || job.status !== "completed" || job.conclusion !== run.conclusion ||
      !Array.isArray(job.steps) || job.steps.length < 1 || job.steps.length > 100 || new Set(job.steps.map(step => step.name)).size !== job.steps.length) fail();
  const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
  if (started < timestamp(run.run_started_at) || completed < started || completed > timestamp(run.updated_at)) fail();
  const required = {
    "database-backup.yml": ["Verify Held Maintenance Before Backup", "Verify Encrypted Backup", "Rehearse Isolated Restore", "Attest Canonical Maintenance Binding", "Verify Held Maintenance Before Backup Attestation"],
    "database-migrate.yml": ["Verify Recursive Backup Attestation Chain", "Verify Signed Backup Maintenance Binding", "Verify Held Maintenance Before Migration", "Revalidate Evidence And Apply Exact Through", "Verify Held Maintenance After Migration"],
    "ordinary-account-cutover-readiness.yml": ["Verify Signed Backup Maintenance Binding", "Inspect Locked Production Readiness From Exact Source", "Enforce Ready Cutover State", "Verify Held Maintenance After Readiness", "Attest Canonical Maintenance Binding", "Confirm Exact Successful Readiness Artifact Inventory"],
    "deploy.yml": ["Validate Readiness Workflow Run", "Verify Readiness Evidence", "Revalidate Live Recursive Backup Evidence", "Verify Signed Readiness Maintenance Binding", "Export Verified Maintenance Binding", "Setup SSH"],
  }[file];
  for (const name of required) if (job.steps.find(step => step.name === name)?.conclusion !== "success") fail();
  const failures = job.steps.filter(step => step.conclusion === "failure");
  if (file === "deploy.yml") {
    if (failures.length !== 1 || failures[0].name !== "Deploy To Server") fail();
    for (const name of ["Verify Public Release", "Verify Candidate While Public Entry Remains Held", "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding"])
      if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  } else if (failures.length !== 0) fail();
  for (const step of job.steps) {
    if (step.status !== "completed" || !["success", "skipped", "failure"].includes(step.conclusion)) fail();
    if (step.conclusion !== "skipped") {
      const start = timestamp(step.started_at), end = timestamp(step.completed_at);
      if (start < started || end < start || end > completed) fail();
    }
  }
  if (file === "database-migrate.yml") {
    const apply = job.steps.find(step => step.name === "Revalidate Evidence And Apply Exact Through");
    if (apply.started_at !== "2026-09-12T21:52:38Z" || apply.completed_at !== "2026-09-12T21:52:45Z") fail();
  }
  return { id: id(job.id), started, completed, steps: job.steps };
}

export async function inspectMaintenanceBuildRecoveryHistory(inspection, api, now) {
  const checked = validateMaintenanceBuildRecoveryInspection(inspection);
  if (typeof api !== "function" || !Number.isSafeInteger(now) || now < checked.createdAt) fail();
  const cutoff = Math.floor(checked.createdAt / 1000) * 1000;
  const all = [], incidents = [];
  for (const [file, name, event, allowed] of WORKFLOWS) {
    const seen = new Set(); let ended = false; let total = null; const found = new Map();
    for (let page = 1; page <= LIMIT; page++) {
      const response = await api(`repos/${REPOSITORY}/actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!response || !Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > LIMIT * 100 ||
          !Array.isArray(response.workflow_runs) || response.workflow_runs.length > 100) fail();
      if (total === null) total = response.total_count;
      if (response.total_count !== total) fail();
      for (const run of response.workflow_runs) {
        if (!run || run.name !== name || run.path !== `.github/workflows/${file}` || run.repository?.full_name !== REPOSITORY ||
            run.head_repository?.full_name !== REPOSITORY || !SHA.test(run.head_sha ?? "") || run.head_branch !== "main") fail();
        const runId = id(run.id), attempt = id(run.run_attempt);
        if (seen.has(runId)) fail(); seen.add(runId);
        const created = timestamp(run.created_at), updated = timestamp(run.updated_at);
        const started = run.run_started_at === null ? created : timestamp(run.run_started_at);
        if (created > updated || started < created || started > updated || updated > now || run.status !== "completed" ||
            !["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure"].includes(run.conclusion)) fail();
        const allowedRun = allowed.find(([expectedId]) => expectedId === runId);
        if (allowedRun) {
          if (attempt !== "1" || run.head_sha !== allowedRun[1] || run.event !== event ||
              run.conclusion !== allowedRun[2] || created <= checked.createdAt) fail();
          found.set(runId, { ...run, created, updated, started, job: await inspectIncidentJob(file, run, api) });
        } else if (Math.max(created, started, updated) >= cutoff) fail();
        all.push({ workflow: file, id: runId, attempt, created, started, updated, sha: run.head_sha, conclusion: run.conclusion });
      }
      if (response.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended || found.size !== allowed.length) fail();
    for (const [expectedId] of allowed) {
      const incident = found.get(expectedId); if (!incident) fail();
      incidents.push({ workflow: file, id: expectedId, created: incident.created, updated: incident.updated, job: incident.job });
    }
  }
  incidents.sort((a, b) => INCIDENT_ORDER.indexOf(a.id) - INCIDENT_ORDER.indexOf(b.id));
  if (incidents.length !== INCIDENT_ORDER.length || incidents.some((incident, index) => incident.id !== INCIDENT_ORDER[index])) fail();
  for (let index = 1; index < incidents.length; index++) if (incidents[index].created < incidents[index - 1].updated) fail();
  all.sort((a, b) => a.workflow.localeCompare(b.workflow) || Number(a.id) - Number(b.id));
  return { all, incidents };
}

export async function createMaintenanceBuildRecoveryWorkflowEvidence(inspection, env, api, priorBindings, now = Date.now()) {
  const checked = validateMaintenanceBuildRecoveryInspection(inspection);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha || env.EXPECTED_OLD_SHA !== checked.expectedOldSha ||
      env.MAINTENANCE_OPERATION_ID !== checked.operationId || env.ACTION !== "recover-build" || env.CONFIRMATION !== "RECOVER_BUILD_PRODUCTION_MAINTENANCE") fail();
  const bindings = validateMaintenanceBuildRecoveryPriorBindings(checked, priorBindings);
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await api(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&head_sha=${checked.targetSha}&per_page=100`);
  if (!Array.isArray(ci?.workflow_runs)) fail();
  const matched = ci.workflow_runs.filter(run => run.name === "CI" && run.path === ".github/workflows/ci.yml" && run.event === "push" &&
    run.head_branch === "main" && run.head_sha === checked.targetSha && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && run.status === "completed" && run.conclusion === "success" &&
    run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY);
  if (!matched.length) fail();
  const mainCIrunId = id(matched[0].id);
  const history = await inspectMaintenanceBuildRecoveryHistory(checked, api, now);
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  return validateMaintenanceBuildRecoveryEvidence({ ...checked, toolsSha: checked.targetSha,
    buildRecoveryRunId: env.GITHUB_RUN_ID, buildRecoveryRunAttempt: 1, mainCIrunId,
    historyDigest: hash({ history, bindings }), historyCheckedAt: now });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "linux" || process.argv.length !== 6 || process.argv[2] !== "--inspection" || process.argv[4] !== "--prior-bindings" ||
        !process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) fail();
    const readBounded = (file, maximum) => {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) fail();
      const bytes = readFileSync(file); if (bytes.length !== stat.size) fail(); return bytes;
    };
    const inspection = JSON.parse(readBounded(process.argv[3], 16384));
    const priorBindings = Object.fromEntries(["backup", "readiness"].map(phase => [phase, {
      bytes: readBounded(join(process.argv[5], phase, "production-maintenance-binding.json"), 4096),
      provenance: JSON.parse(readBounded(join(process.argv[5], phase, "provenance.json"), 1048576)),
    }]));
    const api = async endpoint => {
      if (!endpoint.startsWith(`repos/${REPOSITORY}/`) || endpoint.length > 512) fail();
      const result = spawnSync("/usr/bin/gh", ["api", "--method", "GET", endpoint], {
        encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GH_TOKEN: process.env.GH_TOKEN, GH_HOST: "github.com" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || result.error || result.signal) fail();
      return JSON.parse(result.stdout);
    };
    const evidence = await createMaintenanceBuildRecoveryWorkflowEvidence(inspection, process.env, api, priorBindings);
    appendFileSync(process.env.GITHUB_OUTPUT, `build_recovery_evidence=${encodeMaintenanceBuildRecoveryEvidence(evidence)}\n`);
    process.stdout.write("maintenance_build_recovery_history_verified\n");
  } catch { process.stderr.write("maintenance_build_recovery_workflow_unverified\n"); process.exitCode = 1; }
}
