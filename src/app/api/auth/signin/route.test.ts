import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/auth/signin/route";

test("auth-signin rejects invalid email before touching backend", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "not-an-email",
        password: "secret123",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_email" });
});

test("auth-signin rejects short passwords before touching backend", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "merchant@example.com",
        password: "12345",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_password" });
});

test("auth-signin returns env-missing when public auth config is absent", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "merchant@example.com",
          password: "secret123",
        }),
      }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "auth_signin_env_missing" });
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousAnon === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
    }
  }
});
