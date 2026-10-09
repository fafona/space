// Pure synthetic protocol tests, not a source/SQL/Auth acceptance claim.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseDayReviewQuery as query, parseDayReviewCommand as command, parseDayReviewBody, parseDayReviewHttpQuery, dayReviewQueryString, parseDayReviewJson, dayReviewCommandFingerprintText, dayReviewCommandFingerprint,
  dayReviewReceiptMatches, parseDayReviewReceipt, type DayReviewQuery, type DayReviewDecideCommand } from "./merchantAttendanceDayReviewContract";
const id = (n: number) => `19900000-0000-4000-8000-${String(n).padStart(12, "0")}`, actor = id(1);
const preview = (): Extract<DayReviewQuery, { mode: "preview" }> => ({ siteId: "99990199", access: "owner", mode: "preview", workerId: id(2), workDate: "2026-10-07", slotId: null, caseId: null });
const decide = (): DayReviewDecideCommand => ({ action: "decide", operationId: id(3), caseId: id(4), expectedRevision: 0, workerId: id(2), employeeId: id(5), employeeAuthUserId: id(6), expectedFingerprint: "a".repeat(64), outcome: "follow_up", calendarReference: null, selfStatementOperationId: null, reason: "合成资料继续核查，不认定缺勤或工资" });
test("C15-A exact targets never accept client UTC frames, foreign worker, bulk lists or self discovery", () => {
  const q = preview(), c = decide(); assert.deepEqual(parseDayReviewBody({ query: q, command: c }), { query: q, command: c });
  for (const patch of [{ access: "self" }, { fromAt: "2026-10-07T00:00:00.000000Z" }, { workDate: "2026-02-30" }, { workerIds: [id(2)] }]) assert.throws(() => query({ ...q, ...patch }));
  for (const patch of [{ workerId: id(7) }, { expectedRevision: 1 }, { employeeId: null }, { reason: "" }, { source: {} }, { outcome: "absent" }]) assert.throws(() => command(q, { ...c, ...patch }));
  assert.throws(() => query({ siteId: "99990199", access: "self", mode: "list", workerId: id(2), cursor: null }));
  assert.throws(() => query({ siteId: "99990199", mode: "recover", operationId: id(3), access: "owner" }));
  assert.throws(() => command({ siteId: "99990199", mode: "recover", operationId: id(3) }, c));
});
test("C15-A calendar selection is one live original closure reference; self claim requires an existing case", () => {
  const q = preview(), c = decide(), plan = { ...q, slotId: id(8) }, closure = { entryId: id(9), operationId: id(9), revision: 1 };
  assert.equal(command(plan, { ...c, outcome: "calendar_exempt", calendarReference: closure }).action, "decide");
  for (const bad of [{ ...closure, revision: 2 }, { ...closure, operationId: id(10) }, [closure], null]) assert.throws(() => command(plan, { ...c, outcome: "calendar_exempt", calendarReference: bad }));
  assert.throws(() => command(q, { ...c, outcome: "calendar_exempt", calendarReference: closure }));
  assert.throws(() => command(q, { ...c, outcome: "not_worked_reported", selfStatementOperationId: id(11) }));
  assert.equal(command({ ...q, caseId: c.caseId }, { ...c, expectedRevision: 2, outcome: "not_worked_reported", selfStatementOperationId: id(11) }).action, "decide");
  assert.throws(() => command(q, { ...c, calendarReference: closure }));
});
test("C15-A structured self explanation and dispute never become an owner decision or invented hours", () => {
  const q: DayReviewQuery = { siteId: "99990199", access: "self", mode: "detail", caseId: id(4) }, base = { operationId: id(12), expectedRevision: 1, decisionOperationId: id(3), reason: "本人明确说明" };
  for (const claim of ["worked_missing_records", "not_worked", "uncertain"]) assert.equal(command(q, { ...base, action: "explain", claim }).action, "explain");
  assert.equal(command(q, { ...base, action: "dispute", claim: null }).action, "dispute");
  for (const c of [{ ...base, action: "dispute", claim: "not_worked" }, { ...base, action: "explain", claim: "absent" }, { ...base, action: "explain", claim: "not_worked", hours: 0 }, decide()]) assert.throws(() => command(q, c));
  assert.throws(() => command({ ...q, access: "owner" }, { ...base, action: "explain", claim: "not_worked" }));
});

test("C15-A HTTP exact mode keys, cursor pairs, numeric revisions and bounded duplicate-safe JSON", () => {
  const queries: DayReviewQuery[] = [preview(), { ...preview(), slotId: id(8), caseId: id(4) },
    { siteId: "99990199", access: "owner", mode: "candidates", workerId: id(2), workDate: "2026-10-07" },
    { siteId: "99990199", access: "self", mode: "list", workerId: null, cursor: null },
    { siteId: "99990199", access: "owner", mode: "list", workerId: id(2), cursor: { openedAt: "2026-10-07T12:00:00.123456Z", caseId: id(4) } },
    { siteId: "99990199", access: "self", mode: "detail", caseId: id(4) },
    { siteId: "99990199", access: "owner", mode: "history", caseId: id(4), beforeRevision: null },
    { siteId: "99990199", access: "self", mode: "history", caseId: id(4), beforeRevision: 17 },
    { siteId: "99990199", mode: "recover", operationId: id(3) }];
  for (const q of queries) assert.deepEqual(parseDayReviewHttpQuery("https://synthetic.invalid/?" + dayReviewQueryString(q)), q);
  const url = "https://synthetic.invalid/?" + dayReviewQueryString(preview());
  for (const suffix of ["&siteId=99990199", "&slotId=", "&access=self", "&unknown=1", "#fragment", "&caseId=%xx"]) assert.throws(() => parseDayReviewHttpQuery(url + suffix));
  const list = "https://synthetic.invalid/?siteId=99990199&access=owner&mode=list";
  for (const suffix of ["&cursorCaseId=" + id(4), "&cursorOpenedAt=2026-10-07T12%3A00%3A00.123456Z", "&operationId=" + id(3)]) assert.throws(() => parseDayReviewHttpQuery(list + suffix));
  const history = "https://synthetic.invalid/?siteId=99990199&access=self&mode=history&caseId=" + id(4);
  for (const rev of ["0", "01", "-1", "1e2", "1.0", "9007199254740991"]) assert.throws(() => parseDayReviewHttpQuery(history + "&beforeRevision=" + rev));
  assert.throws(() => parseDayReviewJson('{"query":{},"query":{}}')); assert.throws(() => parseDayReviewJson('{"reason":"' + "界".repeat(2800) + '"}'));
});
test("C15-A immutable scalar-array command digest binds actor, target and exact receipt; getters execute zero times", async () => {
  const q = preview(), c = decide(), text = dayReviewCommandFingerprintText(q, actor, c), expected = createHash("sha256").update(text).digest("hex"), digest = dayReviewCommandFingerprint(q, actor, c);
  Object.assign(c, { reason: "changed after digest started" }); assert.equal(await digest, expected); assert.notEqual(await dayReviewCommandFingerprint(q, id(99), decide()), expected);
  const receipt = { operationId: id(3), caseId: id(4), revision: 1, action: "decide", actorId: actor, recordedAt: "2026-10-08T12:00:00.123456Z", commandFingerprint: expected };
  assert(dayReviewReceiptMatches(receipt, q, actor, decide(), expected));
  for (const patch of [{ actorId: id(99) }, { revision: 2 }, { caseId: id(99) }, { operationId: id(99) }, { action: "explain" }, { commandFingerprint: "f".repeat(64) }]) assert(!dayReviewReceiptMatches({ ...receipt, ...patch }, q, actor, decide(), expected));
  assert.throws(() => parseDayReviewReceipt({ ...receipt, reason: "private" })); let calls = 0;
  const unsafe = { ...decide() }; Object.defineProperty(unsafe, "action", { enumerable: true, get() { calls++; return "decide"; } });
  assert.throws(() => command(q, unsafe)); assert.throws(() => dayReviewCommandFingerprintText(q, actor, unsafe)); assert.equal(calls, 0);
});
