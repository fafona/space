import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/super-admin/auth/verify-code/route";
import { createSuperAdminChallengeToken } from "@/lib/superAdminVerification";

test("super-admin auth verify-code rejects expired or malformed challenges", async () => {
  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challenge: "bad-token",
        deviceId: "device-12345678",
        code: "123456",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_or_expired_challenge" });
});

test("super-admin auth verify-code rejects device mismatch before touching backend", async () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin",
  });

  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challenge,
        deviceId: "device-00000000",
        code: "123456",
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "device_mismatch" });
});

test("super-admin auth verify-code rejects empty code before touching backend", async () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin",
  });

  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challenge,
        deviceId: "device-12345678",
        code: "12",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_email_code" });
});
