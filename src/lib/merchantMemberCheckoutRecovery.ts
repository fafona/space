import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import type { MerchantRedemptionCheckoutReceipt, MerchantRedemptionCheckoutSummary } from "@/lib/merchantRedemptionCheckout";
import { cashierCheckoutBlocksNewSale, cashierCheckoutErrorAfterRecovery, readCashierCheckoutReceipt, readCashierCheckoutSummary } from "@/lib/merchantRedemptionCheckoutRecovery";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";

export type MemberCheckoutRecoverySnapshot = Readonly<{
  phase: "checking" | "ready" | "error";
  checkout: MerchantRedemptionCheckoutSummary | null;
  busy: boolean;
  error: string;
  notice: string;
}>;
export type MemberCheckoutConfirmedResult = { receipt: MerchantRedemptionCheckoutReceipt; replayed: boolean };
export type MemberCheckoutRecoveryAction = "retry" | "cancel" | "ack";
export type MemberProductCheckoutRequest = {
  action: "member_operation"; type: "redeem"; siteId: string; membershipId: string;
  redemptionItemId: string; redemptionQuantity: number; points: number; balanceAmount: number;
  note: string; rechargePlanId: string;
};

export function memberOperationUsesProductCheckout(type: string, redemptionItemId: string) {
  return type === "redeem" && Boolean(redemptionItemId.trim());
}

export function readMemberScopedKeyword(scope: object, valueScope: object, keyword: string) {
  return scope === valueScope ? keyword : "";
}

export function memberCheckoutRecoveryError(value: unknown) {
  const message = typeof value === "string" ? value.trim().slice(0, 1000) : "";
  if (message === "redemption_checkout_quote_changed") return "原单价格或规则已变化。请放弃尚未完成的原结算，确认后重新选购；系统不会按新价格自动扣减。";
  if (message === "membership_balance_insufficient") return "原单当前积分不足，尚未完成。可以补足积分后重试原单，或放弃尚未完成的原结算。";
  if (message === "membership_redemption_stock_insufficient") return "原单商品库存不足，尚未完成。请核对库存后重试原单，或放弃尚未完成的原结算。";
  if (message === "membership_not_active" || message === "membership_not_found") return "原单会员已停用或不存在。请核对原单状态，勿重新扣减。";
  if (message === "redemption_pending_checkout_exists" || message === "redemption_checkout_pending_exists" || message === "redemption_checkout_unacknowledged") return "还有一笔原结算等待处理或确认，请先核对原单再开始下一单。";
  if (message === "redemption_operation_conflict") return "原结算编号已绑定其他请求，请先核对原单，勿重复扣减。";
  if (message === "redemption_checkout_response_invalid") return "无法验证服务器返回的原单结果，已暂停新商品兑换。请重新核对状态。";
  if (message === "redemption_legacy_operation_requires_review") return "发现旧版未核实的结算记录，请先由负责人核对会员、库存和卡券记录。";
  if (["merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict"].includes(message)) return "会员积分、库存或卡券刚被其他操作更新，请核对原单后重试。";
  return "暂时无法确认原结算结果，请重新读取原单状态。不要修改商品或会员后重复扣减。";
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

class CheckoutResponseError extends Error {
  constructor(message: string, readonly status: number, readonly businessRejected: boolean) { super(message); }
}

function confirmedPreStageRejection(error: unknown) {
  if (!(error instanceof CheckoutResponseError) || !error.businessRejected || ![400, 409].includes(error.status)) return "";
  if (error.message === "membership_balance_insufficient") return "服务器已拒绝本次商品兑换：积分不足。核对无原单后，可补足积分再重新确认。";
  if (error.message === "membership_redemption_stock_insufficient") return "服务器已拒绝本次商品兑换：库存不足。核对无原单后，可修正商品或数量再重新确认。";
  if (error.message === "membership_redemption_quantity_invalid") return "服务器已拒绝本次商品兑换：数量无效。核对无原单后，可修正数量再重新确认。";
  return "";
}

/** A controller owns one live UI authorization scope. Requests and receipts stay in memory only. */
export function createMemberCheckoutRecoveryController(options: {
  siteId: string;
  enabled: boolean;
  requestApi: MerchantBusinessApiClient;
  scope?: object;
  createOperationId?: () => string;
}) {
  const allowed = options.enabled && /^\d{8}$/.test(options.siteId);
  const initial = (): MemberCheckoutRecoverySnapshot => ({ phase: allowed ? "checking" : "ready", checkout: null, busy: false, error: "", notice: "" });
  let snapshot = initial();
  let active = false;
  let epoch = 0;
  let sequence = 0;
  let mutationBusy = false;
  let uncertainOperationId = "";
  let rejectedAttempt: { operationId: string; message: string } | null = null;
  let failedMutation: { operationId: string; message: string } | null = null;
  let attempt: { operationId: string; fingerprint: string } | null = null;
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  const current = (ticket: { epoch: number; sequence: number }) => active && epoch === ticket.epoch && sequence === ticket.sequence;
  const begin = () => ({ epoch, sequence: ++sequence });
  const publish = (changes: Partial<MemberCheckoutRecoverySnapshot>) => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  };
  const call = async (path: string, init: RequestInit) => {
    const controller = new AbortController();
    requests.add(controller);
    try {
      const response = await options.requestApi(path, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      const body = payloadRecord(payload);
      const businessRejected = !response.ok && typeof body?.message === "string" && body.ok !== true &&
        (body.error === body.message || (body.ok === false && body.error === undefined));
      if (!response.ok || body?.ok !== true) throw new CheckoutResponseError(typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "merchant_transaction_unavailable", response.status, businessRejected);
      return payload;
    } finally { requests.delete(controller); }
  };
  const read = async (ticket: { epoch: number; sequence: number }) => {
    publish({ phase: "checking", checkout: null });
    try {
      const payload = await call(`/api/merchant-admin/redemption-checkout?siteId=${encodeURIComponent(options.siteId)}`, { method: "GET", headers: { accept: "application/json" } });
      if (!current(ticket)) return undefined;
      let checkout = readCashierCheckoutSummary(payload, options.siteId);
      if (!checkout && uncertainOperationId) {
        const exact = await call(`/api/merchant-admin/redemption-checkout?siteId=${encodeURIComponent(options.siteId)}&operationId=${encodeURIComponent(uncertainOperationId)}`, { method: "GET", headers: { accept: "application/json" } });
        if (!current(ticket)) return undefined;
        checkout = readCashierCheckoutSummary(exact, options.siteId);
        if (checkout && checkout.operationId !== uncertainOperationId) throw new Error("redemption_checkout_response_invalid");
      }
      // A real context supersedes the first request's pre-stage rejection evidence.
      if (checkout) rejectedAttempt = null;
      if (!checkout && uncertainOperationId) {
        if (rejectedAttempt?.operationId === uncertainOperationId) {
          const notice = rejectedAttempt.message;
          attempt = null; uncertainOperationId = ""; failedMutation = null; rejectedAttempt = null;
          publish({ phase: "ready", checkout: null, error: "", notice });
          return null;
        }
        publish({ phase: "error", checkout: null, error: "暂未查询到原单，不能据此认定请求未发送。请先核对兑换记录，再重新读取原单状态。" });
        return undefined;
      }
      const nextError = cashierCheckoutErrorAfterRecovery(snapshot.error, checkout, failedMutation);
      publish({ phase: "ready", checkout: checkout?.acknowledgedAt ? null : checkout, error: checkout?.status === "pending" ? nextError : "" });
      if (checkout?.acknowledgedAt) { attempt = null; uncertainOperationId = ""; failedMutation = null; rejectedAttempt = null; }
      return checkout;
    } catch (error) {
      if (current(ticket)) publish({ phase: "error", checkout: null, error: memberCheckoutRecoveryError(error instanceof Error ? error.message : "") });
      return undefined;
    }
  };
  const confirmed = (payload: unknown, operationId: string): MemberCheckoutConfirmedResult => {
    const data = payloadRecord(payload);
    if (data?.ok !== true || typeof data.replayed !== "boolean") throw new Error("redemption_checkout_response_invalid");
    // The membership response has cashier-specific redaction. Never expose or merge it into the member list.
    const receipt = readCashierCheckoutReceipt(data.receipt, options.siteId, operationId);
    publish({ phase: "ready", checkout: { operationId, status: "committed", createdAt: receipt.createdAt, acknowledgedAt: null, result: receipt },
      error: "", notice: "原结算已完成。请核对服务器原单结果，确认后开始下一单。" });
    uncertainOperationId = ""; failedMutation = null; rejectedAttempt = null;
    return { receipt, replayed: data.replayed };
  };
  const failed = (error: unknown, operationId: string) => {
    const message = memberCheckoutRecoveryError(error instanceof Error ? error.message : "");
    uncertainOperationId = operationId;
    failedMutation = { operationId, message };
    publish({ error: message, notice: "" });
  };
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() {
      active = true; epoch += 1; sequence += 1; mutationBusy = false;
      snapshot = initial();
      return controller.refresh();
    },
    deactivate() {
      active = false; epoch += 1; sequence += 1; mutationBusy = false;
      requests.forEach((request) => request.abort()); requests.clear();
      snapshot = initial(); attempt = null; uncertainOperationId = ""; failedMutation = null; rejectedAttempt = null;
    },
    isActive: () => active,
    blocksNewSale: () => !active || !allowed || mutationBusy || cashierCheckoutBlocksNewSale(snapshot.phase, snapshot.checkout),
    async refresh() {
      if (!active || !allowed || mutationBusy) return undefined;
      return read(begin());
    },
    async submitOriginal(body: MemberProductCheckoutRequest): Promise<MemberCheckoutConfirmedResult | null> {
      if (controller.blocksNewSale() || body.action !== "member_operation" || body.type !== "redeem" || !body.redemptionItemId || body.siteId !== options.siteId) return null;
      const requestBody = structuredClone(body);
      // Take the mutex before the preflight GET, not after it.
      mutationBusy = true;
      publish({ busy: true, error: "", notice: "" });
      const ticket = begin();
      let operationId = "";
      let mutationStarted = false;
      try {
        const original = await read(ticket);
        if (!current(ticket) || original === undefined || (original && !original.acknowledgedAt)) return null;
        const fingerprint = JSON.stringify(requestBody);
        if (attempt && attempt.fingerprint !== fingerprint) throw new Error("redemption_operation_conflict");
        operationId = attempt?.operationId || (options.createOperationId?.() ?? createClientMutationOperationId("member-operation"));
        attempt = { operationId, fingerprint };
        mutationStarted = true;
        const payload = await call("/api/memberships", { method: "PATCH", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ ...requestBody, operationId }) });
        if (!current(ticket)) return null;
        return confirmed(payload, operationId);
      } catch (error) {
        if (current(ticket)) {
          failed(error, operationId || attempt?.operationId || "");
          const rejection = mutationStarted ? confirmedPreStageRejection(error) : "";
          if (rejection && operationId) rejectedAttempt = { operationId, message: rejection };
        }
        return null;
      } finally {
        if (current(ticket)) {
          mutationBusy = false; publish({ busy: false });
          if (mutationStarted && uncertainOperationId) await controller.refresh();
        }
      }
    },
    async act(action: MemberCheckoutRecoveryAction): Promise<MemberCheckoutConfirmedResult | null> {
      const checkout = snapshot.checkout;
      if (!active || !allowed || mutationBusy || snapshot.phase !== "ready" || !checkout ||
        (action === "ack" ? checkout.status === "pending" : checkout.status !== "pending")) return null;
      mutationBusy = true;
      rejectedAttempt = null;
      publish({ busy: true, error: "", notice: "" });
      const ticket = begin();
      let refreshNeeded = false;
      try {
        const payload = await call("/api/merchant-admin/redemption-checkout", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ siteId: options.siteId, operationId: checkout.operationId, action }) });
        if (!current(ticket)) return null;
        if (action === "retry") return confirmed(payload, checkout.operationId);
        const result = readCashierCheckoutSummary(payload, options.siteId);
        if (result && result.operationId !== checkout.operationId) throw new Error("redemption_checkout_response_invalid");
        if (action === "ack") {
          if (!result || !result.acknowledgedAt || result.status === "pending") throw new Error("redemption_checkout_response_invalid");
          attempt = null; uncertainOperationId = ""; failedMutation = null; rejectedAttempt = null;
          publish({ phase: "ready", checkout: null, error: "", notice: "原单已确认，可以开始下一单。" });
        } else {
          if (!result || result.acknowledgedAt) throw new Error("redemption_checkout_response_invalid");
          publish({ phase: "ready", checkout: result, error: "", notice: result.status === "committed"
            ? "原结算已经完成，未取消、未撤销任何扣减。请核对原单后确认。"
            : result.status === "cancelled" ? "尚未完成的原结算已放弃。请确认后开始下一单。" : "原结算仍待处理，请重新核对。" });
          if (result.status !== "pending") { uncertainOperationId = ""; failedMutation = null; }
        }
        return null;
      } catch (error) {
        if (current(ticket)) { failed(error, checkout.operationId); refreshNeeded = true; }
        return null;
      } finally {
        if (current(ticket)) {
          mutationBusy = false; publish({ busy: false });
          if (refreshNeeded) await controller.refresh();
        }
      }
    },
  };
  return controller;
}

export type MemberCheckoutRecoveryController = ReturnType<typeof createMemberCheckoutRecoveryController>;
