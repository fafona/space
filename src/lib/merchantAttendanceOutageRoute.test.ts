import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOutage } from "../app/api/merchant-enterprise/attendance/outages/route-handler";
import { handleOutageLinks } from "../app/api/merchant-enterprise/attendance/outage-links/route-handler";
import { handleOutageReviews } from "../app/api/merchant-enterprise/attendance/outage-reviews/route-handler";
import { executeOutage, outageCommandFingerprint } from "./merchantAttendanceOutage.server";
import { executeOutageLinks, outageLinksCommandFingerprint } from "./merchantAttendanceOutageLinks.server";
import { executeOutageReview, outageReviewCommandFingerprint } from "./merchantAttendanceOutageReview.server";
import { OUTAGE_APIS, outageHttpQueryString, type OutageHttpKind } from "./merchantAttendanceOutageHttp";
import type { OutageRouteDependencies } from "./merchantAttendanceOutageRoute.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import type { OutageCommand, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinkEvidence, OutageLinksCommand, OutageLinksQuery } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewCommand, OutageReviewEvidence, OutageReviewQuery } from "./merchantAttendanceOutageReviewContract";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99999001", owner = id(1), employee = id(2), at = "2026-10-07T12:00:00.000000Z";
const origin = "https://www.faolla.com", headers = { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" };
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 };
const oq: OutageQuery = { siteId, access: "owner", mode: "incident", incidentId: id(10) };
const oc: OutageCommand = { action: "create_incident", operationId: id(11), incidentId: id(10), type: "network", channel: "web", locationId: null, interval, reason: "记录故障，不代表工时" };
const lq: OutageLinksQuery = { siteId, access: "owner", mode: "detail", declarationId: id(20) };
const lc: OutageLinksCommand = { action: "revoke", operationId: id(21), expectedRevision: 1, expectedFingerprint: "a".repeat(64), reason: "明确撤销关联" };
const rq: OutageReviewQuery = { siteId, access: "owner", mode: "detail", declarationId: id(20) };
function linkEvidence(): OutageLinkEvidence {
  const span = { startAt: interval.startAt, endAt: interval.endAt };
  return { protocol: "outage-link-evidence-v1", siteId, declarationId: id(20), workerId: id(3), employeeId: id(4), employeeAuthUserId: employee,
    workerVersion: 2, employeeVersion: 3, generation: 0, declaredInterval: interval, items: [{
      reference: { kind: "session", startEventId: id(6), lastEventId: id(7), lastSequence: 2, effectOperationId: null, effectRevision: null },
      locationId: id(8), timeZone: "UTC", original: span, selected: { ...span }, evidenceFingerprint: "b".repeat(64), open: false, pending: false }] };
}
function proposal() {
  const link = linkEvidence(), evidence: OutageReviewEvidence = { protocol: "outage-review-evidence-v1", siteId, declarationId: id(20),
    linkOperationId: id(9), linkRevision: 1, linkFingerprint: hash(JSON.stringify(link)), linkEvidence: link,
    original: { status: "not_required", operationId: null, channel: null, eventId: null } };
  return { operationId: id(30), revision: 1, action: "propose" as const, actorId: owner, resultVersion: 1,
    resultFingerprint: hash(JSON.stringify(evidence)), reason: "负责人提出精确版本", recordedAt: at, evidence, sourceText: JSON.stringify(evidence) };
}
const rc: OutageReviewCommand = { action: "propose", operationId: id(30), expectedRevision: 0, expectedResultVersion: 0,
  expectedFingerprint: proposal().resultFingerprint, reason: proposal().reason };
const base = (kind: OutageHttpKind, q: { access: string; mode: string }, actorId = owner) => ({
  protocol: kind === "outages" ? "attendance-outage-v1" : kind === "links" ? "attendance-outage-links-v1" : "attendance-outage-review-v1",
  siteId, access: q.access, mode: q.mode, actorId, readAt: at, canWrite: false,
});
function outageSaved(q: OutageQuery = oq) {
  return { ...base("outages", q), items: [], detail: null, nextId: null, receipt: { operationId: oc.operationId, action: oc.action,
    recordId: oc.incidentId, incidentId: oc.incidentId, actorId: owner, commandFingerprint: outageCommandFingerprint(oq, oc), recordedAt: at } };
}
function linksSaved(q: OutageLinksQuery = lq) {
  return { ...base("links", q), declarationId: id(20), revision: 2, current: null, preview: null, history: [], historyTruncated: false,
    receipt: { operationId: lc.operationId, commandFingerprint: outageLinksCommandFingerprint(lq, lc), entry: { operationId: lc.operationId,
      revision: 2, action: "revoke", actorId: owner, reason: lc.reason, sources: [], evidence: null, sourceText: null, fingerprint: lc.expectedFingerprint, recordedAt: at } } };
}
function reviewsSaved(q: OutageReviewQuery = rq, c: OutageReviewCommand = rc) {
  const p = proposal(), actorId = q.access === "self" ? employee : owner;
  return { ...base("reviews", q, actorId), declarationId: id(20), revision: c.expectedRevision + 1, resultVersion: 1,
    current: null, proposal: null, response: null, status: null, history: [], historyTruncated: false,
    receipt: { operationId: c.operationId, commandFingerprint: outageReviewCommandFingerprint({ siteId: q.siteId, access: q.access, declarationId: q.declarationId, mode: "detail" }, c),
      entry: { operationId: c.operationId, revision: c.expectedRevision + 1, action: c.action, actorId, resultVersion: 1,
        resultFingerprint: c.expectedFingerprint, reason: c.reason, recordedAt: at }, proposal: p } };
}
type Common = Omit<OutageRouteDependencies<"outages">, "execute">;
function common(patch: Partial<Common> = {}): Common {
  return { authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic-validated", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<Common["entitlement"]>>,
    allow: () => true, siteEnabled: () => true, bodyTimeoutMs: 5000, ...patch };
}
type Spec = { kind: OutageHttpKind; rpc: string; command: object; query: object; get: () => Request; post: () => Request;
  recover: () => Request; read: () => unknown; saved: (recovery?: boolean) => unknown;
  run: (request: Request, deps: Common, service: AttendanceSelfRpc) => Promise<Response> };
const post = (kind: OutageHttpKind, query: object, command: object, extra: RequestInit = {}) => new Request(origin + OUTAGE_APIS[kind], {
  method: "POST", headers, body: JSON.stringify({ query, command }), ...extra,
});
const specs: Spec[] = [
  { kind: "outages", rpc: "faolla_attendance_outage_v1", query: oq, command: oc,
    get: () => new Request(origin + OUTAGE_APIS.outages + "?" + outageHttpQueryString("outages", { siteId, access: "owner", mode: "incidents", afterId: null }), { headers }),
    post: () => post("outages", oq, oc), recover: () => new Request(origin + OUTAGE_APIS.outages + "?" + outageHttpQueryString("outages", { siteId, access: "owner", mode: "recover", operationId: oc.operationId }), { headers }),
    read: () => ({ ...base("outages", { access: "owner", mode: "incidents" }), items: [], detail: null, receipt: null, nextId: null }),
    saved: recovery => outageSaved(recovery ? { siteId, access: "owner", mode: "recover", operationId: oc.operationId } : oq),
    run: (request, deps, service) => handleOutage(request, { ...deps, execute: input => executeOutage(input, service) }) },
  { kind: "links", rpc: "faolla_attendance_outage_links_v1", query: lq, command: lc,
    get: () => new Request(origin + OUTAGE_APIS.links + "?" + outageHttpQueryString("links", lq), { headers }),
    post: () => post("links", lq, lc), recover: () => new Request(origin + OUTAGE_APIS.links + "?" + outageHttpQueryString("links", { ...lq, mode: "recover", operationId: lc.operationId }), { headers }),
    read: () => ({ ...base("links", lq), declarationId: id(20), revision: 0, current: null, preview: null, history: [], historyTruncated: false, receipt: null }),
    saved: recovery => linksSaved(recovery ? { ...lq, mode: "recover", operationId: lc.operationId } : lq),
    run: (request, deps, service) => handleOutageLinks(request, { ...deps, execute: input => executeOutageLinks(input, service) }) },
  { kind: "reviews", rpc: "faolla_attendance_outage_review_v1", query: rq, command: rc,
    get: () => new Request(origin + OUTAGE_APIS.reviews + "?" + outageHttpQueryString("reviews", { ...rq, mode: "history", beforeRevision: null }), { headers }),
    post: () => post("reviews", rq, rc), recover: () => new Request(origin + OUTAGE_APIS.reviews + "?" + outageHttpQueryString("reviews", { ...rq, mode: "recover", operationId: rc.operationId }), { headers }),
    read: () => ({ ...base("reviews", { ...rq, mode: "history" }), declarationId: id(20), revision: 0, resultVersion: 0, current: null, proposal: null, response: null, status: null, history: [], historyTruncated: false, receipt: null }),
    saved: recovery => reviewsSaved(recovery ? { ...rq, mode: "recover", operationId: rc.operationId } : rq),
    run: (request, deps, service) => handleOutageReviews(request, { ...deps, execute: input => executeOutageReview(input, service) }) },
];
function fake(data: unknown) { const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data, error: null }; } };
  return { calls, service }; }
function enableServices(t: { after: (fn: () => void) => void }) {
  const keys = ["FAOLLA_ATTENDANCE_OUTAGE", "FAOLLA_ATTENDANCE_OUTAGE_LINKS", "FAOLLA_ATTENDANCE_OUTAGE_REVIEW"].flatMap(k => [k + "_ENABLED", k + "_SITE_IDS"]);
  const previous = keys.map(k => [k, process.env[k]] as const);
  for (const k of keys) process.env[k] = k.endsWith("_ENABLED") ? "1" : siteId;
  t.after(() => { for (const [k, value] of previous) { if (value === undefined) delete process.env[k]; else process.env[k] = value; } });
}

for (const spec of specs) {
  test(`${spec.kind}: actual handler and service retain precise authenticated RPC scope and response headers`, async t => {
    enableServices(t);
    const f = fake(spec.read()), response = await spec.run(spec.get(), common(), f.service);
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.canWrite, true);
    assert.equal(body.data.actorId, owner); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, spec.rpc);
    assert.deepEqual(Object.keys(f.calls[0].args).sort(), ["p_allow_write", "p_auth_user_id", "p_command", "p_query"]);
    assert.equal(f.calls[0].args.p_auth_user_id, owner); assert.equal(f.calls[0].args.p_command, null); assert.equal(f.calls[0].args.p_allow_write, true);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
  });
  test(`${spec.kind}: closed rollout or attendance entitlement still reaches SQL for reads, original GET and exact POST replay`, async t => {
    enableServices(t);
    for (const deps of [common({ siteEnabled: () => false }), common({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<Common["entitlement"]>> })]) {
      for (const [request, data, command] of [[spec.get(), spec.read(), null], [spec.recover(), spec.saved(true), null], [spec.post(), spec.saved(), spec.command]] as const) {
        const f = fake(data), r = await spec.run(request, deps, f.service); assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
        assert.equal((await r.json()).canWrite, false); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.p_allow_write, false); assert.deepEqual(f.calls[0].args.p_command, command);
      }
    }
  });
  test(`${spec.kind}: hostile origin/method/auth/rate never reaches RPC`, async () => {
    const f = fake(spec.read());
    const badMethod = await spec.run(new Request(spec.get().url, { method: "DELETE" }), common(), f.service);
    assert.equal(badMethod.status, 405); assert.equal(badMethod.headers.get("allow"), "GET, POST");
    for (const request of [new Request(spec.get().url.replace("www.faolla.com", "other.invalid")),
      new Request(spec.get(), { headers: { ...headers, origin: "https://other.invalid" } }),
      new Request(spec.get(), { headers: { ...headers, "sec-fetch-site": "same-site" } }),
      new Request(spec.post(), { headers: { "content-type": "application/json" } })]) assert.equal((await spec.run(request, common(), f.service)).status, 403);
    for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) {
      assert.equal((await spec.run(spec.get(), common({ authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods }) }), f.service)).status, 403);
    }
    const rate = await spec.run(spec.get(), common({ allow: () => false }), f.service); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
    assert.equal(f.calls.length, 0);
  });
  test(`${spec.kind}: selector injection, duplicate JSON, wrong access and POST query fail before RPC`, async () => {
    const f = fake(spec.saved()), payload = JSON.stringify({ query: spec.query, command: spec.command });
    for (const request of [new Request(spec.get().url + "&siteId=" + siteId, { headers }), new Request(spec.get().url + "&actorId=" + owner, { headers }),
      new Request(spec.get().url + "&command=%7B%7D", { headers }), new Request(origin + OUTAGE_APIS[spec.kind] + "?ignored=1", spec.post()),
      post(spec.kind, spec.query, { ...spec.command, actorId: owner }), post(spec.kind, { ...spec.query, access: "self" }, spec.command),
      post(spec.kind, spec.query, spec.command, { body: payload.replace('"reason":', '"reason":"first","reason":') }),
      post(spec.kind, spec.query, spec.command, { body: "{" })]) assert.equal((await spec.run(request, common(), f.service)).status, 400);
    assert.equal(f.calls.length, 0);
  });
  test(`${spec.kind}: real service rejects corrupt success identity, immutable receipt and source proof`, async () => {
    for (const patch of ["actor", "site", "operation", "fingerprint", "private"]) {
      const data = structuredClone(spec.saved()) as Record<string, unknown>, receipt = data.receipt as Record<string, unknown>;
      if (patch === "actor") data.actorId = id(99); if (patch === "site") data.siteId = "99999002";
      if (patch === "operation") receipt.operationId = id(99); if (patch === "fingerprint") receipt.commandFingerprint = "f".repeat(64);
      if (patch === "private") data.debug = "private secret";
      const r = await spec.run(spec.post(), common(), fake(data).service); assert.equal(r.status, 503); assert.equal(JSON.stringify(await r.json()).includes("private secret"), false);
    }
    if (spec.kind === "reviews") {
      const data = reviewsSaved(); data.receipt.proposal.sourceText = "{}";
      assert.equal((await spec.run(spec.post(), common(), fake(data).service)).status, 503);
    }
  });
}

test("bounded body checks enforce fatal UTF8, duplicate-aware parsing, stream deadline and caller abort", async () => {
  const spec = specs[0], f = fake(spec.saved()), deps = common({ bodyTimeoutMs: 15 });
  for (const [extra, status] of [[{ headers: { ...headers, "content-type": "text/plain" } }, 415],
    [{ headers: { ...headers, "content-length": "32769" } }, 413], [{ headers: { ...headers, "content-length": "-1" } }, 413],
    [{ body: " ".repeat(32769) }, 413], [{ body: new Uint8Array([0xff]) }, 400]] as [RequestInit, number][]) {
    assert.equal((await spec.run(post("outages", oq, oc, extra), deps, f.service)).status, status);
  }
  for (const aborted of [false, true]) {
    let cancelled = false;
    const controller = new AbortController(), stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => { cancelled = true; } });
    const request = post("outages", oq, oc, { body: stream, duplex: "half", signal: controller.signal } as RequestInit & { duplex: "half" });
    if (aborted) controller.abort();
    assert.equal((await spec.run(request, deps, f.service)).status, 400); assert.equal(cancelled, true);
  }
  assert.equal(f.calls.length, 0);
});
test("self confirmation uses validated employee Auth; owner cannot confirm and unknown original remains blocked", async t => {
  enableServices(t);
  const query: OutageReviewQuery = { ...rq, access: "self" }, c: OutageReviewCommand = { ...rc, action: "confirm", operationId: id(31), expectedRevision: 1, expectedResultVersion: 1, reason: "本人明确确认" };
  const f = fake(reviewsSaved(query, c)), deps = common({ authenticate: async () => ({ user: { id: employee } as User, accessToken: "synthetic", authenticationMethods: ["password"] }) });
  const r = await handleOutageReviews(post("reviews", query, c), { ...deps, execute: input => executeOutageReview(input, f.service) });
  assert.equal(r.status, 200); assert.equal(f.calls[0].args.p_auth_user_id, employee); assert.deepEqual(f.calls[0].args.p_command, c);
  assert.equal((await handleOutageReviews(post("reviews", rq, c), { ...deps, execute: input => executeOutageReview(input, f.service) })).status, 400); assert.equal(f.calls.length, 1);
  const denied = await handleOutageReviews(post("reviews", query, c), { ...deps, execute: input => executeOutageReview(input, { rpc: async () => ({ data: null, error: { message: "attendance_outage_review_blocked" } }) }) });
  assert.equal(denied.status, 409); assert.deepEqual(await denied.json(), { ok: false, error: "attendance_outage_review_blocked" });
});
test("SQL alone decides revoked authorization and safe reopen/dispute; route does not bypass gates", async () => {
  for (const [action, access, code] of [["reopen", "owner", "attendance_outage_review_disabled"], ["dispute", "self", "attendance_access_denied"]] as const) {
    const query: OutageReviewQuery = { ...rq, access }, c: OutageReviewCommand = { ...rc, action, expectedRevision: 3, expectedResultVersion: 1 };
    let calls = 0;
    const r = await handleOutageReviews(post("reviews", query, c), { ...common({ siteEnabled: () => false }), execute: input => executeOutageReview(input, { rpc: async (_name, args) => {
      calls++; assert.equal(args.p_allow_write, false); return { data: null, error: { message: code } };
    } }) });
    assert.equal(calls, 1); assert.equal(r.status, 403); assert.deepEqual(await r.json(), { ok: false, error: code });
  }
});
test("known SQL/auth statuses survive while unknown details and malformed handler success remain private", async () => {
  const spec = specs[0];
  for (const [message, status] of [["attendance_outage_changed", 409], ["attendance_outage_not_found", 404], ["attendance_access_denied", 403], ["SQL password secret", 503], ["constructor", 503]] as const) {
    const r = await spec.run(spec.get(), common(), { rpc: async () => ({ data: null, error: { message } }) });
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: status === 503 ? "attendance_unavailable" : message });
  }
  for (const [error, status, code] of [[new MerchantEnterpriseAccessError("unauthorized", 401), 401, "unauthorized"],
    [new MerchantEnterpriseAccessError("enterprise_management_disabled", 403), 403, "enterprise_management_disabled"],
    [new MerchantEnterpriseAccessError("unauthorized", 503), 503, "attendance_unavailable"], [Error("secret"), 503, "attendance_unavailable"]] as const) {
    const f = fake(spec.read()), r = await spec.run(spec.get(), common({ entitlement: async () => { throw error; } }), f.service);
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code }); assert.equal(f.calls.length, 0);
  }
  const tampered = { ...spec.read() as OutageResult, actorId: id(99) };
  const r = await handleOutage(spec.get(), { ...common(), execute: async () => tampered }); assert.equal(r.status, 503);
});
