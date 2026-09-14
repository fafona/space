import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { withPrelaunchRecoveryFixture } from "./test-helpers/maintenance-prelaunch-fixture.mjs";
import { MAINTENANCE_WINDOW_RENEWAL_INCIDENT as WINDOW, MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION as WINDOW_AUTH,
  validateMaintenanceWindowRenewalState } from "./production-maintenance-window-renewal.mjs";
import { transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";
import { MAINTENANCE_PRELAUNCH_RECOVERY_INCIDENT as INCIDENT, MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION as AUTH,
  MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION_DIGEST as AUTH_DIGEST,
  createMaintenancePrelaunchRecoveryInspection, validateMaintenancePrelaunchRecoveryInspection,
  validateMaintenancePrelaunchRecoveryEvidence, encodeMaintenancePrelaunchRecoveryEvidence, decodeMaintenancePrelaunchRecoveryEvidence,
  validateMaintenancePrelaunchRecoveryPredecessor, buildMaintenancePrelaunchRecoveredState,
  validateMaintenancePrelaunchRecoveryState, reconstructMaintenancePrelaunchRecoveryPredecessor,
  assertMaintenancePrelaunchRecoveryProgress } from "./production-maintenance-prelaunch-recovery.mjs";

const NOW = Date.parse("2026-09-14T17:00:00Z"), TARGET = "e".repeat(40);
const reject = action => assert.throws(action, error => error.message === "maintenance_prelaunch_recovery_invalid" && error.cause === undefined);
const LAUNCH = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const FIXED = ["operationId", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "runtime", "database", "publicSupabaseUrl",
  "tokenHash", "recovery", "continuation", "buildRecovery", "deadlineExtension", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal"];

/** TEST ONLY. The shared helper maps four exact synthetic historical states.
 * This callback adds exactly ONE complete synthetic failed-v9 byte string.
 * Padding is inert synthetic ingress, NOT a real production host proof.
 * Every other byte string/algorithm uses real crypto; all hooks are restored.
 * No real private state is checked in and production has no hash override. */
test("one fixed prelaunch recovery carries the original unused attempt without re-anchoring", { concurrency: false }, async t =>
  withPrelaunchRecoveryFixture(t, async base => {
    const { hash, copy, originalCreateHash, launch, seed, v6, v7, predecessor, initialV9, failedV9,
      fixture, build, nextState, journalSteps, clock } = base;
    await t.test("production pins are literal and only exact synthetic bytes map to them", () => {
      assert.equal(INCIDENT.previousTargetSha, "67ddb91bf618e9716b79df6bf97f08d3865919b7");
      assert.equal(INCIDENT.stateDigest, "0a2a2e989e9da7e914a181ae27c3468d2f2a455f78404d8b546824ca3346f70c");
      assert.equal(INCIDENT.stateBytes, 1746788); assert.equal(INCIDENT.revision, 35);
      assert.equal(Buffer.byteLength(JSON.stringify(predecessor)), INCIDENT.stateBytes);
      assert.equal(crypto.createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"), INCIDENT.stateDigest);
      assert.notEqual(hash(predecessor), INCIDENT.stateDigest);
      assert.equal(crypto.createHash("sha256").update(JSON.stringify(predecessor) + " ").digest("hex"), originalCreateHash("sha256").update(JSON.stringify(predecessor) + " ").digest("hex"));
      assert.equal(crypto.createHash("sha512").update(JSON.stringify(predecessor)).digest("hex"), originalCreateHash("sha512").update(JSON.stringify(predecessor)).digest("hex"));
      assert.equal(AUTH.authorizedAt, Date.parse("2026-09-14T15:00:32Z")); assert.equal(AUTH.expiresAt, Date.parse("2026-09-14T20:00:00Z"));
      assert.equal(AUTH.previousExpiresAt, WINDOW_AUTH.expiresAt); assert.equal(AUTH_DIGEST, hash(AUTH));
      assert.equal(AUTH.maximumAdditionalAttempts, 0); assert.equal(AUTH.maximumRemainingAttempts, 1);
      assert(Object.isFrozen(AUTH)); assert(Object.isFrozen(INCIDENT));
    });
    await t.test("exact failed v9 becomes v10 held rev36 with five null fields and no new attempt", () => {
      const f = fixture(), next = build(f);
      assert.equal(next.version, 10); assert.equal(next.revision, 36); assert.equal(next.phase, "held"); assert.equal(next.activeAttempt, 3);
      for (const key of LAUNCH) assert.equal(next[key], null);
      for (const key of [...FIXED, "ingress"]) assert.deepEqual(next[key], predecessor[key]);
      assert.deepEqual(Object.keys(next.prelaunchRecovery.predecessor), ["version", "revision", "targetSha", "phase", "stateDigest", "stateBytes", "ingress"]);
      assert(!Object.hasOwn(next.prelaunchRecovery.predecessor, "state"));
      assert.equal(JSON.stringify(reconstructMaintenancePrelaunchRecoveryPredecessor(next, clock())), JSON.stringify(predecessor));
      assert.equal((JSON.stringify(next).match(/"budgetRecovery":/g) || []).length, 1);
      assert.equal((JSON.stringify(next).match(/"windowRenewal":/g) || []).length, 1);
      assert(Buffer.byteLength(JSON.stringify(next)) < INCIDENT.stateBytes * 2);
      assertMaintenancePrelaunchRecoveryProgress(f.state, next);
      assert(Object.isFrozen(next.prelaunchRecovery.predecessor.ingress)); assert.deepEqual(f.state, predecessor);
    });
    await t.test("actual 15:00:32..20 clock is distinct from immutable historical v9 validation", () => {
      const f = fixture(), next = build(f);
      validateMaintenancePrelaunchRecoveryPredecessor(f.state, clock());
      assert.throws(() => validateMaintenanceWindowRenewalState(f.state, clock()));
      validateMaintenanceWindowRenewalState(f.state, clock(AUTH.authorizedAt));
      for (const now of [AUTH.authorizedAt - 1, AUTH.expiresAt, AUTH.expiresAt + 1, NaN, Infinity]) {
        reject(() => validateMaintenancePrelaunchRecoveryPredecessor(f.state, clock(now)));
        reject(() => validateMaintenancePrelaunchRecoveryState(next, clock(now)));
        reject(() => reconstructMaintenancePrelaunchRecoveryPredecessor(next, clock(now)));
      }
      validateMaintenancePrelaunchRecoveryPredecessor(f.state, clock(AUTH.authorizedAt));
      validateMaintenancePrelaunchRecoveryState(next, clock(AUTH.expiresAt - 1));
      const early = fixture(); early.context.now = AUTH.authorizedAt; early.context.stoppedBaseline.observedAt = AUTH.authorizedAt;
      early.inspection = createMaintenancePrelaunchRecoveryInspection(early.state, early.context);
      early.evidence = { ...early.evidence, ...early.inspection, historyCheckedAt: AUTH.authorizedAt };
      validateMaintenancePrelaunchRecoveryState(build(early), clock(WINDOW_AUTH.expiresAt - 1));
      validateMaintenancePrelaunchRecoveryState(build(early), clock(WINDOW_AUTH.expiresAt));
      reject(() => validateMaintenancePrelaunchRecoveryState(next, { ...clock(), bootId: "00000000-0000-4000-8000-000000000000" }));
      reject(() => validateMaintenancePrelaunchRecoveryPredecessor(f.state, { ...clock(), historicalAuditClock: NOW }));
    });
    await t.test("only exact v9 rev35 failed-held with the unused journal is eligible", () => {
      for (const patch of [{ revision: 34 }, { activeAttempt: 4 }, { phase: "held" }, { phase: "failed-unknown" }, { targetSha: TARGET }, { version: 8 },
        { candidate: {} }, { launchJournal: {} }, { launchDisk: {} }, { resumed: {} }, { finalDump: {} }, { extra: true }]) {
        reject(() => validateMaintenancePrelaunchRecoveryPredecessor({ ...copy(predecessor), ...patch }, clock()));
      }
      for (const key of FIXED.filter(key => typeof predecessor[key] === "object")) {
        const state = copy(predecessor); state[key].changed = true; reject(() => validateMaintenancePrelaunchRecoveryPredecessor(state, clock()));
      }
      const altered = copy(predecessor); altered.ingress.padding = altered.ingress.padding.slice(1);
      reject(() => validateMaintenancePrelaunchRecoveryPredecessor(altered, clock()));
    });
    await t.test("all previous targets and wrong source migration CAS fields are rejected", () => {
      for (const patch of [{ operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { expectedRevision: 34 }, { expectedDigest: "0".repeat(64) },
        { previousTargetSha: TARGET }, { expectedOldSha: TARGET }, { sourceDiffDigest: "wrong" }, { migrationDigest: "wrong" }, { extra: true }]) {
        const f = fixture(); reject(() => buildMaintenancePrelaunchRecoveredState(f.state, f.evidence, { ...f.context, ...patch }));
      }
      for (const targetSha of [INCIDENT.previousTargetSha, WINDOW.previousTargetSha, base.BUDGET.previousTargetSha, base.SECOND.previousTargetSha,
        base.INCIDENT.previousTargetSha, INCIDENT.expectedOldSha, "1b09cdbf25ec1b4164e200486f009500b6551ed4",
        "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf", "46f007fbd9e417f93c01e398c77cf38ec814547d", "13df917416cf06ce27fce021460b08caf50f6165", "78ca8104442172baf046b62f9184cf9c7f6a9279"]) {
        const f = fixture(); reject(() => createMaintenancePrelaunchRecoveryInspection(f.state, { ...f.context, targetSha }));
      }
      for (const key of ["sourceDiffDigest", "migrationDigest", "stoppedBaselineDigest", "predecessorJournalDigest"]) {
        const f = fixture(); f.evidence[key] = "0".repeat(64); reject(() => build(f));
      }
    });
    await t.test("fresh baseline retains exact T7 identity and registry, changing only observation time", () => {
      const f = fixture(); assert.equal(f.inspection.state, "prelaunch-recovery-inspected");
      assert.equal(f.inspection.predecessorJournalDigest, hash(null)); assert.equal(f.inspection.stoppedBaseline.launchJournalDigest, hash(v7.launchJournal));
      assert.deepEqual(validateMaintenancePrelaunchRecoveryInspection(f.inspection), f.inspection);
      for (const key of ["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"]) {
        const bad = fixture(); bad.context.stoppedBaseline[key] = "0".repeat(64); reject(() => createMaintenancePrelaunchRecoveryInspection(bad.state, bad.context));
      }
      for (const mutate of [b => { b.current.linkIdentity = "1:99:3:4:5:1:0:33188"; },
        b => { b.current.runtimeIdentity = "1:99:3:4:5:1:0:33188"; }, b => { b.current.target = "/srv/faolla.releases/" + TARGET.slice(0, 12) + "-20260914150000"; },
        b => { b.bootId = "00000000-0000-4000-8000-000000000000"; }, b => { b.version = 4; }]) {
        const bad = fixture(); mutate(bad.context.stoppedBaseline); reject(() => createMaintenancePrelaunchRecoveryInspection(bad.state, bad.context));
      }
      for (const observedAt of [NOW + 1, NOW - 300001, AUTH.authorizedAt - 1]) {
        const bad = fixture(); bad.context.stoppedBaseline.observedAt = observedAt; reject(() => createMaintenancePrelaunchRecoveryInspection(bad.state, bad.context));
      }
    });
    await t.test("B9 R9 D9 previous renewal and CI are exact, none can replace the fresh run", () => {
      const f = fixture();
      assert.equal(f.inspection.backupRunId, "34852696974"); assert.equal(f.inspection.readinessRunId, "34855754738");
      assert.equal(f.inspection.failedDeployRunId, "34855913697"); assert.equal(f.inspection.migrationRunId, "34721155156");
      assert.equal(f.inspection.priorRecoveryRunId, "34852190872"); assert.equal(f.inspection.priorMainCIrunId, "34850320013");
      for (const key of Object.keys(INCIDENT).filter(key => /RunId$|RunAttempt$/.test(key))) {
        const bad = copy(f.evidence); bad[key] = key.endsWith("Attempt") ? 2 : "1"; reject(() => validateMaintenancePrelaunchRecoveryEvidence(bad));
      }
      for (const run of [INCIDENT.priorRecoveryRunId, INCIDENT.priorMainCIrunId, INCIDENT.backupRunId, INCIDENT.readinessRunId, INCIDENT.failedDeployRunId,
        "34826545330", "34825984301", "34800461043"]) {
        reject(() => validateMaintenancePrelaunchRecoveryEvidence({ ...f.evidence, prelaunchRecoveryRunId: run }));
        reject(() => validateMaintenancePrelaunchRecoveryEvidence({ ...f.evidence, mainCIrunId: run }));
      }
      for (const patch of [{ prelaunchRecoveryRunAttempt: 2 }, { prelaunchRecoveryRunId: "01" }, { prelaunchRecoveryRunId: 123 },
        { mainCIrunId: f.evidence.prelaunchRecoveryRunId }, { toolsSha: INCIDENT.previousTargetSha }]) {
        reject(() => validateMaintenancePrelaunchRecoveryEvidence({ ...f.evidence, ...patch }));
      }
    });
    await t.test("fresh history and baseline remain within five minutes at final builder time", () => {
      for (const historyCheckedAt of [NOW + 1, NOW - 300001, AUTH.authorizedAt - 1, AUTH.expiresAt]) {
        const f = fixture(); f.evidence.historyCheckedAt = historyCheckedAt; reject(() => build(f));
      }
      const f = fixture();
      reject(() => buildMaintenancePrelaunchRecoveredState(f.state, f.evidence, { ...f.context, now: NOW + 300000 }));
      reject(() => buildMaintenancePrelaunchRecoveredState(f.state, f.evidence, { ...f.context, now: AUTH.expiresAt }));
    });
    await t.test("canonical codec rejects reordered duplicate malformed oversized encodings and hidden properties", () => {
      const f = fixture(), canonical = encodeMaintenancePrelaunchRecoveryEvidence(f.evidence);
      assert.deepEqual(decodeMaintenancePrelaunchRecoveryEvidence(canonical), f.evidence);
      for (const value of [canonical + "=", "", "a".repeat(16385), Buffer.from("{").toString("base64url"),
        Buffer.from(JSON.stringify(f.evidence).replace('"version":1', '"version":1,"version":1')).toString("base64url"),
        Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse()))).toString("base64url"), Buffer.from([0xff]).toString("base64url")]) {
        reject(() => decodeMaintenancePrelaunchRecoveryEvidence(value));
      }
      let touched = false; const getter = copy(f.evidence);
      Object.defineProperty(getter, "historyDigest", { enumerable: true, get() { touched = true; return "a".repeat(64); } });
      reject(() => validateMaintenancePrelaunchRecoveryEvidence(getter)); assert.equal(touched, false);
      reject(() => validateMaintenancePrelaunchRecoveryEvidence(new Proxy(f.evidence, {})));
      for (const corrupt of [x => Object.defineProperty(x, "hidden", { value: true }), x => { x[Symbol("extra")] = 1; },
        x => Object.setPrototypeOf(x, { inherited: true }), x => { x.extra = [,]; }]) {
        const bad = copy(f.evidence); corrupt(bad); reject(() => validateMaintenancePrelaunchRecoveryEvidence(bad));
      }
    });
    await t.test("the state four MiB, depth64 and node100000 bounds remain hard", () => {
      const f = fixture();
      const huge = copy(f.state); huge.extra = "x".repeat(4 * 1024 * 1024); reject(() => validateMaintenancePrelaunchRecoveryPredecessor(huge, clock()));
      const deep = copy(f.state); let leaf = deep; for (let i = 0; i < 66; i++) leaf = leaf.extra = {};
      reject(() => validateMaintenancePrelaunchRecoveryPredecessor(deep, clock()));
      const many = copy(f.state); many.extra = Array.from({ length: 100000 }, () => ({}));
      reject(() => validateMaintenancePrelaunchRecoveryPredecessor(many, clock()));
    });
    await t.test("every old audit plus new authorization and compact predecessor remains immutable", () => {
      const start = build(fixture());
      for (const key of [...FIXED.filter(k => typeof start[k] === "object"), "prelaunchRecovery"]) {
        const next = nextState(start); next[key].changed = true; reject(() => assertMaintenancePrelaunchRecoveryProgress(start, next));
      }
      for (const patch of [{ version: 8 }, { revision: 36 }, { targetSha: TARGET }, { phase: "held" }, { stateDigest: "0".repeat(64) }, { stateBytes: 1 }]) {
        const next = copy(start); Object.assign(next.prelaunchRecovery.predecessor, patch); reject(() => validateMaintenancePrelaunchRecoveryState(next, clock()));
      }
      for (const key of ["expiresAt", "authorizedAt", "previousExpiresAt", "activeAttempt", "maximumAdditionalAttempts", "maximumRemainingAttempts"]) {
        const next = copy(start); next.prelaunchRecovery.authorization[key]++; reject(() => validateMaintenancePrelaunchRecoveryState(next, clock()));
      }
      const changed = copy(start); changed.prelaunchRecovery.predecessor.ingress.changed = true; reject(() => validateMaintenancePrelaunchRecoveryState(changed, clock()));
      const initialIngress = copy(start); initialIngress.ingress.changed = true; reject(() => validateMaintenancePrelaunchRecoveryState(initialIngress, clock()));
      const deleted = nextState(start); delete deleted.prelaunchRecovery; reject(() => assertMaintenancePrelaunchRecoveryProgress(start, deleted));
      const oldAuditDeleted = nextState(start); delete oldAuditDeleted.windowRenewal; reject(() => assertMaintenancePrelaunchRecoveryProgress(start, oldAuditDeleted));
    });
    await t.test("durable journal transitions retain all three historical generations and the real new target", () => {
      const start = build(fixture()), { saved, candidate } = journalSteps(start);
      assert.deepEqual(saved.slice(0, 3).map(state => state.launchJournal.slots["paused-web"]?.phase ?? null), [null, "planned", "attempted"]);
      validateMaintenancePrelaunchRecoveryState(candidate, clock()); assert.equal(candidate.targetSha, TARGET); assert.equal(candidate.launchJournal.targetSha, TARGET);
      assert.equal(JSON.stringify(reconstructMaintenancePrelaunchRecoveryPredecessor(candidate, clock())), JSON.stringify(predecessor));
      const changedIngress = nextState(candidate); changedIngress.ingress.bookkeeping = "changed";
      assertMaintenancePrelaunchRecoveryProgress(candidate, changedIngress);
      assert.equal(JSON.stringify(reconstructMaintenancePrelaunchRecoveryPredecessor(changedIngress, clock())), JSON.stringify(predecessor));
      const skipped = { ...copy(candidate), revision: start.revision + 1 }; reject(() => assertMaintenancePrelaunchRecoveryProgress(start, skipped));
      for (const old of [seed, v6, v7]) {
        const invalid = { ...nextState(start), ...launch(start, old.launchJournal.slots["paused-web"].nonce), phase: "candidate" };
        reject(() => validateMaintenancePrelaunchRecoveryState(invalid, clock()));
      }
      for (const key of ["candidate", "launchJournal", "launchDisk"]) {
        const next = nextState(candidate); next[key] = null; reject(() => assertMaintenancePrelaunchRecoveryProgress(candidate, next));
      }
      const reset = nextState(saved[2]); reset.launchJournal.slots["paused-web"] = null; reject(() => assertMaintenancePrelaunchRecoveryProgress(saved[2], reset));
      const replacement = nextState(candidate); Object.assign(replacement, launch(candidate, "88888888-2222-4333-8444-555555555555"));
      reject(() => assertMaintenancePrelaunchRecoveryProgress(candidate, replacement));
      const ended = { ...nextState(candidate), phase: "ended" }; reject(() => validateMaintenancePrelaunchRecoveryState(ended, clock()));
    });
    await t.test("unknown send result can be recorded once, never cleared or promoted by a second launch", () => {
      const { saved } = journalSteps(build(fixture())), attempted = saved[2], slot = attempted.launchJournal.slots["paused-web"];
      const binding = { operationId: attempted.operationId, targetSha: attempted.targetSha, appName: attempted.appName, appPort: attempted.appPort,
        daemon: attempted.launchJournal.daemon, release: attempted.launchJournal.release };
      const unknown = { ...nextState(attempted), launchJournal: transitionMaintenanceLaunch(attempted.launchJournal, binding,
        { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "unknown" }) };
      assertMaintenancePrelaunchRecoveryProgress(attempted, unknown);
      const failed = { ...nextState(unknown), phase: "failed-held" }; assertMaintenancePrelaunchRecoveryProgress(unknown, failed);
      const cleared = nextState(failed); cleared.launchJournal = null; cleared.launchDisk = null;
      reject(() => assertMaintenancePrelaunchRecoveryProgress(failed, cleared));
      reject(() => assertMaintenancePrelaunchRecoveryProgress(failed, { ...nextState(failed), phase: "held" }));
    });
    await t.test("only the initial fixed CAS can failed-held to held, never a subsequent recovery or downgrade", () => {
      const f = fixture(), start = build(f), candidate = journalSteps(start).candidate;
      for (const patch of [{ revision: start.revision }, { revision: start.revision + 2 }, { activeAttempt: 4 }, { targetSha: "c".repeat(40) },
        { phase: "resuming" }, { phase: "ended" }]) reject(() => assertMaintenancePrelaunchRecoveryProgress(start, { ...nextState(start), ...patch }));
      const failed = { ...nextState(candidate), phase: "failed-held" }; assertMaintenancePrelaunchRecoveryProgress(candidate, failed);
      for (const phase of ["held", "candidate", "resuming", "ended"]) reject(() => assertMaintenancePrelaunchRecoveryProgress(failed, { ...nextState(failed), phase }));
      reject(() => buildMaintenancePrelaunchRecoveredState(start, f.evidence, f.context));
      reject(() => assertMaintenancePrelaunchRecoveryProgress(start, { ...copy(predecessor), revision: start.revision + 1 }));
      assertMaintenancePrelaunchRecoveryProgress(initialV9, failedV9); // unchanged legacy delegation
      const attached = { ...copy(failedV9), prelaunchRecovery: start.prelaunchRecovery };
      reject(() => assertMaintenancePrelaunchRecoveryProgress(initialV9, attached));
      assert.equal(predecessor.windowRenewal.authorization.expiresAt, WINDOW_AUTH.expiresAt);
    });
  }));
