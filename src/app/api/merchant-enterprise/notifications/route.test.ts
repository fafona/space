import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeMerchantEnterpriseNotificationCursor,
  handleMerchantEnterpriseNotificationsGet,
  handleMerchantEnterpriseNotificationsPatch,
  parseMerchantEnterpriseNotificationCursor,
  type MerchantEnterpriseNotificationRouteDependencies,
} from "@/app/api/merchant-enterprise/notifications/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseNotification,
} from "@/lib/merchantEnterprise";

const employeeActor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Staff",
  email: "staff@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "tasks.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const ownerActor: Extract<MerchantEnterpriseActor, { type: "owner" }> = {
  type: "owner",
  id: "88888888-8888-4888-8888-888888888888",
  siteId: "10000000",
  displayName: "Owner",
  email: "owner@example.com",
  permissions: [],
  accessScope: "all",
  allowedBoardIds: [],
};

function notification(
  overrides: Partial<MerchantEnterpriseNotification> = {},
): MerchantEnterpriseNotification {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    type: "task_commented",
    actorType: "owner",
    actorId: "88888888-8888-4888-8888-888888888888",
    payload: {},
    readAt: null,
    createdAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseNotificationRouteDependencies> = {},
): MerchantEnterpriseNotificationRouteDependencies {
  return {
    async resolveActor() {
      return employeeActor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadNotifications() {
      return { notifications: [], unreadCount: 0, nextCursor: null };
    },
    async markNotificationsRead() {
      return { markedCount: 0, unreadCount: 0 };
    },
    ...overrides,
  };
}

test("notification cursor is opaque, canonical and round-trips the keyset", () => {
  const cursor = {
    createdAt: "2026-08-02T12:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const encoded = encodeMerchantEnterpriseNotificationCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseMerchantEnterpriseNotificationCursor(encoded), cursor);
  assert.throws(
    () => parseMerchantEnterpriseNotificationCursor(`${encoded}=`),
    /invalid_notification_cursor/,
  );
  assert.throws(
    () =>
      parseMerchantEnterpriseNotificationCursor(
        Buffer.from(JSON.stringify([cursor.createdAt, "not-a-uuid"])).toString(
          "base64url",
        ),
      ),
    /invalid_notification_cursor/,
  );
});

test("employee notification GET uses its resolved identity, entitlement and bounded cursor", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const nextCursor = {
    createdAt: "2026-08-02T11:00:00.000Z",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };
  const response = await handleMerchantEnterpriseNotificationsGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/notifications?siteId=10000000&limit=25`,
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return employeeActor;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async loadNotifications(input) {
        calls.push({ load: input });
        return {
          notifications: [notification()],
          unreadCount: 4,
          nextCursor,
        };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.notifications[0].actorId, "");
  assert.equal(body.unreadCount, 4);
  assert.deepEqual(
    parseMerchantEnterpriseNotificationCursor(body.nextCursor),
    nextCursor,
  );
  assert.deepEqual(calls[0], {
    resolve: { siteId: "10000000", requiredPermission: "tasks.view" },
  });
  assert.deepEqual(calls[1], { entitlement: "10000000" });
  const load = calls[2]?.load as Record<string, unknown>;
  assert.equal(load.siteId, "10000000");
  assert.equal(load.actor, employeeActor);
  assert.equal(load.limit, 25);
  assert.equal(load.cursor, null);
});

test("owner notification GET is an empty inbox and never selects an arbitrary recipient", async () => {
  let loaded = false;
  const response = await handleMerchantEnterpriseNotificationsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/notifications?siteId=10000000",
    ),
    dependencies({
      async resolveActor() {
        return ownerActor;
      },
      async loadNotifications() {
        loaded = true;
        throw new Error("owner must not select an employee inbox");
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    notifications: [],
    unreadCount: 0,
    nextCursor: null,
  });
  assert.equal(loaded, false);
});

test("notification GET rejects unknown, duplicate and oversized query values before auth", async () => {
  let resolved = false;
  const deps = dependencies({
    async resolveActor() {
      resolved = true;
      return employeeActor;
    },
  });
  for (const query of [
    "siteId=10000000&recipientId=77777777-7777-4777-8777-777777777777",
    "siteId=10000000&siteId=10000000",
    "siteId=10000000&limit=51",
    "siteId=%2010000000",
  ]) {
    const response = await handleMerchantEnterpriseNotificationsGet(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/notifications?${query}`,
      ),
      deps,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(resolved, false);
});

test("notification PATCH marks only the resolved employee inbox", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseNotificationsPatch(
    new Request("https://www.faolla.com/api/merchant-enterprise/notifications", {
      method: "PATCH",
      headers: {
        origin: "https://www.faolla.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        siteId: "10000000",
        notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    }),
    dependencies({
      async markNotificationsRead(input) {
        calls.push(input);
        return { markedCount: 1, unreadCount: 2 };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    markedCount: 1,
    unreadCount: 2,
  });
  assert.equal(calls[0]?.siteId, "10000000");
  assert.equal(calls[0]?.actor, employeeActor);
  assert.equal(
    calls[0]?.notificationId,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal("recipientId" in calls[0]!, false);
});

test("notification PATCH rejects forged identity fields and cross-origin requests", async () => {
  let resolved = false;
  const deps = dependencies({
    async resolveActor() {
      resolved = true;
      return employeeActor;
    },
  });
  const forged = await handleMerchantEnterpriseNotificationsPatch(
    new Request("https://www.faolla.com/api/merchant-enterprise/notifications", {
      method: "PATCH",
      headers: {
        origin: "https://www.faolla.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        siteId: "10000000",
        all: true,
        recipientId: "66666666-6666-4666-8666-666666666666",
      }),
    }),
    deps,
  );
  assert.equal(forged.status, 400);
  assert.equal(resolved, false);

  const crossOrigin = await handleMerchantEnterpriseNotificationsPatch(
    new Request("https://www.faolla.com/api/merchant-enterprise/notifications", {
      method: "PATCH",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ siteId: "10000000", all: true }),
    }),
    deps,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, "forbidden_origin");
  assert.equal(resolved, false);
});
