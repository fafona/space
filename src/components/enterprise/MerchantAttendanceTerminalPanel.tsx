"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceTerminalClient } from "@/lib/merchantAttendanceTerminalClient";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceAdminResult, type AttendanceAdminLocation } from "@/lib/merchantAttendanceAdmin";
import MerchantAttendancePinLauncher from "./MerchantAttendancePinLauncher";
import { TERMINAL_PAIRING_GUIDANCE } from "@/lib/merchantAttendanceTerminalGuidance";

const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3 text-sm";
const names = { pending: "等待配对", active: "已配对", expired: "已过期", revoked: "已撤销", blocked: "地点或负责人已变更" };
export default function MerchantAttendanceTerminalPanel({ siteId, ownerId, apiFetch, onClose }: {
  siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onClose: () => void;
}) {
  const client = useMemo(() => new AttendanceTerminalClient({ siteId, ownerId, apiFetch }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [label, setLabel] = useState(""); const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<AttendanceAdminLocation[]>([]), [locationCursor, setLocationCursor] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState(""), [locationBusy, setLocationBusy] = useState(false), [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    void client.initialize(); const hide = () => { if (document.hidden) client.hide(); };
    document.addEventListener("visibilitychange", hide);
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { client.dispose(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  // Choices are explicit, bounded pages. No automatic polling/employee download.
  const locationController = useMemo(() => ({ siteId, ownerId, apiFetch, current: null as AbortController | null }), [siteId, ownerId, apiFetch]);
  useEffect(() => () => { locationController.current?.abort(); }, [locationController]);
  async function loadLocations(cursor: string | null) {
    if (locationController.current) return;
    const controller = new AbortController(); locationController.current = controller; setLocationBusy(true); setLocations([]); setLocationId(""); setLocationMessage("");
    try {
      const q = new URLSearchParams({ siteId, view: "locations" }); if (cursor) q.set("cursor", cursor);
      const b = await attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/admin?${q}`, {}, { signal: controller.signal });
      const r = parseAttendanceAdminResult(b, { siteId, view: "locations", operationId: null });
      if (!controller.signal.aborted) { setLocations((r.items as AttendanceAdminLocation[]).filter(l => l.active)); setLocationCursor(r.nextCursor); }
    } catch { if (!controller.signal.aborted) { setLocationCursor(null); setLocationMessage("无法读取地点，请确认负责人权限与考勤配置后重试。"); } }
    finally { if (!controller.signal.aborted) setLocationBusy(false); locationController.current = null; }
  }
  const busy = state.phase === "loading" || state.phase === "saving";
  return <section aria-label="门店终端管理" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">门店终端配对</h3>
      <button className={button} disabled={busy || !!state.pending} onClick={onClose}>关闭终端管理</button></div>
    <p className="text-sm leading-6 text-slate-600">终端绑定一个工作地点。请在门店专用浏览器打开 <a href="/enterprise/attendance-terminal" target="_blank" rel="noreferrer" className="underline">终端配对页</a>，粘贴配对码。不要在公用终端登录负责人账号。</p>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{TERMINAL_PAIRING_GUIDANCE}</p>
    <p role="status" className="text-sm leading-6">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { setConfirmId(null); void client.load(); }}>重新读取／核对原终端</button>
      {state.phase === "unconfirmed" && state.pending && <button className={button} onClick={() => void client.retry()}>原样重试此操作</button>}</div>
    {state.pairToken && <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <label className="block text-sm font-semibold">一次性配对码<textarea aria-label="一次性配对码" readOnly className={input + " break-all font-mono"} rows={3} value={state.pairToken}/></label>
      <p className="text-xs leading-5">仅当前页面显示，五分钟内有效。切换标签页、隐藏或关闭页面将清除此处配对码；先复制，再到终端粘贴。丢失后请撤销原终端并重新创建。不要发送给无关人员。</p>
      <button className={button} onClick={() => {
        if (!navigator.clipboard) { setLocationMessage("请选中配对码手动复制。"); return; }
        void navigator.clipboard.writeText(state.pairToken!).catch(() => setLocationMessage("自动复制失败，请选中配对码手动复制。"));
      }}>复制一次性配对码</button>
      <button className={button + " ml-2"} onClick={client.hide}>隐藏并清除配对码</button>
    </div>}
    <fieldset disabled={busy || !!state.pending || state.phase !== "ready" || !state.result?.moduleEnabled} className="space-y-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-2 font-semibold">创建终端配对</legend>
      <label className="block text-sm">终端名称<input className={input} maxLength={80} placeholder="例如：前台平板" value={label} onChange={e => setLabel(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={locationBusy} onClick={() => void loadLocations(null)}>读取工作地点</button>
        {locationCursor && <button className={button} disabled={locationBusy} onClick={() => void loadLocations(locationCursor)}>下一页地点</button>}</div>
      <label className="block text-sm">绑定工作地点<select className={input} value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">请选择已启用地点</option>
        {locations.map(l => <option key={l.id} value={l.id}>{l.name} · {l.timeZone}</option>)}</select></label>
      <button className={button} disabled={!label.trim() || !locationId || locationBusy} onClick={() => { setConfirmId(null); void client.create(locationId, label); }}>生成五分钟配对码</button>
    </fieldset>
    {locationMessage && <p role="alert" className="text-sm text-red-700">{locationMessage}</p>}
    {state.result?.items.map(t => <article key={t.id} className="space-y-2 rounded-xl border border-slate-200 p-4">
      <h4 className="font-bold">{t.label} · {names[t.state]}</h4><p className="text-sm">{t.locationName} · {t.timeZone}</p>
      <p className="break-all font-mono text-xs text-slate-500">{t.id}</p>
      <p className="text-xs text-slate-500">{t.pairedAt ? `设备凭证有效至 ${new Date(t.deviceExpiresAt!).toLocaleString()}` : `配对码有效至 ${new Date(t.pairExpiresAt).toLocaleString()}`}</p>
      {t.state !== "revoked" && (confirmId === t.id ? <div className="space-y-2"><p className="text-sm text-red-700">撤销后原配对码和设备凭证均不可再用，需要重新配对。</p>
        <button className={button} disabled={busy || !!state.pending} onClick={() => { setConfirmId(null); void client.revoke(t.id); }}>确认撤销此终端</button>
        <button className={button + " ml-2"} onClick={() => setConfirmId(null)}>取消</button></div>
        : <button className={button} disabled={busy || !!state.pending} onClick={() => setConfirmId(t.id)}>撤销终端</button>)}
    </article>)}
    {state.result?.nextCursor && <button className={button} disabled={busy || !!state.pending} onClick={() => void client.load(state.result!.nextCursor)}>下一页终端</button>}
    <MerchantAttendancePinLauncher siteId={siteId} apiFetch={apiFetch}/>
  </section>;
}
