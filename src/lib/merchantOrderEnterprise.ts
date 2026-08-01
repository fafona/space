import {
  formatMerchantOrderAmount,
  getMerchantOrderStatusLabel,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import type { MerchantTask, MerchantTaskPriority } from "@/lib/merchantEnterprise";

export const MERCHANT_ORDER_TASK_SOURCE_TYPE = "order" as const;

export type MerchantOrderTaskDraft = {
  sourceType: typeof MERCHANT_ORDER_TASK_SOURCE_TYPE;
  sourceId: string;
  title: string;
  description: string;
  priority: MerchantTaskPriority;
};

export type MerchantOrderTaskDraftIntent = MerchantOrderTaskDraft & {
  siteId: string;
  requestId: string;
};

export type MerchantOrderTaskSource = Pick<
  MerchantOrderTaskDraft,
  "sourceType" | "sourceId"
>;

export type MerchantOrderSourceDetailIntent = {
  siteId: string;
  orderId: string;
  requestId: string;
  order: MerchantOrderRecord;
};

export type MerchantLinkedOrderSummaryItem = {
  name: string;
  code: string;
  specification: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type MerchantLinkedOrderSummary = {
  id: string;
  status: MerchantOrderRecord["status"];
  createdAt: string;
  items: MerchantLinkedOrderSummaryItem[];
  totalQuantity: number;
  totalAmount: number;
  pricePrefix: string;
};

function normalizeLinkedOrderSummaryText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeLinkedOrderSummaryNumber(value: unknown, integer = false) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = Math.max(0, integer ? Math.trunc(parsed) : parsed);
  return integer ? normalized : Number(normalized.toFixed(2));
}

export function buildMerchantLinkedOrderSummary(
  order: MerchantOrderRecord,
): MerchantLinkedOrderSummary {
  return {
    id: normalizeLinkedOrderSummaryText(order.id, 200),
    status: order.status,
    createdAt: normalizeLinkedOrderSummaryText(order.createdAt, 80),
    items: order.items.slice(0, 100).map((item) => ({
      name: normalizeLinkedOrderSummaryText(item.name, 500),
      code: normalizeLinkedOrderSummaryText(item.code, 200),
      specification: normalizeLinkedOrderSummaryText(item.description, 1000),
      quantity: normalizeLinkedOrderSummaryNumber(item.quantity, true),
      unitPrice: normalizeLinkedOrderSummaryNumber(item.unitPrice),
      subtotal: normalizeLinkedOrderSummaryNumber(item.subtotal),
    })),
    totalQuantity: normalizeLinkedOrderSummaryNumber(order.totalQuantity, true),
    totalAmount: normalizeLinkedOrderSummaryNumber(order.totalAmount),
    pricePrefix: normalizeLinkedOrderSummaryText(order.pricePrefix, 120),
  };
}

export function getMerchantOrderTaskSource(
  task: Pick<MerchantTask, "sourceType" | "sourceId">,
): MerchantOrderTaskSource | null {
  const sourceId = task.sourceId.trim();
  if (task.sourceType !== MERCHANT_ORDER_TASK_SOURCE_TYPE || !sourceId) return null;
  return {
    sourceType: MERCHANT_ORDER_TASK_SOURCE_TYPE,
    sourceId,
  };
}

export function getMerchantOrderSourceErrorMessage(error: unknown) {
  const code = typeof error === "string" ? error.trim() : "";
  if (code === "order_not_found") return "来源订单当前不可用，可能已被删除。";
  if (code === "order_management_disabled") return "当前商户未开通订单管理。";
  if (code === "enterprise_management_disabled") return "当前商户未开通企业管理。";
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号无权查看来源订单。";
  }
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再试。";
  if (code === "invalid_source_order_request") return "来源订单信息无效，请刷新后重试。";
  return "来源订单读取失败，请稍后重试。";
}

export function getMerchantLinkedOrderSummaryErrorMessage(error: unknown) {
  const code = typeof error === "string" ? error.trim() : "";
  if (code === "task_not_found" || code === "order_not_found") {
    return "当前任务没有可查看的关联订单摘要。";
  }
  if (code === "order_management_disabled") return "当前商户未开通订单管理。";
  if (code === "enterprise_management_disabled") return "当前商户未开通企业管理。";
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号无权查看关联订单摘要。";
  }
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再试。";
  if (code === "invalid_linked_order_summary_request") {
    return "关联订单摘要请求无效，请刷新后重试。";
  }
  return "关联订单摘要读取失败，请稍后重试。";
}

export function buildMerchantOrderTaskDraft(
  order: MerchantOrderRecord,
): MerchantOrderTaskDraft {
  const sourceId = order.id.trim().slice(0, 200);
  const title = `订单跟进 · ${sourceId}`.slice(0, 240);
  const description = [
    `订单号：${sourceId}`,
    `订单状态：${getMerchantOrderStatusLabel(order.status)}`,
    `商品数量：${Math.max(0, Math.trunc(order.totalQuantity))} 件`,
    `订单金额：${formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}`,
  ]
    .join("\n")
    .slice(0, 10_000);

  return {
    sourceType: MERCHANT_ORDER_TASK_SOURCE_TYPE,
    sourceId,
    title,
    description,
    priority: "normal",
  };
}
