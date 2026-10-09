import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceLocationReviewCommand, parseAttendanceLocationReviewQuery, parseAttendanceLocationReviewResult, type AttendanceLocationReviewQuery } from "./merchantAttendanceLocationReview";
import { executeAttendanceLocationReview } from "./merchantAttendanceLocationReview.server";
import { createAttendanceReviewFixture, reviewFixtureAsOf as asOf, reviewFixtureAt as at, reviewFixtureEvent as eventId, reviewFixtureSite as siteId, reviewFixtureOwner as ownerId, reviewFixtureId as id } from "../../scripts/fixtures/attendance-location-review-model";
const detailQuery = { siteId, mode: "detail" as const, eventId, operationId: null };
const listQuery: Extract<AttendanceLocationReviewQuery, { mode: "list" }> = { siteId, mode: "list", fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-01T00:00:00.000000Z", workerId: null, locationId: null, status: "all", asOf: null, cursorAt: null, cursorId: null };
const body = { siteId, eventId, operationId: id(20), expectedRevision: 0, outcome: "noted", note: "Synthetic review reason" };
test("review query enforces mode-specific keys, owner scope, 31 day bound and complete microsecond cursor", () => {
  const base = `https://local.invalid/?siteId=${siteId}&mode=list&status=pending&fromAt=2026-09-01T00:00:00.000001Z&toAt=2026-10-01T00:00:00.000001Z`;
  assert.equal(parseAttendanceLocationReviewQuery(base).mode, "list");
  for (const extra of ["&access=manager", "&limit=500", "&ownerId=x", "&status=all", `&cursorId=${id(6)}`, "&operationId=x"]) assert.throws(() => parseAttendanceLocationReviewQuery(base + extra));
  assert.throws(() => parseAttendanceLocationReviewQuery(base.replace("2026-10-01", "2026-11-01")));
  assert.deepEqual(parseAttendanceLocationReviewQuery(`https://local.invalid/?siteId=${siteId}&mode=detail&eventId=${eventId}`), detailQuery);
  assert.throws(() => parseAttendanceLocationReviewQuery(`https://local.invalid/?siteId=${siteId}&mode=detail&eventId=${eventId}&latitude=1`));
});
test("write requires explicit target, original ID, safe revision, known outcome and bounded reason", () => {
  assert.equal(parseAttendanceLocationReviewCommand(body).command.note, body.note);
  for (const patch of [{ actor: ownerId }, { note: " " }, { note: "x".repeat(501) }, { note: "line\nbreak" }, { outcome: "payroll_approved" }, { expectedRevision: "0" }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { expectedRevision: -1 }]) assert.throws(() => parseAttendanceLocationReviewCommand({ ...body, ...patch }));
  assert.equal(parseAttendanceLocationReviewCommand({ ...body, note: "  reason  " }).command.note, "reason");
});
test("list accepts scanned-but-unmatched batch with cursor older than every returned match", () => {
  const f = createAttendanceReviewFixture(), row = f.detail().item;
  const raw = { siteId, mode: "list", asOf, scanned: 50, items: [], nextCursor: { occurredAt: at, id: eventId } };
  assert.deepEqual(parseAttendanceLocationReviewResult(raw, listQuery), raw);
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, scanned: 49 }, listQuery));
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, items: [row], nextCursor: { occurredAt: "2026-09-30T10:30:00.000001Z", id: id(4) } }, listQuery));
  assert.throws(() => parseAttendanceLocationReviewResult(raw, { ...listQuery, cursorAt: at, cursorId: eventId, asOf }));
});
test("list rejects cross-tenant, filters mismatch, duplicate events, unsorted microsecond ties and malformed states", () => {
  const row = createAttendanceReviewFixture().detail().item, raw = { siteId, mode: "list", asOf, scanned: 2, items: [row], nextCursor: null };
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, siteId: "99990002" }, listQuery));
  assert.throws(() => parseAttendanceLocationReviewResult(raw, { ...listQuery, workerId: id(99) }));
  assert.throws(() => parseAttendanceLocationReviewResult(raw, { ...listQuery, status: "reviewed" }));
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, items: [row, { ...row, occurredAt: "2026-09-30T10:00:00.000000Z" }] }, listQuery));
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, items: [row, { ...row, id: id(9) }] }, listQuery));
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, items: [{ ...row, reviewRevision: 1, reviewState: ["pending"] }] }, listQuery));
});
test("detail validates exception identity, evidence fields and drops hidden columns", () => {
  const raw = createAttendanceReviewFixture().detail();
  assert.deepEqual(parseAttendanceLocationReviewResult({ ...raw, actor_auth_user_id: ownerId, summary: { ...raw.summary, latitude: 37.3 } }, detailQuery), raw);
  for (const patch of [{ item: { ...raw.item, reason: "inside" } }, { summary: { ...raw.summary, accuracyMeters: 1 } }, { item: { ...raw.item, id: id(9) } }]) assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, ...patch }, detailQuery));
  const measured = { ...raw, item: { ...raw.item, reason: "outside" }, summary: { ...raw.summary, capturedAt: at, accuracyMeters: 5, distanceMeters: 200 } };
  assert.equal(parseAttendanceLocationReviewResult(measured, detailQuery).mode, "detail");
  assert.throws(() => parseAttendanceLocationReviewResult({ ...measured, summary: { ...measured.summary, capturedAt: "2026-09-30T09:00:00.000001Z" } }, detailQuery));
});
test("history must be contiguous, reflect current state, retain order and signal truncation honestly", () => {
  const f = createAttendanceReviewFixture();
  f.history.push({ revision: 1, outcome: "noted", note: "reason", recordedAt: asOf, actorRef: "a".repeat(32), byCurrentOwner: true });
  const raw = f.detail(); assert.equal(parseAttendanceLocationReviewResult(raw, detailQuery).mode, "detail");
  for (const patch of [{ history: [] }, { historyTruncated: true }, { item: { ...raw.item, reviewState: "pending" } }, { history: [{ ...raw.history[0], actorRef: ownerId }] }, { history: [{ ...raw.history[0], recordedAt: "2026-09-29T00:00:00.000000Z" }] }]) assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, ...patch }, detailQuery));
  assert.throws(() => parseAttendanceLocationReviewResult({ ...raw, receipt: { ...raw.history[0], operationId: id(20), byCurrentOwner: false } }, { ...detailQuery, operationId: id(20) }));
});
test("server adapter checks original intent and uses only owner-scoped review RPC", async () => {
  const f = createAttendanceReviewFixture(); await f.apiFetch("http://synthetic.invalid/", { method: "POST", body: JSON.stringify(body) });
  const raw = f.detail(id(20)), command = parseAttendanceLocationReviewCommand(body).command, calls: unknown[] = [];
  const result = await executeAttendanceLocationReview({ query: detailQuery, command, authUserId: ownerId }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error: null }; } });
  assert.deepEqual(result, raw); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { name: "faolla_attendance_location_reviews_v1", args: { p_site_id: siteId, p_auth_user_id: ownerId, p_query: { mode: "detail", eventId, operationId: null }, p_command: command } });
  await assert.rejects(executeAttendanceLocationReview({ query: listQuery, command, authUserId: ownerId }, { rpc: async () => { throw Error("must not call"); } }), /attendance_invalid_request/);
  await assert.rejects(executeAttendanceLocationReview({ query: detailQuery, command, authUserId: ownerId }, { rpc: async () => ({ data: { ...raw, receipt: null }, error: null }) }), /attendance_unavailable/);
});
test("adapter never exposes unknown SQL errors or a mismatched review response", async () => {
  for (const [message, expected] of [["private SQL text", "attendance_unavailable"], ["attendance_review_not_found", "attendance_review_not_found"]]) await assert.rejects(executeAttendanceLocationReview({ query: detailQuery, command: null, authUserId: ownerId }, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(expected));
  await assert.rejects(executeAttendanceLocationReview({ query: detailQuery, command: null, authUserId: ownerId }, { rpc: async () => ({ data: { ...createAttendanceReviewFixture().detail(), siteId: "99990002" }, error: null }) }), /attendance_unavailable/);
});
