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
  assert.deepEqual(config.matcher, ["/", "/_next/static/:path*", "/((?!_next/image|favicon.ico|icon.svg|.*\\..*).*)"]);
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

test("middleware lets unauthenticated numeric merchant entries render the client login guard", async () => {
  const request = new NextRequest("https://faolla.com/10000000");

  const response = await middleware(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware keeps an authenticated merchant on their backend Faolla section", async () => {
  const request = new NextRequest("https://faolla.com/10000000?section=faolla&faollaUrl=https%3A%2F%2Ffaolla.com%2F", {
    headers: {
      cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=merchant; ${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=10000000`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.match(response.headers.get("x-middleware-rewrite") ?? "", /^https:\/\/faolla\.com\/admin\?/);
  assert.match(response.headers.get("x-middleware-rewrite") ?? "", /(?:\?|&)scope=site-10000000(?:&|$)/);
  assert.match(response.headers.get("x-middleware-rewrite") ?? "", /(?:\?|&)section=faolla(?:&|$)/);
});

test("middleware rejects backend Faolla section targets", async () => {
  const request = new NextRequest("https://faolla.com/10000000?section=faolla&faollaUrl=https%3A%2F%2Ffaolla.com%2Fadmin");

  const response = await middleware(request);
  const location = response.headers.get("location") ?? "";

  assert.equal(response.status, 307);
  assert.match(location, /^https:\/\/faolla\.com\/\?/);
  assert.doesNotMatch(location, /\/admin/);
  assert.match(location, /(?:\?|&)appShell=faolla(?:&|$)/);
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
      new NextRequest("https://fafona.faolla.com/", {
        headers: {
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
