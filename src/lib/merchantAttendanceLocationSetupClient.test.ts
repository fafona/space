import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLocationSetupClient } from "./merchantAttendanceLocationSetupClient";
import { createLocationSetupModel, setupOwner, setupQuery } from "../../scripts/fixtures/attendance-location-setup-model";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const model = createLocationSetupModel(), memory = new Map<string, string>(); let op = 10;
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const requests: { url: string; method: string; body: string | null }[] = [];
  const apiFetch: typeof model.apiFetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET", body: init.body ? String(init.body) : null }); return model.apiFetch(url, init);
  };
  const create = (overrides: Partial<ConstructorParameters<typeof AttendanceLocationSetupClient>[0]> = {}) => new AttendanceLocationSetupClient({ query: setupQuery, ownerId: setupOwner, apiFetch, storage: () => storage, randomId: () => id(op++), timeoutMs: 30, ...overrides });
  return { model, memory, storage, create, requests };
}
test("setup constructor/read is inert; prepare, publish, enable are distinct actions", async () => {
  const f = fixture(), c = f.create(); assert.deepEqual(f.model.metrics(), { reads: 0, posts: 0 });
  await c.initialize(); assert.equal(f.model.metrics().posts, 0); await c.submit("prepare", "Apply selected draft");
  assert.equal(c.getSnapshot().result?.channelEnabled, false); assert.equal(c.getSnapshot().result?.notice, null); assert.equal(c.getSnapshot().result?.draft?.revision, 2);
  await c.submit("enable", "Too early"); assert.equal(f.model.metrics().posts, 1);
  f.model.publish(); await c.initialize(); await c.submit("enable", "Explicit enterprise enable"); assert.equal(c.getSnapshot().result?.channelEnabled, true); assert.equal(f.memory.size, 0);
});
test("lost response recovers original setup receipt without another write", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("lost"); await c.submit("prepare", "Apply");
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.size, 1);
  assert.doesNotMatch([...f.memory.values()][0], /latitude|longitude|fence|retentionDays|noticeText/);
  f.model.mode("normal"); const next = f.create(); await next.initialize(); assert.equal(next.getSnapshot().result?.receipt?.command.operationId, id(10));
  assert.equal(f.model.metrics().posts, 1); assert.equal(f.memory.size, 0);
});
test("undelivered setup retries same ID and content only after explicit fresh GET", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("unsent"); await c.submit("prepare", "Original reason");
  const pending = c.getSnapshot().pending; f.model.mode("normal"); await c.retry();
  assert.deepEqual(c.getSnapshot().result?.receipt?.command, pending?.command); assert.equal(f.model.records.size, 1); assert.equal(f.model.metrics().posts, 2);
});
test("pause works while platform paused and ignores unrelated config-version changes", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.submit("prepare", "Apply"); f.model.publish(); await c.initialize(); await c.submit("enable", "Enable");
  const before = c.getSnapshot().result!; f.model.mode("unsent"); await c.submit("pause", "Pause"); const original = c.getSnapshot().pending!.command;
  const raw = f.memory.get(c.storageKey), originalBody = f.requests.at(-1)!.body, n = f.requests.length; assert.ok(raw);
  f.model.enabled(false); f.model.changeConfig(); f.model.mode("normal"); const restored = f.create(); await restored.initialize();
  assert.deepEqual(f.requests.slice(n).map(r => r.method), ["GET"]); assert.equal(f.memory.get(c.storageKey), raw); assert.deepEqual(restored.getSnapshot().pending?.command, original);
  const current = restored.getSnapshot().result!; assert.equal(current.settingsVersion, before.settingsVersion + 1); assert.equal(current.channelVersion, before.channelVersion);
  assert.deepEqual(current.location, before.location); assert.deepEqual(current.draft, before.draft); assert.deepEqual(current.notice, before.notice);
  assert.equal(current.moduleEnabled, false); assert.equal(current.channelEnabled, true); assert.equal(current.receipt, null); assert.equal(restored.getSnapshot().phase, "unconfirmed");
  const retryAt = f.requests.length; await restored.retry(); assert.deepEqual(f.requests.slice(retryAt).map(r => r.method), ["GET", "POST"]);
  assert.equal(new URL(f.requests[retryAt].url, "https://fixture.test").searchParams.get("operationId"), original.operationId); assert.equal(f.requests.at(-1)!.body, originalBody);
  assert.equal(restored.getSnapshot().result?.channelEnabled, false); assert.deepEqual(restored.getSnapshot().result?.receipt?.command, original); assert.equal(f.memory.size, 0);
});
for (const action of ["prepare", "enable"] as const) {
  test(`settings-only advancement fences an undelivered ${action} without retrying its POST`, async () => {
    const f = fixture(), c = f.create(); await c.initialize();
    if (action === "enable") { await c.submit("prepare", "Apply"); f.model.publish(); await c.initialize(); }
    const before = c.getSnapshot().result!; f.model.mode("unsent"); await c.submit(action, "Original settings-version intent");
    const pending = c.getSnapshot().pending!, oldRecords = structuredClone([...f.model.records]), n = f.requests.length; assert.ok(f.memory.get(c.storageKey));
    f.model.changeConfig(); f.model.mode("normal"); await c.retry();
    assert.deepEqual(f.requests.slice(n).map(r => r.method), ["GET"]);
    assert.equal(new URL(f.requests[n].url, "https://fixture.test").searchParams.get("operationId"), pending.command.operationId);
    const result = c.getSnapshot().result!; assert.equal(result.settingsVersion, before.settingsVersion + 1); assert.equal(result.channelVersion, before.channelVersion);
    assert.equal(result.channelEnabled, before.channelEnabled); assert.deepEqual(result.location, before.location); assert.deepEqual(result.draft, before.draft); assert.deepEqual(result.notice, before.notice);
    assert.equal(result.receipt, null); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().pending, null); assert.equal(f.memory.get(c.storageKey), undefined);
    assert.match(c.getSnapshot().message, /旧命令不能再写入/); assert.deepEqual([...f.model.records], oldRecords);
    await c.retry(); assert.equal(f.requests.length, n + 1); assert.deepEqual([...f.model.records], oldRecords);
  });
}
test("new immutable draft fences an undelivered prepare, while temporary pause preserves it", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("unsent"); await c.submit("prepare", "Apply");
  f.model.enabled(false); f.model.mode("normal"); await c.initialize(); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(f.memory.size, 1);
  f.model.editDraft(); await c.initialize(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().pending, null); assert.equal(c.getSnapshot().result?.receipt, null); assert.equal(f.model.metrics().posts, 1);
});
test("timeout and hide preserve committed operation until explicit receipt recovery", async () => {
  const f = fixture(), c = f.create({ timeoutMs: 5 }); await c.initialize(); f.model.mode("timeout"); const pending = c.submit("prepare", "Apply");
  await new Promise(resolve => setImmediate(resolve)); c.pause(); await pending; assert.equal(c.getSnapshot().result, null); assert.equal(f.memory.size, 1);
  f.model.mode("normal"); await c.initialize(); assert.equal(c.getSnapshot().result?.receipt?.command.operationId, id(10)); assert.equal(f.model.metrics().posts, 1);
});
test("switching locations first recovers old target; cannot mutate a new target from old snapshot", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("lost"); await c.submit("prepare", "Apply A"); f.model.mode("normal");
  const moved = f.create({ query: { ...setupQuery, locationId: id(99) } }); await moved.initialize(); assert.equal(moved.getSnapshot().result?.locationId, setupQuery.locationId);
  await moved.submit("enable", "Must not target A"); assert.equal(f.model.metrics().posts, 1); assert.equal(f.memory.size, 0);
  await moved.initialize(); assert.equal(moved.getSnapshot().phase, "blocked");
});
test("denied, wrong-owner and wrong-site responses retain uncertain operations and clear displayed data", async () => {
  for (const mode of ["denied", "wrong_owner", "wrong_site"]) {
    const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("lost"); await c.submit("prepare", "Apply");
    f.model.mode(mode); await c.initialize(); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().result, null); assert.equal(f.memory.size, 1);
  }
});
test("storage failure, malformed pending and another instance's operation are never overwritten", async () => {
  const f = fixture(), bad = f.create({ storage: () => ({ ...f.storage, setItem() { throw Error("full"); } }) });
  await bad.initialize(); await bad.submit("prepare", "Apply"); assert.equal(f.model.metrics().posts, 0);
  const c = f.create(); await c.initialize(); f.storage.setItem(c.storageKey, "{}"); await c.submit("prepare", "Apply"); assert.equal(f.storage.getItem(c.storageKey), "{}"); assert.equal(f.model.metrics().posts, 0);
});
test("first explicit refusal clears fresh pending but refusal of uncertain retry cannot erase it", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); f.model.mode("rejected"); await c.submit("prepare", "Apply"); assert.equal(f.memory.size, 0);
  f.model.mode("normal"); await c.initialize(); f.model.mode("unsent"); await c.submit("prepare", "Apply");
  f.model.mode("rejected"); await c.retry(); assert.equal(f.memory.size, 1); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
test("a pause receipt remains historical after a later resume, without overwriting current state", async () => {
  const f = fixture(), c = f.create(); await c.initialize(); await c.submit("prepare", "Apply"); f.model.publish(); await c.initialize(); await c.submit("enable", "Enable");
  f.model.mode("lost"); await c.submit("pause", "Pause"); f.model.mode("normal");
  const later = f.model.command(id(90), "enable"); await f.model.apiFetch("/api/merchant-enterprise/attendance/location-setup", { method: "POST", body: JSON.stringify({ siteId: setupQuery.siteId, locationId: setupQuery.locationId, ...later }) });
  await c.initialize(); assert.equal(c.getSnapshot().result?.channelEnabled, true); assert.equal(c.getSnapshot().result?.receipt?.after.channelEnabled, false); assert.equal(f.memory.size, 0);
});

test("ordinary shifts prevent prepare without a POST; late refusals preserve safe retry semantics", async () => {
  const f = fixture(), c = f.create(); f.model.openWebShift(true); await c.initialize();
  await c.submit("prepare", "Must finish first"); assert.equal(f.model.metrics().posts, 0);
  f.model.openWebShift(false); await c.initialize(); f.model.openWebShift(true);
  await c.submit("prepare", "New shift appeared"); assert.equal(f.memory.size, 0); assert.equal(f.model.records.size, 0);
  f.model.openWebShift(false); await c.initialize(); f.model.mode("unsent"); await c.submit("prepare", "Apply later");
  f.model.mode("normal"); f.model.openWebShift(true); const posts = f.model.metrics().posts;
  await c.retry(); assert.equal(f.model.metrics().posts, posts); assert.equal(f.memory.size, 1);
  f.model.openWebShift(false); await c.retry(); assert.equal(f.model.records.size, 1); assert.equal(f.memory.size, 0);
});
