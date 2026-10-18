import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/auth/merchant-session/route";
import { POST as logoutMerchant } from "@/app/api/auth/merchant-logout/route";
import {
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
} from "@/lib/merchantAuthSession";

test("merchant-session rejects an immutable merchant staff principal", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-staff.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: "99999999-9999-4999-8999-999999999999",
          email: "staff@example.com",
          user_metadata: { merchant_id: "12345678" },
          app_metadata: { principal_type: "merchant_staff" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await GET(
      new Request("https://www.faolla.com/api/auth/merchant-session", {
        headers: {
          cookie: `${MERCHANT_AUTH_COOKIE}=staff-access-token`,
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      authenticated: false,
      error: "merchant_staff_identity_forbidden",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session GET falls back to an older duplicate cookie when the newest token is stale", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);

    if (requestUrl.pathname === "/auth/v1/user") {
      const authorizationHeader =
        init?.headers instanceof Headers
          ? init.headers.get("authorization")
          : Array.isArray(init?.headers)
            ? new Headers(init?.headers).get("authorization")
            : new Headers(init?.headers ?? {}).get("authorization");
      if (authorizationHeader === "Bearer access-token-valid") {
        return new Response(
          JSON.stringify({
            id: "11111111-1111-4111-8111-111111111111",
            email: "owner@example.com",
            user_metadata: {},
            app_metadata: {},
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    if (requestUrl.pathname === "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111") {
      return new Response(
        JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "owner@example.com",
            user_metadata: {
              platform_account_id: "12345678",
              platform_account_type: "merchant",
              merchant_id: "12345678",
            },
            app_metadata: {},
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (requestUrl.pathname === "/rest/v1/merchant_enterprise_employees") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (requestUrl.pathname === "/rest/v1/merchants") {
      return new Response(JSON.stringify([{ id: "12345678" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await GET(
      new Request("https://www.faolla.com/api/auth/merchant-session", {
        headers: {
          cookie: `${MERCHANT_AUTH_COOKIE}=access-token-valid; ${MERCHANT_AUTH_COOKIE}=access-token-stale`,
        },
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.accountType, "merchant");
    assert.equal(body.accountId, "12345678");
    assert.equal(body.merchantId, "12345678");
    assert.deepEqual(body.merchantIds, ["12345678"]);
    assert.equal(body.personalServiceConfig, null);
    assert.equal(body.personalServicePaused, false);
    assert.equal(body.frontendAuthProof, undefined);
    assert.equal(body.accessToken, undefined);
    assert.equal(body.refreshToken, undefined);
    assert.deepEqual(body.user, {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
      user_metadata: {},
      app_metadata: {},
    });

    const accountSwitchResponse = await GET(
      new Request("https://www.faolla.com/api/auth/merchant-session?accountSwitch=1", {
        headers: {
          cookie: `${MERCHANT_AUTH_COOKIE}=access-token-valid; ${MERCHANT_AUTH_COOKIE}=access-token-stale; ${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token-valid`,
        },
      }),
    );
    assert.equal(accountSwitchResponse.status, 200);
    const accountSwitchBody = await accountSwitchResponse.json();
    assert.equal(accountSwitchBody.accessToken, undefined);
    assert.equal(accountSwitchBody.refreshToken, undefined);
    assert.equal(accountSwitchBody.tokenType, undefined);
    assert.equal(accountSwitchBody.accountType, "merchant");
    assert.equal(accountSwitchBody.merchantId, "12345678");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session account switch GET never returns refreshed tokens", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-refresh.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);

    if (requestUrl.pathname === "/auth/v1/token") {
      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner2@example.com",
            user_metadata: {},
            app_metadata: {},
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (requestUrl.pathname === "/auth/v1/user") {
      const authorizationHeader =
        init?.headers instanceof Headers
          ? init.headers.get("authorization")
          : Array.isArray(init?.headers)
            ? new Headers(init?.headers).get("authorization")
            : new Headers(init?.headers ?? {}).get("authorization");
      if (authorizationHeader === "Bearer new-access-token") {
        return new Response(
          JSON.stringify({
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner2@example.com",
            user_metadata: {},
            app_metadata: {},
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    if (requestUrl.pathname === "/auth/v1/admin/users/22222222-2222-4222-8222-222222222222") {
      return new Response(
        JSON.stringify({
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "owner2@example.com",
            user_metadata: {
              platform_account_id: "87654321",
              platform_account_type: "merchant",
              merchant_id: "87654321",
            },
            app_metadata: {},
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (requestUrl.pathname === "/rest/v1/merchant_enterprise_employees") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (requestUrl.pathname === "/rest/v1/merchants") {
      return new Response(JSON.stringify([{ id: "87654321" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await GET(
      new Request("https://www.faolla.com/api/auth/merchant-session?accountSwitch=1", {
        headers: {
          cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=old-refresh-token`,
        },
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.accountType, "merchant");
    assert.equal(body.merchantId, "87654321");
    assert.equal(body.accessToken, undefined);
    assert.equal(body.refreshToken, undefined);
    assert.equal(body.expiresIn, undefined);
    assert.equal(body.tokenType, undefined);
    assert.deepEqual(body.user, {
      id: "22222222-2222-4222-8222-222222222222",
      email: "owner2@example.com",
      user_metadata: {},
      app_metadata: {},
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session POST exchanges Google OAuth code before browser session sync", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let exchangedBody: Record<string, unknown> | null = null;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-oauth.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const googleUser = {
    id: "33333333-3333-4333-8333-333333333333",
    email: "google-owner@example.com",
    user_metadata: {
      platform_account_type: "merchant",
      platform_account_id: "12345678",
      merchant_id: "12345678",
    },
    app_metadata: {},
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);

    if (requestUrl.pathname === "/auth/v1/token") {
      exchangedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      assert.equal(requestUrl.searchParams.get("grant_type"), "pkce");
      return new Response(
        JSON.stringify({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user: googleUser,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (requestUrl.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify(googleUser), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    if (requestUrl.pathname === "/rest/v1/merchant_enterprise_employees") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
        },
        body: JSON.stringify({
          authCode: "google-auth-code",
          codeVerifier: "browser-code-verifier/PASSWORD_RECOVERY",
          authProvider: "google",
          preferredAccountType: "merchant",
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(exchangedBody, {
      auth_code: "google-auth-code",
      code_verifier: "browser-code-verifier",
    });
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.accountType, "merchant");
    assert.equal(body.merchantId, "12345678");
    assert.equal(body.user.email, "google-owner@example.com");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session POST reports invalid Google OAuth code explicitly", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-oauth-invalid.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/auth/v1/token") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
        },
        body: JSON.stringify({
          authCode: "expired-google-auth-code",
          codeVerifier: "browser-code-verifier",
          preferredAccountType: "merchant",
        }),
      }),
    );

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "merchant_session_google_code_invalid");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
  }
});

async function withSyntheticSessionAuth(run: (cookie: string) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "FAOLLA_CANONICAL_PORTAL_ORIGIN"];
  const priorEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const user = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "session-regression@example.invalid",
    user_metadata: { platform_account_type: "merchant", platform_account_id: "99990001", merchant_id: "99990001" },
    app_metadata: {},
  };
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://merchant-session-regression.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://launch.faolla.com",
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    assert.equal(url.hostname, "merchant-session-regression.invalid", "production networking is forbidden in this test");
    if (url.pathname === "/auth/v1/user") {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer regression-current-access" || authorization === "Bearer regression-new-access") {
        return Response.json(user);
      }
      if (authorization === "Bearer regression-staff-access") {
        return Response.json({ ...user, app_metadata: { principal_type: "merchant_staff" } });
      }
      if (authorization === "Bearer regression-busy-access") {
        return Response.json({ message: "service unavailable" }, { status: 503 });
      }
      return Response.json({ message: "JWT expired", code: "bad_jwt" }, { status: 401 });
    }
    if (url.pathname === "/auth/v1/token") {
      return Response.json({ error: "invalid_grant", code: "refresh_token_already_used" }, { status: 400 });
    }
    if (url.pathname === "/rest/v1/merchant_enterprise_employees") return Response.json([]);
    if (url.pathname === "/rest/v1/merchants") return Response.json([{ id: "99990001" }]);
    if (url.pathname === `/auth/v1/admin/users/${user.id}`) return Response.json({ user });
    throw new Error(`unexpected synthetic auth endpoint: ${url.pathname}`);
  };
  try {
    await run(`${MERCHANT_AUTH_COOKIE}=regression-current-access; ${MERCHANT_AUTH_REFRESH_COOKIE}=regression-current-refresh`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
  }
}

function syntheticSessionRequest(cookie: string, body?: unknown) {
  return new Request("https://launch.faolla.com/api/auth/merchant-session", {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin: "https://launch.faolla.com", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("failed, missing and forbidden sync credentials never clear a different valid cookie session", async () => {
  await withSyntheticSessionAuth(async (cookie) => {
    assert.equal((await GET(syntheticSessionRequest(cookie))).status, 200);
    for (const [body, status] of [
      [{ accessToken: "regression-stale-access", refreshToken: "regression-stale-refresh" }, 401],
      [{}, 400],
      [{ accessToken: "regression-staff-access" }, 403],
      [{ accessToken: "regression-busy-access" }, 503],
      [{ authCode: "regression-invalid-code", codeVerifier: "synthetic-verifier" }, 401],
    ] as const) {
      const response = await POST(syntheticSessionRequest(cookie, body));
      assert.equal(response.status, status);
      assert.equal(response.headers.get("set-cookie"), null, "a failed sync cannot mutate the current session");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await GET(syntheticSessionRequest(cookie))).status, 200);
    }
  });
});

test("malformed sync and cross-origin mutation cannot delete a valid current session", async () => {
  await withSyntheticSessionAuth(async (cookie) => {
    const malformed = await POST(new Request("https://launch.faolla.com/api/auth/merchant-session", {
      method: "POST",
      headers: { cookie, origin: "https://launch.faolla.com", "content-type": "application/json" },
      body: "{",
    }));
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("set-cookie"), null);
    const untrusted = await POST(new Request("https://launch.faolla.com/api/auth/merchant-session", {
      method: "POST",
      headers: { cookie, origin: "https://untrusted.invalid", "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "regression-new-access" }),
    }));
    assert.equal(untrusted.status, 403);
    assert.equal(untrusted.headers.get("set-cookie"), null);
  });
});

test("confirmed invalid or staff cookie sessions still reject access and expire their cookies", async () => {
  await withSyntheticSessionAuth(async () => {
    for (const [token, status] of [["regression-revoked-access", 401], ["regression-staff-access", 403]] as const) {
      const response = await GET(syntheticSessionRequest(
        `${MERCHANT_AUTH_COOKIE}=${token}; ${MERCHANT_AUTH_REFRESH_COOKIE}=regression-invalid-refresh`,
      ));
      assert.equal(response.status, status);
      for (const name of [MERCHANT_AUTH_COOKIE, MERCHANT_AUTH_REFRESH_COOKIE]) {
        assert.equal(response.cookies.get(name)?.maxAge, 0);
      }
    }
  });
});

test("valid sync still establishes host-only HttpOnly cookies without returning bearer tokens", async () => {
  await withSyntheticSessionAuth(async (cookie) => {
    const response = await POST(syntheticSessionRequest(cookie, {
      accessToken: "regression-new-access", refreshToken: "regression-new-refresh", preferredAccountType: "merchant",
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.authenticated, true);
    assert.equal(payload.merchantId, "99990001");
    assert.equal(payload.accessToken, undefined);
    assert.equal(payload.refreshToken, undefined);
    for (const name of [MERCHANT_AUTH_COOKIE, MERCHANT_AUTH_REFRESH_COOKIE]) {
      const saved = response.cookies.get(name);
      assert.equal(saved?.httpOnly, true);
      assert.equal(saved?.secure, true);
      assert.equal(saved?.domain, undefined);
      assert.notEqual(saved?.maxAge, 0);
    }
  });
});

test("upstream auth service outages remain 503 and never expire cookie credentials", async () => {
  await withSyntheticSessionAuth(async () => {
    const response = await GET(syntheticSessionRequest(
      `${MERCHANT_AUTH_COOKIE}=regression-busy-access; ${MERCHANT_AUTH_REFRESH_COOKIE}=regression-busy-refresh`,
    ));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).error, "merchant_session_unavailable");
  });
});

test("explicit merchant logout still clears both authentication cookies", async () => {
  const response = await logoutMerchant(new Request("https://launch.faolla.com/api/auth/merchant-logout", {
    method: "POST", headers: { origin: "https://launch.faolla.com" },
  }));
  assert.equal(response.status, 200);
  for (const name of [MERCHANT_AUTH_COOKIE, MERCHANT_AUTH_REFRESH_COOKIE]) {
    assert.equal(response.cookies.get(name)?.maxAge, 0);
  }
});
