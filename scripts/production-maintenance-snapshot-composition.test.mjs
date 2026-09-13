import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import * as runtime from "./production-maintenance-runtime.mjs";
import { runMaintenanceAction, validateMaintenanceSubproofBindings, validateMaintenanceLaunchProofBindings } from "./production-maintenance-control.mjs";
import * as journal from "./production-maintenance-launch-journal.mjs";
import * as continuity from "./production-maintenance-daemon-continuity.mjs";
import { pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";

// Reuse only the existing synthetic fixture definitions, not its test module:
// importing a *.test.mjs would register unrelated tests twice. Host boundaries
// are all injected; actual controller/runtime/strict proof validators execute.
// No PM2 transport, Python, HTTP, subprocess, or production filesystem access.
const source = readFileSync(new URL("./production-maintenance-runtime.test.mjs", import.meta.url), "utf8");
const start = source.indexOf("const OLD =");
const end = source.indexOf("\ntest(", start);
assert.ok(start > 0 && end > start, "existing synthetic runtime fixture required");
const bindings = { ...runtime, ...journal, ...continuity, assert, createHash, pm2RegistryDigest };
const { fixture, input, TARGET, BOOT } = Function(...Object.keys(bindings),
  source.slice(start, end) + "\nreturn {fixture,input,TARGET,BOOT};")(...Object.values(bindings));

async function scenario() {
  const f = fixture();
  const old = await runtime.captureRuntime(input(), f.deps);
  await runtime.stopRuntime(old, f.deps); // Existing fixture Map changes only.
  f.installCandidate(); // Existing fixture Map changes only.
  const candidate = await runtime.captureCandidate(old, TARGET, "1", f.deps);
  const state = { version: 2, revision: 2, operationId: f.journal().operationId,
    targetSha: TARGET, ...input(), bootId: BOOT, createdAt: 100, phase: "candidate",
    runtime: old, ingress: { input: { operationId: f.journal().operationId, appPort: 3000,
      publicSupabaseUrl: "https://supabase.example.test/" },
      docker: { containers: [{ service: "db", id: "f".repeat(64), image: "supabase/postgres:fixture" }] } },
    database: { id: "f".repeat(64), image: "supabase/postgres:fixture", databaseOid: 1 },
    publicSupabaseUrl: "https://supabase.example.test", tokenHash: "a".repeat(64),
    candidate, resumed: null, launchDisk: structuredClone(f.disks.get(TARGET)), launchJournal: f.journal(), finalDump: null };
  const counts = { ingress: 0, outerVerify: 0, snapshot: 0, registry: 0, supervision: 0, sleep50: 0 };
  const events = [];
  const forbidden = () => { assert.fail("no mutation, CLI, database, or transport allowed"); };
  const d = { ...f.deps, run: forbidden, pm2Control: forbidden };
  d.pm2Registry = async (...args) => { counts.registry++; events.push("registry"); return f.deps.pm2Registry(...args); };
  d.supervision = async (...args) => { counts.supervision++; events.push("supervision"); return f.deps.supervision(...args); };
  d.sleep = async (ms) => { assert.equal(ms, 50); counts.sleep50++; events.push("double-observe-gap"); };
  const ops = {
    load: () => structuredClone(state), now: () => 200, bootId: () => BOOT,
    validateProofs: (value) => {
      events.push("validateProofs");
      runtime.validateRuntimeProof(value.runtime); runtime.validateCandidateProof(value.candidate, value.runtime);
      validateMaintenanceSubproofBindings(value);
      runtime.validateLaunchDisk(value.launchDisk, value.runtime, value.targetSha);
      validateMaintenanceLaunchProofBindings(value);
    },
    verifyIngress: async (proof, options) => {
      assert.deepEqual(proof, state.ingress); assert.deepEqual(options, { probeControlServices: false });
      counts.ingress++; events.push("ingress");
    },
    verifyCandidate: async (...args) => { counts.outerVerify++; return runtime.verifyCandidate(...args, d); },
    readManagedSnapshot: (...args) => { counts.snapshot++; events.push("snapshot"); return runtime.readManagedSnapshot(...args, d); },
    save: forbidden, create: forbidden, startCandidate: forbidden, installIngress: forbidden, restoreIngress: forbidden,
    assertDatabaseQuiet: forbidden, assertRuntimeStopped: forbidden,
  };
  const read = (kind = "web") => runMaintenanceAction({ ...input(), operationId: state.operationId,
    targetSha: TARGET, action: "snapshot-" + kind }, ops);
  return { f, state, d, ops, counts, events, read };
}

test("candidate snapshots retain ingress plus one complete reader verification and final fresh registry", async () => {
  for (const kind of ["web", "worker"]) {
    const s = await scenario(); const report = await s.read(kind);
    assert.equal(report.snapshot, kind === "web" ? "running:301" : "absent");
    assert.equal(report.state, "candidate");
    assert.deepEqual(s.counts, { ingress: 1, outerVerify: 0, snapshot: 1, registry: 4, supervision: 2, sleep50: 1 });
    assert.deepEqual(s.events.slice(0, 3), ["validateProofs", "ingress", "snapshot"]);
    assert.deepEqual(s.events.slice(3), ["supervision", "registry", "double-observe-gap", "supervision", "registry", "registry", "registry"]);
  }
});

test("separate snapshot calls never reuse prior host observations or ingress results", async () => {
  const s = await scenario(); await s.read(); await s.read("worker");
  assert.deepEqual(s.counts, { ingress: 2, outerVerify: 0, snapshot: 2, registry: 8, supervision: 4, sleep50: 2 });
  s.f.setPause("0");
  await assert.rejects(s.read(), /production_maintenance_runtime_unverified/);
  assert.equal(s.counts.ingress, 3);
  assert.equal(s.counts.snapshot, 3);
});

test("phase, target, private proof binding and ingress failures reject before the snapshot reader", async () => {
  for (const change of [
    s => { s.state.phase = "ended"; },
    s => { s.state.targetSha = "c".repeat(40); },
    s => { s.state.candidate.targetSha = "c".repeat(40); },
    s => { s.state.runtime.bootId = "99999999-9999-4999-8999-999999999999"; },
    s => { s.ops.verifyIngress = async () => { throw new Error("synthetic ingress rejected"); }; },
  ]) {
    const s = await scenario(); change(s);
    await assert.rejects(s.read());
    assert.equal(s.counts.snapshot, 0); assert.equal(s.counts.registry, 0); assert.equal(s.counts.outerVerify, 0);
  }
});

test("the retained runtime verifier still rejects health, pause, environment, disk, process and boot drift", async () => {
  for (const change of [
    s => { s.d.supervision = async (...args) => ({ ...await s.f.deps.supervision(...args), healthVerified: false }); },
    s => { s.f.setPause("0"); },
    s => { s.f.envs.get(s.f.runtime(TARGET)).sha256 = "0".repeat(64); },
    s => { s.f.disks.get(TARGET).runtimeIdentity = "1:2:10:21:30:1:1000:33152"; },
    s => { s.f.facts.get(s.state.candidate.web.pm2.pid).startTicks = "999999"; },
    s => { s.f.setBoot("99999999-9999-4999-8999-999999999999"); },
  ]) {
    const s = await scenario(); change(s);
    await assert.rejects(s.read(), /production_maintenance_runtime_unverified/);
    assert.equal(s.counts.ingress, 1); assert.equal(s.counts.snapshot, 1); assert.equal(s.counts.outerVerify, 0);
  }
});

test("the final independent registry read still rejects replacement after both candidate observations", async () => {
  const s = await scenario(); const registry = s.d.pm2Registry;
  s.d.pm2Registry = async (...args) => {
    if (s.counts.registry === 3) s.f.entries().find(row => row.name === "faolla").pm2_env.restart_time++;
    return registry(...args);
  };
  await assert.rejects(s.read(), /production_maintenance_runtime_unverified/);
  assert.deepEqual(s.counts, { ingress: 1, outerVerify: 0, snapshot: 1, registry: 4, supervision: 2, sleep50: 1 });
});

test("candidate check commands outside the narrow snapshot path retain their full outer verifier", async () => {
  for (const action of ["check-candidate", "register-candidate"]) {
    const s = await scenario();
    const report = await runMaintenanceAction({ ...input(), operationId: s.state.operationId, targetSha: TARGET, action }, s.ops);
    assert.equal(report.state, "candidate");
    assert.deepEqual(s.counts, { ingress: 1, outerVerify: 1, snapshot: 0, registry: 3, supervision: 2, sleep50: 1 });
  }
});
