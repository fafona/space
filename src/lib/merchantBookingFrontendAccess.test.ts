import assert from "node:assert/strict";
import test from "node:test";

import {
  MERCHANT_BOOKING_OWNER_CACHE_POLICY,
  canManageMerchantBookingWorkbenchSection,
  canOpenMerchantBookingWorkbench,
  canOpenMerchantBookingWorkbenchView,
  createMerchantBookingEmployeeWorkbenchDraft,
  createMerchantBookingApiRequest,
  getMerchantBookingWorkbenchSectionFingerprint,
  getMerchantBookingWorkbenchSectionPermission,
  isMerchantBookingEmployeeFrontend,
} from "@/lib/merchantBookingFrontendAccess";
import { createDefaultMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbench";

test("owner defaults keep the existing booking cache and complete workbench", () => {
  assert.equal(MERCHANT_BOOKING_OWNER_CACHE_POLICY.allowPersistentRead, true);
  assert.equal(MERCHANT_BOOKING_OWNER_CACHE_POLICY.allowPersistentWrite, true);
  assert.equal(MERCHANT_BOOKING_OWNER_CACHE_POLICY.allowStaleOnError, true);
  assert.equal(canOpenMerchantBookingWorkbench(undefined), true);
  assert.equal(canOpenMerchantBookingWorkbenchView(undefined, "analysis"), true);
});

test("booking workbench sections map to independent permissions", () => {
  assert.equal(
    getMerchantBookingWorkbenchSectionPermission("settings"),
    "bookings.settings.manage",
  );
  assert.equal(
    getMerchantBookingWorkbenchSectionPermission("automation"),
    "bookings.automation.manage",
  );
  assert.equal(
    getMerchantBookingWorkbenchSectionPermission("calendar"),
    "bookings.calendar.manage",
  );
  assert.equal(
    canManageMerchantBookingWorkbenchSection(
      ["bookings.settings.manage"],
      "automation",
    ),
    false,
  );
});

test("booking workbench navigation exposes only granted groups", () => {
  assert.equal(
    canOpenMerchantBookingWorkbenchView(
      ["bookings.settings.manage"],
      "rules",
    ),
    true,
  );
  assert.equal(
    canOpenMerchantBookingWorkbenchView(
      ["bookings.settings.manage"],
      "reminders",
    ),
    false,
  );
  assert.equal(
    canOpenMerchantBookingWorkbenchView(
      ["bookings.calendar.manage"],
      "reminders",
    ),
    true,
  );
  assert.equal(
    canOpenMerchantBookingWorkbenchView(
      ["bookings.calendar.manage"],
      "analysis",
    ),
    false,
  );
});

test("section fingerprints do not make unrelated settings dirty", () => {
  const current = createDefaultMerchantBookingWorkbenchSettings();
  const settingsFingerprint = getMerchantBookingWorkbenchSectionFingerprint(
    current,
    "settings",
  );
  const automationFingerprint = getMerchantBookingWorkbenchSectionFingerprint(
    current,
    "automation",
  );
  const automationChanged = {
    ...current,
    noShowEnabled: true,
  };
  assert.equal(
    getMerchantBookingWorkbenchSectionFingerprint(
      automationChanged,
      "settings",
    ),
    settingsFingerprint,
  );
  assert.notEqual(
    getMerchantBookingWorkbenchSectionFingerprint(
      automationChanged,
      "automation",
    ),
    automationFingerprint,
  );
});

test("an injected booking client selects employee mode", () => {
  assert.equal(
    isMerchantBookingEmployeeFrontend({
      apiClient: async () => new Response(),
    }),
    true,
  );
});

test("employee workbench writes strip calendar bearer credentials", () => {
  const current = {
    ...createDefaultMerchantBookingWorkbenchSettings(),
    noShowEnabled: true,
    calendarSyncToken: "long-lived-secret",
    calendarSyncTokenUpdatedAt: "2026-08-28T12:00:00.000Z",
  };
  const safe = createMerchantBookingEmployeeWorkbenchDraft(current, [
    "bookings.calendar.manage",
  ]);
  assert.equal(safe.calendarSyncToken, "");
  assert.equal(
    safe.calendarSyncTokenUpdatedAt,
    "2026-08-28T12:00:00.000Z",
  );
  assert.equal(safe.dailyCutoffTime, current.dailyCutoffTime);
  assert.equal(safe.noShowEnabled, false);
  assert.equal(
    createMerchantBookingEmployeeWorkbenchDraft(current, [
      "bookings.automation.manage",
    ]).noShowEnabled,
    true,
  );
});

test("employee booking requests never fall back to owner cookies", async () => {
  let ownerCalls = 0;
  const request = createMerchantBookingApiRequest({
    employeeMode: true,
    ownerFetch: async () => {
      ownerCalls += 1;
      return new Response();
    },
  });
  await assert.rejects(
    request("/api/bookings"),
    /employee_booking_api_client_required/,
  );
  assert.equal(ownerCalls, 0);
});

test("employee booking requests use only the injected client", async () => {
  const calls: string[] = [];
  const request = createMerchantBookingApiRequest({
    employeeMode: true,
    apiClient: async (path) => {
      calls.push(path);
      return new Response("ok");
    },
    ownerFetch: async () => {
      throw new Error("owner fallback must not run");
    },
  });
  assert.equal(
    await (await request("/api/bookings?siteId=10000000")).text(),
    "ok",
  );
  assert.deepEqual(calls, ["/api/bookings?siteId=10000000"]);
});
