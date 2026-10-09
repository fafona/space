"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ManagementDelegatedPanelProps } from "./MerchantAttendanceManagementDelegatedPanel";
const Panel = lazy(() => import("./MerchantAttendanceManagementDelegatedPanel"));
const managementCurrentAuth = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
type Props = Omit<ManagementDelegatedPanelProps, "onClose"> & Readonly<{ active?: boolean; disabled?: boolean; beforeOpen?: () => boolean }>;
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export default function MerchantAttendanceManagementDelegatedLauncher(props: Props) {
  const key = JSON.stringify([props.siteId, props.actorId, props.ownerMode === true, props.requesterKey ?? null, props.grantEnabled === true, props.auditEnabled === true, props.groupsEnabled === true, props.configurationEnabled === true, props.rulesEnabled === true, props.terminalsEnabled === true, props.pinEnabled === true, props.revisionsEnabled === true, props.active !== false]);
  const [scope, setScope] = useState({ key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: 0 });
  if (scope.key !== key || scope.apiFetch !== props.apiFetch || scope.auth !== props.isCurrentAuth || scope.storage !== props.storage) {
    setScope({ key, apiFetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: scope.revision + 1 }); return null;
  }
  if (props.active === false || !managementCurrentAuth(props.isCurrentAuth)) return null;
  return <Launcher key={scope.revision} {...props}/>;
}
function Launcher({ disabled, beforeOpen, registerLeaveGuard: outerRegister, ...props }: Props) {
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => !guard.current || guard.current(), []);
  useLayoutEffect(() => { if (!open) return; outerRegister?.(leave); return () => outerRegister?.(null); }, [open, outerRegister, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return;
      if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  return <><button className={button} disabled={disabled} onClick={() => { if (!document.hidden && managementCurrentAuth(props.isCurrentAuth)
    && (!beforeOpen || beforeOpen()) && managementCurrentAuth(props.isCurrentAuth) && !document.hidden) setOpen(true); }}>管理委托／资源审计</button>
    {open && <dialog ref={dialog} aria-label="管理委托与资源审计工作区" className="m-auto rounded-2xl border bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载管理委托／资源审计…</p><button className={button} onClick={close}>关闭</button></div>}><Panel {...props} registerLeaveGuard={registerLeaveGuard} onClose={() => setOpen(false)}/></Suspense>
    </dialog>}
  </>;
}
