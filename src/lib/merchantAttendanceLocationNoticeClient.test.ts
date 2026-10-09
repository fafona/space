import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceNoticeClient } from "./merchantAttendanceLocationNoticeClient";
import { createNoticeFixture, noticeQuery, noticeId as id, noticeOwner, noticeEmployee } from "../../scripts/fixtures/attendance-location-notice-model";
function setup() {
  const f = createNoticeFixture(), memory = new Map<string, string>(); let serial = 20;
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  const create = (access: "owner" | "self" = "owner", patch: Partial<ConstructorParameters<typeof AttendanceNoticeClient>[0]> = {}) => new AttendanceNoticeClient({ query: noticeQuery(access), actorId: access === "self" ? noticeEmployee : noticeOwner,
    apiFetch: f.apiFetch, storage: () => storage, randomId: () => id(serial++), timeoutMs: 25, ...patch });
  const owner = create(), self = create("self"); const publish = async () => { await owner.initialize(); await owner.submit("publish", "Public reason"); assert.equal(owner.getSnapshot().phase, "ready"); };
  return { ...f, create, owner, self, memory, storage, publish };
}
test("constructor is inert and reading a published notice never acknowledges", async () => {
  const f = setup(); assert.equal(f.calls.length, 0); await f.publish(); await f.self.initialize();
  assert.equal(f.self.getSnapshot().result?.canAcknowledge, true); assert.equal(f.self.getSnapshot().result?.acknowledgedAt, null); assert.equal(f.writes(), 1);
});
test("explicit acknowledgement is saved and old acknowledgement does not cover republished policy", async () => {
  const f = setup(); await f.publish(); await f.self.initialize(); await f.self.submit("acknowledge"); assert.ok(f.self.getSnapshot().result?.acknowledgedAt);
  await f.owner.submit("withdraw", "Withdraw"); await f.owner.submit("publish", "Publish again"); await f.self.initialize(); assert.equal(f.self.getSnapshot().result?.canAcknowledge, true); assert.equal(f.self.getSnapshot().result?.acknowledgedAt, null);
});
test("lost publication is recovered GET-only on remount, including at another selected location", async () => {
  const f = setup(); await f.owner.initialize(); f.mode("lost"); await f.owner.submit("publish", "Public reason"); assert.ok(f.owner.getSnapshot().pending); const n = f.calls.length;
  const remount = f.create("owner", { query: { ...noticeQuery(), locationId: id(99) } }); await remount.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(remount.getSnapshot().pending, null); assert.equal(f.writes(), 1);
  await remount.submit("withdraw", "Wrong place"); assert.equal(f.writes(), 1);
});
test("lost acknowledgement recovers the original receipt without asking for position or another confirmation", async () => {
  const f = setup(); await f.publish(); await f.self.initialize(); f.mode("lost"); await f.self.submit("acknowledge"); const n = f.calls.length;
  await f.self.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.self.getSnapshot().pending, null); assert.equal(f.writes(), 2);
});
test("unsent writes retry only after successful GET using the original payload", async () => {
  const f = setup(); await f.owner.initialize(); f.mode("unsent"); await f.owner.submit("publish", "Original"); const old = f.calls.at(-1)!.body; f.mode("normal"); const n = f.calls.length;
  await f.owner.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)!.body, old); assert.equal(f.writes(), 1);
});
test("revocation, rebinding, wrong actor/site and failed receipt lookup never auto resend", async () => {
  for (const mode of ["denied", "rebound", "wrong_actor", "wrong_site", "offline", "timeout"]) {
    const f = setup(); await f.publish(); await f.self.initialize(); f.mode("unsent"); await f.self.submit("acknowledge"); f.mode(mode); const n = f.calls.length; await f.self.retry();
    assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.ok(f.self.getSnapshot().pending); assert.equal(f.self.getSnapshot().result, null);
  }
});
test("newer draft and changed configuration fence an old unsent publication", async () => {
  for (const advance of ["editDraft", "advanceConfig"] as const) {
    const f = setup(); await f.owner.initialize(); f.mode("unsent"); await f.owner.submit("publish", "Original"); f[advance](); f.mode("normal"); await f.owner.retry();
    assert.equal(f.owner.getSnapshot().pending, null); assert.equal(f.writes(), 0); assert.match(f.owner.getSnapshot().message, /原请求不能再写入/);
  }
});
for (const action of ["publish", "withdraw"] as const) {
  test(`settings-only advancement ${action === "publish" ? "fences unsent publication without POST" : "preserves unsent withdrawal for explicit original-payload retry"}`, async () => {
    const f = setup(); if (action === "withdraw") await f.publish();
    let settingsAdvanced = false;
    // This client-only response variation changes no location, draft or notice
    // revision. SQL authorization and version semantics have separate coverage.
    const apiFetch: typeof f.apiFetch = async (url, init) => {
      const response = await f.apiFetch(url, init), body = await response.json();
      if (settingsAdvanced && body.ok) { body.settingsVersion++; body.canPublish = false; body.noticeCurrent = false; }
      return Response.json(body, { status: response.status });
    };
    const c = f.create("owner", { apiFetch }); await c.initialize(); const before = c.getSnapshot().result!;
    f.mode("unsent"); await c.submit(action, "Original settings-version intent");
    const original = c.getSnapshot().pending!, raw = f.memory.get(c.storageKey), originalBody = f.calls.at(-1)!.body;
    assert.ok(raw); assert.equal(original.command.action, action); assert.equal(f.writes(), action === "withdraw" ? 1 : 0);
    settingsAdvanced = true; f.mode("normal"); if (action === "withdraw") f.enabled(false);
    const restored = f.create("owner", { apiFetch }), n = f.calls.length; await restored.initialize();
    assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"]);
    assert.equal(new URL(f.calls[n].url, "https://fixture.test").searchParams.get("operationId"), original.command.operationId);
    const result = restored.getSnapshot().result!;
    assert.equal(result.settingsVersion, before.settingsVersion + 1); assert.deepEqual(result.location, before.location);
    assert.deepEqual(result.current, before.current); assert.deepEqual(result.draft, before.draft); assert.equal(result.receipt, null);
    if (action === "publish") {
      assert.equal(restored.getSnapshot().phase, "ready"); assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.get(c.storageKey), undefined);
      assert.match(restored.getSnapshot().message, /原请求不能再写入/); await restored.retry(); await restored.submit("publish", "Must reread a new draft");
      assert.equal(f.calls.length, n + 1); assert.equal(f.writes(), 0);
    } else {
      assert.equal(result.moduleEnabled, false); assert.equal(result.canWithdraw, true); assert.equal(restored.getSnapshot().phase, "unconfirmed");
      assert.deepEqual(restored.getSnapshot().pending, original); assert.equal(f.memory.get(c.storageKey), raw); assert.equal(f.writes(), 1);
      const retryAt = f.calls.length; await restored.retry();
      assert.deepEqual(f.calls.slice(retryAt).map(call => call.method), ["GET", "POST"]);
      assert.equal(new URL(f.calls[retryAt].url, "https://fixture.test").searchParams.get("operationId"), original.command.operationId);
      assert.equal(f.calls.at(-1)!.body, originalBody); assert.equal(restored.getSnapshot().result?.receipt?.operationId, original.command.operationId);
      assert.equal(restored.getSnapshot().result?.receipt?.action, "withdraw"); assert.equal(restored.getSnapshot().result?.current?.revision, before.current!.revision + 1);
      assert.equal(restored.getSnapshot().phase, "ready"); assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.get(c.storageKey), undefined); assert.equal(f.writes(), 2);
    }
  });
}
test("pause prevents new publication retry but permits withdrawal and acknowledgement", async () => {
  const f = setup(); await f.owner.initialize(); f.mode("unsent"); await f.owner.submit("publish", "Original"); f.mode("normal"); f.enabled(false); const n = f.calls.length; await f.owner.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.ok(f.owner.getSnapshot().pending);
  f.enabled(true); await f.owner.retry(); f.enabled(false); await f.self.initialize(); await f.self.submit("acknowledge"); await f.owner.initialize(); await f.owner.submit("withdraw", "Paused withdrawal"); assert.equal(f.writes(), 3);
});
test("first definite refusal may clear intent, but uncertain retry refusal preserves it", async () => {
  const f = setup(); await f.owner.initialize(); f.mode("reject"); await f.owner.submit("publish", "Refused"); assert.equal(f.owner.getSnapshot().pending, null);
  f.mode("normal"); await f.owner.initialize(); f.mode("unsent"); await f.owner.submit("publish", "Unknown"); f.mode("reject"); await f.owner.retry(); assert.ok(f.owner.getSnapshot().pending);
});
test("double clicks and hidden view do not repeat writes or display late personal responses", async () => {
  const f = setup(); await f.owner.initialize(); f.mode("post_timeout"); const work = Promise.all([f.owner.submit("publish", "A"), f.owner.submit("publish", "B")]);
  await new Promise(r => setImmediate(r)); f.owner.pause(); await work; assert.equal(f.owner.getSnapshot().result, null); assert.ok(f.owner.getSnapshot().pending); const n = f.calls.length;
  await f.owner.retry(); assert.equal(f.calls.length, n); f.mode("normal"); await f.owner.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});
test("storage failure, tampering and competing pending records cannot be overwritten or removed", async () => {
  const f = setup(), bad = f.create("owner", { storage: () => ({ ...f.storage, setItem: () => { throw Error("blocked"); } }) });
  await bad.initialize(); await bad.submit("publish", "A"); assert.equal(f.writes(), 0);
  await f.owner.initialize(); f.mode("unsent"); await f.owner.submit("publish", "Original"); const p = JSON.parse(f.memory.get(f.owner.storageKey)!); p.command.operationId = id(99); f.memory.set(f.owner.storageKey, JSON.stringify(p)); const n = f.calls.length;
  await f.owner.retry(); assert.equal(f.calls.length, n); assert.equal(JSON.parse(f.memory.get(f.owner.storageKey)!).command.operationId, id(99));
  p.command.siteId = "99990002"; f.memory.set(f.owner.storageKey, JSON.stringify(p)); const remount = f.create(); await remount.initialize(); assert.equal(remount.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, n);
});
