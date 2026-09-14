import assert from "node:assert/strict";
import test from "node:test";
import { validatePrelaunchRecoveryHandoffReport } from "./production-maintenance-prelaunch-handoff.mjs";

const T7 = "d9de5fe689226fcdd13a1e95039901b5d0f39167", T8 = "a".repeat(40);
const APP = "/www/wwwroot/merchant-space", path = APP + ".releases/" + T7.slice(0, 12) + "-20260913200000";
const request = { appDir: APP, appName: "merchant-space", appPort: 3000, targetSha: T8,
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6", operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4" };
const fieldKeys = ["LINK_TARGET", "RUNTIME_DIR", "RUNTIME_PARENT", "RELEASE_NAME", "BUILD_PREFIX", "BUILD_ID", "RUNTIME_IDENTITY",
  "WEB_CWD_IDENTITY", "WEB_PID", "WEB_PROCESS_START_TICKS", "WEB_PROCESS_IDENTITY", "ENVIRONMENT_DIRECTORY_IDENTITY", "ENVIRONMENT_FILE_IDENTITY",
  "ENVIRONMENT_SHA256", "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_INTERNAL_URL_B64",
  "NEXT_PUBLIC_SUPABASE_URL_B64", "NEXT_PUBLIC_SUPABASE_ANON_KEY_B64", "STAFF_ROLLOUT_STATUS", "STAFF_ALLOW_LEGACY_EMPTY_ORIGIN",
  "MERCHANT_STAFF_BUSINESS_RBAC_MODE", "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS", "FAOLLA_CANONICAL_PORTAL_ORIGIN", "AUTOMATION_WORKER_STATE",
  "AUTOMATION_WORKER_RUNNING"].map(key => "PREVIOUS_" + key);
function fixture() {
  const pin = "a7767b3e1e5a788282c16a57a91ed588821cb0b5894925fcff9d5e544e5d6003";
  const stoppedBaseline = { version: 3, stateDigest: pin, candidateDigest: "a".repeat(64), launchDiskDigest: "b".repeat(64),
    launchJournalDigest: "c".repeat(64), runtimeDigest: "d".repeat(64), current: { target: path,
      linkIdentity: "1:91:64:10:20:1:0:41471", runtimeIdentity: "1:30:64:10:20:2:0:16877" },
    bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa", pm2RegistryDigest: "e".repeat(64), observedAt: Date.parse("2026-09-14T17:00:00Z") };
  const fields = Object.fromEntries(fieldKeys.map(key => [key, "fixture"]));
  Object.assign(fields, { PREVIOUS_LINK_TARGET: path, PREVIOUS_RUNTIME_DIR: path, PREVIOUS_RUNTIME_PARENT: APP + ".releases",
    PREVIOUS_RELEASE_NAME: path.split("/").at(-1), PREVIOUS_BUILD_PREFIX: T7.slice(0, 12), PREVIOUS_BUILD_ID: T7,
    PREVIOUS_RUNTIME_IDENTITY: "1:30:0", PREVIOUS_WEB_CWD_IDENTITY: "1:30:0", PREVIOUS_WEB_PID: "301", PREVIOUS_WEB_PROCESS_START_TICKS: "401",
    PREVIOUS_WEB_PROCESS_IDENTITY: "1:301", PREVIOUS_ENVIRONMENT_SHA256: "f".repeat(64),
    PREVIOUS_AUTOMATION_WORKER_STATE: "running", PREVIOUS_AUTOMATION_WORKER_RUNNING: "1" });
  for (const key of ["SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) fields["PREVIOUS_" + key + "_B64"] = Buffer.from(fields["PREVIOUS_" + key]).toString("base64");
  return { version: 3, operationId: request.operationId, targetSha: T8, expectedOldSha: request.expectedOldSha, state: "held", fields,
    budgetBaseline: { version: 3, predecessorStateDigest: pin, previousTargetSha: T7, stoppedBaseline } };
}
const rejects = (value, bound = request) => assert.throws(() => validatePrelaunchRecoveryHandoffReport(value, bound), { message: "maintenance_prelaunch_handoff_unverified" });
test("small report retains fixed T7 physical baseline without complete predecessors", () => {
  const value = fixture(), result = validatePrelaunchRecoveryHandoffReport(value, request);
  assert.deepEqual(result, value); assert(Object.isFrozen(result.fields)); assert(Object.isFrozen(result.budgetBaseline.stoppedBaseline.current));
  assert(Buffer.byteLength(JSON.stringify(result)) < 8192); assert.equal(Object.hasOwn(result, "runtime"), false);
});
test("wrong scope, target, predecessor, baseline, fields and encoded secrets reject", () => {
  const changes = [r => { r.version = 1; }, r => { r.state = "candidate"; }, r => { r.operationId = "bad"; },
    r => { r.targetSha = T7; }, r => { r.runtime = {}; }, r => { r.budgetBaseline.predecessor = {}; },
    r => { r.budgetBaseline.predecessorStateDigest = "a".repeat(64); }, r => { r.budgetBaseline.stoppedBaseline.version = 1; },
    r => { r.budgetBaseline.stoppedBaseline.current.target = APP + ".releases/old"; },
    r => { r.fields.PREVIOUS_WEB_PID = "0"; }, r => { r.fields.PREVIOUS_RUNTIME_IDENTITY = "1:30:1"; },
    r => { r.fields.PREVIOUS_BUILD_ID = T8; }, r => { r.fields.PREVIOUS_AUTOMATION_WORKER_RUNNING = "0"; },
    r => { r.fields.PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64 = "SECRET"; },
    r => { r.fields.PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY = "SECRET\n"; },
    r => { delete r.fields.PREVIOUS_BUILD_ID; }, r => { r.fields.EXTRA = "SECRET"; },
    r => { r.fields.PREVIOUS_ENVIRONMENT_FILE_IDENTITY = "x".repeat(131073); }];
  for (const change of changes) { const r = fixture(); change(r); rejects(r); }
  rejects(fixture(), { ...request, appDir: "/other" });
});
test("accessor, proxy and extra-field rejection happens without touching getters", () => {
  let touched = 0;
  const value = fixture(); Object.defineProperty(value, "fields", { enumerable: true, get() { touched++; return {}; } }); rejects(value);
  rejects(new Proxy(fixture(), {})); const nested = fixture(); nested.fields = new Proxy(nested.fields, {}); rejects(nested);
  const expected = { ...request }; Object.defineProperty(expected, "targetSha", { enumerable: true, get() { touched++; return T8; } }); rejects(fixture(), expected);
  assert.equal(touched, 0);
});

test("even a matching request cannot select any historical target as the new attempt", () => {
  for (const targetSha of [T7, "3af8fa6ba6644593e10bef0a391389b2b34e926a", request.expectedOldSha, "f3104de19aa59e527c7b94a99850d151448da8cd",
    "1b09cdbf25ec1b4164e200486f009500b6551ed4", "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf",
    "46f007fbd9e417f93c01e398c77cf38ec814547d", "13df917416cf06ce27fce021460b08caf50f6165",
    "78ca8104442172baf046b62f9184cf9c7f6a9279", "3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0", "67ddb91bf618e9716b79df6bf97f08d3865919b7"]) {
    rejects({ ...fixture(), targetSha }, { ...request, targetSha });
  }
});


test("fresh window report retains the original reader shape but rejects old or future baseline clocks", async () => {
  const { validateBudgetRecoveryHandoffReport } = await import("./production-maintenance-budget-handoff.mjs");
  const value = fixture();
  assert.deepEqual(validatePrelaunchRecoveryHandoffReport(value, request), validateBudgetRecoveryHandoffReport(value, request));
  for (const time of ["2026-09-14T09:07:00Z", "2026-09-14T15:00:31.999Z", "2026-09-14T20:00:00Z"]) {
    const changed = fixture(); changed.budgetBaseline.stoppedBaseline.observedAt = Date.parse(time); rejects(changed);
  }
});
