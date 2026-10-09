"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { scheduleDelegationPendingKey } from "@/lib/merchantAttendanceScheduleDelegationClient";

const Panel = lazy(() => import("./MerchantAttendanceScheduleDelegationPanel"));
export type ScheduleDelegationPanelProps = { siteId: string; access: "owner" | "delegate"; actorId: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Props = ScheduleDelegationPanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export const scheduleDelegationLauncherVisible = (access: "owner" | "delegate", enabled: boolean, pending: boolean, open: boolean) => access === "owner" || enabled || pending || open;

export default function MerchantAttendanceScheduleDelegationLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED === "1";
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Launcher(props: Props & { enabled: boolean }) {
  const pending = useCallback(() => { try { return sessionStorage.getItem(scheduleDelegationPendingKey(props.siteId, props.access, props.actorId)) !== null; } catch { return true; } }, [props.siteId, props.access, props.actorId]);
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
  if (!scheduleDelegationLauncherVisible(props.access, props.enabled, recoverable, open)) return null;
  return <>
    <button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>
      {props.access === "owner" ? props.enabled ? "主管排班授权" : "排班授权核验／撤销" : props.enabled ? "受托排班" : "核对待确认排班委托操作"}</button>
    {open && <dialog ref={dialog} aria-label="排班委托工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载排班委托…</p><button type="button" className={button} onClick={close}>关闭排班委托</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
