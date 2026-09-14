import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenanceLeaseInspection, validateMaintenanceLeaseEvidence, encodeMaintenanceLeaseEvidence,
  MAINTENANCE_LEASE_AUTHORIZATION as AUTHORIZATION,
} from "./production-maintenance-lease.mjs";

const MAX_AGE = 300000;
const REPOSITORY = "fafona/space", PRIOR = "3614f5bfc85cf72d064732141a9998a0bbaec513";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_lease_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact GitHub GET projections observed on 2026-09-14: cancelled B11,
// successful recovery11 and CI12. Cancellation is never a valid backup.
// No payload, archive or log is read. The fixed raw predecessor proves the
// unused launch journal independently; GitHub metadata alone does not prove it.
export const MAINTENANCE_LEASE_PRIOR_RUNS = freeze([{"run":{"id":34886165604,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","event":"workflow_dispatch","head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"cancelled","created_at":"2026-09-14T19:19:15Z","run_started_at":"2026-09-14T19:19:15Z","updated_at":"2026-09-14T20:03:43Z"},"jobs":[{"id":104117250156,"name":"backup","run_id":34886165604,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"cancelled","started_at":"2026-09-14T19:19:18Z","completed_at":"2026-09-14T20:03:42Z","steps":[[1,"Set up job","success","2026-09-14T19:19:19Z","2026-09-14T19:19:21Z"],[2,"Checkout Exact Backup Source","success","2026-09-14T19:19:21Z","2026-09-14T19:19:28Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-14T19:19:28Z","2026-09-14T19:19:30Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-14T19:19:30Z","2026-09-14T19:19:32Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-14T19:19:32Z","2026-09-14T19:19:34Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-14T19:19:34Z","2026-09-14T19:19:51Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-14T19:19:51Z","2026-09-14T19:19:53Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-14T19:19:53Z","2026-09-14T19:20:22Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-14T19:20:22Z","2026-09-14T19:20:38Z"],[10,"Transfer Complete Encrypted Backup","cancelled","2026-09-14T19:20:38Z","2026-09-14T20:03:18Z"],[11,"Verify Encrypted Backup","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[12,"Rehearse Isolated Restore","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[13,"Confirm Backup Is Ready For Upload","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[14,"Upload Verified Encrypted Backup","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[15,"Verify Uploaded Backup Artifact Identity","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[16,"Generate Backup Attestation Predicate","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[17,"Upload Canonical Backup Attestation Input","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[18,"Upload Backup Verification And Attestation Inputs","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[19,"Attest Verified Encrypted Backup","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[20,"Attest Canonical Backup Attestation Input","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[21,"Upload Encrypted Backup Attestation Bundle","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[22,"Upload Canonical Backup Attestation Bundle","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[23,"Verify Held Maintenance Before Backup Attestation","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[24,"Build Canonical Maintenance Binding","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[25,"Upload Canonical Maintenance Binding","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[26,"Attest Canonical Maintenance Binding","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[27,"Upload Backup Failure Diagnostics","skipped","2026-09-14T20:03:18Z","2026-09-14T20:03:18Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-14T20:03:18Z","2026-09-14T20:03:40Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-14T20:03:40Z","2026-09-14T20:03:40Z"],[57,"Complete job","success","2026-09-14T20:03:40Z","2026-09-14T20:03:41Z"]]}],"artifacts":[]},{"run":{"id":34885715614,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","event":"workflow_dispatch","head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T19:14:49Z","run_started_at":"2026-09-14T19:14:49Z","updated_at":"2026-09-14T19:18:17Z"},"jobs":[{"id":104115755691,"name":"maintenance","run_id":34885715614,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:14:53Z","completed_at":"2026-09-14T19:18:17Z","steps":[[1,"Set up job","success","2026-09-14T19:14:53Z","2026-09-14T19:14:54Z"],[2,"Validate Fixed Manual Transition","success","2026-09-14T19:14:54Z","2026-09-14T19:14:54Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-14T19:14:54Z","2026-09-14T19:14:59Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T19:14:59Z","2026-09-14T19:15:01Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T19:15:01Z","2026-09-14T19:15:01Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T19:15:01Z","2026-09-14T19:15:01Z"],[7,"Setup Pinned SSH Trust","success","2026-09-14T19:15:01Z","2026-09-14T19:15:01Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T19:15:01Z","2026-09-14T19:15:05Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[27,"Verify Budget Recovery Historical Additional Backup","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[28,"Inspect Stopped Budget Candidate Recovery State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[30,"Inspect Unused Window Renewal State","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[31,"Verify Exact Window Renewal History Under Production Lock","skipped","2026-09-14T19:15:05Z","2026-09-14T19:15:05Z"],[32,"Inspect Failed Unlaunched Preflight Recovery State","success","2026-09-14T19:15:05Z","2026-09-14T19:15:26Z"],[33,"Verify Exact Preflight Recovery History Under Production Lock","success","2026-09-14T19:15:26Z","2026-09-14T19:17:33Z"],[34,"Inspect Failed Unlaunched Prelaunch Recovery State","skipped","2026-09-14T19:17:33Z","2026-09-14T19:17:33Z"],[35,"Verify Exact Prelaunch Recovery History Under Production Lock","skipped","2026-09-14T19:17:33Z","2026-09-14T19:17:33Z"],[36,"Execute Fixed Maintenance Transition","success","2026-09-14T19:17:33Z","2026-09-14T19:18:13Z"],[37,"Verify Real Public Release After End","skipped","2026-09-14T19:18:13Z","2026-09-14T19:18:13Z"],[38,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T19:18:13Z","2026-09-14T19:18:13Z"],[39,"Remove Exact Temporary Control Source","success","2026-09-14T19:18:13Z","2026-09-14T19:18:15Z"],[40,"Remove Runner Recovery Inspection","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[41,"Remove Runner Continuation Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[42,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[43,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[44,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[45,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[46,"Remove Runner Budget Recovery Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[47,"Remove Runner Window Renewal Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[48,"Remove Runner Preflight Recovery Evidence","success","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[49,"Remove Runner Prelaunch Recovery Evidence","skipped","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[50,"Remove Runner SSH Material","success","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[100,"Post Checkout Exact Maintenance Source","success","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"],[101,"Complete job","success","2026-09-14T19:18:15Z","2026-09-14T19:18:15Z"]]}],"artifacts":[]},{"run":{"id":34882604766,"name":"CI","path":".github/workflows/ci.yml","event":"push","head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T18:44:06Z","run_started_at":"2026-09-14T18:44:06Z","updated_at":"2026-09-14T19:12:34Z"},"jobs":[{"id":104105305914,"name":"Isolated Maintenance Ingress Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T18:44:10Z","completed_at":"2026-09-14T18:44:55Z"},{"id":104105306069,"name":"Quality","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T18:44:08Z","completed_at":"2026-09-14T19:09:31Z"},{"id":104105306122,"name":"Isolated Supabase Scheduler Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T18:44:09Z","completed_at":"2026-09-14T18:45:55Z"},{"id":104113947606,"name":"QR Atomic PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:03Z"},{"id":104113947608,"name":"Checkout Context PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:28Z"},{"id":104113947619,"name":"Recovery Content PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:08Z"},{"id":104113947650,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:03Z"},{"id":104113947657,"name":"Redemption PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:18Z"},{"id":104113947683,"name":"Enterprise Browser Journeys","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:12:33Z"},{"id":104113947706,"name":"Order Membership PostgreSQL Acceptance","run_id":34882604766,"head_sha":"3614f5bfc85cf72d064732141a9998a0bbaec513","status":"completed","conclusion":"success","started_at":"2026-09-14T19:09:34Z","completed_at":"2026-09-14T19:10:17Z"}],"artifacts":[]}]);
const [BACKUP, RECOVERY, PRIOR_CI] = MAINTENANCE_LEASE_PRIOR_RUNS;
const RUN_KEYS = Object.keys(BACKUP.run);
const JOB_KEYS = Object.keys(BACKUP.jobs[0]).filter(key => key !== "steps");
const ARTIFACT_KEYS = ["id","name","size_in_bytes","expired","created_at","updated_at","expires_at","digest","workflow_run"];
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
function clock(now) { if (!Number.isSafeInteger(now) || now < AUTHORIZATION.authorizedAt) fail(); }
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
    if (data?.total_count !== spec.artifacts.length || !Array.isArray(data.artifacts) || data.artifacts.length !== spec.artifacts.length) fail();
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
  const foundFixed = new Set(); let foundCurrent = false;
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
          foundFixed.add(runId);
        } else if (Math.max(created, started, updated) >= CUTOFF &&
          !(run.head_sha === checked.targetSha && ["database-backup.yml", "production-maintenance.yml"].includes(file))) fail();
        rows.push({ file, run });
      }
      if (data.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended) fail();
  }
  if (foundFixed.size !== 2 || !foundCurrent) fail();
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.run.id - b.run.id);
}
export async function inspectMaintenanceLeaseHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || MAINTENANCE_LEASE_PRIOR_RUNS.some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_LEASE_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_LEASE_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "lease-only",
    cancelledBackupPurpose: "unfinished-transfer-not-a-valid-backup", rows: first, records };
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
export async function createMaintenanceLeaseWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== PRIOR || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      env.ACTION !== "renew-lease" || env.CONFIRMATION !== "RENEW_PRODUCTION_MAINTENANCE_LEASE") fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenanceLeaseHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
  const current = checkCurrent(await api(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`), checked, env.GITHUB_RUN_ID, observationTime(now, observedClock));
  if (hash(current) !== hash(history.rows.find(row => String(row.run.id) === env.GITHUB_RUN_ID)?.run)) fail();
  if (timestamp(current.created_at) < timestamp(ci.run.updated_at)) fail();
  if (hash(await currentCI(checked, api, now)) !== hash(ci) || (await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const completedAt = observationTime(now, observedClock);
  if (completedAt - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  return validateMaintenanceLeaseEvidence({ ...checked, toolsSha: checked.targetSha,
    leaseRunId: env.GITHUB_RUN_ID, leaseRunAttempt: 1, mainCIrunId: String(ci.run.id),
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
    const evidence = await createMaintenanceLeaseWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenanceLeaseEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `lease_evidence=${encoded}\n`);
    process.stdout.write("maintenance_lease_history_verified\n");
  } catch { process.stderr.write("maintenance_lease_workflow_unverified\n"); process.exitCode = 1; }
}
