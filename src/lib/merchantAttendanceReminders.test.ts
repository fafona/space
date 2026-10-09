import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as p from "./merchantAttendanceReminders";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990201", actorId = id(1), at = "2026-10-08T13:00:00.000001Z", end = "2026-10-08T14:00:00.000000Z", later = "2026-10-08T15:00:00.000000Z";
const query = (mode: "list" | "detail" | "recover" | "check" = "list"): p.AttendanceReminderQuery => {
  const base = { siteId, batchId: null, operationId: null, cursor: null };
  if (mode === "list" || mode === "check") return { ...base, mode };
  if (mode === "detail") return { ...base, mode, batchId: id(2) }; return { ...base, mode, operationId: id(3) };
};
const mark = (): p.AttendanceReminderCommand => ({ action: "mark_read", operationId: id(3), batchId: id(2) });
const run = (): p.AttendanceReminderCommand => ({ action: "run_due", operationId: id(3), cursor: null });
const runQuery = (): p.AttendanceReminderSystemRunQuery => ({ siteId, mode: "run", operationId: id(3), cursor: null });
const summary = (n = 2, category: p.AttendanceReminderCategory = "open_session"): p.AttendanceReminderSummary => ({ batchId: id(n), category,
  windowStart: "2026-10-08T13:00:00.000000Z", windowEnd: end, recordedAt: at, itemCount: 1, readAt: null });
const target = (kind: p.AttendanceReminderCategory = "open_session", family: p.AttendanceReminderReviewFamily = "correction"): p.AttendanceReminderTarget => kind === "open_session"
  ? { kind, workerId: id(8), startEventId: id(9) } : kind === "period_due" ? { kind, workerId: id(8), intentId: id(9) }
    : { kind, family, requestId: id(9), responsibilityRevision: 2, responsibilityOperationId: id(10) };
const batch = (category: p.AttendanceReminderCategory = "open_session"): p.AttendanceReminderBatch => ({ ...summary(2, category), items: [{ planId: id(4), ordinal: 1, target: target(category), observedAt: at }] });
function result(data: p.AttendanceReminderData, receipt: p.AttendanceReminderReceipt | null = null, system = false): p.AttendanceReminderResult {
  return { protocol: p.ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: system ? { kind: "system" } : { kind: "auth", authUserId: actorId }, readAt: later, data, receipt };
}
async function receipt(command = mark(), system = false): Promise<p.AttendanceReminderReceipt> {
  const commandFingerprint = system ? await p.attendanceReminderSystemCommandFingerprint(runQuery()) : await p.attendanceReminderCommandFingerprint(query(command.action === "mark_read" ? "detail" : "check"), actorId, command);
  return { operationId: command.operationId, action: command.action, actorKind: system ? "system" : "auth", actorId: system ? null : actorId, commandFingerprint, recordedAt: at,
    result: command.action === "mark_read" ? { kind: "mark_read", batchId: command.batchId, readAt: at }
      : { kind: "run", status: "completed", checkedCount: 1, deliveredCount: 1, deferredCount: 0, stoppedCount: 0, batchIds: [id(2)], nextCursor: null } };
}
const rejects = (raw: unknown, q = query(), command: p.AttendanceReminderCommand | null = null) => assert.rejects(p.parseAttendanceReminderResult(raw, q, actorId, command), { code: "attendance_reminder_invalid" });

test("201 Auth queries are exact, explicit-null and detached readonly; all modes reject other selectors", () => {
  for (const mode of ["list", "detail", "recover", "check"] as const) {
    const q = query(mode), parsed = p.parseAttendanceReminderQuery(q); assert.deepEqual(parsed, q); assert.ok(Object.isFrozen(parsed)); assert.notEqual(parsed, q);
    for (const changed of [{ ...q, actorId }, { ...q, mode: "run" }, { ...q, siteId: siteId + "\n" }, { ...q, recipientId: actorId }]) assert.throws(() => p.parseAttendanceReminderQuery(changed));
  }
  for (const q of [{ ...query(), batchId: id(2) }, { ...query("detail"), cursor: {} }, { ...query("recover"), batchId: id(2) }, { ...query("check"), operationId: id(3) }]) assert.throws(() => p.parseAttendanceReminderQuery(q));
  const input = { ...query(), cursor: { beforeAt: at, beforeId: id(20) } }, parsed = p.parseAttendanceReminderQuery(input); input.cursor.beforeAt = later;
  assert.equal(parsed.cursor?.beforeAt, at); assert.ok(Object.isFrozen(parsed.cursor));
});
test("201 Auth body only mark/detail or owner-check/run; no claimed system, recipient or due time", () => {
  for (const body of [{ query: query("detail"), command: mark() }, { query: query("check"), command: run() }]) assert.deepEqual(p.parseAttendanceReminderBody(body), body);
  for (const body of [{ query: query(), command: run() }, { query: query("recover"), command: mark() }, { query: query("detail"), command: run() },
    { query: query("check"), command: mark() }, { query: query("detail"), command: { ...mark(), batchId: id(99) } }, { query: runQuery(), command: run() },
    { query: query("check"), command: { ...run(), actorKind: "system" } }, { query: query("check"), command: run(), actor: { kind: "system" } }]) assert.throws(() => p.parseAttendanceReminderBody(body));
});
test("201 strict JSON refuses duplicate escaped keys, UTF8 overflow, unsafe numbers and Unicode", () => {
  for (const text of ['{"siteId":1,"siteId":2}', '{"x":1,"\\u0078":2}', '{"a":"\\ud800"}', '{"a":"\\u0000"}', '{"n":-0}', '{"n":1e400}', '"' + "中".repeat(3000) + '"']) assert.throws(() => p.parseAttendanceReminderJson(text));
  assert.deepEqual(p.parseAttendanceReminderJson(JSON.stringify(query())), query());
  assert.throws(() => p.parseAttendanceReminderJson(" ".repeat(p.ATTENDANCE_REMINDER_RESULT_BYTES + 1), "response"), { code: "attendance_reminder_invalid" });
});
test("201 public parser never invokes getters/toJSON and rejects sparse, extra, symbol and cyclic properties", () => {
  let invoked = 0; const getter = { ...query(), get mode() { invoked++; return "list"; } };
  assert.throws(() => p.parseAttendanceReminderQuery(getter)); assert.equal(invoked, 0);
  for (const value of [Object.assign({ ...query() }, { toJSON() { invoked++; return query(); } }), { ...query(), [Symbol("hidden")]: 1 }, { ...query(), x: new Date() }]) assert.throws(() => p.parseAttendanceReminderQuery(value));
  const cyclic: Record<string, unknown> = {}; cyclic.x = cyclic; assert.throws(() => p.assertAttendanceReminderTree(cyclic));
  const sparse = Array(1); assert.throws(() => p.assertAttendanceReminderTree(sparse)); const extras = [1]; Object.defineProperty(extras, "x", { value: 2 }); assert.throws(() => p.assertAttendanceReminderTree(extras));
  assert.equal(invoked, 0);
});
test("201 UTC6 retains microseconds/years and rejects normalization, nonexistent dates and UUID suffixes", () => {
  for (const stamp of [at, "0001-01-01T00:00:00.000001Z", "9999-12-31T23:59:59.999999Z", "2024-02-29T00:00:00.000000Z"]) assert.equal(p.attendanceReminderStamp(stamp), stamp);
  for (const stamp of ["0000-01-01T00:00:00.000000Z", "2026-02-29T00:00:00.000000Z", at.replace("Z", "+00:00"), at.replace("000001", "000"), at + "\n", at.replace("13:", "24:")]) assert.throws(() => p.attendanceReminderStamp(stamp));
  for (const operationId of [id(3).toUpperCase().replace("4000", "F000"), id(3) + "\n", "00000000-0000-0000-0000-000000000000"]) assert.throws(() => p.parseAttendanceReminderCommand({ ...mark(), operationId }));
});
test("201 run cursor is exact and ordered without accepting caller system identity", () => {
  const cursor = { runOperationId: id(7), afterDueAt: at, afterPlanId: id(8), cutoffAt: at };
  const q = { ...runQuery(), cursor }; assert.deepEqual(p.parseAttendanceReminderSystemQuery(q), q); assert.ok(Object.isFrozen(p.parseAttendanceReminderSystemQuery(q).cursor));
  for (const bad of [{ ...q, actorKind: "system" }, { ...q, mode: "recover" }, { ...q, cursor: { ...cursor, afterDueAt: later } }, { ...q, cursor: { ...cursor, asOf: at } }]) assert.throws(() => p.parseAttendanceReminderSystemQuery(bad));
});
test("201 auth/system canonical tuples match independent Node SHA and differ by actual actor/site/intent", async () => {
  const c = mark(), text = p.attendanceReminderCommandFingerprintText(query("detail"), actorId, c);
  assert.equal(text, `["attendance-reminder-command-v1", "${siteId}", "auth", "${actorId}", ["mark_read", "${id(3)}", "${id(2)}"]]`);
  assert.equal(await p.attendanceReminderCommandFingerprint(query("detail"), actorId, c), createHash("sha256").update(text, "utf8").digest("hex"));
  assert.notEqual(await p.attendanceReminderCommandFingerprint(query("detail"), actorId, c), await p.attendanceReminderCommandFingerprint(query("detail"), id(99), c));
  assert.notEqual(await p.attendanceReminderCommandFingerprint(query("check"), actorId, run()), await p.attendanceReminderSystemCommandFingerprint(runQuery()));
  assert.match(p.attendanceReminderSystemCommandFingerprintText(runQuery()), /, "system", null, \["run_due"/);
  const q = runQuery(), changed = { ...q, siteId: "99990202" }; assert.notEqual(await p.attendanceReminderSystemCommandFingerprint(q), await p.attendanceReminderSystemCommandFingerprint(changed));
  assert.throws(() => p.attendanceReminderCommandFingerprintText(query(), actorId, c));
});
test("201 list is descending keyset with 25+1 externally-proven continuation, never returns sentinel", async () => {
  const items = Array.from({ length: 25 }, (_, i) => summary(100 - i)), nextCursor = { beforeAt: at, beforeId: id(76) }, raw = result({ kind: "list", items, nextCursor });
  assert.deepEqual(await p.parseAttendanceReminderResult(raw, query(), actorId), raw);
  for (const data of [{ kind: "list", items: items.slice(1), nextCursor }, { kind: "list", items: [...items, summary(75)], nextCursor },
    { kind: "list", items: [...items].reverse(), nextCursor }, { kind: "list", items: [items[0], items[0]], nextCursor: null }, { kind: "list", items, nextCursor: { ...nextCursor, beforeId: id(75) } }]) await rejects({ ...raw, data });
  const next: p.AttendanceReminderQuery = { ...query("list"), mode: "list", batchId: null, operationId: null, cursor: nextCursor };
  await p.parseAttendanceReminderResult(result({ kind: "list", items: [summary(75)], nextCursor: null }), next, actorId);
  await rejects(result({ kind: "list", items: [summary(76)], nextCursor: null }), next);
  //Exactly25 without a26th sentinel may legitimately end here.
  await p.parseAttendanceReminderResult(result({ kind: "list", items, nextCursor: null }), query(), actorId);
});
test("201 detail verifies all three minimal navigation categories and six pending-review families", async () => {
  for (const category of ["open_session", "pending_review", "period_due"] as const) {
    const b = batch(category), raw = result({ kind: "batch", batch: b }); assert.deepEqual(await p.parseAttendanceReminderResult(raw, query("detail"), actorId), raw);
  }
  for (const family of ["correction", "correction_revision", "missing", "missing_revision", "leave", "work_arrangement"] as const) {
    const b = batch("pending_review"), raw = result({ kind: "batch", batch: { ...b, items: [{ ...b.items[0], target: target("pending_review", family) }] } }); await p.parseAttendanceReminderResult(raw, query("detail"), actorId);
  }
});
test("201 batch enforces exact hour, observed-at equality, category, plan identity and ordinal caps", async () => {
  const b = batch(), raw = result({ kind: "batch", batch: b });
  for (const changed of [{ ...b, batchId: id(99) }, { ...b, itemCount: 2 }, { ...b, itemCount: 0, items: [] }, { ...b, windowStart: at }, { ...b, windowEnd: later },
    { ...b, recordedAt: end }, { ...b, readAt: "2026-10-08T13:00:00.000000Z" }, { ...b, items: [{ ...b.items[0], observedAt: end }] },
    { ...b, items: [{ ...b.items[0], ordinal: 11 }] }, { ...b, items: [{ ...b.items[0], target: target("period_due") }] },
    { ...b, items: [{ ...b.items[0], target: { ...b.items[0].target, recipientId: actorId } }] },
    { ...b, itemCount: 2, items: [b.items[0], b.items[0]] }, { ...b, itemCount: 2, items: [{ ...b.items[0], planId: id(5) }, b.items[0]] }]) await rejects({ ...raw, data: { kind: "batch", batch: changed } }, query("detail"));
});
test("201 result binds protocol, exact merchant/actual Auth, UTC read bound and minimal selector", async () => {
  const raw = result({ kind: "list", items: [summary()], nextCursor: null });
  for (const changed of [{ ...raw, siteId: "99990202" }, { ...raw, actor: { kind: "system" } }, { ...raw, actor: { kind: "auth", authUserId: id(99) } },
    { ...raw, actor: { ...raw.actor, recipientId: actorId } }, { ...raw, readAt: "2026-10-08T13:00:00.000000Z" }, { ...raw, source: {} }, { ...raw, protocol: "other" },
    { ...raw, data: { kind: "receipt" } }]) await rejects(changed);
  await rejects({ ...raw, receipt: await receipt() });
});
test("201 mark receipt verifies operation/actor/SHA/batch and permits old original read timestamp", async () => {
  const c = mark(), r = await receipt(c), raw = result({ kind: "receipt" }, r);
  assert.deepEqual(await p.parseAttendanceReminderResult(raw, query("detail"), actorId, c), raw);
  for (const changed of [{ ...r, operationId: id(99) }, { ...r, actorId: id(99) }, { ...r, actorKind: "system", actorId: null }, { ...r, commandFingerprint: "a".repeat(64) },
    { ...r, result: { kind: "mark_read", batchId: id(99), readAt: at } }, { ...r, result: { kind: "mark_read", batchId: id(2), readAt: later } }, { ...r, pin: "12345678" }]) await rejects(result({ kind: "receipt" }, changed as p.AttendanceReminderReceipt), query("detail"), c);
  await rejects(result({ kind: "receipt" }, null), query("detail"), c);
});
test("201 recovery original receipt is distinct from pending-command verification and not-found stays null", async () => {
  const c = mark(), raw = result({ kind: "receipt" }, await receipt(c));
  assert.deepEqual(await p.parseAttendanceReminderResult(raw, query("recover"), actorId), raw);
  assert.deepEqual(await p.parseAttendanceReminderResult(raw, query("recover"), actorId, c), raw);
  await rejects(raw, query("recover"), { ...c, batchId: id(99) } as p.AttendanceReminderCommand);
  const empty = result({ kind: "receipt" }); assert.deepEqual(await p.parseAttendanceReminderResult(empty, query("recover"), actorId, c), empty);
  await rejects({ ...raw, data: { kind: "batch", batch: batch() } }, query("recover"));
});
test("201 run result is <=25 counts, unique delivered batches, finite disabled and exact continuation", async () => {
  const c = run(), r = await receipt(c), raw = result({ kind: "receipt" }, r); await p.parseAttendanceReminderResult(raw, query("check"), actorId, c);
  const good: p.AttendanceReminderRunResult = { kind: "run", status: "completed", checkedCount: 25, deliveredCount: 1, deferredCount: 2, stoppedCount: 3, batchIds: [id(2)],
    nextCursor: { runOperationId: id(3), afterDueAt: at, afterPlanId: id(7), cutoffAt: at } };
  await p.parseAttendanceReminderResult(result({ kind: "receipt" }, { ...r, result: good }), query("check"), actorId, c);
  for (const changed of [{ ...good, checkedCount: 26 }, { ...good, checkedCount: 24 }, { ...good, deliveredCount: 24 }, { ...good, batchIds: [id(2), id(2)] },
    { ...good, deliveredCount: 0 }, { ...good, nextCursor: { ...good.nextCursor, runOperationId: id(99) } }, { ...good, nextCursor: { ...good.nextCursor, cutoffAt: later } },
    { ...good, status: "disabled" }, { ...good, proposal: {} }]) await rejects(result({ kind: "receipt" }, { ...r, result: changed } as p.AttendanceReminderReceipt), query("check"), c);
  const disabled: p.AttendanceReminderRunResult = { kind: "run", status: "disabled", checkedCount: 0, deliveredCount: 0, deferredCount: 0, stoppedCount: 0, batchIds: [], nextCursor: null };
  await p.parseAttendanceReminderResult(result({ kind: "receipt" }, { ...r, result: disabled }), query("check"), actorId, c);
});
test("201 check GET never creates a run and no receipt body is accepted without a command", async () => {
  const raw = result({ kind: "receipt" }); assert.deepEqual(await p.parseAttendanceReminderResult(raw, query("check"), actorId), raw);
  await rejects(result({ kind: "receipt" }, await receipt(run())), query("check"));
});
test("201 SHA-verified continuation preserves the original cutoff and strictly advances due/id", async () => {
  const cursor: p.AttendanceReminderRunCursor = { runOperationId: id(6), afterDueAt: at, afterPlanId: id(7), cutoffAt: at };
  const c: p.AttendanceReminderCommand = { action: "run_due", operationId: id(3), cursor }, r = await receipt(c);
  const next: p.AttendanceReminderRunCursor = { runOperationId: id(3), afterDueAt: at, afterPlanId: id(8), cutoffAt: at };
  const saved: p.AttendanceReminderRunResult = { kind: "run", status: "completed", checkedCount: 25, deliveredCount: 1, deferredCount: 0, stoppedCount: 0, batchIds: [id(2)], nextCursor: next };
  await p.parseAttendanceReminderResult(result({ kind: "receipt" }, { ...r, result: saved }), query("check"), actorId, c);
  for (const changed of [{ ...next, cutoffAt: "2026-10-08T13:00:00.000000Z", afterDueAt: "2026-10-08T13:00:00.000000Z" }, { ...next, afterPlanId: id(7) },
    { ...next, afterDueAt: "2026-10-08T13:00:00.000000Z" }]) await rejects(result({ kind: "receipt" }, { ...r, result: { ...saved, nextCursor: changed } }), query("check"), c);
});
test("201 system parser hardcodes literal domain, verifies original cursor and never accepts Auth mark", async () => {
  const q = runQuery(), r = await receipt(run(), true), raw = result({ kind: "receipt" }, r, true); assert.deepEqual(await p.parseAttendanceReminderSystemResult(raw, q), raw);
  const recover: p.AttendanceReminderSystemQuery = { ...q, mode: "recover", cursor: null };
  assert.deepEqual(await p.parseAttendanceReminderSystemResult(raw, recover, q), raw);
  assert.deepEqual(await p.parseAttendanceReminderSystemResult(result({ kind: "receipt" }, null, true), recover, q), result({ kind: "receipt" }, null, true));
  for (const changed of [{ ...raw, actor: { kind: "auth", authUserId: actorId } }, { ...raw, receipt: await receipt() }, { ...raw, receipt: { ...r, actorId } },
    { ...raw, receipt: { ...r, commandFingerprint: "a".repeat(64) } }, { ...raw, data: { kind: "list", items: [], nextCursor: null } }]) await assert.rejects(p.parseAttendanceReminderSystemResult(changed, q), { code: "attendance_reminder_invalid" });
  await assert.rejects(p.parseAttendanceReminderSystemResult(raw, recover, { ...q, cursor: { runOperationId: id(7), afterDueAt: at, afterPlanId: id(8), cutoffAt: at } }));
});
test("201 parsed output is deeply readonly, detached before asynchronous receipt SHA verification", async () => {
  const input = result({ kind: "batch", batch: batch() }), parsed = await p.parseAttendanceReminderResult(input, query("detail"), actorId);
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.actor)); assert.ok(Object.isFrozen(parsed.data));
  if (parsed.data.kind !== "batch" || input.data.kind !== "batch") throw Error(); assert.ok(Object.isFrozen(parsed.data.batch.items[0].target)); assert.notEqual(parsed.data.batch, input.data.batch);
  const raw = result({ kind: "receipt" }, await receipt()), promise = p.parseAttendanceReminderResult(raw, query("detail"), actorId, mark());
  const r = raw.receipt; if (r?.result.kind !== "mark_read") throw Error(); (r.result as { batchId: string }).batchId = id(99);
  const saved = await promise; if (saved.receipt?.result.kind !== "mark_read") throw Error(); assert.equal(saved.receipt.result.batchId, id(2));
});
test("201 new parsers accept null-prototype own data but reject inherited selectors and array overflow", () => {
  assert.deepEqual(p.parseAttendanceReminderQuery(Object.assign(Object.create(null), query())), query());
  assert.throws(() => p.parseAttendanceReminderQuery(Object.create(query())));
  assert.throws(() => p.assertAttendanceReminderTree(Array(26).fill(null)));
  const depth: unknown = Array.from({ length: 14 }).reduce<unknown>(value => ({ value }), null); assert.throws(() => p.assertAttendanceReminderTree(depth));
  const plain = { ...query() }; Object.defineProperty(plain, "hidden", { value: 1, enumerable: false }); assert.throws(() => p.parseAttendanceReminderQuery(plain));
});
