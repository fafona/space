import type { MerchantRedemptionReceiptLine } from "@/lib/merchantReceiptPrint";

/** A committed quote/result. No customer profile or authentication data. */
export type MerchantRedemptionCheckoutReceipt = {
  version: 1;
  operationId: string;
  siteId: string;
  membershipId: string;
  transactionId: string;
  createdAt: string;
  beforePointBalance: number;
  afterPointBalance: number;
  totalQuantity: number;
  grossPoints: number;
  couponPointDiscountTotal: number;
  totalPoints: number;
  couponCount: number;
  note: string;
  lines: MerchantRedemptionReceiptLine[];
};

export type MerchantRedemptionCheckoutQuote = Pick<MerchantRedemptionCheckoutReceipt,
  "totalQuantity" | "grossPoints" | "couponPointDiscountTotal" | "totalPoints" | "couponCount" | "lines">;
export type MerchantRedemptionCheckoutRequest = {
  membershipId: string;
  items: Array<Record<string, string | number>>;
  note: string;
  settingsVersion: string | null;
  couponVersion: string | null;
  quote: MerchantRedemptionCheckoutQuote;
};
export type MerchantRedemptionCheckoutSummary = {
  operationId: string;
  status: "pending" | "committed" | "cancelled";
  createdAt: string;
  acknowledgedAt: string | null;
  result: MerchantRedemptionCheckoutReceipt | null;
};
export type MerchantRedemptionCheckoutContext = MerchantRedemptionCheckoutSummary & {
  fingerprint: string;
  membershipId: string;
  request: MerchantRedemptionCheckoutRequest;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, limit: number) { return typeof value === "string" && value.length <= limit; }
function integer(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function stamp(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

/** Reject malformed success responses; never reconstruct amounts from UI state. */
export function isMerchantRedemptionCheckoutReceipt(value: unknown): value is MerchantRedemptionCheckoutReceipt {
  if (!record(value) || value.version !== 1 || !text(value.operationId, 120) || !value.operationId ||
    !text(value.siteId, 64) || !value.siteId || !text(value.membershipId, 160) || !value.membershipId ||
    !text(value.transactionId, 160) || !value.transactionId || !stamp(value.createdAt) || !text(value.note, 500)) return false;
  if (Object.keys(value).some((key) => !["version", "operationId", "siteId", "membershipId", "transactionId", "createdAt",
    "beforePointBalance", "afterPointBalance", "totalQuantity", "grossPoints", "couponPointDiscountTotal", "totalPoints", "couponCount", "note", "lines"].includes(key))) return false;
  for (const key of ["beforePointBalance", "afterPointBalance", "totalQuantity", "grossPoints", "couponPointDiscountTotal", "totalPoints", "couponCount"]) {
    if (!integer(value[key])) return false;
  }
  if (!Array.isArray(value.lines) || value.lines.length === 0 || value.lines.length > 100) return false;
  let quantity = 0; let gross = 0; let discount = 0;
  for (const line of value.lines) {
    if (!record(line) || !text(line.code, 200) || !text(line.name, 200) || !String(line.name).trim() || !text(line.categoryName, 200) ||
      !text(line.couponDiscountLabel, 200) || !integer(line.quantity) || Number(line.quantity) < 1 ||
      Number(line.quantity) > 9999 || !integer(line.unitPoints) || !integer(line.subtotalPoints) ||
      !integer(line.couponPointDiscount) || Number(line.subtotalPoints) !== Number(line.unitPoints) * Number(line.quantity)) return false;
    if (Object.keys(line).some((key) => !["code", "name", "categoryName", "quantity", "unitPoints", "subtotalPoints", "couponDiscountLabel", "couponPointDiscount"].includes(key))) return false;
    quantity += Number(line.quantity); gross += Number(line.subtotalPoints); discount += Number(line.couponPointDiscount);
  }
  return [quantity, gross, discount].every(Number.isSafeInteger) && quantity === value.totalQuantity &&
    gross === value.grossPoints && discount === value.couponPointDiscountTotal && discount <= gross &&
    Number(value.totalPoints) === gross - discount && Number(value.couponCount) <= value.lines.length;
}

export function isMerchantRedemptionCheckoutSummary(value: unknown): value is MerchantRedemptionCheckoutSummary {
  return record(value) && text(value.operationId, 120) && Boolean(value.operationId) &&
    ["pending", "committed", "cancelled"].includes(String(value.status)) && stamp(value.createdAt) &&
    (value.acknowledgedAt === null || stamp(value.acknowledgedAt)) &&
    (value.status !== "pending" || value.acknowledgedAt === null) &&
    (value.status === "committed" ? isMerchantRedemptionCheckoutReceipt(value.result) : value.result === null);
}

export function summarizeMerchantRedemptionCheckout(context: MerchantRedemptionCheckoutContext): MerchantRedemptionCheckoutSummary {
  return { operationId: context.operationId, status: context.status, createdAt: context.createdAt,
    acknowledgedAt: context.acknowledgedAt, result: context.result };
}
