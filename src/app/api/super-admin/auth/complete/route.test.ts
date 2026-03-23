import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/super-admin/auth/complete/route";
import { createSuperAdminChallengeToken, createSuperAdminEmailProofToken } from "@/lib/superAdminVerification";

test("super-admin auth complete rejects device mismatch", async () => {
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

test("super-admin auth complete accepts matching verified device", async () => {
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
});
