import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parsePlanPosthocQuery, parsePlanPosthocCommand, parsePlanPosthocResult } from "./merchantAttendancePlanPosthoc";
import { projectPlanPosthocResult, executePlanPosthoc, planPosthocSiteEnabled } from "./merchantAttendancePlanPosthoc.server";
import type { PlanPosthocQuery, PlanPosthocCommand, PlanPosthocOperation, PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

// Protocol fixtures only: they do not prove an SQL hash, real authentication,
// historical identity, approved leave, or any previously completed workflow.
const old = () => exceptionUiEligibleSource();
const query = (mode: "detail" | "recover" = "detail"): PlanPosthocQuery => ({ siteId: old().siteId, workerId: old().worker.workerId, slotId: old().slot.id, mode, operationId: mode === "recover" ? id(800) : null });
function value(): PlanPosthocResult {
  const b = old(), { source, worker, slot, actorId, siteId, readAt } = b;
  source.sessions = []; source.approval = null;
  const preview = { fingerprint: "a".repeat(64), eligible: true, blockers: [], candidates: [], approval: null,
    source: { protocol: "posthoc-adoption-preview-v1" as const, basis: source, caseId: id(790), caseRevision: 1, revision: 0, currentOperationId: null, candidates: [], approval: null, blockers: [] } };
  return { protocol: "plan-posthoc-adoption-v1", siteId, actorId, worker: structuredClone(worker), slot: structuredClone(slot), readAt, revision: 0, current: null, preview, history: [], historyTruncated: false, receipt: null };
}
function command(): PlanPosthocCommand { return { action: "apply", operationId: id(800), expectedRevision: 0, expectedFingerprint: "a".repeat(64), employeeId: old().worker.employeeId, employeeAuthUserId: old().worker.employeeAuthUserId, reason: "Synthetic explicit leave-only activation", sources: [] }; }
function saved(): PlanPosthocResult {
  const v = value(), c = command();
  const item: PlanPosthocOperation = { operationId: c.operationId, revision: 1, action: c.action, actorId: v.actorId, employeeId: c.employeeId, employeeAuthUserId: c.employeeAuthUserId, reason: c.reason, sources: [], sourceFingerprint: c.expectedFingerprint, recordedAt: v.readAt };
  v.revision = 1; v.current = item; v.history = [structuredClone(item)]; v.preview = null; v.receipt = { operationId: c.operationId, command: c, item: structuredClone(item) }; return v;
}
function rawWithCanonical(v = value()) {
  if (!v.preview) return v;
  const sourceText = JSON.stringify(v.preview.source), fingerprint = createHash("sha256").update(sourceText).digest("hex");
  return { ...v, preview: { ...v.preview, sourceText, fingerprint } };
}
test("posthoc query is owner-specific exact detail or original-ID recovery; ambiguous modes fail", () => {
  assert.deepEqual(parsePlanPosthocQuery(query()), query()); assert.deepEqual(parsePlanPosthocQuery(query("recover")), query("recover"));
  for (const patch of [{ access: "self" }, { mode: "recover" }, { operationId: id(1) }, { mode: "list" }, { siteId: "12345678\n" }, { workerId: null }]) assert.throws(() => parsePlanPosthocQuery({ ...query(), ...patch }));
});
test("strict apply/revoke commands reject ambiguous references, same missing root and empty reasons", () => {
  assert.deepEqual(parsePlanPosthocCommand(command()), command());
  const session = { kind: "session", startEventId: id(801), lastEventId: id(802), lastSequence: 2, effectOperationId: null, effectRevision: null };
  const missing = { kind: "missing", rootRequestId: id(803), requestId: id(804), approvalOperationId: id(805) };
  assert.doesNotThrow(() => parsePlanPosthocCommand({ ...command(), sources: [session, missing] }));
  for (const sources of [[session, session], [missing, { ...missing, requestId: id(806) }], [{ ...session, effectRevision: 2 }], [{ ...missing, approvalOperationId: missing.requestId }], Array.from({ length: 11 }, () => session), [{ ...session, original: {} }]]) assert.throws(() => parsePlanPosthocCommand({ ...command(), sources }));
  for (const patch of [{ reason: " " }, { expectedRevision: -0 }, { reason: "x".repeat(1001) }, { reason: "\ud800" }, { extra: true }, { expectedFingerprint: "A".repeat(64) }]) assert.throws(() => parsePlanPosthocCommand({ ...command(), ...patch }));
  const { sources: _sources, ...base } = command() as Extract<PlanPosthocCommand, { action: "apply" }>; void _sources;
  assert.doesNotThrow(() => parsePlanPosthocCommand({ ...base, action: "revoke", expectedRevision: 1 }));
  assert.throws(() => parsePlanPosthocCommand({ ...base, action: "revoke" }));
  assert.throws(() => parsePlanPosthocCommand({ ...command(), action: "revoke", expectedRevision: 1 }));
});
test("preview parses detached old v1 evidence without changing old source or treating selection as a verdict", () => {
  const v = value(), before = structuredClone(v), result = parsePlanPosthocResult(v, query(), v.actorId);
  assert.deepEqual(v, before); assert(!Object.isFrozen(v)); assert(Object.isFrozen(result.preview!.source.basis));
  assert.equal(result.preview!.source.basis.policy, "owner-confirmed-plan-edges-v1"); assert.equal(result.current, null);
  assert.equal("candidate" in result.preview!, false); assert.equal("hours" in result, false);
});
test("saved exact replay and recovery remain readable without preview or write flag", () => {
  const v = saved(); assert.equal(parsePlanPosthocResult(v, query("recover"), v.actorId).receipt!.operationId, id(800));
  assert.equal(parsePlanPosthocResult(v, query(), v.actorId, command()).revision, 1);
  assert.throws(() => parsePlanPosthocResult(v, query(), v.actorId));
  assert.throws(() => parsePlanPosthocResult(v, query("recover"), id(801)));
  assert.throws(() => parsePlanPosthocResult(v, query("recover"), v.actorId, { ...command(), reason: "changed" }));
});
test("current/history/receipt must agree exactly and retain the original employee/Auth pair", () => {
  for (const mutate of [
    (v: PlanPosthocResult) => { v.history[0].reason = "changed"; },
    (v: PlanPosthocResult) => { v.receipt!.item.employeeAuthUserId = id(899); },
    (v: PlanPosthocResult) => { v.receipt!.item.sourceFingerprint = "b".repeat(64); },
    (v: PlanPosthocResult) => { v.receipt!.command.expectedRevision = 1; },
    (v: PlanPosthocResult) => { v.historyTruncated = true; },
    (v: PlanPosthocResult) => { v.history = []; },
    (v: PlanPosthocResult) => { v.current!.action = "revoke"; },
    (v: PlanPosthocResult) => { v.current!.actorId = v.worker.employeeAuthUserId; },
    (v: PlanPosthocResult) => { v.preview = value().preview; },
  ]) { const v = saved(); mutate(v); assert.throws(() => parsePlanPosthocResult(v, query("recover"), v.actorId)); }
});
test("source duplicated fields, case existence, current revision and metadata cannot drift", () => {
  for (const mutate of [
    (v: PlanPosthocResult) => { v.preview!.source.revision = 1; },
    (v: PlanPosthocResult) => { v.preview!.source.currentOperationId = id(800); },
    (v: PlanPosthocResult) => { v.preview!.source.caseId = null; },
    (v: PlanPosthocResult) => { v.preview!.eligible = false; },
    (v: PlanPosthocResult) => { v.preview!.source.blockers = ["sealed"]; },
    (v: PlanPosthocResult) => { v.preview!.source.basis.worker.employeeAuthUserId = id(899); },
    (v: PlanPosthocResult) => { v.preview!.source.basis.context.leave.items = [{ requestId: id(4) } as never]; },
  ]) { const v = value(); mutate(v); assert.throws(() => parsePlanPosthocResult(v, query(), v.actorId)); }
});
test("server verifies canonical UTF8 bytes/hash and semantic tree then removes private sourceText", () => {
  const raw = rawWithCanonical(); const result = projectPlanPosthocResult(raw, query(), old().actorId);
  assert.equal("sourceText" in result.preview!, false);
  for (const variant of [
    { ...raw, preview: { ...raw.preview, sourceText: "{}" } },
    { ...raw, preview: { ...raw.preview, fingerprint: "f".repeat(64) } },
    { ...raw, preview: { ...raw.preview, source: { ...raw.preview!.source, caseRevision: 2 } } },
  ]) assert.throws(() => projectPlanPosthocResult(variant, query(), old().actorId));
});
test("strict parsers reject unsafe object trees without invoking getters or freezing caller objects", () => {
  let calls = 0; const v = value(); Object.defineProperty(v, "preview", { get: () => { calls++; throw Error("getter"); }, enumerable: true });
  assert.throws(() => parsePlanPosthocResult(v, query(), old().actorId)); assert.equal(calls, 0);
  const cycle = value() as unknown as Record<string, unknown>; cycle.preview = cycle; assert.throws(() => parsePlanPosthocResult(cycle, query(), old().actorId));
});
test("fresh-write gate is independent default-off exact-site, including malformed lists", () => {
  const site = old().siteId, env = { FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS: site };
  assert(planPosthocSiteEnabled(site, env)); assert(!planPosthocSiteEnabled(site, {}));
  for (const raw of [site + ",", "*", site + ",bad", "1" + site, Array.from({ length: 101 }, () => site).join(",")]) assert(!planPosthocSiteEnabled(site, { ...env, FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS: raw }));
  assert(!planPosthocSiteEnabled(site + "\n", env));
});
test("service default-off still sends original commands for SQL replay; clients cannot force a disabled site on", async () => {
  const keys = ["FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED", "FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS"] as const, prior = keys.map(k => process.env[k]);
  try { keys.forEach(k => { delete process.env[k]; }); let count = 0;
    const service = { rpc: async (name: string, args: Record<string, unknown>) => { count++; assert.equal(name, "faolla_attendance_plan_posthoc_adoption_v1"); assert.equal(args.p_allow_write, false); assert.deepEqual(args.p_command, command()); return { data: saved(), error: null }; } };
    assert.equal((await executePlanPosthoc({ query: query(), authUserId: old().actorId, command: command(), moduleEnabled: true }, service)).revision, 1); assert.equal(count, 1);
  } finally { keys.forEach((k, n) => { if (prior[n] === undefined) delete process.env[k]; else process.env[k] = prior[n]; }); }
});
test("service sanitizes unknown transport/SQL errors and disallows mutations in recovery query", async () => {
  const input = { query: query(), authUserId: old().actorId };
  for (const service of [null, { rpc: async () => { throw Error("secret database detail"); } }, { rpc: async () => ({ data: null, error: { message: "secret database detail" } }) }]) await assert.rejects(executePlanPosthoc(input, service), /attendance_unavailable/);
  await assert.rejects(executePlanPosthoc(input, { rpc: async () => ({ data: null, error: { message: "attendance_plan_posthoc_adoption_blocked" } }) }), /attendance_plan_posthoc_adoption_blocked/);
  await assert.rejects(executePlanPosthoc({ ...input, query: query("recover"), command: command() }, { rpc: async () => { throw Error("must not call"); } }), /attendance_invalid_request/);
});
