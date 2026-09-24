import {
  formatMerchantOrderAmount,
  isMerchantOrderNewForMerchant,
  normalizeMerchantOrderRecord,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import { formatSupportConversationPreview } from "@/lib/supportMessageAttachments";

/** The existing badge/native-notification payload, not an order or customer DTO. */
export type MerchantOrderAttentionNotification = {
  key: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
};

export type MerchantOrderAttentionSummary = {
  count: number;
  latest: MerchantOrderAttentionNotification | null;
};

function normalizeDisplayValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "-" ? text : "";
}

function normalizeLegacyTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function compareMerchantOrderAttentionNotifications(
  left: MerchantOrderAttentionNotification | null,
  right: MerchantOrderAttentionNotification | null,
) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  if (rightTime > leftTime) return right;
  if (rightTime < leftTime) return left;
  // Preserve JavaScript UTF-16 ordering and first-wins for identical keys.
  // localeCompare/database collation can select a different notification.
  return right.key > left.key ? right : left;
}

/** Input must have passed the ordinary order normalizer, including ALL items. */
function buildOrderAttentionBodySource(order: MerchantOrderRecord) {
  const itemSummary = order.items
    .slice(0, 2)
    .map((item) => {
      const name = normalizeDisplayValue(item.name) || normalizeDisplayValue(item.code) || "商品";
      return item.quantity > 1 ? `${name}×${item.quantity}` : name;
    })
    .filter(Boolean)
    .join("、") || `${Math.max(1, order.totalQuantity)}件商品`;
  const amount = formatMerchantOrderAmount(order.totalAmount, order.pricePrefix);
  return [itemSummary, amount].filter(Boolean).join(" · ");
}

export function buildMerchantOrderAttentionNotification(
  order: MerchantOrderRecord,
  merchantId: string,
): MerchantOrderAttentionNotification {
  const customerName =
    normalizeDisplayValue(order.customer?.name) ||
    normalizeDisplayValue(order.customer?.phone) ||
    "客户";
  const preview = formatSupportConversationPreview(buildOrderAttentionBodySource(order));
  const body = !preview
    ? "你有一条新消息"
    : preview.length > 72 ? `${preview.slice(0, 69).trimEnd()}...` : preview;
  const path = normalizeDisplayValue(merchantId) || "admin";
  return {
    key: `order:${order.id}`,
    title: `新订单 - ${customerName}`,
    body,
    url: `/${path}?mobileTab=business&businessSection=orders&appShell=faolla`,
    createdAt: normalizeLegacyTimestamp(order.updatedAt) || normalizeLegacyTimestamp(order.createdAt),
  };
}

/** Exact existing client semantics; this does not normalize, deduplicate or sort. */
export function summarizeMerchantOrderAttentionRecords(
  records: readonly MerchantOrderRecord[],
  merchantId: string,
): MerchantOrderAttentionSummary {
  return records.reduce<MerchantOrderAttentionSummary>((summary, order) => {
    if (!isMerchantOrderNewForMerchant(order)) return summary;
    return {
      count: summary.count + 1,
      latest: compareMerchantOrderAttentionNotifications(
        summary.latest,
        buildMerchantOrderAttentionNotification(order, merchantId),
      ),
    };
  }, { count: 0, latest: null });
}

/**
 * Eligibility only, NEVER authentication. The route must authenticate, check
 * current module permissions and the pilot allowlist before reading order data.
 * Employees must continue using the existing per-actor redacted orders route.
 */
export function canUseMerchantOrderAttentionSummaryForActor(
  actor: { type?: unknown; siteId?: unknown } | null | undefined,
  siteId: string,
) {
  return Boolean(siteId && actor?.type === "owner" && actor.siteId === siteId);
}

/**
 * Fail closed for timestamps whose Date parsing depends on locale/timezone or
 * silently repairs an impossible date. Unsupported records use the full route;
 * never substitute now(), an empty timestamp, or an approximate SQL ordering.
 */
export function normalizeDeterministicMerchantOrderAttentionTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  // Date's millisecond precision is also the existing UI's comparison precision.
  const canonical = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${fraction.padEnd(3, "0").slice(0, 3)}${zone}`;
  const timestamp = Date.parse(canonical);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export type MerchantOrderAttentionCandidateResult =
  | { supported: true; order: MerchantOrderRecord }
  | {
      supported: false;
      reason: "invalid_record" | "site_mismatch" | "unsupported_timestamp" | "unsupported_preview";
    };

/**
 * Validate a RAW source record (including non-pending records). Storage is
 * responsible for original chunk precedence, first-ID-wins and count/tie parity.
 * Only the final notification may be serialized; the normalized order is local.
 */
export function normalizeMerchantOrderAttentionCandidate(
  input: unknown,
  siteId: string,
): MerchantOrderAttentionCandidateResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { supported: false, reason: "invalid_record" };
  const raw = input as Partial<MerchantOrderRecord>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return { supported: false, reason: "invalid_record" };
  if (!siteId || typeof raw.siteId !== "string" || raw.siteId.trim() !== siteId) {
    return { supported: false, reason: "site_mismatch" };
  }
  if (!normalizeDeterministicMerchantOrderAttentionTimestamp(raw.createdAt) ||
      !normalizeDeterministicMerchantOrderAttentionTimestamp(raw.updatedAt)) {
    return { supported: false, reason: "unsupported_timestamp" };
  }
  // Reuse the full normalizer: dropping raw invalid items can change the first
  // two display items, and totals are recomputed from ALL normalized line items.
  const order = normalizeMerchantOrderRecord(raw);
  if (!order) return { supported: false, reason: "invalid_record" };
  // The old attachment preview resolves relative URLs against browser origin.
  // A mixed relative/absolute image+link can be "图片" on one merchant origin
  // and "名片" on another. Do not cache a server-origin-specific answer.
  const bodySource = buildOrderAttentionBodySource(order);
  if (/\r?\n/.test(bodySource) && bodySource.split(/\r?\n/).some((line) =>
    /^(?:(?:图片|照片|拍照|联系卡|链接)\s*[:：]?\s*)?\//.test(line.trim()))) {
    return { supported: false, reason: "unsupported_preview" };
  }
  return { supported: true, order };
}

function hasExactKeys(input: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(input);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(input, key));
}

/** Validate cache/network payloads without allowing extra customer/order data. */
export function parseMerchantOrderAttentionSummary(
  input: unknown,
  siteId: string,
): MerchantOrderAttentionSummary | null {
  if (!input || typeof input !== "object" || Array.isArray(input) || !normalizeDisplayValue(siteId)) return null;
  const summary = input as Record<string, unknown>;
  if (!hasExactKeys(summary, ["count", "latest"]) ||
      typeof summary.count !== "number" || !Number.isSafeInteger(summary.count) || summary.count < 0) return null;
  if (summary.count === 0) return summary.latest === null ? { count: 0, latest: null } : null;
  if (!summary.latest || typeof summary.latest !== "object" || Array.isArray(summary.latest)) return null;
  const latest = summary.latest as Record<string, unknown>;
  if (!hasExactKeys(latest, ["key", "title", "body", "url", "createdAt"])) return null;
  const { key, title, body, url, createdAt } = latest;
  if (typeof key !== "string" || !key.startsWith("order:") || !key.slice(6).trim() || key.slice(6) !== key.slice(6).trim() ||
      typeof title !== "string" || !title.startsWith("新订单 - ") || title.length <= "新订单 - ".length || title.length > "新订单 - ".length + 160 ||
      typeof body !== "string" || !body || body.length > 72 ||
      url !== `/${normalizeDisplayValue(siteId)}?mobileTab=business&businessSection=orders&appShell=faolla` ||
      typeof createdAt !== "string" || normalizeDeterministicMerchantOrderAttentionTimestamp(createdAt) !== createdAt) return null;
  return { count: summary.count, latest: { key, title, body, url, createdAt } };
}
