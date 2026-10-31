import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";
import { MERCHANT_AUTH_COOKIE, MERCHANT_AUTH_REFRESH_COOKIE } from "@/lib/merchantAuthSession";

test("explicit reauthentication cannot return a cached access token already rejected by enterprise", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "FAOLLA_CANONICAL_PORTAL_ORIGIN"];
  const previous = names.map(name => process.env[name]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic-reauth.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service";
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://faolla.com";
  let expired = false, refreshes = 0;
  const user = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.test",
    app_metadata: {}, user_metadata: { platform_account_type: "merchant", platform_account_id: "10000000", merchant_id: "10000000" } };
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://synthetic-reauth.example.test");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/auth/v1/user") {
      const access = new Headers(init?.headers).get("authorization");
      return expired && access === "Bearer synthetic-reauth-old" ? json({ message: "expired" }, 401) : json(user);
    }
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "refresh_token");
      assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: "synthetic-reauth-refresh" });
      refreshes++;
      return json({ access_token: "synthetic-reauth-new", refresh_token: "synthetic-reauth-rotated", expires_in: 3600, user });
    }
    assert.equal(init?.method ?? "GET", "GET", "no business mutations allowed in synthetic auth test");
    if (url.pathname.startsWith("/auth/v1/admin/users/")) return json({ user });
    assert(url.pathname.startsWith("/rest/v1/"));
    return json([]);
  }) as typeof fetch;
  const request = (query = "") => new Request("https://faolla.com/api/auth/merchant-session" + query,
    { headers: { cookie: `${MERCHANT_AUTH_COOKIE}=synthetic-reauth-old; ${MERCHANT_AUTH_REFRESH_COOKIE}=synthetic-reauth-refresh` } });
  try {
    assert.equal((await GET(request())).status, 200, "warm the existing 20-second server cache");
    expired = true;
    const renewed = await GET(request("?reauth=1"));
    assert.equal(renewed.status, 200);
    assert.equal(refreshes, 1, "confirmed 401 recovery must actually revalidate, not reuse cached old credentials");
    assert.match(renewed.headers.get("set-cookie") ?? "", /synthetic-reauth-new/);
    const payload = await renewed.json();
    assert.equal(payload.user.id, user.id);
    assert.equal(payload.accessToken, undefined);
    assert.equal(payload.refreshToken, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
