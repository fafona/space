import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceSelfScheduleClient, parseSelfSchedulePending, selfSchedulePendingKey, type SelfScheduleClientOptions } from "./merchantAttendanceSelfScheduleClient";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { SelfScheduleHttpResult, SelfScheduleSelection, SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";
import type { AttendanceSelfCommand } from "./merchantAttendanceSelf";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3), key = selfSchedulePendingKey(siteId, employeeId);
const command: AttendanceSelfCommand = { action: "clock_in", operationId: id(10), expectedWorkerId: workerId, locationId, expectedSequence: 0 };
const selection: SelfScheduleSelection = { slotId: id(20), revision: 1 };
const slot: SelfScheduleSlot = { id: id(20), revision: 1, locationId, locationName: "本地地点", timeZone: "UTC", workDate: "2026-10-05",
  startAt: "2026-10-05T09:00:00.000Z", endAt: "2026-10-05T17:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
const pending = (choice: SelfScheduleSelection | null = null) => ({ version: 1, siteId, employeeId, command, selection: choice });
function initial(): SelfScheduleHttpResult { return { ok: true, moduleEnabled: true, selectionEnabled: true, protocol: "self-schedule-v1",
  clock: { workerId, locationId, state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false },
  choices: { timeZone: "UTC", fromDate: "2026-10-04", throughDate: "2026-10-06", revision: 1, limited: false, entries: [structuredClone(slot)] }, association: null }; }
function committed(choice: SelfScheduleSelection | null = null): SelfScheduleHttpResult {
  const result = initial(), receipt = { id: id(100), siteId, workerId, locationId, operationId: command.operationId, action: "clock_in" as const,
    sequence: 1, occurredAt: "2026-10-05T08:30:00.000Z", timeZone: "UTC", breakPaid: null };
  result.clock = { ...result.clock, receipt, state: { sequence: 1, status: "working", lastEvent: receipt } };
  result.association = { startEventId: receipt.id, operationId: command.operationId, selection: choice, status: choice ? "linked" : "unselected", reason: null,
    slot: choice ? structuredClone(slot) : null, observedRevision: 1, recordedAt: "2026-10-05T08:30:00.001000Z", currentCancelled: choice ? false : null };
  return result;
}
function storage() { const entries = new Map<string, string>(); return { entries, getItem: (k: string) => entries.get(k) ?? null,
  setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); } }; }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(api: AttendanceApiFetch = async () => Response.json(initial()), extra: Partial<SelfScheduleClientOptions> = {}) {
  const saved = storage(), calls: { url: string; init: RequestInit }[] = [];
  const options: SelfScheduleClientOptions = { siteId, employeeId, canClock: true, enabled: true, storage: () => saved, randomId: () => id(10),
    apiFetch: async (url, init = {}) => { calls.push({ url, init }); return api(url, init); }, ...extra };
  const client = new AttendanceSelfScheduleClient(options); return { saved, calls, client, options };
}
test("construction/initialize only inspect local pending; off without pending never requests", async () => {
  const f = fixture(undefined, { enabled: false }); await f.client.initialize(); await f.client.refresh(); await f.client.submit(null);
  assert.equal(f.calls.length, 0); assert.equal(f.saved.entries.size, 0); assert.equal(f.client.blocksOtherActions(), false);
});
test("explicit null choice persists the exact detached original intent before a single new POST", async () => {
  const f = fixture(async (_url, init) => { if (init?.method === "POST") { assert.deepEqual(JSON.parse(f.saved.getItem(key)!), pending());
    assert.deepEqual(JSON.parse(init.body as string), { siteId, command, selection: null }); return Response.json(committed()); } return Response.json(initial()); });
  await f.client.initialize(); await f.client.refresh(); assert.equal(f.calls.length, 1); await f.client.submit(null);
  assert.equal(f.calls.length, 2); assert(f.calls.every(c => c.url.startsWith("/api/merchant-enterprise/attendance/self-schedule")));
  assert.equal(f.client.getSnapshot().result?.association?.status, "unselected"); assert.equal(f.saved.getItem(key), null);
});
test("one listed candidate is not submitted until an explicit selection and unknown IDs cannot POST", async () => {
  const f = fixture(async (_url, init) => Response.json(init?.method === "POST" ? committed(selection) : initial()));
  await f.client.initialize(); await f.client.refresh(); assert.equal(f.calls.length, 1);
  await f.client.submit({ slotId: id(999), revision: 1 }); assert.equal(f.calls.length, 1); assert.equal(f.saved.getItem(key), null);
  await f.client.refresh(); await f.client.submit(selection); assert.equal(f.client.getSnapshot().result?.association?.selection?.slotId, slot.id);
});
test("committed POST reply loss reloads exact pending and recovers by GET only", async () => {
  const saved = storage(); const a = fixture(async (_url, init) => { if (init?.method === "POST") throw Error("lost"); return Response.json(initial()); }, { storage: () => saved });
  await a.client.initialize(); await a.client.refresh(); await a.client.submit(selection); const raw = saved.getItem(key)!;
  assert.equal(a.client.getSnapshot().phase, "unconfirmed"); a.client.pause(); assert.equal(saved.getItem(key), raw);
  const b = fixture(async () => Response.json(committed(selection)), { storage: () => saved }); await b.client.initialize(); assert.equal(b.calls.length, 0);
  assert.equal(saved.getItem(key), raw); await b.client.refresh(); assert.equal(b.calls.length, 1); assert.equal(b.calls[0].init.method, "GET");
  assert(b.calls[0].url.includes(command.operationId)); assert.equal(saved.getItem(key), null);
});
test("retry first GETs null then sends exact original command/choice without another random ID", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending(selection))); let ids = 0;
  const f = fixture(async (_url, init) => Response.json(init?.method === "POST" ? committed(selection) : initial()), { storage: () => saved, randomId: () => { ids++; return id(99); } });
  await f.client.initialize(); await f.client.retry(); assert.deepEqual(f.calls.map(c => c.init.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(f.calls[1].init.body as string), { siteId, command, selection }); assert.equal(ids, 0);
});
test("flag rollback keeps GET recovery, never POST/fallback; null receipt does not clear pending", async () => {
  const saved = storage(), raw = JSON.stringify(pending()); saved.setItem(key, raw);
  const response = initial(); response.selectionEnabled = false; response.choices.entries = [];
  const f = fixture(async () => Response.json(response), { enabled: false, storage: () => saved });
  await f.client.initialize(); await f.client.refresh(); await f.client.retry(); await f.client.submit(null);
  assert.equal(f.calls.length, 1); assert.equal(saved.getItem(key), raw); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  assert.equal(f.client.getSnapshot().result?.selectionEnabled, false);
});
test("only strictly newer authoritative sequence with absent receipt settles an unadopted intent", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending())); const f = fixture(async () => Response.json(initial()), { storage: () => saved });
  await f.client.initialize(); await f.client.refresh(); assert(saved.getItem(key));
  const newer = committed(); newer.clock.receipt = null; newer.association = null;
  const g = fixture(async () => Response.json(newer), { storage: () => saved }); await g.client.initialize(); await g.client.refresh(); assert.equal(saved.getItem(key), null);
});
test("legacy pending and a real-time other-channel interlock prohibit every new POST", async () => {
  for (const legacy of [true, false]) {
    const f = fixture(undefined, { canStart: () => legacy }); await f.client.initialize(); await f.client.refresh();
    if (legacy) f.saved.setItem(attendancePendingKey(siteId, employeeId), "old intent");
    await f.client.submit(null); assert.equal(f.calls.length, 1); assert.equal(f.saved.getItem(key), null);
  }
});
test("both pending retain original bytes and can read independently but cannot retry POST", async () => {
  const saved = storage(), raw = JSON.stringify(pending()); saved.setItem(key, raw); saved.setItem(attendancePendingKey(siteId, employeeId), "old intent");
  const f = fixture(undefined, { storage: () => saved }); await f.client.initialize(); await f.client.refresh(); await f.client.retry();
  assert.equal(f.calls.length, 1); assert.equal(saved.getItem(key), raw); assert.equal(f.client.blocksOtherActions(), true);
});
test("paused or disabled read never authorizes a new operation, even explicitly unselected", async () => {
  for (const patch of [{ moduleEnabled: false, selectionEnabled: false }, { selectionEnabled: false }]) {
    const response = { ...initial(), ...patch }; response.choices.entries = [];
    const f = fixture(async () => Response.json(response)); await f.client.initialize(); await f.client.refresh(); await f.client.submit(null);
    assert.equal(f.calls.length, 1); assert.equal(f.saved.getItem(key), null); assert(f.client.getSnapshot().result);
  }
});
test("a failed GET clears the successful clock snapshot and cannot submit using stale authorization", async () => {
  let read = 0; const f = fixture(async () => ++read === 1 ? Response.json(initial()) : Response.json({ ok: false, error: "unauthorized" }, { status: 401 }));
  await f.client.initialize(); await f.client.refresh(); await f.client.refresh(); await f.client.submit(null);
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.calls.length, 2); assert.equal(f.saved.getItem(key), null);
});
test("authorization and operation conflicts preserve pending; exact first-attempt business rejection may settle it", async () => {
  for (const [error, status, keep] of [["attendance_access_denied", 403, true], ["attendance_operation_conflict", 409, true], ["attendance_platform_paused", 403, false]] as const) {
    const f = fixture(async (_url, init) => init?.method === "POST" ? Response.json({ ok: false, error }, { status }) : Response.json(initial()));
    await f.client.initialize(); await f.client.refresh(); await f.client.submit(null); assert.equal(!!f.saved.getItem(key), keep);
  }
  const saved = storage(); saved.setItem(key, JSON.stringify(pending())); const raw = saved.getItem(key);
  const retry = fixture(async (_url, init) => init?.method === "POST" ? Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 403 }) : Response.json(initial()), { storage: () => saved });
  await retry.client.initialize(); await retry.client.retry(); assert.equal(saved.getItem(key), raw);
});
test("corrupt/unavailable storage fails closed without overwriting or network", async () => {
  for (const raw of ["{", JSON.stringify({ ...pending(), employeeId: id(900) }), '{"version":1,"version":1}', " ".repeat(4097)]) {
    const f = fixture(); f.saved.setItem(key, raw); await f.client.initialize(); await f.client.refresh(); await f.client.submit(null);
    assert.equal(f.calls.length, 0); assert.equal(f.saved.getItem(key), raw); assert.equal(f.client.getSnapshot().phase, "storage_error"); assert(f.client.blocksOtherActions());
  }
  const f = fixture(undefined, { storage: () => { throw Error("denied"); } }); await f.client.initialize(); assert.equal(f.calls.length, 0); assert(f.client.blocksOtherActions());
});
test("storage substitution before POST or receipt settlement is never overwritten/removed", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.refresh(); f.saved.setItem(key, "other"); await f.client.submit(null);
  assert.equal(f.calls.length, 1); assert.equal(f.saved.getItem(key), "other");
  const held = deferred<Response>(); const g = fixture(async (_url, init) => init?.method === "POST" ? held.promise : Response.json(initial()));
  await g.client.initialize(); await g.client.refresh(); const work = g.client.submit(null); g.saved.setItem(key, "replacement"); held.resolve(Response.json(committed())); await work;
  assert.equal(g.saved.getItem(key), "replacement"); assert.equal(g.client.getSnapshot().phase, "storage_error");
});
test("failed persistence/readback/removal blocks completion and does not erase unrelated storage", async () => {
  const saved = storage(); saved.setItem("unrelated", "keep"); const f = fixture(undefined, { storage: () => ({ ...saved, setItem() { throw Error("full"); } }) });
  await f.client.initialize(); await f.client.refresh(); await f.client.submit(null); assert.equal(f.calls.length, 1); assert(f.client.getSnapshot().pending);
  const g = fixture(async (_url, init) => Response.json(init?.method === "POST" ? committed() : initial()), { storage: () => ({ ...saved, removeItem() { throw Error("blocked"); } }) });
  await g.client.initialize(); await g.client.refresh(); await g.client.submit(null); assert.equal(g.client.getSnapshot().phase, "storage_error"); assert(saved.getItem(key)); assert.equal(saved.getItem("unrelated"), "keep");
});
test("synchronous loading/submitting observers may pause without a late request or unsafe pending loss", async () => {
  const f = fixture(); await f.client.initialize(); f.client.subscribe(() => { if (f.client.getSnapshot().phase === "loading") f.client.pause(); });
  await f.client.refresh(); assert.equal(f.calls.length, 0);
  const g = fixture(); await g.client.initialize(); await g.client.refresh(); g.client.subscribe(() => { if (g.client.getSnapshot().phase === "submitting") g.client.pause(); });
  await g.client.submit(null); assert.equal(g.calls.length, 1); assert(g.saved.getItem(key)); assert.equal(g.client.getSnapshot().result, null);
});
test("randomId/storage callback reentrancy cannot send after pause", async () => {
  const f = fixture(undefined, { randomId: () => { f.client.pause(); return id(10); } });
  await f.client.initialize(); await f.client.refresh(); await f.client.submit(null); assert.equal(f.calls.length, 1); assert.equal(f.saved.getItem(key), null);
  const saved = storage(); let pauseWrite = false; const g = fixture(undefined, { storage: () => ({ ...saved, setItem(k, v) { saved.setItem(k, v); if (pauseWrite) g.client.pause(); } }) });
  await g.client.initialize(); await g.client.refresh(); pauseWrite = true; await g.client.submit(null); assert.equal(g.calls.length, 1); assert(saved.getItem(key));
});
test("double calls and held committed response do not duplicate POST or revive paused data", async () => {
  const held = deferred<Response>(); const f = fixture(async (_url, init) => init?.method === "POST" ? held.promise : Response.json(initial()));
  await f.client.initialize(); await f.client.refresh(); const work = f.client.submit(null); await f.client.submit(selection); await f.client.retry();
  assert.equal(f.calls.length, 2); const raw = f.saved.getItem(key); f.client.pause(); held.resolve(Response.json(committed())); await work;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.saved.getItem(key), raw);
});
test("one total timeout includes a delayed body and retains pending without automatic retry", async () => {
  const f = fixture(async (_url, init) => init?.method === "POST" ? new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }) : Response.json(initial()), { timeoutMs: 20 });
  await f.client.initialize(); await f.client.refresh(); await f.client.submit(null); assert.equal(f.calls.length, 2); assert(f.saved.getItem(key)); assert.equal(f.client.getSnapshot().result, null);
});
test("strict transport rejects duplicate keys, non-JSON, invalid UTF8, oversize and wrong error statuses", async () => {
  const replies = [() => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } }),
    () => Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 400 }),
    () => Response.json(initial(), { status: 201 })];
  for (const response of replies) { const f = fixture(async () => response()); await f.client.initialize(); await f.client.refresh(); await f.client.submit(null);
    assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.saved.getItem(key), null); }
});
test("receipt identity/selection mismatch is never trusted to clear an uncertain intent", async () => {
  for (const expected of [null, selection]) {
    const saved = storage(), raw = JSON.stringify(pending(expected)); saved.setItem(key, raw);
    // Both replies are structurally valid by themselves. Only comparison with
    // the restored intent detects a wrong selection, including explicit null.
    const bad = committed(expected === null ? selection : null);
    const f = fixture(async () => Response.json(bad), { storage: () => saved }); await f.client.initialize(); await f.client.refresh();
    assert.equal(saved.getItem(key), raw); assert.equal(f.client.getSnapshot().result, null);
  }
});
test("options/pending/results are detached and frozen; pending parser rejects shape/identity surprises", async () => {
  const f = fixture(); f.options.enabled = false; await f.client.initialize(); await f.client.refresh(); assert.equal(f.calls.length, 1);
  assert(Object.isFrozen(f.client.getSnapshot())); assert(Object.isFrozen(f.client.getSnapshot().result!.choices.entries[0]));
  const parsed = parseSelfSchedulePending(JSON.stringify(pending(selection)), siteId, employeeId); assert(Object.isFrozen(parsed.command)); assert(Object.isFrozen(parsed.selection));
  for (const value of [{ ...pending(), extra: 1 }, { ...pending(), selection: { ...selection, currentAuth: id(3) } }, { ...pending(), command: { ...command, action: "clock_out" } }]) {
    assert.throws(() => parseSelfSchedulePending(JSON.stringify(value), siteId, employeeId));
  }
});
test("an explicit authorized recent clock-in number reads only that receipt without creating storage or POST", async () => {
  const f = fixture(async () => Response.json(committed(selection))); await f.client.initialize(); await f.client.refresh(command.operationId);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, "GET"); assert(f.calls[0].url.includes(command.operationId));
  assert.equal(f.saved.entries.size, 0); assert.equal(f.client.getSnapshot().result?.association?.status, "linked");
  const saved = storage(), raw = JSON.stringify(pending()); saved.setItem(key, raw); const g = fixture(undefined, { storage: () => saved });
  await g.client.initialize(); await g.client.refresh(id(99)); assert.equal(g.calls.length, 0); assert.equal(saved.getItem(key), raw);
});
test("late explicit receipt read cannot revive an old employee controller after identity replacement", async () => {
  const held = deferred<Response>(), old = fixture(async () => held.promise); await old.client.initialize(); const work = old.client.refresh(command.operationId);
  old.client.pause(); const next = fixture(undefined, { employeeId: id(501) }); await next.client.initialize(); held.resolve(Response.json(committed(selection))); await work;
  assert.equal(old.client.getSnapshot().result, null); assert.equal(next.client.getSnapshot().result, null); assert.equal(next.calls.length, 0);
});
