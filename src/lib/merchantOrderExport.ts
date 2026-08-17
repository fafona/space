import {
  MERCHANT_ORDER_STATUSES,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";

export const MERCHANT_ORDER_EXPORT_MAX_RANGE_DAYS = 366;
export const MERCHANT_ORDER_EXPORT_MAX_ORDERS = 10_000;
export const MERCHANT_ORDER_EXPORT_MAX_BYTES = 25 * 1024 * 1024;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const CSV_BOM = "\uFEFF";
const CSV_ROW_SEPARATOR = "\r\n";

const BASE_HEADERS = [
  "order_id",
  "created_at_utc",
  "updated_at_utc",
  "status_code",
  "status_label",
  "confirmed_at_utc",
  "completed_at_utc",
  "cancelled_at_utc",
  "price_prefix",
  "total_quantity",
  "total_amount",
  "item_count",
  "items_summary",
] as const;

const CUSTOMER_HEADERS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "customer_note",
] as const;

export type MerchantOrderExportInput = {
  createdFrom: unknown;
  createdToExclusive: unknown;
  statuses?: unknown;
  includeCustomerData?: unknown;
};

export type NormalizedMerchantOrderExportInput = {
  createdFrom: string;
  createdFromMs: number;
  createdToExclusive: string;
  createdToExclusiveMs: number;
  statuses: MerchantOrderStatus[];
  includeCustomerData: boolean;
};

export type MerchantOrderCsvExport = {
  csv: string;
  byteLength: number;
  orderCount: number;
  input: NormalizedMerchantOrderExportInput;
};

export type MerchantOrderExportErrorCode =
  | "invalid_order_export_range"
  | "order_export_range_too_large"
  | "invalid_order_export_statuses"
  | "invalid_order_export_include_customer_data"
  | "order_export_order_limit_exceeded"
  | "order_export_size_limit_exceeded";

export class MerchantOrderExportError extends Error {
  readonly code: MerchantOrderExportErrorCode;

  constructor(code: MerchantOrderExportErrorCode) {
    super(code);
    this.name = "MerchantOrderExportError";
    this.code = code;
  }
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStrictUtcIso(value: unknown) {
  const text = trimText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) {
    return null;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed).toISOString();
  if (text !== normalized && text !== normalized.replace(".000Z", "Z")) return null;
  return { text: normalized, parsed };
}

function normalizeStatuses(value: unknown): MerchantOrderStatus[] {
  if (value === undefined) return [...MERCHANT_ORDER_STATUSES];
  if (!Array.isArray(value) || value.length === 0 || value.length > MERCHANT_ORDER_STATUSES.length) {
    throw new MerchantOrderExportError("invalid_order_export_statuses");
  }
  const statuses = [
    ...new Set(
      value.map((item) => trimText(item)).filter((item): item is MerchantOrderStatus =>
        MERCHANT_ORDER_STATUSES.includes(item as MerchantOrderStatus),
      ),
    ),
  ];
  if (statuses.length !== value.length) {
    throw new MerchantOrderExportError("invalid_order_export_statuses");
  }
  return statuses;
}

export function normalizeMerchantOrderExportInput(
  input: MerchantOrderExportInput,
): NormalizedMerchantOrderExportInput {
  const from = parseStrictUtcIso(input.createdFrom);
  const toExclusive = parseStrictUtcIso(input.createdToExclusive);
  if (!from || !toExclusive || from.parsed >= toExclusive.parsed) {
    throw new MerchantOrderExportError("invalid_order_export_range");
  }
  if (toExclusive.parsed - from.parsed > MERCHANT_ORDER_EXPORT_MAX_RANGE_DAYS * MILLISECONDS_PER_DAY) {
    throw new MerchantOrderExportError("order_export_range_too_large");
  }
  if (input.includeCustomerData !== undefined && typeof input.includeCustomerData !== "boolean") {
    throw new MerchantOrderExportError("invalid_order_export_include_customer_data");
  }
  return {
    createdFrom: from.text,
    createdFromMs: from.parsed,
    createdToExclusive: toExclusive.text,
    createdToExclusiveMs: toExclusive.parsed,
    statuses: normalizeStatuses(input.statuses),
    includeCustomerData: input.includeCustomerData === true,
  };
}

function removeNullCharacters(value: unknown) {
  return String(value ?? "").replaceAll("\0", "");
}

function neutralizeSpreadsheetFormula(value: string) {
  const firstNonWhitespace = value.match(/\S/u)?.[0] ?? "";
  if (/^[\t\r\n]/u.test(value) || /^[=+\-@]$/u.test(firstNonWhitespace)) {
    return `'${value}`;
  }
  return value;
}

export function escapeMerchantOrderCsvCell(value: unknown) {
  const normalizedValue = removeNullCharacters(value).replace(/\r\n|\r|\n/g, CSV_ROW_SEPARATOR);
  const safeValue = neutralizeSpreadsheetFormula(normalizedValue);
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function formatUtcTimestamp(value: unknown) {
  const text = trimText(value);
  const parsed = Date.parse(text);
  return text && Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function formatNonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? String(Math.max(0, Math.floor(parsed))) : "0";
}

function formatMoney(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(parsed) ? Math.max(0, parsed) : 0).toFixed(2);
}

function getStatusLabel(status: MerchantOrderStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

function buildItemsSummary(order: MerchantOrderRecord) {
  return order.items
    .map((item, index) => {
      const parts = [
        `商品${index + 1}`,
        item.code ? `编码:${removeNullCharacters(item.code)}` : "",
        `名称:${removeNullCharacters(item.name) || "未命名商品"}`,
        item.tag ? `分类:${removeNullCharacters(item.tag)}` : "",
        `数量:${formatNonNegativeInteger(item.quantity)}`,
        `单价:${formatMoney(item.unitPrice)}`,
        `小计:${formatMoney(item.subtotal)}`,
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

function buildOrderRow(order: MerchantOrderRecord, includeCustomerData: boolean) {
  const row: unknown[] = [
    order.id,
    formatUtcTimestamp(order.createdAt),
    formatUtcTimestamp(order.updatedAt),
    order.status,
    getStatusLabel(order.status),
    formatUtcTimestamp(order.confirmedAt),
    formatUtcTimestamp(order.completedAt),
    formatUtcTimestamp(order.cancelledAt),
    order.pricePrefix,
    formatNonNegativeInteger(order.totalQuantity),
    formatMoney(order.totalAmount),
    formatNonNegativeInteger(order.items.length),
    buildItemsSummary(order),
  ];
  if (includeCustomerData) {
    row.push(order.customer.name, order.customer.phone, order.customer.email, order.customer.note);
  }
  return row.map(escapeMerchantOrderCsvCell).join(",");
}

function getOrderCreatedAtMs(order: MerchantOrderRecord) {
  const parsed = Date.parse(order.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterMerchantOrdersForExport(
  orders: MerchantOrderRecord[],
  input: NormalizedMerchantOrderExportInput,
) {
  const statusSet = new Set(input.statuses);
  return orders
    .filter((order) => {
      const createdAtMs = getOrderCreatedAtMs(order);
      return (
        createdAtMs !== null &&
        createdAtMs >= input.createdFromMs &&
        createdAtMs < input.createdToExclusiveMs &&
        statusSet.has(order.status)
      );
    })
    .sort((left, right) => {
      const createdDelta = (getOrderCreatedAtMs(right) ?? 0) - (getOrderCreatedAtMs(left) ?? 0);
      return createdDelta || right.id.localeCompare(left.id, "en");
    });
}

export function buildMerchantOrdersCsvExport(
  orders: MerchantOrderRecord[],
  rawInput: MerchantOrderExportInput,
): MerchantOrderCsvExport {
  const input = normalizeMerchantOrderExportInput(rawInput);
  const filteredOrders = filterMerchantOrdersForExport(Array.isArray(orders) ? orders : [], input);
  if (filteredOrders.length > MERCHANT_ORDER_EXPORT_MAX_ORDERS) {
    throw new MerchantOrderExportError("order_export_order_limit_exceeded");
  }

  const encoder = new TextEncoder();
  const headers = [...BASE_HEADERS, ...(input.includeCustomerData ? CUSTOMER_HEADERS : [])];
  const rows = [headers.map(escapeMerchantOrderCsvCell).join(",")];
  let byteLength = encoder.encode(`${CSV_BOM}${rows[0]}`).byteLength;

  for (const order of filteredOrders) {
    const row = buildOrderRow(order, input.includeCustomerData);
    byteLength += encoder.encode(`${CSV_ROW_SEPARATOR}${row}`).byteLength;
    if (byteLength > MERCHANT_ORDER_EXPORT_MAX_BYTES) {
      throw new MerchantOrderExportError("order_export_size_limit_exceeded");
    }
    rows.push(row);
  }

  return {
    csv: `${CSV_BOM}${rows.join(CSV_ROW_SEPARATOR)}`,
    byteLength,
    orderCount: filteredOrders.length,
    input,
  };
}
