import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  __clearMiddlewareSiteResolveCacheForTests,
  config,
  isLocalLikeRequestHostname,
  middleware,
  resolveHttpsRedirectUrl,
} from "../middleware";
import {
  MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE,
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
} from "./lib/merchantAuthSession";

process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://faolla.com";
process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";

test("isLocalLikeRequestHostname only treats local hosts and IPs as local-like", () => {
  assert.equal(isLocalLikeRequestHostname("localhost"), true);
  assert.equal(isLocalLikeRequestHostname("127.0.0.1"), true);
  assert.equal(isLocalLikeRequestHostname("[::1]:3000"), true);
  assert.equal(isLocalLikeRequestHostname("faolla.com"), false);
});

test("resolveHttpsRedirectUrl upgrades direct public http requests", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://faolla.com/admin?scope=site-10000000"),
    new Headers({
      host: "faolla.com",
    }),
  );

  assert.equal(redirectUrl?.toString(), "https://faolla.com/admin?scope=site-10000000");
});

test("resolveHttpsRedirectUrl upgrades proxy-reported public http requests", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://127.0.0.1:3000/api/auth/signin"),
    new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "fafona.faolla.com",
      "x-forwarded-proto": "http",
    }),
  );

  assert.equal(redirectUrl?.toString(), "https://fafona.faolla.com/api/auth/signin");
});

test("resolveHttpsRedirectUrl leaves local development requests alone", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://localhost:3000/admin"),
    new Headers({
      host: "localhost:3000",
    }),
  );

  assert.equal(redirectUrl, null);
});

test("resolveHttpsRedirectUrl avoids redirecting when a proxy omits forwarded proto", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://127.0.0.1:3000/admin"),
    new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "faolla.com",
      "x-forwarded-for": "203.0.113.10",
    }),
  );

  assert.equal(redirectUrl, null);
});

test("middleware matcher now covers api routes for https enforcement", () => {
  assert.deepEqual(config.matcher, ["/", "/_next/static/:path*", "/((?!_next/image(?:/|$)).*)"]);
});

test("middleware leaves hashed static assets cacheable", async () => {
  const request = new NextRequest("https://faolla.com/_next/static/chunks/app.js");

  const response = await middleware(request);

  assert.equal(response.headers.get("cache-control"), null);
});

test("middleware redirects bad OAuth state before homepage render", async () => {
  const request = new NextRequest("https://faolla.com/?error_code=bad_oauth_state&appShell=faolla&loginFrom=checkout");

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://faolla.com/login?oauth_error=bad_oauth_state&appShell=faolla&loginFrom=checkout",
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware canonicalizes the launch host before browser session recovery", async () => {
  const request = new NextRequest("https://launch.faolla.com/?appShell=faolla&nativeStart=1");

  const response = await middleware(request);

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://faolla.com/launch?appShell=faolla&nativeStart=1",
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("clear-site-data"), '"cache", "storage"');
});

test("middleware preserves the OAuth callback query across the production login bridge", async () => {
  const previousPortalOrigin = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://launch.faolla.com";
  try {
    const callbackPath =
      "/login?oauth=google&accountType=merchant&redirect=%2F10000000&code=test-code&state=test-state";
    const response = await middleware(new NextRequest(`https://faolla.com${callbackPath}`));

    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `https://launch.faolla.com${callbackPath}`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    if (previousPortalOrigin === undefined) {
      delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
    } else {
      process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = previousPortalOrigin;
    }
  }
});

test("middleware never replays unsafe launch-host requests across origins", async () => {
  const response = await middleware(
    new NextRequest("https://launch.faolla.com/", { method: "POST", body: "state=private" }),
  );

  assert.equal(response.status, 421);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("clear-site-data"), null);
  assert.deepEqual(await response.json(), { error: "portal_origin_required" });
});

test("middleware keeps an unauthenticated launch page on the canonical portal", async () => {
  const response = await middleware(new NextRequest("https://faolla.com/launch?appShell=faolla"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware redirects authenticated personal launch requests before page render", async () => {
  const request = new NextRequest("https://faolla.com/launch?appShell=faolla", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=access-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=personal`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://faolla.com/me?appShell=faolla");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware redirects authenticated merchant launch requests before page render", async () => {
  const request = new NextRequest("https://faolla.com/launch?appShell=faolla&nativeStart=1", {
    headers: {
      cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=merchant; ${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=10000003`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://faolla.com/10000003?appShell=faolla");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware redirects numeric Faolla section to the public app shell before admin rewrite", async () => {
  const request = new NextRequest("https://faolla.com/10000000?section=faolla&faollaUrl=https%3A%2F%2Ffaolla.com%2F");

  const response = await middleware(request);
  const location = response.headers.get("location") ?? "";

  assert.equal(response.status, 307);
  assert.match(location, /^https:\/\/faolla\.com\/\?/);
  assert.match(location, /(?:\?|&)appShell=faolla(?:&|$)/);
  assert.match(location, /(?:\?|&)uiLocale=zh-CN(?:&|$)/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware moves unauthenticated numeric merchant entries to a tenant origin", async () => {
  const request = new NextRequest("https://faolla.com/10000000");

  const response = await middleware(request);

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://10000000.faolla.com/10000000");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware moves direct published-site routes off the authenticated portal origin", async () => {
  const response = await middleware(new NextRequest("https://faolla.com/site/10000000?preview=0"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://10000000.faolla.com/site/10000000?preview=0");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware moves public card and share routes off the authenticated portal origin", async () => {
  for (const path of ["/card/public-card", "/share/business-card?key=public-card"]) {
    const response = await middleware(new NextRequest(`https://faolla.com${path}`));
    assert.equal(response.status, 308);
    assert.equal(new URL(response.headers.get("location") ?? "https://invalid").hostname, "public.faolla.com");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("middleware keeps enterprise entry paths on the canonical portal as sensitive no-store UI", async () => {
  for (const path of ["/enterprise", "/enterprise/10000000"]) {
    const response = await middleware(new NextRequest(`https://faolla.com${path}`));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
});

test("middleware returns enterprise UI paths from tenant origins to the canonical portal", async () => {
  for (const path of ["/enterprise", "/enterprise/10000000?view=tasks"]) {
    const response = await middleware(new NextRequest(`https://merchant.faolla.com${path}`));

    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `https://faolla.com${path}`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  }

  const mutation = await middleware(
    new NextRequest("https://merchant.faolla.com/enterprise/10000000", {
      method: "POST",
      body: "private=state",
    }),
  );
  assert.equal(mutation.status, 421);
  assert.equal(mutation.headers.get("location"), null);
  assert.match(mutation.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await mutation.json(), { error: "portal_origin_required" });
});

test("middleware keeps nested enterprise paths inside the canonical sensitive portal boundary", async () => {
  const path = "/enterprise/10000000/workflows/executions?view=pending";
  const canonical = await middleware(new NextRequest(`https://faolla.com${path}`));
  assert.equal(canonical.headers.get("x-middleware-next"), "1");
  assert.equal(canonical.headers.get("location"), null);
  assert.match(canonical.headers.get("cache-control") ?? "", /no-store/);
  assert.match(canonical.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  const tenant = await middleware(new NextRequest(`https://merchant.faolla.com${path}`));
  assert.equal(tenant.status, 308);
  assert.equal(tenant.headers.get("location"), `https://faolla.com${path}`);
});

test("middleware isolates portal auth and super-admin console hosts", async () => {
  const tenantAuth = await middleware(
    new NextRequest("https://merchant.faolla.com/api/auth/merchant-session", {
      headers: { cookie: `${MERCHANT_AUTH_COOKIE}=forged-tenant-cookie` },
    }),
  );
  assert.equal(tenantAuth.status, 421);

  const portalSuperAdmin = await middleware(
    new NextRequest("https://faolla.com/api/super-admin/auth/session"),
  );
  assert.equal(portalSuperAdmin.status, 421);

  const consoleTenantPath = await middleware(
    new NextRequest("https://console.faolla.com/merchant-slug"),
  );
  assert.equal(consoleTenantPath.status, 404);

  const consoleApi = await middleware(
    new NextRequest("https://console.faolla.com/api/super-admin/auth/session"),
  );
  assert.equal(consoleApi.status, 200);
  assert.match(consoleApi.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(consoleApi.headers.get("x-frame-options"), "DENY");
  assert.match(consoleApi.headers.get("cache-control") ?? "", /no-store/);

  for (const path of ["/api/merchant-draft", "/api/publish", "/api/assets/upload"]) {
    const allowed = await middleware(new NextRequest(`https://console.faolla.com${path}`));
    assert.equal(allowed.headers.get("x-middleware-next"), "1");
    assert.match(allowed.headers.get("cache-control") ?? "", /no-store/);
  }
  const unrelatedApi = await middleware(new NextRequest("https://console.faolla.com/api/orders"));
  assert.equal(unrelatedApi.status, 404);
});

test("middleware cannot bypass portal or console isolation with dotted merchant entries", async () => {
  const consoleResponse = await middleware(new NextRequest("https://console.faolla.com/victim."));
  assert.equal(consoleResponse.status, 404);

  const portalResponse = await middleware(new NextRequest("https://faolla.com/victim."));
  assert.equal(portalResponse.status, 308);
  assert.equal(new URL(portalResponse.headers.get("location") ?? "https://invalid").hostname, "victim.faolla.com");
  assert.match(portalResponse.headers.get("cache-control") ?? "", /no-store/);

  const trustedAsset = await middleware(new NextRequest("https://console.faolla.com/faolla-logo-f.png"));
  assert.equal(trustedAsset.headers.get("x-middleware-next"), "1");
  for (const path of ["/icon.svgvictim", "/favicon.icovictim"]) {
    const response = await middleware(new NextRequest(`https://console.faolla.com${path}`));
    assert.equal(response.status, 404);
  }
});

test("middleware refuses forwarded-host spoofing for sensitive routes", async () => {
  const response = await middleware(
    new NextRequest("https://merchant.faolla.com/api/auth/merchant-session", {
      headers: {
        host: "merchant.faolla.com",
        "x-forwarded-host": "faolla.com",
      },
    }),
  );
  assert.equal(response.status, 421);
});

test("middleware does not resolve tenant content from a spoofed forwarded host on the portal root", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify([{ merchant_id: "10000000" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const response = await middleware(
      new NextRequest("https://faolla.com/", {
        headers: {
          host: "faolla.com",
          "x-forwarded-host": "victim.faolla.com",
          "x-forwarded-proto": "https",
        },
      }),
    );
    assert.equal(calls, 0);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("middleware expires legacy cross-subdomain auth cookies without reflecting their values", async () => {
  const response = await middleware(
    new NextRequest("https://faolla.com/login", {
      headers: {
        cookie:
          "faolla-auth-storage.sb-project-auth-token=legacy-secret; faolla-google-oauth-entry=merchant; merchant-space-merchant-refresh=legacy-refresh; merchant-space-super-admin=legacy-admin; merchant-space-super-admin-device=legacy-device",
      },
    }),
  );
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /faolla-auth-storage\.sb-project-auth-token=/);
  assert.match(setCookie, /faolla-google-oauth-entry=/);
  assert.match(setCookie, /merchant-space-merchant-refresh=/);
  assert.match(setCookie, /merchant-space-super-admin=/);
  assert.match(setCookie, /merchant-space-super-admin-device=/);
  assert.match(setCookie, /Domain=faolla\.com/i);
  assert.match(setCookie, /Max-Age=0/i);
  assert.equal((setCookie.match(/faolla-auth-storage\.sb-project-auth-token=/g) ?? []).length, 2);
  assert.doesNotMatch(setCookie, /legacy-secret|legacy-refresh|legacy-admin|legacy-device/);
});

test("middleware prioritizes fixed legacy session cookies over attacker-shaped cleanup noise", async () => {
  const noise = Array.from(
    { length: 20 },
    (_value, index) => `faolla-auth-storage.noise-${index}=noise-${index}`,
  ).join("; ");
  const response = await middleware(
    new NextRequest("https://faolla.com/login", {
      headers: {
        cookie: `${noise}; merchant-space-super-admin=legacy-admin; merchant-space-merchant-refresh=legacy-refresh`,
      },
    }),
  );
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /merchant-space-super-admin=/);
  assert.match(setCookie, /merchant-space-merchant-refresh=/);
  assert.doesNotMatch(setCookie, /legacy-admin|legacy-refresh/);
});

test("middleware removes a legacy backend Faolla section from an authenticated merchant entry", async () => {
  const request = new NextRequest("https://faolla.com/10000000?section=faolla&faollaUrl=https%3A%2F%2Ffaolla.com%2F", {
    headers: {
      cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=merchant; ${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=10000000`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://faolla.com/10000000");
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware rejects backend Faolla section targets", async () => {
  for (const target of ["/admin", "/enterprise/10000000"]) {
    const request = new NextRequest(
      `https://faolla.com/10000000?section=faolla&faollaUrl=${encodeURIComponent(`https://faolla.com${target}`)}`,
    );

    const response = await middleware(request);
    const location = response.headers.get("location") ?? "";

    assert.equal(response.status, 307);
    assert.match(location, /^https:\/\/faolla\.com\/\?/);
    assert.doesNotMatch(location, new RegExp(target.split("/")[1] ?? "invalid"));
    assert.match(location, /(?:\?|&)appShell=faolla(?:&|$)/);
  }
});

test("middleware redirects unauthenticated mobile public merchant entries to the guest Faolla shell", async () => {
  __clearMiddlewareSiteResolveCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([{ merchant_id: "10000000", updated_at: "2026-06-16T10:00:00.000Z" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    const response = await middleware(
      new NextRequest("http://localhost:3000/", {
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "fafona.faolla.com",
          "x-forwarded-proto": "https",
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        },
      }),
    );
    const location = response.headers.get("location") ?? "";

    assert.equal(response.status, 307);
    assert.match(location, /^https:\/\/fafona\.faolla\.com\/me\?/);
    assert.match(location, /(?:\?|&)section=faolla(?:&|$)/);
    assert.match(location, /(?:\?|&)faollaUrl=https%3A%2F%2Ffafona\.faolla\.com%2F(?:&|$)/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
    __clearMiddlewareSiteResolveCacheForTests();
  }
});

test("middleware reuses a fresh merchant prefix resolve", async () => {
  __clearMiddlewareSiteResolveCacheForTests();
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let calls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify([{ merchant_id: "10000000", updated_at: "2026-06-16T10:00:00.000Z" }]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const first = await middleware(new NextRequest("https://fafona.faolla.com/"));
    const second = await middleware(new NextRequest("https://fafona.faolla.com/"));
    assert.match(first.headers.get("x-middleware-rewrite") ?? "", /\/site\/10000000$/);
    assert.match(second.headers.get("x-middleware-rewrite") ?? "", /\/site\/10000000$/);
    assert.match(first.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
    __clearMiddlewareSiteResolveCacheForTests();
  }
});
