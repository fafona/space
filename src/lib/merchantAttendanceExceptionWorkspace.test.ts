import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceExceptionWorkspace, exceptionWorkspaceRecovery, type ExceptionIdentity, type ExceptionActivity } from "./merchantAttendanceExceptionWorkspace";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), eventId = id(2), workerId = id(3), op = id(4), owner: ExceptionIdentity = { siteId, actorId, access: "owner" };
const reviewKey = `faolla:attendance:location-review:v1:${siteId}:${actorId}`;
const discussionKey = (access = "owner") => `faolla:attendance:discussion:v1:${siteId}:${access}:${actorId}`;
const reviewPending = () => JSON.stringify({ siteId, ownerId: actorId, command: { eventId, operationId: op, expectedRevision: 0, outcome: "follow_up", note: "internal only" } });
const discussionPending = (access = "owner") => JSON.stringify({ actorId, query: { siteId, access, mode: "detail", eventId, expectedWorkerId: access === "self" ? workerId : null, operationId: null }, command: { eventId, operationId: op, expectedRevision: 0, note: "explicitly public" } });
const review = { step: "review" as const, eventId, workerId: null }, discussion = { ...review, step: "discussion" as const };
function fixture(i = owner) {
  const memory = new Map<string, string>(), keys: string[] = [], storage = { getItem: (k: string) => { keys.push(k); return memory.get(k) ?? null; } };
  const c = new AttendanceExceptionWorkspace(i, () => storage);
  const report = (patch: Partial<ExceptionActivity> = {}) => c.report(c.getSnapshot().token, { busy: false, pendingId: null, receiptId: null, eventId: null, workerId: null, ...patch });
  return { c, memory, keys, storage, report };
}
test("exception workspace ctor is inert; owner defaults to private review and self to public discussion", () => {
  for (const access of ["owner", "self"] as const) { const f = fixture({ ...owner, access }); assert.equal(f.keys.length, 0); f.c.initialize();
    assert.equal(f.c.getSnapshot().target?.step, access === "owner" ? "review" : "discussion"); assert.equal(f.memory.size, 0);
    if (access === "self") assert.ok(f.keys.every(k => k === discussionKey("self")));
  }
});
test("switching same event passes IDs only, not private notes", () => {
  const f = fixture(); f.c.initialize(); f.report({ eventId }); f.c.navigate(discussion);
  assert.deepEqual(f.c.getSnapshot().target, discussion); assert.equal(f.c.getSnapshot().busy, true); assert.equal(f.memory.size, 0);
});
test("self cannot navigate to internal review or an unpinned detail", () => {
  const f = fixture({ ...owner, access: "self" }); f.c.initialize(); f.report();
  assert.throws(() => f.c.navigate(review)); assert.throws(() => f.c.navigate(discussion));
  f.c.navigate({ ...discussion, workerId }); assert.equal(f.c.getSnapshot().target?.workerId, workerId);
});
test("unsaved note needs explicit discard; cancel or further edit cancels stale navigation", () => {
  const f = fixture(); f.c.initialize(); f.report({ eventId }); f.c.edit(); const token = f.c.getSnapshot().token;
  assert.equal(f.c.navigate(discussion), false); assert.equal(f.c.getSnapshot().token, token); assert.deepEqual(f.c.getSnapshot().requested, discussion);
  f.c.cancel(); assert.equal(f.c.getSnapshot().requested, null); assert.equal(f.c.getSnapshot().dirty, true);
  f.c.navigate(discussion); f.c.edit(); assert.equal(f.c.getSnapshot().requested, null);
  f.c.navigate(discussion, true); assert.equal(f.c.getSnapshot().dirty, false); assert.deepEqual(f.c.getSnapshot().target, discussion);
});
test("closing requires discard while dirty but never overrides an uncertain submission", () => {
  const f = fixture(); f.c.initialize(); f.report(); f.c.edit(); assert.equal(f.c.navigate("close"), false);
  f.report({ pendingId: op }); assert.equal(f.c.navigate("close", true), false); assert.equal(f.c.requiresLeaveWarning(), true);
  f.report({ receiptId: op }); assert.equal(f.c.getSnapshot().dirty, false); assert.equal(f.c.navigate("close"), true);
});
test("old receipt or callback cannot erase new input or unlock a new step", () => {
  const f = fixture(); f.c.initialize(); const old = f.c.getSnapshot().token;
  f.report({ receiptId: op }); f.c.edit(); f.report({ receiptId: op }); assert.equal(f.c.getSnapshot().dirty, true);
  f.c.navigate(discussion, true); f.c.report(old, { busy: false, pendingId: null, receiptId: id(99), eventId, workerId: null });
  assert.equal(f.c.getSnapshot().busy, true); assert.equal(f.c.navigate("close"), false);
});
test("original review/discussion recovery selects original event without copying notes into nav state", () => {
  for (const [key, raw, expected] of [[reviewKey, reviewPending(), review], [discussionKey(), discussionPending(), discussion]] as const) {
    const f = fixture(); f.memory.set(key, raw); f.c.initialize(); assert.deepEqual(f.c.getSnapshot().target, expected);
    assert.doesNotMatch(JSON.stringify(f.c.getSnapshot()), /internal only|explicitly public/); assert.equal(f.memory.get(key), raw);
    f.report(); assert.equal(f.c.requiresLeaveWarning(), true); assert.equal(f.c.navigate("close"), false); assert.equal(f.memory.get(key), raw);
  }
});
test("self recovers pinned own discussion but never reads the owner's internal slot", () => {
  const f = fixture({ ...owner, access: "self" }); f.memory.set(reviewKey, "broken owner data"); f.memory.set(discussionKey("self"), discussionPending("self"));
  f.c.initialize(); assert.deepEqual(f.c.getSnapshot().target, { ...discussion, workerId }); assert.ok(!f.keys.includes(reviewKey));
});
test("unreadable, oversized, wrong-actor and conflicting pending records fail closed without deleting", () => {
  for (const entries of [[[reviewKey, "bad"]], [[discussionKey(), "x".repeat(4097)]], [[reviewKey, reviewPending().replace(actorId, id(99))]],
    [[reviewKey, reviewPending()], [discussionKey(), discussionPending()]], [[discussionKey(), discussionPending("self")]]] as [string, string][][]) {
    const f = fixture(); entries.forEach(([k, v]) => f.memory.set(k, v)); const before = [...f.memory]; f.c.initialize();
    assert.equal(f.c.getSnapshot().blocked, true); assert.equal(f.c.getSnapshot().target, null); assert.deepEqual([...f.memory], before);
    assert.equal(f.c.navigate("close"), true);
  }
});
test("new pending data at navigation time overrides remembered child ready state", () => {
  const f = fixture(); f.c.initialize(); f.report(); f.memory.set(discussionKey(), discussionPending());
  f.c.navigate(review); assert.deepEqual(f.c.getSnapshot().target, discussion); assert.equal(f.memory.size, 1);
});
test("runtime storage errors do not drop edits or persisted intent", () => {
  const c = new AttendanceExceptionWorkspace(owner, () => ({ getItem: () => { throw Error("denied"); } }));
  c.initialize(); assert.equal(c.getSnapshot().blocked, true); assert.equal(c.requiresLeaveWarning(), true);
  assert.throws(() => exceptionWorkspaceRecovery({ getItem: () => null }, { ...owner, siteId: "*" }));
});
test("child read updates navigation selection without changing mount props; a new list drops stale selected event", () => {
  const f = fixture(); f.c.initialize(); f.report(); f.c.navigate(discussion);
  const initial = f.c.getSnapshot().target, token = f.c.getSnapshot().token;
  f.report({ eventId, viewReady: true }); assert.equal(f.c.getSnapshot().selected.eventId, eventId);
  f.report({ busy: true }); assert.equal(f.c.getSnapshot().selected.eventId, eventId);
  f.report({ viewReady: true }); assert.equal(f.c.getSnapshot().selected.eventId, null);
  assert.equal(f.c.getSnapshot().target, initial); assert.equal(f.c.getSnapshot().token, token);
});

test("clean authorized exception view leaves without a misleading unsaved prompt", () => {
  const f = fixture(); f.c.initialize(); f.report({ eventId });
  assert.equal(f.c.externalLeaveMessage(), null);
  assert.equal(f.c.confirmExternalLeave(() => { throw Error("clean_view_must_not_prompt"); }), true);
});

test("outer draft warning distinguishes unsent text and never mutates on cancel or accept", () => {
  const f = fixture(); f.c.initialize(); f.report({ eventId }); f.c.edit();
  const before = f.c.getSnapshot();
  for (const decision of [false, true]) {
    const messages: string[] = [];
    assert.equal(f.c.confirmExternalLeave(message => { messages.push(message); return decision; }), decision);
    assert.equal(messages.length, 1); assert.match(messages[0], /尚未提交的文字/);
    assert.doesNotMatch(messages[0], /结果仍待确认/);
    assert.equal(f.c.getSnapshot(), before); assert.equal(f.memory.size, 0);
  }
});

test("stored intent outranks dirty draft even before the child reports pending", () => {
  for (const access of ["owner", "self"] as const) {
    const f = fixture({ ...owner, access }); f.c.initialize(); f.report(); f.c.edit();
    const key = discussionKey(access), raw = discussionPending(access); f.memory.set(key, raw);
    const before = f.c.getSnapshot(); assert.equal(before.pendingId, null);
    for (const decision of [false, true]) {
      assert.equal(f.c.confirmExternalLeave(message => {
        assert.match(message, /结果仍待确认/); assert.match(message, /不会撤销/); assert.match(message, /不会删除原编号/);
        assert.doesNotMatch(message, /explicitly public|internal only/); return decision;
      }), decision);
      assert.equal(f.memory.get(key), raw); assert.equal(f.c.getSnapshot(), before);
    }
  }
});

test("child-reported pending remains uncertain until a receipt report, not just empty storage", () => {
  const f = fixture(); f.c.initialize(); f.report({ eventId }); f.c.edit(); f.report({ pendingId: op });
  assert.match(f.c.externalLeaveMessage()!, /结果仍待确认/);
  f.report({ receiptId: op, eventId });
  assert.equal(f.c.getSnapshot().dirty, false); assert.equal(f.c.externalLeaveMessage(), null);
  f.c.edit(); assert.match(f.c.externalLeaveMessage()!, /尚未提交/);
});

test("read in progress is not called a committed or unsent operation", () => {
  const f = fixture(); f.c.initialize();
  assert.match(f.c.externalLeaveMessage()!, /正在读取考勤资料/);
  assert.doesNotMatch(f.c.externalLeaveMessage()!, /结果仍待确认|尚未提交的文字/);
  f.report(); assert.equal(f.c.externalLeaveMessage(), null);
});

test("malformed or conflicting recovery warns without deleting or revealing notes", () => {
  const f = fixture(); f.c.initialize(); f.report();
  for (const entries of [[[reviewKey, "malformed-private-raw"]], [[reviewKey, reviewPending()], [discussionKey(), discussionPending()]]] as [string, string][][]) {
    f.memory.clear(); for (const [key, raw] of entries) f.memory.set(key, raw);
    const before = [...f.memory];
    assert.equal(f.c.confirmExternalLeave(message => {
      assert.match(message, /暂不可读或存在冲突/); assert.doesNotMatch(message, /malformed-private-raw|internal only|explicitly public/); return true;
    }), true);
    assert.deepEqual([...f.memory], before);
  }
});

test("unavailable recovery storage warns without blocking explicit outer departure", () => {
  const c = new AttendanceExceptionWorkspace(owner, () => { throw Error("storage_denied"); }); c.initialize();
  assert.equal(c.confirmExternalLeave(message => { assert.match(message, /暂不可读/); return false; }), false);
  assert.equal(c.confirmExternalLeave(() => true), true);
  assert.equal(c.getSnapshot().blocked, true);
});

test("hidden owner configuration warning is retained and combined into a single confirmation", () => {
  const f = fixture(); f.c.initialize(); f.report();
  const parentWarning = "考勤配置页可能仍有未提交的输入；离开会丢弃这些输入，不会自动保存。";
  for (const pending of [false, true]) {
    if (pending) f.memory.set(reviewKey, reviewPending());
    for (const decision of [false, true]) {
      const messages: string[] = [];
      assert.equal(f.c.confirmExternalLeave(message => { messages.push(message); return decision; }, parentWarning), decision);
      assert.equal(messages.length, 1); assert(messages[0].includes(parentWarning));
      if (pending) { assert.match(messages[0], /结果仍待确认/); assert.equal(f.memory.get(reviewKey), reviewPending()); }
      else assert.doesNotMatch(messages[0], /结果仍待确认/);
    }
  }
});
