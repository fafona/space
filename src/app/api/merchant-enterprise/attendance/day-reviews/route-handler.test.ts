// Synthetic authenticated HTTP and strict public projection, not real Auth/SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleDayReviews, dayReviewDependencies } from "./route-handler";
import { GET, POST, runtime, dynamic } from "./route";
import { DAY_REVIEW_API, DAY_REVIEW_PROTOCOL, dayReviewQueryString, dayReviewCommandFingerprintText,
  type DayReviewQuery, type DayReviewCommand } from "@/lib/merchantAttendanceDayReviewContract";
import type { DayReviewSavedResult } from "@/lib/merchantAttendanceDayReviewResult";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://www.faolla.com", url = origin + DAY_REVIEW_API, siteId = "99990199", actor = id(1), at = "2026-10-08T12:00:00.123456Z";
const query: DayReviewQuery = { siteId, access: "owner", mode: "preview", workerId: id(2), workDate: "2026-10-07", slotId: null, caseId: null };
const command: DayReviewCommand = { action: "decide", operationId: id(10), caseId: id(11), expectedRevision: 0, workerId: id(2), employeeId: id(3),
  employeeAuthUserId: id(4), expectedFingerprint: "a".repeat(64), outcome: "follow_up", calendarReference: null, selfStatementOperationId: null, reason: "继续核查" };
type Input = Parameters<typeof dayReviewDependencies.execute>[0];
const get = (q: DayReviewQuery, headers: Record<string, string> = {}) => new Request(url + "?" + dayReviewQueryString(q), { headers: { origin, ...headers } });
const post = (value: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
function result(input: Input): DayReviewSavedResult {
  const c = input.command, common = { protocol: DAY_REVIEW_PROTOCOL, siteId, actorId: input.authUserId, readAt: at };
  if (c) return { ...common, kind: "receipt", replayed: false, receipt: { operationId: c.operationId, caseId: c.action === "decide" ? c.caseId : id(11),
    revision: c.expectedRevision + 1, action: c.action, actorId: input.authUserId, recordedAt: at,
    commandFingerprint: createHash("sha256").update(dayReviewCommandFingerprintText(input.query, input.authUserId, c)).digest("hex") } };
  if (input.query.mode === "recover") return { ...common, kind: "receipt", replayed: true, receipt: { operationId: input.query.operationId, caseId: id(11), revision: 1,
    action: "decide", actorId: input.authUserId, recordedAt: at, commandFingerprint: "b".repeat(64) } };
  if (input.query.mode !== "list") throw new MerchantAttendanceError("attendance_access_denied");
  return { ...common, kind: "list", access: input.query.access, items: [], nextCursor: null };
}
function setup() {
  const calls: Input[] = [], eligibility: string[] = [];
  const d: typeof dayReviewDependencies = { authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    enabled: () => true, entitlement: async site => { eligibility.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof dayReviewDependencies.entitlement>>; },
    allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000, execute: async input => { calls.push(input); return result(input); } };
  return { d, calls, eligibility };
}
test("199 HTTP requires canonical same-origin, actual password Auth and limiter; Node/dynamic entry exports", async () => {
  assert.equal(runtime, "nodejs"); assert.equal(dynamic, "force-dynamic"); assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const s = setup(), body = { query, command };
  const foreign: Record<string, string>[] = [{ origin: "https://other.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of foreign)
    assert.equal((await handleDayReviews(post(body, headers), s.d)).status, 403);
  assert.equal((await handleDayReviews(new Request(url.replace("www.faolla.com", "other.faolla.com")), s.d)).status, 403);
  for (const methods of [[], ["magiclink"], ["recovery"], ["password", "invite"]])
    assert.equal((await handleDayReviews(post(body), { ...s.d, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: methods }) })).status, 403);
  assert.equal((await handleDayReviews(post(body), { ...s.d, allow: () => false })).status, 429);
  assert.equal((await handleDayReviews(new Request(url, { method: "DELETE" }), s.d)).status, 405); assert.equal(s.calls.length, 0);
});
test("199 body/query never accepts browser authority, guessed UTC/source, duplicate JSON, invalid UTF8 or oversize", async () => {
  const s = setup(), body = { query, command };
  for (const v of [{ ...body, authUserId: actor }, { ...body, moduleEnabled: true }, { ...body, source: {} }, { ...body, command: { ...command, classification: "normal" } }])
    assert.equal((await handleDayReviews(post(v), s.d)).status, 400);
  for (const bytes of ['{"query":null,"query":null}', new Uint8Array([0xff])])
    assert.equal((await handleDayReviews(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: bytes }), s.d)).status, 400);
  assert.equal((await handleDayReviews(post({}, { "content-type": "text/plain" }), s.d)).status, 415);
  assert.equal((await handleDayReviews(post({ x: "x".repeat(8192) }), s.d)).status, 413);
  assert.equal((await handleDayReviews(post({}, { "content-length": "9000" }), s.d)).status, 413);
  assert.equal((await handleDayReviews(new Request(url + "?siteId=" + siteId + "&siteId=" + siteId), s.d)).status, 400);
  assert.equal((await handleDayReviews(new Request(url + "?x=1", { method: "POST", headers: { origin }, body: "{}" }), s.d)).status, 400);
  assert.equal(s.calls.length, 0);
});
test("199 exact authenticated actor/command/SHA is checked again before no-store public response", async () => {
  const s = setup(), r = await handleDayReviews(post({ query, command }), s.d);
  assert.equal(r.status, 200); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].authUserId, actor); assert.equal(s.calls[0].moduleEnabled, true);
  assert.match(r.headers.get("cache-control")!, /private.*no-store/); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  for (const mutate of [(v: DayReviewSavedResult) => ({ ...v, privateCanonical: "secret" }), (v: DayReviewSavedResult) => ({ ...v, actorId: id(99) }),
    (v: DayReviewSavedResult) => v.kind === "receipt" ? { ...v, receipt: { ...v.receipt, commandFingerprint: "f".repeat(64) } } : v]) {
    const bad = await handleDayReviews(post({ query, command }), { ...s.d, execute: async input => mutate(result(input)) });
    assert.equal(bad.status, 503); assert.equal((await bad.text()).includes("secret"), false);
  }
});
test("199 flag/entitlement only permits fresh decide; saved reads/recovery and self reply reach own SQL authority with false", async () => {
  const s = setup(), safe = { ...s.d, enabled: () => false, entitlement: async () => { assert.fail("not needed"); } };
  assert.equal((await handleDayReviews(post({ query, command }), safe)).status, 200);
  assert.equal((await handleDayReviews(get({ siteId, mode: "recover", operationId: id(10) }), safe)).status, 200);
  assert.equal((await handleDayReviews(get({ siteId, access: "self", mode: "list", workerId: null, cursor: null }), safe)).status, 200);
  const selfQuery: DayReviewQuery = { siteId, access: "self", mode: "detail", caseId: id(11) };
  const self: DayReviewCommand = { action: "dispute", operationId: id(12), expectedRevision: 1, decisionOperationId: id(10), claim: null, reason: "本人提出异议" };
  assert.equal((await handleDayReviews(post({ query: selfQuery, command: self }), safe)).status, 200);
  assert(s.calls.every(v => v.moduleEnabled === false)); assert.equal(s.eligibility.length, 0);
  assert.equal((await handleDayReviews(post({ query, command }), { ...s.d, entitlement: async () => { throw Error("private"); } })).status, 200);
  assert.equal(s.calls.at(-1)!.moduleEnabled, false);
});
test("199 total/body deadlines cancel streams and never dispatch after late Auth or eligibility", async () => {
  const s = setup(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  assert.equal((await handleDayReviews(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), { ...s.d, bodyTimeoutMs: 10 })).status, 400);
  assert.equal(cancelled, true); assert.equal(s.calls.length, 0);
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  assert.equal((await handleDayReviews(get({ siteId, mode: "recover", operationId: id(10) }), { ...s.d, timeoutMs: 10, authenticate: async req => { await held; return s.d.authenticate(req); } })).status, 503);
  release(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  let finish!: () => void; const pending = new Promise<void>(r => { finish = r; });
  assert.equal((await handleDayReviews(post({ query, command }), { ...s.d, timeoutMs: 10, entitlement: async site => { await pending; return s.d.entitlement(site); } })).status, 503);
  finish(); await new Promise<void>(r => setImmediate(r)); assert.equal(s.calls.length, 0);
  assert.equal((await handleDayReviews(get({ siteId, mode: "recover", operationId: id(10) }), { ...s.d, timeoutMs: 12001 })).status, 503);
});
test("199 one unknown/failed RPC never retries, leaks SQL error or clears any client intent", async () => {
  const s = setup(); let calls = 0, signal: AbortSignal | undefined;
  const r = await handleDayReviews(post({ query, command }), { ...s.d, execute: async input => { calls++; signal = input.signal; throw new Error("private SQL details"); } });
  assert.equal(r.status, 503); assert.equal(calls, 1); assert.equal(signal?.aborted, true); assert.equal((await r.text()).includes("private SQL"), false);
});
