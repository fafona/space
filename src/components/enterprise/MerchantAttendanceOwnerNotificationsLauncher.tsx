"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ownerNotificationsPendingKey } from "@/lib/merchantAttendanceOwnerNotificationsClient";
import { parseOwnerNotificationsItem, type OwnerNotificationsItem } from "@/lib/merchantAttendanceOwnerNotifications";
import type { OwnerNotificationsPanelProps } from "./MerchantAttendanceOwnerNotificationsPanel";

const Panel = lazy(() => import("./MerchantAttendanceOwnerNotificationsPanel"));
const PlanWorkspace = lazy(() => import("./MerchantAttendancePlanExceptionWorkspace"));
const PeriodWorkspace = lazy(() => import("./MerchantAttendancePeriodClosureV2Workspace"));
export type OwnerNotificationsLauncherProps = Omit<OwnerNotificationsPanelProps, "onClose" | "onOpenTarget" | "recoveryOnly"> & {
  authUserId: string; active?: boolean; disabled?: boolean; beforeOpen?: () => boolean; beforeTarget?: () => boolean;
  planExceptionsEnabled?: boolean; periodsEnabled?: boolean;
};
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export function ownerNotificationsLauncherIdentity(siteId: string, actorId: string, authUserId: string) {
  try { ownerNotificationsPendingKey(siteId, actorId); return actorId === authUserId; } catch { return false; }
}
/* eslint-disable react-hooks/refs -- This monotonic render-time fence revokes old async authority before effects. An interrupted render can conservatively invalidate a lease, never reauthorize one. */
export default function MerchantAttendanceOwnerNotificationsLauncher(props: OwnerNotificationsLauncherProps) {
  const { siteId, actorId, authUserId, active, apiFetch, isCurrentAuth: checkAuth, planExceptionsEnabled, periodsEnabled } = props;
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_ENABLED === "1";
  const key = JSON.stringify([siteId, actorId, authUserId, active !== false, enabled, planExceptionsEnabled, periodsEnabled]);
  const live = useRef({ key, fetch: apiFetch, auth: checkAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== apiFetch || live.current.auth !== checkAuth)
    live.current = { key, fetch: apiFetch, auth: checkAuth, token: live.current.token + 1 };
  const token = live.current.token;
  const isCurrentAuth = useCallback(() => live.current.token === token && active !== false && checkAuth?.() !== false, [token, active, checkAuth]);
  if (active === false || !ownerNotificationsLauncherIdentity(siteId, actorId, authUserId)) return null;
  return <Launcher key={token} {...props} enabled={enabled} isCurrentAuth={isCurrentAuth}/>;
}
/* eslint-enable react-hooks/refs */
function Launcher(props: OwnerNotificationsLauncherProps & { enabled: boolean; isCurrentAuth: () => boolean }) {
  const { siteId, actorId, isCurrentAuth, registerLeaveGuard } = props;
  const [open, setOpen] = useState(false), [selection, setSelection] = useState<OwnerNotificationsItem | null>(null), [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), guard = useRef<{ key: string; run: () => boolean } | null>(null), closing = useRef(false);
  const childKey = selection?.notificationId ?? "inbox";
  const registerChild = useCallback((run: (() => boolean) | null) => { if (run) guard.current = { key: childKey, run }; else if (guard.current?.key === childKey) guard.current = null; }, [childKey]);
  const pending = useCallback(() => { if (!isCurrentAuth()) return false;
    try { return sessionStorage.getItem(ownerNotificationsPendingKey(siteId, actorId)) !== null; } catch { return true; }
  }, [siteId, actorId, isCurrentAuth]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const leave = useCallback(() => isCurrentAuth() && (!guard.current || guard.current.run()), [isCurrentAuth]);
  useLayoutEffect(() => { if (!open) return; registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [open, registerLeaveGuard, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return;
      if (allowed) { setOpen(false); setSelection(null); } else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <div className="min-w-0 space-y-2">
    {(props.enabled || recoverable || open) && <button type="button" className={button} disabled={props.disabled} onClick={() => {
      if (props.disabled || document.hidden || !props.isCurrentAuth() || props.beforeOpen && !props.beforeOpen() || !props.isCurrentAuth()) return;
      setSelection(null); setMessage(""); setOpen(true);
    }}>{props.enabled ? "负责人考勤收件" : "核对待确认标读原号"}</button>}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full-document navigation deliberately re-verifies Auth on the independent recovery page, without prefetch or reusing this workspace session. */}
    <a className="block text-sm underline" href="/enterprise/attendance-owner-notifications-recovery" onClick={event => {
      if (!props.isCurrentAuth() || !leave() || props.beforeOpen && !open && !props.beforeOpen()) event.preventDefault();
    }}>负责人标读原号独立恢复</a>
    {open && <dialog ref={dialog} aria-label="负责人收件与原事项工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(68rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      {message && <p role="alert" className="p-4 text-sm">{message}</p>}
      <Suspense fallback={<div className="p-4"><p role="status">正在加载负责人收件工作区…</p><button type="button" className={button} onClick={close}>关闭</button></div>}>
        {selection ? <Target {...props} item={selection} registerLeaveGuard={registerChild} onClose={() => { if (props.isCurrentAuth()) { setSelection(null); setMessage(""); } }}/>
          : <Panel {...props} registerLeaveGuard={registerChild} onClose={() => { if (props.isCurrentAuth()) setOpen(false); }} onOpenTarget={item => {
            if (!props.enabled || !props.isCurrentAuth() || document.hidden || pending() || props.beforeTarget && !props.beforeTarget() || !props.isCurrentAuth()) {
              setMessage("当前存在其他草稿、待确认操作或身份变化；未打开原事项，请先完成核对。"); return;
            }
            setSelection(parseOwnerNotificationsItem(item)); setMessage("");
          }}/>}</Suspense>
    </dialog>}
  </div>;
}
function Target(props: OwnerNotificationsLauncherProps & { item: OwnerNotificationsItem; onClose: () => void; isCurrentAuth: () => boolean }) {
  const item = props.item;
  const expected = useMemo(() => ({ workerId: item.workerId, employeeId: item.employeeId, employeeAuthUserId: item.employeeAuthUserId }), [item]);
  const planTarget = useMemo(() => item.sourceCategory === "plan_exception" ? { ...expected, caseId: item.sourceId, slotId: item.target.slotId } : null, [item, expected]);
  const periodTarget = useMemo(() => item.sourceCategory === "period" ? { ...expected, ...item.target } : null, [item, expected]);
  return <div className="min-w-0"><p className="p-4 text-sm">返回仅回到收件工作区，不自动刷新名单或标为已读。已处理、封存或身份变化以当前原事项结果为准。</p>
    {planTarget ? <PlanWorkspace siteId={props.siteId} access="owner" actorId={props.actorId} apiFetch={props.apiFetch} enabled={props.planExceptionsEnabled}
      initialTarget={planTarget} expectedNotificationTarget={planTarget} isCurrentAuth={props.isCurrentAuth} registerLeaveGuard={props.registerLeaveGuard} onClose={props.onClose}/>
      : periodTarget && <PeriodWorkspace siteId={props.siteId} access="owner" actorId={props.actorId} workerId={periodTarget.workerId} fromDate={periodTarget.fromDate} throughDate={periodTarget.throughDate}
        apiFetch={props.apiFetch} enabled={props.periodsEnabled ?? (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED === "1")}
        expectedNotificationTarget={periodTarget} isCurrentAuth={props.isCurrentAuth} registerLeaveGuard={props.registerLeaveGuard} onClose={props.onClose}/>}
  </div>;
}
