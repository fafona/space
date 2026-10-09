import assert from "node:assert/strict";
import test from "node:test";
import { parseShiftRuleBindingQuery, parseShiftRuleBindingHttpQuery, shiftRuleBindingQueryString, parseShiftRuleBindingResult, parseShiftRuleBindingResponse, parseShiftRulePoint, SHIFT_RULE_BINDING_REASONS } from "./merchantAttendanceShiftRuleBinding";
import { shiftRuleBindingId as id, shiftRuleBindingActor as actor, shiftRuleBindingQuery as query, shiftRuleBindingWire as wire, shiftRulePoint as point, rehashShiftRuleBinding as rehash, refreshShiftRulePointFields as fields } from "../../scripts/fixtures/attendance-shift-rule-binding-model";
const parse = (raw: unknown) => parseShiftRuleBindingResult(raw, query, actor);
const graph = (raw = wire("verified", true)) => parseShiftRulePoint(raw.binding!.source!, query, raw.binding!, raw.event);

test("exact site/worker/start-event query rejects duplicates, missing scope and write payloads", () => {
  assert.deepEqual(parseShiftRuleBindingQuery(query), query);
  assert.deepEqual(parseShiftRuleBindingHttpQuery(`https://fixture.invalid/?${shiftRuleBindingQueryString(query)}`), query);
  for (const patch of [{ siteId: "1" }, { workerId: null }, { startEventId: "x" }, { source: {} }, { action: "bind" }]) assert.throws(() => parseShiftRuleBindingQuery({ ...query, ...patch }), /attendance_invalid_request/);
  for (const suffix of ["&siteId=99990009", "&ownerId=" + actor, "&__proto__=x", "&limit=1"]) assert.throws(() => parseShiftRuleBindingHttpQuery(`https://fixture.invalid/?${shiftRuleBindingQueryString(query)}${suffix}`), /attendance_invalid_request/);
});

test("all three statuses are exact read-only states without creating or replacing missing source", () => {
  for (const status of ["verified", "unverified", "missing"] as const) assert.deepEqual(parse(wire(status)), wire(status));
  for (const reason of SHIFT_RULE_BINDING_REASONS) { const raw = wire("unverified"); raw.reason = reason; assert.equal(parse(raw).reason, reason); }
  const missing = wire("missing"); missing.binding = wire().binding; assert.throws(() => parse(missing));
  const unverified = wire("unverified"); unverified.binding!.source = wire().binding!.source; assert.throws(() => parse(unverified));
  const verified = wire(); verified.reason = "source_cap"; assert.throws(() => parse(verified));
});

test("HTTP envelope is exact and paused reads retain verified source without write authority", () => {
  const raw = wire(); assert.equal(parseShiftRuleBindingResponse({ ok: true, moduleEnabled: false, data: raw }, query, actor).moduleEnabled, false);
  for (const body of [{ ok: false, moduleEnabled: true, data: raw }, { ok: true, moduleEnabled: 1, data: raw }, { ok: true, moduleEnabled: true, data: raw, command: {} }]) assert.throws(() => parseShiftRuleBindingResponse(body, query, actor));
});

test("current owner, exact event/worker and current dual identity remain independently bound", () => {
  const mutate = [(r: ReturnType<typeof wire>) => { r.actorId = id(99); }, (r: ReturnType<typeof wire>) => { r.worker.workerId = id(99); },
    (r: ReturnType<typeof wire>) => { r.event.startEventId = id(99); }, (r: ReturnType<typeof wire>) => { r.event.employeeId = id(99); },
    (r: ReturnType<typeof wire>) => { r.worker.employeeAuthUserId = id(99); }, (r: ReturnType<typeof wire>) => { r.binding!.employeeId = id(99); }];
  for (const change of mutate) { const raw = wire(); change(raw); assert.throws(() => parse(raw)); }
});

test("PIN requires kiosk/null request auth, other channels require web/current employee auth", () => {
  for (const channel of ["self", "location", "onsite", "pin"] as const) {
    const raw = wire(); raw.binding!.channel = channel;
    if (channel === "pin") { raw.event.source = "kiosk"; raw.binding!.requestAuthUserId = null; }
    assert.equal(parse(raw).binding!.channel, channel);
    raw.event.source = channel === "pin" ? "web" : "kiosk"; assert.throws(() => parse(raw));
  }
  const bad = wire(); bad.binding!.requestAuthUserId = id(999); assert.throws(() => parse(bad));
});

test("historical worker/settings versions, source dedup and original authors survive current changes", () => {
  const raw = wire("verified", true); raw.worker.version = 100; raw.worker.active = false; raw.worker.employeeActive = false; raw.actorId = id(99);
  const result = parseShiftRuleBindingResult(raw, query, id(99)); assert.equal(result.binding!.workerVersion, 2);
  assert.notEqual(result.binding!.source!.sourceId, result.event.startEventId); assert.equal(graph(raw).enterprise.publication!.actorId, id(90));
  const changed = point(); changed.workerVersion = 3; assert.throws(() => parse(rehash(wire(), changed)));
});

test("saved unsupported timezone labels are opaque and never reinterpreted with current Intl tzdata", () => {
  const raw = wire("verified", true), p = point(true); p.timeZone = "Archived/Removed_Zone"; p.assignment!.detail.timeZone = "Archived/Removed_Zone";
  p.assignment!.detail.history[0].item.timeZone = p.assignment!.detail.timeZone;
  const command = p.assignment!.detail.history[0].command; assert.equal(command.action, "assign"); if (command.action === "assign") command.timeZone = p.assignment!.detail.timeZone;
  p.enterprise.publication!.timeZone = "Archived/Publication"; p.personal.approval!.timeZone = "Archived/Personal"; raw.event.timeZone = "Archived/Event";
  rehash(raw, p); assert.equal(parse(raw).status, "verified"); assert.equal(graph(raw).timeZone, "Archived/Removed_Zone");
});

test("raw UTF8 bytes/hash are preserved including whitespace and Unicode; no reserialization checksum", () => {
  const raw = wire(), p = point(); p.enterprise.publication!.reason = "历史规则 😀";
  rehash(raw, JSON.stringify(p, null, 2)); const original = raw.binding!.source!.sourceText; assert.equal(parse(raw).binding!.source!.sourceText, original);
  for (const mutate of [(r: ReturnType<typeof wire>) => { r.binding!.source!.sourceBytes++; }, (r: ReturnType<typeof wire>) => { r.binding!.source!.sourceSha256 = "0".repeat(64); },
    (r: ReturnType<typeof wire>) => { r.binding!.source!.sourceText += " "; }]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => parse(bad)); }
});

test("duplicate decoded JSON keys, unpaired surrogates and polluted nested objects fail closed even with new hash", () => {
  const text = JSON.stringify(point());
  for (const corrupt of [text.replace('"protocol":', '"protocol":"wrong","protocol":'), text.replace('"protocol":', '"protoc\\u006fl":"wrong","protocol":'),
    text.replace('"fields":{', '"__proto__":{},"fields":{'), text.replace("Historical owner publication", "\\ud800")]) assert.throws(() => parse(rehash(wire(), corrupt)));
});

test("source and envelope byte limits reject oversized input before source projection", () => {
  const raw = wire(); rehash(raw, " ".repeat(65537) + JSON.stringify(point())); assert.throws(() => parse(raw));
  assert.throws(() => parse({ ...wire(), extra: "x".repeat(262145) }));
});

test("saved personal > group > enterprise independently validates zero/disabled/inherit and complete traces", () => {
  const p = graph(); assert.equal(p.fields.lateGraceMinutes.minutes, 5); assert.equal(p.fields.lateGraceMinutes.source!.layer, "personal");
  assert.equal(p.fields.earlyGraceMinutes.state, "disabled"); assert.equal(p.fields.earlyGraceMinutes.source!.layer, "enterprise");
  assert.equal(p.fields.openSpanWarningMinutes.minutes, 480); assert.equal(p.fields.openSpanWarningMinutes.source!.layer, "group");
  assert.equal(p.fields.completedBreakMinimumMinutes.minutes, 1); assert.ok(Object.values(p.fields).every(f => f.trace.length === 3));
  const rootOnly = graph(wire()); assert.equal(rootOnly.fields.lateGraceMinutes.minutes, 0); assert.equal(rootOnly.fields.openSpanWarningMinutes.state, "unconfigured");
  assert.deepEqual(rootOnly.fields.lateGraceMinutes.trace.map(t => t.mode), ["missing_approval", "no_assignment", "value"]);
});

test("field state, minutes, source authors and full trace cannot be tampered while keeping internally mismatched graph", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { p.fields.lateGraceMinutes.minutes = 6; }, (p: ReturnType<typeof point>) => { p.fields.lateGraceMinutes.trace.pop(); },
    (p: ReturnType<typeof point>) => { p.fields.lateGraceMinutes.source!.actorId = id(99); }, (p: ReturnType<typeof point>) => { p.fields.earlyGraceMinutes.state = "unconfigured"; },
    (p: ReturnType<typeof point>) => { p.fields.openSpanWarningMinutes.trace.reverse(); }]) { const p = point(true); mutate(p); assert.throws(() => parse(rehash(wire(), p))); }
});

test("missing publications and missing approval are legitimate unconfigured points, not default values", () => {
  const p = point(true); p.enterprise.publication = null; p.group!.publication = null; p.personal.approval = null; fields(p);
  const saved = graph(rehash(wire(), p)); assert.ok(Object.values(saved.fields).every(f => f.state === "unconfigured" && f.minutes === null && f.source === null));
  assert.equal(saved.fields.lateGraceMinutes.trace[1].mode, "missing_publication");
});

test("same-millisecond assignment metadata is accepted without weakening next-millisecond conflicts", () => {
  const raw = wire("verified", true), p = point(true), stamp = "2026-09-02T08:00:00.000700Z";
  p.assignment!.detail.createdAt = stamp; p.assignment!.detail.updatedAt = stamp; p.assignment!.detail.history[0].item.createdAt = stamp; p.assignment!.detail.history[0].item.updatedAt = stamp;
  assert.equal(parse(rehash(raw, p)).status, "verified");
  p.assignment!.detail.updatedAt = "2026-09-02T08:00:00.001000Z"; p.assignment!.detail.history[0].item.updatedAt = p.assignment!.detail.updatedAt;
  assert.throws(() => parse(rehash(raw, p)));
});

test("assignment UTC interval, saved identities and original-command snapshots are checked without date reinterpretation", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { p.assignment!.fromAt = "2026-09-02T09:00:00.000000Z"; },
    (p: ReturnType<typeof point>) => { p.assignment!.detail.employeeId = id(99); }, (p: ReturnType<typeof point>) => { p.assignment!.workerVersion = 2; },
    (p: ReturnType<typeof point>) => { p.group!.group.groupId = id(99); }, (p: ReturnType<typeof point>) => { p.group!.group.active = false; }]) {
    const p = point(true); mutate(p); assert.throws(() => parse(rehash(wire(), p)));
  }
});

test("publication must be saved publish within saved stream version and effective by clock-in", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { p.enterprise.revision = 1; }, (p: ReturnType<typeof point>) => { p.enterprise.publication!.effectiveAt = "2026-09-03T00:00:00.000Z"; },
    (p: ReturnType<typeof point>) => { p.enterprise.publication!.groupRevision = 1; }, (p: ReturnType<typeof point>) => { p.enterprise.publication!.settingsVersion = 4; }]) {
    const p = point(true); mutate(p); fields(p); assert.throws(() => parse(rehash(wire(), p)));
  }
});

test("personal saved interval is half-open, identity anchored and never an all-inherit approval", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { p.personal.approval!.toAt = "2026-09-02T08:00:00.000Z"; },
    (p: ReturnType<typeof point>) => { p.personal.approval!.fromAt = "2026-09-02T08:00:00.001Z"; }, (p: ReturnType<typeof point>) => { p.personal.approval!.employeeAuthUserId = id(99); },
    (p: ReturnType<typeof point>) => { p.personal.approval!.rules.lateGraceMinutes = { mode: "inherit" }; }]) {
    const p = point(true); mutate(p); fields(p); assert.throws(() => parse(rehash(wire(), p)));
  }
  const p = point(true); p.personal.approval!.fromAt = "2026-09-02T08:00:00.000Z"; assert.equal(parse(rehash(wire(), p)).status, "verified");
});

test("nested extras, invalid rule bounds and mismatched nullable group graph fail closed", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { Object.assign(p.enterprise.publication!, { secret: 1 }); },
    (p: ReturnType<typeof point>) => { p.enterprise.publication!.rules!.lateGraceMinutes = { mode: "value", minutes: -1 }; },
    (p: ReturnType<typeof point>) => { p.group = null; }, (p: ReturnType<typeof point>) => { p.personal.revision = 0; }]) {
    const p = point(true); mutate(p); fields(p); assert.throws(() => parse(rehash(wire(), p)));
  }
});

test("no caller-owned object survives in frozen output; getters and sparse trees are refused", () => {
  const raw = wire("verified", true), before = structuredClone(raw), result = parse(raw); assert.deepEqual(raw, before);
  assert.notEqual(result.worker, raw.worker); assert.notEqual(result.binding, raw.binding); assert.notEqual(result.binding!.source, raw.binding!.source);
  const visit = (v: unknown) => { if (v && typeof v === "object") { assert.equal(Object.isFrozen(v), true); Object.values(v).forEach(visit); } }; visit(result); visit(graph());
  let getter = 0; const bad = wire(); Object.defineProperty(bad.worker, "workerName", { enumerable: true, get() { getter++; return "x"; } });
  assert.throws(() => parse(bad)); assert.equal(getter, 0);
  const p = point(); delete p.fields.lateGraceMinutes.trace[1]; assert.throws(() => parse(rehash(wire(), p)));
});

test("saved assignment capability flags and publication minimum revision match the original producer", () => {
  for (const mutate of [(p: ReturnType<typeof point>) => { p.assignment!.detail.canEnd = false; },
    (p: ReturnType<typeof point>) => { p.assignment!.detail.canCancel = false; }, (p: ReturnType<typeof point>) => { p.enterprise.publication!.revision = 1; }]) {
    const p = point(true); mutate(p); fields(p); assert.throws(() => parse(rehash(wire(), p)));
  }
});

test("group snapshot updatedAt has no new historical clock cutoff absent from the original collector", () => {
  const p = point(true); p.group!.group.updatedAt = "2026-09-02T08:01:00.000000Z";
  const raw = rehash(wire(), p); assert.ok(p.group!.group.updatedAt > raw.binding!.recordedAt); assert.equal(parse(raw).status, "verified");
});

test("group creation and assignment creation have no invented cross-entity wall-clock ordering", () => {
  const p = point(true); p.group!.group.createdAt = "2026-08-02T00:00:00.000000Z"; p.group!.group.updatedAt = p.group!.group.createdAt;
  assert.ok(p.group!.group.createdAt > p.assignment!.detail.createdAt); assert.equal(parse(rehash(wire(), p)).status, "verified");
});

test("unchanged finite assignment preserves identical original/current UTC end, while genuine end history preserves original open interval", () => {
  const p = point(true), a = p.assignment!; a.detail.endsOn = "2026-09-03"; a.detail.canEnd = false;
  a.detail.history[0].item.endsOn = a.detail.endsOn; const first = a.detail.history[0].command; if (first.action === "assign") first.endsOn = a.detail.endsOn;
  a.toAt = "2026-09-04T00:00:00.000000Z"; a.originalToAt = a.toAt; assert.equal(parse(rehash(wire(), p)).status, "verified");
  a.originalToAt = "2026-09-05T00:00:00.000000Z"; assert.throws(() => parse(rehash(wire(), p)));
  const ended = point(true), b = ended.assignment!, original = structuredClone(b.detail.history[0]);
  const item = { ...original.item, endsOn: "2026-09-03", revision: 2 as const, status: "ended" as const, updatedAt: "2026-09-02T07:00:00.000000Z" };
  b.detail = { ...item, history: [original, { item: { ...item }, command: { operationId: id(39), action: "end", reason: "Saved ending", assignmentId: item.assignmentId, expectedRevision: 1, endsOn: item.endsOn } }], canEnd: false, canCancel: true };
  b.toAt = "2026-09-04T00:00:00.000000Z"; assert.equal(b.originalToAt, null); assert.equal(parse(rehash(wire(), ended)).status, "verified");
});
