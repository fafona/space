import { types } from "node:util";
import { posix } from "node:path";
import { validateMaintenanceStartupBaseline as validateBudgetRecoveryBaseline } from "./production-maintenance-startup-recovery.mjs";

// Only a private disk handoff for the exact stopped T15. No original runtime
// replacement, process adoption, restart permission, or whole-state stdout.
const PIN = "7f62d8e4cbe861eaac415a67d0f5b7d012639b78290a46d059e3e64234f6f405";
const T15 = "e83c91abbf8e0d327708bd0b04c3a33ed423ab91";
const OLD = "cd943076ebda758b70bf2f2270a508c774b726d6";
const OPERATION = "eb81284a-09c4-4514-8f16-38eaf6acc1e4";
const APP = "/www/wwwroot/merchant-space";
const HISTORICAL_TARGETS = [T15, "3af8fa6ba6644593e10bef0a391389b2b34e926a", OLD, "f3104de19aa59e527c7b94a99850d151448da8cd",
  "1b09cdbf25ec1b4164e200486f009500b6551ed4", "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf",
  "46f007fbd9e417f93c01e398c77cf38ec814547d", "13df917416cf06ce27fce021460b08caf50f6165"];
const fail = () => { throw new Error("maintenance_startup_handoff_unverified"); };
const FIELD_KEYS = ["LINK_TARGET", "RUNTIME_DIR", "RUNTIME_PARENT", "RELEASE_NAME", "BUILD_PREFIX", "BUILD_ID", "RUNTIME_IDENTITY",
  "WEB_CWD_IDENTITY", "WEB_PID", "WEB_PROCESS_START_TICKS", "WEB_PROCESS_IDENTITY", "ENVIRONMENT_DIRECTORY_IDENTITY", "ENVIRONMENT_FILE_IDENTITY",
  "ENVIRONMENT_SHA256", "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_INTERNAL_URL_B64",
  "NEXT_PUBLIC_SUPABASE_URL_B64", "NEXT_PUBLIC_SUPABASE_ANON_KEY_B64", "STAFF_ROLLOUT_STATUS", "STAFF_ALLOW_LEGACY_EMPTY_ORIGIN",
  "MERCHANT_STAFF_BUSINESS_RBAC_MODE", "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS", "FAOLLA_CANONICAL_PORTAL_ORIGIN", "AUTOMATION_WORKER_STATE",
  "AUTOMATION_WORKER_RUNNING"].map(key => "PREVIOUS_" + key);
function object(raw, keys) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || types.isProxy(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function fields(raw, baseline) {
  const value = object(raw, FIELD_KEYS);
  if (Object.values(value).some(x => typeof x !== "string" || /[\0\r\n]/.test(x) || x.length > 131072)) fail();
  const directory = baseline.current.runtimeIdentity.split(":"), legacyIdentity = `${directory[0]}:${directory[1]}:${BigInt(directory[4]) / 1000000000n}`;
  if (value.PREVIOUS_LINK_TARGET !== baseline.current.target || value.PREVIOUS_RUNTIME_DIR !== baseline.current.target ||
      value.PREVIOUS_RUNTIME_PARENT !== APP + ".releases" || value.PREVIOUS_RELEASE_NAME !== posix.basename(baseline.current.target) ||
      value.PREVIOUS_BUILD_ID !== T15 || value.PREVIOUS_BUILD_PREFIX !== T15.slice(0, 12) ||
      value.PREVIOUS_RUNTIME_IDENTITY !== legacyIdentity || value.PREVIOUS_WEB_CWD_IDENTITY !== legacyIdentity ||
      !/^[1-9][0-9]{0,9}$/.test(value.PREVIOUS_WEB_PID) || Number(value.PREVIOUS_WEB_PID) > 2147483647 ||
      !/^[1-9][0-9]{0,24}$/.test(value.PREVIOUS_WEB_PROCESS_START_TICKS) || !/^\d+:\d+$/.test(value.PREVIOUS_WEB_PROCESS_IDENTITY) ||
      !/^[a-f0-9]{64}$/.test(value.PREVIOUS_ENVIRONMENT_SHA256) || value.PREVIOUS_AUTOMATION_WORKER_STATE !== "running" ||
      value.PREVIOUS_AUTOMATION_WORKER_RUNNING !== "1") fail();
  for (const key of ["SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (Buffer.from(value["PREVIOUS_" + key], "utf8").toString("base64") !== value["PREVIOUS_" + key + "_B64"]) fail();
  }
  return Object.freeze(value);
}
/** The controller constructs this small report only after full private checks.
 * The reader independently obtains TWO reports and compares every field under
 * its one absolute deadline. This function never treats a digest as permission
 * to fabricate/replace the complete predecessor, which remains in state only. */
export function validateStartupHandoffReport(raw, request) {
  try {
    const value = object(raw, ["version", "operationId", "targetSha", "expectedOldSha", "state", "fields", "budgetBaseline"]);
    if (types.isProxy(request) || !request || typeof request !== "object" ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(request))) fail();
    for (const key of ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort"]) {
      const d = Object.getOwnPropertyDescriptor(request, key); if (!d?.enumerable || !Object.hasOwn(d, "value")) fail();
    }
    if (value.version !== 4 || value.state !== "held" || value.operationId !== OPERATION || value.expectedOldSha !== OLD ||
        value.operationId !== request.operationId || value.targetSha !== request.targetSha || value.expectedOldSha !== request.expectedOldSha ||
        request.appDir !== APP || request.appName !== "merchant-space" || request.appPort !== 4000 ||
        typeof value.targetSha !== "string" || !/^[a-f0-9]{40}$/.test(value.targetSha) || HISTORICAL_TARGETS.includes(value.targetSha)) fail();
    const reference = object(value.budgetBaseline, ["version", "predecessorStateDigest", "previousTargetSha", "stoppedBaseline"]);
    if (reference.version !== 4 || reference.predecessorStateDigest !== PIN || reference.previousTargetSha !== T15) fail();
    reference.stoppedBaseline = validateBudgetRecoveryBaseline(reference.stoppedBaseline);
    value.fields = fields(value.fields, reference.stoppedBaseline); value.budgetBaseline = Object.freeze(reference);
    if (Buffer.byteLength(JSON.stringify(value)) > 262144) fail();
    return Object.freeze(value);
  } catch { fail(); }
}
