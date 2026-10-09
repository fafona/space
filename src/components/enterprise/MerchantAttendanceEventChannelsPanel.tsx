"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceEventChannelsClient } from "@/lib/merchantAttendanceEventChannelsClient";
import type { EventChannelsProps } from "./MerchantAttendanceEventChannels";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const labels = { web: "网页通路（非现场动态码）", onsite_qr: "现场动态码 · 手机提交", kiosk: "终端打卡" };
const actions = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
export default function MerchantAttendanceEventChannelsPanel(props: EventChannelsProps & { onClose: () => void }) {
  const [page, setPage] = useState(0);
  if (props.eventIds.length > 4000 || new Set(props.eventIds).size !== props.eventIds.length) return <p role="alert">记录数量超出核对范围或有重复，请缩小查询范围。</p>;
  const pages = Math.ceil(props.eventIds.length / 202);
  return <section aria-label="详细打卡通路" className="my-3 min-w-0 space-y-3 rounded-xl border border-teal-200 bg-white p-3">
    <header className="flex flex-wrap justify-between gap-2"><h4 className="text-sm font-bold">原始打卡通路</h4><button type="button" className={button} onClick={props.onClose}>关闭通路核对</button></header>
    <Batch key={page} {...props} eventIds={props.eventIds.slice(page * 202, (page + 1) * 202)}/>
    {pages > 1 && <div className="flex flex-wrap items-center gap-2 text-xs"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>通路上一批</button>
      <span>第 {page + 1} / {pages} 批；仅当前批，不是完整周期统计</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>通路下一批</button></div>}
    <p className="text-xs leading-5 text-slate-500">这是原始记录的提交通路，不证明真实到店，也不改变核定工时。只在点击时查询；结果最多显示 30 秒，切到后台立即清除。此信息不追加到既有 CSV 导出。</p>
  </section>;
}
function Batch({ siteId, access, workerId, locationId = null, employeeId, eventIds, apiFetch }: EventChannelsProps) {
  const ids = eventIds.join(",");
  const client = useMemo(() => new AttendanceEventChannelsClient({ query: { siteId, access, workerId, locationId, eventIds: ids.split(",") }, employeeId, apiFetch }), [siteId, access, workerId, locationId, employeeId, ids, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => { const hide = () => client.invalidate("已清除通路详情；返回后请手动核对。"), visible = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visible); window.addEventListener("pagehide", hide);
    return () => { client.invalidate(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", hide); }; }, [client]);
  return <>
    <button type="button" className={button} disabled={state.phase === "loading"} onClick={() => void client.load()}>读取本批通路（{eventIds.length} 条）</button>
    <p role="status" className="text-sm leading-6">{state.message}</p>
    {state.result && <>
      <p className="text-xs">本批：{Object.entries(labels).map(([key, label]) => `${label} ${state.result!.items.filter(item => item.channel === key).length} 条`).join(" · ")}</p>
      <ol className="max-h-80 space-y-2 overflow-y-auto">{state.result.items.map(item => <li key={item.eventId} className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-semibold">{actions[item.action]} · {labels[item.channel]}</p><p className="break-all text-xs leading-5">UTC：{item.occurredAt}<br/>记录编号：{item.eventId}</p>
        {item.terminalId && <p className="break-all text-xs leading-5">原扫码终端编号：{item.terminalId}（不表示当前设备仍有效）</p>}
      </li>)}</ol>
    </>}
  </>;
}
