import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AttendanceRuleCaptureHistoryClient, matchRuleCaptureHistoryDetail, type RuleCaptureHistoryClientOptions } from "./merchantAttendanceRuleCaptureHistoryClient";
import { parseRuleCaptureHistoryHttpQuery, type RuleCaptureHistoryItem } from "./merchantAttendanceRuleCaptureHistory";
import { parseCompactRuleCaptureResponse } from "./merchantAttendanceRuleCapturesBrowser";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { ruleCaptureHistoryQuery as query, ruleCaptureHistoryResult } from "../../scripts/fixtures/attendance-rule-capture-history-model";
import { ruleCapturesQuery, ruleCapturesResult } from "../../scripts/fixtures/attendance-rule-captures-model";
import { ruleSourcesId, ruleSourcesOwner as actor } from "../../scripts/fixtures/attendance-rule-sources-model";

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const raw = (text: string, status = 200) => new Response(text, { status, headers: { "Content-Type": "application/json" } });
const detail = () => ({ ok: true, moduleEnabled: true, data: ruleCapturesResult() });
function history(moduleEnabled = true) {
  const result = ruleCaptureHistoryResult(0), receipt = ruleCapturesResult().receipt!;
  result.items = [{ operationId: receipt.operationId, sourceId: receipt.sourceId, actorId: receipt.actorId, command: receipt.command,
    observedAt: receipt.observedAt, recordedAt: receipt.recordedAt, sourceReadAt: receipt.sourceReadAt, sourceSha256: receipt.sourceSha256,
    sourceBytes: receipt.sourceBytes, applied: false, historicalApplicationProven: false }];
  return { ok: true, moduleEnabled, data: result };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(fetch?: AttendanceApiFetch, extra: Partial<RuleCaptureHistoryClientOptions> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return fetch ? fetch(url, init) : reply(String(url).includes("rule-capture-history") ? history() : detail()); };
  const options: RuleCaptureHistoryClientOptions = { siteId: query.siteId, ownerId: actor, workerId: query.workerId, apiFetch, ...extra };
  return { options, client: new AttendanceRuleCaptureHistoryClient(options), calls };
}
const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("constructor is request-free, copies identity/fetch options and rejects invalid bounds", async () => {
  const x = setup(); assert.equal(x.calls.length, 0); assert.equal(x.client.getSnapshot().phase, "idle");
  x.options.ownerId = ruleSourcesId(8); x.options.apiFetch = async () => { throw Error("changed"); };
  await x.client.firstread(); assert.equal(x.calls.length, 1); assert.equal(x.client.getSnapshot().result!.actorId, actor);
  for (const value of [{ timeoutMs: 0 }, { timeoutMs: 12001 }, { timeoutMs: null }, { ownerId: "wrong" }, { workerId: "wrong" }, { apiFetch: null }])
    assert.throws(() => new AttendanceRuleCaptureHistoryClient({ ...x.options, ...value } as RuleCaptureHistoryClientOptions));
});

test("first explicit read uses GET only, null cursor, no-store/redirect-error and freezes detached state", async () => {
  const wire = history(), x = setup(async () => reply(wire)); await x.client.firstread();
  assert.deepEqual(parseRuleCaptureHistoryHttpQuery(`https://example.test${x.calls[0].url}`), query);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.calls[0].init.cache, "no-store"); assert.equal(x.calls[0].init.redirect, "error");
  assert.equal(x.client.getSnapshot().detail, null); assert(Object.isFrozen(x.client.getSnapshot().result!.items[0].command));
  wire.data.items[0].command.reason = "changed"; assert.notEqual(x.client.getSnapshot().result!.items[0].command.reason, "changed");
});

test("pagination sends exact cutoff and identity cursor, clears old page/detail and never auto-selects", async () => {
  const first = ruleCaptureHistoryResult(25, true), held = deferred<Response>();
  const second = ruleCaptureHistoryResult(0); second.asOf = first.asOf;
  const x = setup(async () => x.calls.length === 1 ? reply({ ok: true, moduleEnabled: true, data: first }) : held.promise);
  await x.client.firstread(); const pending = x.client.next();
  assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().detail, null);
  assert.deepEqual(parseRuleCaptureHistoryHttpQuery(`https://example.test${x.calls[1].url}`), { ...query, ...first.nextCursor });
  held.resolve(reply({ ok: true, moduleEnabled: true, data: second })); await pending;
  assert.equal(x.client.getSnapshot().result!.items.length, 0); assert.equal(x.calls.length, 2);
  await x.client.next(); assert.equal(x.calls.length, 2);
});

test("select only a current visible row and verify original SHA plus every history field", async () => {
  const x = setup(); await x.client.firstread(); assert.equal(x.calls.length, 1);
  await x.client.select(ruleCapturesQuery.operationId);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "GET"]); assert.match(x.calls[1].url, /\/rule-captures\?/);
  assert.equal(x.client.getSnapshot().detail!.receipt!.operationId, ruleCapturesQuery.operationId);
  assert(!JSON.stringify(x.client.getSnapshot().detail).includes("sourceText"));
  assert(Object.isFrozen(x.client.getSnapshot().detail!.receipt!.summary));
});

test("unknown row selection makes no request and clears previous detail instead of becoming arbitrary-ID lookup", async () => {
  const x = setup(); await x.client.firstread(); await x.client.select(ruleCapturesQuery.operationId);
  await x.client.select(ruleSourcesId(999)); assert.equal(x.calls.length, 2); assert.equal(x.client.getSnapshot().phase, "blocked");
  assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().detail, null);
});

test("row-to-detail comparison covers all metadata and command equality independent of key order", async () => {
  const decoded = await parseCompactRuleCaptureResponse(detail(), ruleCapturesQuery, actor), item = history().data.items[0];
  assert(matchRuleCaptureHistoryDetail(item, decoded));
  const reordered = { ...item, command: Object.fromEntries(Object.entries(item.command).reverse()) as typeof item.command };
  assert(matchRuleCaptureHistoryDetail(reordered, decoded));
  for (const key of ["operationId", "sourceId", "actorId", "observedAt", "recordedAt", "sourceReadAt", "sourceSha256", "sourceBytes", "applied", "historicalApplicationProven"] as const) {
    const changed = { ...item, [key]: typeof item[key] === "number" ? Number(item[key]) + 1 : typeof item[key] === "boolean" ? true : `${item[key]}x` } as RuleCaptureHistoryItem;
    assert.equal(matchRuleCaptureHistoryDetail(changed, decoded), false, key);
  }
  assert.equal(matchRuleCaptureHistoryDetail({ ...item, command: { ...item.command, reason: "other" } }, decoded), false);
  assert.equal(matchRuleCaptureHistoryDetail(item, { ...decoded, receipt: null }), false);
});

test("valid original receipt with mismatched history metadata fails closed", async () => {
  for (const change of [
    (r: ReturnType<typeof history>) => { r.data.items[0].sourceId = ruleSourcesId(990); },
    (r: ReturnType<typeof history>) => { r.data.items[0].sourceSha256 = "0".repeat(64); },
    (r: ReturnType<typeof history>) => { r.data.items[0].sourceBytes++; },
    (r: ReturnType<typeof history>) => { r.data.items[0].recordedAt = "2026-10-04T12:00:00.000004Z"; },
    (r: ReturnType<typeof history>) => { r.data.items[0].command.reason = "different history reason"; },
  ]) {
    const wire = history(); change(wire); const x = setup(async url => reply(String(url).includes("history") ? wire : detail()));
    await x.client.firstread(); assert.equal(x.client.getSnapshot().phase, "ready"); await x.client.select(ruleCapturesQuery.operationId);
    assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().detail, null); assert.equal(x.client.getSnapshot().result, null);
  }
});

test("tampered SHA/source bytes, missing receipt and another-owner original are never published", async () => {
  for (const mode of ["hash", "bytes", "null", "actor"] as const) {
    const wire = detail();
    if (mode === "hash") wire.data.receipt!.sourceSha256 = "0".repeat(64);
    else if (mode === "bytes") wire.data.receipt!.sourceText += " ";
    else if (mode === "null") wire.data.receipt = null;
    else wire.data.actorId = ruleSourcesId(1);
    const x = setup(async url => reply(String(url).includes("history") ? history() : wire));
    await x.client.firstread(); await x.client.select(ruleCapturesQuery.operationId); assert.equal(x.client.getSnapshot().phase, "blocked", mode); assert.equal(x.client.getSnapshot().detail, null);
  }
});

test("paused module and inactive current worker/employee remain read-only discoverable", async () => {
  const wire = history(false); wire.data.workerActive = false; wire.data.employeeActive = false;
  const saved = detail(); saved.moduleEnabled = false;
  const x = setup(async url => reply(String(url).includes("history") ? wire : saved));
  await x.client.firstread(); assert.equal(x.client.getSnapshot().result!.moduleEnabled, false);
  await x.client.select(ruleCapturesQuery.operationId); assert.equal(x.client.getSnapshot().detail!.moduleEnabled, false); assert.equal(x.calls.length, 2);
});

test("wrong history identity and unknown nested metadata are rejected without leaking response text", async () => {
  for (const mode of ["owner", "worker", "extra"] as const) {
    const wire = history(); if (mode === "owner") wire.data.actorId = ruleSourcesId(1); else if (mode === "worker") wire.data.workerId = ruleSourcesId(1);
    else Object.assign(wire.data.items[0], { sourceText: "secret raw source" });
    const x = setup(async () => reply(wire)); await x.client.firstread(); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().result, null);
    assert(!x.client.getSnapshot().message.includes("secret"));
  }
});

test("definitive denied/identity and malformed error envelopes clear all displays without automatic retry", async () => {
  for (const [body, status] of [[{ ok: false, error: "attendance_access_denied" }, 403], [{ ok: false, error: "attendance_rule_capture_identity_changed" }, 409],
    [{ ok: false, error: "attendance_access_denied" }, 500], [{ ok: false, error: "attendance_access_denied", detail: "secret" }, 403], [{ ok: false, error: "secret" }, 503]] as const) {
    const x = setup(async () => x.calls.length === 1 ? reply(history()) : reply(body, status));
    await x.client.firstread(); await x.client.select(ruleCapturesQuery.operationId);
    assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().detail, null); assert.equal(x.calls.length, 2); assert(!x.client.getSnapshot().message.includes("secret"));
  }
});

test("success/error transport caps count UTF8 bytes and reject bad encoding, redirects, duplicate keys and type", async () => {
  const bad = [
    () => raw(" ".repeat(66561)), () => raw('"' + "汉".repeat(23000) + '"'), () => raw(" ".repeat(4097), 403),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    () => new Response(JSON.stringify(history()), { headers: { "Content-Type": "text/html" } }),
    () => raw('{"ok":true,"ok":true,"moduleEnabled":true,"data":{}}'),
    () => { const r = reply(history()); Object.defineProperty(r, "redirected", { value: true }); return r; },
  ];
  for (const response of bad) { const x = setup(async () => response()); await x.client.firstread(); assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().result, null); }
});

test("split Unicode bytes across chunks are decoded without normalization or accidental rejection", async () => {
  const wire = history(); wire.data.workerName = "历史🧭"; const bytes = new TextEncoder().encode(JSON.stringify(wire));
  const x = setup(async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { "Content-Type": "application/json" } }));
  await x.client.firstread(); assert.equal(x.client.getSnapshot().result!.workerName, "历史🧭");
});

test("one total deadline covers held headers and held body and ignores late completion", async () => {
  const held = deferred<Response>(), x = setup(async () => held.promise, { timeoutMs: 15 });
  await x.client.firstread(); assert.equal(x.client.getSnapshot().phase, "blocked"); held.resolve(reply(history())); await turn(); assert.equal(x.client.getSnapshot().result, null);
  let cancelled = false;
  const body = setup(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } }), { timeoutMs: 15 });
  await body.client.firstread(); assert.equal(body.client.getSnapshot().phase, "blocked"); assert(cancelled);
});

test("pause and superseding first read prevent both held history and old details from resurfacing", async () => {
  const held = deferred<Response>(), x = setup(async () => x.calls.length === 1 ? held.promise : reply(history()));
  const old = x.client.firstread(); x.client.pause(); assert.equal(x.client.getSnapshot().phase, "idle"); await x.client.firstread();
  const newer = x.client.getSnapshot(); held.resolve(reply(history())); await old; assert.equal(x.client.getSnapshot(), newer);
  const detailHeld = deferred<Response>(), y = setup(async url => String(url).includes("history") ? reply(history()) : detailHeld.promise);
  await y.client.firstread(); const pending = y.client.select(ruleCapturesQuery.operationId); y.client.pause(); detailHeld.resolve(reply(detail())); await pending;
  assert.equal(y.client.getSnapshot().result, null); assert.equal(y.client.getSnapshot().detail, null);
});

test("synchronous loading subscribers can hide before GET and observer exceptions cannot affect reads", async () => {
  const x = setup(); x.client.subscribe(() => { if (x.client.getSnapshot().phase === "loading") x.client.pause(); });
  await x.client.firstread(); assert.equal(x.calls.length, 0); assert.equal(x.client.getSnapshot().phase, "idle");
  const y = setup(); y.client.subscribe(() => { throw Error("observer"); }); await y.client.firstread(); assert.equal(y.client.getSnapshot().phase, "ready");
});

test("abort event reentrancy cannot let an older first read replace a newer generation", async () => {
  const gate = deferred<Response>(), x = setup(async (_, init) => {
    if (x.calls.length === 1) { init!.signal!.addEventListener("abort", () => { void x.client.firstread(); }, { once: true }); return gate.promise; }
    return reply(history());
  });
  const first = x.client.firstread(); const second = x.client.firstread(); await second; await turn(); gate.resolve(reply(history())); await first; await turn();
  assert.equal(x.calls.length, 2); assert.equal(x.client.getSnapshot().phase, "ready");
});

test("hidden state blocks new reads and invalidates pending publication", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    const x = setup(); await x.client.firstread(); assert.equal(x.calls.length, 0);
    doc.hidden = false; const held = deferred<Response>(), y = setup(async () => held.promise); const pending = y.client.firstread();
    doc.hidden = true; held.resolve(reply(history())); await pending; assert.equal(y.client.getSnapshot().result, null); assert.equal(y.client.getSnapshot().phase, "idle");
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});

test("digest falls inside the deadline and late cryptographic completion cannot republish detail", async () => {
  const subtle = globalThis.crypto.subtle, descriptor = Object.getOwnPropertyDescriptor(subtle, "digest"), original = subtle.digest;
  const started = deferred<void>(), release = deferred<void>();
  Object.defineProperty(subtle, "digest", { configurable: true, value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
    const hash = await original.apply(subtle, args); started.resolve(); await release.promise; return hash;
  } });
  try {
    const x = setup(undefined, { timeoutMs: 30 }); await x.client.firstread();
    const pending = x.client.select(ruleCapturesQuery.operationId); await started.promise; await pending;
    assert.equal(x.client.getSnapshot().phase, "blocked"); assert.equal(x.client.getSnapshot().detail, null);
    release.resolve(); await turn(); assert.equal(x.client.getSnapshot().detail, null);
  } finally { release.resolve(); if (descriptor) Object.defineProperty(subtle, "digest", descriptor); else Reflect.deleteProperty(subtle, "digest"); }
});

test("GET-only client has no persistence, auto-recovery, write actions or polling surface", () => {
  const file = readFileSync(new URL("./merchantAttendanceRuleCaptureHistoryClient.ts", import.meta.url), "utf8");
  assert.doesNotMatch(file, /sessionStorage|localStorage|setItem|removeItem|method: "POST"|setInterval|capture =|retry =|initialize =/);
  assert.match(file, /parseCompactRuleCaptureResponse/); assert.match(file, /matchRuleCaptureHistoryDetail\(item, decoded\)/);
});
