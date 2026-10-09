import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import * as p from "./merchantAttendanceDelegatedCredentials";
import { createDelegatedCredentialsService } from "./merchantAttendanceDelegatedCredentials.server";
import { withAttendancePinKdf } from "./merchantAttendancePin.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

// Opt-in resource check only: real default207 KDF paths, MOCK SQL/authority.
// One member issue followed by one independent issue = exactly TWO scrypts.
// No verifier override, reference derivation, verification, retry or real Auth.
// Run this file alone, serially, only after obtaining the shared heavy lease:
// FAOLLA_ATTENDANCE_DELEGATED_CREDENTIALS_REAL_KDF_CHECK=1
const enabled = process.env.FAOLLA_ATTENDANCE_DELEGATED_CREDENTIALS_REAL_KDF_CHECK === "1";
const id = (n: number) => `20700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990207", actor = id(1), locationId = id(5);
const at = "2026-10-09T12:00:00.000001Z", before = "2026-10-09T11:58:00.000001Z";
const pin = "72483516", key = "synthetic207-real-kdf-check-not-production";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
// Independent reference encoder: only scalar array elements occur below.
const tuple = (values: readonly (string | number)[]) => `[${values.map(value => JSON.stringify(value)).join(", ")}]`;
const environment = () => ({ FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_PIN_SITE_IDS: siteId });
type Material = Readonly<{ salt: string; verifier: string; commitment: string }>;
function privateMaterial(raw: unknown): Material {
  assert(raw !== null && typeof raw === "object", "private material must be an object");
  assert.deepEqual(Object.keys(raw).sort(), ["commitment", "salt", "verifier"]);
  const salt: unknown = Object.getOwnPropertyDescriptor(raw, "salt")?.value;
  const verifier: unknown = Object.getOwnPropertyDescriptor(raw, "verifier")?.value;
  const commitment: unknown = Object.getOwnPropertyDescriptor(raw, "commitment")?.value;
  assert(typeof salt === "string" && /^[0-9a-f]{32}$/.test(salt), "private salt shape");
  assert(typeof verifier === "string" && /^[0-9a-f]{64}$/.test(verifier), "private verifier shape");
  assert(typeof commitment === "string" && /^[0-9a-f]{64}$/.test(commitment), "private commitment shape");
  return { salt, verifier, commitment };
}
function context(query: p.DelegatedCredentialsContextQuery, command: p.DelegatedPinCommand): p.DelegatedPinContextResult {
  const common = { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "context" as const,
    grantId: query.grantId, action: command.action };
  if (command.kind === "member_pin") return { ...common,
    scope: { kind: "member_pin", workerId: command.workerId, employeeId: command.employeeId,
      employeeAuthUserId: command.employeeAuthUserId, locationIds: [locationId] },
    context: { employeeAuthUserId: command.employeeAuthUserId, status: { siteId, workerId: command.workerId,
      employeeId: command.employeeId, workerNo: command.workerNo, workerName: "Synthetic207 member", ready: true,
      revision: command.expectedRevision, enabled: true, bindingCurrent: true, changedAt: before, receipt: null } } };
  return { ...common, scope: { kind: "independent_pin", workerId: command.workerId, subjectId: command.subjectId,
    generation: command.expectedGeneration, locationIds: [locationId] }, context: { settingsVersion: command.expectedSettingsVersion,
    detail: { kind: "detail", subject: { workerId: command.workerId, subjectId: command.subjectId, workerNo: "独立207",
      displayName: "Synthetic207 independent", startsOn: "2026-10-09", locationId, enabled: true,
      generation: command.expectedGeneration, revision: command.expectedSubjectRevision,
      workerVersion: command.expectedWorkerVersion, state: "independent", createdAt: before },
    credential: { credentialId: id(30), enabled: true, revision: command.expectedCredentialRevision,
      generation: command.expectedGeneration, changedAt: before },
    head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null } } };
}
async function harness(query: p.DelegatedCredentialsContextQuery, command: p.DelegatedPinCommand) {
  let calls = 0, completedKdfPaths = 0;
  const reference: p.DelegatedPinReference = command.kind === "member_pin"
    ? { kind: "member_pin", workerId: command.workerId, employeeId: command.employeeId,
      employeeAuthUserId: command.employeeAuthUserId, revision: command.expectedRevision + 1 }
    : { kind: "independent_pin", workerId: command.workerId, subjectId: command.subjectId,
      subjectRevision: command.expectedSubjectRevision + 1, generation: command.expectedGeneration,
      workerVersion: command.expectedWorkerVersion + 1, credentialRevision: command.expectedCredentialRevision + 1 };
  const saved: p.DelegatedPinResult = { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId: actor, readAt: at,
    kind: "receipt", receipt: { operationId: command.operationId, actorId: actor, grantId: query.grantId,
      action: command.action, reference, commandFingerprint: await p.delegatedPinCommandFingerprint(query, actor, command),
      // Mock business fingerprint is NOT an actual SQL postimage proof.
      businessFingerprint: "b".repeat(64), recordedAt: before } };
  const rpc: AttendanceSelfRpc = { rpc: async (name, args) => {
    calls++;
    assert.equal(name, p.DELEGATED_PIN_RPC);
    assert.deepEqual(Object.keys(args), ["p_query", "p_auth_user_id", "p_command", "p_allow_write", "p_material"]);
    assert.equal(args.p_auth_user_id, actor);
    const actualQuery = p.parseDelegatedCredentialsQuery(args.p_query);
    assert.equal(actualQuery.siteId, siteId); assert.equal(actualQuery.grantId, query.grantId);
    assert(!JSON.stringify(args).includes(pin), "raw PIN must never enter the mock RPC");
    assert(!JSON.stringify(args).includes(key), "pepper must never enter the mock RPC");
    if (calls === 1) {
      assert.equal(actualQuery.mode, "recover"); assert.equal(actualQuery.operationId, command.operationId);
      assert.equal(args.p_command, null); assert.equal(args.p_allow_write, false); assert.equal(args.p_material, null);
      return { data: { ...saved, receipt: null }, error: null };
    }
    assert.deepEqual(actualQuery, query);
    if (calls === 2) {
      assert.equal(args.p_command, null); assert.equal(args.p_allow_write, false); assert.equal(args.p_material, null);
      return { data: context(query, command), error: null };
    }
    assert.equal(calls, 3, "each real KDF path gets exactly three mock RPCs");
    assert.deepEqual(args.p_command, command); assert.equal(args.p_allow_write, true);
    const material = privateMaterial(args.p_material);
    if (command.kind === "member_pin") {
      const values = [siteId, actor, query.grantId, command.operationId, command.workerId, command.employeeId,
        command.employeeAuthUserId, command.expectedRevision + 1];
      const salt = createHmac("sha256", key).update(tuple(["faolla-attendance-delegated-member-pin-salt-v1", ...values]), "utf8")
        .digest("hex").slice(0, 32);
      assert(material.salt === salt, "member deterministic private salt mismatch");
      assert(material.commitment === sha(tuple(["attendance-delegated-member-pin-material-v1", ...values, material.salt, material.verifier])),
        "member private material commitment mismatch");
    } else {
      const values = [siteId, command.workerId, command.subjectId, command.expectedGeneration, command.expectedCredentialRevision + 1, command.operationId];
      const salt = createHmac("sha256", key).update(tuple(["faolla-attendance-independent-pin-salt-v1", ...values]), "utf8")
        .digest("hex").slice(0, 32);
      assert(material.salt === salt, "independent deterministic private salt mismatch");
      assert(material.commitment === sha(tuple(["attendance-independent-pin-material-v1", ...values, material.salt, material.verifier])),
        "independent private material commitment mismatch");
    }
    // No extra KDF: this proves the SAME process gate was released before SQL.
    assert.equal(await withAttendancePinKdf(async () => true), true);
    completedKdfPaths++;
    const publicText = JSON.stringify(saved);
    for (const secret of [pin, key, material.salt, material.verifier, material.commitment])
      assert(!publicText.includes(secret), "public receipt contains private material");
    return { data: saved, error: null };
  } };
  // Deliberately NO memberVerifier/independentMaterial overrides here.
  const service = createDelegatedCredentialsService(rpc, { environment, pepper: () => key });
  return { service, saved, counts: () => ({ calls, completedKdfPaths }) };
}

test("207 opt-in actual default member and independent KDF paths: exactly two sequential derives, six mock RPCs", {
  skip: !enabled, concurrency: false, timeout: 25000,
}, async t => {
  const memberQuery: p.DelegatedCredentialsContextQuery = { siteId, grantId: id(2), mode: "context", operationId: null };
  const member: p.DelegatedMemberPinCommand = { kind: "member_pin", action: "pin_issue", operationId: id(3), workerId: id(6),
    employeeId: id(7), employeeAuthUserId: id(8), workerNo: "员工207", expectedRevision: 1, reason: "Synthetic real-KDF postcheck" };
  const memberCheck = await harness(memberQuery, member);
  const memberResult = await memberCheck.service.executePin({ query: memberQuery, command: member, pin, authUserId: actor, allowWrite: true });
  assert.deepEqual(memberResult, memberCheck.saved); assert.deepEqual(memberCheck.counts(), { calls: 3, completedKdfPaths: 1 });
  const independentQuery: p.DelegatedCredentialsContextQuery = { siteId, grantId: id(12), mode: "context", operationId: null };
  const independent: p.DelegatedIndependentPinCommand = { kind: "independent_pin", action: "pin_issue", operationId: id(13), workerId: id(16),
    subjectId: id(19), expectedSubjectRevision: 2, expectedGeneration: 1, expectedWorkerVersion: 3,
    expectedSettingsVersion: 4, expectedCredentialRevision: 1, reason: "Synthetic real-KDF postcheck" };
  const independentCheck = await harness(independentQuery, independent);
  const independentResult = await independentCheck.service.executePin({ query: independentQuery, command: independent, pin, authUserId: actor, allowWrite: true });
  assert.deepEqual(independentResult, independentCheck.saved); assert.deepEqual(independentCheck.counts(), { calls: 3, completedKdfPaths: 1 });
  assert.equal(await withAttendancePinKdf(async () => true), true);
  t.diagnostic("real KDF paths completed: member=1 independent=1; mock RPCs=6; real SQL/Auth=0");
});
