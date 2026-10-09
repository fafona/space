import assert from "node:assert/strict";
import test from "node:test";
import { correctionControlDates, correctionControlQueryString, correctionControlReceiptMatches, parseCorrectionControlCommand, parseCorrectionControlQuery,
  parseCorrectionControlResult, type CorrectionControlCommand } from "./merchantAttendanceCorrectionControls";
import { executeCorrectionControls } from "./merchantAttendanceCorrectionControls.server";
import { controlId as id, controlSite as siteId, controlOwner as ownerId, createCorrectionControlsFixture } from "../../scripts/fixtures/attendance-correction-controls-model";
const q = { siteId, operationId: null, beforeRevision: null };
const policy: CorrectionControlCommand = { operationId: id(100), expectedRevision: 0, expectedSettingsVersion: 1, action: "set_policy", submissionWindowDays: 7, reason: "配置理由" };
const parse = (c: unknown) => parseCorrectionControlCommand({ siteId, ...c as object });
async function seeded() { const m = createCorrectionControlsFixture(); await m.apiFetch("/api/merchant-enterprise/attendance/correction-controls", { method: "POST", body: JSON.stringify({ siteId, ...policy }) }); return m; }
test("control commands are exact, bounded and normalize reasons; never accept approval/actor fields", () => {
  assert.deepEqual(parse(policy), { siteId, command: policy }); assert.equal(parse({ ...policy, reason: " 理由 " }).command.reason, "理由");
  for (const patch of [{ submissionWindowDays: -1 }, { submissionWindowDays: 366 }, { submissionWindowDays: 1.5 }, { reason: "" }, { reason: "a\n" }, { reason: "字".repeat(501) },
    { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { expectedSettingsVersion: 0 }, { approved: true }, { actor: id(9) }, { action: "approve" }, { timeZone: "UTC" }]) assert.throws(() => parse({ ...policy, ...patch }));
  for (const days of [0, 365]) assert.equal((parse({ ...policy, submissionWindowDays: days }).command as typeof policy).submissionWindowDays, days);
});
test("period range is inclusive, at most 366 natural days and strictly valid; unlock needs an exact ID", () => {
  assert.deepEqual(correctionControlDates("2024-01-01", "2024-12-31"), { fromDate: "2024-01-01", throughDate: "2024-12-31" });
  for (const dates of [["2024-01-01", "2025-01-01"], ["2026-02-30", "2026-03-01"], ["2026-09-02", "2026-09-01"], ["1999-01-01", "1999-01-01"]]) assert.throws(() => correctionControlDates(...dates as [string,string]));
  const base = { operationId: id(101), expectedRevision: 1, expectedSettingsVersion: 1, reason: "锁定" };
  assert.equal(parse({ ...base, action: "lock_period", fromDate: "2026-01-01", throughDate: "2026-01-31" }).command.action, "lock_period");
  assert.equal(parse({ ...base, action: "unlock_period", periodId: id(101) }).command.action, "unlock_period");
  assert.throws(() => parse({ ...base, action: "unlock_period", periodId: "wrong" }));
});
test("query restricts tenant, receipt and positive history cursor; duplicate/injected fields reject", () => {
  const full = { siteId, operationId: id(100), beforeRevision: 25 };
  assert.deepEqual(parseCorrectionControlQuery(`https://local.invalid/?${correctionControlQueryString(full)}`), full);
  for (const suffix of ["&beforeRevision=0", "&beforeRevision=1.5", "&beforeRevision=01", "&siteId=99990002", "&authUserId=x", "&action=approve"])
    assert.throws(() => parseCorrectionControlQuery(`https://local.invalid/?siteId=${siteId}${suffix}`));
});
test("empty/read response never claims enforcement; unexpected private fields stripped", () => {
  const raw = createCorrectionControlsFixture().response(null, null), { moduleEnabled: _module, ...expected } = raw;
  assert.equal(_module, true); assert.deepEqual(parseCorrectionControlResult({ ...raw, actorAuthId: id(9) }, q), expected);
  for (const patch of [{ siteId: "99990002" }, { rulesEnforced: "true" }, { approvalAvailable: true }, { controlsOnly: false }, { revision: 1 }, { activePeriods: Array(201).fill({}) }])
    assert.throws(() => parseCorrectionControlResult({ ...raw, ...patch }, q));
});
test("receipts match original values and versions, not merely operation UUID", async () => {
  const m = await seeded(), raw = m.response(policy.operationId, null), receipt = raw.receipt!;
  assert.equal(correctionControlReceiptMatches(policy, receipt), true);
  for (const patch of [{ reason: "不同" }, { submissionWindowDays: 8 }, { expectedRevision: 1 }, { operationId: id(200) }]) assert.equal(correctionControlReceiptMatches({ ...policy, ...patch }, receipt), false);
  assert.throws(() => parseCorrectionControlResult(raw, q));
  assert.equal(parseCorrectionControlResult(raw, { ...q, operationId: policy.operationId }).receipt?.revision, 1);
});
test("response bounds history, timestamps, policy action, and future/duplicate active periods", async () => {
  const m = await seeded(), raw = m.response(null, null);
  for (const patch of [{ entries: [...raw.entries, ...raw.entries] }, { policy: { ...raw.policy, action: "approve" } }, { nextBeforeRevision: 1 },
    { entries: [{ ...raw.entries[0], recordedAt: "2099-01-01T00:00:00.000000Z" }] }]) assert.throws(() => parseCorrectionControlResult({ ...raw, ...patch }, q));
  const lock = { operationId: id(101), expectedRevision: 1, expectedSettingsVersion: 1, action: "lock_period", fromDate: "2026-03-29", throughDate: "2026-03-29", reason: "锁定" };
  await m.apiFetch("/api/merchant-enterprise/attendance/correction-controls", { method: "POST", body: JSON.stringify({ siteId, ...lock }) });
  const locked = m.response(null, null); assert.equal(parseCorrectionControlResult(locked, q).activePeriods[0].endAt, "2026-03-29T22:00:00.000000Z");
  for (const activePeriods of [[...locked.activePeriods, ...locked.activePeriods], [{ ...locked.activePeriods[0], startAt: "2026-03-29T00:00:00.000000Z" }]]) assert.throws(() => parseCorrectionControlResult({ ...locked, activePeriods }, q));
});
test("server authenticates RPC arguments, matches write receipt and masks backend details", async () => {
  const m = await seeded(), calls: unknown[] = [];
  const input = { query: q, command: policy, authUserId: ownerId, allowWrite: false };
  await executeCorrectionControls(input, { rpc: async (name,args) => { calls.push({ name,args }); return { data: m.response(policy.operationId,null), error:null }; } });
  assert.deepEqual(calls, [{ name: "faolla_attendance_correction_controls_v2", args: { p_site_id: siteId, p_auth_user_id: ownerId, p_command: policy, p_operation_id: null, p_before_revision: null, p_allow_write:false } }]);
  await assert.rejects(executeCorrectionControls(input, { rpc: async()=>({data:null,error:{message:"private sql"}}) }), /attendance_unavailable/);
  await assert.rejects(executeCorrectionControls(input, { rpc: async()=>({data:null,error:{message:"attendance_period_overlap"}}) }), /attendance_period_overlap/);
  await assert.rejects(executeCorrectionControls(input, { rpc: async()=>({data:m.response(null,null),error:null}) }), /attendance_unavailable/);
  await assert.rejects(executeCorrectionControls({ ...input, query:{...q,beforeRevision:1} }, { rpc:async()=>{throw Error("unreachable");} }), /attendance_invalid_request/);
});
