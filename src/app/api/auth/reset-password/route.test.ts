import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/auth/reset-password/route";

test("reset-password rejects short passwords before touching backend", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        password: "12345",
        tokenHash: "demo-token",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "reset_password_invalid_password",
  });
});

test("reset-password rejects missing recovery payload before touching backend", async () => {
  const response = await POST(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        password: "secret123",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "reset_password_missing_recovery_payload",
  });
});

test("reset-password returns env-missing when Supabase config is absent", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousNextServiceRole = process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          password: "secret123",
          tokenHash: "demo-token",
        }),
      }),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "reset_password_env_missing",
    });
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
    if (previousServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    }
    if (previousNextServiceRole === undefined) {
      delete process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY = previousNextServiceRole;
    }
  }
});
