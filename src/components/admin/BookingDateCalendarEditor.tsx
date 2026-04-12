"use client";

import { useMemo, useState } from "react";
import { normalizeMerchantBookingDateList } from "@/lib/merchantBookings";

type BookingDateCalendarEditorProps = {
  label: string;
  helperText: string;
  value?: string[];
  tone?: "blocked" | "holiday";
  allowYearWeekendShortcut?: boolean;
  onChange: (value: string[]) => void;
};

function normalizeMonthStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, delta: number) {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1);
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function buildCalendarCells(monthStart: Date) {
  const firstVisibleDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(firstVisibleDate.getFullYear(), firstVisibleDate.getMonth(), firstVisibleDate.getDate() + index);
    return {
      value,
      key: formatDate(value),
      inCurrentMonth: isSameMonth(value, monthStart),
    };
  });
}

function collectWeekendDatesForYear(year: number) {
  const next: string[] = [];
  for (let month = 0; month < 12; month += 1) {
    const date = new Date(year, month, 1);
    while (date.getMonth() === month) {
      const day = date.getDay();
      if (day === 0 || day === 6) {
        next.push(formatDate(date));
      }
      date.setDate(date.getDate() + 1);
    }
  }
  return next;
}

export default function BookingDateCalendarEditor({
  label,
  helperText,
  value = [],
  tone = "blocked",
  allowYearWeekendShortcut = false,
  onChange,
}: BookingDateCalendarEditorProps) {
  const normalizedValue = useMemo(() => normalizeMerchantBookingDateList(value), [value]);
  const valueSignature = JSON.stringify(normalizedValue);
  const [draftState, setDraftState] = useState<{
    signature: string;
    selectedDates: string[];
  }>(() => ({
    signature: valueSignature,
    selectedDates: normalizedValue,
  }));
  const selectedDates = draftState.signature === valueSignature ? draftState.selectedDates : normalizedValue;
  const [displayMonth, setDisplayMonth] = useState(() => {
    if (normalizedValue.length > 0) {
      const [year, month] = normalizedValue[0].split("-").map((item) => Number.parseInt(item, 10));
      return new Date(year, (month || 1) - 1, 1);
    }
    return normalizeMonthStart(new Date());
  });

  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const cells = useMemo(() => buildCalendarCells(displayMonth), [displayMonth]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
      }).format(displayMonth),
    [displayMonth],
  );
  const accentClassName =
    tone === "holiday"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border-rose-300 bg-rose-100 text-rose-800";

  const commitDates = (nextDates: string[]) => {
    const normalizedDates = normalizeMerchantBookingDateList(nextDates);
    setDraftState({
      signature: valueSignature,
      selectedDates: normalizedDates,
    });
    onChange(normalizedDates);
  };

  const toggleDate = (dateKey: string) => {
    commitDates(
      selectedDateSet.has(dateKey)
        ? selectedDates.filter((item) => item !== dateKey)
        : [...selectedDates, dateKey],
    );
  };

  const visibleYear = displayMonth.getFullYear();

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-xs text-slate-500">{helperText}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => setDisplayMonth((current) => addMonths(current, -1))}
          >
            上个月
          </button>
          <div className="min-w-[120px] text-center text-sm font-medium text-slate-700">{monthLabel}</div>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => setDisplayMonth((current) => addMonths(current, 1))}
          >
            下个月
          </button>
        </div>
        <div className="text-xs text-slate-500">{`已选 ${selectedDates.length} 天`}</div>
      </div>

      {allowYearWeekendShortcut ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 transition hover:bg-emerald-100"
            onClick={() => commitDates([...selectedDates, ...collectWeekendDatesForYear(visibleYear)])}
          >
            {`一键勾选 ${visibleYear} 全年周六和周日`}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() =>
              commitDates(selectedDates.filter((item) => !collectWeekendDatesForYear(visibleYear).includes(item)))
            }
          >
            {`清空 ${visibleYear} 周末`}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
        {["日", "一", "二", "三", "四", "五", "六"].map((item) => (
          <div key={item} className="py-1">
            {item}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const isSelected = selectedDateSet.has(cell.key);
          return (
            <button
              key={cell.key}
              type="button"
              className={`rounded-lg border px-0 py-2 text-sm transition ${
                isSelected
                  ? accentClassName
                  : cell.inCurrentMonth
                    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-transparent bg-slate-100 text-slate-400 hover:bg-slate-200"
              }`}
              onClick={() => toggleDate(cell.key)}
            >
              {cell.value.getDate()}
            </button>
          );
        })}
      </div>

      {selectedDates.length > 0 ? (
        <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap gap-2">
            {selectedDates.map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-xs ${accentClassName}`}
                onClick={() => toggleDate(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
