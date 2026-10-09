"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DayReviewWorkspaceProps } from "./MerchantAttendanceDayReviewWorkspace";
const Panel = lazy(() => import("./MerchantAttendanceDayReviewWorkspace"));
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
type Props = Omit<DayReviewWorkspaceProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
export default function MerchantAttendanceDayReviewLauncher(props: Props) {
  if (props.active === false || props.isCurrentAuth?.() === false) return null;
  return <Launcher key={`${props.siteId}:${props.actorId}:${props.access}:${props.workerId ?? ""}`} {...props}/>;
}
function Launcher({ active, disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: Props) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegister?.(value); }, [outerRegister]);
  const close = useCallback(() => {
    const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (active === false) return null;
  return <><button className={button} type="button" disabled={disabled} onClick={() => {
    if (!document.hidden && props.isCurrentAuth?.() !== false && (!beforeOpen || beforeOpen())) setOpen(true);
  }}>{props.access === "owner" ? "出勤情况核查／历史与恢复" : "我的出勤核查与说明"}</button>
    {open && <dialog ref={dialog} aria-label="出勤情况核查工作区" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
      onCancel={e => { e.preventDefault(); close(); }} onClose={e => { if (e.currentTarget === dialog.current) close(); }}
      onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载出勤核查…</p><button className={button} type="button" onClick={close}>关闭</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
