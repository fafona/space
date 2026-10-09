import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceDayReviewReader } from "./merchantAttendanceDayReviewReader";
import { dayReviewPendingKey } from "./merchantAttendanceDayReviewRecovery";
import { DAY_REVIEW_PROTOCOL, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { dayUiSource, dayUiOwner as actor, dayUiSite as siteId, dayUiWorker as workerId, dayUiDate as workDate } from "../../scripts/fixtures/attendance-day-review-ui-model";
const reply = (data: unknown) => Response.json({ ok: true, data });
function setup(options: { timeoutMs?: number; isCurrent?: () => boolean } = {}) {
  const values = new Map<string, string>(), calls: { url: string; options?: RequestInit }[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const apiFetch = async (url: string, init?: RequestInit) => { calls.push({ url, options: init }); return reply(dayUiSource()); };
  return { values, calls, options: { siteId, actorId: actor, access: "owner" as const, storage: () => storage, apiFetch, ...options } };
}
const query: DayReviewQuery = { siteId, access: "owner", mode: "candidates", workerId, workDate };
test("199 reader is inert until explicit GET, exact bounded public source only; it never writes or polls", async () => {
  const s = setup(), client = new AttendanceDayReviewReader(s.options); assert.equal(s.calls.length, 0);
  const r = await client.read(query); assert.equal(r.kind, "candidates"); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].options?.method, "GET");
  assert.equal(s.calls[0].options?.cache, "no-store"); assert.equal(s.calls[0].options?.redirect, "error"); assert.equal(s.values.size, 0);
  await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 1);
});
test("199 reader refuses another scope and any pending/malformed intent without reading or overwriting it", async () => {
  const s = setup(), client = new AttendanceDayReviewReader(s.options), key = dayReviewPendingKey(siteId, "owner", actor);
  s.values.set(key, "malformed original bytes"); await assert.rejects(client.read(query)); assert.equal(s.values.get(key), "malformed original bytes"); assert.equal(s.calls.length, 0);
  s.values.clear(); await assert.rejects(client.read({ ...query, siteId: "99990001" }));
  await assert.rejects(client.read({ siteId, mode: "recover", operationId: actor })); assert.equal(s.calls.length, 0);
});
test("199 reader checks actor/query and strips no unknown private fields; failed/invalid transport is not an empty day", async () => {
  const s = setup();
  for (const data of [{ ...dayUiSource(), actorId: workerId }, { ...dayUiSource(), privateCanonical: "private" },
    { ...dayUiSource(), input: { ...dayUiSource().input, target: { ...dayUiSource().input.target, workDate: "2026-10-06" } } }])
    await assert.rejects(new AttendanceDayReviewReader({ ...s.options, apiFetch: async () => reply(data) }).read(query));
  for (const response of [new Response("{}", { status: 503 }), new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), Response.json({ ok: true, data: null, authorityChecked: true })])
    await assert.rejects(new AttendanceDayReviewReader({ ...s.options, apiFetch: async () => response }).read(query));
});
test("199 paused/changed viewer and concurrent reads cannot accept late private body or add network requests", async () => {
  let release!: (response: Response) => void, current = true, count = 0;
  const s = setup({ isCurrent: () => current }), waiting = new Promise<Response>(r => { release = r; });
  const client = new AttendanceDayReviewReader({ ...s.options, apiFetch: async () => { count++; return waiting; } });
  const first = client.read(query); await assert.rejects(client.read(query)); client.pause(); current = false; release(reply(dayUiSource()));
  await assert.rejects(first); assert.equal(count, 1);
});
test("199 late body, pending storage replacement and total deadline fail closed with one request", async () => {
  const s = setup({ timeoutMs: 10 }); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":true,')); }, cancel() { cancelled = true; } });
  await assert.rejects(new AttendanceDayReviewReader({ ...s.options, apiFetch: async () => new Response(stream, { headers: { "content-type": "application/json" } }) }).read(query));
  assert.equal(cancelled, true);
  let release!: (response: Response) => void; const held = new Promise<Response>(r => { release = r; });
  const client = new AttendanceDayReviewReader({ ...s.options, timeoutMs: 12000, apiFetch: async () => held }), result = client.read(query);
  const key = dayReviewPendingKey(siteId, "owner", actor); s.values.set(key, "another pending intent"); release(reply(dayUiSource()));
  await assert.rejects(result); assert.equal(s.values.get(key), "another pending intent");
});
test("199 strict saved 25-row list uses requested role, without fetching a source", async () => {
  const s = setup(), q: DayReviewQuery = { siteId, access: "owner", mode: "list", workerId, cursor: null };
  const result = await new AttendanceDayReviewReader({ ...s.options, apiFetch: async () => reply({ protocol: DAY_REVIEW_PROTOCOL, kind: "list", siteId, actorId: actor,
    readAt: dayUiSource().readAt, access: "owner", items: [], nextCursor: null }) }).read(q);
  assert.equal(result.kind, "list");
});
