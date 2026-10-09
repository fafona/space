import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEventChannelsClient } from "./merchantAttendanceEventChannelsClient";
import type { EventChannelsQuery, EventChannelsResult } from "./merchantAttendanceEventChannels";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const employeeId = id(2), terminalId = id(70), asOf = "2026-10-02T12:00:00.000000Z";
const query = (access: EventChannelsQuery["access"] = "self", count = 3): EventChannelsQuery => ({
  siteId: "99990001", access, workerId: id(3), locationId: access === "manager" ? id(4) : null,
  eventIds: Array.from({ length: count }, (_, index) => id(index + 100)),
});
function wire(input = query(), extra: Partial<EventChannelsResult> = {}) {
  const result: EventChannelsResult = {
    siteId: input.siteId, access: input.access, workerId: input.workerId, locationId: input.locationId,
    viewerEmployeeId: input.access === "owner" ? null : employeeId, asOf, accessValidUntil: null,
    items: input.eventIds.map((eventId, index) => ({ eventId, action: "clock_in", occurredAt: "2026-10-02T11:00:00.123456Z",
      channel: index % 3 === 0 ? "onsite_qr" : index % 3 === 1 ? "web" : "kiosk", terminalId: index % 3 === 0 ? terminalId : null })),
    ...extra,
  };
  return { ok: true, moduleEnabled: true, ...result };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); }
type Options = ConstructorParameters<typeof AttendanceEventChannelsClient>[0];
function harness(options: Partial<Options> = {}) {
  const input = options.query ?? query();
  let mono = 0, nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const calls: { path: string; init?: RequestInit }[] = [];
  const respond: AttendanceApiFetch = options.apiFetch ?? (async () => json(wire(input)));
  const setTimer = ((callback: () => void, delay = 0) => {
    const timer = ++nextTimer; timers.set(timer, { at: mono + delay, callback });
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimer = ((timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as number); }) as typeof clearTimeout;
  const client = new AttendanceEventChannelsClient({ query: input, employeeId: input.access === "owner" ? undefined : employeeId,
    now: () => mono, setTimer, clearTimer, ...options,
    apiFetch: async (path, init) => { calls.push({ path, init }); return respond(path, init); },
  });
  const advance = async (milliseconds: number) => {
    const target = mono + milliseconds;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      mono = due[1].at; timers.delete(due[0]); due[1].callback(); await flush();
    }
    mono = target; await flush();
  };
  return { client, calls, timers, advance, setNow: (value: number) => { mono = value; } };
}

test("construction and subscription never query; one explicit bounded batch preserves all channels and microseconds", async () => {
  const h = harness(), observed: string[] = [];
  const unsubscribe = h.client.subscribe(() => observed.push(h.client.getSnapshot().phase));
  assert.equal(h.client.getSnapshot().phase, "idle"); assert.equal(h.client.getSnapshot().result, null);
  await h.advance(120000); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
  await h.client.load();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, "/api/merchant-enterprise/attendance/event-channels");
  assert.equal(h.calls[0].init?.method, "POST"); assert.equal(h.calls[0].init?.cache, "no-store");
  assert.deepEqual(h.calls[0].init?.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), query());
  assert.equal(h.client.getSnapshot().phase, "ready");
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.channel), ["onsite_qr", "web", "kiosk"]);
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.terminalId), [terminalId, null, null]);
  assert.equal(h.client.getSnapshot().result?.items[0].occurredAt, "2026-10-02T11:00:00.123456Z");
  assert.deepEqual(observed, ["idle", "loading", "ready"]);
  unsubscribe(); h.client.invalidate(); assert.equal(observed.length, 3); assert.equal(h.timers.size, 0);
});

test("202 events use one explicit POST; invalid empty, duplicate, oversized or noncanonical batches never send", async () => {
  const maximum = harness({ query: query("owner", 202) }); await maximum.client.load();
  assert.equal(maximum.calls.length, 1); assert.equal(maximum.client.getSnapshot().result?.items.length, 202);
  assert.ok(new TextEncoder().encode(String(maximum.calls[0].init?.body)).byteLength < 16384); maximum.client.invalidate();
  let requests = 0;
  const invalid: unknown[] = [query("self", 0), query("self", 203), { ...query(), eventIds: [id(100), id(100)] },
    { ...query(), eventIds: [id(100).toUpperCase().replace("8000", "A000")] }, { ...query(), eventIds: [null] },
    { ...query(), eventIds: "all" }, { ...query(), locationId: id(4) }, { ...query("manager"), locationId: null },
    { ...query(), workerId: "*" }, { ...query(), authUserId: id(1) }];
  for (const input of invalid) assert.throws(() => new AttendanceEventChannelsClient({ query: input as EventChannelsQuery,
    apiFetch: async () => { requests++; return json(wire()); } }), /attendance_invalid_request/);
  assert.equal(requests, 0);
});

test("constructor snapshots the validated batch rather than retaining caller-owned IDs", async () => {
  const original = query(), expected = query();
  const h = harness({ query: original, apiFetch: async () => json(wire(expected)) });
  original.eventIds.reverse(); original.workerId = id(999); original.siteId = "99990002";
  await h.client.load(); assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), expected);
  assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.eventId), expected.eventIds); h.client.invalidate();
});

const badResults: [string, (body: ReturnType<typeof wire>) => unknown][] = [
  ["extra private envelope field", body => ({ ...body, claims: { secret: "private" } })],
  ["missing envelope field", body => { const { asOf: omitted, ...rest } = body; void omitted; return rest; }],
  ["false ok", body => ({ ...body, ok: false })],
  ["invalid module flag", body => ({ ...body, moduleEnabled: "true" })],
  ["wrong site", body => ({ ...body, siteId: "99990002" })],
  ["wrong access", body => ({ ...body, access: "owner" })],
  ["wrong worker", body => ({ ...body, workerId: id(90) })],
  ["wrong location", body => ({ ...body, locationId: id(4) })],
  ["partial batch", body => ({ ...body, items: body.items.slice(1) })],
  ["reordered batch", body => ({ ...body, items: [...body.items].reverse() })],
  ["duplicate substituted event", body => ({ ...body, items: [body.items[0], body.items[0], body.items[2]] })],
  ["unknown substituted event", body => ({ ...body, items: body.items.map((item, index) => index ? item : { ...item, eventId: id(90) }) })],
  ["unknown action", body => ({ ...body, items: body.items.map(item => ({ ...item, action: "delete" })) })],
  ["unknown channel", body => ({ ...body, items: body.items.map(item => ({ ...item, channel: "qr" })) })],
  ["onsite missing terminal", body => ({ ...body, items: body.items.map(item => ({ ...item, terminalId: null })) })],
  ["ordinary channel with terminal", body => ({ ...body, items: body.items.map(item => ({ ...item, terminalId })) })],
  ["private nested field", body => ({ ...body, items: body.items.map(item => ({ ...item, nonce: id(50) })) })],
  ["future event", body => ({ ...body, items: body.items.map(item => ({ ...item, occurredAt: "2026-10-02T12:00:00.000001Z" })) })],
  ["invalid instant", body => ({ ...body, asOf: "2026-02-30T12:00:00.000000Z" })],
  ["self with scope expiry", body => ({ ...body, accessValidUntil: "2026-10-02T12:00:20.000000Z" })],
];
for (const [name, change] of badResults) test(`strict response rejects ${name} without partial or ordinary-web fallback`, async () => {
  const h = harness({ apiFetch: async () => json(change(wire())) });
  await h.client.load(); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  assert.match(h.client.getSnapshot().message, /不能据此判断为普通网页打卡/); assert.equal(h.timers.size, 0);
  await h.advance(120000); assert.equal(h.calls.length, 1); h.client.invalidate();
});

test("current employee mismatch is denied for both self and manager; owner requires null viewer", async () => {
  for (const access of ["self", "manager"] as const) {
    const input = query(access), h = harness({ query: input, apiFetch: async () => json(wire(input, { viewerEmployeeId: id(88) })) });
    await h.client.load(); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
    assert.match(h.client.getSnapshot().message, /当前权限/); h.client.invalidate();
  }
  const owner = harness({ query: query("owner"), apiFetch: async () => json(wire(query("owner"), { viewerEmployeeId: employeeId })) });
  await owner.client.load(); assert.equal(owner.client.getSnapshot().phase, "blocked"); assert.equal(owner.client.getSnapshot().result, null); owner.client.invalidate();
});

test("module pause permits authorized history; a subsequent revoked batch clears previous results immediately", async () => {
  const denial = deferred<Response>(); let requests = 0;
  const h = harness({ apiFetch: async () => ++requests === 1 ? json({ ...wire(), moduleEnabled: false }) : denial.promise });
  await h.client.load(); assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.timers.size, 1);
  const loading = h.client.load(); assert.equal(h.client.getSnapshot().phase, "loading"); assert.equal(h.client.getSnapshot().result, null);
  assert.equal(h.timers.size, 0); denial.resolve(json({ ok: false, error: "attendance_access_denied" }, 403)); await loading;
  assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
  assert.match(h.client.getSnapshot().message, /已清除结果/); await h.advance(120000); assert.equal(requests, 2); h.client.invalidate();
});

test("partial or failed refresh discards a previously verified full batch and never retries itself", async () => {
  for (const failure of [json({ ...wire(), items: wire().items.slice(0, 1) }), json({ ok: false, error: "attendance_unavailable" }, 503)]) {
    let requests = 0; const h = harness({ apiFetch: async () => ++requests === 1 ? json(wire()) : failure });
    await h.client.load(); assert.equal(h.client.getSnapshot().phase, "ready"); await h.client.load();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
    assert.match(h.client.getSnapshot().message, /不能据此判断为普通网页打卡/);
    await h.advance(120000); assert.equal(requests, 2); assert.equal(h.timers.size, 0); h.client.invalidate();
  }
});

test("malformed, HTML, oversized and mismatched-status responses expose no raw transport or database errors", async () => {
  const responses = [
    () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
    () => json({ ok: false, error: "private_sql_detail_employee_42" }, 503),
    () => json({ ok: false, error: "attendance_access_denied" }, 200),
    () => json({ ok: false, error: "toString" }, 403),
    () => new Response(JSON.stringify(wire()) + " ".repeat(65536), { headers: { "Content-Type": "application/json" } }),
    () => new Response("{invalid", { headers: { "Content-Type": "application/json" } }),
  ];
  for (const response of responses) {
    const h = harness({ apiFetch: async () => response() }); await h.client.load();
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null);
    assert.doesNotMatch(h.client.getSnapshot().message, /private_sql|employee_42|toString|<html>/); assert.equal(h.timers.size, 0); h.client.invalidate();
  }
  const disabled = harness({ apiFetch: async () => json({ ok: false, error: "attendance_not_available" }, 404) });
  await disabled.client.load(); assert.match(disabled.client.getSnapshot().message, /尚未开放/); assert.equal(disabled.client.getSnapshot().result, null); disabled.client.invalidate();
});

test("busy repeated explicit loads share one in-flight batch and never queue an automatic retry", async () => {
  const response = deferred<Response>(), h = harness({ apiFetch: async () => response.promise });
  const first = h.client.load(); await h.client.load(); await h.client.load();
  assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().phase, "loading");
  response.resolve(json(wire())); await first; assert.equal(h.client.getSnapshot().phase, "ready");
  await h.advance(120000); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().phase, "idle"); h.client.invalidate();
});

test("invalidation aborts transport; stale success cannot restore an old batch over a newer generation", async () => {
  const old = deferred<Response>(); let requests = 0;
  const h = harness({ apiFetch: async () => ++requests === 1 ? old.promise : json(wire(query(), {
    items: wire().items.map(item => ({ ...item, channel: "kiosk", terminalId: null })),
  })) });
  const first = h.client.load(); const signal = h.calls[0].init?.signal;
  h.client.invalidate("identity changed"); await first; assert.equal(signal?.aborted, true);
  assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().message, "identity changed");
  await h.client.load(); assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.channel), ["kiosk", "kiosk", "kiosk"]);
  old.resolve(json(wire())); await flush(); assert.deepEqual(h.client.getSnapshot().result?.items.map(item => item.channel), ["kiosk", "kiosk", "kiosk"]);
  assert.equal(h.timers.size, 1); h.client.invalidate(); assert.equal(h.timers.size, 0);
});

test("late old-generation failure cannot block, clear or unlock a newer pending request", async () => {
  const old = deferred<Response>(), current = deferred<Response>(); let requests = 0;
  const h = harness({ apiFetch: async () => ++requests === 1 ? old.promise : current.promise });
  const first = h.client.load(); h.client.invalidate(); const second = h.client.load();
  old.reject(Error("private old failure")); await first; await flush(); await h.client.load();
  assert.equal(requests, 2); assert.equal(h.client.getSnapshot().phase, "loading"); assert.equal(h.client.getSnapshot().result, null);
  current.resolve(json(wire())); await second; assert.equal(h.client.getSnapshot().phase, "ready"); h.client.invalidate();
});

test("invalidation cancels a response-body reader and cannot leak a partially received result", async () => {
  let cancelled = false;
  const h = harness({ apiFetch: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":true,')); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } }) });
  const pending = h.client.load(); await flush(); h.client.invalidate(); await pending;
  assert.equal(cancelled, true); assert.equal(h.client.getSnapshot().phase, "idle"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.timers.size, 0);
});

test("30-second display expiry uses request-start monotonic time and does not poll", async () => {
  const response = deferred<Response>(), h = harness({ apiFetch: async () => response.promise });
  const pending = h.client.load(); await h.advance(5000); response.resolve(json(wire())); await pending;
  assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal([...h.timers.values()][0].at, 30000);
  await h.advance(24999); assert.notEqual(h.client.getSnapshot().result, null);
  await h.advance(1); assert.equal(h.client.getSnapshot().phase, "idle"); assert.equal(h.client.getSnapshot().result, null);
  assert.match(h.client.getSnapshot().message, /不会自动请求/); await h.advance(120000); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});

test("earlier manager expiry wins, while long or unbounded scopes still expire the display at 30 seconds", async () => {
  for (const [expiry, lifetime] of [["2026-10-02T12:00:08.000000Z", 8000], ["2026-10-02T12:01:00.000000Z", 30000], [null, 30000]] as const) {
    const input = query("manager"), response = deferred<Response>();
    const h = harness({ query: input, apiFetch: async () => response.promise });
    const pending = h.client.load(); await h.advance(2000); response.resolve(json(wire(input, { accessValidUntil: expiry }))); await pending;
    assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal([...h.timers.values()][0].at, lifetime);
    await h.advance(lifetime - 2001); assert.notEqual(h.client.getSnapshot().result, null);
    await h.advance(1); assert.equal(h.client.getSnapshot().result, null); await h.advance(120000); assert.equal(h.calls.length, 1); h.client.invalidate();
  }
});

test("already expired response, clock reversal and nonfinite monotonic readings fail closed", async () => {
  for (const elapsed of [30000, 30001, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const response = deferred<Response>(), h = harness({ apiFetch: async () => response.promise });
    const pending = h.client.load(); h.setNow(elapsed); response.resolve(json(wire())); await pending;
    assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.timers.size, 0); h.client.invalidate();
  }
  const input = query("manager"), response = deferred<Response>();
  const h = harness({ query: input, apiFetch: async () => response.promise });
  const pending = h.client.load(); h.setNow(8000); response.resolve(json(wire(input, { accessValidUntil: "2026-10-02T12:00:08.000000Z" }))); await pending;
  assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.timers.size, 0); h.client.invalidate();
});

test("an invalidated old timer cannot clear the newest verified result", async () => {
  const h = harness(); await h.client.load(); const oldTimer = [...h.timers.values()][0].callback;
  h.client.invalidate(); await h.client.load(); oldTimer();
  assert.equal(h.client.getSnapshot().phase, "ready"); assert.notEqual(h.client.getSnapshot().result, null);
  assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 1); h.client.invalidate();
});

test("hidden document never starts a request and returning visible still needs an explicit load", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), current = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: current });
  const h = harness();
  try {
    await h.client.load(); assert.equal(h.calls.length, 0); assert.equal(h.client.getSnapshot().phase, "idle");
    current.hidden = false; await h.advance(120000); assert.equal(h.calls.length, 0);
    await h.client.load(); assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().phase, "ready");
  } finally { h.client.invalidate(); if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});
