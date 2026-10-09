// Synthetic metadata/HTTP/storage, not proof of a real SQL disposition.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceRetentionDisposalExecutionClient as Client, disposalExecutionPendingKey, parseDisposalExecutionPending, type DisposalExecutionClientOptions } from "./merchantAttendanceRetentionDisposalExecutionClient";
import { parseDisposalExecutionHttpQuery, type DisposalExecutionQuery, type DisposalExecutionCommand } from "./merchantAttendanceRetentionDisposalExecution";
import { disposalActor, disposalSite, disposalId as id, disposalApprove, disposalPreview, disposalReceipt, disposalResult } from "../../scripts/fixtures/attendance-retention-disposal-execution-model";
type Call = { method: string; query: DisposalExecutionQuery; command: DisposalExecutionCommand | null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function setup(overrides: Partial<DisposalExecutionClientOptions> = {}) {
  const values = new Map<string, string>(), calls: Call[] = []; let current = true, next = 7;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const options: DisposalExecutionClientOptions = { siteId: disposalSite, authUserId: disposalActor, enabled: true, storage: () => storage, isCurrentAuth: () => current, randomId: () => id(next++),
    apiFetch: async (url, init) => { const method = init?.method ?? "GET", b = method === "POST" ? JSON.parse(String(init?.body)) : null;
      const query = b?.query ?? parseDisposalExecutionHttpQuery("https://local.invalid" + url), command = b?.command ?? null; calls.push({ method, query, command });
      if (command) { assert(values.has(disposalExecutionPendingKey(disposalSite, disposalActor)), "durable complete intent must precede POST");
        return json({ ok: true, data: disposalResult({ kind: "receipt", receipt: await disposalReceipt(command) }) }); }
      return json({ ok: true, data: disposalResult(query.mode === "recover" ? { kind: "receipt", receipt: null } : { kind: "preview", preview: await disposalPreview() }) }); }, ...overrides };
  return { options, values, calls, storage, setCurrent: (v: boolean) => { current = v; } };
}
async function ready(c: Client) { await c.initialize(); await c.preview(id(2)); }
test("initialization is local; approval is one durable POST and never auto-executes", async () => {
  const s = setup(), c = new Client(s.options); await c.initialize(); assert.equal(s.calls.length, 0);
  await c.approve("Synthetic approval"); assert.equal(s.calls.length, 0);
  await c.preview(id(2)); await c.approve("Synthetic approval"); assert.deepEqual(s.calls.map(x => x.method), ["GET", "POST"]);
  assert.equal(c.getSnapshot().pending, null); assert.equal(s.values.size, 0); assert.match(c.getSnapshot().message, /尚未执行/);
  await c.execute(id(7)); assert.equal(s.calls.length, 2, "approval receipt is not a fresh execution source");
  await c.preview(id(2)); await c.execute(id(7)); assert.equal(s.calls.at(-1)?.command?.action, "execute"); assert.equal(s.calls.length, 4); c.dispose();
});
test("lost write response, disabled reload and GET null retain exact original bytes with no retry", async () => {
  const s = setup(), base = s.options.apiFetch, apiFetch: DisposalExecutionClientOptions["apiFetch"] = (url, init) => init?.method === "POST" ? Promise.reject(Error("unknown")) : base(url, init);
  const c = new Client({ ...s.options, apiFetch }); await ready(c); await c.approve("Synthetic approval"); const raw = s.values.get(c.storageKey)!; assert(raw); c.dispose();
  const next = new Client({ ...s.options, apiFetch, enabled: false }); const count = s.calls.length; await next.initialize(); await next.preview(id(2)); await next.execute(id(7)); assert.equal(s.calls.length, count);
  await next.recover(); assert.equal(s.calls.at(-1)?.query.mode, "recover"); assert.equal(s.values.get(next.storageKey), raw); assert(next.getSnapshot().pending); next.dispose();
});
test("only an exact saved-command receipt clears pending; matching GET works with flag disabled", async () => {
  const s = setup(), base = s.options.apiFetch; let saved: DisposalExecutionCommand | null = null, mismatch = true;
  const apiFetch: DisposalExecutionClientOptions["apiFetch"] = async (url, init) => {
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)).command; throw Error("unknown"); }
    if (String(url).includes("mode=recover")) { assert(saved); const receipt = await disposalReceipt(saved);
      return json({ ok: true, data: disposalResult({ kind: "receipt", receipt: mismatch ? { ...receipt, commandFingerprint: "f".repeat(64) } : receipt }) }); }
    return base(url, init);
  };
  const c = new Client({ ...s.options, apiFetch }); await ready(c); await c.approve("Synthetic approval"); const raw = s.values.get(c.storageKey)!; c.dispose();
  const next = new Client({ ...s.options, apiFetch, enabled: false }); await next.initialize(); await next.recover(); assert.equal(s.values.get(c.storageKey), raw);
  mismatch = false; await next.recover(); assert.equal(next.getSnapshot().pending, null); assert.equal(s.values.size, 0); assert.equal(next.getSnapshot().result?.data.kind, "receipt"); next.dispose();
});
test("stale preview hashes, blocked candidate and disabled client cannot create any write", async () => {
  const s = setup(), c = new Client(s.options); await ready(c); const command = await disposalApprove();
  assert.equal(command.action, "approve"); if (command.action !== "approve") return;
  await c.submit({ ...command, expectedPolicyFingerprint: "f".repeat(64) }); assert.equal(s.calls.length, 1); c.dispose();
  const off = new Client({ ...s.options, enabled: false }); await ready(off); await off.approve("Disabled"); assert.equal(s.calls.length, 2); off.dispose();
  const b = setup({ apiFetch: async () => json({ ok: true, data: disposalResult({ kind: "preview", preview: await disposalPreview(undefined, { eventCovered: false, artifactsComplete: true, artifactLimitExceeded: false, alreadyDisposed: false }) }) }) });
  const blocked = new Client(b.options); await ready(blocked); await blocked.approve("Blocked"); assert.equal(b.values.size, 0); blocked.dispose();
});
test("corrupt storage blocks without overwrite; pre-POST replacement/quota failure prevent transport", async () => {
  const s = setup(), c = new Client(s.options); s.values.set(c.storageKey, "corrupt"); await ready(c); await c.approve("Synthetic"); assert.equal(s.calls.length, 0); assert.equal(s.values.get(c.storageKey), "corrupt"); c.dispose();
  const q = setup({ storage: () => ({ getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => assert.fail("cannot remove") }) }), broken = new Client(q.options);
  await ready(broken); await broken.approve("Synthetic"); assert.equal(q.calls.length, 1); broken.dispose();
  const r = setup(), replaced = new Client(r.options); await ready(replaced); replaced.subscribe(() => { if (replaced.getSnapshot().pending) r.values.set(replaced.storageKey, "replacement"); });
  await replaced.approve("Synthetic"); assert.equal(r.calls.length, 1); assert.equal(r.values.get(replaced.storageKey), "replacement"); replaced.dispose();
});
test("a successful or rejected POST cannot clear a replacement intent; rejection never grants local-clear proof", async () => {
  for (const reject of [false, true]) {
    const s = setup(), base = s.options.apiFetch;
    const c = new Client({ ...s.options, apiFetch: async (url, init) => { if (init?.method !== "POST") return base(url, init);
      if (reject) return json({ ok: false, error: { code: "attendance_retention_disposal_changed", message: "Synthetic" } }, 409);
      const response = await base(url, init); s.values.set(c.storageKey, "replacement"); return response; } });
    await ready(c); await c.approve("Synthetic"); assert(c.getSnapshot().pending); assert(c.hasLeaveRisk()); assert.equal("endRejectedAttempt" in c, false);
    if (!reject) assert.equal(s.values.get(c.storageKey), "replacement"); c.dispose();
  }
});
test("late Auth/body and hidden state clear only displayed data, never pending or resend", async t => {
  const s = setup(), base = s.options.apiFetch; let finish!: () => void, started!: () => void;
  const arrived = new Promise<void>(r => { started = r; }), hold = new Promise<void>(r => { finish = r; });
  const c = new Client({ ...s.options, apiFetch: async (url, init) => { if (init?.method !== "POST") return base(url, init); const command = JSON.parse(String(init.body)).command;
    const text = JSON.stringify({ ok: true, data: disposalResult({ kind: "receipt", receipt: await disposalReceipt(command) }) });
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text.slice(0, 1))); started();
      void hold.then(() => { try { controller.enqueue(new TextEncoder().encode(text.slice(1))); controller.close(); } catch { /* canceled */ } }); } }), { headers: { "content-type": "application/json" } }); } });
  await ready(c); const writing = c.approve("Synthetic"); await arrived; const raw = s.values.get(c.storageKey); s.setCurrent(false); c.pause(); finish(); await writing;
  assert.equal(c.getSnapshot().result, null); assert.equal(s.values.get(c.storageKey), raw); c.dispose();
  let isHidden = true; const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, "document", prior); else Reflect.deleteProperty(globalThis, "document"); });
  s.setCurrent(true); const next = new Client({ ...s.options, enabled: false }); const count = s.calls.length; await next.initialize(); await next.recover(); assert.equal(s.calls.length, count);
  isHidden = false; next.pause(); assert.equal(s.calls.length, count); assert.equal(s.values.get(next.storageKey), raw); next.dispose();
});
test("pending hash scope and whole-lease deadlines fail closed", async t => {
  const s = setup(), base = s.options.apiFetch, c = new Client({ ...s.options, apiFetch: (url, init) => init?.method === "POST" ? Promise.reject(Error("lost")) : base(url, init) });
  await ready(c); await c.approve("Synthetic"); const raw = s.values.get(c.storageKey)!; c.dispose();
  await assert.rejects(parseDisposalExecutionPending(raw, { siteId: disposalSite, authUserId: id(99) }));
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {}));
  const bounded = new Client({ ...s.options, timeoutMs: 10 }); await bounded.initialize(); assert.equal(bounded.getSnapshot().phase, "blocked"); assert.equal(s.values.get(c.storageKey), raw); bounded.dispose();
});
