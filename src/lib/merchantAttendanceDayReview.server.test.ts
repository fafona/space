import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeDayReviews, dayReviewsSiteEnabled, DAY_REVIEW_RPC } from "./merchantAttendanceDayReview.server";
import { DAY_REVIEW_PROTOCOL, dayReviewCommandFingerprintText, type DayReviewQuery, type DayReviewDecideCommand } from "./merchantAttendanceDayReviewContract";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
const id = (n: number) => `19900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), siteId = "99990199";
const query = (): DayReviewQuery => ({ siteId, access: "owner", mode: "preview", workerId: id(2), workDate: "2026-10-07", slotId: null, caseId: null });
const command = (): DayReviewDecideCommand => ({ action: "decide", operationId: id(3), caseId: id(4), expectedRevision: 0, workerId: id(2), employeeId: id(5),
  employeeAuthUserId: id(6), expectedFingerprint: "a".repeat(64), outcome: "follow_up", calendarReference: null, selfStatementOperationId: null, reason: "合成继续核查" });
function receipt(q = query(), c = command()) { return { protocol: DAY_REVIEW_PROTOCOL, siteId, actorId: actor, readAt: "2026-10-08T12:00:00.000001Z", kind: "receipt", replayed: true,
  receipt: { operationId: c.operationId, caseId: c.caseId, revision: 1, action: c.action, actorId: actor, recordedAt: "2026-10-08T12:00:00.000001Z",
    commandFingerprint: createHash("sha256").update(dayReviewCommandFingerprintText(q, actor, c)).digest("hex") } }; }

test("C15-A site gate is default off, exact64 sites, no whitespace/duplicates/wildcard or substring", () => {
  const good = { FAOLLA_ATTENDANCE_DAY_REVIEWS_ENABLED: "1", FAOLLA_ATTENDANCE_DAY_REVIEWS_SITE_IDS: siteId };
  assert.equal(dayReviewsSiteEnabled(siteId, good), true);
  for (const env of [{}, { ...good, FAOLLA_ATTENDANCE_DAY_REVIEWS_ENABLED: "true" },
    ...["*", ` ${siteId}`, `${siteId},${siteId}`, `${siteId}\n`, `${siteId},`, Array.from({ length: 65 }, (_, i) => String(99990000 + i)).join(",")]
      .map(value => ({ ...good, FAOLLA_ATTENDANCE_DAY_REVIEWS_SITE_IDS: value }))]) assert.equal(dayReviewsSiteEnabled(siteId, env), false);
  assert.equal(dayReviewsSiteEnabled("9999019", good), false);
});

test("C15-A one SQL call handles command and exact recovery even with new writes disabled, with no Node source/artifact", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [], q = query(), c = command();
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: receipt(q, c), error: null }; } };
  assert.equal((await executeDayReviews({ query: q, command: c, authUserId: actor }, service)).kind, "receipt");
  assert.deepEqual(calls, [{ name: DAY_REVIEW_RPC, args: { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: false } }]);
  assert.doesNotMatch(JSON.stringify(calls), /sourceText|snapshot|artifact|candidate|timeZone/);
  calls.length = 0; const recover: DayReviewQuery = { siteId, mode: "recover", operationId: c.operationId };
  await executeDayReviews({ query: recover, authUserId: actor }, service); assert.equal(calls.length, 1); assert.equal(calls[0].args.p_command, null);
});

test("C15-A known conflicts pass through; internal errors, timeouts and thrown RPC never trigger fallback or retry", async () => {
  for (const message of ["attendance_access_denied", "attendance_day_review_source_changed", "attendance_operation_not_found", "secret SQL internals"])
    { let calls = 0; const service: AttendanceSelfRpc = { rpc: async () => { calls++; return { data: null, error: { message } }; } };
      await assert.rejects(executeDayReviews({ query: query(), command: command(), authUserId: actor }, service),
        { code: message === "secret SQL internals" ? "attendance_unavailable" : message }); assert.equal(calls, 1); }
  let calls = 0; await assert.rejects(executeDayReviews({ query: query(), command: command(), authUserId: actor },
    { rpc: async () => { calls++; throw Error("unknown commit"); } }), { code: "attendance_unavailable" }); assert.equal(calls, 1);
});

test("C15-A owner-self new writes and aborted/late scopes cannot return a result or start another SQL call", async () => {
  let calls = 0; const controller = new AbortController(), service: AttendanceSelfRpc = { rpc: async () => { calls++; controller.abort(); return { data: receipt(), error: null }; } };
  await assert.rejects(executeDayReviews({ query: query(), command: { ...command(), employeeAuthUserId: actor }, authUserId: actor }, service)); assert.equal(calls, 0);
  await assert.rejects(executeDayReviews({ query: query(), command: command(), authUserId: actor, signal: controller.signal }, service)); assert.equal(calls, 1);
  await assert.rejects(executeDayReviews({ query: query(), command: command(), authUserId: actor, signal: controller.signal }, service)); assert.equal(calls, 1);
});
