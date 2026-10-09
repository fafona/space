"use client";
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceRuleCaptureHistoryPanel"));
export type AttendanceRuleCaptureHistoryPanelProps = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch };
export default function MerchantAttendanceRuleCaptureHistoryLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED === "1", active = true,
  ...props }: AttendanceRuleCaptureHistoryPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}
function Launcher(props: AttendanceRuleCaptureHistoryPanelProps) {
  const [open, setOpen] = useState(false), dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current; if (!open || !dialog) return;
    dialog.showModal(); return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return <>
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>候选留存历史（只读）</button>
    {open && <dialog ref={dialogRef} aria-label="候选留存历史（只读）" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(54rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <Suspense fallback={<div className="space-y-4 p-4"><p role="status">正在加载只读留存历史…</p><button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => setOpen(false)}>关闭候选留存历史</button></div>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
