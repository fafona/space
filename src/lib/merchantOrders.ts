export const MERCHANT_ORDER_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export const MERCHANT_ORDER_MAX_LINE_ITEMS = 100;
export const MERCHANT_ORDER_MAX_ITEM_QUANTITY = 999;

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
  clientRequestId?: string;
  customerAccountId?: string;
  customerUserId?: string;
  customerLoginEmail?: string;
  customerGuestHash?: string;
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
  completedAt: string | null;
  cancelledAt: string | null;
  printedAt: string | null;
  printCount: number;
};

export type MerchantOrderCreateInput = {
  siteId: string;
  siteName?: string;
  blockId?: string;
  clientRequestId?: string;
  customerAccountId?: string;
  customerUserId?: string;
  customerLoginEmail?: string;
  customerGuestHash?: string;
  pricePrefix?: string;
  customer?: MerchantOrderCustomerInput;
  items?: MerchantOrderLineItemInput[];
};

export type MerchantOrderAction = "confirm" | "cancel" | "restore" | "complete" | "uncomplete" | "print" | "touch";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInt(value: unknown) {
  const next = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(next)) return 0;
  return Math.min(MERCHANT_ORDER_MAX_ITEM_QUANTITY, Math.max(0, Math.round(next)));
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
    const lastComma = sanitized.lastIndexOf(",");
    const lastDot = sanitized.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    const compact = sanitized.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
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

export function getMerchantOrderStatusLabel(status: MerchantOrderStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

export function getMerchantOrderErrorMessage(value: unknown) {
  const code = value instanceof Error ? value.message : trimText(value);
  if (code === "order_management_disabled") {
    return "当前商户未启用订单管理功能，暂时无法查看或提交订单。";
  }
  if (code === "membership_recharge_cancel_balance_insufficient" || code === "order_points_reversal_balance_insufficient") {
    return "该订单赠送的积分已被使用，暂时不能回退完成状态；请先处理会员积分后再操作。";
  }
  if (code === "order_items_locked") return "已完成或已取消的订单不能直接修改商品，请先回退订单状态。";
  if (code === "order_product_block_not_found" || code === "order_product_not_found") {
    return "产品已更新或下架，请返回产品页刷新后重新选择。";
  }
  if (code === "order_product_catalog_conflict") {
    return "手机端与电脑端的产品价格不一致，请先在网站编辑器中统一价格后再下单。";
  }
  if (code === "order_product_catalog_changed") {
    return "商品目录已更新，请刷新商品列表并确认最新价格后重新提交。";
  }
  if (code === "order_product_catalog_scope_unavailable") {
    return "当前页面的商品目录配置已变更，请刷新页面后重新选择商品。";
  }
  if (code === "order_product_unavailable") {
    return "商品已售罄或暂停销售，请刷新商品列表后重新选择。";
  }
  if (code === "order_product_price_invalid") {
    return "商品价格配置无效，暂时无法下单，请联系商家。";
  }
  if (code === "order_quantity_invalid") return `单项产品数量必须为 1-${MERCHANT_ORDER_MAX_ITEM_QUANTITY}。`;
  if (code === "order_too_many_items") return `每笔订单最多包含 ${MERCHANT_ORDER_MAX_LINE_ITEMS} 种产品。`;
  if (code === "order_catalog_unavailable") return "产品目录暂时不可用，请稍后重试。";
  if (code === "merchant_catalog_storage_unavailable") return "产品目录暂时不可用，请稍后重试。";
  if (code === "order_request_conflict") return "订单提交编号冲突，请修改购物车后重试。";
  if (code === "order_not_found") return "没有找到该订单，可能已被其他操作更新，请刷新后重试。";
  if (code === "order_customer_action_locked") return "商家已开始处理该订单，当前不能由客户取消。";
  if (code === "order_item_invalid" || code === "order_items_not_editable") return "订单商品数据无效，请刷新后重试。";
  if (code === "invalid_order_update") return "订单操作无效，请刷新后重试。";
  if (code === "order_update_failed") return "订单保存失败，请稍后重试。";
  if (code === "order_items_required") return "订单至少需要保留一项产品。";
  if (
    code === "orders_store_unavailable" ||
    code.startsWith("merchant_orders_read_failed") ||
    code.startsWith("merchant_orders_history_save_failed")
  ) {
    return "订单服务暂时不可用，请稍后重试。";
  }
  if (code === "merchant_memberships_conflict") return "会员积分正在被其他操作更新，请稍后重试。";
  return code || "unknown_error";
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
    name: trimText(input?.name).slice(0, 160),
    phone: trimText(input?.phone).slice(0, 80),
    email: trimText(input?.email).slice(0, 320),
    note: trimText(input?.note).slice(0, 2000),
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
        productId: trimText(item?.productId).slice(0, 200),
        code: trimText(item?.code).slice(0, 200),
        name: trimText(item?.name).slice(0, 500),
        description: trimText(item?.description).slice(0, 4000),
        imageUrl: trimText(item?.imageUrl).slice(0, 4096),
        tag: trimText(item?.tag).slice(0, 200),
        quantity,
        unitPrice,
        unitPriceText: unitPriceText.slice(0, 120),
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
    clientRequestId: trimText(input.clientRequestId).slice(0, 160),
    customerAccountId: trimText(input.customerAccountId),
    customerUserId: trimText(input.customerUserId),
    customerLoginEmail: trimText(input.customerLoginEmail).toLowerCase(),
    customerGuestHash: trimText(input.customerGuestHash),
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
    completedAt: trimText((input as Partial<MerchantOrderRecord>).completedAt) || null,
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

export function isMerchantOrderNewForMerchant(
  record: Pick<MerchantOrderRecord, "status" | "updatedAt" | "merchantTouchedAt">,
) {
  return record.status === "pending" && !trimText(record.merchantTouchedAt ?? "");
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
      completedAt: null,
      cancelledAt: null,
    };
  }
  if (action === "complete") {
    return {
      ...record,
      status: "completed",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      confirmedAt: record.confirmedAt || actedAt,
      completedAt: actedAt,
      cancelledAt: null,
    };
  }
  if (action === "uncomplete") {
    return {
      ...record,
      status: "confirmed",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      confirmedAt: record.confirmedAt || actedAt,
      completedAt: null,
      cancelledAt: null,
    };
  }
  if (action === "cancel") {
    return {
      ...record,
      status: "cancelled",
      updatedAt: actedAt,
      merchantTouchedAt: actedAt,
      completedAt: null,
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
      completedAt: null,
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

export function applyMerchantOrderStatus(
  record: MerchantOrderRecord,
  status: MerchantOrderStatus,
  actedAt = new Date().toISOString(),
): MerchantOrderRecord {
  if (record.status === status) return record;
  if (status === "pending") return applyMerchantOrderAction(record, "restore", actedAt);
  if (status === "cancelled") return applyMerchantOrderAction(record, "cancel", actedAt);
  if (status === "completed") return applyMerchantOrderAction(record, "complete", actedAt);
  return applyMerchantOrderAction(record, record.status === "completed" ? "uncomplete" : "confirm", actedAt);
}

export function updateMerchantOrderItems(
  record: MerchantOrderRecord,
  itemsInput: MerchantOrderLineItemInput[],
  actedAt = new Date().toISOString(),
): MerchantOrderRecord {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new Error("order_items_required");
  }
  if (itemsInput.length > MERCHANT_ORDER_MAX_LINE_ITEMS) {
    throw new Error("order_too_many_items");
  }
  const currentByProductId = new Map<string, MerchantOrderLineItem>();
  for (const item of record.items) {
    if (!item.productId || currentByProductId.has(item.productId)) {
      throw new Error("order_items_not_editable");
    }
    currentByProductId.set(item.productId, item);
  }
  const seen = new Set<string>();
  const items = itemsInput.flatMap((item) => {
    const productId = trimText(item?.productId);
    const current = currentByProductId.get(productId);
    if (!productId || !current || seen.has(productId)) {
      throw new Error("order_item_invalid");
    }
    seen.add(productId);
    const rawQuantity = typeof item?.quantity === "number" ? item.quantity : Number(item?.quantity);
    if (!Number.isInteger(rawQuantity) || rawQuantity < 0 || rawQuantity > MERCHANT_ORDER_MAX_ITEM_QUANTITY) {
      throw new Error("order_quantity_invalid");
    }
    if (rawQuantity === 0) return [];
    return [{
      ...current,
      quantity: rawQuantity,
      subtotal: normalizeMoneyValue(current.unitPrice * rawQuantity),
    }];
  });
  if (items.length === 0) throw new Error("order_items_required");
  const summary = summarizeMerchantOrderItems(items);
  return {
    ...record,
    items,
    totalQuantity: summary.totalQuantity,
    totalAmount: summary.totalAmount,
    updatedAt: actedAt,
    merchantTouchedAt: actedAt,
  };
}

export function applyMerchantOrderUpdate(
  record: MerchantOrderRecord,
  input: {
    action?: MerchantOrderAction;
    status?: MerchantOrderStatus;
    items?: MerchantOrderLineItemInput[];
  },
  actedAt = new Date().toISOString(),
): MerchantOrderRecord {
  const hasItems = Array.isArray(input.items);
  if (!hasItems && !input.status && !input.action) {
    throw new Error("invalid_order_update");
  }
  if ((input.status && input.action) || (hasItems && input.action)) {
    throw new Error("invalid_order_update");
  }

  const orderWithItems = hasItems ? updateMerchantOrderItems(record, input.items ?? [], actedAt) : record;
  if (input.status) {
    return applyMerchantOrderStatus(orderWithItems, input.status, actedAt);
  }
  if (input.action) {
    return applyMerchantOrderAction(orderWithItems, input.action, actedAt);
  }
  return orderWithItems;
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
    clientRequestId: trimText(input.clientRequestId).slice(0, 160),
    customerAccountId: trimText(input.customerAccountId),
    customerUserId: trimText(input.customerUserId),
    customerLoginEmail: trimText(input.customerLoginEmail).toLowerCase(),
    customerGuestHash: trimText(input.customerGuestHash),
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
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
  };
}
