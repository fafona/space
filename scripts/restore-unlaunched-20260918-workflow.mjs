import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RESTORATION_TARGET as P, validateRestorationReceipt } from "./restore-unlaunched-20260918.mjs";
import { validateProductionReleaseAttestation } from "./production-release-attestation.mjs";


const fail = () => { throw new Error("candidate_recovery_workflow_unverified"); };
export const RECOVERY_SOURCE_PATHS = Object.freeze([
  ".github/workflows/restore-unlaunched-20260918.yml",
  "scripts/restore-unlaunched-20260918.mjs", "scripts/restore-unlaunched-20260918-workflow.mjs",
  "scripts/production-maintenance-unlaunched-20260918.test.mjs",
  "scripts/restore-unlaunched-20260918-artifacts.mjs",
  "scripts/production-maintenance-daemon-continuity.mjs", "scripts/production-maintenance-daemon-continuity.test.mjs",
  "scripts/production-maintenance-runtime.mjs", "scripts/production-maintenance-pm2-adapter.mjs",
  "scripts/production-maintenance-runtime.test.mjs", "scripts/production-maintenance-pm2-adapter.test.mjs",
]);
export function validateRecoveryRun(value, expected) {
  if (!value || value.id !== Number(expected.id) || value.run_attempt !== 1 || value.head_sha !== expected.sha || value.head_branch !== "main" ||
    value.event !== expected.event || value.name !== expected.name || value.path !== ".github/workflows/" + expected.file ||
    value.status !== "completed" || value.conclusion !== expected.conclusion || value.repository?.full_name !== "fafona/space" ||
    value.head_repository?.full_name !== "fafona/space") fail();
  return true;
}
function run(file, args) {
  const r = spawnSync(file, args, { encoding: "utf8", timeout: 60000, maxBuffer: 8388608, windowsHide: true });
  if (r.status !== 0 || r.error || r.signal) fail(); return r.stdout;
}
const api = path => JSON.parse(run("gh", ["api", "repos/fafona/space/" + path]));
const CI = ["Checkout Context PostgreSQL Acceptance", "Enterprise Browser Journeys", "Isolated Maintenance Ingress Acceptance",
  "Isolated Supabase Scheduler Acceptance", "Order Membership PostgreSQL Acceptance", "Pages Client Write ACL PostgreSQL Acceptance",
  "QR Atomic PostgreSQL Acceptance", "Quality", "Recovery Content PostgreSQL Acceptance", "Redemption PostgreSQL Acceptance"].sort();
function checkCi(id, sha) {
  validateRecoveryRun(api("actions/runs/" + id), { id, sha, event: "push", name: "CI", file: "ci.yml", conclusion: "success" });
  const result = api(`actions/runs/${id}/jobs?per_page=100`);
  if (result.total_count !== 10 || result.jobs.length !== 10 || result.jobs.map(j => j.name).sort().join() !== CI.join() ||
    result.jobs.some(j => j.status !== "completed" || j.conclusion !== "success" || j.head_sha !== sha)) fail();
}
export function validateRecoveryProvenance(receiptBytes, results) {
  const subjects = results?.[0]?.verificationResult?.statement?.subject;
  if (!Array.isArray(results) || results.length !== 1 || !Array.isArray(subjects) || subjects.length !== 1 ||
    subjects[0].name !== "candidate-verification.json" || subjects[0].digest?.sha256 !== createHash("sha256").update(receiptBytes).digest("hex")) fail();
}
function originalPredicate(phase, runId, file, provenance) {
  if (!["backup", "readiness"].includes(phase) || runId !== (phase === "backup" ? P.backupRunId : P.readinessRunId)) fail();
  const bytes = readFileSync(file), expectedHash = phase === "backup"
    ? "049dcce8346b400f2ce5bb53dbfed6fe162d01cd1109dd7720db475d21df19ea"
    : "2ab6a6bf68cc2232a9e90671a79f6da8e97dba665d03a80d42728b530f20453c";
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) fail();
  // Readiness's short-lived grant is NOT renewed. Its exact signed bytes only
  // supply the expected baseline for the mandatory new host-side SQL check.
  const parsed = JSON.parse(bytes);
  const checked = validateProductionReleaseAttestation(parsed, { nowMs: phase === "readiness" ? Date.parse(parsed.issuedAt) : Date.now(), expectedKind: phase,
    expectedRepository: "fafona/space", expectedTargetSha: P.targetSha, expectedRunId: runId, expectedRunAttempt: "1" });
  if (!checked.valid || !bytes.equals(checked.canonicalBytes)) fail();
  const proofs = JSON.parse(readFileSync(provenance)), subjects = proofs?.[0]?.verificationResult?.statement?.subject;
  if (!Array.isArray(proofs) || proofs.length !== 1 || subjects?.length !== 1 || subjects[0].name !== `production-${phase}-attestation.json` ||
    subjects[0].digest?.sha256 !== expectedHash) fail();
  if (phase === "backup") {
    const expected = checked.attestation.backupArtifact;
    const inventory = api(`actions/runs/${runId}/artifacts?per_page=100`);
    const artifacts = inventory.artifacts.filter(a => String(a.id) === expected.id);
    if (artifacts.length !== 1 || artifacts[0].expired || artifacts[0].name !== expected.name || artifacts[0].digest !== expected.digest ||
      String(artifacts[0].size_in_bytes) !== expected.sizeBytes || artifacts[0].workflow_run?.head_sha !== P.targetSha) fail();
  }
}
function metadata(sha, runId, restoration = false) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]{0,15}$/.test(runId) || process.env.GITHUB_REPOSITORY !== "fafona/space" ||
    process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_RUN_ATTEMPT !== "1" || process.env.GITHUB_SHA !== sha || process.env.GITHUB_RUN_ID !== runId ||
    api("git/ref/heads/main").object.sha !== sha) fail();
  run("git", ["merge-base", "--is-ancestor", P.targetSha, sha]);
  const changed = run("git", ["diff", "--name-only", "--no-renames", P.targetSha, sha]).trim().split("\n");
  if (run("git", ["diff", "--name-only", P.expectedOldSha, P.targetSha, "--", "supabase/migrations"]).trim()) fail();
  if (changed.some(path => !RECOVERY_SOURCE_PATHS.includes(path))) fail();
  const cis = api(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  if (cis.total_count !== 1 || cis.workflow_runs.length !== 1) fail();
  checkCi(cis.workflow_runs[0].id, sha); checkCi("35268238628", P.targetSha);
  const history = [[P.backupRunId, "Encrypted Database Backup", "database-backup.yml", "workflow_dispatch", "success"],
    [P.readinessRunId, "Ordinary Account Cutover Readiness", "ordinary-account-cutover-readiness.yml", "workflow_dispatch", "success"],
    [P.deployRunId, "Deploy Production", "deploy.yml", "workflow_run", "failure"]];
  for (const [id, name, file, event, conclusion] of history) {
    validateRecoveryRun(api("actions/runs/" + id), { id, name, file, event, conclusion, sha: P.targetSha });
    const jobs = api(`actions/runs/${id}/jobs?per_page=100`);
    if (jobs.total_count !== 1 || jobs.jobs.length !== 1 || jobs.jobs[0].conclusion !== conclusion) fail();
    const failed = jobs.jobs[0].steps.filter(s => s.conclusion === "failure");
    if (conclusion === "success" ? failed.length !== 0 : failed.length !== 1 || failed[0].name !== "Deploy To Server") fail();
    if (id === P.backupRunId && !jobs.jobs[0].steps.some(s => s.name === "Rehearse Isolated Restore" && s.conclusion === "success")) fail();
  }
  const current = api("actions/runs/" + runId);
  if (current.head_sha !== sha || current.event !== "workflow_dispatch" || current.run_attempt !== 1 || current.head_branch !== "main" ||
    current.path !== (restoration ? ".github/workflows/restore-unlaunched-20260918.yml" : ".github/workflows/recover-maintenance-candidate.yml") ||
    current.name !== (restoration ? "Complete Unlaunched Release 20260918" : "Production Maintenance")) fail();
  for (const file of ["deploy.yml", "production-maintenance.yml", "database-migrate.yml", "database-backup.yml", "ordinary-account-cutover-readiness.yml", "production-maintenance.yml", ...(restoration ? ["restore-unlaunched-20260918.yml"] : [])]) {
    const runs = api(`actions/workflows/${file}/runs?per_page=100`);
    if (runs.workflow_runs.some(r => String(r.id) !== runId && r.status !== "completed")) fail();
  }
  if (Date.now() >= P.expiresAt - 1200000) fail();
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, sha, runId, receiptFile, provenanceFile] = process.argv.slice(2);
    if (action === "metadata") metadata(sha, runId);
    else if (action === "restoration-metadata") metadata(sha, runId, true);
    else if (action === "original-predicate") originalPredicate(sha, runId, receiptFile, provenanceFile);
    else if (action === "signed-restoration") {
      const bytes = readFileSync(receiptFile); if (bytes.length > 4096) fail();
      validateRestorationReceipt(JSON.parse(bytes), sha, runId);
      const results = JSON.parse(readFileSync(provenanceFile)), subjects = results?.[0]?.verificationResult?.statement?.subject;
      if (!Array.isArray(results) || results.length !== 1 || subjects?.length !== 1 || subjects[0].name !== "restoration-receipt.json" || subjects[0].digest?.sha256 !== createHash("sha256").update(bytes).digest("hex")) fail();
    } else fail();
  } catch { process.stderr.write("candidate_recovery_workflow_unverified\n"); process.exitCode = 1; }
}
