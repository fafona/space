import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEmployeeLocationWorkspace, employeeLocationRecovery, hasEmployeeLocationPending } from "./merchantAttendanceEmployeeLocationWorkspace";
import { attendanceLocationClockPendingKey } from "./merchantAttendanceLocationClockClient";
import { locationSchedulePendingKey } from "./merchantAttendanceLocationScheduleClient";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3), identity = { siteId, employeeId };
const payload = (patch = {}) => ({ ok: true, moduleEnabled: false, siteId, employeeId, workerId, locationId, ...patch });
const clockKey = attendanceLocationClockPendingKey(siteId, employeeId), noticeKey = `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`;
const intent = { expectedWorkerId: workerId, operationId: id(4), locationId, action: "clock_in", expectedSequence: 0, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false };
const clockPending = (patch = {}) => JSON.stringify({ version: 1, siteId, employeeId, intent: { ...intent, ...patch } });
const noticePending = (patch = {}) => JSON.stringify({ actorId: employeeId, query: { siteId, access: "self", expectedWorkerId: workerId, locationId, operationId: null, ...patch }, command: { action: "acknowledge", operationId: id(5), expectedRevision: 1 } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetch?: AttendanceApiFetch) {
  const memory = new Map<string, string>(), keys: string[] = [], calls: string[] = [];
  const storage = { getItem: (k: string) => { keys.push(k); return memory.get(k) ?? null; } };
  const apiFetch: AttendanceApiFetch = async (url, init) => { calls.push(url); assert.equal(init?.method, "GET"); assert.equal(init.cache, "no-store"); return fetch ? fetch(url, init) : Response.json(payload()); };
  const c = new AttendanceEmployeeLocationWorkspace({ ...identity, apiFetch, storage: () => storage, timeoutMs: 1000 });
  const idle = () => c.report(c.getSnapshot().token, { busy: false, pendingId: null, receiptId: null });
  return { c, memory, storage, keys, calls, idle };
}
test("employee workspace ctor is inert; init resolves current identity even with platform paused", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.keys.length, 0);
  await f.c.initialize(); assert.equal(f.c.getSnapshot().target?.step, "clock"); assert.equal(f.c.getSnapshot().context?.workerId, workerId);
  assert.deepEqual(f.calls, [`/api/merchant-enterprise/attendance/self-context?siteId=${siteId}`]);
  assert.deepEqual([...new Set(f.keys)].sort(), [attendancePendingKey(siteId, employeeId), clockKey, locationSchedulePendingKey(siteId, employeeId), noticeKey].sort());
});
test("both steps re-read context; no acknowledgement or position is requested by switching", async () => {
  const f = fixture(); await f.c.initialize(); f.idle(); await f.c.navigate("notice");
  assert.equal(f.c.getSnapshot().target?.step, "notice"); f.idle(); await f.c.navigate("clock");
  assert.equal(f.calls.length, 3); assert.equal(f.memory.size, 0); f.idle(); assert.equal(await f.c.navigate("close"), true);
});
test("unfinished clock intent recovers original target with GET only", async () => {
  const f = fixture(async () => Response.json(payload({ locationId: id(90) })));
  const original = clockPending(); f.memory.set(clockKey, original); await f.c.initialize();
  assert.equal(f.c.getSnapshot().target?.locationId, locationId); assert.equal(f.c.getSnapshot().target?.workerId, workerId);
  f.idle(); assert.equal(await f.c.navigate("notice"), false); assert.equal(await f.c.navigate("close"), false);
  assert.equal(f.calls.length, 1); assert.equal(f.memory.get(clockKey), original); assert.equal(f.c.requiresLeaveWarning(), true);
});
test("notice recovery keeps the old location, not the new default, and forbids other steps", async () => {
  const f = fixture(async () => Response.json(payload({ locationId: id(90) })));
  const raw = noticePending(); f.memory.set(noticeKey, raw); await f.c.initialize();
  assert.equal(f.c.getSnapshot().target?.step, "notice"); assert.equal(f.c.getSnapshot().target?.locationId, locationId);
  f.idle(); await f.c.navigate("clock"); assert.equal(f.calls.length, 1); assert.equal(f.memory.get(noticeKey), raw);
  f.memory.delete(noticeKey); await f.c.navigate("clock"); assert.equal(f.c.getSnapshot().target?.locationId, id(90));
});
test("busy and uncertain child callbacks cannot switch; stale child callback cannot unlock a new child", async () => {
  const f = fixture(); await f.c.initialize(); const old = f.c.getSnapshot().token;
  await f.c.navigate("notice"); assert.equal(f.calls.length, 1); f.idle(); await f.c.navigate("notice");
  f.c.report(old, { busy: false, pendingId: null, receiptId: null }); assert.equal(f.c.getSnapshot().childBusy, true);
  f.c.report(f.c.getSnapshot().token, { busy: false, pendingId: id(8), receiptId: null });
  assert.equal(await f.c.navigate("close"), false); assert.equal(f.c.requiresLeaveWarning(), true);
});
test("unreadable/ambiguous recovery blocks without networking or altering original intent", async () => {
  for (const entries of [[[clockKey, "bad json"]], [[noticeKey, "x".repeat(4097)]], [[noticeKey, noticePending({ access: "owner" })]],
    [[clockKey, clockPending({ position: { latitude: 0 } })]], [[attendancePendingKey(siteId, employeeId), "original-basic"]],
    [[clockKey, clockPending()], [noticeKey, noticePending()]]] as [string, string][][]) {
    const f = fixture(); entries.forEach(([k, v]) => f.memory.set(k, v)); const before = [...f.memory];
    await f.c.initialize(); assert.equal(f.c.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0);
    assert.deepEqual([...f.memory], before); assert.equal(await f.c.navigate("close"), true);
  }
});
test("current worker change cannot adopt an old pending command", async () => {
  for (const key of [clockKey, noticeKey]) {
    const f = fixture(async () => Response.json(payload({ workerId: id(90) })));
    const raw = key === clockKey ? clockPending() : noticePending(); f.memory.set(key, raw); await f.c.initialize();
    assert.equal(f.c.getSnapshot().phase, "blocked"); assert.equal(f.c.getSnapshot().target, null); assert.equal(f.memory.get(key), raw);
  }
});
test("wrong employee/site and malformed context never mount children", async () => {
  for (const patch of [{ employeeId: id(80) }, { siteId: "99990002" }, { workerId: "*" }, { locationId: "" }]) {
    const f = fixture(async () => Response.json(payload(patch))); await f.c.initialize();
    assert.equal(f.c.getSnapshot().target, null); assert.equal(f.c.getSnapshot().phase, "blocked");
  }
});
test("no default location still permits clock-state reads and explicit safe-finish discovery", async () => {
  const f = fixture(async () => Response.json(payload({ locationId: null })));
  await f.c.initialize(); assert.equal(f.c.getSnapshot().target?.step, "clock"); f.idle(); await f.c.navigate("notice");
  assert.equal(f.c.getSnapshot().target?.locationId, null); assert.equal(f.c.getSnapshot().childBusy, false);
  assert.equal(await f.c.navigate("close"), true);
});
test("pending changes during context read cannot slip into a fresh child, including same-target new ID", async () => {
  const f = fixture(async () => { f.memory.set(clockKey, clockPending({ operationId: id(99) })); return Response.json(payload()); });
  f.memory.set(clockKey, clockPending()); await f.c.initialize(); assert.equal(f.c.getSnapshot().phase, "blocked");
  assert.equal(f.memory.get(clockKey), clockPending({ operationId: id(99) }));
});
test("dispose cancels late context, and StrictMode-style remount can initialize again", async () => {
  let release!: (v: Response) => void, count = 0;
  const f = fixture(async () => ++count === 1 ? new Promise<Response>(resolve => { release = resolve; }) : Response.json(payload()));
  const first = f.c.initialize(); await tick(); f.c.dispose(); await f.c.initialize(); release(Response.json(payload({ employeeId: id(90) }))); await first;
  assert.equal(f.c.getSnapshot().phase, "ready"); assert.equal(f.c.getSnapshot().context?.employeeId, employeeId); assert.equal(f.calls.length, 2);
});
test("HTML/oversized/error replies are hidden and never retried automatically", async () => {
  for (const response of [new Response("login", { headers: { "Content-Type": "text/html" } }), Response.json({ ...payload(), padding: "x".repeat(2048) }),
    Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 })]) {
    const f = fixture(async () => response); await f.c.initialize(); assert.equal(f.c.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 1);
  }
});
test("cross-channel pending hint treats malformed entries as pending and never scans other identities", () => {
  const f = fixture(); assert.equal(hasEmployeeLocationPending(f.storage, identity), false);
  f.memory.set(noticeKey, "broken"); assert.equal(hasEmployeeLocationPending(f.storage, identity), true);
  assert.throws(() => employeeLocationRecovery(f.storage, identity)); assert.equal(f.memory.get(noticeKey), "broken");
  assert.equal(hasEmployeeLocationPending(f.storage, { siteId, employeeId: id(80) }), false);
  assert.throws(() => hasEmployeeLocationPending({ getItem: () => { throw Error("storage unavailable"); } }, identity));
});
