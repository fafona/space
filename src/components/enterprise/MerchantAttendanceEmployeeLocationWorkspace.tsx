"use client";
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AttendanceEmployeeLocationWorkspace } from "@/lib/merchantAttendanceEmployeeLocationWorkspace";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { AttendanceLocationEnvironment } from "@/lib/merchantAttendanceLocationCheckClient";
import type { LocationWorkspaceActivity } from "@/lib/merchantAttendanceLocationWorkspace";
const ClockPanel = lazy(() => import("./MerchantAttendanceLocationClockPanel"));
const NoticePanel = lazy(() => import("./MerchantAttendanceLocationNoticePanel"));
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
class StepBoundary extends Component<{ children: ReactNode; failed: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.failed(); }
  render() { return this.state.failed ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">当前页面未能加载，原操作未删除。请返回后重新进入；若仍有待确认操作，请刷新本页核对。</p> : this.props.children; }
}
type Props = { siteId: string; employeeId: string; authUserId?: string | null; canClock: boolean; apiFetch: AttendanceApiFetch; onClose: () => void; environment?: AttendanceLocationEnvironment };
export default function MerchantAttendanceEmployeeLocationWorkspace(props: Props) {
  return <Screen key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}
function Screen({ siteId, employeeId, authUserId, canClock, apiFetch, onClose, environment }: Props) {
  const client = useMemo(() => new AttendanceEmployeeLocationWorkspace({ siteId, employeeId, apiFetch, storage: () => window.sessionStorage }), [siteId, employeeId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const token = state.token;
  const report = useCallback((activity: LocationWorkspaceActivity) => client.report(token, activity), [client, token]);
  const failed = useCallback(() => report({ busy: false, pendingId: null, receiptId: null }), [report]);
  useEffect(() => {
    void client.initialize();
    const unload = (e: BeforeUnloadEvent) => { if (client.requiresLeaveWarning()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { client.dispose(); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  const waiting = state.phase === "loading" || state.childBusy || !!state.pendingId, target = state.target;
  return <section aria-label="我的定位考勤" className="mt-5 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div><h2 className="text-xl font-bold">我的定位考勤</h2><p className="mt-2 text-sm text-slate-500">本人状态 · 地点告知 · 已有班次收尾</p></div>
      <button className={button} disabled={waiting} onClick={() => void client.navigate("close").then(closed => { if (closed) onClose(); })}>返回我的考勤</button>
    </header>
    <div role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-4 text-sm leading-6">{state.message}</div>
    <nav aria-label="定位考勤步骤" className="flex flex-wrap gap-3">
      <button className={button} disabled={waiting} aria-current={target?.step === "clock" ? "step" : undefined} onClick={() => void client.navigate("clock")}>打卡与原班次收尾</button>
      <button className={button} disabled={waiting} aria-current={target?.step === "notice" ? "step" : undefined} onClick={() => void client.navigate("notice")}>查看／确认地点告知</button>
    </nav>
    {state.phase === "blocked" && <button className={button} onClick={() => void client.initialize()}>重新核对本人身份</button>}
    {state.phase === "loading" && <p role="status" className="p-4 text-sm">正在核对当前员工和考勤档案…</p>}
    {target && <StepBoundary key={token} failed={failed}><Suspense fallback={<p role="status" className="p-4 text-sm">正在加载所选步骤…</p>}>
      {target.step === "clock" ? <ClockPanel siteId={siteId} employeeId={employeeId} authUserId={authUserId} workerId={target.workerId} canClock={canClock} apiFetch={apiFetch} environment={environment} onWorkspaceActivity={report}/>
        : target.locationId ? <NoticePanel query={{ siteId, access: "self", expectedWorkerId: target.workerId, locationId: target.locationId, operationId: null }} actorId={employeeId} apiFetch={apiFetch} onWorkspaceActivity={report}/>
          : <p className="rounded-xl bg-amber-50 p-4 text-sm">尚未分配当前考勤地点，请联系负责人。已有班次请返回打卡页核对是否可收尾。</p>}
    </Suspense></StepBoundary>}
    <p className="text-xs leading-6 text-slate-500">打开页面不会请求定位。只有主动点击定位打卡才会请求一次位置；告知确认不是定位授权，也不会自动打卡。</p>
  </section>;
}
