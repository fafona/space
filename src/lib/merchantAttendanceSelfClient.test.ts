import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceSelfClient, attendancePendingKey, parseAttendancePending, type AttendanceApiFetch, type AttendancePending } from "./merchantAttendanceSelfClient";
import type { AttendanceSelfCommand, AttendanceSelfResult } from "./merchantAttendanceSelf";
import type { AttendanceEvent } from "./merchantAttendance";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3);
const initial = (): AttendanceSelfResult => ({ workerId, locationId, state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false });
const command: AttendanceSelfCommand = { expectedWorkerId: workerId, operationId: id(10), locationId, action: "clock_in", expectedSequence: 0 };
const pending: AttendancePending = { version: 1, siteId, employeeId, workerId, command };
const key = attendancePendingKey(siteId, employeeId);
function storage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
function event(c = command, sequence = 1): AttendanceEvent {
  return { operationId: c.operationId, locationId: c.locationId, action: c.action, id: id(100 + sequence), siteId, workerId, sequence,
    occurredAt: "2026-09-29T09:00:00.000Z", timeZone: "Europe/Madrid", breakPaid: c.action === "break_start" ? false : null };
}
function committed(c = command): AttendanceSelfResult {
  const receipt = event(c);
  return { workerId, locationId, state: { sequence: 1, status: "working", lastEvent: receipt }, receipt, replayed: false };
}
const ok = (value: AttendanceSelfResult, moduleEnabled = true) => Response.json({ ok: true, ...value, moduleEnabled });
const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });
test("paused employee cannot start a shift or break but can close an existing shift",async()=>{
  const idle=fixture(async()=>ok(initial(),false));await idle.client.initialize();await idle.client.submit("clock_in");assert.equal(idle.calls.length,1);assert.equal(idle.saved.entries.size,0);
  const current=committed();current.receipt=null;
  const working=fixture(async(_path,init)=>{
    if(init?.method!=="POST")return ok(current,false);
    const c=JSON.parse(init.body as string) as AttendanceSelfCommand;const receipt=event(c,2);
    return ok({...current,state:{sequence:2,status:"off",lastEvent:receipt},receipt},false);
  },{randomId:()=>id(11)});
  await working.client.initialize();await working.client.submit("break_start");assert.equal(working.calls.length,1);
  await working.client.submit("clock_out");assert.equal(working.calls.length,2);assert.equal(working.client.getSnapshot().confirmed?.action,"clock_out");
});
test("paused employee can end an existing break then must explicitly clock out",async()=>{
  const c={...command,action:"break_start" as const};const last=event(c,2);
  const current:AttendanceSelfResult={...initial(),state:{sequence:2,status:"break",lastEvent:last}};
  const s=fixture(async(_path,init)=>{
    if(init?.method!=="POST")return ok(current,false);
    const c=JSON.parse(init.body as string) as AttendanceSelfCommand;const receipt=event(c,3);
    return ok({...current,state:{sequence:3,status:"working",lastEvent:receipt},receipt},false);
  },{randomId:()=>id(11)});
  await s.client.initialize();await s.client.submit("clock_out");assert.equal(s.calls.length,1);
  await s.client.submit("break_end");assert.equal(s.client.getSnapshot().result?.state.status,"working");assert.equal(s.calls.length,2);
});
test("paused platform still resolves a previously committed receipt",async()=>{
  const saved=storage();saved.setItem(key,JSON.stringify(pending));const s=fixture(async()=>ok(committed(),false),{storage:()=>saved});
  await s.client.initialize();assert.equal(s.client.getSnapshot().pending,null);assert.equal(s.client.getSnapshot().confirmed?.action,"clock_in");assert.equal(s.calls.length,1);
});
test("missing or malformed admission status fails closed without POST",async()=>{
  for(const moduleEnabled of [undefined,"true",null]){
    const s=fixture(async()=>Response.json({ok:true,...initial(),moduleEnabled}));await s.client.initialize();await s.client.submit("clock_in");
    assert.equal(s.client.getSnapshot().phase,"blocked");assert.equal(s.calls.length,1);assert.equal(s.saved.entries.size,0);
  }
});
function fixture(api: AttendanceApiFetch, options: Partial<ConstructorParameters<typeof AttendanceSelfClient>[0]> = {}) {
  const saved = storage(); const calls: Array<{ path: string; init: RequestInit }> = [];
  const client = new AttendanceSelfClient({ siteId, employeeId, canClock: true, storage: () => saved, randomId: () => id(10),
    apiFetch: async (path, init = {}) => { calls.push({ path, init }); return api(path, init); }, ...options });
  return { client, saved, calls };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }

test("initial loading is read-only, explicit actions persist intent before POST and confirm from receipt", async () => {
  const { client, saved, calls } = fixture(async (_path, init) => {
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(saved.getItem(key)!), pending);
      return ok(committed());
    }
    return ok(initial());
  });
  await client.initialize(); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, "GET");
  await client.submit("clock_in");
  assert.equal(client.getSnapshot().phase, "ready"); assert.deepEqual(client.getSnapshot().confirmed, event());
  assert.equal(saved.getItem(key), null);
  assert.deepEqual(JSON.parse(calls[1].init.body as string), { siteId, ...command });
});
test("double taps submit once and do not toggle while waiting", async () => {
  const waiting = deferred<Response>();
  const { client, calls } = fixture(async (_p, init) => init?.method === "POST" ? waiting.promise : ok(initial()));
  await client.initialize(); const submitted = client.submit("clock_in");
  await client.submit("clock_in"); await client.submit("clock_out"); await client.refresh();
  assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
  assert.equal(client.getSnapshot().phase, "submitting"); waiting.resolve(ok(committed())); await submitted;
});
test("network failure retains original intent and blocks all new actions until resolved", async () => {
  const { client, saved, calls } = fixture(async (_p, init) => { if (init?.method === "POST") throw Error("offline"); return ok(initial()); });
  await client.initialize(); await client.submit("clock_in");
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.equal(client.getSnapshot().confirmed, null);
  assert.ok(saved.getItem(key)); await client.submit("clock_out"); await client.submit("clock_in");
  assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
  await client.retry();
  assert.deepEqual(calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(c.init.body as string).operationId), [id(10), id(10)]);
});
test("refresh/remount recovers by receipt without automatically posting again", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const { client, calls } = fixture(async (path) => { assert.ok(path.includes(`operationId=${id(10)}`)); return ok(committed()); }, { storage: () => saved });
  await client.initialize(); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, "GET");
  assert.equal(client.getSnapshot().pending, null); assert.deepEqual(client.getSnapshot().confirmed, event());
});
test("absent receipt at original sequence is not failure or success and does not lose intent", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const { client } = fixture(async () => ok(initial()), { storage: () => saved });
  await client.initialize(); assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(saved.getItem(key));
});
test("newer sequence without receipt safely fences delayed old operation", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const newer = committed({ ...command, operationId: id(11) }); newer.receipt = null;
  const { client } = fixture(async () => ok(newer), { storage: () => saved });
  await client.initialize(); assert.equal(client.getSnapshot().phase, "ready");
  assert.equal(client.getSnapshot().confirmed, null); assert.equal(saved.getItem(key), null);
  assert.match(client.getSnapshot().message, /未找到此次操作/);
});
test("old receipt is shown independently of newer current status", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const value = committed(); value.state = { sequence: 2, status: "off", lastEvent: event({ ...command, operationId: id(11), action: "clock_out" }, 2) };
  const { client } = fixture(async () => ok(value), { storage: () => saved });
  await client.initialize(); assert.equal(client.getSnapshot().result?.state.status, "off"); assert.equal(client.getSnapshot().confirmed?.action, "clock_in");
});
test("first attempt explicit rejection clears uncommitted intent but requires refresh", async () => {
  const { client, saved } = fixture(async (_p, init) => init?.method === "POST" ? fail("attendance_not_employed", 403) : ok(initial()));
  await client.initialize(); await client.submit("clock_in");
  assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(saved.getItem(key), null); assert.equal(client.getSnapshot().result, null);
});
test("retry rejection cannot erase an earlier possible success, even after permission revoked", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const { client } = fixture(async (_p, init) => init?.method === "POST" ? fail("attendance_access_denied", 403) : ok(initial()), { storage: () => saved });
  await client.initialize(); await client.retry(); assert.equal(client.getSnapshot().phase, "blocked"); assert.ok(saved.getItem(key));
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().confirmed, null);
});

for (const [code, status] of [["attendance_access_denied", 403], ["attendance_worker_changed", 409],
  ["unauthorized", 401], ["employee_password_authentication_required", 403],
  ["enterprise_management_disabled", 403], ["forbidden_origin", 403]] as const) {
  test(`identity rejection ${code} removes cached events without losing or resending original intent`, async () => {
    let denied = false;
    const current = committed(); current.receipt = null;
    const saved = storage();
    const close = { ...pending, command: { ...command, operationId: id(11), action: "clock_out" as const, expectedSequence: 1 } };
    saved.setItem(key, JSON.stringify(close));
    const { client, calls } = fixture(async (_p, init) => denied || init?.method === "POST" ? fail(code, status) : ok(current), { storage: () => saved });
    await client.initialize(); assert.ok(client.getSnapshot().result?.state.lastEvent);
    await client.retry();
    assert.equal(client.getSnapshot().phase, "blocked");
    assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().confirmed, null);
    assert.deepEqual(client.getSnapshot().pending, close); assert.equal(saved.getItem(key), JSON.stringify(close));
    assert.match(client.getSnapshot().message, /原操作编号.*保留/);
    await client.retry(); await client.submit("clock_in"); await client.submit("clock_out");
    assert.equal(calls.length, 2, "blocked identity cannot send another POST");
    denied = true; await client.refresh();
    assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null);
    assert.equal(saved.getItem(key), JSON.stringify(close)); assert.equal(calls[2].init.method, "GET");
    assert.ok(calls[2].path.includes(`operationId=${id(11)}`));
  });
}

test("first identity rejection keeps the exact operation for owner review rather than treating it as a new blank shift", async () => {
  const { client, saved, calls } = fixture(async (_p, init) => init?.method === "POST" ? fail("attendance_access_denied", 403) : ok(initial()));
  await client.initialize(); await client.submit("clock_in");
  assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null);
  assert.deepEqual(client.getSnapshot().pending, pending); assert.deepEqual(JSON.parse(saved.getItem(key)!), pending);
  await client.retry(); await client.submit("clock_in"); assert.equal(calls.length, 2);
});

test("explicit recheck after restored identity can recover the original receipt without a new operation", async () => {
  let denied = false, recovered = false;
  const { client, saved, calls } = fixture(async (_p, init) => {
    if (denied) return fail("attendance_access_denied", 403);
    if (recovered) return ok(committed());
    if (init?.method === "POST") throw Error("response lost");
    return ok(initial());
  });
  await client.initialize(); await client.submit("clock_in");
  denied = true; await client.retry(); assert.equal(client.getSnapshot().phase, "blocked");
  denied = false; recovered = true; await client.refresh();
  assert.equal(client.getSnapshot().phase, "ready"); assert.deepEqual(client.getSnapshot().confirmed, event());
  assert.equal(saved.getItem(key), null); assert.equal(calls.filter(call => call.init.method === "POST").length, 2);
});

test("failed refresh after identity rejection cannot unlock POST; an accepted own-state read is required", async () => {
  for (const unavailable of [() => fail("attendance_unavailable", 503), () => fail("attendance_rate_limited", 429),
    () => { throw Error("network offline"); }]) {
    let mode: "ready" | "denied" | "unavailable" | "restored" = "ready";
    const saved = storage(); saved.setItem(key, JSON.stringify(pending));
    const { client, calls } = fixture(async (_p, init) => {
      if (mode === "denied") return fail("attendance_access_denied", 403);
      if (mode === "unavailable") return unavailable();
      if (mode === "restored" && init?.method === "POST") return ok(committed());
      return ok(initial());
    }, { storage: () => saved });
    await client.initialize(); mode = "denied"; await client.retry();
    assert.equal(client.getSnapshot().phase, "blocked");
    mode = "unavailable"; await client.refresh(); await client.retry(); await client.submit("clock_in");
    assert.equal(client.getSnapshot().result, null); assert.equal(saved.getItem(key), JSON.stringify(pending));
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
    client.dispose(); await client.initialize(); await client.retry();
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1, "reinitialize cannot bypass failed read");
    mode = "restored"; await client.refresh(); await client.retry();
    assert.equal(client.getSnapshot().phase, "ready"); assert.deepEqual(client.getSnapshot().confirmed, event());
    assert.deepEqual(calls.filter(call => call.init.method === "POST").map(call => JSON.parse(call.init.body as string).operationId), [id(10), id(10)]);
    assert.equal(saved.getItem(key), null);
  }
});

test("fresh controller with restored pending and no accepted state cannot retry after a failed GET", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const { client, calls } = fixture(async () => fail("attendance_unavailable", 503), { storage: () => saved });
  await client.initialize(); await client.retry();
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, "GET");
  assert.equal(client.getSnapshot().result, null); assert.equal(saved.getItem(key), JSON.stringify(pending));
});

test("temporary failures and malformed identity errors preserve uncertainty instead of claiming identity revocation", async () => {
  for (const response of [fail("attendance_rate_limited", 429), fail("attendance_unavailable", 503),
    fail("attendance_access_denied", 500), fail("attendance_worker_changed", 400), fail("unknown", 403)]) {
    const saved = storage(); saved.setItem(key, JSON.stringify(pending));
    const { client } = fixture(async (_p, init) => init?.method === "POST" ? response : ok(initial()), { storage: () => saved });
    await client.initialize(); await client.retry();
    assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(client.getSnapshot().result);
    assert.equal(client.getSnapshot().confirmed, null); assert.equal(saved.getItem(key), JSON.stringify(pending));
  }
});
test("HTTP 5xx, HTML login, malformed JSON and invalid success never confirm or erase pending", async () => {
  for (const response of [fail("attendance_unavailable", 503), new Response("login", { status: 200, headers: { "content-type": "text/html" } }),
    new Response("{", { headers: { "content-type": "application/json" } }), Response.json({ ok: true }),
    new Response(" ".repeat(32769), { headers: { "content-type": "application/json" } })]) {
    const { client, saved } = fixture(async (_p, init) => init?.method === "POST" ? response : ok(initial()));
    await client.initialize(); await client.submit("clock_in");
    assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.equal(client.getSnapshot().confirmed, null); assert.ok(saved.getItem(key));
  }
});
test("storage unavailable, corrupt or cross-member intent fails closed without network", async () => {
  for (const value of ["not-json", JSON.stringify({ ...pending, siteId: "99990002" }), JSON.stringify({ ...pending, employeeId: id(999) }), JSON.stringify({ ...pending, secret: "forbidden" })]) {
    const saved = storage(); saved.setItem(key, value);
    const { client, calls } = fixture(async () => ok(initial()), { storage: () => saved });
    await client.initialize(); assert.equal(client.getSnapshot().phase, "storage_error"); assert.equal(calls.length, 0);
  }
  const { client, calls } = fixture(async () => ok(initial()), { storage: () => { throw Error("storage disabled"); } });
  await client.initialize(); await client.submit("clock_in"); assert.equal(calls.length, 0);
});
test("failed or silently dropped persistent write prevents all POSTs", async () => {
  for (const setItem of [() => { throw Error("quota"); }, () => {}]) {
    const saved = { ...storage(), setItem };
    const { client, calls } = fixture(async () => ok(initial()), { storage: () => saved });
    await client.initialize(); await client.submit("clock_in");
    assert.equal(client.getSnapshot().phase, "storage_error"); assert.equal(calls.length, 1);
  }
});
test("confirmed receipt remains visible if pending cleanup fails; new writes stay blocked", async () => {
  const saved = { ...storage(), removeItem: () => { throw Error("storage read only"); } };
  const { client, calls } = fixture(async (_p, init) => init?.method === "POST" ? ok(committed()) : ok(initial()), { storage: () => saved });
  await client.initialize(); await client.submit("clock_in");
  assert.equal(client.getSnapshot().phase, "storage_error"); assert.ok(client.getSnapshot().confirmed);
  await client.submit("clock_out"); assert.equal(calls.length, 2);
});

for (const mismatch of ["worker", "receipt"] as const) {
  test(`a ${mismatch} mismatch also hides a prior receipt retained after storage cleanup failed`, async () => {
    let changed = false;
    const saved = { ...storage(), removeItem: () => { throw Error("storage read only"); } };
    const { client, calls } = fixture(async (_p, init) => {
      if (changed) return mismatch === "worker" ? ok({ ...initial(), workerId: id(888) })
        : ok(committed({ ...command, locationId: id(99) }));
      return init?.method === "POST" ? ok(committed()) : ok(initial());
    }, { storage: () => saved });
    await client.initialize(); await client.submit("clock_in");
    assert.equal(client.getSnapshot().phase, "storage_error"); assert.ok(client.getSnapshot().confirmed);
    assert.ok(client.getSnapshot().pending); const raw = saved.getItem(key);
    changed = true; await client.refresh();
    assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null);
    assert.equal(client.getSnapshot().confirmed, null); assert.equal(saved.getItem(key), raw);
    await client.retry(); assert.equal(calls.length, 3);
  });
}
test("disposed scope ignores late success and leaves recoverable pending intent", async () => {
  const waiting = deferred<Response>();
  const { client, saved } = fixture(async (_p, init) => init?.method === "POST" ? waiting.promise : ok(initial()));
  await client.initialize(); const work = client.submit("clock_in"); client.dispose(); waiting.resolve(ok(committed())); await work;
  assert.equal(client.getSnapshot().confirmed, null); assert.ok(saved.getItem(key));
});
test("reinitializing fences older reads and strict-mode cleanup is restartable", async () => {
  const old = deferred<Response>(); let count = 0;
  const { client } = fixture(async () => ++count === 1 ? old.promise : ok(initial()));
  const previous = client.initialize(); client.dispose(); await client.initialize(); old.resolve(ok(committed())); await previous;
  assert.equal(client.getSnapshot().result?.state.sequence, 0); assert.equal(client.getSnapshot().phase, "ready");
});
test("read-only role and missing location cannot submit", async () => {
  for (const canClock of [true, false]) {
    const { client, calls } = fixture(async () => ok({ ...initial(), locationId: canClock ? null : locationId }), { canClock });
    await client.initialize(); await client.submit("clock_in"); assert.equal(calls.length, 1);
  }
});
test("identity-specific keys do not store access tokens, email, name or location coordinates", () => {
  assert.notEqual(key, attendancePendingKey(siteId, id(999))); assert.notEqual(key, attendancePendingKey("99990002", employeeId));
  const raw = JSON.stringify(pending); assert.doesNotMatch(raw, /token|email|name|latitude|longitude/i);
  assert.deepEqual(parseAttendancePending(raw, siteId, employeeId), pending);
});
test("a newly assigned worker cannot adopt an old worker's pending request", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const { client, calls } = fixture(async () => ok({ ...initial(), workerId: id(888) }), { storage: () => saved });
  await client.initialize(); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); assert.ok(saved.getItem(key));
  await client.retry(); assert.equal(calls.length, 1);
});
test("mismatched receipt intent is not confirmed or retried", async () => {
  const saved = storage(); saved.setItem(key, JSON.stringify(pending));
  const wrong = committed({ ...command, locationId: id(99) });
  const { client, calls } = fixture(async () => ok(wrong), { storage: () => saved });
  await client.initialize(); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().confirmed, null);
  await client.retry(); assert.equal(calls.length, 1); assert.ok(saved.getItem(key));
});
test("parallel instances in one tab reuse persisted intent instead of overwriting it", async () => {
  const saved = storage(); const wait = deferred<Response>(); let writes = 0;
  const api: AttendanceApiFetch = async (_p, init) => { if (init?.method === "POST") { writes++; return wait.promise; } return ok(initial()); };
  const one = fixture(api, { storage: () => saved }).client;
  const two = fixture(api, { storage: () => saved, randomId: () => id(99) }).client;
  await Promise.all([one.initialize(), two.initialize()]); const submit = one.submit("clock_in"); await two.submit("clock_in");
  assert.equal(writes, 1); assert.equal(two.getSnapshot().pending?.command.operationId, id(10)); wait.resolve(ok(committed())); await submit;
});
test("HTTP timeout leaves pending intent, not an invented clock record", async () => {
  const { client, saved } = fixture(async (_p, init) => {
    if (init?.method !== "POST") return ok(initial());
    return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(Error("timeout")), { once: true }));
  }, { timeoutMs: 5 });
  await client.initialize(); await client.submit("clock_in"); assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(saved.getItem(key));
});
test("untrusted error names remain plain text and never use inherited object properties", async () => {
  const { client } = fixture(async (_p, init) => init?.method === "POST" ? fail("constructor", 403) : ok(initial()));
  await client.initialize(); await client.submit("clock_in");
  assert.equal(typeof client.getSnapshot().message, "string"); assert.equal(client.getSnapshot().phase, "unconfirmed");
});
test("authorization loss clears displayed state and prior receipt", async () => {
  let revoked = false;
  const { client } = fixture(async (_p, init) => revoked ? fail("attendance_access_denied", 403) : init?.method === "POST" ? ok(committed()) : ok(initial()));
  await client.initialize(); await client.submit("clock_in"); assert.ok(client.getSnapshot().confirmed);
  revoked = true; await client.refresh(); assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().confirmed, null);
});

for (const [code, status] of [["unauthorized", 401], ["attendance_access_denied", 403],
  ["employee_password_authentication_required", 403], ["enterprise_management_disabled", 403], ["forbidden_origin", 403]] as const) {
  test(`self GET ${code} signals a monotonic child reset without erasing unknown intent`, async () => {
    let denied = false;
    const saved = storage(); saved.setItem(key, JSON.stringify(pending)); saved.setItem("unrelated", "keep");
    const { client, calls } = fixture(async () => denied ? fail(code, status) : ok(initial(), false), { storage: () => saved });
    assert.equal(client.getSnapshot().authorizationEpoch, 0);
    await client.initialize(); denied = true; await client.refresh();
    assert.equal(client.getSnapshot().authorizationEpoch, 1); assert.equal(client.getSnapshot().result, null);
    assert.equal(client.getSnapshot().confirmed, null); assert.equal(saved.getItem(key), JSON.stringify(pending));
    await client.initialize(); assert.equal(client.getSnapshot().authorizationEpoch, 2);
    denied = false; await client.initialize();
    assert.equal(client.getSnapshot().authorizationEpoch, 2); assert.equal(client.getSnapshot().phase, "unconfirmed");
    assert.equal(client.getSnapshot().result?.moduleEnabled, false); assert.equal(saved.getItem("unrelated"), "keep");
    assert.ok(calls.every(call => call.init.method === "GET"));
  });
}
test("self non-auth GET failures and malformed error envelopes never invalidate independent child authorization", async () => {
  const cases = [
    () => fail("attendance_unavailable", 503), () => fail("attendance_rate_limited", 429),
    ...["attendance_platform_paused", "attendance_disabled", "attendance_web_disabled", "attendance_location_denied", "attendance_not_employed", "unknown"].map(code => () => fail(code, 403)),
    () => fail("attendance_worker_changed", 409), () => fail("attendance_access_denied", 500),
    () => Response.json({ ok: true, error: "attendance_access_denied" }, { status: 403 }),
    () => Response.json({ ok: false, error: "unauthorized", extra: true }, { status: 401 }),
    () => new Response("login", { status: 401, headers: { "Content-Type": "text/html" } }),
    () => { throw Error("offline"); },
  ];
  for (const response of cases) {
    const { client } = fixture(async () => response()); await client.initialize();
    assert.equal(client.getSnapshot().authorizationEpoch, 0);
  }
  const saved = storage(); saved.setItem(key, "invalid pending");
  const { client, calls } = fixture(async () => ok(initial()), { storage: () => saved }); await client.initialize();
  assert.equal(client.getSnapshot().authorizationEpoch, 0); assert.equal(calls.length, 0);
});
test("self stale or disposed GET rejection never invalidates the current child scope", async () => {
  for (const restart of [false, true]) {
    const old = deferred<Response>(); let count = 0;
    const { client } = fixture(async () => ++count === 1 ? old.promise : ok(initial()));
    const previous = client.initialize(); client.dispose();
    if (restart) await client.initialize();
    old.resolve(fail("attendance_access_denied", 403)); await previous;
    assert.equal(client.getSnapshot().authorizationEpoch, 0);
    if (restart) assert.equal(client.getSnapshot().phase, "ready");
  }
});
test("self aborted timeout GET does not signal authorization even if transport returns a denial on abort", async () => {
  const { client } = fixture(async (_path, init) => new Promise<Response>(resolve => {
    init?.signal?.addEventListener("abort", () => resolve(fail("unauthorized", 401)), { once: true });
  }), { timeoutMs: 5 });
  await client.initialize(); assert.equal(client.getSnapshot().authorizationEpoch, 0);
});
test("self POST identity and business rejection keep their previous pending rules and never advance the GET epoch", async () => {
  for (const [code, status, keeps] of [["attendance_access_denied", 403, true], ["unauthorized", 401, true],
    ["attendance_worker_changed", 409, true], ["attendance_platform_paused", 403, false], ["attendance_not_employed", 403, false]] as const) {
    const { client, saved } = fixture(async (_path, init) => init?.method === "POST" ? fail(code, status) : ok(initial()));
    await client.initialize(); await client.submit("clock_in");
    assert.equal(client.getSnapshot().authorizationEpoch, 0); assert.equal(client.getSnapshot().pending !== null, keeps);
    assert.equal(saved.getItem(key) !== null, keeps);
  }
});
