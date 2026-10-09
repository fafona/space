import assert from "node:assert/strict";
import test from "node:test";
import { parseShiftCheckResult } from "./merchantAttendanceShiftCheck";
import { parsePlanCoverageResult } from "./merchantAttendancePlanCoverage";
import { shiftCheckApprovedEffect } from "../../scripts/fixtures/attendance-shift-check-model";
import { planAdoptionViewActor as actor, planAdoptionViewId as id, shiftCheckAdoptionQuery as shiftQuery,
  shiftCheckAdoptionWire as shiftWire, shiftCheckAdoptionHttp as shiftHttp, planCoverageAdoptionsQuery as planQuery,
  planCoverageAdoptionsWire as planWire, planCoverageAdoptionsHttp as planHttp } from "../../scripts/fixtures/attendance-plan-adoption-view-model";
import { PLAN_ADOPTION_VIEW_BYTE_LIMIT, PLAN_ADOPTION_VIEW_ERRORS, SHIFT_CHECK_ADOPTION_API, PLAN_COVERAGE_ADOPTIONS_API,
  parseShiftCheckAdoptionQuery, parseShiftCheckAdoptionHttpQuery, shiftCheckAdoptionQueryString,
  parsePlanCoverageAdoptionsQuery, parsePlanCoverageAdoptionsHttpQuery, planCoverageAdoptionsQueryString,
  parseShiftCheckAdoptionData, parseShiftCheckAdoptionResult, parseShiftCheckAdoptionResponse,
  parsePlanCoverageAdoptionsData, parsePlanCoverageAdoptionsResult, parsePlanCoverageAdoptionsResponse,
  parsePlanAdoptionViewJson, type PlanAdoption, type ShiftCheckAdoptionData } from "./merchantAttendancePlanAdoptionView";

const shift = (raw = shiftWire()) => parseShiftCheckAdoptionResult(raw, shiftQuery, actor);
const plan = (raw = planWire()) => parsePlanCoverageAdoptionsResult(raw, planQuery, actor);
function channel(raw: ShiftCheckAdoptionData, value: PlanAdoption["channel"]) {
  raw.adoption!.channel = value;
  raw.check.rule.event.source = value === "pin" ? "kiosk" : "web";
  raw.check.events.forEach(event => { event.source = value === "pin" ? "kiosk" : "web"; });
  if (raw.check.rule.binding) {
    raw.check.rule.binding.channel = value;
    raw.check.rule.binding.requestAuthUserId = value === "pin" ? null : raw.check.rule.worker.employeeAuthUserId;
  }
}
function allFrozen(value: unknown) {
  if (value && typeof value === "object") { assert(Object.isFrozen(value)); Object.values(value).forEach(allFrozen); }
}

test("both owner queries keep exact old anchors and reject identity overrides and duplicate URL names", () => {
  assert.equal(SHIFT_CHECK_ADOPTION_API, "/api/merchant-enterprise/attendance/shift-check-adoption");
  assert.equal(PLAN_COVERAGE_ADOPTIONS_API, "/api/merchant-enterprise/attendance/plan-coverage-adoptions");
  assert.deepEqual(parseShiftCheckAdoptionQuery(shiftQuery), shiftQuery); assert.deepEqual(parsePlanCoverageAdoptionsQuery(planQuery), planQuery);
  const shiftUrl = `https://local.invalid/?${shiftCheckAdoptionQueryString(shiftQuery)}`;
  const planUrl = `https://local.invalid/?${planCoverageAdoptionsQueryString(planQuery)}`;
  assert.deepEqual(parseShiftCheckAdoptionHttpQuery(shiftUrl), shiftQuery); assert.deepEqual(parsePlanCoverageAdoptionsHttpQuery(planUrl), planQuery);
  for (const extra of ["&siteId=" + shiftQuery.siteId, "&employeeId=" + id(2), "&actorId=" + actor, "&offset=0", "&__proto__=x"])
    for (const [url, parse] of [[shiftUrl, parseShiftCheckAdoptionHttpQuery], [planUrl, parsePlanCoverageAdoptionsHttpQuery]] as const)
      assert.throws(() => parse(url + extra), /attendance_invalid_request/);
  for (const patch of [{ siteId: shiftQuery.siteId + "\n" }, { workerId: shiftQuery.workerId + "\n" }, { command: null }]) {
    assert.throws(() => parseShiftCheckAdoptionQuery({ ...shiftQuery, ...patch }), /attendance_invalid_request/);
    assert.throws(() => parsePlanCoverageAdoptionsQuery({ ...planQuery, ...patch }), /attendance_invalid_request/);
  }
});

test("HTTP query rejects literal URL whitespace before WHATWG parsing can discard it", () => {
  const cases = [
    { query: shiftQuery, encode: shiftCheckAdoptionQueryString, parse: parseShiftCheckAdoptionHttpQuery },
    { query: planQuery, encode: planCoverageAdoptionsQueryString, parse: parsePlanCoverageAdoptionsHttpQuery },
  ] as const;
  for (const item of cases) {
    const url = `https://local.invalid/?${new URLSearchParams(item.query).toString()}`;
    for (const malformed of [url + " ", url + "\n", url + "\r\n", url.replace("workerId=", "workerId=\t"),
      url.replace("siteId=", "si\r\nteId="), url.replace("workerId=", "workerId=\u0000"), url + "\u0085", url + "\u00a0"])
      assert.throws(() => item.parse(malformed), /attendance_invalid_request/);
  }
});

test("decoded HTTP values are exact ASCII identities, not trimmed or Unicode-normalized", () => {
  for (const item of [
    { query: shiftQuery, parse: parseShiftCheckAdoptionHttpQuery },
    { query: planQuery, parse: parsePlanCoverageAdoptionsHttpQuery },
  ]) {
    for (const [key, value] of Object.entries(item.query)) {
      for (const malformed of [" " + value, value + " ", "\t" + value, value + "\r\n", value + "\u0000", value + "\u007f",
        value + "\u0085", value + "\u00a0", value + "\u200b", value + "\u2028", value.replace(/[0-9]/, "０")]) {
        const params = new URLSearchParams(item.query); params.set(key, malformed);
        assert.throws(() => item.parse(`https://local.invalid/?${params}`), /attendance_invalid_request/);
      }
    }
    const params = new URLSearchParams(item.query);
    for (const suffix of ["&%77orkerId=" + item.query.workerId, "&workerId%00=x", "&workerId=%FF", "&actorId=" + actor])
      assert.throws(() => item.parse(`https://local.invalid/?${params}${suffix}`), /attendance_invalid_request/);
  }
});

test("wrappers preserve every existing derived single-shift and coverage result unchanged", () => {
  const s = shiftWire(), p = planWire();
  assert.deepEqual(shift(s).check, parseShiftCheckResult(s.check, shiftQuery, actor));
  assert.deepEqual(plan(p).coverage, parsePlanCoverageResult(p.coverage, planQuery, actor));
  assert.equal(shift(s).check.formalReady, false); assert.equal(plan(p).coverage.formalReady, false);
  assert.equal(shift(s).adoption!.approval!.revision, 3);
  assert.equal(plan(p).coverage.original.coveredUs, "14400000000");
});

test("Data preserves only old wire fields and never sends derived conclusions or module flags in children", () => {
  const s = parseShiftCheckAdoptionData(shiftWire(), shiftQuery, actor), p = parsePlanCoverageAdoptionsData(planWire(), planQuery, actor);
  assert.deepEqual(s, shiftWire()); assert.deepEqual(p, planWire());
  assert.equal(Object.hasOwn(s.check, "original"), false); assert.equal(Object.hasOwn(p.coverage, "gapBlockers"), false);
  assert.equal(Object.hasOwn(p.coverage.sessions[0], "checks"), false);
  assert.throws(() => shift({ ...shiftWire(), check: shift().check }));
  assert.throws(() => plan({ ...planWire(), coverage: plan().coverage }));
});

test("four channels are preserved and match source kind and any saved133 binding", () => {
  for (const name of ["self", "location", "onsite", "pin"] as const) {
    const raw = shiftWire(); channel(raw, name); assert.equal(shift(raw).adoption!.channel, name);
  }
  const wrong = shiftWire(); wrong.adoption!.channel = "onsite";
  assert.throws(() => shift(wrong), /attendance_plan_adoption_view_invalid/);
  wrong.check.rule.binding = null; wrong.check.rule.evidence = null; wrong.check.rule.status = "missing"; wrong.check.rule.reason = "binding_missing";
  assert.equal(shift(wrong).adoption!.channel, "onsite", "133 absence does not erase independently saved plan adoption");
  wrong.adoption!.channel = "pin"; assert.throws(() => shift(wrong), /attendance_plan_adoption_view_invalid/);
});

test("legacy null stays distinct from saved not_approved and never requires a historical sidecar", () => {
  const raw = shiftWire(); raw.adoption = null;
  assert.equal(shift(raw).adoption, null); assert.equal(shift(raw).check.relation!.status, "linked");
  raw.check.relation = null; assert.equal(shift(raw).adoption, null);
  const missing = shiftWire(); Object.assign(missing.adoption!, { status: "not_approved", reason: "approval_missing", approval: null });
  assert.equal(shift(missing).adoption!.status, "not_approved");
  const bad = shiftWire(); bad.check.relation = null; assert.throws(() => shift(bad));
});

test("empty plans and ordered null entries retain complete one-to-one correspondence", () => {
  assert.deepEqual(plan(planWire(0)).adoptions, []);
  const raw = planWire(); raw.adoptions[0].adoption = null;
  const parsed = plan(raw); assert.equal(parsed.adoptions.length, 2); assert.equal(parsed.adoptions[0].adoption, null);
  assert.deepEqual(parsed.adoptions.map(entry => entry.startEventId), parsed.coverage.sessions.map(check => check.rule.event.startEventId));
  for (const entries of [[], [raw.adoptions[1]], [...raw.adoptions].reverse(), [raw.adoptions[0], raw.adoptions[0]],
    [...raw.adoptions, raw.adoptions[1]], [{ ...raw.adoptions[0], startEventId: id(999) }, raw.adoptions[1]]])
    assert.throws(() => plan({ ...raw, adoptions: entries }), /attendance_plan_adoption_view_invalid/);
});

test("adoption uses current member dual identity, never current owner as employee auth", () => {
  const raw = shiftWire(); assert.notEqual(raw.check.rule.worker.employeeAuthUserId, actor);
  assert.equal(shift(raw).adoption!.employeeAuthUserId, raw.check.rule.worker.employeeAuthUserId);
  for (const patch of [{ employeeId: id(999) }, { employeeAuthUserId: actor }, { employeeAuthUserId: null }, { employeeId: id(2) + "\n" }])
    assert.throws(() => parseShiftCheckAdoptionResult({ ...raw, adoption: { ...raw.adoption!, ...patch } }, shiftQuery, actor));
  assert.throws(() => parseShiftCheckAdoptionResult(raw, shiftQuery, id(99)));
  assert.throws(() => parsePlanCoverageAdoptionsResult(planWire(0), planQuery, id(99)));
});

test("event operation, association time and per-session pair cannot be substituted", () => {
  const raw = shiftWire();
  for (const patch of [{ startEventId: id(999) }, { operationId: id(999) }, { recordedAt: "2026-09-02T08:00:00.000901Z" },
    { policy: "latest-approval-v1" }]) assert.throws(() => parseShiftCheckAdoptionResult({ ...raw, adoption: { ...raw.adoption!, ...patch } }, shiftQuery, actor));
  const crossed = planWire(); crossed.adoptions[0].adoption = crossed.adoptions[1].adoption;
  assert.throws(() => plan(crossed), /attendance_plan_adoption_view_invalid/);
});

test("unselected and every original unresolved reason remain explicit with no approval fallback", () => {
  const none = shiftWire(); Object.assign(none.check.relation!, { status: "unselected", selection: null, slot: null, reason: null, currentCancelled: null });
  Object.assign(none.adoption!, { status: "unselected", reason: null, approval: null });
  assert.equal(shift(none).adoption!.status, "unselected");
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const raw = shiftWire(); Object.assign(raw.check.relation!, { status: "unverified", reason });
    if (reason === "publication_missing") raw.check.relation!.slot!.hasPublicationEvidence = false;
    if (reason === "cancelled") { raw.check.relation!.slot!.cancelled = true; raw.check.relation!.currentCancelled = true; }
    if (reason === "location_changed") raw.check.relation!.slot!.locationId = id(999);
    Object.assign(raw.adoption!, { status: "unverified", reason, approval: null });
    assert.equal(shift(raw).adoption!.reason, reason);
    raw.adoption!.reason = "approval_missing"; assert.throws(() => shift(raw));
  }
  const conflict = shiftWire(); Object.assign(conflict.adoption!, { status: "not_approved", reason: "approval_missing" });
  assert.throws(() => shift(conflict));
});

test("reference is exact five-key metadata, preserves dedup source IDs and does not invent commit-time order", () => {
  const raw = shiftWire(); assert.notEqual(raw.adoption!.approval!.sourceId, raw.adoption!.approval!.operationId);
  assert.ok(raw.adoption!.approval!.revision > raw.check.relation!.observedRevision);
  for (const patch of [{ revision: 0 }, { revision: -0 }, { sourceSha256: "A".repeat(64) }, { sourceSha256: "a".repeat(64) + "\n" },
    { recordedAt: "2026-02-30T01:00:00.123456Z" }, { recordedAt: "2026-09-01T01:00:00.123Z" }, { sourceText: "not public" }, { reason: "private" }])
    assert.throws(() => parseShiftCheckAdoptionResult({ ...raw, adoption: { ...raw.adoption!, approval: { ...raw.adoption!.approval!, ...patch } } }, shiftQuery, actor));
  raw.adoption!.approval!.recordedAt = "2026-09-02T08:00:00.999999Z";
  assert.doesNotThrow(() => shift(raw));
});

test("later cancellation and changed owner retain the original fixed reference", () => {
  const raw = planWire(); raw.coverage.slot.cancelled = true;
  raw.coverage.sessions.forEach(check => { check.relation!.currentCancelled = true; });
  const before = structuredClone(raw.adoptions), nextOwner = id(999);
  raw.coverage.actorId = nextOwner; raw.coverage.sessions.forEach(check => { check.rule.actorId = nextOwner; });
  const parsed = parsePlanCoverageAdoptionsResult(raw, planQuery, nextOwner);
  assert.deepEqual(parsed.adoptions, before); assert(parsed.coverage.gapBlockers.includes("cancelled"));
  assert(parsed.adoptions.every(entry => entry.adoption?.status === "adopted"));
});

test("newest correction changes only old derived calculations and never reselects adoption", () => {
  const raw = shiftWire(); raw.check.effect = shiftCheckApprovedEffect(); const saved = structuredClone(raw.adoption);
  const parsed = shift(raw);
  assert.deepEqual(parsed.check, parseShiftCheckResult(raw.check, shiftQuery, actor)); assert.deepEqual(parsed.adoption, saved);
  assert.notEqual(parsed.check.original.startAt, parsed.check.approved!.startAt);
  assert.equal(parsed.check.checks.originalBreaks[0].state, "triggered");
  assert.equal(parsed.check.checks.approvedBreaks![0].state, "not_triggered");
});

test("paused HTTP and inactive current personnel remain authorized-read metadata, not permission to mutate", () => {
  const raw = planHttp(2, false); raw.data.coverage.worker.active = false; raw.data.coverage.worker.employeeActive = false;
  raw.data.coverage.sessions.forEach(check => { check.rule.worker.active = false; check.rule.worker.employeeActive = false; });
  assert.equal(parsePlanCoverageAdoptionsResponse(raw, planQuery, actor).moduleEnabled, false);
  const single = parseShiftCheckAdoptionResponse(shiftHttp(false), shiftQuery, actor);
  assert.equal(single.moduleEnabled, false); assert.equal(Object.hasOwn(single.check, "moduleEnabled"), false);
  assert.throws(() => parseShiftCheckAdoptionResponse({ ...shiftHttp(), moduleEnabled: "true" }, shiftQuery, actor));
  assert.throws(() => parsePlanCoverageAdoptionsResponse({ ...planHttp(), extra: null }, planQuery, actor));
});

test("results are detached deeply frozen and do not freeze caller-owned inputs", () => {
  const raw = planWire(), parsed = plan(raw); allFrozen(parsed);
  raw.coverage.worker.workerName = "mutated"; raw.adoptions[0].adoption!.approval!.revision = 999;
  assert.notEqual(parsed.coverage.worker.workerName, raw.coverage.worker.workerName); assert.equal(parsed.adoptions[0].adoption!.approval!.revision, 3);
  assert.equal(Object.isFrozen(raw), false); allFrozen(parseShiftCheckAdoptionData(shiftWire(), shiftQuery, actor));
});

test("both wrappers reject getters, hidden/symbolic keys, sparse arrays and extra nested fields without invoking them", () => {
  let invoked = false; const raw = Object.defineProperty(shiftWire(), "adoption", { enumerable: true, get() { invoked = true; return null; } });
  assert.throws(() => shift(raw)); assert.equal(invoked, false);
  for (const bad of [{ ...planWire(), [Symbol("hidden")]: true }, Object.defineProperty(planWire(), "hidden", { value: true }),
    { ...planWire(), adoptions: new Array(2) }, Object.assign(Object.create({ inherited: true }), planWire())])
    assert.throws(() => parsePlanCoverageAdoptionsResult(bad, planQuery, actor));
  const cycle = shiftWire(); Object.assign(cycle.adoption!, { self: cycle }); assert.throws(() => shift(cycle));
  const extra = planWire(); Object.assign(extra.adoptions[0], { channel: "self" }); assert.throws(() => plan(extra));
});

test("JSON duplicate names, unsafe keys and invalid scalar strings are rejected", () => {
  assert.deepEqual(parsePlanAdoptionViewJson(JSON.stringify(planHttp())), planHttp());
  for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"prototype":0}', '{"x":"\\ud800"}', '{'])
    assert.throws(() => parsePlanAdoptionViewJson(text), /attendance_plan_adoption_view_invalid/);
});

test("the entire raw/public/HTTP budget remains1MiB and oversized metadata is rejected rather than truncated", () => {
  assert.equal(PLAN_ADOPTION_VIEW_BYTE_LIMIT, 1048576);
  const json = JSON.stringify(shiftHttp()), exactBytes = json + " ".repeat(PLAN_ADOPTION_VIEW_BYTE_LIMIT - new TextEncoder().encode(json).byteLength);
  assert.deepEqual(parsePlanAdoptionViewJson(exactBytes), shiftHttp());
  assert.throws(() => parsePlanAdoptionViewJson(exactBytes + " "), /attendance_plan_adoption_view_too_large/);
  const huge = "x".repeat(PLAN_ADOPTION_VIEW_BYTE_LIMIT - 100);
  assert.throws(() => parseShiftCheckAdoptionResponse({ ...shiftHttp(), metadata: huge }, shiftQuery, actor), /attendance_plan_adoption_view_too_large/);
  assert.throws(() => parsePlanCoverageAdoptionsResult({ ...planWire(), metadata: huge }, planQuery, actor), /attendance_plan_adoption_view_too_large/);
  const tooMany = planWire(); tooMany.coverage.sessions = Array(11).fill(tooMany.coverage.sessions[0]);
  assert.throws(() => plan(tooMany), /attendance_plan_adoption_view_too_large/);
});

test("strict old data remains independently validated, no raw private source or manufactured wire conclusion", () => {
  for (const patch of [{ sourceText: "private" }, { original: {} }, { formalReady: true }]) {
    const malformed: unknown = { ...shiftWire(), check: { ...shiftWire().check, ...patch } };
    assert.throws(() => parseShiftCheckAdoptionResult(malformed, shiftQuery, actor));
  }
  const badScope = planWire(); badScope.coverage.sessions[0].rule.worker.employeeId = id(999);
  assert.throws(() => plan(badScope));
  const badRelation = planWire(); badRelation.coverage.sessions[0].relation!.selection!.slotId = id(999);
  assert.throws(() => plan(badRelation));
  assert.equal(PLAN_ADOPTION_VIEW_ERRORS.attendance_plan_adoption_view_invalid, 503);
  assert.equal(PLAN_ADOPTION_VIEW_ERRORS.attendance_plan_adoption_view_too_large, 422);
  for (const name of ["location", "onsite", "pin", "self_schedule_adoption"])
    assert.equal(PLAN_ADOPTION_VIEW_ERRORS[name === "self_schedule_adoption" ? "attendance_self_schedule_adoption_invalid" : `attendance_${name}_schedule_invalid`], 503);
});
