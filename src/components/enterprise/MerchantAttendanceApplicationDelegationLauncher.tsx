"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { applicationDelegationPendingKey } from "@/lib/merchantAttendanceApplicationDelegationClient";

const Panel = lazy(() => import("./MerchantAttendanceApplicationDelegationPanel"));
export type ApplicationDelegationPanelProps = { siteId: string; access: "owner" | "delegate"; actorId: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Props = ApplicationDelegationPanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export const applicationDelegationLauncherVisible = (enabled: boolean, recoverable: boolean, open: boolean) => enabled || recoverable || open;

export default function MerchantAttendanceApplicationDelegationLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED === "1";
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Launcher(props: Props & { enabled: boolean }) {
  const pending = useCallback(() => { try { return sessionStorage.getItem(applicationDelegationPendingKey(props.siteId, props.access, props.actorId)) !== null; } catch { return true; } }, [props.siteId, props.access, props.actorId]);
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
  // A settled exact key does not discard this scope's already-open receipt.
  if (!applicationDelegationLauncherVisible(props.enabled, recoverable, open)) return null;
  return <>
    <button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>
      {!props.enabled ? "核对待确认申请委托操作" : props.access === "owner" ? "请假与工作安排审批委托" : "受托请假与工作安排审批"}</button>
    {open && <dialog ref={dialog} aria-label="申请审批委托工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载申请审批委托…</p><button type="button" className={button} onClick={close}>关闭申请委托</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
