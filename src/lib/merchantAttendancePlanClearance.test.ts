import assert from "node:assert/strict";
import test from "node:test";
import { canClearPlanException, hasClearPlanExceptionBasis } from "./merchantAttendancePlanClearance";
import { planClearanceSiteEnabled } from "./merchantAttendancePlanClearance.server";
import { executePlanExceptions } from "./merchantAttendancePlanExceptions.server";
import { parsePlanExceptionCommand, parsePlanExceptionResult, parsePlanExceptionResponse, parsePlanExceptionHttpQuery } from "./merchantAttendancePlanExceptions";
import { calculateExceptionCandidate } from "./merchantAttendancePlanExceptionSource";
import { AttendancePlanExceptionClient, type PlanExceptionClientOptions, type PlanExceptionStorage } from "./merchantAttendancePlanExceptionClient";
import { parseEventNotificationsItem, parseEventNotificationsDetail } from "./merchantAttendanceEventNotifications";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import type { PlanExceptionAccess, PlanExceptionQuery, PlanExceptionCommand, PlanExceptionDecisionCommand, PlanExceptionHistoryEntry } from "./merchantAttendancePlanExceptionContract";
import { exceptionUiId as id, exceptionUiSite as site, exceptionUiOwner as owner, exceptionUiAuth as auth, exceptionUiEmployee as employee,
  exceptionUiWorker as worker, exceptionUiSlot as slot, exceptionUiQuery as query, exceptionUiWire, exceptionUiEvidence,
  exceptionUiEligibleSource, exceptionUiDecisionCommand } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { eventNotificationsDetail } from "../../scripts/fixtures/attendance-event-notifications-model";

// Detached protocol fixtures only. They attest no PostgreSQL canonical hash,
// correction writer, notification capture, authentication or legal conclusion.
function clearSource(withinGrace = false) {
  const value = exceptionUiEligibleSource(), startAt = value.slot.startAt.replace(".000Z", ".000000Z"), endAt = withinGrace
    ? new Date(Date.parse(value.slot.endAt) - 60000).toISOString().replace(".000Z", ".000000Z") : value.slot.endAt.replace(".000Z", ".000000Z");
  value.fingerprint = "c".repeat(64);
  value.source.sessions[0].original = { startAt, endAt }; value.source.sessions[0].selected = { startAt, endAt };
  value.source.sessions[0].relation.recordedAt = startAt; value.source.sessions[0].adoption!.recordedAt = startAt;
  value.candidate = calculateExceptionCandidate(value.source, true); return value;
}
function command(): PlanExceptionDecisionCommand { return { ...exceptionUiDecisionCommand(), operationId: id(901), expectedRevision: 1, expectedFingerprint: "c".repeat(64), outcome: "cleared" }; }
function wire(access: PlanExceptionAccess = "owner", mode: PlanExceptionQuery["mode"] = "detail", cleared = true, withReceipt = false) {
  const value = exceptionUiWire({ access, mode: "detail", saved: true }), detail = value.detail!, source = clearSource();
  if (access === "owner") { detail.current = source; detail.stale = true; }
  if (cleared) {
    const c = command(), decision = { ...detail.latestDecision!, operationId: c.operationId, revision: 2, outcome: c.outcome, note: c.note, evidence: exceptionUiEvidence(source) };
    detail.latestDecision = decision; detail.revision = 2;
    const { evidence: _evidence, readAt: _readAt, ...history } = decision; void _evidence; void _readAt;
    detail.history.unshift(history); if (access === "owner") detail.stale = false;
    if (withReceipt) { const { readAt: _read, ...item } = decision; void _read; value.receipt = { operationId: c.operationId, command: c, item }; }
  }
  if (mode === "recover") { detail.current = null; detail.currentValidation = "not_checked"; detail.stale = null; detail.canDecide = false; }
  if (mode === "list") {
    const result = exceptionUiWire({ access, mode: "list", saved: true });
    if (cleared) { result.items[0].revision = 2; result.items[0].latestDecision = { operationId: id(901), revision: 2, outcome: "cleared", recordedAt: value.readAt, readAt: null }; }
    return result;
  }
  return value;
}
const q = (mode: PlanExceptionQuery["mode"] = "detail", access: PlanExceptionAccess = "owner") => query(access, mode, id(901));
function http(mode: PlanExceptionQuery["mode"], cleared = true, receipt = false, moduleEnabled = true) {
  const data = wire("owner", mode, cleared, receipt);
  if (!moduleEnabled && data.detail) { data.detail.canDecide = false; data.detail.canNote = false; }
  return { ok: true, moduleEnabled, data };
}

test("clearance is a strict existing-case decision command, not a new case or employee action", () => {
  assert.deepEqual(parsePlanExceptionCommand(q("decide"), command()), command());
  for (const patch of [{ expectedRevision: 0 }, { outcome: ["cleared"] }, { outcome: "no_exception" }, { note: "" }, { candidate: {} }, { employeeAuthUserId: "bad" }]) {
    assert.throws(() => parsePlanExceptionCommand(q("decide"), { ...command(), ...patch }));
  }
  assert.throws(() => parsePlanExceptionCommand(q("decide", "self"), command()));
  assert.deepEqual(parsePlanExceptionCommand(q("recover"), command()), command());
});

test("owner/self cleared details, original receipts and list accept saved revision2 without reclassifying history", () => {
  for (const access of ["owner", "self"] as const) for (const mode of ["detail", "list"] as const) {
    const result = parsePlanExceptionResult(wire(access, mode), q(mode, access), { authUserId: access === "owner" ? owner : auth });
    assert.equal(mode === "list" ? result.items[0].latestDecision.outcome : result.detail!.latestDecision!.outcome, "cleared");
    if (mode === "detail") assert.equal(result.detail!.history[1].outcome, "confirmed");
  }
  const result = parsePlanExceptionResult(wire("owner", "recover", true, true), q("recover"), { authUserId: owner }, command());
  assert.equal(result.receipt!.item.revision, 2);
  assert.equal(parsePlanExceptionResponse(http("recover", true, true, false), q("recover"), { authUserId: owner }, command()).moduleEnabled, false);
  assert.throws(() => parsePlanExceptionResult(wire("owner", "recover", true, true), q("recover"), { authUserId: auth }, command()));
});

test("clearance helper requires an existing checked actionable case and both configured checks", () => {
  const detail = wire("owner", "detail", false).detail!;
  assert.equal(canClearPlanException(detail), true); assert.equal(hasClearPlanExceptionBasis(clearSource(true)), true);
  assert.notDeepEqual(clearSource(true).candidate.selected, { startAt: clearSource().candidate.selected.startAt, endAt: clearSource().candidate.selected.endAt });
  for (const patch of [{ caseId: null }, { revision: 0 }, { canDecide: false }, { current: null }, { currentValidation: "not_checked" as const }]) assert.equal(canClearPlanException({ ...detail, ...patch }), false);
  for (const side of ["late", "early"] as const) for (const state of ["triggered", "disabled", "unconfigured", "blocked"] as const) {
    const basis = clearSource(); basis.candidate[side].state = state; assert.equal(hasClearPlanExceptionBasis(basis), false);
  }
  const basis = clearSource(); basis.eligible = false; assert.equal(hasClearPlanExceptionBasis(basis), false);
});

test("strict saved clearance evidence rejects blocked, disabled, unconfigured and triggered outcomes on either edge", () => {
  for (const side of ["late", "early"] as const) for (const state of ["triggered", "disabled", "unconfigured", "blocked"] as const) {
    const value = wire("owner", "recover", true, true), basis = value.detail!.latestDecision!.evidence;
    basis.candidate[side] = state === "triggered" ? { state, minutes: 0, rawDeltaUs: "1", excessUs: "1" } : { state, minutes: null, rawDeltaUs: null, excessUs: null };
    value.receipt!.item.evidence = structuredClone(basis);
    assert.throws(() => parsePlanExceptionResult(value, q("recover"), { authUserId: owner }, command()));
  }
  const value = wire("owner", "recover", true, true); value.receipt!.item.evidence!.candidate.late.excessUs = "1";
  assert.throws(() => parsePlanExceptionResult(value, q("recover"), { authUserId: owner }, command()));
});

test("list, history and receipt cannot use cleared for the first case revision", () => {
  const list = wire("owner", "list"); list.items[0].latestDecision.revision = 1; list.items[0].latestDecision.operationId = list.items[0].caseId;
  assert.throws(() => parsePlanExceptionResult(list, q("list"), { authUserId: owner }));
  const detail = wire("owner", "detail", false); detail.detail!.latestDecision!.outcome = "cleared"; detail.detail!.history[0].outcome = "cleared";
  assert.throws(() => parsePlanExceptionResult(detail, q(), { authUserId: owner }));
  const receipt = wire("owner", "recover", true, true); receipt.receipt!.command = { ...command(), expectedRevision: 0 };
  assert.throws(() => parsePlanExceptionResult(receipt, q("recover"), { authUserId: owner }));
  const listCollision = wire("owner", "list"); listCollision.items[0].latestDecision.operationId = listCollision.items[0].caseId;
  assert.throws(() => parsePlanExceptionResult(listCollision, q("list"), { authUserId: owner }));
});

test("old confirmed/excused still require at least one triggered edge; follow_up remains available", () => {
  for (const outcome of ["confirmed", "excused", "follow_up"] as const) {
    const value = wire("owner", "detail"); value.detail!.latestDecision!.outcome = outcome; value.detail!.history[0].outcome = outcome;
    if (outcome === "follow_up") assert.doesNotThrow(() => parsePlanExceptionResult(value, q(), { authUserId: owner }));
    else assert.throws(() => parsePlanExceptionResult(value, q(), { authUserId: owner }));
    const old = exceptionUiWire({ saved: true }); old.detail!.latestDecision!.outcome = outcome; old.detail!.history[0].outcome = outcome;
    assert.doesNotThrow(() => parsePlanExceptionResult(old, q(), { authUserId: owner }));
  }
});

test("clearance notification preserves summary/type agreement and requires revision beyond initial case", () => {
  const original = eventNotificationsDetail("plan_exception"); assert.equal(original.sourceCategory, "plan_exception");
  if (original.sourceCategory !== "plan_exception") throw Error("fixture");
  const detail = { ...original, sourceRevision: 2, type: "cleared", summary: { ...original.summary, outcome: "cleared" } };
  assert.equal(parseEventNotificationsDetail(detail).type, "cleared");
  const { summary: _summary, ...item } = detail; void _summary;
  assert.equal(parseEventNotificationsItem(item).type, "cleared");
  for (const patch of [{ sourceRevision: 1 }, { sourceRevision: null }, { sourceCategory: "schedule" }, { type: ["cleared"] }, { sourceOperationId: detail.sourceId }]) assert.throws(() => parseEventNotificationsDetail({ ...detail, ...patch }));
  assert.throws(() => parseEventNotificationsDetail({ ...detail, summary: { ...detail.summary, outcome: "excused" } }));
  assert.equal(parseEventNotificationsDetail(original).type, "confirmed");
});

test("clearance rollout is independent, exact-site and off unless explicitly enabled", () => {
  assert.equal(planClearanceSiteEnabled(site, {}), false);
  const env = { FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS: `${site},99990008` };
  assert.equal(planClearanceSiteEnabled(site, env), true);
  for (const value of ["", "*", `${site},`, `${site},bad`, `${site}0`, Array(101).fill(site).join(",")]) assert.equal(planClearanceSiteEnabled(site, { ...env, FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS: value }), false);
  for (const value of ["true", "0", " 1", undefined]) assert.equal(planClearanceSiteEnabled(site, { ...env, FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED: value }), false);
  assert.equal(planClearanceSiteEnabled("99990007", env), false);
});

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await run(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
test("shared seven-argument RPC keeps clearance/capture gates independent and delegates flag-off replay to SQL", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: "attendance_plan_exception_review_blocked" } }; } };
  await withEnv({ FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED: "0", FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS: site,
    FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED: "0", FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS: site,
    FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "0", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: site }, async () => {
    const run = (query: PlanExceptionQuery, c: PlanExceptionCommand | null, moduleEnabled = true) => assert.rejects(executePlanExceptions({ query, command: c, authUserId: owner, moduleEnabled }, service), { code: "attendance_plan_exception_review_blocked" });
    await run(q("decide"), command(), false);
    assert.deepEqual(calls.at(-1), { name: "faolla_attendance_plan_exception_posthoc_review_v1", args: { p_query: q("decide"), p_auth_user_id: owner, p_command: command(), p_allow_write: false, p_allow_posthoc: false, p_allow_clearance: false, p_capture_notifications: false } });
    process.env.FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED = "1";
    await run(q("decide"), command()); assert.equal(calls.at(-1)!.args.p_allow_clearance, true); assert.equal(calls.at(-1)!.args.p_capture_notifications, true);
    for (const mode of ["detail", "recover"] as const) { await run(q(mode), null); assert.equal(calls.at(-1)!.name, "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(calls.at(-1)!.args.p_allow_clearance, true); assert.equal(calls.at(-1)!.args.p_capture_notifications, false); }
    for (const outcome of ["confirmed", "excused", "follow_up"] as const) { await run(q("decide"), { ...command(), outcome }); assert.equal(calls.at(-1)!.name, "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(calls.at(-1)!.args.p_capture_notifications, true); }
    process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED = "0";
    await run(q("decide"), { ...command(), outcome: "confirmed" }); assert.equal(calls.at(-1)!.name, "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(calls.at(-1)!.args.p_capture_notifications, false);
  });
  await assert.rejects(executePlanExceptions({ query: q("decide"), command: command(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "attendance_plan_exception_clearance_disabled" } }) }), { code: "attendance_plan_exception_clearance_disabled" });
});

test("flag-off service accepts SQL-confirmed historical clearance receipt without inventing a current-source check", async () => {
  await withEnv({ FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED: "0", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "0" }, async () => {
    const value = wire("owner", "recover", true, true); value.detail!.canDecide = false;
    const result = await executePlanExceptions({ query: q("decide"), command: command(), authUserId: owner, moduleEnabled: false }, { rpc: async () => ({ data: value, error: null }) });
    assert.equal(result.receipt!.item.outcome, "cleared"); assert.equal(result.detail!.currentValidation, "not_checked");
  });
});

function clientSetup(clearanceEnabled?: boolean, losePost = false) {
  const values = new Map<string, string>(), methods: string[] = []; let saved = false;
  const storage: PlanExceptionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const options: PlanExceptionClientOptions = { siteId: site, access: "owner", actorId: owner, enabled: true, clearanceEnabled, storage: () => storage, operationId: () => id(901),
    apiFetch: async (url, init = {}) => {
      methods.push(init.method ?? "GET");
      if (init.method === "POST") { assert(values.size === 1); saved = true; if (losePost) throw Error("synthetic response lost"); return new Response(JSON.stringify(http("decide", true, true)), { headers: { "content-type": "application/json" } }); }
      const query = parsePlanExceptionHttpQuery(`https://example.test${url}`);
      return new Response(JSON.stringify(http(query.mode, saved, query.mode === "recover" && saved)), { headers: { "content-type": "application/json" } });
    } };
  return { client: new AttendancePlanExceptionClient(options), options, values, methods };
}
test("fresh clearance defaults off, persists before exactly one POST when enabled, and preserves old history", async () => {
  const off = clientSetup(); await off.client.initialize(); await off.client.detail(worker, slot); await off.client.decide("cleared", command().note);
  assert.deepEqual(off.methods, ["GET"]); assert.equal(off.values.size, 0);
  const on = clientSetup(true); await on.client.initialize(); await on.client.detail(worker, slot); await on.client.decide("cleared", command().note);
  assert.deepEqual(on.methods, ["GET", "POST"]); assert.equal(on.values.size, 0); assert.equal(on.client.getSnapshot().result!.detail!.history[1].outcome, "confirmed");
});
test("unknown clearance stays exact; disabled new client can recover by GET and never repeat POST", async () => {
  const value = clientSetup(true, true); await value.client.initialize(); await value.client.detail(worker, slot); await value.client.decide("cleared", command().note);
  const raw = value.values.get(value.client.storageKey); assert(raw); assert.equal(value.client.getSnapshot().phase, "unconfirmed");
  const resumed = new AttendancePlanExceptionClient({ ...value.options, enabled: false, clearanceEnabled: false }); await resumed.initialize();
  assert.equal(value.values.get(resumed.storageKey), raw); await resumed.recover();
  assert.deepEqual(value.methods, ["GET", "POST", "GET"]); assert.equal(value.values.size, 0); assert.equal(resumed.getSnapshot().result!.receipt!.item.outcome, "cleared");
});
test("unconfirmed clearance GET null retains exact intent; clearance-off explicit retry cannot issue POST", async () => {
  const value = clientSetup(false); const pending = { version: 1, actorId: owner, employeeId: employee, employeeAuthUserId: auth, query: q("decide"), command: command() };
  const raw = JSON.stringify(pending); value.values.set(value.client.storageKey, raw); await value.client.initialize(); await value.client.recover(); await value.client.retry();
  assert.deepEqual(value.methods, ["GET", "GET"]); assert.equal(value.values.get(value.client.storageKey), raw);
});

test("new source becoming stale after a cleared decision remains visibly stale, never rewritten as a current clearance", () => {
  const value = wire(); value.detail!.current = exceptionUiEligibleSource(); value.detail!.stale = true;
  const parsed = parsePlanExceptionResult(value, q(), { authUserId: owner });
  assert.equal(parsed.detail!.stale, true); assert.equal(parsed.detail!.latestDecision!.outcome, "cleared"); assert.equal(canClearPlanException(parsed.detail), false);
  const note: PlanExceptionHistoryEntry = { operationId: id(902), revision: 3, actorId: auth, kind: "note", outcome: null, note: "重新核查", decisionOperationId: id(901), recordedAt: value.readAt };
  value.detail!.history.unshift(note); value.detail!.revision = 3;
  assert.equal(parsePlanExceptionResult(value, q(), { authUserId: owner }).detail!.history[0].kind, "note");
});
