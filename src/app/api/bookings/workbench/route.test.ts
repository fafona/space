import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantBookingWorkbenchGet,
  handleMerchantBookingWorkbenchPatch,
  type MerchantBookingWorkbenchRouteDependencies,
} from "@/app/api/bookings/workbench/route";
import {
  MerchantBusinessAccessError,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { getMerchantBookingAutomationRuntimeSnapshot } from "@/lib/merchantBookingAutomationRuntime";
import {
  createDefaultMerchantBookingWorkbenchSettings,
  type MerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbench";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const ORIGIN = "https://launch.faolla.com";
const SITE_ID = "10000000";

function makeSettings(): MerchantBookingWorkbenchSettings {
  return {
    ...createDefaultMerchantBookingWorkbenchSettings(),
    minAdvanceMinutes: 30,
    bufferMinutes: 15,
    customerEmailSenderName: "Private Sender",
    merchantReminderOffsetsMinutes: [120],
    calendarSyncToken: "private-calendar-token",
    calendarSyncTokenUpdatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function makeEmployee(
  permissions: MerchantStaffBusinessPermission[],
): MerchantBusinessActor {
  return {
    type: "employee",
    siteId: SITE_ID,
    authUserId: "auth-employee-1",
    employeeId: "employee-1",
    roleId: "role-1",
    employeeVersion: 4,
    roleVersion: 5,
    principalKey: "employee:employee-1",
    authorizationVersion: "4:5",
    displayName: "Employee",
    email: "employee@example.com",
    collaborationPermissions: [],
    businessPermissions: permissions,
  };
}

function getRequest(query = `siteId=${SITE_ID}`) {
  return new Request(`${ORIGIN}/api/bookings/workbench?${query}`, {
    headers: { "x-merchant-access-token": "staff-token" },
  });
}

function patchRequest(body: unknown, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/bookings/workbench`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin,
      "x-merchant-access-token": "staff-token",
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

function readJsonRecord(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("workbench GET rejects duplicate site selectors before authorization", async () => {
  let authorizations = 0;
  const response = await handleMerchantBookingWorkbenchGet(
    getRequest(`siteId=${SITE_ID}&siteId=20000000`),
    {
      async authorizeActor() {
        authorizations += 1;
        return makeEmployee(["bookings.view"]);
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(authorizations, 0);
  assertPrivateHeaders(response);
});

test("workbench GET projects settings, dashboard, and secrets by permission", async () => {
  const actor = makeEmployee(["bookings.view", "bookings.settings.manage"]);
  const response = await handleMerchantBookingWorkbenchGet(getRequest(), {
    async authorizeActor(_request, input) {
      assert.equal(input.requiredPermission, "bookings.view");
      return actor;
    },
    async loadSettings() {
      return makeSettings();
    },
    async buildDashboard() {
      return {
        pushDeviceCount: 7,
        automation: getMerchantBookingAutomationRuntimeSnapshot(),
      };
    },
  });
  assert.equal(response.status, 200);
  const json = await readJsonRecord(response);
  const settings = json.settings as Record<string, unknown>;
  assert.equal(settings.minAdvanceMinutes, 30);
  assert.equal(settings.bufferMinutes, 15);
  assert.ok(!("customerEmailSenderName" in settings));
  assert.ok(!("calendarSyncToken" in settings));
  assert.deepEqual(json.dashboard, {});
  assert.deepEqual(json.capabilities, {
    settings: true,
    automation: false,
    calendar: false,
    analytics: false,
  });
  assertPrivateHeaders(response);
});

test("workbench GET reveals granted automation and analytics but never an employee calendar bearer token", async () => {
  const actor = makeEmployee([
    "bookings.view",
    "bookings.automation.manage",
    "bookings.calendar.manage",
    "bookings.analytics.view",
  ]);
  const runtime = getMerchantBookingAutomationRuntimeSnapshot();
  const response = await handleMerchantBookingWorkbenchGet(getRequest(), {
    async authorizeActor() {
      return actor;
    },
    async loadSettings() {
      return makeSettings();
    },
    async buildDashboard() {
      return { pushDeviceCount: 7, automation: runtime };
    },
  });
  assert.equal(response.status, 200);
  const json = await readJsonRecord(response);
  const settings = json.settings as Record<string, unknown>;
  assert.equal(settings.customerEmailSenderName, "Private Sender");
  assert.equal(settings.calendarSyncEnabled, true);
  assert.equal(
    settings.calendarSyncTokenUpdatedAt,
    "2026-08-28T10:00:00.000Z",
  );
  assert.ok(!("calendarSyncToken" in settings));
  assert.deepEqual(json.dashboard, {
    pushDeviceCount: 7,
    automation: runtime,
  });
});

test("owner workbench remains compatible and can read its calendar bearer token", async () => {
  const employee = makeEmployee([]);
  const owner: MerchantBusinessActor = {
    type: "owner",
    siteId: SITE_ID,
    authUserId: "owner-auth-1",
    principalKey: "owner:owner-auth-1",
    authorizationVersion: "owner",
    displayName: "Owner",
    email: "owner@example.com",
    authorizationSource: "database",
    collaborationPermissions: [],
    businessPermissions: employee.businessPermissions,
  };
  const response = await handleMerchantBookingWorkbenchGet(getRequest(), {
    async authorizeActor() {
      return owner;
    },
    async loadSettings() {
      return makeSettings();
    },
    async buildDashboard() {
      return {
        pushDeviceCount: 0,
        automation: getMerchantBookingAutomationRuntimeSnapshot(),
      };
    },
  });
  assert.equal(response.status, 200);
  const json = await readJsonRecord(response);
  const settings = json.settings as Record<string, unknown>;
  assert.equal(settings.calendarSyncToken, "private-calendar-token");
});

test("employee workbench writes require one explicit section", async () => {
  const actor = makeEmployee(["bookings.view"]);
  const response = await handleMerchantBookingWorkbenchPatch(
    patchRequest({ siteId: SITE_ID, settings: makeSettings() }),
    {
      async authorizeActor(_request, input) {
        assert.equal(input.requiredPermission, "bookings.view");
        return actor;
      },
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "booking_workbench_section_required",
  });
  assertPrivateHeaders(response);
});

test("settings section preserves automation and calendar values and reauthorizes inside the update", async () => {
  const actor = makeEmployee([
    "bookings.view",
    "bookings.settings.manage",
  ]);
  const current = makeSettings();
  const proposed = {
    ...current,
    minAdvanceMinutes: 90,
    customerEmailSenderName: "ATTACKER CHANGE",
    calendarSyncToken: "ATTACKER TOKEN",
  };
  const events: string[] = [];
  const savedValues: MerchantBookingWorkbenchSettings[] = [];
  const dependencies: Partial<MerchantBookingWorkbenchRouteDependencies> = {
    async authorizeActor(_request, input) {
      assert.equal(input.requiredPermission, "bookings.settings.manage");
      return actor;
    },
    async reauthorizeActor(_request, input) {
      events.push("reauthorize");
      assert.deepEqual(input.requiredPermissions, ["bookings.settings.manage"]);
      return actor;
    },
    async loadSnapshotSite() {
      return null;
    },
    async updateSettings(_siteId, input) {
      events.push("lock-enter");
      await input.assertAuthorizationCurrent?.();
      events.push("apply");
      const saved = input.update(current);
      savedValues.push(saved);
      return saved;
    },
  };
  const response = await handleMerchantBookingWorkbenchPatch(
    patchRequest({
      siteId: SITE_ID,
      section: "settings",
      settings: proposed,
    }),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(events, ["lock-enter", "reauthorize", "apply"]);
  assert.equal(savedValues[0]?.minAdvanceMinutes, 90);
  assert.equal(savedValues[0]?.customerEmailSenderName, "Private Sender");
  assert.equal(savedValues[0]?.calendarSyncToken, "private-calendar-token");
  assertPrivateHeaders(response);
});

test("employee calendar rotation never returns the newly generated bearer token", async () => {
  const actor = makeEmployee([
    "bookings.view",
    "bookings.calendar.manage",
  ]);
  const response = await handleMerchantBookingWorkbenchPatch(
    patchRequest({
      siteId: SITE_ID,
      section: "calendar",
      calendarSyncAction: "reset",
      settings: makeSettings(),
    }),
    {
      async authorizeActor() {
        return actor;
      },
      async reauthorizeActor() {
        return actor;
      },
      async loadSnapshotSite() {
        return null;
      },
      async updateSettings(_siteId, input) {
        await input.assertAuthorizationCurrent?.();
        return input.update(makeSettings());
      },
    },
  );
  assert.equal(response.status, 200);
  const json = await readJsonRecord(response);
  const settings = json.settings as Record<string, unknown>;
  assert.equal(settings.calendarSyncEnabled, true);
  assert.ok(!("calendarSyncToken" in settings));
  assertPrivateHeaders(response);
});

test("workbench revocation inside the update prevents settings application", async () => {
  const actor = makeEmployee([
    "bookings.view",
    "bookings.automation.manage",
  ]);
  let applied = false;
  const response = await handleMerchantBookingWorkbenchPatch(
    patchRequest({
      siteId: SITE_ID,
      section: "automation",
      settings: makeSettings(),
    }),
    {
      async authorizeActor() {
        return actor;
      },
      async reauthorizeActor() {
        throw new MerchantBusinessAccessError("permission_denied", 403);
      },
      async loadSnapshotSite() {
        return null;
      },
      async updateSettings(_siteId, input) {
        await input.assertAuthorizationCurrent?.();
        applied = true;
        return input.update(makeSettings());
      },
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
  assert.equal(applied, false);
  assertPrivateHeaders(response);
});

test("workbench PATCH rejects cross-origin requests before authorization", async () => {
  let authorizations = 0;
  const response = await handleMerchantBookingWorkbenchPatch(
    patchRequest(
      { siteId: SITE_ID, section: "settings", settings: makeSettings() },
      "https://attacker.example",
    ),
    {
      async authorizeActor() {
        authorizations += 1;
        return makeEmployee(["bookings.view", "bookings.settings.manage"]);
      },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(authorizations, 0);
  assertPrivateHeaders(response);
});
