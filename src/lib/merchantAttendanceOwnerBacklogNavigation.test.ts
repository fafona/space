import assert from "node:assert/strict";
import test from "node:test";
import { ownerBacklogHostReady, ownerBacklogTarget } from "./merchantAttendanceOwnerBacklogNavigation";
import type { OwnerBacklogItem } from "./merchantAttendanceOwnerBacklog";
const row: OwnerBacklogItem = { kind: "correction", requestId: "00000000-0000-4000-8000-000000000001", submittedAt: "2026-10-07T10:00:00.000001Z",
  workerId: "00000000-0000-4000-8000-000000000002", workerName: "合成员工", workerNo: "229", proposedStartAt: "2026-10-05T08:00:00.000000Z", proposedEndAt: "2026-10-05T09:00:00.000000Z", status: "submitted" };
const ready = { phase: "ready", result: { moduleEnabled: true, items: [row] } };
test("backlog navigation projects identity only, never stale approval or employee evidence", () => {
  assert.deepEqual(ownerBacklogTarget(ready, row, { correction: true }), { kind: row.kind, requestId: row.requestId, submittedAt: row.submittedAt });
});
test("hidden/paused/loading/blocked or disabled modules cannot navigate an old row", () => {
  for (const phase of ["idle", "loading", "blocked"]) assert.equal(ownerBacklogTarget({ ...ready, phase }, row, { correction: true }), null);
  assert.equal(ownerBacklogTarget({ ...ready, result: null }, row, { correction: true }), null);
  assert.equal(ownerBacklogTarget({ ...ready, result: { ...ready.result, moduleEnabled: false } }, row, { correction: true }), null);
  assert.equal(ownerBacklogTarget(ready, row, {}), null);
});
test("a stale row, wrong type, request or microsecond must match the currently displayed result", () => {
  for (const candidate of [{ ...row, requestId: row.workerId }, { ...row, kind: "revision" as const }, { ...row, submittedAt: "2026-10-07T10:00:00.000002Z" }])
    assert.equal(ownerBacklogTarget(ready, candidate, { correction: true, revision: true }), null);
  assert.equal(ownerBacklogTarget({ ...ready, result: { ...ready.result, items: [] } }, row, { correction: true }), null);
});
test("all three types preserve submission date instead of proposed shift date", () => {
  for (const kind of ["correction", "revision", "missing"] as const) {
    const item = { ...row, kind };
    assert.deepEqual(ownerBacklogTarget({ ...ready, result: { ...ready.result, items: [item] } }, item, { [kind]: true }),
      { kind, requestId: row.requestId, submittedAt: row.submittedAt });
  }
});
const host = { phase: "ready", pending: null, result: { moduleEnabled: true } };
test("host rejects current nonready state, parent draft, unresolved operation and paused module", () => {
  assert.equal(ownerBacklogHostReady(host, false, () => null), true);
  assert.equal(ownerBacklogHostReady(host, true, () => null), false);
  for (const phase of ["idle", "loading", "saving", "blocked", "unconfirmed"]) assert.equal(ownerBacklogHostReady({ ...host, phase }, false, () => null), false);
  assert.equal(ownerBacklogHostReady({ ...host, pending: {} }, false, () => null), false);
  assert.equal(ownerBacklogHostReady({ ...host, result: null }, false, () => null), false);
  assert.equal(ownerBacklogHostReady({ ...host, result: { moduleEnabled: false } }, false, () => null), false);
});
test("live pending slot blocks even when React snapshot has no pending; storage denial fails closed", () => {
  for (const raw of ["", "corrupt", "original-operation"]) assert.equal(ownerBacklogHostReady(host, false, () => raw), false);
  assert.equal(ownerBacklogHostReady(host, false, () => { throw Error("storage denied"); }), false);
});
