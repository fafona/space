import assert from "node:assert/strict";
import test from "node:test";
import { readSuperAdminAuthorizedSession } from "./superAdminRequestAuth";
import { createSuperAdminSessionToken, createSuperAdminTrustedDeviceToken } from "./superAdminVerification";

function withSuperAdminVerificationSecret(run: () => void | Promise<void>) {
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

test("readSuperAdminAuthorizedSession tolerates duplicate cookies when an older value is stale", async () => {
  await withSuperAdminVerificationSecret(async () => {
    const validSession = createSuperAdminSessionToken({
      deviceId: "device-12345678",
      deviceLabel: "Windows / Chrome",
    });
    const validTrustedDevice = createSuperAdminTrustedDeviceToken({
      deviceId: "device-12345678",
      deviceLabel: "Windows / Chrome",
    });
    const request = new Request("https://www.fafona.com/api/super-admin/auth/session", {
      headers: {
        cookie: [
          "merchant-space-super-admin=",
          `merchant-space-super-admin=${validSession}`,
          "merchant-space-super-admin-device=stale-token",
          `merchant-space-super-admin-device=${validTrustedDevice}`,
        ].join("; "),
      },
    });

    const session = readSuperAdminAuthorizedSession(request);
    assert.equal(session?.deviceId, "device-12345678");
  });
});
