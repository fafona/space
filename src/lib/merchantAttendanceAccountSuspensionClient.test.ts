import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAccountSuspensionClient, AttendanceAccountStatusClient, accountStatusPendingKey, type AccountSuspensionClientOptions } from "./merchantAttendanceAccountSuspensionClient";
import { accountSuspensionHttp as wire, accountSuspensionOwner as owner, accountSuspensionSite as site, accountSuspensionCommand as command,
  accountStatusCommand as status, accountSuspensionReceiptHttp as receipt, accountStatusReceiptHttp as statusReceipt, accountSuspensionId as id } from "../../scripts/fixtures/attendance-account-suspension-model";
const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
function setup(fetch: AccountSuspensionClientOptions["apiFetch"], patch: Partial<AccountSuspensionClientOptions> = {}) { const data = new Map<string, string>(); const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const options: AccountSuspensionClientOptions = { siteId: site, actorId: owner, apiFetch: fetch, storage: () => storage, randomId: () => id(20), ...patch }; return { data, storage, options }; }
const intent = () => { const { operationId, ...v } = status(); void operationId; return v; };
test("initialize is local only; explicit list/detail GET and one restore use exact saved identity/version", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = []; const f = setup(async (url, init) => { calls.push({ url: String(url), init }); if (init?.method === "POST") return reply({ ...await receipt(), mode: "detail", detail: null }); return reply(wire(String(url).includes("mode=detail") ? "detail" : "list")); });
  const c = new AttendanceAccountSuspensionClient(f.options); await c.initialize(); assert.equal(calls.length, 0); await c.load(); await c.detail(id(10)); await c.restore(command().reason);
  assert.equal(calls.length, 3); assert.deepEqual(JSON.parse(String(calls[2].init?.body)).command, command()); assert.equal(c.getSnapshot().pending, null); assert.equal(f.data.size, 0); assert.ok(c.getSnapshot().result?.receipt);
});
test("status PATCH success always GETs original receipt before clearing and never guesses from employee snapshot", async () => {
  const calls: string[] = []; const f = setup(async (_, init) => { calls.push(init?.method ?? ""); if (init?.method === "PATCH") { assert.equal(f.data.size, 1); assert.deepEqual(JSON.parse(String(init.body)), { siteId: site, ...status() }); return reply({ ok: true, employee: { id: status().employeeId, version: 2, status: "disabled" } }); } return reply(await statusReceipt()); });
  const c = new AttendanceAccountStatusClient(f.options); await c.initialize(); await c.submit(intent()); assert.deepEqual(calls, ["PATCH", "GET"]); assert.equal(c.getSnapshot().pending, null); assert.ok(c.getSnapshot().result?.statusReceipt);
});
test("lost status response survives reload and recover is GET-only; null/error never clear unknown", async () => {
  let count = 0; const f = setup(async () => { count++; throw Error("lost"); }); const c = new AttendanceAccountStatusClient(f.options); await c.initialize(); await c.submit(intent()); assert.equal(count, 1); assert.ok(c.getSnapshot().pending); const saved = f.data.get(c.storageKey);
  for (const response of [reply(wire("recover-status")), reply({ ok: false, error: "attendance_access_denied" }, 403)]) { const d = new AttendanceAccountStatusClient({ ...f.options, apiFetch: async (_, init) => { assert.equal(init?.method, "GET"); return response; } }); await d.initialize(); await d.recover(); assert.equal(f.data.get(c.storageKey), saved); assert.ok(d.getSnapshot().pending); }
  const d = new AttendanceAccountStatusClient({ ...f.options, apiFetch: async (_, init) => { assert.equal(init?.method, "GET"); return reply(await statusReceipt()); } }); await d.initialize(); await d.recover(); assert.equal(d.getSnapshot().pending, null); assert.equal(f.data.size, 0);
});
test("pause and live auth change prevent late settle or storage deletion", async () => {
  let release!: (r: Response) => void, current = true; const f = setup(async () => new Promise<Response>(r => { release = r; }), { isCurrentAuth: () => current }); const c = new AttendanceAccountStatusClient(f.options); await c.initialize(); const p = c.submit(intent());
  await new Promise(r => setTimeout(r, 10)); current = false; release(reply({ ok: true, employee: { id: status().employeeId, version: 2, status: "disabled" } })); await p; assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null); assert.equal(f.data.size, 1);
  const d = new AttendanceAccountStatusClient({ ...f.options, isCurrentAuth: () => true }); await d.initialize(); const recovery = d.recover(); await new Promise(r => setTimeout(r, 5)); d.pause(); release(reply(await statusReceipt())); await recovery; assert.equal(d.getSnapshot().result, null); assert.equal(f.data.size, 1);
});
test("subscriber reentrancy cannot send after pause and storage compare-and-swap will not delete changed intents", async () => {
  let calls = 0; const f = setup(async () => { calls++; return reply(await statusReceipt()); }); const c = new AttendanceAccountStatusClient(f.options); await c.initialize(); const unsub = c.subscribe(() => { if (c.getSnapshot().phase === "saving") c.pause(); }); await c.submit(intent()); unsub(); assert.equal(calls, 0);
  const seed = new AttendanceAccountStatusClient({ ...f.options, apiFetch: async () => { throw Error("lost"); } }); await seed.initialize(); await seed.submit(intent()); const saved = f.data.get(seed.storageKey)!;
  const d = new AttendanceAccountStatusClient({ ...f.options, apiFetch: async () => { f.data.set(seed.storageKey, saved + " "); return reply(await statusReceipt()); } }); await d.initialize(); await d.recover(); assert.equal(f.data.get(seed.storageKey), saved + " "); assert.ok(d.getSnapshot().pending); assert.equal(d.getSnapshot().result, null);
});
test("wrong actor/op/hash receipts and corrupted/foreign local records fail closed", async () => {
  const f = setup(async () => { throw Error("lost"); }); const c = new AttendanceAccountStatusClient(f.options); await c.initialize(); await c.submit(intent()); const saved = f.data.get(c.storageKey)!;
  for (const patch of [{ actorId: id(99) }, { operationId: id(99) }, { commandFingerprint: "0".repeat(64) }]) { const d = new AttendanceAccountStatusClient({ ...f.options, apiFetch: async () => { const r = await statusReceipt(); return reply({ ...r, statusReceipt: { ...r.statusReceipt!, ...patch } }); } }); await d.initialize(); await d.recover(); assert.ok(d.getSnapshot().pending); assert.equal(f.data.get(c.storageKey), saved); }
  f.data.set(accountStatusPendingKey(site, id(99)), saved); const other = new AttendanceAccountStatusClient({ ...f.options, actorId: id(99) }); await other.initialize(); assert.equal(other.getSnapshot().phase, "blocked"); assert.equal(other.getSnapshot().pending, null);
});
test("strict response stream bounds, malformed UTF8/JSON and total header timeout retain durable intent", async () => {
  for (const response of [new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }), new Response("x".repeat(4097), { status: 503, headers: { "content-type": "application/json" } })]) {
    const f = setup(async () => response), c = new AttendanceAccountStatusClient(f.options); await c.initialize(); await c.submit(intent()); assert.ok(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null); }
  const f = setup(async () => new Promise<Response>(() => {}), { timeoutMs: 10 }), c = new AttendanceAccountStatusClient(f.options); await c.initialize(); await c.submit(intent()); assert.ok(c.getSnapshot().pending);
});
