import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { cycleSendModel, cycleSendModelId as id } from "../../scripts/fixtures/attendance-cycle-send-model";
import { cycleModel, cycleOwner } from "../../scripts/fixtures/attendance-cycle-intent-model";
import { cycleSendEnabled, executeCycleSend, executeCycleSendRecovery } from "./merchantAttendanceCycleSend.server";
import { cycleSendCommandFingerprint, cycleSendIntent, cycleSendPeriodQuery } from "./merchantAttendanceCycleSend";

function stub(fn: (name: string, args: Record<string, unknown>, n: number) => { data: unknown; error: { message: string } | null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return fn(name, args, calls.length); } };
  return { service, calls };
}
test("200 first send needs both explicit cycle and actual original writer rollout; all defaults stay off", () => {
  const site = "99990200", enabled = { FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED: "1", FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_SITE_IDS: site,
    FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS: site };
  assert.equal(cycleSendEnabled(site, "owner", {}), false); assert.equal(cycleSendEnabled(site, "owner", enabled), true);
  assert.equal(cycleSendEnabled(site, "delegate", enabled), false);
  assert.equal(cycleSendEnabled(site, "delegate", { ...enabled, FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES: site }), true);
  for (const key of Object.keys(enabled)) assert.equal(cycleSendEnabled(site, "owner", { ...enabled, [key]: "*" }), false, key);
});
test("200 exact saved first send recovers before today's flag, intent, source or capacity", async () => {
  const f = await cycleSendModel(), s = stub(() => ({ data: f.linked(), error: null }));
  const r = await executeCycleSend({ body: { frame: f.frame, command: f.command }, authUserId: f.actor, allowWrite: false }, s.service);
  assert.equal(r.data.kind, "linked"); assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].name, "faolla_attendance_operational_cycle_send_recover_v1");
  assert.deepEqual(s.calls[0].args, { p_query: cycleSendPeriodQuery(f.frame, "recover", f.command.operationId), p_auth_user_id: f.actor,
    p_intent: cycleSendIntent(f.frame), p_expected_fingerprint: f.fingerprint });
  assert(!Object.hasOwn(s.calls[0].args, "p_command")); assert(!Object.hasOwn(s.calls[0].args, "p_allow_write"));
});
test("200 unseen original id remains unknown on GET; paused fresh POST stops after that one read", async () => {
  const f = await cycleSendModel(), s = stub(() => ({ data: f.unknown(), error: null }));
  const query = { ...f.frame, mode: "recover" as const, operationId: f.command.operationId, commandFingerprint: f.fingerprint };
  const r = await executeCycleSendRecovery({ query, authUserId: f.actor }, s.service); assert.equal(r.receipt, null);
  await assert.rejects(executeCycleSend({ body: { frame: f.frame, command: f.command }, authUserId: f.actor, allowWrite: false }, s.service), /attendance_operational_cycle_disabled/);
  assert.equal(s.calls.length, 2); assert(s.calls.every(c => c.name.endsWith("send_recover_v1")));
});
test("200 a conflicting/corrupt original receipt or SQL failure never falls through to source or a write", async () => {
  const f = await cycleSendModel();
  for (const code of ["attendance_access_denied", "attendance_operation_conflict", "attendance_period_storage_limit", "postgres://secret@example.invalid"]) {
    const s = stub(() => ({ data: null, error: { message: code } }));
    await assert.rejects(executeCycleSend({ body: { frame: f.frame, command: f.command }, authUserId: f.actor, allowWrite: true }, s.service), new RegExp(code.startsWith("postgres") ? "attendance_operational_cycle_invalid" : code));
    assert.equal(s.calls.length, 1);
  }
  const r = f.linked(), s = stub(() => ({ data: { ...r, receipt: { ...r.receipt, commandFingerprint: "c".repeat(64) } }, error: null }));
  await assert.rejects(executeCycleSend({ body: { frame: f.frame, command: f.command }, authUserId: f.actor, allowWrite: true }, s.service)); assert.equal(s.calls.length, 1);
});
test("200 valid local digest does not manufacture an intent; actual current head is checked before period collection", async () => {
  const send = await cycleSendModel(), intent = await cycleModel(), frame = { ...send.frame, intentId: intent.intent.intentId,
    expectedIntentFingerprint: intent.intent.intentFingerprint }, fingerprint = await cycleSendCommandFingerprint(frame, send.command, cycleOwner);
  const cancelled = { ...intent.receipt, operationId: id(70), action: "cancel", revision: 2, commandFingerprint: "c".repeat(64) };
  const s = stub((_name, args, n) => {
    assert.equal(args.p_auth_user_id, cycleOwner);
    if (n === 1) { assert.equal(args.p_expected_fingerprint, fingerprint); return { data: { ...send.unknown(), actorId: cycleOwner }, error: null }; }
    assert.equal(n, 2); return { data: intent.result({ kind: "detail", intent: intent.intent, head: cancelled }), error: null };
  });
  await assert.rejects(executeCycleSend({ body: { frame, command: send.command }, authUserId: cycleOwner, allowWrite: true }, s.service), /attendance_operational_cycle_changed/);
  assert.equal(s.calls.length, 2); assert(s.calls.every(c => !c.name.includes("period_closure_source") && !c.name.endsWith("cycle_send_v1")));
});

test("200 cancellation at any fresh pre-read stops the next RPC and cannot start a late writer", async () => {
  const send = await cycleSendModel(), intent = await cycleModel();
  const frame = { ...send.frame, intentId: intent.intent.intentId, expectedIntentFingerprint: intent.intent.intentFingerprint };
  const values = [{ ...send.unknown(), actorId: cycleOwner }, intent.result({ kind: "detail", intent: intent.intent, head: intent.receipt }), {}];
  for (const stopAt of [1, 2, 3]) {
    const controller = new AbortController(), names: string[] = []; let enter!: () => void, release!: (value: unknown) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const service: AttendanceSelfRpc = { rpc: async name => {
      names.push(name); const n = names.length;
      const data = n === stopAt ? await new Promise<unknown>(resolve => { release = resolve; enter(); }) : values[n - 1];
      return { data, error: null };
    } };
    const running = executeCycleSend({ body: { frame, command: send.command }, authUserId: cycleOwner, allowWrite: true }, service, controller.signal);
    const rejected = assert.rejects(running, /attendance_operational_cycle_invalid/);
    await entered; controller.abort(); release(values[stopAt - 1]); await rejected;
    assert.equal(names.length, stopAt); assert(!names.includes("faolla_attendance_operational_cycle_send_v1"));
  }
  const controller = new AbortController(); controller.abort(); const s = stub(() => { assert.fail("already-aborted request must dispatch nothing"); });
  await assert.rejects(executeCycleSend({ body: { frame, command: send.command }, authUserId: cycleOwner, allowWrite: true }, s.service, controller.signal));
  assert.equal(s.calls.length, 0);
});
