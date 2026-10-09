"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceSourcesPanel"));
export type AttendanceSourcesPanelProps = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch };
export default function MerchantAttendanceSourcesLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SOURCES_ENABLED === "1", active = true, ...props }:
  AttendanceSourcesPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}
function Launcher(props: AttendanceSourcesPanelProps) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const closeRequested = useRef(false);
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => { leaveGuard.current = guard; }, []);
  const close = useCallback(() => {
    const element = dialog.current;
    if (!element || closeRequested.current) return;
    closeRequested.current = true;
    // Native confirmation must not run inside the dialog's cancel dispatch.
    // One pending request also prevents keydown/cancel/close from prompting twice.
    queueMicrotask(() => {
      try {
        if (dialog.current !== element) return;
        const allowed = !leaveGuard.current || leaveGuard.current();
        if (dialog.current !== element) return;
        if (allowed) setOpen(false);
        else if (!element.open) element.showModal();
      } finally { closeRequested.current = false; }
    });
  }, []);
  useLayoutEffect(() => {
    const element = dialog.current; if (!open || !element) return;
    element.showModal(); return () => { if (element.open) element.close(); };
  }, [open]);
  return <>
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" onClick={() => setOpen(true)}>资料核查（只读）</button>
    {open && <dialog ref={dialog} aria-label="员工考勤资料核查" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }}
      onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载资料核查…</p><button type="button" onClick={() => setOpen(false)}>关闭资料核查</button></div>}>
        <Panel {...props} onClose={() => setOpen(false)} registerLeaveGuard={registerLeaveGuard}/>
      </Suspense>
    </dialog>}
  </>;
}
