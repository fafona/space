"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { periodDelegationPendingKey } from "@/lib/merchantAttendancePeriodDelegationClient";
import { cycleIntentAuthCurrent } from "@/lib/merchantAttendanceCycleIntentClient";
import type { PeriodDelegationPanelProps, PeriodDelegationPeriodSelection } from "./MerchantAttendancePeriodDelegationPanel";

const Panel = lazy(() => import("./MerchantAttendancePeriodDelegationPanel"));
const Workspace = lazy(() => import("./MerchantAttendancePeriodDelegatedClosureWorkspace"));
type Props = Omit<PeriodDelegationPanelProps, "onClose" | "onOpenPeriod"> & { active?: boolean; disabled?: boolean; beforeOpen?: () => boolean; periodsEnabled?: boolean; cycleEnabled?: boolean };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export function periodDelegationLauncherIdentityValid(access: "owner" | "delegate", actor: string, auth: string) {
  return uuid(actor) && uuid(auth) && (access !== "owner" || actor === auth);
}
export function periodDelegationLauncherVisible(access: "owner" | "delegate", enabled: boolean, pending: boolean, open: boolean) {
  return access === "owner" || enabled || pending || open;
}
/** Only one child exists at a time. A saved grant is a navigation anchor, never
 * authorization to skip the delegated endpoint's fresh checks. */
/* eslint-disable react-hooks/refs -- This exact monotonic scope fence revokes old async/storage authority before effects. An abandoned render can only invalidate a lease; it cannot reauthorize an old A-B-A token. */
export default function MerchantAttendancePeriodDelegationLauncher(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED === "1";
  const periodsEnabled = enabled && (props.periodsEnabled ?? (process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1"
    && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED === "1"));
  const key = JSON.stringify([props.siteId, props.access, props.actorId, props.authUserId, props.active !== false, enabled, periodsEnabled]);
  const live = useRef({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== props.apiFetch || live.current.auth !== props.isCurrentAuth) {
    live.current = { key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: live.current.token + 1 };
  }
  const token = live.current.token;
  const isCurrentAuth = useCallback(() => live.current.token === token && props.active !== false && props.isCurrentAuth?.() !== false, [token, props.active, props.isCurrentAuth]);
  // The new cycle path requires the actual host callback; do not inherit the
  // legacy workspace's optional-callback compatibility as new authority.
  const cycleIsCurrentAuth = useCallback(() => live.current.token === token && props.active !== false && cycleIntentAuthCurrent(props.isCurrentAuth), [token, props.active, props.isCurrentAuth]);
  if (props.active === false || !/^\d{8}$/.test(props.siteId) || !periodDelegationLauncherIdentityValid(props.access, props.actorId, props.authUserId)) return null;
  return <Launcher key={token} {...props} enabled={enabled} periodsEnabled={periodsEnabled} isCurrentAuth={isCurrentAuth} cycleIsCurrentAuth={cycleIsCurrentAuth}/>;
}
/* eslint-enable react-hooks/refs */
function Launcher(props: Props & { enabled: boolean; periodsEnabled: boolean; isCurrentAuth: () => boolean; cycleIsCurrentAuth: () => boolean }) {
  const [open, setOpen] = useState(false), [selection, setSelection] = useState<PeriodDelegationPeriodSelection | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), guard = useRef<{ key: string; run: () => boolean } | null>(null), closing = useRef(false);
  const pending = useCallback(() => {
    if (!props.isCurrentAuth()) return false;
    try { return sessionStorage.getItem(periodDelegationPendingKey(props.siteId, props.access, props.actorId)) !== null; } catch { return true; }
  }, [props.siteId, props.access, props.actorId, props.isCurrentAuth]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recoverable = useSyncExternalStore(subscribe, pending, () => false);
  const childKey = selection ? `period:${selection.grantId}:${selection.fromDate}:${selection.throughDate}` : "management";
  const registerChild = useCallback((run: (() => boolean) | null) => {
    if (run) guard.current = { key: childKey, run }; else if (guard.current?.key === childKey) guard.current = null;
  }, [childKey]);
  const leave = useCallback(() => props.isCurrentAuth() && (!guard.current || guard.current.run()), [props.isCurrentAuth]);
  useLayoutEffect(() => { if (!open) return; props.registerLeaveGuard?.(leave); return () => props.registerLeaveGuard?.(null); }, [open, props.registerLeaveGuard, leave]);
  const close = useCallback(() => { const element = dialog.current; if (!element || closing.current) return; closing.current = true;
    queueMicrotask(() => { try { if (dialog.current !== element) return; const allowed = leave();
      if (dialog.current !== element) return; if (allowed) { setOpen(false); setSelection(null); } else if (!element.open) element.showModal();
    } finally { closing.current = false; } });
  }, [leave]);
  useLayoutEffect(() => { const element = dialog.current; if (!open || !element) return; element.showModal();
    return () => { if (element.open) element.close(); }; }, [open]);
  const shown = periodDelegationLauncherVisible(props.access, props.enabled, recoverable, open);
  return <div className="min-w-0 space-y-2">
    {shown && <button type="button" className={button} disabled={props.disabled} onClick={() => {
      if (props.disabled || !props.isCurrentAuth() || document.hidden || props.beforeOpen && !props.beforeOpen() || !props.isCurrentAuth()) return;
      setSelection(null); setOpen(true);
    }}>{props.access === "owner" ? props.enabled ? "周期管理授权" : "周期授权核验／撤销" : props.enabled ? "我的受托周期" : "核对待确认周期授权原编号"}</button>}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full-document navigation deliberately re-verifies Auth on the independent recovery page, without prefetch or reusing this workspace session. */}
    <a className="block text-sm underline" href="/enterprise/attendance-recovery" onClick={event => {
      if (!props.isCurrentAuth() || props.beforeOpen && !props.beforeOpen() || !leave()) event.preventDefault();
    }}>核对待确认周期原编号（独立恢复）</a>
    {open && <dialog ref={dialog} aria-label="周期管理授权与受托核对工作区" className="m-auto rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      style={{ width: "min(68rem, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)", maxHeight: "calc(100dvh - 1rem)", padding: 0, overflowY: "auto", overscrollBehavior: "contain" }}
      onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (event.currentTarget === dialog.current) close(); }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Suspense fallback={<div className="space-y-3 p-4"><p role="status">正在加载周期授权工作区…</p><button type="button" className={button} onClick={close}>关闭</button></div>}>
        {selection ? <Workspace {...selection} enabled={props.periodsEnabled} apiFetch={props.apiFetch} isCurrentAuth={props.isCurrentAuth} registerLeaveGuard={registerChild}
          cycleIsCurrentAuth={props.cycleIsCurrentAuth} cycleEnabled={props.cycleEnabled}
          onClose={() => { if (props.isCurrentAuth()) setSelection(null); }}/>
          : <Panel {...props} registerLeaveGuard={registerChild} onClose={() => { if (props.isCurrentAuth()) setOpen(false); }}
            onOpenPeriod={props.access === "delegate" && props.periodsEnabled ? value => { if (!props.periodsEnabled || !props.isCurrentAuth() || document.hidden) return;
              if (value.siteId !== props.siteId || value.actorEmployeeId !== props.actorId || value.expectedAuthUserId !== props.authUserId) return;
              setSelection(value); } : undefined}/>}
      </Suspense>
    </dialog>}
  </div>;
}
