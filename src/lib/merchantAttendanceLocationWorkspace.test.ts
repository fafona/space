import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationWorkspace, locationWorkspaceRecovery } from "./merchantAttendanceLocationWorkspace";
import { AttendanceLocationPolicyClient } from "./merchantAttendanceLocationPolicyClient";
import { AttendanceLocationSetupClient } from "./merchantAttendanceLocationSetupClient";
import { AttendanceNoticeClient } from "./merchantAttendanceLocationNoticeClient";
import { createLocationWorkspaceModel } from "../../scripts/fixtures/attendance-location-workspace-model";
import { setupOwner, setupQuery, setupValues } from "../../scripts/fixtures/attendance-location-setup-model";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { siteId: setupQuery.siteId, ownerId: setupOwner, locationId: setupQuery.locationId };
function fixture() {
  const model = createLocationWorkspaceModel(), memory = new Map<string, string>(); let op = 100;
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const deps = { apiFetch: model.apiFetch, storage: () => storage, randomId: () => id(op++), timeoutMs: 100 };
  const policy = () => new AttendanceLocationPolicyClient({ ...identity, ...deps });
  const setup = () => new AttendanceLocationSetupClient({ query: setupQuery, ownerId: setupOwner, ...deps });
  const notice = () => new AttendanceNoticeClient({ query: { ...setupQuery, access: "owner", expectedWorkerId: null }, actorId: setupOwner, ...deps });
  return { model, memory, storage, policy, setup, notice, workspace: new AttendanceLocationWorkspace(identity, () => storage) };
}
const ready = (w: AttendanceLocationWorkspace) => w.report(w.getSnapshot().token, { busy: false, pendingId: null, receiptId: null });
test("workspace is inert, enters one step, and navigation never submits any command", () => {
  const f = fixture(), w = f.workspace; assert.equal(w.getSnapshot().target, null); w.initialize();
  assert.deepEqual(w.getSnapshot().target, { step: "policy", locationId: identity.locationId });
  assert.equal(w.navigate("setup"), false); assert.equal(w.getSnapshot().target?.step, "policy");
  ready(w); w.navigate("setup"); assert.equal(w.getSnapshot().target?.step, "setup");
  ready(w); assert.equal(w.navigate("close"), true); assert.deepEqual(f.model.metrics(), { gets: 0, posts: 0 });
});
test("dirty input requires explicit discard; cancellation and new typing revoke previous confirmation", () => {
  const f = fixture(), w = f.workspace; w.initialize(); ready(w); w.edit(); w.navigate("notice");
  assert.equal(w.getSnapshot().requested, "notice"); assert.equal(w.getSnapshot().target?.step, "policy");
  w.cancel(); assert.equal(w.getSnapshot().dirty, true); assert.equal(w.getSnapshot().requested, null);
  w.navigate("setup"); w.edit(); assert.equal(w.getSnapshot().requested, null);
  w.navigate("setup"); w.navigate("setup", true); assert.equal(w.getSnapshot().dirty, false); assert.equal(w.getSnapshot().target?.step, "setup");
});
test("busy or uncertain commands cannot be bypassed by discard, and late panels cannot unlock navigation", () => {
  const f = fixture(), w = f.workspace; w.initialize(); ready(w); const oldToken = w.getSnapshot().token;
  w.navigate("setup"); w.report(oldToken, { busy: false, pendingId: null, receiptId: null });
  assert.equal(w.getSnapshot().busy, true); assert.equal(w.navigate("close", true), false);
  w.report(w.getSnapshot().token, { busy: false, pendingId: id(99), receiptId: null }); assert.equal(w.navigate("policy", true), false);
  assert.equal(w.getSnapshot().target?.step, "setup");
});
test("a confirmed save clears dirty state but an unchanged historical receipt cannot clear new input", () => {
  const f = fixture(), w = f.workspace; w.initialize(); ready(w); w.edit();
  w.report(w.getSnapshot().token, { busy: false, pendingId: null, receiptId: id(4) }); assert.equal(w.getSnapshot().dirty, false);
  w.edit(); w.report(w.getSnapshot().token, { busy: false, pendingId: null, receiptId: id(4) }); assert.equal(w.getSnapshot().dirty, true);
});

test("wrong receipts cannot clear a tracked save, and a failed child cannot erase storage recovery", async () => {
  const f = fixture(), w = f.workspace; w.initialize(); ready(w); w.edit();
  w.report(w.getSnapshot().token, { busy: true, pendingId: id(3), receiptId: null });
  w.report(w.getSnapshot().token, { busy: false, pendingId: null, receiptId: id(4) }); assert.equal(w.getSnapshot().dirty, true);
  const setup = f.setup(); await setup.initialize(); f.model.mode("unsent"); await setup.submit("prepare", "Apply");
  w.report(w.getSnapshot().token, { busy: false, pendingId: null, receiptId: null });
  assert.equal(w.requiresLeaveWarning(), true);
  assert.equal(w.navigate("close", true), false); assert.equal(w.getSnapshot().target?.step, "setup"); assert.equal(f.memory.size, 1);
});
test("storage failure and basic configuration pending fail closed without writing or deleting storage", () => {
  const w = new AttendanceLocationWorkspace(identity, () => ({ getItem() { throw Error("denied"); } })); w.initialize();
  assert.equal(w.getSnapshot().storageBlocked, true); assert.equal(w.getSnapshot().target, null); assert.equal(w.navigate("close"), true);
  assert.equal(w.requiresLeaveWarning(), true);
  const f = fixture(); f.memory.set(`faolla:attendance:config:v1:${identity.siteId}:${identity.ownerId}`, "{}"); f.workspace.initialize();
  assert.equal(f.workspace.getSnapshot().storageBlocked, true); assert.equal(f.memory.size, 1);
});
test("strict restoration rejects wrong actor, merchant, malformed or oversized commands and never scans other identities", async () => {
  const f = fixture(), setup = f.setup(); await setup.initialize(); f.model.mode("unsent"); await setup.submit("prepare", "Apply");
  const original = f.memory.get(setup.storageKey)!, pending = JSON.parse(original);
  for (const value of ["{}", "x".repeat(4097), JSON.stringify({ ...pending, ownerId: id(99) }), JSON.stringify({ ...pending, query: { ...pending.query, siteId: "99990002" } }),
    JSON.stringify({ ...pending, command: { ...pending.command, latitude: 0 } })]) {
    f.memory.set(setup.storageKey, value); assert.throws(() => locationWorkspaceRecovery(f.storage, identity)); assert.equal(f.memory.get(setup.storageKey), value);
  }
  f.memory.set(setup.storageKey, original); assert.deepEqual(locationWorkspaceRecovery(f.storage, { ...identity, ownerId: id(99) }), null);
});
test("cross-location pending setup is restored at its original location, not at the newly selected location", async () => {
  const f = fixture(), setup = f.setup(); await setup.initialize(); f.model.mode("lost"); await setup.submit("prepare", "Apply");
  const w = new AttendanceLocationWorkspace({ ...identity, locationId: id(88) }, () => f.storage); w.initialize();
  assert.deepEqual(w.getSnapshot().target, { step: "setup", locationId: identity.locationId });
  f.model.mode("normal"); await f.setup().initialize(); ready(w); w.navigate("policy");
  assert.deepEqual(w.getSnapshot().target, { step: "policy", locationId: id(88) }); assert.equal(f.model.metrics().posts, 1);
});
test("pending operation appearing between steps redirects to recovery without deleting it", async () => {
  const f = fixture(), w = f.workspace; w.initialize(); ready(w); const setup = f.setup(); await setup.initialize();
  f.model.mode("unsent"); await setup.submit("prepare", "Apply"); w.navigate("notice");
  assert.equal(w.getSnapshot().target?.step, "setup"); assert.equal(f.memory.size, 1); assert.equal(f.model.metrics().posts, 1);
});
test("three real clients share one synthetic state: save policy, apply fence, publish, then enable", async () => {
  const f = fixture(), policy = f.policy(); await policy.initialize(); const p = policy.getSnapshot().result!;
  await policy.submit({ ...setupValues, radiusMeters: 180 }, { revision: p.current!.revision, settingsVersion: p.settingsVersion, locationVersion: p.location.version });
  assert.equal(policy.getSnapshot().result?.current?.revision, 2);
  const setup = f.setup(); await setup.initialize(); await setup.submit("prepare", "Apply selected draft");
  assert.equal(setup.getSnapshot().result?.draft?.revision, 3); assert.equal(setup.getSnapshot().result?.channelEnabled, false);
  const notice = f.notice(); await notice.initialize(); assert.equal(notice.getSnapshot().result?.draft?.revision, 3);
  await notice.submit("publish", "Published purpose"); assert.equal(notice.getSnapshot().result?.noticeCurrent, true);
  await setup.initialize(); await setup.submit("enable", "Explicit activation");
  assert.equal(setup.getSnapshot().result?.channelEnabled, true); assert.equal(f.model.metrics().posts, 4); assert.equal(f.memory.size, 0);
  await policy.initialize(); assert.equal(policy.getSnapshot().result?.current?.revision, 3); assert.equal(policy.getSnapshot().result?.previous?.revision, 2);
});
test("policy and notice response losses restore the correct step with GET only", async () => {
  const f = fixture(), policy = f.policy(); await policy.initialize(); f.model.mode("lost");
  await policy.submit(setupValues, { revision: 1, settingsVersion: 1, locationVersion: 1 });
  assert.equal(locationWorkspaceRecovery(f.storage, identity)?.step, "policy");
  f.model.mode("normal"); await f.policy().initialize(); const setup = f.setup(); await setup.initialize(); await setup.submit("prepare", "Apply");
  const notice = f.notice(); await notice.initialize(); f.model.mode("lost"); await notice.submit("publish", "Notice");
  assert.equal(locationWorkspaceRecovery(f.storage, identity)?.step, "notice"); const posts = f.model.metrics().posts;
  f.model.mode("normal"); await f.notice().initialize(); assert.equal(f.model.metrics().posts, posts); assert.equal(f.memory.size, 0);
});
test("publication before applying the fence does not activate location, and applying it requires republishing", async () => {
  const f = fixture(), notice = f.notice(); await notice.initialize(); await notice.submit("publish", "Early notice");
  const setup = f.setup(); await setup.initialize(); assert.equal(setup.getSnapshot().result?.canEnable, false);
  await setup.submit("prepare", "Prepare fence"); assert.equal(setup.getSnapshot().result?.noticeMatches, false);
  await notice.initialize(); assert.equal(notice.getSnapshot().result?.canPublish, true); await notice.submit("publish", "Updated version");
  await setup.initialize(); assert.equal(setup.getSnapshot().result?.canEnable, true);
});
