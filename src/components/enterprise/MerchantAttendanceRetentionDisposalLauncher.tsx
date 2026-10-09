"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { DISPOSAL_LOCAL_SITE } from "@/lib/merchantAttendanceRetentionDisposalExecution";
import type { RetentionDisposalPanelProps } from "./MerchantAttendanceRetentionDisposalPanel";
const Panel = lazy(() => import("./MerchantAttendanceRetentionDisposalPanel"));
type Props = Omit<RetentionDisposalPanelProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceRetentionDisposalLauncher(props: Props) {
  if (props.active === false || props.siteId !== DISPOSAL_LOCAL_SITE) return null;
  return <Launcher key={`${props.siteId}:${props.authUserId}`} {...props}/>;
}
function Launcher({ active, disabled, beforeOpen, registerLeaveGuard: outer, ...props }: Props) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const register = useCallback((value: (() => boolean) | null) => { guard.current = value; outer?.(value); }, [outer]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (active === false) return null;
  return <><button type="button" className={button} disabled={disabled} onClick={() => { if (!document.hidden && props.isCurrentAuth() === true && beforeOpen()) setOpen(true); }}>本地单条定位处置验收</button>
    {open && <dialog ref={dialog} aria-label="单条处置工作区" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(54rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={e => { e.preventDefault(); close(); }} onClose={close} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载单条处置…</p><button type="button" className={button} onClick={close}>关闭</button></div>}>
        <Panel {...props} registerLeaveGuard={register} onClose={() => setOpen(false)}/>
      </Suspense></dialog>}
  </>;
}
