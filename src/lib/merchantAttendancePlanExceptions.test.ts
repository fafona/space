import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanExceptionQuery, parsePlanExceptionCommand, parsePlanExceptionBody, parsePlanExceptionHttpQuery, planExceptionQueryString, parsePlanExceptionResponse, parsePlanExceptionJson } from "./merchantAttendancePlanExceptions";
import { planExceptionsSiteEnabled, executePlanExceptions } from "./merchantAttendancePlanExceptions.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
const owner = "70000000-0000-4000-8000-000000000001", worker = "70000000-0000-4000-8000-000000000002", slot = "70000000-0000-4000-8000-000000000003", operation = "70000000-0000-4000-8000-000000000004";
const query = () => ({ siteId: "99990001", access: "owner" as const, mode: "list" as const, workerId: null, slotId: null, operationId: null, beforeAt: null, beforeId: null });
const result = () => ({ ok: true, moduleEnabled: true, data: { protocol: "plan-exception-review-v1", siteId: "99990001", access: "owner", actorId: owner, employeeId: null, readAt: "2026-10-05T12:00:00.000001Z", items: [], nextCursor: null, detail: null, receipt: null, readReceipt: null } });
test("review list strict query and HTTP omit only nullable anchors", () => {
  const q = query(); assert.deepEqual(parsePlanExceptionHttpQuery("https://www.faolla.com/?" + planExceptionQueryString(q)), q);
  for (const suffix of ["&mode=list", "&unknown=1", "&workerId=", " ", "\n", "&siteId=99990001"]) assert.throws(() => parsePlanExceptionHttpQuery("https://www.faolla.com/?" + planExceptionQueryString(q) + suffix));
  for (const change of [{ siteId: "99990001\n" }, { siteId: "9999001" }, { workerId: "" }, { beforeId: operation }, { beforeAt: "2026-10-05T12:00:00.000000Z" }, { slotId: slot }]) assert.throws(() => parsePlanExceptionQuery({ ...q, ...change }));
});
test("review command cannot supply candidate facts, change original ID or use self decision", () => {
  const q = { ...query(), mode: "decide" as const, workerId: worker, slotId: slot, operationId: operation };
  const c = { operationId: operation, expectedRevision: 0, expectedFingerprint: "a".repeat(64), employeeId: worker, employeeAuthUserId: slot, outcome: "follow_up", note: "核查漏卡" };
  assert.equal(parsePlanExceptionBody({ query: q, command: c }).command.operationId, operation);
  for (const change of [{ eligible: true }, { note: "" }, { note: "a\nb" }, { note: "a".repeat(501) }, { expectedRevision: -0 }, { expectedRevision: -1 }, { expectedFingerprint: "a".repeat(63) }, { operationId: worker }, { outcome: "absent" }]) assert.throws(() => parsePlanExceptionCommand(q, { ...c, ...change }));
  assert.throws(() => parsePlanExceptionQuery({ ...q, access: "self" }));
  assert.throws(() => parsePlanExceptionBody({ query: { ...q, mode: "recover" }, command: c }));
});
test("review self note and explicit read have distinct exact commands", () => {
  const q = { ...query(), access: "self" as const, mode: "note" as const, workerId: worker, slotId: slot, operationId: operation };
  const c = { operationId: operation, expectedRevision: 1, decisionOperationId: owner, note: "员工说明" };
  assert.deepEqual(parsePlanExceptionCommand(q, c), c);
  assert.throws(() => parsePlanExceptionCommand(q, { ...c, expectedRevision: 0 }));
  assert.deepEqual(parsePlanExceptionCommand({ ...q, mode: "ack" }, { operationId: operation, decisionOperationId: owner }), { operationId: operation, decisionOperationId: owner });
  assert.throws(() => parsePlanExceptionCommand({ ...q, mode: "ack" }, c));
});
test("review response checks real Auth separately from employee identity", () => {
  const raw = result(), parsed = parsePlanExceptionResponse(raw, query(), { ownerId: owner, authUserId: owner }); assert.equal(parsed.items.length, 0);
  assert.throws(() => parsePlanExceptionResponse(raw, query(), { employeeId: worker }));
  assert.throws(() => parsePlanExceptionResponse(raw, query(), { ownerId: worker }));
  const self = { ...raw, data: { ...raw.data, access: "self", employeeId: worker } };
  assert.equal(parsePlanExceptionResponse(self, { ...query(), access: "self" }, { employeeId: worker, authUserId: owner }).employeeId, worker);
  assert.throws(() => parsePlanExceptionResponse(self, { ...query(), access: "self" }, { authUserId: worker }));
});
test("review unsafe JSON/descriptors/unknown fields fail closed without invoking getters", () => {
  assert.throws(() => parsePlanExceptionJson('{"a":1,"a":2}')); assert.throws(() => parsePlanExceptionJson('{"__proto__":{}}'));
  const raw = result(); let read = false; Object.defineProperty(raw.data, "detail", { get() { read = true; return null; }, enumerable: true });
  assert.throws(() => parsePlanExceptionResponse(raw, query(), { ownerId: owner })); assert.equal(read, false);
  assert.throws(() => parsePlanExceptionResponse({ ...result(), extra: true }, query(), { ownerId: owner }));
});
test("review gate is independent, default off and exact-site allowlisted", () => {
  assert.equal(planExceptionsSiteEnabled("99990001", {}), false);
  const env = { FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_SITE_IDS: "99990001,99990002" };
  assert.equal(planExceptionsSiteEnabled("99990001", env), true);
  for (const raw of ["*", "99990001,", "9999001", "99990001,bad"]) assert.equal(planExceptionsSiteEnabled("99990001", { ...env, FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_SITE_IDS: raw }), false);
  assert.equal(planExceptionsSiteEnabled("99990003", env), false);
});
test("review service invokes only one real actor RPC, defaults writes off and sanitizes failures", async () => {
  const calls: unknown[] = [], data = result().data;
  await executePlanExceptions({ query: query(), authUserId: owner }, { rpc: async (name, args) => { calls.push({ name, args }); return { data, error: null }; } });
  assert.deepEqual(calls, [{ name: "faolla_attendance_plan_exception_posthoc_review_v1", args: { p_query: query(), p_auth_user_id: owner, p_command: null, p_allow_write: false, p_allow_posthoc: false, p_allow_clearance: false, p_capture_notifications: false } }]);
  await assert.rejects(executePlanExceptions({ query: query(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "secret database details" } }) }), /attendance_unavailable/);
});

test("review service preserves the exact sealed rejection without accepting database error details", async () => {
  const q = { ...query(), mode: "decide" as const, workerId: worker, slotId: slot, operationId: operation };
  const command = parsePlanExceptionCommand(q, { operationId: operation, expectedRevision: 1, expectedFingerprint: "a".repeat(64),
    employeeId: worker, employeeAuthUserId: slot, outcome: "follow_up", note: "Synthetic sealed boundary" });
  for (const message of ["attendance_period_sealed", "attendance_period_sealed: private details"]) {
    let calls = 0;
    await assert.rejects(executePlanExceptions({ query: q, command, authUserId: owner, moduleEnabled: true }, {
      rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_plan_exception_posthoc_review_v1");
        assert.deepEqual(args.p_command, command); assert.equal(args.p_auth_user_id, owner);
        return { data: null, error: { message } }; },
    }), error => error instanceof MerchantAttendanceError && error.code === (message === "attendance_period_sealed" ? message : "attendance_unavailable"));
    assert.equal(calls, 1);
  }
});
