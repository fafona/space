import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/super-admin/auth/complete/route";
import {
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import {
  createSuperAdminChallengeToken,
  createSuperAdminEmailProofToken,
  readSuperAdminSessionToken,
  readSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";

function withSuperAdminVerificationSecret(run: () => Promise<void>) {
  const previousSecret = process.env.SUPER_ADMIN_VERIFICATION_SECRET;
  process.env.SUPER_ADMIN_VERIFICATION_SECRET = "test-super-admin-secret";
  return Promise.resolve(run()).finally(() => {
    if (previousSecret === undefined) {
      delete process.env.SUPER_ADMIN_VERIFICATION_SECRET;
    } else {
      process.env.SUPER_ADMIN_VERIFICATION_SECRET = previousSecret;
    }
  });
}

test("super-admin auth complete rejects device mismatch", async () => {
  await withSuperAdminVerificationSecret(async () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin",
  });
  const proof = createSuperAdminEmailProofToken(challenge);

  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        challenge,
        proof,
        deviceId: "device-87654321",
      }),
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "device_mismatch" });
  });
});

test("super-admin auth complete accepts matching verified device", async () => {
  await withSuperAdminVerificationSecret(async () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin/editor",
  });
  const proof = createSuperAdminEmailProofToken(challenge);

  const response = await POST(
    new Request("http://localhost/api/super-admin/auth/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        challenge,
        proof,
        deviceId: "device-12345678",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    nextPath: "/super-admin/editor",
    deviceLabel: "Windows / Chrome",
  });
  assert.equal(
    readSuperAdminSessionToken(response.cookies.get(SUPER_ADMIN_SESSION_COOKIE)?.value ?? "")?.deviceId,
    "device-12345678",
  );
  assert.equal(
    readSuperAdminTrustedDeviceToken(response.cookies.get(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)?.value ?? "")?.deviceId,
    "device-12345678",
  );
  assert.equal(response.cookies.get(SUPER_ADMIN_SESSION_COOKIE)?.httpOnly, true);
  });
});

test("super-admin auth complete shares session and trusted-device cookies across faolla subdomains", async () => {
  await withSuperAdminVerificationSecret(async () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin/editor",
  });
  const proof = createSuperAdminEmailProofToken(challenge);

  const response = await POST(
    new Request("https://www.faolla.com/api/super-admin/auth/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.faolla.com",
      },
      body: JSON.stringify({
        challenge,
        proof,
        deviceId: "device-12345678",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.cookies.get(SUPER_ADMIN_SESSION_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(SUPER_ADMIN_DEVICE_ID_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)?.domain, "faolla.com");
  });
});
