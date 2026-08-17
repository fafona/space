import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantOrderExportPost,
  type MerchantOrderExportAuditMetadata,
  type MerchantOrderExportRouteDependencies,
} from "@/app/api/orders/export/route";
import { MerchantOrderExportError } from "@/lib/merchantOrderExport";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

const ORIGIN = "https://merchant.faolla.test";
const SITE_ID = "10000000";
const VALID_BODY = {
  siteId: SITE_ID,
  createdFrom: "2026-08-01T00:00:00.000Z",
  createdToExclusive: "2026-09-01T00:00:00.000Z",
  statuses: ["pending", "confirmed", "completed", "cancelled"],
};

function makeOrder(id = "O10000000202608170001"): MerchantOrderRecord {
  return {
    id,
    siteId: SITE_ID,
    siteName: "Faolla",
    blockId: "products-1",
    clientRequestId: "never-export-client-request",
    customerAccountId: "never-export-account",
    customerUserId: "never-export-user",
    customerLoginEmail: "never-export-login@example.com",
    customerGuestHash: "never-export-guest-hash",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    merchantTouchedAt: "",
    status: "pending",
    customer: {
      name: "Private Customer",
      phone: "+34 600 000 000",
      email: "private@example.com",
      note: "Private note",
    },
    items: [
      {
        productId: "product-1",
        code: "SKU-001",
        name: "Product One",
        description: "",
        imageUrl: "",
        tag: "",
        quantity: 1,
        unitPrice: 12.5,
        unitPriceText: "€12.50",
        subtotal: 12.5,
      },
    ],
    totalQuantity: 1,
    totalAmount: 12.5,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
  };
}

function buildRequest(
  body: unknown = VALID_BODY,
  options: { origin?: string | null; rawBody?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  return new Request(`${ORIGIN}/api/orders/export`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function createDependencies(input: {
  orders?: MerchantOrderRecord[];
  sessionMerchantId?: string | null;
  managementEnabled?: boolean;
  auditError?: Error | null;
} = {}) {
  const calls = {
    sessions: 0,
    management: 0,
    lists: 0,
    audits: [] as MerchantOrderExportAuditMetadata[],
  };
  const dependencies: Partial<MerchantOrderExportRouteDependencies> = {
    async resolveSession(_request, siteId) {
      calls.sessions += 1;
      assert.equal(siteId, SITE_ID);
      return input.sessionMerchantId === null
        ? null
        : { merchantId: input.sessionMerchantId ?? SITE_ID };
    },
    async isManagementEnabled(siteId) {
      calls.management += 1;
      assert.equal(siteId, SITE_ID);
      return input.managementEnabled ?? true;
    },
    async listOrders(siteId) {
      calls.lists += 1;
      assert.equal(siteId, SITE_ID);
      return input.orders ?? [makeOrder()];
    },
    async recordAudit(metadata) {
      calls.audits.push(metadata);
      if (input.auditError) throw input.auditError;
    },
  };
  return { calls, dependencies };
}

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("order export rejects cross-origin POST before authentication or canonical reads", async () => {
  const harness = createDependencies();
  const response = await handleMerchantOrderExportPost(
    buildRequest(VALID_BODY, { origin: "https://attacker.example" }),
    harness.dependencies,
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "forbidden_origin");
  assert.deepEqual(harness.calls, { sessions: 0, management: 0, lists: 0, audits: [] });
  assertPrivateHeaders(response);
});

test("order export requires an exact merchant session and enabled order management", async () => {
  const wrongMerchant = createDependencies({ sessionMerchantId: "20000000" });
  const unauthorized = await handleMerchantOrderExportPost(buildRequest(), wrongMerchant.dependencies);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });
  assert.equal(wrongMerchant.calls.management, 0);
  assert.equal(wrongMerchant.calls.lists, 0);

  const disabled = createDependencies({ managementEnabled: false });
  const forbidden = await handleMerchantOrderExportPost(buildRequest(), disabled.dependencies);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: "order_management_disabled" });
  assert.equal(disabled.calls.lists, 0);
  assertPrivateHeaders(forbidden);
});

test("order export contains authentication and permission read failures behind private 503 responses", async () => {
  for (const failure of ["session", "management"] as const) {
    const harness = createDependencies();
    const response = await handleMerchantOrderExportPost(buildRequest(), {
      ...harness.dependencies,
      ...(failure === "session"
        ? {
            async resolveSession() {
              throw new Error("auth infrastructure detail");
            },
          }
        : {
            async isManagementEnabled() {
              throw new Error("permission infrastructure detail");
            },
          }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "order_export_failed" });
    assert.equal(harness.calls.lists, 0);
    assert.equal(harness.calls.audits.length, 0);
    assertPrivateHeaders(response);
  }
});

test("order export validates JSON and the UTC range before loading canonical orders", async () => {
  const malformedHarness = createDependencies();
  const malformed = await handleMerchantOrderExportPost(
    buildRequest(null, { rawBody: "{" }),
    malformedHarness.dependencies,
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_order_export_request" });
  assert.equal(malformedHarness.calls.sessions, 0);

  const rangeHarness = createDependencies();
  const invalidRange = await handleMerchantOrderExportPost(
    buildRequest({ ...VALID_BODY, createdToExclusive: VALID_BODY.createdFrom }),
    rangeHarness.dependencies,
  );
  assert.equal(invalidRange.status, 400);
  assert.deepEqual(await invalidRange.json(), { error: "invalid_order_export_range" });
  assert.equal(rangeHarness.calls.sessions, 1);
  assert.equal(rangeHarness.calls.management, 1);
  assert.equal(rangeHarness.calls.lists, 0);
});

test("order export reads the canonical order set exactly once and returns a safe CSV response", async () => {
  const orders = Array.from({ length: 1001 }, (_, index) =>
    makeOrder(`O1000000020260817${String(index).padStart(4, "0")}`),
  );
  const harness = createDependencies({ orders });
  const response = await handleMerchantOrderExportPost(buildRequest(), harness.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv;charset=utf-8");
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^attachment; filename="orders-10000000-20260801-20260901\.csv"$/,
  );
  assertPrivateHeaders(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder("utf-8").decode(bytes);
  assert.ok(csv.startsWith('"order_id"'));
  assert.ok(csv.includes("O10000000202608171000"));
  assert.ok(!csv.includes("Private Customer"));
  assert.ok(!csv.includes("private@example.com"));
  assert.ok(!csv.includes("never-export-account"));
  assert.equal(Number(response.headers.get("content-length")), bytes.byteLength);
  assert.equal(harness.calls.lists, 1);
  assert.equal(harness.calls.audits.length, 1);
  assert.deepEqual(harness.calls.audits[0], {
    siteId: SITE_ID,
    createdFrom: VALID_BODY.createdFrom,
    createdToExclusive: VALID_BODY.createdToExclusive,
    statuses: VALID_BODY.statuses,
    includeCustomerData: false,
    orderCount: 1001,
    byteLength: bytes.byteLength,
  });
});

test("order export includes customer snapshot columns only after explicit opt-in", async () => {
  const harness = createDependencies();
  const response = await handleMerchantOrderExportPost(
    buildRequest({ ...VALID_BODY, includeCustomerData: true }),
    harness.dependencies,
  );
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes('"customer_name"'));
  assert.ok(csv.includes("Private Customer"));
  assert.ok(csv.includes("private@example.com"));
  assert.ok(!csv.includes("never-export-login@example.com"));
  assert.equal(harness.calls.audits[0]?.includeCustomerData, true);
});

test("order export returns a valid header-only CSV and audits zero matching orders", async () => {
  const harness = createDependencies({ orders: [] });
  const response = await handleMerchantOrderExportPost(buildRequest(), harness.dependencies);
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder("utf-8").decode(bytes);
  assert.ok(csv.startsWith('"order_id","created_at_utc"'));
  assert.ok(!csv.includes("\r\n"));
  assert.equal(harness.calls.lists, 1);
  assert.equal(harness.calls.audits[0]?.orderCount, 0);
  assert.equal(harness.calls.audits[0]?.byteLength, bytes.byteLength);
  assertPrivateHeaders(response);
});

test("order export returns 413 for pre-response hard limits and does not audit a failed file", async () => {
  for (const code of ["order_export_order_limit_exceeded", "order_export_size_limit_exceeded"] as const) {
    const harness = createDependencies();
    const response = await handleMerchantOrderExportPost(buildRequest(), {
      ...harness.dependencies,
      buildExport() {
        throw new MerchantOrderExportError(code);
      },
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(harness.calls.lists, 1);
    assert.equal(harness.calls.audits.length, 0);
    assertPrivateHeaders(response);
  }
});

test("order export audit failure does not block the generated download", async () => {
  const harness = createDependencies({ auditError: new Error("audit unavailable") });
  const response = await handleMerchantOrderExportPost(buildRequest(), harness.dependencies);
  assert.equal(response.status, 200);
  assert.equal(harness.calls.audits.length, 1);
  assert.ok((await response.text()).includes("O10000000202608170001"));
});

test("order export canonical read failure is private and returns 503", async () => {
  const harness = createDependencies();
  const response = await handleMerchantOrderExportPost(buildRequest(), {
    ...harness.dependencies,
    async listOrders() {
      harness.calls.lists += 1;
      throw new Error("database detail must not leak");
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "order_export_failed" });
  assert.equal(harness.calls.audits.length, 0);
  assertPrivateHeaders(response);
});
