"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MERCHANT_BOOKING_STATUSES, type MerchantBookingStatus } from "@/lib/merchantBookings";
import { getMerchantBookingFilterText } from "@/lib/merchantBookingLocale";

type BookingStatusFilterCounts = Record<MerchantBookingStatus, number> & {
  total: number;
};

type BookingStatusFilterDropdownProps = {
  locale: string;
  counts: BookingStatusFilterCounts;
  selectedStatuses: MerchantBookingStatus[];
  onChange: (statuses: MerchantBookingStatus[]) => void;
  onPress?: () => void;
  compact?: boolean;
};

const STATUS_ORDER = [...MERCHANT_BOOKING_STATUSES];

function normalizeSelectedStatuses(value: MerchantBookingStatus[]) {
  return STATUS_ORDER.filter((status) => value.includes(status));
}

function getMenuItemClass(status: MerchantBookingStatus, selected: boolean) {
  if (status === "active") {
    return selected
      ? "border-amber-300 bg-amber-100 text-amber-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-amber-200 hover:bg-amber-50";
  }
  if (status === "confirmed") {
    return selected
      ? "border-sky-300 bg-sky-100 text-sky-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50";
  }
  if (status === "completed") {
    return selected
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50";
  }
  if (status === "no_show") {
    return selected
      ? "border-rose-300 bg-rose-100 text-rose-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50";
  }
  return selected
    ? "border-slate-300 bg-slate-200 text-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100";
}

function CheckIndicator({
  checked,
  indeterminate,
  compact,
}: {
  checked: boolean;
  indeterminate: boolean;
  compact: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded border ${
        compact ? "h-4 w-4" : "h-[18px] w-[18px]"
      } ${
        checked || indeterminate
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-transparent"
      }`}
    >
      {indeterminate ? (
        <span className="block h-0.5 w-2 rounded bg-white" />
      ) : checked ? (
        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

export default function BookingStatusFilterDropdown({
  locale,
  counts,
  selectedStatuses,
  onChange,
  onPress,
  compact = false,
}: BookingStatusFilterDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const normalizedSelectedStatuses = useMemo(
    () => normalizeSelectedStatuses(selectedStatuses),
    [selectedStatuses],
  );
  const selectedStatusSet = useMemo(
    () => new Set<MerchantBookingStatus>(normalizedSelectedStatuses),
    [normalizedSelectedStatuses],
  );
  const allSelected = normalizedSelectedStatuses.length === STATUS_ORDER.length;
  const partiallySelected = normalizedSelectedStatuses.length > 0 && !allSelected;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleAll = () => {
    onChange(allSelected ? [] : STATUS_ORDER);
  };

  const toggleStatus = (status: MerchantBookingStatus) => {
    const next = selectedStatusSet.has(status)
      ? normalizedSelectedStatuses.filter((item) => item !== status)
      : normalizeSelectedStatuses([...normalizedSelectedStatuses, status]);
    onChange(next);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 ${
          compact ? "px-3 py-2 text-xs" : "px-3 py-2 text-sm"
        }`}
        onClick={() => {
          onPress?.();
          setOpen((current) => !current);
        }}
        aria-expanded={open}
      >
        <span className="font-medium text-slate-900">{getMerchantBookingFilterText("all", counts.total, locale)}</span>
        <span className="text-[11px] font-medium text-slate-500">{`${normalizedSelectedStatuses.length}/${STATUS_ORDER.length}`}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[240px] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_38px_rgba(15,23,42,0.14)]">
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${allSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"}`}
            onClick={toggleAll}
          >
            <div className="flex min-w-0 items-center gap-2">
              <CheckIndicator checked={allSelected} indeterminate={partiallySelected} compact={compact} />
              <span className={`${compact ? "text-xs" : "text-sm"} font-medium`}>
                {getMerchantBookingFilterText("all", counts.total, locale)}
              </span>
            </div>
          </button>

          <div className="mt-2 space-y-2">
            {STATUS_ORDER.map((status) => {
              const checked = selectedStatusSet.has(status);
              return (
                <button
                  key={status}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${getMenuItemClass(status, checked)}`}
                  onClick={() => toggleStatus(status)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <CheckIndicator checked={checked} indeterminate={false} compact={compact} />
                    <span className={`${compact ? "text-xs" : "text-sm"} font-medium`}>
                      {getMerchantBookingFilterText(status, counts[status], locale)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
