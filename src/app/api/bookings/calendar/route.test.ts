import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantBookingCalendarGet,
} from "@/app/api/bookings/calendar/route";
import {
  MerchantBusinessAccessError,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { createDefaultMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbench";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const ORIGIN = "https://launch.faolla.com";
const SITE_ID = "10000000";

function makeBooking(): MerchantBookingRecord {
  return {
    id: "B10000000202608280001",
    siteId: SITE_ID,
    siteName: "Untrusted Site private@example.com",
    bookingBlockId: "booking-1",
    bookingViewport: "desktop",
    store: "Main store",
    item: "Consultation",
    appointmentAt: "2026-09-10T10:30",
    title: "Ms",
    customerName: "Private Customer",
    email: "private@example.com",
    phone: "+34 600 000 000",
    note: "Private note",
    status: "active",
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function makeActor(
  permissions: MerchantStaffBusinessPermission[],
): MerchantBusinessActor {
  return {
    type: "employee",
    siteId: SITE_ID,
    authUserId: "auth-employee-1",
    employeeId: "employee-1",
    roleId: "role-1",
    employeeVersion: 2,
    roleVersion: 3,
    principalKey: "employee:employee-1",
    authorizationVersion: "2:3",
    displayName: "Employee",
    email: "employee@example.com",
    collaborationPermissions: [],
    businessPermissions: permissions,
  };
}

function request(query = `siteId=${SITE_ID}`) {
  return new Request(`${ORIGIN}/api/bookings/calendar?${query}`, {
    headers: { "x-merchant-access-token": "staff-token" },
  });
}

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("booking calendar rejects duplicate site selectors before any read", async () => {
  let settingsReads = 0;
  const response = await handleMerchantBookingCalendarGet(
    request(`siteId=${SITE_ID}&siteId=20000000`),
    {
      async loadSettings() {
        settingsReads += 1;
        return createDefaultMerchantBookingWorkbenchSettings();
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(settingsReads, 0);
  assertPrivateHeaders(response);
});

test("calendar bearer token remains supported but is never publicly cached", async () => {
  let authorizations = 0;
  const settings = {
    ...createDefaultMerchantBookingWorkbenchSettings(),
    calendarSyncToken: "0123456789abcdef0123456789abcdef0123",
  };
  const response = await handleMerchantBookingCalendarGet(
    request(`siteId=${SITE_ID}&token=${settings.calendarSyncToken}`),
    {
      async loadSettings() {
        return settings;
      },
      async authorizeActor() {
        authorizations += 1;
        return makeActor(["bookings.view", "bookings.export"]);
      },
      async listBookings() {
        return [makeBooking()];
      },
      async loadSnapshotSite() {
        return null;
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(authorizations, 0);
  const ics = await response.text();
  assert.ok(ics.includes("private@example.com"));
  assert.ok(!ics.includes("Untrusted Site private@example.com"));
  assertPrivateHeaders(response);
});

test("employee calendar export is server-redacted without customer-data permission", async () => {
  const actor = makeActor(["bookings.view", "bookings.export"]);
  const reauthorizationPermissions: string[][] = [];
  const response = await handleMerchantBookingCalendarGet(request(), {
    async loadSettings() {
      return createDefaultMerchantBookingWorkbenchSettings();
    },
    async authorizeActor(_request, input) {
      assert.equal(input.requiredPermission, "bookings.export");
      return actor;
    },
    async reauthorizeActor(_request, input) {
      reauthorizationPermissions.push([...input.requiredPermissions]);
      return actor;
    },
    async listBookings() {
      return [makeBooking()];
    },
    async loadSnapshotSite() {
      return null;
    },
  });
  assert.equal(response.status, 200);
  const ics = await response.text();
  assert.ok(!ics.includes("Private Customer"));
  assert.ok(!ics.includes("private@example.com"));
  assert.ok(!ics.includes("+34 600 000 000"));
  assert.ok(!ics.includes("Private note"));
  assert.deepEqual(reauthorizationPermissions, [["bookings.export"]]);
  assertPrivateHeaders(response);
});

test("customer-data calendar export reauthorizes both sensitive permissions", async () => {
  const actor = makeActor([
    "bookings.view",
    "bookings.customer_data.view",
    "bookings.export",
  ]);
  const reauthorizationPermissions: string[][] = [];
  const response = await handleMerchantBookingCalendarGet(request(), {
    async loadSettings() {
      return createDefaultMerchantBookingWorkbenchSettings();
    },
    async authorizeActor() {
      return actor;
    },
    async reauthorizeActor(_request, input) {
      reauthorizationPermissions.push([...input.requiredPermissions]);
      return actor;
    },
    async listBookings() {
      return [makeBooking()];
    },
    async loadSnapshotSite() {
      return null;
    },
  });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("private@example.com"));
  assert.deepEqual(reauthorizationPermissions, [
    ["bookings.export", "bookings.customer_data.view"],
  ]);
});

test("calendar authorization errors remain bounded and stop the booking read", async () => {
  let bookingReads = 0;
  const response = await handleMerchantBookingCalendarGet(request(), {
    async loadSettings() {
      return createDefaultMerchantBookingWorkbenchSettings();
    },
    async authorizeActor() {
      throw new MerchantBusinessAccessError("permission_denied", 403);
    },
    async listBookings() {
      bookingReads += 1;
      return [makeBooking()];
    },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
  assert.equal(bookingReads, 0);
  assertPrivateHeaders(response);
});
