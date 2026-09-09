"use client";

import type { MemberCheckoutRecoveryAction, MemberCheckoutRecoverySnapshot } from "@/lib/merchantMemberCheckoutRecovery";

export default function MerchantCheckoutRecoveryPanel({ snapshot, onRefresh, onAction }: {
  snapshot: MemberCheckoutRecoverySnapshot;
  onRefresh: () => void;
  onAction: (action: MemberCheckoutRecoveryAction) => void;
}) {
  const checkout = snapshot.checkout;
  if (snapshot.phase === "ready" && !checkout && !snapshot.notice) return null;
  const busy = snapshot.busy || snapshot.phase === "checking";
  return (
    <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-800" aria-label="原结算恢复" aria-busy={busy}>
      <h3 className="font-semibold text-slate-950">{snapshot.phase === "checking" ? "正在核对原结算" : snapshot.phase === "error" ? "新商品兑换已暂停" :
        checkout?.status === "pending" ? "有一笔原结算等待处理" : checkout?.status === "committed" ? "原结算已完成，等待确认" : checkout?.status === "cancelled" ? "原结算已放弃，等待确认" : "原单已确认"}</h3>
      {snapshot.phase === "checking" ? <p>正在读取当前账号的未确认结算。核对完成前不会开始新的商品兑换；充值和手工账户操作不受此门禁影响。</p> : null}
      {snapshot.error ? <p role="alert" className="text-rose-700">{snapshot.error}</p> : null}
      {snapshot.notice ? <p role="status">{snapshot.notice}</p> : null}
      {checkout ? <p className="break-all">结算编号：{checkout.operationId} · {new Date(checkout.createdAt).toLocaleString()}</p> : null}
      {checkout?.status === "pending" ? <>
        <p>仅使用服务器保存的原单，不需要重新选择会员或商品；未完成的结算仍需通过余额、库存与权限检查。</p>
        <p>放弃仅针对尚未完成的原单；若已经完成，将显示原结果，不会撤销扣减。</p>
      </> : null}
      {checkout?.result ? <div className="space-y-1 rounded-xl border border-sky-200 bg-white p-3" aria-label="服务器确认的原单金额">
        <p>原单扣减 <strong>{checkout.result.totalPoints}</strong> 积分 · 原单积分 {checkout.result.beforePointBalance} → {checkout.result.afterPointBalance}</p>
        <p>积分券抵扣 {checkout.result.couponPointDiscountTotal} · 核销卡券 {checkout.result.couponCount} 张</p>
        {checkout.result.lines.map((line, index) => <p key={index}>{line.name} × {line.quantity}{line.couponDiscountLabel ? ` · ${line.couponDiscountLabel}` : ""}</p>)}
        <p className="text-xs text-slate-500">以上为服务器保存的原单结果；即使会员已删除，也不会重算或重复扣减。</p>
      </div> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-50" disabled={busy} onClick={onRefresh}>重新读取结算状态</button>
        {checkout?.status === "pending" ? <>
          <button type="button" className="rounded-lg bg-slate-950 px-3 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => onAction("retry")}>核对/重试原结算</button>
          <button type="button" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => onAction("cancel")}>放弃尚未完成的原结算</button>
        </> : null}
        {checkout && checkout.status !== "pending" ? <button type="button" className="rounded-lg bg-slate-950 px-3 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => onAction("ack")}>确认并开始下一单</button> : null}
      </div>
    </section>
  );
}
