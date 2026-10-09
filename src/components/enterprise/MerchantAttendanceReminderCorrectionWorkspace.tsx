"use client";
//A stale reminder opens only the original189 grant selector. No grant, request
//body, authorization result or command is injected into the existing Panel.
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { reminderOriginalTarget, type ReminderReviewTarget } from "@/lib/merchantAttendanceRemindersNavigation";
import { remindersAuthCurrent } from "@/lib/merchantAttendanceRemindersClient";
const Panel = lazy(() => import("./MerchantAttendanceCorrectionDelegationPanel"));
export type ReminderCorrectionWorkspaceProps = { siteId: string; employeeId: string; authUserId: string; target: ReminderReviewTarget;
  apiFetch: AttendanceApiFetch; enabled: boolean; isCurrentAuth: () => boolean; registerLeaveGuard: (guard: (() => boolean) | null) => void; onClose: () => void };
export function reminderCorrectionTarget(raw: ReminderReviewTarget): ReminderReviewTarget {
  const target = reminderOriginalTarget(raw); if (target.family !== "correction") throw Error("unsupported_reminder_target"); return target;
}
export default function MerchantAttendanceReminderCorrectionWorkspace(props: ReminderCorrectionWorkspaceProps) {
  const { enabled, isCurrentAuth, onClose, registerLeaveGuard } = props;
  const [shown, setShown] = useState(true), dialog = useRef<HTMLDialogElement>(null), child = useRef<(() => boolean) | null>(null);
  const current = useCallback(() => shown && enabled && !document.hidden && remindersAuthCurrent(isCurrentAuth), [shown, enabled, isCurrentAuth]);
  const leave = useCallback(() => current() && (!child.current || child.current()), [current]);
  const registerChild = useCallback((guard: (() => boolean) | null) => { child.current = guard; }, []);
  const close = useCallback(() => { if (leave()) onClose(); }, [leave, onClose]);
  useLayoutEffect(() => { registerLeaveGuard(leave); return () => registerLeaveGuard(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => { const element = dialog.current; if (!current() || !element) return; element.showModal();
    return () => { if (element.open) element.close(); }; }, [current]);
  useLayoutEffect(() => { const hide = () => { flushSync(() => setShown(false)); onClose(); };
    const visibility = () => { if (document.hidden) hide(); }; document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); }; }, [onClose]);
  let target: ReminderReviewTarget; try { target = reminderCorrectionTarget(props.target); } catch { return null; }
  if (!shown || !props.enabled || !remindersAuthCurrent(props.isCurrentAuth) || typeof document !== "undefined" && document.hidden) return null;
  return <dialog ref={dialog} aria-label="提醒中的受托首次补正原入口" className="m-auto min-w-0 rounded-2xl border bg-white text-slate-900 backdrop:bg-slate-900/40"
    style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
    onCancel={event => { event.preventDefault(); close(); }}>
    <section className="min-w-0 space-y-2 border-b p-4 text-sm"><p className="font-semibold">从提醒进入原受托补正工作区</p><p className="break-all">目标申请：{target.requestId}</p>
      <p>这是历史指针，不代表当前责任或审批资格。请明确读取本人委托、选择当前有效授权，再在其范围内查找此申请并读取详情。不自动选择、翻页、审批或标记已读。</p></section>
    <Suspense fallback={<section className="p-4"><p role="status">正在加载原补正授权选择器…</p><button onClick={close}>关闭受托补正入口</button></section>}>
      <Panel siteId={props.siteId} access="delegate" actorId={props.employeeId} authUserId={props.authUserId} apiFetch={props.apiFetch}
        isCurrentAuth={current} enabled={props.enabled} registerLeaveGuard={registerChild} onClose={() => { if (current()) props.onClose(); }}/>
    </Suspense>
  </dialog>;
}
