// 242 isolated memory transports, not SQL, browser or real credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceOperationalPunchClient, operationalPunchPendingKey, parseOperationalPunchPending,
  type OperationalPunchClientOptions, type OperationalPunchClientScope, type OperationalPunchStorage, type OperationalPunchTransport } from "./merchantAttendanceOperationalPunchClient";
import { OPERATIONAL_PUNCH_ERRORS, type OperationalPunchCommand } from "./merchantAttendanceOperationalPunch";
import type { OperationalPunchClientContext } from "./merchantAttendanceOperationalPunchClient";
import { punchFixture, punchStartFixture, punchId as id, punchSite as siteId } from "./merchantAttendanceOperationalPunchTestFixtures";

const scope: OperationalPunchClientScope = { siteId, channel: "self", authUserId: id(3), terminalId: null, workerNo: null };
const context = { siteId, channel: "self" as const, authUserId: id(3) };
const errors: Readonly<Record<string, number>> = { ...OPERATIONAL_PUNCH_ERRORS, attendance_operation_conflict: 409, attendance_access_denied: 403 };
function memory() {
  const values = new Map<string, string>(), writes: string[] = [], removes: string[] = [];
  const storage: OperationalPunchStorage = { getItem: key => values.get(key) ?? null, setItem: (key, raw) => { writes.push(raw); values.set(key, raw); }, removeItem: key => { removes.push(key); values.delete(key); } };
  return { values, writes, removes, storage };
}
function setup(overrides: Partial<OperationalPunchClientOptions> = {}) {
  const m = memory(), client = new AttendanceOperationalPunchClient({ scope, storage: () => m.storage, isCurrent: () => true, blockedKeys: () => [], errors, ...overrides });
  return { ...m, client };
}
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { "Content-Type": "application/json" } });
const rejected = (code = "attendance_operational_punch_changed", status = errors[code], extra = {}) => new Response(JSON.stringify({ ok: false, error: { code, message: code }, ...extra }), { status, headers: { "Content-Type": "application/json" } });
async function prepared(x: ReturnType<typeof setup>) { const f = await punchFixture(); await x.client.initialize(); await x.client.prepare(context, async () => response(f.result)); assert.equal(x.client.getSnapshot().phase, "ready"); return f; }
async function pending(x: ReturnType<typeof setup>) { const f = await punchStartFixture(); await prepared(x); await x.client.submit(f.command, context, async () => { throw Error("lost response"); }); const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); return { ...f, raw }; }
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("242 initialize is local and new POST cannot precede a fresh explicit prepare", async () => {
  const x = setup(), f = await punchStartFixture(); let requests = 0, observations = 0; const unsubscribe = x.client.subscribe(() => { observations++; });
  await x.client.initialize(); assert.equal(x.client.getSnapshot().phase, "idle"); assert.equal(x.writes.length, 0);
  await x.client.submit(f.command, context, async () => { requests++; return response(f.result); }); assert.equal(requests, 0); assert.equal(x.writes.length, 0);
  assert.ok(observations > 0); unsubscribe(); x.client.dispose();
});

test("242 full immutable intent is durably saved and read back before the single POST; exact receipt alone clears", async () => {
  const x = setup(), f = await punchStartFixture(); await prepared(x); let requests = 0;
  await x.client.submit(f.command, context, async (query, command) => {
    requests++; assert.deepEqual(query, f.input.query); assert.deepEqual(command, f.command);
    const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); assert.deepEqual(parseOperationalPunchPending(raw, scope).command, f.command);
    assert.equal(x.client.getSnapshot().phase, "submitting"); assert.equal(Object.isFrozen(command!.choice), true); return response(f.result);
  });
  assert.equal(requests, 1); assert.equal(x.writes.length, 1); assert.equal(x.removes.length, 1); assert.equal(x.client.getSnapshot().pending, null);
  await x.client.submit(f.command, context, async () => { requests++; return response(f.result); }); assert.equal(requests, 1); x.client.dispose();
});

test("242 lost response reload restores exact original bytes locally, then only explicit GET matching full hash clears", async () => {
  const x = setup(), f = await pending(x); x.client.dispose();
  const y = setup({ storage: () => x.storage }); await y.client.initialize(); assert.deepEqual(y.client.getSnapshot().pending?.command, f.command);
  let requests = 0; await y.client.recover(context, async (query, command) => { requests++; assert.deepEqual(query, f.input.query); assert.equal(command, null); return response({ ...f.result, session: null }); });
  assert.equal(requests, 1); assert.equal(x.storage.getItem(y.client.storageKey), null); assert.equal(y.client.getSnapshot().pending, null);
  await y.client.submit(f.command, context, async () => { requests++; return response(f.result); }); assert.equal(requests, 1); y.client.dispose();
});

test("242 GET null, old receipt, changed full-command hash and known GET rejection never clear or enable ending", async () => {
  for (const kind of ["null", "old", "hash", "get_rejected"] as const) {
    const x = setup(), f = await pending(x);
    const result = { ...f.result, session: null, operation: kind === "hash" ? { ...f.result.operation!, commandFingerprint: "f".repeat(64) } : null,
      clock: kind === "null" ? { ...f.result.clock, receipt: null } : f.result.clock };
    await x.client.recover(context, async () => kind === "get_rejected" ? rejected() : response(result));
    assert.equal(x.storage.getItem(x.client.storageKey), f.raw); assert.equal(x.client.getSnapshot().canEndRejected, false);
    await x.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), f.raw); x.client.dispose();
  }
});

test("242 old pending interlock blocks preparation and rechecks immediately before submitting", async () => {
  const x = setup({ blockedKeys: () => ["synthetic:legacy-pending"] }); x.values.set("synthetic:legacy-pending", "old complete intent");
  let requests = 0; const f = await punchStartFixture(); await x.client.initialize(); await x.client.prepare(context, async () => { requests++; return response(f.result); }); assert.equal(requests, 0);
  x.values.delete("synthetic:legacy-pending"); await prepared(x); x.values.set("synthetic:legacy-pending", "arrived in another tab");
  await x.client.submit(f.command, context, async () => { requests++; return response(f.result); }); assert.equal(requests, 0); assert.equal(x.writes.length, 0); x.client.dispose();
});

test("242 unavailable/changed durable storage prevents POST or deletion of another tab's exact bytes", async () => {
  const m = memory(), x = setup({ storage: () => ({ ...m.storage, setItem: () => { throw Error("quota"); } }) }), f = await punchStartFixture(); await prepared(x); let writes = 0;
  await x.client.submit(f.command, context, async () => { writes++; return response(f.result); }); assert.equal(writes, 0); assert.equal(x.client.getSnapshot().phase, "storage_error"); x.client.dispose();
  const y = setup(), p = await pending(y); await y.client.recover(context, async () => { y.values.set(y.client.storageKey, "another-tab-exact-bytes"); return response({ ...p.result, session: null }); });
  assert.equal(y.storage.getItem(y.client.storageKey), "another-tab-exact-bytes"); assert.equal(y.removes.length, 0); assert.equal(y.client.getSnapshot().phase, "storage_error"); y.client.dispose();
});

test("242 invalid current scope and pause fence a delayed matching receipt without clearing pending", async () => {
  for (const pause of [false, true]) { let current = true; const x = setup({ isCurrent: () => current }), f = await pending(x), late = defer<Response>();
    const reading = x.client.recover(context, () => late.promise); if (pause) x.client.pause(); else current = false;
    late.resolve(response({ ...f.result, session: null })); await reading;
    assert.equal(x.storage.getItem(x.client.storageKey), f.raw); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.removes.length, 0); x.client.dispose(); }
});

test("242 late response headers after pause cancel the owned body and do not retain an open stream", async () => {
  const x = setup(), f = await pending(x), late = defer<Response>(); let canceled = false;
  const reading = x.client.recover(context, () => late.promise); x.client.pause(); late.resolve(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "Content-Type": "application/json" } }));
  await reading; await Promise.resolve(); assert.equal(canceled, true); assert.equal(x.storage.getItem(x.client.storageKey), f.raw); x.client.dispose();
});

test("242 initially hidden / visible require explicit calls and hiding clears read without touching pending", async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "document"); let hidden = true;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return hidden; } } });
  t.after(() => { if (old) Object.defineProperty(globalThis, "document", old); else Reflect.deleteProperty(globalThis, "document"); });
  const x = setup(), f = await punchFixture(); let requests = 0; const transport: OperationalPunchTransport = async () => { requests++; return response(f.result); };
  await x.client.initialize(); await x.client.prepare(context, transport); assert.equal(requests, 0); hidden = false; assert.equal(requests, 0);
  await x.client.initialize(); await x.client.prepare(context, transport); assert.equal(requests, 1); hidden = true; x.client.pause(); assert.equal(x.client.getSnapshot().result, null); hidden = false; assert.equal(requests, 1); x.client.dispose();
});

test("242 malformed UTF8, over-limit stream, invalid status/MIME/redirect remain unknown and preserve the original", async () => {
  const cases = [() => new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }),
    () => new Response("x".repeat(262145), { headers: { "Content-Type": "application/json" } }),
    () => new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } }),
    () => new Response("{}", { headers: { "Content-Type": "text/plain" } }),
    () => { const r = new Response("{}", { headers: { "Content-Type": "application/json" } }); Object.defineProperty(r, "redirected", { value: true }); return r; }];
  for (const make of cases) { const x = setup(), f = await pending(x); await x.client.recover(context, async () => make());
    assert.equal(x.storage.getItem(x.client.storageKey), f.raw); assert.equal(x.client.getSnapshot().canEndRejected, false); assert.equal(x.client.getSnapshot().result, null); x.client.dispose(); }
});

test("242 one deadline covers hung headers, body and receipt SHA; late crypto completion cannot clear", async t => {
  const x = setup({ timeoutMs: 20 }), f = await pending(x); await x.client.recover(context, async () => new Promise<Response>(() => {})); assert.equal(x.storage.getItem(x.client.storageKey), f.raw); x.client.dispose();
  let canceled = false; const y = setup({ timeoutMs: 20 }), g = await pending(y);
  await y.client.recover(context, async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel() { canceled = true; } }), { headers: { "Content-Type": "application/json" } }));
  assert.equal(canceled, true); assert.equal(y.storage.getItem(y.client.storageKey), g.raw); y.client.dispose();
  const z = setup({ timeoutMs: 20 }), h = await pending(z), digest = crypto.subtle.digest.bind(crypto.subtle), delayed = defer<void>();
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<SubtleCrypto["digest"]>) => { await delayed.promise; return digest(...args); });
  await z.client.recover(context, async () => response({ ...h.result, session: null })); assert.equal(z.storage.getItem(z.client.storageKey), h.raw); assert.equal(z.client.getSnapshot().phase, "unconfirmed");
  delayed.resolve(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(z.storage.getItem(z.client.storageKey), h.raw); assert.equal(z.removes.length, 0); z.client.dispose();
});

test("242 five exact current-POST rejections allow only explicit memory-backed local end and fresh preparation", async () => {
  for (const suffix of ["changed", "disabled", "channel_denied", "location_denied", "break_type_denied"]) {
    const x = setup(), f = await punchStartFixture(); await prepared(x); let writes = 0;
    await x.client.submit(f.command, context, async () => { writes++; return rejected("attendance_operational_punch_" + suffix); });
    assert.equal(x.client.getSnapshot().canEndRejected, true); const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["command", "scope", "version"]);
    await x.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), null); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().canEndRejected, false);
    await x.client.submit(f.command, context, async () => { writes++; return response(f.result); }); assert.equal(writes, 1); x.client.dispose();
  }
});

test("242 conflict/unknown/Auth/status mismatch/extra error fields are never a known no-write proof", async () => {
  const failures = [() => rejected("attendance_operation_conflict"), () => rejected("attendance_access_denied"), () => rejected("attendance_operational_punch_invalid"),
    () => rejected("attendance_operational_punch_changed", 403), () => rejected("attendance_operational_punch_changed", 409, { injected: true }), () => { throw Error("attendance_operational_punch_changed"); }];
  for (const fail of failures) { const x = setup(), f = await punchStartFixture(); await prepared(x); await x.client.submit(f.command, context, async () => fail());
    const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); assert.equal(x.client.getSnapshot().canEndRejected, false); await x.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), raw); x.client.dispose(); }
});

test("242 initialize/hidden/close/GET null discard only volatile rejection proof, never original pending", async () => {
  for (const mode of ["initialize", "pause", "dispose", "get"] as const) {
    const x = setup(), f = await punchStartFixture(); await prepared(x); await x.client.submit(f.command, context, async () => rejected());
    const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); assert.equal(x.client.getSnapshot().canEndRejected, true);
    if (mode === "get") await x.client.recover(context, async () => response({ ...f.result, session: null, operation: null })); else await x.client[mode]();
    assert.equal(x.client.getSnapshot().canEndRejected, false, mode); await x.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), raw); x.client.dispose();
  }
});

test("242 rejection proof is not restored from local storage, cannot clear replacements or changed Auth", async () => {
  let current = true; const x = setup({ isCurrent: () => current }), f = await punchStartFixture(); await prepared(x); await x.client.submit(f.command, context, async () => rejected());
  const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); const y = setup({ storage: () => x.storage }); await y.client.initialize(); await y.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), raw); y.client.dispose();
  current = false; await x.client.endRejected(); assert.equal(x.storage.getItem(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().canEndRejected, false); x.client.dispose();
  const z = setup(); await prepared(z); await z.client.submit(f.command, context, async () => rejected()); z.values.set(z.client.storageKey, "replacement bytes"); await z.client.endRejected(); assert.equal(z.storage.getItem(z.client.storageKey), "replacement bytes"); z.client.dispose();
});

test("242 durable grammar rejects GPS/token/PIN injection; ephemeral transport closure is never retained", async () => {
  const x = setup(), f = await punchStartFixture(), secret = "synthetic-pin-01738264-token-location-12.345";
  for (const extra of [{ pin: secret }, { token: secret }, { position: { latitude: 12.345, longitude: 4.56 } }]) {
    await prepared(x); await x.client.submit({ ...f.command, ...extra }, context, async () => { assert.fail("invalid durable intent"); }); assert.equal(x.writes.length, 0);
    assert.throws(() => parseOperationalPunchPending(JSON.stringify({ version: 1, scope, command: { ...f.command, ...extra } }), scope));
  }
  await prepared(x); await x.client.submit(f.command, context, async () => { assert.ok(secret); throw Error("unknown transport"); });
  assert.equal(JSON.stringify(x.client.getSnapshot()).includes(secret), false); assert.equal(x.writes.some(raw => raw.includes(secret)), false); x.client.dispose();
});

test("242 PIN/onsite/location valid finish intents save only their channel grammar, never temporary credentials", async () => {
  const f = await punchStartFixture();
  for (const channel of ["pin", "onsite", "location"] as const) {
    const isPin = channel === "pin", scope: OperationalPunchClientScope = { siteId, channel, authUserId: isPin ? null : id(3), terminalId: isPin ? id(9) : null, workerNo: isPin ? "PIN-01" : null };
    const context: OperationalPunchClientContext = isPin ? { siteId, channel, authUserId: null, terminalId: id(9), workerNo: "PIN-01", expectedWorkerId: id(1), expectedEmployeeId: id(2) }
      : channel === "location" ? { siteId, channel, authUserId: id(3), expectedWorkerId: id(1) } : { siteId, channel, authUserId: id(3) };
    const commonClock = { ...f.result.clock, receipt: null, employeeId: id(2) };
    const clock = isPin ? { ...commonClock, siteId, terminalId: id(9), workerNo: "PIN-01", workerName: "Synthetic only", canStart: false, canFinish: true, blockReason: null }
      : channel === "onsite" ? commonClock : { ...commonClock, siteId, channelEnabled: false, policy: null, locationResult: null,
        noticeGate: { ready: false, reason: "unpublished", revision: null }, finish: { locationId: id(4), settingsVersion: 1, workerVersion: 1, locationVersion: 1 }, receiptGate: null };
    const result = { ...f.result, channel, clock, policy: null, session: null, operation: null, canStart: false, canBreak: false, canFinish: true };
    const common = { expectedWorkerId: id(1), operationId: id(99), locationId: id(4), action: "clock_out" as const, expectedSequence: 1 };
    const command: OperationalPunchCommand = { clock: channel === "location" ? { ...common, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: null, safeFinish: true }
      : { ...common, expectedEmployeeId: id(2) }, choice: { kind: "finish" } };
    const x = setup({ scope }), credential = { pin: "synthetic-01738264", token: "synthetic-aq1-secret", position: { latitude: 12.345, longitude: 4.567 } };
    await x.client.initialize(); await x.client.prepare(context, async () => response(result)); assert.equal(x.client.getSnapshot().phase, "ready", channel);
    await x.client.submit(command, context, async (_query, durable) => { assert.deepEqual(durable, command); assert.ok(credential); throw Error("response lost"); });
    const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw, channel); assert.deepEqual(parseOperationalPunchPending(raw, scope).command, command);
    for (const field of ["pin", "token", "position", "latitude", "longitude", "secret", "lease"]) assert.equal(Object.hasOwn(JSON.parse(raw).command, field), false);
    for (const secret of [credential.pin, credential.token, "12.345", "4.567"]) { assert.equal(raw.includes(secret), false); assert.equal(JSON.stringify(x.client.getSnapshot()).includes(secret), false); }
    x.client.dispose();
  }
});

test("242 scope constructors reject newline UUID/site suffixes before creating a pending namespace", () => {
  for (const suffix of ["\n", "\r\n", "\u2028"]) {
    assert.throws(() => operationalPunchPendingKey({ ...scope, siteId: siteId + suffix }));
    assert.throws(() => operationalPunchPendingKey({ ...scope, authUserId: id(3) + suffix }));
  }
  let reads = 0; assert.throws(() => operationalPunchPendingKey({ ...scope, get authUserId() { reads++; return id(3); } })); assert.equal(reads, 0);
  for (const timeoutMs of [0, 12001, Infinity]) assert.throws(() => setup({ timeoutMs }));
});
