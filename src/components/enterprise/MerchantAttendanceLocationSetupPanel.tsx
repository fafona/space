"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceLocationSetupClient } from "@/lib/merchantAttendanceLocationSetupClient";
import type { LocationSetupCommand, LocationSetupQuery, LocationSetupResult } from "@/lib/merchantAttendanceLocationSetup";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { useAttendanceLocationWorkspaceActivity, type AttendanceWorkspaceReporter } from "./useAttendanceLocationWorkspaceActivity";
const names = { prepare: "应用草稿围栏", enable: "启用企业定位通路", pause: "暂停企业定位通路" };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
function Actions({ result: r, submit }: { result: LocationSetupResult; submit: (action: LocationSetupCommand["action"], reason: string) => void }) {
  const [reason, setReason] = useState(""), [action, setAction] = useState<LocationSetupCommand["action"]>(r.canPrepare ? "prepare" : r.canEnable ? "enable" : "pause"), [confirmed, setConfirmed] = useState(false);
  const allowed = action === "prepare" ? r.canPrepare : action === "enable" ? r.canEnable : r.canPause;
  return <form className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4" onSubmit={e => { e.preventDefault(); if (confirmed && allowed && reason.trim()) submit(action, reason); }}>
    <label className="block text-sm font-semibold">操作<select value={action} onChange={e => { setAction(e.target.value as typeof action); setConfirmed(false); }} className="ml-3 rounded-lg border p-2">
      <option value="prepare" disabled={!r.canPrepare}>{names.prepare}</option><option value="enable" disabled={!r.canEnable}>{names.enable}</option><option value="pause" disabled={!r.canPause}>{names.pause}</option></select></label>
    <p className="text-sm leading-6">{action === "prepare" ? `应用当前草稿 v${r.draft?.revision} 的中心点和半径，并生成绑定新配置的草稿。当前地点的旧告知会失效；其他地点的围栏不改变。不会自动发布告知或开启通路。`
      : action === "enable" ? "这是企业级通路开关，影响企业内所有符合条件的地点。只允许当前告知、围栏和个人确认均满足条件的员工定位打卡，不会自动给员工确认或授予权限。"
      : "暂停整个企业的定位打卡通路，不清空围栏、不改写告知或员工确认；已有班次仍可明确选择无定位收尾。"}</p>
    <label className="block text-sm">内部操作说明（不作为员工告知发布）<textarea maxLength={240} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3" /></label>
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/>我已核对影响范围，确认执行以上操作。启用不代表已完成法律评估或实机验收。</label>
    <button className={button} disabled={!allowed || !confirmed || !reason.trim()}>{names[action]}</button>
  </form>;
}
export default function MerchantAttendanceLocationSetupPanel({ query, ownerId, apiFetch, onWorkspaceActivity }: { query: LocationSetupQuery; ownerId: string; apiFetch: AttendanceApiFetch; onWorkspaceActivity?: AttendanceWorkspaceReporter }) {
  const { siteId, locationId } = query;
  const client = useMemo(() => new AttendanceLocationSetupClient({ query: { siteId, locationId, operationId: null }, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, locationId, ownerId, apiFetch]);
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), r = s.result, busy = s.phase === "loading" || s.phase === "saving";
  useAttendanceLocationWorkspaceActivity(onWorkspaceActivity, s.phase, s.pending?.command.operationId ?? null, r?.receipt?.command.operationId ?? null);
  useEffect(() => {
    void client.initialize(); const hide = () => client.pause(), visibility = () => { if (document.visibilityState === "visible") void client.initialize(); else hide(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("beforeunload", unload);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  return <section aria-label="负责人定位策略设置" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <header><h2 className="text-xl font-bold">围栏与定位通路</h2><p className="mt-2 text-sm text-slate-600">本地候选 · 尚未上线。应用围栏 → 发布匹配告知 → 启用通路；员工还需自己确认当前告知。</p></header>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{s.message}</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void client.initialize()}>重新读取／核对收据</button>{s.pending && <button className={button} disabled={busy} onClick={() => void client.retry()}>原编号重试</button>}</div>
    {s.pending && <p className="break-all text-xs">待确认：{names[s.pending.command.action]} · {s.pending.command.operationId}</p>}
    {r && <><div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border p-4"><h3 className="font-semibold">{r.location.name} · 地点配置 v{r.location.version}</h3>
        <p className="mt-2 text-sm">{r.location.fence ? `运行围栏：${r.location.fence.latitude}, ${r.location.fence.longitude} · ${r.location.fence.radiusMeters} 米` : "尚无运行围栏"}</p>
        <p className="mt-2 text-sm">{r.noticeMatches ? `告知版本 ${r.notice?.revision} 与当前围栏匹配` : "告知未发布、已撤回或与当前配置不匹配"}</p></div>
      <div className="rounded-2xl border p-4"><h3 className="font-semibold">企业定位通路 · 开关版本 {r.channelVersion}</h3><p className="mt-2 text-sm">{r.channelEnabled ? "开关已启用（个人条件仍需逐次校验）" : "开关已暂停"}</p>
        <p className="mt-2 text-sm">考勤设置：{r.attendanceEnabled ? "启用" : "停用"}；网页打卡：{r.webClockEnabled ? "启用" : "停用"}</p>
        {!r.moduleEnabled && <p className="mt-2 text-sm text-amber-900">平台已暂停新配置，仍可核对原收据或暂停定位通路。</p>}</div>
    </div>
    {r.openWebShift && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">此地点仍关联未结束的普通网页班次。请先按原方式结束休息并下班，再应用围栏；不会代替员工补打卡或修改原记录。</p>}
    {r.draft && <div className="rounded-2xl border p-4 text-sm leading-6"><h3 className="font-semibold">当前待发布草稿 v{r.draft.revision}（不是运行设置）</h3>
      <p>{r.draft.values.latitude}, {r.draft.values.longitude} · {r.draft.values.radiusMeters} 米</p><p>用途：{r.draft.values.purpose}</p><p>说明：{r.draft.values.notice}</p>
      <p>替代方式：{r.draft.values.alternative}；联系人：{r.draft.values.contact}</p><p>拟定保留期限：{r.draft.values.retentionDays} 天，尚未启用自动执行。</p></div>}
    {s.phase === "ready" && !s.pending && r.locationId === locationId && (r.canPrepare || r.canEnable || r.canPause) &&
      <Actions key={`${r.ownerId}:${r.locationId}:${r.settingsVersion}:${r.location.version}:${r.channelVersion}:${r.draft?.revision}:${r.notice?.revision}`} result={r} submit={(action, reason) => void client.submit(action, reason)}/>}
    {r.receipt && <div className="rounded-2xl border p-4 text-sm leading-6"><h3 className="font-semibold">原操作收据（不是当前状态）</h3><p>{names[r.receipt.command.action]} · {r.receipt.recordedAt}</p>
      <p>地点版本 {r.receipt.before.locationVersion} → {r.receipt.after.locationVersion}；开关版本 {r.receipt.before.channelVersion} → {r.receipt.after.channelVersion}</p><p>内部说明：{r.receipt.command.reason}</p></div>}</>}
    <p className="text-xs leading-6 text-slate-500">本页不读取员工位置，不发布告知、不代替个人确认、不修改原始考勤。完整企业登录态联调、手机验收、通知和保留期限执行尚未完成，不能据此开放生产定位。</p>
  </section>;
}
