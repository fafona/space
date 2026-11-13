"use client";
import { useCallback, useEffect, useState } from "react";
import { canCustomerChangeMerchantBooking, getMerchantBookingStatusLabel, type MerchantBookingRecord, type MerchantBookingEditableInput } from "@/lib/merchantBookings";
import { getMerchantOrderStatusLabel, formatMerchantOrderAmount, type MerchantOrderRecord } from "@/lib/merchantOrders";
import { readPersonalGuestBookings, readPersonalGuestOrders, PERSONAL_GUEST_STORAGE_EVENT } from "@/lib/personalGuestSession";
import { PERSONAL_CONSUMPTION_CHANGED_MESSAGE } from "@/lib/personalConsumptionBridge";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import { serviceButton, serviceCard, serviceInput, serviceRequest, type ServicePanelProps } from "./serviceCenterClient";

type BookingPayload = { bookings?: MerchantBookingRecord[] };
type OrderPayload = { orders?: MerchantOrderRecord[] };
const merge = <T extends { id: string }>(remote: T[], local: T[]) => [...new Map([...local, ...remote].map(row => [row.id, row])).values()];

export default function ServiceOrders({ active, identity }: ServicePanelProps) {
  const [bookings, setBookings] = useState<MerchantBookingRecord[]>([]);
  const [orders, setOrders] = useState<MerchantOrderRecord[]>([]);
  const [ownedBookings, setOwnedBookings] = useState(new Set<string>());
  const [ownedOrders, setOwnedOrders] = useState(new Set<string>());
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [edit, setEdit] = useState<{ booking: MerchantBookingRecord; draft: MerchantBookingEditableInput } | null>(null);
  const authenticated = identity?.authenticated, accountId = identity?.accountId;
  useEffect(() => {
    if (!active || authenticated === undefined) return;
    const controller = new AbortController();
    const localBookings = readPersonalGuestBookings(), localOrders = readPersonalGuestOrders();
    setError("");
    if (!authenticated) { setBookings(localBookings); setOrders(localOrders); setLoading(false); return; }
    setLoading(true);
    void Promise.allSettled([
      serviceRequest<BookingPayload>("/api/bookings?scope=personal", { signal: controller.signal }),
      serviceRequest<OrderPayload>("/api/orders?scope=personal", { signal: controller.signal }),
    ]).then(([bookingResult, orderResult]) => {
      if (controller.signal.aborted) return;
      if (bookingResult.status === "fulfilled") { const rows = bookingResult.value.bookings ?? [];
        setBookings(merge(rows, localBookings)); setOwnedBookings(new Set(rows.map(row => row.id))); }
      if (orderResult.status === "fulfilled") { const rows = orderResult.value.orders ?? [];
        setOrders(merge(rows, localOrders)); setOwnedOrders(new Set(rows.map(row => row.id))); }
      if (bookingResult.status === "rejected" || orderResult.status === "rejected") setError("部分记录读取失败，请重新读取。已显示的记录仍然保留。");
      setLoading(false);
    });
    return () => controller.abort();
  }, [active, accountId, authenticated, attempt]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener(PERSONAL_CONSUMPTION_CHANGED_MESSAGE, refresh);
    window.addEventListener(PERSONAL_GUEST_STORAGE_EVENT, refresh);
    return () => { window.removeEventListener(PERSONAL_CONSUMPTION_CHANGED_MESSAGE, refresh); window.removeEventListener(PERSONAL_GUEST_STORAGE_EVENT, refresh); };
  }, [active]);
  const mutate = useCallback(async (record: MerchantBookingRecord | MerchantOrderRecord, booking: boolean, action: string, updates?: MerchantBookingEditableInput) => {
    if (busy) return;
    setBusy(record.id); setError("");
    try {
      const result = await serviceRequest<{ booking?: MerchantBookingRecord; order?: MerchantOrderRecord }>(booking ? "/api/bookings" : "/api/orders", {
        method: "PATCH", body: JSON.stringify({ scope: "personal", action, siteId: record.siteId,
          ...(booking ? { bookingId: record.id } : { orderId: record.id }), ...(updates ? { updates } : {}) }),
      });
      if (result.booking) setBookings(current => current.map(row => row.id === record.id ? result.booking! : row));
      if (result.order) setOrders(current => current.map(row => row.id === record.id ? result.order! : row));
      if (updates) setEdit(null);
    } catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重新读取记录后再试。"); }
    finally { setBusy(""); }
  }, [busy]);
  const rows = [...(kind !== "orders" ? bookings.map(row => ({ booking: true, record: row })) : []),
    ...(kind !== "bookings" ? orders.map(row => ({ booking: false, record: row })) : [])]
    .filter(({ record }) => (status === "all" || record.status === status) && JSON.stringify(record).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
  const startEdit = (booking: MerchantBookingRecord) => setEdit({ booking, draft: { store: booking.store, item: booking.item,
    title: booking.title, customerName: booking.customerName, email: booking.email, phone: booking.phone, note: booking.note, appointmentAt: booking.appointmentAt } });
  return <div className="space-y-4" data-service-orders>
    <div className="flex flex-wrap gap-2">{([['all', '全部'], ['orders', '订单'], ['bookings', '预约']] as const).map(([id, label]) =>
      <button className={`${serviceButton} ${kind === id ? "!border-slate-950 !bg-slate-950 !text-white" : ""}`} type="button" key={id} onClick={() => setKind(id)} aria-pressed={kind === id}>{label}</button>)}
      <button type="button" className={`${serviceButton} ml-auto`} disabled={loading || !!busy} onClick={() => setAttempt(value => value + 1)}>刷新记录</button></div>
    <div className="flex gap-2"><input className={serviceInput} aria-label="搜索订单或预约" placeholder="搜索编号、商户或项目" value={query} onChange={event => setQuery(event.target.value)} />
      <select className={serviceInput + " !w-32"} aria-label="记录状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="pending">订单待确认</option><option value="active">预约待确认</option><option value="confirmed">已确认</option><option value="completed">已完成</option><option value="no_show">未到店</option><option value="cancelled">已取消</option></select></div>
    {!identity?.authenticated ? <p className="text-xs text-slate-500">显示本设备保存的游客记录。登录后可查看账号记录。</p> : null}
    {loading ? <p role="status">正在读取记录…</p> : null}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {edit ? <form className={serviceCard + " space-y-3"} onSubmit={event => { event.preventDefault(); void mutate(edit.booking, true, "update", edit.draft); }}>
      <h3 className="font-semibold">修改预约</h3>
      <BookingDateTimeInput dateValue={edit.draft.appointmentAt.slice(0, 10)} timeValue={edit.draft.appointmentAt.slice(11, 16)}
        onDateChange={date => setEdit(current => current ? { ...current, draft: { ...current.draft, appointmentAt: `${date}T${current.draft.appointmentAt.slice(11, 16)}` } } : null)}
        onTimeChange={time => setEdit(current => current ? { ...current, draft: { ...current.draft, appointmentAt: `${current.draft.appointmentAt.slice(0, 10)}T${time}` } } : null)} />
      {([['store', '店铺'], ['item', '项目'], ['customerName', '姓名'], ['phone', '电话'], ['email', '邮箱'], ['note', '备注']] as const).map(([key, label]) =>
        <label key={key} className="block text-sm">{label}<input className={serviceInput} value={edit.draft[key]} onChange={event => setEdit(current => current ? { ...current, draft: { ...current.draft, [key]: event.target.value } } : null)} /></label>)}
      <div className="flex gap-2"><button type="submit" className={serviceButton} disabled={!!busy}>保存预约</button><button type="button" className={serviceButton} disabled={!!busy} onClick={() => setEdit(null)}>取消修改</button></div>
    </form> : null}
    {!loading && !rows.length ? <div className={serviceCard + " text-center text-sm text-slate-500"}>暂无匹配的订单或预约。</div> : null}
    {rows.map(({ booking, record }) => <article className={serviceCard + " space-y-3"} key={`${booking}:${record.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{record.siteName || record.siteId}</p><p className="mt-1 break-all text-xs text-slate-500">{booking ? "预约" : "订单"} · {record.id}</p></div>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-800">{booking ? getMerchantBookingStatusLabel(record.status as MerchantBookingRecord["status"]) : getMerchantOrderStatusLabel(record.status as MerchantOrderRecord["status"])}</span></div>
      {booking ? <div className="text-sm"><p>{(record as MerchantBookingRecord).store} · {(record as MerchantBookingRecord).item}</p><p className="mt-1 font-medium">{(record as MerchantBookingRecord).appointmentAt.replace("T", " ")}</p></div>
        : <div><p className="text-sm">{(record as MerchantOrderRecord).items.map(item => `${item.name} × ${item.quantity}`).join("、")}</p><p className="mt-2 font-semibold">{formatMerchantOrderAmount((record as MerchantOrderRecord).totalAmount, (record as MerchantOrderRecord).pricePrefix)}</p></div>}
      <details className="text-sm"><summary className="cursor-pointer text-slate-600">查看详情</summary><div data-no-translate="1" className="mt-3 space-y-1 break-words text-slate-600">
        <p>提交时间：{record.createdAt}</p><p>更新时间：{record.updatedAt}</p>
        {booking ? <><p>{(record as MerchantBookingRecord).customerName} · {(record as MerchantBookingRecord).phone} · {(record as MerchantBookingRecord).email}</p><p>{(record as MerchantBookingRecord).note}</p></>
          : <><p>{(record as MerchantOrderRecord).customer.name} · {(record as MerchantOrderRecord).customer.phone} · {(record as MerchantOrderRecord).customer.email}</p><p>{(record as MerchantOrderRecord).customer.note}</p>
            {(record as MerchantOrderRecord).items.map((item, index) => <p key={index}>{item.name} · {item.unitPriceText} × {item.quantity} = {item.subtotal}</p>)}</>}
      </div></details>
      <div className="flex flex-wrap gap-2">
        {booking && ownedBookings.has(record.id) ? <>
          {canCustomerChangeMerchantBooking(record as MerchantBookingRecord, "update") ? <button type="button" className={serviceButton} disabled={!!busy} onClick={() => startEdit(record as MerchantBookingRecord)}>修改预约</button> : null}
          {(['cancel', 'restore'] as const).filter(action => canCustomerChangeMerchantBooking(record as MerchantBookingRecord, action)).map(action =>
            <button key={action} type="button" className={serviceButton} disabled={!!busy} onClick={() => void mutate(record, true, action)}>{action === "cancel" ? "取消预约" : "恢复预约"}</button>)}
          <a className={serviceButton} href={`/api/bookings/customer-calendar?scope=personal&bookingId=${encodeURIComponent(record.id)}&download=1`} target="_blank" rel="noreferrer">加入日历</a>
        </> : !booking && ownedOrders.has(record.id) && record.status === "pending" && !record.merchantTouchedAt ?
          <button type="button" className={serviceButton} disabled={!!busy} onClick={() => void mutate(record, false, "cancel")}>取消订单</button> : null}
      </div>
    </article>)}
  </div>;
}
