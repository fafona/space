// One incident-specific continuation: verify the already launched T17 without
// replaying deploy, migrations, launch slots, or rewriting its failed GH run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const CANDIDATE_RECOVERY = Object.freeze({
  targetSha: "a06a5921e2fad5797e58304b828dfcf16b7ec43b",
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  stateDigest: "3d22b3b08687e9c4e0b7a09447f098ee09f391068ac4853ef76284f2e277aa76",
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  release: "/www/wwwroot/merchant-space.releases/a06a5921e2fa-20260916054114",
  appDir: "/www/wwwroot/merchant-space", appName: "merchant-space", appPort: 3000,
  failedDeployRunId: "35060368701", backupRunId: "35056280602", readinessRunId: "35060275125",
  expiresAt: Date.parse("2026-09-16T15:16:24.758Z"),
});
const P = CANDIDATE_RECOVERY, SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,15}$/;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw new Error("candidate_recovery_" + code); };
export const RECOVERY_CHECKS = Object.freeze(["source", "candidate", "handoff", "environment", "readiness", "booking", "smoke", "nginx", "candidateAfter", "stateUnchanged"]);
export function validateCandidateRecoveryReceipt(value, recoverySha, runId, now = Date.now()) {
  const keys = ["version", "kind", "targetSha", "expectedOldSha", "operationId", "stateDigest", "recoverySha", "runId", "runAttempt", "failedDeployRunId", "backupRunId", "readinessRunId", "checkedAt", "validUntil", "checks"];
  if (!value || Object.keys(value).sort().join() !== keys.sort().join() || value.version !== 1 || value.kind !== "faolla-existing-candidate-verification" ||
    !SHA.test(recoverySha) || !ID.test(runId) || value.recoverySha !== recoverySha || value.runId !== runId || value.runAttempt !== "1" ||
    ["targetSha", "expectedOldSha", "operationId", "stateDigest", "failedDeployRunId", "backupRunId", "readinessRunId"].some(k => value[k] !== P[k]) ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(value.checkedAt) || !Number.isSafeInteger(value.validUntil) ||
    value.checkedAt > now || now >= value.validUntil || value.validUntil > P.expiresAt || value.validUntil !== Math.min(value.checkedAt + 1800000, P.expiresAt) ||
    !isDeepStrictEqual(value.checks, RECOVERY_CHECKS)) fail("receipt_invalid");
  return value;
}
export function extractRecoveryShellFunction(source, name) {
  if (!["run_local_release_smoke", "verify_nginx_release_static_access", "verify_booking_persistence"].includes(name)) fail("shell_function_invalid");
  const start = source.indexOf(name + "() {"); if (start < 0) fail("shell_function_missing");
  const lines = source.slice(start).replaceAll("\r\n", "\n").split("\n"), out = []; let heredoc = null;
  for (const line of lines) { out.push(line); if (heredoc) { if (line === heredoc) heredoc = null; continue; }
    heredoc = line.match(/<<['"]?([A-Z_]+)['"]?/)?.[1] ?? null;
    if (!heredoc && line === "}") return out.join("\n"); }
  fail("shell_function_invalid");
}
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 180000, maxBuffer: 1048576,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" }, ...options });
  if (result.status !== 0 || result.signal || result.error) fail("command_failed");
  return result;
}
export function validateControllerDiagnostics(stderr) {
  if (typeof stderr !== "string" || stderr.length > 32768) fail("controller_stderr");
  const stages = "controller_ingress|controller_stopped|controller_start|controller_verify|controller_save|controller_accept|runtime_disk|runtime_stopped|runtime_launch|runtime_settle|launch_identity|launch_supervision|candidate_capture|launch_confirm";
  const line = new RegExp(`^\\[deploy\\] maintenance_start_diagnostic stage=(${stages}) code=(start|passed) elapsed_seconds=(0|[1-9][0-9]{0,4})$`);
  for (const value of stderr.split("\n").filter(Boolean)) {
    const match = value.match(line);
    if (!match || Number(match[3]) > 86400) fail("controller_stderr");
  }
}
function controller(action) {
  if (!["check-candidate", "end", "fail-held"].includes(action)) fail("action_invalid");
  const r = command("/usr/bin/node", [P.appDir + "/scripts/production-maintenance-control.mjs", action,
    "--app-dir", P.appDir, "--app-name", P.appName, "--app-port", String(P.appPort), "--target-sha", P.targetSha,
    "--expected-old-sha", P.expectedOldSha, "--expected-operation-id", P.operationId, "--json"], { timeout: action === "end" ? 900000 : 180000 });
  validateControllerDiagnostics(r.stderr);
  const report = JSON.parse(r.stdout);
  if (!isDeepStrictEqual(report, { version: 1, operationId: P.operationId, targetSha: P.targetSha, expectedOldSha: P.expectedOldSha,
    state: action === "end" ? "ended" : action === "fail-held" ? "failed-held" : "candidate" })) fail("controller_report");
  return report;
}
function fixedState() {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("host_authority");
  const bytes = readFileSync("/var/lib/faolla-maintenance/merchant-space/state.json"), state = JSON.parse(bytes);
  if (hash(bytes) !== P.stateDigest || bytes.length !== 2641234 || state.version !== 14 || state.revision !== 58 || state.phase !== "candidate" ||
    state.targetSha !== P.targetSha || state.operationId !== P.operationId || state.activeAttempt !== 4 ||
    state.bootId !== P.bootId || readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== P.bootId ||
    state.startupRecovery.expiresAt !== P.expiresAt || Date.now() >= P.expiresAt - 1200000 ||
    state.launchJournal.slots["paused-web"]?.phase !== "confirmed" || state.launchJournal.slots["resumed-web"] !== null ||
    state.launchJournal.slots.worker !== null || state.resumed !== null || state.finalDump !== null ||
    readlinkSync(P.appDir + ".current") !== P.release) fail("state_changed");
  return { bytes, state };
}
function shellGate(source, name) {
  const script = `set -euo pipefail
APP_DIR=${P.appDir}
CURRENT_LINK=${P.appDir}.current
RELEASE_DIR=${P.release}
APP_PORT=3000
FAOLLA_WEB_BUILD_ID=${P.targetSha}
CANDIDATE_FAOLLA_CANONICAL_PORTAL_ORIGIN=https://launch.faolla.com
RELEASE_SMOKE_ORIGIN=http://127.0.0.1:3000
RELEASE_SMOKE_PATHS=/,/login,/10909094,/admin,/enterprise/login
RELEASE_SMOKE_ATTEMPTS=3
RELEASE_SMOKE_DELAY_MS=1000
RELEASE_SMOKE_TIMEOUT_MS=12000
RELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS=180
NGINX_RUNTIME_USER=www
NGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS=120
${extractRecoveryShellFunction(source, name)}
${name}
`;
  command("/bin/bash", ["-s"], { input: script, timeout: 200000 });
}
async function verify(recoverySha, runId) {
  if (!SHA.test(recoverySha) || !ID.test(runId)) fail("binding_invalid");
  const before = fixedState(), steps = [];
  const step = async (name, fn) => { if (name !== RECOVERY_CHECKS[steps.length]) fail("step_order"); await fn(); steps.push(name); process.stderr.write("candidate_recovery_check_" + name + "_passed\n"); };
  const source = readFileSync(P.appDir + "/scripts/deploy.production.sh", "utf8");
  const repaired = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
  await step("source", () => {
    if (command("git", ["-C", P.appDir, "rev-parse", "HEAD"]).stdout.trim() !== P.targetSha) fail("source_changed");
    command("git", ["-C", P.appDir, "diff", "--quiet", "HEAD", "--"]);
    if (command("git", ["-C", P.appDir, "show", P.targetSha + ":scripts/deploy.production.sh"]).stdout !== source) fail("source_changed");
  });
  await step("candidate", () => controller("check-candidate"));
  const load = file => import(pathToFileURL(P.appDir + "/scripts/" + file + ".mjs").href);
  await step("handoff", async () => {
    const reader = await load("production-maintenance-deploy-read");
    const fields = await reader.readMaintenanceDeploymentFields(["candidate-handoff", P.appDir, P.appName, "3000", P.targetSha, P.expectedOldSha, P.operationId, "115000"]);
    if (fields.split("\0").length !== 11) fail("handoff_invalid");
  });
  const environment = await load("read-production-supabase-environment"); let snapshot;
  await step("environment", () => {
    snapshot = environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(P.release + "/.env.local", P.targetSha);
    const pid = String(before.state.candidate.web.processes[0].pid);
    const live = environment.captureStableProductionProcessSupabaseEnvironment(pid, P.release);
    if (live.status !== "present" || live.rolloutStatus !== "present" ||
      ["internalUrl", "publicUrl", "anonKey", "staffBusinessRbacMode", "staffBusinessRbacSiteIds", "canonicalPortalOrigin"].some(key => live[key] !== snapshot[key]) ||
      snapshot.canonicalPortalOrigin !== "https://launch.faolla.com") fail("environment_mismatch");
  });
  await step("readiness", async () => {
    const bytes = readFileSync(new URL("./production-readiness-attestation.json", import.meta.url));
    if (hash(bytes) !== "87439b0b31ad6bfec4f17fe1085ae0c9b5363a6716186c009a090ee2e11dc0c4") fail("readiness_reference");
    // The signed old report is a baseline, NOT a fresh authorization. Run the
    // complete original read-only readiness SQL against the live DB now.
    const original = JSON.parse(bytes), expected = original.database;
    const inspect = () => command("docker", ["--host", "unix:///var/run/docker.sock", "inspect", "--format", "{{.Id}}", expected.containerName]).stdout.trim();
    if (inspect() !== expected.containerId || expected.containerId !== before.state.database.id) fail("database_identity");
    const api = await load("check-ordinary-account-cutover-readiness");
    const report = await api.checkOrdinaryAccountCutoverReadiness({ containerName: expected.containerName,
      env: { FAOLLA_EXPECTED_DATABASE_NAME: expected.dbName, FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: expected.systemId,
        FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT: original.baseline.merchantRecordCount,
        FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT: original.baseline.personalCanonicalBindingCount,
        FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256: original.baseline.ordinaryIdentityContentSha256 } });
    if (report.status !== "ready" || report.mode !== "read_only" || inspect() !== expected.containerId ||
      ["dbName", "dbOid", "systemId", "primary"].some(key => report.databaseIdentity[key] !== expected[key]) ||
      Object.entries(original.baseline).some(([key, value]) => String(report.readiness[key]) !== value)) fail("readiness_failed");
  });
  await step("booking", () => {
    // Reuse the deploy's unchanged descriptor-bound read-only query supervisor.
    const fn = extractRecoveryShellFunction(source, "verify_booking_persistence");
    const js = fn.split("<<'NODE'\n")[1]?.split("\nNODE\n")[0]; if (!js) fail("booking_source_missing");
    command("/usr/bin/node", ["--input-type=module", "-", P.release, snapshot.directoryIdentity, snapshot.fileIdentity, snapshot.sha256, "30", "5"], {
      input: js, timeout: 35000, env: { BOOKING_PERSISTENCE_CHECK_ATTEMPTS: "1", BOOKING_PERSISTENCE_CHECK_DELAY_MS: "1", BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS: "10000" },
    });
  });
  await step("smoke", () => shellGate(source, "run_local_release_smoke"));
  await step("nginx", () => shellGate(repaired, "verify_nginx_release_static_access"));
  await step("candidateAfter", () => controller("check-candidate"));
  await step("stateUnchanged", () => {
    if (!fixedState().bytes.equals(before.bytes) || !isDeepStrictEqual(snapshot, environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(P.release + "/.env.local", P.targetSha))) fail("state_changed");
  });
  const checkedAt = Date.now();
  return validateCandidateRecoveryReceipt({ version: 1, kind: "faolla-existing-candidate-verification",
    ...Object.fromEntries(["targetSha", "expectedOldSha", "operationId", "stateDigest", "failedDeployRunId", "backupRunId", "readinessRunId"].map(k => [k, P[k]])),
    recoverySha, runId, runAttempt: "1", checkedAt, validUntil: Math.min(checkedAt + 1800000, P.expiresAt), checks: steps }, recoverySha, runId, checkedAt);
}
async function main([action, recoverySha, runId, receiptFile, confirmation]) {
  if (!SHA.test(recoverySha ?? "") || !ID.test(runId ?? "")) fail("binding_invalid");
  if (action === "validate-receipt") { validateCandidateRecoveryReceipt(JSON.parse(readFileSync(receiptFile)), recoverySha, runId); return; }
  if (action === "verify") {
    if (receiptFile) fail("arguments_invalid");
    process.stdout.write(JSON.stringify(await verify(recoverySha, runId)) + "\n"); return;
  }
  if (action === "resume") {
    if (confirmation !== "RESUME_VERIFIED_T17_CANDIDATE" || resolve(receiptFile) !== resolve(dirname(process.argv[1]), "candidate-verification.json")) fail("confirmation_invalid");
    const fact = lstatSync(receiptFile); if (!fact.isFile() || fact.isSymbolicLink() || fact.uid !== 0 || fact.nlink !== 1 || fact.size > 4096) fail("receipt_file_invalid");
    const signed = validateCandidateRecoveryReceipt(JSON.parse(readFileSync(receiptFile)), recoverySha, runId);
    await verify(recoverySha, runId);
    validateCandidateRecoveryReceipt(signed, recoverySha, runId);
    // The reviewed workflow verifies hosted provenance BEFORE invoking this
    // fixed action. The original typed controller owns all resumed launches,
    // ACL proof, saved PM2 proof, ingress restoration, and failure closure.
    const report = controller("end");
    writeFileSync(resolve(dirname(process.argv[1]), "recovery-ended.json"), JSON.stringify(report) + "\n", { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify(report) + "\n"); return;
  }
  if (action === "reclose") {
    const state = JSON.parse(readFileSync("/var/lib/faolla-maintenance/merchant-space/state.json"));
    if (state.targetSha !== P.targetSha || state.operationId !== P.operationId || state.expectedOldSha !== P.expectedOldSha) fail("reclose_binding");
    process.stdout.write(JSON.stringify(controller("fail-held")) + "\n"); return;
  }
  fail("arguments_invalid");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(/^candidate_recovery_[a-z_]+$/.test(error?.message ?? "") ? error.message + "\n" : "candidate_recovery_unverified\n"); process.exitCode = 1;
  }
}
