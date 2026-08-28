import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerSource = readFileSync(
  new URL("../src/components/admin/MerchantBookingManagerDialog.tsx", import.meta.url),
  "utf8",
);
const workbenchSource = readFileSync(
  new URL("../src/components/admin/BookingWorkbenchDialog.tsx", import.meta.url),
  "utf8",
);
const preferenceSource = readFileSync(
  new URL("../src/lib/useMerchantManagerPreferences.ts", import.meta.url),
  "utf8",
);

test("booking manager exposes an injected fail-closed employee contract", () => {
  assert.match(managerSource, /apiClient\?: MerchantBusinessApiClient/);
  assert.match(managerSource, /cachePolicy\?: MerchantBusinessCachePolicy/);
  assert.match(managerSource, /permissions\?: MerchantBookingFrontendPermissions/);
  assert.match(managerSource, /createMerchantBookingApiRequest\(\{/);
  assert.match(managerSource, /employeeMode\s*\?\s*MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY/);
  assert.doesNotMatch(managerSource, /await\s+fetchWithAdminPerformance\s*\(/);
  assert.doesNotMatch(managerSource, /await\s+fetch\s*\(/);
});

test("employee booking records disable cache and stale-on-error", () => {
  assert.match(
    managerSource,
    /effectiveCachePolicy\.allowPersistentRead\s*\?\s*readCachedBookingRecords/,
  );
  assert.match(
    managerSource,
    /if \(effectiveCachePolicy\.allowPersistentWrite\) \{\s*writeCachedBookingRecords/,
  );
  assert.match(
    managerSource,
    /effectiveCachePolicy\.allowStaleOnError && cachedRecords\.length > 0/,
  );
  assert.match(
    managerSource,
    /useMerchantBookingManagerPreferences\(siteId, \{\s*cachePolicy: effectiveCachePolicy/,
  );
  assert.match(
    preferenceSource,
    /if \(!normalizedSiteId \|\| !persistenceEnabled\) \{/,
  );
  assert.match(
    preferenceSource,
    /cancelPendingRemotePreferenceWrite\(normalizedSiteId, kind\)/,
  );
});

test("booking actions and sensitive fields are gated by granular permissions", () => {
  for (const permission of [
    "bookings.view",
    "bookings.customer_data.view",
    "bookings.update",
    "bookings.status.manage",
    "bookings.email.send",
    "bookings.export",
  ]) {
    assert.ok(managerSource.includes(`"${permission}"`), permission);
  }
  assert.match(managerSource, /if \(payload\.status && !canManageBookingStatus\)/);
  assert.match(managerSource, /if \(payload\.updates && !canUpdateBookings\)/);
  assert.match(managerSource, /if \(!canManageBookingStatus\) return null;/);
  assert.match(managerSource, /record\.email && canSendBookingEmail/);
  assert.match(managerSource, /canExportBookings \? \(/);
  assert.match(managerSource, /canViewCustomerData && record\.note/);
});

test("workbench requests use the injected client and every PATCH names a section", () => {
  assert.match(workbenchSource, /createMerchantBookingApiRequest\(\{/);
  assert.doesNotMatch(workbenchSource, /await\s+fetch\s*\(/);
  assert.match(
    workbenchSource,
    /requestWorkbenchApi\("\/api\/bookings\/workbench", \{/,
  );
  assert.match(workbenchSource, /if \(!section\) \{/);
  assert.match(
    workbenchSource,
    /body: JSON\.stringify\(\{\s*siteId,\s*section,\s*settings:/,
  );
  assert.match(workbenchSource, /section: changedSection/);
  assert.match(workbenchSource, /section: "calendar"/);
});

test("workbench fields and navigation follow independent permissions", () => {
  for (const gate of [
    "canViewAnalytics",
    "canManageSettings",
    "canManageAutomation",
    "canManageCalendar",
  ]) {
    assert.ok(workbenchSource.includes(`${gate} ? (`), gate);
  }
  assert.match(
    workbenchSource,
    /canOpenMerchantBookingWorkbenchView\(effectivePermissions, item\.key\)/,
  );
  assert.match(
    workbenchSource,
    /canManageMerchantBookingWorkbenchSection\(\s*effectivePermissions,\s*section/,
  );
});

test("employee calendar management never exposes or constructs a bearer token URL", () => {
  assert.match(
    workbenchSource,
    /const ownerCalendarSyncToken = employeeMode \? "" : draft\.calendarSyncToken/,
  );
  assert.ok(
    workbenchSource.match(/createMerchantBookingEmployeeWorkbenchDraft\(/g)?.length >= 3,
  );
  assert.match(workbenchSource, /employeeCalendarSyncEnabled/);
  assert.match(
    workbenchSource,
    /employeeMode\s*\?\s*createMerchantBookingEmployeeWorkbenchDraft\(\s*sourceDraft,\s*effectivePermissions,\s*\)\s*:\s*sourceDraft/,
  );
  assert.match(workbenchSource, /!employeeMode && calendarSyncUrl/);
  assert.match(workbenchSource, /if \(employeeMode \|\| typeof window === "undefined"\) return ""/);
  assert.match(workbenchSource, /员工可查看启用状态、重置或停用同步，但不会读取或显示长期订阅凭证/);
});
