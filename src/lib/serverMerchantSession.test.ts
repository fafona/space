import assert from "node:assert/strict";
import test from "node:test";
import {
  merchantAuthorizationRecordMatchesUser,
  resolveMerchantSessionFromRequest,
} from "./serverMerchantSession";

test("merchantAuthorizationRecordMatchesUser accepts linked ids and normalized emails only", () => {
  const user = {
    id: "user-linked",
    email: "Owner@Example.com",
  };

  assert.equal(
    merchantAuthorizationRecordMatchesUser(
      {
        id: "12345678",
        owner_user_id: "user-linked",
      },
      user,
    ),
    true,
  );
  assert.equal(
    merchantAuthorizationRecordMatchesUser(
      {
        id: "12345678",
        contact_email: " owner@example.COM ",
      },
      user,
    ),
    true,
  );
  assert.equal(
    merchantAuthorizationRecordMatchesUser(
      {
        id: "12345678",
        owner_user_id: "another-user",
        contact_email: "another@example.com",
      },
      user,
    ),
    false,
  );
});

test("resolveMerchantSessionFromRequest does not trust unauthenticated merchant hints", async () => {
  const session = await resolveMerchantSessionFromRequest(
    new Request("https://faolla.com/api/support-messages?siteId=87654321&merchantEmail=owner@example.com", {
      headers: {
        "x-merchant-site-id": "87654321",
        "x-merchant-email": "owner@example.com",
        "x-merchant-name": "Merchant Name",
      },
    }),
  );

  assert.equal(session, null);
});

test("resolveMerchantSessionFromRequest does not rotate refresh cookies inside business routes", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let refreshEndpointCalled = false;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/auth/v1/token") {
      refreshEndpointCalled = true;
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }), { status: 200 });
    }
    if (requestUrl.pathname === "/auth/v1/user") {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const session = await resolveMerchantSessionFromRequest(
      new Request("https://faolla.com/api/merchant-peer-messages?siteId=12345678", {
        headers: {
          cookie:
            "merchant-space-merchant-auth=stale-access; merchant-space-merchant-refresh=refresh-token",
        },
      }),
      { hintedMerchantId: "12345678" },
    );

    assert.equal(session, null);
    assert.equal(refreshEndpointCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("resolveMerchantSessionFromRequest accepts an authorized hinted merchant id after authenticating the user", async () => {
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
      if (authorizationHeader === "Bearer access-token-query") {
        return new Response(
          JSON.stringify({
            id: "user-1",
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

    if (requestUrl.pathname === "/rest/v1/merchants") {
      return new Response(JSON.stringify([{ id: "12345678" }, { id: "87654321" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const session = await resolveMerchantSessionFromRequest(
      new Request("https://faolla.com/api/support-messages?siteId=87654321", {
        headers: {
          cookie: "merchant-space-merchant-auth=access-token-query",
        },
      }),
    );

    assert.deepEqual(session, {
      merchantId: "87654321",
      merchantEmail: "owner@example.com",
      merchantName: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("resolveMerchantSessionFromRequest rejects unauthorized hinted merchant ids and falls back to linked merchants", async () => {
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
      if (authorizationHeader === "Bearer access-token-fallback") {
        return new Response(
          JSON.stringify({
            id: "user-2",
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

    if (requestUrl.pathname === "/rest/v1/merchants") {
      return new Response(JSON.stringify([{ id: "12345678" }, { id: "87654321" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const session = await resolveMerchantSessionFromRequest(
      new Request("https://faolla.com/api/support-messages?siteId=99999999", {
        headers: {
          cookie: "merchant-space-merchant-auth=access-token-fallback",
        },
      }),
    );

    assert.deepEqual(session, {
      merchantId: "12345678",
      merchantEmail: "owner@example.com",
      merchantName: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("resolveMerchantSessionFromRequest falls back to older duplicate cookies when the newest one is stale", async () => {
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
            id: "user-3",
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
    const session = await resolveMerchantSessionFromRequest(
      new Request("https://faolla.com/api/bookings?siteId=12345678", {
        headers: {
          cookie:
            "merchant-space-merchant-auth=access-token-valid; merchant-space-merchant-auth=access-token-stale",
        },
      }),
      { hintedMerchantId: "12345678" },
    );

    assert.deepEqual(session, {
      merchantId: "12345678",
      merchantEmail: "owner@example.com",
      merchantName: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("resolveMerchantSessionFromRequest shares concurrent hinted lookups and avoids exhaustive scans", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let authRequestCount = 0;
  let merchantRequestCount = 0;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);

    if (requestUrl.pathname === "/auth/v1/user") {
      authRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(
        JSON.stringify({
          id: "user-fast-path",
          email: "owner-fast@example.com",
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

    if (requestUrl.pathname === "/rest/v1/merchants") {
      merchantRequestCount += 1;
      assert.equal(requestUrl.searchParams.get("id"), "eq.24681357");
      return new Response(
        JSON.stringify({
          id: "24681357",
          user_id: "user-fast-path",
          email: "owner-fast@example.com",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const makeRequest = () =>
      new Request("https://faolla.com/api/assets/upload", {
        headers: {
          cookie:
            "merchant-space-merchant-auth=access-token-fast-path; merchant-space-merchant-id=24681357",
        },
      });
    const [first, second] = await Promise.all([
      resolveMerchantSessionFromRequest(makeRequest()),
      resolveMerchantSessionFromRequest(makeRequest()),
    ]);

    assert.deepEqual(first, {
      merchantId: "24681357",
      merchantEmail: "owner-fast@example.com",
      merchantName: "",
    });
    assert.deepEqual(second, first);
    assert.equal(authRequestCount, 1);
    assert.equal(merchantRequestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});
