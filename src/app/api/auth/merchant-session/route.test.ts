import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/auth/merchant-session/route";

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
          cookie:
            "merchant-space-merchant-auth=access-token-valid; merchant-space-merchant-auth=access-token-stale",
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
    assert.equal(typeof body.frontendAuthProof, "string");
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
          cookie:
            "merchant-space-merchant-auth=access-token-valid; merchant-space-merchant-auth=access-token-stale; merchant-space-merchant-refresh=refresh-token-valid",
        },
      }),
    );
    assert.equal(accountSwitchResponse.status, 200);
    const accountSwitchBody = await accountSwitchResponse.json();
    assert.equal(accountSwitchBody.accessToken, "access-token-valid");
    assert.equal(accountSwitchBody.refreshToken, "refresh-token-valid");
    assert.equal(accountSwitchBody.tokenType, "bearer");
    assert.equal(accountSwitchBody.accountType, "merchant");
    assert.equal(accountSwitchBody.merchantId, "12345678");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session account switch GET returns refreshed tokens", async () => {
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
          cookie: "merchant-space-merchant-refresh=old-refresh-token",
        },
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.accountType, "merchant");
    assert.equal(body.merchantId, "87654321");
    assert.equal(body.accessToken, "new-access-token");
    assert.equal(body.refreshToken, "new-refresh-token");
    assert.equal(body.expiresIn, 3600);
    assert.equal(body.tokenType, "bearer");
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
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

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
