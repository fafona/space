import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const memberManager = read(
  "src/components/admin/MerchantMemberManager.tsx",
);
const cashier = read(
  "src/components/admin/MerchantPointRedemptionCashier.tsx",
);
const settingsPanel = read(
  "src/components/admin/MerchantMembershipSettingsPanel.tsx",
);
const printPanel = read(
  "src/components/admin/MerchantPrintSettingsPanel.tsx",
);

test("member manager uses the injected business client and disables restricted caches", () => {
  assert.match(memberManager, /apiClient\?: MerchantBusinessApiClient/);
  assert.match(memberManager, /createMerchantMembershipApiRequest/);
  assert.match(
    memberManager,
    /employeeMode && permissions === undefined[\s\S]*MERCHANT_MEMBERSHIP_NO_PERMISSIONS/,
  );
  assert.match(
    memberManager,
    /force \|\| !effectiveCachePolicy\.allowPersistentRead/,
  );
  assert.match(
    memberManager,
    /requestMemberApi\(`\/api\/memberships\?/,
  );
  assert.match(memberManager, /"members\.customer_data\.view"/);
  assert.match(memberManager, /"members\.account\.view"/);
  assert.match(memberManager, /"members\.insights\.view"/);
  assert.match(memberManager, /"members\.allergens\.manage"/);
  assert.match(memberManager, /"redemptions\.checkout"/);
  assert.match(memberManager, /"redemptions\.recharge"/);
});

test("cashier closes credential, persistence, search and local-log fallback paths", () => {
  assert.match(cashier, /apiClient\?: MerchantBusinessApiClient/);
  assert.match(cashier, /requestRedemptionApi\("\/api\/memberships"/);
  assert.match(
    cashier,
    /requestRedemptionApi\(`\/api\/merchant-admin\/redemption-cashier\?/,
  );
  assert.match(
    cashier,
    /employeeMode \|\| !normalizedSiteId \|\| typeof window === "undefined"/,
  );
  assert.match(
    cashier,
    /if \(!employeeMode && typeof window !== "undefined"\)[\s\S]*localStorage\.setItem/,
  );
  assert.match(
    cashier,
    /if \(!employeeMode\) recordMerchantOperationLog/g,
  );
  assert.match(
    cashier,
    /employeeMode && !canSearchMemberDirectory/,
  );
  assert.match(cashier, /"redemptions\.recharge\.cancel"/);
  assert.match(cashier, /"members\.account\.adjust"/);
  assert.match(cashier, /"redemptions\.print"/);
  assert.match(
    cashier,
    /recordRedemptionReceiptPrintOutcome\([^;]+!employeeMode\)/,
  );
});

test("employee membership settings carry an exact scope and use the scoped catalog upload proxy", () => {
  assert.match(settingsPanel, /getMerchantMembershipSettingsFrontendScope/);
  assert.match(settingsPanel, /params\.set\("scope", employeeScope\)/);
  assert.match(
    settingsPanel,
    /\.\.\.\(employeeMode \? \{ scope: employeeScope \} : \{\}\)/,
  );
  assert.match(
    settingsPanel,
    /uploadImageDataUrlToSupabaseWithMetadata\(/,
  );
  assert.match(settingsPanel, /businessPurpose:\s*"redemption-catalog"/);
  assert.match(settingsPanel, /"product-image"/);
  assert.match(settingsPanel, /Boolean\(apiClient\)/);
  assert.match(settingsPanel, /"redemptions\.catalog\.manage"/);
  assert.match(
    settingsPanel,
    /disabled=\{itemImageUploading \|\| !canUploadRedemptionCatalogImage\}/,
  );
  assert.match(
    settingsPanel,
    /: await uploadDataUrlToPublicStorage\(uploadDataUrl/,
    "owner upload behavior must retain the legacy no-business-purpose path",
  );
  assert.match(
    settingsPanel,
    /if \(effectiveCachePolicy\.allowPersistentWrite\)/,
  );
});

test("print configuration is owner-only even when employees may print receipts", () => {
  assert.match(printPanel, /isMerchantMembershipEmployeeFrontend/);
  assert.match(printPanel, /if \(employeeMode\) return;/);
  assert.match(printPanel, /打印配置仅限负责人管理/);
  assert.match(printPanel, /if \(saving \|\| employeeMode\) return;/);
});
