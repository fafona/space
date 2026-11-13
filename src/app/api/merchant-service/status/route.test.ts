import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { handleMerchantServiceStatus, merchantServiceStatusDependencies } from "./route-handler";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";
import type { PersonalAccountSession } from "@/lib/personalAccountSession.server";

const origin = "https://launch.faolla.com", merchant = "https://cyberspace.faolla.com";
const request = (headers: Record<string,string> = {}) => new Request(origin + "/api/merchant-service/status?siteId=10909095", { headers: { host: "launch.faolla.com", origin: merchant, ...headers } });
const session = { user: { id: "private-user", email: "private@example.invalid", user_metadata: { personal_profile: { phone: "private-phone", favoriteSites: [{ id: "10909095", url: "https://faolla.com/site/10909095" }] } } } } as unknown as PersonalAccountSession;
test("site-scoped status projects only two booleans, with exact credentialed CORS and no identity or tokens", async () => {
  const original = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin;
  try {
    const response = await handleMerchantServiceStatus(request({ cookie: `${MERCHANT_AUTH_COOKIE}=synthetic-token` }), {
      ...merchantServiceStatusDependencies,
      authorize: async () => true,
      renew: async () => { const response = NextResponse.json({ user: session.user, accessToken: "never-expose" }); response.cookies.set(MERCHANT_AUTH_COOKIE, "renewed-secret", { httpOnly: true, secure: true, sameSite: "lax", path: "/" }); return response; },
      resolveSession: async request => { assert.match(request.headers.get("cookie") || "", /renewed-secret/); return session; },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), merchant);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(await response.json(), { ok: true, authenticated: true, favorited: true });
  } finally { if (original === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = original; }
});
test("unbound origins and noncanonical hosts are denied before session access; guests cause no login bootstrap", async () => {
  const original = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin;
  const noRead = async (): Promise<never> => { assert.fail("credentials must not be accessed"); };
  try {
    const deps = { ...merchantServiceStatusDependencies, authorize: async () => false, renew: noRead, resolveSession: noRead };
    const forbidden = await handleMerchantServiceStatus(request(), deps);
    assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.has("access-control-allow-origin"), false);
    const wrongHost = await handleMerchantServiceStatus(request({ host: "other.faolla.com" }), deps); assert.equal(wrongHost.status, 421);
    const guest = await handleMerchantServiceStatus(request(), { ...deps, authorize: async () => true });
    assert.deepEqual(await guest.json(), { ok: true, authenticated: false, favorited: false });
  } finally { if (original === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = original; }
});
test("a definitive expired session becomes a guest, while a transient failure remains unknown", async () => {
  const original = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin;
  try {
    for (const status of [401, 503]) {
      const response = await handleMerchantServiceStatus(request({ cookie: `${MERCHANT_AUTH_COOKIE}=expired-synthetic-token` }), {
        ...merchantServiceStatusDependencies,
        authorize: async () => true,
        renew: async () => { const result = NextResponse.json({ authenticated: false }, { status });
          result.cookies.set(MERCHANT_AUTH_COOKIE, "", { maxAge: 0, path: "/", httpOnly: true, secure: true }); return result; },
        resolveSession: async () => { assert.fail("a rejected renewal must not read identity"); },
      });
      if (status === 401) {
        assert.deepEqual(await response.json(), { ok: true, authenticated: false, favorited: false });
        assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
      } else {
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("set-cookie"), null, "a network failure cannot clear the login");
      }
    }
  } finally { if (original === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = original; }
});
test("old domain-shaped bookmarks hide the favorite entry without migrating or disclosing identity", async () => {
  const original = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = origin;
  const legacySession = structuredClone(session);
  legacySession.user.user_metadata = { personal_profile: { favoriteSites: [{ id: merchant, url: merchant + "/" }] } };
  const before = structuredClone(legacySession);
  try {
    const response = await handleMerchantServiceStatus(request({ cookie: `${MERCHANT_AUTH_COOKIE}=synthetic-token` }), {
      ...merchantServiceStatusDependencies, authorize: async () => true, renew: async () => NextResponse.json({ authenticated: true }),
      resolveSession: async () => legacySession,
      loadSite: async () => ({ id: "10909095", domainPrefix: "cyberspace" }) as Awaited<ReturnType<typeof merchantServiceStatusDependencies.loadSite>>,
    });
    assert.deepEqual(await response.json(), { ok: true, authenticated: true, favorited: true });
    assert.deepEqual(legacySession, before);
  } finally { if (original === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN; else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = original; }
});
