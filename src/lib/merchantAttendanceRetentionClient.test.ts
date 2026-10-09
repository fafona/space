import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AttendanceRetentionClient, retentionClientCommandMatchesRead, retentionClientPendingKey,
  type RetentionClientOptions, type RetentionClientStorage } from "./merchantAttendanceRetentionClient";
import { RETENTION_API, RETENTION_CATEGORIES, RETENTION_RESULT_LIMIT, parseRetentionResponse,
  retentionCommandFingerprintText, retentionWriteQuery,
  type RetentionCategory, type RetentionCommand, type RetentionPolicy, type RetentionQuery, type RetentionRecord, type RetentionResult } from "./merchantAttendanceRetention";

// Synthetic transport/storage models; these do not attest to PostgreSQL or UI execution.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), operationId = id(2), recordId = id(3), workerId = id(4), periodId = id(5);
const at = "2026-10-07T12:00:00.000000Z", fingerprint = "a".repeat(64);
const query: RetentionQuery = { siteId, mode: "policies" };
const command: RetentionCommand = { siteId, operationId, action: "set_policy", category: "events", expectedRevision: 0,
  retentionDays: 90, reason: "明确保留期限，含中文与 café" };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const error = (code: string, status: number) => json({ ok: false, error: code }, status);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function policy(category: RetentionCategory): RetentionPolicy {
  return { category, revision: 0, retentionDays: null, operationId: null, recordedAt: null };
}
function result(data: RetentionResult["data"], canWrite = true): RetentionResult {
  return { protocol: "attendance-retention-v1", siteId, actorId, readAt: at, canWrite, data, receipt: null, disposition: "preview_only" };
}
const policies = () => result({ kind: "policies", items: RETENTION_CATEGORIES.map(policy) });
function record(category: RetentionCategory = "events", held = false): RetentionRecord {
  const event = { kind: "event" as const, eventId: recordId, workerId, locationId: id(6), operationId: id(7), sequence: 1,
    action: "clock_in" as const, rawSource: "web" as const, breakPaid: null, occurredAt: at, receivedAt: at, timeZone: "Europe/Madrid", actorEmployeeId: null };
  return { category, recordId, source: category === "events" ? event : category === "location_results"
    ? { kind: "location_summary", event, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1,
      reason: "not_provided", needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null }
    : { kind: "period_artifact", artifactId: recordId, periodId, workerId, employeeId: id(8), fromDate: "2026-10-06", throughDate: "2026-10-06",
      timeZone: "Europe/Madrid", startAt: "2026-10-05T22:00:00.000000Z", endAt: "2026-10-06T22:00:00.000000Z", recordedAt: at,
      artifactSha256: "b".repeat(64), artifactBytes: 123, sourceFingerprint: "c".repeat(64) },
    sourceFingerprint: fingerprint, policy: policy(category), anchorAt: at, asOf: at, dueAt: null, ageState: "unconfigured",
    preservation: held ? { revision: 1, held: true, operationId: id(9), actorId, reason: "历史保留", recordedAt: at }
      : { revision: 0, held: false, operationId: null, actorId: null, reason: null, recordedAt: null } };
}
function saved(c: RetentionCommand = command): RetentionResult {
  return { ...result({ kind: "receipt" }, false), receipt: { operationId: c.operationId, actorId, revision: c.expectedRevision + 1,
    command: c, commandFingerprint: hash(retentionCommandFingerprintText(c)), recordedAt: at } };
}
function wire(r: RetentionResult, q: RetentionQuery = query, c: RetentionCommand | null = null) {
  const value = { ok: true, canWrite: r.canWrite, data: r };
  parseRetentionResponse(value, q, actorId, c); return value;
}
class MemoryStorage implements RetentionClientStorage {
  values = new Map<string, string>(); writes = 0; removes = 0;
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => { this.writes++; this.values.set(key, value); };
  removeItem = (key: string) => { this.removes++; this.values.delete(key); };
}
type Call = { path: string; init?: RequestInit };
function setup(respond: (call: Call) => Response | Promise<Response>, options: Partial<Omit<RetentionClientOptions, "apiFetch">> = {}) {
  const storage = new MemoryStorage(), calls: Call[] = [];
  const apiFetch = async (path: string, init?: RequestInit) => { const call = { path, init }; calls.push(call); return respond(call); };
  const client = new AttendanceRetentionClient({ siteId, actorId, enabled: true, storage: () => storage, apiFetch, ...options });
  return { client, storage, calls, apiFetch };
}
async function ready(respond: (call: Call) => Response | Promise<Response>, options: Partial<Omit<RetentionClientOptions, "apiFetch">> = {},
  read = policies(), q: RetentionQuery = query) {
  const h = setup(call => call.init?.method === "GET" && !call.path.includes("mode=recover") ? json(wire(read, q)) : respond(call), options);
  await h.client.initialize(); await h.client.load(q); assert.equal(h.client.getSnapshot().phase, "ready"); return h;
}
const pendingRaw = (c: RetentionCommand = command, owner = actorId) => JSON.stringify({ version: 1, actorId: owner, query: retentionWriteQuery(c), command: c });
function unknown(h: ReturnType<typeof setup>, raw?: string) {
  assert.equal(h.client.getSnapshot().phase, "unconfirmed"); assert(h.client.getSnapshot().pending);
  assert.equal(h.client.getSnapshot().canWrite, false); assert.equal(h.client.getSnapshot().canEndRejectedAttempt, false);
  assert.equal(h.storage.removes, 0); if (raw !== undefined) assert.equal(h.storage.getItem(h.client.storageKey), raw);
}

test("initialization is local-only, scope-isolated and explicit reads are immutable", async () => {
  const h = setup(() => json(wire(policies())));
  await h.client.initialize(); assert.equal(h.calls.length, 0); assert.equal(h.client.hasLeaveRisk(), false);
  await h.client.load(query); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init?.method, "GET");
  assert.equal(h.calls[0].path.split("?")[0], RETENTION_API); assert.equal(h.calls[0].init?.body, undefined);
  assert(Object.isFrozen(h.client.getSnapshot())); assert(Object.isFrozen(h.client.getSnapshot().result?.data));
  assert.equal(new Set([h.client.storageKey, retentionClientPendingKey(siteId, id(99)), retentionClientPendingKey("99990002", actorId)]).size, 3);
});

test("one POST is preceded by durable exact scoped storage and receipt validates UTF8 SHA", async () => {
  const h: Awaited<ReturnType<typeof ready>> = await ready(call => {
    const raw = h.storage.getItem(h.client.storageKey); assert(raw); assert.equal(h.storage.writes, 1);
    assert.deepEqual(JSON.parse(raw), JSON.parse(pendingRaw())); assert.deepEqual(JSON.parse(String(call.init?.body)), { query, command });
    return json(wire(saved(), query, command));
  });
  await h.client.submit(command); assert.equal(h.calls.length, 2); assert.equal(h.storage.removes, 1);
  assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.client.hasLeaveRisk(), false);
  assert.equal(h.client.getSnapshot().canWrite, false); assert.equal(h.calls[1].init?.cache, "no-store"); assert.equal(h.calls[1].init?.redirect, "error");
  await h.client.submit(command); assert.equal(h.calls.length, 2); // A receipt is not a fresh read.
});

test("all three categories require a current category CAS, hold/release additionally pin source fingerprint", async () => {
  for (const category of RETENTION_CATEGORIES) {
    for (const action of ["hold", "release"] as const) {
      const q: RetentionQuery = { siteId, mode: "record", category, recordId };
      const read = result({ kind: "record", item: record(category, action === "release") });
      const c: RetentionCommand = { siteId, operationId, action, category, recordId, expectedRevision: action === "release" ? 1 : 0,
        expectedSourceFingerprint: fingerprint, reason: "只登记历史单条保留元数据" };
      const h = await ready(() => json(wire(saved(c), q, c)), {}, read, q);
      assert(retentionClientCommandMatchesRead(read, q, c));
      assert(!retentionClientCommandMatchesRead(read, q, { ...c, expectedRevision: 99 }));
      assert(!retentionClientCommandMatchesRead(read, q, { ...c, expectedSourceFingerprint: "d".repeat(64) }));
      await h.client.submit(c); assert.equal(h.storage.removes, 1); assert.equal(h.calls.length, 2);
    }
  }
  const c = { ...command, category: "location_results" as const };
  assert(retentionClientCommandMatchesRead(policies(), query, c));
  assert(!retentionClientCommandMatchesRead(policies(), query, { ...c, expectedRevision: 1 }));
});

test("stale revisions, record identity/fingerprint, malformed or foreign commands never save or POST", async () => {
  for (const bad of [{ ...command, expectedRevision: 1 }, { ...command, siteId: "99990002" },
    { ...command, extra: true }, { ...command, operationId: "bad" }, { ...command, reason: "" }]) {
    const h = await ready(() => { throw Error("unexpected POST"); }); await h.client.submit(bad);
    assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0); assert.equal(h.client.getSnapshot().canWrite, false);
  }
  const q: RetentionQuery = { siteId, mode: "record", category: "events", recordId };
  for (const change of [{ expectedSourceFingerprint: "e".repeat(64) }, { expectedRevision: 1 }, { recordId: id(22) }, { category: "location_results" as const }]) {
    const h = await ready(() => { throw Error("unexpected POST"); }, {}, result({ kind: "record", item: record() }), q);
    await h.client.submit({ siteId, operationId, action: "hold", category: "events", recordId, expectedRevision: 0,
      expectedSourceFingerprint: fingerprint, reason: "明确保留", ...change });
    assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0);
  }
});

test("feature/server flag off permit explicit reads and recovery but not a new intent", async () => {
  for (const flagOff of [true, false]) {
    const read = policies(); read.canWrite = flagOff;
    const h = await ready(() => { throw Error("unexpected POST"); }, { enabled: !flagOff }, read);
    assert.equal(h.client.getSnapshot().canWrite, false); await h.client.submit(command); assert.equal(h.storage.writes, 0);
  }
  const h = setup(() => json(wire(saved(), { siteId, mode: "recover", operationId })), { enabled: false });
  h.storage.values.set(h.client.storageKey, pendingRaw()); await h.client.initialize(); assert.equal(h.calls.length, 0);
  await h.client.recover(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init?.method, "GET"); assert.equal(h.storage.removes, 1);
});

test("lost POST keeps original intent across reload; recovery sends GET only", async () => {
  const h = await ready(() => { throw Error("lost response after unknown commit"); }); await h.client.submit(command); unknown(h);
  const raw = h.storage.getItem(h.client.storageKey)!;
  const next = setup(() => json(wire(saved(), { siteId, mode: "recover", operationId })), { storage: () => h.storage, enabled: false });
  await next.client.initialize(); assert.equal(next.calls.length, 0); assert.equal(next.client.getSnapshot().pending?.command.operationId, operationId);
  assert.equal(h.storage.getItem(h.client.storageKey), raw); await next.client.recover(); assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0].init?.method, "GET"); assert.equal(next.calls[0].init?.body, undefined); assert.equal(next.client.getSnapshot().pending, null);
});

test("null recovery never means failure, never clears, never permits ending and never POSTs", async () => {
  const q: RetentionQuery = { siteId, mode: "recover", operationId };
  const h = setup(() => json(wire(result({ kind: "receipt" }, false), q)));
  const raw = pendingRaw(); h.storage.values.set(h.client.storageKey, raw); await h.client.initialize(); await h.client.recover(); unknown(h, raw);
  await h.client.endRejectedAttempt(); await h.client.submit({ ...command, operationId: id(55) }); unknown(h, raw);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init?.method, "GET");
});

test("independent receipt lookup never clears any pending, and ordinary loads cannot bypass it", async () => {
  const other = { ...command, operationId: id(77) }, q: RetentionQuery = { siteId, mode: "recover", operationId: other.operationId };
  const h = setup(() => json(wire(saved(other), q))); const raw = pendingRaw(); h.storage.values.set(h.client.storageKey, raw);
  await h.client.initialize(); await h.client.load(q); unknown(h, raw); assert.equal(h.client.getSnapshot().result?.receipt?.operationId, other.operationId);
  await h.client.load(query); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().result, null); unknown(h, raw);
  const standalone = setup(() => json(wire(saved(other), q))); await standalone.client.initialize(); await standalone.client.load(q);
  assert.equal(standalone.client.getSnapshot().phase, "ready"); assert.equal(standalone.client.getSnapshot().canWrite, false); assert.equal(standalone.storage.removes, 0);
});

test("recovery checks original actor, all command fields and the exact original hash", async () => {
  const q: RetentionQuery = { siteId, mode: "recover", operationId };
  const variants: RetentionResult[] = [];
  for (const change of [{ category: "location_results" as const }, { expectedRevision: 1 }, { retentionDays: 91 }, { retentionDays: null }, { reason: "不同原意图" }]) {
    variants.push(saved({ ...command, ...change }));
  }
  const wrongActor = saved(); wrongActor.receipt!.actorId = id(88); variants.push(wrongActor);
  const wrongHash = saved(); wrongHash.receipt!.commandFingerprint = "f".repeat(64); variants.push(wrongHash);
  const wrongScope = saved(); wrongScope.actorId = id(88); variants.push(wrongScope);
  for (const value of variants) {
    const h = setup(() => json({ ok: true, canWrite: false, data: value })); const raw = pendingRaw();
    h.storage.values.set(h.client.storageKey, raw); await h.client.initialize(); await h.client.recover(); unknown(h, raw);
  }
  // Same original command and number succeeds; receipt actor is checked independently.
  const h = setup(() => json(wire(saved(), q))); h.storage.values.set(h.client.storageKey, pendingRaw());
  await h.client.initialize(); await h.client.recover(); assert.equal(h.storage.removes, 1);
});

test("hold recovery cannot substitute record, source, category, action or revision", async () => {
  const original: RetentionCommand = { siteId, operationId, action: "hold", category: "events", recordId,
    expectedRevision: 2, expectedSourceFingerprint: fingerprint, reason: "历史单条" };
  for (const change of [{ recordId: id(44) }, { expectedSourceFingerprint: "b".repeat(64) }, { category: "location_results" as const },
    { action: "release" as const }, { expectedRevision: 3 }, { reason: "不同原因" }]) {
    const value = saved({ ...original, ...change }); const h = setup(() => json({ ok: true, canWrite: false, data: value }));
    const raw = pendingRaw(original); h.storage.values.set(h.client.storageKey, raw); await h.client.initialize(); await h.client.recover(); unknown(h, raw);
  }
});

test("only status-matched explicit no-write POST rejections permit the separate user-end action", async () => {
  for (const [code, status] of [["attendance_retention_changed", 409], ["attendance_retention_unchanged", 409],
    ["attendance_retention_disabled", 403], ["attendance_retention_not_found", 404], ["attendance_retention_too_large", 422], ["attendance_operation_conflict", 409]] as const) {
    const h = await ready(() => error(code, status)); await h.client.submit(command);
    assert.equal(h.client.getSnapshot().canEndRejectedAttempt, true); assert(h.storage.getItem(h.client.storageKey)); assert.equal(h.storage.removes, 0);
    await h.client.endRejectedAttempt(); assert.equal(h.storage.removes, 1); assert.equal(h.client.getSnapshot().phase, "idle");
    assert.equal(h.calls.length, 2); assert.equal(h.client.getSnapshot().canWrite, false);
  }
});

test("unknown/malformed/wrong-status responses and GET errors cannot authorize local end", async () => {
  for (const make of [() => error("attendance_unavailable", 503), () => error("attendance_retention_changed", 403),
    () => json({ ok: false, error: "attendance_retention_changed", extra: true }, 409), () => error("unknown", 409),
    () => error("attendance_access_denied", 403), () => json({ ok: false, error: "attendance_retention_changed" })]) {
    const h = await ready(make); await h.client.submit(command); unknown(h); await h.client.endRejectedAttempt(); unknown(h);
  }
  const h = setup(() => error("attendance_retention_changed", 409)); const raw = pendingRaw(); h.storage.values.set(h.client.storageKey, raw);
  await h.client.initialize(); await h.client.recover(); unknown(h, raw); await h.client.endRejectedAttempt(); unknown(h, raw);
});

test("storage unavailable, failed persistence and changed storage prevent POST or replacement", async () => {
  const h = await ready(() => { throw Error("unexpected POST"); });
  h.storage.setItem = () => { throw Error("quota"); }; await h.client.submit(command); assert.equal(h.calls.length, 1); assert.equal(h.storage.removes, 0);
  const ignored = await ready(() => { throw Error("unexpected POST"); }); ignored.storage.setItem = () => {};
  await ignored.client.submit(command); assert.equal(ignored.calls.length, 1); assert.equal(ignored.storage.removes, 0);
  const changed = await ready(() => { throw Error("unexpected POST"); }); const foreign = pendingRaw({ ...command, operationId: id(33) });
  changed.storage.values.set(changed.client.storageKey, foreign); await changed.client.submit(command);
  assert.equal(changed.calls.length, 1); assert.equal(changed.storage.writes, 0); assert.equal(changed.storage.getItem(changed.client.storageKey), foreign);
  const unavailable = setup(() => { throw Error("unexpected fetch"); }, { storage: () => { throw Error("disabled storage"); } });
  await unavailable.client.initialize(); await unavailable.client.load(query); assert.equal(unavailable.calls.length, 0); assert(unavailable.client.hasLeaveRisk());
});

test("a setItem that persisted then threw remains recoverable without any automatic request", async () => {
  const h = await ready(() => { throw Error("unexpected POST"); });
  h.storage.setItem = (key, raw) => { h.storage.values.set(key, raw); throw Error("storage callback failed after write"); };
  await h.client.submit(command); assert.equal(h.calls.length, 1); assert(h.client.hasLeaveRisk());
  const raw = h.storage.getItem(h.client.storageKey); assert(raw); await h.client.initialize(); assert.equal(h.calls.length, 1);
  assert.equal(h.client.getSnapshot().pending?.command.operationId, operationId); assert.equal(h.storage.getItem(h.client.storageKey), raw);
});

test("foreign or malformed local pending is not overwritten, removed or automatically fetched", async () => {
  for (const raw of [pendingRaw(command, id(99)), "not json", JSON.stringify({ ...JSON.parse(pendingRaw()), extra: 1 }),
    pendingRaw({ ...command, siteId: "99990002" }), " ".repeat(10000)]) {
    const h = setup(() => { throw Error("unexpected fetch"); }); h.storage.values.set(h.client.storageKey, raw);
    await h.client.initialize(); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.calls.length, 0);
    assert.equal(h.storage.getItem(h.client.storageKey), raw); assert.equal(h.storage.removes, 0); assert(h.client.hasLeaveRisk());
  }
});

test("in-flight storage replacement is never cleared even after an exact successful receipt", async () => {
  const waiting = deferred<Response>(); const h = await ready(() => waiting.promise);
  const task = h.client.submit(command); await tick(); assert.equal(h.calls.length, 2);
  const foreign = pendingRaw({ ...command, operationId: id(55) }); h.storage.values.set(h.client.storageKey, foreign);
  waiting.resolve(json(wire(saved(), query, command))); await task;
  assert.equal(h.storage.getItem(h.client.storageKey), foreign); assert.equal(h.storage.removes, 0); assert.equal(h.storage.writes, 1);
  assert.equal(h.client.getSnapshot().result, null); assert(h.client.hasLeaveRisk());
});

test("storage replacement between publication and dispatch blocks the sole POST", async () => {
  const h = await ready(() => { throw Error("unexpected POST"); }); const foreign = pendingRaw({ ...command, operationId: id(44) });
  h.client.subscribe(() => { if (h.client.getSnapshot().phase === "saving" && h.client.getSnapshot().pending) queueMicrotask(() => h.storage.values.set(h.client.storageKey, foreign)); });
  await h.client.submit(command); assert.equal(h.calls.length, 1); assert.equal(h.storage.getItem(h.client.storageKey), foreign); assert.equal(h.storage.removes, 0);
});

test("storage replaced after definite rejection cannot be removed by endRejectedAttempt", async () => {
  const h = await ready(() => error("attendance_retention_changed", 409)); await h.client.submit(command);
  const foreign = pendingRaw({ ...command, operationId: id(66) }); h.storage.values.set(h.client.storageKey, foreign);
  await h.client.endRejectedAttempt(); assert.equal(h.storage.getItem(h.client.storageKey), foreign); assert.equal(h.storage.removes, 0);
});

test("POST fetch timeout and late response are bounded, retain the same operation and never replay", async () => {
  const waiting = deferred<Response>(); const h = await ready(() => waiting.promise, { timeoutMs: 40 });
  await h.client.submit(command); const raw = h.storage.getItem(h.client.storageKey)!; unknown(h, raw); assert.equal(h.calls.length, 2);
  waiting.resolve(json(wire(saved(), query, command))); await tick(); unknown(h, raw);
  await h.client.submit({ ...command, operationId: id(44) }); assert.equal(h.calls.length, 2);
});

test("stalled response body times out and is cancelled without an unbounded wait", async () => {
  let cancelled = false;
  const h = await ready(() => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
    { headers: { "content-type": "application/json" } }), { timeoutMs: 40 });
  await h.client.submit(command); unknown(h); assert(cancelled); assert.equal(h.calls.length, 2);
});

test("oversized, malformed UTF8, duplicate-key and wrong MIME bodies cannot clear pending", async () => {
  const makers = [() => new Response(new Uint8Array(RETENTION_RESULT_LIMIT + 1), { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    () => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }),
    () => new Response(JSON.stringify(wire(saved(), query, command)), { headers: { "content-type": "text/html" } }),
    () => { const response = json(wire(saved(), query, command)); Object.defineProperty(response, "redirected", { value: true }); return response; },
    () => json(wire(saved(), query, command), 201)];
  for (const make of makers) { const h = await ready(make); await h.client.submit(command); unknown(h); }
});

test("pause cancels old response, clears read authority and allows only a new explicit read", async () => {
  const waiting = deferred<Response>(); let count = 0;
  const h = setup(() => ++count === 1 ? waiting.promise : json(wire(policies()))); await h.client.initialize();
  const task = h.client.load(query); await tick(); h.client.pause(); waiting.resolve(json(wire(policies()))); await task;
  assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().canWrite, false);
  await h.client.submit(command); assert.equal(h.calls.length, 1); await h.client.load(query); assert.equal(h.calls.length, 2); assert(h.client.getSnapshot().canWrite);
});

test("dispose permanently stops future reads/writes and late POST replies cannot clear original intent", async () => {
  const waiting = deferred<Response>(); const h = await ready(() => waiting.promise); const task = h.client.submit(command); await tick();
  const raw = h.storage.getItem(h.client.storageKey)!; h.client.dispose(); waiting.resolve(json(wire(saved(), query, command))); await task;
  unknown(h, raw); assert.equal(h.client.getSnapshot().result, null);
  await h.client.initialize(); await h.client.load(query); await h.client.recover(); await h.client.submit(command);
  assert.equal(h.calls.length, 2); assert.equal(h.storage.removes, 0);
});

test("hidden document blocks startup and hides in-flight responses while preserving pending", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"); const fake = { hidden: true };
  Object.defineProperty(globalThis, "document", { value: fake, configurable: true });
  try {
    const h = setup(() => { throw Error("unexpected fetch"); }); await h.client.initialize(); await h.client.load(query); assert.equal(h.calls.length, 0);
    fake.hidden = false; const waiting = deferred<Response>(); const active = await ready(() => waiting.promise);
    const task = active.client.submit(command); await tick(); const raw = active.storage.getItem(active.client.storageKey)!;
    fake.hidden = true; waiting.resolve(json(wire(saved(), query, command))); await task; unknown(active, raw);
    assert.equal(active.client.getSnapshot().result, null);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});

test("reentrant listeners cannot send after pause, and parallel submits still have one operation", async () => {
  const stopped = await ready(() => { throw Error("unexpected POST"); });
  stopped.client.subscribe(() => { if (stopped.client.getSnapshot().phase === "saving") stopped.client.pause(); });
  await stopped.client.submit(command); assert.equal(stopped.calls.length, 1); assert.equal(stopped.storage.writes, 0);
  const waiting = deferred<Response>(); const h = await ready(() => waiting.promise);
  const first = h.client.submit(command), second = h.client.submit({ ...command, operationId: id(55) }); await tick();
  assert.equal(h.calls.length, 2); assert.equal(h.storage.writes, 1); waiting.resolve(json(wire(saved(), query, command))); await Promise.all([first, second]);
  assert.equal(h.storage.removes, 1);
});

test("preview and history may be displayed but cannot authorize a command", async () => {
  const q: RetentionQuery = { siteId, mode: "preview", category: "events", workerId,
    fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z" };
  const r = result({ kind: "preview", asOf: at, items: [record()] }, false);
  const h = await ready(() => { throw Error("unexpected POST"); }, {}, r, q);
  await h.client.submit(command); assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0);
  const history: RetentionQuery = { siteId, mode: "history", category: "events", recordId: null, beforeRevision: null };
  const hh = await ready(() => { throw Error("unexpected POST"); }, {}, result({ kind: "history", items: [saved().receipt!], nextBeforeRevision: null }, false), history);
  await hh.client.submit(command); assert.equal(hh.calls.length, 1); assert.equal(hh.storage.writes, 0);
});
