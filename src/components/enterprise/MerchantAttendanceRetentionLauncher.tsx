"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { retentionClientPendingKey } from "@/lib/merchantAttendanceRetentionClient";
const Panel = lazy(() => import("./MerchantAttendanceRetentionPanel"));
export type RetentionLauncherProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean; active?: boolean; disabled?: boolean; periodsV2Enabled?: boolean;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceRetentionLauncher(props: RetentionLauncherProps) {
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.actorId}`} {...props} enabled={props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_ENABLED === "1"}/>;
}
function Launcher(props: RetentionLauncherProps & { enabled: boolean }) {
  const pending = useCallback(() => { try { return sessionStorage.getItem(retentionClientPendingKey(props.siteId, props.actorId)) !== null; } catch { return true; } }, [props.siteId, props.actorId]);
  const subscribe = useCallback((fn: () => void) => { window.addEventListener("storage", fn); window.addEventListener("focus", fn);
    return () => { window.removeEventListener("storage", fn); window.removeEventListener("focus", fn); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false), [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const outer = props.registerLeaveGuard;
  const register = useCallback((value: (() => boolean) | null) => { guard.current = value; outer?.(value); }, [outer]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (!props.enabled && !recoverable && !open) return null;
  return <><button type="button" className={button} disabled={props.disabled} onClick={() => setOpen(true)}>{props.enabled ? "资料保留与单条保全" : "核对资料保留待确认操作"}</button>
    {open && <dialog ref={dialog} aria-label="资料保留与单条保全" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(66rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={e => { e.preventDefault(); close(); }} onClose={close} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载资料保留…</p><button className={button} onClick={close}>关闭</button></div>}>
        <Panel {...props} registerLeaveGuard={register} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
