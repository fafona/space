import assert from "node:assert/strict";
import test from "node:test";
import { correctionReviewComparison, correctionReviewQueryString, parseCorrectionReviewQuery, parseCorrectionReviewResult, inspectCorrectionReview, type CorrectionReviewQuery } from "./merchantAttendanceCorrectionReview";
import { correctionReviewDetail, reviewQuery } from "../../scripts/fixtures/attendance-correction-review-model";
import { correctionId as id, correctionNow, correctionSite as siteId } from "../../scripts/fixtures/attendance-correction-model";
import { executeCorrectionReview } from "./merchantAttendanceCorrectionReview.server";
const list: Extract<CorrectionReviewQuery, { mode: "list" }> = { siteId, mode: "list", fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-02T00:00:00.000000Z",
  workerId: null, status: "all", asOf: null, cursorAt: null, cursorId: null };
const parseQ = (q: CorrectionReviewQuery) => parseCorrectionReviewQuery(`https://local.invalid/?${correctionReviewQueryString(q)}`);
const listing = () => ({ siteId, mode: "list", asOf: correctionNow, approvalAvailable: false, items: [correctionReviewDetail().item], scanned: 1, nextCursor: null });

test("owner queries are bounded, exact, paired and keep sub-millisecond cursors", () => {
  assert.deepEqual(parseQ(list), list); assert.deepEqual(parseQ(reviewQuery), reviewQuery);
  const q = { ...list, asOf: correctionNow, cursorAt: "2026-09-28T12:00:00.123456Z", cursorId: id(9) }; assert.deepEqual(parseQ(q), q);
  for (const suffix of ["&action=approve", "&authUserId=x", "&employeeId=x", "&siteId=99990002", "&mode=detail"]) assert.throws(() => parseCorrectionReviewQuery(`https://local.invalid/?${correctionReviewQueryString(list)}${suffix}`));
  for (const bad of [{ ...list, fromAt: list.toAt }, { ...list, toAt: "2026-10-02T00:00:00.000001Z" }, { ...list, cursorAt: correctionNow },
    { ...list, cursorAt: correctionNow, cursorId: id(1) }, { ...list, asOf: correctionNow, cursorAt: list.toAt, cursorId: id(1) },
    { ...list, status: "approved" }, { ...list, fromAt: "1999-01-01T00:00:00.000000Z", toAt: "1999-01-02T00:00:00.000000Z" }]) assert.throws(() => parseQ(bad as CorrectionReviewQuery));
});
test("detail response projects immutable application and current evidence without actor IDs or unrequested notes", () => {
  const raw = correctionReviewDetail();
  const parsed = parseCorrectionReviewResult({ ...raw, privateToken: "secret", evidence: { ...raw.evidence, latitude: 1, authUserId: id(998) } }, reviewQuery);
  assert.deepEqual(parsed, raw); assert.doesNotMatch(JSON.stringify(parsed), /secret|latitude|authUserId/);
  if (parsed.mode === "detail") { const report = inspectCorrectionReview(parsed); assert.deepEqual(report.issues, []); assert.equal(report.approvalAvailable, false); assert.equal(report.remainingChecks.length, 2); }
});
test("mismatched tenant/request/employee, approval availability and mutation receipt are rejected", () => {
  const raw = correctionReviewDetail();
  for (const bad of [{ ...raw, siteId: "99990002" }, { ...raw, approvalAvailable: true }, { ...raw, item: { ...raw.item, requestId: id(999) } },
    { ...raw, application: { ...raw.application, employeeId: id(99) } }, { ...raw, application: { ...raw.application, canRequest: true } },
    { ...raw, application: { ...raw.application, receipt: { operationId: id(1) } } }, { ...raw, item: { ...raw.item, revision: 99 } }])
    assert.throws(() => parseCorrectionReviewResult(bad, reviewQuery));
});
test("withdrawn, rebound and owner-self applications have explicit blockers", () => {
  const raw = correctionReviewDetail(); raw.item.status = "withdrawn"; raw.application.item.status = "withdrawn";
  raw.application.withdrawal = { reason: "已撤回", recordedAt: correctionNow }; raw.evidence.bindingCurrent = false; raw.evidence.ownApplication = true;
  const parsed = parseCorrectionReviewResult(raw, reviewQuery); assert.equal(parsed.mode, "detail");
  if (parsed.mode === "detail") assert.deepEqual(inspectCorrectionReview(parsed).issues, ["withdrawn", "binding_changed", "self_review"]);
});
test("missing raw evidence and over-limit evidence never produce a clear preflight", () => {
  const raw = correctionReviewDetail(); raw.evidence.currentBasis = null; raw.evidence.basisIssue = "attendance_session_too_large";
  const parsed = parseCorrectionReviewResult(raw, reviewQuery); if (parsed.mode === "detail") assert.ok(inspectCorrectionReview(parsed).issues.includes("basis_unavailable"));
  assert.throws(() => parseCorrectionReviewResult({ ...raw, evidence: { ...raw.evidence, basisIssue: null } }, reviewQuery));
  assert.throws(() => parseCorrectionReviewResult({ ...raw, evidence: { ...raw.evidence, basisIssue: "private_sql_failure" } }, reviewQuery));
});
test("raw open segment remains blocked, and newly appended clock-out differs from submitted snapshot", () => {
  const raw = correctionReviewDetail(); raw.application.basis.events.pop(); raw.evidence.currentBasis!.events.pop();
  assert.ok(inspectCorrectionReview(raw).issues.includes("open_session"));
  raw.evidence.currentBasis = correctionReviewDetail().evidence.currentBasis;
  const parsed = parseCorrectionReviewResult(raw, reviewQuery); if (parsed.mode === "detail") assert.deepEqual(inspectCorrectionReview(parsed).issues, ["basis_changed"]);
});
test("neighboring shifts in different time zones compare UTC instants, endpoints may touch", () => {
  const raw = correctionReviewDetail();
  for (const basis of [raw.application.basis, raw.evidence.currentBasis!]) basis.events.forEach(e => { e.sequence += 2; });
  raw.evidence.previous = { ...raw.application.basis.events.at(-1)!, id: id(90), sequence: 2, timeZone: "UTC", occurredAt: raw.application.proposal.startAt };
  raw.evidence.next = { ...raw.application.basis.events[0], id: id(91), sequence: 5, timeZone: "Asia/Shanghai", occurredAt: raw.application.proposal.endAt };
  const parsed = parseCorrectionReviewResult(raw, reviewQuery);
  if (parsed.mode === "detail") assert.deepEqual(inspectCorrectionReview(parsed).issues, []);
  raw.application.proposal.startAt = "2026-09-28T07:59:59.999999Z"; raw.item.startAt = raw.application.item.startAt = raw.application.proposal.startAt;
  raw.application.proposal.endAt = "2026-09-28T17:00:00.000001Z"; raw.item.endAt = raw.application.item.endAt = raw.application.proposal.endAt;
  assert.deepEqual(inspectCorrectionReview(raw).issues, ["overlap_previous", "overlap_next"]);
});
test("missing/gapped/backward/inconsistent neighbors and wrong current worker fail closed", () => {
  const raw = correctionReviewDetail(), current = raw.evidence.currentBasis!;
  for (const evidence of [{ ...raw.evidence, currentBasis: { ...current, workerId: id(999) } },
    { ...raw.evidence, next: { ...current.events[0], sequence: 4, id: id(98), occurredAt: "2026-09-28T18:00:00.000000Z" } },
    { ...raw.evidence, next: { ...current.events[0], sequence: 3, id: id(98), occurredAt: "2026-09-28T15:00:00.000000Z" } },
    { ...raw.evidence, previous: current.events[1] }, { ...raw.evidence, currentBasis: { ...current, employeeId: id(98) } }])
    assert.throws(() => parseCorrectionReviewResult({ ...raw, evidence }, reviewQuery));
});
test("employment coverage detects gaps and overlapping ranges instead of trusting active flag", () => {
  const raw = correctionReviewDetail(); raw.evidence.employmentPeriods = [];
  assert.deepEqual(inspectCorrectionReview(raw).issues, ["employment_gap"]);
  raw.evidence.employmentPeriods = [{ startsOn: "2026-01-01", endsOn: null }, { startsOn: "2026-09-01", endsOn: null }];
  assert.deepEqual(inspectCorrectionReview(raw).issues, ["employment_ambiguous"]);
  raw.evidence.employmentPeriods = [{ startsOn: "2026-09-29", endsOn: null }]; assert.deepEqual(inspectCorrectionReview(raw).issues, ["employment_gap"]);
});
test("exact local midnight end is half-open; one extra microsecond requires the next employment day", () => {
  const raw = correctionReviewDetail(); raw.application.proposal.endAt = "2026-09-28T22:00:00.000000Z";
  raw.item.endAt = raw.application.item.endAt = raw.application.proposal.endAt;
  raw.evidence.employmentPeriods = [{ startsOn: "2026-09-28", endsOn: "2026-09-28" }];
  assert.deepEqual(inspectCorrectionReview(raw).issues, []);
  raw.application.proposal.endAt = "2026-09-28T22:00:00.000001Z"; assert.deepEqual(inspectCorrectionReview(raw).issues, ["employment_gap"]);
});
test("unsupported early declarations are blocked explicitly, and large evidence is bounded", () => {
  const raw = correctionReviewDetail(); raw.application.proposal = { startAt: "0001-01-01T00:00:00.000000Z", endAt: "0001-01-01T01:00:00.000000Z", breaks: [] };
  assert.ok(inspectCorrectionReview(raw).issues.includes("declaration_range"));
  const valid = correctionReviewDetail();
  const periods = Array.from({ length: 100 }, (_, i) => ({ startsOn: `${2000 + i}-01-01`, endsOn: null }));
  valid.evidence.employmentPeriods = periods; valid.evidence.employmentTruncated = true;
  const parsed = parseCorrectionReviewResult(valid, reviewQuery); if (parsed.mode === "detail") assert.ok(inspectCorrectionReview(parsed).issues.includes("employment_limit"));
  assert.throws(() => parseCorrectionReviewResult({ ...valid, evidence: { ...valid.evidence, employmentPeriods: [...periods, { startsOn: "2100-01-01", endsOn: null }] } }, reviewQuery));
  assert.throws(() => parseCorrectionReviewResult({ ...valid, evidence: { ...valid.evidence, employmentPeriods: periods.slice(0, 99) } }, reviewQuery));
});
test("bad employment dates, ordering and reverse intervals are rejected", () => {
  const raw = correctionReviewDetail();
  for (const periods of [[{ startsOn: "2026-02-30", endsOn: null }], [{ startsOn: "2026-01-01", endsOn: "2025-12-31" }],
    [{ startsOn: "2026-02-01", endsOn: null }, { startsOn: "2026-01-01", endsOn: null }], [{ startsOn: "2026-01-01", endsOn: null }, { startsOn: "2026-01-01", endsOn: null }]])
    assert.throws(() => parseCorrectionReviewResult({ ...raw, evidence: { ...raw.evidence, employmentPeriods: periods } }, reviewQuery));
});
test("employment coverage skips a nonexistent local date instead of inventing an absence", () => {
  const raw = correctionReviewDetail();
  for (const basis of [raw.application.basis, raw.evidence.currentBasis!]) for (const e of basis.events) e.timeZone = "Pacific/Apia";
  raw.application.proposal = { startAt: "2011-12-29T10:00:00.000000Z", endAt: "2011-12-31T10:00:00.000000Z", breaks: [] };
  raw.evidence.employmentPeriods = [{ startsOn: "2011-12-29", endsOn: "2011-12-29" }, { startsOn: "2011-12-31", endsOn: "2011-12-31" }];
  const before = structuredClone(raw);
  assert.deepEqual(correctionReviewComparison(raw)?.proposed.days.map(d => d.date), ["2011-12-29", "2011-12-31"]);
  assert.deepEqual(inspectCorrectionReview(raw).issues, []); assert.deepEqual(raw, before);
});
test("out-of-range or uncomputable local declaration stays inspectable without a UI calculation exception", () => {
  const raw = correctionReviewDetail(); raw.application.proposal = { startAt: "1999-01-01T00:00:00.000000Z", endAt: "1999-01-01T01:00:00.000000Z", breaks: [] };
  assert.equal(correctionReviewComparison(raw), null); assert.ok(inspectCorrectionReview(raw).issues.includes("declaration_range"));
  for (const basis of [raw.application.basis, raw.evidence.currentBasis!]) for (const e of basis.events) e.timeZone = "America/New_York";
  raw.application.proposal = { startAt: "2000-01-01T00:00:00.000000Z", endAt: "2000-01-01T01:00:00.000000Z", breaks: [] };
  assert.equal(correctionReviewComparison(raw), null); assert.ok(inspectCorrectionReview(raw).issues.includes("declaration_unreviewable"));
});
test("list rejects wrong counts, filters, duplicates, ordering, status and cursor ranges", () => {
  const raw = listing(); assert.equal(parseCorrectionReviewResult(raw, list).mode, "list");
  for (const bad of [{ ...raw, scanned: 0 }, { ...raw, scanned: 51 }, { ...raw, items: [...raw.items, ...raw.items], scanned: 2 },
    { ...raw, items: [{ ...raw.items[0], status: "approved" }] }, { ...raw, nextCursor: { recordedAt: correctionNow, requestId: id(100) } },
    { ...raw, scanned: 50, items: [], nextCursor: { recordedAt: list.toAt, requestId: id(100) } }]) assert.throws(() => parseCorrectionReviewResult(bad, list));
  assert.throws(() => parseCorrectionReviewResult(raw, { ...list, status: "withdrawn" }));
  assert.throws(() => parseCorrectionReviewResult(raw, { ...list, workerId: id(9) }));
  assert.throws(() => parseCorrectionReviewResult(raw, { ...list, asOf: "2026-09-29T00:00:00.000000Z" }));
});
test("empty filtered pages can advance only with full bounded scan and exact cutoff/cursor", () => {
  const raw = { ...listing(), items: [], scanned: 50, nextCursor: { recordedAt: "2026-09-28T12:00:00.123456Z", requestId: id(50) } };
  assert.deepEqual(parseCorrectionReviewResult(raw, list), raw);
  assert.throws(() => parseCorrectionReviewResult(raw, { ...list, asOf: correctionNow, cursorAt: raw.nextCursor.recordedAt, cursorId: id(50) }));
});
test("server forwards only owner query and authenticated identity, masks backend internals", async () => {
  const calls: unknown[] = [], raw = correctionReviewDetail();
  const value = await executeCorrectionReview({ query: reviewQuery, authUserId: id(1) }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error: null }; } });
  assert.deepEqual(value, raw); assert.deepEqual(calls, [{ name: "faolla_attendance_correction_owner_review_v3", args: { p_site_id: siteId, p_auth_user_id: id(1), p_query: { mode: "detail", requestId: reviewQuery.requestId } } }]);
  await assert.rejects(executeCorrectionReview({ query: reviewQuery, authUserId: id(1) }, null), /attendance_unavailable/);
  await assert.rejects(executeCorrectionReview({ query: reviewQuery, authUserId: id(1) }, { rpc: async () => ({ data: null, error: { message: "private_relation" } }) }), /attendance_unavailable/);
  await assert.rejects(executeCorrectionReview({ query: reviewQuery, authUserId: id(1) }, { rpc: async () => ({ data: null, error: { message: "attendance_access_denied" } }) }), /attendance_access_denied/);
  await assert.rejects(executeCorrectionReview({ query: reviewQuery, authUserId: id(1) }, { rpc: async () => ({ data: { ...raw, approvalAvailable: true }, error: null }) }), /attendance_unavailable/);
});
