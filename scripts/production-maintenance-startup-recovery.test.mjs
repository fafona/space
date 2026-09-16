import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { withFenceFixture } from "./production-maintenance-fence-recovery.test.mjs";
import { MAINTENANCE_STARTUP_PREDECESSOR as PIN } from "./production-maintenance-startup-recovery.mjs";

export async function withStartupFixture(t, action) {
  return withFenceFixture(t, async f => {
    const context = { ...f.context, targetSha: PIN.targetSha };
    const evidence = { ...f.evidence, targetSha: PIN.targetSha, toolsSha: PIN.targetSha };
    const held = f.api.buildMaintenanceFenceRecoveredState(f.failed, evidence, context);
    const archived = held.budgetRecovery.predecessor.state;
    const candidate = f.copy(archived.candidate), journal = f.copy(archived.launchJournal);
    const runtime = "/www/wwwroot/merchant-space.releases/e83c91abbf8e-20260915004149";
    const priorRuntime = candidate.disk.runtime;
    candidate.targetSha = PIN.targetSha; candidate.disk.runtime = runtime;
    candidate.disk.runtimeIdentity = "1:3:4096:1:1:15:0:16877";
    candidate.environment.directoryIdentity = candidate.disk.runtimeIdentity;
    candidate.disk.nextEntryPath = candidate.disk.nextEntryPath.replace(priorRuntime, runtime);
    candidate.web.pm2.pid += 10000;
    candidate.web.processes[0].pid = candidate.web.pm2.pid;
    candidate.web.processes[0].cwd = runtime;
    candidate.web.processes[0].cwdIdentity = candidate.disk.runtimeIdentity;
    journal.targetSha = PIN.targetSha; journal.release.path = runtime;
    journal.release.identity = candidate.disk.runtimeIdentity;
    journal.slots["paused-web"].nonce = "abababab-abab-4bab-8bab-abababababab";
    journal.slots["paused-web"].instance.pid = candidate.web.pm2.pid;
    journal.slots["paused-web"].instance.cwd = runtime;
    journal.slots["paused-web"].instance.cwdIdentity = candidate.disk.runtimeIdentity;
    const failed = { ...f.copy(held), revision: 51, phase: "failed-held", candidate, launchDisk: f.copy(candidate.disk), launchJournal: journal };
    f.api.validateMaintenanceLeaseState(failed, { bootId: PIN.bootId, now: Date.parse("2026-09-15T00:52:00Z") });
    f.mappings.set(JSON.stringify(failed), PIN.stateDigest);
    const source = readFileSync(new URL("./production-maintenance-startup-recovery.mjs", import.meta.url), "utf8")
      .replaceAll(/from "(\.\/[^"\n]+)"/g, (_all,path) => `from ${JSON.stringify(path === "./production-maintenance-lease.mjs" ? f.apiUrl : new URL(path,import.meta.url).href)}`)
      .replace("stateBytes: 2457712", `stateBytes: ${Buffer.byteLength(JSON.stringify(failed))}`);
    const apiUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64") + "#" + Math.random(), api = await import(apiUrl);
    const now = Date.parse("2026-09-16T02:00:00Z"), targetSha = "7".repeat(40), hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
    const baseline = { version: 4, stateDigest: PIN.stateDigest, candidateDigest: hash(candidate), launchDiskDigest: hash(failed.launchDisk),
      launchJournalDigest: hash(journal), runtimeDigest: hash(failed.runtime), current: { target: runtime, linkIdentity: "1:2:60:1:1:1:0:41471",
        runtimeIdentity: candidate.disk.runtimeIdentity }, bootId: PIN.bootId, pm2RegistryDigest: "e".repeat(64), observedAt: now - 1000 };
    const recoveryContext = { operationId: failed.operationId, targetSha, previousTargetSha: PIN.targetSha, expectedOldSha: PIN.expectedOldSha,
      expectedRevision: 51, expectedDigest: PIN.stateDigest, bootId: PIN.bootId, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline };
    const inspected = api.createMaintenanceStartupInspection(failed, recoveryContext);
    const item = { ...inspected, toolsSha: targetSha, leaseRunId: "900000000000000051", leaseRunAttempt: 1, mainCIrunId: "900000000000000052",
      historyDigest: "d".repeat(64), historyCheckedAt: now - 500 };
    const leaseSource = readFileSync(new URL("./production-maintenance-lease.mjs", import.meta.url), "utf8")
      .replaceAll(/from "(\.\/[^"\n]+)"/g, (_all,path) => `from ${JSON.stringify(path === "./production-maintenance-startup-recovery.mjs" ? apiUrl : new URL(path,import.meta.url).href)}`)
      .replace("stateBytes: 2099829", `stateBytes: ${Buffer.byteLength(JSON.stringify(f.previous))}`)
      .replace("stateBytes: 2276109", `stateBytes: ${Buffer.byteLength(JSON.stringify(f.failed))}`);
    const controllerLeaseApiUrl = "data:text/javascript;base64," + Buffer.from(leaseSource).toString("base64") + "#" + Math.random();
    await action({ ...f, api, apiUrl, controllerLeaseApiUrl, failed, context: recoveryContext, evidence: item, targetSha, now });
  });
}
test("startup recovery preserves the consumed launch and every historical audit", { concurrency: false }, async t => withStartupFixture(t, async f => {
  const lease = await import(f.controllerLeaseApiUrl);
  assert.throws(() => lease.validateMaintenanceLeaseState(f.failed, { bootId: PIN.bootId, now: f.now }));
  assert.deepEqual(f.api.validateMaintenanceStartupPredecessor(f.failed, { bootId: PIN.bootId, now: f.now }), f.failed);
  const next = f.api.buildMaintenanceStartupRecoveredState(f.failed, f.evidence, f.context);
  assert.equal(next.version, 14); assert.equal(next.revision, 52); assert.equal(next.activeAttempt, 4); assert.equal(next.phase, "held");
  for (const key of ["candidate","resumed","launchDisk","launchJournal","finalDump"]) assert.equal(next[key],null);
  assert.deepEqual(next.startupRecovery.predecessor.launchJournal,f.failed.launchJournal);
  for(const key of ["leaseRenewal","leaseExtensions","fenceRecovery","budgetRecovery","preflightRecovery","runtime"]) assert.deepEqual(next[key],f.failed[key]);
  assert.deepEqual(f.api.maintenanceStartupHistoricalState(next,{bootId:PIN.bootId,now:f.now}),f.failed);
  f.api.assertMaintenanceStartupProgress(f.failed,next);
  // Warm-cache mutations must still fail their complete canonical digest check.
  for(const change of [s=>s.startupRecovery.predecessor.launchJournal.slots["paused-web"].nonce="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",s=>s.fenceRecovery.authorization.activeAttempt++,
    s=>s.activeAttempt++,s=>s.startupRecovery.expiresAt++,s=>s.startupRecovery.authorization.maximumAdditionalAttempts++,s=>s.startupRecovery.predecessor.candidate.web.pm2.pid++,
    s=>s.startupRecovery.stoppedBaseline.current.target+="x",s=>s.extra=true]){
    const bad=f.copy(next);change(bad);assert.throws(()=>f.api.validateMaintenanceStartupState(bad,{bootId:PIN.bootId,now:f.now}));
  }
  const later={...f.copy(next),revision:53,phase:"failed-held"};f.api.assertMaintenanceStartupProgress(next,later);
  assert.throws(()=>f.api.assertMaintenanceStartupProgress(later,{...f.copy(later),revision:54,phase:"held"}));
  assert.throws(()=>f.api.validateMaintenanceStartupPredecessor(later,{bootId:PIN.bootId,now:f.now}));
  assert.throws(()=>f.api.validateMaintenanceStartupState(next,{bootId:PIN.bootId,now:next.startupRecovery.expiresAt}));
}));
