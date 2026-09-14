import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validateMaintenanceBudgetRecoveryState } from "./production-maintenance-budget-recovery.mjs";
import { MAINTENANCE_WINDOW_RENEWAL_INCIDENT as WINDOW, MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION as WINDOW_AUTH,
  MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION_DIGEST as WINDOW_AUTH_DIGEST,
  createMaintenanceWindowRenewalInspection, validateMaintenanceWindowRenewalInspection,
  validateMaintenanceWindowRenewalEvidence, encodeMaintenanceWindowRenewalEvidence, decodeMaintenanceWindowRenewalEvidence,
  validateMaintenanceWindowRenewalPredecessor, buildMaintenanceWindowRenewedState,
  validateMaintenanceWindowRenewalState, reconstructMaintenanceWindowRenewalPredecessor,
  assertMaintenanceWindowRenewalProgress } from "./production-maintenance-window-renewal.mjs";
import { withWindowRenewalFixture } from "./test-helpers/maintenance-window-fixture.mjs";
const reject = action => assert.throws(action, error => error.message === "maintenance_window_renewal_invalid" && error.cause === undefined);

test("one compact renewal keeps the same unused launch and every original v8 byte", { concurrency: false }, async t =>
  withWindowRenewalFixture(t, async ({ seed, v6, v7, predecessor, fixture, build, nextState, journalSteps, hash, copy, clock, launch, originalCreateHash, INCIDENT, SECOND, BUDGET, AUTH, NOW, TARGET }) => {
  await t.test("exact predecessor bytes and new authorization are separate from the expired original", () => {
    assert.equal(Buffer.byteLength(JSON.stringify(predecessor)), 1570550);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"), WINDOW.stateDigest);
    assert.notEqual(hash(predecessor), WINDOW.stateDigest);
    assert.equal(crypto.createHash("sha512").update(JSON.stringify(predecessor)).digest("hex"),
      originalCreateHash("sha512").update(JSON.stringify(predecessor)).digest("hex"));
    assert.equal(crypto.createHash("sha256").update("unrelated").digest("hex"), originalCreateHash("sha256").update("unrelated").digest("hex"));
    validateMaintenanceWindowRenewalPredecessor(predecessor, clock());
    assert.throws(() => validateMaintenanceBudgetRecoveryState(predecessor, clock()));
    validateMaintenanceBudgetRecoveryState(predecessor, clock(predecessor.budgetRecovery.recoveredAt));
    assert.deepEqual(predecessor.budgetRecovery.authorization, AUTH);
    assert.equal(WINDOW_AUTH.previousExpiresAt, AUTH.expiresAt);
    assert.equal(WINDOW_AUTH_DIGEST, hash(WINDOW_AUTH));
    assert(Object.isFrozen(WINDOW_AUTH)); assert(Object.isFrozen(WINDOW));
    assert.equal(WINDOW_AUTH.maximumAdditionalAttempts, 0); assert.equal(WINDOW_AUTH.maximumRemainingAttempts, 1);
  });
  await t.test("only v9 rev33, same attempt3, compact ingress archive and exact reconstruction", () => {
    const f = fixture(), next = build(f);
    assert.equal(next.version, 9); assert.equal(next.revision, 33); assert.equal(next.activeAttempt, 3); assert.equal(next.phase, "held");
    for (const key of ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"]) assert.equal(next[key], null);
    for (const key of ["runtime", "ingress", "database", "tokenHash", "createdAt", "bootId", "recovery", "continuation", "buildRecovery",
      "deadlineExtension", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery"]) assert.deepEqual(next[key], predecessor[key]);
    assert.deepEqual(Object.keys(next.windowRenewal.predecessor), ["version", "revision", "targetSha", "phase", "stateDigest", "stateBytes", "ingress"]);
    assert(!Object.hasOwn(next.windowRenewal.predecessor, "state"));
    assert.equal(JSON.stringify(reconstructMaintenanceWindowRenewalPredecessor(next, clock())), JSON.stringify(predecessor));
    assert.equal((JSON.stringify(next).match(/"budgetRecovery":/g) || []).length, 1);
    assert(Buffer.byteLength(JSON.stringify(next)) < WINDOW.stateBytes * 2);
    assertMaintenanceWindowRenewalProgress(f.state, next);
    assert(Object.isFrozen(next.windowRenewal.predecessor.ingress)); assert.deepEqual(f.state, predecessor);
  });
  await t.test("real now has both absolute bounds and fixed boot; old clocks cannot renew", () => {
    const f = fixture(), next = build(f);
    for (const now of [WINDOW_AUTH.authorizedAt - 1, WINDOW_AUTH.previousExpiresAt, WINDOW_AUTH.expiresAt, WINDOW_AUTH.expiresAt + 1, NaN, Infinity]) {
      reject(() => validateMaintenanceWindowRenewalPredecessor(f.state, clock(now)));
      reject(() => validateMaintenanceWindowRenewalState(next, clock(now)));
      reject(() => reconstructMaintenanceWindowRenewalPredecessor(next, clock(now)));
    }
    reject(() => validateMaintenanceWindowRenewalState(next, { ...clock(), bootId: "00000000-0000-4000-8000-000000000000" }));
    reject(() => validateMaintenanceWindowRenewalState(next, { ...clock(), historicalAuditClock: NOW }));
    validateMaintenanceWindowRenewalState(next, clock(WINDOW_AUTH.expiresAt - 1));
  });
  await t.test("predecessor must be the fixed initial unused state, not any held state or consumed launch", () => {
    for (const patch of [{ revision: 33 }, { activeAttempt: 4 }, { phase: "failed-held" }, { targetSha: TARGET }, { version: 7 },
      { candidate: {} }, { launchJournal: {} }, { launchDisk: {} }, { resumed: {} }, { finalDump: {} }, { extra: true }]) {
      reject(() => validateMaintenanceWindowRenewalPredecessor({ ...copy(predecessor), ...patch }, clock()));
    }
    for (const key of ["runtime", "ingress", "database", "recovery", "continuation", "buildRecovery", "deadlineExtension",
      "attemptRecovery", "secondAttemptRecovery", "budgetRecovery"]) {
      const state = copy(predecessor); state[key].changed = true;
      reject(() => validateMaintenanceWindowRenewalPredecessor(state, clock()));
    }
  });
  await t.test("inspection binds the unused null journal independently of the actual T7 stopped baseline", () => {
    const f = fixture();
    assert.equal(f.inspection.state, "window-renewal-inspected");
    assert.equal(f.inspection.predecessorJournalDigest, hash(null));
    assert.equal(f.inspection.stoppedBaseline.launchJournalDigest, hash(v7.launchJournal));
    assert.equal(f.inspection.stoppedBaseline.stateDigest, BUDGET.stateDigest);
    assert.equal(f.inspection.priorRecoveryRunId, "34825984301");
    assert.equal(f.inspection.priorMainCIrunId, "34824742841");
    assert.equal(f.inspection.failedBackupRunId, "34826545330");
    assert.deepEqual(validateMaintenanceWindowRenewalInspection(f.inspection), f.inspection);
    for (const key of ["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest"]) {
      const bad = fixture(); bad.context.stoppedBaseline[key] = "0".repeat(64);
      reject(() => createMaintenanceWindowRenewalInspection(bad.state, bad.context));
    }
    for (const now of [NOW + 1, NOW - 300001, WINDOW_AUTH.authorizedAt - 1]) {
      const bad = fixture(); bad.context.stoppedBaseline.observedAt = now;
      reject(() => createMaintenanceWindowRenewalInspection(bad.state, bad.context));
    }
    const bad = fixture(); bad.context.stoppedBaseline.current.target = "/srv/faolla.releases/aaaaaaaaaaaa-20260914000100";
    reject(() => createMaintenanceWindowRenewalInspection(bad.state, bad.context));
    for (const mutate of [value => { value.current.linkIdentity = "1:99:3:4:5:1:0:33188"; },
      value => { value.pm2RegistryDigest = "0".repeat(64); }]) {
      const drift = fixture(); mutate(drift.context.stoppedBaseline);
      reject(() => createMaintenanceWindowRenewalInspection(drift.state, drift.context));
    }
  });
  await t.test("context CAS source migration and old/new target bindings cannot be substituted", () => {
    for (const patch of [{ operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { expectedRevision: 31 },
      { expectedDigest: "0".repeat(64) }, { previousTargetSha: TARGET }, { expectedOldSha: TARGET },
      { sourceDiffDigest: "wrong" }, { migrationDigest: "wrong" }, { extra: true }]) {
      const f = fixture(); reject(() => buildMaintenanceWindowRenewedState(f.state, f.evidence, { ...f.context, ...patch }));
    }
    for (const targetSha of [WINDOW.previousTargetSha, BUDGET.previousTargetSha, SECOND.previousTargetSha, INCIDENT.previousTargetSha,
      WINDOW.expectedOldSha, "78ca8104442172baf046b62f9184cf9c7f6a9279"]) {
      const f = fixture(); reject(() => createMaintenanceWindowRenewalInspection(f.state, { ...f.context, targetSha }));
    }
    for (const key of ["sourceDiffDigest", "migrationDigest", "stoppedBaselineDigest", "predecessorJournalDigest"]) {
      const f = fixture(); f.evidence[key] = "0".repeat(64); reject(() => build(f));
    }
  });
  await t.test("new fixed incident IDs and attempts are mandatory, and the fresh grant cannot reuse old runs", () => {
    const f = fixture();
    for (const key of Object.keys(WINDOW).filter(key => /RunId$|RunAttempt$/.test(key))) {
      const bad = copy(f.evidence); bad[key] = key.endsWith("Attempt") ? 2 : "1";
      reject(() => validateMaintenanceWindowRenewalEvidence(bad));
    }
    for (const patch of [{ toolsSha: WINDOW.previousTargetSha }, { windowRenewalRunAttempt: 2 },
      { windowRenewalRunId: WINDOW.priorRecoveryRunId }, { windowRenewalRunId: WINDOW.failedBackupRunId },
      { mainCIrunId: WINDOW.priorMainCIrunId }, { mainCIrunId: f.evidence.windowRenewalRunId }]) {
      reject(() => validateMaintenanceWindowRenewalEvidence({ ...copy(f.evidence), ...patch }));
    }
  });
  await t.test("history and fresh baseline stay within five minutes through the final builder clock", () => {
    for (const checkedAt of [NOW + 1, NOW - 300001, WINDOW_AUTH.authorizedAt - 1, WINDOW_AUTH.expiresAt]) {
      const f = fixture(); f.evidence.historyCheckedAt = checkedAt; reject(() => build(f));
    }
    const f = fixture();
    reject(() => buildMaintenanceWindowRenewedState(f.state, f.evidence, { ...f.context, now: NOW + 300000 }));
    reject(() => buildMaintenanceWindowRenewedState(f.state, f.evidence, { ...f.context, now: WINDOW_AUTH.expiresAt }));
  });
  await t.test("canonical bounded codec rejects duplicate reordered malformed encodings and hidden behavior", () => {
    const f = fixture(), canonical = encodeMaintenanceWindowRenewalEvidence(f.evidence);
    assert.deepEqual(decodeMaintenanceWindowRenewalEvidence(canonical), f.evidence);
    for (const raw of [canonical + "=", "", "a".repeat(16385), Buffer.from("{").toString("base64url"),
      Buffer.from(JSON.stringify(f.evidence).replace('"version":1', '"version":1,"version":1')).toString("base64url"),
      Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse()))).toString("base64url"),
      Buffer.from([0xff]).toString("base64url")]) reject(() => decodeMaintenanceWindowRenewalEvidence(raw));
    let touched = false;
    const getter = copy(f.evidence); Object.defineProperty(getter, "historyDigest", { enumerable: true, get() { touched = true; return "0".repeat(64); } });
    reject(() => validateMaintenanceWindowRenewalEvidence(getter)); assert.equal(touched, false);
    reject(() => validateMaintenanceWindowRenewalEvidence(new Proxy(f.evidence, {})));
    const hidden = copy(f.evidence); Object.defineProperty(hidden, "secret", { value: true }); reject(() => validateMaintenanceWindowRenewalEvidence(hidden));
    const symbol = copy(f.evidence); symbol[Symbol("extra")] = true; reject(() => validateMaintenanceWindowRenewalEvidence(symbol));
    const sparse = copy(f.evidence); sparse.extra = [,]; reject(() => validateMaintenanceWindowRenewalEvidence(sparse));
  });
  await t.test("every original audit and compact predecessor field stays immutable on every writer", () => {
    const start = build(fixture());
    for (const key of ["runtime", "database", "recovery", "continuation", "buildRecovery", "deadlineExtension",
      "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal"]) {
      const next = nextState(start); next[key].changed = true; reject(() => assertMaintenanceWindowRenewalProgress(start, next));
    }
    for (const patch of [{ version: 7 }, { revision: 34 }, { targetSha: TARGET }, { phase: "candidate" },
      { stateDigest: "0".repeat(64) }, { stateBytes: 1 }]) {
      const next = copy(start); Object.assign(next.windowRenewal.predecessor, patch);
      reject(() => validateMaintenanceWindowRenewalState(next, clock()));
    }
    for (const key of ["expiresAt", "authorizedAt", "previousExpiresAt", "activeAttempt", "maximumRemainingAttempts"]) {
      const next = copy(start); next.windowRenewal.authorization[key]++;
      reject(() => validateMaintenanceWindowRenewalState(next, clock()));
    }
    const changed = copy(start); changed.windowRenewal.predecessor.ingress.changed = true;
    reject(() => validateMaintenanceWindowRenewalState(changed, clock()));
    const initialIngress = copy(start); initialIngress.ingress.changed = true;
    reject(() => validateMaintenanceWindowRenewalState(initialIngress, clock()));
    const deleted = nextState(start); delete deleted.windowRenewal;
    reject(() => assertMaintenanceWindowRenewalProgress(start, deleted));
  });
  await t.test("three durable pre-send journal writes precede confirmed candidate, all at the actual new target", () => {
    const start = build(fixture()), { saved, candidate } = journalSteps(start);
    assert.deepEqual(saved.slice(0, 3).map(state => state.launchJournal.slots["paused-web"]?.phase ?? null), [null, "planned", "attempted"]);
    validateMaintenanceWindowRenewalState(candidate, clock());
    assert.equal(candidate.targetSha, TARGET); assert.equal(candidate.launchJournal.targetSha, TARGET);
    assert.equal(JSON.stringify(reconstructMaintenanceWindowRenewalPredecessor(candidate, clock())), JSON.stringify(predecessor));
    const changedIngress = nextState(candidate); changedIngress.ingress.bookkeeping = "changed";
    assertMaintenanceWindowRenewalProgress(candidate, changedIngress);
    assert.equal(JSON.stringify(reconstructMaintenanceWindowRenewalPredecessor(changedIngress, clock())), JSON.stringify(predecessor));
    for (const role of ["operationId", "targetSha"]) {
      const bad = copy(candidate); bad.launchJournal[role] = role === "targetSha" ? WINDOW.previousTargetSha : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      reject(() => validateMaintenanceWindowRenewalState(bad, clock()));
    }
    const skipped = { ...copy(candidate), revision: start.revision + 1 };
    reject(() => assertMaintenanceWindowRenewalProgress(start, skipped));
  });
  await t.test("none of three consumed historical nonces or a second launch can be reused", () => {
    const start = build(fixture());
    for (const old of [seed, v6, v7]) {
      const invalid = { ...nextState(start), ...launch(start, old.launchJournal.slots["paused-web"].nonce), phase: "candidate" };
      reject(() => validateMaintenanceWindowRenewalState(invalid, clock()));
    }
    const { saved, candidate } = journalSteps(start), attempted = saved[2];
    const cleared = nextState(attempted); cleared.launchJournal.slots["paused-web"] = null;
    reject(() => assertMaintenanceWindowRenewalProgress(attempted, cleared));
    const replaced = nextState(candidate); Object.assign(replaced, launch(candidate, "88888888-2222-4333-8444-555555555555"));
    reject(() => assertMaintenanceWindowRenewalProgress(candidate, replaced));
    for (const key of ["candidate", "launchJournal", "launchDisk"]) {
      const next = nextState(candidate); next[key] = null; reject(() => assertMaintenanceWindowRenewalProgress(candidate, next));
    }
  });
  await t.test("CAS revisions terminal phases repeated renewal and downgrade cannot reset the attempt", () => {
    const start = build(fixture()), candidate = journalSteps(start).candidate;
    for (const patch of [{ revision: start.revision }, { revision: start.revision + 2 }, { activeAttempt: 4 },
      { targetSha: "c".repeat(40) }, { phase: "resuming" }, { phase: "ended" }]) {
      reject(() => assertMaintenanceWindowRenewalProgress(start, { ...nextState(start), ...patch }));
    }
    const failed = { ...nextState(candidate), phase: "failed-held" };
    assertMaintenanceWindowRenewalProgress(candidate, failed);
    for (const phase of ["held", "candidate", "resuming", "ended"]) reject(() => assertMaintenanceWindowRenewalProgress(failed, { ...nextState(failed), phase }));
    const f = fixture(); reject(() => buildMaintenanceWindowRenewedState(start, f.evidence, f.context));
    reject(() => assertMaintenanceWindowRenewalProgress(start, { ...copy(predecessor), revision: start.revision + 1 }));
    const oldChanged = { ...copy(predecessor), revision: 33, budgetRecovery: { ...copy(predecessor.budgetRecovery), authorization: WINDOW_AUTH } };
    assert.throws(() => assertMaintenanceWindowRenewalProgress(predecessor, oldChanged));
  });
}));
