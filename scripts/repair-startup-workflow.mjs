import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STARTUP_REPAIR as P, STARTUP_COMPLETION as C } from "./production-maintenance-startup-repair.mjs";
import { readStartupRepairSource, validateStartupRepairAuthority } from "./repair-startup.mjs";

const fail = () => { throw new Error("startup_workflow_unverified"); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const run = (file, args) => {
  const r = spawnSync(file, args, { encoding: "utf8", timeout: 60000, maxBuffer: 8388608, windowsHide: true });
  if (r.status !== 0 || r.error || r.signal) fail(); return r.stdout;
};
const api = path => JSON.parse(run("gh", ["api", "repos/fafona/space/" + path]));
export const STARTUP_CI_JOBS = Object.freeze(["Checkout Context PostgreSQL Acceptance", "Enterprise Browser Journeys", "Isolated Maintenance Ingress Acceptance",
  "Isolated Supabase Scheduler Acceptance", "Order Membership PostgreSQL Acceptance", "Pages Client Write ACL PostgreSQL Acceptance",
  "QR Atomic PostgreSQL Acceptance", "Quality", "Recovery Content PostgreSQL Acceptance", "Redemption PostgreSQL Acceptance"].sort());
export function validateStartupRun(value, expected) {
  if (!value || value.id !== Number(expected.id) || value.run_attempt !== 1 || value.head_sha !== expected.sha || value.head_branch !== "main" ||
      value.event !== expected.event || value.path !== ".github/workflows/" + expected.file || value.status !== "completed" ||
      value.conclusion !== expected.conclusion || value.repository?.full_name !== "fafona/space" || value.head_repository?.full_name !== "fafona/space") fail();
}
export function validateStartupCiJobs(value, sha) {
  if (value.total_count !== 10 || value.jobs?.length !== 10 || value.jobs.map(j => j.name).sort().join() !== STARTUP_CI_JOBS.join() ||
      value.jobs.some(j => j.status !== "completed" || j.conclusion !== "success" || j.head_sha !== sha)) fail();
}
export function validateStartupProvenance(bytes, results) {
  const subjects = results?.[0]?.verificationResult?.statement?.subject;
  if (!Array.isArray(results) || results.length !== 1 || subjects?.length !== 1 || subjects[0].name !== "startup-authority.json" ||
      subjects[0].digest?.sha256 !== hash(bytes)) fail();
}
export function validateStartupHistoryRun(r, currentRunId) {
  if (String(r.id) === currentRunId) return;
  if (r.status !== "completed" || !Number.isFinite(Date.parse(r.created_at))) fail();
  if (Date.parse(r.created_at) >= P.createdAt && ![C.failedRunId,P.failedRunId, P.backupRunId, P.readinessRunId, "35129584317", "35132895108", "35131822753", "35129762971", "35131689002", "35145761968", "35146223181", "35156337705", "35148085536", "35156235371", "35162980806", "35163248067"].includes(String(r.id))) fail();
}
export function startupMetadata(sha, runId, read = api, now = Date.now()) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]{0,15}$/.test(runId) || process.env.GITHUB_REPOSITORY !== "fafona/space" ||
      process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_RUN_ATTEMPT !== "1" ||
      process.env.GITHUB_SHA !== sha || process.env.GITHUB_RUN_ID !== runId || read("git/ref/heads/main").object.sha !== sha ||
      now < C.authorizedAfter || now >= C.expiresAt - 1200000) fail();
  const history = [];
  const ci = (id, target) => {
    const r = read("actions/runs/" + id);
    validateStartupRun(r, { id, sha: target, event: "push", file: "ci.yml", conclusion: "success" });
    validateStartupCiJobs(read(`actions/runs/${id}/jobs?per_page=100`), target);
    history.push({ id: r.id, sha: r.head_sha, conclusion: r.conclusion, attempt: r.run_attempt });
  };
  const cis = read(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  if (cis.total_count !== 1 || cis.workflow_runs.length !== 1) fail();
  const mainCIrunId = String(cis.workflow_runs[0].id);
  ci(mainCIrunId, sha); ci("35160575874", P.previousTargetSha);
  ci("35172553547",C.sourceSha);
  const partial=read("actions/runs/"+C.failedRunId);
  validateStartupRun(partial,{id:C.failedRunId,sha:C.sourceSha,event:"workflow_dispatch",file:"repair-startup.yml",conclusion:"failure"});
  const partialJobs=read(`actions/runs/${C.failedRunId}/jobs?per_page=100`);
  if(partialJobs.total_count!==1||partialJobs.jobs.length!==1||partialJobs.jobs[0].conclusion!=="failure")fail();
  const partialFailed=partialJobs.jobs[0].steps.filter(s=>s.conclusion==="failure");
  if(partialFailed.length!==1||partialFailed[0].name!=="Reverify Held State And Commit Under Original Locks"||
    !partialJobs.jobs[0].steps.some(s=>s.name==="Verify Fresh Hosted Authority"&&s.conclusion==="success"))fail();
  history.push({id:partial.id,sha:partial.head_sha,conclusion:partial.conclusion,attempt:partial.run_attempt});
  for (const [id, file, event, conclusion] of [[P.backupRunId, "database-backup.yml", "workflow_dispatch", "success"],
    [P.readinessRunId, "ordinary-account-cutover-readiness.yml", "workflow_dispatch", "success"], [P.failedRunId, "deploy.yml", "workflow_run", "failure"]]) {
    const r = read("actions/runs/" + id);
    validateStartupRun(r, { id, sha: P.previousTargetSha, file, event, conclusion });
    const jobs = read(`actions/runs/${id}/jobs?per_page=100`);
    if (jobs.total_count !== 1 || jobs.jobs.length !== 1 || jobs.jobs[0].conclusion !== conclusion) fail();
    const failed = jobs.jobs[0].steps.filter(s => s.conclusion === "failure");
    if (conclusion === "success" ? failed.length !== 0 : failed.length !== 1 || failed[0].name !== "Deploy To Server") fail();
    if (id === P.backupRunId && !jobs.jobs[0].steps.some(s => s.name === "Rehearse Isolated Restore" && s.conclusion === "success")) fail();
    history.push({ id: r.id, sha: r.head_sha, conclusion: r.conclusion, attempt: r.run_attempt });
  }
  const current = read("actions/runs/" + runId);
  if (current.id !== Number(runId) || current.head_sha !== sha || current.event !== "workflow_dispatch" || current.run_attempt !== 1 ||
      current.head_branch !== "main" || current.path !== ".github/workflows/repair-startup.yml" || current.status !== "in_progress" ||
      current.repository?.full_name !== "fafona/space" || current.head_repository?.full_name !== "fafona/space") fail();
  for (const file of ["deploy.yml", "production-maintenance.yml", "database-migrate.yml", "database-backup.yml", "ordinary-account-cutover-readiness.yml",
    "recover-maintenance-candidate.yml", "restore-reclosed-candidate.yml", "repair-startup.yml", "repair-daemon.yml", "repair-unlaunched-transport.yml",
    "recover-failed-post-switch-deploy.yml", "recover-failed-pre-forward-deploy.yml", "revoke-legacy-browser-auth-sessions.yml",
    "legacy-personal-recovery-encrypted-config.yml"]) {
    let count = 0, complete = false;
    for (let page = 1; page <= 20; page++) {
      const value = read(`actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!Array.isArray(value.workflow_runs) || !Number.isSafeInteger(value.total_count)) fail();
      for (const r of value.workflow_runs) { validateStartupHistoryRun(r, runId); }
      count += value.workflow_runs.length;
      if (count === value.total_count) { complete = true; break; }
      if (!value.workflow_runs.length || count > value.total_count) fail();
    }
    if (!complete) fail();
  }
  return validateStartupRepairAuthority({ version: 2, kind: "faolla-startup-completion", targetSha: sha, runId, runAttempt: 1,
    operationId: P.operationId, failedRunId: C.failedRunId, previousAuthorityDigest:C.authorityDigest,expiresAt:C.expiresAt,
    mainCIrunId, historyDigest: hash(JSON.stringify(history)), checkedAt: now }, sha, runId, now);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, sha, runId, file, provenance] = process.argv.slice(2);
    if(action==="verify-prior"){
      const bytes=readFileSync(file);
      if(bytes.length>8192||hash(bytes)!==C.authorityDigest)fail();
      validateStartupProvenance(bytes,JSON.parse(readFileSync(provenance)));
      const a=JSON.parse(bytes);validateStartupRepairAuthority(a,C.sourceSha,C.failedRunId,a.checkedAt);
      if(a.checkedAt>=C.historicalAt||a.checkedAt<P.createdAt)fail();
    } else if (action === "authority") {
      readStartupRepairSource(sha);
      const value = startupMetadata(sha, runId);
      writeFileSync(file, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    } else if (action === "verify") {
      const bytes = readFileSync(file); if (bytes.length > 8192) fail();
      const value = validateStartupRepairAuthority(JSON.parse(bytes), sha, runId);
      validateStartupProvenance(bytes, JSON.parse(readFileSync(provenance)));
      const fresh = startupMetadata(sha, runId);
      if (fresh.historyDigest !== value.historyDigest || fresh.mainCIrunId !== value.mainCIrunId) fail();
    } else fail();
  } catch { process.stderr.write("startup_workflow_unverified\n"); process.exitCode = 1; }
}
