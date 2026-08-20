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

async function withSuperAdminTestEnvironment(
  run: () => Promise<void>,
  options: { storeAvailable?: boolean } = {},
) {
  const previous = {
    secret: process.env.SUPER_ADMIN_VERIFICATION_SECRET,
    origin: process.env.FAOLLA_SUPER_ADMIN_ORIGIN,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.SUPER_ADMIN_VERIFICATION_SECRET = "test-super-admin-secret";
  process.env.FAOLLA_SUPER_ADMIN_ORIGIN = "https://console.faolla.com";
  if (options.storeAvailable) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://super-admin-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/rest/v1/pages" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ id: "trusted-devices-row", blocks: { maxDevices: 3, devices: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/rest/v1/pages" && init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  try {
    await run();
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("SUPER_ADMIN_VERIFICATION_SECRET", previous.secret);
    restore("FAOLLA_SUPER_ADMIN_ORIGIN", previous.origin);
    restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restore("SUPABASE_SERVICE_ROLE_KEY", previous.key);
    globalThis.fetch = previous.fetch;
  }
}

function makeProof(deviceId: string) {
  const challenge = createSuperAdminChallengeToken({
    deviceId,
    deviceLabel: "Windows / Chrome",
    nextPath: "/super-admin/editor",
  });
  return { challenge, proof: createSuperAdminEmailProofToken(challenge) };
}

test("super-admin auth complete rejects device mismatch", async () => {
  await withSuperAdminTestEnvironment(async () => {
    const { challenge, proof } = makeProof("device-12345678");
    const response = await POST(
      new Request("http://localhost/api/super-admin/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ challenge, proof, deviceId: "device-87654321" }),
      }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "device_mismatch" });
  });
});

test("super-admin login fails closed when revocation storage is unavailable", async () => {
  await withSuperAdminTestEnvironment(async () => {
    const { challenge, proof } = makeProof("device-12345678");
    const response = await POST(
      new Request("http://localhost/api/super-admin/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ challenge, proof, deviceId: "device-12345678" }),
      }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "super_admin_trusted_devices_unavailable" });
  });
});

test("super-admin console issues secure host-only cookies after durable device registration", async () => {
  await withSuperAdminTestEnvironment(async () => {
    const { challenge, proof } = makeProof("device-12345678");
    const response = await POST(
      new Request("https://console.faolla.com/api/super-admin/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://console.faolla.com" },
        body: JSON.stringify({ challenge, proof, deviceId: "device-12345678" }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(readSuperAdminSessionToken(response.cookies.get(SUPER_ADMIN_SESSION_COOKIE)?.value ?? "")?.deviceId, "device-12345678");
    assert.equal(readSuperAdminTrustedDeviceToken(response.cookies.get(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)?.value ?? "")?.deviceId, "device-12345678");
    for (const name of [SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_DEVICE_ID_COOKIE, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE]) {
      assert.equal(response.cookies.get(name)?.domain, undefined);
      assert.equal(response.cookies.get(name)?.secure, true);
    }
    assert.equal(response.cookies.get(SUPER_ADMIN_SESSION_COOKIE)?.httpOnly, true);
    assert.equal(response.cookies.get(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)?.httpOnly, true);
  }, { storeAvailable: true });
});

test("portal and merchant origins cannot complete super-admin login", async () => {
  await withSuperAdminTestEnvironment(async () => {
    const { challenge, proof } = makeProof("device-12345678");
    for (const origin of ["https://www.faolla.com", "https://merchant.faolla.com"]) {
      const response = await POST(
        new Request(`${origin}/api/super-admin/auth/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ challenge, proof, deviceId: "device-12345678" }),
        }),
      );
      assert.equal(response.status, 421);
    }
  });
});
