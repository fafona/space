import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateMaintenanceRecoveryInspection, validateMaintenanceRecoveryEvidence, encodeMaintenanceRecoveryEvidence } from "./production-maintenance-recovery.mjs";

const REPOSITORY = "fafona/space";
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const LIMIT = 20;
const WORKFLOWS = Object.freeze([
  ["database-backup.yml", "Encrypted Database Backup"],
  ["database-migrate.yml", "Apply Production Database Migrations"],
  ["ordinary-account-cutover-readiness.yml", "Ordinary Account Cutover Readiness"],
  ["deploy.yml", "Deploy Production"],
]);
const fail = () => { throw new Error("maintenance_recovery_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = value => Number.isSafeInteger(value) && value > 0 ? String(value) : fail();
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || new Date(result).toISOString() !== value.slice(0, -1) + ".000Z") fail();
  return result;
}

/** Authenticated metadata only. A run/attempt updated in the window is refused
 * regardless of its conclusion. The shared production-deploy workflow lock
 * remains required: this is not a transaction with arbitrary GitHub dispatches.
 */
export async function inspectMaintenanceRecoveryHistory(inspection, api) {
  const checked = validateMaintenanceRecoveryInspection(inspection);
  if (typeof api !== "function") fail();
  // GitHub truncates these timestamps to seconds, while the original operation
  // uses epoch milliseconds. Treat its WHOLE creation second as ambiguous:
  // a later action in that second must never be classified as pre-maintenance.
  const cutoff = Math.floor(checked.createdAt / 1000) * 1000;
  const all = [];
  for (const [file, name] of WORKFLOWS) {
    const seen = new Set(); let ended = false; let total = null;
    for (let page = 1; page <= LIMIT; page++) {
      const value = await api(`repos/${REPOSITORY}/actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!value || !Number.isSafeInteger(value.total_count) || value.total_count < 0 || value.total_count > LIMIT * 100 ||
          !Array.isArray(value.workflow_runs) || value.workflow_runs.length > 100) fail();
      if (total === null) total = value.total_count;
      if (value.total_count !== total) fail();
      for (const run of value.workflow_runs) {
        if (!run || run.name !== name || run.path !== `.github/workflows/${file}` ||
            run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY ||
            !SHA.test(run.head_sha ?? "") || run.head_branch !== "main") fail();
        const runId = id(run.id), attempt = id(run.run_attempt);
        if (seen.has(runId)) fail(); seen.add(runId);
        const created = timestamp(run.created_at), updated = timestamp(run.updated_at);
        const started = run.run_started_at === null ? created : timestamp(run.run_started_at);
        if (created > updated || started < created || started > updated ||
            Math.max(created, started, updated) >= cutoff || run.status !== "completed" ||
            !["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure"].includes(run.conclusion)) fail();
        all.push({ workflow: file, id: runId, attempt, created, started, updated, sha: run.head_sha, conclusion: run.conclusion });
      }
      if (value.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended) fail();
  }
  all.sort((a, b) => a.workflow.localeCompare(b.workflow) || Number(a.id) - Number(b.id));
  return hash(all);
}

export async function createMaintenanceRecoveryWorkflowEvidence(inspection, env, api, now = Date.now()) {
  const checked = validateMaintenanceRecoveryInspection(inspection);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") ||
      env.GITHUB_SHA !== checked.targetSha || env.TARGET_SHA !== checked.targetSha ||
      env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha || env.EXPECTED_OLD_SHA !== checked.expectedOldSha ||
      env.MAINTENANCE_OPERATION_ID !== checked.operationId || env.ACTION !== "recover-held" ||
      env.CONFIRMATION !== "RECOVER_PRODUCTION_MAINTENANCE" || !Number.isSafeInteger(now) || now < checked.createdAt) fail();
  const main = await api(`repos/${REPOSITORY}/commits/main`);
  if (main?.sha !== checked.targetSha) fail();
  const ci = await api(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&head_sha=${checked.targetSha}&per_page=100`);
  if (!Array.isArray(ci?.workflow_runs)) fail();
  const matched = ci.workflow_runs.filter(run => run.name === "CI" && run.path === ".github/workflows/ci.yml" &&
    run.event === "push" && run.head_branch === "main" && run.head_sha === checked.targetSha &&
    run.status === "completed" && run.conclusion === "success" && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY);
  if (!matched.length) fail();
  const mainCIrunId = id(matched[0].id);
  const historyDigest = await inspectMaintenanceRecoveryHistory(checked, api);
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  return validateMaintenanceRecoveryEvidence({ ...checked, toolsSha: checked.targetSha,
    recoveryRunId: env.GITHUB_RUN_ID, recoveryRunAttempt: 1, mainCIrunId, historyDigest, historyCheckedAt: now });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "linux" || process.argv.length !== 4 || process.argv[2] !== "--inspection" ||
        !process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) fail();
    const file = process.argv[3], stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16384) fail();
    const inspection = JSON.parse(readFileSync(file, "utf8"));
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
    const evidence = await createMaintenanceRecoveryWorkflowEvidence(inspection, process.env, api);
    appendFileSync(process.env.GITHUB_OUTPUT, `recovery_evidence=${encodeMaintenanceRecoveryEvidence(evidence)}\n`);
    process.stdout.write("maintenance_recovery_history_verified\n");
  } catch { process.stderr.write("maintenance_recovery_workflow_unverified\n"); process.exitCode = 1; }
}
