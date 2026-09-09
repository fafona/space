import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, posix } from "node:path";
import { parseMaintenanceRequest } from "./production-maintenance-control.mjs";

// Host-only, private stdout. A real script entry point prevents the legacy
// runtime module's stdin CLI from executing during deployment handoff imports.
export async function readMaintenanceDeploymentFields(argv, overrides = {}) {
  try { return await readFields(argv, overrides); }
  catch { throw new Error("maintenance_deployment_read_unverified"); }
}

async function readFields(argv, overrides) {
  const [action, appDir, appName, appPort, targetSha, expectedOldSha, operationId, timeoutRaw = "30000", expectedMode, expectedSiteIds, expectedOrigin] = argv;
  const rollout = action === "rollout-web";
  if (argv.length < 7 || (rollout ? argv.length !== 11 : argv.length > 8) || !["runtime-handoff", "candidate-handoff", "snapshot-web", "snapshot-worker", "rollout-web"].includes(action) ||
      !/^[1-9]\d{0,5}$/.test(timeoutRaw) || Number(timeoutRaw) < 1000 || Number(timeoutRaw) > 120000) throw new Error("maintenance_deployment_read_invalid");
  if (rollout && (expectedOrigin !== "https://launch.faolla.com" || !["off", "enforce"].includes(expectedMode) ||
      (expectedMode === "off" ? expectedSiteIds !== "" : typeof expectedSiteIds !== "string" || !/^[0-9]{8}(,[0-9]{8}){0,49}$/.test(expectedSiteIds) ||
        new Set(expectedSiteIds.split(",")).size !== expectedSiteIds.split(",").length))) throw new Error("maintenance_deployment_read_invalid");
  const controlAction = rollout ? "snapshot-web" : action;
  const flags = [controlAction, "--app-dir", appDir, "--app-name", appName, "--app-port", appPort, "--target-sha", targetSha,
    "--expected-old-sha", expectedOldSha, "--expected-operation-id", operationId, "--json"];
  const request = parseMaintenanceRequest(flags);
  const run = overrides.run ?? spawnSync;
  const now = overrides.now ?? (() => performance.now()), deadline = now() + Number(timeoutRaw);
  const remaining = () => { const value = deadline - now(); if (!Number.isFinite(value) || value <= 0 || value > Number(timeoutRaw)) throw new Error("maintenance_deployment_read_unverified"); return Math.ceil(value); };
  const read = () => {
    const result = run(process.execPath, [fileURLToPath(new URL("./production-maintenance-control.mjs", import.meta.url)), ...flags], {
      encoding: "utf8", timeout: remaining(), killSignal: "SIGKILL", maxBuffer: 262144,
      windowsHide: true, shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"],
    });
    remaining();
    if (result.error || result.signal || result.status !== 0 || result.stderr !== "" || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 262144) throw new Error("maintenance_deployment_read_unverified");
    const report = JSON.parse(result.stdout);
    const expectedKeys = ["version", "operationId", "targetSha", "expectedOldSha", "state",
      controlAction === "runtime-handoff" ? "runtime" : controlAction === "candidate-handoff" ? "fields" : "snapshot"].sort();
    if (!report || typeof report !== "object" || Array.isArray(report) || Object.keys(report).sort().join(",") !== expectedKeys.join(",") || report.version !== 1 ||
        report.operationId !== operationId || report.targetSha !== targetSha || report.expectedOldSha !== expectedOldSha ||
        !["held", "candidate"].includes(report.state) || action === "runtime-handoff" && report.state !== "held" ||
        action === "candidate-handoff" && report.state !== "candidate") throw new Error("maintenance_deployment_read_unverified");
    return report;
  };
  const report = read();
  if (controlAction.startsWith("snapshot-")) {
    if (typeof report.snapshot !== "string" || !/^(?:absent|inactive|running:[1-9]\d{0,9})$/.test(report.snapshot)) throw new Error("maintenance_deployment_read_unverified");
    if (rollout) {
      if (report.state !== "candidate" || !/^running:[1-9]\d{0,9}$/.test(report.snapshot)) throw new Error("maintenance_deployment_read_unverified");
      const pid = report.snapshot.slice(8);
      if (Number(pid) > 2147483647) throw new Error("maintenance_deployment_read_unverified");
      const { realpathSync } = await import("node:fs");
      const canonical = overrides.canonical ?? realpathSync;
      const runtimePath = canonical(appDir + ".current");
      if (typeof runtimePath !== "string" || posix.dirname(runtimePath) !== appDir + ".releases" ||
          !new RegExp("^" + targetSha.slice(0, 12) + "-[0-9]{14}$").test(posix.basename(runtimePath))) throw new Error("maintenance_deployment_read_unverified");
      const environment = overrides.environment ?? await import("./read-production-supabase-environment.mjs");
      remaining();
      const frozen = environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(runtimePath + "/.env.local", targetSha);
      const live = environment.captureStableProductionProcessSupabaseEnvironment(pid, runtimePath);
      if (live.status !== "present" || live.rolloutStatus !== "present" || !/^[1-9]\d{0,24}$/.test(live.startTicks ?? "") ||
          ["internalUrl", "publicUrl", "anonKey"].some((key) => live[key] !== frozen[key]) ||
          live.staffBusinessRbacMode !== expectedMode || live.staffBusinessRbacSiteIds !== expectedSiteIds || live.canonicalPortalOrigin !== expectedOrigin ||
          frozen.staffBusinessRbacMode !== expectedMode || frozen.staffBusinessRbacSiteIds !== expectedSiteIds || frozen.canonicalPortalOrigin !== expectedOrigin) throw new Error("maintenance_deployment_read_unverified");
      remaining();
      const after = read();
      const liveAfter = environment.captureStableProductionProcessSupabaseEnvironment(pid, runtimePath);
      const frozenAfter = environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(runtimePath + "/.env.local", targetSha);
      if (after.state !== "candidate" || after.snapshot !== report.snapshot || canonical(appDir + ".current") !== runtimePath ||
          JSON.stringify(liveAfter) !== JSON.stringify(live) || JSON.stringify(frozenAfter) !== JSON.stringify(frozen)) throw new Error("maintenance_deployment_read_unverified");
      remaining(); return pid + "\n";
    }
    if (report.snapshot.startsWith("running:") && Number(report.snapshot.slice(8)) > 2147483647) throw new Error("maintenance_deployment_read_unverified");
    return report.snapshot + "\n";
  }
  let fields = report.fields;
  if (action === "runtime-handoff") {
    const runtime = overrides.runtime ?? await import("./production-maintenance-runtime.mjs");
    const proof = runtime.validateRuntimeProof(report.runtime);
    if (["appDir", "appName", "appPort", "expectedOldSha"].some((key) => proof.input[key] !== request[key])) throw new Error("maintenance_deployment_read_unverified");
    fields = await runtime.readDeploymentHandoffFields(proof);
  }
  const candidateKeys = ["CANDIDATE_WEB_PID", "CANDIDATE_WEB_PROCESS_START_TICKS", "CANDIDATE_WEB_PROCESS_IDENTITY", "CANDIDATE_WEB_CWD_IDENTITY", "CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64"];
  const previousKeys = ["PREVIOUS_LINK_TARGET", "PREVIOUS_RUNTIME_DIR", "PREVIOUS_RUNTIME_PARENT", "PREVIOUS_RELEASE_NAME", "PREVIOUS_BUILD_PREFIX",
    "PREVIOUS_BUILD_ID", "PREVIOUS_RUNTIME_IDENTITY", "PREVIOUS_WEB_CWD_IDENTITY", "PREVIOUS_WEB_PID", "PREVIOUS_WEB_PROCESS_START_TICKS",
    "PREVIOUS_WEB_PROCESS_IDENTITY", "PREVIOUS_ENVIRONMENT_DIRECTORY_IDENTITY", "PREVIOUS_ENVIRONMENT_FILE_IDENTITY", "PREVIOUS_ENVIRONMENT_SHA256",
    "PREVIOUS_SUPABASE_INTERNAL_URL", "PREVIOUS_NEXT_PUBLIC_SUPABASE_URL", "PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY", "PREVIOUS_SUPABASE_INTERNAL_URL_B64",
    "PREVIOUS_NEXT_PUBLIC_SUPABASE_URL_B64", "PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64", "PREVIOUS_STAFF_ROLLOUT_STATUS", "PREVIOUS_STAFF_ALLOW_LEGACY_EMPTY_ORIGIN",
    "PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_MODE", "PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS", "PREVIOUS_FAOLLA_CANONICAL_PORTAL_ORIGIN",
    "PREVIOUS_AUTOMATION_WORKER_STATE", "PREVIOUS_AUTOMATION_WORKER_RUNNING"];
  const allowed = action === "runtime-handoff" ? previousKeys : candidateKeys;
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length !== (action === "runtime-handoff" ? 27 : 5) ||
      Object.keys(fields).some((key) => !allowed.includes(key))) throw new Error("maintenance_deployment_read_unverified");
  if (action === "candidate-handoff" && (!/^[1-9]\d{0,9}$/.test(fields.CANDIDATE_WEB_PID) || Number(fields.CANDIDATE_WEB_PID) > 2147483647 ||
      !/^[1-9]\d{0,24}$/.test(fields.CANDIDATE_WEB_PROCESS_START_TICKS) || !/^\d+:\d+$/.test(fields.CANDIDATE_WEB_PROCESS_IDENTITY) ||
      !/^\d+:\d+:\d+$/.test(fields.CANDIDATE_WEB_CWD_IDENTITY) || !/^[A-Za-z0-9+/]+={0,2}$/.test(fields.CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64) ||
      Buffer.from(fields.CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64, "base64").toString("base64") !== fields.CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64)) throw new Error("maintenance_deployment_read_unverified");
  remaining();
  return Object.entries(fields).map(([key, value]) => {
    if (!/^(?:PREVIOUS|CANDIDATE)_[A-Z0-9_]+$/.test(key) || typeof value !== "string" || /[\0\r\n]/.test(value) || value.length > 131072) throw new Error("maintenance_deployment_read_unverified");
    return key + "\0" + value + "\0";
  }).join("");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(await readMaintenanceDeploymentFields(process.argv.slice(2))); }
  catch { process.stderr.write("maintenance_deployment_read_unverified\n"); process.exitCode = 1; }
}
