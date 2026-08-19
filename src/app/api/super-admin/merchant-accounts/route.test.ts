import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import {
  createSuperAdminSessionToken,
  createSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";
import { DELETE, GET, POST } from "@/app/api/super-admin/merchant-accounts/route";

function authorizedCookie() {
  const deviceId = "ordinary-auth-cutover-device";
  const session = createSuperAdminSessionToken({
    deviceId,
    deviceLabel: "ordinary auth cutover test",
  });
  const trustedDevice = createSuperAdminTrustedDeviceToken({
    deviceId,
    deviceLabel: "ordinary auth cutover test",
  });
  assert.ok(session);
  assert.ok(trustedDevice);
  return `${SUPER_ADMIN_SESSION_COOKIE}=${session}; ${SUPER_ADMIN_TRUSTED_DEVICE_COOKIE}=${trustedDevice}`;
}

function deletionRequest(body: Record<string, unknown>, cookie: string) {
  return new Request("http://localhost/api/super-admin/merchant-accounts", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie,
    },
    body: JSON.stringify(body),
  });
}

test("super-admin deletion cannot orphan a canonical personal or one-auth-many merchant binding", async () => {
  const previous = {
    verificationSecret: process.env.SUPER_ADMIN_VERIFICATION_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env.SUPER_ADMIN_VERIFICATION_SECRET =
    "ordinary-auth-cutover-test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("retirement guard must run before backend mutation");
  };

  try {
    const cookie = authorizedCookie();
    for (const body of [
      {
        accountType: "personal",
        accountId: "50010105",
        authUserId: "10000000-0000-4000-8000-000000000001",
        code: "123456",
      },
      {
        accountType: "merchant",
        accountId: "12345678",
        authUserId: "10000000-0000-4000-8000-000000000002",
        // The same Auth UUID may still own another merchant; direct Auth
        // deletion is therefore never safe here.
        merchantIds: ["12345678", "87654321"],
        code: "123456",
      },
    ]) {
      const response = await DELETE(deletionRequest(body, cookie));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "ordinary_account_safe_retirement_required",
        message:
          "This account must be safely retired through the authoritative binding service before it can be deleted.",
      });
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previous.verificationSecret === undefined) {
      delete process.env.SUPER_ADMIN_VERIFICATION_SECRET;
    } else {
      process.env.SUPER_ADMIN_VERIFICATION_SECRET =
        previous.verificationSecret;
    }
    if (previous.supabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    }
    if (previous.serviceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRoleKey;
    }
  }
});

test("super-admin creation uses only create-only authority before display updates", () => {
  const source = fs
    .readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/super-admin/merchant-accounts/route.ts",
      ),
      "utf8",
    )
    .replace(/\r\n?/g, "\n");
  const createIndex = source.indexOf(
    "await createActiveOrdinaryAccountAuthorization(",
  );
  const displayUpdateIndex = source.indexOf(
    '.from("merchants")\n            .update({ name: merchantDisplayName })',
  );
  assert.ok(createIndex >= 0);
  assert.ok(displayUpdateIndex > createIndex);
  assert.doesNotMatch(
    source,
    /faolla_bind_ordinary_account_authorization_v1|\.from\("merchants"\)\.insert\(/,
  );
  assert.match(source, /appMetadata\.manual_user === true/);
  assert.match(source, /appMetadata\.account_id === accountId/);

  const personalResolveIndex = source.indexOf(
    "const authoritativeIdentity = await resolveOrdinaryAccountPlatformIdentity(",
  );
  const personalMetadataUpdateIndex = source.indexOf(
    "buildPersonalAccountServiceMetadataPatch(targetUser, nextConfig)",
  );
  assert.ok(personalResolveIndex >= 0);
  assert.ok(personalMetadataUpdateIndex > personalResolveIndex);

  assert.match(source, /ordinary_account_safe_retirement_required/);
  const deleteHandler = source.slice(
    source.indexOf("export async function DELETE"),
    source.indexOf("async function loadAuthoritativeAccountsBestEffort"),
  );
  assert.doesNotMatch(
    deleteHandler,
    /auth\.admin\.deleteUser|\.from\("merchants"\)\.delete\(/,
  );
  assert.match(source, /postFailureAuthorization\.status === "unbound"/);
  assert.doesNotMatch(
    source,
    /readPlatformAccountIdFromMetadata|readPlatformAccountTypeHintFromMetadata|dedupedByEmail|authByEmail/,
  );
  assert.match(source, /loadAuthoritativeAccountsBestEffort/);
});

test("super-admin GET emits every authoritative merchant in one-auth-many and ignores forged identity metadata", async () => {
  const previous = {
    verificationSecret: process.env.SUPER_ADMIN_VERIFICATION_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SUPER_ADMIN_VERIFICATION_SECRET =
    "ordinary-auth-cutover-list-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://ordinary-list.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ordinary-list-service-role";

  const merchantAuthUserId = "11111111-1111-4111-8111-111111111111";
  const personalAuthUserId = "22222222-2222-4222-8222-222222222222";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/admin/users") {
      return new Response(
        JSON.stringify({
          users: [
            {
              id: merchantAuthUserId,
              email: "shared@example.com",
              created_at: "2026-08-18T10:00:00.000Z",
              email_confirmed_at: "2026-08-18T10:00:00.000Z",
              user_metadata: {
                account_type: "personal",
                personal_id: "forged-personal",
                merchant_id: "99999999",
              },
              app_metadata: {},
            },
            {
              id: personalAuthUserId,
              email: "shared@example.com",
              created_at: "2026-08-18T11:00:00.000Z",
              email_confirmed_at: "2026-08-18T11:00:00.000Z",
              user_metadata: {
                account_type: "merchant",
                merchant_id: "99999999",
                personal_id: "forged-personal",
              },
              app_metadata: {},
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        p_auth_user_id?: string;
      };
      const payload =
        body.p_auth_user_id === merchantAuthUserId
          ? {
              schemaVersion: 1,
              status: "resolved",
              accountType: "merchant",
              merchantIds: ["12345678", "87654321"],
              personalAccountId: null,
            }
          : {
              schemaVersion: 1,
              status: "resolved",
              accountType: "personal",
              merchantIds: [],
              personalAccountId: "50010105",
            };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/rest/v1/merchants") {
      return new Response(
        JSON.stringify([
          {
            id: "12345678",
            name: "Merchant A",
            email: "shared@example.com",
            created_at: "2026-08-17T10:00:00.000Z",
          },
          {
            id: "87654321",
            name: "Merchant B",
            email: "shared@example.com",
            created_at: "2026-08-17T11:00:00.000Z",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await GET(
      new Request("http://localhost/api/super-admin/merchant-accounts", {
        headers: { cookie: authorizedCookie() },
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      items: Array<{
        accountType: string;
        accountId: string;
        merchantId: string;
        authUserId: string | null;
      }>;
    };
    const merchantItems = body.items.filter(
      (item) => item.accountType === "merchant",
    );
    assert.deepEqual(
      merchantItems.map((item) => item.merchantId).sort(),
      ["12345678", "87654321"],
    );
    assert.ok(
      merchantItems.every((item) => item.authUserId === merchantAuthUserId),
    );
    assert.ok(
      body.items.some(
        (item) =>
          item.accountType === "personal" &&
          item.accountId === "50010105" &&
          item.authUserId === personalAuthUserId,
      ),
    );
    assert.ok(
      body.items.every(
        (item) =>
          item.accountId !== "forged-personal" &&
          item.merchantId !== "99999999",
      ),
    );
  } finally {
    globalThis.fetch = previousFetch;
    process.env.SUPER_ADMIN_VERIFICATION_SECRET = previous.verificationSecret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRoleKey;
  }
});

test("super-admin creation rejects a cross-type authoritative collision before creating Auth", async () => {
  const previous = {
    verificationSecret: process.env.SUPER_ADMIN_VERIFICATION_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SUPER_ADMIN_VERIFICATION_SECRET =
    "ordinary-auth-collision-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://ordinary-collision.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "ordinary-collision-service-role";

  const merchantAuthUserId = "33333333-3333-4333-8333-333333333333";
  const personalAuthUserId = "44444444-4444-4444-8444-444444444444";
  let createUserCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.pathname === "/auth/v1/admin/users") {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        createUserCalls += 1;
        return new Response("unexpected create", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          users: [
            {
              id: merchantAuthUserId,
              email: "merchant-collision@example.com",
              user_metadata: {},
              app_metadata: {},
            },
            {
              id: personalAuthUserId,
              email: "personal-collision@example.com",
              user_metadata: {},
              app_metadata: {},
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.pathname ===
      "/rest/v1/rpc/faolla_resolve_ordinary_account_authorization_v1"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        p_auth_user_id?: string;
      };
      const authorization =
        body.p_auth_user_id === merchantAuthUserId
          ? {
              schemaVersion: 1,
              status: "resolved",
              accountType: "merchant",
              merchantIds: ["50010105"],
              personalAccountId: null,
            }
          : {
              schemaVersion: 1,
              status: "resolved",
              accountType: "personal",
              merchantIds: [],
              personalAccountId: "50010105",
            };
      return new Response(JSON.stringify(authorization), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/rest/v1/merchants") {
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const response = await POST(
      new Request("http://localhost/api/super-admin/merchant-accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          cookie: authorizedCookie(),
        },
        body: JSON.stringify({
          accountType: "personal",
          accountId: "50010105",
          loginAccount: "new-personal@example.com",
          password: "secure-password",
        }),
      }),
    );
    assert.equal(response.status, 409);
    assert.equal(
      (await response.json()).error,
      "ordinary_account_identifier_collision",
    );
    assert.equal(createUserCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    process.env.SUPER_ADMIN_VERIFICATION_SECRET = previous.verificationSecret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRoleKey;
  }
});
