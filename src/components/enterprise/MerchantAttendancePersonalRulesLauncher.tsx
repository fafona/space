"use client";

import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendancePersonalRulesPanel"));
export type AttendancePersonalRulesPanelProps = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch };

export default function MerchantAttendancePersonalRulesLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED === "1", active = true,
  ...props }: AttendancePersonalRulesPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}

function Launcher(props: AttendancePersonalRulesPanelProps) {
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
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={() => setOpen(true)}>个人例外候选（未应用）</button>
    {open && <dialog ref={dialogRef} aria-label="个人例外候选管理（未应用）" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(58rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); requestClose(); }}>
      <Suspense fallback={<div className="space-y-4 p-4"><p role="status">正在加载个人例外候选记录…</p><button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={requestClose}>关闭个人例外</button></div>}>
        <Panel {...props} onClose={close} registerCloseHandler={registerCloseHandler}/>
      </Suspense>
    </dialog>}
  </>;
}
