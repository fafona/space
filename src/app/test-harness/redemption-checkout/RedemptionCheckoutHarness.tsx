"use client";

import { useMemo, useRef, useState } from "react";
import MerchantPointRedemptionCashier from "@/components/admin/MerchantPointRedemptionCashier";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import type { MerchantRedemptionCheckoutReceipt, MerchantRedemptionCheckoutSummary } from "@/lib/merchantRedemptionCheckout";
import { normalizeMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import { normalizeMerchantMembershipRecord, toMerchantMembershipListItem } from "@/lib/merchantMemberships";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const SITE = "10000000";
const CREATED = "2026-09-08T10:00:00.000Z";
type Scenario = "pending" | "committed" | "read-error" | "quote-changed" | "cancel-race" | "new-response-lost" | "retry-response-lost" | "deleted-member" | "delayed" | "empty";
type HarnessState = { actor: string; scenario: Scenario; checkout: MerchantRedemptionCheckoutSummary | null; calls: string[]; writes: number };

function receipt(actor: string, operationId = `original-${actor}`): MerchantRedemptionCheckoutReceipt {
  return { version: 1, operationId, siteId: SITE, membershipId: `member-${actor}`, transactionId: `transaction-${operationId}`,
    createdAt: CREATED, beforePointBalance: 100, afterPointBalance: 20, totalQuantity: 1, grossPoints: 80,
    couponPointDiscountTotal: 0, totalPoints: 80, couponCount: 0, note: "服务器原单，不是当前购物车",
    lines: [{ code: "original-item", name: "服务器原单商品", categoryName: "原单分类", quantity: 1, unitPoints: 80,
      subtotalPoints: 80, couponDiscountLabel: "", couponPointDiscount: 0 }] };
}
function fixture(actor: string, scenario: Scenario): HarnessState {
  const result = receipt(actor);
  return { actor, scenario, calls: [], writes: scenario === "committed" ? 1 : 0,
    checkout: scenario === "empty" || scenario === "new-response-lost" ? null : {
      operationId: result.operationId, status: scenario === "committed" ? "committed" : "pending", createdAt: CREATED,
      acknowledgedAt: null, result: scenario === "committed" ? result : null,
    } };
}
function membership(state: HarnessState) {
  if (state.scenario === "deleted-member") return null;
  const source = normalizeMerchantMembershipRecord({ id: `member-${state.actor}`, siteId: SITE,
    memberNo: state.actor === "A" ? "10000000000001" : "10000000000002", serial: state.actor === "A" ? 1 : 2,
    accountId: `synthetic-${state.actor}`, status: "active", name: `合成会员 ${state.actor}`, joinedAt: CREATED, updatedAt: CREATED,
    pointBalance: state.scenario === "new-response-lost" && !state.checkout ? 100 : 20, balanceAmount: 0, growthValue: 0, transactions: [] });
  if (!source) throw new Error("invalid_harness_member");
  return toMerchantMembershipListItem(source);
}
function commit(state: HarnessState, operationId: string) {
  if (state.checkout?.status !== "committed") state.writes += 1;
  state.checkout = { operationId, status: "committed", createdAt: CREATED, acknowledgedAt: null, result: receipt(state.actor, operationId) };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

/** All business responses are in-memory synthetic fixtures; no business API is called. */
export default function RedemptionCheckoutHarness() {
  const stateRef = useRef(fixture("A", "pending"));
  const [revision, setRevision] = useState(0);
  const [display, setDisplay] = useState({ actor: "A", writes: 0, calls: [] as string[] });
  const [printAllowed, setPrintAllowed] = useState(false);
  const apiClient = useMemo<MerchantBusinessApiClient>(() => {
    const state = stateRef.current;
    return async (path, init = {}) => {
      const url = new URL(path, "http://local-harness.invalid");
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      state.calls.push(`${state.actor} [case ${revision}] ${method} ${url.pathname}${body.action ? ` ${body.action}` : ""}`);
      try {
      if (url.pathname === "/api/merchant-admin/redemption-checkout") {
        if (method === "GET") {
          if (state.scenario === "read-error") return json({ ok: false, message: "merchant_transaction_unavailable" }, 503);
          const checkout = structuredClone(state.checkout?.acknowledgedAt ? null : state.checkout);
          if (state.scenario === "delayed") await new Promise((resolve) => setTimeout(resolve, 1800));
          return json({ ok: true, checkout });
        }
        if (body.operationId !== state.checkout?.operationId) return json({ ok: false, message: "redemption_operation_conflict" }, 409);
        if (body.action === "retry") {
          if (state.scenario === "quote-changed") return json({ ok: false, message: "redemption_checkout_quote_changed" }, 409);
          const replayed = state.checkout?.status === "committed";
          commit(state, String(body.operationId));
          if (state.scenario === "retry-response-lost") return json({ ok: false, message: "merchant_transaction_unavailable" }, 503);
          return json({ ok: true, membership: membership(state), receipt: state.checkout?.result, replayed });
        }
        if (body.action === "cancel") {
          if (state.scenario === "cancel-race") commit(state, String(body.operationId));
          else if (state.checkout?.status === "pending") state.checkout = { ...state.checkout, status: "cancelled" };
          return json({ ok: true, checkout: state.checkout });
        }
        if (body.action === "ack") {
          if (!state.checkout || state.checkout.status === "pending") return json({ ok: false, message: "redemption_checkout_pending" }, 409);
          state.checkout = { ...state.checkout, acknowledgedAt: CREATED };
          return json({ ok: true, checkout: state.checkout });
        }
      }
      if (url.pathname === "/api/merchant-admin/redemption-cashier") {
        const itemStock = state.scenario === "new-response-lost" && !state.checkout ? 5 : 0;
        const settings = normalizeMerchantMembershipSettings(SITE, { updatedAt: CREATED, printSettings: { enabled: false, autoPrintRedemptionReceipt: false },
          redemptionItems: [{ id: "item-one", name: "当前商品（80积分）", enabled: true, pointsCost: 80, stock: itemStock }] });
        const member = membership(state);
        return json({ ok: true, memberships: member ? [member] : [], searchMemberships: [], settings, coupons: [] });
      }
      if (url.pathname === "/api/memberships" && method === "PATCH") {
        if (state.checkout && !state.checkout.acknowledgedAt) return json({ ok: false, message: "redemption_checkout_pending_exists" }, 409);
        commit(state, String(body.operationId));
        if (state.scenario === "new-response-lost") return json({ ok: false, message: "merchant_transaction_unavailable" }, 503);
        return json({ ok: true, membership: membership(state), receipt: state.checkout?.result, replayed: false });
      }
      if (url.pathname === "/api/memberships") return json({ ok: true, membership: membership(state), memberships: membership(state) ? [membership(state)] : [] });
      return json({ ok: false, message: "unexpected_harness_request" }, 404);
      } finally {
        if (stateRef.current === state) setDisplay({ actor: state.actor, writes: state.writes, calls: [...state.calls] });
      }
    };
  }, [revision]);
  const permissions: MerchantStaffBusinessPermission[] = ["redemptions.view", "redemptions.checkout", "redemptions.customer_data.view", ...(printAllowed ? ["redemptions.print" as const] : [])];
  function scenario(next: Scenario) {
    stateRef.current = fixture(stateRef.current.actor, next);
    setDisplay({ actor: stateRef.current.actor, writes: stateRef.current.writes, calls: [] });
    setRevision((value) => value + 1);
  }
  return <main style={{ padding: 16, background: "#f3f6fb" }}>
    <section style={{ padding: 16, marginBottom: 16, background: "white", border: "1px solid #cbd5e1" }}>
      <h1>本地合成验收：收银恢复</h1>
      <p>当前身份 {display.actor}；业务提交次数 <strong data-testid="financial-writes">{display.writes}</strong>；不连接真实业务接口。</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {([ ["pending", "待处理（余额20，原单80）"], ["committed", "已完成未确认"], ["read-error", "状态读取失败"],
          ["quote-changed", "原价已变化"], ["cancel-race", "取消时已完成"], ["new-response-lost", "新单响应丢失"],
          ["retry-response-lost", "重试响应丢失"], ["deleted-member", "会员后来被删除"], ["delayed", "旧身份延迟响应"] ] as const).map(([key, label]) =>
          <button key={key} type="button" onClick={() => scenario(key)}>{label}</button>)}
        <button type="button" onClick={() => { stateRef.current = fixture(stateRef.current.actor === "A" ? "B" : "A", "empty"); setDisplay({ actor: stateRef.current.actor, writes: 0, calls: [] }); setRevision((value) => value + 1); }}>切换员工身份</button>
        <label><input type="checkbox" checked={printAllowed} onChange={(event) => setPrintAllowed(event.target.checked)} />授权打印（不自动打印恢复单）</label>
      </div>
      <details><summary>合成请求记录</summary><pre data-testid="request-log">{display.calls.join("\n")}</pre></details>
    </section>
    <MerchantPointRedemptionCashier siteId={SITE} siteName="合成验收商户" apiClient={apiClient} permissions={permissions} />
  </main>;
}
