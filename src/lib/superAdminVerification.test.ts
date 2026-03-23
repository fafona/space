import test from "node:test";
import assert from "node:assert/strict";
import {
  createSuperAdminChallengeToken,
  createSuperAdminEmailProofToken,
  createSuperAdminTrustedDeviceToken,
  normalizeSuperAdminNextPath,
  readSuperAdminChallengeToken,
  readSuperAdminTrustedDeviceToken,
  verifySuperAdminEmailProofToken,
} from "@/lib/superAdminVerification";

test("normalizeSuperAdminNextPath keeps safe internal paths only", () => {
  assert.equal(normalizeSuperAdminNextPath("/super-admin/editor"), "/super-admin/editor");
  assert.equal(normalizeSuperAdminNextPath("https://evil.example"), "/super-admin");
  assert.equal(normalizeSuperAdminNextPath("//evil.example"), "/super-admin");
});

test("super admin challenge/proof tokens stay bound together", () => {
  const challenge = createSuperAdminChallengeToken({
    deviceId: "device-12345678",
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin/editor",
  });
  assert.ok(challenge);
  const payload = readSuperAdminChallengeToken(challenge);
  assert.equal(payload?.deviceId, "device-12345678");
  assert.equal(payload?.nextPath, "/super-admin/editor");

  const proof = createSuperAdminEmailProofToken(challenge);
  assert.equal(verifySuperAdminEmailProofToken(proof, challenge), true);

  const anotherChallenge = createSuperAdminChallengeToken({
    deviceId: "device-87654321",
    deviceLabel: "Mac / Safari",
    nextPath: "/super-admin",
  });
  assert.equal(verifySuperAdminEmailProofToken(proof, anotherChallenge), false);
});

test("trusted device token preserves device identity", () => {
  const token = createSuperAdminTrustedDeviceToken({
    deviceId: "device-abcdef12",
    deviceLabel: "Windows / Edge",
  });
  const payload = readSuperAdminTrustedDeviceToken(token);
  assert.equal(payload?.deviceId, "device-abcdef12");
  assert.equal(payload?.deviceLabel, "Windows / Edge");
});
