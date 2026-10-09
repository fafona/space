import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import * as p from "./merchantAttendanceReminders";
import * as s from "./merchantAttendanceReminders.server";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990201", authUserId = id(1), at = "2026-10-08T13:00:00.000001Z", readAt = "2026-10-08T14:00:00.000000Z";
const enabled = { FAOLLA_ATTENDANCE_REMINDERS_ENABLED: "1", FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: siteId };
const systemEnabled = { ...enabled, FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED: "1", FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS: siteId };
const q = (mode: "list" | "detail" | "recover" | "check" = "list"): p.AttendanceReminderQuery => mode === "detail"
  ? { siteId, mode, batchId: id(2), operationId: null, cursor: null } : mode === "recover" ? { siteId, mode, batchId: null, operationId: id(3), cursor: null }
    : { siteId, mode, batchId: null, operationId: null, cursor: null };
const mark = (): p.AttendanceReminderCommand => ({ action: "mark_read", operationId: id(3), batchId: id(2) });
const run = (): p.AttendanceReminderCommand => ({ action: "run_due", operationId: id(3), cursor: null });
const systemQuery = (): p.AttendanceReminderSystemRunQuery => ({ siteId, mode: "run", operationId: id(3), cursor: null });
const recoverQuery = (): Extract<p.AttendanceReminderQuery, { mode: "recover" }> => ({ siteId, mode: "recover", batchId: null, operationId: id(3), cursor: null });
const systemRecover = (): Extract<p.AttendanceReminderSystemQuery, { mode: "recover" }> => ({ siteId, mode: "recover", operationId: id(3), cursor: null });
function result(data: p.AttendanceReminderData = { kind: "receipt" }, receipt: p.AttendanceReminderReceipt | null = null, system = false): p.AttendanceReminderResult {
  return { protocol: p.ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: system ? { kind: "system" } : { kind: "auth", authUserId }, readAt, data, receipt };
}
async function saved(command = mark(), system = false): Promise<p.AttendanceReminderResult> {
  const commandFingerprint = system ? await p.attendanceReminderSystemCommandFingerprint(systemQuery()) : await p.attendanceReminderCommandFingerprint(q(command.action === "mark_read" ? "detail" : "check"), authUserId, command);
  return result({ kind: "receipt" }, { operationId: command.operationId, action: command.action, actorKind: system ? "system" : "auth", actorId: system ? null : authUserId,
    commandFingerprint, recordedAt: at, result: command.action === "mark_read" ? { kind: "mark_read", batchId: command.batchId, readAt: at }
      : { kind: "run", status: "completed", checkedCount: 1, deliveredCount: 1, deferredCount: 0, stoppedCount: 0, batchIds: [id(2)], nextCursor: null } }, system);
}
type Response = Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
function stub(fn: (name: string, args: Record<string, unknown>, ordinal: number) => Response | Promise<Response>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return fn(name, args, calls.length); } };
  return { calls, service };
}
const ok = (data: unknown): Response => ({ data, error: null });
const authInput = (command: p.AttendanceReminderCommand | null = null): s.AttendanceReminderServiceInput => ({ query: q(command?.action === "mark_read" ? "detail" : command ? "check" : "list"), command, authUserId, allowWrite: true });

test("201 adapter gates are default-off exact <=64-site common/runner intersections", () => {
  assert.equal(s.attendanceRemindersSiteEnabled(siteId, {}), false); assert.equal(s.attendanceRemindersSiteEnabled(siteId, enabled), true);
  assert.equal(s.attendanceRemindersRunnerSiteEnabled(siteId, enabled), false); assert.equal(s.attendanceRemindersRunnerSiteEnabled(siteId, systemEnabled), true);
  for (const bad of ["*", siteId + " ", " " + siteId, siteId + ",", siteId + "," + siteId, siteId + "\n"]) assert.equal(s.attendanceRemindersSiteEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: bad }), false);
  const ids = Array.from({ length: 64 }, (_, i) => String(99990201 + i)); assert.equal(s.attendanceRemindersSiteEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: ids.join(",") }), true);
  assert.equal(s.attendanceRemindersSiteEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: [...ids, "99990300"].join(",") }), false);
  assert.equal(s.attendanceRemindersRunnerSiteEnabled(siteId, { ...systemEnabled, FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: "99990202" }), false);
  assert.equal(s.attendanceRemindersRunnerSiteEnabled(siteId, { ...systemEnabled, FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS: "99990202" }), false);
  for (const key of Object.keys(systemEnabled)) assert.equal(s.attendanceRemindersRunnerSiteEnabled(siteId, { ...systemEnabled, [key]: "*" }), false);
});
test("201 Auth read is one actual-Auth RPC, always false/null, with no new-write rollout evaluation", async () => {
  const raw = result({ kind: "list", items: [], nextCursor: null }), st = stub(() => ok(raw));
  const service = s.createAttendanceRemindersService(st.service, { environment: () => { assert.fail("read does not evaluate new-write rollout"); } });
  assert.deepEqual(await service.execute(authInput()), raw);
  assert.deepEqual(st.calls, [{ name: s.ATTENDANCE_REMINDERS_RPC, args: { p_query: q(), p_auth_user_id: authUserId, p_command: null, p_allow_write: false } }]);
  const check = stub(() => ok(result())); await s.createAttendanceRemindersService(check.service).execute({ ...authInput(), query: q("check") }); assert.equal(check.calls.length, 1);
});
test("201 Auth original-actor recovery validates full original command SHA, missing stays unknown", async () => {
  const raw = await saved(), st = stub(() => ok(raw)), service = s.createAttendanceRemindersService(st.service, { environment: () => { assert.fail("recovery before rollout"); } });
  assert.deepEqual(await service.recover({ query: recoverQuery(), expectedCommand: mark(), authUserId }), raw);
  assert.deepEqual(st.calls[0].args, { p_query: recoverQuery(), p_auth_user_id: authUserId, p_command: null, p_allow_write: false });
  const missing = stub(() => ok(result())); assert.equal((await s.createAttendanceRemindersService(missing.service).recover({ query: recoverQuery(), expectedCommand: mark(), authUserId })).receipt, null);
  await assert.rejects(service.recover({ query: recoverQuery(), expectedCommand: { ...mark(), batchId: id(99) } as p.AttendanceReminderCommand, authUserId }), { code: "attendance_reminder_invalid" });
  await assert.rejects(service.execute({ ...authInput(), query: recoverQuery() }), { code: "attendance_invalid_request" });
});
test("201 saved Auth POST returns before flag/entitlement/current authority and never writes again", async () => {
  for (const command of [mark(), run()]) {
    const raw = await saved(command), st = stub(() => ok(raw)), service = s.createAttendanceRemindersService(st.service, { environment: () => { assert.fail("saved original precedes rollout"); } });
    assert.deepEqual(await service.execute({ ...authInput(command), allowWrite: false }), raw); assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_command, null);
    assert.equal((st.calls[0].args.p_query as p.AttendanceReminderQuery).mode, "recover");
  }
});
test("201 unknown Auth POST with rollout/entitlement off stops after read and creates no disabled receipt", async () => {
  for (const [allowWrite, environment] of [[false, enabled], [true, {}]] as const) {
    for (const command of [mark(), run()]) {
      const st = stub(() => ok(result())); await assert.rejects(s.createAttendanceRemindersService(st.service, { environment: () => environment }).execute({ ...authInput(command), allowWrite }), { code: "attendance_reminder_disabled" });
      assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_write, false); assert.equal(st.calls[0].args.p_command, null);
    }
  }
});
test("201 allowed fresh Auth mark/check dispatches one SQL-owned writer after exact recovery", async () => {
  for (const command of [mark(), run()]) {
    const raw = await saved(command), st = stub((_name, _args, n) => ok(n === 1 ? result() : raw));
    assert.deepEqual(await s.createAttendanceRemindersService(st.service, { environment: () => enabled }).execute(authInput(command)), raw);
    assert.equal(st.calls.length, 2); assert.equal(st.calls[1].name, s.ATTENDANCE_REMINDERS_RPC);
    assert.deepEqual(st.calls[1].args, { p_query: authInput(command).query, p_auth_user_id: authUserId, p_command: command, p_allow_write: true });
    assert(!Object.hasOwn(st.calls[1].args, "p_actor_kind"));
  }
});
test("201 rollout is sampled after original recovery, not a stale admission before wait", async () => {
  let environment: Readonly<Record<string, string>> = enabled; const st = stub(() => { environment = {}; return ok(result()); });
  await assert.rejects(s.createAttendanceRemindersService(st.service, { environment: () => environment }).execute(authInput(run())), { code: "attendance_reminder_disabled" }); assert.equal(st.calls.length, 1);
});
test("201 conflict/corrupt saved receipt never falls through to fresh RPC or exposes SQL text", async () => {
  const raw = await saved();
  const corrupted = { ...raw, receipt: { ...raw.receipt!, commandFingerprint: "a".repeat(64) } }, st = stub(() => ok(corrupted));
  await assert.rejects(s.createAttendanceRemindersService(st.service, { environment: () => enabled }).execute(authInput(mark())), { code: "attendance_reminder_invalid" }); assert.equal(st.calls.length, 1);
  for (const code of [...Object.keys(s.ATTENDANCE_REMINDER_ERRORS), "postgres://private@secret.invalid", "attendance_employee_invalid"]) {
    const fail = stub(() => ({ data: null, error: { message: code } }));
    await assert.rejects(s.createAttendanceRemindersService(fail.service, { environment: () => enabled }).execute(authInput(mark())), { code: Object.hasOwn(s.ATTENDANCE_REMINDER_ERRORS, code) ? code : "attendance_reminder_invalid" });
    assert.equal(fail.calls.length, 1);
  }
});
test("201 disabled result is accepted only after an explicitly allowed fresh run reaches SQL activation", async () => {
  const raw = await saved(run()); const disabled: p.AttendanceReminderRunResult = { kind: "run", status: "disabled", checkedCount: 0, deliveredCount: 0, deferredCount: 0, stoppedCount: 0, batchIds: [], nextCursor: null };
  const value = { ...raw, receipt: { ...raw.receipt!, result: disabled } }, st = stub((_name, _args, n) => ok(n === 1 ? result() : value));
  assert.deepEqual(await s.createAttendanceRemindersService(st.service, { environment: () => enabled }).execute(authInput(run())), value); assert.equal(st.calls[1].args.p_allow_write, true);
});
test("201 Auth context/body rejects actor/system injection, nonboolean authority and inherited/getter input before RPC", async () => {
  let invoked = 0; const st = stub(() => { assert.fail("invalid input never dispatches"); }), service = s.createAttendanceRemindersService(st.service);
  const bad: unknown[] = [{ ...authInput(), actorKind: "system" }, { ...authInput(), authUserId: "system" }, { ...authInput(), allowWrite: 1 },
    { ...authInput(), query: systemQuery() }, { ...authInput(run()), command: { ...run(), actorKind: "system" } }, Object.create(authInput()),
    { ...authInput(), get query() { invoked++; return q(); } }];
  for (const input of bad) await assert.rejects(service.execute(input as s.AttendanceReminderServiceInput), { code: "attendance_invalid_request" });
  assert.equal(invoked, 0); assert.equal(st.calls.length, 0);
});
test("201 system original run recovers while off, literal system RPC has no Auth/actor parameter", async () => {
  const raw = await saved(run(), true), st = stub(() => ok(raw)), runner = s.createAttendanceReminderSystemRunner(st.service, { environment: () => { assert.fail("saved system original before flags"); } });
  assert.deepEqual(await runner.run(systemQuery()), raw); assert.deepEqual(st.calls, [{ name: s.ATTENDANCE_REMINDERS_RUN_RPC, args: { p_query: systemRecover(), p_allow_run: false } }]);
  assert.deepEqual(await runner.recover(systemRecover(), systemQuery()), raw); assert.equal(st.calls.length, 2);
});
test("201 default-off or mismatched system gates stop at original read with no fresh SQL call", async () => {
  for (const environment of [{}, enabled, { ...systemEnabled, FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS: "99990202" }]) {
    const st = stub(() => ok(result({ kind: "receipt" }, null, true))); await assert.rejects(s.createAttendanceReminderSystemRunner(st.service, { environment: () => environment }).run(systemQuery()), { code: "attendance_reminder_disabled" });
    assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_run, false);
  }
});
test("201 allowed system run uses only two bounded same-site calls and system-domain saved SHA", async () => {
  const raw = await saved(run(), true), st = stub((_name, _args, n) => ok(n === 1 ? result({ kind: "receipt" }, null, true) : raw));
  assert.deepEqual(await s.createAttendanceReminderSystemRunner(st.service, { environment: () => systemEnabled }).run(systemQuery()), raw);
  assert.equal(st.calls.length, 2); assert.deepEqual(st.calls[1], { name: s.ATTENDANCE_REMINDERS_RUN_RPC, args: { p_query: systemQuery(), p_allow_run: true } });
  const auth = await saved(run()), bad = stub(() => ok(auth)); await assert.rejects(s.createAttendanceReminderSystemRunner(bad.service).run(systemQuery()), { code: "attendance_reminder_invalid" }); assert.equal(bad.calls.length, 1);
});
test("201 system explicit recovery binds original run/site/cursor/full SHA and keeps missing receipt null", async () => {
  const raw = await saved(run(), true), st = stub(() => ok(raw)), runner = s.createAttendanceReminderSystemRunner(st.service);
  await assert.rejects(runner.recover(systemRecover(), { ...systemQuery(), siteId: "99990202" }), { code: "attendance_invalid_request" }); assert.equal(st.calls.length, 0);
  await assert.rejects(runner.recover(systemRecover(), { ...systemQuery(), cursor: { runOperationId: id(8), afterDueAt: at, afterPlanId: id(9), cutoffAt: at } }), { code: "attendance_reminder_invalid" }); assert.equal(st.calls.length, 1);
  const missing = stub(() => ok(result({ kind: "receipt" }, null, true))); assert.equal((await s.createAttendanceReminderSystemRunner(missing.service).recover(systemRecover(), systemQuery())).receipt, null);
  const extras = { ...systemQuery(), authUserId }; await assert.rejects(runner.run(extras), { code: "attendance_invalid_request" });
});
test("201 already-cancelled Auth/system requests dispatch zero RPCs and remove cancellation listeners", async () => {
  const controller = new AbortController(); controller.abort(); const st = stub(() => { assert.fail("cancelled request cannot dispatch"); });
  await assert.rejects(s.createAttendanceRemindersService(st.service, { signal: controller.signal }).execute(authInput(mark())), { code: "attendance_reminder_invalid" });
  await assert.rejects(s.createAttendanceReminderSystemRunner(st.service, { signal: controller.signal }).run(systemQuery()), { code: "attendance_reminder_invalid" });
  assert.equal(st.calls.length, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("201 cancellation during original read settles failclosed immediately and late read cannot start a writer", async () => {
  const controller = new AbortController(); let enter!: () => void, release!: (value: Response) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const st = stub(() => new Promise<Response>(resolve => { release = resolve; enter(); }));
  const promise = s.createAttendanceRemindersService(st.service, { signal: controller.signal, environment: () => enabled }).execute(authInput(mark()));
  const rejected = assert.rejects(promise, { code: "attendance_reminder_invalid" }); await entered; controller.abort(); await rejected;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0); release(ok(result())); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(st.calls.length, 1);
});
test("201 cancellation after writer dispatch is unknown, not rollback or automatic retry", async () => {
  const controller = new AbortController(); let enter!: () => void, release!: (value: Response) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const raw = await saved();
  const st = stub((_name, _args, n) => n === 1 ? ok(result()) : new Promise<Response>(resolve => { release = resolve; enter(); }));
  const promise = s.createAttendanceRemindersService(st.service, { signal: controller.signal, environment: () => enabled }).execute(authInput(mark()));
  const rejected = assert.rejects(promise, { code: "attendance_reminder_invalid" }); await entered; controller.abort(); await rejected;
  assert.equal(st.calls.length, 2); assert.equal(st.calls[1].args.p_allow_write, true); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  release(ok(raw)); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(st.calls.length, 2);
});
test("201 one monotonic deadline includes recovery wait, backward/nonfinite clock cannot extend it", async () => {
  for (const value of [s.ATTENDANCE_REMINDER_TIMEOUT_MS, -1, Number.NaN]) {
    let now = 0; const st = stub(() => { now = value; return ok(result()); });
    await assert.rejects(s.createAttendanceRemindersService(st.service, { now: () => now, environment: () => enabled }).execute(authInput(mark())), { code: "attendance_reminder_invalid" }); assert.equal(st.calls.length, 1);
  }
  const st = stub(() => { assert.fail("invalid initial clock cannot dispatch"); });
  await assert.rejects(s.createAttendanceReminderSystemRunner(st.service, { now: () => Infinity }).run(systemQuery()), { code: "attendance_reminder_invalid" }); assert.equal(st.calls.length, 0);
});
test("201 successful/failed calls clean abort listener and malformed RPC descriptors are never invoked", async () => {
  const controller = new AbortController(), good = stub(() => ok(result({ kind: "list", items: [], nextCursor: null })));
  await s.createAttendanceRemindersService(good.service, { signal: controller.signal }).execute(authInput()); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  let invoked = 0; const bad: AttendanceSelfRpc = { rpc: async () => ({ get data() { invoked++; return {}; }, error: null }) };
  await assert.rejects(s.createAttendanceRemindersService(bad, { signal: controller.signal }).execute(authInput()), { code: "attendance_reminder_invalid" });
  assert.equal(invoked, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(s.createAttendanceRemindersService(null).execute(authInput()), { code: "attendance_reminder_invalid" });
});
test("201 Auth/system inputs are snapshotted before the adapter's first asynchronous boundary", async () => {
  const raw = await saved(), input = authInput(mark()); let release!: (value: Response) => void;
  const st = stub((_name, _args, n) => n === 1 ? new Promise<Response>(resolve => { release = resolve; }) : ok(raw));
  const pending = s.createAttendanceRemindersService(st.service, { environment: () => enabled }).execute(input);
  (input as { authUserId: string }).authUserId = id(99); (input.command as { batchId: string }).batchId = id(99);
  release(ok(result())); assert.deepEqual(await pending, raw); assert.equal(st.calls[1].args.p_auth_user_id, authUserId); assert.deepEqual(st.calls[1].args.p_command, mark());
  const sysRaw = await saved(run(), true), sysInput = systemQuery(); let sysRelease!: (value: Response) => void;
  const sys = stub((_name, _args, n) => n === 1 ? new Promise<Response>(resolve => { sysRelease = resolve; }) : ok(sysRaw));
  const sysPending = s.createAttendanceReminderSystemRunner(sys.service, { environment: () => systemEnabled }).run(sysInput);
  (sysInput as { siteId: string }).siteId = "99990202"; (sysInput as { operationId: string }).operationId = id(99);
  sysRelease(ok(result({ kind: "receipt" }, null, true))); assert.deepEqual(await sysPending, sysRaw); assert.deepEqual(sys.calls[1].args.p_query, systemQuery());
});
