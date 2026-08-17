import assert from "node:assert/strict";
import test from "node:test";
import {
  MERCHANT_ORDER_EXPORT_MAX_BYTES,
  MERCHANT_ORDER_EXPORT_MAX_ORDERS,
  MerchantOrderExportError,
  buildMerchantOrdersCsvExport,
  escapeMerchantOrderCsvCell,
  normalizeMerchantOrderExportInput,
} from "@/lib/merchantOrderExport";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

const SITE_ID = "10000000";
const RANGE = {
  createdFrom: "2026-08-01T00:00:00.000Z",
  createdToExclusive: "2026-09-01T00:00:00.000Z",
};

function makeOrder(
  id: string,
  overrides: Partial<MerchantOrderRecord> = {},
): MerchantOrderRecord {
  return {
    id,
    siteId: SITE_ID,
    siteName: "Faolla",
    blockId: "products-1",
    clientRequestId: "internal-request-secret",
    customerAccountId: "internal-account-secret",
    customerUserId: "internal-user-secret",
    customerLoginEmail: "login-secret@example.com",
    customerGuestHash: "internal-guest-secret",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:30:00.000Z",
    merchantTouchedAt: "",
    status: "pending",
    customer: {
      name: "Customer One",
      phone: "+34 600 000 000",
      email: "customer@example.com",
      note: "Please call first",
    },
    items: [
      {
        productId: "internal-product-id",
        code: "SKU-001",
        name: "Product One",
        description: "description-not-exported",
        imageUrl: "https://example.com/private-image.jpg",
        tag: "Featured",
        quantity: 2,
        unitPrice: 12.5,
        unitPriceText: "€12.50",
        subtotal: 25,
      },
    ],
    totalQuantity: 2,
    totalAmount: 25,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

function readErrorCode(task: () => unknown) {
  try {
    task();
    return "";
  } catch (error) {
    assert.ok(error instanceof MerchantOrderExportError);
    return error.code;
  }
}

test("order export input requires a strict left-closed/right-open UTC range bounded to 366 days", () => {
  const normalized = normalizeMerchantOrderExportInput({
    createdFrom: "2024-01-01T00:00:00Z",
    createdToExclusive: "2025-01-01T00:00:00Z",
  });
  assert.equal(normalized.createdFrom, "2024-01-01T00:00:00.000Z");
  assert.equal(normalized.createdToExclusive, "2025-01-01T00:00:00.000Z");
  assert.deepEqual(normalized.statuses, ["pending", "confirmed", "completed", "cancelled"]);
  assert.equal(normalized.includeCustomerData, false);

  assert.equal(
    readErrorCode(() =>
      normalizeMerchantOrderExportInput({
        createdFrom: "2024-01-01T00:00:00.000Z",
        createdToExclusive: "2025-01-02T00:00:00.001Z",
      }),
    ),
    "order_export_range_too_large",
  );
  for (const input of [
    { createdFrom: "", createdToExclusive: RANGE.createdToExclusive },
    { createdFrom: "2026-08-01", createdToExclusive: RANGE.createdToExclusive },
    { createdFrom: RANGE.createdToExclusive, createdToExclusive: RANGE.createdFrom },
    { createdFrom: "2026-02-30T00:00:00.000Z", createdToExclusive: RANGE.createdToExclusive },
  ]) {
    assert.equal(
      readErrorCode(() => normalizeMerchantOrderExportInput(input)),
      "invalid_order_export_range",
    );
  }
});

test("order export validates status and customer-data options", () => {
  assert.deepEqual(
    normalizeMerchantOrderExportInput({
      ...RANGE,
      statuses: ["completed", "pending"],
      includeCustomerData: true,
    }).statuses,
    ["completed", "pending"],
  );
  for (const statuses of [[], ["paid"], ["pending", "pending"], "pending"]) {
    assert.equal(
      readErrorCode(() => normalizeMerchantOrderExportInput({ ...RANGE, statuses })),
      "invalid_order_export_statuses",
    );
  }
  assert.equal(
    readErrorCode(() =>
      normalizeMerchantOrderExportInput({ ...RANGE, includeCustomerData: "true" }),
    ),
    "invalid_order_export_include_customer_data",
  );
});

test("CSV cells remove NULs, quote values and neutralize spreadsheet formulas after leading whitespace", () => {
  assert.equal(escapeMerchantOrderCsvCell('safe, "quoted"'), '"safe, ""quoted"""');
  assert.equal(escapeMerchantOrderCsvCell("nul\0value"), '"nulvalue"');
  for (const value of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)", "  =cmd", "\tordinary", "\rordinary", "\nordinary"]) {
    const escaped = escapeMerchantOrderCsvCell(value);
    assert.ok(escaped.startsWith('"\''), `${JSON.stringify(value)} was not neutralized`);
  }
});

test("order summary CSV uses BOM and CRLF, filters exact boundaries and excludes PII by default", () => {
  const fromIncluded = makeOrder("O-FROM", { createdAt: RANGE.createdFrom });
  const inside = makeOrder("O-INSIDE", {
    createdAt: "2026-08-18T00:00:00.000Z",
    status: "completed",
    completedAt: "2026-08-18T01:00:00.000Z",
    pricePrefix: " =DANGEROUS_PREFIX",
  });
  const toExcluded = makeOrder("O-TO", { createdAt: RANGE.createdToExclusive });
  const statusExcluded = makeOrder("O-CANCELLED", {
    createdAt: "2026-08-19T00:00:00.000Z",
    status: "cancelled",
  });
  const result = buildMerchantOrdersCsvExport(
    [toExcluded, statusExcluded, fromIncluded, inside],
    { ...RANGE, statuses: ["pending", "completed"] },
  );

  assert.equal(result.orderCount, 2);
  assert.ok(result.csv.startsWith('\uFEFF"order_id","created_at_utc"'));
  assert.ok(result.csv.includes("\r\n"));
  assert.ok(result.csv.indexOf("O-INSIDE") < result.csv.indexOf("O-FROM"));
  assert.ok(!result.csv.includes("O-TO"));
  assert.ok(!result.csv.includes("O-CANCELLED"));
  assert.ok(result.csv.includes("SKU-001"));
  assert.ok(result.csv.includes("Product One"));
  assert.ok(!result.csv.includes("description-not-exported"));
  assert.ok(!result.csv.includes("private-image"));
  assert.ok(!result.csv.includes("Customer One"));
  assert.ok(!result.csv.includes("customer@example.com"));
  assert.ok(!result.csv.includes("internal-account-secret"));
  assert.ok(!result.csv.includes("internal-user-secret"));
  assert.ok(!result.csv.includes("login-secret@example.com"));
  assert.ok(!result.csv.includes("internal-guest-secret"));
  assert.ok(!result.csv.includes("internal-request-secret"));
  assert.ok(result.csv.includes('"\' =DANGEROUS_PREFIX"'));
  assert.equal(result.byteLength, new TextEncoder().encode(result.csv).byteLength);
});

test("order summary CSV includes only explicit customer snapshot fields when requested", () => {
  const order = makeOrder("O-PII", {
    customer: {
      name: "=FORMULA_NAME",
      phone: "+34600000000",
      email: "@customer.example",
      note: "  -FORMULA_NOTE\0",
    },
  });
  const result = buildMerchantOrdersCsvExport([order], {
    ...RANGE,
    includeCustomerData: true,
  });

  for (const header of ["customer_name", "customer_phone", "customer_email", "customer_note"]) {
    assert.ok(result.csv.includes(`"${header}"`));
  }
  assert.ok(result.csv.includes('"\'=FORMULA_NAME"'));
  assert.ok(result.csv.includes('"\'+34600000000"'));
  assert.ok(result.csv.includes('"\'@customer.example"'));
  assert.ok(result.csv.includes('"\'  -FORMULA_NOTE"'));
  assert.ok(!result.csv.includes("login-secret@example.com"));
  assert.ok(!result.csv.includes("\0"));
});

test("order export rejects more than 10000 matching orders before serialization", () => {
  const order = makeOrder("O-LIMIT");
  const orders = Array.from({ length: MERCHANT_ORDER_EXPORT_MAX_ORDERS + 1 }, () => order);
  assert.equal(
    readErrorCode(() => buildMerchantOrdersCsvExport(orders, RANGE)),
    "order_export_order_limit_exceeded",
  );
});

test("order export rejects CSV output larger than 25 MiB", () => {
  const order = makeOrder("O-BYTES", {
    items: [
      {
        ...makeOrder("O-SOURCE").items[0],
        name: "x".repeat(MERCHANT_ORDER_EXPORT_MAX_BYTES),
      },
    ],
  });
  assert.equal(
    readErrorCode(() => buildMerchantOrdersCsvExport([order], RANGE)),
    "order_export_size_limit_exceeded",
  );
});
