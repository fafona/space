import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { withPreflightRecoveryFixture } from "./test-helpers/maintenance-preflight-fixture.mjs";
import { buildMaintenancePreflightRecoveredState, createMaintenancePreflightRecoveryInspection } from "./production-maintenance-preflight-recovery.mjs";
import { MAINTENANCE_LEASE_AUTHORIZATION as AUTH, MAINTENANCE_LEASE_PREDECESSOR as PIN } from "./production-maintenance-lease.mjs";

// Only the synthetic fixture's byte count is substituted in a data-URL module.
// Real production constants stay unchanged; this module can perform no host I/O.
export async function withLeaseFixture(t, action) {
  return withPreflightRecoveryFixture(t, async base => {
    const f = base.fixture(), when = Date.parse("2026-09-14T19:18:00Z");
    const context = { ...f.context, targetSha: PIN.targetSha, now: when, stoppedBaseline: { ...f.context.stoppedBaseline, observedAt: when - 1000 } };
    const evidence = { ...createMaintenancePreflightRecoveryInspection(f.state, context), toolsSha: PIN.targetSha,
      preflightRecoveryRunId: PIN.recoveryRunId, preflightRecoveryRunAttempt: 1, mainCIrunId: PIN.mainCIrunId, historyDigest: "d".repeat(64), historyCheckedAt: when - 1000 };
    const previous = buildMaintenancePreflightRecoveredState(f.state, evidence, context);
    base.mappings.set(JSON.stringify(previous), PIN.stateDigest);
    const source = readFileSync(new URL("./production-maintenance-lease.mjs", import.meta.url), "utf8")
      .replaceAll(/from "(\.\/[^"\n]+)"/g, (_all, path) => `from ${JSON.stringify(new URL(path, import.meta.url).href)}`)
      .replace("stateBytes: 2099829", `stateBytes: ${Buffer.byteLength(JSON.stringify(previous))}`);
    const apiUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64") + "#" + Math.random();
    const api = await import(apiUrl);
    const now = AUTH.authorizedAt + 60000, targetSha = "9".repeat(40);
    const nextContext = { operationId: AUTH.operationId, targetSha, previousTargetSha: PIN.targetSha, expectedOldSha: PIN.expectedOldSha,
      expectedRevision: previous.revision, expectedDigest: PIN.stateDigest, bootId: PIN.bootId, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
      stoppedBaseline: { ...previous.preflightRecovery.stoppedBaseline, observedAt: now - 1000 } };
    const inspected = api.createMaintenanceLeaseInspection(previous, nextContext);
    const leaseEvidence = { ...inspected, toolsSha: targetSha, leaseRunId: "900000000000000031", leaseRunAttempt: 1,
      mainCIrunId: "900000000000000032", historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
    await action({ ...base, api, apiUrl, previous, context: nextContext, evidence: leaseEvidence, now, targetSha });
  });
}

test("renewable lease keeps original deadline and the same unused attempt", { concurrency: false }, async t => withLeaseFixture(t, async f => {
  const { api, previous, evidence, context, copy } = f;
  assert.equal(PIN.stateDigest, "728b41efe1e4538c21caa195716214553e51c4cbf56cb14d04f57863fcb82898");
  assert.equal(PIN.stateBytes, 2099829); assert.equal(AUTH.maximumAdditionalAttempts, 0);
  const next = api.buildMaintenanceLeasedState(previous, evidence, context);
  assert.equal(next.version, 12); assert.equal(next.revision, 40); assert.equal(next.activeAttempt, 3);
  assert.deepEqual(next.preflightRecovery, previous.preflightRecovery);
  assert.equal(next.preflightRecovery.authorization.expiresAt, Date.parse("2026-09-14T20:00:00Z"));
  assert.equal(api.maintenanceLeaseExpiresAt(next), context.now + 43200000);
  api.assertMaintenanceLeaseProgress(previous, next);
  assert.deepEqual(api.reconstructMaintenanceLeasePredecessor(next, { bootId: PIN.bootId, now: context.now }), previous);
  assert.deepEqual(api.decodeMaintenanceLeaseEvidence(api.encodeMaintenanceLeaseEvidence(evidence)), evidence);
  for (const change of [s => s.activeAttempt++, s => s.preflightRecovery.authorization.expiresAt++, s => s.leaseRenewal.authorization.automaticRenewal = false,
    s => s.leaseRenewal.expiresAt++, s => s.leaseRenewal.predecessor.stateDigest = "f".repeat(64), s => s.candidate = {}, s => s.extra = true]) {
    const bad = copy(next); change(bad); assert.throws(() => api.validateMaintenanceLeaseState(bad, { bootId: PIN.bootId, now: context.now }));
  }
  const expired = api.maintenanceLeaseExpiresAt(next);
  assert.throws(() => api.validateMaintenanceLeaseState(next, { bootId: PIN.bootId, now: expired }));
  api.validateMaintenanceLeasePredecessor(next, { bootId: PIN.bootId, now: expired + 1 });
  const crypto = await import("node:crypto");
  const ctx = { ...context, now: expired + 1000, expectedRevision: 40, expectedDigest: crypto.createHash("sha256").update(JSON.stringify(next)).digest("hex"),
    stoppedBaseline: { ...context.stoppedBaseline, observedAt: expired } };
  const inspected = api.createMaintenanceLeaseInspection(next, ctx);
  const renewed = api.buildMaintenanceLeasedState(next, { ...inspected, toolsSha: ctx.targetSha, leaseRunId: "900000000000000033", leaseRunAttempt: 1,
    mainCIrunId: evidence.mainCIrunId, historyDigest: "e".repeat(64), historyCheckedAt: expired }, ctx);
  assert.equal(renewed.leaseExtensions.length, 1); assert.deepEqual(renewed.leaseRenewal, next.leaseRenewal);
  api.assertMaintenanceLeaseProgress(next, renewed);
  const failed = { ...copy(next), revision: 41, phase: "failed-held" }; api.assertMaintenanceLeaseProgress(next, failed);
  assert.throws(() => api.validateMaintenanceLeasePredecessor(failed, { bootId: PIN.bootId, now: context.now }));
  assert.throws(() => api.assertMaintenanceLeaseProgress(failed, { ...copy(failed), revision: 42, phase: "held" }));
  assert.throws(() => api.assertMaintenanceLeaseProgress(renewed, { ...copy(renewed), revision: 42, leaseExtensions: [] }));
}));
