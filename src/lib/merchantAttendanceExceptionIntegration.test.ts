import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationReviewCaseClient } from "./merchantAttendanceLocationReviewClient";
import { AttendanceDiscussionClient } from "./merchantAttendanceLocationDiscussionClient";
import { AttendanceExceptionWorkspace } from "./merchantAttendanceExceptionWorkspace";
import { createExceptionWorkspaceFixture, siteId, ownerId, employeeId, workerId, eventId } from "../../scripts/fixtures/attendance-exception-workspace-model";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const f = createExceptionWorkspaceFixture(), memory = new Map<string, string>(); let serial = 100;
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  const review = () => new AttendanceLocationReviewCaseClient({ siteId, ownerId, apiFetch: f.apiFetch, storage: () => storage, randomId: () => id(++serial) });
  const discussion = (access: "owner" | "self" = "owner") => new AttendanceDiscussionClient({ siteId, access, actorId: access === "owner" ? ownerId : employeeId, apiFetch: f.apiFetch, storage: () => storage, randomId: () => id(++serial) });
  const workspace = new AttendanceExceptionWorkspace({ siteId, access: "owner", actorId: ownerId }, () => storage);
  return { f, memory, storage, review, discussion, workspace };
}
test("same synthetic case shares review status, never shares internal note with public clients", async () => {
  const { f, review, discussion } = fixture(), privateClient = review(); await privateClient.initialize(); await privateClient.select(eventId);
  await privateClient.submit("follow_up", "PRIVATE_ONLY_SYNTHETIC_NOTE", 0); assert.equal(privateClient.getSnapshot().phase, "ready"); privateClient.pause();
  const owner = discussion(); await owner.initialize({ eventId, expectedWorkerId: null }); assert.equal(owner.getSnapshot().detail?.item.reviewState, "follow_up");
  assert.equal(owner.getSnapshot().detail?.history.length, 0); assert.doesNotMatch(JSON.stringify(owner.getSnapshot()), /PRIVATE_ONLY_SYNTHETIC_NOTE/);
  await owner.submit("Please explain this incident"); owner.pause();
  const employee = discussion("self"); await employee.initialize({ eventId, expectedWorkerId: workerId });
  assert.deepEqual(employee.getSnapshot().detail?.history.map(x => x.note), ["Please explain this incident"]);
  assert.doesNotMatch(JSON.stringify(employee.getSnapshot()), /PRIVATE_ONLY_SYNTHETIC_NOTE/);
  await employee.submit("Synthetic employee explanation"); employee.pause();
  await privateClient.initialize(); assert.equal(privateClient.getSnapshot().result?.item.reviewState, "follow_up");
  assert.equal(privateClient.getSnapshot().result?.history.length, 1); assert.equal(f.discussion.writes(), 2); assert.equal(f.review.writes(), 1); privateClient.pause();
});
test("lost internal write restores original review first and never auto-publishes", async () => {
  const { f, review, workspace, memory } = fixture(); const c = review(); await c.initialize(); await c.select(eventId); f.mode("lost"); await c.submit("noted", "Internal review", 0); c.pause();
  workspace.initialize(); assert.equal(workspace.getSnapshot().target?.step, "review"); assert.equal(workspace.getSnapshot().target?.eventId, eventId);
  f.mode("normal"); const recovered = review(); await recovered.initialize(); assert.equal(recovered.getSnapshot().pending, null);
  assert.equal(f.review.writes(), 1); assert.equal(f.discussion.writes(), 0); assert.equal(memory.size, 0); recovered.pause();
});
test("lost public write restores its original event even if caller offers another initial event", async () => {
  const { f, discussion, workspace, memory } = fixture(); const c = discussion(); await c.initialize({ eventId, expectedWorkerId: null }); f.mode("lost"); await c.submit("Public message"); c.pause();
  workspace.initialize(); assert.equal(workspace.getSnapshot().target?.step, "discussion"); f.mode("normal");
  const recovered = discussion(); const before = f.discussion.calls.length; await recovered.initialize({ eventId: id(90), expectedWorkerId: null });
  const calls = f.discussion.calls.slice(before); assert.equal(calls.length, 1); assert.equal(calls[0].method, "GET"); assert.match(calls[0].url, new RegExp(eventId));
  assert.equal(memory.size, 0); assert.equal(f.discussion.writes(), 1); recovered.pause();
});
test("detail navigation is a validated GET, self requires a worker pin and rejects changed identity", async () => {
  const { f, discussion } = fixture(); const c = discussion("self");
  await c.initialize({ eventId, expectedWorkerId: null }); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(f.discussion.calls.length, 0);
  await c.initialize({ eventId, expectedWorkerId: id(90) }); assert.equal(c.getSnapshot().detail, null);
  f.mode("wrong_actor"); await c.initialize({ eventId, expectedWorkerId: workerId }); assert.equal(c.getSnapshot().detail, null);
  assert.ok(f.discussion.calls.every(x => x.method === "GET")); assert.equal(f.discussion.writes(), 0); c.pause();
});
test("public read-only employee and paused existing cases preserve prior permission semantics", async () => {
  const { f, discussion } = fixture(); f.enabled(false); f.discussion.canPost(false);
  const c = discussion("self"); await c.initialize({ eventId, expectedWorkerId: workerId });
  assert.equal(c.getSnapshot().detail?.moduleEnabled, false); assert.equal(c.getSnapshot().detail?.canPost, false);
  await c.submit("Not allowed"); assert.equal(f.discussion.writes(), 0); c.pause();
  const owner = discussion(); await owner.initialize({ eventId, expectedWorkerId: null }); await owner.submit("Existing case reply");
  assert.equal(f.discussion.writes(), 1); owner.pause();
});
