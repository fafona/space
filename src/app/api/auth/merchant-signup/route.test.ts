import assert from "node:assert/strict";
import test from "node:test";
import { POST as requestSignup } from "@/app/api/auth/merchant-signup/route";
import { POST as requestSignupCode } from "@/app/api/auth/merchant-signup/request-code/route";
import { POST as verifySignupCode } from "@/app/api/auth/merchant-signup/verify-code/route";
import {
  ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY,
  ORDINARY_SIGNUP_INTENT_COOKIE,
  createOrdinarySignupIntent,
} from "@/lib/ordinarySignupIntent.server";

function createMutationRequest(path: string, body: unknown) {
  return new Request(`https://www.faolla.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.faolla.com",
    },
    body: JSON.stringify(body),
  });
}

test("merchant-signup rejects malformed email and oversized passwords without backend access", async () => {
  const emailResponse = await requestSignup(
    createMutationRequest("/api/auth/merchant-signup", {
      email: "not-an-email",
      password: "secret123",
      accountType: "personal",
    }),
  );
  assert.equal(emailResponse.status, 400);
  assert.deepEqual(await emailResponse.json(), { ok: false, error: "invalid_email" });
  assert.equal(emailResponse.headers.get("cache-control"), "no-store");

  const passwordResponse = await requestSignup(
    createMutationRequest("/api/auth/merchant-signup", {
      email: "member@example.com",
      password: "x".repeat(1025),
      accountType: "merchant",
    }),
  );
  assert.equal(passwordResponse.status, 400);
  assert.deepEqual(await passwordResponse.json(), { ok: false, error: "invalid_password" });
});

test("signup code routes validate email and numeric code format before backend access", async () => {
  const requestResponse = await requestSignupCode(
    createMutationRequest("/api/auth/merchant-signup/request-code", { email: "missing-domain@" }),
  );
  assert.equal(requestResponse.status, 400);
  assert.deepEqual(await requestResponse.json(), { ok: false, error: "signup_code_invalid_email" });

  const verifyResponse = await verifySignupCode(
    createMutationRequest("/api/auth/merchant-signup/verify-code", {
      email: "member@example.com",
      code: "12ab56",
      accountType: "personal",
    }),
  );
  assert.equal(verifyResponse.status, 400);
  assert.deepEqual(await verifyResponse.json(), { ok: false, error: "signup_code_invalid_code" });
});

test("merchant-signup bootstraps through the service-only RPC and returns only the subsequent resolver identity", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: string[] = [];
  const userId = "44444444-4444-4444-8444-444444444444";
  let storedUser: Record<string, unknown> = {
    id: userId,
    email: "new-personal@example.com",
    email_confirmed_at: "2026-08-19T08:00:00.000Z",
    user_metadata: {
      account_type: "personal",
      personal_id: "forged-personal",
    },
    app_metadata: {},
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-signup.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          access_token: "signup-access-token",
          refresh_token: "signup-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: userId,
            email: "new-personal@example.com",
            email_confirmed_at: "2026-08-19T08:00:00.000Z",
            user_metadata: {
              account_type: "personal",
              personal_id: "forged-personal",
            },
            app_metadata: {},
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      const attributes = JSON.parse(String(init?.body ?? "{}")) as {
        app_metadata?: Record<string, unknown>;
      };
      storedUser = {
        ...storedUser,
        app_metadata: attributes.app_metadata ?? {},
      };
      return new Response(JSON.stringify({ user: storedUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      assert.equal(
        new Headers(init?.headers ?? {}).get("authorization"),
        "Bearer service-role-key",
      );
      assert.deepEqual(JSON.parse(String(init?.body ?? "{}")), {
        p_account_type: "personal",
        p_auth_user_id: userId,
      });
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "merchant",
          merchantIds: ["99999999"],
          personalAccountId: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "new-personal@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accountType, "personal");
    assert.equal(body.accountId, "50010105");
    assert.equal(body.merchantId, null);
    assert.deepEqual(body.merchantIds, []);
    assert.deepEqual(calls, [
      "/auth/v1/signup",
      `/auth/v1/admin/users/${userId}`,
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1",
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1",
      `/auth/v1/admin/users/${userId}`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("sessionless signup requires a fresh matching top-level confirmation before bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "45454545-4545-4454-8454-454545454545";
  let freshLookups = 0;
  let bootstrapCalls = 0;
  let completionCalls = 0;
  let storedUser: Record<string, unknown> = {
    id: userId,
    email: "fresh-confirmed@example.com",
    email_confirmed_at: "2026-08-20T08:00:00.000Z",
    user_metadata: {
      account_type: "personal",
      email_verified: false,
    },
    app_metadata: {},
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-fresh-confirmed-signup.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "fresh-confirmed-secret";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: userId,
          email: "fresh-confirmed@example.com",
          email_confirmed_at: "2026-08-20T08:00:00.000Z",
          identities: [{ id: "identity-fresh-confirmed" }],
          user_metadata: {
            account_type: "personal",
            email_verified: false,
          },
          app_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      if (init?.body === undefined) {
        freshLookups += 1;
        return new Response(JSON.stringify({ user: storedUser }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const attributes = JSON.parse(String(init.body)) as {
        app_metadata?: Record<string, unknown>;
      };
      const intent = attributes.app_metadata?.[
        ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY
      ] as { status?: unknown } | undefined;
      if (intent?.status === "completed") completionCalls += 1;
      storedUser = {
        ...storedUser,
        app_metadata: attributes.app_metadata ?? {},
      };
      return new Response(JSON.stringify({ user: storedUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      bootstrapCalls += 1;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "fresh-confirmed@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.needsConfirmation, false);
    assert.equal(body.accountId, "50010105");
    assert.equal(freshLookups, 1);
    assert.equal(bootstrapCalls, 1);
    assert.equal(completionCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});

test("merchant-signup never bootstraps an obfuscated existing auth user", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let bootstrapCalled = false;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-existing-signup.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: "77777777-7777-4777-8777-777777777777",
          email: "existing@example.com",
          identities: [],
          user_metadata: { account_type: "personal" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.includes("faolla_bootstrap_ordinary_account")) {
      bootstrapCalled = true;
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "existing@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(bootstrapCalled, false);
    const body = await response.json();
    assert.equal(body.needsConfirmation, true);
    assert.equal(body.accountId, null);
    assert.equal(body.user, null);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("password grant alone never bootstraps a confirmed unbound Auth user", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let bootstrapCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-password-only.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "password-only-intent-secret";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: userId,
          email: "unbound@example.com",
          identities: [],
          app_metadata: {},
          user_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/auth/v1/token") {
      return new Response(
        JSON.stringify({
          access_token: "password-access",
          refresh_token: "password-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: userId,
            email: "unbound@example.com",
            email_confirmed_at: "2026-08-19T12:00:00.000Z",
            identities: [{ id: "identity-existing" }],
            app_metadata: {},
            user_metadata: {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      return new Response(
        JSON.stringify({
          user: {
            id: userId,
            email: "unbound@example.com",
            email_confirmed_at: "2026-08-19T12:00:00.000Z",
            identities: [{ id: "identity-existing" }],
            app_metadata: {},
            user_metadata: {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.includes("faolla_bootstrap_ordinary_account")) {
      bootstrapCalls += 1;
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "unbound@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "ordinary_signup_recovery_not_allowed");
    assert.equal(bootstrapCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});

test("duplicate signup returns an existing exact authoritative binding without bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let bootstrapCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-existing-binding.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: userId,
          email: "bound@example.com",
          identities: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/auth/v1/token") {
      return new Response(
        JSON.stringify({
          access_token: "bound-access",
          refresh_token: "bound-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: userId,
            email: "bound@example.com",
            email_confirmed_at: "2026-08-19T12:00:00.000Z",
            identities: [{ id: "identity-bound" }],
            app_metadata: {},
            user_metadata: {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.includes("faolla_bootstrap_ordinary_account")) {
      bootstrapCalls += 1;
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "bound@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accountId, "50010105");
    assert.equal(bootstrapCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("lost initial response reissues a persisted intent before duplicate signup recovery", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-intent-reissue.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "reissue-route-intent-secret";
  const intent = createOrdinarySignupIntent({
    userId,
    email: "resume@example.com",
    accountType: "personal",
  });
  assert.ok(intent);
  let bound = false;
  let bootstrapCalls = 0;
  let storedUser: Record<string, unknown> = {
    id: userId,
    email: "resume@example.com",
    email_confirmed_at: "2026-08-19T12:00:00.000Z",
    identities: [{ id: "identity-resume" }],
    user_metadata: {},
    app_metadata: {
      [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: intent.record,
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: userId,
          email: "resume@example.com",
          identities: [],
          app_metadata: {},
          user_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/auth/v1/token") {
      return new Response(
        JSON.stringify({
          access_token: "resume-access",
          refresh_token: "resume-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: storedUser,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      if ((init?.method ?? "GET").toUpperCase() !== "GET") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          app_metadata?: Record<string, unknown>;
        };
        storedUser = { ...storedUser, app_metadata: body.app_metadata ?? {} };
      }
      return new Response(JSON.stringify({ user: storedUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify(
          bound
            ? {
                schemaVersion: 1,
                status: "resolved",
                accountType: "personal",
                merchantIds: [],
                personalAccountId: "50010105",
              }
            : {
                schemaVersion: 1,
                status: "unbound",
                accountType: null,
                merchantIds: [],
                personalAccountId: null,
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      bootstrapCalls += 1;
      bound = true;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const body = {
      email: "resume@example.com",
      password: "secret123",
      accountType: "personal",
    };
    const first = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", body),
    );
    assert.equal(first.status, 409);
    assert.equal((await first.json()).error, "ordinary_signup_intent_reissued");
    assert.equal(bootstrapCalls, 0);
    const cookie = (first.headers.get("set-cookie") ?? "").match(
      new RegExp(`${ORDINARY_SIGNUP_INTENT_COOKIE}=[^;]+`),
    )?.[0];
    assert.ok(cookie);

    const second = await requestSignup(
      new Request("https://www.faolla.com/api/auth/merchant-signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
          cookie,
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(second.status, 200);
    assert.equal((await second.json()).accountId, "50010105");
    assert.equal(bootstrapCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});

test("unconfirmed signup persists an immutable intent and does not bootstrap before OTP", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "88888888-8888-4888-8888-888888888888";
  let bootstrapCalls = 0;
  let completionCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-pending-signup.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "pending-signup-secret";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/signup") {
      return new Response(
        JSON.stringify({
          id: userId,
          email: "pending@example.com",
          email_confirmed_at: null,
          identities: [{ id: "identity-1" }],
          user_metadata: {
            account_type: "personal",
            email_verified: true,
          },
          app_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        app_metadata?: Record<string, unknown>;
      };
      const intent = body.app_metadata?.[
        ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY
      ] as { status?: unknown } | undefined;
      if (intent?.status === "completed") completionCalls += 1;
      assert.equal(
        typeof intent,
        "object",
      );
      return new Response(
        JSON.stringify({
          user: {
            id: userId,
            email: "pending@example.com",
            email_confirmed_at: null,
            user_metadata: {
              account_type: "personal",
              email_verified: true,
            },
            app_metadata: body.app_metadata,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.includes("faolla_bootstrap_ordinary_account")) {
      bootstrapCalls += 1;
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await requestSignup(
      createMutationRequest("/api/auth/merchant-signup", {
        email: "pending@example.com",
        password: "secret123",
        accountType: "personal",
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.needsConfirmation, true);
    assert.equal(body.accountId, null);
    assert.equal(bootstrapCalls, 0);
    assert.equal(completionCalls, 0);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`${ORDINARY_SIGNUP_INTENT_COOKIE}=`),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});

test("fresh OTP verification can recover a persisted intent without a cookie, but mismatches cannot", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-fresh-otp.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "fresh-otp-intent-secret";
  const intent = createOrdinarySignupIntent({
    userId,
    email: "fresh-otp@example.com",
    accountType: "personal",
  });
  assert.ok(intent);
  let storedUser: Record<string, unknown> = {
    id: userId,
    email: "fresh-otp@example.com",
    email_confirmed_at: "2026-08-19T12:00:00.000Z",
    user_metadata: {},
    app_metadata: {
      [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: intent.record,
    },
  };
  let bootstrapCalls = 0;
  let bound = false;
  let verifyFails = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/verify") {
      if (verifyFails) {
        return new Response(JSON.stringify({ error: "otp_expired" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          access_token: "fresh-otp-access",
          refresh_token: "fresh-otp-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: storedUser,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      if ((init?.method ?? "GET").toUpperCase() !== "GET") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          app_metadata?: Record<string, unknown>;
        };
        storedUser = { ...storedUser, app_metadata: body.app_metadata ?? {} };
      }
      return new Response(JSON.stringify({ user: storedUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      bootstrapCalls += 1;
      bound = true;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      return new Response(
        JSON.stringify(
          bound
            ? {
                schemaVersion: 1,
                status: "resolved",
                accountType: "personal",
                merchantIds: [],
                personalAccountId: "50010105",
              }
            : {
                schemaVersion: 1,
                status: "unbound",
                accountType: null,
                merchantIds: [],
                personalAccountId: null,
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const consumedWithoutCookie = await verifySignupCode(
      createMutationRequest("/api/auth/merchant-signup/verify-code", {
        email: "fresh-otp@example.com",
        code: "123456",
        accountType: "personal",
      }),
    );
    assert.equal(consumedWithoutCookie.status, 401);
    assert.equal(
      (await consumedWithoutCookie.json()).error,
      "ordinary_signup_intent_required",
    );
    assert.equal(bootstrapCalls, 0);
    verifyFails = false;

    storedUser = { ...storedUser, email: "other@example.com" };
    const wrongFreshEmail = await verifySignupCode(
      createMutationRequest("/api/auth/merchant-signup/verify-code", {
        email: "fresh-otp@example.com",
        code: "123456",
        accountType: "personal",
      }),
    );
    assert.equal(wrongFreshEmail.status, 403);
    assert.equal(
      (await wrongFreshEmail.json()).error,
      "ordinary_signup_intent_mismatch",
    );
    assert.equal(bootstrapCalls, 0);
    storedUser = { ...storedUser, email: "fresh-otp@example.com" };

    const mismatched = await verifySignupCode(
      createMutationRequest("/api/auth/merchant-signup/verify-code", {
        email: "fresh-otp@example.com",
        code: "123456",
        accountType: "merchant",
      }),
    );
    assert.equal(mismatched.status, 403);
    assert.equal((await mismatched.json()).error, "ordinary_signup_intent_mismatch");
    assert.equal(bootstrapCalls, 0);

    const recovered = await verifySignupCode(
      createMutationRequest("/api/auth/merchant-signup/verify-code", {
        email: "fresh-otp@example.com",
        code: "123456",
        accountType: "personal",
      }),
    );
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).accountId, "50010105");
    assert.equal(bootstrapCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});

test("consumed OTP response loss resumes only from the matching persisted signup intent", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousIntentSecret = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  const userId = "99999999-9999-4999-8999-999999999999";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://unit-test-consumed-otp.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "consumed-otp-secret";
  const intent = createOrdinarySignupIntent({
    userId,
    email: "confirmed@example.com",
    accountType: "personal",
  });
  assert.ok(intent);
  let storedUser: Record<string, unknown> = {
    id: userId,
    email: "confirmed@example.com",
    email_confirmed_at: "2026-08-19T12:00:00.000Z",
    user_metadata: {},
    app_metadata: {
      [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: intent.record,
    },
  };
  let bootstrapCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/verify") {
      return new Response(JSON.stringify({ error: "otp_expired" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === `/auth/v1/admin/users/${userId}`) {
      if ((init?.method ?? "GET").toUpperCase() !== "GET") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          app_metadata?: Record<string, unknown>;
        };
        storedUser = { ...storedUser, app_metadata: body.app_metadata ?? {} };
      }
      return new Response(JSON.stringify({ user: storedUser }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_bootstrap_ordinary_account_authorization_v1"
    ) {
      bootstrapCalls += 1;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          status: "resolved",
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
          accountType: "personal",
          merchantIds: [],
          personalAccountId: "50010105",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await verifySignupCode(
      new Request(
        "https://www.faolla.com/api/auth/merchant-signup/verify-code",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://www.faolla.com",
            cookie: `${ORDINARY_SIGNUP_INTENT_COOKIE}=${encodeURIComponent(intent.token)}`,
          },
          body: JSON.stringify({
            email: "confirmed@example.com",
            code: "123456",
            accountType: "personal",
          }),
        },
      ),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accountId, "50010105");
    assert.equal(bootstrapCalls, 1);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`${ORDINARY_SIGNUP_INTENT_COOKIE}=;`),
    );

    for (const mismatch of [
      { email: "other@example.com", accountType: "personal" },
      { email: "confirmed@example.com", accountType: "merchant" },
    ]) {
      const denied = await verifySignupCode(
        new Request(
          "https://www.faolla.com/api/auth/merchant-signup/verify-code",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://www.faolla.com",
              cookie: `${ORDINARY_SIGNUP_INTENT_COOKIE}=${encodeURIComponent(intent.token)}`,
            },
            body: JSON.stringify({
              ...mismatch,
              code: "123456",
            }),
          },
        ),
      );
      assert.equal(denied.status, 401);
      assert.equal(
        (await denied.json()).error,
        "ordinary_signup_intent_required",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previousIntentSecret;
  }
});
