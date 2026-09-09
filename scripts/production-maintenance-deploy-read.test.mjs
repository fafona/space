import assert from "node:assert/strict";
import test from "node:test";
import { readMaintenanceDeploymentFields } from "./production-maintenance-deploy-read.mjs";

const TARGET = "a".repeat(40), OLD = "b".repeat(40), OP = "11111111-1111-4111-8111-111111111111";
const APP = "/srv/faolla", RUNTIME = `${APP}.releases/${TARGET.slice(0, 12)}-20260910000000`;
const args = (action, ...extra) => [action, APP, "faolla", "3000", TARGET, OLD, OP, "30000", ...extra];
const summary = (extra) => ({ version: 1, operationId: OP, targetSha: TARGET, expectedOldSha: OLD, state: "candidate", ...extra });
const response = (value) => ({ status: 0, signal: null, stderr: "", stdout: JSON.stringify(value) });
const candidate = () => ({
  CANDIDATE_WEB_PID: "300", CANDIDATE_WEB_PROCESS_START_TICKS: "400", CANDIDATE_WEB_PROCESS_IDENTITY: "1:2",
  CANDIDATE_WEB_CWD_IDENTITY: "3:4:5", CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64: Buffer.from('{"typed":"candidate"}').toString("base64"),
});
const previousKeys = ["LINK_TARGET", "RUNTIME_DIR", "RUNTIME_PARENT", "RELEASE_NAME", "BUILD_PREFIX", "BUILD_ID", "RUNTIME_IDENTITY",
  "WEB_CWD_IDENTITY", "WEB_PID", "WEB_PROCESS_START_TICKS", "WEB_PROCESS_IDENTITY", "ENVIRONMENT_DIRECTORY_IDENTITY", "ENVIRONMENT_FILE_IDENTITY",
  "ENVIRONMENT_SHA256", "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_INTERNAL_URL_B64",
  "NEXT_PUBLIC_SUPABASE_URL_B64", "NEXT_PUBLIC_SUPABASE_ANON_KEY_B64", "STAFF_ROLLOUT_STATUS", "STAFF_ALLOW_LEGACY_EMPTY_ORIGIN",
  "MERCHANT_STAFF_BUSINESS_RBAC_MODE", "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS", "FAOLLA_CANONICAL_PORTAL_ORIGIN", "AUTOMATION_WORKER_STATE",
  "AUTOMATION_WORKER_RUNNING"].map((key) => `PREVIOUS_${key}`);
const rejected = (promise) => assert.rejects(promise, { message: "maintenance_deployment_read_unverified" });

function rolloutFixture() {
  const calls = [], environmentCalls = [];
  const frozen = { internalUrl: "http://127.0.0.1:8000", publicUrl: "https://db.example.test", anonKey: "PRIVATE_SENTINEL",
    staffBusinessRbacMode: "enforce", staffBusinessRbacSiteIds: "12345678", canonicalPortalOrigin: "https://launch.faolla.com",
    directoryIdentity: "1:2:3", fileIdentity: "4:5:6", sha256: "c".repeat(64) };
  const live = { status: "present", rolloutStatus: "present", startTicks: "400", ...frozen };
  return { calls, environmentCalls, frozen, live,
    argv: args("rollout-web", "enforce", "12345678", "https://launch.faolla.com"),
    d: {
      run(command, values, options) { calls.push({ command, values, options }); return response(summary({ snapshot: "running:300" })); },
      canonical(value) { assert.equal(value, APP + ".current"); return RUNTIME; },
      environment: {
        readFrozenProductionSupabaseRollbackEnvironmentSnapshot(path, sha) { environmentCalls.push("frozen"); assert.equal(path, RUNTIME + "/.env.local"); assert.equal(sha, TARGET); return { ...frozen }; },
        captureStableProductionProcessSupabaseEnvironment(pid, path) { environmentCalls.push("live"); assert.equal(pid, "300"); assert.equal(path, RUNTIME); return { ...live }; },
      },
    },
  };
}

test("snapshots use one bounded direct Node control command with exact binding", async () => {
  for (const [action, snapshot] of [["snapshot-web", "running:300"], ["snapshot-worker", "inactive"], ["snapshot-worker", "absent"]]) {
    let count = 0;
    const result = await readMaintenanceDeploymentFields(args(action), { run(command, values, options) {
      count++; assert.equal(command, process.execPath); assert.match(values[0], /production-maintenance-control\.mjs$/);
      assert.equal(values[1], action); assert.ok(values.includes(OP)); assert.equal(options.shell, false);
      assert.equal(options.timeout <= 30000 && options.timeout > 0, true); assert.equal(options.maxBuffer, 262144);
      assert.deepEqual(options.env, { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
      return response(summary({ snapshot }));
    } });
    assert.equal(result, snapshot + "\n"); assert.equal(count, 1);
  }
});

test("invalid arguments and rollout inputs cannot start a controller", async () => {
  const cases = [args("unknown"), args("snapshot-web", "extra"), args("snapshot-web").with(7, "999"),
    args("snapshot-web").with(6, "bad"), args("snapshot-web").with(4, OLD),
    args("rollout-web", "enforce", "12345678,12345678", "https://launch.faolla.com"),
    args("rollout-web", "off", "12345678", "https://launch.faolla.com"),
    args("rollout-web", "enforce", "12345678", "https://evil.test")];
  for (const argv of cases) await rejected(readMaintenanceDeploymentFields(argv, { run() { assert.fail("must not execute"); } }));
});

test("transport failures, pollution, malformed JSON and oversized bodies are fixed failures", async () => {
  const clean = response(summary({ snapshot: "absent" }));
  for (const changes of [{ status: 1 }, { signal: "SIGTERM" }, { error: new Error("SECRET") }, { stderr: "SECRET" },
    { stdout: "SECRET malformed" }, { stdout: "x".repeat(262145) }]) {
    await rejected(readMaintenanceDeploymentFields(args("snapshot-web"), { run: () => ({ ...clean, ...changes }) }));
  }
  await rejected(readMaintenanceDeploymentFields(args("snapshot-web"), { run() { throw new Error("SECRET"); } }));
});

test("snapshot binding and exact envelope reject wrong operation, target, state and pid", async () => {
  for (const change of [{ operationId: "22222222-2222-4222-8222-222222222222" }, { targetSha: OLD }, { expectedOldSha: TARGET },
    { state: "ended" }, { actor: "SECRET" }, { snapshot: "running:2147483648" }, { snapshot: "running:0300" }, { snapshot: 300 }]) {
    await rejected(readMaintenanceDeploymentFields(args("snapshot-web"), { run: () => response(summary({ snapshot: "running:300", ...change })) }));
  }
});

test("candidate handoff emits only the five complete NUL-framed fields", async () => {
  const fields = candidate();
  const result = await readMaintenanceDeploymentFields(args("candidate-handoff"), { run: () => response(summary({ fields })) });
  assert.deepEqual(result.split("\0"), [...Object.entries(fields).flat(), ""]);
});

test("candidate handoff rejects missing, extra, polluted or malformed fields", async () => {
  const missing = candidate(); delete missing.CANDIDATE_WEB_PID;
  for (const fields of [missing, { ...candidate(), EXTRA: "SECRET" }, { ...candidate(), CANDIDATE_WEB_PID: "0" },
    { ...candidate(), CANDIDATE_WEB_PROCESS_START_TICKS: "x" }, { ...candidate(), CANDIDATE_WEB_CWD_IDENTITY: "1:2" },
    { ...candidate(), CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64: "eA" }, { ...candidate(), CANDIDATE_WEB_PROCESS_IDENTITY: "1:2\nSECRET" }]) {
    await rejected(readMaintenanceDeploymentFields(args("candidate-handoff"), { run: () => response(summary({ fields })) }));
  }
  await rejected(readMaintenanceDeploymentFields(args("candidate-handoff"), { run: () => response(summary({ state: "held", fields: candidate() })) }));
});

test("previous runtime handoff validates frozen proof and exactly twenty-seven fields", async () => {
  const proof = { input: { appDir: APP, appName: "faolla", appPort: 3000, expectedOldSha: OLD } };
  const fields = Object.fromEntries(previousKeys.map((key) => [key, "value"]));
  let validated = 0, read = 0;
  const d = { run: () => response(summary({ state: "held", runtime: proof })), runtime: {
    validateRuntimeProof(value) { validated++; assert.deepEqual(value, proof); return value; },
    async readDeploymentHandoffFields(value) { read++; assert.deepEqual(value, proof); return fields; },
  } };
  assert.equal((await readMaintenanceDeploymentFields(args("runtime-handoff"), d)).split("\0").length, 55);
  assert.equal(validated, 1); assert.equal(read, 1);
  delete fields.PREVIOUS_BUILD_ID;
  await rejected(readMaintenanceDeploymentFields(args("runtime-handoff"), d));
  proof.input.appPort = 3001;
  await rejected(readMaintenanceDeploymentFields(args("runtime-handoff"), d));
  assert.equal(read, 2);
});

test("rollout verifies both controller snapshots and stable real process/frozen environment", async () => {
  const f = rolloutFixture();
  assert.equal(await readMaintenanceDeploymentFields(f.argv, f.d), "300\n");
  assert.equal(f.calls.length, 2); assert.deepEqual(f.environmentCalls, ["frozen", "live", "live", "frozen"]);
  assert.ok(f.calls.every((call) => call.values[1] === "snapshot-web"));
});

test("rollout rejects stale input, absent environment, frozen mismatch and incorrect release", async () => {
  for (const mutate of [(f) => { f.live.status = "absent"; }, (f) => { f.live.rolloutStatus = "absent"; },
    (f) => { f.live.staffBusinessRbacMode = "off"; }, (f) => { f.frozen.staffBusinessRbacSiteIds = "87654321"; },
    (f) => { f.frozen.anonKey = "OTHER_SECRET"; }, (f) => { f.d.canonical = () => APP + ".releases/wrong"; }]) {
    const f = rolloutFixture(); mutate(f); await rejected(readMaintenanceDeploymentFields(f.argv, f.d));
    assert.equal(f.calls.length, 1);
  }
});

test("rollout rejects changed PID, reused PID generation, environment file or current link", async () => {
  for (const kind of ["pid", "generation", "frozen", "current"]) {
    const f = rolloutFixture(); let reads = 0;
    f.d.canonical = () => kind === "current" && reads === 2 ? RUNTIME + "-changed" : RUNTIME;
    f.d.run = () => { reads++; if (reads === 2) {
      if (kind === "generation") f.live.startTicks = "401";
      if (kind === "frozen") f.frozen.sha256 = "d".repeat(64);
    } return response(summary({ snapshot: kind === "pid" && reads === 2 ? "running:301" : "running:300" })); };
    await rejected(readMaintenanceDeploymentFields(f.argv, f.d)); assert.equal(reads, 2);
  }
});

test("one absolute deadline is shared by both controls and every environment observation", async () => {
  const f = rolloutFixture(); let now = 0;
  f.d.now = () => now;
  const run = f.d.run; f.d.run = (...values) => { const result = run(...values); now += 6000; return result; };
  const live = f.d.environment.captureStableProductionProcessSupabaseEnvironment;
  f.d.environment.captureStableProductionProcessSupabaseEnvironment = (...values) => { now += 2000; return live(...values); };
  assert.equal(await readMaintenanceDeploymentFields(f.argv, f.d), "300\n");
  assert.deepEqual(f.calls.map((call) => call.options.timeout), [30000, 22000]);
  const expired = rolloutFixture(); now = 0; expired.d.now = () => now;
  expired.d.run = () => { now = 30000; return response(summary({ snapshot: "running:300" })); };
  await rejected(readMaintenanceDeploymentFields(expired.argv, expired.d)); assert.deepEqual(expired.environmentCalls, []);
});

test("rollout finishing after its deadline returns no PID", async () => {
  const f = rolloutFixture(); let now = 0, reads = 0; f.d.now = () => now;
  const frozen = f.d.environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot;
  f.d.environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot = (...values) => { if (++reads === 2) now = 30001; return frozen(...values); };
  await rejected(readMaintenanceDeploymentFields(f.argv, f.d));
});
