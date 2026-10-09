import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationPolicyClient } from "./merchantAttendanceLocationPolicyClient";
import { parseAttendanceLocationPolicyCommand, type AttendanceLocationPolicyResult } from "./merchantAttendanceLocationPolicy";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(1), locationId = id(2), at = "2026-09-30T12:00:00.000Z";
const values = { purpose: "Synthetic", notice: "Draft notice", contact: "Owner", alternative: "Manual review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
const expected = { revision: 0, settingsVersion: 1, locationVersion: 1 };
function fixture() {
  const memory = new Map<string, string>(), storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  const result: AttendanceLocationPolicyResult = { siteId, locationId, draftOnly: true, settingsVersion: 1, location: { name: "Synthetic", active: true, version: 1 }, current: null, previous: null, receipt: null };
  let mode = "normal", writes = 0, moduleEnabled = true;
  const requests: { method: string; body: string | null }[] = [], receipts = new Map<string, { revision: number; recordedAt: string; operationId: string }>();
  const fetch: AttendanceApiFetch = async (url, init) => {
    const method = init?.method ?? "GET"; requests.push({ method, body: init?.body ? String(init.body) : null });
    if (mode === "offline" || method === "POST" && mode === "unsent") throw Error("synthetic_network");
    if (mode === "timeout" || method === "POST" && mode === "post_timeout") return new Promise<Response>(() => {});
    if (mode === "denied") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
    let operationId = new URL(String(url), "http://fixture.test").searchParams.get("operationId");
    if (method === "POST") {
      const { command } = parseAttendanceLocationPolicyCommand(JSON.parse(String(init?.body))); operationId = command.operationId;
      if (mode === "reject") return Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
      if (!receipts.has(operationId)) {
        writes++; result.previous = result.current;
        result.current = { revision: command.expectedRevision + 1, recordedAt: at, settingsVersion: 1, locationVersion: 1, values: command.values };
        receipts.set(operationId, { revision: result.current.revision, recordedAt: at, operationId });
      }
      if (mode === "lost") throw Error("response_lost");
    }
    return Response.json({ ...result, ...(mode === "wrong_site" ? { siteId: "99990002" } : {}), receipt: operationId ? receipts.get(operationId) ?? null : null, ok: true, moduleEnabled });
  };
  const create = (overrides: Partial<ConstructorParameters<typeof AttendanceLocationPolicyClient>[0]> = {}) => new AttendanceLocationPolicyClient({ siteId, ownerId, locationId, apiFetch: fetch, storage: () => storage, randomId: () => id(3), timeoutMs: 35, ...overrides });
  return { create, result, requests, memory, storage, mode: (v: string) => { mode = v; }, enabled: (v: boolean) => { moduleEnabled = v; }, writes: () => writes };
}
test("constructing is inert; initialization reads only; save persists before POST and clears only after receipt", async () => {
  const f = fixture(), c = f.create(); assert.equal(f.requests.length, 0); await c.initialize();
  assert.deepEqual(f.requests.map(r => r.method), ["GET"]); assert.equal(c.getSnapshot().phase, "ready");
  await c.submit(values, expected); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(f.writes(), 1); assert.equal(f.memory.size, 0); assert.equal(c.getSnapshot().result?.current?.revision, 1);
});
test("lost response and remount recover original receipt with GET and no automatic repost", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("lost"); await c.submit(values, expected);
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.size, 1); assert.equal(f.writes(), 1);
  const count = f.requests.length; const restored = f.create(); await restored.initialize();
  assert.deepEqual(f.requests.slice(count).map(r => r.method), ["GET"]); assert.equal(restored.getSnapshot().phase, "ready"); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});
test("explicit retry of undelivered write reads receipt then uses identical original command", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("unsent"); await c.submit(values, expected);
  const original = f.requests.at(-1)?.body; f.mode("normal"); await c.retry();
  assert.deepEqual(f.requests.slice(-2).map(r => r.method), ["GET", "POST"]); assert.equal(f.requests.at(-1)?.body, original); assert.equal(f.writes(), 1);
});
test("explicit retry discovers already committed result without an additional POST", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("lost"); await c.submit(values, expected); const n = f.requests.length;
  await c.retry(); assert.deepEqual(f.requests.slice(n).map(r => r.method), ["GET"]); assert.equal(f.writes(), 1);
});
test("GET error while recovering preserves pending and cannot trigger POST", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("unsent"); await c.submit(values, expected); f.mode("denied"); const n = f.requests.length;
  await c.retry(); assert.deepEqual(f.requests.slice(n).map(r => r.method), ["GET"]); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null);
});
test("changed settings fence without old receipt safely invalidates old request", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("unsent"); await c.submit(values, expected); f.mode("normal"); f.result.settingsVersion++;
  const n = f.requests.length; await c.initialize();
  assert.deepEqual(f.requests.slice(n).map(r => r.method), ["GET"]); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(c.getSnapshot().result?.settingsVersion, expected.settingsVersion + 1); assert.equal(c.getSnapshot().result?.location.version, expected.locationVersion);
  assert.equal(c.getSnapshot().result?.current, null); assert.equal(c.getSnapshot().result?.receipt, null);
  assert.equal(c.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 0);
  await c.retry(); assert.equal(f.requests.length, n + 1); assert.equal(f.writes(), 0);
});
test("first definitive refusal clears intent, but an uncertain old submission is not cleared on retry refusal", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("reject"); await c.submit(values, expected); assert.equal(c.getSnapshot().pending, null);
  f.mode("normal"); await c.initialize(); f.mode("unsent"); await c.submit(values, expected); f.mode("reject"); await c.retry(); assert.ok(c.getSnapshot().pending);
});
test("pause after sending retains pending and late response cannot revive private result", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.mode("post_timeout"); const saving = c.submit(values, expected);
  await new Promise(resolve => setImmediate(resolve)); c.pause(); await saving;
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(c.getSnapshot().pending);
  f.mode("normal"); await c.initialize(); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
test("deadline covers never-returning headers and prevents parallel writes", async () => {
  const f = fixture(), c = f.create(); f.mode("timeout"); await c.initialize(); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(c.getSnapshot().result, null);
  f.mode("normal"); await c.initialize(); f.mode("post_timeout"); await Promise.all([c.submit(values, expected), c.submit(values, expected)]);
  assert.equal(f.requests.filter(r => r.method === "POST").length, 1); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
test("paused entitlement or inactive location permits read but no new save", async () => {
  for (const kind of ["platform", "location"]) {
    const f = fixture(), c = f.create(); if (kind === "platform") f.enabled(false); else f.result.location.active = false;
    await c.initialize(); await c.submit(values, expected); assert.equal(f.requests.length, 1); assert.equal(f.memory.size, 0);
  }
});
test("storage failures, foreign pending and competing operation never cause a write or deletion", async () => {
  const f = fixture(), c = f.create(); f.memory.set(c.storageKey, JSON.stringify({ ownerId: id(9) })); await c.initialize(); assert.equal(f.requests.length, 0); assert.equal(f.memory.size, 1);
  f.memory.clear(); const bad = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("denied"); } }) }); await bad.initialize(); await bad.submit(values, expected); assert.equal(f.requests.filter(r => r.method === "POST").length, 0);
  await c.initialize(); f.mode("unsent"); await c.submit(values, expected); const raw = JSON.parse(f.memory.get(c.storageKey)!); raw.command.operationId = id(9); f.memory.set(c.storageKey, JSON.stringify(raw));
  const n = f.requests.length; await c.retry(); assert.equal(f.requests.length, n); assert.equal(JSON.parse(f.memory.get(c.storageKey)!).command.operationId, id(9));
});
test("wrong tenant responses and oversized drafts fail closed without accepting old data", async () => {
  const f = fixture(), c = f.create(); f.mode("wrong_site"); await c.initialize(); assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "blocked");
  f.mode("normal"); await c.initialize(); await c.submit({ ...values, notice: "x".repeat(401) }, expected); assert.equal(f.writes(), 0); assert.equal(f.memory.size, 0);
});
