import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { AttendanceOnsiteClockClient, onsiteClockPendingKey, parseOnsiteClockPending, type OnsiteClockPending } from "./merchantAttendanceOnsiteClockClient";
import type { AttendanceEvent } from "./merchantAttendance";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { OnsiteClaims, OnsiteClockResult, OnsiteCommand } from "./merchantAttendanceOnsiteQr";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", authUserId = id(1), employeeId = id(2), workerId = id(3), locationId = id(4), now = 1_800_000_000_000;
const command: OnsiteCommand = { expectedWorkerId: workerId, expectedEmployeeId: employeeId, operationId: id(6), locationId, action: "clock_in", expectedSequence: 0 };
const pending: OnsiteClockPending = { version: 1, siteId, authUserId, command };
const key = onsiteClockPendingKey(siteId, authUserId);
const claims: OnsiteClaims = { v: 1, purpose: "faolla.attendance.onsite", siteId, terminalId: id(5), locationId,
  pairedAtMs: now - 60_000, issuedAtMs: now, expiresAtMs: now + 45_000, nonce: id(7) };
function code(change: Partial<OnsiteClaims> = {}) {
  // The browser intentionally cannot authenticate this signature. Server tests
  // separately verify real HMACs; this fixture exercises untrusted UX decoding.
  return `aq1.${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${"A".repeat(43)}`;
}
const initial = (): OnsiteClockResult => ({ workerId, employeeId, locationId,
  state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false });
function event(c = command, sequence = c.expectedSequence + 1): AttendanceEvent {
  return { id: id(100 + sequence), siteId, workerId: c.expectedWorkerId, locationId: c.locationId, operationId: c.operationId,
    action: c.action, breakPaid: c.action === "break_start" ? false : null, sequence, occurredAt: "2027-01-15T08:00:00.000Z", timeZone: "Europe/Madrid" };
}
function committed(c = command, sequence = c.expectedSequence + 1): OnsiteClockResult {
  const receipt = event(c, sequence), status = c.action === "clock_out" ? "off" : c.action === "break_start" ? "break" : "working";
  return { workerId: c.expectedWorkerId, employeeId: c.expectedEmployeeId, locationId: c.locationId,
    state: { sequence, status, lastEvent: receipt }, receipt, replayed: false };
}
const ok = (value: OnsiteClockResult, moduleEnabled = true) => Response.json({ ok: true, ...value, moduleEnabled });
const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });
function storage() {
  const entries = new Map<string, string>(); let writes = 0, removals = 0;
  return { entries, get writes() { return writes; }, get removals() { return removals; }, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; entries.set(key, value); }, removeItem: (key: string) => { removals++; entries.delete(key); } };
}
const clients = new Set<AttendanceOnsiteClockClient>();
afterEach(() => { for (const client of clients) client.dispose(); clients.clear(); });
function fixture(api: AttendanceApiFetch = async () => ok(initial()), options: Partial<ConstructorParameters<typeof AttendanceOnsiteClockClient>[0]> = {}) {
  const saved = storage(), calls: Array<{ path: string; init: RequestInit }> = [];
  const client = new AttendanceOnsiteClockClient({ siteId, authUserId, storage: () => saved, randomId: () => id(6), now: () => now,
    ...options, apiFetch: async (path, init = {}) => { calls.push({ path, init }); return api(path, init); } });
  clients.add(client); return { client, saved, calls, posts: () => calls.filter(call => call.init.method === "POST") };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function until(ready: () => boolean) {
  for (let i = 0; i < 50 && !ready(); i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ready(), true);
}

test("initialize only GETs; explicit punch preflights, saves non-secret intent before POST and confirms exact receipt", async () => {
  const f = fixture(async (_path, init) => {
    if (init?.method !== "POST") return ok(initial());
    assert.deepEqual(JSON.parse(f.saved.getItem(key)!), pending);
    assert.equal(f.client.getSnapshot().code, null);
    return ok(committed());
  });
  await f.client.initialize(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.client.setCode(code()), true); assert.equal(f.posts().length, 0);
  await f.client.punch("clock_in");
  assert.equal(f.calls.length, 3); assert.equal(f.calls[1].init.method, "GET");
  assert.deepEqual(JSON.parse(f.posts()[0].init.body as string), { siteId, token: code(), command });
  assert.equal(f.client.getSnapshot().phase, "confirmed"); assert.deepEqual(f.client.getSnapshot().result?.receipt, event());
  assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.saved.getItem(key), null);
  assert.equal(f.client.getSnapshot().code, null);
});

test("tokens never appear in snapshots, storage, GET URLs or pending schemas", async () => {
  const snapshots: string[] = [];
  const f = fixture(async (_path, init) => { if (init?.method === "POST") throw Error("lost response"); return ok(initial()); });
  f.client.subscribe(() => snapshots.push(JSON.stringify(f.client.getSnapshot())));
  await f.client.initialize(); f.client.setCode(code());
  assert.deepEqual(Object.keys(f.client.getSnapshot().code!), ["siteId", "terminalId", "locationId", "issuedAtMs", "expiresAtMs"]);
  await f.client.punch("clock_in");
  assert.equal(snapshots.some(value => value.includes(code())), false);
  const persisted = f.saved.getItem(key)!;
  assert.equal(persisted.includes("aq1."), false); assert.equal(persisted.includes("terminalId"), false); assert.equal(persisted.includes("nonce"), false);
  assert.equal(f.calls.some(call => call.path.includes("token") || call.path.includes("aq1.")), false);
  for (const invalid of [{ ...pending, token: code() }, { ...pending, terminalId: claims.terminalId },
    { ...pending, command: { ...command, token: code() } }]) assert.throws(() => parseOnsiteClockPending(JSON.stringify(invalid), siteId, authUserId));
});

test("lost response keeps one pending command; refresh/remount recovers by GET without token or auto-POST", async () => {
  const saved = storage(); let committedOnServer = false;
  const api: AttendanceApiFetch = async (path, init) => {
    if (init?.method === "POST") { committedOnServer = true; throw Error("connection lost"); }
    if (committedOnServer) { assert.ok(path.includes(`operationId=${command.operationId}`)); return ok(committed()); }
    return ok(initial());
  };
  const f = fixture(api, { storage: () => saved }); await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.ok(saved.getItem(key)); assert.equal(f.client.getSnapshot().code, null);
  f.client.dispose();
  const restored = fixture(api, { storage: () => saved, now: () => now + 3600_000 }); await restored.client.initialize();
  assert.equal(restored.posts().length, 0); assert.equal(restored.calls.length, 1);
  assert.equal(restored.client.getSnapshot().phase, "confirmed"); assert.equal(saved.getItem(key), null);
});

test("same-sequence absence remains unknown; no new action or automatic retry and every explicit retry needs a new scan", async () => {
  let generated = 0;
  const f = fixture(async (_path, init) => { if (init?.method === "POST") throw Error("offline"); return ok(initial()); }, { randomId: () => id(6 + generated++) });
  await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
  await f.client.read(); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  await f.client.punch("clock_in"); await f.client.punch("clock_out"); await f.client.punch(null);
  assert.equal(f.posts().length, 1);
  f.client.setCode(code({ nonce: id(8), terminalId: id(9) })); await f.client.punch(null);
  assert.equal(f.posts().length, 2);
  assert.deepEqual(f.posts().map(call => JSON.parse(call.init.body as string).command), [command, command]);
  assert.notEqual(JSON.parse(f.posts()[0].init.body as string).token, JSON.parse(f.posts()[1].init.body as string).token);
  assert.equal(f.calls.at(-2)?.init.method, "GET"); assert.ok(f.calls.at(-2)?.path.includes(`operationId=${command.operationId}`));
  assert.equal(f.client.getSnapshot().pending?.command.operationId, command.operationId);
  assert.equal(generated, 1);
  assert.equal(f.client.getSnapshot().code, null);
});

test("fresh retry performs GET first; a found receipt or advanced sequence resolves without POST", async () => {
  for (const found of [true, false]) {
    const saved = storage(); saved.setItem(key, JSON.stringify(pending)); let reads = 0;
    const newer = committed({ ...command, operationId: id(20) }); newer.receipt = null;
    const f = fixture(async () => ok(++reads === 1 ? initial() : found ? committed() : newer), { storage: () => saved });
    await f.client.initialize(); f.client.setCode(code()); await f.client.punch(null);
    assert.equal(f.posts().length, 0); assert.equal(saved.getItem(key), null); assert.equal(f.client.getSnapshot().pending, null);
    assert.equal(f.client.getSnapshot().phase, found ? "confirmed" : "ready");
    assert.match(f.client.getSnapshot().message, found ? /服务器确认/ : /旧操作已不能写入/);
  }
});

test("double clicks and simultaneous reads never send a second POST or operation", async () => {
  const waiting = deferred<Response>();
  const f = fixture(async (_path, init) => init?.method === "POST" ? waiting.promise : ok(initial()));
  await f.client.initialize(); f.client.setCode(code()); const first = f.client.punch("clock_in");
  await until(() => f.posts().length === 1);
  await f.client.punch("clock_in"); await f.client.punch(null); await f.client.read();
  assert.equal(f.client.setCode(code({ nonce: id(11) })), false);
  assert.equal(f.posts().length, 1); assert.equal(f.client.getSnapshot().phase, "saving");
  waiting.resolve(ok(committed())); await first;
  assert.equal(f.client.getSnapshot().phase, "confirmed");
});

test("explicit QR rejection still preserves pending until an authoritative GET reconciles it", async () => {
  const f = fixture(async (_path, init) => init?.method === "POST" ? fail("attendance_qr_invalid", 400) : ok(initial()));
  await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.ok(f.saved.getItem(key));
  await f.client.read(); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.ok(f.saved.getItem(key));
  assert.equal(f.posts().length, 1);
});

test("malformed, oversized, redirected or missing-receipt POST responses never confirm or discard pending", async () => {
  const badResponses = [() => fail("attendance_unavailable", 503), () => new Response("login", { headers: { "content-type": "text/html" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }), () => Response.json({ ok: true }),
    () => new Response(" ".repeat(32_769), { headers: { "content-type": "application/json" } }), () => ok(initial()),
    () => { const response = ok(committed()); Object.defineProperty(response, "redirected", { value: true }); return response; }];
  for (const bad of badResponses) {
    const f = fixture(async (_path, init) => init?.method === "POST" ? bad() : ok(initial()));
    await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
    assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.client.getSnapshot().result, null);
    assert.ok(f.saved.getItem(key)); assert.equal(f.client.getSnapshot().code, null);
  }
});

test("401/403 clears visible identity and code while keeping non-secret pending for the original principal", async () => {
  for (const [error, status] of [["unauthorized", 401], ["attendance_access_denied", 403], ["employee_password_authentication_required", 403]] as const) {
    const f = fixture(async (_path, init) => init?.method === "POST" ? fail(error, status) : ok(initial()));
    await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
    assert.equal(f.client.getSnapshot().moduleEnabled, false); assert.equal(f.client.getSnapshot().code, null);
    assert.ok(f.client.getSnapshot().pending); assert.ok(f.saved.getItem(key));
  }
});

test("pending key and recovery are isolated by both site and auth principal", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  for (const scope of [{ siteId, authUserId: id(22) }, { siteId: "99990002", authUserId }]) {
    const f = fixture(async () => ok(initial()), { ...scope, storage: () => saved }); await f.client.initialize();
    assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.calls[0].path.includes("operationId="), false);
    assert.notEqual(f.client.storageKey, key); assert.ok(saved.getItem(key));
  }
  assert.throws(() => parseOnsiteClockPending(JSON.stringify(pending), siteId, id(22)));
  assert.throws(() => parseOnsiteClockPending(JSON.stringify(pending), "99990002", authUserId));
});

test("corrupt or unavailable storage is preserved and fails closed without network or storage writes", async () => {
  for (const raw of ["not JSON", JSON.stringify({ ...pending, version: 2 }), JSON.stringify({ ...pending, siteId: "99990002" }),
    JSON.stringify({ ...pending, authUserId: id(9) }), JSON.stringify({ ...pending, command: { ...command, expectedEmployeeId: "other" } }),
    JSON.stringify({ ...pending, command: { ...command, expectedSequence: -1 } }), "x".repeat(2_049)]) {
    const saved = storage(); saved.setItem(key, raw); const originalWrites = saved.writes;
    const f = fixture(undefined, { storage: () => saved }); await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0);
    assert.equal(saved.getItem(key), raw); assert.equal(saved.writes, originalWrites); assert.equal(saved.removals, 0);
  }
  const unavailable = fixture(undefined, { storage: () => { throw Error("denied"); } });
  await unavailable.client.initialize(); unavailable.client.setCode(code()); await unavailable.client.punch("clock_in");
  assert.equal(unavailable.calls.length, 0); assert.equal(unavailable.client.getSnapshot().phase, "blocked");
});

test("failed or silently dropped write/readback prevents POST", async () => {
  for (const setItem of [() => { throw Error("quota"); }, () => {}]) {
    const saved = { ...storage(), setItem }, f = fixture(undefined, { storage: () => saved });
    await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
    assert.equal(f.posts().length, 0); assert.equal(f.client.getSnapshot().phase, "blocked");
  }
});

test("concurrent controller intent appearing during preflight is never overwritten or posted", async () => {
  const saved = storage(), waiting = deferred<Response>(); let reads = 0;
  const other = { ...pending, command: { ...command, operationId: id(33) } };
  const f = fixture(async () => ++reads === 1 ? ok(initial()) : waiting.promise, { storage: () => saved });
  await f.client.initialize(); f.client.setCode(code()); const punch = f.client.punch("clock_in");
  await until(() => f.calls.length === 2); saved.setItem(key, JSON.stringify(other)); waiting.resolve(ok(initial())); await punch;
  assert.equal(f.posts().length, 0); assert.deepEqual(JSON.parse(saved.getItem(key)!), other);
  assert.equal(f.client.getSnapshot().phase, "blocked");
});

test("receipt cleanup never removes or rewrites a concurrent different intent, even reusing the operation ID", async () => {
  const saved = storage(), waiting = deferred<Response>();
  const f = fixture(async (_path, init) => init?.method === "POST" ? waiting.promise : ok(initial()), { storage: () => saved });
  await f.client.initialize(); f.client.setCode(code()); const punch = f.client.punch("clock_in"); await until(() => f.posts().length === 1);
  const other = { ...pending, command: { ...command, expectedEmployeeId: id(44) } };
  saved.setItem(key, JSON.stringify(other)); waiting.resolve(ok(committed())); await punch;
  assert.deepEqual(JSON.parse(saved.getItem(key)!), other); assert.equal(saved.removals, 0);
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.ok(f.client.getSnapshot().pending);
});

test("worker/employee mismatch or mismatched receipt action/location/sequence cannot clear pending", async () => {
  const corrupt = [() => ({ ...initial(), workerId: id(33) }), () => ({ ...initial(), employeeId: id(33) }),
    () => committed({ ...command, action: "clock_out" }), () => committed({ ...command, locationId: id(33) }),
    () => committed(command, 2), () => committed({ ...command, operationId: id(33) })];
  for (const make of corrupt) {
    const saved = storage(); saved.setItem(key, JSON.stringify(pending));
    const f = fixture(async () => ok(make()), { storage: () => saved }); await f.client.initialize();
    assert.ok(saved.getItem(key)); assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
    assert.notEqual(f.client.getSnapshot().phase, "confirmed"); assert.equal(f.posts().length, 0);
  }
});

test("changing employee, worker, location or state between display and preflight never silently posts", async () => {
  for (const latest of [{ ...initial(), employeeId: id(33) }, { ...initial(), workerId: id(33) }, { ...initial(), locationId: id(33) },
    { ...committed({ ...command, operationId: id(33) }), receipt: null }]) {
    let reads = 0; const f = fixture(async () => ok(++reads === 1 ? initial() : latest));
    await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
    assert.equal(f.posts().length, 0); assert.equal(f.client.getSnapshot().code, null); assert.equal(f.saved.getItem(key), null);
  }
});

test("old confirmed receipt remains distinguishable from a newer current state", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const newer = committed({ ...command, operationId: id(33), action: "clock_out", expectedSequence: 1 });
  const f = fixture(async () => ok({ ...newer, receipt: event() }), { storage: () => saved }); await f.client.initialize();
  assert.equal(f.client.getSnapshot().phase, "confirmed"); assert.equal(f.client.getSnapshot().result?.receipt?.action, "clock_in");
  assert.equal(f.client.getSnapshot().result?.state.status, "off"); assert.equal(saved.getItem(key), null);
});

test("bad, expired, future-issued, foreign-site/location and invalid-lifetime codes never enable a POST", async () => {
  const f = fixture(); await f.client.initialize();
  for (const token of ["", "not a token", code({ siteId: "99990002" }), code({ locationId: id(33) }),
    code({ issuedAtMs: now - 45_000, expiresAtMs: now }), code({ issuedAtMs: now + 1, expiresAtMs: now + 45_001 }),
    code({ expiresAtMs: now + 44_999 }), code({ pairedAtMs: now + 1 }), code({ purpose: "other" as OnsiteClaims["purpose"] })]) {
    assert.equal(f.client.setCode(token), false); assert.equal(f.client.getSnapshot().code, null); await f.client.punch("clock_in");
  }
  assert.equal(f.calls.length, 1); assert.equal(f.posts().length, 0);
});

test("expiry timer clears capability; elapsed time is rechecked after a slow preflight", async () => {
  const f = fixture(); await f.client.initialize();
  assert.equal(f.client.setCode(code({ issuedAtMs: now - 44_999, expiresAtMs: now + 1 })), true);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(f.client.getSnapshot().code, null);
  let current = now, reads = 0; const waiting = deferred<Response>();
  const slow = fixture(async () => ++reads === 1 ? ok(initial()) : waiting.promise, { now: () => current });
  await slow.client.initialize(); slow.client.setCode(code()); const punch = slow.client.punch("clock_in");
  await until(() => slow.calls.length === 2); current += 45_000; waiting.resolve(ok(initial())); await punch;
  assert.equal(slow.posts().length, 0); assert.equal(slow.client.getSnapshot().code, null); assert.equal(slow.saved.getItem(key), null);
});

test("clearCode during preflight prevents a POST, and clearing after a POST cannot undo or forget it", async () => {
  let reads = 0; const waiting = deferred<Response>();
  const f = fixture(async () => ++reads === 1 ? ok(initial()) : waiting.promise);
  await f.client.initialize(); f.client.setCode(code()); const punch = f.client.punch("clock_in");
  await until(() => f.calls.length === 2); f.client.clearCode(); waiting.resolve(ok(initial())); await punch;
  assert.equal(f.posts().length, 0); assert.equal(f.saved.getItem(key), null);
  const post = deferred<Response>(), active = fixture(async (_path, init) => init?.method === "POST" ? post.promise : ok(initial()));
  await active.client.initialize(); active.client.setCode(code()); const writing = active.client.punch("clock_in");
  await until(() => active.posts().length === 1); active.client.clearCode(); assert.ok(active.saved.getItem(key));
  post.resolve(ok(committed())); await writing; assert.equal(active.client.getSnapshot().phase, "confirmed");
});

test("visibility clearing triggered by persistence notification cannot send a null or stale QR", async () => {
  const f = fixture(); let cleared = false;
  f.client.subscribe(() => {
    if (!cleared && f.client.getSnapshot().pending) { cleared = true; f.client.clearCode(); }
  });
  await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
  assert.equal(f.posts().length, 0); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  assert.ok(f.saved.getItem(key)); assert.equal(f.client.getSnapshot().code, null);
});

test("disposed scope aborts a pending POST, hides personal state and ignores a late receipt without removing recovery", async () => {
  const waiting = deferred<Response>(); let signal: AbortSignal | null = null;
  const f = fixture(async (_path, init) => { if (init?.method === "POST") { signal = init.signal!; return waiting.promise; } return ok(initial()); });
  await f.client.initialize(); f.client.setCode(code()); const writing = f.client.punch("clock_in"); await until(() => f.posts().length === 1);
  f.client.dispose(); const snapshot = f.client.getSnapshot(); waiting.resolve(ok(committed())); await writing;
  assert.equal((signal as AbortSignal | null)?.aborted, true); assert.equal(f.client.getSnapshot(), snapshot);
  assert.equal(snapshot.result, null); assert.equal(snapshot.code, null); assert.ok(f.saved.getItem(key));
  await f.client.read(); await f.client.punch(null); assert.equal(f.posts().length, 1);
});

test("reinitialize generations ignore a late old read and support StrictMode cleanup", async () => {
  const waiting = deferred<Response>(); let calls = 0;
  const f = fixture(async () => ++calls === 1 ? waiting.promise : ok(initial()));
  const first = f.client.initialize(); f.client.dispose(); await f.client.initialize();
  waiting.resolve(ok(committed())); await first;
  assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().result?.state.sequence, 0);
  assert.equal(f.client.getSnapshot().pending, null);
});

test("aborting during streamed response releases the reader and retains original intent", async () => {
  let canceled = false; const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { canceled = true; } }),
    { headers: { "content-type": "application/json" } });
  const f = fixture(async () => response, { storage: () => saved }); const reading = f.client.initialize();
  await new Promise<void>(resolve => setImmediate(resolve)); f.client.dispose(); await reading;
  assert.equal(canceled, true); assert.ok(saved.getItem(key)); assert.equal(f.client.getSnapshot().result, null);
});

test("paused module blocks new work but still permits explicit fresh-code finish and receipt recovery", async () => {
  const paused = fixture(async () => ok(initial(), false)); await paused.client.initialize(); paused.client.setCode(code()); await paused.client.punch("clock_in");
  assert.equal(paused.posts().length, 0); assert.equal(paused.saved.getItem(key), null);
  const working = { ...committed(), receipt: null }, finishCommand: OnsiteCommand = { ...command, operationId: id(9), expectedSequence: 1, action: "clock_out" };
  const finish = fixture(async (_path, init) => init?.method === "POST" ? ok(committed(finishCommand), false) : ok(working, false), { randomId: () => id(9) });
  await finish.client.initialize(); finish.client.setCode(code()); await finish.client.punch("clock_out");
  assert.equal(finish.posts().length, 1); assert.equal(finish.client.getSnapshot().phase, "confirmed");
  assert.equal(finish.client.getSnapshot().moduleEnabled, false);
});

test("a post receipt cleanup failure preserves intent and blocks further writes", async () => {
  const saved = { ...storage(), removeItem: () => { throw Error("read only"); } };
  const f = fixture(async (_path, init) => init?.method === "POST" ? ok(committed()) : ok(initial()), { storage: () => saved });
  await f.client.initialize(); f.client.setCode(code()); await f.client.punch("clock_in");
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.ok(saved.getItem(key)); assert.ok(f.client.getSnapshot().pending);
  f.client.setCode(code()); await f.client.punch(null); assert.equal(f.posts().length, 1);
});
