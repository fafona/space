"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { remindersAuthCurrent } from "@/lib/merchantAttendanceRemindersClient";
import type { RemindersPanelProps } from "./MerchantAttendanceRemindersPanel";
const Panel = lazy(() => import("./MerchantAttendanceRemindersPanel"));
export type RemindersLauncherProps = Omit<RemindersPanelProps, "onClose"> & { disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
/** A fresh navigation result is only a pointer; the real host must accept it.
 * Close the reminder modal only after that synchronous, same-scope handoff. */
export function reminderUiHandoff(current: () => boolean, openOriginal: () => boolean, closeReminder: () => void): boolean {
  if (!current() || !openOriginal() || !current()) return false;
  closeReminder(); return true;
}
export default function MerchantAttendanceRemindersLauncher(props: RemindersLauncherProps) {
  const key = JSON.stringify([props.siteId, props.actorId, props.ownerId ?? null, props.selfEmployeeId ?? null, props.requesterKey ?? null, props.enabled === true, props.active !== false, props.recoveryOnly === true]);
  const [marker, setMarker] = useState({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: 0 });
  if (marker.key !== key || marker.fetch !== props.apiFetch || marker.auth !== props.isCurrentAuth) { setMarker({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: marker.version + 1 }); return null; }
  if (props.active === false || !remindersAuthCurrent(props.isCurrentAuth)) return null;
  return <Launcher key={marker.version} {...props}/>;
}
function Launcher({ disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: RemindersLauncherProps) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const mountedOpen = useRef(false), generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => !guard.current || guard.current(), []);
  useLayoutEffect(() => { if (!open) return; mountedOpen.current = true; invalidate(); outerRegister?.(leave);
    return () => { mountedOpen.current = false; invalidate(); outerRegister?.(null); }; }, [open, outerRegister, leave, invalidate]);
  const handoff = (accept: () => boolean) => { const token = generation.current;
    return reminderUiHandoff(() => mountedOpen.current && token === generation.current && !document.hidden && remindersAuthCurrent(props.isCurrentAuth),
      accept, () => { generation.current++; setOpen(false); }); };
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; if (leave()) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <><button type="button" className={button} disabled={disabled} onClick={() => {
    if (!document.hidden && remindersAuthCurrent(props.isCurrentAuth) && (!beforeOpen || beforeOpen()) && !document.hidden && remindersAuthCurrent(props.isCurrentAuth)) setOpen(true);
  }}>考勤站内提醒</button>{open && <dialog ref={dialog} aria-label="考勤站内提醒" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
    onCancel={e => { e.preventDefault(); close(); }} onClose={close} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <Suspense fallback={<section className="p-4"><p role="status">正在加载提醒工作区…</p><button type="button" className={button} onClick={close}>关闭提醒</button></section>}>
      <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}
        onOpenOriginal={props.onOpenOriginal ? request => handoff(() => props.onOpenOriginal!(request)) : undefined}
        onOpenSelfSession={props.onOpenSelfSession ? value => handoff(() => props.onOpenSelfSession!(value)) : undefined}
        onOpenDelegateTarget={props.onOpenDelegateTarget ? target => handoff(() => props.onOpenDelegateTarget!(target)) : undefined}
        onOpenPeriod={props.onOpenPeriod ? value => handoff(() => props.onOpenPeriod!(value)) : undefined}/>
    </Suspense>
  </dialog>}</>;
}
