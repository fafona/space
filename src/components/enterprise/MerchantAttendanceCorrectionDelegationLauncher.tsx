"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { correctionDelegationPendingKey } from "@/lib/merchantAttendanceCorrectionDelegationClient";
import type { CorrectionDelegationPanelProps } from "./MerchantAttendanceCorrectionDelegationPanel";
const Panel = lazy(() => import("./MerchantAttendanceCorrectionDelegationPanel"));
export type CorrectionDelegationLauncherProps = Omit<CorrectionDelegationPanelProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const correctionDelegationLauncherIdentityValid = (access: "owner" | "delegate", actor: string, auth: string) => uuid(actor) && uuid(auth) && (access !== "owner" || actor === auth);
export const correctionDelegationLauncherVisible = (enabled: boolean, pending: boolean, open: boolean) => enabled || pending || open;
/* eslint-disable react-hooks/refs -- This monotonic render-time fence revokes old scope before effects; abandoned renders can only invalidate old authority. */
export default function MerchantAttendanceCorrectionDelegationLauncher(props: CorrectionDelegationLauncherProps) {
  const { active, isCurrentAuth: authCurrent } = props;
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED === "1";
  const key = JSON.stringify([props.siteId, props.access, props.actorId, props.authUserId, props.active !== false, enabled]);
  const live = useRef({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== props.apiFetch || live.current.auth !== props.isCurrentAuth) live.current = { key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token, isCurrentAuth = useCallback(() => live.current.token === token && active !== false && authCurrent?.() !== false, [token, active, authCurrent]);
  if (props.active === false || !/^\d{8}$/.test(props.siteId) || !correctionDelegationLauncherIdentityValid(props.access, props.actorId, props.authUserId)) return null;
  return <Launcher key={token} {...props} enabled={enabled} isCurrentAuth={isCurrentAuth}/>;
}
/* eslint-enable react-hooks/refs */
function Launcher(props: CorrectionDelegationLauncherProps & { enabled: boolean; isCurrentAuth: () => boolean }) {
  const {siteId,access,actorId,isCurrentAuth,registerLeaveGuard}=props;
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const pending = useCallback(() => { if (!isCurrentAuth()) return false; try { return sessionStorage.getItem(correctionDelegationPendingKey(siteId, access, actorId)) !== null; } catch { return true; } }, [siteId, access, actorId, isCurrentAuth]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const registerChild = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => isCurrentAuth() && (!guard.current || guard.current()), [isCurrentAuth]);
  useLayoutEffect(() => { if (!open) return; registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [open, registerLeaveGuard, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (!correctionDelegationLauncherVisible(props.enabled, recoverable, open)) return null;
  return <div className="min-w-0 space-y-2"><button className={button} disabled={props.disabled} onClick={() => {
    if (props.disabled || !props.isCurrentAuth() || document.hidden || props.beforeOpen && !props.beforeOpen() || !props.isCurrentAuth()) return; setOpen(true);
  }}>{!props.enabled ? "核对待确认补正委托原编号" : props.access === "owner" ? "首次补正审批委托管理" : "受托首次补正审批"}</button>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A full-document transition deliberately enters independent Supabase reauthentication, not the current business scope. */}
    <a className="block text-sm underline" href="/enterprise/attendance-recovery" onClick={e => { if (!props.isCurrentAuth() || props.beforeOpen && !props.beforeOpen() || !leave()) e.preventDefault(); }}>核对补正委托原编号（独立恢复）</a>
    {open && <dialog ref={dialog} aria-label="首次补正审批委托工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={e => { e.preventDefault(); close(); }} onClose={e => { if (e.currentTarget === dialog.current) close(); }} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载首次补正委托…</p><button className={button} onClick={close}>关闭</button></div>}><Panel {...props} registerLeaveGuard={registerChild} onClose={() => { if (props.isCurrentAuth()) setOpen(false); }}/></Suspense>
    </dialog>}
  </div>;
}
