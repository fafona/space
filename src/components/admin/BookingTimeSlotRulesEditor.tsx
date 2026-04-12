"use client";

import { useMemo, useState } from "react";
import {
  normalizeMerchantBookingTimeSlotRules,
  type MerchantBookingTimeSlotRule,
} from "@/lib/merchantBookings";

type BookingTimeSlotRulesEditorProps = {
  value?: unknown;
  legacyRanges?: unknown;
  onChange: (value: MerchantBookingTimeSlotRule[]) => void;
};

type SlotRuleDraftRow = {
  id: string;
  timeRange: string;
  maxBookings: string;
};

function createRowId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMaxBookings(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : null;
}

function buildDraftRows(value: MerchantBookingTimeSlotRule[]) {
  return value.map((item) => ({
    id: createRowId(),
    timeRange: item.timeRange,
    maxBookings: item.maxBookings ? String(item.maxBookings) : "",
  }));
}

function buildNormalizedRules(rows: SlotRuleDraftRow[]) {
  return normalizeMerchantBookingTimeSlotRules(
    rows.map((item) => ({
      timeRange: item.timeRange,
      maxBookings: normalizeMaxBookings(item.maxBookings),
    })),
  );
}

export default function BookingTimeSlotRulesEditor({
  value = [],
  legacyRanges = [],
  onChange,
}: BookingTimeSlotRulesEditorProps) {
  const normalizedValue = useMemo(
    () => normalizeMerchantBookingTimeSlotRules(value, legacyRanges),
    [legacyRanges, value],
  );
  const valueSignature = JSON.stringify(normalizedValue);
  const [draftState, setDraftState] = useState<{
    signature: string;
    rows: SlotRuleDraftRow[];
  }>(() => ({
    signature: valueSignature,
    rows: buildDraftRows(normalizedValue),
  }));
  const rows = draftState.signature === valueSignature ? draftState.rows : buildDraftRows(normalizedValue);

  const commitRows = (nextRows: SlotRuleDraftRow[]) => {
    const normalizedRules = buildNormalizedRules(nextRows);
    setDraftState({
      signature: valueSignature,
      rows: buildDraftRows(normalizedRules),
    });
    onChange(normalizedRules);
  };

  const commitCurrentRows = () => {
    setDraftState((current) => {
      const sourceRows = current.signature === valueSignature ? current.rows : buildDraftRows(normalizedValue);
      const normalizedRules = buildNormalizedRules(sourceRows);
      onChange(normalizedRules);
      return {
        signature: valueSignature,
        rows: buildDraftRows(normalizedRules),
      };
    });
  };

  const updateRow = (rowId: string, patch: Partial<Omit<SlotRuleDraftRow, "id">>) => {
    setDraftState((current) => {
      const sourceRows = current.signature === valueSignature ? current.rows : buildDraftRows(normalizedValue);
      return {
        signature: valueSignature,
        rows: sourceRows.map((item) => (item.id === rowId ? { ...item, ...patch } : item)),
      };
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-700">可预约时段 / 时间点</div>
          <div className="mt-1 text-xs text-slate-500">每行设置一个时段或时间点，并在右侧填写该时段的人数上限。</div>
        </div>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
          onClick={() =>
            setDraftState((current) => {
              const sourceRows = current.signature === valueSignature ? current.rows : buildDraftRows(normalizedValue);
              return {
                signature: valueSignature,
                rows: [...sourceRows, { id: createRowId(), timeRange: "", maxBookings: "" }],
              };
            })
          }
        >
          添加时段
        </button>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((item, index) => (
            <div key={item.id} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_140px_auto]">
              <label className="space-y-1 text-sm text-gray-700">
                <span className="block text-gray-600">{`时段 ${index + 1}`}</span>
                <input
                  className="w-full rounded border px-3 py-2"
                  value={item.timeRange}
                  placeholder="09:00-12:00 或 19:30"
                  onChange={(event) => updateRow(item.id, { timeRange: event.target.value })}
                  onBlur={commitCurrentRows}
                />
              </label>
              <label className="space-y-1 text-sm text-gray-700">
                <span className="block text-gray-600">人数上限</span>
                <input
                  className="w-full rounded border px-3 py-2"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={item.maxBookings}
                  placeholder="不限"
                  onChange={(event) => updateRow(item.id, { maxBookings: event.target.value })}
                  onBlur={commitCurrentRows}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-100"
                  onClick={() => commitRows(rows.filter((row) => row.id !== item.id))}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
          还没有设置预约时段。添加后可分别控制每个时段或时间点的人数上限。
        </div>
      )}
    </div>
  );
}
