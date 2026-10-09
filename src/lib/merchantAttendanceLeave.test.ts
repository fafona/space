import assert from "node:assert/strict";
import test from "node:test";
import { leaveInterval, leaveQueryString, leaveReason, parseLeaveBody, parseLeaveCommand, parseLeaveDetail,
  parseLeaveHttpQuery, parseLeaveQuery, parseLeaveResponse, parseLeaveResult, parseLeaveSummary, resolveLeaveInterval,
  type LeaveCommand, type LeaveDetail, type LeaveQuery, type LeaveResult, type LeaveSummary } from "./merchantAttendanceLeave";
import { DEFAULT_MERCHANT_ENTERPRISE_ROLES, MERCHANT_ENTERPRISE_PERMISSIONS,
  toggleMerchantEnterprisePermissionSelection } from "./merchantEnterprise";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (access: LeaveQuery["access"] = "self"): LeaveQuery => ({ siteId: "99990001", access, requestId: null, operationId: null, beforeAt: null, beforeId: null });
const command: LeaveCommand = { operationId: id(501), action: "submit", reason: "Personal leave", expectedWorkerId: id(201),
  expectedSettingsVersion: 1, timeZone: "Europe/Madrid", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z" };
const summary = (n = 501): LeaveSummary => ({ requestId: id(n), workerName: "Synthetic worker", startAt: command.startAt,
  endAt: command.endAt, timeZone: command.timeZone, submittedAt: "2026-10-03T09:00:00.123456Z", revision: 1, status: "submitted" });
const detail = (): LeaveDetail => ({ ...summary(), workerId: id(201), employeeId: id(101), reason: command.reason,
  history: [{ revision: 1, action: "submit", reason: command.reason, recordedAt: summary().submittedAt }],
  canWithdraw: true, canApprove: false, canReject: false, canCancel: false });
const result = (access: LeaveQuery["access"] = "self"): LeaveResult => ({ protocol: "leave-v1", siteId: "99990001", access, actorId: id(99),
  employeeId: access === "self" ? id(101) : null, workerId: access === "self" ? id(201) : null,
  timeZone: "Europe/Madrid", settingsVersion: 1, canSubmit: access === "self", items: [], nextCursor: null, detail: null, receipt: null });

test("leave queries are exact, duplicate-free and bind complete microsecond pagination separately from detail or receipt lookup", () => {
  assert.deepEqual(parseLeaveHttpQuery(`https://fixture.invalid/?${leaveQueryString(query())}`), query());
  const paged = { ...query(), beforeAt: summary().submittedAt, beforeId: id(501) };
  assert.deepEqual(parseLeaveQuery(paged), paged);
  for (const patch of [{ access: "manager" }, { siteId: "all" }, { ownerId: id(1) }, { limit: 500 },
    { beforeAt: paged.beforeAt }, { beforeId: paged.beforeId }, { ...paged, requestId: id(501) },
    { ...paged, operationId: id(501) }, { beforeAt: "2026-10-03T09:00:00.123Z", beforeId: id(501) }])
    assert.throws(() => parseLeaveQuery({ ...query(), ...patch }));
  for (const suffix of ["&siteId=99990001", "&access=owner", "&authUserId=" + id(99), "&workerId=" + id(201)])
    assert.throws(() => parseLeaveHttpQuery(`https://fixture.invalid/?${leaveQueryString(query())}${suffix}`));
});

test("commands have exact schemas, bounded reasons and role-specific submit/withdraw/owner decisions", () => {
  assert.deepEqual(parseLeaveBody({ query: query(), command }), { query: query(), command });
  for (const reason of ["", " padded", "bad\nreason", "x".repeat(201), "\u0085bad"]) assert.throws(() => leaveReason(reason));
  assert.equal(leaveReason("🙂".repeat(200)).length, 400);
  for (const patch of [{ extra: true }, { expectedSettingsVersion: 0 }, { expectedWorkerId: "bad" }, { reason: "" }, { expectedSettingsVersion: 0.1 }])
    assert.throws(() => parseLeaveCommand({ ...command, ...patch }));
  for (const action of ["withdraw", "approve", "reject", "cancel"] as const) {
    const access = action === "withdraw" ? "self" : "owner", q = { ...query(access), requestId: id(501) };
    const c = { operationId: id(502), action, reason: "Decision", requestId: id(501), expectedRevision: action === "cancel" ? 2 : 1 };
    assert.deepEqual(parseLeaveBody({ query: q, command: c }).command, c);
    assert.throws(() => parseLeaveBody({ query: { ...q, access: access === "self" ? "owner" : "self" }, command: c }));
    assert.throws(() => parseLeaveCommand({ ...c, expectedRevision: 3 }));
  }
  for (const value of [{ query: query("owner"), command }, { query: { ...query(), requestId: id(501) }, command },
    { query: { ...query(), operationId: id(501) }, command }, { query: query(), command, allowWrite: true }])
    assert.throws(() => parseLeaveBody(value));
});

test("leave intervals require canonical minute UTC, a real zone and positive spans of at most 366 days; DST ambiguity is explicit", () => {
  assert.deepEqual(leaveInterval(command.startAt, command.endAt, command.timeZone), { startAt: command.startAt, endAt: command.endAt, timeZone: command.timeZone });
  for (const [start, end, zone] of [[command.startAt, command.startAt, command.timeZone], [command.startAt, "2027-10-07T07:00:00.000Z", command.timeZone],
    ["2026-10-05T07:00:01.000Z", command.endAt, command.timeZone], ["2026-10-05T07:00:00.000000Z", command.endAt, command.timeZone],
    [command.startAt, command.endAt, "Bad/Zone"], ["1990-01-01T00:00:00.000Z", "1990-01-02T00:00:00.000Z", "UTC"]])
    assert.throws(() => leaveInterval(start, end, zone));
  const repeated = { local: "2026-10-25T02:30", offset: "" }, end = { local: "2026-10-25T04:00", offset: "+01:00" };
  assert.throws(() => resolveLeaveInterval(repeated, end, "Europe/Madrid"));
  const early = resolveLeaveInterval({ ...repeated, offset: "+02:00" }, end, "Europe/Madrid");
  const late = resolveLeaveInterval({ ...repeated, offset: "+01:00" }, end, "Europe/Madrid");
  assert.equal(Date.parse(late.startAt) - Date.parse(early.startAt), 3600000);
  assert.throws(() => resolveLeaveInterval({ local: "2026-03-29T02:30", offset: "+01:00" }, { local: "2026-03-29T04:00", offset: "+02:00" }, "Europe/Madrid"));
});

test("strict summaries exclude reasons and identities; detail history must follow submit to terminal or approve to cancel", () => {
  assert.deepEqual(parseLeaveSummary(summary()), summary()); assert.deepEqual(parseLeaveDetail(detail()), detail());
  for (const patch of [{ revision: 2 }, { status: "pending" }, { workerName: " padded " }, { workerName: "x".repeat(121) }, { submittedAt: "2026-10-03T09:00:00.123Z" },
    { reason: "private" }, { workerId: id(201) }]) assert.throws(() => parseLeaveSummary({ ...summary(), ...patch }));
  const approved: LeaveDetail = { ...detail(), revision: 2, status: "approved", canWithdraw: false, canCancel: true,
    history: [...detail().history, { revision: 2, action: "approve", reason: "Approved", recordedAt: "2026-10-03T10:00:00.000001Z" }] };
  const cancelled: LeaveDetail = { ...approved, revision: 3, status: "cancelled", canCancel: false,
    history: [...approved.history, { revision: 3, action: "cancel", reason: "Cancelled", recordedAt: "2026-10-03T10:00:00.000002Z" }] };
  assert.deepEqual(parseLeaveDetail(cancelled), cancelled);
  for (const patch of [{ history: [] }, { reason: "Mismatch" }, { canCancel: true }, { canWithdraw: "true" },
    { history: [{ ...detail().history[0], recordedAt: "2026-10-03T09:00:00.123457Z" }] }])
    assert.throws(() => parseLeaveDetail({ ...detail(), ...patch }));
  assert.throws(() => parseLeaveDetail({ ...cancelled, history: cancelled.history.map((h, i) => i === 1 ? { ...h, action: "reject" } : h) }));
  assert.throws(() => parseLeaveDetail({ ...detail(), canWithdraw: false, canApprove: true, canReject: false }));
  assert.equal(parseLeaveSummary({ ...summary(), workerName: "x".repeat(120) }).workerName.length, 120);
});

test("result envelopes pin actor, tenant and employee/worker authority and reject cross-role capability leakage", () => {
  assert.deepEqual(parseLeaveResult(result(), query(), null, id(99)), result());
  assert.equal(parseLeaveResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { protocol: "other" }, { access: "owner" },
    { employeeId: null }, { workerId: null }, { canSubmit: "true" }, { settingsVersion: 0 }, { extra: true }])
    assert.throws(() => parseLeaveResult({ ...result(), ...patch }, query(), null, id(99)));
  assert.deepEqual(parseLeaveResult(result("owner"), query("owner")), result("owner"));
  for (const patch of [{ employeeId: id(101) }, { workerId: id(201) }, { canSubmit: true }])
    assert.throws(() => parseLeaveResult({ ...result("owner"), ...patch }, query("owner")));
  for (const patch of [{ employeeId: id(102) }, { workerId: id(202) }, { canApprove: true }, { canReject: true }, { canCancel: true }])
    assert.throws(() => parseLeaveResult({ ...result(), detail: { ...detail(), ...patch } }, { ...query(), requestId: id(501) }));
  assert.throws(() => parseLeaveResult({ ...result("owner"), detail: detail() }, { ...query("owner"), requestId: id(501) }));
  assert.throws(() => parseLeaveResult({ ...result(), detail: detail() }, query()));
  assert.throws(() => parseLeaveResponse({ ok: true, moduleEnabled: "false", ...result() }, query()));
});

test("25-row descending pages retain six-digit tie breaks and detail/receipt queries cannot advertise list pagination", () => {
  const items = Array.from({ length: 25 }, (_, i) => summary(550 - i));
  const value = { ...result(), items, nextCursor: { at: items[24].submittedAt, id: items[24].requestId } };
  assert.deepEqual(parseLeaveResult(value, query()), value);
  for (const patch of [{ items: [...items, summary(525)] }, { items: [...items].reverse() }, { items: [summary(), summary()], nextCursor: null },
    { items: items.slice(1) }, { nextCursor: { ...value.nextCursor, id: id(527) } }, { nextCursor: { ...value.nextCursor, extra: true } }])
    assert.throws(() => parseLeaveResult({ ...value, ...patch }, query()));
  const paged = { ...query(), beforeAt: summary().submittedAt, beforeId: id(501) };
  assert.throws(() => parseLeaveResult({ ...result(), items: [summary()] }, paged));
  assert.equal(parseLeaveResult({ ...result(), items: [summary(500)] }, paged).items[0].requestId, id(500));
  assert.throws(() => parseLeaveResult(value, { ...query(), operationId: id(501) }));
});

test("operation receipts remain original snapshots even when current detail has later approvals", () => {
  const current: LeaveDetail = { ...detail(), revision: 2, status: "approved", canWithdraw: false,
    history: [...detail().history, { revision: 2, action: "approve", reason: "Approved", recordedAt: "2026-10-03T10:00:00.000001Z" }] };
  const receipt = { command, item: summary(), requestId: id(501), revision: 1 };
  const value = { ...result(), detail: current, receipt };
  assert.equal(parseLeaveResult(value, { ...query(), operationId: command.operationId }).receipt?.item.revision, 1);
  assert.equal(parseLeaveResult(value, query(), command).detail?.revision, 2);
  for (const malformed of [null, { ...receipt, revision: 2 }, { ...receipt, requestId: id(502) },
    { ...receipt, command: { ...command, operationId: id(502) } }, { ...receipt, item: { ...summary(), endAt: "2026-10-05T16:00:00.000Z" } },
    { ...receipt, item: { ...summary(), revision: 2, status: "approved" } }, { ...receipt, privateData: "x" }])
    assert.throws(() => parseLeaveResult({ ...value, receipt: malformed }, query(), command));
});

test("receipts require related current detail, immutable summary fields and the exact historical action/reason and submit worker", () => {
  const receipt = { command, item: summary(), requestId: id(501), revision: 1 };
  for (const replacement of [null, { ...detail(), requestId: id(502) }, { ...detail(), workerName: "Other worker" },
    { ...detail(), endAt: "2026-10-05T16:00:00.000Z" },
    { ...detail(), reason: "Different original reason", history: [{ ...detail().history[0], reason: "Different original reason" }] }])
    assert.throws(() => parseLeaveResult({ ...result(), detail: replacement, receipt }, query(), command));
  assert.throws(() => parseLeaveResult({ ...result(), workerId: id(202), detail: { ...detail(), workerId: id(202) }, receipt }, query(), command));
  const approval: LeaveCommand = { operationId: id(502), action: "approve", reason: "Approved", requestId: id(501), expectedRevision: 1 };
  const approvedReceipt = { command: approval, item: { ...summary(), revision: 2, status: "approved" }, requestId: id(501), revision: 2 };
  const operationQuery = { ...query("owner"), operationId: approval.operationId };
  assert.throws(() => parseLeaveResult({ ...result("owner"), detail: { ...detail(), canWithdraw: false }, receipt: approvedReceipt }, operationQuery));
  const withdrawn: LeaveDetail = { ...detail(), revision: 2, status: "withdrawn", canWithdraw: false,
    history: [...detail().history, { revision: 2, action: "withdraw", reason: "Approved", recordedAt: "2026-10-03T10:00:00.000001Z" }] };
  assert.throws(() => parseLeaveResult({ ...result("owner"), detail: withdrawn, receipt: approvedReceipt }, operationQuery));
});

test("new self-leave permission depends on viewing but is not silently granted to existing default roles", () => {
  assert.ok(MERCHANT_ENTERPRISE_PERMISSIONS.includes("attendance.self.leave"));
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) assert.equal(role.permissions.includes("attendance.self.leave"), false);
  const granted = toggleMerchantEnterprisePermissionSelection([], "attendance.self.leave", true);
  assert.ok(granted.includes("enterprise.view")); assert.ok(granted.includes("attendance.self.view"));
  assert.equal(toggleMerchantEnterprisePermissionSelection(granted, "attendance.self.view", false).includes("attendance.self.leave"), false);
});
