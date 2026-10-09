import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEmployeeLocationWorkspace, employeeLocationRecovery, hasEmployeeLocationPending } from "./merchantAttendanceEmployeeLocationWorkspace";
import { attendanceLocationClockPendingKey } from "./merchantAttendanceLocationClockClient";
import { locationSchedulePendingKey, parseLocationSchedulePending } from "./merchantAttendanceLocationScheduleClient";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3), identity = { siteId, employeeId };
const scheduleKey = locationSchedulePendingKey(siteId, employeeId), clockKey = attendanceLocationClockPendingKey(siteId, employeeId);
const basicKey = attendancePendingKey(siteId, employeeId), noticeKey = `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`;
const intent = { expectedWorkerId: workerId, operationId: id(4), locationId, action: "clock_in", expectedSequence: 0,
  settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false };
const selection = { slotId: id(5), revision: 2 };
const pending = (patch: Record<string, unknown> = {}) => JSON.stringify({ version: 1, siteId, employeeId, intent, selection, ...patch });
const oldPending = JSON.stringify({ version: 1, siteId, employeeId, intent });
const noticePending = JSON.stringify({ actorId: employeeId, query: { siteId, access: "self", expectedWorkerId: workerId, locationId, operationId: null },
  command: { action: "acknowledge", operationId: id(6), expectedRevision: 1 } });
const context = (patch: Record<string, unknown> = {}) => ({ ok: true, moduleEnabled: false, siteId, employeeId, workerId, locationId, ...patch });

function fixture(fetch?: AttendanceApiFetch) {
  const memory = new Map<string, string>(), reads: string[] = [], calls: string[] = [];
  const storage = new Proxy({ getItem: (key: string) => { reads.push(key); return memory.get(key) ?? null; } }, {
    get(target, key) { if (key !== "getItem") throw Error(`forbidden_storage_access:${String(key)}`); return target.getItem; },
    ownKeys() { throw Error("forbidden_storage_scan"); },
  });
  const apiFetch: AttendanceApiFetch = async (url, init) => {
    calls.push(url); assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store");
    return fetch ? fetch(url, init) : Response.json(context());
  };
  const workspace = new AttendanceEmployeeLocationWorkspace({ ...identity, apiFetch, storage: () => storage, timeoutMs: 1000 });
  const idle = () => workspace.report(workspace.getSnapshot().token, { busy: false, pendingId: null, receiptId: null });
  return { memory, reads, calls, storage, workspace, idle };
}

test("new pending hint and recovery use exact identity keys only, with no storage enumeration or writes", () => {
  const f = fixture();
  f.memory.set(locationSchedulePendingKey("99990002", employeeId), pending());
  f.memory.set(locationSchedulePendingKey(siteId, id(99)), pending());
  f.memory.set("unrelated-session-key", "keep-me"); const before = [...f.memory];
  assert.equal(hasEmployeeLocationPending(f.storage, identity), false);
  assert.deepEqual(f.reads, [clockKey, scheduleKey, noticeKey]); f.reads.length = 0;
  assert.equal(employeeLocationRecovery(f.storage, identity), null);
  assert.deepEqual(f.reads, [basicKey, clockKey, noticeKey, scheduleKey]);
  assert.deepEqual([...f.memory], before); assert.equal(f.calls.length, 0);
});

test("selected or explicit-none schedule intent recovers its original clock target and complete pending fingerprint", () => {
  for (const raw of [pending(), pending({ selection: null })]) {
    const f = fixture(); f.memory.set(scheduleKey, raw);
    assert.equal(hasEmployeeLocationPending(f.storage, identity), true);
    assert.deepEqual(employeeLocationRecovery(f.storage, identity), { step: "clock", workerId, locationId,
      fingerprint: JSON.stringify(parseLocationSchedulePending(raw, siteId, employeeId)) });
    assert.equal(f.memory.get(scheduleKey), raw); assert.equal(f.calls.length, 0);
  }
});

test("workspace routes new pending to original location after one current-identity GET and never automatically retries", async () => {
  const f = fixture(async () => Response.json(context({ locationId: id(90) })));
  const raw = pending(); f.memory.set(scheduleKey, raw); await f.workspace.initialize();
  assert.equal(f.workspace.getSnapshot().phase, "ready");
  assert.equal(f.workspace.getSnapshot().target?.step, "clock");
  assert.equal(f.workspace.getSnapshot().target?.workerId, workerId);
  assert.equal(f.workspace.getSnapshot().target?.locationId, locationId);
  assert.equal(f.workspace.getSnapshot().context?.locationId, id(90));
  f.idle(); assert.equal(await f.workspace.navigate("notice"), false);
  assert.equal(await f.workspace.navigate("close"), false); assert.equal(f.workspace.requiresLeaveWarning(), true);
  assert.deepEqual(f.calls, [`/api/merchant-enterprise/attendance/self-context?siteId=${siteId}`]);
  assert.equal(f.memory.get(scheduleKey), raw);
});

test("damaged new pending remains pending and blocks without clearing bytes or requesting context", async () => {
  const missing = JSON.parse(pending()); delete missing.selection;
  const duplicate = pending().replace('"version":1', '"version":1,"version":1');
  const invalid = ["not-json", "x".repeat(4097), JSON.stringify(missing), duplicate, pending({ version: 2 }),
    pending({ position: { latitude: 0, longitude: 0 } }), pending({ selection: { ...selection, revision: 0 } }),
    pending({ intent: { ...intent, action: "clock_out", safeFinish: true, noticeRevision: null } })];
  for (const raw of invalid) {
    const f = fixture(); f.memory.set(scheduleKey, raw); const before = [...f.memory];
    assert.equal(hasEmployeeLocationPending(f.storage, identity), true); assert.throws(() => employeeLocationRecovery(f.storage, identity));
    await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().phase, "blocked");
    assert.equal(f.workspace.getSnapshot().target, null); assert.equal(f.calls.length, 0);
    assert.equal(f.workspace.requiresLeaveWarning(), true); assert.deepEqual([...f.memory], before);
  }
});

test("old and new pending simultaneously block even when their operation IDs and targets match", async () => {
  const f = fixture(); f.memory.set(clockKey, oldPending); f.memory.set(scheduleKey, pending()); const before = [...f.memory];
  assert.throws(() => employeeLocationRecovery(f.storage, identity), /conflicting_pending_channels/);
  await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().phase, "blocked");
  assert.equal(f.calls.length, 0); assert.deepEqual([...f.memory], before);
});

test("new pending conflicts with notice or basic pending without merging or erasing either intent", async () => {
  for (const [key, raw, error] of [[noticeKey, noticePending, "conflicting_pending_channels"], [basicKey, "basic-original", "basic_clock_pending"]]) {
    const f = fixture(); f.memory.set(scheduleKey, pending()); f.memory.set(key, raw); const before = [...f.memory];
    assert.throws(() => employeeLocationRecovery(f.storage, identity), new RegExp(error));
    await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().phase, "blocked");
    assert.equal(f.calls.length, 0); assert.deepEqual([...f.memory], before);
  }
});

test("embedded site or employee mismatch cannot recover under the current exact storage key", async () => {
  for (const raw of [pending({ siteId: "99990002" }), pending({ employeeId: id(99) })]) {
    const f = fixture(); f.memory.set(scheduleKey, raw); await f.workspace.initialize();
    assert.equal(f.workspace.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0);
    assert.equal(f.memory.get(scheduleKey), raw); assert.equal(f.workspace.getSnapshot().target, null);
  }
});

test("current employee or worker rebinding never mounts an old schedule intent or consumes its key", async () => {
  for (const patch of [{ employeeId: id(90) }, { workerId: id(91) }]) {
    const f = fixture(async () => Response.json(context(patch))); const raw = pending(); f.memory.set(scheduleKey, raw);
    await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().phase, "blocked");
    assert.equal(f.workspace.getSnapshot().context, null); assert.equal(f.workspace.getSnapshot().target, null);
    assert.equal(f.calls.length, 1); assert.equal(f.memory.get(scheduleKey), raw);
  }
});

test("same-target changes in slot selection or operation during context GET fail the pending fingerprint fence", async () => {
  for (const replacement of [pending({ selection: { ...selection, slotId: id(90) } }), pending({ selection: null }),
    pending({ intent: { ...intent, operationId: id(91) } })]) {
    const f = fixture(async () => { f.memory.set(scheduleKey, replacement); return Response.json(context()); });
    f.memory.set(scheduleKey, pending()); await f.workspace.initialize();
    assert.equal(f.workspace.getSnapshot().phase, "blocked"); assert.equal(f.workspace.getSnapshot().target, null);
    assert.equal(f.calls.length, 1); assert.equal(f.memory.get(scheduleKey), replacement);
  }
});

test("storage failure is not absence and does not invite fresh clock initialization", async () => {
  const storage = { getItem: (key: string): string | null => { if (key === scheduleKey) throw Error("storage denied"); return null; } };
  assert.throws(() => hasEmployeeLocationPending(storage, identity), /storage denied/);
  assert.throws(() => employeeLocationRecovery(storage, identity), /storage denied/);
  let requests = 0;
  const workspace = new AttendanceEmployeeLocationWorkspace({ ...identity, storage: () => storage,
    apiFetch: async () => { requests++; return Response.json(context()); } });
  await workspace.initialize(); assert.equal(workspace.getSnapshot().phase, "blocked");
  assert.equal(workspace.getSnapshot().target, null); assert.equal(workspace.requiresLeaveWarning(), true); assert.equal(requests, 0);
});
