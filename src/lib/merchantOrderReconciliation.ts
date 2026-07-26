import { normalizeMerchantOrderRecords, type MerchantOrderRecord } from "@/lib/merchantOrders";

export type MerchantOrderV1Row = {
  merchant_id?: unknown;
  id?: unknown;
  status?: unknown;
  total_quantity?: unknown;
  total_amount_minor?: unknown;
  print_count?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  source_snapshot?: unknown;
};

export type MerchantOrderItemV1Row = {
  merchant_id?: unknown;
  order_id?: unknown;
  line_number?: unknown;
  product_id?: unknown;
  code?: unknown;
  name?: unknown;
  quantity?: unknown;
  unit_amount_minor?: unknown;
  subtotal_amount_minor?: unknown;
};

export type MerchantOrderReconciliationMismatch = {
  orderId: string;
  fields: string[];
};

export type MerchantOrderReconciliationReport = {
  merchantId: string;
  legacyCount: number;
  v1Count: number;
  matchedCount: number;
  missingInV1: string[];
  unexpectedInV1: string[];
  mismatches: MerchantOrderReconciliationMismatch[];
  isMatch: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toMinorUnits(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function normalizeTimestamp(value: unknown) {
  const text = trimText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampsMatch(left: unknown, right: unknown) {
  const leftTimestamp = normalizeTimestamp(left);
  const rightTimestamp = normalizeTimestamp(right);
  if (leftTimestamp === null || rightTimestamp === null) return leftTimestamp === rightTimestamp;
  return Math.abs(leftTimestamp - rightTimestamp) < 1000;
}

function readV1SourceUpdatedAt(row: MerchantOrderV1Row) {
  const snapshot = row.source_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const sourceUpdatedAt = (snapshot as { updatedAt?: unknown }).updatedAt;
    if (trimText(sourceUpdatedAt)) return sourceUpdatedAt;
  }
  return row.updated_at;
}

function normalizeV1OrderRows(merchantId: string, rows: MerchantOrderV1Row[]) {
  const map = new Map<string, MerchantOrderV1Row>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row.merchant_id) !== merchantId) continue;
    const orderId = trimText(row.id);
    if (!orderId) continue;
    map.set(orderId, row);
  }
  return map;
}

function normalizeV1ItemRows(merchantId: string, rows: MerchantOrderItemV1Row[]) {
  const map = new Map<string, MerchantOrderItemV1Row[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trimText(row.merchant_id) !== merchantId) continue;
    const orderId = trimText(row.order_id);
    if (!orderId) continue;
    const items = map.get(orderId) ?? [];
    items.push(row);
    map.set(orderId, items);
  }
  for (const items of map.values()) {
    items.sort((left, right) => toInteger(left.line_number) - toInteger(right.line_number));
  }
  return map;
}

function compareOrderItems(legacy: MerchantOrderRecord, rows: MerchantOrderItemV1Row[]) {
  const fields: string[] = [];
  if (legacy.items.length !== rows.length) fields.push("items.count");
  const totalLines = Math.max(legacy.items.length, rows.length);
  for (let index = 0; index < totalLines; index += 1) {
    const legacyItem = legacy.items[index];
    const v1Item = rows[index];
    const fieldPrefix = `items.${index + 1}`;
    if (!legacyItem || !v1Item) continue;
    if (trimText(v1Item.product_id) !== legacyItem.productId) fields.push(`${fieldPrefix}.productId`);
    if (trimText(v1Item.code) !== legacyItem.code) fields.push(`${fieldPrefix}.code`);
    if (trimText(v1Item.name) !== legacyItem.name) fields.push(`${fieldPrefix}.name`);
    if (toInteger(v1Item.quantity) !== legacyItem.quantity) fields.push(`${fieldPrefix}.quantity`);
    if (toInteger(v1Item.unit_amount_minor) !== toMinorUnits(legacyItem.unitPrice)) {
      fields.push(`${fieldPrefix}.unitAmount`);
    }
    if (toInteger(v1Item.subtotal_amount_minor) !== toMinorUnits(legacyItem.subtotal)) {
      fields.push(`${fieldPrefix}.subtotalAmount`);
    }
  }
  return fields;
}

export function reconcileMerchantOrderStorage(input: {
  merchantId: string;
  legacyOrders: MerchantOrderRecord[];
  v1Orders: MerchantOrderV1Row[];
  v1Items: MerchantOrderItemV1Row[];
}): MerchantOrderReconciliationReport {
  const merchantId = trimText(input.merchantId);
  const legacyOrders = normalizeMerchantOrderRecords(input.legacyOrders).filter(
    (order) => order.siteId === merchantId,
  );
  const legacyMap = new Map(legacyOrders.map((order) => [order.id, order]));
  const v1Map = normalizeV1OrderRows(merchantId, input.v1Orders);
  const v1ItemsByOrder = normalizeV1ItemRows(merchantId, input.v1Items);
  const missingInV1 = [...legacyMap.keys()].filter((orderId) => !v1Map.has(orderId)).sort();
  const unexpectedInV1 = [...v1Map.keys()].filter((orderId) => !legacyMap.has(orderId)).sort();
  const mismatches: MerchantOrderReconciliationMismatch[] = [];
  let matchedCount = 0;

  for (const [orderId, legacy] of legacyMap.entries()) {
    const v1 = v1Map.get(orderId);
    if (!v1) continue;
    const fields: string[] = [];
    if (trimText(v1.status) !== legacy.status) fields.push("status");
    if (toInteger(v1.total_quantity) !== legacy.totalQuantity) fields.push("totalQuantity");
    if (toInteger(v1.total_amount_minor) !== toMinorUnits(legacy.totalAmount)) fields.push("totalAmount");
    if (toInteger(v1.print_count) !== legacy.printCount) fields.push("printCount");
    if (!timestampsMatch(v1.created_at, legacy.createdAt)) fields.push("createdAt");
    if (!timestampsMatch(readV1SourceUpdatedAt(v1), legacy.updatedAt)) fields.push("updatedAt");
    fields.push(...compareOrderItems(legacy, v1ItemsByOrder.get(orderId) ?? []));

    if (fields.length > 0) {
      mismatches.push({ orderId, fields });
    } else {
      matchedCount += 1;
    }
  }

  mismatches.sort((left, right) => left.orderId.localeCompare(right.orderId));
  return {
    merchantId,
    legacyCount: legacyMap.size,
    v1Count: v1Map.size,
    matchedCount,
    missingInV1,
    unexpectedInV1,
    mismatches,
    isMatch: missingInV1.length === 0 && unexpectedInV1.length === 0 && mismatches.length === 0,
  };
}
