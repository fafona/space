"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

const Panel = lazy(() => import("./MerchantAttendanceAccountSuspensionPanel"));
export type AccountSuspensionPanelProps = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Props = AccountSuspensionPanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

// This safety entry is deliberately independent of the new-status rollout flag.
// Mounting/opening is local-only; reading requires an explicit button.
export default function MerchantAttendanceAccountSuspensionLauncher(props: Props) {
  if (props.active === false) return null;
  return <Launcher key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}
function Launcher(props: Props) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const outerRegister = props.registerLeaveGuard;
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegister?.(value); }, [outerRegister]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, []);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <><button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>考勤暂停待核验</button>
    {open && <dialog ref={dialog} aria-label="账号与考勤暂停工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(56rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载考勤暂停核验…</p><button type="button" className={button} onClick={close}>关闭暂停核验</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/>
      </Suspense>
    </dialog>}
  </>;
}
