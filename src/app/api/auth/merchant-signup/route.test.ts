import assert from "node:assert/strict";
import test from "node:test";
import {
  POST as requestSignup,
  signUpNeedsEmailConfirmation,
} from "@/app/api/auth/merchant-signup/route";
import { POST as requestSignupCode } from "@/app/api/auth/merchant-signup/request-code/route";
import { POST as verifySignupCode } from "@/app/api/auth/merchant-signup/verify-code/route";

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

test("signup confirmation never trusts mutable user metadata", () => {
  assert.equal(signUpNeedsEmailConfirmation({
    user: {
      email_confirmed_at: null,
      user_metadata: { email_verified: true },
    },
  }), true);
  assert.equal(signUpNeedsEmailConfirmation({
    user: {
      email_confirmed_at: "2026-08-20T00:00:00.000Z",
      user_metadata: { email_verified: false },
    },
  }), false);
  assert.equal(signUpNeedsEmailConfirmation({
    session: { user: { email_confirmed_at: null, user_metadata: {} } },
  }), false);
});
