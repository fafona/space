import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/super-admin/auth/request/route";

function withSuperAdminAuthEnv(run: () => Promise<void>) {
  const previousAccount = process.env.SUPER_ADMIN_ACCOUNT;
  const previousPassword = process.env.SUPER_ADMIN_PASSWORD;
  const previousEmail = process.env.SUPER_ADMIN_VERIFICATION_EMAIL;
  const previousSecret = process.env.SUPER_ADMIN_VERIFICATION_SECRET;
  process.env.SUPER_ADMIN_ACCOUNT = "felix";
  process.env.SUPER_ADMIN_PASSWORD = "987987";
  process.env.SUPER_ADMIN_VERIFICATION_EMAIL = "super-admin@example.com";
  process.env.SUPER_ADMIN_VERIFICATION_SECRET = "test-super-admin-secret";
  return Promise.resolve(run()).finally(() => {
    if (previousAccount === undefined) delete process.env.SUPER_ADMIN_ACCOUNT;
    else process.env.SUPER_ADMIN_ACCOUNT = previousAccount;
    if (previousPassword === undefined) delete process.env.SUPER_ADMIN_PASSWORD;
    else process.env.SUPER_ADMIN_PASSWORD = previousPassword;
    if (previousEmail === undefined) delete process.env.SUPER_ADMIN_VERIFICATION_EMAIL;
    else process.env.SUPER_ADMIN_VERIFICATION_EMAIL = previousEmail;
    if (previousSecret === undefined) delete process.env.SUPER_ADMIN_VERIFICATION_SECRET;
    else process.env.SUPER_ADMIN_VERIFICATION_SECRET = previousSecret;
  });
}

test("super-admin auth request rejects wrong credentials before touching backend", async () => {
  await withSuperAdminAuthEnv(async () => {
  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        account: "wrong",
        password: "bad",
        deviceId: "device-12345678",
        deviceLabel: "Windows / Chrome",
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  });
});

test("super-admin auth request rejects malformed devices", async () => {
  await withSuperAdminAuthEnv(async () => {
  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        account: "felix",
        password: "987987",
        deviceId: "short",
        deviceLabel: "Windows / Chrome",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_device" });
  });
});
