"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceEventNotificationsClient } from "@/lib/merchantAttendanceEventNotificationsClient";
import type { EventNotificationsItem, EventNotificationsDetail, EventNotificationsResult } from "@/lib/merchantAttendanceEventNotifications";
import type { EventNotificationsPanelProps } from "./MerchantAttendanceEventNotificationsLauncher";

type Props = EventNotificationsPanelProps & { onClose: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const types: Record<EventNotificationsItem["type"], string> = { published: "排班已发布", cancelled: "班次已取消", approved: "工作安排已批准", rejected: "工作安排已驳回", approval_cancelled: "工作安排批准已取消", confirmed: "异常已确认", excused: "异常已豁免", follow_up: "异常继续核查", cleared: "核对后未触发本次迟到／早退规则", not_applicable: "整段获批请假，本次迟到／早退不适用" };
const categories = { schedule: "排班变更", work_arrangement: "工作安排结果", plan_exception: "异常处理结果" };
const kinds = { trip: "出差", field: "外勤", remote: "远程" };
export function confirmEventNotificationRead(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function eventNotificationReadReady(result: EventNotificationsResult, acknowledged: boolean, enabled: boolean, disabled: boolean): boolean {
  return enabled && !disabled && acknowledged && result.canMarkRead && !!result.workerId && !!result.detail && result.detail.readAt === null;
}
export default function MerchantAttendanceEventNotificationsPanel(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_ENABLED === "1";
  return <Prepared key={`${props.siteId}:${props.employeeId}`} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, employeeId, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendanceEventNotificationsClient({ siteId, employeeId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [siteId, employeeId, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="考勤消息" className="p-4"><p role="alert">当前身份无法核验考勤消息，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭考勤消息</button></section>;
}
function Screen({ client, enabled, onClose, registerLeaveGuard }: Props & { enabled: boolean; client: AttendanceEventNotificationsClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [shown, setShown] = useState(false), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clearDraft = useCallback(() => { dirty.current = false; setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current; return (!(dirty.current || client.hasLeaveRisk())
    || window.confirm("离开会清除尚未提交的标读确认。已发送的标读不会撤销，待确认消息编号仍需核对；继续吗？")) && epoch.current === generation; }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clearDraft(); client.pause(); };
    const show = () => { epoch.current++; clearDraft(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate this lifetime, not a captured generation
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clearDraft]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null, busy = state.phase === "loading" || state.phase === "saving";
  const read = (run: () => void) => { const generation = epoch.current;
    if (!shown || document.hidden || busy || dirty.current && !window.confirm("读取其他消息会清除尚未提交的标读确认，继续吗？")) return;
    if (generation !== epoch.current || document.hidden) return; epoch.current++; clearDraft(); run(); };
  const markRead = () => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmEventNotificationRead(() => window.confirm(pending ? "明确再次标读同一条消息？只重发这个原消息编号的标读命令，不创建新消息、不表示同意，也不提交异常或周期确认。" : "明确将这条消息标记为已读？只保存消息已读时间，不表示同意，不替代异常确认、出勤确认或周期确认。"),
      () => shown && !document.hidden && !busy && enabled && !!result?.canMarkRead && !!result.detail && result.detail.readAt === null
        && (!pending || pending.notificationId === result.detail.notificationId) && epoch.current === generation && client.getSnapshot() === snapshot,
      () => { epoch.current++; clearDraft(); void client.markRead(); }); };
  return <section aria-label="考勤消息" data-event-notifications className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">考勤消息</h2><p className="mt-1 text-sm text-slate-600">本人站内事件 · 查看不会自动标读</p></div><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭考勤消息</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">这里只显示捕获开启期间新增的排班变更、工作安排结果和异常明确决定，不补旧历史，也不是全部考勤消息。请假结果仍在原“请假结果通知”入口。没有邮件、手机推送、定时提醒或后台轮询；生成站内消息不证明设备已收到。</p>
    <p className="text-sm leading-6">消息记录的是当时结果，当前事项状态未重新核查。已读只表示阅读本条消息，不表示同意、确认出勤或放弃争议，不替代异常业务确认及周期本人确认，也不改变工时、工资或原事项。</p>
    {!enabled && <p className="text-sm text-amber-900">新消息入口已关闭；仅可明确核对本标签页待确认消息的原已读结果。若读取服务暂停或身份无法核验，编号继续保留，不能保证立即恢复。</p>}
    <p role="status" aria-live="polite" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || !enabled || busy || !!pending} onClick={() => read(() => { void client.load(); })}>读取考勤消息</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原消息已读结果</button>}</div>
    {pending && <section aria-label="消息标读待确认" data-event-notifications-pending className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>标读结果尚未核实；未查到已读时间不等于之前请求失败。不会自动重发，消息编号保留。</p><p className="break-all">原消息编号：{pending.notificationId}</p><p>不从本地待确认记录恢复消息正文，也不影响正常打卡或安全下班。</p></section>}
    {result && <>{!result.canMarkRead && <p role="alert" className="text-sm text-amber-900">当前不能首次标记已读；已保存的已读时间仍按当前权限核验。</p>}
      {result.detail ? <EventNotificationDetailView key={`${result.detail.notificationId}:${result.detail.readAt ?? "unread"}:${formEpoch}`} result={result} enabled={enabled} disabled={!shown || busy}
        retry={!!pending} onDirty={() => { epoch.current++; dirty.current = true; }} onRead={markRead}/>
        : <EventNotificationList result={result} disabled={!shown || !enabled || busy || !!pending} onDetail={id => read(() => { void client.detail(id); })} onNext={() => read(() => { void client.next(); })}/>}
    </>}
  </section>;
}
export function EventNotificationList({ result, disabled, onDetail, onNext }: { result: EventNotificationsResult; disabled: boolean; onDetail: (id: string) => void; onNext: () => void }) {
  return <section aria-label="考勤消息列表" className="space-y-3">{!result.workerId ? <p className="text-sm">当前本人没有匹配的考勤档案，不能认领旧档案的消息。</p> : !result.items.length && <p className="text-sm">本页没有考勤事件消息，不代表没有排班、安排或处理历史。</p>}
    {result.items.map(item => <EventNotificationCard key={item.notificationId} item={item} disabled={disabled} onDetail={onDetail}/>)}
    <button type="button" className={button} disabled={disabled || !result.nextCursor} onClick={onNext}>下一页考勤消息</button>
    <p className="text-xs leading-6 text-slate-500">每页最多25条，按保存事件时间和消息编号倒序。新事件请明确重新读取首页；没有未读总数、全部已读或常驻刷新。</p>
  </section>;
}
export function EventNotificationCard({ item, disabled = true, onDetail = () => {} }: { item: EventNotificationsItem; disabled?: boolean; onDetail?: (id: string) => void }) {
  return <article data-event-notification-id={item.notificationId} className={`min-w-0 space-y-2 rounded-xl border p-3 text-sm ${item.readAt ? "border-slate-200" : "border-blue-200 bg-blue-50"}`}>
    <div className="flex flex-wrap justify-between gap-2"><strong>{types[item.type]} · 当时结果</strong><span>{item.readAt ? "已读" : "未读"}</span></div><p>{categories[item.sourceCategory]}{item.sourceRevision === null ? "" : ` · 保存修订 ${item.sourceRevision}`}</p>
    <p className="break-all">事件时间（UTC）：{item.occurredAt}{item.readAt && <><br/>明确标读时间（UTC）：{item.readAt}</>}</p>
    <details className="break-all text-xs"><summary>消息及来源编号</summary><p>消息：{item.notificationId}<br/>来源：{item.sourceId}<br/>来源操作：{item.sourceOperationId}</p></details>
    <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.notificationId)}>查看考勤消息详情</button>
  </article>;
}
export function EventNotificationSummary({ detail }: { detail: EventNotificationsDetail }) {
  if (detail.sourceCategory === "schedule") return <section aria-label="保存排班摘要" className="space-y-2"><h4 className="font-semibold">本次{detail.type === "published" ? "发布" : "取消"}的保存时段 · {detail.summary.segments.length}段</h4>
    <ol className="space-y-2">{detail.summary.segments.map((segment, index) => <li key={segment.slotId} className="min-w-0 rounded-xl bg-slate-50 p-3"><p>第{index + 1}段 · 保存地点时区：{segment.timeZone}</p><p className="break-all">UTC：{segment.startAt} → {segment.endAt}<br/>班次编号：{segment.slotId}</p></li>)}</ol></section>;
  if (detail.sourceCategory === "work_arrangement") return <section aria-label="保存工作安排摘要" className="space-y-2 rounded-xl bg-slate-50 p-3"><p>安排种类：{kinds[detail.summary.kind]}</p><p>保存时区：{detail.summary.timeZone}</p><p className="break-all">UTC：{detail.summary.startAt} → {detail.summary.endAt}</p><p>工作安排批准不证明实际出勤，不自动计工时或豁免异常。</p></section>;
  return <section aria-label="保存异常决定摘要" className="space-y-2 rounded-xl bg-slate-50 p-3"><p>保存决定：{types[detail.summary.outcome]}</p><p>保存地点时区：{detail.summary.timeZone}</p><p className="break-all">UTC：{detail.summary.startAt} → {detail.summary.endAt}<br/>班次编号：{detail.summary.slotId}</p><p>这是已有异常决定的消息；在此标读不提交异常业务已读确认或新的处理意见。</p>
    {detail.summary.outcome === "cleared" && <p data-event-notification-cleared>保存当时两项规则均未触发，可能仍在已核准宽限内；不声称实际没有晚到或提前离开，不代表整班全部出勤正常或周期已确认。当前来源未重新核查。</p>}
    {detail.summary.outcome === "not_applicable" && <p data-event-notification-not-applicable>保存时获批请假覆盖整段计划，且未发现工作时段冲突；本次迟到／早退规则不适用，不表示全部出勤正常，也不修改工时、工资或周期确认。当前来源未重新核查。</p>}</section>;
}
export function EventNotificationDetailView({ result, enabled = true, disabled = true, retry = false, onDirty = () => {}, onRead = () => {} }: { result: EventNotificationsResult; enabled?: boolean; disabled?: boolean; retry?: boolean; onDirty?: () => void; onRead?: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false), detail = result.detail;
  if (!detail) return null;
  const ready = eventNotificationReadReady(result, acknowledged, enabled, disabled);
  return <article aria-label="考勤消息详情" data-event-notifications-detail={detail.sourceCategory} className="min-w-0 space-y-3 rounded-xl border border-blue-200 p-3 text-sm">
    <h3 className="font-bold">{types[detail.type]} · 保存的当时结果</h3><p>当前事项状态未重新核查；本条较早消息不证明目前仍获批准、班次未取消或该异常决定仍是最新版本。</p>
    <p className="break-all">事件时间（UTC）：{detail.occurredAt}<br/>消息编号：{detail.notificationId}<br/>来源编号：{detail.sourceId}<br/>来源操作：{detail.sourceOperationId}{detail.sourceRevision !== null && <><br/>保存修订：{detail.sourceRevision}</>}</p>
    <EventNotificationSummary detail={detail}/>
    {detail.readAt ? <p data-event-notification-read-at className="break-all rounded-xl bg-emerald-50 p-3">这条消息已读 · UTC {detail.readAt}。这不是同意或业务确认，也不证明设备送达。</p> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (ready) onRead(); }}>
      <label className="flex items-start gap-2"><input aria-label="确认仅标读这条消息" type="checkbox" checked={acknowledged} disabled={disabled || !enabled || !result.canMarkRead} onChange={event => { setAcknowledged(event.target.checked); onDirty(); }}/><span>我已阅读本条消息；仅保存消息已读时间，不代表同意，不提交异常或周期确认。</span></label>
      <button type="submit" className={button} disabled={!ready}>{retry ? "明确再次标记这条消息已读" : "明确标记这条消息已读"}</button>
    </form>}
  </article>;
}
