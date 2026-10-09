import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { AttendanceOnsiteScheduleClient, onsiteSchedulePendingKey, parseOnsiteSchedulePending, type OnsiteScheduleStorage } from "./merchantAttendanceOnsiteScheduleClient";
import { onsiteClockPendingKey } from "./merchantAttendanceOnsiteClockClient";
import { parseOnsiteScheduleBody } from "./merchantAttendanceOnsiteSchedule";
import { onsiteScheduleActor as authUserId, onsiteScheduleEmployee as employeeId, onsiteScheduleSite as siteId, onsiteScheduleId as id,
  onsiteScheduleCommand, onsiteScheduleHttp, onsiteScheduleToken, onsiteScheduleClaims, onsiteScheduleSelection as selection } from "../../scripts/fixtures/attendance-onsite-schedule-model";
const key = onsiteSchedulePendingKey(siteId, authUserId), clients = new Set<AttendanceOnsiteScheduleClient>();
afterEach(() => { for (const c of clients) c.pause(); clients.clear(); });
const pending = () => ({ version: 1, siteId, authUserId, command: onsiteScheduleCommand(), selection: { ...selection } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function harness(initial?: string) {
  const values = new Map<string, string>(initial ? [[key, initial]] : []), calls: { method: string; url: string; body?: unknown }[] = [];
  let now = onsiteScheduleClaims().issuedAtMs + 1000, canStart = true, record: ReturnType<typeof onsiteScheduleHttp> | null = null, nowHook: (() => void) | null = null;
  let getHook: (() => Promise<Response> | Response) | null = null, postHook: ((r: ReturnType<typeof onsiteScheduleHttp>) => Promise<Response> | Response) | null = null, storageHook: (() => void) | null = null;
  const storage: OnsiteScheduleStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); storageHook?.(); }, removeItem: k => { values.delete(k); } };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ method, url, body });
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.ok(!url.includes("aq1.")); assert.ok(!url.includes("nonce"));
    if (method === "GET") {
      if (getHook) return getHook();
      if (record && new URL(url, "https://example.test").searchParams.get("operationId") === record.clock.receipt!.operationId) return reply(record);
      const r = onsiteScheduleHttp(); if (record) { r.clock.state = structuredClone(record.clock.state); r.choices.entries = []; } return reply(r);
    }
    assert.equal(url, "/api/merchant-enterprise/attendance/onsite-schedule"); const parsed = parseOnsiteScheduleBody(body);
    const durable = values.get(key); assert.ok(durable); assert.ok(!/aq1\.|nonce|token|claims/.test(durable));
    const r = onsiteScheduleHttp(true), op = parsed.command.operationId;
    r.clock.receipt!.operationId = op; r.clock.state.lastEvent!.operationId = op; r.association!.operationId = op; r.adoption!.operationId = op;
    r.association!.selection = parsed.selection;
    if (parsed.selection === null) { r.association!.status = "unselected"; r.association!.slot = null; r.association!.currentCancelled = null; r.adoption!.status = "unselected"; r.adoption!.approval = null; }
    if (postHook) return postHook(r); record = structuredClone(r); return reply(r);
  };
  const create = (enabled = true, timeoutMs = 1000) => { const c = new AttendanceOnsiteScheduleClient({ siteId, authUserId, enabled, apiFetch, storage: () => storage,
    randomId: () => id(5), now: () => { nowHook?.(); return now; }, timeoutMs, canStart: () => canStart }); clients.add(c); return c; };
  return { values, calls, storage, create, set getHook(v: typeof getHook) { getHook = v; }, set postHook(v: typeof postHook) { postHook = v; },
    set storageHook(v: typeof storageHook) { storageHook = v; }, set nowHook(v: typeof nowHook) { nowHook = v; }, set now(v: number) { now = v; }, set canStart(v: boolean) { canStart = v; }, commit: (r: ReturnType<typeof onsiteScheduleHttp>) => { record = structuredClone(r); } };
}
async function ready(h: ReturnType<typeof harness>, code = true) { const c = h.create(); await c.initialize(); await c.read(); assert.equal(c.getSnapshot().phase, "ready"); if (code) assert.equal(c.setCode(onsiteScheduleToken()), true); return c; }
test("local initialize and disabled fresh read make no HTTP or QR claim", async () => {
  const h = harness(), c = h.create(); await c.initialize(); assert.equal(h.calls.length, 0); assert.equal(c.getSnapshot().code, null);
  const off = h.create(false); await off.initialize(); await off.read(); assert.equal(h.calls.length, 0); assert.equal(off.setCode(onsiteScheduleToken()), false);
});
test("explicit default-location candidate GET needs no token and cannot submit without one", async () => {
  const h = harness(), c = await ready(h, false); assert.equal(h.calls.length, 1); await c.submit(selection); assert.equal(h.calls.length, 1); assert.equal(h.values.size, 0);
});
test("selected submit preflights, persists only exact intent, consumes code then saves both sidecars", async () => {
  const h = harness(), c = await ready(h); await c.submit(selection); assert.deepEqual(h.calls.map(x => x.method), ["GET", "GET", "POST"]);
  assert.equal(c.getSnapshot().result?.adoption?.status, "adopted"); assert.equal(c.getSnapshot().code, null); assert.equal(h.values.has(key), false); assert.equal(c.blocksOtherActions(), false);
});
test("explicit none remains unselected and QR is never in snapshots or storage", async () => {
  const h = harness(), c = await ready(h); assert.ok(!/aq1\.|nonce|signature/.test(JSON.stringify(c.getSnapshot()))); await c.submit(null);
  assert.equal(c.getSnapshot().result?.association?.status, "unselected"); assert.equal(c.getSnapshot().result?.adoption?.status, "unselected");
});
test("lost committed POST reload discovers locally; feature-off explicit GET settles without new token/POST", async () => {
  const h = harness(), c = await ready(h); h.postHook = r => { h.commit(r); throw Error("lost"); }; await c.submit(selection); assert.ok(h.values.get(key));
  const count = h.calls.length, off = h.create(false); await off.initialize(); await off.retry(); assert.equal(h.calls.length, count);
  await off.read(); assert.equal(off.getSnapshot().result?.association?.status, "linked"); assert.equal(h.values.has(key), false); assert.equal(h.calls.filter(x => x.method === "POST").length, 1);
});
test("unknown same-sequence result preserves choice; explicit retry requires fresh QR and GET first", async () => {
  const h = harness(), c = await ready(h); h.postHook = () => { throw Error("undelivered"); }; await c.submit(selection); const raw = h.values.get(key);
  await c.read(); assert.equal(h.values.get(key), raw); const count = h.calls.length; await c.retry(); assert.equal(h.calls.length, count);
  h.postHook = null; assert.equal(c.setCode(onsiteScheduleToken({ ...onsiteScheduleClaims(), nonce: id(12) })), true); await c.retry();
  assert.equal(h.calls.at(-2)?.method, "GET"); assert.equal(h.calls.filter(x => x.method === "POST").length, 2);
  const posts = h.calls.filter(x => x.method === "POST").map(x => parseOnsiteScheduleBody(x.body)); assert.deepEqual(posts[0].command, posts[1].command); assert.deepEqual(posts[0].selection, posts[1].selection); assert.notEqual(posts[0].token, posts[1].token);
});
test("strict pending scopes principal/site, rejects duplicate keys/token/other actions and detaches", () => {
  const raw = JSON.stringify(pending()); assert.ok(Object.isFrozen(parseOnsiteSchedulePending(raw, siteId, authUserId).command));
  assert.throws(() => parseOnsiteSchedulePending(raw, siteId, id(99))); assert.throws(() => parseOnsiteSchedulePending(raw.replace('"version":1', '"version":1,"version":1'), siteId, authUserId));
  for (const p of [{ ...pending(), token: onsiteScheduleToken() }, { ...pending(), command: { ...onsiteScheduleCommand(), action: "clock_out" } }, { ...pending(), selection: { ...selection, extra: true } }])
    assert.throws(() => parseOnsiteSchedulePending(JSON.stringify(p), siteId, authUserId));
});
test("bad pending blocks without replacing or issuing HTTP", async () => {
  const h = harness("{}"), c = h.create(); await c.initialize(); await c.read(); assert.equal(c.getSnapshot().phase, "storage_error"); assert.equal(h.calls.length, 0); assert.equal(h.values.get(key), "{}");
});
test("old onsite and known employee self/location/notice pending block a new operation", async () => {
  for (const k of [onsiteClockPendingKey(siteId, authUserId), ...["self", "self-schedule", "self-schedule-adoption", "location-clock", "location-schedule"].map(name => `faolla:attendance:${name}:v1:${siteId}:${employeeId}`), `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`]) {
    const h = harness(), c = await ready(h); h.values.set(k, "opaque"); await c.submit(selection); assert.equal(h.calls.length, 1); assert.equal(h.values.get(k), "opaque");
  }
});
test("expired or wrong-site/location code cannot authorize a submit", async () => {
  const h = harness(), c = await ready(h, false);
  for (const claims of [{ ...onsiteScheduleClaims(), siteId: "99990002" }, { ...onsiteScheduleClaims(), locationId: id(88) }]) assert.equal(c.setCode(onsiteScheduleToken(claims)), false);
  h.now = onsiteScheduleClaims().expiresAtMs; assert.equal(c.setCode(onsiteScheduleToken()), false); assert.equal(h.calls.length, 1);
});
test("setCode clear notification cannot resurrect capability after synchronous pause", async () => {
  const h = harness(), c = await ready(h, false); let once = false, paused = c.getSnapshot();
  c.subscribe(() => { if (!once) { once = true; c.pause(); paused = c.getSnapshot(); } });
  assert.equal(c.setCode(onsiteScheduleToken()), false); assert.equal(c.getSnapshot(), paused); assert.equal(c.getSnapshot().code, null);
  await c.submit(selection); assert.equal(h.calls.length, 1); assert.equal(h.values.size, 0);
});
test("setCode injected clock callback cannot restore code or overwrite pause message", async () => {
  const h = harness(), c = await ready(h, false); let once = false, paused = c.getSnapshot();
  h.nowHook = () => { if (!once) { once = true; c.pause(); paused = c.getSnapshot(); } };
  assert.equal(c.setCode(onsiteScheduleToken()), false); assert.equal(c.getSnapshot(), paused); assert.equal(c.getSnapshot().code, null);
});
test("starting a later read cannot extend the private QR expiry timer", async () => {
  const h = harness(), c = await ready(h, false); h.now = onsiteScheduleClaims().expiresAtMs - 5;
  assert.equal(c.setCode(onsiteScheduleToken()), true);
  let release: (r: Response) => void = () => {};
  h.getHook = () => new Promise(resolve => { release = resolve; });
  const expired = new Promise<void>(resolve => { c.subscribe(() => { if (c.getSnapshot().code === null) resolve(); }); });
  const read = c.read(); await expired; assert.equal(c.getSnapshot().code, null); release(reply(onsiteScheduleHttp())); await read; assert.equal(c.getSnapshot().code, null);
});
test("code expiry or clear during async preflight prevents POST", async () => {
  for (const mode of ["expire", "clear"] as const) { const h = harness(), c = await ready(h);
    h.getHook = () => { if (mode === "expire") h.now = onsiteScheduleClaims().expiresAtMs; else c.clearCode(); return reply(onsiteScheduleHttp()); };
    await c.submit(selection); assert.equal(h.calls.filter(x => x.method === "POST").length, 0); assert.equal(h.values.size, 0);
  }
});
test("state observer pause stops preflight before HTTP and stops saving before POST", async () => {
  for (const phase of ["loading", "saving"] as const) { const h = harness(), c = await ready(h); c.subscribe(() => { if (c.getSnapshot().phase === phase) c.pause(); });
    await c.submit(selection); assert.equal(h.calls.filter(x => x.method === "POST").length, 0); assert.equal(h.values.has(key), phase === "saving");
  }
});
test("clearCode notification after private token consumption still prevents POST", async () => {
  const h = harness(), c = await ready(h); let once = false;
  c.subscribe(() => { if (!once && c.getSnapshot().phase === "saving" && c.getSnapshot().code === null) { once = true; c.clearCode(); } });
  await c.submit(selection); assert.equal(h.calls.filter(x => x.method === "POST").length, 0); assert.ok(h.values.get(key));
});
test("storage write hooks cannot bypass lease or replace an owned pending", async () => {
  for (const mode of ["pause", "replace"] as const) { const h = harness(), c = await ready(h); h.storageHook = () => { if (mode === "pause") c.pause(); else h.values.set(key, "foreign"); };
    await c.submit(selection); assert.equal(h.calls.filter(x => x.method === "POST").length, 0); assert.ok(h.values.get(key)); if (mode === "replace") assert.equal(h.values.get(key), "foreign");
  }
});
test("auth and QR rejection retain original ID, clear visible result and capability", async () => {
  for (const [error, status] of [["attendance_access_denied", 403], ["attendance_qr_expired", 409], ["attendance_qr_used", 409]] as const) {
    const h = harness(), c = await ready(h); h.postHook = () => reply({ ok: false, error }, status); await c.submit(selection);
    assert.ok(c.getSnapshot().pending); assert.ok(h.values.get(key)); assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().code, null);
  }
});
test("changed current identity/sequence/listed selection preflight cannot silently write", async () => {
  for (const mode of ["identity", "slot"] as const) { const h = harness(), c = await ready(h), r = onsiteScheduleHttp();
    if (mode === "identity") r.clock.employeeId = id(88); else r.choices.entries = []; h.getHook = () => reply(r); await c.submit(selection);
    assert.equal(h.calls.filter(x => x.method === "POST").length, 0); assert.equal(h.values.size, 0);
  }
});
test("mismatched receipt action/selection/actor cannot clear pending", async () => {
  for (const mode of ["selection", "actor", "sequence"] as const) { const h = harness(JSON.stringify(pending())), c = h.create(); await c.initialize(); const r = onsiteScheduleHttp(true);
    if (mode === "selection") r.association!.selection!.slotId = id(99); else if (mode === "actor") r.adoption!.employeeAuthUserId = id(99); else { r.clock.receipt!.sequence = 2; r.clock.state.sequence = 2; }
    h.getHook = () => reply(r); await c.read(); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null);
  }
});
test("late successful POST after pause cannot consume pending or resurrect result", async () => {
  const h = harness(), c = await ready(h); let release: (r: Response) => void = () => {}, entered: () => void = () => {};
  const posted = new Promise<void>(r => { entered = r; }); h.postHook = () => { entered(); return new Promise(r => { release = r; }); };
  const work = c.submit(selection); await posted; c.pause(); release(reply(onsiteScheduleHttp(true))); await work;
  assert.ok(h.values.get(key)); assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().code, null);
});
test("failed pending removal blocks without presenting a confirmed receipt", async () => {
  const h = harness(), c = await ready(h); h.storage.removeItem = () => {}; await c.submit(selection); assert.equal(c.getSnapshot().phase, "storage_error"); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null);
});
test("bounded UTF8/body deadline and error shape are fail-closed", async () => {
  for (const mode of ["timeout", "utf8", "oversize", "extraerror"] as const) {
    const h = harness(JSON.stringify(pending())), c = h.create(true, 20); await c.initialize();
    h.getHook = () => mode === "extraerror" ? reply({ ok: false, error: "attendance_access_denied", extra: true }, 403)
      : new Response(new ReadableStream<Uint8Array>({ start(s) { if (mode === "timeout") return; s.enqueue(mode === "utf8" ? Uint8Array.of(255) : new Uint8Array(65537).fill(32)); s.close(); } }), { headers: { "content-type": "application/json" } });
    await c.read(); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null);
  }
});
