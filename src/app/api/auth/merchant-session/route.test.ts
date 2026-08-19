import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/auth/merchant-session/route";

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
          cookie: "merchant-space-merchant-auth=staff-access-token",
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

    if (requestUrl.pathname === "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1") {
      return new Response(JSON.stringify({
        schemaVersion: 1,
        status: "resolved",
        accountType: "merchant",
        merchantIds: ["12345678"],
        personalAccountId: null,
      }), {
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
    assert.equal(accountSwitchBody.refreshToken, null);
    assert.match(
      accountSwitchResponse.headers.get("set-cookie") ?? "",
      /merchant-space-merchant-refresh=;/,
    );
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

    if (requestUrl.pathname === "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1") {
      return new Response(JSON.stringify({
        schemaVersion: 1,
        status: "resolved",
        accountType: "merchant",
        merchantIds: ["87654321"],
        personalAccountId: null,
      }), {
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
      const grantType = requestUrl.searchParams.get("grant_type");
      const tokenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (grantType === "pkce") {
        exchangedBody = tokenBody;
      } else {
        assert.equal(grantType, "refresh_token");
        assert.deepEqual(tokenBody, { refresh_token: "oauth-refresh-token" });
      }
      return new Response(
        JSON.stringify({
          access_token: grantType === "pkce" ? "oauth-access-token" : "oauth-access-token-rotated",
          refresh_token: grantType === "pkce" ? "oauth-refresh-token" : "oauth-refresh-token-rotated",
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

    if (requestUrl.pathname === "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1") {
      return new Response(JSON.stringify({
        schemaVersion: 1,
        status: "resolved",
        accountType: "merchant",
        merchantIds: ["12345678"],
        personalAccountId: null,
      }), {
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

test("merchant-session preserves an explicit one-auth-many merchant selection and rejects unauthorized hints", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-one-many.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const user = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "one-many@example.com",
    user_metadata: { merchant_id: "99999999" },
    app_metadata: {},
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678", "87654321"],
          personalAccountId: null,
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
    const selectedGet = await GET(
      new Request("https://faolla.com/api/auth/merchant-session", {
        headers: {
          cookie:
            "merchant-space-merchant-auth=one-many-get; merchant-space-merchant-id=87654321",
        },
      }),
    );
    assert.equal(selectedGet.status, 200);
    assert.equal((await selectedGet.json()).merchantId, "87654321");
    assert.match(
      selectedGet.headers.get("set-cookie") ?? "",
      /merchant-space-merchant-id=87654321/,
    );

    const deniedGet = await GET(
      new Request("https://faolla.com/api/auth/merchant-session?merchantId=99999999", {
        headers: {
          cookie:
            "merchant-space-merchant-auth=one-many-get-denied; merchant-space-merchant-id=99999999",
        },
      }),
    );
    assert.equal(deniedGet.status, 403);
    assert.equal(
      (await deniedGet.json()).error,
      "ordinary_account_merchant_selection_forbidden",
    );
    const deniedGetCookies = deniedGet.headers.get("set-cookie") ?? "";
    assert.match(deniedGetCookies, /merchant-space-merchant-id=/);
    assert.doesNotMatch(deniedGetCookies, /merchant-space-merchant-auth=/);

    const selectedPost = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
        },
        body: JSON.stringify({
          accessToken: "one-many-post",
          preferredMerchantId: "87654321",
        }),
      }),
    );
    assert.equal(selectedPost.status, 200);
    assert.equal((await selectedPost.json()).merchantId, "87654321");

    const deniedPost = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
        },
        body: JSON.stringify({
          accessToken: "one-many-post-denied",
          preferredMerchantId: "99999999",
        }),
      }),
    );
    assert.equal(deniedPost.status, 403);
    assert.equal(
      (await deniedPost.json()).error,
      "ordinary_account_merchant_selection_forbidden",
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session POST explicitly clears a stale merchant selection when switching to personal", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-clear-selection.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const user = {
    id: "55555555-5555-4555-8555-555555555555",
    email: "personal@example.com",
    user_metadata: { merchant_id: "12345678" },
    app_metadata: {},
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
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
    const response = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
          cookie:
            "merchant-space-merchant-id=12345678; merchant-space-merchant-auth=personal-access",
        },
        body: JSON.stringify({
          accessToken: "personal-access",
          preferredAccountType: "personal",
          preferredMerchantId: null,
        }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accountType, "personal");
    assert.equal(body.accountId, "50010105");
    assert.equal(body.merchantId, null);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      /merchant-space-merchant-id=;/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session POST never pairs access A with refresh B", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-mixed-pair.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const userA = {
    id: "66666666-6666-4666-8666-666666666666",
    email: "a@example.com",
    user_metadata: {},
    app_metadata: {},
  };
  const userB = {
    id: "77777777-7777-4777-8777-777777777777",
    email: "b@example.com",
    user_metadata: {},
    app_metadata: {},
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      const authorization = new Headers(init?.headers).get("authorization");
      return authorization === "Bearer access-a"
        ? new Response(JSON.stringify(userA), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ error: "invalid" }), { status: 401 });
    }
    if (url.pathname === "/auth/v1/token") {
      assert.deepEqual(JSON.parse(String(init?.body ?? "{}")), {
        refresh_token: "refresh-b",
      });
      return new Response(
        JSON.stringify({
          access_token: "rotated-access-b",
          refresh_token: "rotated-refresh-b",
          expires_in: 3600,
          token_type: "bearer",
          user: userB,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678"],
          personalAccountId: null,
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
    const response = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
          cookie: "merchant-space-merchant-refresh=refresh-b",
        },
        body: JSON.stringify({
          accessToken: "access-a",
          refreshToken: "refresh-b",
          preferredAccountType: "merchant",
        }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.id, userA.id);
    assert.equal(body.merchantId, "12345678");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /merchant-space-merchant-refresh=;/);
    assert.doesNotMatch(setCookie, /rotated-refresh-b/);
    assert.doesNotMatch(setCookie, /rotated-access-b/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session POST can recover from an old body refresh with a verified rotated cookie", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-rotated-pair.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const user = {
    id: "88888888-8888-4888-8888-888888888888",
    email: "rotated@example.com",
    user_metadata: {},
    app_metadata: {},
  };
  const attemptedRefreshes: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/auth/v1/token") {
      const refreshValue = String(
        (JSON.parse(String(init?.body ?? "{}")) as { refresh_token?: unknown })
          .refresh_token ?? "",
      );
      attemptedRefreshes.push(refreshValue);
      if (refreshValue === "old-body-refresh") {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(refreshValue, "current-cookie-refresh");
      return new Response(
        JSON.stringify({
          access_token: "next-access",
          refresh_token: "next-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["87654321"],
          personalAccountId: null,
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
    const response = await POST(
      new Request("https://faolla.com/api/auth/merchant-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://faolla.com",
          cookie: "merchant-space-merchant-refresh=current-cookie-refresh",
        },
        body: JSON.stringify({
          accessToken: "current-access",
          refreshToken: "old-body-refresh",
          preferredAccountType: "merchant",
        }),
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(attemptedRefreshes, [
      "old-body-refresh",
      "current-cookie-refresh",
    ]);
    assert.equal((await response.json()).user.id, user.id);
    assert.match(response.headers.get("set-cookie") ?? "", /next-refresh/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session GET revalidates a previously accepted access token", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-revoked-access.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const user = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "revoked@example.com",
    user_metadata: {},
    app_metadata: {},
  };
  let authReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      authReads += 1;
      return authReads === 1
        ? new Response(JSON.stringify(user), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ error: "revoked" }), { status: 401 });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678"],
          personalAccountId: null,
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
    const request = () =>
      new Request("https://faolla.com/api/auth/merchant-session", {
        headers: { cookie: "merchant-space-merchant-auth=revoked-access" },
      });
    assert.equal((await GET(request())).status, 200);
    const revoked = await GET(request());
    assert.equal(revoked.status, 401);
    assert.deepEqual(await revoked.json(), { authenticated: false });
    assert.equal(authReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-session never bootstraps an arbitrary authenticated unbound user", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-unbound-session.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  let bootstrapCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/user") {
      return new Response(
        JSON.stringify({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          email: "unbound@example.com",
          user_metadata: {},
          app_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      bootstrapCalls += 1;
      return new Response("unexpected bootstrap", { status: 500 });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "unbound",
          accountType: null,
          merchantIds: [],
          personalAccountId: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
          accessToken: "unbound-access",
          preferredAccountType: "personal",
        }),
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).error,
      "ordinary_account_principal_unbound",
    );
    assert.equal(bootstrapCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});
