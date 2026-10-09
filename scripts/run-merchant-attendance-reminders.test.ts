import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getEventListeners } from "node:events";
import { executeReminderRunner, parseReminderRunnerArgs, reminderRunnerSummary, type ReminderRunnerInvocation } from "./run-merchant-attendance-reminders";
import { attendanceReminderSystemCommandFingerprint, type AttendanceReminderResult, type AttendanceReminderSystemRunQuery } from "../src/lib/merchantAttendanceReminders";
import type { AttendanceSelfRpc } from "../src/lib/merchantAttendanceSelf.server";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990201", at = "2026-10-08T14:00:00.000000Z";
const env = { FAOLLA_ATTENDANCE_REMINDERS_ENABLED: "1", FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: siteId,
  FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED: "1", FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS: siteId };
const query = (): AttendanceReminderSystemRunQuery => ({ siteId, mode: "run", operationId: id(1), cursor: null });
const input = (action: "once" | "recover" = "once"): ReminderRunnerInvocation => ({ action, originalRun: query() });
const args = (mode = "--once", cursor = "null") => [mode, "--site", siteId, "--operation", id(1), "--cursor", cursor];
function missing(): AttendanceReminderResult { return { protocol: "attendance-reminders-v1", siteId, actor: { kind: "system" }, readAt: at, data: { kind: "receipt" }, receipt: null }; }
async function saved(q = query()): Promise<AttendanceReminderResult> { return { ...missing(), receipt: {
  operationId: q.operationId, action: "run_due", actorKind: "system", actorId: null, commandFingerprint: await attendanceReminderSystemCommandFingerprint(q), recordedAt: at,
  result: { kind: "run", status: "completed", checkedCount: 1, deliveredCount: 1, stoppedCount: 0, deferredCount: 0, batchIds: [id(2)], nextCursor: null },
} }; }
function stub(reply: (args: Record<string, unknown>, n: number) => unknown | Promise<unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service: AttendanceSelfRpc = { rpc: async (name, a) => { calls.push({ name, args: a }); return { data: await reply(a, calls.length), error: null }; } };
  return { service, calls };
}

test("runner exact CLI requires stable original id and explicit exact cursor, no implicit enable or aliases", () => {
  assert.equal(parseReminderRunnerArgs([]), null); assert.deepEqual(parseReminderRunnerArgs(args()), input());
  assert.deepEqual(parseReminderRunnerArgs(args("--recover")), input("recover"));
  const cursor = { runOperationId: id(9), afterDueAt: at, afterPlanId: id(10), cutoffAt: at };
  assert.deepEqual(parseReminderRunnerArgs(args("--recover", JSON.stringify(cursor)))?.originalRun.cursor, cursor);
  for (const bad of [args().slice(0, 5), [...args(), "--loop"], ["--once", "--recover", ...args().slice(2)], args("--auto"), args("--once", "undefined"), args("--once", '{"runOperationId":"x","runOperationId":"y"}'), args("--once", '{"actorId":"system"}'), ["--once", "--site", "*", ...args().slice(3)], ["--once", "--site", siteId, "--operation", "new", "--cursor", "null"]]) {
    assert.throws(() => parseReminderRunnerArgs(bad));
  }
});
test("runner no-argument/import path has no env/client/cron/files side effects and output has no batch body", () => {
  const source = readFileSync(new URL("./run-merchant-attendance-reminders.ts", import.meta.url), "utf8"), main = source.slice(source.indexOf("export async function reminderRunnerMain"));
  assert.ok(main.indexOf("parseReminderRunnerArgs(argv)") < main.indexOf('await import("@next/env")'));
  assert.ok(main.indexOf("if (!input)") < main.indexOf('await import("@next/env")'));
  assert.match(main, /loadEnvConfig\(process\.cwd\(\), undefined, \{ info\(\) \{\}, error\(\) \{\} \}\)/);
  assert.doesNotMatch(source, /randomUUID|setInterval|setTimeout|writeFile|discoverMerchant|process\.env\.[A-Z_]+\s*=/);
  const output = JSON.stringify(reminderRunnerSummary(input(), { ...missing(), receipt: null }));
  assert.equal(output.includes("batchIds"), false); assert.equal(output.includes("commandFingerprint"), false); assert.equal(output.includes("receipt"), false);
});
test("runner one explicit run uses original recovery then only one literal system writer", async () => {
  const raw = await saved(), st = stub((_a, n) => n === 1 ? missing() : raw);
  assert.deepEqual(await executeReminderRunner(input(), { service: st.service, environment: () => env }), raw);
  assert.equal(st.calls.length, 2);
  assert(st.calls.every(c => c.name === "faolla_attendance_reminders_run_v1" && !Object.hasOwn(c.args, "p_auth_user_id") && !Object.hasOwn(c.args, "p_actor_kind")));
  assert.equal(st.calls[0].args.p_allow_run, false); assert.equal(st.calls[1].args.p_allow_run, true); assert.deepEqual(st.calls[1].args.p_query, query());
  assert.deepEqual(reminderRunnerSummary(input(), raw).counts, { checked: 1, delivered: 1, deferred: 0, stopped: 0 });
});
test("runner pause/malformed pause only recovers, never calls run even with enabled gates", async () => {
  for (const flag of ["1", "", "false"]) {
    const st = stub(() => missing()); const result = await executeReminderRunner(input(), { service: st.service, environment: () => ({ ...env, FAOLLA_BACKGROUND_JOBS_PAUSED: flag }) });
    assert.equal(result.receipt, null); assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_run, false);
    assert.equal((st.calls[0].args.p_query as { mode: string }).mode, "recover"); assert.equal(reminderRunnerSummary(input(), result).keepOriginalParameters, true);
  }
});
test("runner pause during original read prevents fresh admission without another RPC", async () => {
  let paused = false; const st = stub(() => { paused = true; return missing(); });
  await assert.rejects(executeReminderRunner(input(), { service: st.service, environment: () => ({ ...env, FAOLLA_BACKGROUND_JOBS_PAUSED: paused ? "1" : "0" }) }), { code: "attendance_reminder_disabled" });
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_run, false);
});
test("runner original recover remains available with all flags off and pause; cursor SHA mismatch never writes", async () => {
  const raw = await saved(), st = stub(() => raw);
  assert.deepEqual(await executeReminderRunner(input("recover"), { service: st.service, environment: () => ({ FAOLLA_BACKGROUND_JOBS_PAUSED: "1" }) }), raw);
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_run, false);
  assert.deepEqual(await executeReminderRunner(input("recover"), { service: st.service, environment: () => { assert.fail("explicit recovery never evaluates admission environment"); } }), raw);
  const changed: ReminderRunnerInvocation = { action: "recover", originalRun: { ...query(), cursor: { runOperationId: id(9), afterDueAt: at, afterPlanId: id(10), cutoffAt: at } } };
  await assert.rejects(executeReminderRunner(changed, { service: st.service, environment: () => ({}) }), { code: "attendance_reminder_invalid" });
  assert.equal(st.calls.length, 3); assert(st.calls.every(c => c.args.p_allow_run === false));
});
test("runner default-off/over-limit allowlists never write and unknown failure keeps exact original parameters", async () => {
  for (const environment of [{}, { ...env, FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS: "99990202" }, { ...env, FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: Array.from({ length: 65 }, (_, n) => String(99990201 + n)).join(",") }]) {
    const st = stub(() => missing()); await assert.rejects(executeReminderRunner(input(), { service: st.service, environment: () => environment }), { code: "attendance_reminder_disabled" });
    assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_allow_run, false);
  }
  const summary = reminderRunnerSummary(input(), null); assert.equal(summary.status, "unconfirmed"); assert.equal(summary.operationId, id(1)); assert.equal(summary.originalCursor, null); assert.equal(summary.keepOriginalParameters, true);
});
test("runner cancelled input/foreign actor/getter reject before any RPC and do not register permanent listeners", async () => {
  const controller = new AbortController(); controller.abort(); const st = stub(() => assert.fail("zero RPC"));
  await assert.rejects(executeReminderRunner(input(), { service: st.service, signal: controller.signal }));
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  let invoked = 0;
  for (const raw of [{ ...input(), actorId: id(99) }, { ...input(), originalRun: { ...query(), authUserId: id(99) } }, { action: "once", get originalRun() { invoked++; return query(); } }]) {
    await assert.rejects(executeReminderRunner(raw as ReminderRunnerInvocation, { service: st.service }));
  }
  assert.equal(invoked, 0); assert.equal(st.calls.length, 0);
});
test("runner input snapshots survive caller mutation and writer failure never loops or generates another id", async () => {
  const original = input(), raw = await saved(); let release!: (result: unknown) => void;
  const st = stub((_a, n) => n === 1 ? new Promise(resolve => { release = resolve; }) : raw);
  const pending = executeReminderRunner(original, { service: st.service, environment: () => env });
  Reflect.set(original.originalRun, "operationId", id(99));
  while (!release) await new Promise<void>(resolve => setImmediate(resolve)); release(missing());
  assert.deepEqual(await pending, raw); assert.deepEqual(st.calls[1].args.p_query, query());
  const failed = stub((_a, n) => { if (n === 1) return missing(); throw Error("private SQL details must not be logged"); });
  await assert.rejects(executeReminderRunner(input(), { service: failed.service, environment: () => env }), { code: "attendance_reminder_invalid" });
  assert.equal(failed.calls.length, 2); assert.deepEqual(failed.calls[1].args.p_query, query());
});
