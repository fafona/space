"use client";

import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceRuleCapturesPanel"));
export type AttendanceRuleCapturesPanelProps = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch };

export default function MerchantAttendanceRuleCapturesLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED === "1", active = true,
  ...props }: AttendanceRuleCapturesPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}

function Launcher(props: AttendanceRuleCapturesPanelProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null), closeHandler = useRef<(() => void) | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const registerCloseHandler = useCallback((handler: (() => void) | null) => { closeHandler.current = handler; }, []);
  const requestClose = useCallback(() => { if (closeHandler.current) closeHandler.current(); else close(); }, [close]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return <>
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>候选来源留存（未应用）</button>
    {open && <dialog ref={dialogRef} aria-label="候选来源留存（未应用）" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(54rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); requestClose(); }} onClose={close}>
      <Suspense fallback={<div className="space-y-4 p-4"><p role="status">正在加载候选来源留存…</p><button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={requestClose}>关闭候选来源留存</button></div>}>
        <Panel {...props} onClose={close} registerCloseHandler={registerCloseHandler}/>
      </Suspense>
    </dialog>}
  </>;
}
