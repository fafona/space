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
const employeeShell = await readFile(
  new URL(
    "../src/components/enterprise/MerchantEmployeeShell.tsx",
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
  assert.match(workspace, /MerchantEmployeeShell/);
  assert.doesNotMatch(portal, /AdminClient/);
  assert.doesNotMatch(workspace, /AdminClient/);
  assert.doesNotMatch(employeeShell, /AdminClient/);
  assert.match(workspace, /label:\s*"企业协作"/);
  assert.match(workspace, /MERCHANT_EMPLOYEE_BUSINESS_MENUS/);
});

test("employee shell mirrors the merchant sidebar without owner identity or owner-only entries", () => {
  assert.match(employeeShell, /data-employee-merchant-shell="1"/);
  assert.match(employeeShell, /data-employee-merchant-sidebar="1"/);
  assert.match(employeeShell, /w-\[228px\]/);
  assert.match(employeeShell, /bg-\[#111827\]/);
  assert.match(employeeShell, /员工工作区主导航/);
  assert.match(employeeShell, /getSubmenuButtonClassName/);
  assert.match(employeeShell, /contextItems\.map/);
  assert.match(
    employeeShell,
    /selectContextItem[\s\S]{0,180}closeMobileSidebar\(\)/,
  );
  assert.match(employeeShell, /mobileMenuTriggerRef/);
  assert.match(employeeShell, /mobileSidebarRef/);
  assert.match(employeeShell, /trapMobileSidebarFocus/);
  assert.match(
    employeeShell,
    /event\.key === "Escape"[\s\S]{0,100}mobileSidebarOpen/,
  );
  assert.match(employeeShell, /MOBILE_SIDEBAR_MEDIA_QUERY/);
  assert.match(workspace, /积分兑换子菜单/);
  assert.match(workspace, /会员管理子菜单/);
  assert.doesNotMatch(workspace, /aria-label="积分兑换功能"/);
  assert.doesNotMatch(workspace, /aria-label="会员管理功能"/);
  assert.match(employeeShell, /aria-current=/);
  assert.match(employeeShell, /lg:ml-\[228px\]/);
  assert.match(employeeShell, /lg:hidden/);
  assert.match(portal, /账户与安全/);
  assert.match(portal, /autoComplete="new-password"/);
  assert.match(portal, /setNewPassword\(""\)/);

  const isolatedEmployeeUi = `${portal}\n${workspace}\n${employeeShell}`;
  assert.doesNotMatch(
    isolatedEmployeeUi,
    /merchant-logout|readMerchantSessionPayload|\/api\/auth\/merchant-session/,
  );
  assert.doesNotMatch(
    isolatedEmployeeUi,
    />\s*(?:企业管理|优惠券|经营中心|商户信息|网站编辑)\s*</,
  );
  assert.doesNotMatch(employeeShell, /\bfetch\s*\(|accessToken|localStorage|sessionStorage|document\.cookie/);
});

test("employee business content keeps the merchant full-width desktop geometry", () => {
  assert.match(workspace, /data-employee-merchant-content="business"/);
  assert.match(
    workspace,
    /className="w-full p-4 sm:p-6 lg:px-6 lg:pb-8 lg:pt-0"/,
  );
  assert.doesNotMatch(workspace, /mx-auto max-w-7xl p-4 sm:p-6/);
  assert.match(
    workspace,
    /MerchantPointRedemptionCashier[\s\S]{0,420}className="min-h-\[calc\(100vh-14rem\)\] lg:py-6"/,
  );
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
  assert.match(
    workspace,
    /subviewAuthorizationKey = `\$\{authorizationEpoch\}:\$\{capabilityMountKey\}`/,
  );
  assert.match(
    workspace,
    /redemptionSubviewPreference\.authorizationKey === subviewAuthorizationKey/,
  );
  assert.match(
    workspace,
    /memberSubviewPreference\.authorizationKey === subviewAuthorizationKey/,
  );
  assert.match(workspace, /key=\{`\$\{capabilityMountKey\}:\$\{activeRoot\}`\}/);
  assert.match(
    workspace,
    /key=\{`\$\{siteId\}:\$\{authorizationEpoch\}:\$\{capabilityMountKey \|\| capabilityStatus\}`\}/,
  );
  assert.match(workspace, /principalKey|capabilityMountKey/);
  assert.doesNotMatch(workspace, /assets\/upload|businessPurpose/);
});
