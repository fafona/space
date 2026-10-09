"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { outageClientPendingKey } from "@/lib/merchantAttendanceOutageClient";

const Panel = lazy(() => import("./MerchantAttendanceOutagePanel"));
export type OutageLauncherProps = { siteId: string; actorId: string; access: "owner" | "self"; workerId?: string | null;
  apiFetch: AttendanceApiFetch; enabled?: boolean; printEnabled?: boolean; relationsEnabled?: boolean; active?: boolean; disabled?: boolean; beforeOpen?: () => boolean;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export const outageLauncherVisible = (enabled: boolean, pending: boolean, open: boolean, printEnabled = false, relationsEnabled = false) => enabled || pending || open || printEnabled || relationsEnabled;
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceOutageLauncher(props: OutageLauncherProps) {
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.actorId}:${props.access}:${props.workerId ?? "all"}`} {...props}
    printEnabled={props.printEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_PRINT_ENABLED === "1"}
    relationsEnabled={props.relationsEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED === "1"}
    enabled={props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_ENABLED === "1"}/>;
}
function Launcher(props: OutageLauncherProps & { enabled: boolean }) {
  const pending = useCallback(() => { try { return (["outages", "links", "reviews", "relations"] as const).some(kind =>
    sessionStorage.getItem(outageClientPendingKey(kind, props.siteId, props.access, props.actorId)) !== null); } catch { return true; } }, [props.siteId, props.access, props.actorId]);
  const subscribe = useCallback((fn: () => void) => { window.addEventListener("storage", fn); window.addEventListener("focus", fn);
    return () => { window.removeEventListener("storage", fn); window.removeEventListener("focus", fn); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const outer = props.registerLeaveGuard;
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outer?.(value); }, [outer]);
  const close = useCallback(() => {
    const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try {
      if (dialog.current !== element) return;
      const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal();
    return () => { if (element.open) element.close(); }; }, [open]);
  if (!outageLauncherVisible(props.enabled, recoverable, open, props.printEnabled, props.relationsEnabled)) return null;
  return <><button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>
    {!props.enabled ? props.printEnabled ? "故障备用纸表与资料核对" : props.relationsEnabled ? "故障声明关系与资料核对" : "核对待确认故障操作" : props.workerId ? "登记该人员故障声明" : props.access === "self" ? "我的故障声明与核对" : "故障登记与恢复核对"}</button>
    {open && <dialog ref={dialog} aria-label="故障登记与恢复工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(70rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载故障工作区…</p><button type="button" className={button} onClick={close}>关闭故障工作区</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
