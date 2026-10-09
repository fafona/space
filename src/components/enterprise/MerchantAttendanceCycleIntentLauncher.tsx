"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CycleIntentPanelProps } from "./MerchantAttendanceCycleIntentPanel";
import { cycleIntentAuthCurrent } from "@/lib/merchantAttendanceCycleIntentClient";
const Panel = lazy(() => import("./MerchantAttendanceCycleIntentPanel"));
export type CycleIntentLauncherProps = Omit<CycleIntentPanelProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceCycleIntentLauncher(props: CycleIntentLauncherProps) {
  const s = props.scope, d = props.delegateScope;
  const key = JSON.stringify([s.siteId, props.actorId, s.access, s.workerId, s.grantId, props.active !== false, props.enabled, props.initialIntentId ?? null,
    d ? [d.siteId, d.actorEmployeeId, d.expectedAuthUserId, d.grantId, d.workerId, d.targetEmployeeId, d.targetAuthUserId, d.authorizedFromDate, d.authorizedThroughDate] : null]);
  const [marker, setMarker] = useState({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: 0 });
  if (marker.key !== key || marker.fetch !== props.apiFetch || marker.auth !== props.isCurrentAuth) {
    setMarker({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: marker.version + 1 }); return null;
  }
  if (props.active === false || !cycleIntentAuthCurrent(props.isCurrentAuth)) return null;
  return <Launcher key={marker.version} {...props}/>;
}
function Launcher({ disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: CycleIntentLauncherProps) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => cycleIntentAuthCurrent(props.isCurrentAuth) && (!guard.current || guard.current()), [props.isCurrentAuth]);
  useLayoutEffect(() => { if (!open) return; outerRegister?.(leave); return () => outerRegister?.(null); }, [open, outerRegister, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <><button type="button" className={button} disabled={disabled} onClick={() => {
    if (!document.hidden && cycleIntentAuthCurrent(props.isCurrentAuth) && (!beforeOpen || beforeOpen()) && !document.hidden && cycleIntentAuthCurrent(props.isCurrentAuth)) setOpen(true);
  }}>周期采用意向</button>{open && <dialog ref={dialog} aria-label="周期采用意向" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
    onCancel={e => { e.preventDefault(); close(); }} onClose={e => { if (e.currentTarget === dialog.current) close(); }}
    onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <Suspense fallback={<div className="p-4"><p role="status">正在加载周期采用意向…</p><button type="button" className={button} onClick={close}>关闭周期意向</button></div>}>
      <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
    </Suspense>
  </dialog>}</>;
}
