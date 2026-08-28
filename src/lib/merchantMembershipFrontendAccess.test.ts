import assert from "node:assert/strict";
import test from "node:test";
import {
  canOpenMerchantMembershipSettingsView,
  createMerchantMembershipApiRequest,
  getMerchantMembershipSettingsFrontendScope,
  hasMerchantMembershipFrontendPermission,
  isMerchantMembershipEmployeeFrontend,
} from "@/lib/merchantMembershipFrontendAccess";

test("owner permissions stay backward compatible while employee permissions fail closed", () => {
  assert.equal(
    hasMerchantMembershipFrontendPermission(undefined, "members.view"),
    true,
  );
  assert.equal(
    hasMerchantMembershipFrontendPermission([], "members.view"),
    false,
  );
  assert.equal(
    isMerchantMembershipEmployeeFrontend({ permissions: [] }),
    true,
  );
});

test("membership settings views map to their exact server scopes", () => {
  assert.equal(getMerchantMembershipSettingsFrontendScope("levels"), "members");
  assert.equal(
    getMerchantMembershipSettingsFrontendScope("pointsRules"),
    "members",
  );
  assert.equal(
    getMerchantMembershipSettingsFrontendScope("rechargePlans"),
    "redemptions",
  );
  assert.equal(
    canOpenMerchantMembershipSettingsView(
      ["members.settings.manage"],
      "levels",
    ),
    true,
  );
  assert.equal(
    canOpenMerchantMembershipSettingsView(
      ["members.settings.manage"],
      "redemptionItems",
    ),
    false,
  );
});

test("employee request factory never falls back to owner fetch", async () => {
  let ownerCalls = 0;
  const request = createMerchantMembershipApiRequest({
    employeeMode: true,
    ownerFetch: async () => {
      ownerCalls += 1;
      return new Response(null);
    },
  });
  await assert.rejects(
    request("/api/memberships"),
    /employee_membership_api_client_required/,
  );
  assert.equal(ownerCalls, 0);
});
