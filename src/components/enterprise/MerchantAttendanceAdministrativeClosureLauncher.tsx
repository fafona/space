"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AdministrativeClosurePanelProps } from "./MerchantAttendanceAdministrativeClosurePanel";
const Panel = lazy(() => import("./MerchantAttendanceAdministrativeClosurePanel"));
type Props = Omit<AdministrativeClosurePanelProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceAdministrativeClosureLauncher(props: Props) {
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.access}:${props.authUserId}`} {...props}/>;
}
function Launcher({ active, disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: Props) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegister?.(value); }, [outerRegister]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (active === false) return null;
  // Saved reads/disputes/recovery must remain reachable when new close is off.
  return <><button type="button" className={button} disabled={disabled} onClick={() => { if (!document.hidden && (!props.isCurrentAuth || props.isCurrentAuth()) && (!beforeOpen || beforeOpen())) setOpen(true); }}>行政结案记录与原号核验</button>
    {open && <dialog ref={dialog} aria-label="行政结案工作区" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载行政记录…</p><button type="button" className={button} onClick={close}>关闭行政记录</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense></dialog>}
  </>;
}
