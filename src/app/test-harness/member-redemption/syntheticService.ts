import type { MerchantBusinessApiRequestInit } from "@/lib/merchantBusinessApiClient";
import type { MerchantRedemptionCheckoutReceipt, MerchantRedemptionCheckoutSummary } from "@/lib/merchantRedemptionCheckout";
import { normalizeMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import { normalizeMerchantMembershipRecord, toMerchantMembershipListItem } from "@/lib/merchantMemberships";

export const MEMBER_HARNESS_SITE = "10000000";
export const MEMBER_HARNESS_CREATED = "2026-09-08T10:00:00.000Z";
export type HarnessActor = "employee-A" | "employee-B" | "owner";
export type HarnessScenario = "empty" | "pending" | "committed" | "first-response-lost" | "retry-response-lost"
  | "read-error" | "quote-changed" | "cancel-wins" | "commit-wins" | "deleted-member" | "delayed";

type ActorState = {
  actor: HarnessActor;
  scenario: HarnessScenario;
  checkoutAllowed: boolean;
  readError: boolean;
  deleted: boolean;
  loseResponse: boolean;
  writes: number;
  balance: number;
  stock: number;
  checkouts: Record<string, MerchantRedemptionCheckoutSummary>;
  preparedResults: Record<string, MerchantRedemptionCheckoutReceipt>;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function error(message: string, status = 409) { return json({ ok: false, message }, status); }
function actorLabel(actor: HarnessActor) { return actor === "owner" ? "合成负责人" : `合成员工 ${actor.endsWith("A") ? "A" : "B"}`; }

function makeReceipt(actor: HarnessActor, operationId: string, quantity = 4, before = 100, note = "服务器保存的原单，不是当前表单", unitPoints = 20):
MerchantRedemptionCheckoutReceipt {
  const total = quantity * unitPoints;
  return { version: 1, operationId, siteId: MEMBER_HARNESS_SITE, membershipId: `member-${actor}`,
    transactionId: `transaction-${operationId}`, createdAt: MEMBER_HARNESS_CREATED,
    beforePointBalance: before, afterPointBalance: before - total, totalQuantity: quantity,
    grossPoints: total, couponPointDiscountTotal: 0, totalPoints: total, couponCount: 0, note,
    lines: [{ code: "gift-one", name: `合成兑换商品 · ${actorLabel(actor)}`, categoryName: "合成分类", quantity,
      unitPoints, subtotalPoints: total, couponDiscountLabel: "", couponPointDiscount: 0 }] };
}

function makeActor(actor: HarnessActor, scenario: HarnessScenario): ActorState {
  const committed = scenario === "committed" || scenario === "deleted-member";
  const state: ActorState = { actor, scenario, checkoutAllowed: true, readError: scenario === "read-error",
    deleted: scenario === "deleted-member", loseResponse: scenario === "first-response-lost" || scenario === "retry-response-lost",
    writes: committed ? 1 : 0, balance: committed ? 20 : 100, stock: committed ? 6 : 10, checkouts: {}, preparedResults: {} };
  if (scenario !== "empty" && scenario !== "first-response-lost") {
    const operationId = `original-${actor}`;
    const result = makeReceipt(actor, operationId);
    state.preparedResults[operationId] = result;
    state.checkouts[operationId] = { operationId, status: committed ? "committed" : "pending",
      acknowledgedAt: null, createdAt: MEMBER_HARNESS_CREATED, result: committed ? result : null };
  }
  return state;
}

function currentCheckout(state: ActorState, operationId?: string | null) {
  return operationId ? state.checkouts[operationId] ?? null
    : Object.values(state.checkouts).find((checkout) => checkout.acknowledgedAt === null) ?? null;
}

function member(state: ActorState) {
  if (state.deleted) return null;
  const serial = state.actor === "employee-A" ? 1 : state.actor === "employee-B" ? 2 : 3;
  const record = normalizeMerchantMembershipRecord({ id: `member-${state.actor}`, siteId: MEMBER_HARNESS_SITE,
    memberNo: `1000000000000${serial}`, serial, accountId: `synthetic-account-${state.actor}`,
    userId: `synthetic-user-${state.actor}`, email: `${state.actor}@example.test`, name: `${actorLabel(state.actor)}的测试会员`,
    status: "active", joinedAt: MEMBER_HARNESS_CREATED, updatedAt: MEMBER_HARNESS_CREATED,
    pointBalance: state.balance, balanceAmount: 0, growthValue: 0, transactions: Object.values(state.checkouts)
      .filter((checkout) => checkout.status === "committed" && checkout.result)
      .map((checkout) => ({ id: checkout.result!.transactionId, type: "redeem", status: "completed", at: MEMBER_HARNESS_CREATED,
        pointDelta: -checkout.result!.totalPoints, balanceDelta: 0, growthDelta: 0, note: checkout.result!.note,
        operatorId: state.actor })) });
  if (!record) throw new Error("invalid_synthetic_member");
  return { ...toMerchantMembershipListItem(record), insight: { pointBalance: state.balance, balanceAmount: 0,
    availableCouponCount: 0, availableCoupons: [], couponHistory: [], totalSpendAmount: 0, totalOrderCount: 0,
    consumptionFrequencyPerMonth: 0, averageOrderAmount: 0, recentPurchaseAt: null, firstPurchaseAt: null,
    yearlySpendAmount: 0, productPreferences: [] } };
}

function commit(state: ActorState, operationId: string) {
  const checkout = state.checkouts[operationId];
  if (!checkout || checkout.status === "cancelled") throw new Error("synthetic_commit_without_pending");
  if (checkout.status === "committed") return true;
  const result = state.preparedResults[operationId];
  if (!result) throw new Error("synthetic_missing_prepared_result");
  state.checkouts[operationId] = { ...checkout, status: "committed", result: structuredClone(result) };
  state.writes += 1;
  state.balance = result.afterPointBalance;
  state.stock -= result.totalQuantity;
  return false;
}

/** A pure synthetic server: no fetch, browser storage, credentials or real APIs. */
export function createMemberRedemptionHarnessService() {
  const actors: Record<HarnessActor, ActorState> = {
    "employee-A": makeActor("employee-A", "pending"), "employee-B": makeActor("employee-B", "empty"), owner: makeActor("owner", "empty"),
  };
  const calls: string[] = [];
  let callSequence = 0;

  const service = {
    reset(actor: HarnessActor, scenario: HarnessScenario) { actors[actor] = makeActor(actor, scenario); },
    allowCheckout(actor: HarnessActor, allowed: boolean) { actors[actor].checkoutAllowed = allowed; },
    recoverReads(actor: HarnessActor) { actors[actor].readError = false; },
    snapshot() {
      return { calls: [...calls], actors: Object.fromEntries(Object.entries(actors).map(([actor, state]) => [actor, {
        scenario: state.scenario, writes: state.writes, balance: state.balance, stock: state.stock,
        checkoutAllowed: state.checkoutAllowed, readError: state.readError, deleted: state.deleted,
        checkout: structuredClone(currentCheckout(state)), receipts: Object.keys(state.checkouts).length,
      }])) as Record<HarnessActor, { scenario: HarnessScenario; writes: number; balance: number; stock: number;
        checkoutAllowed: boolean; readError: boolean; deleted: boolean; checkout: MerchantRedemptionCheckoutSummary | null; receipts: number }> };
    },
    async request(actor: HarnessActor, path: string, init: MerchantBusinessApiRequestInit = {}, revision = 0): Promise<Response> {
      const state = actors[actor]; // Capture the old actor for delayed-response isolation tests.
      const sequence = ++callSequence;
      const method = (init.method ?? "GET").toUpperCase();
      const url = new URL(path, "https://synthetic.invalid");
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = typeof init.body === "string" ? JSON.parse(init.body) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch { return error("invalid_synthetic_request", 400); }
      calls.push(`#${sequence} ${actor} [scope ${revision}] ${method} ${url.pathname}${url.search}${body.action ? ` action=${String(body.action)}` : ""}${body.operationId ? ` op=${String(body.operationId)}` : ""}`);
      const finish = (response: Response) => { calls.push(`#${sequence} <- ${response.status} writes=${state.writes} context=${currentCheckout(state)?.status ?? "none"}`); return response; };
      if (url.origin !== "https://synthetic.invalid" || !url.pathname.startsWith("/api/")) return finish(error("unexpected_synthetic_path", 404));
      const siteId = method === "GET" ? url.searchParams.get("siteId") : body.siteId;
      if (siteId !== MEMBER_HARNESS_SITE) return finish(error("invalid_site_id", 400));

      if (url.pathname === "/api/merchant-admin/redemption-checkout") {
        if (!state.checkoutAllowed) return finish(error("forbidden", 403));
        if (method === "GET") {
          if (state.readError) return finish(error("merchant_transaction_unavailable", 503));
          const checkout = structuredClone(currentCheckout(state, url.searchParams.get("operationId")));
          // Deliberately do not cancel the response when the actor changes.
          if (state.scenario === "delayed") await new Promise((resolve) => setTimeout(resolve, 1800));
          return finish(json({ ok: true, checkout }));
        }
        const operationId = typeof body.operationId === "string" ? body.operationId : "";
        const checkout = currentCheckout(state, operationId);
        if (!checkout) return finish(error("redemption_checkout_not_found", 404));
        if (body.action === "retry") {
          if (checkout.status === "cancelled") return finish(error("redemption_checkout_cancelled"));
          if (state.scenario === "quote-changed" && checkout.status === "pending") return finish(error("redemption_checkout_quote_changed"));
          if (state.scenario === "cancel-wins" && checkout.status === "pending") {
            state.checkouts[operationId] = { ...checkout, status: "cancelled", result: null };
            return finish(error("redemption_checkout_cancelled"));
          }
          const replayed = commit(state, operationId);
          if (state.scenario === "retry-response-lost" && state.loseResponse) {
            state.loseResponse = false;
            return finish(error("merchant_transaction_unavailable", 503));
          }
          return finish(json({ ok: true, membership: member(state), receipt: state.checkouts[operationId].result, replayed }));
        }
        if (body.action === "cancel") {
          if (state.scenario === "commit-wins" && checkout.status === "pending") commit(state, operationId);
          else if (checkout.status === "pending") state.checkouts[operationId] = { ...checkout, status: "cancelled", result: null };
          return finish(json({ ok: true, checkout: state.checkouts[operationId] }));
        }
        if (body.action === "ack") {
          if (checkout.status === "pending") return finish(error("redemption_checkout_not_terminal"));
          state.checkouts[operationId] = { ...checkout, acknowledgedAt: checkout.acknowledgedAt ?? MEMBER_HARNESS_CREATED };
          return finish(json({ ok: true, checkout: state.checkouts[operationId] }));
        }
        return finish(error("unexpected_synthetic_action", 400));
      }
      if (url.pathname === "/api/membership-settings" && method === "GET") {
        const settings = normalizeMerchantMembershipSettings(MEMBER_HARNESS_SITE, { updatedAt: MEMBER_HARNESS_CREATED,
          redemptionCategories: [{ id: "synthetic-category", name: "合成分类", enabled: true }],
          redemptionItems: [{ id: "gift-one", code: "SYNTHETIC-GIFT", name: "合成兑换商品（20积分）", enabled: true,
            categoryId: "synthetic-category", pointsCost: state.scenario === "quote-changed" ? 40 : 20, stock: state.stock }],
          printSettings: { enabled: false, autoPrintRedemptionReceipt: false }, rechargePlans: [] });
        return finish(json({ ok: true, settings, version: MEMBER_HARNESS_CREATED }));
      }
      if (url.pathname === "/api/memberships" && method === "GET") {
        const membership = member(state);
        const query = url.searchParams.get("query")?.toLowerCase() ?? "";
        const memberId = url.searchParams.get("membershipId");
        const list = membership && (!memberId || memberId === membership.id) && (!query || JSON.stringify(membership).toLowerCase().includes(query)) ? [membership] : [];
        return finish(json({ ok: true, memberships: list, membership, total: list.length, allTotal: membership ? 1 : 0,
          hasMore: false, version: MEMBER_HARNESS_CREATED }));
      }
      if (url.pathname === "/api/memberships" && method === "PATCH" && body.action === "member_operation") {
        if (body.membershipId !== `member-${actor}` || state.deleted) return finish(error("membership_not_found", 404));
        if (body.type === "redeem" && !state.checkoutAllowed) return finish(error("forbidden", 403));
        if (body.type === "redeem" && body.redemptionItemId) {
          const operationId = typeof body.operationId === "string" ? body.operationId : "";
          if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(operationId) || body.redemptionItemId !== "gift-one") return finish(error("invalid_synthetic_request", 400));
          const existing = currentCheckout(state, operationId);
          if (existing?.status === "cancelled") return finish(error("redemption_checkout_cancelled"));
          if (existing?.status === "committed") return finish(json({ ok: true, membership: member(state), receipt: existing.result, replayed: true }));
          if (currentCheckout(state) && !existing) return finish(error("redemption_pending_checkout_exists"));
          const quantity = Number(body.redemptionQuantity ?? 1);
          const unitPoints = state.scenario === "quote-changed" ? 40 : 20;
          if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > state.stock) return finish(error("membership_redemption_stock_insufficient"));
          if (state.balance < quantity * unitPoints) return finish(error("membership_balance_insufficient"));
          state.preparedResults[operationId] = makeReceipt(actor, operationId, quantity, state.balance, String(body.note ?? ""), unitPoints);
          state.checkouts[operationId] = { operationId, status: "pending", createdAt: MEMBER_HARNESS_CREATED, acknowledgedAt: null, result: null };
          commit(state, operationId);
          if (state.scenario === "first-response-lost" && state.loseResponse) {
            state.loseResponse = false;
            return finish(error("merchant_transaction_unavailable", 503));
          }
          return finish(json({ ok: true, membership: member(state), receipt: state.checkouts[operationId].result, replayed: false }));
        }
        // Non-product operations stay on the legacy response shape. Never send
        // them through a real endpoint or invent a checkout receipt for them.
        const points = Number(body.points ?? 0);
        if (!Number.isSafeInteger(points) || points <= 0) return finish(error("membership_operation_empty", 400));
        const nextBalance = state.balance + (body.type === "recharge" ? points : -points);
        if (nextBalance < 0) return finish(error("membership_balance_insufficient"));
        state.balance = nextBalance; state.writes += 1;
        return finish(json({ ok: true, membership: member(state) }));
      }
      return finish(error("unexpected_synthetic_request", 404));
    },
  };
  return service;
}
