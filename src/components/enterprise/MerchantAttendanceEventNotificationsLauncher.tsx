"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { eventNotificationsPendingKey } from "@/lib/merchantAttendanceEventNotificationsClient";

const Panel = lazy(() => import("./MerchantAttendanceEventNotificationsPanel"));
export type EventNotificationsPanelProps = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Props = EventNotificationsPanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export const eventNotificationsLauncherVisible = (enabled: boolean, pending: boolean, open: boolean) => enabled || pending || open;

export default function MerchantAttendanceEventNotificationsLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_ENABLED === "1";
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.employeeId}`} {...props} enabled={enabled}/>;
}
function Launcher(props: Props & { enabled: boolean }) {
  const pending = useCallback(() => { try { return sessionStorage.getItem(eventNotificationsPendingKey(props.siteId, props.employeeId)) !== null; } catch { return true; } }, [props.siteId, props.employeeId]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const outerRegister = props.registerLeaveGuard;
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegister?.(value); }, [outerRegister]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal();
    return () => { if (element.open) element.close(); }; }, [open]);
  if (!eventNotificationsLauncherVisible(props.enabled, recoverable, open)) return null;
  return <>
    <button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>{props.enabled ? "考勤消息" : "核对待确认消息标读"}</button>
    {open && <dialog ref={dialog} aria-label="考勤消息工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(55rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载考勤消息…</p><button type="button" className={button} onClick={close}>关闭考勤消息</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
