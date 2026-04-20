"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type MerchantOrderStatus } from "@/lib/merchantOrders";

type OrderStatusFilterCounts = Record<MerchantOrderStatus, number> & {
  all: number;
};

type OrderStatusFilterDropdownProps = {
  counts: OrderStatusFilterCounts;
  selectedStatuses: MerchantOrderStatus[];
  onChange: (statuses: MerchantOrderStatus[]) => void;
  onPress?: () => void;
};

const STATUS_ORDER: MerchantOrderStatus[] = ["pending", "confirmed", "completed", "cancelled"];

function normalizeSelectedStatuses(value: MerchantOrderStatus[]) {
  return STATUS_ORDER.filter((status) => value.includes(status));
}

function getFilterText(status: MerchantOrderStatus | "all", count: number) {
  if (status === "all") return `全部 ${count}`;
  if (status === "pending") return `待确认 ${count}`;
  if (status === "confirmed") return `已确认 ${count}`;
  if (status === "completed") return `已完成 ${count}`;
  return `已取消 ${count}`;
}

function getMenuItemClass(status: MerchantOrderStatus, selected: boolean) {
  if (status === "pending") {
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
  return selected
    ? "border-slate-300 bg-slate-200 text-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100";
}

function CheckIndicator({
  checked,
  indeterminate,
}: {
  checked: boolean;
  indeterminate: boolean;
}) {
  return (
    <span
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${
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

export default function OrderStatusFilterDropdown({
  counts,
  selectedStatuses,
  onChange,
  onPress,
}: OrderStatusFilterDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const normalizedSelectedStatuses = useMemo(
    () => normalizeSelectedStatuses(selectedStatuses),
    [selectedStatuses],
  );
  const selectedStatusSet = useMemo(
    () => new Set<MerchantOrderStatus>(normalizedSelectedStatuses),
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

  const toggleStatus = (status: MerchantOrderStatus) => {
    const next = selectedStatusSet.has(status)
      ? normalizedSelectedStatuses.filter((item) => item !== status)
      : normalizeSelectedStatuses([...normalizedSelectedStatuses, status]);
    onChange(next);
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`inline-flex items-stretch overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm transition ${
          open ? "border-slate-300" : "hover:bg-slate-50"
        }`}
      >
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm transition hover:bg-slate-50"
          onClick={() => {
            onPress?.();
            setOpen(false);
          }}
        >
          <span className="font-medium text-slate-900">{getFilterText("all", counts.all)}</span>
          <span className="text-[11px] font-medium text-slate-500">{`${normalizedSelectedStatuses.length}/${STATUS_ORDER.length}`}</span>
        </button>
        <button
          type="button"
          className="inline-flex w-10 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={getFilterText("all", counts.all)}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[240px] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_38px_rgba(15,23,42,0.14)]">
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${
              allSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
            }`}
            onClick={toggleAll}
          >
            <div className="flex min-w-0 items-center gap-2">
              <CheckIndicator checked={allSelected} indeterminate={partiallySelected} />
              <span className="text-sm font-medium">{getFilterText("all", counts.all)}</span>
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
                    <CheckIndicator checked={checked} indeterminate={false} />
                    <span className="text-sm font-medium">{getFilterText(status, counts[status])}</span>
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
