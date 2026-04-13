"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import {
  buildMerchantBookingReminderSummary,
  createDefaultMerchantBookingWorkbenchSettings,
  formatMerchantBookingReminderOffset,
  normalizeMerchantBookingWorkbenchSettings,
  type MerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbench";
import { normalizeMerchantBookingTimeRangeOptions } from "@/lib/merchantBookings";

type BookingWorkbenchDialogProps = {
  open: boolean;
  siteId: string;
  siteName: string;
  records: MerchantBookingRecord[];
  darkMode?: boolean;
  onClose: () => void;
};

const REMINDER_PRESETS = [1440, 720, 120, 60, 30];

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function formatReminderInput(value: number[]) {
  return value.join(", ");
}

function parseReminderInput(value: string) {
  const next: number[] = [];
  value
    .split(/[,\s]+/)
    .map((item) => Number.parseInt(item.trim(), 10))
    .forEach((item) => {
      if (!Number.isFinite(item) || item < 1 || next.includes(item)) return;
      next.push(item);
    });
  return next.sort((left, right) => right - left);
}

function toNumberOrNull(value: string) {
  const numeric = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return numeric;
}

function buildWeekdayLabels(locale: string) {
  const formatter = new Intl.DateTimeFormat(locale || "zh-CN", { weekday: "short" });
  return Array.from({ length: 7 }, (_, weekday) => formatter.format(new Date(2026, 0, 4 + weekday)));
}

function countOpenBookings(records: MerchantBookingRecord[]) {
  return records.filter((record) => record.status === "active" || record.status === "confirmed").length;
}

function countTodayBookings(records: MerchantBookingRecord[]) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayText = `${yyyy}-${mm}-${dd}`;
  return records.filter((record) => record.appointmentAt.startsWith(todayText)).length;
}

function countUpcomingBookings(records: MerchantBookingRecord[], days: number) {
  const now = new Date();
  const max = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return records.filter((record) => {
    if (record.status !== "active" && record.status !== "confirmed") return false;
    const appointmentDate = new Date(record.appointmentAt.replace(" ", "T"));
    return Number.isFinite(appointmentDate.getTime()) && appointmentDate >= now && appointmentDate <= max;
  }).length;
}

export default function BookingWorkbenchDialog({
  open,
  siteId,
  siteName,
  records,
  darkMode = false,
  onClose,
}: BookingWorkbenchDialogProps) {
  const { locale } = useI18n();
  const [draft, setDraft] = useState<MerchantBookingWorkbenchSettings>(() => createDefaultMerchantBookingWorkbenchSettings());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !siteId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/bookings/workbench?siteId=${encodeURIComponent(siteId)}`, {
          cache: "no-store",
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; settings?: MerchantBookingWorkbenchSettings; error?: string }
          | null;
        if (!response.ok || !json?.ok) {
          throw new Error("工作台设置读取失败");
        }
        if (!cancelled) {
          setDraft(normalizeMerchantBookingWorkbenchSettings(json.settings));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "工作台设置读取失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, siteId]);

  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale || "zh-CN"), [locale]);
  const reminderSummary = useMemo(() => buildMerchantBookingReminderSummary(records, draft), [draft, records]);
  const openBookingCount = useMemo(() => countOpenBookings(records), [records]);
  const todayBookingCount = useMemo(() => countTodayBookings(records), [records]);
  const upcomingWeekCount = useMemo(() => countUpcomingBookings(records, 7), [records]);
  const calendarSyncUrl = useMemo(() => {
    if (!draft.calendarSyncToken || typeof window === "undefined") return "";
    return `${window.location.origin}/api/bookings/calendar?siteId=${encodeURIComponent(siteId)}&token=${encodeURIComponent(draft.calendarSyncToken)}`;
  }, [draft.calendarSyncToken, siteId]);

  const updateRecurringRule = (weekday: number, patch: { allDay?: boolean; timeRangesText?: string }) => {
    setDraft((current) => {
      const currentRule = current.recurringRules.find((item) => item.weekday === weekday) ?? null;
      const nextAllDay = patch.allDay ?? currentRule?.allDay ?? false;
      const nextTimeRanges = typeof patch.timeRangesText === "string"
        ? normalizeMerchantBookingTimeRangeOptions(
            patch.timeRangesText
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        : currentRule?.timeRanges ?? [];
      const nextRules = current.recurringRules.filter((item) => item.weekday !== weekday);
      if (nextAllDay || nextTimeRanges.length > 0) {
        nextRules.push({
          id: currentRule?.id || `weekday-${weekday}`,
          weekday,
          allDay: nextAllDay,
          timeRanges: nextAllDay ? [] : nextTimeRanges,
        });
      }
      return {
        ...current,
        recurringRules: nextRules.sort((left, right) => left.weekday - right.weekday),
      };
    });
  };

  const toggleReminderPreset = (field: "customerReminderOffsetsMinutes" | "merchantReminderOffsetsMinutes", minutes: number) => {
    setDraft((current) => {
      const currentValues = current[field];
      const nextValues = currentValues.includes(minutes)
        ? currentValues.filter((item) => item !== minutes)
        : [...currentValues, minutes];
      return {
        ...current,
        [field]: nextValues.sort((left, right) => right - left),
      };
    });
  };

  const saveWorkbench = async (calendarSyncAction: "keep" | "ensure" | "reset" | "disable" = "keep") => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/bookings/workbench", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          settings: draft,
          calendarSyncAction,
        }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; settings?: MerchantBookingWorkbenchSettings }
        | null;
      if (!response.ok || !json?.ok || !json.settings) {
        throw new Error("工作台设置保存失败");
      }
      setDraft(normalizeMerchantBookingWorkbenchSettings(json.settings));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "工作台设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const copyCalendarSyncUrl = async () => {
    if (!calendarSyncUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(calendarSyncUrl);
    } catch {
      setError("订阅链接复制失败");
    }
  };

  if (!open) return null;

  const containerClassName = darkMode
    ? "border-slate-700 bg-slate-900 text-slate-100"
    : "border-slate-200 bg-white text-slate-900";
  const panelClassName = darkMode
    ? "border-slate-700/80 bg-slate-950 text-slate-100"
    : "border-slate-200 bg-slate-50 text-slate-900";
  const inputClassName = darkMode
    ? "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none"
    : "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none";
  const cardClassName = darkMode
    ? "rounded-2xl border border-slate-700/80 bg-slate-950/90 p-4"
    : "rounded-2xl border border-slate-200 bg-white p-4";

  const dialog = (
    <div className="fixed inset-0 z-[2147483000] bg-black/50 p-3 sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className={`mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[30px] border shadow-2xl ${containerClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-inherit px-5 py-4">
          <div>
            <div className="text-lg font-semibold">预约工作台</div>
            <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{siteName || siteId}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-200" : "border border-slate-200 bg-white text-slate-700"}`}
              onClick={onClose}
            >
              关闭
            </button>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              onClick={() => void saveWorkbench()}
              disabled={saving}
            >
              {saving ? "保存中..." : "保存工作台"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className={cardClassName}>正在加载工作台设置...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className={cardClassName}>
                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>待处理预约</div>
                  <div className="mt-2 text-2xl font-semibold">{openBookingCount}</div>
                </div>
                <div className={cardClassName}>
                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>今日预约</div>
                  <div className="mt-2 text-2xl font-semibold">{todayBookingCount}</div>
                </div>
                <div className={cardClassName}>
                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>7日内预约</div>
                  <div className="mt-2 text-2xl font-semibold">{upcomingWeekCount}</div>
                </div>
                <div className={cardClassName}>
                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>待自动处理</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div>{`客户提醒 ${reminderSummary.dueCustomerReminderCount}`}</div>
                    <div>{`商家提醒 ${reminderSummary.dueMerchantReminderCount}`}</div>
                    <div>{`爽约判定 ${reminderSummary.pendingNoShowCount}`}</div>
                  </div>
                </div>
              </div>

              {error ? (
                <div className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-700 bg-rose-950/60 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                  {error}
                </div>
              ) : null}

              <section className={cardClassName}>
                <div className="text-base font-semibold">1. 提前预约 / 截止规则</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>至少提前多久才能预约，以及过了当天截止时间后，需要再额外提前多久。</div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-sm">最少提前分钟</span>
                    <input
                      type="number"
                      className={inputClassName}
                      value={draft.minAdvanceMinutes ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, minAdvanceMinutes: toNumberOrNull(event.target.value) }))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm">当天截止时间</span>
                    <input
                      type="time"
                      className={inputClassName}
                      value={draft.dailyCutoffTime}
                      onChange={(event) => setDraft((current) => ({ ...current, dailyCutoffTime: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm">截止后额外提前分钟</span>
                    <input
                      type="number"
                      className={inputClassName}
                      value={draft.dailyCutoffLeadMinutes ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, dailyCutoffLeadMinutes: toNumberOrNull(event.target.value) }))}
                    />
                  </label>
                </div>
              </section>

              <section className={cardClassName}>
                <div className="text-base font-semibold">2. 缓冲时间</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>同一预约区块内，前后订单需要至少间隔多少分钟。</div>
                <div className="mt-4 max-w-sm">
                  <label className="space-y-1">
                    <span className="text-sm">缓冲分钟</span>
                    <input
                      type="number"
                      className={inputClassName}
                      value={draft.bufferMinutes ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, bufferMinutes: toNumberOrNull(event.target.value) }))}
                    />
                  </label>
                </div>
              </section>

              <section className={cardClassName}>
                <div className="text-base font-semibold">3. 周期性不可预约</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>支持“每周一全天休息”或“每周三下午不接单”。时间段用英文逗号分隔。</div>
                <div className="mt-4 space-y-3">
                  {weekdayLabels.map((label, weekday) => {
                    const currentRule = draft.recurringRules.find((item) => item.weekday === weekday) ?? null;
                    return (
                      <div key={weekday} className={`grid gap-3 rounded-2xl border p-3 md:grid-cols-[96px_auto_minmax(0,1fr)] ${panelClassName}`}>
                        <div className="flex items-center text-sm font-medium">{label}</div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={currentRule?.allDay === true}
                            onChange={(event) => updateRecurringRule(weekday, { allDay: event.target.checked })}
                          />
                          全天停约
                        </label>
                        <input
                          type="text"
                          className={inputClassName}
                          placeholder="例如 13:00-18:00,19:30-21:00"
                          value={currentRule?.allDay ? "" : (currentRule?.timeRanges ?? []).join(", ")}
                          disabled={currentRule?.allDay === true}
                          onChange={(event) => updateRecurringRule(weekday, { timeRangesText: event.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={cardClassName}>
                <div className="text-base font-semibold">4. 提醒通知</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>客户提醒走邮件，商家提醒走浏览器推送。预设可点，也可直接输入分钟。</div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className={`rounded-2xl border p-4 ${panelClassName}`}>
                    <div className="text-sm font-semibold">客户提醒</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {REMINDER_PRESETS.map((minutes) => {
                        const selected = draft.customerReminderOffsetsMinutes.includes(minutes);
                        return (
                          <button
                            key={`customer-${minutes}`}
                            type="button"
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ${selected ? "bg-slate-900 text-white" : darkMode ? "border border-slate-700 bg-slate-900 text-slate-300" : "border border-slate-200 bg-white text-slate-600"}`}
                            onClick={() => toggleReminderPreset("customerReminderOffsetsMinutes", minutes)}
                          >
                            {formatMerchantBookingReminderOffset(minutes)}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      className={`${inputClassName} mt-3`}
                      value={formatReminderInput(draft.customerReminderOffsetsMinutes)}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        customerReminderOffsetsMinutes: parseReminderInput(event.target.value),
                      }))}
                      placeholder="例如 1440, 120, 30"
                    />
                  </div>
                  <div className={`rounded-2xl border p-4 ${panelClassName}`}>
                    <div className="text-sm font-semibold">商家提醒</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {REMINDER_PRESETS.map((minutes) => {
                        const selected = draft.merchantReminderOffsetsMinutes.includes(minutes);
                        return (
                          <button
                            key={`merchant-${minutes}`}
                            type="button"
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ${selected ? "bg-slate-900 text-white" : darkMode ? "border border-slate-700 bg-slate-900 text-slate-300" : "border border-slate-200 bg-white text-slate-600"}`}
                            onClick={() => toggleReminderPreset("merchantReminderOffsetsMinutes", minutes)}
                          >
                            {formatMerchantBookingReminderOffset(minutes)}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      className={`${inputClassName} mt-3`}
                      value={formatReminderInput(draft.merchantReminderOffsetsMinutes)}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        merchantReminderOffsetsMinutes: parseReminderInput(event.target.value),
                      }))}
                      placeholder="例如 1440, 120, 30"
                    />
                  </div>
                </div>
              </section>

              <section className={cardClassName}>
                <div className="text-base font-semibold">5. 未到店 / 爽约</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>到预约时间后超过宽限分钟仍未完成或确认，系统会自动标记为未到店。</div>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.noShowEnabled}
                      onChange={(event) => setDraft((current) => ({ ...current, noShowEnabled: event.target.checked }))}
                    />
                    启用自动爽约判定
                  </label>
                  <div className="w-full max-w-sm">
                    <input
                      type="number"
                      className={inputClassName}
                      value={draft.noShowGraceMinutes ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, noShowGraceMinutes: toNumberOrNull(event.target.value) }))}
                      placeholder="宽限分钟，例如 30"
                      disabled={!draft.noShowEnabled}
                    />
                  </div>
                </div>
              </section>

              <section className={cardClassName}>
                <div className="text-base font-semibold">6. 导出 / 同步日历</div>
                <div className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>支持直接下载 ICS，也可生成订阅链接给 Google Calendar / Apple Calendar 使用。</div>
                <div className={`mt-4 rounded-2xl border p-4 ${panelClassName}`}>
                  <div className="text-sm">
                    {draft.calendarSyncToken
                      ? `已生成同步令牌${draft.calendarSyncTokenUpdatedAt ? `，更新时间 ${draft.calendarSyncTokenUpdatedAt}` : ""}`
                      : "当前还没有同步令牌"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                      onClick={() => void saveWorkbench(draft.calendarSyncToken ? "reset" : "ensure")}
                      disabled={saving}
                    >
                      {draft.calendarSyncToken ? "重置订阅链接" : "生成订阅链接"}
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                      onClick={() => void saveWorkbench("disable")}
                      disabled={saving || !draft.calendarSyncToken}
                    >
                      停用订阅链接
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                      onClick={() => void copyCalendarSyncUrl()}
                      disabled={!calendarSyncUrl}
                    >
                      复制订阅链接
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                      onClick={() => {
                        if (typeof window === "undefined") return;
                        window.open(`/api/bookings/calendar?siteId=${encodeURIComponent(siteId)}&download=1`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      下载 ICS
                    </button>
                  </div>
                  {calendarSyncUrl ? (
                    <div className={`mt-3 break-all rounded-xl px-3 py-2 text-xs ${darkMode ? "bg-slate-900 text-slate-300" : "bg-white text-slate-500"}`}>
                      {calendarSyncUrl}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return overlay(dialog);
}
