"use client";

import { resolveMerchantBookingTimeRangeSelection } from "@/lib/merchantBookings";

type BookingQuickTimeRangePickerProps = {
  ranges?: string[];
  selectedTime?: string;
  disabled?: boolean;
  className?: string;
  onSelect: (nextTime: string, range: string) => void;
};

export default function BookingQuickTimeRangePicker({
  ranges = [],
  selectedTime = "",
  disabled = false,
  className = "",
  onSelect,
}: BookingQuickTimeRangePickerProps) {
  const normalizedRanges = ranges
    .map((item) => {
      const range = String(item ?? "").trim();
      const nextTime = resolveMerchantBookingTimeRangeSelection(range);
      return range && nextTime ? { range, nextTime } : null;
    })
    .filter((item): item is { range: string; nextTime: string } => !!item);

  if (normalizedRanges.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {normalizedRanges.map(({ range, nextTime }) => (
        <button
          key={range}
          type="button"
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
            nextTime === selectedTime
              ? "border-sky-300 bg-sky-100 text-sky-800"
              : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          onClick={() => onSelect(nextTime, range)}
          disabled={disabled}
          aria-label={`选择时间 ${range}`}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
