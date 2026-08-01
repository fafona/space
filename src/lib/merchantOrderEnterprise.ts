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
