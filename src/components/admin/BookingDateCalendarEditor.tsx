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

type CalendarCell = {
  value: Date;
  key: string;
  inCurrentMonth: boolean;
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

function buildCalendarCells(monthStart: Date): CalendarCell[] {
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

function buildYearOptions(selectedDates: string[], displayMonth: Date) {
  const displayYear = displayMonth.getFullYear();
  const currentYear = new Date().getFullYear();
  const selectedYears = selectedDates
    .map((item) => Number.parseInt(item.slice(0, 4), 10))
    .filter((item) => Number.isFinite(item));
  const minYear = Math.min(displayYear, currentYear, ...(selectedYears.length > 0 ? selectedYears : [currentYear])) - 2;
  const maxYear = Math.max(displayYear, currentYear, ...(selectedYears.length > 0 ? selectedYears : [currentYear])) + 2;
  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
}

function groupSelectedDatesByMonth(selectedDates: string[]) {
  const groups = new Map<string, string[]>();
  selectedDates.forEach((item) => {
    const monthKey = item.slice(0, 7);
    const day = item.slice(8, 10);
    const current = groups.get(monthKey) ?? [];
    current.push(day);
    groups.set(monthKey, current);
  });
  return [...groups.entries()].map(([monthKey, days]) => ({ monthKey, days }));
}

function ArrowButton({
  direction,
  onClick,
}: {
  direction: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
      onClick={onClick}
      aria-label={direction === "left" ? "上个月" : "下个月"}
      title={direction === "left" ? "上个月" : "下个月"}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        {direction === "left" ? (
          <path d="m12.5 4.5-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="m7.5 4.5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
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
  const visibleYear = displayMonth.getFullYear();
  const visibleMonth = displayMonth.getMonth() + 1;
  const yearOptions = useMemo(() => buildYearOptions(selectedDates, displayMonth), [displayMonth, selectedDates]);
  const selectedDateGroups = useMemo(() => groupSelectedDatesByMonth(selectedDates), [selectedDates]);
  const visibleYearWeekendDates = useMemo(() => collectWeekendDatesForYear(visibleYear), [visibleYear]);
  const accentClassName =
    tone === "holiday"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border-rose-300 bg-rose-100 text-rose-800";
  const monthSelectClassName =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";

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

  const handleYearChange = (value: string) => {
    const nextYear = Number.parseInt(value, 10);
    if (!Number.isFinite(nextYear)) return;
    setDisplayMonth(new Date(nextYear, displayMonth.getMonth(), 1));
  };

  const handleMonthChange = (value: string) => {
    const nextMonth = Number.parseInt(value, 10);
    if (!Number.isFinite(nextMonth) || nextMonth < 1 || nextMonth > 12) return;
    setDisplayMonth(new Date(displayMonth.getFullYear(), nextMonth - 1, 1));
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-xs text-slate-500">{helperText}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ArrowButton direction="left" onClick={() => setDisplayMonth((current) => addMonths(current, -1))} />
          <select className={monthSelectClassName} value={visibleYear} onChange={(event) => handleYearChange(event.target.value)}>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {`${year}年`}
              </option>
            ))}
          </select>
          <select className={monthSelectClassName} value={visibleMonth} onChange={(event) => handleMonthChange(event.target.value)}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>
                {`${month}月`}
              </option>
            ))}
          </select>
          <ArrowButton direction="right" onClick={() => setDisplayMonth((current) => addMonths(current, 1))} />
        </div>
        <div className="text-xs text-slate-500">{`已选 ${selectedDates.length} 天`}</div>
      </div>

      {allowYearWeekendShortcut ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 transition hover:bg-emerald-100"
            onClick={() => commitDates([...selectedDates, ...visibleYearWeekendDates])}
          >
            {`一键勾选 ${visibleYear} 全年周六和周日`}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            onClick={() => commitDates(selectedDates.filter((item) => !visibleYearWeekendDates.includes(item)))}
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

      {selectedDateGroups.length > 0 ? (
        <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
          {selectedDateGroups.map((group) => (
            <div key={group.monthKey} className="flex flex-wrap items-start gap-2">
              <div className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {`${group.monthKey}：`}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.days.map((day) => {
                  const dateKey = `${group.monthKey}-${day}`;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      className={`rounded-full border px-2.5 py-1 text-xs ${accentClassName}`}
                      onClick={() => toggleDate(dateKey)}
                    >
                      {Number.parseInt(day, 10)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
