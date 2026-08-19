import assert from "node:assert/strict";
import test from "node:test";
import { resolveMerchantSessionFromRequest } from "./serverMerchantSession";

const USER_ID = "10000000-0000-4000-8000-000000000001";

async function withSupabaseFetch(
  fetchImpl: typeof fetch,
  task: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = fetchImpl;
  try {
    await task();
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestAuthorization(init?: RequestInit) {
  return new Headers(init?.headers ?? {}).get("authorization") ?? "";
}

test("merchant session does not trust unauthenticated merchant hints", async () => {
  const session = await resolveMerchantSessionFromRequest(
    new Request(
      "https://faolla.com/api/support-messages?siteId=87654321&merchantEmail=forged@example.com",
      {
        headers: {
          "x-merchant-site-id": "87654321",
          "x-merchant-email": "forged@example.com",
        },
      },
    ),
  );
  assert.equal(session, null);
});

test("merchant session never rotates refresh cookies inside business routes", async () => {
  let refreshEndpointCalled = false;
  await withSupabaseFetch(
    (async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname === "/auth/v1/token") refreshEndpointCalled = true;
      if (url.pathname === "/auth/v1/user") return json({ error: "unauthorized" }, 401);
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
    async () => {
      const session = await resolveMerchantSessionFromRequest(
        new Request(
          "https://faolla.com/api/bookings?siteId=12345678",
          {
            headers: {
              cookie:
                "merchant-space-merchant-auth=stale-access; merchant-space-merchant-refresh=refresh-token",
            },
          },
        ),
      );
      assert.equal(session, null);
      assert.equal(refreshEndpointCalled, false);
    },
  );
});

test("merchant session selects an authoritative one-to-many binding and ignores forged metadata or email", async () => {
  await withSupabaseFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname === "/auth/v1/user") {
        if (requestAuthorization(init) !== "Bearer access-token") {
          return json({ error: "unauthorized" }, 401);
        }
        return json({
          id: USER_ID,
          email: "owner@example.com",
          user_metadata: {
            account_type: "personal",
            merchant_id: "99999999",
          },
          app_metadata: { merchant_id: "99999999" },
        });
      }
      if (
        url.pathname ===
        "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
      ) {
        return json({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["12345678", "87654321"],
          personalAccountId: null,
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
    async () => {
      const selected = await resolveMerchantSessionFromRequest(
        new Request(
          "https://faolla.com/api/support-messages?siteId=87654321&merchantEmail=forged@example.com",
          {
            headers: {
              cookie: "merchant-space-merchant-auth=access-token",
            },
          },
        ),
      );
      assert.deepEqual(selected, {
        merchantId: "87654321",
        merchantEmail: "owner@example.com",
        merchantName: "",
      });

      const forged = await resolveMerchantSessionFromRequest(
        new Request(
          "https://faolla.com/api/support-messages?siteId=99999999",
          {
            headers: {
              cookie: "merchant-space-merchant-auth=access-token",
            },
          },
        ),
      );
      assert.equal(forged, null);
    },
  );
});

test("merchant session rejects personal, disabled, unbound and employee-only resolver results", async () => {
  const deniedResults = [
    {
      data: {
        schemaVersion: 1,
        status: "resolved",
        accountType: "personal",
        merchantIds: [],
        personalAccountId: "50010105",
      },
      status: 200,
    },
    {
      data: {
        schemaVersion: 1,
        status: "disabled",
        accountType: "personal",
        merchantIds: [],
        personalAccountId: "50010106",
      },
      status: 200,
    },
    {
      data: {
        schemaVersion: 1,
        status: "unbound",
        accountType: null,
        merchantIds: [],
        personalAccountId: null,
      },
      status: 200,
    },
    {
      data: { message: "ordinary_account_staff_identity_forbidden" },
      status: 400,
    },
  ];

  for (const denied of deniedResults) {
    await withSupabaseFetch(
      (async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        if (url.pathname === "/auth/v1/user") {
          return json({ id: USER_ID, email: "owner@example.com" });
        }
        if (
          url.pathname ===
          "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
        ) {
          return json(denied.data, denied.status);
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
      async () => {
        const session = await resolveMerchantSessionFromRequest(
          new Request("https://faolla.com/api/orders?siteId=12345678", {
            headers: {
              cookie: `merchant-space-merchant-auth=denied-${deniedResults.indexOf(denied)}`,
            },
          }),
        );
        assert.equal(session, null);
      },
    );
  }
});

test("merchant session shares concurrent authoritative resolver work", async () => {
  let authRequestCount = 0;
  let resolverRequestCount = 0;
  await withSupabaseFetch(
    (async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.pathname === "/auth/v1/user") {
        authRequestCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json({ id: USER_ID, email: "owner@example.com" });
      }
      if (
        url.pathname ===
        "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
      ) {
        resolverRequestCount += 1;
        return json({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["24681357"],
          personalAccountId: null,
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
    async () => {
      const makeRequest = () =>
        new Request("https://faolla.com/api/assets/upload?siteId=24681357", {
          headers: {
            cookie: "merchant-space-merchant-auth=shared-access-token",
          },
        });
      const [first, second] = await Promise.all([
        resolveMerchantSessionFromRequest(makeRequest()),
        resolveMerchantSessionFromRequest(makeRequest()),
      ]);
      assert.deepEqual(first, {
        merchantId: "24681357",
        merchantEmail: "owner@example.com",
        merchantName: "",
      });
      assert.deepEqual(second, first);
      assert.equal(authRequestCount, 1);
      assert.equal(resolverRequestCount, 1);
    },
  );
});
