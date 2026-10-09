import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkArrangementQuery, parseWorkArrangementHttpQuery, workArrangementQueryString, parseWorkArrangementBody,
  parseWorkArrangementCommand, parseWorkArrangementResult, parseWorkArrangementResponse, parseWorkArrangementContextItem,
  parseWorkArrangementJson, resolveWorkArrangementInterval, WORK_ARRANGEMENT_BYTE_LIMIT, type WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";
import { workArrangementQuery as query, workArrangementCommand as command, workArrangementHttp as http, workArrangementPreviewHttp as preview,
  workArrangementReceiptHttp as receipt, workArrangementDetail as detail, workArrangementItem as item, workArrangementId as id, workArrangementSpan as span,
  workArrangementAuth as auth, workArrangementOwner as owner } from "../../scripts/fixtures/attendance-work-arrangement-model";

test("work arrangement exact query/HTTP rejects trimming, duplicate keys and impossible pagination/preview mixtures", () => {
  for (const q of [query(), { ...query(), preview: span() }, { ...query("owner"), requestId: id(10) }, { ...query(), operationId: id(10) }])
    assert.deepEqual(parseWorkArrangementHttpQuery(`https://fixture.invalid/?${workArrangementQueryString(q)}`), q);
  for (const patch of [{ siteId: "99990001\n" }, { requestId: ` ${id(10)}` }, { access: "manager" }, { beforeAt: "2026-10-06T00:00:00.000000Z" },
    { preview: span(), requestId: id(10) }, { preview: span(), access: "owner" }, { unexpected: true }]) assert.throws(() => parseWorkArrangementQuery({ ...query(), ...patch }));
  for (const tail of ["&siteId=99990001", "&employeeId=" + id(2), "&preview=%7B%22kind%22%3A%22trip%22%2C%22kind%22%3A%22field%22%7D", "&requestId=" + id(1) + "%0A"])
    assert.throws(() => parseWorkArrangementHttpQuery(`https://fixture.invalid/?${workArrangementQueryString(query())}${tail}`));
});

test("new policy and request actions have independent exact CAS contracts and role boundaries", () => {
  assert.deepEqual(parseWorkArrangementBody({ query: query(), command: command() }).command, command());
  for (const kind of ["trip", "field", "remote"]) assert.equal(parseWorkArrangementCommand({ ...command(), kind }).action, "submit");
  for (const patch of [{ expectedPolicyRevision: -1 }, { expectedSettingsVersion: 0 }, { kind: "leave" }, { reason: " padded" },
    { reason: "x\n" }, { reason: "x".repeat(201) }, { endAt: span().startAt }, { startAt: "2026-10-05T07:00:00.000001Z" }, { extra: true }])
    assert.throws(() => parseWorkArrangementCommand({ ...command(), ...patch }));
  const policy = { action: "set_policy", operationId: id(20), expectedRevision: 0, retrospectiveDays: 30, reason: "Policy" };
  assert.equal(parseWorkArrangementBody({ query: query("owner"), command: policy }).command.action, "set_policy");
  assert.throws(() => parseWorkArrangementBody({ query: query(), command: policy }));
  for (const days of [-1, 366, 1.5]) assert.throws(() => parseWorkArrangementCommand({ ...policy, retrospectiveDays: days }));
  assert.throws(() => parseWorkArrangementCommand({ action: "approve", operationId: id(11), requestId: id(10), expectedRevision: 1, reason: "Approve" }));
});

test("minute draft conversion rejects DST gap and requires an explicit fold offset", () => {
  const end = { local: "2026-10-25T04:00", offset: "+01:00" }, fold = { local: "2026-10-25T02:30", offset: "" };
  assert.throws(() => resolveWorkArrangementInterval(fold, end, "Europe/Madrid"));
  const a = resolveWorkArrangementInterval({ ...fold, offset: "+02:00" }, end, "Europe/Madrid"), b = resolveWorkArrangementInterval({ ...fold, offset: "+01:00" }, end, "Europe/Madrid");
  assert.equal(Date.parse(b.startAt) - Date.parse(a.startAt), 3600000);
  assert.throws(() => resolveWorkArrangementInterval({ local: "2026-03-29T02:30", offset: "+01:00" }, { local: "2026-03-29T04:00", offset: "+02:00" }, "Europe/Madrid"));
  const edge = resolveWorkArrangementInterval({ local: "2100-12-31T23:00", offset: "-11:00" }, { local: "2100-12-31T23:30", offset: "-11:00" }, "Pacific/Pago_Pago");
  assert.equal(edge.startAt, "2101-01-01T10:00:00.000Z");
  const c = { ...command(), ...edge, timeZone: "Pacific/Pago_Pago" }; assert.equal(parseWorkArrangementCommand(c).action, "submit");
  parseWorkArrangementResponse(receipt(c), query(), c);
});

test("overnight local interval preserves a single arrangement across two dates", () => {
  const interval = resolveWorkArrangementInterval({ local: "2026-10-06T23:00", offset: "+02:00" },
    { local: "2026-10-07T02:00", offset: "+02:00" }, "Europe/Madrid");
  assert.deepEqual(interval, { startAt: "2026-10-06T21:00:00.000Z", endAt: "2026-10-07T00:00:00.000Z" });
  const c = { ...command(), ...interval, timeZone: "Europe/Madrid" };
  assert.equal(parseWorkArrangementCommand(c).action, "submit");
  const saved = parseWorkArrangementResponse(receipt(c), query(), c);
  assert.equal(saved.receipt?.item?.startAt, interval.startAt); assert.equal(saved.receipt?.item?.endAt, interval.endAt);
});

test("fresh, preview and historical receipt-only recovery bind command and current principal", () => {
  parseWorkArrangementResponse(http(), query(), null, { authUserId: auth });
  parseWorkArrangementResponse(preview(), { ...query(), preview: span() });
  parseWorkArrangementResponse(receipt(), query(), command(), { authUserId: auth });
  const q = { ...query(), operationId: command().operationId };
  const recovered = parseWorkArrangementResponse(receipt(command(), false), q, command(), { authUserId: auth });
  assert.equal(recovered.detail, null); assert.equal(recovered.receipt?.command.operationId, command().operationId);
  parseWorkArrangementResponse(http(), q, command()); // Missing receipt is unknown, not a successful write.
  assert.throws(() => parseWorkArrangementResponse(http(), query(), command()));
  assert.throws(() => parseWorkArrangementResponse(receipt(command(), false), q, { ...command(), reason: "Changed" }));
  assert.throws(() => parseWorkArrangementResponse(http(), query(), null, { authUserId: owner }));
});

test("conflicts are bounded, true UTC intersections, unique sorted and consistent with issues/sealing", () => {
  const q = { ...query(), preview: span() }, r = preview();
  r.preview!.conflicts = [{ source: "schedule", id: id(80), status: "scheduled", revision: 1, kind: null, ...{ startAt: span().startAt, endAt: span().endAt, timeZone: "UTC" } }];
  r.preview!.issues = ["conflicts"]; parseWorkArrangementResponse(r, q);
  for (const mutate of [(v: typeof r) => { v.preview!.issues = []; }, (v: typeof r) => { v.preview!.conflicts[0].startAt = span().endAt; },
    (v: typeof r) => { v.preview!.conflicts.push({ ...v.preview!.conflicts[0] }); }, (v: typeof r) => { v.preview!.sealed = true; v.preview!.issues.push("sealed"); }]) {
    const bad = structuredClone(r); mutate(bad); assert.throws(() => parseWorkArrangementResponse(bad, q)); }
});

test("archived context retains exact identity/history, no self-approval and never invokes current Intl", () => {
  const d = detail(), context = Object.fromEntries(Object.entries(d).filter(([k]) => !["conflicts", "conflictsFingerprint", "sealed", "issues", "canWithdraw", "canApprove", "canReject", "canCancel"].includes(k)));
  const old = Intl.DateTimeFormat; try { Intl.DateTimeFormat = (() => { throw Error("must_not_recalculate"); }) as unknown as typeof Intl.DateTimeFormat;
    assert.equal(parseWorkArrangementContextItem(context).requestId, id(10));
  } finally { Intl.DateTimeFormat = old; }
  const approve: WorkArrangementCommand = { action: "approve", operationId: id(11), requestId: id(10), expectedRevision: 1, reason: "Approved with review", expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: true };
  const a = receipt(approve).detail!; a.history[1].actorId = auth;
  assert.throws(() => parseWorkArrangementResponse({ ...http("owner"), detail: a }, { ...query("owner"), requestId: id(10) }));
  const bad = structuredClone(context) as Record<string, unknown>; bad.employeeId = id(99);
  // Employee UUID alone is an immutable saved identity; public response supplies current self binding.
  assert.throws(() => parseWorkArrangementResponse({ ...http(), detail: { ...detail(), employeeId: id(99) } }, { ...query(), requestId: id(10) }));
});

test("owner can reject their own request but cannot self-approve; historical policy receipt may be older", () => {
  const reject: WorkArrangementCommand = { action: "reject", operationId: id(11), requestId: id(10), expectedRevision: 1, reason: "Withdraw approval request" };
  const r = receipt(reject); r.actorId = auth; r.detail!.history[1].actorId = auth;
  parseWorkArrangementResponse(r, { ...query("owner"), requestId: id(10) }, reject, { ownerId: auth });
  const p: WorkArrangementCommand = { action: "set_policy", operationId: id(30), expectedRevision: 0, retrospectiveDays: 45, reason: "Policy" };
  const old = receipt(p, false); old.policy = { ...old.policy, operationId: id(31), revision: 2, retrospectiveDays: 10 };
  assert.equal(parseWorkArrangementResponse(old, { ...query("owner"), operationId: id(30) }, p).receipt?.policy?.retrospectiveDays, 45);
});

test("strict trees and JSON reject duplicate/unsafe/scalar/big/invalid Unicode without reading getters", () => {
  assert.throws(() => parseWorkArrangementJson('{"x":1,"x":2}'));
  assert.throws(() => parseWorkArrangementJson('{"constructor":{}}'));
  assert.throws(() => parseWorkArrangementJson(JSON.stringify({ x: "x".repeat(WORK_ARRANGEMENT_BYTE_LIMIT) })));
  assert.throws(() => parseWorkArrangementJson('"\\ud800"'));
  let calls = 0; const getter = { ...http() }; Object.defineProperty(getter, "readAt", { enumerable: true, get: () => { calls++; return ""; } });
  assert.throws(() => parseWorkArrangementResponse(getter, query())); assert.equal(calls, 0);
  assert.throws(() => parseWorkArrangementResult({ ...http(), ok: true }, query()));
});

test("default policy snapshot and work/leave conflict revision semantics must match SQL ledger contracts", () => {
  const itemResult = http(); itemResult.items = [item()];
  parseWorkArrangementResponse(itemResult, query());
  for (const days of [0, 29, 31, 365]) { const bad = structuredClone(itemResult); bad.items[0].retrospectiveDays = days; assert.throws(() => parseWorkArrangementResponse(bad, query())); }
  const configured = structuredClone(itemResult); configured.items[0].policyRevision = 1; configured.items[0].retrospectiveDays = 0;
  parseWorkArrangementResponse(configured, query());
  const q = { ...query(), preview: span() };
  for (const source of ["work_arrangement", "leave"] as const) for (const status of ["submitted", "approved"] as const) {
    const r = preview(); r.preview!.issues = ["conflicts"];
    r.preview!.conflicts = [{ source, status, id: id(80), revision: status === "submitted" ? 1 : 2, kind: source === "work_arrangement" ? "trip" : null,
      startAt: span().startAt, endAt: span().endAt, timeZone: "UTC" }];
    parseWorkArrangementResponse(r, q);
    for (const revision of [status === "submitted" ? 2 : 1, 3, 99]) {
      const bad = structuredClone(r); bad.preview!.conflicts[0].revision = revision; assert.throws(() => parseWorkArrangementResponse(bad, q));
    }
  }
  const schedule = preview(); schedule.preview!.issues = ["conflicts"];
  schedule.preview!.conflicts = [{ source: "schedule", status: "scheduled", id: id(81), revision: 99, kind: null, startAt: span().startAt, endAt: span().endAt, timeZone: "UTC" }];
  parseWorkArrangementResponse(schedule, q);
});
