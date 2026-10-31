import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantEnterpriseSessionRecovery } from "@/lib/merchantEnterpriseSessionRecovery";

const path = "/api/merchant-enterprise/overview?siteId=10000000";
const renewalPath = "/api/auth/merchant-session?reauth=1";
const user = "10000000-0000-4000-8000-000000000001";
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const session = () => reply(200, { authenticated: true, user: { id: user } });
const cookieInit = () => ({ credentials: "include" as const, cache: "no-store" as const });
function fixture(responses: Array<Response | (() => Promise<Response>)>, initial: string | null = user) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let current = initial;
  const request = createMerchantEnterpriseSessionRecovery({
    fetch: (async (input, init) => {
      calls.push({ path: String(input), init });
      const next = responses.shift();
      assert(next, "unexpected extra request");
      return typeof next === "function" ? next() : next;
    }) as typeof fetch,
    getAuthUserId: () => current,
  });
  return { request, calls, identity: (id: string | null) => { current = id; } };
}

test("expired cookie read renews once, pins recovered identity and retries exactly once", async () => {
  const f = fixture([reply(401), session(), reply(200)]);
  const controller = new AbortController();
  assert.equal((await f.request(path, { ...cookieInit(), signal: controller.signal })).status, 200);
  assert.deepEqual(f.calls.map(call => call.path), [path, renewalPath, path]);
  assert.equal(f.calls[1].init?.credentials, "include");
  assert.equal(f.calls[1].init?.cache, "no-store");
  assert.equal(f.calls[2].init?.signal, controller.signal);
  const headers = new Headers(f.calls[2].init?.headers);
  assert.equal(headers.get("x-merchant-expected-auth-user-id"), user);
  assert.equal(headers.has("x-merchant-access-token"), false);
  assert.equal(headers.has("x-merchant-refresh-token"), false);
});

test("an initial read without an already mounted identity can recover but is still server-pinned", async () => {
  const f = fixture([reply(401), session(), reply(200)], null);
  assert.equal((await f.request(path, cookieInit())).status, 200);
  assert.equal(new Headers(f.calls[2].init?.headers).get("x-merchant-expected-auth-user-id"), user);
});

const noReplayRequests: RequestInit[] = [
  { method: "POST", body: "{}" }, { method: "PATCH", body: "{}" }, { method: "DELETE" }, { method: "PUT", body: "{}" },
  { headers: { "x-merchant-access-token": "employee-token" } }, { headers: { "x-merchant-access-token": "" } },
  { headers: { authorization: "Bearer employee-token" } }, { credentials: "omit" as const },
  { method: "GET", body: "must-not-replay" },
];
for (const init of noReplayRequests) test(`never replay mutations or cross employee-cookie authority: ${JSON.stringify(init)}`, async () => {
  const original = reply(401), f = fixture([original]);
  assert.equal(await f.request(path, { ...cookieInit(), ...init }), original);
  assert.equal(f.calls.length, 1);
});

for (const status of [200, 403, 404, 408, 429, 500, 503]) test(`ordinary status ${status} never triggers session recovery`, async () => {
  const original = reply(status), f = fixture([original]);
  assert.equal(await f.request(path, cookieInit()), original);
  assert.equal(f.calls.length, 1);
});

test("a non-enterprise request is never retried", async () => {
  const f = fixture([reply(401)]);
  assert.equal((await f.request("https://external.example.test/api/merchant-enterprise/overview", cookieInit())).status, 401);
  assert.equal(f.calls.length, 1);
});

test("a genuine session rejection preserves the original denial", async () => {
  for (const status of [401, 403]) {
    const original = reply(401), f = fixture([original, reply(status)]);
    assert.equal(await f.request(path, cookieInit()), original);
    assert.equal(f.calls.length, 2);
  }
});

test("another account or a changed local identity must not inherit or replay the old read", async () => {
  const original = reply(401), f = fixture([original, reply(200, { authenticated: true, user: { id: "another-user" } })]);
  assert.equal(await f.request(path, cookieInit()), original);
  assert.equal(f.calls.length, 2);
  const g = fixture([original, async () => { g.identity("another-user"); return session(); }]);
  assert.equal(await g.request(path, cookieInit()), original);
  assert.equal(g.calls.length, 2);
});

test("service, transport and malformed session failures are unknown rather than logouts", async () => {
  for (const next of [reply(503), reply(429), reply(200), reply(200, { authenticated: true, user: { id: "" } }),
    new Response("{", { status: 200 }), async () => { throw new TypeError("synthetic network failure"); }]) {
    const f = fixture([reply(401), next]);
    await assert.rejects(() => f.request(path, cookieInit()), /登录服务暂时不可用/);
    assert.equal(f.calls.length, 2);
  }
});

test("a still-invalid refreshed cookie does not loop or suppress denial", async () => {
  const final = reply(401), f = fixture([reply(401), session(), final]);
  assert.equal(await f.request(path, cookieInit()), final);
  assert.equal(f.calls.length, 3);
});

test("concurrent expired reads share one renewal and independently cancel", async () => {
  let release!: (response: Response) => void;
  const waiting = new Promise<Response>(resolve => { release = resolve; });
  const calls: string[] = [];
  let renewed = false;
  const request = createMerchantEnterpriseSessionRecovery({ getAuthUserId: () => user, fetch: (async input => {
    const target = String(input); calls.push(target);
    if (target === renewalPath) return waiting;
    return reply(renewed ? 200 : 401);
  }) as typeof fetch });
  const controller = new AbortController();
  const a = request(path, { ...cookieInit(), signal: controller.signal });
  const b = request(path, cookieInit());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(target => target === renewalPath).length, 1);
  controller.abort(); renewed = true; release(session());
  await assert.rejects(a, { name: "AbortError" });
  assert.equal((await b).status, 200);
  assert.equal(calls.length, 4, "cancelled caller must never issue its retry");
});

test("a timed-out renewal remains an availability failure and never retries the protected read", async () => {
  let calls = 0;
  const request = createMerchantEnterpriseSessionRecovery({ getAuthUserId: () => user, renewalTimeoutMs: 10,
    fetch: (async (_input, init) => {
      if (++calls === 1) return reply(401);
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Synthetic", "AbortError")), { once: true }));
    }) as typeof fetch });
  await assert.rejects(() => request(path, cookieInit()), /登录服务暂时不可用/);
  assert.equal(calls, 2);
});

test("a finished failed renewal is not cached indefinitely", async () => {
  const f = fixture([reply(401), reply(503), reply(401), session(), reply(200)]);
  await assert.rejects(() => f.request(path, cookieInit()), /登录服务暂时不可用/);
  assert.equal((await f.request(path, cookieInit())).status, 200);
  assert.equal(f.calls.length, 5);
});
