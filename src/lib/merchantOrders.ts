export const MERCHANT_ORDER_STATUSES = ["pending", "confirmed", "cancelled"] as const;

export type MerchantOrderStatus = (typeof MERCHANT_ORDER_STATUSES)[number];

export type MerchantOrderLineItemInput = {
  productId?: string;
  code?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  tag?: string;
  quantity?: number;
  unitPrice?: number;
  unitPriceText?: string;
};

export type MerchantOrderLineItem = {
  productId: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string;
  tag: string;
  quantity: number;
  unitPrice: number;
  unitPriceText: string;
  subtotal: number;
};

export type MerchantOrderCustomerInput = {
  name?: string;
  phone?: string;
  email?: string;
  note?: string;
};

export type MerchantOrderCustomer = {
  name: string;
  phone: string;
  email: string;
  note: string;
};

export type MerchantOrderRecord = {
  id: string;
  siteId: string;
  siteName: string;
  blockId: string;
  createdAt: string;
  updatedAt: string;
  merchantTouchedAt?: string;
  status: MerchantOrderStatus;
  customer: MerchantOrderCustomer;
  items: MerchantOrderLineItem[];
  totalQuantity: number;
  totalAmount: number;
  pricePrefix: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  printedAt: string | null;
  printCount: number;
};

export type MerchantOrderCreateInput = {
  siteId: string;
  siteName?: string;
  blockId?: string;
  pricePrefix?: string;
  customer?: MerchantOrderCustomerInput;
  items?: MerchantOrderLineItemInput[];
};

export type MerchantOrderAction = "confirm" | "cancel" | "restore" | "print" | "touch";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInt(value: unknown) {
  const next = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next));
}

function normalizeMoneyValue(value: unknown) {
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Number(next.toFixed(2)));
}

function padOrderSequence(value: number) {
  return String(Math.max(0, Math.trunc(value))).padStart(4, "0");
}

function normalizeIsoDateValue(value: Date | string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const source = value instanceof Date ? value : new Date(value);
  return Number.isFinite(source.getTime()) ? source.toISOString() : fallback;
}

export function parseMerchantOrderPriceValue(value: string) {
  const raw = trimText(value);
  if (!raw) return 0;
  const sanitized = raw.replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;
  if (sanitized.includes(",") && sanitized.includes(".")) {
    const compact = sanitized.replace(/,/g, "");
    const parsed = Number.parseFloat(compact);
    return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
  }
  if (sanitized.includes(",")) {
    const parsed = Number.parseFloat(sanitized.replace(",", "."));
    return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
  }
  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
}

export function formatMerchantOrderAmount(amount: number, pricePrefix: string) {
  const normalized = Math.max(0, Number.isFinite(amount) ? amount : 0);
  return `${trimText(pricePrefix)}${normalized.toFixed(2)}`;
}

export function formatMerchantOrderIdDate(value: Date | string) {
  const source = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(source.getTime())) return "";
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildMerchantOrderId(siteId: string, createdAt: Date | string, existingIds: string[]) {
  const normalizedSiteId = trimText(siteId);
  const datePart = formatMerchantOrderIdDate(createdAt);
  if (!normalizedSiteId || !datePart) {
    return "";
  }
  const prefix = `O${normalizedSiteId}${datePart}`;
  const maxSequence = existingIds.reduce((highest, currentId) => {
    if (!currentId.startsWith(prefix)) return highest;
    const sequence = Number.parseInt(currentId.slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
  }, 0);
  return `${prefix}${padOrderSequence(maxSequence + 1)}`;
}

export function normalizeMerchantOrderCustomer(input: MerchantOrderCustomerInput | null | undefined): MerchantOrderCustomer {
  return {
    name: trimText(input?.name),
    phone: trimText(input?.phone),
    email: trimText(input?.email),
    note: trimText(input?.note),
  };
}

export function normalizeMerchantOrderLineItems(
  items: MerchantOrderLineItemInput[] | null | undefined,
  pricePrefix = "",
): MerchantOrderLineItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const quantity = normalizePositiveInt(item?.quantity);
      const unitPrice =
        typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice)
          ? normalizeMoneyValue(item.unitPrice)
          : parseMerchantOrderPriceValue(trimText(item?.unitPriceText));
      const unitPriceText = trimText(item?.unitPriceText) || formatMerchantOrderAmount(unitPrice, pricePrefix);
      return {
        productId: trimText(item?.productId),
        code: trimText(item?.code),
        name: trimText(item?.name),
        description: trimText(item?.description),
        imageUrl: trimText(item?.imageUrl),
        tag: trimText(item?.tag),
        quantity,
        unitPrice,
        unitPriceText,
        subtotal: normalizeMoneyValue(unitPrice * quantity),
      };
    })
    .filter((item) => item.quantity > 0 && (item.productId || item.name || item.code));
}

export function summarizeMerchantOrderItems(items: MerchantOrderLineItem[]) {
  return items.reduce(
    (summary, item) => {
      summary.totalQuantity += item.quantity;
      summary.totalAmount = normalizeMoneyValue(summary.totalAmount + item.subtotal);
      return summary;
    },
    { totalQuantity: 0, totalAmount: 0 },
  );
}

export function normalizeMerchantOrderRecord(input: Partial<MerchantOrderRecord>): MerchantOrderRecord | null {
  const id = trimText(input.id);
  const siteId = trimText(input.siteId);
  if (!id || !siteId) return null;
  const items = normalizeMerchantOrderLineItems(input.items ?? [], trimText(input.pricePrefix));
  const summary = summarizeMerchantOrderItems(items);
  return {
    id,
    siteId,
    siteName: trimText(input.siteName),
    blockId: trimText(input.blockId),
    createdAt: trimText(input.createdAt) || new Date().toISOString(),
    updatedAt: trimText(input.updatedAt) || new Date().toISOString(),
    merchantTouchedAt: trimText(input.merchantTouchedAt),
    status: MERCHANT_ORDER_STATUSES.includes(input.status as MerchantOrderStatus)
      ? (input.status as MerchantOrderStatus)
      : "pending",
    customer: normalizeMerchantOrderCustomer(input.customer),
    items,
    totalQuantity: summary.totalQuantity,
    totalAmount: summary.totalAmount,
    pricePrefix: trimText(input.pricePrefix),
    confirmedAt: trimText(input.confirmedAt) || null,
    cancelledAt: trimText(input.cancelledAt) || null,
    printedAt: trimText(input.printedAt) || null,
    printCount: normalizePositiveInt(input.printCount),
  };
}

export function normalizeMerchantOrderRecords(input: unknown): MerchantOrderRecord[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => normalizeMerchantOrderRecord(item as Partial<MerchantOrderRecord>))
    .filter((item): item is MerchantOrderRecord => Boolean(item))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function createMerchantOrderId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `O${stamp}${random}`;
}

export function isMerchantOrderPendingMerchantTouch(
  record: Pick<MerchantOrderRecord, "updatedAt" | "merchantTouchedAt">,
) {
  const updatedAt = trimText(record.updatedAt);
  const merchantTouchedAt = trimText(record.merchantTouchedAt ?? "");
  if (!updatedAt) return !merchantTouchedAt;
  if (!merchantTouchedAt) return true;
  return new Date(updatedAt).getTime() > new Date(merchantTouchedAt).getTime();
}

export function applyMerchantOrderAction(
  record: MerchantOrderRecord,
  action: MerchantOrderAction,
  actedAt = new Date().toISOString(),
): MerchantOrderRecord {
  if (action === "confirm") {
    return {
      ...record,
      status: "confirmed",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      confirmedAt: actedAt,
      cancelledAt: null,
    };
  }
  if (action === "cancel") {
    return {
      ...record,
      status: "cancelled",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      cancelledAt: actedAt,
    };
  }
  if (action === "restore") {
    return {
      ...record,
      status: "pending",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      confirmedAt: null,
      cancelledAt: null,
    };
  }
  if (action === "print") {
    return {
      ...record,
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      printedAt: actedAt,
      printCount: record.printCount + 1,
    };
  }
  return {
    ...record,
    merchantTouchedAt: actedAt,
  };
}

export function createMerchantOrder(
  input: MerchantOrderCreateInput,
  options: {
    id?: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    merchantTouchedAt?: string;
  } = {},
): MerchantOrderRecord {
  const now = new Date().toISOString();
  const createdAt = normalizeIsoDateValue(options.createdAt, now);
  const updatedAt = normalizeIsoDateValue(options.updatedAt, createdAt);
  const pricePrefix = trimText(input.pricePrefix);
  const items = normalizeMerchantOrderLineItems(input.items ?? [], pricePrefix);
  const summary = summarizeMerchantOrderItems(items);
  return {
    id: trimText(options.id) || createMerchantOrderId(),
    siteId: trimText(input.siteId),
    siteName: trimText(input.siteName),
    blockId: trimText(input.blockId),
    createdAt,
    updatedAt,
    merchantTouchedAt: trimText(options.merchantTouchedAt),
    status: "pending",
    customer: normalizeMerchantOrderCustomer(input.customer),
    items,
    totalQuantity: summary.totalQuantity,
    totalAmount: summary.totalAmount,
    pricePrefix,
    confirmedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
  };
}
