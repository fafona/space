import assert from "node:assert/strict";
import test from "node:test";
import { POST as requestCode } from "./request-code/route";
import {
  isLegacyPersonalRecoveryApprovalBody,
  POST as approveRecovery,
} from "@/app/api/super-admin/legacy-personal-recovery/route";
import {
  LEGACY_PERSONAL_RECOVERY_CASE_ENV,
  LEGACY_PERSONAL_RECOVERY_ENABLED_ENV,
  LEGACY_PERSONAL_RECOVERY_HMAC_ENV,
  sha256,
} from "@/lib/legacyPersonalRecovery.server";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import {
  createSuperAdminSessionToken,
  createSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";

const FIXED_AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_EMAIL = "legacy-personal@example.com";
const FIXED_PERSONAL_ID = "50010105";
const RECOVERY_HMAC = "0123456789abcdef".repeat(4);

async function withRecoveryEnv(run: () => Promise<void>) {
  const values: Record<string, string> = {
    [LEGACY_PERSONAL_RECOVERY_ENABLED_ENV]: "true",
    [LEGACY_PERSONAL_RECOVERY_CASE_ENV]: JSON.stringify({
      caseId: "route_case_20260819",
      authUserId: FIXED_AUTH_USER_ID,
      personalAccountId: FIXED_PERSONAL_ID,
      emailSha256: sha256(FIXED_EMAIL),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    [LEGACY_PERSONAL_RECOVERY_HMAC_ENV]: RECOVERY_HMAC,
    SUPER_ADMIN_VERIFICATION_SECRET:
      "route-test-super-admin-secret-that-is-independent",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("public recovery route is 410 and no-store when the one-time gate is disabled", async () => {
  const previous = process.env.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED;
  process.env.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED = "false";
  try {
    const response = await requestCode(
      new Request(
        "https://faolla.com/api/auth/legacy-personal-recovery/request-code",
        {
          method: "POST",
          headers: {
            origin: "https://faolla.com",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: "not-returned@example.com",
            personalAccountId: "50010105",
          }),
        },
      ),
    );
    assert.equal(response.status, 410);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: false,
      error: "legacy_personal_recovery_disabled",
    });
    assert.equal(JSON.stringify(body).includes("not-returned@example.com"), false);
    assert.equal(JSON.stringify(body).includes("50010105"), false);
  } finally {
    if (previous === undefined) {
      delete process.env.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED;
    } else {
      process.env.ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED = previous;
    }
  }
});

test("public recovery mutation rejects cross-origin requests before parsing identity", async () => {
  const response = await requestCode(
    new Request(
      "https://faolla.com/api/auth/legacy-personal-recovery/request-code",
      {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "sensitive@example.com" }),
      },
    ),
  );
  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(JSON.stringify(await response.json()).includes("sensitive@example.com"), false);
});

test("public recovery body cannot add an Auth UUID target selector", async () => {
  await withRecoveryEnv(async () => {
    const response = await requestCode(
      new Request(
        "https://faolla.com/api/auth/legacy-personal-recovery/request-code",
        {
          method: "POST",
          headers: {
            origin: "https://faolla.com",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: FIXED_EMAIL,
            personalAccountId: FIXED_PERSONAL_ID,
            authUserId: "22222222-2222-4222-8222-222222222222",
          }),
        },
      ),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "legacy_personal_recovery_identity_mismatch",
    });
  });
});

test("super-admin approval body accepts only confirm and cannot select UUID or ID", async () => {
  assert.equal(isLegacyPersonalRecoveryApprovalBody({ confirm: true }), true);
  assert.equal(
    isLegacyPersonalRecoveryApprovalBody({
      confirm: true,
      authUserId: FIXED_AUTH_USER_ID,
      personalAccountId: FIXED_PERSONAL_ID,
    }),
    false,
  );

  await withRecoveryEnv(async () => {
    const deviceId = "route-test-device";
    const session = createSuperAdminSessionToken({
      deviceId,
      deviceLabel: "route test",
    });
    const trusted = createSuperAdminTrustedDeviceToken({
      deviceId,
      deviceLabel: "route test",
    });
    const response = await approveRecovery(
      new Request(
        "https://console.faolla.com/api/super-admin/legacy-personal-recovery",
        {
          method: "POST",
          headers: {
            origin: "https://console.faolla.com",
            "content-type": "application/json",
            cookie: `${SUPER_ADMIN_SESSION_COOKIE}=${session}; ${SUPER_ADMIN_TRUSTED_DEVICE_COOKIE}=${trusted}`,
          },
          body: JSON.stringify({
            confirm: true,
            authUserId: FIXED_AUTH_USER_ID,
            personalAccountId: FIXED_PERSONAL_ID,
          }),
        },
      ),
    );
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: false,
      error: "unauthorized",
    });
    assert.equal(JSON.stringify(body).includes(FIXED_AUTH_USER_ID), false);
    assert.equal(JSON.stringify(body).includes(FIXED_PERSONAL_ID), false);
  });
});
