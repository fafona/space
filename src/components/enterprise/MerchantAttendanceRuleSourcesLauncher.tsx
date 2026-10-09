"use client";
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceRuleSourcesPanel"));
export type AttendanceRuleSourcesPanelProps = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch };

export default function MerchantAttendanceRuleSourcesLauncher({ enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED === "1", active = true, ...props }:
  AttendanceRuleSourcesPanelProps & { enabled?: boolean; active?: boolean }) {
  if (!enabled || !active) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}

function Launcher(props: AttendanceRuleSourcesPanelProps) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [open]);
  return <>
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" onClick={() => setOpen(true)}>三层规则预览（未应用）</button>
    {open && <dialog ref={dialog} aria-label="三层规则只读预览（未应用）"
      className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载三层规则只读预览…</p><button type="button" onClick={() => setOpen(false)}>关闭三层规则预览</button></div>}>
        <Panel {...props} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
