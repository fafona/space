import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerNotificationsQuery as parseQuery, parseOwnerNotificationsBody as parseBody, parseOwnerNotificationsJson as parseJson,
  parseOwnerNotificationsResult as parseResult, parseOwnerNotificationsResponse as parseResponse, parseOwnerNotificationsHttpQuery as parseHttp,
  ownerNotificationsQueryString as qs, ownerNotificationsReceiptMatches } from "./merchantAttendanceOwnerNotifications";
import { ownerNoticeId as id, ownerNoticeQuery as query, ownerNoticeCommand as command, ownerNoticeWire as wire, ownerNoticeActor as actor, ownerNoticeItem as item, ownerNoticeTime as at } from "../../scripts/fixtures/attendance-owner-notifications-model";

test("three exact query modes and one write command; no recipient impersonation or implicit null fields", () => {
  for (const mode of ["list", "detail", "recover"] as const) assert.deepEqual(parseHttp("https://www.faolla.com/any?" + qs(query(mode))), query(mode));
  assert.deepEqual(parseBody({ query: query("detail"), command: command() }).command, command());
  for (const bad of [{ ...query(), recipient: actor }, { ...query(), notificationId: id(10) }, { ...query("detail"), beforeId: id(10), beforeAt: at },
    { ...query("recover"), notificationId: null }, { ...query(), operationId: id(20) }, { ...query(), beforeAt: at }, { ...query(), siteId: "99990001\n" }, { siteId: "99990001", mode: "list" }]) assert.throws(() => parseQuery(bad));
  for (const q of [query(), query("recover"), query("detail", { notificationId: id(11) })]) assert.throws(() => parseBody({ query: q, command: command() }));
  assert.throws(() => parseBody({ query: query("detail"), command: { ...command(), actorId: actor } }));
  assert.throws(() => parseHttp("https://www.faolla.com/?" + qs(query()) + "&siteId=99990001"));
});
test("bounded strict JSON rejects duplicate fields, unsafe keys and byte overflow", () => {
  for (const text of ['{"mode":"list","mode":"detail"}', '{"__proto__":{}}', '{"n":NaN}', " ".repeat(4097)]) assert.throws(() => parseJson(text, "request"));
  assert.throws(() => parseJson(" ".repeat(131073))); assert.deepEqual(parseJson('{"a":null}'), { a: null });
});
test("list and both source kinds preserve original identity and expose only bounded navigation metadata", () => {
  for (const source of [item(), item("period")]) {
    const raw = { ...wire(), items: [source] }, parsed = parseResult(raw, query(), actor); assert.deepEqual(parsed, raw); assert(Object.isFrozen(parsed));
    for (const patch of [{ note: "private" }, { reason: "private" }, { employeeAuthUserId: id(9).toUpperCase() + " " }, { sourceRevision: "1" }, { sourceRevision: 0 }, { readAt: "2025-10-08T10:00:00.000001Z" }]) assert.throws(() => parseResult({ ...raw, items: [{ ...source, ...patch }] }, query(), actor));
  }
});
test("period navigation requires exact source/frame, valid dates and at most31 local days", () => {
  const target = item("period").target;
  for (const patch of [{ periodId: id(90) }, { fromDate: "2026-02-30" }, { throughDate: "2026-09-30" }, { throughDate: "2026-11-02" }, { url: "https://untrusted.invalid" }]) assert.throws(() => parseResult({ ...wire(), items: [{ ...item("period"), target: { ...target, ...patch } }] }, query(), actor));
});
test("25-item cursor and descending tie order are verified; no duplicate or skipped cursor identity", () => {
  const items = Array.from({ length: 25 }, (_, n) => ({ ...item(), notificationId: id(100 - n) }));
  const raw = { ...wire(), items, nextCursor: { at, id: id(76) } }; assert.deepEqual(parseResult(raw, query(), actor), raw);
  for (const patch of [{ items: [...items, item()] }, { nextCursor: { at, id: id(75) } }, { items: [...items].reverse() }, { items: [items[0], items[0]], nextCursor: null }, { items: items.slice(1) }]) assert.throws(() => parseResult({ ...raw, ...patch }, query(), actor));
  assert.throws(() => parseResult(raw, query("list", { beforeAt: at, beforeId: id(99) }), actor));
});
test("new-write and original-id receipts are minimum exact actor/operation/message tuples", () => {
  const q = query("detail"), c = command(), raw = wire(q, c); assert.deepEqual(parseResult(raw, q, actor, c), raw);
  const recovery = query("recover"); assert.deepEqual(parseResult({ ...raw, receipt: null }, recovery, actor), { ...raw, receipt: null });
  assert.throws(() => parseResult({ ...raw, receipt: null }, q, actor, c));
  if (raw.kind !== "receipt" || !raw.receipt) throw Error("fixture");
  assert(ownerNotificationsReceiptMatches(raw.receipt, c, actor)); assert(!ownerNotificationsReceiptMatches(raw.receipt, c, id(2)));
  for (const patch of [{ actorId: id(2) }, { operationId: id(99) }, { notificationId: id(90) }, { sourceId: id(12) }]) assert.throws(() => parseResult({ ...raw, receipt: { ...raw.receipt, ...patch } }, recovery, actor));
});
test("response discriminator, actor, HTTP envelope and all extra authority fields fail closed", () => {
  const q = query("detail"); assert.deepEqual(parseResponse({ ok: true, ...wire(q) }, q, actor), wire(q));
  for (const patch of [{ actorId: id(2) }, { siteId: "99990002" }, { kind: "list" }, { canMarkRead: 1 }, { isOwner: true }]) assert.throws(() => parseResult({ ...wire(q), ...patch }, q, actor));
  assert.throws(() => parseResponse({ ok: false, ...wire(q) }, q, actor));
  assert.throws(() => parseResponse({ ok: true, ...wire(q), error: null }, q, actor));
});
