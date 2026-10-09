import assert from "node:assert/strict";
import test from "node:test";
import { parseNoticeCommand, parseNoticeQuery, parseNoticeResult, noticeQueryString, locationNoticeTemplate1, noticeReceiptMatches } from "./merchantAttendanceLocationNotice";
import { executeAttendanceNotice } from "./merchantAttendanceLocationNotice.server";
import { createNoticeFixture, noticeQuery, noticeId as id, noticeOwner } from "../../scripts/fixtures/attendance-location-notice-model";
const q = noticeQuery(), body = { siteId: q.siteId, access: q.access, locationId: q.locationId, expectedWorkerId: null,
  action: "publish", operationId: id(20), expectedRevision: 0, draftRevision: 1, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Public reason" };
test("notice query pins self worker/location and rejects duplicate or forged identities", () => {
  for (const a of ["self", "owner"] as const) assert.deepEqual(parseNoticeQuery(`https://local.invalid/?${noticeQueryString(noticeQuery(a))}`), noticeQuery(a));
  for (const extra of ["&access=self", "&employeeId=x", "&expectedWorkerId=00000000-0000-4000-8000-000000000099"]) assert.throws(() => parseNoticeQuery(`https://local.invalid/?${noticeQueryString(q)}${extra}`));
  assert.throws(() => parseNoticeQuery(`https://local.invalid/?${noticeQueryString({ ...noticeQuery("self"), expectedWorkerId: null })}`));
});
test("publish/withdraw/acknowledge strict commands cannot carry activation, raw consent or actor flags", () => {
  assert.equal(parseNoticeCommand(body).command.action, "publish");
  for (const patch of [{ enabled: true }, { action: "acknowledge" }, { reason: "" }, { reason: "a\nb" }, { reason: "x".repeat(241) }, { expectedRevision: "0" }, { action: "withdraw" }, { draftRevision: null }, { expectedSettingsVersion: 0 }]) assert.throws(() => parseNoticeCommand({ ...body, ...patch }));
  const self = noticeQuery("self"); const ack = { siteId: self.siteId, access: self.access, locationId: self.locationId, expectedWorkerId: self.expectedWorkerId, action: "acknowledge", operationId: id(21), expectedRevision: 1 };
  assert.equal(parseNoticeCommand(ack).command.action, "acknowledge"); assert.throws(() => parseNoticeCommand({ ...ack, consent: true }));
  assert.equal(parseNoticeCommand({ ...ack, expectedRevision: Number.MAX_SAFE_INTEGER - 1 }).command.expectedRevision, Number.MAX_SAFE_INTEGER - 1);
  assert.throws(() => parseNoticeCommand({ ...ack, expectedRevision: Number.MAX_SAFE_INTEGER }));
});
test("response projection does not expose owner draft to self or claim operational changes", async () => {
  const f = createNoticeFixture(); await f.apiFetch("/local", { method: "POST", body: JSON.stringify(body) });
  const raw = f.snapshot("self"), parsed = parseNoticeResult(raw, noticeQuery("self")); assert.equal(parsed.draft, null); assert.equal(parsed.current?.values?.notice, "合成告知第 1 版");
  for (const patch of [{ draft: f.snapshot().draft }, { operationalChanged: true }, { workerId: id(99) }, { canPublish: true }, { canWithdraw: true }, { acknowledgedAt: "2020-01-01T00:00:00.000000Z" }]) assert.throws(() => parseNoticeResult({ ...raw, ...patch }, noticeQuery("self")));
  assert.throws(() => parseNoticeResult({ ...raw, current: { ...raw.current, templateVersion: 2 } }, noticeQuery("self")));
  assert.throws(() => parseNoticeResult({ ...raw, current: { ...raw.current, values: { ...raw.current?.values, latitude: 37 } } }, noticeQuery("self")));
});
test("publication receipt is bound to exact action, draft and public reason", async () => {
  const f = createNoticeFixture(), p = parseNoticeCommand(body); await f.apiFetch("/local", { method: "POST", body: JSON.stringify(body) });
  const raw = f.snapshot("owner", body.operationId), parsed = parseNoticeResult(raw, { ...q, operationId: body.operationId }); assert.ok(parsed.receipt); assert.equal(noticeReceiptMatches(parsed.receipt, p.command), true);
  assert.equal(noticeReceiptMatches({ ...parsed.receipt, reason: "different" }, p.command), false);
  assert.throws(() => parseNoticeResult({ ...raw, receipt: { ...raw.receipt, action: "withdraw" } }, { ...q, operationId: body.operationId }));
  const args: unknown[] = []; await executeAttendanceNotice({ query: q, command: p.command, authUserId: noticeOwner, allowPublish: false }, { rpc: async (...a: unknown[]) => { args.push(a); return { data: raw, error: null }; } });
  assert.match(JSON.stringify(args), /"p_allow_publish":false/);
});
test("server sanitizes backend errors and rejects missing or inconsistent receipts", async () => {
  const input = { query: q, command: parseNoticeCommand(body).command, authUserId: noticeOwner, allowPublish: true };
  await assert.rejects(() => executeAttendanceNotice(input, { rpc: async () => ({ data: createNoticeFixture().snapshot(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(() => executeAttendanceNotice(input, { rpc: async () => ({ data: null, error: { message: "private DB detail" } }) }), /attendance_unavailable/);
  await assert.rejects(() => executeAttendanceNotice({ ...input, query: noticeQuery("self") }, { rpc: async () => { throw Error("unexpected"); } }), /attendance_invalid_request/);
});
test("template explicitly distinguishes acknowledgement, planned retention and location activation", () => {
  const values = createNoticeFixture().snapshot().draft!.values, lines = locationNoticeTemplate1(values).join("\n");
  assert.match(lines, /不启用定位/); assert.match(lines, /不能证明已阅读理解全文/); assert.match(lines, /不会启动自动清理/); assert.doesNotMatch(lines, /37\.3|-5\.9/);
});
