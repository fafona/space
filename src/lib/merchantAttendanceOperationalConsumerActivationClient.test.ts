import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceOperationalConsumerActivationClient, operationalConsumerActivationPendingKey, parseOperationalConsumerActivationPending } from "./merchantAttendanceOperationalConsumerActivationClient";
import { type OperationalConsumerActivationCommand } from "./merchantAttendanceOperationalConsumerActivation";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import * as f from "./merchantAttendanceOperationalConsumerActivationTestFixtures";
const key = operationalConsumerActivationPendingKey(f.activationSite, f.activationActor, "application_window");

test("201 reminder activation uses local initialization, one persisted full-SHA POST and flagoff explicit original GET only", async () => {
  const storage = new f.ActivationMemoryStorage(), query = { ...f.activationQuery, consumer: "reminders" as const },
    reminderKey = operationalConsumerActivationPendingKey(f.activationSite, f.activationActor, "reminders"), calls: string[] = [];
  let receipt: Awaited<ReturnType<typeof f.activationItem>> | null = null;
  const c = client(storage, async (path, init) => { calls.push(init!.method!); if (init?.method === "GET") { assert.match(path, /consumer=reminders/); return f.activationResponse({ ...f.activationResult(), consumer: "reminders" }); }
    const command: OperationalConsumerActivationCommand = JSON.parse(init!.body as string).command;
    const pending = await parseOperationalConsumerActivationPending(storage.getItem(reminderKey)!, { siteId: f.activationSite, consumer: "reminders", actorId: f.activationActor });
    assert.deepEqual(pending.command, command); assert.deepEqual(pending.query, query); receipt = await f.activationItem(command);
    return new Response('{"ok":true', { headers: { "content-type": "application/json" } }); }, { consumer: "reminders" });
  await c.initialize(); assert.equal(calls.length, 0); await c.load(); await c.submit("activate", "明确启用新来源提醒");
  const original = storage.getItem(reminderKey); assert(original); assert.equal(storage.getItem(key), null); assert.deepEqual(calls, ["GET", "POST"]); c.dispose();
  let found = false; const restored = client(storage, async (path, init) => { calls.push(init!.method!); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); assert.match(path, /consumer=reminders/); assert.match(path, /mode=recover/);
    return f.activationResponse({ ...f.activationResult(null, found ? receipt : null, false), consumer: "reminders" }); }, { consumer: "reminders", enabled: false });
  await restored.initialize(); await restored.load(); await restored.submit("activate", "不能重发"); assert.equal(calls.length, 2);
  await restored.recover(); assert.equal(storage.getItem(reminderKey), original); found = true; await restored.recover(); assert.equal(storage.getItem(reminderKey), null);
  assert.deepEqual(calls, ["GET", "POST", "GET", "GET"]); assert.equal(restored.getSnapshot().result?.canActivate, false); restored.dispose();
});

test("194 pending keys and hashes isolate consumers and snapshot caller scope before SHA", async t => {
  const bytes = await f.activationPendingBytes(), scope = { siteId: f.activationSite, actorId: f.activationActor, consumer: "application_window" as const };
  assert.notEqual(key, operationalConsumerActivationPendingKey(f.activationSite, f.activationActor, "reminders"));
  await assert.rejects(parseOperationalConsumerActivationPending(bytes, { ...scope, consumer: "reminders" }));
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { scope.actorId = f.activationId(99); return digest(...args); });
  assert.equal((await parseOperationalConsumerActivationPending(bytes, scope)).actorId, f.activationActor);
});
function client(storage: f.ActivationMemoryStorage, apiFetch: AttendanceApiFetch, extra: Partial<ConstructorParameters<typeof AttendanceOperationalConsumerActivationClient>[0]> = {}) { return new AttendanceOperationalConsumerActivationClient({ siteId: f.activationSite, consumer: "application_window", actorId: f.activationActor, enabled: true, apiFetch, storage: () => storage, randomId: () => f.activationId(10), ...extra }); }
test("194 activation local initialize, explicit GET and single persisted POST; receipt never restores CAS", async () => {
  const storage = new f.ActivationMemoryStorage(), calls: string[] = []; const c = client(storage, async (_, init) => { calls.push(init!.method!); if (init?.method === "GET") return f.activationResponse(f.activationResult());
    const command = JSON.parse(init!.body as string).command as OperationalConsumerActivationCommand; assert.equal((await parseOperationalConsumerActivationPending(storage.getItem(key)!, { siteId: f.activationSite, consumer: "application_window", actorId: f.activationActor })).command.operationId, command.operationId); return f.activationResponse(await f.activationSaved(command)); });
  await c.initialize(); assert.deepEqual(calls, []); await c.submit("activate", "no read"); assert.deepEqual(calls, []); await c.load(); await c.submit("activate", f.activationCommand().reason); assert.deepEqual(calls, ["GET", "POST"]); assert.equal(storage.length, 0);
  await c.submit("deactivate", "must reread"); assert.deepEqual(calls, ["GET", "POST"]); c.dispose();
});
test("194 lost POST body retains exact original intent; reload/flag-off only GET recover, null never clears", async () => {
  const storage = new f.ActivationMemoryStorage(); let saved: Awaited<ReturnType<typeof f.activationSaved>> | null = null;
  const c = client(storage, async (_, init) => { if (init?.method === "GET") return f.activationResponse(f.activationResult()); saved = await f.activationSaved(JSON.parse(init!.body as string).command); return new Response('{"ok":true', { headers: { "content-type": "application/json" } }); });
  await c.initialize(); await c.load(); await c.submit("activate", f.activationCommand().reason); const bytes = storage.getItem(key)!; assert.ok(bytes); assert.equal(c.getSnapshot().phase, "unconfirmed"); c.dispose();
  const calls: string[] = []; let found = false; const restored = client(storage, async (path, init) => { calls.push(path); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); assert.match(path, /mode=recover/); return f.activationResponse(f.activationResult(null, found ? saved!.receipt : null, false)); }, { enabled: false });
  await restored.initialize(); await restored.load(); assert.equal(calls.length, 0); await restored.recover(); assert.equal(storage.getItem(key), bytes); found = true; await restored.recover(); assert.equal(storage.getItem(key), null); assert.equal(calls.length, 2); await restored.submit("activate", "not CAS"); assert.equal(calls.length, 2); restored.dispose();
});
test("194 flag-off allows explicit fresh safe deactivate but no activate", async () => {
  const storage = new f.ActivationMemoryStorage(), head = await f.activationItem(); const calls: string[] = [];
  const c = client(storage, async (_, init) => { calls.push(init!.method!); return init?.method === "GET" ? f.activationResponse(f.activationResult(head)) : f.activationResponse(await f.activationSaved(JSON.parse(init!.body as string).command)); }, { enabled: false });
  await c.initialize(); await c.load(); await c.submit("activate", "denied"); assert.deepEqual(calls, ["GET"]); await c.submit("deactivate", "明确停用"); assert.deepEqual(calls, ["GET", "POST"]); c.dispose();
});
test("194 replacement storage cannot be deleted by a valid late original receipt", async () => {
  const storage = new f.ActivationMemoryStorage(), original = await f.activationPendingBytes(), replacement = await f.activationPendingBytes({ ...f.activationCommand(), operationId: f.activationId(98) }); storage.setItem(key, original);
  const c = client(storage, async () => { storage.setItem(key, replacement); return f.activationResponse(f.activationResult(null, await f.activationItem(), false)); }); await c.initialize(); await c.recover(); assert.equal(storage.getItem(key), replacement); assert.equal(c.getSnapshot().result, null); c.dispose();
});
test("194 authorization loss during POST preserves original number and hides late body", async () => {
  const storage = new f.ActivationMemoryStorage(); let current = true; const c = client(storage, async (_, init) => { if (init?.method === "GET") return f.activationResponse(f.activationResult()); const saved = await f.activationSaved(JSON.parse(init!.body as string).command); current = false; return f.activationResponse(saved); }, { isCurrentAuth: () => current });
  await c.initialize(); await c.load(); await c.submit("activate", "核准启用"); assert.ok(storage.getItem(key)); assert.equal(c.getSnapshot().result, null); c.dispose();
});
test("194 hanging initialize digest is deadline-bounded and cannot alter persisted bytes", async t => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes); let calls = 0;
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(() => {})); const c = client(storage, async () => { calls++; throw Error("no HTTP"); }, { timeoutMs: 15 });
  await c.initialize(); assert.equal(c.getSnapshot().phase, "blocked"); assert.equal(storage.getItem(key), bytes); assert.equal(calls, 0); c.dispose();
});
test("194 delayed write digest cannot persist or POST after deadline", async t => {
  const storage = new f.ActivationMemoryStorage(); let calls = 0; const c = client(storage, async () => { calls++; return f.activationResponse(f.activationResult()); }, { timeoutMs: 15 }); await c.initialize(); await c.load();
  const digest = crypto.subtle.digest.bind(crypto.subtle); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { await gate; return digest(...args); });
  await c.submit("activate", "超时不能送出"); release(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(storage.length, 0); assert.equal(calls, 1); c.dispose();
});
test("194 stalled POST response body times out with pending intact", async () => {
  const storage = new f.ActivationMemoryStorage(); let canceled = false; const c = client(storage, async (_, init) => init?.method === "GET" ? f.activationResponse(f.activationResult()) : new Response(new ReadableStream({ pull: () => new Promise<void>(() => {}), cancel: () => { canceled = true; } }), { headers: { "content-type": "application/json" } }), { timeoutMs: 20 });
  await c.initialize(); await c.load(); await c.submit("activate", "网络未确认"); assert.ok(storage.getItem(key)); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(canceled, true); c.dispose();
});
test("194 wrong saved hash and arbitrary rejection messages never clear pending", async () => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes);
  const c = client(storage, async () => f.activationResponse(f.activationResult(null, { ...await f.activationItem(), commandFingerprint: "a".repeat(64) }, false))); await c.initialize(); await c.recover(); assert.equal(storage.getItem(key), bytes); c.dispose();
  const bad = client(storage, async () => { throw Error("attendance_operational_consumer_unchanged"); }); await bad.initialize(); await bad.recover(); assert.equal(storage.getItem(key), bytes); bad.dispose();
});

