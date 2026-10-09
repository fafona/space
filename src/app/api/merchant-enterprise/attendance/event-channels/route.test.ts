import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleEventChannels, eventChannelsDependencies } from "./route-handler";
import { EVENT_CHANNEL_ERRORS, EVENT_CHANNEL_MAX_RESPONSE_BYTES, type EventChannelsQuery, type EventChannelsResult } from "@/lib/merchantAttendanceEventChannels";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

const base = "https://www.faolla.com/api/merchant-enterprise/attendance/event-channels";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query: EventChannelsQuery = { siteId: "99990001", access: "self", workerId: id(1), locationId: null, eventIds: [id(3), id(2)] };
function result(q = query): EventChannelsResult {
  return { siteId: q.siteId, access: q.access, workerId: q.workerId, locationId: q.locationId,
    viewerEmployeeId: q.access === "owner" ? null : id(5), asOf: "2026-10-02T12:00:00.000000Z",
    accessValidUntil: q.access === "manager" ? "2026-10-02T12:01:00.000000Z" : null,
    items: q.eventIds.map((eventId, index) => ({ eventId, action: "clock_in", occurredAt: "2026-10-02T11:00:00.000000Z",
      channel: index === 0 ? "onsite_qr" : "web", terminalId: index === 0 ? id(6) : null })) };
}
function post(value: unknown = query, url = base, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
}
function setup(extra: Partial<typeof eventChannelsDependencies> = {}) {
  const calls: Parameters<typeof eventChannelsDependencies.execute>[0][] = [], sites: string[] = [];
  const counters = { auth: 0 };
  const deps: typeof eventChannelsDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => { counters.auth++; return { user: { id: id(7) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }; },
    entitlement: async siteId => { sites.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof eventChannelsDependencies.entitlement>>; },
    execute: async input => { calls.push(input); return result(input.query); }, ...extra,
  };
  return { deps, calls, sites, counters };
}

test("default-off provenance gate requires both exact flags and is independent of QR issue flags and secrets", async () => {
  const names = ["FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED", "FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED",
    "FAOLLA_ATTENDANCE_TERMINALS_ENABLED", "FAOLLA_ATTENDANCE_ONSITE_QR_SECRET"];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(eventChannelsDependencies.enabled(), false);
    for (const [self, channels] of [[undefined, undefined], ["1", undefined], [undefined, "1"], ["true", "1"], ["1", "true"], ["0", "1"]]) {
      if (self === undefined) delete process.env.FAOLLA_ATTENDANCE_SELF_ENABLED; else process.env.FAOLLA_ATTENDANCE_SELF_ENABLED = self;
      if (channels === undefined) delete process.env.FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED; else process.env.FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED = channels;
      const f = setup({ enabled: eventChannelsDependencies.enabled });
      const response = await handleEventChannels(post(), f.deps);
      assert.equal(response.status, 404); assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
    }
    process.env.FAOLLA_ATTENDANCE_SELF_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED = "1";
    process.env.FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED = "0"; process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED = "0";
    delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
    const f = setup({ enabled: eventChannelsDependencies.enabled });
    assert.equal((await handleEventChannels(post(), f.deps)).status, 200);
  } finally { for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; } }
});

test("method, canonical host and origin guards refuse before authentication", async () => {
  const f = setup();
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) assert.equal((await handleEventChannels(new Request(base, { method }), f.deps)).status, 405);
  for (const request of [post(query, base.replace("www.faolla.com", "foreign.invalid")),
    post(query, base, { Origin: "https://foreign.invalid" }), post(query, base, { Origin: "null" }),
    post(query, base, { Origin: "" }), post(query, base, { Origin: "", Referer: "https://foreign.invalid/page" })])
    assert.equal((await handleEventChannels(request, f.deps)).status, 403);
  assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
});

test("read-only batch never accepts query parameters, token-bearing URLs or another HTTP verb", async () => {
  const f = setup();
  for (const suffix of ["?siteId=99990001", "?token=private", "?eventIds=" + id(3), "?access=self&access=owner"]) {
    assert.equal((await handleEventChannels(post(query, base + suffix), f.deps)).status, 400);
  }
  assert.equal(f.counters.auth, 0); assert.equal(f.calls.length, 0);
});

test("self, manager and owner all require a current password-authenticated session", async () => {
  for (const access of ["self", "manager", "owner"] as const) {
    for (const authenticationMethods of [[], ["oauth"], ["magiclink"], ["invite"], ["password", "recovery"]]) {
      const f = setup({ authenticate: async () => ({ user: { id: id(7) } as User, accessToken: "synthetic", authenticationMethods }) });
      const response = await handleEventChannels(post({ ...query, access, locationId: access === "manager" ? id(8) : null }), f.deps);
      assert.equal(response.status, 403); assert.equal(f.calls.length, 0); assert.equal(f.sites.length, 0);
      assert.deepEqual(await response.json(), { ok: false, error: "employee_password_authentication_required" });
    }
  }
});

test("paused collection still returns authorized provenance and current principal context for all read scopes", async () => {
  for (const access of ["self", "manager", "owner"] as const) {
    const value = { ...query, access, locationId: access === "manager" ? id(8) : null }, f = setup();
    const response = await handleEventChannels(post(value), f.deps);
    assert.equal(response.status, 200); assert.deepEqual(f.calls, [{ query: value, authUserId: id(7) }]);
    assert.deepEqual(f.sites, [query.siteId]);
    assert.deepEqual(await response.json(), { ok: true, ...result(value), moduleEnabled: false });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
  }
});

test("enterprise entitlement and authentication denial stop every RPC", async () => {
  for (const extra of [
    { authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } },
    { entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } },
  ]) {
    const f = setup(extra), response = await handleEventChannels(post(), f.deps);
    assert.ok([401, 403].includes(response.status)); assert.equal(f.calls.length, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("body rejects client authority, capabilities, extra fields and invalid or duplicate scope IDs", async () => {
  const f = setup();
  const missing = Object.fromEntries(Object.entries(query).filter(([field]) => field !== "locationId"));
  for (const invalid of [null, [], missing, { ...query, authUserId: id(9) }, { ...query, viewerEmployeeId: id(9) },
    { ...query, claims: {} }, { ...query, token: "private" }, { ...query, command: {} }, { ...query, nonce: id(9) },
    { ...query, access: "admin" }, { ...query, workerId: "other" }, { ...query, locationId: id(8) },
    { ...query, access: "manager", locationId: null }, { ...query, access: "owner", locationId: id(8) },
    { ...query, eventIds: [] }, { ...query, eventIds: [id(3), id(3)] },
    { ...query, eventIds: Array.from({ length: 203 }, (_, n) => id(n + 1)) }]) {
    assert.equal((await handleEventChannels(post(invalid), f.deps)).status, 400);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.sites.length, 0);
});

test("body is bounded to 16KiB by actual UTF-8 bytes and declared length, and JSON content type is mandatory", async () => {
  const f = setup();
  for (const request of [post({ padding: "x".repeat(16_385) }), post({ padding: "中".repeat(6_000) }),
    post(query, base, { "Content-Length": "16385" }), post(query, base, { "Content-Length": "invalid" })]) {
    assert.equal((await handleEventChannels(request, f.deps)).status, 413);
  }
  assert.equal((await handleEventChannels(post(query, base, { "Content-Type": "text/plain" }), f.deps)).status, 415);
  assert.equal((await handleEventChannels(new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: "{" }), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("streaming oversized request is canceled without an RPC even without content length", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(" ".repeat(10_000))); controller.enqueue(new TextEncoder().encode(" ".repeat(10_000)));
  }, cancel() { canceled = true; } });
  const request = new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const f = setup(); assert.equal((await handleEventChannels(request, f.deps)).status, 413);
  assert.equal(canceled, true); assert.equal(f.calls.length, 0);
});

test("valid maximum batch retains requested item order and stays below 64KiB", async () => {
  const value = { ...query, eventIds: Array.from({ length: 202 }, (_, n) => id(202 - n)) }, f = setup();
  const response = await handleEventChannels(post(value), f.deps), text = await response.text();
  assert.equal(response.status, 200); assert.ok(Buffer.byteLength(text) <= EVENT_CHANNEL_MAX_RESPONSE_BYTES);
  assert.deepEqual(JSON.parse(text).items.map((item: { eventId: string }) => item.eventId), value.eventIds);
});

test("raw private result fields and malformed response scopes never leak through API projection", async () => {
  for (const raw of [{ ...result(), token: "private secret" }, { ...result(), claims: { nonce: "private secret" } },
    { ...result(), items: result().items.map(item => ({ ...item, actorAuthUserId: "private secret" })) },
    { ...result(), siteId: "99990002" }, { ...result(), workerId: id(33) },
    { ...result(), items: result().items.slice(1) }, { ...result(), items: result().items.reverse() },
    { ...result(), items: [{ ...result().items[0], channel: "web" }, result().items[1]] }]) {
    const f = setup({ execute: async () => raw as EventChannelsResult }), response = await handleEventChannels(post(), f.deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
});

test("known attendance failures are typed while unexpected SQL and credential details are redacted", async () => {
  for (const [code, status] of Object.entries(EVENT_CHANNEL_ERRORS)) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleEventChannels(post(), f.deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  for (const error of [Error("private SQL/credential"), new MerchantAttendanceError("private SQL/credential")]) {
    const f = setup({ execute: async () => { throw error; } }), response = await handleEventChannels(post(), f.deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
});

test("output byte limit covers error bodies and returns a generic bounded failure", async () => {
  const f = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError("private".repeat(12_000), 503); } });
  const response = await handleEventChannels(post(), f.deps), text = await response.text();
  assert.equal(response.status, 503); assert.ok(Buffer.byteLength(text) <= EVENT_CHANNEL_MAX_RESPONSE_BYTES);
  assert.deepEqual(JSON.parse(text), { ok: false, error: "attendance_unavailable" });
});

test("rate limiter runs on authenticated principal and denies before entitlement or RPC", async () => {
  let principal = ""; const f = setup({ allow: auth => { principal = auth; return false; } });
  const response = await handleEventChannels(post(), f.deps);
  assert.equal(principal, id(7)); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(f.calls.length, 0); assert.equal(f.sites.length, 0);
});
