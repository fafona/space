import {
  formatMerchantOrderAmount,
  getMerchantOrderStatusLabel,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import type { MerchantTaskPriority } from "@/lib/merchantEnterprise";

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
