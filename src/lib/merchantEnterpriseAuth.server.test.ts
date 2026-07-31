import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import {
  MerchantEnterpriseAccessError,
  readMerchantEnterpriseRequestAccessTokens,
  requireMerchantEnterpriseEntitlement,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createEnterpriseBrowserAuthStorageAdapter,
  isEnterpriseOAuthTransientStorageKey,
} from "@/lib/merchantEnterpriseSupabase";
import type { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";

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
      cookie: "merchant-space-merchant-auth=owner-cookie-token",
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
      cookie: "merchant-space-merchant-auth=owner-cookie-token",
    },
  });

  assert.deepEqual(readMerchantEnterpriseRequestAccessTokens(request), []);
});

test("enterprise auth keeps merchant cookie candidates when no explicit header is present", () => {
  const request = new Request("https://faolla.com/api/merchant-enterprise/overview", {
    headers: {
      cookie:
        "merchant-space-merchant-auth=stale-token; merchant-space-merchant-auth=fresh-token",
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

  assert.ok(gateIndex >= 0);
  assert.ok(employeeLookupIndex > gateIndex);
  assert.equal(source.includes(".update({"), false);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.match(
    source,
    /getMissingMerchantEnterprisePermissionDependencies\(role\.permissions\)/,
  );
  assert.doesNotMatch(source, /merchant_employee_activation_failed/);
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
