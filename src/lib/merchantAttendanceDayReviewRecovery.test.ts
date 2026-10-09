import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceDayReviewRecovery } from "./merchantAttendanceDayReviewRecovery";
import { DAY_REVIEW_PROTOCOL, type DayReviewDecideCommand, type DayReviewQuery } from "./merchantAttendanceDayReviewContract";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
const id = (n: number) => `19900000-0000-4000-8000-${String(n).padStart(12, "0")}`, actorId = id(1), siteId = "99990199";
const query = (): DayReviewQuery => ({ siteId, access: "owner", mode: "preview", workerId: id(2), workDate: "2026-10-07", slotId: null, caseId: null });
const command = (): DayReviewDecideCommand => ({ action: "decide", operationId: id(3), caseId: id(4), expectedRevision: 0, workerId: id(2), employeeId: id(5),
  employeeAuthUserId: id(6), expectedFingerprint: "a".repeat(64), outcome: "follow_up", calendarReference: null, selfStatementOperationId: null, reason: "合成待核查原号" });
const at = "2026-10-08T12:00:00.123456Z";
function harness(fetcher?: AttendanceApiFetch, current = () => true, timeoutMs = 1000) {
  const values = new Map<string, string>(), calls: { url: unknown; init: RequestInit | undefined }[] = []; let sets = 0, removes = 0;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { sets++; values.set(k, v); }, removeItem: (k: string) => { removes++; values.delete(k); } };
  const client: AttendanceDayReviewRecovery = new AttendanceDayReviewRecovery({ siteId, actorId, access: "owner", storage: () => storage, isCurrent: current, timeoutMs,
    apiFetch: async (url, init): Promise<Response> => { calls.push({ url, init }); return fetcher ? fetcher(url, init) : reply(client, values); } });
  return { client, values, calls, storage, writes: () => ({ sets, removes }) };
}
function reply(client: AttendanceDayReviewRecovery, values: Map<string, string>, patch: Record<string, unknown> = {}) {
  const pending = JSON.parse(values.get(client.key)!), data = { protocol: DAY_REVIEW_PROTOCOL, siteId, actorId, readAt: at, kind: "receipt", replayed: true,
    receipt: { operationId: id(3), caseId: id(4), revision: 1, action: "decide", actorId, recordedAt: at, commandFingerprint: pending.fingerprint }, ...patch };
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("C15-A durable staging and load do zero HTTP and preserve exact actor/query/command with no evidence", async () => {
  const h = harness(), q = query(), c = command(); assert.equal(await h.client.load(), null);
  const pending = await h.client.stage(q, c); assert.equal(pending.command.operationId, id(3)); assert(Object.isFrozen(pending.command));
  Object.assign(c, { reason: "changed after snapshot" }); assert.equal((await h.client.load())!.command.reason, "合成待核查原号");
  assert.deepEqual(h.calls, []); assert.deepEqual(h.writes(), { sets: 1, removes: 0 });
  assert.doesNotMatch(h.values.get(h.client.key)!, /sourceText|sourceCanonical|latitude|observations/);
  await assert.rejects(h.client.stage(query(), command())); assert.equal(h.writes().sets, 1);
});

test("C15-A explicit original GET is the sole clear path; no POST, current detail or new operation is fetched", async () => {
  const h = harness(); await h.client.stage(query(), command()); const result = await h.client.recover();
  assert.equal(result.kind, "receipt"); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init!.method, "GET");
  const p = new URL(String(h.calls[0].url), "https://synthetic.invalid").searchParams;
  assert.deepEqual([...p.keys()].sort(), ["mode", "operationId", "siteId"]); assert.equal(p.get("operationId"), id(3));
  assert.equal(h.calls[0].init!.cache, "no-store"); assert.equal(h.calls[0].init!.redirect, "error"); assert.equal(h.calls[0].init!.body, undefined);
  assert.deepEqual(h.writes(), { sets: 1, removes: 1 }); assert.equal(await h.client.load(), null);
});

test("C15-A corrupt/foreign pending storage is neither erased nor replaced and never triggers HTTP", async () => {
  const h = harness(); await h.client.stage(query(), command()); const original = h.values.get(h.client.key)!;
  const values = ["broken-json", original.replace(actorId, id(99)), original.replace('"fingerprint":"', '"fingerprint":"0'),
    original.replace('"reason":"', '"reason":"changed-'), '{"version":1,"version":1}'];
  for (const raw of values) { h.values.set(h.client.key, raw); await assert.rejects(h.client.load()); await assert.rejects(h.client.recover());
    await assert.rejects(h.client.stage(query(), command())); assert.equal(h.values.get(h.client.key), raw); }
  assert.deepEqual(h.calls, []); assert.deepEqual(h.writes(), { sets: 1, removes: 0 });
});

test("C15-A 404, timeout, bad JSON/content type and substituted receipt all retain the original", async () => {
  const variants: ((h: ReturnType<typeof harness>) => Response)[] = [() => new Response("{}", { status: 404 }),
    () => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } }),
    () => new Response("{}", { status: 200, headers: { "Content-Type": "text/html" } }),
    h => reply(h.client, h.values, { receipt: { operationId: id(99), caseId: id(4), revision: 1, action: "decide", actorId, recordedAt: at, commandFingerprint: "a".repeat(64) } }),
    h => reply(h.client, h.values, { head: {} }), h => reply(h.client, h.values, { replayed: false })];
  for (const response of variants) { const h = harness(async () => response(h)); await h.client.stage(query(), command()); const raw = h.values.get(h.client.key);
    await assert.rejects(h.client.recover()); assert.equal(h.values.get(h.client.key), raw); assert.equal(h.writes().removes, 0); assert.equal(h.calls.length, 1); }
  const h = harness(async () => new Promise<Response>(() => {}), () => true, 10); await h.client.stage(query(), command()); const raw = h.values.get(h.client.key);
  await assert.rejects(h.client.recover()); assert.equal(h.values.get(h.client.key), raw); assert.equal(h.calls.length, 1);
});

test("C15-A pause or identity/scope change after GET suppresses late results and retains original storage", async () => {
  let release: (r: Response) => void = () => {}; let current = true;
  const h = harness(async () => new Promise<Response>(resolve => { release = resolve; }), () => current);
  await h.client.stage(query(), command()); const raw = h.values.get(h.client.key); const running = h.client.recover();
  await new Promise(resolve => setTimeout(resolve, 0)); current = false; h.client.pause(); release(reply(h.client, h.values));
  await assert.rejects(running); assert.equal(h.values.get(h.client.key), raw); assert.equal(h.writes().removes, 0); current = true;
  await h.client.load(); assert.equal(h.calls.length, 1);
});

test("C15-A storage race while awaiting digest or GET cannot delete a replacement intent", async () => {
  const staged = harness(), p = staged.client.stage(query(), command()); staged.values.set(staged.client.key, "another pending intent");
  await assert.rejects(p); assert.equal(staged.values.get(staged.client.key), "another pending intent"); assert.equal(staged.writes().sets, 0);
  const h = harness(async () => { const response = reply(h.client, h.values); h.values.set(h.client.key, "replacement"); return response; });
  await h.client.stage(query(), command()); await assert.rejects(h.client.recover()); assert.equal(h.values.get(h.client.key), "replacement"); assert.equal(h.writes().removes, 0);
});

test("C15-A wrong-site, owner-self judgment, unsupported query and hidden/current scope cannot be staged", async () => {
  const h = harness();
  await assert.rejects(h.client.stage({ ...query(), siteId: "99990198" }, command()));
  await assert.rejects(h.client.stage(query(), { ...command(), employeeAuthUserId: actorId }));
  await assert.rejects(h.client.stage({ siteId, mode: "recover", operationId: id(3) }, command()));
  const hidden = harness(undefined, () => false); await assert.rejects(hidden.client.stage(query(), command()));
  assert.equal(h.writes().sets, 0); assert.equal(hidden.writes().sets, 0);
});
