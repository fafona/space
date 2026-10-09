import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleBody, parseScheduleQuery, parseScheduleResult, resolveScheduleWallSlots, scheduleQueryString, type ScheduleQuery, type ScheduleResult } from "./merchantAttendanceSchedule";
import { executeAttendanceSchedule } from "./merchantAttendanceSchedule.server";
import { AttendanceScheduleClient } from "./merchantAttendanceScheduleClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q: ScheduleQuery = { siteId: "99990001", access: "owner", workerId: id(201), fromDate: "2026-10-01", throughDate: "2026-10-31", operationId: null };
const cmd = { operationId: id(401), expectedRevision: 0, expectedSettingsVersion: 1, reason: "排班测试", action: "publish" as const, locationId: id(301), timeZone: "Europe/Madrid",
  slots: [["2026-10-02T07:00:00.000Z", "2026-10-02T15:00:00.000Z"]] as [string, string][] };
const result = (): ScheduleResult => ({ siteId: q.siteId, access: "owner", fromDate: q.fromDate, throughDate: q.throughDate, revision: 0, settingsVersion: 1, timeZone: "Europe/Madrid",
  worker: { id: id(201), name: "员工", active: true, location: { id: id(301), name: "地点", active: true, timeZone: "Europe/Madrid" } }, entries: [], rangeLimited: false, receipt: null, moduleEnabled: true });
test("schedule query is bounded, identity-specific and rejects duplicate/unrecognized parameters", () => {
  assert.deepEqual(parseScheduleQuery(`https://local.invalid/?${scheduleQueryString(q)}`), q);
  for (const extra of ["&employeeId=" + id(1), "&siteId=99990002", "&allowWrite=true"]) assert.throws(() => parseScheduleQuery(`https://local.invalid/?${scheduleQueryString(q)}${extra}`));
  for (const changed of [{ access: "self" }, { throughDate: "2026-11-01" }, { fromDate: "2026-02-30" }, { fromDate: "2026-11-01" }]) assert.throws(() => parseScheduleQuery(`https://local.invalid/?${scheduleQueryString({ ...q, ...changed } as ScheduleQuery)}`));
});
test("schedule commands reject self write, actor injection, unsorted/overlapping/oversized spans and sub-minute input", () => {
  assert.deepEqual(parseScheduleBody({ query: q, command: cmd }).command, cmd);
  for (const patch of [{ workerId: null }, { access: "self" }, { operationId: id(77) }, { allowWrite: true }]) assert.throws(() => parseScheduleBody({ query: { ...q, ...patch }, command: cmd }));
  for (const patch of [{ actor: id(1) }, { reason: "" }, { expectedRevision: 0.1 }, { slots: [] }, { slots: Array(33).fill(cmd.slots[0]) },
    { slots: [cmd.slots[0], cmd.slots[0]] }, { slots: [[cmd.slots[0][1], cmd.slots[0][0]]] }, { slots: [["2026-10-02T07:00:01.000Z", cmd.slots[0][1]]] },
    { slots: [["2026-09-01T07:00:00.000Z", "2026-09-01T09:00:00.000Z"]] }]) assert.throws(() => parseScheduleBody({ query: q, command: { ...cmd, ...patch } }));
});
test("summer/winter recurrence resolves each date independently, not fixed 24h UTC increments", () => {
  const slots = resolveScheduleWallSlots([{ start: "2026-10-24T09:00", end: "2026-10-24T17:00", startOffset: "", endOffset: "" },
    { start: "2026-10-26T09:00", end: "2026-10-26T17:00", startOffset: "", endOffset: "" }], "Europe/Madrid");
  assert.equal(slots[0][0], "2026-10-24T07:00:00.000Z"); assert.equal(slots[1][0], "2026-10-26T08:00:00.000Z");
});
test("nonexistent local time is rejected, repeated local time needs an explicit offset", () => {
  const row = { start: "2026-03-29T02:30", end: "2026-03-29T04:00", startOffset: "", endOffset: "" };
  assert.throws(() => resolveScheduleWallSlots([row], "Europe/Madrid"), /不存在/);
  const fold = { ...row, start: "2026-10-25T02:30", end: "2026-10-25T04:00" };
  assert.throws(() => resolveScheduleWallSlots([fold], "Europe/Madrid"), /重复/);
  const early = resolveScheduleWallSlots([{ ...fold, startOffset: "+02:00" }], "Europe/Madrid");
  const late = resolveScheduleWallSlots([{ ...fold, startOffset: "+01:00" }], "Europe/Madrid");
  assert.equal(Date.parse(late[0][0]) - Date.parse(early[0][0]), 3600000);
});
test("cross-midnight duration uses actual UTC elapsed time through DST", () => {
  const [slot] = resolveScheduleWallSlots([{ start: "2026-10-24T22:00", end: "2026-10-25T06:00", startOffset: "", endOffset: "" }], "Europe/Madrid");
  assert.equal((Date.parse(slot[1]) - Date.parse(slot[0])) / 3600000, 9);
});
test("strict result binding rejects other worker/date, fabricated receipt and oversize list", () => {
  assert.deepEqual(parseScheduleResult(result(), q), result());
  for (const patch of [{ worker: { ...result().worker, id: id(2) } }, { access: "self" }, { fromDate: "2026-10-02" }, { entries: Array(101).fill({}) },
    { receipt: { operationId: cmd.operationId, revision: 1, command: cmd } }, { moduleEnabled: "true" }]) assert.throws(() => parseScheduleResult({ ...result(), ...patch }, q));
});
test("executor uses only allowlisted RPC with server identity, sanitizes output and hides SQL failures", async () => {
  const input = { query: q, command: null, authUserId: id(99), allowWrite: false };
  const r = await executeAttendanceSchedule(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_schedule_v1"); assert.equal(args.p_auth_user_id, id(99)); assert.equal(args.p_allow_write, false);
    return { data: { ...result(), privateField: "secret" }, error: null };
  } }); assert.equal(Object.hasOwn(r, "privateField"), false);
  await assert.rejects(executeAttendanceSchedule(input, { rpc: async () => ({ data: null, error: { message: "secret_sql" } }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceSchedule({ ...input, command: cmd }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
});
function fixture() {
  const storage = new Map<string, string>(), calls: string[] = []; let server = result(), saved = false, lost = false;
  const response = (v: unknown, status = 200) => Response.json(v, { status });
  const apiFetch = async (_url: string, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    if (init?.method === "POST") { const body = parseScheduleBody(JSON.parse(String(init.body))); assert.deepEqual(body.command, cmd);
      server = { ...server, revision: 1, receipt: { operationId: cmd.operationId, revision: 1, command: body.command } }; saved = true;
      if (!lost) { lost = true; throw Error("lost response"); }
    }
    return response({ ok: true, ...server, receipt: saved ? server.receipt : null });
  };
  const client = new AttendanceScheduleClient({ query: q, actorId: id(99), apiFetch, randomId: () => id(401), storage: () => ({
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: k => { storage.delete(k); },
  }) }); return { client, storage, calls, apiFetch, setResult: (r: ScheduleResult) => { server = r; } };
}
test("lost publish response retains original ID; initialize recovers through GET only", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.submit(cmd);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.storage.size, 1);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.storage.size, 0); assert.deepEqual(f.calls, ["GET", "POST", "GET"]);
});
test("malformed storage stops all traffic and preserves raw pending value", async () => {
  const f = fixture(); f.storage.set(f.client.storageKey, "{bad"); await f.client.initialize();
  assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.storage.get(f.client.storageKey), "{bad");
});
test("paused platform remains readable but cannot submit", async () => {
  const f = fixture(); f.setResult({ ...result(), moduleEnabled: false }); await f.client.initialize(); await f.client.submit(cmd);
  assert.deepEqual(f.calls, ["GET"]); assert.equal(f.storage.size, 0);
});
test("self client never sends a publish command or inspects owner pending storage", async () => {
  const calls: string[] = []; const selfQ = { ...q, access: "self" as const, workerId: null };
  const client = new AttendanceScheduleClient({ query: selfQ, actorId: id(101), storage: () => { throw Error("must not inspect storage"); }, apiFetch: async (_url, init) => {
    calls.push(init?.method ?? "GET"); return Response.json({ ok: true, ...result(), access: "self" });
  } }); await client.initialize(); assert.equal(client.getSnapshot().phase, "ready"); await client.submit(cmd); assert.deepEqual(calls, ["GET"]);
});
test("hide clears protected data and late read cannot repopulate it", async () => {
  let release!: (r: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
  const client = new AttendanceScheduleClient({ query: q, actorId: id(99), storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }), apiFetch: () => pending });
  const read = client.initialize(); client.pause(); release(Response.json({ ok: true, ...result() })); await read;
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "blocked");
});
