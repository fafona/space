import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePlanRuleApprovalsQuery, parsePlanRuleApprovalsHttpQuery, planRuleApprovalsQueryString, parsePlanRuleApprovalsCommand,
  parsePlanRuleApprovalsBody, parsePlanRuleApprovalsResult, parsePlanRuleApprovalsResponse, samePlanRuleApprovalsCommand,
  PLAN_RULE_APPROVALS_BLOCKERS, PLAN_RULE_APPROVALS_ERRORS, type PlanRuleApprovalsSource } from "./merchantAttendancePlanRuleApprovals";
import type { ShiftRuleField, ShiftRuleProvenance } from "./merchantAttendanceShiftRuleBinding";
import { planRuleApprovalsActor as actor, planRuleApprovalsId as id, planRuleApprovalsQuery as query, planRuleApprovalsCommand as command,
  planRuleApprovalsHttp as http, planRuleApprovalsWire as wire } from "../../scripts/fixtures/attendance-plan-rule-approvals-model";

const invalid = (run: () => unknown, code = "attendance_plan_rule_invalid") => assert.throws(run, (e: unknown) => e instanceof Error && e.message === code);
const parse = (v = wire(), mode: ReturnType<typeof query>["mode"] = "preview") => parsePlanRuleApprovalsResult(v, query(mode), actor);
function fields(s: PlanRuleApprovalsSource) {
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes"] as const) {
    const f: ShiftRuleField = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = s[layer], item = layer === "personal" ? s.personal.approval : layer === "group" ? s.group?.publication ?? null : s.enterprise.publication;
      const groupId = layer === "group" ? s.group?.groupId ?? null : null, ledgerRevision = part?.revision ?? null, c = item?.rules[key];
      const p: ShiftRuleProvenance | null = item ? { layer, groupId, ledgerRevision: ledgerRevision!, operationId: item.operationId, revision: item.revision, actorId: item.actorId } : null;
      const mode = c?.mode ?? (layer === "personal" ? "missing_approval" : layer === "group" && !part ? "no_assignment" : "missing_publication"), minutes = c?.mode === "value" ? c.minutes : null;
      f.trace.push({ layer, groupId, ledgerRevision, mode, minutes, source: p });
      if (f.state === "unconfigured" && (mode === "disabled" || mode === "value")) { f.state = mode; f.minutes = minutes; f.source = p; }
    }
    s.fields[key] = f;
  }
}
function frozen(v: unknown): void { if (v && typeof v === "object") { assert(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }

test("query is exact, mode/op combinations and URL duplicates/prototype/whitespace are closed", () => {
  for (const mode of ["preview", "read", "recover", "approve"] as const) {
    const q = query(mode); assert.deepEqual(parsePlanRuleApprovalsQuery(q), q);
    const text = planRuleApprovalsQueryString(q); assert.deepEqual(parsePlanRuleApprovalsHttpQuery(`https://local.invalid?${text}`), q);
    assert.equal(text.includes("operationId="), mode === "recover" || mode === "approve");
  }
  for (const patch of [{ siteId: "99990009\n" }, { workerId: id(4) + "\n" }, { slotId: id(30).toUpperCase().replace("4000", "A000") }, { mode: "latest" },
    { operationId: id(9) }, { mode: "recover", operationId: null }, { extra: true }]) invalid(() => parsePlanRuleApprovalsQuery({ ...query(), ...patch }), "attendance_invalid_request");
  for (const suffix of ["&mode=read", "&__proto__=x", "&constructor=x", "&offset=0", "&operationId=null", "&operationId="]) {
    invalid(() => parsePlanRuleApprovalsHttpQuery(`https://local.invalid?${planRuleApprovalsQueryString(query())}${suffix}`), "attendance_invalid_request");
  }
  const absent: Record<string, unknown> = { ...query() }; delete absent.operationId;
  invalid(() => parsePlanRuleApprovalsQuery(absent), "attendance_invalid_request");
});
test("command/body accept only explicit fingerprint CAS and dual identity, not sources or actor flags", () => {
  const c = command(); assert.deepEqual(parsePlanRuleApprovalsBody({ query: query("approve"), command: c }), { query: query("approve"), command: c });
  assert(samePlanRuleApprovalsCommand(c, Object.fromEntries(Object.entries(c).reverse()) as typeof c));
  for (const patch of [{ expectedRevision: -0 }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: 9007199254740990 },
    { expectedFingerprint: "a".repeat(64) + "\n" }, { expectedFingerprint: "A".repeat(64) }, { employeeAuthUserId: null }, { reason: " " },
    { reason: "x".repeat(201) }, { reason: "bad\u0000" }, { reason: "\ud800" }, { source: {} }, { actorId: actor }]) invalid(() => parsePlanRuleApprovalsCommand({ ...c, ...patch }), "attendance_invalid_request");
  assert.equal([...parsePlanRuleApprovalsCommand({ ...c, reason: "😀".repeat(200) }).reason].length, 200);
  invalid(() => parsePlanRuleApprovalsBody({ query: query("read"), command: c }), "attendance_invalid_request");
  invalid(() => parsePlanRuleApprovalsBody({ query: query("approve", id(901)), command: c }), "attendance_invalid_request");
  invalid(() => parsePlanRuleApprovalsBody({ query: query("approve"), command: c, moduleEnabled: true }), "attendance_invalid_request");
});
test("all four modes parse; zero, inheritance, selected layer and historical authors remain distinct", () => {
  for (const mode of ["preview", "read", "recover", "approve"] as const) assert.equal(parsePlanRuleApprovalsResponse(http(mode), query(mode), actor).revision, mode === "preview" ? 0 : 1);
  const s = parse().preview!.source!;
  assert.equal(s.fields.lateGraceMinutes.state, "value"); assert.equal(s.fields.lateGraceMinutes.minutes, 0); assert.equal(s.fields.lateGraceMinutes.source?.layer, "group");
  assert.equal(s.fields.earlyGraceMinutes.minutes, 5); assert.equal(s.fields.earlyGraceMinutes.source?.layer, "enterprise");
  assert.deepEqual(s.fields.lateGraceMinutes.trace.map(t => t.layer), ["personal", "group", "enterprise"]);
  assert.equal(s.personal.approval!.actorId, id(9)); assert.equal(s.group!.revision, 6); assert.equal(s.group!.publication!.revision, 4);
});
test("disabled stops inheritance; no assignment/missing publication/unconfigured never turn into zero", () => {
  const v = wire(), s = v.preview!.source!; s.personal.approval!.rules.lateGraceMinutes = { mode: "disabled" }; fields(s);
  assert.equal(parse(v).preview!.source!.fields.lateGraceMinutes.state, "disabled"); assert.equal(parse(v).preview!.source!.fields.lateGraceMinutes.minutes, null);
  s.assignment = null; s.group = null; s.enterprise.publication = null; s.personal.approval = null; fields(s);
  const result = parse(v).preview!.source!.fields.lateGraceMinutes; assert.equal(result.state, "unconfigured"); assert.equal(result.source, null); assert.equal(result.minutes, null);
  assert.deepEqual(result.trace.map(t => t.mode), ["missing_approval", "no_assignment", "missing_publication"]);
});
test("late/early limits are0..1440, not slot length; two personal inherit values remain legal", () => {
  const v = wire(), s = v.preview!.source!; s.personal.approval!.rules.lateGraceMinutes = { mode: "value", minutes: 1440 }; fields(s);
  assert.equal(parse(v).preview!.source!.fields.lateGraceMinutes.minutes, 1440);
  for (const minutes of [-1, -0, 1441, 0.1, Number.NaN]) { const bad = structuredClone(v); bad.preview!.source!.personal.approval!.rules.lateGraceMinutes = { mode: "value", minutes }; fields(bad.preview!.source!); invalid(() => parse(bad)); }
  assert.equal(parse().preview!.source!.personal.approval!.rules.earlyGraceMinutes.mode, "inherit");
});
test("source provenance and every full trace are reconstructed and bound to exact layer/version/operation", () => {
  const mutations: ((s: PlanRuleApprovalsSource) => void)[] = [s => { s.fields.lateGraceMinutes.minutes = 1; }, s => { s.fields.lateGraceMinutes.source!.layer = "enterprise"; },
    s => { s.fields.earlyGraceMinutes.trace[0].source!.operationId = id(999); }, s => { s.fields.lateGraceMinutes.trace.reverse(); },
    s => { s.fields.lateGraceMinutes.trace[1].ledgerRevision = 4; }, s => { s.fields.lateGraceMinutes.trace[2].mode = "disabled"; },
    s => { s.fields.earlyGraceMinutes.trace[2].source!.actorId = actor; }, s => { s.group!.publication!.revision = 7; },
    s => { s.enterprise.publication!.revision = 1; }, s => { s.personal.approval!.revision = 4; }, s => { s.personal.approval!.rules.earlyGraceMinutes = { mode: "disabled" }; }];
  for (const mutate of mutations) { const v = wire(); mutate(v.preview!.source!); invalid(() => parse(v)); }
});
test("preview blockers are fixed, unique and fail closed; source_switch may show initial source without approval", () => {
  for (const blocker of PLAN_RULE_APPROVALS_BLOCKERS) { const v = wire(); v.preview!.eligible = false; v.preview!.blockers = [blocker];
    if (blocker !== "source_switch") { v.preview!.source = null; v.preview!.fingerprint = null; }
    assert.equal(parse(v).preview!.eligible, false); }
  const bad = wire(); bad.preview!.eligible = false; invalid(() => parse(bad));
  bad.preview!.blockers = ["source_switch", "source_switch"]; invalid(() => parse(bad));
  bad.preview!.blockers = ["source_incomplete"]; invalid(() => parse(bad));
  bad.preview!.source = null; bad.preview!.fingerprint = null; (bad.preview!.blockers as string[]) = ["unrecognized"]; invalid(() => parse(bad));
  const paused = http(); invalid(() => parsePlanRuleApprovalsResponse({ ...paused, moduleEnabled: false }, query(), actor));
  for (const mutate of [(v: ReturnType<typeof wire>) => { v.worker.active = false; }, (v: ReturnType<typeof wire>) => { v.worker.employeeActive = false; },
    (v: ReturnType<typeof wire>) => { v.slot.cancelled = true; }, (v: ReturnType<typeof wire>) => { v.slot.hasPublicationEvidence = false; }]) { const v = wire(); mutate(v); invalid(() => parse(v)); }
});
test("approval restores immutable original receipt across head changes, pause, inactive and cancellation", () => {
  const v = http("recover", false); v.data.revision = 8; v.data.worker.active = false; v.data.worker.employeeActive = false; v.data.slot.cancelled = true;
  v.data.readAt = "2026-10-09T00:00:00.000000Z"; v.data.worker.workerName = "Renamed current worker"; v.data.slot.locationName = "Renamed current location";
  const r = parsePlanRuleApprovalsResponse(v, query("recover"), actor, command()); assert.equal(r.approval!.revision, 1); assert.equal(r.revision, 8);
  assert.equal(r.approval!.sourceId, id(500)); assert.notEqual(r.approval!.sourceId, r.approval!.operationId);
  const absent = wire("recover"); absent.approval = null; assert.equal(parsePlanRuleApprovalsResult(absent, query("recover"), actor, command()).approval, null);
});
test("latest read permits prior owner; original-operation recovery/approve must retain original actor", () => {
  const v = wire("read"); v.approval!.actorId = id(80); assert.equal(parse(v, "read").approval!.actorId, id(80));
  invalid(() => parse(v, "recover")); invalid(() => parse(v, "approve"));
  const stale = wire("read"); stale.revision = 2; invalid(() => parse(stale, "read"));
  const empty = wire("read"); empty.revision = 0; empty.approval = null; assert.equal(parse(empty, "read").approval, null);
  empty.revision = 1; invalid(() => parse(empty, "read"));
});
test("receipt command/op/fingerprint/revision and expected pending must all agree", () => {
  const changes: ((v: ReturnType<typeof wire>) => void)[] = [v => { v.approval!.operationId = id(999); }, v => { v.approval!.command.operationId = id(999); },
    v => { v.approval!.sourceSha256 = "b".repeat(64); }, v => { v.approval!.command.expectedRevision = 1; }, v => { v.approval!.sourceBytes = 32769; },
    v => { v.approval!.sourceBytes = 0; }, v => { v.approval!.command.employeeAuthUserId = id(999); }, v => { v.approval!.command.employeeId = id(999); }];
  for (const mutate of changes) { const v = wire("recover"); mutate(v); invalid(() => parse(v, "recover")); }
  const expected = command(); expected.reason = "Changed reason";
  invalid(() => parsePlanRuleApprovalsResult(wire("recover"), query("recover"), actor, expected));
  invalid(() => parsePlanRuleApprovalsResult(wire("read"), query("read"), actor, command()));
  const missing = wire("approve"); missing.approval = null; invalid(() => parse(missing, "approve"));
});
test("current scope/dual identity and every saved immutable slot field bind, not names or historical authors", () => {
  const mutations: ((v: ReturnType<typeof wire>) => void)[] = [v => { v.actorId = id(99); }, v => { v.worker.workerId = id(99); }, v => { v.siteId = "99990001"; },
    v => { v.worker.employeeId = id(99); }, v => { v.worker.employeeAuthUserId = id(99); }, v => { v.slot.id = id(99); },
    v => { v.preview!.source!.workerVersion = v.worker.version + 1; }, v => { v.preview!.source!.assignment!.employeeId = id(99); },
    v => { v.preview!.source!.group!.groupId = id(99); }, v => { v.preview!.source!.assignment = null; }];
  for (const key of ["id", "revision", "locationId", "timeZone", "startAt", "endAt"] as const) mutations.push(v => {
    const s = v.preview!.source!.slot; if (key === "revision") s.revision++;
    else s[key] = key === "timeZone" ? "Saved/Different" : key.endsWith("At") ? "2026-10-08T09:00:00.000Z" : id(99);
  });
  for (const change of mutations) { const v = wire(); change(v); invalid(() => parse(v)); }
  const v = wire(); v.preview!.source!.assignment!.groupRevision = 99; assert.equal(parse(v).preview!.source!.assignment!.groupRevision, 99); // group definition is not its rule head.
});
test("microsecond ordering and strict pre-start write guard preserve boundary equality distinctions", () => {
  const v = wire("recover"), start = "2026-10-08T08:00:00.000000Z";
  v.approval!.observedAt = "2026-10-08T07:59:59.999998Z"; v.approval!.recordedAt = "2026-10-08T07:59:59.999999Z"; v.readAt = start;
  assert.equal(parse(v, "recover").approval!.recordedAt, "2026-10-08T07:59:59.999999Z");
  v.approval!.recordedAt = start; invalid(() => parse(v, "recover"));
  const preview = wire(); preview.preview!.observedAt = start; preview.readAt = start; invalid(() => parse(preview));
  const reversed = wire("recover"); reversed.approval!.observedAt = "2026-10-05T12:00:00.002001Z"; invalid(() => parse(reversed, "recover"));
  const future = wire(); future.preview!.source!.enterprise.publication!.recordedAt = "2026-10-05T12:00:00.001001Z"; invalid(() => parse(future));
});
test("saved source applicability is half-open, with head versions separate and historical zone labels opaque", () => {
  const v = wire(), s = v.preview!.source!; s.assignment!.fromAt = "2026-10-08T08:00:00.000000Z"; s.assignment!.toAt = null;
  s.timeZone = "Historical/Unavailable_Zone"; s.assignment!.timeZone = "Saved/Old_Zone"; assert.equal(parse(v).preview!.source!.timeZone, s.timeZone);
  s.assignment!.toAt = "2026-10-08T08:00:00.000000Z"; invalid(() => parse(v));
  const p = wire(); p.preview!.source!.personal.approval!.toAt = p.slot.startAt; invalid(() => parse(p));
  const after = wire(); after.preview!.source!.group!.publication!.effectiveAt = "2026-10-08T08:00:00.001Z"; invalid(() => parse(after));
  const short = wire(); short.preview!.source!.personal.approval!.toAt = "2026-10-08T10:00:00.000Z"; assert.equal(parse(short).preview!.eligible, true); // Unadopted inherit layer is not extended or made a false blocker here.
});
test("cross-midnight/DST UTC spans are preserved without local-date remapping", () => {
  for (const [startAt, endAt, workDate] of [["2026-10-24T22:00:00.000Z", "2026-10-25T04:00:00.000Z", "2026-10-25"], ["2026-03-28T23:00:00.000Z", "2026-03-29T03:00:00.000Z", "2026-03-29"]]) {
    const v = wire(), s = v.preview!.source!; Object.assign(v.slot, { startAt, endAt, workDate, timeZone: "Europe/Madrid" }); Object.assign(s.slot, { startAt, endAt, timeZone: "Europe/Madrid" });
    s.assignment = null; s.group = null; s.personal.approval = null; s.enterprise.publication = null; fields(s);
    v.preview!.observedAt = "2026-01-01T00:00:00.000000Z"; v.readAt = v.preview!.observedAt;
    assert.equal(parse(v).slot.startAt, startAt); assert.equal(parse(v).slot.workDate, workDate);
  }
});
test("timestamps must be canonical real UTC dates with correct saved precision, never normalized silently", () => {
  for (const value of ["2026-02-30T00:00:00.000000Z", "2026-10-05T12:00:00.003Z", "2026-10-05T12:00:00.003000Z\n", "2026-10-05T14:00:00.003000+02:00", "0000-01-01T00:00:00.000000Z"]) {
    const v = wire(); v.readAt = value; invalid(() => parse(v));
  }
  const v = wire(); v.slot.startAt = "2026-10-08T08:00:00.000000Z"; invalid(() => parse(v));
  const p = wire(); p.preview!.source!.enterprise.publication!.effectiveAt = "2026-10-07T00:00:00.000000Z"; invalid(() => parse(p));
});
test("strict trees reject accessors before invocation, dangerous keys, sparse arrays, symbols and cycles", () => {
  let calls = 0; const v = wire(); Object.defineProperty(v.preview!.source!.personal, "approval", { enumerable: true, get() { calls++; throw Error("unsafe getter"); } });
  invalid(() => parse(v)); assert.equal(calls, 0);
  for (const mutate of [(r: ReturnType<typeof wire>) => { Object.defineProperty(r, "extra", { value: 1 }); },
    (r: ReturnType<typeof wire>) => { Object.defineProperty(r, Symbol("hidden"), { value: 1 }); },
    (r: ReturnType<typeof wire>) => { Object.setPrototypeOf(r.worker, { foreign: true }); },
    (r: ReturnType<typeof wire>) => { delete r.preview!.source!.fields.lateGraceMinutes.trace[1]; },
    (r: ReturnType<typeof wire>) => { Object.defineProperty(r.worker, "__proto__", { enumerable: true, value: {} }); },
    (r: ReturnType<typeof wire>) => { Object.assign(r.worker, { circular: r }); }]) { const r = wire(); mutate(r); invalid(() => parse(r)); }
});
test("unknown nested fields, raw sourceText or formal claims are never accepted or projected", () => {
  for (const locate of [(v: ReturnType<typeof wire>) => v, (v: ReturnType<typeof wire>) => v.worker, (v: ReturnType<typeof wire>) => v.slot,
    (v: ReturnType<typeof wire>) => v.preview!, (v: ReturnType<typeof wire>) => v.preview!.source!, (v: ReturnType<typeof wire>) => v.preview!.source!.slot,
    (v: ReturnType<typeof wire>) => v.preview!.source!.personal.approval!, (v: ReturnType<typeof wire>) => v.preview!.source!.fields.lateGraceMinutes.trace[0]]) {
    const v = wire(); Object.assign(locate(v), { unexpected: true }); invalid(() => parse(v));
  }
  for (const extra of [{ sourceText: "private raw" }, { formalReady: true }, { payrollApplied: true }]) invalid(() => parse({ ...wire(), ...extra }));
  invalid(() => parsePlanRuleApprovalsResponse({ ...http(), extra: false }, query(), actor));
  invalid(() => parsePlanRuleApprovalsResponse({ ...http(), moduleEnabled: "true" }, query(), actor));
});
test("byte bounds, lossless Unicode labels, detached deep immutability and no current tz/Node execution", () => {
  const v = wire(); v.worker.workerName = "😀".repeat(120); v.slot.locationName = "😀".repeat(120);
  const original = structuredClone(v), r = parse(v); assert.deepEqual(v, original); frozen(r);
  v.preview!.source!.personal.approval!.rules.lateGraceMinutes = { mode: "disabled" }; assert.equal(r.preview!.source!.personal.approval!.rules.lateGraceMinutes.mode, "inherit");
  const huge = wire(); huge.worker.workerName = "x".repeat(65537); invalid(() => parse(huge));
  const badUnicode = wire(); badUnicode.slot.locationName = "bad\udfff"; invalid(() => parse(badUnicode));
  const code = readFileSync(new URL("./merchantAttendancePlanRuleApprovals.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /from\s+["']node:|require\(|attendanceTimeZone\(|attendanceDayUtcRange\(|Intl\./);
  assert.equal(PLAN_RULE_APPROVALS_ERRORS.attendance_plan_rule_source_conflict, 409); assert.equal(PLAN_RULE_APPROVALS_ERRORS.attendance_plan_rule_invalid, 503);
});
