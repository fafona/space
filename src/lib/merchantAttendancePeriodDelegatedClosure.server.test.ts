import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { executePeriodDelegatedClosures, periodDelegatedClosuresEnabled, projectPeriodDelegatedClosureResult } from "./merchantAttendancePeriodDelegatedClosure.server";
import { parsePeriodDelegatedClosureQuery, periodDelegatedClosureFingerprintText, type PeriodDelegatedClosureQuery, type PeriodDelegatedClosureCommand } from "./merchantAttendancePeriodDelegatedClosure";
import { periodClosureUiQuery, periodClosureUiCommand, periodClosureUiSummary, periodClosureUiArtifact, periodClosureUiId as id } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { periodClosureV2FixtureSource } from "../../scripts/fixtures/attendance-period-closure-v2-model";

// Synthetic RPC protocol fixtures, not database or authentication acceptance.
const actor = id(903), employee = id(902), grant = id(901), readAt = "2026-09-11T12:00:00.000001Z";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function query(mode: PeriodDelegatedClosureQuery["mode"] = "detail") {
  return parsePeriodDelegatedClosureQuery({ ...periodClosureUiQuery("detail"), access: "delegate", grantId: grant, mode,
    periodId: ["list", "preview"].includes(mode) ? null : periodClosureUiQuery("detail").periodId,
    operationId: mode === "recover" ? periodClosureUiCommand().operationId : null, cursor: null });
}
function command(): PeriodDelegatedClosureCommand { return { ...periodClosureUiCommand(), action: "send", expectedRevision: 0, expectedVersion: 0 }; }
function common(q: PeriodDelegatedClosureQuery) { return { protocol: "period-delegated-closure-v1", siteId: q.siteId, access: q.access,
  workerId: q.workerId, grantId: q.grantId, actorId: actor, employeeId: employee, readAt }; }
function receipt(q = query(), c = command()) { return { ...common(q), kind: "receipt", usableActions: [], receipt: {
  operationId: c.operationId, action: c.action, grantId: q.grantId, grantRevision: 1, periodId: q.periodId, periodRevision: c.expectedRevision + 1,
  actorId: actor, recordedAt: readAt, commandFingerprint: sha(periodDelegatedClosureFingerprintText(q, c)),
} }; }
function rawSource() { const s = periodClosureV2FixtureSource(); return { ...s, report: { ...s.report, access: "delegate" }, validation: "delegate_checked" }; }
function stub(run: (name: string, args: Record<string, unknown>, n: number) => { data: unknown; error: { message: string } | null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return run(name, args, calls.length); } };
  return { calls, service };
}

test("fresh delegation requires all existing period and independent delegation rollout switches", () => {
  const site = query().siteId, enabled = { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: site,
    FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES: site };
  assert.equal(periodDelegatedClosuresEnabled(site, enabled), true);
  for (const key of Object.keys(enabled)) for (const value of [undefined, "", "true", "*"]) assert.equal(periodDelegatedClosuresEnabled(site, { ...enabled, [key]: value }), false, `${key}:${value}`);
  assert.equal(periodDelegatedClosuresEnabled("99999999", enabled), false);
});

test("disabled fresh reads and every write fail before RPC; explicit recovery retains actual auth and returns no authority", async () => {
  const f = stub(() => { throw Error("no fresh RPC"); });
  for (const mode of ["list", "preview", "detail", "history", "versions"] as const) await assert.rejects(executePeriodDelegatedClosures({ query: query(mode), authUserId: actor, moduleEnabled: false }, f.service), /attendance_period_delegation_disabled/);
  for (const action of ["send", "respond", "seal", "reopen"] as const) await assert.rejects(executePeriodDelegatedClosures({ query: query(), command: { ...command(), action, expectedRevision: 2, expectedVersion: 1, reason: "Explicit" }, authUserId: actor, moduleEnabled: false }, f.service), /attendance_period_delegation_disabled/);
  assert.equal(f.calls.length, 0);
  const q = query("recover"), recovery = stub((_name, args) => {
    assert.equal(args.p_auth_user_id, actor); assert.equal(args.p_allow_write, false); assert.equal(args.p_command, null); assert.equal(args.p_artifact, null);
    return { data: receipt(), error: null };
  });
  const result = await executePeriodDelegatedClosures({ query: q, authUserId: actor, moduleEnabled: false }, recovery.service);
  assert.equal(result.kind, "receipt"); assert.deepEqual(result.usableActions, []); assert.equal(recovery.calls.length, 1);
  assert(!Object.hasOwn(result, "artifact")); assert(!Object.hasOwn(result, "period")); assert(!Object.hasOwn(result, "source"));
});

test("send first recovers exact original receipt with zero source collection and zero write RPC", async () => {
  const q = query(), c = command(), f = stub((name, args) => {
    assert.equal(name, "faolla_attendance_period_delegated_closure_v1"); assert.equal((args.p_query as PeriodDelegatedClosureQuery).mode, "recover");
    assert.equal(args.p_command, null); assert.equal(args.p_artifact, null); assert.equal(args.p_allow_write, false); return { data: receipt(q, c), error: null };
  });
  const result = await executePeriodDelegatedClosures({ query: q, command: c, authUserId: actor, moduleEnabled: true }, f.service);
  assert.equal(result.kind, "receipt"); assert.equal(f.calls.length, 1);
});

test("foreign or changed recovery receipt never falls through to source or POST", async () => {
  const q = query(), c = command(), saved = receipt(q, c);
  for (const patch of [{ actorId: id(8888) }, { grantId: id(8888) }, { periodId: id(8888) }, { operationId: id(8888) }, { commandFingerprint: "0".repeat(64) }]) {
    const f = stub(() => ({ data: { ...saved, receipt: { ...saved.receipt, ...patch } }, error: null }));
    await assert.rejects(executePeriodDelegatedClosures({ query: q, command: c, authUserId: actor, moduleEnabled: true }, f.service), Object.keys(patch).join(",")); assert.equal(f.calls.length, 1);
  }
  assert.notEqual(sha(periodDelegatedClosureFingerprintText(q, c)), sha(periodDelegatedClosureFingerprintText({ ...q, grantId: id(800) }, c)));
  assert.notEqual(sha(periodDelegatedClosureFingerprintText(q, c)), sha(periodDelegatedClosureFingerprintText(q, { ...c, reason: "Changed" })));
});

test("only an exact receipt-null recovery permits fresh strict source projection then one original command", async () => {
  const q = query(), s = rawSource(), c = { ...command(), expectedFingerprint: s.sourceFingerprint };
  const f = stub((name, args, n) => {
    assert.equal(name, "faolla_attendance_period_delegated_closure_v1"); assert.equal(args.p_auth_user_id, actor);
    const rq = args.p_query as PeriodDelegatedClosureQuery;
    if (n === 1) return { data: { ...common(rq), kind: "receipt", usableActions: [], receipt: null }, error: null };
    if (n === 2) { assert.equal(rq.mode, "preview"); assert.equal(rq.periodId, null); assert.equal(args.p_allow_write, true); assert.equal(args.p_command, null);
      return { data: { ...common(rq), kind: "preview", usableActions: ["view", "send"], source: s, period: null }, error: null }; }
    assert.equal(n, 3); assert.deepEqual(args.p_query, q); assert.deepEqual(args.p_command, c); assert.equal(args.p_allow_write, true);
    const a = args.p_artifact as Record<string, unknown>; assert.equal(a.protocol, "attendance-period-artifact-v2"); assert.equal(Object.keys(a).length, 8);
    assert(!Object.hasOwn(a, "authority")); assert.equal((a.report as Record<string, unknown>).access, "delegate"); assert.equal(a.sourceFingerprint, s.sourceFingerprint);
    return { data: receipt(q, c), error: null };
  });
  assert.equal((await executePeriodDelegatedClosures({ query: q, command: c, authUserId: actor, moduleEnabled: true }, f.service)).kind, "receipt");
  assert.equal(f.calls.length, 3); assert.equal(f.calls.filter(x => x.args.p_command !== null).length, 1);
});

test("source hash or source scope mismatch stops send before a write", async () => {
  const q = query(), c = command();
  for (const patch of [{}, { sourceFingerprint: "f".repeat(64) }, { validation: "owner_checked" }, { workerId: id(888) }]) {
    const f = stub((_name, args, n) => ({ data: n === 1 ? { ...common(args.p_query as PeriodDelegatedClosureQuery), kind: "receipt", usableActions: [], receipt: null }
      : { ...common(args.p_query as PeriodDelegatedClosureQuery), kind: "preview", usableActions: ["view", "send"], source: { ...rawSource(), ...patch }, period: null }, error: null }));
    await assert.rejects(executePeriodDelegatedClosures({ query: q, command: c, authUserId: actor, moduleEnabled: true }, f.service));
    assert.equal(f.calls.length, 2); assert(f.calls.every(x => x.args.p_command === null));
  }
});

test("saved detail verifies original UTF8 bytes, SHA and exact JSON without querying a source", async () => {
  const q = query(), artifact = periodClosureUiArtifact(), artifactText = JSON.stringify(artifact);
  const raw = { ...common(q), usableActions: ["view"], kind: "detail", period: periodClosureUiSummary(), artifact, artifactVersion: 1,
    sourceChanged: false, operation: null, replayed: false, artifactText, artifactBytes: Buffer.byteLength(artifactText), artifactSha256: sha(artifactText) };
  const f = stub(() => ({ data: raw, error: null }));
  const result = await executePeriodDelegatedClosures({ query: q, authUserId: actor, moduleEnabled: true }, f.service);
  assert.equal(result.kind, "detail"); assert.equal(f.calls.length, 1); assert(!Object.hasOwn(result, "artifactText"));
  for (const patch of [{ artifactBytes: raw.artifactBytes + 1 }, { artifactSha256: "0".repeat(64) }, { artifactText: artifactText + " " },
    { artifactText: artifactText.replace('"protocol":', '"protocol":"duplicate","protocol":') }, { extra: true }]) assert.throws(() => projectPeriodDelegatedClosureResult({ ...raw, ...patch }, q, actor, null));
});

test("known RPC failures remain typed; unknown exceptions and malformed original replies never trigger fallback", async () => {
  for (const message of ["attendance_access_denied", "attendance_period_source_changed", "attendance_period_storage_limit"]) {
    const f = stub(() => ({ data: null, error: { message } }));
    await assert.rejects(executePeriodDelegatedClosures({ query: query(), command: command(), authUserId: actor, moduleEnabled: true }, f.service), new RegExp(message)); assert.equal(f.calls.length, 1);
  }
  for (const f of [stub(() => ({ data: null, error: { message: "secret database internals" } })), stub(() => { throw Error("secret transport"); })]) {
    await assert.rejects(executePeriodDelegatedClosures({ query: query(), authUserId: actor, moduleEnabled: true }, f.service), error => error instanceof Error && error.message === "attendance_unavailable"); assert.equal(f.calls.length, 1);
  }
  await assert.rejects(executePeriodDelegatedClosures({ query: query(), authUserId: actor, moduleEnabled: true }, null), /attendance_unavailable/);
  const malformed = stub(() => ({ data: null, error: null })); await assert.rejects(executePeriodDelegatedClosures({ query: query(), command: command(), authUserId: actor, moduleEnabled: true }, malformed.service)); assert.equal(malformed.calls.length, 1);
});
