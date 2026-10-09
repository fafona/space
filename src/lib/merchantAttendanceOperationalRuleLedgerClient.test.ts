import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceOperationalRuleLedgerClient, operationalRuleLedgerPendingKey, parseOperationalRuleLedgerPending, type OperationalRuleLedgerStorage } from "./merchantAttendanceOperationalRuleLedgerClient";
import { parseOperationalRuleLedgerBody, parseOperationalRuleLedgerHttpQuery, operationalRuleLedgerCommandFingerprint,
  OPERATIONAL_RULE_LEDGER_ERRORS, OPERATIONAL_RULE_LEDGER_MESSAGES, type OperationalRuleLedgerErrorCode, type OperationalRuleLedgerQuery } from "./merchantAttendanceOperationalRuleLedger";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { "Content-Type": "application/json" } });
function memory() { const values = new Map<string, string>(), storage: OperationalRuleLedgerStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; return { values, storage }; }
function fixture(o: { apiFetch?: AttendanceApiFetch; enabled?: boolean; storage?: OperationalRuleLedgerStorage; isCurrentAuth?: () => boolean; timeoutMs?: number } = {}) {
  const mem = memory(), calls: { url: string; init?: RequestInit }[] = [], client = new AttendanceOperationalRuleLedgerClient({ siteId: f.operationalRuleLedgerSite, actorId: f.operationalRuleLedgerActor, scope: f.operationalRuleLedgerScope(), enabled: o.enabled ?? true,
    storage: () => o.storage ?? mem.storage, isCurrentAuth: o.isCurrentAuth, randomId: () => f.operationalRuleLedgerId(90), timeoutMs: o.timeoutMs,
    apiFetch: async (url, init) => { calls.push({ url: String(url), init }); if (o.apiFetch) return o.apiFetch(url, init); if (init?.method === "POST") return response(await f.operationalRuleLedgerReceiptResult(parseOperationalRuleLedgerBody(JSON.parse(String(init.body))).command));
      const q = parseOperationalRuleLedgerHttpQuery("https://synthetic.invalid" + url); return response(q.mode === "recover" ? f.operationalRuleLedgerResult({ kind: "receipt" }, false) : await f.operationalRuleLedgerDetail()); } }); return { ...mem, calls, client };
}
async function storedPending(storage: OperationalRuleLedgerStorage) { const command = f.operationalRuleLedgerSaveCommand(), raw = JSON.stringify({ version: 1, actorId: f.operationalRuleLedgerActor, query: f.operationalRuleLedgerQuery(), command, commandFingerprint: await operationalRuleLedgerCommandFingerprint(command, f.operationalRuleLedgerActor) });
  storage.setItem(operationalRuleLedgerPendingKey(f.operationalRuleLedgerSite, f.operationalRuleLedgerActor), raw); return { raw, command }; }
test("240 client initialize makes zero HTTP, fresh GET then durable single POST settles only receipt", async () => {
  const x = fixture(); await x.client.initialize(); assert.equal(x.calls.length, 0); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic");
  assert.deepEqual(x.calls.map(c => c.init?.method), ["GET", "POST"]); assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.values.size, 0); assert.equal(x.client.getSnapshot().result?.data.kind, "receipt");
  await x.client.saveDraft(f.operationalRuleLedgerRules(), "again"); assert.equal(x.calls.length, 2); x.client.dispose();
});
test("240 storage denial means no POST and no manufactured success", async () => {
  const x = fixture({ storage: { getItem: () => null, setItem: () => { throw Error("denied"); }, removeItem: () => {} } }); await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic");
  assert.equal(x.calls.length, 1); assert.equal(x.client.getSnapshot().phase, "blocked"); x.client.dispose();
});
test("240 lost POST response retains exact bytes; default-off reload only explicit GET recovery", async () => {
  const mem = memory(); let submitted: ReturnType<typeof parseOperationalRuleLedgerBody>["command"] | null = null;
  const x = fixture({ storage: mem.storage, apiFetch: async (_url, init) => { if (init?.method === "POST") { submitted = parseOperationalRuleLedgerBody(JSON.parse(String(init.body))).command; throw Error("response lost"); } return response(await f.operationalRuleLedgerDetail()); } });
  await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic"); const raw = mem.storage.getItem(x.client.storageKey); assert.ok(raw); assert.equal(x.client.getSnapshot().phase, "unconfirmed"); x.client.dispose();
  const y = fixture({ storage: mem.storage, enabled: false, apiFetch: async () => response(await f.operationalRuleLedgerReceiptResult(submitted!)) }); await y.client.initialize(); assert.equal(y.calls.length, 0); await y.client.load(); assert.equal(y.calls.length, 0); await y.client.recover();
  assert.deepEqual(y.calls.map(c => c.init?.method), ["GET"]); assert.equal(mem.storage.getItem(y.client.storageKey), null); assert.equal(y.client.getSnapshot().result?.canWrite, false); y.client.dispose();
});
test("240 null recovery, changed local bytes and wrong receipt never retire intent", async () => {
  for (const variant of ["null", "changed", "wrong"] as const) { const mem = memory(), pending = await storedPending(mem.storage); const x = fixture({ storage: mem.storage, apiFetch: async () => { if (variant === "changed") mem.storage.setItem(operationalRuleLedgerPendingKey(f.operationalRuleLedgerSite, f.operationalRuleLedgerActor), "replacement");
      return response(variant === "null" ? f.operationalRuleLedgerResult({ kind: "receipt" }, false) : await f.operationalRuleLedgerReceiptResult({ ...pending.command, reason: variant === "wrong" ? "other" : pending.command.reason })); } });
    await x.client.initialize(); await x.client.recover(); assert.equal(mem.storage.getItem(x.client.storageKey), variant === "changed" ? "replacement" : pending.raw); assert.ok(x.client.getSnapshot().pending); x.client.dispose(); }
});
test("240 same-actor cross-scope recovery is receipt-only and cannot write constructor scope", async () => {
  const mem = memory(), { command } = await storedPending(mem.storage), x = new AttendanceOperationalRuleLedgerClient({ siteId: f.operationalRuleLedgerSite, actorId: f.operationalRuleLedgerActor, scope: f.operationalRuleLedgerScope("group"), enabled: true,
    storage: () => mem.storage, apiFetch: async () => response(await f.operationalRuleLedgerReceiptResult(command)) }); await x.initialize(); await x.recover(); await x.saveDraft(f.operationalRuleLedgerRules(), "no context"); assert.equal(x.getSnapshot().result?.data.kind, "receipt"); x.dispose();
});
test("240 scope invalidation during delayed receipt keeps original storage and clears read", async () => {
  const mem = memory(), { raw, command } = await storedPending(mem.storage); let current = true, release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const x = fixture({ storage: mem.storage, isCurrentAuth: () => current, apiFetch: async () => { await wait; return response(await f.operationalRuleLedgerReceiptResult(command)); } }); await x.client.initialize(); const recovering = x.client.recover(); current = false; x.client.pause(); release(); await recovering;
  assert.equal(mem.storage.getItem(x.client.storageKey), raw); assert.equal(x.client.getSnapshot().result, null); x.client.dispose();
});
test("240 total deadline covers hung fetch, streamed body and crypto initialization", async t => {
  const x = fixture({ timeoutMs: 15, apiFetch: async () => new Promise<Response>(() => {}) }); await x.client.initialize(); await x.client.load(); assert.equal(x.client.getSnapshot().phase, "blocked"); x.client.dispose();
  let canceled = false; const y = fixture({ timeoutMs: 15, apiFetch: async () => new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } }), { headers: { "Content-Type": "application/json" } }) }); await y.client.initialize(); await y.client.load(); assert.equal(canceled, true); y.client.dispose();
  const mem = memory(), { raw } = await storedPending(mem.storage), original = crypto.subtle.digest.bind(crypto.subtle); t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {}));
  const z = fixture({ timeoutMs: 15, storage: mem.storage }); await z.client.initialize(); assert.equal(z.client.getSnapshot().phase, "blocked"); assert.equal(mem.storage.getItem(z.client.storageKey), raw); z.client.dispose(); t.mock.restoreAll(); assert.ok(original);
});
test("240 first hidden initialize is local, visible requires explicit read, hide clears late body", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"); let hidden = true; Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return hidden; } } }); t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const x = fixture(); await x.client.initialize(); await x.client.load(); assert.equal(x.calls.length, 0); hidden = false; assert.equal(x.calls.length, 0); await x.client.load(); assert.equal(x.calls.length, 1); hidden = true; x.client.pause(); assert.equal(x.client.getSnapshot().result, null); x.client.dispose();
});
test("240 pending parser binds full actor/site/command without trusting operation alone", async () => {
  const m = memory(), { raw } = await storedPending(m.storage); assert.equal((await parseOperationalRuleLedgerPending(raw, { siteId: f.operationalRuleLedgerSite, actorId: f.operationalRuleLedgerActor })).version, 1);
  await assert.rejects(parseOperationalRuleLedgerPending(raw, { siteId: f.operationalRuleLedgerSite, actorId: f.operationalRuleLedgerId(2) })); const changed = JSON.parse(raw); changed.command.reason = "changed"; await assert.rejects(parseOperationalRuleLedgerPending(JSON.stringify(changed), { siteId: f.operationalRuleLedgerSite, actorId: f.operationalRuleLedgerActor }));
});
test("240 fresh saved preview is required for publish; catalog removes old write context", async () => {
  const x = fixture({ apiFetch: async (url, init) => { if (init?.method === "POST") return response(await f.operationalRuleLedgerReceiptResult(parseOperationalRuleLedgerBody(JSON.parse(String(init.body))).command));
    const q: OperationalRuleLedgerQuery = parseOperationalRuleLedgerHttpQuery("https://synthetic.invalid" + url); return response(q.mode === "preview" ? f.operationalRuleLedgerResult(await f.operationalRuleLedgerPreview()) : q.mode === "catalog" ? f.operationalRuleLedgerResult({ kind: "catalog", catalog: "routes", items: [], nextId: null }, false) : await f.operationalRuleLedgerDetail(undefined, true)); } });
  await x.client.initialize(); await x.client.load(); await x.client.publish("no preview"); assert.equal(x.calls.length, 1); await x.client.preview({ effectiveOn: "2026-10-09", endsOn: null }); await x.client.publish("synthetic publish"); assert.equal(x.calls.filter(c => c.init?.method === "POST").length, 1);
  await x.client.load(); await x.client.catalog("routes"); await x.client.saveDraft(f.operationalRuleLedgerRules(), "stale detail"); assert.equal(x.calls.filter(c => c.init?.method === "POST").length, 1); x.client.dispose();
});
test("240 late headers after pause cancel the owned response body and never touch pending", async () => {
  let deliver!: (r: Response) => void, canceled = false; const x = fixture({ apiFetch: () => new Promise(r => { deliver = r; }) }); await x.client.initialize(); const reading = x.client.load(); x.client.pause();
  deliver(new Response(new ReadableStream({ cancel: () => { canceled = true; } }), { headers: { "Content-Type": "application/json" } })); await reading;
  assert.equal(canceled, true); assert.equal(x.client.getSnapshot().result, null); x.client.dispose();
});
const rejection = (code: OperationalRuleLedgerErrorCode, status: number = OPERATIONAL_RULE_LEDGER_ERRORS[code], patch: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error: { code, message: OPERATIONAL_RULE_LEDGER_MESSAGES[code] }, ...patch }), { status, headers: { "Content-Type": "application/json" } });
test("240 only exact current-POST five-code rejection permits explicit local end, then fresh GET is required", async () => {
  for (const code of ["attendance_operational_rule_changed", "attendance_operational_rule_disabled", "attendance_operational_rule_not_found",
    "attendance_operational_rule_future_required", "attendance_operational_rule_overlap"] as const) {
    const x = fixture({ apiFetch: async (_url, init) => init?.method === "POST" ? rejection(code) : response(await f.operationalRuleLedgerDetail()) });
    await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic rejection");
    assert.equal(x.client.getSnapshot().canEndRejectedAttempt, true); const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw);
    assert.equal(JSON.parse(raw).canEndRejectedAttempt, undefined); assert.equal(JSON.parse(raw).rejectedAttempt, undefined);
    assert.equal(x.client.endRejectedAttempt(), true); assert.equal(x.storage.getItem(x.client.storageKey), null); assert.equal(x.client.getSnapshot().pending, null);
    assert.equal(x.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().query, null);
    await x.client.saveDraft(f.operationalRuleLedgerRules(), "must fresh read"); assert.equal(x.calls.length, 2); assert.equal(x.client.endRejectedAttempt(), false); x.client.dispose();
  }
});
test("240 conflict/auth/unknown, mismatched status or malformed errors cannot masquerade as no-write proof", async () => {
  const failures: (() => Promise<Response>)[] = ["attendance_operation_conflict", "attendance_access_denied", "attendance_operational_rule_invalid", "attendance_operational_rule_limit"].map(code => async () => rejection(code as OperationalRuleLedgerErrorCode));
  failures.push(async () => rejection("attendance_operational_rule_changed", 403), async () => rejection("attendance_operational_rule_changed", 409, { extra: true }),
    async () => { throw Error("attendance_operational_rule_changed"); }, async () => new Response('{"ok":false,"error":{"code":"attendance_operational_rule_changed","message":"not verified"}}', { status: 409, headers: { "Content-Type": "application/json" } }));
  for (const rejected of failures) { const x = fixture({ apiFetch: async (_url, init) => init?.method === "POST" ? rejected() : response(await f.operationalRuleLedgerDetail()) }); await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic rejection");
    const raw = x.storage.getItem(x.client.storageKey); assert.ok(raw); assert.equal(x.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(x.client.endRejectedAttempt(), false); assert.equal(x.storage.getItem(x.client.storageKey), raw); x.client.dispose(); }
});
test("240 pause/initialize/Auth change/close and subsequent GET remove proof but retain the exact pending", async () => {
  for (const action of ["pause", "initialize", "auth", "dispose", "get_null", "get_error", "get_mismatch"] as const) { let current = true, reads = 0;
    const x = fixture({ isCurrentAuth: () => current, apiFetch: async (_url, init) => { if (init?.method === "POST") return rejection("attendance_operational_rule_changed"); if (++reads === 1) return response(await f.operationalRuleLedgerDetail());
      if (action === "get_error") return rejection("attendance_operational_rule_changed"); if (action === "get_mismatch") return response(await f.operationalRuleLedgerReceiptResult(f.operationalRuleLedgerSaveCommand())); return response(f.operationalRuleLedgerResult({ kind: "receipt" }, false)); } });
    await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic rejection"); assert.equal(x.client.getSnapshot().canEndRejectedAttempt, true); const raw = x.storage.getItem(x.client.storageKey);
    if (action === "pause") x.client.pause(); else if (action === "initialize") await x.client.initialize(); else if (action === "auth") current = false; else if (action === "dispose") x.client.dispose(); else await x.client.recover();
    assert.equal(x.client.endRejectedAttempt(), false); assert.equal(x.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(x.storage.getItem(x.client.storageKey), raw); x.client.dispose();
  }
});
test("240 proof cannot clear concurrently replaced storage or an in-flight recovery", async () => {
  for (const mode of ["replacement", "inflight"] as const) { let reads = 0, release!: () => void; const wait = new Promise<void>(r => { release = r; });
    const x = fixture({ apiFetch: async (_url, init) => { if (init?.method === "POST") return rejection("attendance_operational_rule_changed"); if (++reads === 1) return response(await f.operationalRuleLedgerDetail()); await wait; return response(f.operationalRuleLedgerResult({ kind: "receipt" }, false)); } });
    await x.client.initialize(); await x.client.load(); await x.client.saveDraft(f.operationalRuleLedgerRules(), "synthetic rejection"); const raw = x.storage.getItem(x.client.storageKey); let reading: Promise<void> | undefined;
    if (mode === "replacement") x.storage.setItem(x.client.storageKey, "concurrent replacement"); else reading = x.client.recover();
    assert.equal(x.client.endRejectedAttempt(), false); assert.equal(x.storage.getItem(x.client.storageKey), mode === "replacement" ? "concurrent replacement" : raw); release(); await reading;
    assert.equal(x.client.getSnapshot().canEndRejectedAttempt, false); x.client.dispose();
  }
});
