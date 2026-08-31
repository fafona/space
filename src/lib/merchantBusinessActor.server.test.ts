import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  readMerchantBusinessRequestAccessTokens,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActorDependencies,
} from "@/lib/merchantBusinessActor.server";
import { MERCHANT_AUTH_COOKIE } from "@/lib/merchantAuthSession";

process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://www.faolla.com";

const SITE_ID = "10000000";
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "33333333-3333-4333-8333-333333333333";

function request(headers?: HeadersInit) {
  return new Request(`https://www.faolla.com/api/orders?siteId=${SITE_ID}`, {
    headers,
  });
}

function dependencies(
  overrides: Partial<MerchantBusinessActorDependencies> = {},
): MerchantBusinessActorDependencies {
  return {
    resolveAuthUser: async () => ({
      user: {
        id: AUTH_USER_ID,
        email: "employee@example.com",
        app_metadata: { principal_type: "merchant_staff" },
      },
      explicitToken: true,
      jwtVerified: true,
      authenticationMethods: ["password"],
    }),
    isStaffPrincipal: async () => true,
    loadEmployeeAuthorization: async () => ({
      employeeId: EMPLOYEE_ID,
      employeeVersion: 7,
      roleId: ROLE_ID,
      roleVersion: 9,
      displayName: "值班员工",
      email: "employee@example.com",
      permissions: ["orders.view", "orders.status.manage"],
    }),
    loadOwnerAuthorization: async () => {
      throw new Error("staff principals must never reach owner authorization");
    },
    loadSite: async (siteId) => ({
      id: siteId,
      permissionConfig: {
        ...createDefaultMerchantPermissionConfig(),
        allowProductBlock: true,
        allowOrderManagement: true,
        allowEnterpriseManagement: true,
      },
    }),
    rolloutConfig: {
      mode: "enforce",
      siteIds: [SITE_ID],
      valid: true,
    },
    ...overrides,
  };
}

test("explicit staff token is authoritative even when an owner cookie exists", () => {
  assert.deepEqual(
    readMerchantBusinessRequestAccessTokens(
      request({
        "x-merchant-access-token": "employee-token",
        cookie: `${MERCHANT_AUTH_COOKIE}=owner-token`,
      }),
    ),
    { candidates: ["employee-token"], explicitToken: true },
  );
  assert.deepEqual(
    readMerchantBusinessRequestAccessTokens(
      request({
        "x-merchant-access-token": "",
        cookie: `${MERCHANT_AUTH_COOKIE}=owner-token`,
      }),
    ),
    { candidates: [], explicitToken: true },
  );
});

test("business authorization rejects tenant hosts before reading credentials", async () => {
  let authUserChecks = 0;
  for (const headers of [
    undefined,
    {
      host: "merchant.faolla.com",
      "x-forwarded-host": "www.faolla.com",
      "x-merchant-access-token": "employee-token",
    },
  ]) {
    await assert.rejects(
      () =>
        authorizeMerchantBusinessRequest(
          new Request(
            `https://merchant.faolla.com/api/orders?siteId=${SITE_ID}`,
            { headers },
          ),
          { siteId: SITE_ID, requiredPermission: "orders.view" },
          dependencies({
            resolveAuthUser: async () => {
              authUserChecks += 1;
              return {
                user: { id: AUTH_USER_ID },
                explicitToken: true,
                jwtVerified: true,
                authenticationMethods: ["password"],
              };
            },
          }),
        ),
      (error: unknown) =>
        error instanceof MerchantBusinessAccessError &&
        error.code === "portal_origin_required" &&
        error.status === 421,
    );
  }
  assert.equal(authUserChecks, 0);
});

test("employee actor is exact-site, versioned and contains no token", async () => {
  const actor = await authorizeMerchantBusinessRequest(
    request({ "x-merchant-access-token": "employee-token" }),
    { siteId: SITE_ID, requiredPermission: "orders.status.manage" },
    dependencies(),
  );
  assert.deepEqual(actor, {
    type: "employee",
    siteId: SITE_ID,
    authUserId: AUTH_USER_ID,
    employeeId: EMPLOYEE_ID,
    roleId: ROLE_ID,
    employeeVersion: 7,
    roleVersion: 9,
    principalKey: `employee:${EMPLOYEE_ID}`,
    authorizationVersion: "7:9",
    displayName: "值班员工",
    email: "employee@example.com",
    collaborationPermissions: [],
    businessPermissions: ["orders.view", "orders.status.manage"],
  });
  assert.equal(JSON.stringify(actor).includes("employee-token"), false);
});

test("staff principals require an explicit portal token and never authorize from cookies", async () => {
  let siteChecks = 0;
  let employeeChecks = 0;
  let ownerChecks = 0;
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request({ cookie: `${MERCHANT_AUTH_COOKIE}=staff-cookie-token` }),
        { siteId: SITE_ID, requiredPermission: "orders.view" },
        dependencies({
          resolveAuthUser: async () => ({
            user: {
              id: AUTH_USER_ID,
              email: "employee@example.com",
              app_metadata: { principal_type: "merchant_staff" },
            },
            explicitToken: false,
            jwtVerified: true,
            authenticationMethods: ["password"],
          }),
          loadSite: async () => {
            siteChecks += 1;
            throw new Error("staff cookie fallback must stop before site access");
          },
          loadEmployeeAuthorization: async () => {
            employeeChecks += 1;
            throw new Error("staff cookie fallback must not reach employee authorization");
          },
          loadOwnerAuthorization: async () => {
            ownerChecks += 1;
            throw new Error("staff principals must not fall back to owner authorization");
          },
        }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "unauthorized" &&
      error.status === 401,
  );
  assert.equal(siteChecks, 0);
  assert.equal(employeeChecks, 0);
  assert.equal(ownerChecks, 0);
});

test("employee access requires a verified password JWT and rejects link or recovery AMR", async () => {
  const rejectedAuthContexts = [
    { jwtVerified: false, authenticationMethods: ["password"] },
    { jwtVerified: true, authenticationMethods: [] },
    { jwtVerified: true, authenticationMethods: ["oauth", "google"] },
    { jwtVerified: true, authenticationMethods: ["password", "invite"] },
    { jwtVerified: true, authenticationMethods: ["password", "magiclink"] },
    { jwtVerified: true, authenticationMethods: ["password", "recovery"] },
  ];

  for (const authContext of rejectedAuthContexts) {
    let siteChecks = 0;
    let employeeChecks = 0;
    await assert.rejects(
      () =>
        authorizeMerchantBusinessRequest(
          request({ "x-merchant-access-token": "employee-token" }),
          { siteId: SITE_ID, requiredPermission: "orders.view" },
          dependencies({
            resolveAuthUser: async () => ({
              user: {
                id: AUTH_USER_ID,
                email: "employee@example.com",
                app_metadata: { principal_type: "merchant_staff" },
              },
              explicitToken: true,
              ...authContext,
            }),
            loadSite: async () => {
              siteChecks += 1;
              throw new Error("invalid employee authentication must fail first");
            },
            loadEmployeeAuthorization: async () => {
              employeeChecks += 1;
              throw new Error("invalid employee authentication must fail first");
            },
          }),
        ),
      (error: unknown) =>
        error instanceof MerchantBusinessAccessError &&
        error.code === "employee_password_authentication_required" &&
        error.status === 403,
    );
    assert.equal(siteChecks, 0);
    assert.equal(employeeChecks, 0);
  }
});

test("employee access is default-off and requires the exact site allowlist", async () => {
  for (const rolloutConfig of [
    { mode: "off" as const, siteIds: [] as string[], valid: true },
    { mode: "enforce" as const, siteIds: ["10000001"], valid: true },
    { mode: null, siteIds: [] as string[], valid: false },
  ]) {
    await assert.rejects(
      () =>
        authorizeMerchantBusinessRequest(
          request(),
          { siteId: SITE_ID, requiredPermission: "orders.view" },
          dependencies({ rolloutConfig }),
        ),
      (error: unknown) =>
        error instanceof MerchantBusinessAccessError &&
        error.code === "staff_business_access_disabled" &&
        error.status === 403,
    );
  }
});

test("employee permission, active membership and module entitlement fail closed", async () => {
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request(),
        { siteId: SITE_ID, requiredPermission: "orders.complete" },
        dependencies(),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "permission_denied",
  );
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request(),
        { siteId: SITE_ID, requiredPermission: "orders.view" },
        dependencies({ loadEmployeeAuthorization: async () => null }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "business_access_denied",
  );
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request(),
        { siteId: SITE_ID, requiredPermission: "orders.view" },
        dependencies({
          loadSite: async () => ({
            id: SITE_ID,
            permissionConfig: {
              ...createDefaultMerchantPermissionConfig(),
              allowEnterpriseManagement: true,
            },
          }),
        }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "business_module_disabled",
  );
});

test("staff classification failures never fall back to owner authorization", async () => {
  let ownerChecks = 0;
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request(),
        { siteId: SITE_ID, requiredPermission: "orders.view" },
        dependencies({
          isStaffPrincipal: async () => {
            throw new Error("directory unavailable");
          },
          loadOwnerAuthorization: async () => {
            ownerChecks += 1;
            return {
              displayName: "Owner",
              email: "owner@example.com",
              source: "database",
            };
          },
        }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "business_principal_check_failed" &&
      error.status === 503,
  );
  assert.equal(ownerChecks, 0);
});

test("owners keep OAuth and Google business access while employee rollout remains off", async () => {
  for (const authenticationMethods of [["oauth"], ["google"]]) {
    const actor = await authorizeMerchantBusinessRequest(
      request(),
      { siteId: SITE_ID, requiredPermission: "orders.view" },
      dependencies({
        resolveAuthUser: async () => ({
          user: { id: AUTH_USER_ID, email: "owner@example.com" },
          explicitToken: false,
          jwtVerified: true,
          authenticationMethods,
        }),
        isStaffPrincipal: async () => false,
        loadOwnerAuthorization: async () => ({
          displayName: "Owner",
          email: "owner@example.com",
          source: "database",
        }),
        rolloutConfig: { mode: "off", siteIds: [], valid: true },
      }),
    );
    assert.equal(actor.type, "owner");
    assert.equal(actor.principalKey, `owner:${AUTH_USER_ID}`);
    assert.equal(actor.businessPermissions.includes("orders.view"), true);
    assert.equal(actor.businessPermissions.includes("members.settings.manage"), false);
  }
});

test("forged personal-account merchant metadata never grants owner access", async () => {
  let ownerChecks = 0;
  await assert.rejects(
    () =>
      authorizeMerchantBusinessRequest(
        request({ cookie: `${MERCHANT_AUTH_COOKIE}=personal-cookie-token` }),
        { siteId: SITE_ID, requiredPermission: "orders.view" },
        dependencies({
          resolveAuthUser: async () => ({
            user: {
              id: AUTH_USER_ID,
              email: "personal@example.com",
              user_metadata: { merchant_id: SITE_ID },
              app_metadata: { account_type: "personal" },
            },
            explicitToken: false,
            jwtVerified: true,
            authenticationMethods: ["magiclink"],
          }),
          isStaffPrincipal: async () => false,
          loadOwnerAuthorization: async (siteId, user) => {
            ownerChecks += 1;
            assert.equal(siteId, SITE_ID);
            assert.equal(user.id, AUTH_USER_ID);
            return null;
          },
        }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "business_access_denied" &&
      error.status === 403,
  );
  assert.equal(ownerChecks, 1);
});

test("mutation reauthorization rejects changed employee or role versions", async () => {
  const actor = await authorizeMerchantBusinessRequest(
    request({ "x-merchant-access-token": "employee-token" }),
    { siteId: SITE_ID, requiredPermission: "orders.status.manage" },
    dependencies(),
  );
  await assert.rejects(
    () =>
      reauthorizeMerchantBusinessMutation(
        request({ "x-merchant-access-token": "employee-token" }),
        {
          actor,
          requiredPermissions: ["orders.view", "orders.status.manage"],
        },
        dependencies({
          loadEmployeeAuthorization: async () => ({
            employeeId: EMPLOYEE_ID,
            employeeVersion: 7,
            roleId: ROLE_ID,
            roleVersion: 10,
            displayName: "值班员工",
            email: "employee@example.com",
            permissions: ["orders.view", "orders.status.manage"],
          }),
        }),
      ),
    (error: unknown) =>
      error instanceof MerchantBusinessAccessError &&
      error.code === "permission_denied" &&
      error.status === 403,
  );
});
