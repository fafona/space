"use client";
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { AttendanceExceptionWorkspace, type ExceptionActivity, type ExceptionIdentity, type ExceptionTarget } from "@/lib/merchantAttendanceExceptionWorkspace";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const ReviewPanel = lazy(() => import("./MerchantAttendanceLocationReviewPanel"));
const DiscussionPanel = lazy(() => import("./MerchantAttendanceLocationDiscussionPanel"));
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
type Props = ExceptionIdentity & { apiFetch: AttendanceApiFetch; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void; parentLeaveWarning?: string };
class StepBoundary extends Component<{ children: ReactNode; failed: () => void }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.failed(); }
  render() { return this.state.failed ? <p role="alert">页面未能加载。原操作没有删除；请返回后重新进入，有待确认操作时刷新核对。</p> : this.props.children; }
}
export default function MerchantAttendanceExceptionWorkspace(props: Props) { return <Screen key={`${props.siteId}:${props.access}:${props.actorId}`} {...props}/>; }
function Screen({ siteId, access, actorId, apiFetch, onClose, registerLeaveGuard, parentLeaveWarning }: Props) {
  const client = useMemo(() => new AttendanceExceptionWorkspace({ siteId, access, actorId }, () => window.sessionStorage), [siteId, access, actorId]);
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), token = s.token;
  const report = useCallback((a: ExceptionActivity) => client.report(token, a), [client, token]);
  const failed = useCallback(() => report({ busy: false, pendingId: null, receiptId: null, eventId: null, workerId: null }), [report]);
  const navigate = useCallback((t: ExceptionTarget | "close", discard = false) => { if (client.navigate(t, discard)) onClose(); }, [client, onClose]);
  useEffect(() => {
    client.initialize(); const unload = (e: BeforeUnloadEvent) => { if (client.requiresLeaveWarning()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [client]);
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(() => client.confirmExternalLeave(message => window.confirm(message), parentLeaveWarning));
    return () => registerLeaveGuard(null);
  }, [client, registerLeaveGuard, parentLeaveWarning]);
  const waiting = s.busy || !!s.pendingId;
  return <section aria-label="考勤异常工作区" className="mt-5 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5"><div><h2 className="text-xl font-bold">{access === "owner" ? "定位异常核查与沟通" : "我的定位异常与说明"}</h2>
      <p className="mt-2 text-sm text-slate-500">已有记录 · 明确提交 · 不采集定位、不改写打卡</p></div><button className={button} disabled={waiting} onClick={() => navigate("close")}>返回考勤</button></header>
    <div role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-4 text-sm leading-6">{s.message}</div>
    {access === "owner" && <nav aria-label="异常处理步骤" className="flex flex-wrap gap-3">{(["review", "discussion"] as const).map(step => <button key={step} className={button} disabled={waiting} aria-current={s.target?.step === step ? "step" : undefined}
      onClick={() => navigate({ step, eventId: s.selected.eventId, workerId: null })}>{step === "review" ? "内部核查（仅负责人）" : "员工可见说明／回复"}</button>)}</nav>}
    {s.requested && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm">尚未提交的文字会丢弃，不会删除已提交记录或待确认编号。</p>
      <div className="flex flex-wrap gap-3"><button className={button} onClick={() => navigate(s.requested!, true)}>放弃未提交输入并继续</button><button className={button} onClick={client.cancel}>保留输入</button></div></div>}
    {s.blocked && <button className={button} onClick={client.initialize}>重新检查恢复存储</button>}
    {s.dirty && !s.pendingId && <div className="flex flex-wrap items-center gap-3 text-sm"><p>有未提交输入；查询／刷新前请先保存或放弃。</p><button className={button} disabled={waiting} onClick={() => s.target && navigate({ ...s.target, ...s.selected })}>放弃未提交输入／重新读取</button></div>}
    <div onChangeCapture={e => { if ((e.target as HTMLElement).closest("[data-attendance-draft]")) client.edit(); }}>
      {s.target && <StepBoundary key={token} failed={failed}><Suspense fallback={<p role="status" className="p-4">正在加载异常处理页面…</p>}>
        {s.target.step === "review" && access === "owner" ? <ReviewPanel siteId={siteId} ownerId={actorId} apiFetch={apiFetch} initialEventId={s.target.eventId} draftDirty={s.dirty} onWorkspaceActivity={report} onNavigate={navigate}/>
          : <DiscussionPanel siteId={siteId} access={access} actorId={actorId} apiFetch={apiFetch} initialEventId={s.target.eventId} initialWorkerId={s.target.workerId} draftDirty={s.dirty} onWorkspaceActivity={report} onNavigate={navigate}/>}
      </Suspense></StepBoundary>}
    </div>
    <p className="text-xs leading-6 text-slate-500">未提交文字不会持久保存；刷新、隐藏页面前请处理当前输入。切换功能时会区分未提交输入与待确认操作；离开不等于撤销已发送的提交。退出登录和权限变化仍会立即关闭资料，不提供自动草稿保存或跨设备恢复。</p>
  </section>;
}
