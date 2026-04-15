import test from "node:test";
import assert from "node:assert/strict";
import {
  createSuperAdminChallengeToken,
  createSuperAdminEmailProofToken,
  createSuperAdminSessionToken,
  createSuperAdminTrustedDeviceToken,
  normalizeSuperAdminNextPath,
  readSuperAdminChallengeToken,
  readSuperAdminSessionToken,
  readSuperAdminTrustedDeviceToken,
  verifySuperAdminEmailProofToken,
} from "@/lib/superAdminVerification";

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

test("normalizeSuperAdminNextPath keeps safe internal paths only", () => {
  assert.equal(normalizeSuperAdminNextPath("/super-admin/editor"), "/super-admin/editor");
  assert.equal(normalizeSuperAdminNextPath("https://evil.example"), "/super-admin");
  assert.equal(normalizeSuperAdminNextPath("//evil.example"), "/super-admin");
});

test("super admin challenge/proof tokens stay bound together", async () => {
  await withSuperAdminVerificationSecret(() => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin/editor",
    deviceDetails: {
      platform: "Windows",
      os: "Windows 10.0",
      browser: "Chrome",
      browserVersion: "135.0.0.0",
      model: "PC",
      deviceType: "desktop",
      language: "zh-CN",
      languages: ["zh-CN"],
      timezone: "Asia/Shanghai",
      screen: "1920×1080 @1x",
      viewport: "1440×900",
      userAgent: "Mozilla/5.0",
      brands: ["Google Chrome 135.0.0.0"],
      deviceMemory: "8 GB",
      hardwareConcurrency: "8",
    },
  });
  assert.ok(challenge);
  const payload = readSuperAdminChallengeToken(challenge);
  assert.equal(payload?.deviceId, "device-12345678");
  assert.equal(payload?.nextPath, "/super-admin/editor");
  assert.equal(payload?.deviceDetails?.browser, "Chrome");

  const proof = createSuperAdminEmailProofToken(challenge);
  assert.equal(verifySuperAdminEmailProofToken(proof, challenge), true);

  const anotherChallenge = createSuperAdminChallengeToken({
    deviceId: "device-87654321",
    deviceLabel: "Mac / Safari",
    nextPath: "/super-admin",
  });
  assert.equal(verifySuperAdminEmailProofToken(proof, anotherChallenge), false);
  });
});

test("trusted device token preserves device identity", async () => {
  await withSuperAdminVerificationSecret(() => {
  const token = createSuperAdminTrustedDeviceToken({
    deviceId: "device-abcdef12",
    deviceLabel: "Windows / Edge",
  });
  const payload = readSuperAdminTrustedDeviceToken(token);
  assert.equal(payload?.deviceId, "device-abcdef12");
  assert.equal(payload?.deviceLabel, "Windows / Edge");
  });
});

test("session token preserves device identity", async () => {
  await withSuperAdminVerificationSecret(() => {
  const token = createSuperAdminSessionToken({
    deviceId: "device-session-1234",
    deviceLabel: "Mac / Safari",
  });
  const payload = readSuperAdminSessionToken(token);
  assert.equal(payload?.deviceId, "device-session-1234");
  assert.equal(payload?.deviceLabel, "Mac / Safari");
  });
});
