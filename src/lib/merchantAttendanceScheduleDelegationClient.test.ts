import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceScheduleDelegationClient as Client, scheduleDelegationPendingKey, type ScheduleDelegationClientOptions, type ScheduleDelegationPending } from "./merchantAttendanceScheduleDelegationClient";
import { parseScheduleDelegationHttpQuery, parseScheduleDelegationBody, scheduleDelegationFingerprint, type ScheduleDelegationQuery, type ScheduleDelegationCommand } from "./merchantAttendanceScheduleDelegation";
import { scheduleDelegationQuery as query, scheduleDelegationWire as wire, scheduleDelegationReceiptHttp as receipt, scheduleDelegationId as id,
  scheduleDelegationCommand as command, scheduleDelegationGrantCommand as grant } from "../../scripts/fixtures/attendance-schedule-delegation-model";
const http = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { "content-type": "application/json" } });
function fixture(options: Partial<ScheduleDelegationClientOptions> = {}) {
  const values = new Map<string, string>(), reads: string[] = [], writes: string[] = [], calls: { method: string; query: ScheduleDelegationQuery; command: ScheduleDelegationCommand | null }[] = [];
  const storage = { getItem: (k: string) => { reads.push(k); return values.get(k) ?? null; }, setItem: (k: string, v: string) => { writes.push(k); values.set(k, v); }, removeItem: (k: string) => { writes.push(k); values.delete(k); } };
  let post: ((q: ScheduleDelegationQuery, c: ScheduleDelegationCommand) => Promise<Response>) | null = null;
  let get: ((q: ScheduleDelegationQuery) => Promise<Response>) | null = null;
  const client = new Client({ siteId: "98400198", access: "delegate", actorId: id(2), enabled: true, storage: () => storage, randomId: () => id(30),
    apiFetch: async (input, init) => { const method = init?.method ?? "GET";
      const body = method === "POST" ? parseScheduleDelegationBody(JSON.parse(String(init?.body))) : null;
      const q = body?.query ?? parseScheduleDelegationHttpQuery("https://local" + String(input)); calls.push({ method, query: q, command: body?.command ?? null });
      if (body) { assert.ok(values.has(client.storageKey), "durable intent precedes the sole POST"); return post ? post(q, body.command) : http(await receipt(q, body.command)); }
      return get ? get(q) : http({ ok: true, ...wire(q) }); }, ...options });
  return { client, values, calls, reads, writes, storage, post: (fn: typeof post) => { post = fn; }, get: (fn: typeof get) => { get = fn; } };
}
async function prepared(f = fixture()) { await f.client.initialize(); await f.client.load(); await f.client.schedule(id(10), "2026-10-07", "2026-10-08"); return f; }
const publish = (c: Client) => c.publish({ slots: (command().decision as Extract<ReturnType<typeof command>["decision"], { action: "publish" }>).slots, reason: "明确  排班" });
async function pending(access: "owner" | "delegate" = "delegate"): Promise<ScheduleDelegationPending> { const q = access === "owner" ? query("owner") : query("delegate", "schedule"), c = access === "owner" ? grant() : command();
  return { version: 1, anchorId: access === "owner" ? id(1) : id(2), actorId: access === "owner" ? id(1) : id(3), employeeId: access === "owner" ? null : id(2), query: q, command: c, commandFingerprint: await scheduleDelegationFingerprint(q, c) }; }

test("no implicit fetch; publish and cancel each persist before exactly one POST and settle exact receipts", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); await f.client.initialize(); assert.equal(f.calls.length, 0);
  await f.client.load(); await f.client.schedule(id(10), "2026-10-07", "2026-10-08"); await publish(f.client);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.values.size, 0);
  await publish(f.client); assert.equal(f.calls.filter(c => c.method === "POST").length, 1, "receipt does not confer a new-write schedule context");
  await f.client.load(); await f.client.schedule(id(10), "2026-10-07", "2026-10-08"); await f.client.cancel(id(20), "取消");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 2); assert.equal(f.client.getSnapshot().result?.receipt?.action, "cancel");
  assert.ok(f.reads.every(k => k === f.client.storageKey));
});
test("unknown write, null recovery, wrong actor/hash and GET errors keep the original bytes; only matching GET clears", async () => {
  const f = await prepared(); f.post(async () => { throw Error("network lost"); }); await publish(f.client); const raw = f.values.get(f.client.storageKey)!;
  assert.ok(raw); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); await publish(f.client); await f.client.load(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  await f.client.recover(); assert.equal(f.values.get(f.client.storageKey), raw);
  f.get(async () => http({ ok: false, error: "attendance_version_conflict" }, 409)); await f.client.recover(); assert.equal(f.values.get(f.client.storageKey), raw);
  const p = JSON.parse(raw) as ScheduleDelegationPending;
  for (const field of ["actorId", "commandFingerprint"] as const) { f.get(async q => { const r = await receipt(p.query, p.command, q); r.receipt[field] = field === "actorId" ? id(90) : "0".repeat(64); return http(r); });
    await f.client.recover(); assert.equal(f.values.get(f.client.storageKey), raw); }
  f.get(async q => http(await receipt(p.query, p.command, q))); await f.client.recover(); assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().pending, null);
  assert.ok(f.calls.slice(3).every(c => c.method === "GET"));
});
test("only exact typed POST no-write rejections clear; fake network names, status mismatch, operation conflict and 503 retain", async () => {
  for (const code of ["attendance_version_conflict", "attendance_schedule_delegation_changed", "attendance_schedule_overlap", "attendance_account_suspended"] as const) {
    const f = await prepared(); f.post(async () => http({ ok: false, error: code }, 409)); await publish(f.client); assert.equal(f.values.size, 0, code); assert.equal(f.client.getSnapshot().phase, "blocked"); }
  for (const kind of ["fake", "status", "conflict", "503", "extra"] as const) { const f = await prepared(); f.post(async () => {
    if (kind === "fake") throw Error("attendance_version_conflict"); return http({ ok: false, error: kind === "conflict" ? "attendance_operation_conflict" : kind === "503" ? "attendance_schedule_delegation_invalid" : "attendance_version_conflict",
      ...(kind === "extra" ? { private: "no" } : {}) }, kind === "status" ? 400 : kind === "503" ? 503 : 409); }); await publish(f.client); assert.equal(f.values.size, 1, kind); }
});
test("CAS/live-auth/lease invalidation cannot remove or display a late receipt", async () => {
  for (const kind of ["CAS", "auth", "pause"] as const) { let live = true; const f = await prepared(fixture({ isCurrentAuth: () => live }));
    let release!: (r: Response) => void; let q!: ScheduleDelegationQuery, c!: ScheduleDelegationCommand;
    f.post(async (query, command) => { q = query; c = command; return new Promise<Response>(r => { release = r; }); });
    const write = publish(f.client); while (!release) await new Promise(r => setTimeout(r, 0));
    if (kind === "CAS") f.values.set(f.client.storageKey, "different-intent"); if (kind === "auth") live = false; if (kind === "pause") f.client.pause();
    release(http(await receipt(q, c))); await write; assert.equal(f.client.getSnapshot().result, null); assert.ok(f.values.has(f.client.storageKey));
    if (kind === "CAS") assert.equal(f.values.get(f.client.storageKey), "different-intent"); }
});
test("synchronous subscriber pause cannot strand an unpublished in-memory intent", async () => {
  const f = await prepared(); let paused = false;
  const unsubscribe = f.client.subscribe(() => { if (!paused && f.client.getSnapshot().pending) { paused = true; assert.ok(f.values.has(f.client.storageKey)); f.client.pause(); } });
  await publish(f.client); unsubscribe(); assert.equal(paused, true); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  const raw = f.values.get(f.client.storageKey)!; assert.ok(raw); await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  await f.client.recover(); assert.equal(f.values.get(f.client.storageKey), raw, "GET null does not discard the durable, unsent intent");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});
test("pre-persistence pause leaves no intent; storage reentrancy/throw-after-write preserves discoverable durable bytes without POST", async () => {
  const before = await prepared(); let paused = false;
  const unsubscribe = before.client.subscribe(() => { if (!paused && before.client.getSnapshot().phase === "saving") { paused = true; before.client.pause(); } });
  await publish(before.client); unsubscribe(); assert.equal(before.values.size, 0); assert.equal(before.client.getSnapshot().pending, null);
  await before.client.initialize(); await before.client.load(); assert.equal(before.client.getSnapshot().phase, "ready"); assert.equal(before.calls.filter(c => c.method === "POST").length, 0);
  for (const kind of ["pause", "throw_after", "throw_before"] as const) { const f = await prepared(), original = f.storage.setItem;
    f.storage.setItem = (key, raw) => { if (kind !== "throw_before") original(key, raw); if (kind === "pause") f.client.pause(); else throw Error("storage failed"); };
    await publish(f.client); assert.equal(f.calls.filter(c => c.method === "POST").length, 0); assert.equal(f.client.getSnapshot().pending, null);
    f.storage.setItem = original; await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, kind === "throw_before" ? "idle" : "unconfirmed");
    assert.equal(f.values.size, kind === "throw_before" ? 0 : 1);
  }
});
test("recovery-only reload binds current Auth and employee anchor; changed Auth/corrupt bytes never scan or delete", async () => {
  const p = await pending(), raw = JSON.stringify(p);
  for (const auth of [id(3), id(99)]) { const f = fixture({ enabled: false, recoveryOnly: true, expectedAuthUserId: auth }); f.values.set(f.client.storageKey, raw);
    await f.client.initialize(); await f.client.load(); await f.client.catalog("workers"); await publish(f.client); assert.equal(f.calls.length, 0);
    f.get(async q => http(await receipt(p.query, p.command, q))); await f.client.recover(); assert.equal(f.calls.length, auth === id(3) ? 1 : 0);
    assert.equal(f.values.has(f.client.storageKey), auth !== id(3)); assert.ok(f.reads.every(k => k === f.client.storageKey)); }
  for (const raw of ["{", JSON.stringify({ ...p, employeeId: id(99) }), JSON.stringify({ ...p, commandFingerprint: "0".repeat(64) })]) { const f = fixture(); f.values.set(f.client.storageKey, raw);
    await f.client.initialize(); await f.client.load(); assert.equal(f.calls.length, 0); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.hasLeaveRisk(), true); }
  assert.throws(() => new Client({ siteId: "98400198", access: "delegate", actorId: id(2), apiFetch: async () => http({}), storage: () => ({ getItem: () => null, setItem() {}, removeItem() {} }), enabled: false, recoveryOnly: true }));
  assert.equal(scheduleDelegationPendingKey("98400198", "delegate", id(2)), "faolla:attendance:schedule-delegation:v1:98400198:delegate:" + id(2));
});
test("owner catalog selections are exact, persist across catalog pages, and grant consumes three actual choices", async () => {
  const f = fixture({ access: "owner", actorId: id(1) }); await f.client.initialize();
  await f.client.catalog("delegates"); const d = f.client.getSnapshot().result!.catalogItems[0]; f.client.selectDelegate({ ...d, employeeAuthUserId: id(88) }); assert.equal(f.client.getSnapshot().choices.delegate, null); f.client.selectDelegate(d);
  await f.client.catalog("workers"); f.client.selectWorker(f.client.getSnapshot().result!.catalogItems[0]); await f.client.catalog("locations"); f.client.selectLocation(f.client.getSnapshot().result!.catalogItems[0]);
  assert.ok(f.client.getSnapshot().choices.delegate); assert.ok(f.client.getSnapshot().choices.worker);
  await f.client.grant({ actions: ["publish", "cancel"], includeExistingFuture: true, validFrom: grant().validFrom, validUntil: grant().validUntil, reason: "授权" });
  assert.equal(f.client.getSnapshot().result?.receipt?.action, "grant"); assert.equal(f.calls.filter(x => x.method === "POST").length, 1);
});
test("owner off-switch still reads and safely revokes; delegate off-switch cannot fetch ordinary authority", async () => {
  const f = fixture({ access: "owner", actorId: id(1), enabled: false }); await f.client.initialize(); await f.client.load(); await f.client.detailGrant(id(10));
  assert.equal(f.client.getSnapshot().result?.detail?.grantId, id(10)); await f.client.revoke(id(10), "撤销"); assert.equal(f.client.getSnapshot().result?.receipt?.action, "revoke");
  const delegate = fixture({ enabled: false }); await delegate.client.initialize(); await delegate.client.load(); assert.equal(delegate.calls.length, 0);
});
test("transport strict status, UTF8, content type, bounded body and total body deadline retain unknown intent", async () => {
  for (const kind of ["201", "utf8", "type", "large", "stall", "duplicate"] as const) {
    const f = await prepared(fixture({ timeoutMs: 25 })); f.post(async (q, c) => {
      if (kind === "201") return http(await receipt(q, c), 201);
      if (kind === "utf8") return new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } });
      if (kind === "type") return new Response("{}", { headers: { "content-type": "text/html" } });
      if (kind === "large") return http({ text: "x".repeat(131073) });
      if (kind === "duplicate") return new Response('{"ok":true,"ok":false}', { headers: { "content-type": "application/json" } });
      return new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }), { headers: { "content-type": "application/json" } }); });
    await publish(f.client); assert.equal(f.values.size, 1, kind); assert.equal(f.client.getSnapshot().phase, "unconfirmed", kind);
  }
});
