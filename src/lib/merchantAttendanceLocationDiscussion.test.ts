import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscussionCommand, parseDiscussionQuery, parseDiscussionResult, discussionQueryString } from "./merchantAttendanceLocationDiscussion";
import { executeAttendanceDiscussion } from "./merchantAttendanceLocationDiscussion.server";
import { createDiscussionFixture, discussionSite as siteId, discussionWorker as expectedWorkerId, discussionEvent as eventId, discussionId as id, discussionDetailQuery as detail, discussionListQuery as list } from "../../scripts/fixtures/attendance-location-discussion-model";
const body = { siteId, access: "self", expectedWorkerId, eventId, operationId: id(20), expectedRevision: 0, note: " Synthetic explanation " };
test("discussion strict commands reject forged identities, private/public flags and invalid notes", () => {
  assert.equal(parseDiscussionCommand(body).command.note, "Synthetic explanation");
  for (const patch of [{ actor: id(99) }, { visible: true }, { expectedWorkerId: null }, { access: "manager" }, { note: "" }, { note: "x".repeat(501) }, { note: "a\nb" }, { expectedRevision: "0" }, { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }]) assert.throws(() => parseDiscussionCommand({ ...body, ...patch }));
  assert.throws(() => parseDiscussionCommand({ ...body, access: "owner" }));
});
test("queries enforce bounded dates, duplicates and self worker pin while owner has no pin", () => {
  for (const q of [list(), detail(), list("owner"), detail("owner")]) assert.deepEqual(parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(q)}`), q);
  for (const suffix of ["&employeeId=x", "&siteId=99990002", "&operationId=x"]) assert.throws(() => parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(list())}${suffix}`));
  assert.throws(() => parseDiscussionQuery(`https://local.invalid/?${discussionQueryString({ ...detail(), expectedWorkerId: null })}`));
  const q = { ...list("owner"), cursorAt: "2026-09-28T11:00:00.000001Z", cursorId: id(50), asOf: "2026-09-30T12:00:00.000000Z" };
  assert.deepEqual(parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(q)}`), q);
  assert.throws(() => parseDiscussionQuery(`https://local.invalid/?${discussionQueryString({ ...q, access: "self" })}`));
});
test("explicit response projection discards internal notes and identities", () => {
  const raw = { ...createDiscussionFixture().detail(), internalNote: "private", actorAuthUserId: id(88) };
  assert.equal("internalNote" in parseDiscussionResult(raw, detail()), false);
  for (const patch of [{ siteId: "99990002" }, { workerId: id(88) }, { access: "owner" }, { canPost: "true" }, { historyTruncated: true }, { history: [{}] }]) assert.throws(() => parseDiscussionResult({ ...raw, ...patch }, detail()));
});
test("thread history, latest author, receipt operation and revision are mutually checked", async () => {
  const f = createDiscussionFixture(), p = parseDiscussionCommand(body);
  await f.apiFetch("/api/merchant-enterprise/attendance/location-discussion", { method: "POST", body: JSON.stringify(body) });
  const raw = f.detail("self", body.operationId); assert.equal(parseDiscussionResult(raw, detail("self", body.operationId)).mode, "detail");
  for (const patch of [{ item: { ...raw.item, lastAuthor: "owner" } }, { history: [{ ...raw.history[0], revision: 4 }] }, { receipt: { ...raw.receipt, note: "altered" } }, { receipt: { ...raw.receipt, operationId: id(99) } }]) assert.throws(() => parseDiscussionResult({ ...raw, ...patch }, detail("self", body.operationId)));
  const args: unknown[] = [];
  const output = await executeAttendanceDiscussion({ query: detail(), authUserId: id(60), command: p.command }, { rpc: async (...a: unknown[]) => { args.push(a); return { data: raw, error: null }; } });
  assert.equal(output.mode, "detail"); assert.match(JSON.stringify(args), /p_auth_user_id/); assert.doesNotMatch(JSON.stringify(args), /internalNote/);
});
test("server hides backend errors and refuses malformed success, wrong event or command receipt", async () => {
  const input = { query: detail(), authUserId: id(60), command: parseDiscussionCommand(body).command };
  await assert.rejects(() => executeAttendanceDiscussion(input, { rpc: async () => ({ data: createDiscussionFixture().detail(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(() => executeAttendanceDiscussion(input, { rpc: async () => ({ data: null, error: { message: "secret database error" } }) }), /attendance_unavailable/);
  await assert.rejects(() => executeAttendanceDiscussion({ ...input, query: list() }, { rpc: async () => { throw Error("unexpected"); } }), /attendance_invalid_request/);
});
