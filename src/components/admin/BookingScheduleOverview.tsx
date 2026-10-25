"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import { bookingScheduleDays, bookingScheduleRecords, bookingCapacitySummary } from "@/lib/merchantBookingPresentation";
import type { MerchantBookingRulesSnapshot } from "@/lib/merchantBookingRules";

const subscribeClock = (listener: () => void) => { const timer = window.setInterval(listener, 60000); return () => window.clearInterval(timer); };
const currentDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; };
const serverDate = () => "";

/** An overview of LOADED records, never an authoritative availability calendar. */
export function BookingScheduleOverview({ records, locale, partial, onSelect, rules }: {
  records: MerchantBookingRecord[]; locale: string; partial: boolean; onSelect: (id: string) => void; rules?: MerchantBookingRulesSnapshot | null;
}) {
  const es = locale.startsWith("es");
  const [view, setView] = useState<"day" | "week">("week");
  const today = useSyncExternalStore(subscribeClock, currentDate, serverDate);
  const [selectedDate, setAnchor] = useState("");
  const anchor = selectedDate || today;
  const groups = useMemo(() => bookingScheduleRecords(records, bookingScheduleDays(anchor, view)), [records, anchor, view]);
  return <details className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-slate-900">
    <summary className="cursor-pointer text-sm font-semibold">{es ? "Agenda diaria / semanal" : "日／周排期概览"}</summary>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-xs">{es ? "Fecha" : "排期日期"} <input aria-label={es ? "Fecha de agenda" : "排期日期"} type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="rounded-lg border bg-white px-2 py-1" /></label>
      <select aria-label={es ? "Vista de agenda" : "排期视图"} value={view} onChange={(event) => setView(event.target.value as "day" | "week")} className="rounded-lg border bg-white px-2 py-1 text-xs">
        <option value="day">{es ? "Día" : "日视图"}</option><option value="week">{es ? "Semana" : "周视图"}</option>
      </select>
    </div>
    <p className="mt-2 text-xs text-slate-500">{es ? "Solo citas cargadas; horas locales de cada cita. No confirma plazas disponibles." : "仅统计已加载预约，按各预约记录的当地时间排列；不代表可预约余量。"}
      {partial ? (es ? " Cargue más para completar el período." : " 尚有未加载记录，请加载更多后核对。") : ""}</p>
    <div className={`mt-3 grid gap-2 ${view === "week" ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-7" : "grid-cols-1"}`}>
      {groups.map(({ day, records: items }) => <section key={day} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2">
        <div className="text-xs font-semibold">{day}</div><div className="mb-2 text-xs text-slate-500">{es ? `${items.length} citas` : `${items.length} 条预约`}</div>
        {bookingCapacitySummary(records, day, rules).map((slot) => <p key={slot.key} className="mb-1 rounded bg-slate-100 px-1 py-1 text-[10px] text-slate-600">{slot.timeRange} · {es ? "cargadas/límite" : "已加载占用／上限"} {slot.occupied}/{slot.capacity}</p>)}
        {items.length === 0 ? <span className="text-xs text-slate-400">{es ? "Sin citas cargadas" : "暂无已加载预约"}</span> : items.map((record) => <button key={record.id} type="button" onClick={() => onSelect(record.id)} className="mb-1 block w-full rounded-lg bg-sky-50 px-2 py-2 text-left text-xs hover:bg-sky-100">
          <span className="font-semibold">{record.appointmentAt.slice(11, 16)}</span> · {record.item || record.id}<span className="mt-1 block truncate text-slate-500">{record.appointmentTimeZone || (es ? "Hora histórica" : "历史时间")}</span>
        </button>)}
      </section>)}
    </div>
  </details>;
}
