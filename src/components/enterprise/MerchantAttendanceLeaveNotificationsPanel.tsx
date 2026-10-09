"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { NotificationDetail, NotificationItem, NotificationsResponse } from "@/lib/merchantAttendanceLeaveNotifications";
import { AttendanceLeaveNotificationsClient } from "@/lib/merchantAttendanceLeaveNotificationsClient";
import type { AttendanceLeaveNotificationsPanelProps } from "./MerchantAttendanceLeaveNotificationsLauncher";

type Props = AttendanceLeaveNotificationsPanelProps & { onClose: () => void };

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const typeLabels: Record<NotificationItem["type"], string> = {
  approved: "已批准",
  rejected: "已驳回",
  approval_cancelled: "已取消批准",
};
const currentLabels: Record<NotificationDetail["currentStatus"], string> = {
  approved: "当前仍为已批准",
  rejected: "当前为已驳回",
  cancelled: "当前已取消批准",
};

export default function MerchantAttendanceLeaveNotificationsPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}

function Screen({ siteId, employeeId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceLeaveNotificationsClient({
    siteId,
    employeeId,
    apiFetch,
    storage: () => window.sessionStorage,
  }), [siteId, employeeId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true, generation = 0;
    const initialize = async () => {
      const current = ++generation;
      setVisible(false);
      await client.initialize();
      if (mounted && current === generation && !document.hidden) setVisible(true);
    };
    const hide = () => {
      generation++;
      setVisible(false);
      client.pause();
    };
    const visibility = () => {
      if (document.hidden) hide();
      else void initialize();
    };
    if (document.hidden) hide();
    else void initialize();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => {
      mounted = false;
      generation++;
      client.pause();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
    };
  }, [client]);

  const busy = state.phase === "loading" || state.phase === "saving";
  const result = visible ? state.result : null;
  const locked = busy || !!state.pending || state.phase !== "ready";
  const close = () => {
    setVisible(false);
    client.pause();
    onClose();
  };

  return <section aria-label="请假结果通知" className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-bold">请假结果通知</h2><p className="mt-1 text-sm text-slate-600">本人站内结果 · 查看不会自动标记已读</p></div>
      <button type="button" className={button} onClick={close}>关闭结果通知</button>
    </header>

    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">
      这里只显示通知捕获开启期间新产生的批准、驳回和取消批准结果；不补发更早历史，也不表示邮件、手机推送、假期余额、排班、打卡、工时或工资发生变化。
    </p>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm leading-6 ${state.phase === "blocked" || state.pending ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{state.message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => {
        void client.initialize();
      }}>{state.pending ? "重新读取／查原已读结果" : "重新读取通知"}</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => {
        if (window.confirm("先查询这条通知是否已读；如仍未确认，只重试同一通知的已读操作，不生成新编号。继续吗？")) void client.retry();
      }}>用原通知明确重试已读</button>}
    </div>
    {state.pending && <section aria-label="已读结果待确认" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>这条通知的已读结果仍待确认。未查到已读时间不等于先前请求失败，不能自动重发。</p>
      <p className="mt-1 break-all text-xs">通知编号：{state.pending.notificationId}</p>
    </section>}

    {result ? <ResultView result={result} disabled={locked} onHome={() => void client.list()} onNext={() => void client.next()}
      onDetail={notificationId => void client.detail(notificationId)} onMarkRead={() => {
        if (window.confirm("确认把这条站内请假结果通知标记为已读？这只保存已读时间，不改变请假决定或其他考勤事实。")) void client.markRead();
      }}/> : null}

    <p className="text-xs leading-6 text-slate-500">
      页面不会发送邮件或手机推送，不会轮询、后台重试或因查看详情自动标记已读。隐藏、关闭或离开会清除已显示资料；未知已读结果只按原通知编号恢复核对。
    </p>
  </section>;
}

function ResultView({ result, disabled, onHome, onNext, onDetail, onMarkRead }: {
  result: NotificationsResponse;
  disabled: boolean;
  onHome: () => void;
  onNext: () => void;
  onDetail: (notificationId: string) => void;
  onMarkRead: () => void;
}) {
  if (result.detail) return <NotificationDetailView result={result} detail={result.detail} disabled={disabled} onHome={onHome} onMarkRead={onMarkRead}/>;
  return <section aria-label="请假结果通知列表" className="space-y-3">
    {!result.moduleEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">平台已暂停新的已读标记；仍可查看已有通知与已保存的已读时间。</p>}
    {!result.workerId && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">当前本人尚未绑定考勤档案，不能读取通知；不会认领旧档案的结果。</p>}
    {result.workerId && !result.items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">本页没有请假结果通知；这不代表没有请假申请或更早处理历史。</p>}
    {result.items.map(item => <NotificationCard key={item.notificationId} item={item} disabled={disabled} onDetail={onDetail}/>)}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled} onClick={onHome}>重新查询通知首页</button>
      <button type="button" className={button} disabled={disabled || !result.nextCursor} onClick={onNext}>下一页通知</button>
    </div>
    <p className="text-xs leading-6 text-slate-500">每页最多 25 条，按负责人或获授权审批人的实际决定时间倒序；新决定到达后请重新查询首页。此通知不提供审核者姓名。没有未读总数、未读筛选或全部已读。</p>
  </section>;
}

function NotificationCard({ item, disabled, onDetail }: { item: NotificationItem; disabled: boolean; onDetail: (notificationId: string) => void }) {
  return <article aria-label={`请假结果通知 ${typeLabels[item.type]}`} className={`min-w-0 space-y-2 rounded-xl border p-3 text-sm ${item.readAt ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><strong>{typeLabels[item.type]} · 修订 {item.revision}</strong><span>{item.readAt ? "已读" : "未读"}</span></div>
    <p>决定时间：{stamp(item.decidedAt, item.timeZone)}<br/>请假时段：{stamp(item.startAt, item.timeZone)} — {stamp(item.endAt, item.timeZone)}<br/>申请时区：{item.timeZone}</p>
    {item.readAt && <p className="text-xs text-slate-500">明确标记已读：{stamp(item.readAt, item.timeZone)}</p>}
    <p className="break-all text-xs text-slate-500">申请编号：{item.requestId}<br/>通知编号：{item.notificationId}</p>
    <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.notificationId)}>查看结果详情</button>
  </article>;
}

function NotificationDetailView({ result, detail, disabled, onHome, onMarkRead }: {
  result: NotificationsResponse;
  detail: NotificationDetail;
  disabled: boolean;
  onHome: () => void;
  onMarkRead: () => void;
}) {
  return <article aria-label="请假结果通知详情" className="min-w-0 space-y-3 rounded-xl border border-blue-200 p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold">通知结果：{typeLabels[detail.type]} · 修订 {detail.revision}</h3><span>{detail.readAt ? "已读" : "未读"}</span></div>
    <p className="rounded-xl bg-slate-50 p-3"><strong>{currentLabels[detail.currentStatus]} · 当前修订 {detail.currentRevision}</strong><br/>通知记录的是当时处理结果；当前状态单独读取，较早批准通知不等于目前仍获批准。</p>
    <p>决定时间：{stamp(detail.decidedAt, detail.timeZone)}<br/>请假时段：{stamp(detail.startAt, detail.timeZone)} — {stamp(detail.endAt, detail.timeZone)}<br/>申请时区：{detail.timeZone}</p>
    {detail.readAt && <p>明确标记已读：{stamp(detail.readAt, detail.timeZone)}</p>}
    <p className="break-all text-xs text-slate-500">申请编号：{detail.requestId}<br/>通知编号：{detail.notificationId}</p>
    {!result.moduleEnabled && !detail.readAt && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-950">平台已暂停新的已读标记；仍可查看已有通知与已保存的已读时间。</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled} onClick={onHome}>返回通知列表</button>
      <button type="button" className={button} disabled={disabled || !!detail.readAt || !result.moduleEnabled} onClick={onMarkRead}>{detail.readAt ? "这条通知已读" : "明确标记已读"}</button>
    </div>
  </article>;
}

function stamp(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(value));
  } catch {
    return value;
  }
}
