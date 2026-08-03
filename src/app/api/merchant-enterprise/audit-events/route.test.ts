import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeMerchantEnterpriseAuditCursor,
  handleMerchantEnterpriseAuditEventsGet,
  parseMerchantEnterpriseAuditCursor,
  type MerchantEnterpriseAuditRouteDependencies,
} from "@/app/api/merchant-enterprise/audit-events/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseAuditEvent,
} from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

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

const employeeActor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Auditor",
  email: "auditor@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "audit.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

function auditEvent(
  overrides: Partial<MerchantEnterpriseAuditEvent> = {},
): MerchantEnterpriseAuditEvent {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    siteId: "10000000",
    eventType: "employee.renamed",
    entityType: "employee",
    entityId: "77777777-7777-4777-8777-777777777777",
    actorType: "owner",
    actorId: null,
    actorLabel: "企业负责人",
    targetLabel: "仓库员工",
    beforeData: { display_name: "旧名称" },
    afterData: { display_name: "新名称" },
    operationId: "",
    createdAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseAuditRouteDependencies> = {},
): MerchantEnterpriseAuditRouteDependencies {
  return {
    async resolveActor() {
      return ownerActor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadAuditEvents() {
      return { events: [], nextCursor: null };
    },
    ...overrides,
  };
}

test("audit cursor is opaque, canonical and round-trips its keyset", () => {
  const cursor = {
    beforeCreatedAt: "2026-08-02T12:00:00.000Z",
    beforeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const encoded = encodeMerchantEnterpriseAuditCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseMerchantEnterpriseAuditCursor(encoded), cursor);
  assert.throws(
    () => parseMerchantEnterpriseAuditCursor(`${encoded}=`),
    /invalid_enterprise_audit_cursor/,
  );
  assert.throws(
    () =>
      parseMerchantEnterpriseAuditCursor(
        Buffer.from(
          JSON.stringify(["2026-08-02T12:00:00+00:00", cursor.beforeId]),
        ).toString("base64url"),
      ),
    /invalid_enterprise_audit_cursor/,
  );
});

test("audit GET authorizes audit.view, checks entitlement and forwards bounded filters", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const nextCursor = {
    beforeCreatedAt: "2026-08-02T11:00:00.000Z",
    beforeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };
  const response = await handleMerchantEnterpriseAuditEventsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/audit-events?siteId=10000000&limit=25&entityType=employee&eventType=employee.renamed",
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return ownerActor;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async loadAuditEvents(input) {
        calls.push({ load: input });
        return { events: [auditEvent()], nextCursor };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.events[0].actorId, null);
  assert.deepEqual(parseMerchantEnterpriseAuditCursor(body.nextCursor), nextCursor);
  assert.deepEqual(calls[0], {
    resolve: { siteId: "10000000", requiredPermission: "audit.view" },
  });
  assert.deepEqual(calls[1], { entitlement: "10000000" });
  assert.deepEqual(calls[2], {
    load: {
      siteId: "10000000",
      actor: ownerActor,
      limit: 25,
      cursor: null,
      entityType: "employee",
      eventType: "employee.renamed",
    },
  });
});

test("audit GET uses the resolved employee identity and never accepts actor query fields", async () => {
  let loadedActor: MerchantEnterpriseActor | null = null;
  const allowed = await handleMerchantEnterpriseAuditEventsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/audit-events?siteId=10000000",
    ),
    dependencies({
      async resolveActor() {
        return employeeActor;
      },
      async loadAuditEvents(input) {
        loadedActor = input.actor;
        return { events: [], nextCursor: null };
      },
    }),
  );
  assert.equal(allowed.status, 200);
  assert.equal(loadedActor, employeeActor);

  let resolved = false;
  const forged = await handleMerchantEnterpriseAuditEventsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/audit-events?siteId=10000000&actorId=88888888-8888-4888-8888-888888888888",
    ),
    dependencies({
      async resolveActor() {
        resolved = true;
        return employeeActor;
      },
    }),
  );
  assert.equal(forged.status, 400);
  assert.equal(resolved, false);
});

test("audit GET rejects duplicate, oversized and inconsistent filters before auth", async () => {
  let resolved = false;
  const deps = dependencies({
    async resolveActor() {
      resolved = true;
      return ownerActor;
    },
  });
  for (const query of [
    "siteId=10000000&siteId=10000000",
    "siteId=10000000&limit=101",
    "siteId=10000000&entityType=unknown",
    "siteId=10000000&eventType=unknown",
    "siteId=10000000&entityType=employee&eventType=role.updated",
    "siteId=%2010000000",
  ]) {
    const response = await handleMerchantEnterpriseAuditEventsGet(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/audit-events?${query}`,
      ),
      deps,
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(resolved, false);
});

test("audit GET fails closed before loading when permission or entitlement is denied", async () => {
  let downstream = 0;
  const denied = await handleMerchantEnterpriseAuditEventsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/audit-events?siteId=10000000",
    ),
    dependencies({
      async resolveActor() {
        throw new MerchantEnterpriseAccessError("permission_denied", 403);
      },
      async requireEnterpriseEntitlement() {
        downstream += 1;
      },
      async loadAuditEvents() {
        downstream += 1;
        return { events: [], nextCursor: null };
      },
    }),
  );
  assert.equal(denied.status, 403);
  assert.equal(downstream, 0);

  const disabled = await handleMerchantEnterpriseAuditEventsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/audit-events?siteId=10000000",
    ),
    dependencies({
      async requireEnterpriseEntitlement() {
        throw new MerchantEnterpriseAccessError("enterprise_not_enabled", 403);
      },
      async loadAuditEvents() {
        downstream += 1;
        return { events: [], nextCursor: null };
      },
    }),
  );
  assert.equal(disabled.status, 403);
  assert.equal(downstream, 0);
});
