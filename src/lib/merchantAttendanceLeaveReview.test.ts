import assert from "node:assert/strict";
import test from "node:test";
import { LEAVE_REVIEW_ERRORS, leaveReviewQueryString, parseLeaveReviewHttpQuery, parseLeaveReviewQuery,
  parseLeaveReviewResponse, parseLeaveReviewResult, type LeaveReviewItem, type LeaveReviewQuery,
  type LeaveReviewResult } from "./merchantAttendanceLeaveReview";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), submittedAt = "2026-10-04T09:00:00.123456Z";
const query = (): LeaveReviewQuery => ({ siteId, afterAt: null, afterId: null });
const item = (n = 501): LeaveReviewItem => ({ requestId: id(n), workerName: "Synthetic leave applicant",
  startAt: "2027-10-05T07:00:00.000Z", endAt: "2027-10-05T15:00:00.000Z", timeZone: "Europe/Madrid",
  submittedAt, revision: 1, status: "submitted" });
const result = (): LeaveReviewResult => ({ protocol: "leave-review-v1", siteId, ownerId, items: [], scanned: 0, nextCursor: null });
const without = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

test("review query exact3 is duplicate-free, has paired canonical microsecond cursor and excludes client authority", () => {
  assert.deepEqual(parseLeaveReviewQuery(query()), query());
  assert.deepEqual(parseLeaveReviewHttpQuery(`https://fixture.invalid/?${leaveReviewQueryString(query())}`), query());
  const paged = { ...query(), afterAt: submittedAt, afterId: id(501) };
  assert.deepEqual(parseLeaveReviewQuery(paged), paged);
  assert.deepEqual(parseLeaveReviewHttpQuery(`https://fixture.invalid/?${leaveReviewQueryString(paged)}`), paged);
  for (const key of Object.keys(query())) assert.throws(() => parseLeaveReviewQuery(without(query(), key)), key);
  for (const patch of [{ siteId: "all" }, { ownerId }, { authUserId: ownerId }, { access: "owner" }, { limit: 50 },
    { status: "submitted" }, { afterAt: submittedAt }, { afterId: id(501) }, { ...paged, afterId: "bad" },
    { ...paged, afterAt: "2026-10-04T09:00:00.123Z" }, { ...paged, afterAt: "2026-02-30T09:00:00.123456Z" }])
    assert.throws(() => parseLeaveReviewQuery({ ...query(), ...patch }), JSON.stringify(patch));
  for (const suffix of [`&siteId=${siteId}`, `&ownerId=${ownerId}`, "&status=submitted", "&limit=50", "&afterAt="])
    assert.throws(() => parseLeaveReviewHttpQuery(`https://fixture.invalid/?${leaveReviewQueryString(query())}${suffix}`));
});

test("review accepts future leave intervals but only exact submitted revision1 summaries without private detail fields", () => {
  const value = { ...result(), scanned: 1, items: [item()] };
  assert.deepEqual(parseLeaveReviewResult(value, query(), ownerId), value);
  assert.ok(value.items[0].endAt > value.items[0].submittedAt, "leave is not restricted to past missing-work declarations");
  for (const key of Object.keys(item()))
    assert.throws(() => parseLeaveReviewResult({ ...value, items: [without(item(), key)] }, query()), key);
  for (const patch of [{ reason: "private" }, { workerId: id(201) }, { employeeId: id(101) }, { canApprove: true },
    { history: [] }, { status: "approved", revision: 2 }, { status: "withdrawn", revision: 2 }, { revision: 2 },
    { status: "cancelled", revision: 3 }, { workerName: " padded " }, { workerName: "x".repeat(121) },
    { submittedAt: "2026-10-04T09:00:00.123Z" }, { endAt: item().startAt }, { timeZone: "Bad/Zone" }])
    assert.throws(() => parseLeaveReviewResult({ ...value, items: [{ ...item(), ...patch }] }, query()), JSON.stringify(patch));
});

test("exact result and HTTP envelopes bind real owner and tenant and reject invented write capabilities", () => {
  assert.deepEqual(parseLeaveReviewResult(result(), query(), ownerId), result());
  for (const key of Object.keys(result())) assert.throws(() => parseLeaveReviewResult(without(result(), key), query()), key);
  for (const patch of [{ protocol: "leave-v1" }, { siteId: "99990002" }, { ownerId: id(98) }, { actorId: ownerId },
    { readOnly: true }, { total: 0 }, { canApprove: true }, { privateReason: "x" }])
    assert.throws(() => parseLeaveReviewResult({ ...result(), ...patch }, query(), ownerId));
  assert.equal(parseLeaveReviewResponse({ ok: true, moduleEnabled: false, ...result() }, query(), ownerId).moduleEnabled, false);
  assert.equal(Object.hasOwn(parseLeaveReviewResponse({ ok: true, moduleEnabled: true, ...result() }, query()), "ok"), false);
  for (const patch of [{ ok: false }, { ok: "true" }, { moduleEnabled: "false" }, { moduleEnabled: null }, { extra: true }])
    assert.throws(() => parseLeaveReviewResponse({ ok: true, moduleEnabled: true, ...result(), ...patch }, query()));
  assert.throws(() => parseLeaveReviewResponse({ ok: true, ...result() }, query()));
  assert.throws(() => parseLeaveReviewResponse({ ok: true, moduleEnabled: true, ...result(), ownerId: id(98) }, query(), ownerId));
});

test("scanned counts candidates, not pending matches; empty50 pages remain valid with a candidate cursor", () => {
  for (const scanned of [-1, 51, 0.5, "50", null, Number.NaN])
    assert.throws(() => parseLeaveReviewResult({ ...result(), scanned }, query()));
  assert.throws(() => parseLeaveReviewResult({ ...result(), items: [item()] }, query()));
  const empty = { ...result(), scanned: 50, nextCursor: { at: submittedAt, id: id(550) } };
  assert.deepEqual(parseLeaveReviewResult(empty, query()), empty);
  const filtered = { ...empty, items: [item(501), item(530)] };
  assert.deepEqual(parseLeaveReviewResult(filtered, query()), filtered);
  assert.equal(parseLeaveReviewResult({ ...empty, nextCursor: null }, query()).scanned, 50, "exactly50 may be final page");
  for (const scanned of [0, 1, 49]) assert.throws(() => parseLeaveReviewResult({ ...empty, scanned }, query()));
  assert.throws(() => parseLeaveReviewResult({ ...filtered, scanned: 1, nextCursor: null }, query()));
});

test("items strictly ascend by exact microsecond and UUID, exclude duplicates and must follow the request cursor", () => {
  const items = Array.from({ length: 50 }, (_, i) => item(501 + i));
  const value = { ...result(), items, scanned: 50, nextCursor: { at: submittedAt, id: id(550) } };
  assert.deepEqual(parseLeaveReviewResult(value, query()), value);
  for (const patch of [{ items: [...items].reverse() }, { items: [item(), item()] }, { items: [...items, item(551)] }])
    assert.throws(() => parseLeaveReviewResult({ ...value, ...patch }, query()));
  const microseconds = [item(502), { ...item(501), submittedAt: "2026-10-04T09:00:00.123457Z" }];
  assert.equal(parseLeaveReviewResult({ ...result(), scanned: 2, items: microseconds }, query()).items[1].requestId, id(501));
  assert.throws(() => parseLeaveReviewResult({ ...result(), scanned: 2, items: [item(), { ...item(), submittedAt: "2026-10-04T09:00:00.123457Z" }] }, query()));
  const paged = { ...query(), afterAt: submittedAt, afterId: id(501) };
  for (const row of [item(500), item(501), { ...item(502), submittedAt: "2026-10-04T09:00:00.123455Z" }])
    assert.throws(() => parseLeaveReviewResult({ ...result(), scanned: 1, items: [row] }, paged));
  assert.equal(parseLeaveReviewResult({ ...result(), scanned: 1, items: [item(502)] }, paged).items[0].requestId, id(502));
});

test("next cursor is exact, strictly advances, bounds every returned row and equals final row when all50 candidates match", () => {
  const paged = { ...query(), afterAt: submittedAt, afterId: id(500) };
  const filtered = { ...result(), scanned: 50, items: [item(530)], nextCursor: { at: submittedAt, id: id(550) } };
  assert.deepEqual(parseLeaveReviewResult(filtered, paged), filtered);
  for (const nextCursor of [{ at: submittedAt, id: id(529) }, { at: submittedAt, id: id(500) },
    { at: "2026-10-04T09:00:00.123455Z", id: id(999) }, { at: submittedAt, id: id(550), extra: true },
    { at: submittedAt }, { at: "2026-10-04T09:00:00.123Z", id: id(550) }])
    assert.throws(() => parseLeaveReviewResult({ ...filtered, nextCursor }, paged));
  const full = { ...filtered, items: Array.from({ length: 50 }, (_, i) => item(501 + i)) };
  assert.deepEqual(parseLeaveReviewResult(full, paged), full);
  assert.throws(() => parseLeaveReviewResult({ ...full, nextCursor: { at: submittedAt, id: id(551) } }, paged));
  assert.throws(() => parseLeaveReviewResult({ ...full, nextCursor: { at: "2026-10-04T09:00:00.123457Z", id: id(550) } }, paged));
});

test("review error allowlist is exact and preserves source-integrity errors without adding any write errors", () => {
  assert.deepEqual(LEAVE_REVIEW_ERRORS, { attendance_leave_review_invalid: 503, attendance_leave_invalid: 503,
    attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
    attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404 });
});
