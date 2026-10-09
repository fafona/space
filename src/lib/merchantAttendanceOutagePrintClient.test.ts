import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AttendanceOutagePrintClient, type OutagePrintClientOptions } from "./merchantAttendanceOutagePrintClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { deliverOutagePrint, type OutagePrintDelivery } from "./merchantAttendanceOutagePrintBrowser";
import type { OutageDeclaration, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageReviewProposal, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), declarationId = id(3), at = "2026-10-07T12:00:00.000000Z";
function declaration(): OutageResult & { detail: OutageDeclaration } {
  return { protocol: "attendance-outage-v1", siteId, access: "owner", mode: "declaration", actorId: owner, readAt: at,
    canWrite: false, items: [], nextId: null, receipt: null,
    detail: { kind: "declaration", id: declarationId, operationId: id(4), incidentId: id(5), workerId: id(6), employeeId: id(7), employeeAuthUserId: id(2),
      workerVersion: 2, employeeVersion: 3, generation: 0,
      interval: { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 },
      statement: "仅供合成测试的声明正文", originalOperationId: null, originalChannel: null, paperReference: "P-220", recordedBy: "owner", actorId: owner,
      actorEmployeeId: null, recordedAt: "2026-10-07T11:00:00.000000Z" } };
}
function review(): OutageReviewResult {
  return { protocol: "attendance-outage-review-v1", siteId, access: "owner", mode: "detail", actorId: owner, declarationId, readAt: at, canWrite: false,
    revision: 0, resultVersion: 0, current: null, proposal: null, response: null,
    status: { basisFingerprint: null, linkOperationId: null, linkRevision: 0, linkFingerprint: null,
      blockers: ["link_missing", "result_missing", "unconfirmed"], canPropose: false, canConfirm: false, canResolve: false, resolved: false },
    history: [], historyTruncated: false, receipt: null };
}
function proposed(d = declaration()): OutageReviewResult {
  const p: OutageReviewProposal = { operationId: id(12), revision: 1, action: "propose", actorId: owner, resultVersion: 1,
    resultFingerprint: "b".repeat(64), reason: "仅供合成测试的保存理由", recordedAt: at,
    evidence: { protocol: "outage-review-evidence-v1", siteId, declarationId, linkOperationId: id(11), linkRevision: 1, linkFingerprint: "a".repeat(64),
      original: { status: "not_required", operationId: null, channel: null, eventId: null },
      linkEvidence: { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: d.detail.workerId, employeeId: d.detail.employeeId,
        employeeAuthUserId: d.detail.employeeAuthUserId, workerVersion: 5, employeeVersion: 7, generation: 2, declaredInterval: { ...d.detail.interval },
        items: [{ reference: { kind: "session", startEventId: id(8), lastEventId: id(9), lastSequence: 2, effectOperationId: null, effectRevision: null },
          locationId: id(10), timeZone: "Europe/Madrid", original: { startAt: d.detail.interval.startAt, endAt: d.detail.interval.endAt },
          selected: { startAt: d.detail.interval.startAt, endAt: d.detail.interval.endAt }, evidenceFingerprint: "c".repeat(64), pending: false, open: false }] } } };
  const { evidence: _e, ...entry } = p; void _e;
  return { ...review(), revision: 1, resultVersion: 1, current: entry, proposal: p,
    status: { basisFingerprint: p.resultFingerprint, linkOperationId: p.evidence.linkOperationId, linkRevision: 1, linkFingerprint: p.evidence.linkFingerprint,
      blockers: ["unconfirmed"], canPropose: false, canConfirm: false, canResolve: false, resolved: false } };
}
const json = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const ok = (data: OutageResult | OutageReviewResult) => json({ ok: true, canWrite: false, data });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function setup(overrides: Partial<OutagePrintClientOptions> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [], deliveries: OutagePrintDelivery[] = [];
  const clock = { time: 0 }, availability = { value: true };
  const apiFetch: AttendanceApiFetch = async (path, init) => { calls.push({ path, init }); return ok(path.includes("outage-reviews") ? review() : declaration()); };
  const client = new AttendanceOutagePrintClient({ siteId, actorId: owner, access: "owner", declarationId, apiFetch,
    available: () => availability.value, deliver: async input => { deliveries.push(input); }, now: () => clock.time, ...overrides });
  return { client, calls, deliveries, clock, availability };
}

test("blank owner/self has zero HTTP and no personal data; immutable state contains only phase/message", async t => {
  for (const access of ["owner", "self"] as const) {
    const h = setup({ access, declarationId: null }); t.after(() => h.client.invalidate());
    const seen: string[] = [], unsubscribe = h.client.subscribe(() => seen.push(h.client.getSnapshot().phase));
    await h.client.print("blank", true); unsubscribe();
    assert.deepEqual(seen, ["loading", "ready"]); assert.equal(h.calls.length, 0); assert.equal(h.deliveries.length, 1);
    assert.equal(h.deliveries[0].kind, "blank"); assert.equal(h.deliveries[0].remainingMs(), 30000); assert(h.deliveries[0].authorized());
    for (const privateValue of [siteId, owner, declarationId, declaration().detail.statement]) assert(!h.deliveries[0].html.includes(privateValue));
    assert.deepEqual(Object.keys(h.client.getSnapshot()).sort(), ["message", "phase"]); assert(Object.isFrozen(h.client.getSnapshot()));
    assert.match(h.client.getSnapshot().message, /不能确认是否出纸/);
  }
});

test("handoff freshly reads exactly two scoped no-store GETs even when canWrite is false", async t => {
  const h = setup(); t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
  assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.calls.length, 2); assert.equal(h.deliveries.length, 1);
  for (const [index, call] of h.calls.entries()) {
    const url = new URL(call.path, "https://local.invalid");
    assert.equal(url.pathname, `/api/merchant-enterprise/attendance/${index ? "outage-reviews" : "outages"}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), { siteId, access: "owner", mode: index ? "detail" : "declaration", declarationId });
    assert.equal(call.init?.method, "GET"); assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.redirect, "error"); assert.equal(call.init?.body, undefined);
  }
  assert(h.deliveries[0].html.includes(declaration().detail.statement)); assert(!JSON.stringify(h.client.getSnapshot()).includes(declaration().detail.statement));
});

test("self handoff and absent or malformed declaration targets are denied before HTTP", async t => {
  for (const options of [{ access: "self" as const }, { declarationId: null }, { declarationId: "not-a-uuid" }]) {
    const h = setup(options); t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.calls.length + h.deliveries.length, 0);
  }
});

test("ack must be exactly true; double-click while loading cannot dispatch another read or print", async t => {
  const gate = deferred<Response>(); let calls = 0;
  const h = setup({ apiFetch: async () => { calls++; return gate.promise; } }); t.after(() => h.client.invalidate());
  for (const ack of [false, "true", 1, null]) await h.client.print("handoff", ack as boolean);
  assert.equal(calls, 0); const first = h.client.print("handoff", true); await flush();
  await h.client.print("blank", true); assert.equal(calls, 1); assert.equal(h.deliveries.length, 0);
  h.client.invalidate(); await first; gate.resolve(ok(declaration())); await flush(); assert.equal(calls, 1);
});

test("strict known 401/403/503 and all non-200 success statuses refuse delivery without retry", async t => {
  for (const [status, code] of [[401, "unauthorized"], [403, "attendance_access_denied"], [503, "attendance_outage_invalid"], [201, "unauthorized"], [202, "unauthorized"], [206, "unauthorized"], [304, "unauthorized"]] as const) {
    let calls = 0; const h = setup({ apiFetch: async () => { calls++; return status === 304 ? new Response(null, { status, headers: { "Content-Type": "application/json" } }) : json({ ok: false, error: code }, status); } });
    t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
    assert.equal(h.client.getSnapshot().phase, "blocked", String(status)); assert.equal(calls, 1); assert.equal(h.deliveries.length, 0);
  }
});

test("reject unknown/wrong-status error and extra authority fields; never echo server text", async t => {
  for (const [status, raw] of [[401, { ok: false, error: "attendance_access_denied" }], [503, { ok: false, error: "private-secret" }],
    [403, { ok: false, error: "attendance_access_denied", details: "private-secret" }],
    [200, { ok: true, canWrite: false, moduleEnabled: true, data: declaration() }]] as const) {
    const h = setup({ apiFetch: async () => json(raw, status) }); t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
    assert.equal(h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "blocked"); assert(!h.client.getSnapshot().message.includes("private-secret"));
  }
});

test("fatal UTF-8, duplicate JSON keys, bad MIME, redirects and missing bodies fail closed", async t => {
  const factories: (() => Response)[] = [
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response('{"ok":true,"ok":true,"canWrite":false,"data":null}', { headers: { "Content-Type": "application/json" } }),
    () => new Response("{}", { headers: { "Content-Type": "text/html" } }),
    () => { const r = ok(declaration()); Object.defineProperty(r, "redirected", { value: true }); return r; },
    () => new Response(null, { headers: { "Content-Type": "application/json" } }),
  ];
  for (const response of factories) { const h = setup({ apiFetch: async () => response() }); t.after(() => h.client.invalidate());
    await h.client.print("handoff", true); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.deliveries.length, 0); }
});

test("response bytes, not content length, cap successful reads at 2 MiB and errors at 4096", async t => {
  for (const [status, bytes] of [[200, 2097153], [503, 4097]]) {
    let cancelled = 0;
    const h = setup({ apiFetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); }, cancel() { cancelled++; } }),
      { status, headers: { "Content-Type": "application/json", "Content-Length": "2" } }) });
    t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
    assert.equal(h.deliveries.length, 0); assert.equal(cancelled, 1); assert.equal(h.client.getSnapshot().phase, "blocked");
  }
});

test("both HTTP parsers bind actual actor/site/access/declaration and reject receipt/history substitution", async t => {
  for (const [which, patch] of [[0, { siteId: "99990002" }], [0, { actorId: id(99) }], [0, { access: "self" }],
    [0, { detail: { ...declaration().detail, id: id(98) } }], [1, { declarationId: id(98) }], [1, { actorId: id(99) }],
    [1, { siteId: "99990002" }], [1, { mode: "history" }], [1, { mode: "recover" }]] as const) {
    let calls = 0; const h = setup({ apiFetch: async () => { const n = calls++; return ok({ ...(n ? review() : declaration()), ...(n === which ? patch : {}) } as OutageResult | OutageReviewResult); } });
    t.after(() => h.client.invalidate()); await h.client.print("handoff", true); assert.equal(h.deliveries.length, 0); assert.equal(calls, which + 1);
  }
});

test("builder cross-binds saved subject/interval/original across two valid reads, without equating later versions", async t => {
  for (const change of ["none", "identity", "interval", "original"] as const) {
    const d = declaration(), r = proposed(d);
    if (change === "identity") r.proposal!.evidence.linkEvidence.employeeAuthUserId = id(99);
    if (change === "interval") r.proposal!.evidence.linkEvidence.declaredInterval.endAt = "2026-10-07T11:00:00.000000Z";
    if (change === "original") { d.detail.originalOperationId = id(98); d.detail.originalChannel = "web"; }
    const h = setup({ apiFetch: async path => ok(path.includes("outage-reviews") ? r : d) }); t.after(() => h.client.invalidate());
    await h.client.print("handoff", true); assert.equal(h.deliveries.length, change === "none" ? 1 : 0, change);
  }
});

test("invalidation aborts an ignored late first fetch, cancels its body, and never reads step two", async t => {
  const gate = deferred<Response>(); let calls = 0, cancelled = 0, signal: AbortSignal | null = null;
  const h = setup({ apiFetch: async (_path, init) => { calls++; signal = init!.signal!; return gate.promise; } }); t.after(() => h.client.invalidate());
  const running = h.client.print("handoff", true); await flush(); h.client.invalidate(); await running;
  assert.equal(h.client.getSnapshot().phase, "idle"); assert.equal((signal as AbortSignal | null)?.aborted, true);
  gate.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "Content-Type": "application/json" } })); await flush();
  assert.equal(cancelled, 1); assert.equal(calls, 1); assert.equal(h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
});

test("invalidation cancels a blocked body reader and its late body cannot print", async t => {
  let cancelled = 0;
  const h = setup({ apiFetch: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "Content-Type": "application/json" } }) });
  t.after(() => h.client.invalidate()); const running = h.client.print("handoff", true); await flush(); h.client.invalidate(); await running;
  assert.equal(cancelled, 1); assert.equal(h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
});

test("late old generation cannot overwrite a newer blank print or deliver old personal HTML", async t => {
  const gate = deferred<Response>(), h = setup({ apiFetch: async () => gate.promise }); t.after(() => h.client.invalidate());
  const first = h.client.print("handoff", true); await flush(); h.client.invalidate();
  await h.client.print("blank", true); gate.resolve(ok(declaration())); await first; await flush();
  assert.equal(h.deliveries.length, 1); assert.equal(h.deliveries[0].kind, "blank"); assert.equal(h.client.getSnapshot().phase, "ready");
});

test("available false/throw/nonboolean blocks before first read; scope loss during either GET prevents delivery", async t => {
  for (const available of [() => false, () => { throw Error("secret"); }, () => "yes" as unknown as boolean]) {
    const h = setup({ available }); t.after(() => h.client.invalidate()); await h.client.print("handoff", true);
    assert.equal(h.calls.length + h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "blocked");
  }
  for (const loseAt of [1, 2]) {
    let available = true, calls = 0; const h = setup({ available: () => available, apiFetch: async () => { calls++; if (calls === loseAt) available = false; return ok(calls === 1 ? declaration() : review()); } });
    t.after(() => h.client.invalidate()); await h.client.print("handoff", true); assert.equal(calls, loseAt); assert.equal(h.deliveries.length, 0);
  }
});

test("synchronous subscriber/available invalidation cannot authorize fetch or overwrite cleared state", async t => {
  const h = setup(); t.after(() => h.client.invalidate());
  const unsubscribe = h.client.subscribe(() => { if (h.client.getSnapshot().phase === "loading") h.client.invalidate(); });
  await h.client.print("handoff", true); unsubscribe(); assert.equal(h.calls.length + h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
  let calls = 0;
  const client: AttendanceOutagePrintClient = setup({ available: () => { client.invalidate(); return true; }, apiFetch: async () => { calls++; return ok(declaration()); } }).client;
  t.after(() => client.invalidate()); await client.print("handoff", true); assert.equal(calls, 0); assert.equal(client.getSnapshot().phase, "idle");
});

test("hidden pages fail closed; hidden after an awaited GET prevents second read", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); });
  const h = setup(); t.after(() => h.client.invalidate()); await h.client.print("blank", true); assert.equal(h.deliveries.length, 0);
  doc.hidden = false; let calls = 0; const next = setup({ apiFetch: async () => { calls++; doc.hidden = true; return ok(declaration()); } });
  t.after(() => next.client.invalidate()); await next.client.print("handoff", true); assert.equal(calls, 1); assert.equal(next.deliveries.length, 0);
});

test("synchronous loading observer reentry is busy-rejected, not a second print", async t => {
  const h = setup(); t.after(() => h.client.invalidate());
  const unsubscribe = h.client.subscribe(() => { if (h.client.getSnapshot().phase === "loading") void h.client.print("blank", true); });
  await h.client.print("handoff", true); unsubscribe();
  assert.equal(h.calls.length, 2); assert.equal(h.deliveries.length, 1); assert.equal(h.deliveries[0].kind, "handoff");
});

test("synchronous abort observer cannot make a superseded print adopt the new generation", async t => {
  const h = setup(); t.after(() => h.client.invalidate()); await h.client.print("blank", true);
  let reentered: Promise<void> | null = null;
  h.deliveries[0].signal.addEventListener("abort", () => { reentered = h.client.print("blank", true); }, { once: true });
  await h.client.print("handoff", true); await reentered;
  assert.equal(h.calls.length, 0); assert.equal(h.deliveries.length, 2); assert.equal(h.deliveries[1].kind, "blank");
  assert(!h.deliveries[1].signal.aborted); assert.equal(h.client.getSnapshot().phase, "ready");
});

test("request timeout is bounded even if fetch ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const h = setup({ apiFetch: async () => new Promise<Response>(() => {}) });
  try { const running = h.client.print("handoff", true); await flush(); t.mock.timers.tick(12000); await running;
    assert.equal(h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "blocked");
  } finally { h.client.invalidate(); t.mock.timers.reset(); }
});

test("one fixed 30-second lease survives delivery without renewal and aborts retained output exactly at expiry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let now = 0, calls = 0;
  const h = setup({ now: () => now, apiFetch: async () => { calls++; now += 9000; t.mock.timers.tick(9000); return ok(calls === 1 ? declaration() : review()); } });
  try {
    await h.client.print("handoff", true); assert.equal(h.client.getSnapshot().phase, "ready"); const output = h.deliveries[0];
    assert.equal(output.remainingMs(), 12000); assert.equal(output.signal.aborted, false);
    now += 11999; t.mock.timers.tick(11999); assert.equal(output.signal.aborted, false); assert.equal(output.remainingMs(), 1);
    now++; t.mock.timers.tick(1); assert.equal(output.signal.aborted, true); assert.equal(output.authorized(), false); assert.equal(h.client.getSnapshot().phase, "blocked");
    assert.match(h.client.getSnapshot().message, /打印结果不确定/); assert.match(h.client.getSnapshot().message, /不能收回已打印或另存/);
    assert.equal(calls, 2); assert.equal(h.deliveries.length, 1);
  } finally { h.client.invalidate(); t.mock.timers.reset(); }
});

test("deadline is rechecked after await and generation: elapsed/backward/invalid clocks never deliver", async t => {
  for (const changedClock of [30000, -1, Number.NaN, Infinity]) {
    let now = 0; const h = setup({ now: () => now, apiFetch: async () => { now = changedClock; return ok(declaration()); } });
    t.after(() => h.client.invalidate()); await h.client.print("handoff", true); assert.equal(h.deliveries.length, 0); assert.equal(h.client.getSnapshot().phase, "blocked");
  }
});

test("expiry interrupts an ignored delivery promise; explicit new print revokes earlier successful delivery", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const outputs: OutagePrintDelivery[] = [];
  const h = setup({ deliver: async input => { outputs.push(input); return new Promise<void>(() => {}); } });
  try { const running = h.client.print("blank", true); await flush(); t.mock.timers.tick(30000); await running;
    assert.equal(outputs.length, 1); assert(outputs[0].signal.aborted); assert.equal(h.client.getSnapshot().phase, "blocked");
    assert.match(h.client.getSnapshot().message, /打印结果不确定/);
  } finally { h.client.invalidate(); t.mock.timers.reset(); }
  const next = setup(); t.after(() => next.client.invalidate()); await next.client.print("blank", true); const old = next.deliveries[0];
  await next.client.print("blank", true); assert(old.signal.aborted); assert(!next.deliveries[1].signal.aborted);
  next.client.invalidate(); assert(next.deliveries[1].signal.aborted);
});

test("delivery reentry invalidation cannot publish ready, and errors never automatically retry", async t => {
  let count = 0;
  const client: AttendanceOutagePrintClient = setup({ deliver: async () => { count++; client.invalidate(); } }).client; t.after(() => client.invalidate());
  await client.print("blank", true); assert.equal(count, 1); assert.equal(client.getSnapshot().phase, "idle");
  for (const code of ["outage_print_uncertain", "outage_print_expired", "outage_print_unavailable", "secret-error"]) {
    let deliveries = 0; const h = setup({ deliver: async () => { deliveries++; throw Error(code); } }); t.after(() => h.client.invalidate());
    await h.client.print("blank", true); assert.equal(deliveries, 1); assert.equal(h.client.getSnapshot().phase, "blocked"); assert(!h.client.getSnapshot().message.includes("secret-error"));
    assert.match(h.client.getSnapshot().message, /结果不确定/);
  }
});

test("real browser adapter: controller's earlier abort listener cannot hide uncertainty after print dispatch", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  for (const loss of ["scope", "deadline", "invalidate"] as const) {
    let calls = 0, now = 0, available = true;
    class Frame extends EventTarget {
      title = ""; tabIndex = 0; style = { cssText: "" }; srcdoc = ""; isConnected = false; removed = 0;
      contentDocument = { URL: "about:srcdoc", body: { getAttribute: () => "blank" } };
      contentWindow = Object.assign(new EventTarget(), { print: () => {
        calls++;
        if (loss === "scope") available = false;
        else if (loss === "deadline") now = 30000;
        else client.invalidate();
      } });
      setAttribute() {}
      remove() { this.isConnected = false; this.removed++; }
    }
    const frame = new Frame();
    Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false, createElement: () => frame,
      body: { appendChild: () => { frame.isConnected = true; } } } });
    const { client } = setup({ now: () => now, available: () => available, deliver: deliverOutagePrint });
    try {
      const running = client.print("blank", true); await flush(); assert(frame.isConnected);
      frame.dispatchEvent(new Event("load")); await running;
      assert.equal(calls, 1); assert.equal(frame.removed, 1); assert(!frame.isConnected);
      assert.match(client.getSnapshot().message, /打印结果不确定/); assert.match(client.getSnapshot().message, /不能收回已打印或另存/);
      assert.doesNotMatch(client.getSnapshot().message, /未交付打印/);
      frame.dispatchEvent(new Event("load")); assert.equal(calls, 1);
    } finally {
      client.invalidate();
      if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
    }
  }
});

test("live delivery guard cancels immediately when scope becomes unavailable", async t => {
  const h = setup(); t.after(() => h.client.invalidate()); await h.client.print("blank", true); const input = h.deliveries[0];
  h.availability.value = false; assert.equal(input.authorized(), false); assert(input.signal.aborted); assert.throws(() => input.remainingMs());
});

test("constructor bounds request timers and controller contains no storage, POST or old export path", () => {
  for (const timeoutMs of [0, -1, 12001, 1.5, Infinity]) assert.throws(() => setup({ timeoutMs }), /invalid_options/);
  const source = readFileSync(new URL("./merchantAttendanceOutagePrintClient.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage|\.setItem\(|\.removeItem\(|method:\s*["']POST|timesheet-export)/);
  assert.match(source, /deadline: now \+ 30000/); assert.match(source, /fatal: true/); assert.match(source, /parseCaptureBrowserJson/);
});
