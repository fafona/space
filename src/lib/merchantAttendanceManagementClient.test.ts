import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceScopeClient, AttendanceRecordsClient, attendanceManagementRequest, attendanceRecordsDateQuery, attendanceRecordsQueryString } from "./merchantAttendanceManagementClient";
import { parseAttendanceScopeCommand, type AttendanceScopeCommand, type AttendanceRecordsQuery } from "./merchantAttendanceManagement";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { AttendanceManagementGrant } from "./merchantAttendanceScope";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(2), ownerId = id(1);
const grant = { workerIds: [id(3)], locationIds: [id(4)], validFrom: "2026-01-01T00:00:00.000Z", validUntil: null };
const change = { action: "put" as const, grantId: id(5), grant };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function setupScope() {
  const saved = new Map<string, string>();
  const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, v); }, removeItem: (k: string) => { saved.delete(k); } };
  const calls: { url: string; command: AttendanceScopeCommand | null }[] = [];
  let revision = 0, moduleEnabled = true, lose = false, error: string | null = null, receipts = true;
  let receipt: { operationId: string; revision: number; action: string; grantId: string } | null = null;
  let grants: AttendanceManagementGrant[] = [];
  const fetch: AttendanceApiFetch = async (url, init) => {
    const u = new URL(url, "https://local.invalid");
    const command = init?.method === "POST" ? parseAttendanceScopeCommand(JSON.parse(String(init.body))).command : null;
    calls.push({ url, command });
    if (error) return json({ ok: false, error }, 403);
    if (command) {
      assert.ok([...saved.values()].some(v => v.includes(command.operationId)), "intent persisted before POST");
      if (command.operationId !== receipt?.operationId) { revision++; receipt = { operationId: command.operationId, revision, action: command.action, grantId: command.grantId };
        grants = command.action === "put" ? [{ id: command.grantId, ...command.grant! }] : []; }
      if (lose) throw Error("lost");
    }
    return json({ ok: true, moduleEnabled, scope: { siteId, employeeId: command ? employeeId : u.searchParams.get("employeeId"), revision, grants },
      receipt: receipts && receipt && (command?.operationId ?? u.searchParams.get("operationId")) === receipt.operationId ? receipt : null });
  };
  const options = { siteId, ownerId, apiFetch: fetch, storage: () => storage, randomId: () => id(99) };
  return { client: new AttendanceScopeClient(options), options, calls, storage, saved,
    pause: () => { moduleEnabled = false; }, lose: () => { lose = true; }, deny: () => { error = "attendance_access_denied"; },
    hideReceipt: () => { receipts = false; }, version: (v: number) => { revision = v; } };
}
test("scope selection is read only and success clears persisted intent once receipt matches", async () => {
  const s = setupScope(); await s.client.initialize(); assert.equal(s.calls.length, 0); await s.client.select(employeeId);
  assert.equal(await s.client.submit(change, 0), true); assert.equal(s.saved.size, 0); assert.equal(s.client.getSnapshot().result?.scope.revision, 1);
  assert.equal(s.calls.filter(c => c.command).length, 1);
});
test("response loss restores original employee on remount and confirms with GET, no second POST", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId); s.lose();
  assert.equal(await s.client.submit(change, 0), false); assert.equal(s.client.getSnapshot().phase, "unconfirmed");
  await s.client.select(id(8)); assert.equal(s.client.getSnapshot().employeeId, employeeId);
  s.client.dispose(); const next = new AttendanceScopeClient(s.options); await next.initialize();
  assert.equal(next.getSnapshot().employeeId, employeeId); assert.equal(next.getSnapshot().phase, "ready"); assert.equal(s.saved.size, 0);
  assert.equal(s.calls.filter(c => c.command).length, 1);
});
test("retry rejection after uncertain POST retains the original pending intent", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId); s.lose(); await s.client.submit(change, 0); s.deny();
  await s.client.retry(); assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.equal(s.saved.size, 1);
  assert.equal(s.calls.filter(c => c.command).length, 2); assert.deepEqual(s.calls.at(-1)?.command, s.calls[1].command);
});
test("first authoritative denial clears intent, and target may change after failure", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId); s.deny();
  await s.client.submit(change, 0); assert.equal(s.saved.size, 0); assert.equal(s.client.getSnapshot().phase, "blocked");
  await s.client.select(id(8)); assert.equal(s.client.getSnapshot().employeeId, id(8));
});
test("no receipt plus strictly newer scope fences old command, equal revision does not", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId); s.lose(); await s.client.submit(change, 0); s.hideReceipt(); s.version(0);
  await s.client.load(); assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.equal(s.saved.size, 1);
  s.version(1); await s.client.load(); assert.equal(s.client.getSnapshot().phase, "ready"); assert.equal(s.saved.size, 0);
});
test("pause permits explicit revoke but cannot create or replace authorization", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId); s.pause(); await s.client.load();
  assert.equal(await s.client.submit(change, 0), false); assert.equal(s.calls.filter(c => c.command).length, 0);
  assert.equal(await s.client.submit({ action: "remove", grantId: id(5), grant: null }, 0), true);
});
test("storage failure refuses POST, malformed pending is not silently discarded", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId);
  s.storage.setItem = () => { throw Error("storage_disabled"); };
  await s.client.submit(change, 0); assert.equal(s.calls.filter(c => c.command).length, 0);
  s.saved.set(s.client.storageKey, "broken"); await s.client.initialize(); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.saved.size, 1);
});
test("pending cannot be transplanted across owner/company or hide additional command fields", async () => {
  for (const patch of [{ ownerId: id(7) }, { siteId: "99990002" }, { command: { ...change, operationId: id(99), expectedRevision: 0, siteId } }]) {
    const s = setupScope(); s.saved.set(s.client.storageKey, JSON.stringify({ siteId, ownerId, employeeId, command: { ...change, operationId: id(99), expectedRevision: 0 }, ...patch }));
    await s.client.initialize(); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.calls.length, 0);
  }
});
test("client disposal prevents a late receipt from clearing intent or reviving UI", async () => {
  const s = setupScope(); let release!: () => void;
  const fetch: AttendanceApiFetch = async (url, init) => { const r = await s.options.apiFetch(url, init); if (init?.method === "POST") await new Promise<void>(r => { release = r; }); return r; };
  const c = new AttendanceScopeClient({ ...s.options, apiFetch: fetch }); await c.initialize(); await c.select(employeeId);
  const saving = c.submit(change, 0); while (!release) await new Promise(r => setImmediate(r));
  c.dispose(); release(); await saving; assert.equal(s.saved.size, 1);
  await c.initialize(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(s.saved.size, 0);
});
test("rapid duplicate submit is fenced and wrong receipt cannot clear the command", async () => {
  const s = setupScope(); let release!: () => void;
  const fetch: AttendanceApiFetch = async (url, init) => {
    const response = await s.options.apiFetch(url, init);
    if (init?.method !== "POST") return response;
    await new Promise<void>(r => { release = r; });
    const body = await response.json(); body.receipt.grantId = id(77); return json(body);
  };
  const c = new AttendanceScopeClient({ ...s.options, apiFetch: fetch }); await c.initialize(); await c.select(employeeId);
  const first = c.submit(change, 0); while (!release) await new Promise(r => setImmediate(r));
  assert.equal(await c.submit(change, 0), false); release(); await first;
  assert.equal(s.calls.filter(c => c.command).length, 1); assert.equal(s.saved.size, 1); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
test("identities use separate intent keys and invalid input never creates an operation", async () => {
  const s = setupScope(); await s.client.initialize(); await s.client.select(employeeId);
  const other = new AttendanceScopeClient({ ...s.options, ownerId: id(70) }); assert.notEqual(other.storageKey, s.client.storageKey);
  assert.equal(await s.client.submit({ ...change, grant: { ...grant, workerIds: ["*"] } }, 0), false);
  assert.equal(s.saved.size, 0); assert.equal(s.calls.filter(c => c.command).length, 0); assert.equal(s.client.getSnapshot().phase, "ready");
});
test("oversized full scope still fits explicit 512KiB bound, not the 16KiB command limit", async () => {
  const payload = { ok: true, moduleEnabled: true, padding: "x".repeat(330000) };
  assert.ok(await attendanceManagementRequest(async () => json(payload), "/synthetic", {}, { maxBytes: 524288 }));
  await assert.rejects(attendanceManagementRequest(async () => json(payload), "/synthetic"), /oversized_response/);
});
for (const bad of [() => new Response("login", { headers: { "content-type": "text/html" } }),
  () => json({ ok: true }), () => json({ ok: true, moduleEnabled: "true" }), () => json({ ok: false, error: "toString" }, 403)])
  test("transport rejects malformed, HTML or prototype error responses", async () => { await assert.rejects(attendanceManagementRequest(async () => bad(), "/synthetic")); });
test("response-body timeout cancels the stream and does not leave the read pending", async () => {
  let cancelled = false;
  const r = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
  await assert.rejects(attendanceManagementRequest(async () => r, "/synthetic", {}, { timeoutMs: 10 }), /timeout/);
  assert.equal(cancelled, true);
});
test("date range is explicit IANA, DST-aware, calendar-bounded and strict", () => {
  const spring = attendanceRecordsDateQuery(siteId, "manager", "2026-03-29", "2026-03-29", "Europe/Madrid");
  assert.equal(Date.parse(spring.toAt) - Date.parse(spring.fromAt), 23 * 3600000);
  const autumn = attendanceRecordsDateQuery(siteId, "owner", "2026-10-25", "2026-10-25", "Europe/Madrid");
  assert.equal(Date.parse(autumn.toAt) - Date.parse(autumn.fromAt), 25 * 3600000);
  assert.ok(attendanceRecordsDateQuery(siteId, "owner", "2026-10-01", "2026-10-30", "Europe/Madrid"));
  for (const [from, to, zone] of [["2026-10-01", "2026-10-31", "UTC"], ["2026-02-30", "2026-03-01", "UTC"], ["2026-01-01", "2026-01-01", "+01:00"], ["2011-12-30", "2011-12-30", "Pacific/Apia"]])
    assert.throws(() => attendanceRecordsDateQuery(siteId, "owner", from, to, zone));
});
const rq = attendanceRecordsDateQuery(siteId, "manager", "2026-09-01", "2026-09-02", "UTC");
const rows = Array.from({ length: 50 }, (_, n) => ({ id: id(1000 - n), workerId: id(3), locationId: id(4), workerName: "合成人员", workerNo: "T1", locationName: "合成地点",
  sequence: 1000 - n, action: "clock_in", source: "web", timeZone: "UTC", breakPaid: null, occurredAt: `2026-09-01T12:00:00.${String(999999 - n).padStart(6, "0")}Z` }));
const records = (items = rows) => ({ ok: true, moduleEnabled: true, siteId, access: "manager", scopeRevision: 1, asOf: "2026-09-03T00:00:00.000000Z", items,
  nextCursor: items.length === 50 ? { id: items.at(-1)!.id, occurredAt: items.at(-1)!.occurredAt } : null });
test("paging sends exact microsecond cursor and clears visible rows before denial", async () => {
  const urls: string[] = []; let denied = false;
  const c = new AttendanceRecordsClient({ siteId, access: "manager", apiFetch: async url => { urls.push(url); return denied ? json({ ok: false, error: "attendance_access_denied" }, 403) : json(records()); } });
  await c.load(rq); assert.equal(c.getSnapshot().result?.items.length, 50); denied = true;
  const next = c.next(); assert.equal(c.getSnapshot().result, null); await next; assert.equal(c.getSnapshot().phase, "blocked");
  assert.equal(new URL(urls[1], "https://local.invalid").searchParams.get("cursorAt"), rows.at(-1)!.occurredAt);
});
test("record queries cannot promote access or switch tenant and never post", async () => {
  let called = 0;
  const c = new AttendanceRecordsClient({ siteId, access: "manager", apiFetch: async () => { called++; return json(records()); } });
  for (const patch of [{ access: "owner" as const }, { siteId: "99990002" }]) { await c.load({ ...rq, ...patch }); assert.equal(c.getSnapshot().phase, "blocked"); }
  assert.equal(called, 0);
  await c.refresh(); assert.equal(called, 0);
});
test("old delayed page cannot replace newer page or reappear after hiding", async () => {
  let release!: (value: Response) => void, n = 0;
  const c = new AttendanceRecordsClient({ siteId, access: "manager", apiFetch: async () => ++n === 1 ? new Promise<Response>(r => { release = r; }) : json(records([])) });
  const old = c.load(rq); await c.load(rq); assert.equal(c.getSnapshot().result?.items.length, 0);
  release(json(records())); await old; assert.equal(c.getSnapshot().result?.items.length, 0);
  c.invalidate(); assert.equal(c.getSnapshot().result, null); await c.refresh(); assert.equal(c.getSnapshot().phase, "ready");
});
test("query serializer preserves 6-digit timestamps and only omits nulls", () => {
  const q: AttendanceRecordsQuery = { ...rq, asOf: records().asOf, cursorAt: rows[0].occurredAt, cursorId: rows[0].id };
  assert.equal(new URLSearchParams(attendanceRecordsQueryString(q)).get("cursorAt"), rows[0].occurredAt);
  assert.equal(new URLSearchParams(attendanceRecordsQueryString(q)).has("workerId"), false);
});
