"use client";
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AttendanceLocationWorkspace, type LocationWorkspaceActivity, type LocationWorkspaceIdentity, type LocationWorkspaceStep } from "@/lib/merchantAttendanceLocationWorkspace";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const Policy = lazy(() => import("./MerchantAttendanceLocationPolicyPanel"));
const Setup = lazy(() => import("./MerchantAttendanceLocationSetupPanel"));
const Notice = lazy(() => import("./MerchantAttendanceLocationNoticePanel"));
class StepBoundary extends Component<{ children: ReactNode; report: (activity: LocationWorkspaceActivity) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.report({ busy: false, pendingId: null, receiptId: null }); }
  render() { return this.state.failed ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">此步骤暂时无法显示。可尝试重新打开当前步骤；如有待确认原操作，会优先核对，不会自动重发或删除本页存储。</p> : this.props.children; }
}
type Props = LocationWorkspaceIdentity & { locationName: string; apiFetch: AttendanceApiFetch; onClose: () => void };
const steps: { key: LocationWorkspaceStep; label: string; note: string }[] = [
  { key: "policy", label: "1 · 政策草稿", note: "填写用途、替代方式、围栏和拟定期限" },
  { key: "setup", label: "2 / 4 · 围栏与通路", note: "先应用围栏；发布告知后再回来启用通路" },
  { key: "notice", label: "3 · 发布告知", note: "核对新草稿并明确发布；不代员工确认" },
];
export default function MerchantAttendanceLocationWorkspace(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.locationId}`} {...props}/>;
}
function Screen({ siteId, ownerId, locationId, locationName, apiFetch, onClose }: Props) {
  const workspace = useMemo(() => new AttendanceLocationWorkspace({ siteId, ownerId, locationId }, () => window.sessionStorage), [siteId, ownerId, locationId]);
  const s = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const report = useCallback((activity: LocationWorkspaceActivity) => workspace.report(s.token, activity), [workspace, s.token]);
  useEffect(() => { workspace.initialize(); }, [workspace]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (workspace.requiresLeaveWarning()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [workspace]);
  const navigate = (next: LocationWorkspaceStep | "close", discard = false) => { if (workspace.navigate(next, discard)) onClose(); };
  const target = s.target, disabled = s.busy || !!s.pendingId;
  return <section aria-label="地点定位工作区" className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-slate-500">考勤配置 / 工作地点</p><h2 className="mt-1 text-xl font-bold">{locationName} · 定位设置</h2>
      <p className="mt-2 text-sm">应用围栏 → 发布告知 → 启用企业通路。员工还需本人确认；当前仍是未发布候选。</p></div>
      <button className="rounded-xl border bg-white px-4 py-3 text-sm disabled:opacity-40" disabled={disabled} onClick={() => navigate("close")}>返回工作地点</button></header>
    <p role="status" aria-live="polite" className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">{s.message}</p>
    {target && target.locationId !== locationId && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">正在恢复另一个地点（{target.locationId}）的原操作，不是修改上方所选地点。核对后点击步骤按钮回到所选地点。</p>}
    {s.requested && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><span>是否放弃尚未保存的输入？</span>
      <button disabled={disabled} className="rounded-lg border bg-white p-2" onClick={() => navigate(s.requested!, true)}>放弃未保存输入并继续</button><button className="rounded-lg border bg-white p-2" onClick={workspace.cancel}>继续编辑</button></div>}
    {s.storageBlocked ? <button className="rounded-xl border bg-white px-4 py-3 text-sm" onClick={workspace.initialize}>重新检查恢复存储</button> : <>
      <nav aria-label="地点定位设置步骤" className="grid gap-3 sm:grid-cols-3">{steps.map(step => <button key={step.key} disabled={disabled} aria-current={target?.step === step.key ? "step" : undefined}
        onClick={() => navigate(step.key)} className={`rounded-xl border p-4 text-left disabled:opacity-50 ${target?.step === step.key ? "border-blue-400 bg-blue-50" : "bg-white"}`}><strong className="block text-sm">{step.label}</strong><span className="mt-1 block text-xs leading-5 text-slate-600">{step.note}</span></button>)}</nav>
      <div onChangeCapture={workspace.edit}><StepBoundary key={s.token} report={report}><Suspense fallback={<p role="status" className="p-4 text-sm">正在加载当前步骤…</p>}>
        {target?.step === "policy" && <Policy key={s.token} siteId={siteId} ownerId={ownerId} locationId={target.locationId} apiFetch={apiFetch} onWorkspaceActivity={report}/>}
        {target?.step === "setup" && <Setup key={s.token} query={{ siteId, locationId: target.locationId, operationId: null }} ownerId={ownerId} apiFetch={apiFetch} onWorkspaceActivity={report}/>}
        {target?.step === "notice" && <Notice key={s.token} query={{ siteId, access: "owner", locationId: target.locationId, expectedWorkerId: null, operationId: null }} actorId={ownerId} apiFetch={apiFetch} onWorkspaceActivity={report}/>}
      </Suspense></StepBoundary></div>
    </>}
    <p className="text-xs leading-6 text-slate-500">本工作区不会自动提交、采集员工位置或轮询。每次进入步骤重新读取版本；通路启停是企业级，其他操作针对当前步骤所示地点。此页的切换保护不替代其他标签页的服务器版本校验。</p>
  </section>;
}
