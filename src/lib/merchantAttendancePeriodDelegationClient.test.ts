import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePeriodDelegationClient, periodDelegationPendingKey, type PeriodDelegationStorage } from "./merchantAttendancePeriodDelegationClient";
import { periodDelegationCommandFingerprint, type PeriodDelegationQuery, type PeriodDelegationCommand } from "./merchantAttendancePeriodDelegation";
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), delegate = id(2), delegateAuth = id(3), worker = id(4), employee = id(5), employeeAuth = id(6), operation = id(7);
const readAt = "2026-10-08T10:00:00.000000Z";
const selectedDelegate = { id: delegate, name: "Supervisor", employeeId: delegate, employeeAuthUserId: delegateAuth, workerNo: null, actions: ["view", "send"] };
const selectedWorker = { id: worker, name: "Worker", employeeId: employee, employeeAuthUserId: employeeAuth, workerNo: "TEST-1", actions: [] };
const input = { actions: ["view"] as ["view"], fromDate: "2026-10-01", throughDate: "2026-10-31", includeExisting: false,
  validFrom: "2026-10-08T09:00:00.000000Z", validUntil: "2026-11-08T09:00:00.000000Z", reason: "Test delegation" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
function fixture(options: { enabled?: boolean; storage?: PeriodDelegationStorage; current?: () => boolean; timeoutMs?: number;
  response?: (q: PeriodDelegationQuery, c: PeriodDelegationCommand | null, base: Record<string, unknown>) => Promise<Response> | Response } = {}) {
  const values = new Map<string, string>(); const storage = options.storage ?? { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const calls: { q: PeriodDelegationQuery; c: PeriodDelegationCommand | null }[] = [];
  const client = new AttendancePeriodDelegationClient({ siteId, actorId: owner, expectedAuthUserId: owner, access: "owner", enabled: options.enabled ?? true, storage: () => storage,
    randomId: () => operation, isCurrentAuth: options.current, timeoutMs: options.timeoutMs, apiFetch: async (url, init) => {
      const body = init?.method === "POST" ? JSON.parse(String(init.body)) : null, p = new URL(String(url), "https://launch.faolla.com").searchParams;
      const q: PeriodDelegationQuery = body?.query ?? { siteId, access: "owner", mode: p.get("mode"), catalog: p.get("catalog"), grantId: p.get("grantId"), afterId: p.get("afterId"), operationId: p.get("operationId") };
      const c: PeriodDelegationCommand | null = body?.command ?? null; calls.push({ q, c });
      const base = { ok: true, protocol: "period-delegation-v1", siteId, access: "owner", actorId: owner, employeeId: null, mode: q.mode, canWrite: q.mode !== "recover" && (options.enabled ?? true), grants: [],
        catalogItems: q.mode === "catalog" ? [q.catalog === "delegates" ? selectedDelegate : selectedWorker] : [], nextAfterId: null, detail: null, receipt: null, readAt };
      return options.response ? options.response(q, c, base) : json(base);
    } }); return { client, calls, values, storage };
}
async function choose(f: ReturnType<typeof fixture>) { await f.client.initialize(); await f.client.catalog("delegates"); f.client.selectDelegate(f.client.getSnapshot().result!.catalogItems[0]);
  await f.client.catalog("workers"); f.client.selectWorker(f.client.getSnapshot().result!.catalogItems[0]); }
async function savedReceipt(q: PeriodDelegationQuery, c: PeriodDelegationCommand) { return { operationId: c.operationId, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId,
  grantRevision: c.action === "grant" ? 1 : 2, periodId: null, periodRevision: null, actorId: owner, recordedAt: readAt, commandFingerprint: await periodDelegationCommandFingerprint(q, c) }; }

test("initialization is local-only; exact identities partition keys", async () => { const f = fixture(); await f.client.initialize(); assert.equal(f.calls.length, 0);
  assert.notEqual(f.client.storageKey, periodDelegationPendingKey(siteId, "owner", id(19))); assert.throws(() => new AttendancePeriodDelegationClient({ siteId, access: "owner", actorId: owner, expectedAuthUserId: "", storage: () => f.storage, enabled: true, apiFetch: async () => json({}) })); });
test("one durable POST; damaged reply retains intent; recovery uses GET only", async () => { let original: { q: PeriodDelegationQuery; c: PeriodDelegationCommand } | null = null;
  const f = fixture({ response: async (q, c, base) => { if (c) { original = { q, c }; return new Response('{"ok":', { headers: { "content-type": "application/json" } }); }
    if (q.mode === "recover") return json({ ...base, receipt: await savedReceipt(original!.q, original!.c) }); return json(base); } });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.values.size, 1);
  await f.client.grant(input); assert.equal(f.calls.filter(c => c.c).length, 1); await f.client.recover(); assert.equal(f.calls.at(-1)!.q.mode, "recover");
  assert.equal(f.calls.filter(c => c.c).length, 1); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.values.size, 0); });
test("recover-not-found and forged receipt never clear the original intent", async () => { let saved: { q: PeriodDelegationQuery; c: PeriodDelegationCommand } | null = null; let forged = false;
  const f = fixture({ response: async (q, c, base) => { if (c) { saved = { q, c }; throw Error("lost"); }
    if (q.mode === "recover" && forged) return json({ ...base, receipt: { ...await savedReceipt(saved!.q, saved!.c), actorId: id(99) } }); return json(base); } });
  await choose(f); await f.client.grant(input); const raw = f.storage.getItem(f.client.storageKey); await f.client.recover(); assert.equal(f.storage.getItem(f.client.storageKey), raw);
  forged = true; await f.client.recover(); assert.equal(f.storage.getItem(f.client.storageKey), raw); assert.equal(f.calls.filter(c => c.c).length, 1); });
test("storage exception after durable write prevents POST and survives reinitialize", async () => { const values = new Map<string, string>(); let fault = true;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); if (fault) throw Error("storage callback"); }, removeItem: (k: string) => { values.delete(k); } };
  const f = fixture({ storage }); await choose(f); await f.client.grant(input); assert.equal(f.calls.filter(c => c.c).length, 0); assert.equal(values.size, 1);
  fault = false; await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.client.getSnapshot().pending?.command.operationId, operation); });
test("identity invalidation hides late data and preserves unknown-operation marker", async () => { let current = true;
  const f = fixture({ current: () => current, response: async (_q, c, base) => { if (c) { current = false; throw Error("identity changed"); } return json(base); } });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.values.size, 1); const count = f.calls.length;
  await f.client.recover(); assert.equal(f.calls.length, count); });
test("generic or GET errors do not count as definite POST rejection", async () => { const f = fixture({ response: (_q, c, base) => c ? json({ ok: false, error: "attendance_period_delegation_disabled" }, 503) : json(base) });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.values.size, 1); });
test("strict known transaction rejection removes only this exact pending marker", async () => { const f = fixture({ response: (_q, c, base) => c ? json({ ok: false, error: "attendance_version_conflict" }, 409) : json(base) });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.values.size, 0); assert.equal(f.client.getSnapshot().phase, "blocked"); });
test("rollout rejection before original-id lookup keeps the id for GET recovery", async () => { const f = fixture({ response: (_q, c, base) => c ? json({ ok: false, error: "attendance_period_delegation_disabled" }, 403) : json(base) });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().pending?.command.operationId, operation); assert.equal(f.values.size, 1); });
test("no grant POST when creation switch is off", async () => { const f = fixture({ enabled: false }); await choose(f); await f.client.grant(input); assert.equal(f.calls.filter(c => c.c).length, 0); });
test("receipt with wrong command fingerprint is not a successful write", async () => { const f = fixture({ response: async (q, c, base) => c ? json({ ...base, receipt: { ...await savedReceipt(q, c), commandFingerprint: "0".repeat(64) } }) : json(base) });
  await choose(f); await f.client.grant(input); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.values.size, 1); });
test("actions absent from the selected supervisor are refused before an operation id or storage", async () => { const f = fixture(); await choose(f);
  await f.client.grant({ ...input, actions: ["view", "seal"] }); assert.equal(f.calls.filter(c => c.c).length, 0); assert.equal(f.values.size, 0); });
test("runtime extra identity keys cannot override the exact catalog selection", async () => { const f = fixture(); await choose(f);
  await assert.rejects(f.client.grant({ ...input, employeeId: id(99) } as typeof input)); assert.equal(f.calls.filter(c => c.c).length, 0); assert.equal(f.values.size, 0); });

test("hanging grant digest expires without storage or POST and its late result cannot resume writing", async t => {
  const f = fixture({ timeoutMs: 25 }); await choose(f);
  let finish!: (value: ArrayBuffer) => void;
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
  const started = performance.now(); await f.client.grant(input); assert(performance.now() - started < 1000);
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.hasLeaveRisk(), false);
  assert.equal(f.values.size, 0); assert.equal(f.calls.filter(call => call.c).length, 0);
  const snapshot = f.client.getSnapshot(); finish(new ArrayBuffer(32)); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.client.getSnapshot(), snapshot); assert.equal(f.values.size, 0); assert.equal(f.calls.filter(call => call.c).length, 0);
});

test("reload digest timeout preserves committed-unknown bytes; a matching late digest cannot clear or read", async t => {
  const original = fixture({ response: (_q, c, base) => { if (c) throw Error("committed reply lost"); return json(base); } });
  await choose(original); await original.client.grant(input);
  const raw = original.storage.getItem(original.client.storageKey)!; assert(raw);
  const expected = Uint8Array.from(Buffer.from(JSON.parse(raw).commandFingerprint, "hex")).buffer;
  const reload = fixture({ storage: original.storage, enabled: false, timeoutMs: 25 }); let finish!: (value: ArrayBuffer) => void;
  const digest = t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
  const started = performance.now(); await reload.client.initialize(); assert(performance.now() - started < 1000);
  assert.equal(reload.client.getSnapshot().phase, "blocked"); assert.equal(reload.client.hasLeaveRisk(), true);
  assert.equal(reload.storage.getItem(reload.client.storageKey), raw); assert.equal(reload.calls.length, 0);
  const snapshot = reload.client.getSnapshot(); finish(expected); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(reload.client.getSnapshot(), snapshot); assert.equal(reload.storage.getItem(reload.client.storageKey), raw); assert.equal(reload.calls.length, 0);
  digest.mock.restore(); await reload.client.initialize(); assert.equal(reload.client.getSnapshot().pending?.command.operationId, operation);
  assert.equal(reload.calls.length, 0); assert.equal(reload.storage.getItem(reload.client.storageKey), raw);
});

test("pause interrupts a hung digest and stale completion cannot affect the next lease", async t => {
  const f = fixture(); await choose(f); let finish!: (value: ArrayBuffer) => void;
  const digest = t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
  const pending = f.client.grant(input); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.client.getSnapshot().phase, "saving"); f.client.pause(); await pending;
  digest.mock.restore(); await f.client.initialize(); const snapshot = f.client.getSnapshot();
  finish(new ArrayBuffer(32)); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.client.getSnapshot(), snapshot); assert.equal(f.client.getSnapshot().phase, "idle");
  assert.equal(f.values.size, 0); assert.equal(f.calls.filter(call => call.c).length, 0); assert.equal(f.client.hasLeaveRisk(), false);
});
