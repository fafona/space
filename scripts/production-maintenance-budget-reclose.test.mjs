import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileFunction, createContext } from "node:vm";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION as AUTH } from "./production-maintenance-budget-recovery.mjs";

// Execute the actual private controller method and lock/load/save functions,
// not a copied implementation. Host effects and state-schema validation are
// deliberately bounded DI here; the separate controller/storage/pure suite
// proves the full state protocol. No real file, process, firewall or clock is
// changed. The advancing clock below models the real-current-clock input, not
// a historical audit clock or a production validation override.
const source = readFileSync(new URL("./production-maintenance-control.mjs", import.meta.url), "utf8");
function slice(start, end) {
  assert.equal(source.split(start).length, 2, "one exact production source marker");
  const at = source.indexOf(start), until = source.indexOf(end, at + start.length);
  assert.ok(until > at); return source.slice(at, until);
}
const method = slice("    async recloseAttemptIngress(state) {", "    async readAttemptRecoverySnapshot()");
const lockSource = slice("async function underExistingOperationLock(appName, action) {", "async function withPrivateOperationLock(");
const loadSource = slice("  const load = async () => {", "  const captureDatabase = () => {");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const copy = value => structuredClone(value);
const failure = code => { throw new Error(code); };
const BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";

function fixture() {
  const events = [], baselines = new WeakMap(), poisonedStates = new WeakSet(), attemptedReclosures = new WeakSet();
  const ownedOperationLocks = new Map(), expectedLock = { dev: 1, ino: 9 };
  let now = AUTH.expiresAt - 1, currentBoot = BOOT, token = "a".repeat(64), lockPresent = true;
  let afterEnvironment = () => {}, afterInstall = () => {}, installError = false, proofError = false;
  let lockStat = { ...expectedLock, uid: 0, mode: 0o40700 };
  const request = { action: "end", appName: "merchant-space" };
  const baseline = { version: 8, revision: 43, activeAttempt: 3, operationId: AUTH.operationId, targetSha: "e".repeat(40),
    expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6", appDir: "/www/wwwroot/merchant-space",
    appName: request.appName, appPort: 3000, bootId: BOOT, createdAt: 1789236034129, phase: "resuming",
    runtime: { fixture: "original-O-frozen-runtime" }, tokenHash: hash(token),
    attemptRecovery: { fixture: "immutable-first-attempt-audit" },
    secondAttemptRecovery: { fixture: "immutable-whole-v6-predecessor-and-both-consumed-journals" },
    budgetRecovery: { fixture: "immutable-whole-v7-predecessor-and-three-consumed-journals" },
    ingress: { fixture: "already-validated-config-and-own-rule-anchors" } };
  const tokenPath = "/var/lib/faolla-maintenance/merchant-space/control.token";
  const context = createContext({});
  const lock = compileFunction(lockSource + "\nreturn underExistingOperationLock;",
    ["ownedOperationLocks", "ROOT", "lstatSync", "failure"], { parsingContext: context })(ownedOperationLocks,
    "/var/lib/faolla-maintenance", file => {
      events.push("lock-check"); assert.equal(file, "/var/lib/faolla-maintenance/merchant-space/operation.lock");
      if (!lockPresent) throw new Error("synthetic lock disappeared");
      return { ...lockStat, isDirectory: () => lockStat.directory !== false, isSymbolicLink: () => lockStat.symlink === true };
    }, failure);
  ownedOperationLocks.set(request.appName, expectedLock);
  const store = {
    async readOperationUnderExistingOperationLock() {
      events.push("load-current-clock");
      // This is the store captureState admission seam, not a pure-proof mock.
      // Full actual pure validation is covered by budget-control.test.mjs.
      if (now >= AUTH.expiresAt) throw new Error("synthetic actual deadline expired");
      return { state: copy(baseline), revision: baseline.revision, digest: hash(JSON.stringify(baseline)) };
    },
    async replaceOperationUnderExistingOperationLock() {
      events.push("save-current-clock");
      if (now >= AUTH.expiresAt) throw new Error("synthetic actual deadline expired");
      assert.fail("this suite never authorizes a state write");
    },
  };
  const { load, save } = compileFunction(loadSource + "\nreturn { load, save };",
    ["store", "clone", "baselines", "poisonedStates", "failure"], { parsingContext: context })(store, copy, baselines, poisonedStates, failure);
  const runtime = {
    async readRuntimeHandoffEnvironment(proof) {
      events.push("environment"); assert.deepEqual(proof, baseline.runtime); afterEnvironment(); return { anonKey: "synthetic-anon-key" };
    },
    startCandidate() { assert.fail("no start capability"); }, resumeCandidate() { assert.fail("no resume capability"); },
  };
  const installed = { fixture: "new-structural-installation-proof-NOT-held" };
  const ingress = {
    async installIngress(proof, actualToken, options) {
      events.push("install"); assert.equal(proof, baselines.get(state)?.state.ingress);
      assert.deepEqual(proof, baseline.ingress); assert.equal(actualToken, "a".repeat(64));
      assert.equal(options.probeControlServices, false);
      assert.deepEqual(Object.keys(options).sort(), ["probeControlServices", "probeHeaders"]);
      assert.equal(options.probeHeaders.apikey, "synthetic-anon-key");
      assert.equal(options.probeHeaders.authorization, "Bearer synthetic-anon-key");
      afterInstall(); if (installError) throw new Error("synthetic install outcome unknown"); return installed;
    },
    restoreIngress() { assert.fail("no reopen capability"); },
    verifyIngress() { assert.fail("no new held certificate"); },
  };
  const reclose = compileFunction("return ({\n" + method + "\n}).recloseAttemptIngress;",
    ["baselines", "attemptedReclosures", "request", "equal", "bootId", "failure", "underExistingOperationLock",
      "validateProofs", "readPrivate", "tokenPath", "digest", "runtime", "ingress"], { parsingContext: context })(
    baselines, attemptedReclosures, request, isDeepStrictEqual, () => currentBoot, failure, lock,
    proof => { events.push("validate-anchored-proof"); assert.equal(proof, baselines.get(state)?.state); if (proofError) throw new Error("synthetic changed proof"); },
    (path, limit) => { events.push("read-token"); assert.equal(path, tokenPath); assert.equal(limit, 64); return token; },
    tokenPath, hash, runtime, ingress);
  let state;
  return { events, baseline, request, baselines, attemptedReclosures, poisonedStates, ownedOperationLocks, runtime, installed, reclose, load, save,
    async admit() { state = await load(); return state; },
    get state() { return state; }, get now() { return now; },
    setNow(value) { now = value; }, setBoot(value) { currentBoot = value; }, setToken(value) { token = value; },
    setLock(value) { lockPresent = value; }, patchLock(value) { lockStat = { ...lockStat, ...value }; },
    afterEnvironment(fn) { afterEnvironment = fn; }, afterInstall(fn) { afterInstall = fn; },
    failInstall() { installError = true; }, failProof() { proofError = true; } };
}

test("private capability is extracted from the actual source and remains absent from CLI actions/exports", () => {
  assert.match(method, /baselines\.get\(state\)/);
  assert.match(method, /attemptedReclosures\.add\(state\)/);
  assert.match(method, /ingress\.installIngress\(baseline\.ingress, token, \{ probeControlServices: false/);
  assert.doesNotMatch(method, /\b(?:load|save|restoreIngress|startCandidate|resumeCandidate|validateMaintenanceState)\s*\(/);
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function\s+recloseAttemptIngress/);
  assert.match(source, /const snapshot = await store\.readOperationUnderExistingOperationLock\(\);\s*const state = clone\(snapshot\.state\); baselines\.set\(state, snapshot\)/);
  const capture = slice("    captureState: (value) => {", "  // Each loaded object keeps its OWN baseline.");
  assert.match(capture, /validateMaintenanceState\(value,[\s\S]*bootId\(\), Date\.now\(\)\)/);
  assert.match(capture, /validateProofs\(value\); return value/);
});
test("already-admitted invocation can reclose once after expiry using only original anchors", async () => {
  const f = fixture(), state = await f.admit(), original = copy(state);
  f.setNow(AUTH.expiresAt + 1); state.ingress = { attacker: "never passed to installer" };
  assert.equal(await f.reclose(state), f.installed); assert.equal(f.now, AUTH.expiresAt + 1);
  assert.deepEqual(f.events, ["load-current-clock", "lock-check", "validate-anchored-proof", "read-token", "environment", "install", "lock-check"]);
  assert.deepEqual(f.baselines.get(state).state, original); assert.deepEqual(state.ingress, { attacker: "never passed to installer" });
  await assert.rejects(f.reclose(state), /maintenance_attempt_reclose_unverified/);
  assert.equal(f.events.filter(x => x === "install").length, 1);
});
test("unadmitted objects and new expired loads cannot acquire the in-memory capability", async () => {
  const f = fixture(), state = await f.admit();
  await assert.rejects(f.reclose(copy(state)), /maintenance_attempt_reclose_unverified/);
  await assert.rejects(f.reclose({ ...state, version: 5 }), /maintenance_attempt_reclose_unverified/);
  f.setNow(AUTH.expiresAt); await assert.rejects(f.load(), /actual deadline expired/);
  assert.equal(f.events.includes("install"), false); assert.equal(f.events.includes("lock-check"), false);
});
test("every fixed binding and unsupported request action rejects before host I/O", async () => {
  for (const key of ["version", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "runtime", "tokenHash", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery"]) {
    const f = fixture(), state = await f.admit(); state[key] = "changed";
    await assert.rejects(f.reclose(state), /maintenance_attempt_reclose_unverified/); assert.deepEqual(f.events, ["load-current-clock"]);
  }
  for (const action of ["prepare", "recover-attempt", "recover-second-attempt", "recover-budget", "inspect-budget-recovery", "snapshot-pair", "check-held", "runtime-handoff", "snapshot-web", ""] ) {
    const f = fixture(), state = await f.admit(); f.request.action = action;
    await assert.rejects(f.reclose(state), /maintenance_attempt_reclose_unverified/); assert.deepEqual(f.events, ["load-current-clock"]);
  }
  for (const action of ["start-candidate", "end", "fail-held"]) {
    const f = fixture(); f.request.action = action; assert.equal(await f.reclose(await f.admit()), f.installed);
  }
});
test("current boot, missing/replaced/unsafe/unowned lock all prevent installation", async () => {
  for (const change of [f => f.setBoot("changed"), f => f.setLock(false), f => f.ownedOperationLocks.clear(),
    f => f.patchLock({ ino: 10 }), f => f.patchLock({ uid: 1000 }), f => f.patchLock({ mode: 0o40777 }),
    f => f.patchLock({ directory: false }), f => f.patchLock({ symlink: true })]) {
    const f = fixture(), state = await f.admit(); change(f); await assert.rejects(f.reclose(state));
    assert.equal(f.events.includes("install"), false);
  }
});
test("token/proof/environment drift rejects and consumes the attempt without exposing bytes", async () => {
  for (const change of [f => f.setToken("b".repeat(64)), f => f.setToken("a".repeat(63)), f => f.setToken("PRIVATE_SECRET\n"),
    f => f.failProof(), f => { f.runtime.readRuntimeHandoffEnvironment = async () => ({ anonKey: "" }); },
    f => { f.runtime.readRuntimeHandoffEnvironment = async () => ({ anonKey: "bad\nheader" }); },
    f => f.afterEnvironment(() => f.setBoot("changed"))]) {
    const f = fixture(), state = await f.admit(); change(f); await assert.rejects(f.reclose(state));
    assert.equal(f.events.includes("install"), false); assert.equal(f.attemptedReclosures.has(state), true);
    await assert.rejects(f.reclose(state), /maintenance_attempt_reclose_unverified/);
  }
});
test("poisoned expired save still permits one protective close but never a later write", async () => {
  const f = fixture(), state = await f.admit(); f.setNow(AUTH.expiresAt);
  await assert.rejects(f.save(state), /actual deadline expired/); assert.equal(f.poisonedStates.has(state), true);
  assert.equal(await f.reclose(state), f.installed);
  const writes = f.events.filter(x => x === "save-current-clock").length;
  await assert.rejects(f.save(state), /maintenance_state_write_unconfirmed/);
  assert.equal(f.events.filter(x => x === "save-current-clock").length, writes);
});
test("unknown install, post-install boot drift or lock loss does not retry or manufacture confirmation", async () => {
  for (const change of [f => f.failInstall(), f => f.afterInstall(() => f.setBoot("changed")), f => f.afterInstall(() => f.patchLock({ ino: 10 }))]) {
    const f = fixture(), state = await f.admit(); change(f); await assert.rejects(f.reclose(state));
    assert.equal(f.events.filter(x => x === "install").length, 1);
    await assert.rejects(f.reclose(state), /maintenance_attempt_reclose_unverified/);
    assert.equal(f.events.filter(x => x === "install").length, 1);
  }
});
