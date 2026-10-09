import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEmploymentLifecycleClient, employmentLifecyclePendingKey, type EmploymentLifecycleClientOptions } from "./merchantAttendanceEmploymentLifecycleClient";
import { parseEmploymentLifecycleHttpQuery, type EmploymentLifecycleCommand } from "./merchantAttendanceEmploymentLifecycle";
import { employmentLifecycleId as id, employmentLifecycleOwner as owner, employmentLifecycleSite as site, employmentLifecycleWorker as worker,
  employmentLifecycleCommand as command, employmentLifecycleHttp as http, employmentLifecycleReceipt as receipt, employmentLifecycleReceiptHttp as receiptHttp,
  employmentLifecycleItem as item } from "../../scripts/fixtures/attendance-employment-lifecycle-model";

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function setup(apiFetch: EmploymentLifecycleClientOptions["apiFetch"], patch: Partial<EmploymentLifecycleClientOptions> = {}) {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const options: EmploymentLifecycleClientOptions = { siteId: site, actorId: owner, enabled: true, apiFetch, storage: () => storage, randomId: () => id(30), ...patch };
  return { data, storage, options };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function lost() {
  const calls: string[] = [], f = setup(async (_, init) => { calls.push(init?.method ?? ""); if (init?.method === "GET") return reply(http()); throw Error("lost_response"); });
  const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(worker); await c.submit("close", command().reason);
  const raw = f.data.get(c.storageKey); assert(raw); return { ...f, c, calls, raw };
}

test("initialize is local; explicit detail and exact once-only close use saved identity/date/versions", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const f = setup(async (path, init) => { calls.push({ path: String(path), init });
    if (init?.method === "POST") { const body = JSON.parse(String(init.body)); assert.deepEqual(body.command, command()); assert.equal(body.query.workerId, worker);
      assert.equal(f.data.size, 1); return reply(await receiptHttp(body.command, "detail")); } return reply(http()); });
  const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); assert.equal(calls.length, 0);
  await c.load(worker); await c.submit("close", command().reason); assert.deepEqual(calls.map(x => x.init?.method), ["GET", "POST"]);
  assert.equal(c.getSnapshot().pending, null); assert.equal(f.data.size, 0); assert.equal(c.getSnapshot().result?.receipt?.action, "close");
  await c.submit("close", command().reason); assert.equal(calls.length, 2, "receipt is not a new preview");
});

test("rejoin uses the previous saved period and server date, not browser now or worker supplied by caller", async () => {
  let posted: EmploymentLifecycleCommand | null = null;
  const f = setup(async (_, init) => { if (init?.method === "POST") { posted = JSON.parse(String(init.body)).command; return reply(await receiptHttp(posted!, "detail")); } return reply(http("detail", "rejoin")); });
  const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(worker); await c.submit("rejoin", command().reason);
  assert.deepEqual(posted, command("rejoin")); assert.equal(c.getSnapshot().result?.receipt?.startsOn, "2026-10-06"); assert.equal(c.getSnapshot().pending, null);
});

test("list and operation history page only explicit cursors; old owners in history are not current-authority claims", async () => {
  const queries: ReturnType<typeof parseEmploymentLifecycleHttpQuery>[] = [];
  const f = setup(async (url, init) => { assert.equal(init?.method, "GET"); const q = parseEmploymentLifecycleHttpQuery("https://test.invalid" + url); queries.push(q);
    if (q.mode === "list") { const r = http("list"); if (q.afterId) { r.items = []; return reply(r); }
      r.items = Array.from({ length: 25 }, (_, n) => { const i = item(); i.worker.id = id(100 + n); return i; }); r.nextAfterId = id(124); return reply(r); }
    const r = http("history"); if (q.afterRevision !== null) { r.history = []; return reply(r); }
    r.history = Array.from({ length: 25 }, (_, n) => receipt({ ...command(n % 2 ? "rejoin" : "close"), expectedRevision: n, operationId: id(200 + n) }));
    r.history[0].actorId = id(900); r.nextAfterRevision = 25; return reply(r);
  });
  const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(); assert.equal(queries.length, 1);
  await c.next(); assert.equal(queries[1].afterId, id(124)); await c.history(worker); assert.equal(c.getSnapshot().result?.history[0].actorId, id(900));
  await c.nextHistory(); assert.equal(queries[3].afterRevision, 25); assert.equal(queries[3].afterId, null); assert.equal(queries[3].workerId, worker);
});

test("unknown response persists original command; reload and flag-off can only GET original receipt", async () => {
  const f = await lost(); assert.deepEqual(f.calls, ["GET", "POST"]); const calls: string[] = [];
  const c = new AttendanceEmploymentLifecycleClient({ ...f.options, enabled: false, apiFetch: async (path, init) => {
    calls.push(init?.method ?? ""); const q = parseEmploymentLifecycleHttpQuery("https://test.invalid" + path); assert.equal(q.mode, "recover"); assert.equal(q.operationId, command().operationId); assert.equal(q.workerId, null);
    return reply(await receiptHttp()); } });
  await c.initialize(); assert.equal(calls.length, 0); await c.load(worker); await c.submit("close", "different"); assert.equal(calls.length, 0);
  assert.equal(f.data.get(c.storageKey), f.raw); await c.recover(); assert.deepEqual(calls, ["GET"]); assert.equal(c.getSnapshot().pending, null); assert.equal(f.data.size, 0);
});

test("null, 403, 404, 409, 503 and malformed responses preserve unknown bytes with no retry POST", async () => {
  const f = await lost();
  const responses = [reply(http("recover")), reply({ ok: false, error: "attendance_access_denied" }, 403), reply({ ok: false, error: "attendance_employment_lifecycle_not_found" }, 404),
    reply({ ok: false, error: "attendance_version_conflict" }, 409), reply({ ok: false, error: "attendance_unavailable" }, 503), reply({ ok: false, error: "invented" }, 409)];
  for (const response of responses) { let count = 0; const c = new AttendanceEmploymentLifecycleClient({ ...f.options, apiFetch: async (_, init) => { count++; assert.equal(init?.method, "GET"); return response; } });
    await c.initialize(); await c.recover(); assert.equal(count, 1); assert(c.getSnapshot().pending); assert.equal(f.data.get(c.storageKey), f.raw); }
});

test("receipt actor, worker, employee, Auth, period and command hash must match before any pending clear", async () => {
  const f = await lost();
  for (const patch of [{ actorId: id(900) }, { operationId: id(900) }, { workerId: id(900) }, { employeeId: id(900) }, { employeeAuthUserId: id(900) }, { periodId: id(900) },
    { endsOn: "2026-10-07" }, { commandFingerprint: "0".repeat(64) }]) {
    const c = new AttendanceEmploymentLifecycleClient({ ...f.options, apiFetch: async () => { const wire = await receiptHttp(); return reply({ ...wire, receipt: { ...wire.receipt, ...patch } }); } });
    await c.initialize(); await c.recover(); assert(c.getSnapshot().pending); assert.equal(c.getSnapshot().result, null); assert.equal(f.data.get(c.storageKey), f.raw);
  }
});

test("storage CAS never removes replacement bytes and unsupported or foreign envelopes remain untouched", async () => {
  const f = await lost(); const c = new AttendanceEmploymentLifecycleClient({ ...f.options, apiFetch: async () => { f.data.set(f.c.storageKey, f.raw + " "); return reply(await receiptHttp()); } });
  await c.initialize(); await c.recover(); assert.equal(f.data.get(c.storageKey), f.raw + " "); assert(c.getSnapshot().pending);
  for (const raw of ["{", JSON.stringify({ ...JSON.parse(f.raw), version: 2 }), JSON.stringify({ ...JSON.parse(f.raw), actorId: id(99) }), JSON.stringify({ ...JSON.parse(f.raw), commandFingerprint: "0".repeat(64) })]) {
    const x = setup(async () => { throw Error("must_not_send"); }); x.data.set(employmentLifecyclePendingKey(site, owner), raw);
    const client = new AttendanceEmploymentLifecycleClient(x.options); await client.initialize(); await client.load(worker); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().pending, null); assert.equal(x.data.get(client.storageKey), raw); assert(client.hasLeaveRisk());
  }
});

test("pause and synchronous auth change prevent late receipt display and deletion", async () => {
  for (const invalidate of ["pause", "auth"] as const) { const f = await lost(), entered = deferred<void>(), response = deferred<Response>(); let current = true;
    const c = new AttendanceEmploymentLifecycleClient({ ...f.options, isCurrentAuth: () => current, apiFetch: async () => { entered.resolve(); return response.promise; } });
    await c.initialize(); const read = c.recover(); await entered.promise; if (invalidate === "pause") c.pause(); else current = false;
    response.resolve(reply(await receiptHttp())); await read; assert.equal(c.getSnapshot().result, null); assert(c.getSnapshot().pending); assert.equal(f.data.get(c.storageKey), f.raw);
  }
});

test("subscriber, ID generator and storage reentrancy cannot grant write authority", async () => {
  for (const target of ["subscriber", "uuid", "storage"] as const) { let posts = 0; const f = setup(async (_, init) => { if (init?.method === "POST") posts++; return reply(http()); });
    let once = false;
    const options: EmploymentLifecycleClientOptions = { ...f.options, ...(target === "uuid" ? { randomId: () => { c.pause(); return id(30); } } : {}),
      ...(target === "storage" ? { storage: () => ({ ...f.storage, setItem: (key: string, value: string) => { f.storage.setItem(key, value); c.pause(); } }) } : {}) };
    const c = new AttendanceEmploymentLifecycleClient(options); await c.initialize(); await c.load(worker);
    if (target === "subscriber") c.subscribe(() => { if (!once && c.getSnapshot().phase === "saving") { once = true; c.pause(); } });
    await c.submit("close", command().reason); assert.equal(posts, 0);
  }
});

test("storage failure never sends and feature-off/new blocked previews cannot submit", async () => {
  let posts = 0;
  for (const disabled of ["flag", "blocked", "storage"] as const) {
    const f = setup(async (_, init) => { if (init?.method === "POST") posts++; const wire = http(); if (disabled === "blocked") { wire.detail!.canClose = false; wire.detail!.closeBlockers = ["open_session"]; wire.detail!.currentAction = "break_start"; } return reply(wire); }, { enabled: disabled !== "flag" });
    const c = new AttendanceEmploymentLifecycleClient({ ...f.options, ...(disabled === "storage" ? { storage: () => ({ ...f.storage, setItem: () => { throw Error("quota"); } }) } : {}) });
    await c.initialize(); await c.load(worker); await c.submit("close", command().reason);
  } assert.equal(posts, 0);
});

test("bounded UTF8/JSON/content-type/error-body/header timeout all preserve original pending", async () => {
  const f = await lost();
  for (const response of [new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } }), reply("x".repeat(131072)),
    new Response("x".repeat(4097), { status: 503, headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "text/html" } })]) {
    const c = new AttendanceEmploymentLifecycleClient({ ...f.options, apiFetch: async () => response }); await c.initialize(); await c.recover(); assert.equal(f.data.get(c.storageKey), f.raw); assert(c.getSnapshot().pending);
  }
  const c = new AttendanceEmploymentLifecycleClient({ ...f.options, apiFetch: async () => new Promise<Response>(() => {}), timeoutMs: 5 }); await c.initialize(); await c.recover(); assert.equal(f.data.get(c.storageKey), f.raw);
});

test("owner/site keys are exact and no global storage or automatic API scan occurs", async () => {
  const f = setup(async () => { throw Error("automatic_network"); }); const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize();
  assert.equal(c.storageKey, `faolla:attendance:employment-lifecycle:v1:${site}:${owner}`); assert.notEqual(c.storageKey, employmentLifecyclePendingKey(site, id(900)));
  assert.throws(() => employmentLifecyclePendingKey("wrong", owner)); assert.throws(() => employmentLifecyclePendingKey(site, "employee-not-auth")); assert.equal(c.hasLeaveRisk(), false);
});

test("only strictly validated no-write POST refusals clear their exact pending and require fresh preview/new number", async () => {
  for (const code of ["attendance_employment_lifecycle_changed", "attendance_employment_lifecycle_blocked", "attendance_employment_lifecycle_disabled", "attendance_version_conflict", "attendance_version_exhausted"]) {
    let sequence = 30, reject = true; const operations: string[] = [], methods: string[] = [];
    const f = setup(async (_, init) => { methods.push(init?.method ?? ""); if (init?.method === "GET") return reply(http());
      const c = JSON.parse(String(init?.body)).command; operations.push(c.operationId);
      return reject ? reply({ ok: false, error: code }, code.endsWith("disabled") ? 403 : 409) : reply(await receiptHttp(c, "detail"));
    }, { randomId: () => id(sequence++) });
    const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(worker); await c.submit("close", command().reason);
    assert.equal(c.getSnapshot().pending, null); assert.equal(c.getSnapshot().result, null); assert.equal(f.data.size, 0); assert.match(c.getSnapshot().message, /本次没有写入/);
    assert.deepEqual(methods, ["GET", "POST"]); await c.submit("close", command().reason); assert.equal(operations.length, 1, "must not use rejected old preview");
    reject = false; await c.load(worker); await c.submit("close", command().reason); assert.deepEqual(operations, [id(30), id(31)]); assert.equal(c.getSnapshot().pending, null);
  }
});

test("matching network Error text, malformed/status-mismatched error and non-whitelisted refusal cannot clear", async () => {
  const replies = [() => { throw Error("attendance_employment_lifecycle_changed"); },
    () => reply({ ok: false, error: "attendance_employment_lifecycle_changed", extra: true }, 409),
    () => reply({ ok: false, error: "attendance_employment_lifecycle_changed" }, 503),
    () => reply({ ok: false, error: "attendance_operation_conflict" }, 409),
    () => reply({ ok: false, error: "attendance_access_denied" }, 403),
    () => reply({ ok: false, error: "attendance_invalid_request" }, 400),
    () => reply({ ok: false, error: "attendance_unavailable" }, 503)];
  for (const response of replies) { const f = setup(async (_, init) => init?.method === "GET" ? reply(http()) : response());
    const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(worker); await c.submit("close", command().reason);
    assert(c.getSnapshot().pending); assert(f.data.has(c.storageKey)); assert.equal(c.getSnapshot().result, null);
  }
});

test("validated refusal cannot delete replacement storage or settle after synchronous auth change", async () => {
  for (const mode of ["storage", "auth", "pause"] as const) { let current = true; const f = setup(async (_, init) => {
    if (init?.method === "GET") return reply(http());
    if (mode === "storage") f.data.set(c.storageKey, f.data.get(c.storageKey)! + " "); else if (mode === "auth") current = false; else c.pause();
    return reply({ ok: false, error: "attendance_employment_lifecycle_changed" }, 409);
  }, { isCurrentAuth: () => current });
    const c = new AttendanceEmploymentLifecycleClient(f.options); await c.initialize(); await c.load(worker); await c.submit("close", command().reason);
    assert(c.getSnapshot().pending); assert(f.data.has(c.storageKey)); if (mode === "storage") assert(f.data.get(c.storageKey)!.endsWith(" ")); assert.equal(c.getSnapshot().result, null);
  }
});
