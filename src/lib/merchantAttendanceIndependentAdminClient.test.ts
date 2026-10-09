import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { AttendanceIndependentAdminClient, independentAdminPendingKey, type IndependentAdminStorage } from "./merchantAttendanceIndependentAdminClient";
import { independentUiAdmin, independentUiCommand, independentUiDetailQuery, independentUiId as id, independentUiOwner as actorId,
  independentUiReceipt, independentUiSite as siteId, independentUiSubject } from "../../scripts/fixtures/attendance-independent-ui-model";
const query = independentUiDetailQuery;
const key = independentAdminPendingKey(siteId, actorId);
function memory(): IndependentAdminStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map<string, string>(), writes: string[] = [];
  return { values, writes, getItem: k => values.get(k) ?? null, setItem: (k, v) => { writes.push(v); values.set(k, v); }, removeItem: k => { values.delete(k); } };
}
const reply = (data: unknown) => Response.json({ ok: true, data });
function client(apiFetch: AttendanceApiFetch, storage = memory(), current = () => true, timeoutMs = 12000) {
  return { c: new AttendanceIndependentAdminClient({ siteId, actorId, apiFetch, storage: () => storage, isCurrent: current, timeoutMs }), storage };
}
test("196 owner initialization is local, explicit reads are strict GET only and cannot impersonate another scope", async () => {
  let calls = 0; const subject = independentUiSubject();
  const { c } = client(async (url, init) => { calls++; assert.match(String(url), /mode=list/); assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store");
    return reply(independentUiAdmin({ kind: "list", items: [subject], nextCursor: null })); });
  assert.equal(await c.load(), null); assert.equal(calls, 0);
  assert.equal((await c.read({ siteId, mode: "list", cursor: null, search: "", state: "all" })).data.kind, "list"); assert.equal(calls, 1);
  await assert.rejects(c.read({ ...query(), siteId: "99990001" }));
  await assert.rejects(c.read({ siteId, mode: "recover", subjectId: subject.subjectId, operationId: id(20) })); assert.equal(calls, 1);
});
test("196 exact nonsecret intent is durable before one POST; even success clears only after matching original GET", async () => {
  const saved = await independentUiReceipt(), storage = memory(); let calls = 0;
  const { c } = client(async (url, init) => { calls++; assert(storage.values.has(key));
    if (calls === 1) { assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init?.body)), { query: query(), command: independentUiCommand() }); }
    else { assert.equal(init?.method, "GET"); assert.match(String(url), /mode=recover/); }
    return reply(saved); }, storage);
  await c.post(query(), independentUiCommand()); assert(storage.values.has(key));
  assert.equal((await c.load())?.command.operationId, id(20)); assert.equal(calls, 1);
  await assert.rejects(c.post(query(), independentUiCommand())); await assert.rejects(c.read(query())); assert.equal(calls, 1);
  await c.recover(); assert.equal(storage.values.has(key), false); assert.equal(calls, 2);
});
test("196 issue PIN is transient only, no PIN/verifier/cookie in pending or GET recovery; body captured before await", async () => {
  const command = independentUiCommand("issue_pin"), original = structuredClone(command), saved = await independentUiReceipt(command), storage = memory(); let calls = 0;
  const { c } = client(async (url, init) => { calls++; const local = storage.values.get(key)!;
    assert.doesNotMatch(local, /"pin"|12345678|verifier|pepper|secret|cookie/);
    if (calls === 1) { const body = JSON.parse(String(init?.body)); assert.equal(body.pin, "12345678"); assert.deepEqual(body.command, original); }
    else { assert.equal(init?.method, "GET"); assert.doesNotMatch(String(url), /12345678|pin=/); }
    return reply(saved); }, storage);
  const posting = c.post(query(), command, "12345678"); Object.assign(command, { reason: "调用方随后改动" }); await posting;
  assert.deepEqual((await c.load())?.command, original); await c.recover(); assert.equal(calls, 2); assert.equal(storage.values.size, 0);
  await assert.rejects(c.post(query(), independentUiCommand("issue_pin"))); assert.equal(calls, 2);
});
test("196 malformed/foreign pending and failed persistence never overwrite or dispatch", async () => {
  const storage = memory(); storage.values.set(key, "not json"); let calls = 0;
  const { c } = client(async () => { calls++; assert.fail(); }, storage);
  await assert.rejects(c.load()); await assert.rejects(c.post(query(), independentUiCommand())); await assert.rejects(c.recover());
  assert.equal(storage.values.get(key), "not json"); assert.equal(calls, 0);
  const bad = new AttendanceIndependentAdminClient({ siteId, actorId, apiFetch: async () => { calls++; assert.fail(); }, storage: () => ({ getItem: () => null,
    setItem: () => { throw Error("disk full"); }, removeItem: () => { assert.fail(); } }) });
  await assert.rejects(bad.post(query(), independentUiCommand())); assert.equal(calls, 0);
});
test("196 null, foreign, damaged, oversized, invalid UTF8 and failed recovery retain the number without any retry", async () => {
  const saved = await independentUiReceipt(); const responses = [reply(independentUiAdmin({ kind: "receipt" })),
    reply({ ...saved, actorId: id(99) }), reply({ ...saved, receipt: { ...saved.receipt, commandFingerprint: "a".repeat(64) } }),
    new Response("no", { status: 404 }), new Response("bad", { headers: { "content-type": "text/html" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response("a".repeat(1048577), { headers: { "content-type": "application/json" } })];
  for (const response of responses) { let calls = 0; const { c, storage } = client(async () => { calls++; return calls === 1 ? reply(saved) : response; });
    await c.post(query(), independentUiCommand()); const raw = storage.values.get(key); await assert.rejects(c.recover());
    assert.equal(storage.values.get(key), raw); assert.equal(calls, 2); }
});
test("196 pause/current Auth/storage replacement reject late POST and GET while keeping the relevant pending bytes", async () => {
  function deferredRequest() {
    let enter!: () => void, release!: (response: Response) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const response = new Promise<Response>(resolve => { release = resolve; });
    return { entered, response, enter, release };
  }
  async function enteredBeforeCompletion(entered: Promise<void>, operation: Promise<unknown>, label: string) {
    await Promise.race([entered, operation.then(
      () => { assert.fail(`${label} resolved before entering apiFetch`); },
      () => { assert.fail(`${label} rejected before entering apiFetch`); },
    )]);
  }
  const saved = await independentUiReceipt(), postRequest = deferredRequest(), replacedRequest = deferredRequest(), pausedRequest = deferredRequest();
  const requests = [postRequest, replacedRequest, pausedRequest]; let calls = 0, current = true;
  const { c, storage } = client(async (_, init) => {
    const request = requests[calls++]; assert(request); assert.equal(init?.method, calls === 1 ? "POST" : "GET");
    request.enter(); return request.response;
  }, memory(), () => current);
  const pending = c.post(query(), independentUiCommand()); await enteredBeforeCompletion(postRequest.entered, pending, "admin POST");
  const raw = storage.values.get(key); current = false; postRequest.release(reply(saved));
  await assert.rejects(pending); assert.equal(storage.values.get(key), raw); current = true;
  const recovering = c.recover(); await enteredBeforeCompletion(replacedRequest.entered, recovering, "replacement receipt GET");
  storage.values.set(key, "replacement intent"); replacedRequest.release(reply(saved));
  await assert.rejects(recovering); assert.equal(storage.values.get(key), "replacement intent"); assert.equal(calls, 2);
  storage.values.set(key, raw!); const paused = c.recover(); await enteredBeforeCompletion(pausedRequest.entered, paused, "paused receipt GET");
  c.pause(); pausedRequest.release(reply(saved));
  await assert.rejects(paused); assert.equal(storage.values.get(key), raw); assert.equal(calls, 3);
});
test("196 one bounded request deadline and busy guard prevent automatic repeat or late parsing acceptance", async () => {
  let calls = 0; const { c, storage } = client(async () => { calls++; return new Promise<Response>(() => {}); }, memory(), () => true, 8);
  const attempt = c.post(query(), independentUiCommand()); await assert.rejects(c.post(query(), independentUiCommand()));
  await assert.rejects(attempt); assert.equal(calls, 1); assert(storage.values.has(key));
});
