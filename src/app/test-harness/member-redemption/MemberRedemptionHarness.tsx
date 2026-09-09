"use client";

import { useMemo, useState } from "react";
import MerchantMemberManager from "@/components/admin/MerchantMemberManager";
import { MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY, type MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import { createMemberRedemptionHarnessService, MEMBER_HARNESS_SITE, type HarnessActor, type HarnessScenario } from "./syntheticService";

const SCENARIOS: Array<[HarnessScenario, string]> = [
  ["pending", "待确认原单"], ["committed", "已完成但未确认"], ["first-response-lost", "首笔提交响应丢失"],
  ["retry-response-lost", "重试响应丢失"], ["read-error", "原单 GET 失败"], ["quote-changed", "原单价格已变"],
  ["cancel-wins", "取消赢：重试时原单已取消"], ["commit-wins", "提交赢：取消时已完成"],
  ["deleted-member", "已完成后会员被删"], ["delayed", "旧身份延迟响应"], ["empty", "无待处理单"],
];
const BASE_PERMISSIONS: MerchantStaffBusinessPermission[] = ["members.view", "members.customer_data.view", "members.account.view",
  "members.insights.view", "redemptions.view", "redemptions.recharge"];

export default function MemberRedemptionHarness() {
  const [service] = useState(createMemberRedemptionHarnessService);
  const [actor, setActor] = useState<HarnessActor>("employee-A");
  const [scopeRevision, setScopeRevision] = useState(0);
  const [mount, setMount] = useState(0);
  const [snapshot, setSnapshot] = useState(() => service.snapshot());
  const active = snapshot.actors[actor];
  const apiClient = useMemo<MerchantBusinessApiClient>(() => async (path, init) => {
    try { return await service.request(actor, path, init, scopeRevision); }
    finally { setSnapshot(service.snapshot()); }
  }, [actor, service, scopeRevision]);
  const permissions = useMemo<MerchantStaffBusinessPermission[]>(() => [
    ...BASE_PERMISSIONS,
    ...(actor === "owner" ? ["members.allergens.manage", "members.settings.manage"] as const : []),
    ...(active.checkoutAllowed ? ["redemptions.checkout"] as const : []),
  ], [actor, active.checkoutAllowed]);
  function reset(scenario: HarnessScenario) {
    service.reset(actor, scenario); setSnapshot(service.snapshot()); setScopeRevision((value) => value + 1);
  }
  return <main style={{ padding: 20, background: "#f2f5fa", minHeight: "100vh" }}>
    <section aria-label="本地合成验收控制台" style={{ background: "#fff", border: "1px solid #cbd5e1", padding: 18, marginBottom: 20, borderRadius: 12 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>会员管理：商品兑换恢复 · 本地合成验收</h1>
      <p>真实 MerchantMemberManager，所有业务响应来自内存；不调用真实接口，不读写浏览器持久存储。</p>
      <p>当前身份 <strong data-testid="active-actor">{actor}</strong>；场景 <strong>{active.scenario}</strong>；
        业务写入 <strong data-testid="financial-writes">{active.writes}</strong>；积分 <strong>{active.balance}</strong>；库存 {active.stock}；
        页面挂载次数 <strong data-testid="mount-count">{mount + 1}</strong></p>
      <p>当前未确认原单：<strong data-testid="checkout-status">{active.checkout?.status ?? "none"}</strong>
        {active.checkout ? ` · ${active.checkout.operationId}` : ""}</p>
      <p style={{ color: "#475569", fontSize: 13 }}>负责人模式为合成负责人身份与完整页面权限；为隔离真实网络和持久缓存，仍注入测试 apiClient，不代表原生负责人默认网络/缓存路径验收。</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 12 }}>
        {SCENARIOS.map(([key, label]) => <button key={key} type="button" onClick={() => reset(key)}>{label}</button>)}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={() => setMount((value) => value + 1)}>重挂载页面（保留服务原单）</button>
        <button type="button" onClick={() => setActor(actor === "employee-A" ? "employee-B" : "employee-A")}>切换员工 A / B</button>
        <button type="button" onClick={() => setActor(actor === "owner" ? "employee-A" : "owner")}>切换合成负责人 / 员工</button>
        <button type="button" onClick={() => { service.recoverReads(actor); setSnapshot(service.snapshot()); }}>恢复 GET 服务（再点重新读取）</button>
        <label><input type="checkbox" checked={active.checkoutAllowed} onChange={(event) => {
          service.allowCheckout(actor, event.target.checked); setSnapshot(service.snapshot());
        }} />允许商品兑换权限</label>
      </div>
      <details style={{ marginTop: 14 }}><summary>合成服务状态与请求日志</summary>
        <pre data-testid="context-state" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
          {JSON.stringify({ actor, context: active.checkout, totalStoredReceipts: active.receipts,
            writesByActor: Object.fromEntries(Object.entries(snapshot.actors).map(([key, value]) => [key, value.writes])) }, null, 2)}
        </pre>
        <pre data-testid="request-log" style={{ whiteSpace: "pre-wrap", maxHeight: 170, overflow: "auto", fontSize: 12 }}>{snapshot.calls.join("\n")}</pre>
      </details>
      <p style={{ fontSize: 13 }}>首笔丢响应：选中测试会员 → 兑换 → 选择合成商品 → 提交。之后重挂载，原结果必须可恢复且业务写入仍为 1。</p>
    </section>
    <MerchantMemberManager key={mount} siteId={MEMBER_HARNESS_SITE} siteName="合成本地商户"
      apiClient={apiClient} cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY} permissions={permissions} />
  </main>;
}
