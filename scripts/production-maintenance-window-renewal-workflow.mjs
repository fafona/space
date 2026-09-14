import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenanceWindowRenewalInspection, validateMaintenanceWindowRenewalEvidence, encodeMaintenanceWindowRenewalEvidence,
  MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION as AUTHORIZATION,
  MAINTENANCE_WINDOW_RENEWAL_HISTORY_MAX_AGE_MS as MAX_AGE,
} from "./production-maintenance-window-renewal.mjs";

const REPOSITORY = "fafona/space", PRIOR = "3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_window_renewal_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact GitHub GET projections observed on 2026-09-14. These records are
// historical evidence only: B8 has NO maintenance binding and is NOT a usable
// deployment backup. No artifact archive, payload, log or credential is read.
export const MAINTENANCE_WINDOW_RENEWAL_PRIOR_RUNS = freeze([{"run":{"id":34826545330,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","event":"workflow_dispatch","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"failure","created_at":"2026-09-14T09:10:54Z","run_started_at":"2026-09-14T09:10:54Z","updated_at":"2026-09-14T10:58:45Z"},"jobs":[{"id":103919918312,"name":"backup","run_id":34826545330,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"failure","started_at":"2026-09-14T09:10:58Z","completed_at":"2026-09-14T10:58:45Z","steps":[[1,"Set up job","success","2026-09-14T09:10:59Z","2026-09-14T09:11:01Z"],[2,"Checkout Exact Backup Source","success","2026-09-14T09:11:01Z","2026-09-14T09:11:08Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-14T09:11:08Z","2026-09-14T09:11:10Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-14T09:11:10Z","2026-09-14T09:11:12Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-14T09:11:12Z","2026-09-14T09:11:15Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-14T09:11:15Z","2026-09-14T09:11:30Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-14T09:11:30Z","2026-09-14T09:11:31Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-14T09:11:31Z","2026-09-14T09:12:04Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-14T09:12:04Z","2026-09-14T09:12:18Z"],[10,"Transfer Complete Encrypted Backup","success","2026-09-14T09:12:18Z","2026-09-14T10:56:54Z"],[11,"Verify Encrypted Backup","success","2026-09-14T10:56:54Z","2026-09-14T10:56:59Z"],[12,"Rehearse Isolated Restore","success","2026-09-14T10:56:59Z","2026-09-14T10:58:22Z"],[13,"Confirm Backup Is Ready For Upload","success","2026-09-14T10:58:22Z","2026-09-14T10:58:23Z"],[14,"Upload Verified Encrypted Backup","success","2026-09-14T10:58:23Z","2026-09-14T10:58:28Z"],[15,"Verify Uploaded Backup Artifact Identity","success","2026-09-14T10:58:28Z","2026-09-14T10:58:29Z"],[16,"Generate Backup Attestation Predicate","success","2026-09-14T10:58:29Z","2026-09-14T10:58:29Z"],[17,"Upload Canonical Backup Attestation Input","success","2026-09-14T10:58:29Z","2026-09-14T10:58:31Z"],[18,"Upload Backup Verification And Attestation Inputs","success","2026-09-14T10:58:31Z","2026-09-14T10:58:32Z"],[19,"Attest Verified Encrypted Backup","success","2026-09-14T10:58:32Z","2026-09-14T10:58:34Z"],[20,"Attest Canonical Backup Attestation Input","success","2026-09-14T10:58:34Z","2026-09-14T10:58:36Z"],[21,"Upload Encrypted Backup Attestation Bundle","success","2026-09-14T10:58:36Z","2026-09-14T10:58:37Z"],[22,"Upload Canonical Backup Attestation Bundle","success","2026-09-14T10:58:37Z","2026-09-14T10:58:38Z"],[23,"Verify Held Maintenance Before Backup Attestation","failure","2026-09-14T10:58:38Z","2026-09-14T10:58:41Z"],[24,"Build Canonical Maintenance Binding","skipped","2026-09-14T10:58:41Z","2026-09-14T10:58:41Z"],[25,"Upload Canonical Maintenance Binding","skipped","2026-09-14T10:58:41Z","2026-09-14T10:58:41Z"],[26,"Attest Canonical Maintenance Binding","skipped","2026-09-14T10:58:41Z","2026-09-14T10:58:41Z"],[27,"Upload Backup Failure Diagnostics","success","2026-09-14T10:58:41Z","2026-09-14T10:58:42Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-14T10:58:42Z","2026-09-14T10:58:43Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-14T10:58:43Z","2026-09-14T10:58:43Z"],[57,"Complete job","success","2026-09-14T10:58:43Z","2026-09-14T10:58:43Z"]]}],"artifacts":[{"id":10344445094,"name":"faolla-encrypted-backup-attestation-bundle-34826545330-1","size_in_bytes":7623,"digest":"sha256:5743eff2be75467b8ee427aafa3fa3769a8c3d3bdfd3f03266e644d4d1a29018","expired":false,"created_at":"2026-09-14T10:58:37Z","updated_at":"2026-09-14T10:58:37Z","expires_at":"2026-09-21T10:58:36Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}},{"id":10344180498,"name":"faolla-backup-verification-reports-34826545330-1","size_in_bytes":8157,"digest":"sha256:f5f9a60d2791d3d6add58f8cf5c8b35a344e875904bb0e241f883559cf4e43ed","expired":false,"created_at":"2026-09-14T10:58:32Z","updated_at":"2026-09-14T10:58:32Z","expires_at":"2026-09-21T10:58:31Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}},{"id":10343478867,"name":"faolla-production-backup-attestation-34826545330-1","size_in_bytes":1064,"digest":"sha256:34fa4f498ddfd26d9c6ee53785782074c97510aac6bd9a446c8bc3dc40017d3a","expired":false,"created_at":"2026-09-14T10:58:30Z","updated_at":"2026-09-14T10:58:30Z","expires_at":"2026-09-21T10:58:30Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}},{"id":10343383891,"name":"faolla-production-backup-attestation-bundle-34826545330-1","size_in_bytes":6839,"digest":"sha256:0db6e0c8ae2eb1e6ab5bc5b4e6a589fd76940ad5bdadc6a4b98327b5c51cdca1","expired":false,"created_at":"2026-09-14T10:58:38Z","updated_at":"2026-09-14T10:58:38Z","expires_at":"2026-09-21T10:58:37Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}},{"id":10343199256,"name":"faolla-backup-failure-diagnostics-34826545330-1","size_in_bytes":9199,"digest":"sha256:22696fbce450dd3695621114d116b41d7c4cf809f97248a5fac7935abb9a63cb","expired":false,"created_at":"2026-09-14T10:58:42Z","updated_at":"2026-09-14T10:58:42Z","expires_at":"2026-09-21T10:58:41Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}},{"id":10342934932,"name":"faolla-encrypted-disaster-recovery-34826545330-1","size_in_bytes":505784526,"digest":"sha256:f3007e84f5d9e05240160d7f59036992ff420b16a7d90b1c4b876380353c2224","expired":false,"created_at":"2026-09-14T10:58:28Z","updated_at":"2026-09-14T10:58:28Z","expires_at":"2026-09-21T10:58:23Z","workflow_run":{"id":34826545330,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"}}]},{"run":{"id":34825984301,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","event":"workflow_dispatch","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T09:04:41Z","run_started_at":"2026-09-14T09:04:41Z","updated_at":"2026-09-14T09:07:29Z"},"jobs":[{"id":103918151765,"name":"maintenance","run_id":34825984301,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:04:45Z","completed_at":"2026-09-14T09:07:29Z","steps":[[1,"Set up job","success","2026-09-14T09:04:46Z","2026-09-14T09:04:46Z"],[2,"Validate Fixed Manual Transition","success","2026-09-14T09:04:46Z","2026-09-14T09:04:47Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-14T09:04:47Z","2026-09-14T09:04:51Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T09:04:51Z","2026-09-14T09:04:53Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T09:04:53Z","2026-09-14T09:04:53Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T09:04:53Z","2026-09-14T09:04:53Z"],[7,"Setup Pinned SSH Trust","success","2026-09-14T09:04:53Z","2026-09-14T09:04:53Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T09:04:53Z","2026-09-14T09:04:58Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T09:04:58Z","2026-09-14T09:04:58Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","success","2026-09-14T09:04:58Z","2026-09-14T09:05:07Z"],[27,"Verify Budget Recovery Historical Additional Backup","success","2026-09-14T09:05:07Z","2026-09-14T09:05:18Z"],[28,"Inspect Stopped Budget Candidate Recovery State","success","2026-09-14T09:05:18Z","2026-09-14T09:05:33Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","success","2026-09-14T09:05:33Z","2026-09-14T09:06:54Z"],[30,"Execute Fixed Maintenance Transition","success","2026-09-14T09:06:54Z","2026-09-14T09:07:24Z"],[31,"Verify Real Public Release After End","skipped","2026-09-14T09:07:24Z","2026-09-14T09:07:24Z"],[32,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T09:07:24Z","2026-09-14T09:07:24Z"],[33,"Remove Exact Temporary Control Source","success","2026-09-14T09:07:24Z","2026-09-14T09:07:26Z"],[34,"Remove Runner Recovery Inspection","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[35,"Remove Runner Continuation Evidence","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[36,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[37,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[38,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[39,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[40,"Remove Runner Budget Recovery Evidence","success","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[41,"Remove Runner SSH Material","success","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[82,"Post Checkout Exact Maintenance Source","success","2026-09-14T09:07:26Z","2026-09-14T09:07:26Z"],[83,"Complete job","success","2026-09-14T09:07:26Z","2026-09-14T09:07:27Z"]]}]},{"run":{"id":34824742841,"name":"CI","path":".github/workflows/ci.yml","event":"push","head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T08:50:10Z","run_started_at":"2026-09-14T08:50:10Z","updated_at":"2026-09-14T09:04:00Z"},"jobs":[{"id":103914151058,"name":"Isolated Maintenance Ingress Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T08:50:13Z","completed_at":"2026-09-14T08:50:51Z"},{"id":103914151309,"name":"Quality","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T08:50:13Z","completed_at":"2026-09-14T09:00:56Z"},{"id":103914151502,"name":"Isolated Supabase Scheduler Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T08:50:14Z","completed_at":"2026-09-14T08:52:05Z"},{"id":103917087855,"name":"Checkout Context PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:00:59Z","completed_at":"2026-09-14T09:01:53Z"},{"id":103917087893,"name":"Redemption PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:00:59Z","completed_at":"2026-09-14T09:01:44Z"},{"id":103917087899,"name":"QR Atomic PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:00:59Z","completed_at":"2026-09-14T09:01:29Z"},{"id":103917087901,"name":"Recovery Content PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:01:48Z","completed_at":"2026-09-14T09:02:23Z"},{"id":103917087906,"name":"Order Membership PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:00:58Z","completed_at":"2026-09-14T09:01:43Z"},{"id":103917087941,"name":"Enterprise Browser Journeys","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:00:59Z","completed_at":"2026-09-14T09:03:59Z"},{"id":103917087992,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34824742841,"head_sha":"3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0","status":"completed","conclusion":"success","started_at":"2026-09-14T09:01:00Z","completed_at":"2026-09-14T09:01:33Z"}]}]);
const [BACKUP, RECOVERY, PRIOR_CI] = MAINTENANCE_WINDOW_RENEWAL_PRIOR_RUNS;
const RUN_KEYS = Object.keys(BACKUP.run);
const JOB_KEYS = Object.keys(BACKUP.jobs[0]).filter(key => key !== "steps");
const ARTIFACT_KEYS = Object.keys(BACKUP.artifacts[0]);
const WORKFLOWS = freeze([
  ["database-backup.yml", "Encrypted Database Backup"],
  ["database-migrate.yml", "Apply Production Database Migrations"],
  ["ordinary-account-cutover-readiness.yml", "Ordinary Account Cutover Readiness"],
  ["deploy.yml", "Deploy Production"],
  ["production-maintenance.yml", "Production Maintenance"],
]);
const CI_NAMES = PRIOR_CI.jobs.map(job => job.name).sort();
// The prior state contains its full immutable earlier audit. We chain from its
// actual successful recovery, never erase/reinterpret earlier history or use an
// expired authorization clock. Older runs updated/retried after this anchor are
// still detected because every page is enumerated without a created-date filter.
const CUTOFF = Date.parse(RECOVERY.run.created_at);
const id = value => { const result = String(value); if (!ID.test(result) || !Number.isSafeInteger(Number(result))) fail(); return result; };
const timestamp = value => { if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail(); const time = Date.parse(value); if (!Number.isSafeInteger(time)) fail(); return time; };
function clock(now) { if (!Number.isSafeInteger(now) || now < AUTHORIZATION.authorizedAt || now >= AUTHORIZATION.expiresAt) fail(); }
function observationTime(startedAt, observedClock) {
  if (typeof observedClock !== "function") fail();
  const observedAt = observedClock(); clock(observedAt);
  if (observedAt < startedAt || observedAt - startedAt > MAX_AGE) fail();
  return observedAt;
}
function orderedClock(startedAt, source) {
  if (typeof source !== "function") fail();
  let previous = startedAt;
  return () => { const observed = observationTime(startedAt, source); if (observed < previous) fail(); previous = observed; return observed; };
}
function project(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const out = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(); out[key] = descriptor.value; }
  return out;
}
function runProjection(run) {
  if (run?.repository?.full_name !== REPOSITORY || run?.head_repository?.full_name !== REPOSITORY) fail();
  return project(run, RUN_KEYS);
}
function jobProjection(job, steps) {
  const out = project(job, JOB_KEYS);
  if (steps) {
    if (!Array.isArray(job.steps) || job.steps.length > 100 || job.steps.some(step => step.status !== "completed")) fail();
    out.steps = job.steps.map(step => [step.number, step.name, step.conclusion, step.started_at, step.completed_at]);
  }
  return out;
}
async function fixedRun(spec, api) {
  const run = runProjection(await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}`));
  if (hash(run) !== hash(spec.run)) fail();
  const data = await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}/attempts/1/jobs?per_page=100`);
  if (data?.total_count !== spec.jobs.length || !Array.isArray(data.jobs) || data.jobs.length !== spec.jobs.length) fail();
  const jobs = data.jobs.map(job => jobProjection(job, Boolean(spec.jobs[0].steps))).sort((a, b) => a.id - b.id);
  if (hash(jobs) !== hash([...spec.jobs].sort((a, b) => a.id - b.id))) fail();
  let artifacts;
  if (spec.artifacts) {
    const data = await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}/artifacts?per_page=100`);
    if (data?.total_count !== 6 || !Array.isArray(data.artifacts) || data.artifacts.length !== 6) fail();
    artifacts = data.artifacts.map(value => project(value, ARTIFACT_KEYS)).sort((a, b) => a.id - b.id);
    if (hash(artifacts) !== hash([...spec.artifacts].sort((a, b) => a.id - b.id))) fail();
  }
  return { run, jobs, ...(artifacts ? { artifacts } : {}) };
}
function checkCurrent(run, checked, currentRunId, now) {
  const value = runProjection(run);
  if (id(value.id) !== currentRunId || value.name !== "Production Maintenance" || value.path !== ".github/workflows/production-maintenance.yml" ||
      value.event !== "workflow_dispatch" || value.head_branch !== "main" || value.head_sha !== checked.targetSha ||
      value.run_attempt !== 1 || value.status !== "in_progress" || value.conclusion !== null) fail();
  const created = timestamp(value.created_at), started = timestamp(value.run_started_at), updated = timestamp(value.updated_at);
  if (created < AUTHORIZATION.authorizedAt || started < created || updated < started || updated > now) fail();
  // The current step's updated_at may advance legitimately. No terminal or
  // attempt/generation change is ignored; all other current identity is bound.
  return project(value, RUN_KEYS.filter(key => key !== "updated_at"));
}
async function scan(checked, api, now, currentRunId, observedClock) {
  const rows = [];
  let foundBackup = false, foundRecovery = false, foundCurrent = false;
  for (const [file, name] of WORKFLOWS) {
    const seen = new Set(); let total = null, ended = false;
    for (let page = 1; page <= 20; page++) {
      const data = await api(`repos/${REPOSITORY}/actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || data.total_count > 2000 ||
          !Array.isArray(data.workflow_runs) || data.workflow_runs.length > 100) fail();
      if (total === null) total = data.total_count;
      if (total !== data.total_count) fail();
      for (const raw of data.workflow_runs) {
        const run = runProjection(raw), runId = id(run.id);
        if (seen.has(runId) || run.name !== name || run.path !== ".github/workflows/" + file ||
            run.head_branch !== "main" || !SHA.test(run.head_sha ?? "")) fail();
        seen.add(runId);
        if (runId === currentRunId) {
          if (file !== "production-maintenance.yml" || foundCurrent) fail();
          rows.push({ file, run: checkCurrent(raw, checked, currentRunId, observationTime(now, observedClock)) }); foundCurrent = true; continue;
        }
        const created = timestamp(run.created_at), started = run.run_started_at === null ? created : timestamp(run.run_started_at), updated = timestamp(run.updated_at);
        if (created > started || started > updated || updated > now || run.status !== "completed" ||
            !["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure"].includes(run.conclusion)) fail();
        id(run.run_attempt);
        const expected = [BACKUP, RECOVERY].find(spec => String(spec.run.id) === runId);
        if (expected) {
          if (hash(run) !== hash(expected.run)) fail();
          if (expected === BACKUP) foundBackup = true; else foundRecovery = true;
        } else if (Math.max(created, started, updated) >= CUTOFF) fail();
        rows.push({ file, run });
      }
      if (data.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended) fail();
  }
  if (!foundBackup || !foundRecovery || !foundCurrent) fail();
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.run.id - b.run.id);
}
export async function inspectMaintenanceWindowRenewalHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenanceWindowRenewalInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || [BACKUP, RECOVERY, PRIOR_CI].some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_WINDOW_RENEWAL_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_WINDOW_RENEWAL_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "window-renewal-only",
    failedBackupPurpose: "historical-failure-not-valid-backup", rows: first, records };
}
async function currentCI(checked, api, now) {
  const data = await api(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&head_sha=${checked.targetSha}&per_page=100`);
  if (!Array.isArray(data?.workflow_runs) || data.total_count !== data.workflow_runs.length || data.workflow_runs.length !== 1) fail();
  const run = runProjection(data.workflow_runs[0]);
  if (run.name !== "CI" || run.path !== ".github/workflows/ci.yml" || run.event !== "push" || run.head_branch !== "main" ||
      run.head_sha !== checked.targetSha || run.run_attempt !== 1 || run.status !== "completed" || run.conclusion !== "success" ||
      timestamp(run.created_at) < AUTHORIZATION.authorizedAt || timestamp(run.run_started_at) < timestamp(run.created_at) ||
      timestamp(run.updated_at) < timestamp(run.run_started_at) || timestamp(run.updated_at) > now) fail();
  const runId = id(run.id), jobs = await api(`repos/${REPOSITORY}/actions/runs/${runId}/attempts/1/jobs?per_page=100`);
  if (jobs?.total_count !== 10 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 10) fail();
  const projected = jobs.jobs.map(job => jobProjection(job, false)).sort((a, b) => a.id - b.id);
  if (new Set(projected.map(job => id(job.id))).size !== 10 || hash(projected.map(job => job.name).sort()) !== hash(CI_NAMES) ||
      projected.some(job => job.run_id !== run.id || job.head_sha !== checked.targetSha || job.status !== "completed" || job.conclusion !== "success" ||
        timestamp(job.started_at) < timestamp(run.run_started_at) || timestamp(job.completed_at) < timestamp(job.started_at) ||
        timestamp(job.completed_at) > timestamp(run.updated_at))) fail();
  return { run, jobs: projected };
}
export async function createMaintenanceWindowRenewalWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenanceWindowRenewalInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== PRIOR || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      env.ACTION !== "renew-window" || env.CONFIRMATION !== "RENEW_PRODUCTION_MAINTENANCE_UNTIL_20260914T160000Z") fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenanceWindowRenewalHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
  const current = checkCurrent(await api(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`), checked, env.GITHUB_RUN_ID, observationTime(now, observedClock));
  if (hash(current) !== hash(history.rows.find(row => String(row.run.id) === env.GITHUB_RUN_ID)?.run)) fail();
  if (timestamp(current.created_at) < timestamp(ci.run.updated_at)) fail();
  if (hash(await currentCI(checked, api, now)) !== hash(ci) || (await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const completedAt = observationTime(now, observedClock);
  if (completedAt - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  return validateMaintenanceWindowRenewalEvidence({ ...checked, toolsSha: checked.targetSha,
    windowRenewalRunId: env.GITHUB_RUN_ID, windowRenewalRunAttempt: 1, mainCIrunId: String(ci.run.id),
    historyDigest: hash({ history, ci, current }), historyCheckedAt: now });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "linux" || process.argv.length !== 4 || process.argv[2] !== "--inspection" ||
        !process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) fail();
    const stat = lstatSync(process.argv[3]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 16384 || (stat.mode & 0o022)) fail();
    const bytes = readFileSync(process.argv[3]); if (bytes.length !== stat.size) fail();
    const inspection = JSON.parse(bytes);
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
    const evidence = await createMaintenanceWindowRenewalWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenanceWindowRenewalEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `window_renewal_evidence=${encoded}\n`);
    process.stdout.write("maintenance_window_renewal_history_verified\n");
  } catch { process.stderr.write("maintenance_window_renewal_workflow_unverified\n"); process.exitCode = 1; }
}
