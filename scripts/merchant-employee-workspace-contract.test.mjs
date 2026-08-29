import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL(
    "../src/components/enterprise/MerchantEmployeeWorkspace.tsx",
    import.meta.url,
  ),
  "utf8",
);
const portal = await readFile(
  new URL(
    "../src/app/enterprise/[siteId]/EnterprisePortalClient.tsx",
    import.meta.url,
  ),
  "utf8",
);
const employeeHarness = await readFile(
  new URL(
    "../src/app/test-harness/employee-workspace/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("employee portal mounts the dedicated workspace instead of the owner admin shell", () => {
  assert.match(portal, /MerchantEmployeeWorkspace/);
  assert.doesNotMatch(portal, /AdminClient/);
  assert.doesNotMatch(workspace, /AdminClient/);
  assert.match(workspace, />\s*企业协作\s*</);
  assert.match(workspace, /MERCHANT_EMPLOYEE_BUSINESS_MENUS/);
});

test("employee workspace browser harness stays unavailable outside explicit local tests", () => {
  assert.match(
    employeeHarness,
    /FAOLLA_ENTERPRISE_E2E_HARNESS[\s\S]{0,120}enabled-for-local-browser-tests[\s\S]{0,100}notFound\(\)/,
  );
  assert.match(
    employeeHarness,
    /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/,
  );
});

test("business roots are lazy and receive one strict employee API boundary", () => {
  for (const component of [
    "MerchantOrderManagerDialog",
    "MerchantBookingManagerDialog",
    "MerchantMemberManager",
    "MerchantPointRedemptionCashier",
    "MerchantMembershipSettingsPanel",
    "MerchantEmployeeConversationPanel",
  ]) {
    assert.match(
      workspace,
      new RegExp(`dynamic\\([\\s\\S]*${component}`),
      `${component} must stay behind a dynamic import`,
    );
  }
  assert.match(workspace, /createMerchantBusinessApiClient\(\{/);
  assert.match(workspace, /authMode:\s*"employee"/);
  assert.match(workspace, /accessToken/);
  assert.match(
    workspace,
    /MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY/g,
  );
  assert.doesNotMatch(workspace, /\bfetch\s*\(/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|document\.cookie/);
});

test("capability lifecycle is no-store, fail-closed, refreshed and authorization-invalidating", () => {
  assert.match(
    workspace,
    /\/api\/merchant-business\/capabilities\?\$\{params\.toString\(\)\}/,
  );
  assert.match(workspace, /CAPABILITIES_REFRESH_INTERVAL_MS\s*=\s*30_000/);
  assert.match(workspace, /addEventListener\("focus"/);
  assert.match(workspace, /addEventListener\("visibilitychange"/);
  assert.match(workspace, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(
    workspace,
    /response\.status === 403 &&[\s\S]{0,120}staff_business_access_disabled/,
  );
  assert.match(workspace, /closeBusinessWorkspace\("unavailable"/);
  assert.match(workspace, /resolveMerchantEmployeeWorkspaceRoot/);
  assert.match(
    workspace,
    /collaborationPermissions\.includes\("enterprise\.view"\)/,
  );
  assert.match(
    workspace,
    /activeRoot === "collaboration" && collaborationAvailable/,
  );
  assert.match(
    workspace,
    /capabilityStatus === "disabled"[\s\S]+\? "collaboration"/,
  );
  assert.doesNotMatch(
    workspace,
    /capabilityStatus === "unavailable"[\s\S]{0,120}\? "collaboration"/,
  );
  assert.match(workspace, /当前角色没有可用功能/);
});

test("authorization fingerprint remounts every root and uploads stay inside gated leaf components", () => {
  assert.match(workspace, /buildMerchantBusinessCapabilitiesMountKey/);
  assert.match(workspace, /key=\{`\$\{capabilityMountKey\}:\$\{activeRoot\}`\}/);
  assert.match(
    workspace,
    /key=\{`\$\{siteId\}:\$\{authorizationEpoch\}:\$\{capabilityMountKey \|\| capabilityStatus\}`\}/,
  );
  assert.match(workspace, /principalKey|capabilityMountKey/);
  assert.doesNotMatch(workspace, /assets\/upload|businessPurpose/);
});
