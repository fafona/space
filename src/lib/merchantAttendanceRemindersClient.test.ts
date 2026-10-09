//Actual client with memory storage and synthetic HTTP, not real Auth/SQL/browser.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceRemindersClient, attendanceReminderPendingKey, remindersAuthCurrent,
  type ReminderPending, type ReminderStorage, type RemindersClientOptions } from "./merchantAttendanceRemindersClient";
import { ATTENDANCE_REMINDERS_PROTOCOL, attendanceReminderCommandFingerprint, type AttendanceReminderQuery,
  type AttendanceReminderCommand, type AttendanceReminderBody, type AttendanceReminderResult } from "./merchantAttendanceReminders";
import { ATTENDANCE_REMINDERS_API, parseAttendanceReminderHttpQuery } from "./merchantAttendanceRemindersHttp";
const id = (n: number) => `20100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990201", actorId = id(1), stamp = "2026-10-08T14:05:00.000000Z";
const list: Extract<AttendanceReminderQuery, { mode: "list" }> = { siteId, mode: "list", batchId: null, operationId: null, cursor: null };
const query: AttendanceReminderBody["query"] = { siteId, mode: "detail", batchId: id(2), operationId: null, cursor: null };
const command: AttendanceReminderCommand = { action: "mark_read", operationId: id(3), batchId: id(2) };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function result(pending: ReminderPending | null): AttendanceReminderResult {
  return { protocol: ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: { kind: "auth", authUserId: actorId }, readAt: stamp,
    data: pending ? { kind: "receipt" } : { kind: "list", items: [], nextCursor: null },
    receipt: pending ? { operationId: pending.command.operationId, action: pending.command.action, actorKind: "auth", actorId,
      commandFingerprint: pending.commandFingerprint, recordedAt: stamp,
      result: pending.command.action === "mark_read" ? { kind: "mark_read", batchId: pending.command.batchId, readAt: stamp }
        : { kind: "run", status: "completed", checkedCount: 0, deliveredCount: 0, deferredCount: 0, stoppedCount: 0, batchIds: [], nextCursor: null } } : null };
}
type Call = { url: string; init?: RequestInit; pending: ReminderPending | null };
function fixture(extra: { response?: (call: Call) => Response | Promise<Response>; current?: () => boolean; write?: () => boolean;
  timeoutMs?: number; storage?: ReminderStorage; observer?: RemindersClientOptions["onState"] } = {}) {
  const values = new Map<string, string>(), calls: Call[] = [], removes: string[] = [];
  const storage: ReminderStorage = extra.storage ?? { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); },
    removeItem: k => { removes.push(k); values.delete(k); } };
  const options: RemindersClientOptions = { siteId, actorId, storage: () => storage, isCurrentAuth: extra.current ?? (() => true), canWrite: extra.write ?? (() => true),
    timeoutMs: extra.timeoutMs, onState: extra.observer, apiFetch: async (url, init) => {
      const raw = storage.getItem(attendanceReminderPendingKey(siteId, actorId)); const pending = raw === null ? null : JSON.parse(raw) as ReminderPending;
      const call = { url: String(url), init, pending }; calls.push(call); return extra.response ? extra.response(call) : reply({ ok: true, data: result(pending) }); } };
  const client = new AttendanceRemindersClient(options); return { client, options, storage, values, calls, removes };
}
async function seed(f: ReturnType<typeof fixture>) {
  const pending: ReminderPending = { protocol: ATTENDANCE_REMINDERS_PROTOCOL, format: 1, actorId, query, command,
    commandFingerprint: await attendanceReminderCommandFingerprint(query, actorId, command) };
  const raw = JSON.stringify(pending); f.values.set(f.client.storageKey, raw); return { raw, pending };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }

test("201 reminder client constructor/local load use zero HTTP, exact actor slot, failclosed omitted Auth", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); await f.client.load(); assert.equal(f.calls.length, 0); assert.equal(f.client.hasLeaveRisk(), false);
  const closed = new AttendanceRemindersClient({ ...f.options, isCurrentAuth: undefined }); await assert.rejects(closed.read(list)); assert.equal(f.calls.length, 0);
  assert.equal(remindersAuthCurrent(), false); assert.equal(remindersAuthCurrent(() => { throw Error(); }), false);
  assert.throws(() => attendanceReminderPendingKey("bad", actorId)); assert.throws(() => attendanceReminderPendingKey(siteId, "system"));
});
test("201 replayable effect cleanup can pause then load the same memoized client without HTTP or losing raw", async () => {
  const f = fixture(); await f.client.load(); f.client.pause(); await f.client.load(); assert.equal(f.calls.length, 0);
  await f.client.read(list); assert.equal(f.calls.length, 1); f.client.pause(); assert.equal(f.client.getSnapshot().result, null);
  const { raw } = await seed(f); await f.client.load(); f.client.pause(); await f.client.load();
  assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.calls.length, 1);
  await f.client.recover(); assert.equal(f.calls.length, 2); assert.equal(f.values.has(f.client.storageKey), false);
});
test("201 POST persists full non-secret command/SHA first, never clears; explicit original GET clears with full match", async () => {
  const f = fixture(); await f.client.submit(query, command); const raw = f.values.get(f.client.storageKey)!;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init?.method, "POST"); assert.equal(f.calls[0].url, ATTENDANCE_REMINDERS_API);
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { query, command }); assert.ok(f.calls[0].pending?.commandFingerprint);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.removes.length, 0); assert.equal(f.client.hasLeaveRisk(), true);
  await assert.rejects(f.client.read(list)); await assert.rejects(f.client.submit(query, command)); assert.equal(f.calls.length, 1);
  await f.client.recover(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].init?.method, "GET");
  const get = parseAttendanceReminderHttpQuery("https://local.invalid" + f.calls[1].url); assert.deepEqual(get.expectedCommand, command); assert.equal(get.query.operationId, command.operationId);
  assert.equal(f.removes.length, 1); assert.equal(f.values.has(f.client.storageKey), false); assert.ok(raw.includes(command.operationId));
});
test("201 null original GET, wrong actor/SHA/action, 503 and unreadable results preserve exact original bytes", async () => {
  for (const kind of ["null", "actor", "sha", "action", "503", "duplicate", "extra"] as const) {
    const f = fixture({ response: call => {
      const data = { ...result(call.pending) };
      if (kind === "null") data.receipt = null;
      if (kind === "actor") return reply({ ok: true, data: { ...data, actor: { kind: "auth", authUserId: id(99) } } });
      if (kind === "sha") return reply({ ok: true, data: { ...data, receipt: { ...data.receipt, commandFingerprint: "f".repeat(64) } } });
      if (kind === "action") return reply({ ok: true, data: { ...data, receipt: { ...data.receipt, action: "run_due" } } });
      if (kind === "503") return reply({ ok: false, error: { code: "attendance_reminder_invalid", message: "暂时无法核实提醒结果，请保留原操作编号再核对。" } }, 503);
      if (kind === "duplicate") return new Response('{"ok":true,"ok":true,"data":{}}', { headers: { "content-type": "application/json" } });
      return reply({ ok: true, data, ...(kind === "extra" ? { moduleEnabled: true } : {}) });
    } }); const { raw } = await seed(f); await assert.rejects(f.client.recover());
    assert.equal(f.values.get(f.client.storageKey), raw, kind); assert.equal(f.removes.length, 0); assert.equal(f.calls.length, 1); f.client.dispose();
  }
});
test("201 corrupt/unknown/foreign pending slots block load/write/recover without HTTP or replacement", async () => {
  for (const kind of ["corrupt", "format", "actor", "site", "extra", "sha"]) {
    const f = fixture(), { pending } = await seed(f); let raw = "{";
    if (kind !== "corrupt") raw = JSON.stringify({ ...pending, ...(kind === "format" ? { format: 2 } : kind === "actor" ? { actorId: id(99) }
      : kind === "site" ? { query: { ...query, siteId: "99990202" } } : kind === "extra" ? { ignored: true } : { commandFingerprint: "a".repeat(64) }) });
    f.values.set(f.client.storageKey, raw); await assert.rejects(f.client.load()); await assert.rejects(f.client.recover()); await assert.rejects(f.client.submit(query, command));
    assert.equal(f.calls.length, 0); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.removes.length, 0);
  }
});
test("201 explicit read has no automatic followup; caller mutation cannot alter saved command", async () => {
  const f = fixture(); const read = await f.client.read(list); assert.equal(read.data.kind, "list"); assert.equal(f.calls.length, 1);
  const inputQuery = { ...query }, inputCommand = { ...command }; const pending = f.client.submit(inputQuery, inputCommand);
  inputQuery.batchId = id(77); inputCommand.batchId = id(77); await pending;
  assert.deepEqual(f.calls[1].pending?.command, command); assert.deepEqual(f.calls[1].pending?.query, query);
});
test("201 flagoff prohibits new writes but allows original GET, including owner manual run cursor", async () => {
  let write = true; const f = fixture({ write: () => write }); const check = { ...list, mode: "check" as const, cursor: null };
  await f.client.submit(check, { action: "run_due", operationId: id(5), cursor: null }); write = false;
  await f.client.recover(); assert.equal(f.calls.length, 2); await assert.rejects(f.client.submit(query, command)); assert.equal(f.calls.length, 2);
  const omitted = new AttendanceRemindersClient({ ...f.options, canWrite: undefined }); await assert.rejects(omitted.submit(query, command)); assert.equal(f.calls.length, 2);
});
test("201 pause/Auth loss and late POST keep raw while clearing body; no automatic retries", { timeout: 1000 }, async () => {
  let current = true; const late = deferred<Response>(), entered = deferred<void>(), f = fixture({ current: () => current, response: () => { entered.resolve(); return late.promise; } });
  const work = f.client.submit(query, command), rejected = assert.rejects(work); await entered.promise; const raw = f.values.get(f.client.storageKey);
  assert.ok(raw); current = false; f.client.pause(); await rejected; late.resolve(reply({ ok: true, data: result(JSON.parse(raw)) }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.values.get(f.client.storageKey), raw); assert.equal(f.calls.length, 1);
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.removes.length, 0);
});
test("201 storage byte CAS refuses replacement made while matching GET is pending", { timeout: 1000 }, async () => {
  const late = deferred<Response>(), entered = deferred<void>(), f = fixture({ response: () => { entered.resolve(); return late.promise; } }), { raw, pending } = await seed(f);
  const work = f.client.recover(); await entered.promise; f.values.set(f.client.storageKey, raw + " ");
  late.resolve(reply({ ok: true, data: result(pending) })); await assert.rejects(work); assert.equal(f.values.get(f.client.storageKey), raw + " "); assert.equal(f.removes.length, 0);
});
test("201 12s inclusive deadline also cancels blocked response streams; MIME/redirect/UTF8/size failclosed", async () => {
  let cancelled = false;
  const f = fixture({ timeoutMs: 8, response: () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
  const { raw } = await seed(f); await assert.rejects(f.client.recover()); assert.equal(cancelled, true); assert.equal(f.values.get(f.client.storageKey), raw);
  for (const response of [new Response("{}", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }), reply({ ok: false, error: { code: "sql_error", message: "private body" } }, 503)]) {
    const g = fixture({ response: () => response }), original = await seed(g); await assert.rejects(g.client.recover()); assert.equal(g.values.get(g.client.storageKey), original.raw);
    assert.ok(!g.client.getSnapshot().message.includes("private body"));
  }
});
test("201 storage exceptions and observer pause prevent dispatch/clearing without losing the raw slot", async () => {
  const f = fixture({ storage: { getItem: () => { throw Error("denied"); }, setItem: () => {}, removeItem: () => {} } });
  assert.equal(f.client.hasLeaveRisk(), true); await assert.rejects(f.client.submit(query, command)); assert.equal(f.calls.length, 0);
  const g = fixture({ observer: state => { if (state.phase === "saving") g.client.pause(); } });
  await assert.rejects(g.client.submit(query, command)); assert.equal(g.calls.length, 0); assert.ok(g.values.get(g.client.storageKey));
});
