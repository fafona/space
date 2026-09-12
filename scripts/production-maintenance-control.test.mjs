import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { emptyPythonLayout } from "./production-maintenance-runtime-layout.mjs";
import { parseMaintenanceRequest, runMaintenanceAction, createRuntimeDiagnosticReport, createPm2PeerDiagnosticReport, validateMaintenanceState, validateMaintenanceSubproofBindings, validateMaintenanceLaunchProofBindings, maintenanceLaunchBinding, createMaintenanceLaunchCallbacks, queryMaintenanceDatabaseQuiet, PRODUCTION_MAINTENANCE_QUIET_SQL, PRODUCTION_MAINTENANCE_ACL_SQL } from "./production-maintenance-control.mjs";
import { SUPABASE_SCHEDULER_IMAGE } from "./maintenance-supabase-scheduler-profile.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";
import { encodeMaintenanceRecoveryEvidence } from "./production-maintenance-recovery.mjs";

const operationId = "12345678-1234-4123-8123-123456789abc";
const old = "a".repeat(40);
const target = "b".repeat(40);
const token = "c".repeat(64);
const boot = "12345678-1234-4123-8123-987654321abc";
const flags = ["--app-dir", "/srv/faolla", "--app-name", "faolla", "--app-port", "3000", "--target-sha", target, "--expected-old-sha", old, "--json"];
const identity = "1:2:3:4:5:1:0:33261";
const launchDisk = () => ({ runtime: "/srv/faolla.releases/" + target.slice(0, 12) + "-20260909120000", runtimeIdentity: identity, nextBuildDigest: "d".repeat(64) });
const daemon = () => ({ pid: 100, uid: 0, startTicks: "123", executable: "/usr/bin/node", executableIdentity: identity });
const nonce = (n) => `12345678-1234-4123-8123-${String(n).padStart(12, "0")}`;
const environmentDigest = "e".repeat(64);
function observation(role, observedNonce) {
  const number = ["paused-web", "resumed-web", "worker"].indexOf(role) + 1;
  return { observedNonce, environmentDigest, instance: { pmId: number, pid: 200 + number, parentPid: 100, uid: 0,
    startTicks: String(2000 + number), processIdentity: identity, cwd: launchDisk().runtime, cwdIdentity: identity,
    executable: "/usr/bin/node", executableIdentity: identity, commandLineDigest: "f".repeat(64),
    createdAt: 100, pmUptime: 100, restartTime: 0, metadataDigest: "a".repeat(64) } };
}
function addConfirmed(state, role) {
  state.launchDisk ??= launchDisk();
  const binding = maintenanceLaunchBinding(state), sequence = ["paused-web", "resumed-web", "worker"].indexOf(role) + 1;
  state.launchJournal ??= createMaintenanceLaunchJournal(binding);
  state.launchJournal = planMaintenanceLaunch(state.launchJournal, binding, { role, sequence, nonce: nonce(sequence), environmentDigest });
  state.launchJournal = transitionMaintenanceLaunch(state.launchJournal, binding, { role, sequence, nonce: nonce(sequence), phase: "attempted" });
  state.launchJournal = transitionMaintenanceLaunch(state.launchJournal, binding, { role, sequence, nonce: nonce(sequence), phase: "confirmed",
    observation: { ...binding, role, sequence, ...observation(role, nonce(sequence)) } });
}
const request = (action) => parseMaintenanceRequest([action, ...flags, ...(["diagnose-runtime", "diagnose-pm2-peer", "plan", "prepare"].includes(action) ? [] : ["--expected-operation-id", operationId])]);
const diagnosticFixture = () => ({
  version: 4, maintenance: "not_verified", stability: "unverified", disk: "unverified", supervision: null, daemonCwdIsRoot: null,
  webMetadata: { cwdLiteralMatch: null, cwdCanonicalMatch: null, entryLiteralMatch: null, entryCanonicalMatch: null,
    interpreterLiteralMatch: null, interpreterCanonicalMatch: null, argsMatch: null, nodeArgsEmpty: null },
  supabaseEnvironment: "unverified", worker: { state: "unverified", nodeDescendantCount: null, nonNodeDescendantCount: null },
  runtimeExtraProcessCount: null, pm2Home: "unverified", pm2PathOverridesPresent: null, pm2Connection: "not_checked",
  pm2Version: null, pm2Endpoint: { home: "unverified", rpcSocket: "unverified", pidFile: "unverified", pidMatches: null },
  workerNative: { esbuildCount: null, otherCount: null, unknownCount: null, controlledIdentityVerified: null, unknownReasons: null },
  python: { version: null, executableVerified: null, afUnixApiAvailable: null, soPeercredApiAvailable: null, rejectionReason: null },
  layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: null },
});
function fixture(phase = "held") {
  const events = [];
  let state = { version: 2, revision: 0, operationId, targetSha: target, expectedOldSha: old, appDir: "/srv/faolla", appName: "faolla", appPort: 3000,
    bootId: boot, createdAt: 100, phase, runtime: { old: true, daemon: daemon() }, ingress: { planned: true }, database: { frozen: true },
    publicSupabaseUrl: "https://database.example", tokenHash: createHash("sha256").update(token).digest("hex"),
    candidate: ["candidate", "resuming", "ended"].includes(phase) ? { targetSha: target } : null, resumed: phase === "ended" ? { ready: true } : null,
    launchDisk: null, launchJournal: null, finalDump: phase === "ended" ? { verified: true } : null };
  if (state.candidate) addConfirmed(state, "paused-web");
  if (state.resumed) addConfirmed(state, "resumed-web");
  let nextNonce = 10;
  const effect = (name, result) => async (...args) => { events.push(name); if (typeof result === "function") return result(...args); return result; };
  const ops = {
    uuid: () => nextNonce++ === 10 ? operationId : nonce(nextNonce), token: () => token, bootId: () => boot, now: () => 200,
    load: () => structuredClone(state), save: (value) => { events.push("save:" + value.phase); value.revision++; state = structuredClone(value); },
    create: (value, secret) => { assert.equal(secret, token); events.push("create"); state = structuredClone(value); },
    assertNoActiveOperation: () => { events.push("noActive"); }, readToken: () => token,
    captureRuntime: effect("captureRuntime", (input) => { assert.deepEqual(Object.keys(input).sort(), ["appDir", "appName", "appPort", "expectedOldSha"].sort()); return { old: true, daemon: daemon() }; }),
    readPublicSupabaseUrl: effect("readPublicUrl", "https://database.example"),
    captureIngress: effect("captureIngress", { captured: true }), captureDatabase: effect("captureDatabase", { frozen: true }),
    planIngressInstallation: (proof, secret) => { assert.equal(secret, token); assert.ok(proof.captured); events.push("planIngress"); return { planned: true }; },
    installIngress: effect("installIngress", { planned: true }), verifyIngress: effect("verifyIngress"), restoreIngress: effect("restoreIngress"),
    stopRuntime: effect("stopRuntime"), assertRuntimeStopped: effect("assertStopped"),
    waitDatabaseQuiet: effect("waitQuiet"), assertDatabaseQuiet: effect("assertQuiet"), assertClientWritesDenied: effect("assertAcl"),
    validateProofs: () => { events.push("validateProofs"); },
    captureCandidate: effect("captureCandidate", { targetSha: target }),
    validateLaunchDisk: (disk) => structuredClone(disk),
    startCandidate: async (_proof, sha, { launchJournal }) => {
      assert.equal(sha, target); const value = await launchJournal.attempt("paused-web", launchDisk(), environmentDigest);
      assert.equal(state.launchJournal.slots["paused-web"].phase, "attempted"); events.push("send:paused-web");
      await launchJournal.confirm("paused-web", observation("paused-web", value)); return { targetSha: target };
    },
    verifyCandidate: effect("verifyCandidate", (_runtime, candidate, pause) => { assert.equal(candidate.targetSha, target); assert.equal(pause, "1"); }),
    stopCandidate: effect("stopCandidate"), resumeCandidate: async (_proof, _candidate, _sha, { launchJournal }) => {
      events.push("resumeCandidate"); const value = await launchJournal.attempt("resumed-web", launchDisk(), environmentDigest);
      assert.equal(state.launchJournal.slots["resumed-web"].phase, "attempted"); events.push("send:resumed-web");
      await launchJournal.confirm("resumed-web", observation("resumed-web", value)); return { ready: true };
    },
    verifyResumedCandidate: effect("verifyResumed"), stopResumedCandidate: effect("stopResumed"),
    persistResumedDump: effect("persistDump", { verified: true }), verifyResumedDump: effect("verifyDump"),
    validateResumedDumpProof: () => { events.push("validateDump"); },
    readManagedSnapshot: effect("snapshot", "absent"),
    readCandidateHandoffFields: effect("handoff", { CANDIDATE_WEB_PID: "201", CANDIDATE_WEB_PROCESS_START_TICKS: "2001", CANDIDATE_WEB_PROCESS_IDENTITY: identity,
      CANDIDATE_WEB_CWD_IDENTITY: identity, CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64: "e30=" }),
    reconcileMaintenanceLaunches: async () => { throw new Error("no actual observation"); },
  };
  return { events, ops, state: () => state, replace: (value) => { state = value; } };
}
test("strict CLI rejects missing, duplicate, unexpected and unbound inputs", () => {
  for (const args of [["plan", ...flags, "--app-name", "x"], ["end", ...flags], ["plan", ...flags, "--expected-operation-id", operationId], ["prepare", ...flags, "--force"],
    ["prepare", ...flags.filter((value) => value !== "--json")], ["plan", ...flags.map((value) => value === "/srv/faolla" ? "/srv/../faolla" : value)],
    ["plan", ...flags.map((value) => value === target ? old : value)]]) assert.throws(() => parseMaintenanceRequest(args), /maintenance_arguments_invalid/);
});

test("recovery CLI alone accepts explicit previous target and bounded canonical evidence", () => {
  const previous = "d".repeat(40), operationFlags = ["--expected-operation-id", operationId];
  const raw = value => Buffer.from(value).toString("base64url");
  const base = [...flags, ...operationFlags, "--previous-target-sha", previous];
  assert.equal(parseMaintenanceRequest(["inspect-recovery", ...base]).previousTargetSha, previous);
  const evidence = { version: 1, state: "recovery-inspected", operationId, targetSha: target, previousTargetSha: previous,
    expectedOldSha: old, revision: 3, stateDigest: "a".repeat(64), createdAt: 100, sourceDiffDigest: "b".repeat(64),
    migrationDigest: "c".repeat(64), toolsSha: target, recoveryRunId: "123", recoveryRunAttempt: 1,
    mainCIrunId: "124", historyDigest: "d".repeat(64), historyCheckedAt: 199 };
  assert.deepEqual(parseMaintenanceRequest(["recover-held", ...base, "--recovery-evidence", encodeMaintenanceRecoveryEvidence(evidence)]).recoveryEvidence, evidence);
  for (const args of [
    ["inspect-recovery", ...flags, ...operationFlags], ["recover-held", ...base],
    ["inspect-recovery", ...base, "--recovery-evidence", raw('{}')],
    ["check-held", ...base], ["prepare", ...flags, "--previous-target-sha", previous],
    ["check-held", ...flags, ...operationFlags, "--recovery-evidence", raw('{}')],
    ["inspect-recovery", ...base.map(value => value === previous ? target : value)],
    ...['{}\n', '{"x":1,"x":2}', '[]', 'null', '{ "x":1}', 'PRIVATE', '"' + 'x'.repeat(17000) + '"']
      .map(value => ["recover-held", ...base, "--recovery-evidence", raw(value)]),
    ["recover-held", ...base, "--recovery-evidence", "e30="],
  ]) assert.throws(() => parseMaintenanceRequest(args), /maintenance_arguments_invalid/);
});

function recoveryFixture() {
  const f = fixture("failed-held"), nextTarget = "f".repeat(40);
  const args = [...flags.map(value => value === target ? nextTarget : value), "--expected-operation-id", operationId, "--previous-target-sha", target];
  const inspect = parseMaintenanceRequest(["inspect-recovery", ...args]);
  const source = { sourceDiffDigest: "1".repeat(64), sourceChangedPaths: ["scripts/production-maintenance-control.mjs"] };
  let migrationDigest = "2".repeat(64);
  f.ops.readRecoverySnapshot = () => {
    f.events.push("readRecovery"); const state = f.ops.load();
    return { state, revision: state.revision, digest: createHash("sha256").update(JSON.stringify(state)).digest("hex") };
  };
  f.ops.readRecoverySourceProof = async () => { f.events.push("readSource"); return source; };
  f.ops.readRecoveryMigrationProof = async () => { f.events.push("readMigrations"); return migrationDigest; };
  f.ops.commitRecovery = async (snapshot, next) => {
    assert.equal(snapshot.revision, f.state().revision);
    assert.equal(snapshot.digest, createHash("sha256").update(JSON.stringify(f.state())).digest("hex"));
    assert.equal(next.revision, snapshot.revision + 1);
    f.events.push("commitRecovery"); f.replace(structuredClone(next)); return structuredClone(next);
  };
  return { ...f, inspect, nextTarget, source, setMigration: value => { migrationDigest = value; },
    grant: inspection => ({ ...inspection, toolsSha: nextTarget, recoveryRunId: "123", recoveryRunAttempt: 1,
      mainCIrunId: "124", historyDigest: "3".repeat(64), historyCheckedAt: 199 }),
    recover: evidence => parseMaintenanceRequest(["recover-held", ...args, "--recovery-evidence", encodeMaintenanceRecoveryEvidence(evidence)]),
  };
}

test("recovery inspection is read-only and bound recovery commits once without refreshing original TTL or frozen proof", async () => {
  const f = recoveryFixture(), original = structuredClone(f.state());
  const inspection = await runMaintenanceAction(f.inspect, f.ops);
  assert.equal(inspection.state, "recovery-inspected"); assert.equal(inspection.targetSha, f.nextTarget);
  assert.equal(inspection.previousTargetSha, target); assert.equal(inspection.revision, original.revision);
  assert.equal(inspection.createdAt, original.createdAt); assert.deepEqual(f.state(), original);
  assert.deepEqual(f.events, ["readRecovery", "validateProofs", "verifyIngress", "assertStopped", "assertQuiet", "readSource", "readMigrations"]);
  f.events.length = 0;
  const result = await runMaintenanceAction(f.recover(f.grant(inspection)), f.ops);
  assert.deepEqual(result, { version: 1, operationId, targetSha: f.nextTarget, expectedOldSha: old, state: "held" });
  const saved = f.state(); assert.equal(saved.version, 3); assert.equal(saved.revision, original.revision + 1);
  assert.equal(saved.createdAt, original.createdAt); assert.equal(saved.phase, "held");
  for (const key of Object.keys(original).filter(key => !["version", "revision", "targetSha", "phase"].includes(key))) assert.deepEqual(saved[key], original[key]);
  assert.equal(f.events.filter(value => value === "commitRecovery").length, 1);
  assert.equal(f.events.some(value => /^(?:save:|create$|installIngress$|restoreIngress$|stopRuntime$|send:)/.test(value)), false);
  assert.equal(validateMaintenanceState(saved, { ...f.inspect, targetSha: f.nextTarget }, boot, 200), saved);
  await assert.rejects(runMaintenanceAction(f.recover(f.grant(inspection)), f.ops));
  assert.equal(f.events.filter(value => value === "commitRecovery").length, 1);
});

test("recovery requires still-held full checks and identical inspected state, source and migration digests", async () => {
  for (const mutate of [
    f => { f.state().revision++; }, f => { f.source.sourceDiffDigest = "4".repeat(64); },
    f => { f.setMigration("5".repeat(64)); }, f => { f.ops.assertDatabaseQuiet = async () => { throw new Error("quiet-unverified"); }; },
    f => { f.ops.verifyIngress = async () => { throw new Error("gateway-unverified"); }; },
    f => { f.ops.assertRuntimeStopped = async () => { throw new Error("writer-unverified"); }; },
    f => { f.ops.readRecoverySourceProof = async () => { throw new Error("source-unverified"); }; },
    f => { f.ops.readRecoveryMigrationProof = async () => { throw new Error("registry-unverified"); }; },
  ]) {
    const f = recoveryFixture(), inspection = await runMaintenanceAction(f.inspect, f.ops); f.events.length = 0;
    mutate(f); const original = structuredClone(f.state());
    await assert.rejects(runMaintenanceAction(f.recover(f.grant(inspection)), f.ops));
    assert.equal(f.events.includes("commitRecovery"), false); assert.deepEqual(f.state(), original);
  }
});

test("recovery rejects wrong phase or any launch evidence, stale history, and never retries an ambiguous commit", async () => {
  for (const mutate of [f => { f.state().phase = "held"; }, f => { f.state().phase = "failed-unknown"; },
    f => { addConfirmed(f.state(), "paused-web"); }, f => { f.state().candidate = { targetSha: target }; }]) {
    const f = recoveryFixture(); mutate(f);
    await assert.rejects(runMaintenanceAction(f.inspect, f.ops));
    assert.equal(f.events.includes("readSource"), false); assert.equal(f.events.includes("commitRecovery"), false);
  }
  const stale = recoveryFixture(), inspection = await runMaintenanceAction(stale.inspect, stale.ops);
  stale.ops.now = () => 400000;
  await assert.rejects(runMaintenanceAction(stale.recover(stale.grant(inspection)), stale.ops));
  assert.equal(stale.events.includes("commitRecovery"), false);
  const slow = recoveryFixture(), slowInspection = await runMaintenanceAction(slow.inspect, slow.ops);
  let heldChecks = 0;
  slow.ops.assertDatabaseQuiet = async () => { if (++heldChecks === 2) slow.ops.now = () => 400000; };
  await assert.rejects(runMaintenanceAction(slow.recover(slow.grant(slowInspection)), slow.ops));
  assert.equal(slow.events.includes("commitRecovery"), false);
  const f = recoveryFixture(), observed = await runMaintenanceAction(f.inspect, f.ops);
  let sends = 0;
  f.ops.commitRecovery = async (_snapshot, next) => { sends++; f.replace(structuredClone(next)); throw new Error("fsync-unconfirmed"); };
  await assert.rejects(runMaintenanceAction(f.recover(f.grant(observed)), f.ops), /fsync-unconfirmed/);
  await assert.rejects(runMaintenanceAction(f.recover(f.grant(observed)), f.ops));
  assert.equal(sends, 1); assert.equal(f.state().version, 3); assert.equal(f.events.some(value => value.startsWith("save:")), false);
});
test("runtime diagnosis has no operation and only invokes its read-only inspector", async () => {
  const input = request("diagnose-runtime");
  assert.equal(input.operationId, null);
  assert.throws(() => parseMaintenanceRequest(["diagnose-runtime", ...flags, "--expected-operation-id", operationId]), /maintenance_arguments_invalid/);
  let called = 0;
  const result = await createRuntimeDiagnosticReport(input, async (observed) => {
    called += 1;
    assert.deepEqual(observed, { appDir: input.appDir, appName: input.appName, appPort: input.appPort, expectedOldSha: old });
    return diagnosticFixture();
  });
  assert.equal(called, 1);
  assert.deepEqual(result, { version: 1, targetSha: target, expectedOldSha: old, state: "runtime-diagnosed", diagnostics: diagnosticFixture() });
  assert.equal(Object.hasOwn(result, "operationId"), false);
  assert.throws(() => validateMaintenanceState(result, input, boot, 200), /maintenance_state_binding_invalid/);
  await assert.rejects(createRuntimeDiagnosticReport(input, async () => ({ ...diagnosticFixture(), raw: "must-not-disclose" })));
  await assert.rejects(createRuntimeDiagnosticReport(request("prepare"), async () => { throw new Error("must-not-run"); }), /maintenance_arguments_invalid/);
});

test("PM2 peer diagnosis invokes only its exact read-only inspector and never creates an operation", async () => {
  const input = request("diagnose-pm2-peer");
  assert.equal(input.operationId, null);
  assert.throws(() => parseMaintenanceRequest(["diagnose-pm2-peer", ...flags, "--expected-operation-id", operationId]), /maintenance_arguments_invalid/);
  for (const diagnostics of [
    { version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null },
    { version: 1, maintenance: "not_verified", peerVerified: true, pm2Version: "6.0.8" },
  ]) {
    let called = 0;
    const result = await createPm2PeerDiagnosticReport(input, async (observed) => {
      called += 1;
      assert.deepEqual(observed, { appDir: input.appDir, appName: input.appName, appPort: input.appPort, expectedOldSha: old });
      return diagnostics;
    });
    assert.equal(called, 1);
    assert.deepEqual(result, { version: 1, targetSha: target, expectedOldSha: old, state: "pm2-peer-diagnosed", diagnostics });
    assert.equal(Object.hasOwn(result, "operationId"), false);
    assert.throws(() => validateMaintenanceState(result, input, boot, 200), /maintenance_state_binding_invalid/);
  }
});

test("PM2 peer report rejects polluted observations and non-diagnostic requests", async () => {
  const diagnostics = { version: 1, maintenance: "not_verified", peerVerified: true, pm2Version: "6.0.8" };
  for (const patch of [{ raw: "must-not-disclose" }, { socketPath: "/private/rpc.sock" }, { pid: 123 },
    { maintenance: "held" }, { peerVerified: false }, { peerVerified: null }, { pm2Version: null },
    { pm2Version: "6.0.8\nmust-not-disclose" }]) {
    await assert.rejects(createPm2PeerDiagnosticReport(request("diagnose-pm2-peer"), async () => ({ ...diagnostics, ...patch })),
      /^Error: production_maintenance_pm2_peer_unverified$/);
  }
  let called = 0;
  for (const input of [request("prepare"), request("diagnose-runtime"), { ...request("diagnose-pm2-peer"), operationId }]) {
    await assert.rejects(createPm2PeerDiagnosticReport(input, async () => { called += 1; return diagnostics; }), /maintenance_arguments_invalid/);
  }
  assert.equal(called, 0);
});
test("fixed PostgreSQL projections preserve typed database identity and all required ACL operations", () => {
  assert.match(PRODUCTION_MAINTENANCE_QUIET_SQL, /'databaseOid',\(SELECT oid::bigint FROM pg_database WHERE datname=current_database\(\)\)/);
  assert.match(PRODUCTION_MAINTENANCE_QUIET_SQL, /NOT EXISTS \(SELECT 1 FROM pg_subscription WHERE subenabled\)/);
  assert.match(PRODUCTION_MAINTENANCE_QUIET_SQL, /to_regclass\('cron\.job'\) IS NULL/);
  assert.match(PRODUCTION_MAINTENANCE_ACL_SQL, /has_table_privilege\('service_role','public.pages','INSERT'\) AND has_table_privilege\('service_role','public.pages','UPDATE'\) AND has_table_privilege\('service_role','public.pages','DELETE'\)/);
  for (const sql of [PRODUCTION_MAINTENANCE_QUIET_SQL, PRODUCTION_MAINTENANCE_ACL_SQL]) {
    assert.match(sql, /^BEGIN READ ONLY;/); assert.match(sql, /ROLLBACK;$/);
  }
});

test("quiet routing preserves the legacy SQL and never falls back after an exact Supabase profile failure", () => {
  const row = { complete: true, schedulerSafe: false, transactions: 0, prepared: 0, databaseOid: 5 };
  for (const image of ["supabase/postgres:15.8.1.060", "supabase/postgres:15.8.1.085-custom", "supabase/postgres:17.0"]) {
    const calls = [];
    assert.equal(queryMaintenanceDatabaseQuiet({ image }, (name, sql) => {
      calls.push([name, sql]); return row;
    }), row);
    assert.deepEqual(calls, [["postgres", PRODUCTION_MAINTENANCE_QUIET_SQL]]);
  }
  const calls = [];
  assert.throws(() => queryMaintenanceDatabaseQuiet({ id: "c".repeat(64), image: SUPABASE_SCHEDULER_IMAGE, databaseOid: 0 }, (name, sql) => {
    calls.push([name, sql]); throw new Error("synthetic private database error");
  }), /maintenance_database_scheduler_profile_unverified/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "postgres");
  assert.notEqual(calls[0][1], PRODUCTION_MAINTENANCE_QUIET_SQL);
});

test("both initial capture and every held quiet check use the image-bound scheduler profile", () => {
  const source = readFileSync(new URL("./production-maintenance-control.mjs", import.meta.url), "utf8");
  for (const name of ["captureDatabase", "assertDatabaseQuiet"]) {
    const start = source.indexOf(`const ${name} =`);
    assert.ok(start > 0);
    const end = source.indexOf("\n  };", start);
    assert.ok(end > start);
    const block = source.slice(start, end);
    assert.match(block, /queryMaintenanceDatabaseQuiet\(proof, \(name, sql\) => queryDatabase\(proof, sql, name\)\)/);
    assert.doesNotMatch(block, /queryDatabase\(proof, QUIET_SQL\)/);
  }
  assert.match(source, /databaseName !== "postgres" && \(proof.image !== SUPABASE_SCHEDULER_IMAGE \|\| databaseName !== "_supabase"\)/);
  assert.match(source, /\[SUPABASE_SCHEDULER_PSQL_SCRIPT, "faolla-maintenance-readonly", databaseName\]/);
});
test("individually valid subordinate proofs must bind to the same operation, boot, runtime, gateway and DB", () => {
  const state = { ...fixture().state(), database: { id: "database-id", image: "database-image" } };
  state.runtime = { input: { appDir: state.appDir, appName: state.appName, appPort: state.appPort, expectedOldSha: old }, bootId: boot };
  state.ingress = { input: { appPort: state.appPort, operationId, publicSupabaseUrl: "https://database.example/" }, docker: { containers: [{ service: "db", ...state.database }] } };
  assert.equal(validateMaintenanceSubproofBindings(state), true);
  for (const mutate of [
    (copy) => { copy.runtime.bootId = "different"; },
    (copy) => { copy.runtime.input.expectedOldSha = target; },
    (copy) => { copy.ingress.input.operationId = "different"; },
    (copy) => { copy.ingress.input.appPort = 3001; },
    (copy) => { copy.database.id = "replacement"; },
    (copy) => { copy.database.image = "replacement"; },
    (copy) => { copy.publicSupabaseUrl = "https://other.example"; },
  ]) {
    const copy = structuredClone(state); mutate(copy);
    assert.throws(() => validateMaintenanceSubproofBindings(copy), /maintenance_subproof_binding_invalid/);
  }
});
test("plan checks actual supported capture without private persistence or actuation", async () => {
  const f = fixture();
  const summary = await runMaintenanceAction(request("plan"), f.ops);
  assert.deepEqual(summary, { version: 1, operationId, targetSha: target, expectedOldSha: old, state: "planned" });
  assert.deepEqual(f.events, ["noActive", "captureRuntime", "readPublicUrl", "captureIngress", "captureDatabase", "planIngress"]);
});
test("prepare rejects unsupported capture before any mutations", async () => {
  const f = fixture(); f.ops.captureIngress = async () => { throw new Error("unsupported"); };
  await assert.rejects(runMaintenanceAction(request("prepare"), f.ops), /unsupported/);
  assert.equal(f.events.includes("create"), false); assert.equal(f.events.includes("stopRuntime"), false);
});
test("legacy raw HTTP endpoint uses only a proven HTTPS maintenance gateway without changing runtime config", async () => {
  const f = fixture(), raw = "http://8.8.8.8:8000/";
  f.ops.readPublicSupabaseUrl = async () => { f.events.push("readPublicUrl"); return raw; };
  const capture = f.ops.captureIngress;
  f.ops.captureIngress = async (input) => {
    assert.equal(input.publicSupabaseUrl, "https://faolla.com/");
    assert.equal(f.events.includes("create"), false);
    return capture(input);
  };
  const result = await runMaintenanceAction(request("prepare"), f.ops);
  assert.equal(result.state, "held");
  assert.equal(f.state().publicSupabaseUrl, "https://faolla.com/");
  assert.equal(raw, "http://8.8.8.8:8000/");
});
test("an unprovable HTTPS mapping or unsupported HTTP config cannot persist or actuate", async () => {
  const f = fixture();
  f.ops.readPublicSupabaseUrl = async () => "http://8.8.8.8:8000/";
  f.ops.captureIngress = async (input) => { assert.equal(input.publicSupabaseUrl, "https://faolla.com/"); throw new Error("route_not_proven"); };
  await assert.rejects(runMaintenanceAction(request("prepare"), f.ops), /route_not_proven/);
  assert.equal(f.events.includes("create"), false); assert.equal(f.events.includes("installIngress"), false);
  const invalid = fixture(); invalid.ops.readPublicSupabaseUrl = async () => "http://unknown.example:8000/";
  await assert.rejects(runMaintenanceAction(request("plan"), invalid.ops), /maintenance_plan_public_gateway_unverified/);
  assert.equal(invalid.events.includes("captureIngress"), false); assert.equal(invalid.events.includes("create"), false);
});
test("failed read-only plan exposes only a fixed phase and never persists or acts on host state", async () => {
  for (const [method, stage] of [
    ["assertNoActiveOperation", "operation_state"], ["captureRuntime", "runtime"],
    ["readPublicSupabaseUrl", "public_gateway"], ["captureIngress", "ingress"],
    ["captureDatabase", "database"], ["planIngressInstallation", "installation"],
  ]) {
    for (const asynchronous of [false, true]) {
      const f = fixture();
      const hostError = new Error("synthetic-private-host-content\nnot-public");
      f.ops[method] = asynchronous ? async () => { throw hostError; } : () => { throw hostError; };
      await assert.rejects(runMaintenanceAction(request("plan"), f.ops), (error) => {
        assert.equal(error.message, `maintenance_plan_${stage}_unverified`);
        assert.equal(error.cause, undefined);
        assert.equal(error.maintenanceReport, undefined);
        return true;
      });
      assert(f.events.every((event) => ["noActive", "captureRuntime", "readPublicUrl", "captureIngress", "captureDatabase", "planIngress"].includes(event)));
      const prepare = fixture(); prepare.ops[method] = f.ops[method];
      await assert.rejects(runMaintenanceAction(request("prepare"), prepare.ops), (error) => error === hostError);
      assert.equal(prepare.events.includes("create"), false);
    }
  }
});
test("prepare persists exact recovery proof then gates, stops and drains before reporting held", async () => {
  const f = fixture();
  assert.equal((await runMaintenanceAction(request("prepare"), f.ops)).state, "held");
  assert.deepEqual(f.events.slice(6), ["validateProofs", "create", "installIngress", "save:preparing", "stopRuntime", "assertStopped", "verifyIngress", "waitQuiet", "verifyIngress", "save:held"]);
  assert.equal(f.state().publicSupabaseUrl, "https://database.example");
});
test("prepare failure keeps closed and never restores ingress or restarts old writer", async () => {
  const f = fixture(); f.ops.waitDatabaseQuiet = async () => { throw new Error("drain"); };
  await assert.rejects(runMaintenanceAction(request("prepare"), f.ops), /maintenance_prepare_failed_held/);
  assert.equal(f.state().phase, "failed-held"); assert.equal(f.events.includes("restoreIngress"), false); assert.equal(f.events.includes("resumeCandidate"), false);
});
test("incomplete cleanup must not claim held", async () => {
  const f = fixture(); f.ops.installIngress = async () => { throw new Error("gate"); };
  await assert.rejects(runMaintenanceAction(request("prepare"), f.ops), /maintenance_failure_state_unverified/);
  assert.equal(f.state().phase, "failed-unknown");
});
test("failed prepare preserves only its bound operation metadata while still rejecting", async () => {
  for (const uncertain of [false, true]) {
    const f = fixture();
    f.ops.waitDatabaseQuiet = async () => { throw new Error("synthetic failure"); };
    if (uncertain) f.ops.assertDatabaseQuiet = async () => { throw new Error("still busy"); };
    await assert.rejects(runMaintenanceAction(request("prepare"), f.ops), (error) => {
      assert.deepEqual(error.maintenanceReport, { version: 1, operationId, targetSha: target, expectedOldSha: old, state: uncertain ? "failed-unknown" : "failed-held" });
      return true;
    });
  }
});
test("binding checks reject wrong operation, target, boot, expired and extra state", () => {
  const state = fixture().state();
  for (const replacement of [{ operationId: "22345678-1234-4123-8123-123456789abc" }, { targetSha: old }, { bootId: "changed" }, { createdAt: 201 }, { extra: true }]) {
    assert.throws(() => validateMaintenanceState({ ...state, ...replacement }, request("check-held"), boot, 200), /maintenance_state_binding_invalid/);
  }
  assert.throws(() => validateMaintenanceState(state, request("check-held"), boot, 13 * 60 * 60 * 1000), /maintenance_state_binding_invalid/);
});
test("held and private handoff require current real gate, stopped runtime and quiet DB", async () => {
  for (const action of ["check-held", "runtime-handoff"]) {
    const f = fixture(); const result = await runMaintenanceAction(request(action), f.ops);
    assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "assertStopped", "assertQuiet"]);
    assert.equal(result.state, "held"); assert.equal(Object.hasOwn(result, "runtime"), action === "runtime-handoff");
  }
});
test("unknown failure phase and candidate cannot masquerade as held", async () => {
  for (const phase of ["failed-unknown", "candidate", "ended"]) await assert.rejects(runMaintenanceAction(request("check-held"), fixture(phase).ops), /maintenance_not_held/);
});
test("the fence-only checkpoint never claims database quiet or runs conflicting control-service probes", async () => {
  const f = fixture();
  f.ops.verifyIngress = async (_proof, options) => { assert.equal(options.probeControlServices, false); f.events.push("verifyIngress"); };
  f.ops.assertDatabaseQuiet = async () => { throw new Error("must not inspect the separately held fence transaction"); };
  assert.equal((await runMaintenanceAction(request("check-runtime-held"), f.ops)).state, "runtime-held");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "assertStopped"]);
});
test("register only verifies an already journaled candidate and never adopts or starts one", async () => {
  const f = fixture("candidate"); assert.equal((await runMaintenanceAction(request("register-candidate"), f.ops)).state, "candidate");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "verifyCandidate"]);
  const held = fixture(); await assert.rejects(runMaintenanceAction(request("register-candidate"), held.ops), /maintenance_candidate_unverified/);
  assert.equal(held.events.includes("captureCandidate"), false);
});
test("wrong candidate target cannot pass verification or reopen traffic", async () => {
  const f = fixture("candidate"); f.replace({ ...f.state(), candidate: { targetSha: old } });
  await assert.rejects(runMaintenanceAction(request("end"), f.ops), /maintenance_candidate_target_invalid/);
  assert.equal(f.events.includes("resumeCandidate"), false);
});
test("end requires final ACL boundary before resume and real verification before reopen", async () => {
  const f = fixture("candidate"); assert.equal((await runMaintenanceAction(request("end"), f.ops)).state, "ended");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "verifyCandidate", "assertAcl", "save:resuming", "resumeCandidate", "save:resuming", "save:resuming", "send:resumed-web", "save:resuming", "save:resuming", "verifyResumed", "persistDump", "validateDump", "save:resuming", "verifyDump", "verifyIngress", "restoreIngress", "verifyResumed", "verifyDump", "save:ended"]);
});
test("failed ACL never resumes or opens ingress", async () => {
  const f = fixture("candidate"); f.ops.assertClientWritesDenied = async () => { throw new Error("acl"); };
  await assert.rejects(runMaintenanceAction(request("end"), f.ops), /acl/);
  assert.equal(f.events.includes("resumeCandidate"), false); assert.equal(f.state().phase, "candidate");
});
test("end reopen failure reinstalls gate before stopping the new candidate", async () => {
  const f = fixture("candidate"); f.ops.restoreIngress = async () => { f.events.push("restoreFailure"); throw new Error("reopen"); };
  await assert.rejects(runMaintenanceAction(request("end"), f.ops), /maintenance_end_failed_held/);
  assert.equal(f.state().phase, "failed-held");
  assert.ok(f.events.indexOf("installIngress") < f.events.indexOf("stopResumed")); assert.equal(f.events.includes("stopRuntime"), false);
});
test("post-end smoke failure can reclose and stop exact resumed runtime", async () => {
  const f = fixture("ended"); assert.equal((await runMaintenanceAction(request("fail-held"), f.ops)).state, "failed-held");
  assert.deepEqual(f.events, ["validateProofs", "installIngress", "save:ended", "validateProofs", "stopResumed", "verifyIngress", "assertStopped", "assertQuiet", "save:failed-held"]);
});

test("start persists empty, planned and attempted before its only send; registration never sends again", async () => {
  const f = fixture(); const result = await runMaintenanceAction(request("start-candidate"), f.ops);
  assert.equal(result.state, "candidate"); assert.equal(f.state().launchJournal.slots["paused-web"].phase, "confirmed");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "save:held", "save:held", "save:held", "send:paused-web",
    "save:held", "verifyCandidate", "save:candidate", "verifyIngress", "verifyCandidate"]);
  await runMaintenanceAction(request("register-candidate"), f.ops);
  await assert.rejects(runMaintenanceAction(request("start-candidate"), f.ops), /maintenance_not_held/);
  assert.equal(f.events.filter((event) => event === "send:paused-web").length, 1);
});

test("every pre-send durable failure permits zero sends and does not silently reinitialize the slot", async () => {
  for (const failureAt of [1, 2, 3]) {
    const f = fixture(), state = f.state(), original = f.ops.save; let writes = 0, sends = 0;
    f.ops.save = async (value) => { if (++writes === failureAt) throw new Error("fsync failed"); original(value); };
    const callbacks = createMaintenanceLaunchCallbacks(state, f.ops);
    await assert.rejects(async () => { await callbacks.attempt("paused-web", launchDisk(), environmentDigest); sends++; }, /fsync failed/);
    await assert.rejects(callbacks.attempt("paused-web", launchDisk(), environmentDigest), /persistence_unconfirmed/);
    assert.equal(sends, 0); assert.equal(writes, failureAt);
  }
});

test("only a previously planned identical launch can advance; attempted and unknown can only reconcile", async () => {
  for (const initialPhase of ["attempted", "unknown"]) {
    const f = fixture(), state = f.state(), callbacks = createMaintenanceLaunchCallbacks(state, f.ops);
    const value = await callbacks.attempt("paused-web", launchDisk(), environmentDigest);
    if (initialPhase === "unknown") await callbacks.unknown("paused-web");
    const before = f.events.length;
    await assert.rejects(callbacks.attempt("paused-web", launchDisk(), environmentDigest), /already_attempted/);
    assert.equal(f.events.length, before); assert.equal((await callbacks.read("paused-web")).phase, initialPhase);
    await assert.rejects(callbacks.confirm("paused-web", observation("paused-web", nonce(999))), /binding_mismatch/);
    await callbacks.confirm("paused-web", observation("paused-web", value));
    assert.equal((await callbacks.read("paused-web")).phase, "confirmed");
    await callbacks.unknown("paused-web"); assert.equal((await callbacks.read("paused-web")).phase, "confirmed");
  }
  const f = fixture(), state = f.state(); state.launchDisk = launchDisk();
  state.launchJournal = planMaintenanceLaunch(createMaintenanceLaunchJournal(maintenanceLaunchBinding(state)), maintenanceLaunchBinding(state), {
    role: "paused-web", sequence: 1, nonce: nonce(88), environmentDigest });
  const callbacks = createMaintenanceLaunchCallbacks(state, f.ops);
  await assert.rejects(callbacks.attempt("paused-web", launchDisk(), "f".repeat(64)), /already_attempted/);
  assert.equal(await callbacks.attempt("paused-web", launchDisk(), environmentDigest), nonce(88));
  assert.equal(f.events.length, 1);
});

test("runtime cannot replace operation binding, release, nonce, environment or inject observation accessors", async () => {
  const f = fixture(), callbacks = createMaintenanceLaunchCallbacks(f.state(), f.ops);
  const value = await callbacks.attempt("paused-web", launchDisk(), environmentDigest);
  for (const patch of [{ operationId }, { observedNonce: nonce(55) }, { environmentDigest: "a".repeat(64) },
    { instance: { ...observation("paused-web", value).instance, pid: 100 } }]) {
    await assert.rejects(callbacks.confirm("paused-web", { ...observation("paused-web", value), ...patch }));
  }
  let accessed = 0;
  const evil = observation("paused-web", value);
  Object.defineProperty(evil, "instance", { enumerable: true, get: () => { accessed++; return {}; } });
  await assert.rejects(callbacks.confirm("paused-web", evil)); assert.equal(accessed, 0);
  await assert.rejects(callbacks.attempt("paused-web", { ...launchDisk(), runtimeIdentity: "2:2:3:4:5:1:0:33261" }, environmentDigest), /binding_invalid/);
  await assert.rejects(callbacks.attempt("resumed-web", launchDisk(), environmentDigest), /phase_invalid/);
});

test("lost launch ACK without exact observation stays unknown and cannot claim held or resend", async () => {
  const f = fixture(); f.ops.startCandidate = async (_proof, _sha, { launchJournal }) => {
    await launchJournal.attempt("paused-web", launchDisk(), environmentDigest); f.events.push("one-send");
    await launchJournal.unknown("paused-web"); throw new Error("ACK lost");
  };
  await assert.rejects(runMaintenanceAction(request("start-candidate"), f.ops), /maintenance_failure_state_unverified/);
  assert.equal(f.state().phase, "failed-unknown"); assert.equal(f.state().launchJournal.slots["paused-web"].phase, "unknown");
  await assert.rejects(runMaintenanceAction(request("start-candidate"), f.ops), /maintenance_not_held/);
  assert.equal(f.events.filter((event) => event === "one-send").length, 1);
  f.replace({ ...f.state(), phase: "held" });
  await assert.rejects(runMaintenanceAction(request("check-held"), f.ops), /reconciliation_unverified/);
});

test("lost ACK cleanup confirms only persisted nonce observation then saves and stops that candidate", async () => {
  const f = fixture(); f.ops.startCandidate = async (_proof, _sha, { launchJournal }) => {
    await launchJournal.attempt("paused-web", launchDisk(), environmentDigest); f.events.push("one-send"); throw new Error("ACK lost");
  };
  f.ops.reconcileMaintenanceLaunches = async (_proof, disk, sha, { launchJournal }) => {
    assert.deepEqual(disk, launchDisk()); assert.equal(sha, target);
    const slot = await launchJournal.read("paused-web"); assert.equal(slot.phase, "attempted");
    await launchJournal.confirm("paused-web", observation("paused-web", slot.nonce));
    return { candidate: { targetSha: target }, resumed: null };
  };
  await assert.rejects(runMaintenanceAction(request("start-candidate"), f.ops), /maintenance_candidate_start_failed_held/);
  assert.equal(f.state().phase, "failed-held"); assert.equal(f.state().launchJournal.slots["paused-web"].phase, "confirmed");
  assert.equal(f.events.filter((event) => event === "one-send").length, 1);
  assert.equal(f.events.filter((event) => event === "stopCandidate").length, 1);
});

test("snapshot and handoff are exact read-only candidate inspections and never inspect a running DB fence", async () => {
  for (const action of ["snapshot-web", "snapshot-worker", "candidate-handoff"]) {
    const f = fixture("candidate"); f.ops.assertDatabaseQuiet = async () => { throw new Error("fence must remain untouched"); };
    const result = await runMaintenanceAction(request(action), f.ops);
    assert.deepEqual(f.events.slice(0, 3), ["validateProofs", "verifyIngress", "verifyCandidate"]);
    assert.equal(f.events.some((event) => event.startsWith("save:") || event.startsWith("send:")), false);
    assert.equal(action === "candidate-handoff" ? typeof result.fields.CANDIDATE_WEB_PID : result.snapshot, action === "candidate-handoff" ? "string" : "absent");
  }
  for (const invalid of ["running:0", "123", { pid: 123 }, "running:12\nsecret"]) {
    const f = fixture(); f.ops.readManagedSnapshot = async () => invalid;
    await assert.rejects(runMaintenanceAction(request("snapshot-web"), f.ops), /snapshot_unverified/);
  }
  await assert.rejects(runMaintenanceAction(request("candidate-handoff"), fixture().ops), /candidate_unverified/);
});

test("dump save, validation or readback failures must keep traffic fenced and stop confirmed final runtime", async () => {
  for (const method of ["persistResumedDump", "validateResumedDumpProof", "verifyResumedDump"]) {
    const f = fixture("candidate"); f.ops[method] = () => { throw new Error("dump ambiguous"); };
    await assert.rejects(runMaintenanceAction(request("end"), f.ops), /maintenance_end_failed_held/);
    assert.equal(f.events.includes("restoreIngress"), false); assert.equal(f.events.includes("stopResumed"), true);
    assert.equal(f.state().phase, "failed-held");
  }
});

test("old state version, absent durable slots and false ended state fail before actuators", async () => {
  for (const patch of [{ version: 1 }, { revision: -1 }, { revision: "0" }, { launchJournal: undefined }, { finalDump: undefined }]) {
    const f = fixture(); f.replace({ ...f.state(), ...patch });
    await assert.rejects(runMaintenanceAction(request("check-held"), f.ops)); assert.deepEqual(f.events, []);
  }
  const ended = fixture("ended"); ended.replace({ ...ended.state(), finalDump: null });
  await assert.rejects(runMaintenanceAction(request("fail-held"), ended.ops), /state_binding_invalid/);
  assert.deepEqual(ended.events, []);
});

test("individually valid candidate/resumed proofs must equal the confirmed disk daemon and complete instance", () => {
  const f = fixture("candidate"), state = f.state();
  const managed = (role) => {
    const observed = state.launchJournal.slots[role].instance;
    const { pmId, createdAt, pmUptime, restartTime, metadataDigest, ...process } = observed;
    return { pm2: { pmId, createdAt, pmUptime, restartTime, metadataHash: metadataDigest }, processes: [process] };
  };
  state.candidate = { targetSha: target, pauseExpected: "1", disk: structuredClone(state.launchDisk), daemon: daemon(), web: managed("paused-web") };
  state.runtime.worker = { state: "running" }; addConfirmed(state, "resumed-web"); addConfirmed(state, "worker");
  state.resumed = { candidate: { ...structuredClone(state.candidate), pauseExpected: "0", web: managed("resumed-web") }, worker: managed("worker") };
  assert.equal(validateMaintenanceLaunchProofBindings(state), true);
  // Equal facts with different property order remain the same observation.
  state.candidate.web.processes[0] = Object.fromEntries(Object.entries(state.candidate.web.processes[0]).reverse());
  assert.equal(validateMaintenanceLaunchProofBindings(state), true);
  for (const mutate of [
    (copy) => { copy.candidate.disk.runtime += "0"; },
    (copy) => { copy.candidate.disk.nextBuildDigest = "a".repeat(64); },
    (copy) => { copy.candidate.daemon.pid++; },
    (copy) => { copy.candidate.web.processes[0].startTicks += "0"; },
    (copy) => { copy.candidate.web.processes[0].commandLineDigest = "b".repeat(64); },
    (copy) => { copy.candidate.web.pm2.createdAt++; },
    (copy) => { copy.candidate.web.pm2.metadataHash = "b".repeat(64); },
    (copy) => { copy.resumed.candidate.web.pm2.restartTime++; },
    (copy) => { copy.resumed.candidate.pauseExpected = "1"; },
    (copy) => { copy.resumed.worker.pm2.pmId++; },
    (copy) => { copy.resumed.worker.processes[0].cwdIdentity = "2:2:3:4:5:1:0:33261"; },
    (copy) => { copy.resumed.worker = null; },
  ]) {
    const copy = structuredClone(state); mutate(copy);
    assert.throws(() => validateMaintenanceLaunchProofBindings(copy), /maintenance_launch_binding_invalid/);
  }
  const recovered = structuredClone(state); recovered.candidate = recovered.resumed.candidate; recovered.resumed = null;
  assert.equal(validateMaintenanceLaunchProofBindings(recovered), true, "reconciled pause0 web may be saved solely for exact shutdown");
});

function checkpointFixture(withWorker = false) {
  const f = fixture("candidate"), state = f.state(); state.phase = "resuming";
  state.runtime.worker = { state: withWorker ? "running" : "absent" };
  addConfirmed(state, "resumed-web"); if (withWorker) addConfirmed(state, "worker");
  const managed = (role) => {
    const { pmId, createdAt, pmUptime, restartTime, metadataDigest, ...process } = state.launchJournal.slots[role].instance;
    return { pm2: { pmId, createdAt, pmUptime, restartTime, metadataHash: metadataDigest }, processes: [process] };
  };
  const candidate = { targetSha: target, pauseExpected: "0", disk: structuredClone(state.launchDisk), daemon: daemon(), web: managed("resumed-web") };
  const payload = { candidate, resumed: withWorker ? { candidate, worker: managed("worker") } : null };
  return { ...f, current: state, payload, callbacks: createMaintenanceLaunchCallbacks(state, f.ops) };
}

test("partial-resume checkpoint durably saves real complete proof before runtime cleanup, without a new launch", async () => {
  for (const worker of [false, true]) {
    const f = checkpointFixture(worker); await f.callbacks.checkpoint(f.payload);
    assert.deepEqual(f.state().candidate, f.payload.candidate); assert.deepEqual(f.state().resumed, f.payload.resumed);
    assert.deepEqual(f.events, ["validateProofs", "save:resuming"]);
    // Runtime's subsequent deletion is simulated. fail-held must consume the
    // saved proof; it may not demand that the deleted process be live again.
    f.ops.reconcileMaintenanceLaunches = async () => { throw new Error("must not recapture deleted checkpoint"); };
    assert.equal((await runMaintenanceAction(request("fail-held"), f.ops)).state, "failed-held");
    assert.equal(f.events.includes(worker ? "stopResumed" : "stopCandidate"), true);
    assert.equal(f.events.some((event) => event.startsWith("send:")), false);
  }
});

test("checkpoint rejection or ambiguous persistence grants no delete acknowledgement and cannot be retried", async () => {
  const f = checkpointFixture(true); let deleted = 0;
  f.ops.save = async () => { throw new Error("directory fsync unknown"); };
  await assert.rejects(async () => { await f.callbacks.checkpoint(f.payload); deleted++; }, /directory fsync unknown/);
  await assert.rejects(f.callbacks.checkpoint(f.payload), /persistence_unconfirmed/);
  assert.equal(deleted, 0);
  for (const mutate of [
    (copy) => { copy.candidate.disk.runtime += "0"; },
    (copy) => { copy.candidate.web.pm2.metadataHash = "b".repeat(64); },
    (copy) => { copy.resumed.worker.processes[0].pid++; },
    (copy) => { copy.resumed.worker = null; },
    (copy) => { copy.extra = true; },
  ]) {
    const rejected = checkpointFixture(true), copy = structuredClone(rejected.payload); mutate(copy);
    await assert.rejects(rejected.callbacks.checkpoint(copy));
    assert.equal(rejected.events.some((event) => event.startsWith("save:")), false);
    assert.equal(rejected.current.resumed, null);
  }
});

test("checkpoint cannot lose existing worker proof or invoke accessor fields", async () => {
  const f = checkpointFixture(true); await f.callbacks.checkpoint(f.payload);
  const writes = f.events.filter((event) => event.startsWith("save:")).length;
  await f.callbacks.checkpoint(structuredClone(f.payload));
  await assert.rejects(f.callbacks.checkpoint({ candidate: f.payload.candidate, resumed: null }), /checkpoint_invalid/);
  assert.equal(f.events.filter((event) => event.startsWith("save:")).length, writes);
  let accessed = 0;
  await assert.rejects(f.callbacks.checkpoint({ get candidate() { accessed++; return f.payload.candidate; }, resumed: f.payload.resumed }), /checkpoint_invalid/);
  assert.equal(accessed, 0);
});
