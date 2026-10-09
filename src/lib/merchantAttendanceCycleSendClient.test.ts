// Actual pure client, memory-only storage and synthetic HTTP. No real Auth,
// SQL, browser, release, historical report or live employee is exercised here.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceCycleSendClient, type CycleSendClientOptions, type CycleSendPending, type CycleSendStorage } from "./merchantAttendanceCycleSendClient";
import { periodClosurePendingKey } from "./merchantAttendancePeriodClosureClient";
import { periodDelegatedClosurePendingKey, type PeriodDelegatedClosureScope } from "./merchantAttendancePeriodDelegatedClosureClient";
import { CYCLE_INTENT_PROTOCOL } from "./merchantAttendanceCycleIntent";
import { CYCLE_SEND_API, cycleSendCommandFingerprint, parseCycleSendBodyJson, parseCycleSendHttpQuery, type CycleSendFrame, type CycleSendCommand } from "./merchantAttendanceCycleSend";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(10), frame: CycleSendFrame = { siteId: "99990200", access: "owner", workerId: id(1), grantId: null,
  fromDate: "2026-10-05", throughDate: "2026-10-11", periodId: id(2), intentId: id(3), expectedIntentFingerprint: "a".repeat(64) };
const command: CycleSendCommand = { action: "send", operationId: id(4), periodId: frame.periodId, expectedRevision: 0,
  expectedVersion: 0, expectedFingerprint: "b".repeat(64), reason: "合成首次送审，非本人确认" };
const delegateScope: PeriodDelegatedClosureScope = { siteId: frame.siteId, actorEmployeeId: id(11), expectedAuthUserId: actor, grantId: id(12),
  workerId: frame.workerId, targetEmployeeId: id(13), targetAuthUserId: id(14), authorizedFromDate: "2026-10-01", authorizedThroughDate: "2026-10-31" };
const delegatedFrame: CycleSendFrame = { ...frame, access: "delegate", grantId: delegateScope.grantId };
type Call = { url: string; method: string; body: string | null; pending: CycleSendPending | null };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function linked(p: CycleSendPending) {
  const recordedAt = "2026-10-08T10:00:00.000000Z";
  return { ok: true, moduleEnabled: true, data: { protocol: CYCLE_INTENT_PROTOCOL, siteId: p.frame.siteId, actorId: p.actorId, readAt: recordedAt,
    data: { kind: "linked", periodOperation: { operationId: p.command.operationId, revision: 1, action: "send", version: 1, actorId: p.actorId,
      reason: p.command.reason, recordedAt, command: p.command } },
    receipt: { operationId: p.command.operationId, intentId: p.frame.intentId, action: "link", actorId: p.actorId, revision: 2, recordedAt,
      commandFingerprint: p.commandFingerprint, periodId: p.frame.periodId, sendOperationId: p.command.operationId } } };
}
function fixture(extra: { delegate?: boolean; current?: () => boolean; timeoutMs?: number; storage?: CycleSendStorage;
  response?: (call: Call) => Response | Promise<Response>; onState?: CycleSendClientOptions["onState"] } = {}) {
  const values = new Map<string, string>(), writes: { method: string; value?: string }[] = [], calls: Call[] = [];
  const storage: CycleSendStorage = extra.storage ?? { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push({ method: "set", value }); values.set(key, value); },
    removeItem: key => { writes.push({ method: "remove" }); values.delete(key); } };
  const options: CycleSendClientOptions = { siteId: frame.siteId, actorId: actor,
    ...(extra.delegate ? { access: "delegate" as const, delegateScope } : { access: "owner" as const }),
    storage: () => storage, isCurrentAuth: extra.current ?? (() => true), timeoutMs: extra.timeoutMs, onState: extra.onState,
    apiFetch: async (url, init) => {
      const raw = storage.getItem(client.storageKey), pending = raw === null ? null : JSON.parse(raw) as CycleSendPending;
      const call = { url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null, pending }; calls.push(call);
      if (!pending) throw Error("must persist before HTTP");
      return extra.response ? extra.response(call) : reply(linked(pending));
    } };
  const client = new AttendanceCycleSendClient(options); return { client, values, writes, calls, options, storage };
}
async function seed(f: ReturnType<typeof fixture>, fFrame = frame) {
  const pending: CycleSendPending = { format: 3, kind: "operational_cycle", actorId: actor, scope: fFrame.access === "owner" ? null : delegateScope,
    frame: fFrame, command, commandFingerprint: await cycleSendCommandFingerprint(fFrame, command, actor) };
  const raw = JSON.stringify(pending); f.values.set(f.client.storageKey, raw); return { pending, raw };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise<void>(yes => setImmediate(yes));

test("200 first-send load is local-only and uses precisely the old owner/delegate slots", async () => {
  const owner = fixture(), delegate = fixture({ delegate: true });
  assert.equal(owner.client.storageKey, periodClosurePendingKey(frame.siteId, "owner", actor));
  assert.equal(delegate.client.storageKey, periodDelegatedClosurePendingKey(delegateScope));
  for (const f of [owner, delegate]) { assert.equal(await f.client.load(), null); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.client.hasLeaveRisk(), false); assert(Object.isFrozen(f.client.getSnapshot())); }
});
test("200 any old/unknown/malformed slot blocks without HTTP, rewrite or deletion", async () => {
  for (const delegate of [false, true]) {
    const f = fixture({ delegate }), { pending } = await seed(f, delegate ? delegatedFrame : frame);
    for (const raw of ["{", "x".repeat(16385), JSON.stringify({ ...pending, format: 1 }), JSON.stringify({ ...pending, format: 2 }), JSON.stringify({ ...pending, format: 4 }),
      JSON.stringify({ ...pending, kind: "other" }), JSON.stringify({ ...pending, actorId: id(99) }), JSON.stringify({ ...pending, commandFingerprint: "0".repeat(64) }),
      JSON.stringify({ ...pending, extra: true }), JSON.stringify(pending).replace('"format":3', '"format":3,"format":3')]) {
      f.values.set(f.client.storageKey, raw); await assert.rejects(f.client.load()); await assert.rejects(f.client.submit(delegate ? delegatedFrame : frame, command));
      await assert.rejects(f.client.recover()); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.values.get(f.client.storageKey), raw);
      assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.client.hasLeaveRisk(), true);
    }
  }
});
test("200 owner restores the original worker/frame and delegate requires exact nine-field scope", async () => {
  const f = fixture(), original = { ...frame, workerId: id(21) }, { raw } = await seed(f, original);
  const pending = await f.client.load(); assert.equal(pending?.frame.workerId, original.workerId); assert.equal(f.values.get(f.client.storageKey), raw);
  await f.client.recover(); const query = parseCycleSendHttpQuery("https://synthetic.invalid" + f.calls[0].url);
  assert.equal(query.workerId, original.workerId); assert.equal(query.operationId, command.operationId); assert.equal(f.values.size, 0);
  const d = fixture({ delegate: true }), seeded = await seed(d, delegatedFrame);
  const changed = new AttendanceCycleSendClient({ ...d.options, access: "delegate", delegateScope: { ...delegateScope, authorizedThroughDate: "2026-10-30" } });
  assert.equal(changed.storageKey, d.client.storageKey); await assert.rejects(changed.load()); assert.equal(d.calls.length, 0); assert.equal(d.values.get(changed.storageKey), seeded.raw);
  for (const bad of [{ ...delegatedFrame, grantId: id(90) }, { ...delegatedFrame, workerId: id(91) }, { ...delegatedFrame, fromDate: "2026-09-30" }]) await assert.rejects(d.client.submit(bad, command));
  assert.equal(d.calls.length, 0);
});
test("200 one POST persists exact format3 before HTTP; even a valid receipt stays pending until matching GET", async () => {
  for (const delegate of [false, true]) {
    const f = fixture({ delegate }), selected = delegate ? delegatedFrame : frame;
    const result = await f.client.submit(selected, command); assert.equal(result.data.kind, "linked");
    assert.deepEqual(f.calls.map(c => c.method), ["POST"]); assert.equal(f.calls[0].url, CYCLE_SEND_API);
    const p = f.calls[0].pending!; assert.deepEqual(Object.keys(p).sort(), ["actorId", "command", "commandFingerprint", "format", "frame", "kind", "scope"]);
    assert.equal(p.format, 3); assert.equal(p.kind, "operational_cycle"); assert.equal(p.actorId, actor); assert.deepEqual(parseCycleSendBodyJson(f.calls[0].body!), { frame: selected, command });
    assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.writes.filter(w => w.method === "remove").length, 0);
    const raw = f.storage.getItem(f.client.storageKey); await assert.rejects(f.client.submit(selected, command)); assert.equal(f.calls.length, 1); assert.equal(f.storage.getItem(f.client.storageKey), raw);
    await f.client.recover(); assert.deepEqual(f.calls.map(c => c.method), ["POST", "GET"]); assert(!f.calls[1].url.includes("reason")); assert.equal(f.calls[1].body, null);
    assert.equal(f.storage.getItem(f.client.storageKey), null); assert.equal(f.writes.filter(w => w.method === "remove").length, 1); assert.equal(f.client.getSnapshot().pending, null);
    assert.equal(f.client.getSnapshot().result?.data.kind, "linked"); assert.equal(f.client.hasLeaveRisk(), false);
  }
});
test("200 lost reply, null/not-found/error/503 and malformed response never retire the original", async () => {
  const replies: ((p: CycleSendPending) => Response)[] = [() => reply({ ok: false, error: "attendance_operation_not_found" }, 404),
    () => reply({ ok: false, error: "attendance_unavailable" }, 503), p => reply({ ...linked(p), data: { ...linked(p).data, data: { kind: "receipt" }, receipt: null } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }), () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => new Response("x".repeat(16385), { headers: { "content-type": "application/json" } }), () => new Response("{}", { headers: { "content-type": "text/html" } })];
  for (const response of replies) {
    const f = fixture({ response: call => response(call.pending!) }), { raw } = await seed(f); await assert.rejects(f.client.recover());
    assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.writes.length, 0); assert.deepEqual(f.calls.map(c => c.method), ["GET"]);
  }
  const lost = fixture({ response: call => { if (call.method === "POST") throw Error("synthetic lost reply"); return reply(linked(call.pending!)); } });
  await assert.rejects(lost.client.submit(frame, command)); const raw = lost.values.get(lost.client.storageKey); assert(raw);
  assert.equal(lost.client.getSnapshot().pending?.command.operationId, command.operationId); await lost.client.recover(); assert.equal(lost.values.size, 0);
  assert.deepEqual(lost.calls.map(c => c.method), ["POST", "GET"]);
});
test("200 altered actor, intent, frame, command or digest cannot clear a matching-looking GET receipt", async () => {
  for (const change of [(r: ReturnType<typeof linked>) => { r.data.receipt.actorId = id(90); }, (r: ReturnType<typeof linked>) => { r.data.receipt.intentId = id(91); },
    (r: ReturnType<typeof linked>) => { r.data.receipt.periodId = id(92); }, (r: ReturnType<typeof linked>) => { r.data.receipt.commandFingerprint = "0".repeat(64); },
    (r: ReturnType<typeof linked>) => { r.data.data.periodOperation.command = { ...command, reason: "changed" }; r.data.data.periodOperation.reason = "changed"; }]) {
    const f = fixture({ response: call => { const r = linked(call.pending!); change(r); return reply(r); } }), { raw } = await seed(f);
    await assert.rejects(f.client.recover()); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.writes.length, 0); assert.equal(f.client.getSnapshot().result, null);
  }
});
test("200 omission/error/false Auth fails closed; pause/flag-scope invalidation and disposal preserve durable bytes", async () => {
  for (const current of [undefined, () => false, () => { throw Error("Auth unavailable"); }]) {
    const f = fixture(), client = new AttendanceCycleSendClient({ ...f.options, isCurrentAuth: current });
    await assert.rejects(client.submit(frame, command)); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  }
  let live = true; const f = fixture({ current: () => live }), { raw } = await seed(f); await f.client.load(); live = false;
  await assert.rejects(f.client.recover()); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.calls.length, 0);
  live = true; await f.client.load(); f.client.pause(); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.values.get(f.client.storageKey), raw);
  f.client.dispose(); await assert.rejects(f.client.load()); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.calls.length, 0);
});
test("200 onState pause after persistence prevents POST; hide clears returned bodies but never storage", async t => {
  let once = false;
  const f = fixture({ onState: state => { if (!once && state.phase === "saving") { once = true; f.client.pause(); } } });
  await assert.rejects(f.client.submit(frame, command)); assert(once); assert.equal(f.calls.length, 0); assert(f.values.get(f.client.storageKey)); assert.equal(f.client.getSnapshot().pending, null);
  const before = Object.getOwnPropertyDescriptor(globalThis, "document"); let concealed = false;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return concealed; } } });
  t.after(() => { if (before) Object.defineProperty(globalThis, "document", before); else Reflect.deleteProperty(globalThis, "document"); });
  const hiddenClient = fixture(), { raw } = await seed(hiddenClient); await hiddenClient.client.load(); concealed = true;
  await assert.rejects(hiddenClient.client.recover()); assert.equal(hiddenClient.client.getSnapshot().pending, null); assert.equal(hiddenClient.values.get(hiddenClient.client.storageKey), raw); assert.equal(hiddenClient.calls.length, 0);
});
test("200 late GET/disposed response and replaced bytes cannot clear or resurrect state", async () => {
  for (const action of ["pause", "dispose", "replace"] as const) {
    const late = deferred<Response>(), entered = deferred<void>(), f = fixture({ response: () => { entered.resolve(); return late.promise; } });
    const { pending, raw } = await seed(f), request = f.client.recover(), rejected = assert.rejects(request);
    try {
      // Wait for the actual transport boundary, not one event-loop turn: SHA
      // may legitimately finish after setImmediate on a loaded machine.
      await Promise.race([entered.promise, rejected.then(() => assert.fail("recovery ended before HTTP"))]); assert.equal(f.calls.length, 1);
      if (action === "replace") f.values.set(f.client.storageKey, "another-format-or-operation"); else f.client[action]();
      late.resolve(reply(linked(pending))); await rejected; await tick();
      assert.equal(f.values.get(f.client.storageKey), action === "replace" ? "another-format-or-operation" : raw); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.writes.length, 0);
    } finally { late.resolve(reply(linked(pending))); f.client.dispose(); await rejected; }
  }
});
test("200 the same deadline bounds stalled fetch, body stream and digest with no late clear", async t => {
  const stream = new ReadableStream<Uint8Array>({ start() {}, cancel() {} });
  for (const response of [() => new Promise<Response>(() => {}), () => Promise.resolve(new Response(stream, { headers: { "content-type": "application/json" } }))]) {
    const f = fixture({ timeoutMs: 10, response }), { raw } = await seed(f), started = performance.now();
    await assert.rejects(f.client.recover()); assert(performance.now() - started < 1000); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.writes.length, 0);
  }
  const f = fixture({ timeoutMs: 10 }), { raw } = await seed(f), late = deferred<ArrayBuffer>(), original = crypto.subtle.digest.bind(crypto.subtle);
  const mock = t.mock.method(crypto.subtle, "digest", () => late.promise); await assert.rejects(f.client.load()); mock.mock.restore();
  late.resolve(await original("SHA-256", new Uint8Array([1]))); await tick(); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.client.getSnapshot().result, null);
});
test("200 storage exceptions and durable-set failure block HTTP without losing bytes", async () => {
  let durable: string | null = null, fail = true;
  const storage: CycleSendStorage = { getItem: () => durable, setItem: (_key, value) => { durable = value; if (fail) throw Error("durable write then unavailable"); }, removeItem: () => { durable = null; } };
  const f = fixture({ storage }); await assert.rejects(f.client.submit(frame, command)); assert(durable); assert.equal(f.calls.length, 0); assert.equal(f.client.hasLeaveRisk(), true);
  fail = false; await f.client.load(); assert.equal(f.client.getSnapshot().pending?.command.operationId, command.operationId); await f.client.recover(); assert.equal(durable, null);
  const broken = fixture({ storage: { getItem: () => { throw Error("unavailable"); }, setItem: () => assert.fail(), removeItem: () => assert.fail() } });
  await assert.rejects(broken.client.load()); await assert.rejects(broken.client.submit(frame, command)); assert.equal(broken.calls.length, 0); assert.equal(broken.client.hasLeaveRisk(), true);
});
test("200 complete caller frame/command is owned before digest or scheduling can mutate it", async () => {
  const f = fixture(), ownedFrame = { ...frame }, ownedCommand = { ...command }, submission = f.client.submit(ownedFrame, ownedCommand);
  ownedFrame.workerId = id(99); ownedCommand.reason = "later caller mutation"; await submission;
  const p = f.client.getSnapshot().pending!; assert.equal(p.frame.workerId, frame.workerId); assert.equal(p.command.reason, command.reason);
  assert.equal(p.commandFingerprint, await cycleSendCommandFingerprint(frame, command, actor)); assert(Object.isFrozen(p.frame)); assert(Object.isFrozen(p.command));
  assert.equal(f.calls.length, 1); assert.equal(f.writes.filter(w => w.method === "remove").length, 0);
});
