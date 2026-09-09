import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseMaintenanceRequest, runMaintenanceAction, validateMaintenanceState } from "./production-maintenance-control.mjs";

const operationId = "12345678-1234-4123-8123-123456789abc";
const old = "a".repeat(40);
const target = "b".repeat(40);
const token = "c".repeat(64);
const boot = "12345678-1234-4123-8123-987654321abc";
const flags = ["--app-dir", "/srv/faolla", "--app-name", "faolla", "--app-port", "3000", "--target-sha", target, "--expected-old-sha", old, "--json"];
const request = (action) => parseMaintenanceRequest([action, ...flags, ...(["plan", "prepare"].includes(action) ? [] : ["--expected-operation-id", operationId])]);
function fixture(phase = "held") {
  const events = [];
  let state = { version: 1, operationId, targetSha: target, expectedOldSha: old, appDir: "/srv/faolla", appName: "faolla", appPort: 3000,
    bootId: boot, createdAt: 100, phase, runtime: { old: true }, ingress: { planned: true }, database: { frozen: true },
    publicSupabaseUrl: "https://database.example", tokenHash: createHash("sha256").update(token).digest("hex"),
    candidate: ["candidate", "resuming", "ended"].includes(phase) ? { targetSha: target } : null, resumed: phase === "ended" ? { ready: true } : null };
  const effect = (name, result) => async (...args) => { events.push(name); if (typeof result === "function") return result(...args); return result; };
  const ops = {
    uuid: () => operationId, token: () => token, bootId: () => boot, now: () => 200,
    load: () => structuredClone(state), save: (value) => { events.push("save:" + value.phase); state = structuredClone(value); },
    create: (value, secret) => { assert.equal(secret, token); events.push("create"); state = structuredClone(value); },
    assertNoActiveOperation: () => { events.push("noActive"); }, readToken: () => token,
    captureRuntime: effect("captureRuntime", (input) => { assert.deepEqual(Object.keys(input).sort(), ["appDir", "appName", "appPort", "expectedOldSha"].sort()); return { old: true }; }),
    readPublicSupabaseUrl: effect("readPublicUrl", "https://database.example"),
    captureIngress: effect("captureIngress", { captured: true }), captureDatabase: effect("captureDatabase", { frozen: true }),
    planIngressInstallation: (proof, secret) => { assert.equal(secret, token); assert.ok(proof.captured); events.push("planIngress"); return { planned: true }; },
    installIngress: effect("installIngress", { planned: true }), verifyIngress: effect("verifyIngress"), restoreIngress: effect("restoreIngress"),
    stopRuntime: effect("stopRuntime"), assertRuntimeStopped: effect("assertStopped"),
    waitDatabaseQuiet: effect("waitQuiet"), assertDatabaseQuiet: effect("assertQuiet"), assertClientWritesDenied: effect("assertAcl"),
    validateProofs: () => { events.push("validateProofs"); },
    captureCandidate: effect("captureCandidate", { targetSha: target }),
    verifyCandidate: effect("verifyCandidate", (_runtime, candidate, pause) => { assert.equal(candidate.targetSha, target); assert.equal(pause, "1"); }),
    stopCandidate: effect("stopCandidate"), resumeCandidate: effect("resumeCandidate", { ready: true }),
    verifyResumedCandidate: effect("verifyResumed"), stopResumedCandidate: effect("stopResumed"),
  };
  return { events, ops, state: () => state, replace: (value) => { state = value; } };
}
test("strict CLI rejects missing, duplicate, unexpected and unbound inputs", () => {
  for (const args of [["plan", ...flags, "--app-name", "x"], ["end", ...flags], ["plan", ...flags, "--expected-operation-id", operationId], ["prepare", ...flags, "--force"],
    ["prepare", ...flags.filter((value) => value !== "--json")], ["plan", ...flags.map((value) => value === "/srv/faolla" ? "/srv/../faolla" : value)],
    ["plan", ...flags.map((value) => value === target ? old : value)]]) assert.throws(() => parseMaintenanceRequest(args), /maintenance_arguments_invalid/);
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
test("register persists candidate identity and requires paused real runtime", async () => {
  const f = fixture(); assert.equal((await runMaintenanceAction(request("register-candidate"), f.ops)).state, "candidate");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "captureCandidate", "save:candidate", "verifyIngress", "verifyCandidate"]);
});
test("wrong candidate target cannot pass verification or reopen traffic", async () => {
  const f = fixture("candidate"); f.replace({ ...f.state(), candidate: { targetSha: old } });
  await assert.rejects(runMaintenanceAction(request("end"), f.ops), /maintenance_candidate_target_invalid/);
  assert.equal(f.events.includes("resumeCandidate"), false);
});
test("end requires final ACL boundary before resume and real verification before reopen", async () => {
  const f = fixture("candidate"); assert.equal((await runMaintenanceAction(request("end"), f.ops)).state, "ended");
  assert.deepEqual(f.events, ["validateProofs", "verifyIngress", "verifyCandidate", "assertAcl", "save:resuming", "resumeCandidate", "save:resuming", "verifyResumed", "verifyIngress", "restoreIngress", "verifyResumed", "save:ended"]);
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
  assert.deepEqual(f.events, ["validateProofs", "installIngress", "save:ended", "stopResumed", "verifyIngress", "assertStopped", "assertQuiet", "save:failed-held"]);
});
