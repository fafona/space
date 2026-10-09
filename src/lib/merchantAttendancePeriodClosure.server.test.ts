import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executePeriodClosures, periodClosuresSiteEnabled, projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { periodClosureUiArtifact, periodClosureUiCommand, periodClosureUiHttp, periodClosureUiQuery,
  periodClosureUiOwner as owner, periodClosureUiAuth as auth, periodClosureUiId as id } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
// Synthetic collector-shaped source using the actual old report wire, not the
// UI-only {synthetic:true} placeholder. This is pure protocol evidence, not SQL.
function sourceRaw() {
  const report = scheduleEvidenceWire().attendance, a = periodClosureUiArtifact(), q = periodClosureUiQuery();
  const base = structuredClone(report.base) as unknown as Record<string, unknown>; delete base.asOf;
  const context = { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [], sessions: [] }, reviews: [] };
  const canonical = { sourceVersion: "attendance-period-source-v1", siteId: q.siteId, workerId: q.workerId,
    employeeId: a.worker.employeeId, employeeAuthUserId: a.worker.employeeAuthUserId, timeZone: "UTC", fromDate: q.fromDate, throughDate: q.throughDate,
    fromAt: report.base.fromAt, toAt: report.base.toAt, dayBoundaries: a.dayBoundaries,
    report: { version: report.version, base, missing: [], complete: true, payrollReady: false }, context };
  const sourceText = JSON.stringify(canonical);
  return { ...canonical, report, sourceCanonical: canonical, sourceText, sourceFingerprint: sha(sourceText),
    readAt: report.base.asOf, blockers: [] as string[], complete: true, validation: "owner_checked" };
}
function detailRaw(q = periodClosureUiQuery("detail"), command: ReturnType<typeof periodClosureUiCommand> | null = null) {
  const data = periodClosureUiHttp(q, command).data; assert.equal(data.kind, "detail"); if (data.kind !== "detail") throw Error("fixture");
  const artifactText = JSON.stringify(data.artifact);
  return { ...data, artifactText, artifactSha256: sha(artifactText), artifactBytes: Buffer.byteLength(artifactText, "utf8") };
}
function stub(fn: (name: string, args: Record<string, unknown>, n: number) => Promise<{ data: unknown; error: { message: string } | null }> | { data: unknown; error: { message: string } | null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return fn(name, args, calls.length); } };
  return { calls, service };
}

test("server flag is default-off, exact1 and bounded explicit merchant allowlist", () => {
  const site = periodClosureUiQuery().siteId;
  for (const env of [{}, { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1" },
    { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "true", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: site },
    { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: "*" },
    { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: `${site},bad` }]) assert.equal(periodClosuresSiteEnabled(site, env), false);
  assert.equal(periodClosuresSiteEnabled(site, { FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: site }), true);
});

test("collector projection verifies bytes/hash/canonical JSON then uses the fixed-boundary period parser", () => {
  const raw = sourceRaw(), q = periodClosureUiQuery(), parsed = projectPeriodClosureSource(raw, q);
  assert.equal(parsed.artifact.sourceFingerprint, raw.sourceFingerprint); assert.deepEqual(parsed.artifact.source, raw.sourceCanonical);
  assert.equal(parsed.artifact.report.base.rows.length, 1); assert.equal(parsed.artifact.calculationVersion, "timesheet-v2-unified-v1");
  for (const patch of [{ sourceFingerprint: "0".repeat(64) }, { sourceText: raw.sourceText + " " }, { siteId: "87654321" },
    { employeeAuthUserId: "invalid" }, { blockers: ["open_session", "open_session"] }]) assert.throws(() => projectPeriodClosureSource({ ...raw, ...patch }, q));
  const bad = sourceRaw(); bad.report.base.items[0].events[1].sequence = 42;
  assert.throws(() => projectPeriodClosureSource(bad, q));
});

test("collector canonical cannot be substituted independently of the authorized raw identity/report", () => {
  const raw = sourceRaw(); raw.sourceCanonical.employeeAuthUserId = id(333);
  raw.sourceText = JSON.stringify(raw.sourceCanonical); raw.sourceFingerprint = sha(raw.sourceText);
  assert.throws(() => projectPeriodClosureSource(raw, periodClosureUiQuery()), /attendance_period_closure_invalid/);
});

test("fixed period projection uses saved UTC days without reinterpreting its timezone label", () => {
  const raw=sourceRaw(), zone="Saved/No-Current-Tzdata";
  raw.timeZone=zone;raw.report.base.timeZone=zone;raw.sourceCanonical.timeZone=zone;
  raw.sourceCanonical.report.base.timeZone=zone;
  raw.sourceText=JSON.stringify(raw.sourceCanonical);raw.sourceFingerprint=sha(raw.sourceText);
  const result=projectPeriodClosureSource(raw,periodClosureUiQuery());
  assert.equal(result.artifact.period.timeZone,zone);
  assert.deepEqual(result.artifact.dayBoundaries,raw.dayBoundaries);
  assert.deepEqual(result.artifact.report.totals,projectPeriodClosureSource(sourceRaw(),periodClosureUiQuery()).artifact.report.totals);
});

test("fixed-period collector failure never falls back to current-settings source", async () => {
  const q=periodClosureUiQuery("detail"),c=periodClosureUiCommand();
  const f=stub((_name,_args,n)=>({data:null,error:{message:n===1?"attendance_operation_not_found":"function unavailable"}}));
  await assert.rejects(executePeriodClosures({query:q,command:c,authUserId:owner,moduleEnabled:true},f.service),/attendance_unavailable/);
  assert.deepEqual(f.calls.map(x=>x.name),["faolla_attendance_period_closure_v1","faolla_attendance_period_closure_source_v1"]);
});

test("send recovers the original number before collecting sources even when creation is off", async () => {
  const q = periodClosureUiQuery("detail"), c = periodClosureUiCommand(), saved = detailRaw({ ...q, mode: "recover", operationId: c.operationId });
  const f = stub(() => ({ data: saved, error: null }));
  const result = await executePeriodClosures({ query: q, command: c, authUserId: owner, moduleEnabled: false }, f.service);
  assert.equal(result.kind, "detail"); if (result.kind === "detail") assert.equal(result.replayed, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { name: "faolla_attendance_period_closure_v1", args: {
    p_query: { ...q, mode: "recover", operationId: c.operationId }, p_auth_user_id: owner, p_command: null, p_artifact: null, p_allow_write: false } });
});

test("recovery conflict or authentication failure never falls through into a new source/write", async () => {
  const q = periodClosureUiQuery("detail"), c = periodClosureUiCommand();
  const mismatch = detailRaw({ ...q, mode: "recover", operationId: c.operationId }); mismatch.operation!.command.reason = "different original command"; mismatch.operation!.reason = mismatch.operation!.command.reason;
  const f = stub(() => ({ data: mismatch, error: null }));
  await assert.rejects(executePeriodClosures({ query: q, command: c, authUserId: owner }, f.service), /attendance_operation_conflict/); assert.equal(f.calls.length, 1);
  const denied = stub(() => ({ data: null, error: { message: "attendance_access_denied" } }));
  await assert.rejects(executePeriodClosures({ query: q, command: c, authUserId: owner }, denied.service), /attendance_access_denied/); assert.equal(denied.calls.length, 1);
});

test("unknown original permits exactly recover→real-actor source→same original command write", async () => {
  const q = periodClosureUiQuery("detail"), raw = sourceRaw(), c = { ...periodClosureUiCommand(), expectedFingerprint: raw.sourceFingerprint };
  const f = stub((name, args, n) => {
    assert.equal(args.p_auth_user_id, owner);
    if (n === 1) return { data: null, error: { message: "attendance_operation_not_found" } };
    if (n === 2) { assert.equal(name, "faolla_attendance_period_closure_source_v1");
      assert.deepEqual(args.p_query,{siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId});
      return { data: raw, error: null }; }
    const saved = detailRaw(q, c); saved.artifact = args.p_artifact as typeof saved.artifact;
    saved.artifactText = JSON.stringify(saved.artifact); saved.artifactSha256 = sha(saved.artifactText); saved.artifactBytes = Buffer.byteLength(saved.artifactText);
    return { data: saved, error: null };
  });
  await executePeriodClosures({ query: q, command: c, authUserId: owner, moduleEnabled: true }, f.service);
  assert.deepEqual(f.calls.map(x => x.name), ["faolla_attendance_period_closure_v1", "faolla_attendance_period_closure_source_v1", "faolla_attendance_period_closure_v1"]);
  assert.deepEqual(f.calls[2].args.p_command, c); assert.equal(f.calls[2].args.p_allow_write, true);
  assert.equal((f.calls[2].args.p_artifact as Record<string, unknown>).sourceFingerprint, raw.sourceFingerprint);
});

test("changed preflight fingerprint prevents a send after recovery miss", async () => {
  const f = stub((_name, _args, n) => n === 1 ? { data: null, error: { message: "attendance_operation_not_found" } } : { data: sourceRaw(), error: null });
  await assert.rejects(executePeriodClosures({ query: periodClosureUiQuery("detail"), command: periodClosureUiCommand(), authUserId: owner, moduleEnabled: true }, f.service), /attendance_period_source_changed/);
  assert.equal(f.calls.length, 2);
});

test("off flag does not suppress authorized reads or owner reopen; SQL receives false unchanged", async () => {
  const q = periodClosureUiQuery("detail"), f = stub(() => ({ data: detailRaw(q), error: null }));
  await executePeriodClosures({ query: q, authUserId: owner, moduleEnabled: false }, f.service);
  assert.equal(f.calls[0].args.p_allow_write, false); assert.equal(f.calls[0].args.p_command, null);
  const c = { ...periodClosureUiCommand(), action: "reopen" as const, expectedRevision: 3, expectedVersion: 1, expectedFingerprint: null, reason: "Explicit owner reopen" };
  const reopen = stub(() => ({ data: detailRaw(q, c), error: null }));
  await executePeriodClosures({ query: q, command: c, authUserId: owner, moduleEnabled: false }, reopen.service);
  assert.equal(reopen.calls.length, 1); assert.deepEqual(reopen.calls[0].args.p_command, c); assert.equal(reopen.calls[0].args.p_allow_write, false);
});

test("archive reads verify saved exact bytes and fixed version, not current sources", async () => {
  const q = periodClosureUiQuery("export"), saved = detailRaw(q), f = stub(() => ({ data: saved, error: null }));
  const result = await executePeriodClosures({ query: q, authUserId: owner }, f.service);
  assert.equal(result.kind, "detail"); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, "faolla_attendance_period_closure_v1");
  assert.equal(Object.hasOwn(result, "artifactText"), false); assert.equal(Object.hasOwn(result, "artifactSha256"), false);
  for (const patch of [{ artifactSha256: "0".repeat(64) }, { artifactBytes: saved.artifactBytes + 1 }, { artifactText: saved.artifactText + " " }]) {
    const bad = stub(() => ({ data: { ...saved, ...patch }, error: null }));
    await assert.rejects(executePeriodClosures({ query: q, authUserId: owner }, bad.service), /attendance_period_closure_invalid/);
  }
});

test("real member auth is never replaced by owner or worker identity", async () => {
  const q = periodClosureUiQuery("detail", "self"), f = stub(() => ({ data: detailRaw(q), error: null }));
  await executePeriodClosures({ query: q, authUserId: auth, moduleEnabled: false }, f.service);
  assert.equal(f.calls[0].args.p_auth_user_id, auth); assert.notEqual(f.calls[0].args.p_auth_user_id, owner);
});

test("invalid input and unknown database/transport errors are sanitized", async () => {
  const q = periodClosureUiQuery("detail"); await assert.rejects(executePeriodClosures({ query: q, authUserId: owner }, null), /attendance_unavailable/);
  for (const service of [{ rpc: async () => { throw Error("private SQL secret"); } }, { rpc: async () => ({ data: null, error: { message: "private SQL secret" } }) }])
    await assert.rejects(executePeriodClosures({ query: q, authUserId: owner }, service), error => error instanceof Error && error.message === "attendance_unavailable");
  const f = stub(() => ({ data: null, error: null }));
  await assert.rejects(executePeriodClosures({ query: { ...q, actorId: owner } as typeof q, authUserId: owner }, f.service), /attendance_invalid_request/);
  assert.equal(f.calls.length, 0);
});
