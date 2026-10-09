"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceLocationPolicyClient } from "@/lib/merchantAttendanceLocationPolicyClient";
import { attendanceLocationPolicyNotice, type AttendanceLocationPolicyResult, type AttendanceLocationPolicyValues } from "@/lib/merchantAttendanceLocationPolicy";
import { useAttendanceLocationWorkspaceActivity, type AttendanceWorkspaceReporter } from "./useAttendanceLocationWorkspaceActivity";

const labels: Record<keyof AttendanceLocationPolicyValues, string> = { purpose: "定位用途", notice: "补充告知", contact: "咨询／核查联系人", alternative: "无法提供位置时的替代登记说明",
  retentionDays: "拟定定位摘要保留天数", latitude: "拟定地点纬度", longitude: "拟定地点经度", radiusMeters: "拟定范围半径（米）" };
const limits = { purpose: 160, notice: 400, contact: 120, alternative: 240 } as const;
const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";

function PolicyForm({ result, disabled, save }: { result: AttendanceLocationPolicyResult; disabled: boolean;
  save: (values: AttendanceLocationPolicyValues, expected: { revision: number; settingsVersion: number; locationVersion: number }) => void }) {
  const [values, setValues] = useState<Record<keyof AttendanceLocationPolicyValues, string>>(() => {
    const v = result.current?.values;
    return { purpose: v?.purpose ?? "", notice: v?.notice ?? "", contact: v?.contact ?? "", alternative: v?.alternative ?? "",
      retentionDays: v ? String(v.retentionDays) : "", latitude: v ? String(v.latitude) : "", longitude: v ? String(v.longitude) : "", radiusMeters: v ? String(v.radiusMeters) : "" };
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const parsed = { ...values, retentionDays: Number(values.retentionDays), latitude: Number(values.latitude), longitude: Number(values.longitude), radiusMeters: Number(values.radiusMeters) };
  const changed = (key: keyof AttendanceLocationPolicyValues, value: string) => { setValues(v => ({ ...v, [key]: value })); setAcknowledged(false); };
  return <form onSubmit={event => { event.preventDefault(); if (!disabled && acknowledged) save(parsed, { revision: result.current?.revision ?? 0, settingsVersion: result.settingsVersion, locationVersion: result.location.version }); }} className="space-y-5">
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">地点与用途 · {result.location.name}</legend>
      {(Object.keys(limits) as (keyof typeof limits)[]).map(key => <label key={key} className={`text-sm text-slate-700 ${key === "notice" || key === "alternative" ? "sm:col-span-2" : ""}`}>{labels[key]}
        <input required maxLength={limits[key]} value={values[key]} onChange={e => changed(key, e.target.value)} className={inputClass}/></label>)}
      {(["latitude", "longitude", "radiusMeters", "retentionDays"] as const).map(key => <label key={key} className="text-sm text-slate-700">{labels[key]}
        <input type="number" required value={values[key]} min={key === "latitude" ? -90 : key === "longitude" ? -180 : 1}
          max={key === "latitude" ? 90 : key === "longitude" ? 180 : key === "radiusMeters" ? 100000 : 3650} step={key === "latitude" || key === "longitude" ? "any" : 1}
          onChange={e => changed(key, e.target.value)} className={inputClass}/></label>)}
    </fieldset>
    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><h3 className="font-semibold">员工告知预览 · 不会发送给员工</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5">{attendanceLocationPolicyNotice(parsed).map((line, index) => <li key={index}>{line}</li>)}</ul>
    </div>
    {result.previous && result.current && <details className="rounded-2xl border border-slate-200 p-4 text-sm"><summary className="cursor-pointer font-semibold">最近一次变更 · v{result.previous.revision} → v{result.current.revision}</summary>
      <dl className="mt-3 space-y-3">{(Object.keys(labels) as (keyof AttendanceLocationPolicyValues)[]).filter(key => result.previous!.values[key] !== result.current!.values[key]).map(key =>
        <div key={key} className="break-words"><dt className="font-semibold">{labels[key]}</dt><dd className="text-slate-500">之前：{String(result.previous!.values[key])}</dd><dd>之后：{String(result.current!.values[key])}</dd></div>)}</dl>
      <p className="mt-3 text-xs text-slate-500">保存时间（UTC）：{result.current.recordedAt}。此处对比已保存版本，不是尚未保存的输入。</p>
    </details>}
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1"/>
      我理解这里只保存政策草稿，不启用定位、不修改实际围栏；保留期限尚未执行，正式发布仍需核查流程和适用规则确认。</label>
    <button type="submit" disabled={disabled || !acknowledged} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">保存草稿 · 不启用定位</button>
  </form>;
}

// Candidate: standalone fixture or the default-off owner location workspace.
export default function MerchantAttendanceLocationPolicyPanel({ siteId, ownerId, locationId, apiFetch, onWorkspaceActivity }: { siteId: string; ownerId: string; locationId: string; apiFetch: AttendanceApiFetch; onWorkspaceActivity?: AttendanceWorkspaceReporter }) {
  const client = useMemo(() => new AttendanceLocationPolicyClient({ siteId, ownerId, locationId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, locationId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useAttendanceLocationWorkspaceActivity(onWorkspaceActivity, state.phase, state.pending?.command.operationId ?? null, state.result?.receipt?.operationId ?? null);
  useEffect(() => {
    void client.initialize();
    const visibility = () => { if (document.visibilityState !== "visible") client.pause(); else void client.initialize(); };
    const unload = (event: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", client.pause); window.addEventListener("beforeunload", unload);
    return () => { client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", client.pause); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  const busy = state.phase === "loading" || state.phase === "saving", result = state.result;
  return <section aria-label="定位政策草稿" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">定位政策 · 草稿</h2><p className="mt-2 text-sm text-slate-600">未发布 · 不影响现有员工、打卡或地点设置</p></div>
      <button type="button" disabled={busy} onClick={() => void client.initialize()} className="rounded-xl border border-slate-200 px-4 py-3 text-sm disabled:opacity-40">重新读取／核对保存</button></header>
    <div role="status" aria-live="polite" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><p>{state.message}</p>
      {state.pending && <p className="mt-2 break-all text-xs">原操作编号：{state.pending.command.operationId}</p>}</div>
    {state.pending && <button type="button" disabled={busy} onClick={() => void client.retry()} className="rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:opacity-40">原编号重试（先查询收据）</button>}
    {result && !state.pending && <PolicyForm key={`${siteId}:${ownerId}:${locationId}:${result.current?.revision ?? 0}:${result.settingsVersion}:${result.location.version}`} result={result}
      disabled={state.phase !== "ready" || !result.moduleEnabled || !result.location.active} save={(values, expected) => void client.submit(values, expected)}/>}
    <p className="text-xs leading-6 text-slate-500">只有当前负责人可读写。待确认的草稿内容会暂存在本标签页以恢复原操作，确认后移除；不包含员工设备位置。重新读取／切换页面将丢弃尚未点击保存的输入。</p>
  </section>;
}
