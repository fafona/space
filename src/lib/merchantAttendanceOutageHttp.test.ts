import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { OUTAGE_APIS, OUTAGE_HTTP_BODY_LIMIT, OUTAGE_HTTP_ERRORS, OUTAGE_HTTP_RESPONSE_LIMIT,
  outageHttpQueryString, parseOutageHttpBody, parseOutageHttpQuery, parseOutageHttpResponse,
  type OutageHttpKind, type OutageHttpQueryMap } from "./merchantAttendanceOutageHttp";
import { OUTAGE_ERRORS } from "./merchantAttendanceOutage";
import { OUTAGE_LINKS_ERRORS } from "./merchantAttendanceOutageLinks";
import { OUTAGE_REVIEW_ERRORS } from "./merchantAttendanceOutageReview";
import { OUTAGE_RELATIONS_ERRORS } from "./merchantAttendanceOutageRelations";
import type { OutageCommand, OutageDeclaration, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinkEvidence, OutageLinkReference, OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewCommand, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";

// Synthetic protocol fixtures only: none of these values attest database facts.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), employee = id(2), declarationId = id(3), incidentId = id(4), fp = "a".repeat(64);
const at = "2026-10-07T12:00:00.000000Z";
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 };
const reference: OutageLinkReference = { kind: "session", startEventId: id(5), lastEventId: id(6), lastSequence: 2, effectOperationId: null, effectRevision: null };
const missing: OutageLinkReference = { kind: "missing", requestId: id(7), rootRequestId: id(7), approvalOperationId: id(8) };
const oq: OutageQuery = { siteId, access: "owner", mode: "incidents", afterId: null };
const lq: OutageLinksQuery = { siteId, access: "owner", declarationId, mode: "detail" };
const rq: OutageReviewQuery = { siteId, access: "owner", declarationId, mode: "history", beforeRevision: null };
const incidentCommand: OutageCommand = { action: "create_incident", operationId: id(10), incidentId, type: "network", channel: "web", locationId: null, interval, reason: "明确记录已知过去影响" };
const declareCommand: OutageCommand = { action: "declare", operationId: id(11), declarationId, incidentId, workerId: id(12), employeeId: id(13), employeeAuthUserId: employee,
  expectedWorkerVersion: 1, expectedEmployeeVersion: 2, expectedGeneration: 0, interval, statement: "本人说明", originalOperationId: null, originalChannel: null, paperReference: null };
const linkCommand: OutageLinksCommand = { action: "revoke", operationId: id(14), expectedRevision: 1, expectedFingerprint: fp, reason: "撤销旧准备依据" };
const reviewCommand: OutageReviewCommand = { action: "propose", operationId: id(15), expectedRevision: 0, expectedResultVersion: 0, expectedFingerprint: fp, reason: "明确提出核对结果" };
const url = (kind: OutageHttpKind, search: string) => `https://example.test${OUTAGE_APIS[kind]}?${search}`;
const queryUrl = <K extends OutageHttpKind>(kind: K, query: OutageHttpQueryMap[K]) => url(kind, outageHttpQueryString(kind, query));
function outageResult(query: OutageQuery = oq): OutageResult { return { protocol: "attendance-outage-v1", siteId, access: query.access, mode: query.mode, actorId: query.access === "owner" ? owner : employee,
  readAt: at, canWrite: false, items: [], detail: null, receipt: null, nextId: null }; }
function linkResult(query: OutageLinksQuery = lq): OutageLinksResult { return { protocol: "attendance-outage-links-v1", siteId, declarationId, access: query.access, mode: query.mode,
  actorId: query.access === "owner" ? owner : employee, readAt: at, canWrite: false, revision: 0, current: null, preview: null, history: [], historyTruncated: false, receipt: null }; }
function reviewResult(query: OutageReviewQuery = rq): OutageReviewResult { return { protocol: "attendance-outage-review-v1", siteId, declarationId, access: query.access, mode: query.mode,
  actorId: query.access === "owner" ? owner : employee, readAt: at, canWrite: false, revision: 0, resultVersion: 0, current: null, proposal: null, response: null, status: null, history: [], historyTruncated: false, receipt: null }; }
const envelope = (data: unknown, canWrite = false) => ({ ok: true, canWrite, data });
const invalid = (f: () => unknown) => assert.throws(f, /attendance_invalid_request/);

test("exact endpoints, limits and errors include all four protocols and safe HTTP statuses", () => {
  assert.deepEqual(OUTAGE_APIS, { outages: "/api/merchant-enterprise/attendance/outages", links: "/api/merchant-enterprise/attendance/outage-links", reviews: "/api/merchant-enterprise/attendance/outage-reviews", relations: "/api/merchant-enterprise/attendance/outage-relations" });
  assert.equal(OUTAGE_HTTP_BODY_LIMIT, 32768); assert.equal(OUTAGE_HTTP_RESPONSE_LIMIT, 2097152);
  for (const errors of [OUTAGE_ERRORS, OUTAGE_LINKS_ERRORS, OUTAGE_REVIEW_ERRORS, OUTAGE_RELATIONS_ERRORS]) for (const [code, status] of Object.entries(errors)) assert.equal(OUTAGE_HTTP_ERRORS[code], status);
  for (const [code, status] of Object.entries({ unauthorized: 401, forbidden_origin: 403, method_not_allowed: 405, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415 })) assert.equal(OUTAGE_HTTP_ERRORS[code], status);
  assert(Object.isFrozen(OUTAGE_APIS)); assert(Object.isFrozen(OUTAGE_HTTP_ERRORS));
});
test("outage GET modes roundtrip with mode-specific optional nullable cursor", () => {
  const queries: OutageQuery[] = [oq, { ...oq, afterId: id(20) }, { siteId, access: "self", mode: "declarations", incidentId, afterId: null },
    { siteId, access: "self", mode: "incident", incidentId }, { siteId, access: "self", mode: "declaration", declarationId }, { siteId, access: "self", mode: "recover", operationId: id(11) }];
  for (const q of queries) { const parsed = parseOutageHttpQuery("outages", queryUrl("outages", q)); assert.deepEqual(parsed, q); assert(Object.isFrozen(parsed)); }
  assert(!outageHttpQueryString("outages", oq).includes("afterId"));
});
test("links GET modes preserve ordered mixed refs and bounded history cursor", () => {
  const queries: OutageLinksQuery[] = [lq, { ...lq, access: "self" }, { ...lq, mode: "preview", sources: [reference, missing] },
    { ...lq, mode: "history", beforeRevision: null }, { ...lq, access: "self", mode: "history", beforeRevision: 101 }, { ...lq, mode: "recover", operationId: id(14) }];
  for (const q of queries) assert.deepEqual(parseOutageHttpQuery("links", queryUrl("links", q)), q);
  const parsed = parseOutageHttpQuery("links", queryUrl("links", queries[2])); assert(parsed.mode === "preview"); assert(Object.isFrozen(parsed.sources[0]));
});
test("reviews support owner/self exact recovery and the reserved history tail", () => {
  const queries: OutageReviewQuery[] = [rq, { ...lq }, { ...rq, access: "self", beforeRevision: 1001 }, { ...lq, access: "self", mode: "recover", operationId: id(16) }];
  for (const q of queries) assert.deepEqual(parseOutageHttpQuery("reviews", queryUrl("reviews", q)), q);
});
test("GET cannot broaden role bounds or sneak write/authority fields into reads", () => {
  invalid(() => parseOutageHttpQuery("outages", queryUrl("outages", oq).replace("owner", "self")));
  for (const q of [{ ...lq, mode: "preview", sources: [reference] }, { ...lq, mode: "recover", operationId: id(14) }] as OutageLinksQuery[]) invalid(() => parseOutageHttpQuery("links", queryUrl("links", q).replace("owner", "self")));
  for (const key of ["command", "actorId", "allowWrite", "currentOwner", "__proto__", "constructor"]) invalid(() => parseOutageHttpQuery("links", queryUrl("links", lq) + `&${key}=true`));
  invalid(() => outageHttpQueryString("reviews", { ...rq, beforeRevision: 1002 }));
});
test("GET rejects duplicate decoded keys and mixed-mode nullable fields", () => {
  const good = queryUrl("outages", oq);
  for (const tail of ["&siteId=" + siteId, "&%73iteId=" + siteId, "&operationId=" + id(10), "&afterId=null", "&afterId=", "&beforeRevision=1"]) invalid(() => parseOutageHttpQuery("outages", good + tail));
  invalid(() => parseOutageHttpQuery("links", queryUrl("links", lq) + "&beforeRevision=1"));
  invalid(() => parseOutageHttpQuery("reviews", queryUrl("reviews", rq) + "&beforeRevision=1&beforeRevision=1"));
});
test("history cursor accepts only canonical positive decimals within its own protocol", () => {
  for (const bad of ["0", "-0", "+1", "%2B1", "01", "1.0", "1e2", "null", "", "Infinity", "%201", "9007199254740993"]) invalid(() => parseOutageHttpQuery("reviews", queryUrl("reviews", rq) + "&beforeRevision=" + bad));
  invalid(() => parseOutageHttpQuery("links", queryUrl("links", { ...lq, mode: "history", beforeRevision: null }) + "&beforeRevision=102"));
});
test("links sources JSON is duplicate-aware at every object depth", () => {
  const prefix = queryUrl("links", lq).replace("mode=detail", "mode=preview") + "&sources=";
  const valid = JSON.stringify([reference]);
  for (const bad of [valid.replace('"kind":"session"', '"kind":"session","kind":"session"'), valid.replace('"kind":"session"', '"kind":"session","\\u006bind":"session"'), JSON.stringify([reference, reference]), "[]", "null", "{\"__proto__\":{}}", "[", JSON.stringify(Array(11).fill(reference))]) invalid(() => parseOutageHttpQuery("links", prefix + encodeURIComponent(bad)));
});
test("URL spelling is checked before URL percent/whitespace/hash normalization", () => {
  const good = queryUrl("outages", oq);
  for (const bad of [good + "#", good + "#ignored", " " + good, good + "\n", good.replace("https:", "javascript:"), good.replace("https://", "https://user:password@"), good.replace("https://", "https:\\"), good + "%", good + "%GG", good + "%C0%AF", good + "%ED%A0%80", good + "%00", good + "%7f", good + "%C2%85", good + "\ud800", "/api?siteId=" + siteId]) invalid(() => parseOutageHttpQuery("outages", bad));
});
test("URL and body limits count UTF8 bytes, not JavaScript code units", () => {
  invalid(() => parseOutageHttpQuery("outages", queryUrl("outages", oq) + "&x=" + "😀".repeat(9000)));
  assert.throws(() => parseOutageHttpBody("outages", " ".repeat(OUTAGE_HTTP_BODY_LIMIT + 1), owner), /attendance_body_too_large/);
  assert.throws(() => parseOutageHttpBody("outages", { query: oq, command: "😀".repeat(9000) }, owner), /attendance_body_too_large/);
});
test("POST requires exact query plus command and the actual actor UUID", () => {
  const body = { query: { siteId, access: "owner", mode: "incident", incidentId }, command: incidentCommand };
  assert.deepEqual(parseOutageHttpBody("outages", body, owner), body);
  assert.deepEqual(parseOutageHttpBody("outages", JSON.stringify(body), owner), body);
  assert(Object.isFrozen(parseOutageHttpBody("outages", body, owner).command));
  for (const bad of [{ ...body, authUserId: owner }, { ...body, command: null }, { ...body, query: oq }, { ...body, query: { ...body.query, incidentId: id(99) } }]) invalid(() => parseOutageHttpBody("outages", bad, owner));
  invalid(() => parseOutageHttpBody("outages", body, "not-auth"));
  invalid(() => parseOutageHttpBody("outages", { ...body, query: { ...body.query, access: "self" } }, employee));
});
test("self declaration binds the real Auth and owner transcription stays explicit", () => {
  const body = { query: { siteId, access: "self", mode: "declaration", declarationId }, command: declareCommand };
  assert.deepEqual(parseOutageHttpBody("outages", body, employee), body);
  invalid(() => parseOutageHttpBody("outages", body, owner));
  invalid(() => parseOutageHttpBody("outages", { ...body, command: { ...declareCommand, actorId: employee } }, employee));
  assert.doesNotThrow(() => parseOutageHttpBody("outages", { ...body, query: { ...body.query, access: "owner" } }, owner));
});
test("link writes require owner detail and reject preview/history/recover or self", () => {
  const body = { query: lq, command: linkCommand };
  assert.deepEqual(parseOutageHttpBody("links", body, owner), body);
  assert.doesNotThrow(() => parseOutageHttpBody("links", { query: lq, command: { ...linkCommand, action: "apply", expectedRevision: 0, sources: [reference, missing] } }, owner));
  for (const query of [{ ...lq, access: "self" }, { ...lq, mode: "history", beforeRevision: null }, { ...lq, mode: "recover", operationId: id(14) }, { ...lq, mode: "preview", sources: [reference] }]) invalid(() => parseOutageHttpBody("links", { ...body, query }, owner));
});
test("review writes preserve owner/self action separation and exact six fields", () => {
  const query: OutageReviewQuery = { ...lq }, body = { query, command: reviewCommand };
  assert.deepEqual(parseOutageHttpBody("reviews", body, owner), body);
  for (const action of ["confirm", "dispute"] as const) {
    const command: OutageReviewCommand = { ...reviewCommand, action, expectedRevision: 1, expectedResultVersion: 1 };
    assert.doesNotThrow(() => parseOutageHttpBody("reviews", { query: { ...query, access: "self" }, command }, employee));
    invalid(() => parseOutageHttpBody("reviews", { query, command }, owner));
  }
  for (const action of ["propose", "resolve", "reopen"] as const) invalid(() => parseOutageHttpBody("reviews", { query: { ...query, access: "self" }, command: { ...reviewCommand, action } }, employee));
  invalid(() => parseOutageHttpBody("reviews", { ...body, command: { ...reviewCommand, confirmedBy: employee } }, owner));
  invalid(() => parseOutageHttpBody("reviews", { ...body, query: rq }, owner));
});
test("untrusted JSON rejects duplicates, non-data properties, cycles and exotic trees", () => {
  const body = { query: lq, command: linkCommand }, text = JSON.stringify(body);
  invalid(() => parseOutageHttpBody("links", text.replace('"query":', '"query":{},"query":'), owner));
  invalid(() => parseOutageHttpBody("links", text.replace('"reason":', '"reason":"old","reason":'), owner));
  let invoked = false;
  invalid(() => parseOutageHttpBody("links", { get query() { invoked = true; return lq; }, command: linkCommand }, owner)); assert.equal(invoked, false);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  for (const raw of [circular, new Date(), { ...body, x: undefined }, { ...body, x: BigInt(1) }, { ...body, [Symbol("hidden")]: true }, { ...body, command: { ...linkCommand, expectedRevision: -0 } }]) invalid(() => parseOutageHttpBody("links", raw, owner));
});
test("three response branches preserve exact validated result and deep freeze copies", () => {
  const old = outageResult(), result = parseOutageHttpResponse("outages", envelope(old), oq, owner);
  assert.deepEqual(result, { canWrite: false, result: old }); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.result.items)); assert(!Object.isFrozen(old));
  assert.deepEqual(parseOutageHttpResponse("links", JSON.stringify(envelope(linkResult())), lq, owner).result, linkResult());
  assert.deepEqual(parseOutageHttpResponse("reviews", envelope(reviewResult()), rq, owner).result, reviewResult());
});
test("envelope write gate may be broader, never narrower than current data eligibility", () => {
  assert.equal(parseOutageHttpResponse("outages", envelope(outageResult(), true), oq, owner).canWrite, true);
  assert.equal(parseOutageHttpResponse("links", envelope({ ...linkResult(), canWrite: true }, true), lq, owner).result.canWrite, true);
  assert.throws(() => parseOutageHttpResponse("links", envelope({ ...linkResult(), canWrite: true }, false), lq, owner), /attendance_outage_links_invalid/);
  assert.throws(() => parseOutageHttpResponse("outages", { ...envelope(outageResult()), canWrite: "false" }, oq, owner), /attendance_outage_invalid/);
});
test("HTTP envelope rejects authority extras, private sourceText and malformed successful bodies", () => {
  for (const patch of [{ ok: false }, { ok: "true" }, { sourceText: "private" }, { actorId: owner }, { data: { ...outageResult(), sourceText: "private" } }]) assert.throws(() => parseOutageHttpResponse("outages", { ...envelope(outageResult()), ...patch }, oq, owner), /attendance_outage_invalid/);
  assert.throws(() => parseOutageHttpResponse("reviews", envelope(linkResult()), rq, owner), /attendance_outage_review_invalid/);
  const text = JSON.stringify(envelope(outageResult()));
  assert.throws(() => parseOutageHttpResponse("outages", text.replace('"ok":true', '"ok":true,"ok":true'), oq, owner), /attendance_outage_invalid/);
  assert.throws(() => parseOutageHttpResponse("outages", " ".repeat(OUTAGE_HTTP_RESPONSE_LIMIT + 1), oq, owner), /attendance_outage_invalid/);
});
test("response cannot cross actor/site/access/mode/declaration scopes", () => {
  for (const patch of [{ siteId: "99990002" }, { actorId: employee }, { access: "self" }, { mode: "history" }, { declarationId: id(99) }]) assert.throws(() => parseOutageHttpResponse("links", envelope({ ...linkResult(), ...patch }), lq, owner), /attendance_outage_links_invalid/);
  assert.throws(() => parseOutageHttpResponse("reviews", envelope(reviewResult()), rq, employee), /attendance_outage_review_invalid/);
});
test("owner and self outage receipt recovery remains minimal and query-bound", () => {
  const query: OutageQuery = { siteId, access: "self", mode: "recover", operationId: declareCommand.operationId };
  const data: OutageResult = { ...outageResult(query), receipt: { operationId: declareCommand.operationId, action: "declare", recordId: declarationId, incidentId, actorId: employee, commandFingerprint: fp, recordedAt: at } };
  assert.deepEqual(parseOutageHttpResponse("outages", envelope(data), query, employee).result, data);
  for (const patch of [{ operationId: id(99) }, { actorId: owner }]) assert.throws(() => parseOutageHttpResponse("outages", envelope({ ...data, receipt: { ...data.receipt!, ...patch } }), query, employee), /attendance_outage_invalid/);
  assert.throws(() => parseOutageHttpResponse("outages", envelope({ ...data, canWrite: true }, true), query, employee), /attendance_outage_invalid/);
  assert.throws(() => parseOutageHttpResponse("outages", envelope(data), query, employee, declareCommand), /attendance_outage_invalid/);
});
test("link POST/recovery retain original entry while enforcing command intent fields", () => {
  const entry = { operationId: linkCommand.operationId, revision: 2, action: "revoke" as const, actorId: owner, reason: linkCommand.reason, sources: [], evidence: null, fingerprint: fp, recordedAt: at };
  const data: OutageLinksResult = { ...linkResult(), revision: 2, receipt: { operationId: entry.operationId, commandFingerprint: fp, entry } };
  assert.deepEqual(parseOutageHttpResponse("links", envelope(data, true), lq, owner, linkCommand).result, data);
  const query: OutageLinksQuery = { ...lq, mode: "recover", operationId: entry.operationId };
  assert.doesNotThrow(() => parseOutageHttpResponse("links", envelope({ ...data, mode: "recover" }), query, owner));
  assert.throws(() => parseOutageHttpResponse("links", envelope(data), lq, owner, { ...linkCommand, reason: "其他原意图" }), /attendance_outage_links_invalid/);
  assert.throws(() => parseOutageHttpResponse("links", envelope({ ...data, mode: "recover" }), query, owner, linkCommand), /attendance_outage_links_invalid/);
});
test("review POST and self recovery bind the saved proposal and exact response version", () => {
  const evidence: OutageLinkEvidence = { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: id(12), employeeId: id(13), employeeAuthUserId: employee, workerVersion: 1, employeeVersion: 2, generation: 0, declaredInterval: interval,
    items: [{ reference, locationId: id(20), timeZone: "Europe/Madrid", original: { startAt: interval.startAt, endAt: interval.endAt }, selected: { startAt: interval.startAt, endAt: interval.endAt }, evidenceFingerprint: fp, pending: false, open: false }] };
  const entry = { operationId: reviewCommand.operationId, revision: 1, action: "propose" as const, actorId: owner, resultVersion: 1, resultFingerprint: fp, reason: reviewCommand.reason, recordedAt: at };
  const proposal = { ...entry, evidence: { protocol: "outage-review-evidence-v1" as const, siteId, declarationId, linkOperationId: id(21), linkRevision: 1, linkFingerprint: fp, linkEvidence: evidence,
    original: { status: "not_required" as const, operationId: null, channel: null, eventId: null } } };
  const query: OutageReviewQuery = { ...lq }, data: OutageReviewResult = { ...reviewResult(query), revision: 1, resultVersion: 1, receipt: { operationId: entry.operationId, commandFingerprint: fp, entry, proposal } };
  assert.doesNotThrow(() => parseOutageHttpResponse("reviews", envelope(data, true), query, owner, reviewCommand));
  const self: OutageReviewQuery = { ...query, access: "self", mode: "recover", operationId: id(22) };
  const confirmed = { ...entry, action: "confirm" as const, operationId: id(22), actorId: employee, revision: 2 };
  const recovered = { ...data, access: "self", actorId: employee, mode: "recover", revision: 2, receipt: { operationId: id(22), commandFingerprint: fp, entry: confirmed, proposal } };
  assert.doesNotThrow(() => parseOutageHttpResponse("reviews", envelope(recovered), self, employee));
  assert.throws(() => parseOutageHttpResponse("reviews", envelope({ ...recovered, resultVersion: 2 }), self, employee), /attendance_outage_review_invalid/);
  assert.throws(() => parseOutageHttpResponse("reviews", envelope(data), query, owner, { ...reviewCommand, expectedFingerprint: "b".repeat(64) }), /attendance_outage_review_invalid/);
});
test("self declaration reads reject a different saved employee Auth even under a matching top actor", () => {
  const query: OutageQuery = { siteId, access: "self", mode: "declaration", declarationId };
  const detail: OutageDeclaration = { kind: "declaration", id: declarationId, operationId: declareCommand.operationId, incidentId, workerId: id(12), employeeId: id(13), employeeAuthUserId: employee,
    workerVersion: 1, employeeVersion: 2, generation: 0, interval, statement: "本人说明", originalOperationId: null, originalChannel: null, paperReference: null, recordedBy: "self", actorId: employee, actorEmployeeId: id(13), recordedAt: at };
  assert.doesNotThrow(() => parseOutageHttpResponse("outages", envelope({ ...outageResult(query), detail }), query, employee));
  assert.throws(() => parseOutageHttpResponse("outages", envelope({ ...outageResult(query), detail: { ...detail, employeeAuthUserId: owner } }), query, employee), /attendance_outage_invalid/);
});
test("shared HTTP module remains browser-pure and does not weaken original pure parsers", () => {
  const source = readFileSync(new URL("./merchantAttendanceOutageHttp.ts", import.meta.url), "utf8");
  assert(!/from\s+["'][^"']*(?:\.server|node:)/.test(source));
  assert(!/\bas any\b/.test(source));
  for (const name of ["parseOutageResult", "parseOutageLinksResult", "parseOutageReviewResult", "assertOutageWriteQuery", "assertOutageLinksWriteQuery", "assertOutageReviewWriteQuery"]) assert(source.includes(name));
  invalid(() => parseOutageHttpQuery("__proto__" as OutageHttpKind, queryUrl("outages", oq)));
});
