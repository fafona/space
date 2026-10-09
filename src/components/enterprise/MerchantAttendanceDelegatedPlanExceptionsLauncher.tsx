"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { attendanceManagementPendingKey } from "@/lib/merchantAttendanceManagementDelegatedClient";
import type { DelegatedPlanExceptionsPanelProps } from "./MerchantAttendanceDelegatedPlanExceptionsPanel";
const Panel = lazy(() => import("./MerchantAttendanceDelegatedPlanExceptionsPanel"));
type Props = Omit<DelegatedPlanExceptionsPanelProps, "onClose"> & Readonly<{ active?: boolean; disabled?: boolean; beforeOpen?: () => boolean }>;
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const current = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
export default function MerchantAttendanceDelegatedPlanExceptionsLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED === "1";
  const key = JSON.stringify([props.siteId, props.actorId, props.ownerMode === true, props.requesterKey ?? null, enabled, props.grantEnabled === true, props.active !== false]);
  const [scope, setScope] = useState({ key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: 0 });
  if (scope.key !== key || scope.apiFetch !== props.apiFetch || scope.auth !== props.isCurrentAuth || scope.storage !== props.storage) {
    setScope({ key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: scope.revision + 1 }); return null;
  }
  if (props.active === false || !current(props.isCurrentAuth)) return null;
  return <Entry key={scope.revision} {...props} enabled={enabled}/>;
}
function Entry(props: Props & { enabled: boolean }) {
  const key = attendanceManagementPendingKey(props.siteId, props.actorId);
  const snapshot = useCallback(() => { try { return (props.storage ?? (() => sessionStorage))().getItem(key) !== null; } catch { return true; } }, [props.storage, key]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, snapshot, () => false);
  if (!props.enabled && !recoverable) return null;
  return <Launcher {...props}/>;
}
function Launcher({ disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: Props & { enabled: boolean }) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => !guard.current || guard.current(), []);
  useLayoutEffect(() => { if (!open) return; outerRegister?.(leave); return () => outerRegister?.(null); }, [open, outerRegister, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <><button className={button} disabled={disabled} onClick={() => { if (!document.hidden && current(props.isCurrentAuth)
    && (!beforeOpen || beforeOpen()) && current(props.isCurrentAuth) && !document.hidden) setOpen(true); }}>{props.enabled ? "正式异常审批委托" : "核对正式异常委托原编号"}</button>
    {open && <dialog ref={dialog} aria-label="正式异常审批委托工作区" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载正式异常审批委托…</p><button className={button} onClick={close}>关闭</button></div>}><Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/></Suspense>
    </dialog>}
  </>;
}
