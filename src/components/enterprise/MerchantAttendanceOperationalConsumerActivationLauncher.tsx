"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { operationalConsumerActivationPendingKey } from "@/lib/merchantAttendanceOperationalConsumerActivationClient";
import type { OperationalConsumerActivationPanelProps } from "./MerchantAttendanceOperationalConsumerActivationPanel";
const Panel = lazy(() => import("./MerchantAttendanceOperationalConsumerActivationPanel"));
export type OperationalConsumerActivationLauncherProps = Omit<OperationalConsumerActivationPanelProps, "onClose"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean; readOnlyAvailable?: boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
export const operationalConsumerActivationLauncherVisible = (enabled: boolean, pending: boolean, open: boolean, readOnlyAvailable = false) => enabled || pending || open || readOnlyAvailable;
export function OperationalConsumerActivationRecoveryLink({ siteId, actorId, isCurrentAuth, beforeLeave }: { siteId: string; actorId: string; isCurrentAuth: () => boolean; beforeLeave: () => boolean }) {
  const present = useCallback(() => { if (!isCurrentAuth()) return false; try { return (["application_window", "review_routing", "timesheet_cycle", "reminders"] as const).some(consumer => sessionStorage.getItem(operationalConsumerActivationPendingKey(siteId, actorId, consumer)) !== null); } catch { return false; } }, [siteId, actorId, isCurrentAuth]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const pending = useSyncExternalStore(subscribe, present, () => false); if (!pending) return null;
  // No role or owner lookup: the independent recovery page authenticates again.
  return <div className="my-3 min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p>当前账号有待核对的规则启用原编号；失去负责人资格也只能读取这个原操作的最小回执。</p>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full-document transition intentionally authenticates outside the current owner/employee workspace. */}
    <a className="underline" href="/enterprise/attendance-recovery" onClick={e => { if (!isCurrentAuth() || document.hidden || !beforeLeave() || !isCurrentAuth()) e.preventDefault(); }}>独立核对规则启用原编号</a></div>;
}
/* eslint-disable react-hooks/refs -- Synchronous revocation of a prior scope must happen before effect cleanup; abandoned renders only invalidate old authority. */
export default function MerchantAttendanceOperationalConsumerActivationLauncher(props: OperationalConsumerActivationLauncherProps) {
  const { siteId, actorId, apiFetch, active, isCurrentAuth: authCurrent, consumer = "application_window" } = props;
  const enabled = props.enabled ?? (consumer === "reminders" ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED === "1" : consumer === "timesheet_cycle" ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED === "1" : consumer === "review_routing" ? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED === "1" : process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED === "1");
  const key = JSON.stringify([siteId, actorId, consumer, enabled, active !== false]), live = useRef({ key, apiFetch, authCurrent, token: 0 });
  if (live.current.key !== key || live.current.apiFetch !== apiFetch || live.current.authCurrent !== authCurrent) live.current = { key, apiFetch, authCurrent, token: live.current.token + 1 };
  const token = live.current.token, isCurrentAuth = useCallback(() => live.current.token === token && active !== false && authCurrent?.() !== false, [token, active, authCurrent]);
  if (active === false || !/^\d{8}$/.test(siteId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actorId)) return null;
  return <Launcher key={token} {...props} enabled={enabled} isCurrentAuth={isCurrentAuth}/>;
}
/* eslint-enable react-hooks/refs */
function Launcher(props: OperationalConsumerActivationLauncherProps & { enabled: boolean; isCurrentAuth: () => boolean }) {
  const { siteId, actorId, isCurrentAuth, registerLeaveGuard, consumer = "application_window" } = props;
  const name = consumer === "reminders" ? "站内提醒规则" : consumer === "timesheet_cycle" ? "工时表周期规则" : consumer === "review_routing" ? "办理责任规则" : "申请窗口规则";
  const [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), guard = useRef<(() => boolean) | null>(null), closing = useRef(false);
  const pending = useCallback(() => { if (!isCurrentAuth()) return false; try { return sessionStorage.getItem(operationalConsumerActivationPendingKey(siteId, actorId, consumer)) !== null; } catch { return true; } }, [siteId, actorId, consumer, isCurrentAuth]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false), registerChild = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const leave = useCallback(() => isCurrentAuth() && (!guard.current || guard.current()), [isCurrentAuth]);
  useLayoutEffect(() => { if (!open) return; registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [open, registerLeaveGuard, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave(); if (dialog.current !== element) return; if (allowed) setOpen(false); else if (!element.open) element.showModal(); } finally { closing.current = false; } }); }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, [open]);
  if (!operationalConsumerActivationLauncherVisible(props.enabled, recoverable, open, props.readOnlyAvailable)) return null;
  return <div className="min-w-0 space-y-2"><button className={button} disabled={props.disabled} onClick={() => { if (props.disabled || !isCurrentAuth() || document.hidden || props.beforeOpen && !props.beforeOpen() || !isCurrentAuth()) return; setOpen(true); }}>{props.enabled ? `${name}启用` : props.readOnlyAvailable ? `查看／停用${name}` : "核对待确认规则启用原编号"}</button>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full-document reauthentication intentionally separates original-actor recovery from current-owner business scope. */}
    <a className="block text-sm underline" href="/enterprise/attendance-recovery" onClick={e => { if (!isCurrentAuth() || props.beforeOpen && !props.beforeOpen() || !leave()) e.preventDefault(); }}>核对规则启用原编号（独立恢复）</a>
    {open && <dialog ref={dialog} aria-label={`${name}启用工作区`} className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40" style={{ width: "min(64rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={e => { e.preventDefault(); close(); }} onClose={e => { if (e.currentTarget === dialog.current) close(); }} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="p-4"><p role="status">正在加载{name}启用台账…</p><button className={button} onClick={close}>关闭</button></div>}><Panel {...props} registerLeaveGuard={registerChild} onClose={() => { if (isCurrentAuth()) setOpen(false); }}/></Suspense>
    </dialog>}
  </div>;
}


