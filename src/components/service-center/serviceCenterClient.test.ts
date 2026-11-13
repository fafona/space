import test from "node:test";
import assert from "node:assert/strict";
import { serviceRequest, ServiceRequestError } from "./serviceCenterClient";

test("an expired private read renews through the existing canonical session endpoint and retries only once", async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async input => { const path = String(input); calls.push(path);
    return path === "/api/auth/merchant-session" ? Response.json({ authenticated: true })
      : calls.length === 1 ? Response.json({ error: "unauthorized" }, { status: 401 }) : Response.json({ ok: true, orders: [] }); };
  try { assert.deepEqual(await serviceRequest("/api/orders?scope=personal"), { ok: true, orders: [] });
    assert.deepEqual(calls, ["/api/orders?scope=personal", "/api/auth/merchant-session", "/api/orders?scope=personal"]); }
  finally { globalThis.fetch = original; }
});
test("a write rejection or network timeout never causes an automatic duplicate write", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: "unauthorized" }, { status: 401 }); };
  try { await assert.rejects(serviceRequest("/api/personal-favorites", { method: "POST", body: "{}" }), /重新登录/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test("the panel can distinguish a definitive expiry from an unavailable identity service", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 503]) {
      globalThis.fetch = async () => Response.json({ authenticated: false }, { status });
      await assert.rejects(serviceRequest("/api/auth/merchant-session"), (error: unknown) => error instanceof ServiceRequestError && error.status === status);
    }
  } finally { globalThis.fetch = original; }
});
