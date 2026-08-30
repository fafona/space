import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantMembershipSettingsGet,
  handleMerchantMembershipSettingsPatch,
  handleMerchantMembershipSettingsPut,
} from "@/app/api/membership-settings/route";
import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const ORIGIN = "https://launch.faolla.com";
const SITE_ID = "10000000";
const SETTINGS_VERSION = "2026-08-30T12:00:00.000Z";

function makeEmployee(
  permissions: MerchantStaffBusinessPermission[],
  authorizationVersion = "4:5",
): MerchantBusinessActor {
  return {
    type: "employee",
    siteId: SITE_ID,
    authUserId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    roleId: "33333333-3333-4333-8333-333333333333",
    employeeVersion: 4,
    roleVersion: 5,
    principalKey: "employee:22222222-2222-4222-8222-222222222222",
    authorizationVersion,
    displayName: "Settings employee",
    email: "settings-employee@example.test",
    collaborationPermissions: [],
    businessPermissions: permissions,
  };
}

function makeSettings() {
  return {
    ...createEmptyMerchantMembershipSettings(SITE_ID),
    updatedAt: SETTINGS_VERSION,
  };
}

function getRequest(scope: string) {
  const params = new URLSearchParams({
    siteId: SITE_ID,
    scope,
    knownVersion: SETTINGS_VERSION,
  });
  return new Request(`${ORIGIN}/api/membership-settings?${params.toString()}`, {
    headers: { "x-merchant-access-token": "employee-token" },
  });
}

function mutationRequest(method: "PUT" | "PATCH", body: unknown) {
  return new Request(`${ORIGIN}/api/membership-settings`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-merchant-access-token": "employee-token",
    },
    body: JSON.stringify(body),
  });
}

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("employee settings GET enforces exact scope permissions and never reuses an owner cache entry", async () => {
  const scenarios = [
    {
      scope: "members",
      permissions: [
        "members.view",
        "members.settings.manage",
      ] as MerchantStaffBusinessPermission[],
      deniedPermissionSets: [
        ["members.view"],
        ["redemptions.view", "redemptions.catalog.manage"],
      ] as MerchantStaffBusinessPermission[][],
      expectedKeys: ["growthRules", "levels", "pointsRules", "siteId", "updatedAt"],
    },
    {
      scope: "redemptions",
      permissions: [
        "redemptions.view",
        "redemptions.catalog.manage",
      ] as MerchantStaffBusinessPermission[],
      deniedPermissionSets: [
        ["redemptions.view"],
        ["members.view", "members.settings.manage"],
      ] as MerchantStaffBusinessPermission[][],
      expectedKeys: [
        "rechargePlans",
        "redemptionCategories",
        "redemptionItems",
        "redemptionShowStock",
        "siteId",
        "updatedAt",
      ],
    },
  ] as const;

  for (const scenario of scenarios) {
    let loadCalls = 0;
    const response = await handleMerchantMembershipSettingsGet(
      getRequest(scenario.scope),
      {
        async resolveActor(_request, input) {
          assert.equal(input.siteId, SITE_ID);
          return makeEmployee([...scenario.permissions]);
        },
        async loadSettings(siteId) {
          assert.equal(siteId, SITE_ID);
          loadCalls += 1;
          return makeSettings();
        },
      },
    );
    assert.equal(response.status, 200);
    assertPrivateHeaders(response);
    const payload = (await response.json()) as {
      notModified?: boolean;
      settings: Record<string, unknown>;
      version: string;
    };
    assert.equal(payload.notModified, undefined);
    assert.equal(payload.version, SETTINGS_VERSION);
    assert.deepEqual(Object.keys(payload.settings).sort(), [...scenario.expectedKeys].sort());
    assert.equal("printSettings" in payload.settings, false);
    assert.equal(loadCalls, 1);

    for (const deniedPermissions of scenario.deniedPermissionSets) {
      let deniedLoadCalls = 0;
      const denied = await handleMerchantMembershipSettingsGet(
        getRequest(scenario.scope),
        {
          async resolveActor() {
            return makeEmployee([...deniedPermissions]);
          },
          async loadSettings() {
            deniedLoadCalls += 1;
            return makeSettings();
          },
        },
      );
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: "permission_denied" });
      assert.equal(deniedLoadCalls, 0);
      assertPrivateHeaders(denied);
    }
  }
});

test("employee settings PUT rejects a view from another scope before updating", async () => {
  let updateCalls = 0;
  const response = await handleMerchantMembershipSettingsPut(
    mutationRequest("PUT", {
      siteId: SITE_ID,
      scope: "members",
      view: "redemptionItems",
      settings: makeSettings(),
    }),
    {
      async resolveActor() {
        return makeEmployee(["members.view", "members.settings.manage"]);
      },
      async updateSettings() {
        updateCalls += 1;
        return makeSettings();
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "membership_settings_scope_mismatch",
  });
  assert.equal(updateCalls, 0);
  assertPrivateHeaders(response);
});

test("employee settings PUT freshly reauthorizes inside the update and writes nothing after revocation", async () => {
  const actor = makeEmployee(["members.view", "members.settings.manage"]);
  const events: string[] = [];
  let authorizationCalls = 0;
  const response = await handleMerchantMembershipSettingsPut(
    mutationRequest("PUT", {
      siteId: SITE_ID,
      scope: "members",
      view: "levels",
      settings: makeSettings(),
      expectedUpdatedAt: SETTINGS_VERSION,
    }),
    {
      async resolveActor(_request, input) {
        assert.equal(input.siteId, SITE_ID);
        authorizationCalls += 1;
        if (authorizationCalls === 1) {
          events.push("authorize");
          return actor;
        }
        events.push("reauthorize");
        return makeEmployee(["members.view"], actor.authorizationVersion);
      },
      async updateSettings(input) {
        events.push("lock-enter");
        assert.equal(input.operatorId, actor.principalKey);
        assert.equal(input.expectedUpdatedAt, SETTINGS_VERSION);
        await input.assertAuthorizationCurrent?.();
        events.push("write");
        return makeSettings();
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
  assert.deepEqual(events, ["authorize", "lock-enter", "reauthorize"]);
  assert.equal(authorizationCalls, 2);
  assertPrivateHeaders(response);
});

test("employee settings PATCH remains owner-only and never reaches print persistence", async () => {
  let printUpdateCalls = 0;
  const response = await handleMerchantMembershipSettingsPatch(
    mutationRequest("PATCH", {
      siteId: SITE_ID,
      printSettings: makeSettings().printSettings,
    }),
    {
      async resolveActor() {
        return makeEmployee([
          "redemptions.view",
          "redemptions.print",
          "redemptions.catalog.manage",
        ]);
      },
      async updatePrintSettings() {
        printUpdateCalls += 1;
        return makeSettings();
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "owner_required" });
  assert.equal(printUpdateCalls, 0);
  assertPrivateHeaders(response);
});
