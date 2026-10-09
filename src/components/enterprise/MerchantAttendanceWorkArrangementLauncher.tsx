"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { workArrangementPendingKey } from "@/lib/merchantAttendanceWorkArrangementClient";
import type { ReviewRoutingRequest } from "@/lib/merchantAttendanceReviewRouting";

const Panel = lazy(() => import("./MerchantAttendanceWorkArrangementPanel"));
export type WorkArrangementPanelProps = { siteId: string; access: "owner" | "self"; actorId: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void; initialSelection?: ReviewRoutingRequest | null; isCurrentAuth?: () => boolean };
type Props = WorkArrangementPanelProps & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean; onTargetClose?: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";

export default function MerchantAttendanceWorkArrangementLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED === "1";
  const pending = useCallback(() => { try { return sessionStorage.getItem(workArrangementPendingKey(props.siteId, props.access, props.actorId)) !== null; } catch { return true; } }, [props.siteId, props.access, props.actorId]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  if (props.active === false || !enabled && !recoverable) return null;
  return <Launcher key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Launcher(props: Props & { enabled: boolean }) {
  const outerRegisterLeaveGuard = props.registerLeaveGuard;
  const onTargetClose = props.onTargetClose;
  const [open, setOpen] = useState(!!props.initialSelection), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null);
  const closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; outerRegisterLeaveGuard?.(value); }, [outerRegisterLeaveGuard]);
  const close = useCallback(() => {
    const element = dialog.current; if (!element || closing.current) return;
    closing.current = true;
    // Delay native confirmation beyond cancel dispatch; Escape cannot bypass the guard.
    queueMicrotask(() => { try {
      if (dialog.current !== element) return;
      const allowed = !guard.current || guard.current();
      if (dialog.current !== element) return;
      if (allowed) { setOpen(false); onTargetClose?.(); } else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, [onTargetClose]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return;
    element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <>
    <button type="button" className={button} disabled={props.disabled} onClick={() => { if (!props.beforeOpen || props.beforeOpen()) setOpen(true); }}>
      {!props.enabled ? "核对待确认工作安排" : props.access === "owner" ? "工作安排审批与政策" : "我的出差／外勤／远程申请"}</button>
    {open && <dialog ref={dialog} aria-label="出差、外勤与远程工作安排" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(60rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载工作安排…</p><button type="button" className={button} onClick={close}>关闭工作安排</button></div>}>
        <Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => { setOpen(false); props.onTargetClose?.(); }}/>
      </Suspense>
    </dialog>}
  </>;
}
