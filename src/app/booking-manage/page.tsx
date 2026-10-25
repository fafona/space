"use client";

import { useEffect, useRef, useState } from "react";
import { canCustomerChangeMerchantBooking, getMerchantBookingStatusLabel, sanitizeMerchantBookingEditableInput,
  MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES, MERCHANT_BOOKING_NOTE_MAX_BYTES,
  normalizeMerchantBookingCustomerNameInput, normalizeMerchantBookingNoteInput,
  type MerchantBookingEditableInput, type MerchantBookingRecord } from "@/lib/merchantBookings";
import type { MerchantBookingRuleSnapshotEntry } from "@/lib/merchantBookingRules";
import type { MerchantBookingWorkbenchPublicSettings } from "@/lib/merchantBookingWorkbench";
import { buildMerchantBookingCustomerCalendarUrl } from "@/lib/merchantBookingSelfService";
import { getCustomerBookingTimeIssue } from "@/lib/merchantBookingTime";

type Credentials = { bookingId: string; editToken: string };
type Details = { booking: MerchantBookingRecord; rule: MerchantBookingRuleSnapshotEntry | null; settings: MerchantBookingWorkbenchPublicSettings };
const fieldClass = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 disabled:bg-slate-100";

function readAndScrubCredentials(): Credentials {
  const url = new URL(window.location.href), hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const params = hash.has("bookingId") || hash.has("editToken") ? hash : url.searchParams;
  const credentials = { bookingId: params.get("bookingId")?.trim() ?? "", editToken: params.get("editToken")?.trim() ?? "" };
  for (const key of ["bookingId", "editToken", "bookingBlockId", "bookingViewport"]) url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  return credentials;
}

export default function BookingManagePage() {
  const credentials = useRef<Credentials | null>(null), busy = useRef(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [draft, setDraft] = useState<MerchantBookingEditableInput | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");

  useEffect(() => {
    credentials.current ??= readAndScrubCredentials();
    const controller = new AbortController();
    const load = async () => {
      try {
        if (!credentials.current?.bookingId || !credentials.current.editToken) throw new Error("预约链接不完整，请从原预约邮件重新打开。");
        const response = await fetch("/api/bookings/self-service", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials.current) });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.booking) throw new Error(result.message || "预约链接已失效，请联系商户。");
        if (!controller.signal.aborted) {
          setDetails(result); setDraft(sanitizeMerchantBookingEditableInput(result.booking));
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败，请稍后重试。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, []);

  const changeBooking = async (action: "update" | "cancel") => {
    if (!details || !draft || !credentials.current || busy.current) return;
    busy.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const restoring = details.booking.status === "cancelled";
      if (action === "update" && (restoring || draft.appointmentAt !== details.booking.appointmentAt)) {
        const issue = getCustomerBookingTimeIssue(draft.appointmentAt, details.booking.appointmentTimeZone || details.settings.timeZone);
        if (issue) throw new Error(issue);
      }
      const response = await fetch("/api/bookings", { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials.current, action, ...(action === "update" ? { updates: draft } : {}) }) });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.booking) {
        throw new Error(result.message === "booking_customer_action_locked" ? "商户已处理该预约，请联系商户调整。" : result.message || "操作失败，请稍后重试。");
      }
      setDetails({ ...details, booking: result.booking }); setDraft(sanitizeMerchantBookingEditableInput(result.booking));
      setEditing(false); setNotice(action === "cancel" ? "预约已取消。" : restoring ? "预约已重新提交。" : "预约已更新。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败，请稍后重试。"); }
    finally { busy.current = false; setSaving(false); }
  };

  const booking = details?.booking;
  const canEdit = Boolean(booking && details?.rule && (canCustomerChangeMerchantBooking(booking, "update") || canCustomerChangeMerchantBooking(booking, "restore")));
  const setField = (key: keyof MerchantBookingEditableInput, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold tracking-widest text-sky-700">FAOLLA · 预约管理</p>
        <h1 className="mt-2 text-2xl font-bold">{booking?.siteName || "管理您的预约"}</h1>
        {loading ? <p className="mt-5" role="status">正在读取预约…</p> : null}
        {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
        {booking && draft ? <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4 text-sm">
            <span>预约编号：{booking.id}</span><span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{getMerchantBookingStatusLabel(booking.status)}</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">{booking.appointmentTimeZone ? `预约时区：${booking.appointmentTimeZone}` : "历史预约未记录时区，保持原预约时间。"}</p>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void changeBooking("update"); }}>
            {([ ["store", "店铺", details?.rule?.storeOptions], ["item", "项目", details?.rule?.itemOptions], ["title", "称谓", details?.rule?.titleOptions] ] as const).map(([key, label, options]) => (
              <label key={key} className="min-w-0 text-sm">{label}<select className={fieldClass} disabled={!editing || saving} value={draft[key]} onChange={(event) => setField(key, event.target.value)}>
                {[...new Set([draft[key], ...(options ?? [])])].filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}
              </select></label>
            ))}
            <label className="min-w-0 text-sm">姓名<input required className={fieldClass} disabled={!editing || saving} value={draft.customerName} onChange={(event) => setField("customerName", normalizeMerchantBookingCustomerNameInput(event.target.value))} /><span className="text-xs text-slate-500">最多 {MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES} 字节</span></label>
            <label className="min-w-0 text-sm">预约时间<input required type="datetime-local" className={fieldClass} disabled={!editing || saving} value={draft.appointmentAt} onChange={(event) => setField("appointmentAt", event.target.value)} /></label>
            <label className="min-w-0 text-sm">邮箱<input required type="email" className={fieldClass} disabled={!editing || saving} value={draft.email} onChange={(event) => setField("email", event.target.value)} /></label>
            <label className="min-w-0 text-sm">电话<input required type="tel" className={fieldClass} disabled={!editing || saving} value={draft.phone} onChange={(event) => setField("phone", event.target.value)} /></label>
            <label className="text-sm sm:col-span-2">备注<textarea className={fieldClass} disabled={!editing || saving} value={draft.note} onChange={(event) => setField("note", normalizeMerchantBookingNoteInput(event.target.value))} /><span className="text-xs text-slate-500">最多 {MERCHANT_BOOKING_NOTE_MAX_BYTES} 字节</span></label>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              {editing ? <>
                <button type="submit" disabled={saving || !canEdit} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white disabled:opacity-50">{saving ? "处理中…" : booking.status === "cancelled" ? "重新提交预约" : "保存修改"}</button>
                <button type="button" disabled={saving} className="rounded-xl border px-4 py-2.5 text-sm" onClick={() => { setDraft(sanitizeMerchantBookingEditableInput(booking)); setEditing(false); }}>放弃修改</button>
              </> : <button type="button" disabled={!canEdit || saving} className="rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50" onClick={() => setEditing(true)}>修改预约</button>}
              <button type="button" disabled={saving || !canCustomerChangeMerchantBooking(booking, "cancel")} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm text-red-700 disabled:opacity-50" onClick={() => { if (window.confirm("确定取消这次预约吗？")) void changeBooking("cancel"); }}>取消预约</button>
              {booking.status === "active" || booking.status === "confirmed" ? <button type="button" disabled={saving} className="rounded-xl border px-4 py-2.5 text-sm" onClick={() => { if (credentials.current) window.location.assign(buildMerchantBookingCustomerCalendarUrl(window.location.origin, booking.id, credentials.current.editToken)); }}>加入日历</button> : null}
            </div>
          </form>
          {!canEdit ? <p className="mt-4 text-sm text-slate-500">商户已处理、预约已结束或原预约规则已撤下。如需调整，请联系商户。</p> : null}
          <p className="mt-6 border-t pt-4 text-xs text-slate-500">此链接包含预约管理凭证，请勿转发。保存和取消均以服务器校验结果为准。</p>
        </> : null}
      </section>
    </main>
  );
}
