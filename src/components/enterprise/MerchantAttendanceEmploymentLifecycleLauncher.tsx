"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { employmentLifecyclePendingKey } from "@/lib/merchantAttendanceEmploymentLifecycleClient";

const Panel = lazy(() => import("./MerchantAttendanceEmploymentLifecyclePanel"));
export type EmploymentLifecyclePanelProps = { siteId: string; ownerId: string; workerId?: string | null; apiFetch: AttendanceApiFetch;
  enabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Props = EmploymentLifecyclePanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export const employmentLifecycleLauncherVisible = (enabled: boolean, pending: boolean, open: boolean, workerId: string | null) => enabled || open || pending && workerId === null;

export default function MerchantAttendanceEmploymentLifecycleLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED === "1";
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId ?? "all"}`} {...props} enabled={enabled}/>;
}
function Launcher(props: Props & { enabled: boolean }) {
  const pending = useCallback(() => { try { return sessionStorage.getItem(employmentLifecyclePendingKey(props.siteId, props.ownerId)) !== null; } catch { return true; } }, [props.siteId, props.ownerId]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const outerRegister = props.registerLeaveGuard;
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegister?.(value); }, [outerRegister]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  // Keep a recovered receipt visible until explicit close, including after a
  // focus event discovers that this modal has settled its own pending key.
  if (!employmentLifecycleLauncherVisible(props.enabled, recoverable, open, props.workerId ?? null)) return null;
  return <><button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>
    {!props.enabled ? "核对待确认任职操作" : props.workerId ? "核验任职期" : "任职结束／再入职"}</button>
    {open && <dialog ref={dialog} aria-label="任职生命周期工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载任职核验…</p><button type="button" className={button} onClick={close}>关闭任职核验</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
