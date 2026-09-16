import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DAEMON_REPAIR as P } from "./production-maintenance-daemon-repair.mjs";
import { readDaemonRepairSource, validateDaemonRepairAuthority } from "./repair-daemon.mjs";

const fail = () => { throw new Error("daemon_workflow_unverified"); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const run = (file, args) => {
  const r = spawnSync(file, args, { encoding: "utf8", timeout: 60000, maxBuffer: 8388608, windowsHide: true });
  if (r.status !== 0 || r.error || r.signal) fail(); return r.stdout;
};
const api = path => JSON.parse(run("gh", ["api", "repos/fafona/space/" + path]));
export const DAEMON_CI_JOBS = Object.freeze(["Checkout Context PostgreSQL Acceptance", "Enterprise Browser Journeys", "Isolated Maintenance Ingress Acceptance",
  "Isolated Supabase Scheduler Acceptance", "Order Membership PostgreSQL Acceptance", "Pages Client Write ACL PostgreSQL Acceptance",
  "QR Atomic PostgreSQL Acceptance", "Quality", "Recovery Content PostgreSQL Acceptance", "Redemption PostgreSQL Acceptance"].sort());
export function validateDaemonRun(value, expected) {
  if (!value || value.id !== Number(expected.id) || value.run_attempt !== 1 || value.head_sha !== expected.sha || value.head_branch !== "main" ||
      value.event !== expected.event || value.path !== ".github/workflows/" + expected.file || value.status !== "completed" ||
      value.conclusion !== expected.conclusion || value.repository?.full_name !== "fafona/space" || value.head_repository?.full_name !== "fafona/space") fail();
}
export function validateDaemonCiJobs(value, sha) {
  if (value.total_count !== 10 || value.jobs?.length !== 10 || value.jobs.map(j => j.name).sort().join() !== DAEMON_CI_JOBS.join() ||
      value.jobs.some(j => j.status !== "completed" || j.conclusion !== "success" || j.head_sha !== sha)) fail();
}
export function validateDaemonProvenance(bytes, results) {
  const subjects = results?.[0]?.verificationResult?.statement?.subject;
  if (!Array.isArray(results) || results.length !== 1 || subjects?.length !== 1 || subjects[0].name !== "daemon-authority.json" ||
      subjects[0].digest?.sha256 !== hash(bytes)) fail();
}
export function validateDaemonHistoryRun(r, currentRunId) {
  if (String(r.id) === currentRunId) return;
  if (r.status !== "completed" || !Number.isFinite(Date.parse(r.created_at))) fail();
  if (Date.parse(r.created_at) >= P.createdAt && ![P.failedRunId, P.backupRunId, P.readinessRunId, "35129584317", "35132895108", "35131822753", "35129762971", "35131689002", "35145761968", "35146223181"].includes(String(r.id))) fail();
}
export function daemonMetadata(sha, runId, read = api, now = Date.now()) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]{0,15}$/.test(runId) || process.env.GITHUB_REPOSITORY !== "fafona/space" ||
      process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_RUN_ATTEMPT !== "1" ||
      process.env.GITHUB_SHA !== sha || process.env.GITHUB_RUN_ID !== runId || read("git/ref/heads/main").object.sha !== sha ||
      now < P.createdAt || now >= P.createdAt + 43200000 - 1200000) fail();
  const history = [];
  const ci = (id, target) => {
    const r = read("actions/runs/" + id);
    validateDaemonRun(r, { id, sha: target, event: "push", file: "ci.yml", conclusion: "success" });
    validateDaemonCiJobs(read(`actions/runs/${id}/jobs?per_page=100`), target);
    history.push({ id: r.id, sha: r.head_sha, conclusion: r.conclusion, attempt: r.run_attempt });
  };
  const cis = read(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  if (cis.total_count !== 1 || cis.workflow_runs.length !== 1) fail();
  const mainCIrunId = String(cis.workflow_runs[0].id);
  ci(mainCIrunId, sha); ci("35143229909", P.previousTargetSha);
  for (const [id, file, event, conclusion] of [[P.backupRunId, "database-backup.yml", "workflow_dispatch", "success"],
    [P.readinessRunId, "ordinary-account-cutover-readiness.yml", "workflow_dispatch", "success"], [P.failedRunId, "deploy.yml", "workflow_run", "failure"]]) {
    const r = read("actions/runs/" + id);
    validateDaemonRun(r, { id, sha: P.previousTargetSha, file, event, conclusion });
    const jobs = read(`actions/runs/${id}/jobs?per_page=100`);
    if (jobs.total_count !== 1 || jobs.jobs.length !== 1 || jobs.jobs[0].conclusion !== conclusion) fail();
    const failed = jobs.jobs[0].steps.filter(s => s.conclusion === "failure");
    if (conclusion === "success" ? failed.length !== 0 : failed.length !== 1 || failed[0].name !== "Deploy To Server") fail();
    if (id === P.backupRunId && !jobs.jobs[0].steps.some(s => s.name === "Rehearse Isolated Restore" && s.conclusion === "success")) fail();
    history.push({ id: r.id, sha: r.head_sha, conclusion: r.conclusion, attempt: r.run_attempt });
  }
  const current = read("actions/runs/" + runId);
  if (current.id !== Number(runId) || current.head_sha !== sha || current.event !== "workflow_dispatch" || current.run_attempt !== 1 ||
      current.head_branch !== "main" || current.path !== ".github/workflows/repair-daemon.yml" || current.status !== "in_progress" ||
      current.repository?.full_name !== "fafona/space" || current.head_repository?.full_name !== "fafona/space") fail();
  for (const file of ["deploy.yml", "production-maintenance.yml", "database-migrate.yml", "database-backup.yml", "ordinary-account-cutover-readiness.yml",
    "recover-maintenance-candidate.yml", "restore-reclosed-candidate.yml", "repair-daemon.yml", "repair-unlaunched-transport.yml",
    "recover-failed-post-switch-deploy.yml", "recover-failed-pre-forward-deploy.yml", "revoke-legacy-browser-auth-sessions.yml",
    "legacy-personal-recovery-encrypted-config.yml"]) {
    let count = 0, complete = false;
    for (let page = 1; page <= 20; page++) {
      const value = read(`actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!Array.isArray(value.workflow_runs) || !Number.isSafeInteger(value.total_count)) fail();
      for (const r of value.workflow_runs) { validateDaemonHistoryRun(r, runId); }
      count += value.workflow_runs.length;
      if (count === value.total_count) { complete = true; break; }
      if (!value.workflow_runs.length || count > value.total_count) fail();
    }
    if (!complete) fail();
  }
  return validateDaemonRepairAuthority({ version: 1, kind: "faolla-daemon-repair", targetSha: sha, runId, runAttempt: 1,
    operationId: P.operationId, failedRunId: P.failedRunId, mainCIrunId, historyDigest: hash(JSON.stringify(history)), checkedAt: now }, sha, runId, now);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, sha, runId, file, provenance] = process.argv.slice(2);
    if (action === "authority") {
      readDaemonRepairSource(sha);
      const value = daemonMetadata(sha, runId);
      writeFileSync(file, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    } else if (action === "verify") {
      const bytes = readFileSync(file); if (bytes.length > 8192) fail();
      const value = validateDaemonRepairAuthority(JSON.parse(bytes), sha, runId);
      validateDaemonProvenance(bytes, JSON.parse(readFileSync(provenance)));
      const fresh = daemonMetadata(sha, runId);
      if (fresh.historyDigest !== value.historyDigest || fresh.mainCIrunId !== value.mainCIrunId) fail();
    } else fail();
  } catch { process.stderr.write("daemon_workflow_unverified\n"); process.exitCode = 1; }
}
