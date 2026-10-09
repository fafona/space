"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceOwnerNotificationsClient, type OwnerNotificationsClientState, type OwnerNotificationsStorage } from "@/lib/merchantAttendanceOwnerNotificationsClient";
import type { OwnerNotificationsItem } from "@/lib/merchantAttendanceOwnerNotifications";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

export type OwnerNotificationsPanelProps = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean; recoveryOnly?: boolean;
  isCurrentAuth?: () => boolean; onClose?: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void;
  onOpenTarget?: (item: OwnerNotificationsItem) => void };
export function ownerNotificationsPorts(apiFetch: AttendanceApiFetch, storage: () => OwnerNotificationsStorage, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw Error("identity_changed"); }, target = () => { check(); const value = storage(); check(); return value; };
  return { isCurrentAuth: isCurrent, storage: (): OwnerNotificationsStorage => { check(); return {
    getItem: key => { const value = target().getItem(key); check(); return value; },
    setItem: (key, value) => { target().setItem(key, value); check(); },
    removeItem: key => { target().removeItem(key); check(); },
  }; }, apiFetch: (async (path, init) => { check(); const response = await apiFetch(path, init);
    if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response;
  }) satisfies AttendanceApiFetch };
}
export function ownerNotificationsCanOpenTarget(state: OwnerNotificationsClientState, siteId: string, actorId: string) {
  return state.phase === "ready" && !state.pending && state.query?.mode === "detail" && state.query.siteId === siteId
    && state.result?.kind === "detail" && state.result.siteId === siteId && state.result.actorId === actorId
    && state.query.notificationId === state.result.item.notificationId;
}
export function confirmOwnerNotificationsAction(confirm: () => boolean, current: () => boolean, act: () => void) {
  if (!current() || !confirm() || !current()) return false; act(); return true;
}
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
/* eslint-disable react-hooks/refs -- This monotonic render-time fence revokes old async authority before effects. An interrupted render can conservatively invalidate a lease, never reauthorize one. */
export default function MerchantAttendanceOwnerNotificationsPanel(props: OwnerNotificationsPanelProps) {
  const { siteId, actorId, recoveryOnly, apiFetch, isCurrentAuth: checkAuth } = props;
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_ENABLED === "1";
  const key = JSON.stringify([siteId, actorId, enabled, !!recoveryOnly]);
  const live = useRef({ key, fetch: apiFetch, auth: checkAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== apiFetch || live.current.auth !== checkAuth)
    live.current = { key, fetch: apiFetch, auth: checkAuth, token: live.current.token + 1 };
  const token = live.current.token;
  const isCurrent = useCallback(() => live.current.token === token && checkAuth?.() !== false, [token, checkAuth]);
  return <Prepared key={token} {...props} enabled={enabled} isCurrent={isCurrent}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props: OwnerNotificationsPanelProps & { enabled: boolean; isCurrent: () => boolean }) {
  const client = useMemo(() => { try { return new AttendanceOwnerNotificationsClient({ siteId: props.siteId, actorId: props.actorId,
    enabled: props.enabled, recoveryOnly: props.recoveryOnly, ...ownerNotificationsPorts(props.apiFetch, () => sessionStorage, props.isCurrent) }); } catch { return null; } },
    [props.siteId, props.actorId, props.enabled, props.recoveryOnly, props.apiFetch, props.isCurrent]);
  return client ? <Screen {...props} client={client}/> : <section className="min-w-0 p-4"><p role="alert">无法核验当前身份，未读取或提交收件操作。</p></section>;
}
function Screen({ client, siteId, actorId, enabled, recoveryOnly, onClose, onOpenTarget, registerLeaveGuard, isCurrent }: OwnerNotificationsPanelProps & {
  enabled: boolean; isCurrent: () => boolean; client: AttendanceOwnerNotificationsClient;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [ack, setAck] = useState(false);
  const dirty = useRef(false), generation = useRef(0);
  const clear = useCallback(() => { dirty.current = false; setAck(false); }, []);
  const pause = useCallback(() => { generation.current++; client.pause(); clear(); }, [client, clear]);
  const leave = useCallback(() => { const epoch = generation.current, snapshot = client.getSnapshot();
    return confirmOwnerNotificationsAction(() => !(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的选择；待确认标读原编号保留，不会撤销或重发。继续吗？"),
      () => isCurrent() && generation.current === epoch && client.getSnapshot() === snapshot, pause);
  }, [client, isCurrent, pause]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const hide = () => { pause(); setShown(false); }, eventHide = () => flushSync(hide), show = () => { if (!isCurrent() || document.hidden) return; generation.current++; clear(); setShown(true); void client.initialize(); };
    const visibility = () => document.hidden ? eventHide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    if (document.hidden) hide(); else show();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", eventHide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", eventHide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, isCurrent, pause]);
  const busy = state.phase === "loading" || state.phase === "saving", ready = shown && isCurrent() && !busy;
  const result = shown ? state.result : null, pending = shown ? state.pending : null;
  const read = (act: () => void) => { const epoch = generation.current, snapshot = client.getSnapshot();
    confirmOwnerNotificationsAction(() => !dirty.current || window.confirm("重新读取会清除未提交的标读选择，继续吗？"),
      () => ready && !document.hidden && isCurrent() && generation.current === epoch && client.getSnapshot() === snapshot,
      () => { generation.current++; clear(); act(); }); };
  return <section aria-label={recoveryOnly ? "负责人标读原号恢复" : "负责人考勤收件"} className="min-w-0 space-y-4 p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{recoveryOnly ? "负责人标读原号恢复" : "负责人考勤收件"}</h2>
      {onClose && <button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>关闭负责人收件</button>}</header>
    <p className="text-sm leading-6">仅接收功能开启后的新异常说明和周期争议，不补发历史、不自动交接。已读不是处理、同意、异常确认或周期确认；打开原事项会重新核验当前权限和保存身份。</p>
    {(!enabled || recoveryOnly) && <p className="text-sm">本入口仅核对本标签页原标读编号，不读取正文、不恢复原事项权限。负责人已更换时，也只核对本人已提交的最小回执。</p>}
    <p role="status" aria-live="polite" className="break-words text-sm">{shown ? state.message : "资料已隐藏；返回后需明确重新读取。"}</p>
    {shown && <button type="button" className={button} disabled={!ready} onClick={() => read(() => { void client.initialize(); })}>重新检查本地原编号（不联网）</button>}
    {pending && <div className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="break-all">待确认标读原号：{pending.command.operationId}</p>
      <p className="break-all">收件编号：{pending.command.notificationId}</p><p>查无、暂时失败或身份变化均不等于原操作失败。不会自动重新标读。</p>
      <button type="button" className={button} disabled={!ready} onClick={() => read(() => { void client.recover(); })}>只读核对标读原号</button></div>}
    {shown && enabled && !recoveryOnly && <button type="button" className={button} disabled={!ready || !!pending} onClick={() => read(() => { void client.load(); })}>读取负责人收件</button>}
    {result?.kind === "list" && <section aria-label="负责人收件列表" className="min-w-0 space-y-3">
      {!result.items.length && <p className="text-sm">本页没有可读取的收件；不代表没有历史说明或争议。</p>}
      <ol className="space-y-2">{result.items.map(item => <li key={item.notificationId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm">
        <p>{item.sourceCategory === "period" ? "新的周期争议" : "新的异常本人说明"} · {item.readAt === null ? "未读" : "已读"}</p><p className="break-all">保存 UTC {item.occurredAt} · 收件 {item.notificationId}</p>
        <button type="button" className={button} disabled={!ready || !!pending} onClick={() => read(() => { void client.detail(item.notificationId); })}>读取收件详情</button></li>)}</ol>
      <button type="button" className={button} disabled={!ready || !!pending || !result.nextCursor} onClick={() => read(() => { void client.next(); })}>读取下一页收件</button></section>}
    {result?.kind === "detail" && <section aria-label="负责人收件详情" className="min-w-0 space-y-3 rounded-xl border p-3 text-sm">
      <p>{result.item.sourceCategory === "period" ? "周期争议" : "异常本人说明"} · {result.item.readAt === null ? "未读" : `已读 UTC ${result.item.readAt}`}</p>
      <p className="break-all">收件 {result.item.notificationId}<br/>来源原号 {result.item.sourceOperationId}<br/>人员 {result.item.workerId} · 保存修订 {result.item.sourceRevision}</p>
      {onOpenTarget && !recoveryOnly && <button type="button" className={button} disabled={!ready || !ownerNotificationsCanOpenTarget(state, siteId, actorId)} onClick={() => {
        const snapshot = client.getSnapshot(), epoch = generation.current, item = result.item;
        confirmOwnerNotificationsAction(() => !dirty.current || window.confirm("打开原事项会清除未提交的标读选择，不会自动标读。继续吗？"),
          () => ready && !document.hidden && isCurrent() && generation.current === epoch && client.getSnapshot() === snapshot && ownerNotificationsCanOpenTarget(snapshot, siteId, actorId),
          () => { pause(); onOpenTarget(item); });
      }}>打开原事项（重新核验）</button>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={ack} disabled={!ready || !enabled || !!pending || !result.canMarkRead || !!recoveryOnly} onChange={event => { dirty.current = event.target.checked; generation.current++; setAck(event.target.checked); }}/><span>仅确认已阅读此收件，不代替任何业务处理</span></label>
      <button type="button" className={button} disabled={!ready || !enabled || !!pending || !result.canMarkRead || !ack || !!recoveryOnly} onClick={() => {
        const snapshot = client.getSnapshot(), epoch = generation.current;
        confirmOwnerNotificationsAction(() => window.confirm("仅将本收件标为已读，不处理异常、不确认周期。确定吗？"),
          () => ready && ack && isCurrent() && !document.hidden && generation.current === epoch && client.getSnapshot() === snapshot,
          () => { clear(); void client.markRead(); });
      }}>明确标为已读</button></section>}
    {result?.kind === "receipt" && <section aria-label="标读最小回执" className="min-w-0 rounded-xl border p-3 text-sm">{result.receipt
      ? <p className="break-all">标读原号 {result.receipt.operationId}<br/>收件 {result.receipt.notificationId}<br/>已读 UTC {result.receipt.readAt}<br/>仅核实该原操作，不授予正文或原事项权限。</p>
      : <p>尚未取得匹配回执；原编号保留，请勿重复提交。</p>}</section>}
  </section>;
}
