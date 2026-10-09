"use client";
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AttendanceRuleCaptureHistoryClient } from "@/lib/merchantAttendanceRuleCaptureHistoryClient";
import type { RuleCaptureHistoryResponse } from "@/lib/merchantAttendanceRuleCaptureHistory";
import type { AttendanceRuleCaptureHistoryPanelProps } from "./MerchantAttendanceRuleCaptureHistoryLauncher";
import { RuleCaptureReceipt } from "./MerchantAttendanceRuleCapturesPanel";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const visibilitySnapshot = () => document.visibilityState !== "hidden", serverVisibility = () => false;
const subscribeVisibility = (listener: () => void) => { document.addEventListener("visibilitychange", listener); return () => document.removeEventListener("visibilitychange", listener); };
type Props = AttendanceRuleCaptureHistoryPanelProps & { onClose: () => void };

export default function MerchantAttendanceRuleCaptureHistoryPanel(props: Props) {
  const [binding, setBinding] = useState({ apiFetch: props.apiFetch, revision: 0 });
  if (binding.apiFetch !== props.apiFetch) setBinding({ apiFetch: props.apiFetch, revision: binding.revision + 1 });
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.workerId}:${binding.revision}`} {...props}/>;
}
function Screen({ siteId, ownerId, workerId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceRuleCaptureHistoryClient({ siteId, ownerId, workerId, apiFetch }), [siteId, ownerId, workerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibility);
  useLayoutEffect(() => {
    const hide = () => client.pause(), hidden = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") hidden(); };
    if (document.visibilityState === "hidden") hide();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hidden);
    return () => { client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hidden); };
  }, [client]);
  const result = visible ? state.result : null, detail = visible ? state.detail : null, busy = state.phase === "loading";
  const explicit = (run: () => Promise<void>) => { if (visible && document.visibilityState !== "hidden" && !busy) void run(); };
  const close = () => { client.pause(); onClose(); };
  return <section aria-label="单员工候选留存历史" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">候选留存历史（只读）</h2><p className="mt-1 text-sm text-slate-600">仅当前负责人 · 当前员工双身份 · 每页最多 25 条</p></div><button type="button" className={button} onClick={close}>关闭候选留存历史</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6">只读取已留存候选的元数据，不保存、重试写入、发布或应用规则，不改打卡、工时、异常或工资。历史列表不证明来源摘要已核验；只有明确读取某条原留存后才核验其原始来源字节。</p>
    <p className="break-all text-xs text-slate-600">当前考勤档案编号：{workerId}。不按姓名关联，不列出其他负责人或其他员工身份的留存。</p>
    <button type="button" className={button} disabled={!visible || busy} onClick={() => explicit(() => client.firstread())}>读取历史首页</button>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "资料已隐藏；返回后需明确读取，不会自动请求。"}</p>
    {visible && state.phase === "blocked" && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{state.message}</p>}
    {result && <>
      <RuleCaptureHistoryEvidence result={result} disabled={busy} onSelect={operationId => explicit(() => client.select(operationId))}/>
      <button type="button" className={button} disabled={busy || !result.nextCursor} onClick={() => explicit(() => client.next())}>下一页</button>
      {!result.nextCursor && <p className="text-xs text-slate-600">本次分页范围没有下一页；不是其他身份或全部历史的总数结论。</p>}
    </>}
    {detail && <RuleCaptureReceipt result={detail}/>}
    <p className="text-xs leading-6 text-slate-600">打开、返回或切换页面不会自动查询详情。不写浏览器存储、不轮询、不下载。重新读取、翻页、隐藏、关闭或切换身份会清除旧详情；返回后请明确读取。时间截止值只限定本次分页候选范围，不是数据库事务快照，也不是历史应用证明。</p>
  </section>;
}
function Datum({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="font-semibold">{label}</dt><dd className="break-all whitespace-pre-wrap">{children}</dd></div>;
}
export function RuleCaptureHistoryEvidence({ result: r, disabled, onSelect }: { result: RuleCaptureHistoryResponse; disabled: boolean; onSelect: (operationId: string) => void }) {
  return <section aria-label="本页候选留存历史" data-rule-capture-history-result className="min-w-0 space-y-4">
    <dl className="grid min-w-0 gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2"><Datum label="当前人员">{r.workerName} · 工号 {r.workerNo} · 档案 {r.workerId}</Datum>
      <Datum label="当前授权">站点 {r.siteId} · 当前负责人 {r.actorId}</Datum><Datum label="当前员工 / 登录身份">{r.employeeId} / {r.employeeAuthUserId}</Datum>
      <Datum label="当前状态">{r.workerActive ? "档案启用" : "档案停用"} · {r.employeeActive ? "员工启用" : "员工停用"}</Datum>
      <Datum label="本次分页时间截止值（UTC）">{r.asOf}</Datum><Datum label="本页服务器读取时间（UTC）">{r.readAt}</Datum></dl>
    {!r.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新考勤模块已暂停；这里仍可核对有权读取的原留存，不恢复任何新写入。</p>}
    <p className="text-sm leading-6">只包含当前负责人、当前考勤档案及当前员工双身份对应的留存。时间截止值不是事务快照；跨页并发变化不构成全部历史完整性的保证。</p>
    <section aria-label="本页候选留存记录" className="space-y-3"><h3 className="font-bold">本页留存记录 · {r.items.length} 条</h3>
      {!r.items.length && <p className="rounded-xl border border-slate-200 p-3 text-sm">本页未找到符合当前负责人和当前员工双身份的记录；不代表其他负责人、其他身份或全部历史都没有留存。</p>}
      {r.items.map(item => <article key={item.operationId} aria-label={`留存操作 ${item.operationId}`} data-rule-capture-history-item={item.operationId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
        <h4 className="break-all font-bold">留存操作 {item.operationId}</h4><p>{item.command.fromDate} 至 {item.command.throughDate}（含尾日） · 未应用</p>
        <p className="whitespace-pre-wrap break-words">留存理由：{item.command.reason}</p>
        <p className="break-all text-xs">登记 UTC：{item.recordedAt} · 来源编号：{item.sourceId}</p>
        <details><summary className="cursor-pointer font-semibold">核对这条留存的元数据</summary><dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
          <Datum label="原操作人">{item.actorId}</Datum><Datum label="原员工 / 登录身份">{item.command.employeeId} / {item.command.employeeAuthUserId}</Datum>
          <Datum label="本操作新读取 UTC">{item.observedAt}</Datum><Datum label="原来源读取 UTC">{item.sourceReadAt}</Datum>
          <Datum label="来源 SHA-256（列表摘要尚未重新核验）">{item.sourceSha256}</Datum><Datum label="原来源大小">{item.sourceBytes} UTF-8 字节</Datum></dl>
          <p className="mt-2 text-xs leading-6">内容摘要不是签名；本条候选未应用，也不证明过去实际采用。读取原留存后才核验来源字节及与本行的一致性。</p>
        </details>
        <button type="button" className={button} disabled={disabled} onClick={() => onSelect(item.operationId)}>读取原留存</button>
      </article>)}
    </section>
  </section>;
}
