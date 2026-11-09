"use client";

import { useState } from "react";
import { normalizeMerchantBookingTimeRangeOptions } from "@/lib/merchantBookings";

type TimeRangeRow = { id: number; start: string; end: string; originalRange?: string };

export function createRecurringTimeRangeRows(timeRanges: string[]): TimeRangeRow[] {
  const rows = normalizeMerchantBookingTimeRangeOptions(timeRanges).map((range, id) => {
    const [start, end = start] = range.split("-");
    return { id, start, end, originalRange: range };
  });
  return rows.length ? rows : [{ id: 0, start: "", end: "" }];
}

export function serializeRecurringTimeRangeRows(rows: TimeRangeRow[]) {
  return normalizeMerchantBookingTimeRangeOptions(rows.flatMap((row) => {
    if (!row.start || !row.end || row.start > row.end) return [];
    const original = row.originalRange?.split("-");
    if (original?.[0] === row.start && (original[1] ?? original[0]) === row.end) {
      return [row.originalRange!];
    }
    return [`${row.start}-${row.end}`];
  }));
}

export function recurringTimeOptions(selected: string) {
  const options = Array.from({ length: 24 * 12 }, (_, index) => {
    const minutes = index * 5;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
  // Preserve exact existing times, including those not on a five-minute boundary.
  return [...new Set([...options, "23:59", ...(selected ? [selected] : [])])].sort();
}

type Props = {
  weekdayLabel: string;
  timeRanges: string[];
  disabled?: boolean;
  darkMode?: boolean;
  inputClassName: string;
  mutedTextClassName: string;
  onChange: (timeRanges: string[]) => void;
};

export default function RecurringBookingTimeRanges({
  weekdayLabel, timeRanges, disabled = false, darkMode = false,
  inputClassName, mutedTextClassName, onChange,
}: Props) {
  const serializedSource = JSON.stringify(timeRanges);
  const [editor, setEditor] = useState(() => {
    const rows = createRecurringTimeRangeRows(timeRanges);
    return { source: serializedSource, rows, nextId: rows.length };
  });
  // External reloads replace the rows. Our own save echo has the same source,
  // retaining partially selected extra rows without an effect or a second paint.
  if (serializedSource !== editor.source) {
    const rows = createRecurringTimeRangeRows(timeRanges);
    setEditor({ source: serializedSource, rows, nextId: rows.length });
  }
  const { rows } = editor;

  const commitRows = (next: TimeRangeRow[]) => {
    const ranges = serializeRecurringTimeRangeRows(next);
    const serialized = JSON.stringify(ranges);
    setEditor({
      source: serialized,
      rows: next.length ? next : [{ id: editor.nextId, start: "", end: "" }],
      nextId: editor.nextId + (next.length ? 0 : 1),
    });
    if (serialized !== editor.source) onChange(ranges);
  };

  const updateTime = (id: number, field: "start" | "end", value: string) => {
    commitRows(rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  };

  return (
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3">
      {rows.map((row, index) => (
        <div key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          {(["start", "end"] as const).map((field) => (
            <label key={field} className="min-w-0 space-y-1">
              <span className={`text-xs ${mutedTextClassName}`}>{field === "start" ? "开始时间" : "结束时间"}</span>
              <select
                aria-label={`${weekdayLabel} 第${index + 1}段${field === "start" ? "开始时间" : "结束时间"}`}
                className={`${inputClassName} disabled:cursor-not-allowed disabled:opacity-50`}
                value={row[field]}
                onChange={(event) => updateTime(row.id, field, event.target.value)}
                style={{ colorScheme: darkMode ? "dark" : "light" }}
              >
                <option value="" disabled>选择时间</option>
                {recurringTimeOptions(row[field]).map((time) => (
                  <option key={time} value={time} disabled={field === "start" ? Boolean(row.end && time > row.end) : Boolean(row.start && time < row.start)}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            aria-label={`删除${weekdayLabel}第${index + 1}段时段`}
            className={`mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"}`}
            onClick={() => commitRows(rows.filter((item) => item.id !== row.id))}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-label={`为${weekdayLabel}添加时段`}
          className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-amber-800 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40" : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}
          onClick={() => setEditor((current) => ({
            ...current,
            rows: [...current.rows, { id: current.nextId, start: "", end: "" }],
            nextId: current.nextId + 1,
          }))}
        >
          ＋ 添加时段
        </button>
        <span className={`text-xs ${mutedTextClassName}`}>
          {disabled ? "已全天停约，无需设置时段" : "选好起止时间后自动保存；跨夜时段请分两天设置。"}
        </span>
      </div>
    </fieldset>
  );
}
