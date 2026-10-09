import assert from "node:assert/strict";
import test from "node:test";
import { EMPLOYMENT_LIFECYCLE_BLOCKERS, parseEmploymentLifecycleQuery, parseEmploymentLifecycleHttpQuery, employmentLifecycleQueryString,
  parseEmploymentLifecycleCommand, parseEmploymentLifecycleBody, parseEmploymentLifecycleJson, parseEmploymentLifecycleResult,
  parseEmploymentLifecycleResponse, employmentLifecycleCommandFingerprint, employmentLifecycleReceiptMatches } from "./merchantAttendanceEmploymentLifecycle";
import { employmentLifecycleId as id, employmentLifecycleOwner as owner, employmentLifecycleSite as site,
  employmentLifecycleQuery as query, employmentLifecycleCommand as command, employmentLifecycleResult as result,
  employmentLifecycleReceipt as receipt, employmentLifecycleReceiptHttp as receiptHttp } from "../../scripts/fixtures/attendance-employment-lifecycle-model";
const invalid = { code: "attendance_invalid_request" }, bad = { code: "attendance_employment_lifecycle_invalid" };
test("lifecycle exact query roundtrips four read modes and rejects mixed identities/cursors", () => {
  for (const mode of ["list", "detail", "history", "recover"] as const) { const q = query(mode); assert.deepEqual(parseEmploymentLifecycleHttpQuery("https://example.invalid/?" + employmentLifecycleQueryString(q)), q); }
  for (const q of [{ ...query(), ownerId: owner }, { ...query(), workerId: null }, { ...query("list"), workerId: id(4) }, { ...query("recover"), afterId: id(5) },
    { ...query("history"), afterRevision: -1 }, { ...query("history"), afterRevision: -0 }, { ...query("history"), afterRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...query(), mode: "write" }]) assert.throws(() => parseEmploymentLifecycleQuery(q), invalid);
  for (const suffix of ["&mode=detail", "&actorId=" + owner, "&workerId=", "&afterRevision=01", "&afterRevision=1e2"]) assert.throws(() => parseEmploymentLifecycleHttpQuery("https://example.invalid/?" + employmentLifecycleQueryString(query()) + suffix), invalid);
});
test("lifecycle command is exact14, date-only real civil day, bounded reason and safe versions", () => {
  for (const action of ["close", "rejoin"] as const) { const c = command(action); assert.deepEqual(parseEmploymentLifecycleBody({ query: query(), command: c }), { query: query(), command: c }); assert(Object.isFrozen(parseEmploymentLifecycleCommand(c))); }
  for (const patch of [{ expectedDate: "2026-02-30" }, { expectedDate: "2026-1-01" }, { expectedDate: "1999-12-31" }, { expectedDate: "2101-01-01" }, { reason: " " },
    { reason: "a".repeat(501) }, { reason: "x\u0000x" }, { reason: "\ud800" }, { action: "restore" }, { expectedWorkerVersion: 0 }, { expectedRevision: -0 }, { employeeAuthUserId: null }, { employeeId: "not-an-id" }, { active: true }]) assert.throws(() => parseEmploymentLifecycleCommand({ ...command(), ...patch }), invalid);
  assert.throws(() => parseEmploymentLifecycleBody({ query: query("recover"), command: command() }), invalid);
  assert.throws(() => parseEmploymentLifecycleBody({ query: query(), command: { ...command(), workerId: id(99) } }), invalid);
});
test("lifecycle duplicate JSON/accessors/prototype/cycle/over-budget bodies fail without executing getters", () => {
  assert.throws(() => parseEmploymentLifecycleJson('{"siteId":"99990001","siteId":"99990002"}', "request"), invalid);
  assert.throws(() => parseEmploymentLifecycleJson(" ".repeat(8193), "request"), invalid);
  let called = false; const getter = { ...query(), get owner() { called = true; return "x"; } }; assert.throws(() => parseEmploymentLifecycleQuery(getter), invalid); assert.equal(called, false);
  assert.throws(() => parseEmploymentLifecycleQuery(Object.assign(Object.create({ unsafe: true }), query())), invalid);
  const cycle: Record<string, unknown> = { ...query() }; cycle.x = cycle; assert.throws(() => parseEmploymentLifecycleQuery(cycle), invalid);
  assert.throws(() => parseEmploymentLifecycleResult({ ...result(), private: "x".repeat(131073) }, query(), owner), bad);
});
test("lifecycle detail validates explicit off, controlled dates, pause, pending blockers and immutable view", () => {
  for (const action of ["close", "rejoin"] as const) { const r = parseEmploymentLifecycleResult(result("detail", action), query(), owner); assert.equal(r.detail?.canRejoin, action === "rejoin"); assert(Object.isFrozen(r.detail?.worker)); }
  const base = result(); assert(base.detail);
  for (const patch of [{ currentAction: "clock_in" }, { currentAction: "break_start" }, { suspension: null }, { canRejoin: true }, { worker: { ...base.detail.worker, active: true } },
    { worker: { ...base.detail.worker, employeeAuthUserId: null } }, { closeBlockers: ["open_session"] }, { closeBlockers: ["private_free_text"] },
    { pending: { items: [], limited: true, historicalPending: "not_checked" } }, { periods: [] }, { state: "closed" }, { today: "2025-12-31" }]) assert.throws(() => parseEmploymentLifecycleResult({ ...base, detail: { ...base.detail, ...patch } }, query(), owner), bad);
  const closed = result("detail", "rejoin"); assert(closed.detail); closed.detail.today = "2026-10-05"; assert.throws(() => parseEmploymentLifecycleResult(closed, query(), owner), bad);
  base.detail.currentAction = null; base.detail.originalAction = null; assert.equal(parseEmploymentLifecycleResult(base, query(), owner).detail?.canClose, true);
});
test("lifecycle blocked views retain bounded actionable pending items without exposing reasons", () => {
  const r = result(); assert(r.detail); r.detail.canClose = false; r.detail.closeBlockers = ["pending_items"];
  r.detail.pending.items = [{ id: id(90), kind: "leave", status: "submitted", startAt: "2026-10-06T08:00:00.000Z", endAt: "2026-10-07T08:00:00.000Z", timeZone: "Europe/Madrid" }];
  assert.equal(parseEmploymentLifecycleResult(r, query(), owner).detail?.pending.items.length, 1);
  r.detail.pending.items[0].timeZone = "Historical/Database_Only_Zone";
  assert.equal(parseEmploymentLifecycleResult(r, query(), owner).detail?.pending.items[0].timeZone, "Historical/Database_Only_Zone");
  assert.throws(() => parseEmploymentLifecycleResult({ ...r, detail: { ...r.detail, pending: { ...r.detail!.pending, items: [{ ...r.detail!.pending.items[0], reason: "private" }] } } }, query(), owner), bad);
  for (const code of EMPLOYMENT_LIFECYCLE_BLOCKERS) { const x = result(); assert(x.detail); x.detail.canClose = false; x.detail.closeBlockers = [code]; assert.equal(parseEmploymentLifecycleResult(x, query(), owner).detail?.canClose, false); }
});
test("lifecycle pages never mix private detail, out-of-order rows or unbounded history", () => {
  const list = result("list"); assert.equal(parseEmploymentLifecycleResult(list, query("list"), owner).items.length, 1);
  for (const patch of [{ nextAfterId: id(4) }, { items: [...list.items, ...list.items] }, { detail: result().detail }, { items: Array(26).fill(list.items[0]) }]) assert.throws(() => parseEmploymentLifecycleResult({ ...list, ...patch }, query("list"), owner), bad);
  const history = { ...result("history"), history: [{ ...receipt(), actorId: id(999) }] }; assert.equal(parseEmploymentLifecycleResult(history, query("history"), owner).history[0].actorId, id(999));
  assert.throws(() => parseEmploymentLifecycleResult({ ...history, history: [{ ...receipt(), workerId: id(998) }] }, query("history"), owner), bad);
  assert.throws(() => parseEmploymentLifecycleResult({ ...history, nextAfterRevision: 1 }, query("history"), owner), bad);
});
test("lifecycle receipts bind all command fields, original actor, action, dates and revision without private command", async () => {
  for (const action of ["close", "rejoin"] as const) { const c = command(action), http = await receiptHttp(c, "detail"); const r = parseEmploymentLifecycleResponse(http, query(), owner, c); assert(r.receipt);
    assert(employmentLifecycleReceiptMatches(r.receipt, c, await employmentLifecycleCommandFingerprint(site, c)));
    for (const patch of [{ actorId: id(99) }, { workerId: id(99) }, { employeeAuthUserId: id(99) }, { action: action === "close" ? "rejoin" : "close" }, { revision: c.expectedRevision + 2 }, { startsOn: "1999-01-01" }, { reason: "private" }]) assert.throws(() => parseEmploymentLifecycleResponse({ ...http, receipt: { ...http.receipt, ...patch } }, query(), owner, c), bad);
    const fingerprint = await employmentLifecycleCommandFingerprint(site, c); assert.notEqual(fingerprint, await employmentLifecycleCommandFingerprint(site, { ...c, reason: "另一次明确核验" }));
    assert.equal(employmentLifecycleReceiptMatches(r.receipt, { ...c, expectedDate: "2026-10-07" }, fingerprint), false);
  }
});
test("minimum recovery is tied to actor/op and cannot return unrelated detail/history", async () => {
  const q = query("recover"), http = await receiptHttp(); assert(parseEmploymentLifecycleResponse(http, q, owner).receipt);
  for (const patch of [{ detail: result().detail }, { history: [receipt()] }, { receipt: { ...http.receipt!, operationId: id(99) } }, { receipt: { ...http.receipt!, actorId: id(99) } }]) assert.throws(() => parseEmploymentLifecycleResponse({ ...http, ...patch }, q, owner), bad);
  assert.equal(parseEmploymentLifecycleResult(result("recover"), q, owner).receipt, null);
});
