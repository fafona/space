import assert from "node:assert/strict";
import test from "node:test";
import { parsePeriodClosureArtifact, parsePeriodClosureBody, parsePeriodClosureCommand, parsePeriodClosureHttpQuery,
  parsePeriodClosureQuery, parsePeriodClosureResponse, parsePeriodClosureResult, periodClosureQueryString } from "./merchantAttendancePeriodClosure";
import { periodClosureUiArtifact as artifact, periodClosureUiCommand as command, periodClosureUiHttp as wire,
  periodClosureUiQuery as query, periodClosureUiOwner as owner, periodClosureUiAuth as auth, periodClosureUiEmployee as employee,
  periodClosureUiId as id, periodClosureUiEntry as entry } from "../../scripts/fixtures/attendance-period-closure-ui-model";

test("exact query modes, canonical UUIDs, ranges and URL roundtrip", () => {
  for (const mode of ["list", "preview", "detail", "recover", "export"] as const) {
    const q = query(mode); assert.deepEqual(parsePeriodClosureQuery(q), q);
    assert.deepEqual(parsePeriodClosureHttpQuery("https://local.invalid/?" + periodClosureQueryString(q)), q);
  }
  for (const q of [{ ...query(), actorId: owner }, { ...query(), access: "manager" }, { ...query(), workerId: "BAD" },
    { ...query(), fromDate: "2026-02-30" }, { ...query(), throughDate: "2026-08-31" }, { ...query(), throughDate: "2026-10-02" },
    { ...query("list"), periodId: id(44) }, { ...query("recover"), operationId: null }, { ...query("detail"), operationId: id(45) },
    { ...query("export"), version: null }, { ...query("export"), version: 21 }]) assert.throws(() => parsePeriodClosureQuery(q), /attendance_invalid_request/);
  for (const suffix of ["&siteId=87654321", "&artifact={}", "&command={}", "&actorId=" + owner, "&version=01", "&__proto__=x"])
    assert.throws(() => parsePeriodClosureHttpQuery("https://local.invalid/?" + periodClosureQueryString(query()) + suffix), /attendance_invalid_request/);
});

test("commands cannot cross owner/member roles or supply an archive body", () => {
  const q = query("detail"), c = command(); assert.deepEqual(parsePeriodClosureBody({ query: q, command: c }), { query: q, command: c });
  assert.throws(() => parsePeriodClosureBody({ query: q, command: c, artifact: artifact() }), /attendance_invalid_request/);
  for (const action of ["confirm", "dispute"] as const) assert.throws(() => parsePeriodClosureCommand(q, { ...c, action, expectedRevision: 1, expectedVersion: 1, reason: "test" }), /attendance_invalid_request/);
  for (const action of ["send", "respond", "seal", "reopen"] as const) assert.throws(() => parsePeriodClosureCommand({ ...q, access: "self" }, { ...c, action, expectedRevision: 1, expectedVersion: 1, reason: "test" }), /attendance_invalid_request/);
  for (const patch of [{ expectedFingerprint: null }, { expectedRevision: -0 }, { expectedRevision: 101 }, { expectedVersion: 21 },
    { periodId: id(55) }, { reason: "bad\nreason" }, { reason: "x".repeat(501) }, { action: "overwrite" }, { artifact: artifact() }])
    assert.throws(() => parsePeriodClosureCommand(q, { ...c, ...patch }), /attendance_invalid_request/);
});

test("public envelopes bind the actual authenticated actor, selected worker and member double identity", () => {
  const q = query("detail"); assert.deepEqual(parsePeriodClosureResponse(wire(q), q, { ownerId: owner, authUserId: owner }), wire(q));
  assert.throws(() => parsePeriodClosureResponse(wire(q), q, { authUserId: id(91) }), /attendance_period_closure_invalid/);
  const sq = query("detail", "self"), sw = wire(sq);
  assert.deepEqual(parsePeriodClosureResponse(sw, sq, { employeeId: employee, authUserId: auth }), sw);
  assert.throws(() => parsePeriodClosureResponse(sw, sq, { employeeId: id(92), authUserId: auth }), /attendance_period_closure_invalid/);
  assert.throws(() => parsePeriodClosureResponse(sw, sq, { employeeId: employee, authUserId: id(93) }), /attendance_period_closure_invalid/);
  for (const patch of [{ ok: false }, { moduleEnabled: "true" }, { sourceText: "private" }])
    assert.throws(() => parsePeriodClosureResponse({ ...wire(q), ...patch }, q, { authUserId: owner }), /attendance_period_closure_invalid/);
});

test("result discriminants are exact and do not carry unknown private fields", () => {
  for (const mode of ["list", "preview", "detail"] as const) {
    const q = query(mode), value = wire(q).data;
    assert.throws(() => parsePeriodClosureResult({ ...value, artifactText: "server-only" }, q, { authUserId: owner }), /attendance_period_closure_invalid/);
  }
});

test("timestamps reject normalized impossible dates and noncanonical offsets", () => {
  const q = query("detail"), value = wire(q).data;
  for (const readAt of ["2026-02-30T12:00:00.000001Z", "2026-09-11T24:00:00.000001Z", "2026-09-11T12:00:00+00:00", "2026-09-11T12:00:00.0Z"])
    assert.throws(() => parsePeriodClosureResult({ ...value, readAt }, q, { authUserId: owner }), /attendance_period_closure_invalid/);
});

test("archive retains separate original/corrected/missing values and rejects inconsistent totals", () => {
  const saved = artifact(), parsed = parsePeriodClosureArtifact(saved);
  assert.deepEqual(parsed.report.totals, saved.report.totals); assert.equal(parsed.report.missing.length, 1);
  assert.notDeepEqual(parsed.report.totals.original, parsed.report.totals.selected);
  const bad = artifact(); bad.report.totals.selected.workedUs++;
  assert.throws(() => parsePeriodClosureArtifact(bad), /attendance_period_closure_invalid/);
  const extra = artifact(); (extra as unknown as Record<string, unknown>).sourceText = "not public";
  assert.throws(() => parsePeriodClosureArtifact(extra), /attendance_period_closure_invalid/);
});

test("archive reading does not invoke current timezone interpretation", () => {
  const saved = artifact(); saved.period.timeZone = "Saved/No-Current-Tzdata"; saved.report.base.timeZone = saved.period.timeZone;
  assert.equal(parsePeriodClosureArtifact(saved).period.timeZone, saved.period.timeZone);
  assert.deepEqual(parsePeriodClosureArtifact(saved).dayBoundaries, saved.dayBoundaries);
});

test("saved day boundaries are complete, unique and contiguous rather than a partial month", () => {
  for (const mutate of [(a: ReturnType<typeof artifact>) => { a.dayBoundaries.pop(); },
    (a: ReturnType<typeof artifact>) => { a.dayBoundaries[1].date = a.dayBoundaries[0].date; },
    (a: ReturnType<typeof artifact>) => { a.dayBoundaries[1].fromAt = "2026-09-02T01:00:00.000000Z"; },
    (a: ReturnType<typeof artifact>) => { a.dayBoundaries[1].skipped = true; }]) {
    const bad = artifact(); mutate(bad); assert.throws(() => parsePeriodClosureArtifact(bad), /attendance_period_closure_invalid/);
  }
});

test("existing-period preview binds saved timezone, UTC range and employee identities before sending", () => {
  const q = {...query("preview"), periodId:id(600)}, value = wire(q).data;
  assert.equal(value.kind,"preview"); if(value.kind!=="preview") return;
  const detail = wire({...query("detail"),periodId:q.periodId}).data;
  assert.equal(detail.kind,"detail"); if(detail.kind!=="detail") return;
  value.preview.period={...detail.period,periodId:q.periodId};
  assert.equal(parsePeriodClosureResult(value,q,{authUserId:owner}).kind,"preview");
  for(const patch of [{timeZone:"Etc/UTC"},{startAt:"2026-09-01T01:00:00.000000Z"},
    {endAt:"2026-09-03T01:00:00.000000Z"},{employeeId:id(701)},{employeeAuthUserId:id(702)}]){
    const bad=structuredClone(value); Object.assign(bad.preview.period!,patch);
    assert.throws(()=>parsePeriodClosureResult(bad,q,{authUserId:owner}),/attendance_period_closure_invalid/);
  }
});

test("fixed old export version remains readable after a newer source version exists", () => {
  const q = query("export"), value = wire(q).data; assert.equal(value.kind, "detail"); if (value.kind !== "detail") return;
  value.period.currentVersion = 2; value.period.revision = 2; value.artifactVersion = 1;
  value.history.push(entry({ ...command(), operationId: id(902), expectedRevision: 1, expectedVersion: 1, expectedFingerprint: "b".repeat(64), reason: "New source version" }));
  assert.equal(parsePeriodClosureResult(value, q, { authUserId: owner }).kind, "detail");
  assert.throws(() => parsePeriodClosureResult({ ...value, artifactVersion: 2 }, q, { authUserId: owner }), /attendance_period_closure_invalid/);
  const broken = structuredClone(value); broken.artifact!.worker.employeeAuthUserId = id(101);
  assert.throws(() => parsePeriodClosureResult(broken, q, { authUserId: owner }), /attendance_period_closure_invalid/);
});

test("history is complete and original receipts cannot be detached from it", () => {
  const q = query("recover"), value = wire(q).data; assert.equal(value.kind, "detail"); if (value.kind !== "detail") return;
  for (const mutate of [(v: typeof value) => { v.history = []; },
    (v: typeof value) => { v.history[0].revision = 2; },
    (v: typeof value) => { v.operation!.actorId = id(123); },
    (v: typeof value) => { v.operation = { ...v.operation!, reason: "Not original" }; },
    (v: typeof value) => { v.artifactVersion = null; v.artifact = null; }]) {
    const bad = structuredClone(value); mutate(bad);
    assert.throws(() => parsePeriodClosureResult(bad, q, { authUserId: owner }), /attendance_period_closure_invalid/);
  }
  const gap = structuredClone(value); gap.period.revision = 2;
  assert.throws(() => parsePeriodClosureResult(gap, q, { authUserId: owner }), /attendance_period_closure_invalid/);
});

test("recovery binds exact original operation and command, never a replacement command", () => {
  const q = query("recover"), value = wire(q).data;
  assert.equal(parsePeriodClosureResult(value, q, { authUserId: owner }).kind, "detail");
  assert.throws(() => parsePeriodClosureResult(value, { ...q, operationId: id(120) }, { authUserId: owner }), /attendance_period_closure_invalid/);
  const dq = query("detail"), c = command(), saved = wire(dq, c).data;
  assert.equal(parsePeriodClosureResult(saved, dq, { authUserId: owner }, c).kind, "detail");
  assert.throws(() => parsePeriodClosureResult(saved, dq, { authUserId: owner }, { ...c, reason: "changed" }), /attendance_period_closure_invalid/);
});

test("malicious JSON object descriptors and oversized/deep trees fail closed", () => {
  const q = query(), value = wire(q).data;
  assert.throws(() => parsePeriodClosureResult(Object.create(value), q), /attendance_period_closure_invalid/);
  const getter = Object.defineProperty({}, "protocol", { enumerable: true, get() { throw Error("getter executed"); } });
  assert.throws(() => parsePeriodClosureResult(getter, q), /attendance_period_closure_invalid/);
  const a = artifact(); let current: Record<string, unknown> = a.source;
  for (let n = 0; n < 40; n++) { const next = {}; current.next = next; current = next; }
  assert.throws(() => parsePeriodClosureArtifact(a), /attendance_period_closure_invalid/);
});
