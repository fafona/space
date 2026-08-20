import assert from "node:assert/strict";
import test from "node:test";
import { readSuperAdminAuthorizedSession } from "./superAdminRequestAuth";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "./superAdminSession";
import {
  createSuperAdminSessionToken,
  createSuperAdminTrustedDeviceToken,
} from "./superAdminVerification";

function withSuperAdminVerificationSecret(run: () => void | Promise<void>) {
  const previousSecret = process.env.SUPER_ADMIN_VERIFICATION_SECRET;
  const previousOrigin = process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
  process.env.SUPER_ADMIN_VERIFICATION_SECRET = "test-super-admin-secret";
  process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";
  return Promise.resolve(run()).finally(() => {
    if (previousSecret === undefined) delete process.env.SUPER_ADMIN_VERIFICATION_SECRET;
    else process.env.SUPER_ADMIN_VERIFICATION_SECRET = previousSecret;
    if (previousOrigin === undefined) delete process.env.FAOLLA_SUPER_ADMIN_ORIGIN;
    else process.env.FAOLLA_SUPER_ADMIN_ORIGIN = previousOrigin;
  });
}

function validCookieHeader(deviceId = "device-12345678") {
  const session = createSuperAdminSessionToken({ deviceId, deviceLabel: "Windows / Chrome" });
  const trusted = createSuperAdminTrustedDeviceToken({ deviceId, deviceLabel: "Windows / Chrome" });
  return `${SUPER_ADMIN_SESSION_COOKIE}=${session}; ${SUPER_ADMIN_TRUSTED_DEVICE_COOKIE}=${trusted}`;
}

test("authorized sessions require the console origin and active device store", async () => {
  await withSuperAdminVerificationSecret(async () => {
    const session = await readSuperAdminAuthorizedSession(
      new Request("https://console.faolla.com/api/super-admin/auth/session", {
        headers: { cookie: validCookieHeader() },
      }),
      { loadActiveDeviceIds: async () => ["device-12345678"] },
    );
    assert.equal(session?.deviceId, "device-12345678");

    const wrongHost = await readSuperAdminAuthorizedSession(
      new Request("https://merchant.faolla.com/api/super-admin/auth/session", {
        headers: { cookie: validCookieHeader() },
      }),
      { loadActiveDeviceIds: async () => ["device-12345678"] },
    );
    assert.equal(wrongHost, null);
  });
});

test("revoked or unavailable device state fails closed", async () => {
  await withSuperAdminVerificationSecret(async () => {
    const request = new Request("https://console.faolla.com/api/super-admin/auth/session", {
      headers: { cookie: validCookieHeader() },
    });
    assert.equal(
      await readSuperAdminAuthorizedSession(request, { loadActiveDeviceIds: async () => [] }),
      null,
    );
    assert.equal(
      await readSuperAdminAuthorizedSession(request, {
        loadActiveDeviceIds: async () => {
          throw new Error("store unavailable");
        },
      }),
      null,
    );
  });
});

test("legacy parent-domain cookie names are never accepted", async () => {
  await withSuperAdminVerificationSecret(async () => {
    const request = new Request("https://console.faolla.com/api/super-admin/auth/session", {
      headers: {
        cookie: validCookieHeader()
          .replaceAll(SUPER_ADMIN_SESSION_COOKIE, "merchant-space-super-admin")
          .replaceAll(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, "merchant-space-super-admin-device"),
      },
    });
    assert.equal(
      await readSuperAdminAuthorizedSession(request, { loadActiveDeviceIds: async () => ["device-12345678"] }),
      null,
    );
  });
});
