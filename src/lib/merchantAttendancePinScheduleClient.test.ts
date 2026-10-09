import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePinScheduleClient, parsePinSchedulePending, pinScheduleOwnsInput, pinSchedulePendingKey, type PinScheduleClientOptions } from "./merchantAttendancePinScheduleClient";
import { pinClockPendingKey } from "./merchantAttendancePinClockClient";
import { pinScheduleHttp, pinScheduleCommand, pinScheduleId as id, pinScheduleSite as siteId, pinScheduleTerminal as terminalId,
  pinScheduleWorkerNo as workerNo, pinSchedulePin as pin, pinScheduleSelection as selection } from "../../scripts/fixtures/attendance-pin-schedule-model";
const device = { siteId, terminalId, label: "合成终端" }, endpoint = "/api/merchant-enterprise/attendance/terminal-schedule";
const reply = (raw: unknown, status = 200) => Response.json(raw, { status });
function store() { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; }
function pending() { return { version: 1, siteId, terminalId, workerNo, command: pinScheduleCommand(), selection: { ...selection } }; }
function legacy() { const { selection: _selection, ...p } = pending(); void _selection; return p; }
function accepted(body: Record<string, unknown>) {
  const r = pinScheduleHttp(true), c = body.command as ReturnType<typeof pinScheduleCommand>;
  r.clock.receipt!.operationId = c.operationId; r.clock.state.lastEvent!.operationId = c.operationId;
  r.association!.operationId = c.operationId; r.adoption!.operationId = c.operationId;
  if (body.selection === null) { r.association!.selection = null; r.association!.slot = null; r.association!.status = "unselected"; r.association!.currentCancelled = null;
    r.adoption!.status = "unselected"; r.adoption!.approval = null; }
  return r;
}
function setup(extra: Partial<PinScheduleClientOptions> = {}) {
  const storage = store(), calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const c = new AttendancePinScheduleClient({ storage: () => storage, enabled: true, randomId: () => id(5), apiFetch: async (url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push({ url, body }); return reply(body.command ? accepted(body) : pinScheduleHttp());
  }, ...extra }); return { c, storage, calls };
}
test("construction/local routing makes no request; exact device/person key, no global enumeration", async () => {
  const { c, storage, calls } = setup(); try { assert.equal(calls.length, 0); assert.equal(pinScheduleOwnsInput(false, device, workerNo, () => storage), false);
    storage.setItem(pinSchedulePendingKey(device, workerNo), JSON.stringify(pending())); assert.equal(pinScheduleOwnsInput(false, device, "pin-01", () => storage), true);
    assert.equal(pinScheduleOwnsInput(false, device, "PIN-02", () => storage), false); assert.equal(pinScheduleOwnsInput(false, { ...device, terminalId: id(20) }, workerNo, () => storage), false);
    assert.equal(pinScheduleOwnsInput(false, device, workerNo, () => { throw Error("storage"); }), true);
  } finally { c.dispose(); }
});
test("pending exact grammar rejects secrets, altered identity, bad selection and duplicate keys", () => {
  const p = pending(); assert.deepEqual(parsePinSchedulePending(JSON.stringify(p), device, workerNo), p);
  for (const patch of [{ pin }, { lease: id(99) }, { workerNo: "OTHER" }, { terminalId: id(21) }, { selection: { ...selection, revision: 0 } }, { command: { ...p.command, action: "clock_out" } }])
    assert.throws(() => parsePinSchedulePending(JSON.stringify({ ...p, ...patch }), device, workerNo));
  assert.throws(() => parsePinSchedulePending(JSON.stringify(p).replace('"version":1', '"version":1,"version":1'), device, workerNo));
});
for (const picked of [selection, null]) test(`authenticated candidate read followed by one exact ${picked ? "selected" : "none"} POST`, async () => {
  const { c, storage, calls } = setup(); try { await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { workerNo, pin, command: null, operationId: null, selection: null }); assert.equal(storage.map.size, 0);
    await c.submit(picked); assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(c.getSnapshot().canConfirm, false); assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body.selection, picked); assert.equal(storage.map.size, 0); assert(!JSON.stringify(c.getSnapshot()).includes(pin));
    await c.submit(null); assert.equal(calls.length, 2); assert(Object.isFrozen(c.getSnapshot().result!.clock.state));
  } finally { c.dispose(); }
});
test("unknown write retains intent; recreation and flag-off PIN-authenticated recovery never submit", async () => {
  const storage = store(); let writes = 0, reads = 0;
  const apiFetch: PinScheduleClientOptions["apiFetch"] = async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.command) { writes++; throw Error("lost"); } reads++; return reply(b.operationId ? pinScheduleHttp(true, false, false) : pinScheduleHttp()); };
  const a = setup({ storage: () => storage, apiFetch }).c; let b: AttendancePinScheduleClient | null = null;
  try { await a.read(workerNo, pin, device); await a.submit(selection); const raw = storage.getItem(pinSchedulePendingKey(device, workerNo)); assert.ok(raw); assert(!raw.includes(pin));
    a.dispose(); b = setup({ enabled: false, storage: () => storage, apiFetch }).c; assert.equal(reads, 1); await b.read(workerNo, pin, device);
    assert.equal(b.getSnapshot().pending, null); assert.equal(b.getSnapshot().canConfirm, false); assert.equal(storage.map.size, 0); await b.submit(null); await b.retry(); assert.equal(writes, 1);
  } finally { a.dispose(); b?.dispose(); }
});
test("undelivered operation is read first then explicitly retried with original command and selection", async () => {
  const storage = store(), commands: unknown[] = []; let writes = 0;
  const { c } = setup({ storage: () => storage, apiFetch: async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.command) { commands.push(b); if (++writes === 1) throw Error("not_delivered"); return reply(accepted(b)); } return reply(pinScheduleHttp()); } });
  try { await c.read(workerNo, pin, device); await c.submit(selection); await c.retry(); assert.equal(writes, 1);
    await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().phase, "unconfirmed"); await c.submit(null); assert.equal(writes, 1);
    await c.read(workerNo, pin, device); await c.retry(); assert.equal(writes, 2); assert.deepEqual(commands[1], commands[0]); assert.equal(storage.map.size, 0);
  } finally { c.dispose(); }
});
test("flag-off unresolved pending remains read-only and never falls back to old clock", async () => {
  const storage = store(); storage.setItem(pinSchedulePendingKey(device, workerNo), JSON.stringify(pending()));
  const { c, calls } = setup({ enabled: false, storage: () => storage }); try { await c.read(workerNo, pin, device); await c.retry(); await c.punch("clock_out");
    assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(calls[0].body.command, null); assert.equal(c.getSnapshot().canConfirm, false); assert.equal(storage.map.size, 1);
  } finally { c.dispose(); }
});
test("two pending choose new read only; old remains and no automatic second authentication", async () => {
  const storage = store(); storage.setItem(pinSchedulePendingKey(device, workerNo), JSON.stringify(pending())); storage.setItem(pinClockPendingKey(device, workerNo), JSON.stringify(legacy()));
  const { c, calls } = setup({ storage: () => storage, apiFetch: async (url, init) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return reply(pinScheduleHttp(true)); } });
  try { await c.read(workerNo, pin, device); assert.equal(calls.length, 1); assert.equal(calls[0].url, endpoint); assert.equal(c.getSnapshot().pending, null);
    assert.ok(c.getSnapshot().legacyPending); assert.equal(c.getSnapshot().canConfirm, false); await c.retry(); assert.equal(calls.length, 1); assert.equal(storage.map.size, 1);
  } finally { c.dispose(); }
});
test("legacy pending routes authenticated original read, never new sidecar POST", async () => {
  const storage = store(); storage.setItem(pinClockPendingKey(device, workerNo), JSON.stringify(legacy())); const seen: string[] = [];
  const { c } = setup({ storage: () => storage, apiFetch: async (url, init) => { seen.push(url); const b = JSON.parse(String(init?.body)); assert.equal(b.command, null); assert(!Object.hasOwn(b, "selection")); return reply({ ok: true, moduleEnabled: true, ...pinScheduleHttp(true).clock }); } });
  try { await c.read(workerNo, pin, device); assert.deepEqual(seen, ["/api/merchant-enterprise/attendance/terminal-clock"]); assert.equal(storage.map.size, 0); assert.equal(c.getSnapshot().result, null); }
  finally { c.dispose(); }
});
test("one PIN owner uses original non-clock-in endpoint; paused starts do not stop authorized finish", async () => {
  const storage = store(), calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const { c } = setup({ storage: () => storage, apiFetch: async (url, init) => { const b = JSON.parse(String(init?.body)); calls.push({ url, body: b });
    if (!b.command) { const r = pinScheduleHttp(true, false, false); r.clock.receipt = null; r.association = null; r.adoption = null; return reply(r); }
    assert(!Object.hasOwn(b, "selection")); assert.equal(storage.map.size, 1); assert.ok(storage.getItem(pinClockPendingKey(device, workerNo)));
    const r = pinScheduleHttp(true).clock, e = { ...r.receipt!, operationId: b.command.operationId, sequence: 2, action: "clock_out" as const };
    r.state = { sequence: 2, status: "off", lastEvent: e }; r.receipt = e; r.canStart = false; return reply({ ok: true, moduleEnabled: false, ...r });
  } });
  try { await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().canConfirm, true); await c.punch("clock_out"); assert.equal(c.getSnapshot().phase, "confirmed");
    assert.equal(calls[1].url, "/api/merchant-enterprise/attendance/terminal-clock"); assert.equal(storage.map.size, 0);
  } finally { c.dispose(); }
});
for (const [error, status] of [["attendance_access_denied", 403], ["attendance_operation_conflict", 409], ["attendance_unavailable", 503]]) test(`${error} retains exact pending and clears visible identity`, async () => {
  const storage = store(), raw = JSON.stringify(pending()); storage.setItem(pinSchedulePendingKey(device, workerNo), raw);
  const { c } = setup({ storage: () => storage, apiFetch: async () => reply({ ok: false, error }, Number(status)) });
  try { await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().clock, null); assert.equal(c.getSnapshot().canConfirm, false); assert.equal(storage.getItem(pinSchedulePendingKey(device, workerNo)), raw); }
  finally { c.dispose(); }
});
test("receipt selection/identity mismatch cannot consume original pending", async () => {
  for (const mutate of [(r: ReturnType<typeof pinScheduleHttp>) => { r.adoption!.employeeId = id(90); }, (r: ReturnType<typeof pinScheduleHttp>) => { r.clock.receipt!.sequence = 2; },
    (r: ReturnType<typeof pinScheduleHttp>) => { r.association!.selection!.revision = 2; }]) {
    const storage = store(), raw = JSON.stringify(pending()); storage.setItem(pinSchedulePendingKey(device, workerNo), raw);
    const { c } = setup({ storage: () => storage, apiFetch: async () => { const r = pinScheduleHttp(true); mutate(r); return reply(r); } });
    try { await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().clock, null); assert.equal(storage.getItem(pinSchedulePendingKey(device, workerNo)), raw); } finally { c.dispose(); }
  }
});
test("synchronous loading subscriber clearing stops request and PIN installation", async () => {
  const { c, calls } = setup(); let once = false; c.subscribe(() => { if (!once && c.getSnapshot().phase === "loading") { once = true; c.clear(); } });
  try { await c.read(workerNo, pin, device); await c.submit(selection); assert.equal(calls.length, 0); assert.equal(c.getSnapshot().clock, null); assert.equal(c.getSnapshot().canConfirm, false); } finally { c.dispose(); }
});
test("synchronous ready subscriber clearing never restores secret after notification", async () => {
  const { c, calls } = setup(); c.subscribe(() => { if (c.getSnapshot().phase === "ready") c.clear(); });
  try { await c.read(workerNo, pin, device); await c.submit(selection); assert.equal(calls.length, 1); assert.equal(c.getSnapshot().canConfirm, false); } finally { c.dispose(); }
});
test("storage write reentrancy leaves persisted original but blocks POST", async () => {
  const storage = store(), { c, calls } = setup({ storage: () => storage }); const write = storage.setItem;
  try { await c.read(workerNo, pin, device); storage.setItem = (key, raw) => { write(key, raw); c.clear(); }; await c.submit(selection);
    assert.equal(calls.length, 1); assert.equal(storage.map.size, 1); assert(![...storage.map.values()].join().includes(pin)); assert.equal(c.getSnapshot().clock, null);
  } finally { c.dispose(); }
});
test("storage replacement or failed clear retains blocked recovery instead of overwriting", async () => {
  const storage = store(), { c, calls } = setup({ storage: () => storage });
  try { await c.read(workerNo, pin, device); const raw = JSON.stringify({ ...pending(), command: { ...pinScheduleCommand(), operationId: id(88) } });
    storage.setItem(pinSchedulePendingKey(device, workerNo), raw); await c.submit(selection); assert.equal(calls.length, 1); assert.equal(c.getSnapshot().phase, "storage_error"); assert.equal(storage.getItem(pinSchedulePendingKey(device, workerNo)), raw);
    storage.removeItem = () => {}; const d = setup({ storage: () => storage, apiFetch: async () => { const r = pinScheduleHttp(true); r.clock.receipt!.operationId = id(88); r.association!.operationId = id(88); r.adoption!.operationId = id(88); return reply(r); } }).c;
    try { await d.read(workerNo, pin, device); assert.equal(d.getSnapshot().phase, "storage_error"); assert.equal(storage.getItem(pinSchedulePendingKey(device, workerNo)), raw); } finally { d.dispose(); }
  } finally { c.dispose(); }
});
test("clear/new-person ignores late body and exposes no previous identity or PIN", async () => {
  let release!: (r: Response) => void; const { c } = setup({ apiFetch: async () => new Promise<Response>(r => { release = r; }) });
  try { const p = c.read(workerNo, pin, device); c.clear(); release(reply(pinScheduleHttp())); await p;
    assert.equal(c.getSnapshot().clock, null); assert.equal(c.getSnapshot().canConfirm, false); assert.equal(c.getSnapshot().device, null);
  } finally { c.dispose(); }
});
test("deadline covers hanging body; fatal UTF8 and oversized/duplicate/error envelopes fail closed", async () => {
  const responses = [() => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    () => reply({ x: "x".repeat(65536) }), () => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    () => reply({ ok: false, error: "attendance_access_denied", extra: true }, 403), () => reply({ ok: false, error: "attendance_access_denied" }, 409)];
  for (const response of responses) { const { c } = setup({ timeoutMs: 10, apiFetch: async () => response() });
    try { await c.read(workerNo, pin, device); assert.equal(c.getSnapshot().clock, null); assert.equal(c.getSnapshot().canConfirm, false); } finally { c.dispose(); }
  }
});
test("PIN expiration clears candidates; now callback reentrancy also prevents secret resurrection", async () => {
  const { c, calls } = setup({ secretMs: 5 }); try { await c.read(workerNo, pin, device); await new Promise(r => setTimeout(r, 20)); await c.submit(selection); assert.equal(calls.length, 1); assert.equal(c.getSnapshot().clock, null); } finally { c.dispose(); }
  const d = setup({ now: () => { d.clear(); return Date.now(); } }).c;
  try { await d.read(workerNo, pin, device); assert.equal(d.getSnapshot().canConfirm, false); assert.equal(d.getSnapshot().clock, null); } finally { d.dispose(); }
});
test("hidden read never authenticates or reveals candidates", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true } });
  const { c, calls } = setup(); try { await c.read(workerNo, pin, device); assert.equal(calls.length, 0); assert.equal(c.getSnapshot().clock, null); }
  finally { c.dispose(); if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
});
