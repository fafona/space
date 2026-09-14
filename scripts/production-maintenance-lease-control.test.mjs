import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { withLeaseFixture } from "./production-maintenance-lease.test.mjs";
import { MAINTENANCE_LEASE_AUTHORIZATION as AUTH, MAINTENANCE_LEASE_PREDECESSOR as PIN } from "./production-maintenance-lease.mjs";

test("lease controller keeps double live host/source/database proofs and exact CAS", { concurrency: false }, async t => withLeaseFixture(t, async f => {
  const source = readFileSync(new URL("./production-maintenance-control.mjs", import.meta.url), "utf8")
    .replaceAll(/from "(\.\/[^"\n]+)"/g, (_all, path) => `from ${JSON.stringify(path === "./production-maintenance-lease.mjs" ? f.apiUrl : new URL(path, import.meta.url).href)}`);
  const { runMaintenanceAction, parseMaintenanceRequest, validateMaintenanceState } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  const argv = ["renew-lease", "--app-dir", f.previous.appDir, "--app-name", f.previous.appName, "--app-port", String(f.previous.appPort),
    "--target-sha", f.targetSha, "--previous-target-sha", PIN.targetSha, "--expected-old-sha", PIN.expectedOldSha,
    "--expected-operation-id", AUTH.operationId, "--lease-evidence", f.api.encodeMaintenanceLeaseEvidence(f.evidence), "--json"];
  const request = parseMaintenanceRequest(argv), events = [];
  const ops = {
    bootId: () => PIN.bootId, now: () => f.now,
    readLeaseSnapshot: async () => ({ state: f.copy(f.previous), revision: 39, digest: PIN.stateDigest }),
    validateProofs: () => events.push("proofs"), assertPreflightDiskHeadroom: async () => events.push("disk"),
    verifyIngress: async () => events.push("ingress"), assertLeaseStopped: async () => events.push("stopped"), assertDatabaseQuiet: async () => events.push("database"),
    captureLeaseBaseline: async () => f.context.stoppedBaseline, verifyLeaseBaseline: async () => events.push("baseline"),
    readLeaseSourceProof: async () => { events.push("source"); return { sourceDiffDigest: f.context.sourceDiffDigest }; },
    readLeaseMigrationProof: async () => { events.push("migration"); return f.context.migrationDigest; },
    commitLease: async (snapshot, next) => { events.push("CAS"); assert.equal(snapshot.revision, 39); assert.equal(snapshot.digest, PIN.stateDigest);
      f.api.assertMaintenanceLeaseProgress(snapshot.state, next); return next; },
  };
  const result = await runMaintenanceAction(request, ops); assert.equal(result.state, "held"); assert.equal(result.targetSha, f.targetSha);
  assert.equal(events.filter(x => x === "CAS").length, 1);
  for (const name of ["disk", "ingress", "stopped", "database", "source", "migration", "baseline"]) assert.equal(events.filter(x => x === name).length, 2, name);
  for (const failAt of ["verifyIngress", "assertLeaseStopped", "assertDatabaseQuiet", "verifyLeaseBaseline", "readLeaseSourceProof", "readLeaseMigrationProof"]) {
    let committed = false;
    await assert.rejects(runMaintenanceAction(request, { ...ops, [failAt]: async () => { throw Error("blocked"); }, commitLease: async () => { committed = true; } }));
    assert.equal(committed, false);
  }
  assert.throws(() => parseMaintenanceRequest(argv.map(x => x === "renew-lease" ? "check-held" : x)));
  const leased = f.api.buildMaintenanceLeasedState(f.previous, f.evidence, f.context);
  assert.throws(() => validateMaintenanceState(leased, { ...request, action: "check-held" }, PIN.bootId, f.now + 43200000));
  // The only expired-state exception is unused held renewal, never a start.
  validateMaintenanceState(leased, request, PIN.bootId, f.now + 43200000);
  assert.throws(() => validateMaintenanceState({ ...leased, phase: "failed-held", revision: 41 }, request, PIN.bootId, f.now + 43200000));
}));
