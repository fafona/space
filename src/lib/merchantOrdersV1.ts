import {
  MERCHANT_ORDER_MAX_ITEM_QUANTITY,
  MERCHANT_ORDER_STATUSES,
  normalizeMerchantOrderRecord,
  normalizeMerchantOrderRecords,
  type MerchantOrderLineItem,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";

export type MerchantOrderV1StoredRow = {
  merchant_id?: unknown;
  id?: unknown;
  site_name?: unknown;
  block_id?: unknown;
  client_request_id?: unknown;
  status?: unknown;
  currency?: unknown;
  price_prefix?: unknown;
  total_quantity?: unknown;
  total_amount_minor?: unknown;
  customer_snapshot?: unknown;
  source_snapshot?: unknown;
  confirmed_at?: unknown;
  completed_at?: unknown;
  cancelled_at?: unknown;
  printed_at?: unknown;
  print_count?: unknown;
  merchant_touched_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type MerchantOrderItemV1StoredRow = {
  merchant_id?: unknown;
  order_id?: unknown;
  line_number?: unknown;
  product_id?: unknown;
  code?: unknown;
  name?: unknown;
  description?: unknown;
  image_url?: unknown;
  tag?: unknown;
  quantity?: unknown;
  unit_amount_minor?: unknown;
  subtotal_amount_minor?: unknown;
  unit_price_text?: unknown;
  source_snapshot?: unknown;
};

export type MerchantOrderV1ConversionError = {
  orderId: string;
  code:
    | "tenant_mismatch"
    | "missing_order_id"
    | "duplicate_order_id"
    | "invalid_status"
    | "invalid_created_at"
    | "invalid_updated_at"
    | "invalid_optional_timestamp"
    | "invalid_order_totals"
    | "orphan_item"
    | "invalid_line_number"
    | "duplicate_line_number"
    | "invalid_item_values"
    | "item_subtotal_mismatch"
    | "order_normalization_failed";
};

export type MerchantOrderV1ConversionResult = {
  orders: MerchantOrderRecord[];
  errors: MerchantOrderV1ConversionError[];
  valid: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}

function readTimestamp(value: unknown) {
  const text = trimText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function readOptionalTimestamp(value: unknown) {
  const text = trimText(value);
  if (!text) return { valid: true, value: null };
  return {
    valid: Number.isFinite(Date.parse(text)),
    value: Number.isFinite(Date.parse(text)) ? text : null,
  };
}

function minorUnitsToAmount(value: number) {
  return Number((value / 100).toFixed(2));
}

function pushError(
  errors: MerchantOrderV1ConversionError[],
  orderId: string,
  code: MerchantOrderV1ConversionError["code"],
) {
  if (errors.some((error) => error.orderId === orderId && error.code === code)) return;
  errors.push({ orderId, code });
}

function readSourceUpdatedAt(row: MerchantOrderV1StoredRow) {
  const source = asRecord(row.source_snapshot);
  return trimText(source.updatedAt) || trimText(row.updated_at);
}

function buildLineItem(
  row: MerchantOrderItemV1StoredRow,
  orderId: string,
  errors: MerchantOrderV1ConversionError[],
): MerchantOrderLineItem | null {
  const quantity = readInteger(row.quantity);
  const unitAmountMinor = readInteger(row.unit_amount_minor);
  const subtotalAmountMinor = readInteger(row.subtotal_amount_minor);
  if (
    quantity === null ||
    quantity < 1 ||
    quantity > MERCHANT_ORDER_MAX_ITEM_QUANTITY ||
    unitAmountMinor === null ||
    unitAmountMinor < 0 ||
    subtotalAmountMinor === null ||
    subtotalAmountMinor < 0
  ) {
    pushError(errors, orderId, "invalid_item_values");
    return null;
  }
  if (unitAmountMinor * quantity !== subtotalAmountMinor) {
    pushError(errors, orderId, "item_subtotal_mismatch");
    return null;
  }
  return {
    productId: trimText(row.product_id),
    code: trimText(row.code),
    name: trimText(row.name),
    description: trimText(row.description),
    imageUrl: trimText(row.image_url),
    tag: trimText(row.tag),
    quantity,
    unitPrice: minorUnitsToAmount(unitAmountMinor),
    unitPriceText: trimText(row.unit_price_text),
    subtotal: minorUnitsToAmount(subtotalAmountMinor),
  };
}

export function convertMerchantOrderV1Rows(input: {
  merchantId: string;
  orderRows: MerchantOrderV1StoredRow[];
  itemRows: MerchantOrderItemV1StoredRow[];
}): MerchantOrderV1ConversionResult {
  const merchantId = trimText(input.merchantId);
  const errors: MerchantOrderV1ConversionError[] = [];
  const orderRows = Array.isArray(input.orderRows) ? input.orderRows : [];
  const itemRows = Array.isArray(input.itemRows) ? input.itemRows : [];
  const knownOrderIds = new Set(
    orderRows.map((row) => trimText(row.id)).filter(Boolean),
  );
  const itemsByOrder = new Map<string, MerchantOrderItemV1StoredRow[]>();

  for (const itemRow of itemRows) {
    const orderId = trimText(itemRow.order_id);
    if (trimText(itemRow.merchant_id) !== merchantId) {
      pushError(errors, orderId, "tenant_mismatch");
      continue;
    }
    if (!orderId || !knownOrderIds.has(orderId)) {
      pushError(errors, orderId, "orphan_item");
      continue;
    }
    const rows = itemsByOrder.get(orderId) ?? [];
    rows.push(itemRow);
    itemsByOrder.set(orderId, rows);
  }

  const seenOrderIds = new Set<string>();
  const orders: MerchantOrderRecord[] = [];
  for (const row of orderRows) {
    const orderId = trimText(row.id);
    if (trimText(row.merchant_id) !== merchantId) {
      pushError(errors, orderId, "tenant_mismatch");
      continue;
    }
    if (!orderId) {
      pushError(errors, "", "missing_order_id");
      continue;
    }
    if (seenOrderIds.has(orderId)) {
      pushError(errors, orderId, "duplicate_order_id");
      continue;
    }
    seenOrderIds.add(orderId);

    const status = trimText(row.status);
    if (!MERCHANT_ORDER_STATUSES.includes(status as MerchantOrderStatus)) {
      pushError(errors, orderId, "invalid_status");
      continue;
    }
    const createdAt = readTimestamp(row.created_at);
    if (!createdAt) {
      pushError(errors, orderId, "invalid_created_at");
      continue;
    }
    const updatedAt = readTimestamp(readSourceUpdatedAt(row));
    if (!updatedAt) {
      pushError(errors, orderId, "invalid_updated_at");
      continue;
    }

    const confirmedAt = readOptionalTimestamp(row.confirmed_at);
    const completedAt = readOptionalTimestamp(row.completed_at);
    const cancelledAt = readOptionalTimestamp(row.cancelled_at);
    const printedAt = readOptionalTimestamp(row.printed_at);
    const merchantTouchedAt = readOptionalTimestamp(row.merchant_touched_at);
    if (
      !confirmedAt.valid ||
      !completedAt.valid ||
      !cancelledAt.valid ||
      !printedAt.valid ||
      !merchantTouchedAt.valid
    ) {
      pushError(errors, orderId, "invalid_optional_timestamp");
      continue;
    }

    const totalQuantity = readInteger(row.total_quantity);
    const totalAmountMinor = readInteger(row.total_amount_minor);
    const printCount = readInteger(row.print_count);
    if (
      totalQuantity === null ||
      totalQuantity < 0 ||
      totalAmountMinor === null ||
      totalAmountMinor < 0 ||
      printCount === null ||
      printCount < 0
    ) {
      pushError(errors, orderId, "invalid_order_totals");
      continue;
    }

    const lineRows = [...(itemsByOrder.get(orderId) ?? [])].sort(
      (left, right) => (readInteger(left.line_number) ?? 0) - (readInteger(right.line_number) ?? 0),
    );
    const seenLineNumbers = new Set<number>();
    const items: MerchantOrderLineItem[] = [];
    for (let index = 0; index < lineRows.length; index += 1) {
      const lineRow = lineRows[index];
      const lineNumber = readInteger(lineRow.line_number);
      if (lineNumber === null || lineNumber < 1 || lineNumber !== index + 1) {
        pushError(errors, orderId, "invalid_line_number");
        continue;
      }
      if (seenLineNumbers.has(lineNumber)) {
        pushError(errors, orderId, "duplicate_line_number");
        continue;
      }
      seenLineNumbers.add(lineNumber);
      const item = buildLineItem(lineRow, orderId, errors);
      if (item) items.push(item);
    }
    if (errors.some((error) => error.orderId === orderId)) continue;

    const customerSnapshot = asRecord(row.customer_snapshot);
    const sourceSnapshot = asRecord(row.source_snapshot);
    const sourceCustomer = asRecord(sourceSnapshot.customer);
    const normalized = normalizeMerchantOrderRecord({
      id: orderId,
      siteId: merchantId,
      siteName: trimText(row.site_name) || trimText(sourceSnapshot.siteName),
      blockId: trimText(row.block_id) || trimText(sourceSnapshot.blockId),
      clientRequestId: trimText(row.client_request_id) || trimText(sourceSnapshot.clientRequestId),
      customerAccountId:
        trimText(customerSnapshot.accountId) || trimText(sourceSnapshot.customerAccountId),
      customerUserId: trimText(customerSnapshot.userId) || trimText(sourceSnapshot.customerUserId),
      customerLoginEmail:
        trimText(customerSnapshot.loginEmail) || trimText(sourceSnapshot.customerLoginEmail),
      customerGuestHash:
        trimText(customerSnapshot.guestHash) || trimText(sourceSnapshot.customerGuestHash),
      createdAt,
      updatedAt,
      merchantTouchedAt: merchantTouchedAt.value ?? "",
      status: status as MerchantOrderStatus,
      customer: {
        name: trimText(customerSnapshot.name) || trimText(sourceCustomer.name),
        phone: trimText(customerSnapshot.phone) || trimText(sourceCustomer.phone),
        email: trimText(customerSnapshot.email) || trimText(sourceCustomer.email),
        note: trimText(customerSnapshot.note) || trimText(sourceCustomer.note),
      },
      items,
      totalQuantity,
      totalAmount: minorUnitsToAmount(totalAmountMinor),
      pricePrefix: trimText(row.price_prefix) || trimText(sourceSnapshot.pricePrefix),
      confirmedAt: confirmedAt.value,
      completedAt: completedAt.value,
      cancelledAt: cancelledAt.value,
      printedAt: printedAt.value,
      printCount,
    });
    if (!normalized) {
      pushError(errors, orderId, "order_normalization_failed");
      continue;
    }
    if (
      normalized.totalQuantity !== totalQuantity ||
      Math.round(normalized.totalAmount * 100) !== totalAmountMinor
    ) {
      pushError(errors, orderId, "invalid_order_totals");
      continue;
    }
    orders.push(normalized);
  }

  errors.sort((left, right) => left.orderId.localeCompare(right.orderId) || left.code.localeCompare(right.code));
  return {
    orders: normalizeMerchantOrderRecords(orders),
    errors,
    valid: errors.length === 0,
  };
}
