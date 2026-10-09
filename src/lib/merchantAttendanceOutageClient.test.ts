import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AttendanceOutageClient, outageClientCommandMatchesRead, outageClientPendingKey, type OutageClientOptions, type OutageClientStorage } from "./merchantAttendanceOutageClient";
import { OUTAGE_APIS, parseOutageHttpResponse, type OutageHttpKind, type OutageHttpQueryMap, type OutageHttpCommandMap, type OutageHttpResultMap } from "./merchantAttendanceOutageHttp";
import { outageCommandFingerprintText } from "./merchantAttendanceOutage";
import { outageLinksCommandFingerprintText } from "./merchantAttendanceOutageLinks";
import { outageReviewCommandFingerprintText } from "./merchantAttendanceOutageReview";
import type { OutageCommand, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinkEvidence, OutageLinkEntry, OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewCommand, OutageReviewEntry, OutageReviewProposal, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

// Synthetic protocol models, not attestations of database or browser execution.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), employee = id(2), declarationId = id(3), incidentId = id(4), operationId = id(10);
const at = "2026-10-07T12:00:00.000000Z", fp = "a".repeat(64);
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 };
const oq: OutageQuery = { siteId, access: "owner", mode: "incidents", afterId: null };
const ow: OutageQuery = { siteId, access: "owner", mode: "incident", incidentId };
const oc: OutageCommand = { action: "create_incident", operationId, incidentId, type: "network", channel: "web", locationId: null, interval, reason: "记录原意图，含中文和 café" };
const lq: OutageLinksQuery = { siteId, access: "owner", mode: "detail", declarationId };
const rq: OutageReviewQuery = { siteId, access: "owner", mode: "detail", declarationId };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const draft = <T extends { operationId: string }>(command: T) => { const { operationId: _id, ...rest } = command; void _id; return rest; };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (code: string, status: number) => json({ ok: false, error: code }, status);
function body<K extends OutageHttpKind>(kind: K, query: OutageHttpQueryMap[K], result: OutageHttpResultMap[K], command: OutageHttpCommandMap[K] | null = null, canWrite = true) {
  const wire = { ok: true, canWrite, data: result };
  parseOutageHttpResponse(kind, wire, query, result.actorId, command); // Each positive model must satisfy the real HTTP parser.
  return wire;
}
function outageRead(query: OutageQuery = oq): OutageResult {
  return { protocol: "attendance-outage-v1", siteId, access: query.access, mode: query.mode, actorId: query.access === "self" ? employee : owner, readAt: at,
    canWrite: true, items: [], detail: query.mode === "incident" ? { kind: "incident", id: incidentId, operationId: id(9), type: "network", channel: "web", locationId: null, interval, reason: "已登记", actorId: owner, recordedAt: at } : null, receipt: null, nextId: null };
}
function outageSaved(query: OutageQuery = ow, command: OutageCommand = oc, writeQuery: OutageQuery = ow): OutageResult {
  return { ...outageRead(query), canWrite: false, detail: null, receipt: { operationId: command.operationId, action: command.action,
    recordId: command.action === "declare" ? command.declarationId : command.incidentId, incidentId: command.incidentId,
    actorId: query.access === "self" ? employee : owner, commandFingerprint: hash(outageCommandFingerprintText(writeQuery, command)), recordedAt: at } };
}
function evidence(): OutageLinkEvidence {
  const span = { startAt: interval.startAt, endAt: interval.endAt };
  return { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: id(5), employeeId: id(6), employeeAuthUserId: employee, workerVersion: 2, employeeVersion: 3, generation: 0,
    declaredInterval: interval, items: [{ reference: { kind: "session", startEventId: id(7), lastEventId: id(8), lastSequence: 2, effectOperationId: null, effectRevision: null }, locationId: id(9), timeZone: interval.timeZone,
      original: span, selected: span, evidenceFingerprint: fp, open: false, pending: false }] };
}
const lc = (): OutageLinksCommand => ({ action: "apply", operationId, expectedRevision: 0, expectedFingerprint: fp, sources: evidence().items.map(i => i.reference), reason: "明确关联原来源" });
const lp = (): OutageLinksQuery => ({ ...lq, mode: "preview", sources: evidence().items.map(i => i.reference) });
function linkEntry(command = lc()): OutageLinkEntry {
  return { operationId: command.operationId, revision: command.expectedRevision + 1, action: command.action, actorId: owner, reason: command.reason,
    sources: command.action === "apply" ? command.sources : [], evidence: command.action === "apply" ? evidence() : null, fingerprint: command.expectedFingerprint, recordedAt: at };
}
function linkBase(query: OutageLinksQuery): OutageLinksResult {
  return { protocol: "attendance-outage-links-v1", siteId, access: query.access, mode: query.mode, actorId: owner, declarationId, readAt: at,
    canWrite: false, revision: 0, current: null, preview: null, history: [], historyTruncated: false, receipt: null };
}
function linkRead(query = lp()): OutageLinksResult {
  const e = evidence();
  return { ...linkBase(query), canWrite: true, revision: query.mode === "detail" ? 1 : 0, current: query.mode === "detail" ? linkEntry() : null,
    preview: { fingerprint: fp, evidence: e, eligible: true, observations: e.items.map(i => ({ reference: i.reference, current: i, available: true, changed: false, open: false, pending: false })), blockers: [] } };
}
function linkSaved(query = lq, command = lc()): OutageLinksResult {
  return { ...linkBase(query), revision: command.expectedRevision + 1, receipt: { operationId: command.operationId, commandFingerprint: hash(outageLinksCommandFingerprintText(lq, command)), entry: linkEntry(command) } };
}
const rc = (): OutageReviewCommand => ({ action: "propose", operationId, expectedRevision: 0, expectedResultVersion: 0, expectedFingerprint: fp, reason: "供本人明确核对" });
function proposal(): OutageReviewProposal {
  return { operationId, revision: 1, resultVersion: 1, action: "propose", actorId: owner, resultFingerprint: fp, reason: rc().reason, recordedAt: at,
    evidence: { protocol: "outage-review-evidence-v1", siteId, declarationId, linkOperationId: id(11), linkRevision: 1, linkFingerprint: fp, linkEvidence: evidence(), original: { status: "not_required", operationId: null, channel: null, eventId: null } } };
}
function reviewBase(query = rq): OutageReviewResult {
  return { protocol: "attendance-outage-review-v1", siteId, access: query.access, mode: query.mode, actorId: query.access === "self" ? employee : owner, declarationId, readAt: at,
    canWrite: false, revision: 0, resultVersion: 0, current: null, proposal: null, response: null, status: null, history: [], historyTruncated: false, receipt: null };
}
function reviewRead(query = rq): OutageReviewResult {
  return { ...reviewBase(query), canWrite: true, status: { basisFingerprint: fp, linkOperationId: id(11), linkRevision: 1, linkFingerprint: fp,
    blockers: ["result_missing", "unconfirmed"], canPropose: query.access === "owner", canConfirm: false, canResolve: false, resolved: false } };
}
function reviewSaved(query = rq, command = rc(), writeQuery = rq): OutageReviewResult {
  const entry: OutageReviewEntry = { operationId: command.operationId, revision: command.expectedRevision + 1, resultVersion: command.expectedResultVersion + (command.action === "propose" ? 1 : 0),
    action: command.action, actorId: query.access === "self" ? employee : owner, resultFingerprint: command.expectedFingerprint, reason: command.reason, recordedAt: at };
  return { ...reviewBase(query), revision: entry.revision, resultVersion: entry.resultVersion, receipt: { operationId: command.operationId, commandFingerprint: hash(outageReviewCommandFingerprintText(writeQuery, command)), entry, proposal: proposal() } };
}
class MemoryStorage implements OutageClientStorage {
  values = new Map<string, string>(); writes = 0; removes = 0;
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => { this.writes++; this.values.set(key, value); };
  removeItem = (key: string) => { this.removes++; this.values.delete(key); };
}
type Call = { path: string; init?: RequestInit };
function setup<K extends OutageHttpKind>(kind: K, respond: (call: Call) => Response | Promise<Response>, options: Partial<Omit<OutageClientOptions<K>, "kind" | "apiFetch">> = {}) {
  const storage = new MemoryStorage(), calls: Call[] = [];
  const apiFetch: AttendanceApiFetch = async (path, init) => { const call = { path, init }; calls.push(call); return respond(call); };
  const client = new AttendanceOutageClient({ kind, siteId, access: "owner", actorId: owner, enabled: true, apiFetch, storage: () => storage, operationId: () => operationId, ...options });
  return { client, storage, calls, apiFetch };
}
async function ready(respond: (call: Call) => Response | Promise<Response>, options: Partial<Omit<OutageClientOptions<"outages">, "kind" | "apiFetch">> = {}) {
  const h = setup("outages", call => call.init?.method === "GET" && !call.path.includes("mode=recover") ? json(body("outages", oq, outageRead())) : respond(call), options);
  await h.client.initialize(); await h.client.load(oq); assert.equal(h.client.getSnapshot().phase, "ready"); return h;
}
const pending = <K extends OutageHttpKind>(kind: K, query: OutageHttpQueryMap[K], command: OutageHttpCommandMap[K], actorId = owner) => JSON.stringify({ version: 1, kind, actorId, query, command });
const assertUnknown = (h: ReturnType<typeof setup<"outages">>, raw?: string) => {
  assert.equal(h.client.getSnapshot().phase, "unconfirmed"); assert(h.client.getSnapshot().pending); assert.equal(h.client.getSnapshot().result, null);
  assert.equal(h.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(h.storage.removes, 0);
  if (raw !== undefined) assert.equal(h.storage.getItem(h.client.storageKey), raw);
};

test("initialization is local-only, explicit reads are frozen and scopes have distinct keys", async () => {
  const h = setup("outages", () => json(body("outages", oq, outageRead())));
  await h.client.initialize(); assert.equal(h.calls.length, 0); assert.equal(h.client.hasLeaveRisk(), false);
  await h.client.load(oq); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init?.method, "GET"); assert.equal(h.calls[0].init?.body, undefined);
  assert.equal(h.calls[0].path.split("?")[0], OUTAGE_APIS.outages);
  assert(Object.isFrozen(h.client.getSnapshot())); assert(Object.isFrozen(h.client.getSnapshot().result));
  assert.equal(new Set([h.client.storageKey, outageClientPendingKey("links", siteId, "owner", owner), outageClientPendingKey("outages", siteId, "self", owner), outageClientPendingKey("outages", siteId, "owner", employee)]).size, 4);
});
test("disabled client permits explicit reads but never creates a new intent", async () => {
  const h = await ready(() => { throw Error("unexpected POST"); }, { enabled: false });
  await h.client.submit(ow, draft(oc)); assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0); assert.equal(h.client.hasLeaveRisk(), false);
});
test("outage submission persists once before POST and validates the UTF8 original tuple", async () => {
  const h: Awaited<ReturnType<typeof ready>> = await ready(call => { const persisted = h.storage.getItem(h.client.storageKey); assert(persisted); assert.equal(h.storage.writes, 1);
    assert.deepEqual(JSON.parse(String(call.init?.body)), { query: ow, command: oc }); return json(body("outages", ow, outageSaved(), oc)); });
  await h.client.submit(ow, draft(oc)); assert.equal(h.calls.length, 2); assert.equal(h.storage.removes, 1); assert.equal(h.client.getSnapshot().pending, null);
  assert.equal(h.client.getSnapshot().result?.receipt?.commandFingerprint, hash(JSON.stringify([siteId, "owner", oc.action, operationId, incidentId, oc.type, oc.channel, null, interval.startAt, interval.endAt, interval.timeZone, 120, 120, oc.reason])));
  assert.equal(h.calls[1].init?.cache, "no-store"); assert.equal(h.calls[1].init?.redirect, "error");
});
test("lost POST response reloads locally and recovers by GET only while flag is off", async () => {
  const h = await ready(() => { throw Error("response lost after unknown commit"); }); await h.client.submit(ow, draft(oc)); assertUnknown(h);
  const raw = h.storage.getItem(h.client.storageKey)!;
  const q: OutageQuery = { siteId, access: "owner", mode: "recover", operationId };
  const reloaded = setup("outages", call => { assert.equal(call.init?.method, "GET"); assert.equal(call.init?.body, undefined); return json(body("outages", q, outageSaved(q))); }, { enabled: false, storage: () => h.storage });
  await reloaded.client.initialize(); assert.equal(reloaded.calls.length, 0); assert.equal(h.storage.getItem(h.client.storageKey), raw);
  await reloaded.client.recover(); assert.equal(reloaded.calls.length, 1); assert.equal(h.storage.getItem(h.client.storageKey), null); assert.equal(reloaded.client.getSnapshot().pending, null);
});
test("links apply and reload recovery preserve ordered references and original CAS", async () => {
  const c = lc(), readQuery = lp(), h = setup("links", call => call.init?.method === "GET" ? json(body("links", readQuery, linkRead())) : json(body("links", lq, linkSaved(), c)));
  await h.client.initialize(); await h.client.load(readQuery); await h.client.submit(lq, draft(c)); assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.storage.removes, 1);
  const q: OutageLinksQuery = { ...lq, mode: "recover", operationId }; h.storage.setItem(h.client.storageKey, pending("links", lq, c));
  const recover = setup("links", call => { assert.equal(call.init?.method, "GET"); return json(body("links", q, linkSaved(q))); }, { storage: () => h.storage });
  await recover.client.initialize(); await recover.client.recover(); assert.equal(recover.client.getSnapshot().pending, null); assert.equal(h.storage.getItem(h.client.storageKey), null);
});
test("links reject mismatched preview references, fingerprint and revision before persisting", async () => {
  for (const patch of [{ expectedRevision: 1 }, { expectedFingerprint: "b".repeat(64) }, { sources: [{ ...evidence().items[0].reference, lastSequence: 3 }] }]) {
    const h = setup("links", () => json(body("links", lp(), linkRead()))); await h.client.initialize(); await h.client.load(lp());
    await h.client.submit(lq, { ...draft(lc()), ...patch }); assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0);
  }
});
test("links revoke uses saved apply fingerprint, never the changed preview fingerprint", () => {
  const r = linkRead(lq), c: OutageLinksCommand = { action: "revoke", operationId, expectedRevision: 1, expectedFingerprint: fp, reason: "撤销保存关联" };
  r.preview!.fingerprint = "b".repeat(64);
  assert.equal(outageClientCommandMatchesRead("links", r, lq, lq, c), true);
  assert.equal(outageClientCommandMatchesRead("links", r, lq, lq, { ...c, expectedFingerprint: r.preview!.fingerprint! }), false);
});
test("review proposal POST and flag-off recovery validate its original detail tuple", async () => {
  const h = setup("reviews", call => call.init?.method === "GET" ? json(body("reviews", rq, reviewRead())) : json(body("reviews", rq, reviewSaved(), rc())));
  await h.client.initialize(); await h.client.load(rq); await h.client.submit(rq, draft(rc())); assert.equal(h.storage.removes, 1); assert.equal(h.client.getSnapshot().pending, null);
  const q: OutageReviewQuery = { ...rq, mode: "recover", operationId }; h.storage.setItem(h.client.storageKey, pending("reviews", rq, rc()));
  const restore = setup("reviews", () => json(body("reviews", q, reviewSaved(q))), { enabled: false, storage: () => h.storage });
  await restore.client.initialize(); await restore.client.recover(); assert.equal(restore.client.getSnapshot().pending, null); assert.equal(restore.calls[0].init?.method, "GET");
});
test("review safety actions bind saved proposal while closing actions require current capability", () => {
  const p = proposal(), { evidence: _e, ...head } = p; void _e;
  const r: OutageReviewResult = { ...reviewRead(), revision: 1, resultVersion: 1, current: head, proposal: p,
    status: { ...reviewRead().status!, basisFingerprint: "b".repeat(64), blockers: ["result_changed", "unconfirmed"], canPropose: false } };
  const q: OutageReviewQuery = { ...rq, access: "self" }, c: OutageReviewCommand = { ...rc(), action: "dispute", expectedRevision: 1, expectedResultVersion: 1 };
  const self = { ...r, access: "self" as const, actorId: employee }; body("reviews", q, self);
  assert.equal(outageClientCommandMatchesRead("reviews", self, q, q, c), true);
  assert.equal(outageClientCommandMatchesRead("reviews", self, q, q, { ...c, expectedFingerprint: r.status!.basisFingerprint! }), false);
  assert.equal(outageClientCommandMatchesRead("reviews", self, q, q, { ...c, action: "confirm" }), false);
  assert.equal(outageClientCommandMatchesRead("reviews", r, rq, rq, { ...c, action: "resolve" }), false);
  assert.equal(outageClientCommandMatchesRead("reviews", r, rq, rq, { ...c, action: "reopen" }), false);
  assert.equal(outageClientCommandMatchesRead("reviews", { ...r, current: { ...head, action: "resolve", revision: 3 }, revision: 3 }, rq, rq, { ...c, action: "reopen", expectedRevision: 3 }), true);
});
test("self declaration cannot use a different Auth and never infers historical CAS", async () => {
  const readQuery: OutageQuery = { siteId, access: "self", mode: "incident", incidentId }, writeQuery: OutageQuery = { siteId, access: "self", mode: "declaration", declarationId };
  const c: OutageCommand = { action: "declare", operationId, declarationId, incidentId, workerId: id(5), employeeId: id(6), employeeAuthUserId: employee,
    expectedWorkerVersion: 5, expectedEmployeeVersion: 8, expectedGeneration: 2, interval, statement: "本人说明", originalOperationId: null, originalChannel: null, paperReference: null };
  const h = setup("outages", call => call.init?.method === "GET" ? json(body("outages", readQuery, outageRead(readQuery))) : json(body("outages", writeQuery, outageSaved(writeQuery, c, writeQuery), c)), { access: "self", actorId: employee });
  await h.client.initialize(); await h.client.load(readQuery); await h.client.submit(writeQuery, { ...draft(c), employeeAuthUserId: owner }); assert.equal(h.storage.writes, 0);
  await h.client.load(readQuery); await h.client.submit(writeQuery, draft(c)); assert.equal(h.client.getSnapshot().pending, null);
  assert.equal(h.storage.writes, 0); assert.equal(h.calls.filter(x => x.init?.method === "POST").length, 0);
  assert.equal(h.client.getSnapshot().phase, "blocked"); // Incident history cannot substitute for a current subject preparation.
});
test("wrong command hash or matching hash with wrong receipt fields never clears recovery", async () => {
  const q: OutageQuery = { siteId, access: "owner", mode: "recover", operationId };
  for (const patch of [{ commandFingerprint: "b".repeat(64) }, { incidentId: id(98), recordId: id(98) }]) {
    const r = outageSaved(q); Object.assign(r.receipt!, patch); body("outages", q, r);
    const h = setup("outages", () => json({ ok: true, canWrite: true, data: r })); const raw = pending("outages", ow, oc); h.storage.setItem(h.client.storageKey, raw);
    await h.client.initialize(); await h.client.recover(); assertUnknown(h, raw);
  }
});
test("actor, site, access and operation mismatches hide the response and retain intent", async () => {
  for (const patch of [{ actorId: employee }, { siteId: "99990002" }, { access: "self" }]) {
    const h = await ready(() => json({ ok: true, canWrite: true, data: { ...outageSaved(), ...patch } })); await h.client.submit(ow, draft(oc)); assertUnknown(h);
  }
  const r = outageSaved(); r.receipt!.operationId = id(90);
  const h = await ready(() => json({ ok: true, canWrite: true, data: r })); await h.client.submit(ow, draft(oc)); assertUnknown(h);
});
test("links and reviews recovered receipts still match structure beyond the tuple hash", async () => {
  const lrec: OutageLinksQuery = { ...lq, mode: "recover", operationId }, l = linkSaved(lrec); l.receipt!.entry.reason = "另一个理由";
  const links = setup("links", () => json(body("links", lrec, l))); links.storage.setItem(links.client.storageKey, pending("links", lq, lc()));
  await links.client.initialize(); await links.client.recover(); assert(links.client.getSnapshot().pending); assert.equal(links.storage.removes, 0);
  const rrec: OutageReviewQuery = { ...rq, mode: "recover", operationId }, r = reviewSaved(rrec); r.receipt!.entry.reason = "另一意图"; r.receipt!.proposal.reason = "另一意图";
  const reviews = setup("reviews", () => json(body("reviews", rrec, r))); reviews.storage.setItem(reviews.client.storageKey, pending("reviews", rq, rc()));
  await reviews.client.initialize(); await reviews.client.recover(); assert(reviews.client.getSnapshot().pending); assert.equal(reviews.storage.removes, 0);
});
test("duplicate JSON keys, malformed UTF8 and unexpected successful status are rejected", async () => {
  const wire = JSON.stringify(body("outages", ow, outageSaved(), oc));
  for (const response of [() => new Response(wire.replace('"ok":true', '"ok":true,"ok":true'), { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }), () => json(JSON.parse(wire), 201),
    () => new Response(wire, { headers: { "content-type": "text/html" } }), () => json({ ...JSON.parse(wire), extra: true })]) {
    const h = await ready(response); await h.client.submit(ow, draft(oc)); assertUnknown(h);
  }
});
test("only exact definitive POST rejection permits explicit end, never automatic cleanup", async () => {
  const h = await ready(() => error("attendance_outage_changed", 409)); await h.client.submit(ow, draft(oc));
  assert(h.client.getSnapshot().pending); assert.equal(h.client.getSnapshot().canEndRejectedAttempt, true); assert.equal(h.storage.removes, 0);
  await h.client.endRejectedAttempt(); assert.equal(h.client.getSnapshot().phase, "idle"); assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.storage.removes, 1);
  await h.client.submit(ow, draft(oc)); assert.equal(h.calls.length, 2);
});
test("unknown, mismatched-status and authorization POST errors cannot authorize end", async () => {
  for (const response of [() => error("attendance_outage_changed", 503), () => error("attendance_access_denied", 403), () => error("attendance_operation_conflict", 409), () => error("unauthorized", 401), () => error("unknown_error", 409), () => json({ ok: false, error: "attendance_outage_changed", committed: false }, 409)]) {
    const h = await ready(response); await h.client.submit(ow, draft(oc)); await h.client.endRejectedAttempt(); assertUnknown(h);
  }
});
test("GET 404 or authorization failure after a reload never authorizes ending an unknown intent", async () => {
  for (const response of [() => error("attendance_outage_not_found", 404), () => error("attendance_access_denied", 403)]) {
    const h = setup("outages", response); const raw = pending("outages", ow, oc); h.storage.setItem(h.client.storageKey, raw);
    await h.client.initialize(); await h.client.recover(); await h.client.endRejectedAttempt(); assertUnknown(h, raw); assert.equal(h.calls[0].init?.method, "GET");
  }
});
test("reloading a formerly rejected intent forgets the in-memory right to end it", async () => {
  const h = await ready(() => error("attendance_outage_changed", 409)); await h.client.submit(ow, draft(oc)); assert.equal(h.client.getSnapshot().canEndRejectedAttempt, true);
  const copy = setup("outages", () => { throw Error("no auto fetch"); }, { storage: () => h.storage }); await copy.client.initialize(); await copy.client.endRejectedAttempt();
  assert.equal(copy.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(h.storage.removes, 0); assert(h.storage.getItem(h.client.storageKey));
});
test("storage write failure or non-durable readback prevents every POST", async () => {
  for (const storage of [{ getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => { throw Error("no removal"); } },
    { getItem: () => null, setItem: () => {}, removeItem: () => { throw Error("no removal"); } }]) {
    const h = await ready(() => { throw Error("must not POST"); }, { storage: () => storage }); await h.client.submit(ow, draft(oc)); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().phase, "blocked");
  }
});
test("storage replacement during POST wins exact CAS and cannot be erased by success", async () => {
  const gate = deferred<Response>(), entered = deferred<void>(), h = await ready(() => { entered.resolve(); return gate.promise; });
  const task = h.client.submit(ow, draft(oc)); await entered.promise; const replacement = pending("outages", ow, { ...oc, operationId: id(90) }); h.storage.setItem(h.client.storageKey, replacement);
  gate.resolve(json(body("outages", ow, outageSaved(), oc))); await task;
  assert.equal(h.storage.getItem(h.client.storageKey), replacement); assert.equal(h.storage.removes, 0); assert.equal(h.client.getSnapshot().result, null);
});
test("storage replacement before explicit end protects the newer pending bytes", async () => {
  const h = await ready(() => error("attendance_outage_changed", 409)); await h.client.submit(ow, draft(oc));
  const replacement = pending("outages", ow, { ...oc, operationId: id(90) }); h.storage.setItem(h.client.storageKey, replacement);
  await h.client.endRejectedAttempt(); assert.equal(h.storage.getItem(h.client.storageKey), replacement); assert.equal(h.storage.removes, 0);
});
test("pause aborts in-flight writes, clears shown data and ignores late successful responses", async () => {
  const gate = deferred<Response>(), entered = deferred<void>(), h = await ready(() => { entered.resolve(); return gate.promise; });
  const task = h.client.submit(ow, draft(oc)); await entered.promise; h.client.pause(); gate.resolve(json(body("outages", ow, outageSaved(), oc))); await task;
  assertUnknown(h); assert.equal(h.calls[1].init?.signal?.aborted, true); assert.equal(h.client.hasLeaveRisk(), true);
});
test("late definitive rejection after pause cannot make the retained intent endable", async () => {
  const gate = deferred<Response>(), entered = deferred<void>(), h = await ready(() => { entered.resolve(); return gate.promise; });
  const task = h.client.submit(ow, draft(oc)); await entered.promise; h.client.pause(); gate.resolve(error("attendance_outage_changed", 409)); await task;
  await h.client.endRejectedAttempt(); assertUnknown(h);
});
test("listener reentry cannot duplicate POST and pause before persistence prevents sending", async () => {
  const h = await ready(() => json(body("outages", ow, outageSaved(), oc)));
  const off = h.client.subscribe(() => { if (h.client.getSnapshot().phase === "saving") { void h.client.submit(ow, draft(oc)); void h.client.load(oq); } });
  await h.client.submit(ow, draft(oc)); off(); assert.equal(h.calls.filter(c => c.init?.method === "POST").length, 1);
  const stopped = await ready(() => { throw Error("no POST"); }); stopped.client.subscribe(() => { if (stopped.client.getSnapshot().phase === "saving") stopped.client.pause(); });
  await stopped.client.submit(ow, draft(oc)); assert.equal(stopped.storage.writes, 0); assert.equal(stopped.calls.length, 1);
});
test("hidden before reading or during a pending write synchronously hides data and keeps bytes", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); let isHidden = false;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); });
  const h = await ready(() => { isHidden = true; return json(body("outages", ow, outageSaved(), oc)); });
  await h.client.submit(ow, draft(oc)); assertUnknown(h); const count = h.calls.length;
  await h.client.recover(); assert.equal(h.calls.length, count); assert.equal(h.client.getSnapshot().result, null);
});
test("foreign identity, kind and malformed pending records stay hidden and untouched", async () => {
  for (const raw of [pending("outages", ow, oc, employee), pending("links", lq, lc()), pending("outages", ow, oc).replace('"version":1', '"version":1,"version":1'), "x".repeat(34000)]) {
    const h = setup("outages", () => { throw Error("must not fetch"); }); h.storage.setItem(h.client.storageKey, raw); await h.client.initialize(); await h.client.recover();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.storage.getItem(h.client.storageKey), raw); assert.equal(h.calls.length, 0);
  }
});
test("separate authenticated client never discovers or clears another identity's pending key", async () => {
  const h = await ready(() => { throw Error("lost"); }); await h.client.submit(ow, draft(oc)); const raw = h.storage.getItem(h.client.storageKey);
  const other = setup("outages", () => { throw Error("no request"); }, { actorId: employee, storage: () => h.storage }); await other.client.initialize(); await other.client.recover();
  assert.equal(other.client.getSnapshot().pending, null); assert.equal(other.calls.length, 0); assert.equal(h.storage.getItem(h.client.storageKey), raw);
});
test("wrong scope, user operationId and loading recovery directly never create requests", async () => {
  for (const [q, input] of [[{ ...ow, siteId: "99990002" }, draft(oc)], [ow, oc]] as const) {
    const h = await ready(() => { throw Error("no POST"); }); await h.client.submit(q, input); assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0);
  }
  const h = await ready(() => { throw Error("no recovery without intent"); }); await h.client.load({ siteId, access: "owner", mode: "recover", operationId }); assert.equal(h.calls.length, 1);
});
test("one total deadline bounds hung fetch and retains its durable pending operation", async () => {
  const h = await ready(() => new Promise<Response>(() => {}), { timeoutMs: 50 }); const start = performance.now();
  await h.client.submit(ow, draft(oc)); assertUnknown(h); assert(performance.now() - start < 1500); assert.equal(h.calls[1].init?.signal?.aborted, true);
});
test("one total deadline bounds a hung response body and cancels its reader", async () => {
  let cancelled = false;
  const h = await ready(() => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }), { timeoutMs: 50 });
  const start = performance.now(); await h.client.submit(ow, draft(oc)); assertUnknown(h); assert(cancelled); assert(performance.now() - start < 1500);
});
test("one total deadline includes hung WebCrypto after a structurally valid receipt", async t => {
  const h = await ready(() => json(body("outages", ow, outageSaved(), oc)), { timeoutMs: 50 });
  let digests = 0; t.mock.method(globalThis.crypto.subtle, "digest", () => { digests++; return new Promise<ArrayBuffer>(() => {}); });
  const start = performance.now(); await h.client.submit(ow, draft(oc)); assert.equal(digests, 1); assertUnknown(h); assert(performance.now() - start < 1500);
});
test("pause during receipt crypto cannot settle pending even after the digest completes", async t => {
  const gate = deferred<ArrayBuffer>(), entered = deferred<void>();
  t.mock.method(globalThis.crypto.subtle, "digest", () => { entered.resolve(); return gate.promise; });
  const h = await ready(() => json(body("outages", ow, outageSaved(), oc)));
  const task = h.client.submit(ow, draft(oc)); await entered.promise; const raw = h.storage.getItem(h.client.storageKey)!; h.client.pause();
  const bytes = new Uint8Array(Buffer.from(hash(outageCommandFingerprintText(ow, oc)), "hex")); gate.resolve(bytes.buffer); await task; assertUnknown(h, raw);
});
test("storage replacement during receipt crypto cannot delete the newer operation", async t => {
  const gate = deferred<ArrayBuffer>(), entered = deferred<void>();
  t.mock.method(globalThis.crypto.subtle, "digest", () => { entered.resolve(); return gate.promise; });
  const h = await ready(() => json(body("outages", ow, outageSaved(), oc)));
  const task = h.client.submit(ow, draft(oc)); await entered.promise;
  const replacement = pending("outages", ow, { ...oc, operationId: id(91) }); h.storage.setItem(h.client.storageKey, replacement);
  gate.resolve(new Uint8Array(Buffer.from(hash(outageCommandFingerprintText(ow, oc)), "hex")).buffer); await task;
  assert.equal(h.storage.getItem(h.client.storageKey), replacement); assert.equal(h.storage.removes, 0); assert.equal(h.client.getSnapshot().result, null);
});
test("fetch, body and crypto share the initial deadline instead of refreshing a stage budget", async t => {
  let clock = 100, digests = 0, pulled = false;
  const h = await ready(() => {
    clock = 400;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      pulled = true; clock = 700; controller.enqueue(new TextEncoder().encode(JSON.stringify(body("outages", ow, outageSaved(), oc)))); controller.close();
    } }), { headers: { "content-type": "application/json" } });
  }, { timeoutMs: 1000 });
  t.mock.method(performance, "now", () => clock);
  t.mock.method(globalThis.crypto.subtle, "digest", async () => {
    digests++; clock = 1101; return new Uint8Array(Buffer.from(hash(outageCommandFingerprintText(ow, oc)), "hex")).buffer;
  });
  await h.client.submit(ow, draft(oc)); assert(pulled); assert.equal(digests, 1); assertUnknown(h);
});
