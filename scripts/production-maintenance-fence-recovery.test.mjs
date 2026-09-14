import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { withLeaseFixture } from "./production-maintenance-lease.test.mjs";
import { MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION as AUTH, MAINTENANCE_FENCE_RECOVERY_PREDECESSOR as PIN } from "./production-maintenance-lease.mjs";

export async function withFenceFixture(t, action) {
  return withLeaseFixture(t, async f => {
    const context = { ...f.context, targetSha: PIN.targetSha };
    const evidence = { ...f.evidence, targetSha: PIN.targetSha, toolsSha: PIN.targetSha };
    const leased = f.api.buildMaintenanceLeasedState(f.previous, evidence, context);
    const failed = { ...f.copy(leased), revision: 42, phase: "failed-held" };
    f.mappings.set(JSON.stringify(failed), PIN.stateDigest);
    const source = readFileSync(new URL("./production-maintenance-lease.mjs", import.meta.url), "utf8")
      .replace('from "./production-maintenance-preflight-recovery.mjs"', `from ${JSON.stringify(new URL("./production-maintenance-preflight-recovery.mjs", import.meta.url).href)}`)
      .replace("stateBytes: 2099829", `stateBytes: ${Buffer.byteLength(JSON.stringify(f.previous))}`)
      .replace("stateBytes: 2276109", `stateBytes: ${Buffer.byteLength(JSON.stringify(failed))}`);
    const apiUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64") + "#" + Math.random();
    const api = await import(apiUrl), now = AUTH.authorizedAt + 1000;
    const recoveryContext = { ...context, targetSha: "8".repeat(40), previousTargetSha: PIN.targetSha,
      expectedRevision: 42, expectedDigest: PIN.stateDigest, now,
      stoppedBaseline: { ...context.stoppedBaseline, observedAt: now - 500 } };
    const inspected = api.createMaintenanceFenceInspection(failed, recoveryContext);
    const recoveryEvidence = { ...inspected, toolsSha: recoveryContext.targetSha, leaseRunId: "900000000000000041", leaseRunAttempt: 1,
      mainCIrunId: "900000000000000042", historyDigest: "d".repeat(64), historyCheckedAt: now - 500 };
    await action({ ...f, api, apiUrl, failed, context: recoveryContext, evidence: recoveryEvidence, targetSha: recoveryContext.targetSha, now });
  });
}

test("fixed unused fence failure recovery preserves all history and attempt limit", { concurrency: false }, async t => withFenceFixture(t, async f => {
  const { api, failed, context, evidence } = f;
  const next = api.buildMaintenanceFenceRecoveredState(failed, evidence, context);
  assert.equal(next.version, 13); assert.equal(next.revision, 43); assert.equal(next.phase, "held"); assert.equal(next.activeAttempt, 3);
  assert.equal(AUTH.maximumAdditionalAttempts, 0);
  assert.deepEqual(next.leaseRenewal, failed.leaseRenewal);
  assert.deepEqual(next.preflightRecovery, failed.preflightRecovery);
  assert.equal(api.maintenanceLeaseExpiresAt(next), api.maintenanceLeaseExpiresAt(failed));
  api.assertMaintenanceLeaseProgress(failed, next);
  const renewContext = { ...context, now: context.now + 1000,
    previousTargetSha: "3614f5bfc85cf72d064732141a9998a0bbaec513", expectedRevision: 43,
    expectedDigest: createHash("sha256").update(JSON.stringify(next)).digest("hex") };
  const renewInspection = api.createMaintenanceLeaseInspection(next, renewContext);
  const renewEvidence = { ...evidence, ...renewInspection, leaseRunId: "900000000000000043", historyCheckedAt: context.now + 500 };
  const renewed = api.buildMaintenanceLeasedState(next, renewEvidence, renewContext);
  api.assertMaintenanceLeaseProgress(next, renewed);
  assert.equal(renewed.version, 13); assert.equal(renewed.activeAttempt, 3);
  assert.deepEqual(renewed.fenceRecovery, next.fenceRecovery);
  assert.equal(api.maintenanceLeaseExpiresAt(renewed), renewContext.now + 12 * 60 * 60 * 1000);
  assert.throws(() => api.buildMaintenanceLeasedState(failed, evidence, context));
  assert.throws(() => api.validateMaintenanceLeaseState(next, { bootId: next.bootId, now: context.now - 1 }));
  for (const mutate of [s => s.activeAttempt++, s => s.phase = "candidate", s => s.fenceRecovery.authorization.maximumAdditionalAttempts++,
    s => s.fenceRecovery.predecessor.stateDigest = "f".repeat(64), s => s.leaseRenewal.expiresAt++, s => s.fenceRecovery.recoveredAt = AUTH.authorizedAt - 1,
    s => s.launchJournal = {}, s => s.targetSha = PIN.targetSha]) {
    const bad = f.copy(next); mutate(bad); assert.throws(() => api.validateMaintenanceLeaseState(bad, { bootId: next.bootId, now: context.now }));
  }
  const laterFailure = { ...f.copy(next), revision: 44, phase: "failed-held" };
  api.assertMaintenanceLeaseProgress(next, laterFailure);
  assert.throws(() => api.assertMaintenanceLeaseProgress(laterFailure, { ...f.copy(laterFailure), revision: 45, phase: "held" }));
  assert.throws(() => api.validateMaintenanceFencePredecessor(laterFailure, { bootId: next.bootId, now: context.now }));
}));
