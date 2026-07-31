import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/auth/merchant-login/route";

function createLoginRequest(body: unknown) {
  return new Request("https://www.faolla.com/api/auth/merchant-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.faolla.com",
    },
    body: JSON.stringify(body),
  });
}

test("merchant-login rejects invalid bounded credentials before backend access", async () => {
  const shortPasswordResponse = await POST(
    createLoginRequest({ account: "member@example.com", password: "12345", preferredAccountType: "personal" }),
  );
  assert.equal(shortPasswordResponse.status, 400);
  assert.deepEqual(await shortPasswordResponse.json(), { error: "invalid_password" });
  assert.equal(shortPasswordResponse.headers.get("cache-control"), "no-store");

  const oversizedAccountResponse = await POST(
    createLoginRequest({ account: "a".repeat(321), password: "secret123", preferredAccountType: "merchant" }),
  );
  assert.equal(oversizedAccountResponse.status, 400);
  assert.deepEqual(await oversizedAccountResponse.json(), { error: "invalid_account" });
});

test("merchant-login refuses a merchant staff principal after password verification", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test-staff-login.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/auth/v1/token") {
      return new Response(
        JSON.stringify({
          access_token: "staff-access-token",
          refresh_token: "staff-refresh-token",
          expires_in: 3600,
          user: {
            id: "77777777-7777-4777-8777-777777777777",
            email: "staff-login@example.com",
            user_metadata: {
              merchant_id: "12345678",
            },
            app_metadata: {
              principal_type: "merchant_staff",
            },
          },
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
      createLoginRequest({
        account: "staff-login@example.com",
        password: "secret123",
        preferredAccountType: "merchant",
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "merchant_staff_identity_forbidden",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("merchant-login forwards a rate limit without retrying the password grant", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let passwordGrantRequests = 0;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  globalThis.fetch = (async () => {
    passwordGrantRequests += 1;
    return new Response(
      JSON.stringify({
        error_code: "over_request_rate_limit",
        msg: "Too many requests",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "60",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await POST(
      createLoginRequest({
        account: "rate-limit-test@example.com",
        password: "secret123",
        preferredAccountType: "personal",
      }),
    );

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "auth_rate_limited" });
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(passwordGrantRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});
