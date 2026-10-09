// Synthetic storage/HTTP only; capabilities are fixtures, not real authority.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceAdministrativeClosureClient, administrativeClosurePendingKey, parseAdministrativeClosurePending, type AdministrativeClosureClientOptions } from "./merchantAttendanceAdministrativeClosureClient";
import { ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT, parseAdministrativeClosureHttpQuery, type AdministrativeClosureCommand, type AdministrativeClosureQuery } from "./merchantAttendanceAdministrativeClosure";
import { closureId, closureSite, closureOwner, closureSelf, closureQuery, closureCommand, closureCandidate, closureSavedDetail, closureResult, closureReceiptResult } from "./merchantAttendanceAdministrativeClosureTestFixtures";
type Call = { method: string; query: AdministrativeClosureQuery; command: AdministrativeClosureCommand | null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function setup(overrides: Partial<AdministrativeClosureClientOptions> = {}) {
  const values = new Map<string, string>(), calls: Call[] = []; let current = true;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, value: string) => { values.set(k, value); }, removeItem: (k: string) => { values.delete(k); } };
  const options: AdministrativeClosureClientOptions = { siteId: closureSite, access: "owner", authUserId: closureOwner, enabled: true, storage: () => storage, isCurrentAuth: () => current, randomId: () => closureId(100),
    apiFetch: async (url, init) => { const method = init?.method ?? "GET", body = method === "POST" ? JSON.parse(String(init?.body)) : null,
      q = body?.query ?? parseAdministrativeClosureHttpQuery("https://local.invalid" + url), command = body?.command ?? null; calls.push({ method, query: q, command });
      if (command) { assert.ok(values.get(administrativeClosurePendingKey(closureSite, options.authUserId)), "full intent must be durable before POST"); return json({ ok: true, data: await closureReceiptResult(command, q, options.authUserId) }); }
      if (q.mode === "candidate") return json({ ok: true, data: closureResult({ kind: "candidate", detail: closureCandidate() }, q, options.authUserId) });
      if (q.mode === "detail") return json({ ok: true, data: closureResult({ kind: "detail", detail: await closureSavedDetail(q.access, q.access === "owner") }, q, options.authUserId) });
      if (q.mode === "recover") return json({ ok: true, data: closureResult({ kind: "receipt", receipt: null }, q, options.authUserId) });
      return json({ ok: true, data: closureResult({ kind: "list", items: [], nextAfterId: null }, q, options.authUserId) }); }, ...overrides };
  const client = new AttendanceAdministrativeClosureClient(options);
  return { client, options, values, storage, calls, setCurrent: (value: boolean) => { current = value; } };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function ready(s: ReturnType<typeof setup>) { await s.client.initialize(); await s.client.candidate(closureId(3)); }
test("195 initialization is local-only; fresh candidate then one durable full-intent POST clears exact receipt", async () => {
  const s = setup(); await s.client.initialize(); assert.equal(s.calls.length, 0); await s.client.submit(closureCommand()); assert.equal(s.calls.length, 0);
  await s.client.candidate(closureId(3)); await s.client.submit(closureCommand()); assert.deepEqual(s.calls.map(c => c.method), ["GET", "POST"]);
  assert.equal(s.client.getSnapshot().pending, null); assert.equal(s.values.size, 0); assert.equal(s.client.getSnapshot().result?.data.kind, "receipt");
  await s.client.submit({ ...closureCommand(), operationId: closureId(200) }); assert.equal(s.calls.length, 2, "receipt does not grant another write"); s.client.dispose();
});
test("195 unknown response persists original bytes; reload and GET null never retry or clear", async () => {
  const s = setup(), base = s.options.apiFetch; s.options.apiFetch = async (url, init) => init?.method === "POST" ? Promise.reject(Error("lost response")) : base(url, init);
  const c = new AttendanceAdministrativeClosureClient(s.options); await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand());
  const raw = s.values.get(c.storageKey)!; assert.ok(raw); c.dispose(); const recovered = new AttendanceAdministrativeClosureClient({ ...s.options, enabled: false });
  await recovered.initialize(); const before = s.calls.length; await recovered.list(); assert.equal(s.calls.length, before); await recovered.recover();
  assert.equal(s.values.get(c.storageKey), raw); assert.ok(recovered.getSnapshot().pending); assert.equal(s.calls.at(-1)?.method, "GET"); assert.equal(s.calls.at(-1)?.query.mode, "recover"); recovered.dispose();
});
test("195 original pending across owner/self UI recovers its saved access and full hash only", async () => {
  const s = setup(), base = s.options.apiFetch; let fail = true;
  const apiFetch: AdministrativeClosureClientOptions["apiFetch"] = async (url, init) => { if (init?.method === "POST" && fail) throw Error("unknown");
    if (String(url).includes("mode=recover")) { const q = parseAdministrativeClosureHttpQuery("https://local.invalid" + url); return json({ ok: true, data: await closureReceiptResult(closureCommand(), q, closureOwner) }); } return base(url, init); };
  const c = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch }); await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand()); c.dispose(); fail = false;
  const next = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch, access: "self", enabled: false }); await next.initialize(); await next.recover();
  assert.equal(next.getSnapshot().pending, null); assert.equal(next.getSnapshot().result?.access, "owner"); await next.dispute("Synthetic"); assert.equal(s.values.size, 0); next.dispose();
});
test("195 current fresh CAS/source/capability are mandatory; closing flag does not block saved self dispute/owner response", async () => {
  const s = setup(); await ready(s);
  for (const c of [{ ...closureCommand(), expectedRevision: 1 }, { ...closureCommand(), expectedSourceFingerprint: "b".repeat(64) }, { ...closureCommand(), verifiedEndAt: "2026-10-08T13:00:00.000000Z" }]) await s.client.submit(c);
  assert.equal(s.calls.length, 1); s.client.dispose();
  const off = setup({ enabled: false }); await ready(off); await off.client.recordUnknown("Synthetic unknown"); assert.equal(off.calls.length, 1); off.client.dispose();
  const self = setup({ enabled: false, access: "self", authUserId: closureSelf, randomId: () => closureId(101) }); await self.client.initialize(); await self.client.detail(closureId(6)); await self.client.dispute("Synthetic self disagreement");
  assert.equal(self.calls.at(-1)?.command?.action, "self_dispute"); assert.equal(self.client.getSnapshot().pending, null); self.client.dispose();
  const owner = setup({ enabled: false, randomId: () => closureId(102) }); await owner.client.initialize(); await owner.client.detail(closureId(6));
  await owner.client.respond(closureId(999), "Unseen dispute"); assert.equal(owner.calls.length, 1); await owner.client.respond(closureId(101), "Synthetic response"); assert.equal(owner.calls.at(-1)?.command?.action, "owner_respond"); owner.client.dispose();
});
test("195 any rejection, including changed/disabled, retains original intent and grants no local-clear proof", async () => {
  for (const [code, status] of [["attendance_administrative_closure_changed", 409], ["attendance_administrative_closure_disabled", 403], ["attendance_operation_conflict", 409]] as const) {
    const s = setup(), base = s.options.apiFetch, c = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch: (url, init) => init?.method === "POST" ? Promise.resolve(json({ ok: false, error: { code, message: "Synthetic rejection" } }, status)) : base(url, init) });
    await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand()); assert.ok(c.getSnapshot().pending); assert.equal(c.hasLeaveRisk(), true);
    assert.equal("endRejectedAttempt" in c, false); const raw = s.values.get(c.storageKey); await c.recover(); assert.equal(s.values.get(c.storageKey), raw); c.dispose();
  }
});
test("195 malformed/foreign pending blocks without overwriting; initialization hash also has deadline", async t => {
  const s = setup(); s.values.set(s.client.storageKey, "not-json"); await s.client.initialize(); await s.client.candidate(closureId(3)); assert.equal(s.calls.length, 0); assert.equal(s.values.get(s.client.storageKey), "not-json"); s.client.dispose();
  const original = setup(), c = new AttendanceAdministrativeClosureClient({ ...original.options, apiFetch: async (url, init) => { if (init?.method === "POST") throw Error("unknown"); return original.options.apiFetch(url, init); } });
  await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand()); const raw = original.values.get(c.storageKey)!; c.dispose();
  await assert.rejects(parseAdministrativeClosurePending(raw, { siteId: closureSite, authUserId: closureSelf }));
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {})); const bounded = new AttendanceAdministrativeClosureClient({ ...original.options, timeoutMs: 10 });
  await bounded.initialize(); assert.equal(bounded.getSnapshot().phase, "blocked"); assert.equal(original.values.get(c.storageKey), raw); bounded.dispose();
});
test("195 storage write failure or observer replacement prevents POST; no overwrite/remove", async () => {
  const broken = setup({ storage: () => ({ getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => assert.fail("must not remove") }) }); await ready(broken); await broken.client.submit(closureCommand()); assert.equal(broken.calls.length, 1); broken.client.dispose();
  const s = setup(); await ready(s); s.client.subscribe(() => { if (s.client.getSnapshot().pending) s.values.set(s.client.storageKey, "replacement"); });
  await s.client.submit(closureCommand()); assert.equal(s.calls.length, 1); assert.equal(s.values.get(s.client.storageKey), "replacement"); s.client.dispose();
});
test("195 replacement storage after response is never removed even if receipt matches", async () => {
  const s = setup(), base = s.options.apiFetch;
  const c = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch: async (url, init) => { const r = await base(url, init); if (init?.method === "POST") s.values.set(c.storageKey, "other writer"); return r; } });
  await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand()); assert.equal(s.values.get(c.storageKey), "other writer"); assert.ok(c.getSnapshot().pending); c.dispose();
});
test("195 receipt mismatch or HTTP status mismatch never clears durable intent", async () => {
  for (const mismatch of ["actor", "command", "status"] as const) {
    const s = setup(), base = s.options.apiFetch;
    const c = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch: async (url, init) => {
      if (init?.method !== "POST") return base(url, init); const r = await closureReceiptResult(mismatch === "command" ? { ...closureCommand(), reason: "Other intent" } : closureCommand(), closureQuery(), mismatch === "actor" ? closureSelf : closureOwner);
      return json({ ok: true, data: r }, mismatch === "status" ? 201 : 200); } });
    await c.initialize(); await c.candidate(closureId(3)); await c.submit(closureCommand()); assert.ok(c.getSnapshot().pending); assert.ok(s.values.get(c.storageKey)); c.dispose();
  }
});
test("195 Auth change and pause isolate delayed headers/body; original pending remains", async () => {
  for (const phase of ["headers", "body"] as const) {
    const s = setup(), base = s.options.apiFetch; let finish!: () => void, started!: () => void;
    const arrived = new Promise<void>(r => { started = r; }), hold = new Promise<void>(r => { finish = r; });
    const c = new AttendanceAdministrativeClosureClient({ ...s.options, apiFetch: async (url, init) => {
      if (init?.method !== "POST") return base(url, init); const text = JSON.stringify({ ok: true, data: await closureReceiptResult() });
      if (phase === "headers") { started(); await hold; return new Response(text, { headers: { "content-type": "application/json" } }); }
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text.slice(0, 1))); started(); void hold.then(() => { try { controller.enqueue(new TextEncoder().encode(text.slice(1))); controller.close(); } catch { /* cancellation */ } }); } }), { headers: { "content-type": "application/json" } }); } });
    await c.initialize(); await c.candidate(closureId(3)); const writing = c.submit(closureCommand()); await arrived; const raw = s.values.get(c.storageKey); assert.ok(raw);
    if (phase === "headers") s.setCurrent(false); c.pause(); finish(); await writing; await tick(); assert.equal(s.values.get(c.storageKey), raw); assert.equal(c.getSnapshot().result, null); c.dispose();
  }
});
test("195 hidden first initialization remains local; hidden/hide do not transport or clear unknown", async t => {
  let isHidden = true; const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, "document", prior); else Reflect.deleteProperty(globalThis, "document"); });
  const s = setup(); await s.client.initialize(); await s.client.candidate(closureId(3)); assert.equal(s.calls.length, 0);
  isHidden = false; await s.client.initialize(); await s.client.candidate(closureId(3)); assert.equal(s.calls.length, 1);
  isHidden = true; await s.client.submit(closureCommand()); assert.equal(s.calls.length, 1); assert.equal(s.client.getSnapshot().result, null); s.client.dispose();
});
test("195 bounded fatal UTF8 and nonterminating streams fail closed and cancel", async () => {
  for (const kind of ["utf8", "oversize", "stalled"] as const) {
    let cancelled = false; const s = setup({ timeoutMs: 15, apiFetch: async () => new Response(kind === "stalled" ? new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } }) : kind === "utf8" ? new Uint8Array([0xff]) : "x".repeat(ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT + 1), { headers: { "content-type": "application/json" } }) });
    await s.client.initialize(); await s.client.candidate(closureId(3)); assert.equal(s.client.getSnapshot().phase, "blocked"); if (kind === "stalled") assert.equal(cancelled, true); s.client.dispose();
  }
});
test("195 SHA deadline covers pre-POST intent hash; late digest cannot write local intent", async t => {
  const s = setup({ timeoutMs: 15 }); await ready(s); const original = crypto.subtle.digest.bind(crypto.subtle); let finish!: () => void;
  const hold = new Promise<void>(r => { finish = r; }); t.mock.method(crypto.subtle, "digest", async (...args: Parameters<SubtleCrypto["digest"]>) => { await hold; return original(...args); });
  await s.client.submit(closureCommand()); assert.equal(s.values.size, 0); assert.equal(s.calls.length, 1); finish(); await tick(); assert.equal(s.values.size, 0); s.client.dispose();
});
test("195 workers pages replace rather than accumulate; stale/foreign scope never grants a write", async () => {
  let read = 0; const s = setup({ apiFetch: async url => { const q = parseAdministrativeClosureHttpQuery("https://local.invalid" + url); assert.equal(q.mode, "workers");
    const start = read++ ? 200 : 100, items = Array.from({ length: start === 100 ? 25 : 1 }, (_, n) => ({ workerId: closureId(start + n), employeeId: null, employeeAuthUserId: null, workerNo: `W${start + n}`, displayName: "Synthetic worker", paused: true }));
    return json({ ok: true, data: closureResult({ kind: "workers", items, nextAfterId: start === 100 ? items[24].workerId : null }, q) }); } });
  await s.client.initialize(); await s.client.workers(); await s.client.nextPage(); const d = s.client.getSnapshot().result?.data; assert.equal(d?.kind, "workers"); if (d?.kind === "workers") assert.equal(d.items.length, 1);
  await s.client.submit(closureCommand()); assert.equal(read, 2); await s.client.load({ siteId: "99990002", access: "owner", mode: "list", afterId: null }); assert.equal(read, 2); s.client.dispose();
});
