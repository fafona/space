import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import {
  MerchantEnterpriseAccessError,
  readMerchantEnterpriseRequestAccessTokens,
  requireMerchantEnterpriseAllBoardAccess,
  requireMerchantEnterpriseBoardAccess,
  requireMerchantEnterpriseEntitlement,
  requireMerchantEnterprisePasswordAuthentication,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  createEnterpriseBrowserAuthStorageAdapter,
  isEnterpriseOAuthTransientStorageKey,
} from "@/lib/merchantEnterpriseSupabase";
import type { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";

process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://faolla.com";

type CurrentSnapshot = Awaited<
  ReturnType<typeof loadAuthoritativeCurrentMerchantSnapshotSites>
>;

function currentSite(
  siteId: string,
  allowEnterpriseManagement: boolean,
) {
  return {
    id: siteId,
    permissionConfig: {
      ...createDefaultMerchantPermissionConfig(),
      allowEnterpriseManagement,
    },
  } as unknown as CurrentSnapshot[number];
}

test("enterprise auth treats an explicit access-token header as authoritative", () => {
  const request = new Request("https://faolla.com/api/merchant-enterprise/overview", {
    headers: {
      "x-merchant-access-token": "employee-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=owner-cookie-token`,
    },
  });

  assert.deepEqual(readMerchantEnterpriseRequestAccessTokens(request), [
    "employee-token",
  ]);
});

test("enterprise auth never falls back to an owner cookie for an empty explicit header", () => {
  const request = new Request("https://faolla.com/api/merchant-enterprise/overview", {
    headers: {
      "x-merchant-access-token": "",
      cookie: `${MERCHANT_AUTH_COOKIE}=owner-cookie-token`,
    },
  });

  assert.deepEqual(readMerchantEnterpriseRequestAccessTokens(request), []);
});

test("enterprise auth keeps merchant cookie candidates when no explicit header is present", () => {
  const request = new Request("https://faolla.com/api/merchant-enterprise/overview", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=stale-token; ${MERCHANT_AUTH_COOKIE}=fresh-token`,
    },
  });

  assert.deepEqual(readMerchantEnterpriseRequestAccessTokens(request), [
    "fresh-token",
    "stale-token",
  ]);
});

test("enterprise entitlement uses only the injected authoritative current snapshot", async () => {
  const site = await requireMerchantEnterpriseEntitlement(
    "10000000",
    async () => [currentSite("10000000", true)],
  );
  assert.equal(site.id, "10000000");

  await assert.rejects(
    () =>
      requireMerchantEnterpriseEntitlement(
        "10000000",
        async () => [currentSite("10000000", false)],
      ),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "enterprise_management_disabled" &&
      error.status === 403,
  );
  await assert.rejects(
    () =>
      requireMerchantEnterpriseEntitlement("10000000", async () => {
        throw new Error("authoritative snapshot unavailable");
      }),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "enterprise_entitlement_unavailable" &&
      error.status === 503,
  );
});

test("enterprise employee access requires a password-authenticated session", () => {
  assert.doesNotThrow(() =>
    requireMerchantEnterprisePasswordAuthentication({
      authenticationMethods: ["password"],
    }),
  );
  assert.doesNotThrow(() =>
    requireMerchantEnterprisePasswordAuthentication({
      authenticationMethods: ["token_refresh", "password"],
    }),
  );

  for (const authenticationMethods of [
    [],
    ["invite"],
    ["magiclink"],
    ["recovery"],
    ["token_refresh"],
    ["oauth", "google"],
  ]) {
    assert.throws(
      () =>
        requireMerchantEnterprisePasswordAuthentication({
          authenticationMethods,
        }),
      (error: unknown) =>
        error instanceof MerchantEnterpriseAccessError &&
        error.code === "employee_password_authentication_required" &&
        error.status === 403,
      authenticationMethods.join(",") || "missing amr",
    );
  }
});

test("enterprise auth verifies signed AMR claims against the resolved user", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/merchantEnterpriseAuth.server.ts"),
    "utf8",
  );
  const claimsLookup = source.indexOf("authClient.auth.getClaims(accessToken)");
  const userLookup = source.indexOf("authClient.auth.getUser(accessToken)");
  const subjectBinding = source.indexOf(
    "normalizeText(claims.sub, 80) === normalizeText(user.id, 80)",
  );
  const amrBinding = source.indexOf(
    "authenticationMethods: normalizeAuthenticationMethods(claims.amr)",
  );

  assert.ok(claimsLookup >= 0);
  assert.ok(userLookup >= 0);
  assert.ok(subjectBinding > claimsLookup && subjectBinding > userLookup);
  assert.ok(amrBinding > subjectBinding);
  assert.match(source, /!claimsResult\?\.error[\s\S]{0,120}!userResult\?\.error/);
  assert.doesNotMatch(
    source,
    /authenticationMethods:\s*normalizeAuthenticationMethods\(user(?:\.|\?\.)/,
  );
});

test("enterprise actor resolution is read-only and gates before membership lookup", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/merchantEnterpriseAuth.server.ts"),
    "utf8",
  );
  const gateIndex = source.indexOf(
    "await requireMerchantEnterpriseEntitlement(siteId)",
  );
  const employeeLookupIndex = source.indexOf(
    '.from("merchant_enterprise_employees")',
  );
  const ownerLookupIndex = source.indexOf('.from("merchants")');
  const passwordGateIndex = source.indexOf(
    "requireMerchantEnterprisePasswordAuthentication(authContext)",
  );

  assert.ok(gateIndex >= 0);
  assert.ok(ownerLookupIndex > gateIndex);
  assert.ok(passwordGateIndex > ownerLookupIndex);
  assert.ok(employeeLookupIndex > passwordGateIndex);
  assert.ok(employeeLookupIndex > gateIndex);
  assert.equal(source.includes(".update({"), false);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.match(
    source,
    /getMissingMerchantEnterprisePermissionDependencies\(role\.permissions\)/,
  );
  assert.doesNotMatch(source, /merchant_employee_activation_failed/);
});

test("restricted enterprise actors cannot access or create outside their board scope", () => {
  const allowedBoardId = "11111111-1111-4111-8111-111111111111";
  const deniedBoardId = "22222222-2222-4222-8222-222222222222";
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "33333333-3333-4333-8333-333333333333",
    siteId: "10000000",
    displayName: "区域主管",
    email: "manager@example.com",
    roleId: "44444444-4444-4444-8444-444444444444",
    permissions: ["enterprise.view", "boards.manage", "tasks.view"],
    accessScope: "restricted",
    allowedBoardIds: [allowedBoardId],
  };

  assert.doesNotThrow(() =>
    requireMerchantEnterpriseBoardAccess(actor, allowedBoardId, "board_not_found"),
  );
  assert.throws(
    () => requireMerchantEnterpriseBoardAccess(actor, deniedBoardId, "board_not_found"),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "board_not_found" &&
      error.status === 404,
  );
  assert.throws(
    () => requireMerchantEnterpriseAllBoardAccess(actor),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "permission_denied" &&
      error.status === 403,
  );
});

test("enterprise invitation removal failures keep actionable HTTP statuses", () => {
  for (const [code, status] of [
    ["employee_not_found", 404],
    ["role_not_found", 404],
    ["enterprise_version_conflict", 409],
    ["employee_invitation_not_pending", 409],
    ["employee_invitation_in_use", 409],
    ["employee_email_in_use", 409],
    ["employee_board_access_in_use", 409],
    ["role_board_access_in_use", 409],
    ["task_assignee_board_access_denied", 409],
    ["system_role_protected", 409],
    ["role_in_use", 409],
    ["invalid_employee_invitation", 400],
  ] as const) {
    assert.deepEqual(toMerchantEnterpriseAccessResponse(new Error(code)), {
      status,
      body: { ok: false, error: code },
    });
  }
  assert.deepEqual(
    toMerchantEnterpriseAccessResponse(new Error("internal database detail")),
    {
      status: 503,
      body: { ok: false, error: "enterprise_request_failed" },
    },
  );
});

test("enterprise employee sessions remain tab-scoped and do not mirror tokens", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/merchantEnterpriseSupabase.ts"),
    "utf8",
  );
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /window\.localStorage\.removeItem/);
  assert.match(source, /isEnterpriseOAuthTransientStorageKey/);
  assert.match(source, /ENTERPRISE_OAUTH_TRANSIENT_TTL_MS/);
  assert.match(source, /deleteBrowserAuthStorageCookie/);
  assert.doesNotMatch(source, /createMirroredBrowserAuthStorageAdapter/);
  assert.doesNotMatch(source, /writeBrowserAuthStorageCookie/);
});

test("enterprise browser storage isolates tokens while allowing short-lived PKCE callbacks", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    } satisfies Storage;
  }

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage, localStorage },
  });
  try {
    const adapter = createEnterpriseBrowserAuthStorageAdapter();
    const tokenKey = "faolla-enterprise-auth-token";
    const verifierKey = `${tokenKey}-code-verifier`;
    assert.equal(isEnterpriseOAuthTransientStorageKey(tokenKey), false);
    assert.equal(isEnterpriseOAuthTransientStorageKey(verifierKey), true);

    adapter.setItem(tokenKey, "token-session");
    assert.equal(sessionStorage.getItem(tokenKey), "token-session");
    assert.equal(localStorage.getItem(tokenKey), null);

    adapter.setItem(verifierKey, "pkce-verifier");
    assert.equal(sessionStorage.getItem(verifierKey), null);
    assert.equal(localStorage.getItem(verifierKey), "pkce-verifier");
    assert.equal(adapter.getItem(verifierKey), "pkce-verifier");

    localStorage.setItem(
      `${verifierKey}.faolla-created-at`,
      String(Date.now() - 16 * 60 * 1000),
    );
    assert.equal(adapter.getItem(verifierKey), null);
    assert.equal(localStorage.getItem(verifierKey), null);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
