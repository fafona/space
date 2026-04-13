"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEventHandler } from "react";
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

type WorkbenchMenuKey = "rules" | "reminders" | "reports";
type SaveWorkbenchOptions = {
  applyServerDraft?: boolean;
  calendarSyncAction?: "keep" | "ensure" | "reset" | "disable";
  sourceDraft?: MerchantBookingWorkbenchSettings;
  sourceSerialized?: string;
};

const REMINDER_PRESETS = [1440, 720, 120, 60, 30];
const MOBILE_BREAKPOINT = 768;

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

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m11.5 4.5-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getMenuButtonClass(active: boolean, darkMode: boolean) {
  if (active) {
    return darkMode
      ? "border-slate-100 bg-slate-100 text-slate-900"
      : "border-slate-900 bg-slate-900 text-white";
  }
  return darkMode
    ? "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50";
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
  const [activeMenu, setActiveMenu] = useState<WorkbenchMenuKey>("rules");
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const swipeStateRef = useRef({
    tracking: false,
    startX: 0,
    startY: 0,
  });
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const hasLoadedRef = useRef(false);
  const lastFailedDraftRef = useRef("");
  const lastSavedDraftRef = useRef("");

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setAutoSaveStatus("idle");
      return;
    }
    setActiveMenu("rules");
    setSwipeOffset(0);
  }, [open]);

  useEffect(() => {
    if (!open || !siteId) return;
    let cancelled = false;
    hasLoadedRef.current = false;
    lastFailedDraftRef.current = "";
    setAutoSaveStatus("idle");
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
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
          const normalized = normalizeMerchantBookingWorkbenchSettings(json.settings);
          lastSavedDraftRef.current = JSON.stringify(normalized);
          draftRef.current = normalized;
          hasLoadedRef.current = true;
          setDraft(normalized);
          setAutoSaveStatus("saved");
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

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

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
      const nextTimeRanges =
        typeof patch.timeRangesText === "string"
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

  const saveWorkbench = useCallback(
    async ({
      applyServerDraft = false,
      calendarSyncAction = "keep",
      sourceDraft = draftRef.current,
      sourceSerialized = JSON.stringify(sourceDraft),
    }: SaveWorkbenchOptions = {}) => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setSaving(true);
      setAutoSaveStatus("saving");
      setError("");
      lastFailedDraftRef.current = "";
      try {
        const response = await fetch("/api/bookings/workbench", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            settings: sourceDraft,
            calendarSyncAction,
          }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; settings?: MerchantBookingWorkbenchSettings }
          | null;
        if (!response.ok || !json?.ok || !json.settings) {
          throw new Error("工作台设置保存失败");
        }
        const normalized = normalizeMerchantBookingWorkbenchSettings(json.settings);
        lastSavedDraftRef.current = JSON.stringify(normalized);
        if (applyServerDraft) {
          draftRef.current = normalized;
          setDraft(normalized);
        }
        setAutoSaveStatus("saved");
      } catch (saveError) {
        lastFailedDraftRef.current = sourceSerialized;
        setAutoSaveStatus("idle");
        setError(saveError instanceof Error ? saveError.message : "工作台设置保存失败");
      } finally {
        setSaving(false);
      }
    },
    [siteId],
  );

  useEffect(() => {
    if (!open || !siteId || loading || saving || !hasLoadedRef.current) return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedDraftRef.current || serialized === lastFailedDraftRef.current) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveWorkbench({
        applyServerDraft: false,
        sourceDraft: draft,
        sourceSerialized: serialized,
      });
    }, 700);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [draft, loading, open, saveWorkbench, saving, siteId]);

  const copyCalendarSyncUrl = async () => {
    if (!calendarSyncUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(calendarSyncUrl);
    } catch {
      setError("订阅链接复制失败");
    }
  };

  const handleTouchStart = ((event) => {
    if (typeof window === "undefined" || window.innerWidth >= MOBILE_BREAKPOINT) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > 42) {
      swipeStateRef.current.tracking = false;
      return;
    }
    swipeStateRef.current = {
      tracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
    };
    setSwipeOffset(0);
  }) satisfies TouchEventHandler<HTMLDivElement>;

  const handleTouchMove = ((event) => {
    if (!swipeStateRef.current.tracking) return;
    const touch = event.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - swipeStateRef.current.startX;
    const deltaY = touch.clientY - swipeStateRef.current.startY;
    if (deltaX <= 0 || Math.abs(deltaY) > 80) {
      setSwipeOffset(0);
      return;
    }
    setSwipeOffset(Math.min(120, deltaX));
  }) satisfies TouchEventHandler<HTMLDivElement>;

  const finishSwipe = () => {
    if (swipeOffset >= 96) {
      onClose();
      return;
    }
    setSwipeOffset(0);
    swipeStateRef.current.tracking = false;
  };

  const handleTouchEnd = (() => {
    finishSwipe();
  }) satisfies TouchEventHandler<HTMLDivElement>;

  const handleTouchCancel = (() => {
    setSwipeOffset(0);
    swipeStateRef.current.tracking = false;
  }) satisfies TouchEventHandler<HTMLDivElement>;

  if (!open) return null;

  const shellClassName = darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900";
  const panelClassName = darkMode
    ? "border-slate-700/80 bg-slate-900 text-slate-100"
    : "border-slate-200 bg-white text-slate-900";
  const softPanelClassName = darkMode
    ? "border-slate-700/80 bg-slate-950 text-slate-100"
    : "border-slate-200 bg-slate-50 text-slate-900";
  const inputClassName = darkMode
    ? "w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none"
    : "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";

  const content = (
    <div className={`fixed inset-0 z-[2147483000] ${shellClassName}`}>
      <div
        className="flex h-full flex-col"
        style={{
          transform: swipeOffset > 0 ? `translateX(${swipeOffset}px)` : undefined,
          transition: swipeStateRef.current.tracking ? "none" : "transform 180ms ease-out",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div className={`border-b px-4 py-3 sm:px-6 ${darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 hover:border-slate-500" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                onClick={onClose}
              >
                <BackIcon />
                <span>返回预约管理</span>
              </button>
              <div className="mt-3 text-xl font-semibold">预约工作台</div>
              <div className={`mt-1 text-sm ${mutedTextClassName}`}>{siteName || siteId}</div>
              <div className={`mt-2 text-xs ${mutedTextClassName}`}>
                {saving ? "正在自动保存..." : autoSaveStatus === "saved" ? "已自动保存" : "修改后自动保存"}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className={`rounded-3xl border p-4 ${panelClassName}`}>
                <div className={`text-xs ${mutedTextClassName}`}>待处理预约</div>
                <div className="mt-2 text-2xl font-semibold">{openBookingCount}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${panelClassName}`}>
                <div className={`text-xs ${mutedTextClassName}`}>今日预约</div>
                <div className="mt-2 text-2xl font-semibold">{todayBookingCount}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${panelClassName}`}>
                <div className={`text-xs ${mutedTextClassName}`}>7日内预约</div>
                <div className="mt-2 text-2xl font-semibold">{upcomingWeekCount}</div>
              </div>
              <div className={`rounded-3xl border p-4 ${panelClassName}`}>
                <div className={`text-xs ${mutedTextClassName}`}>待自动处理</div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>{`客户提醒 ${reminderSummary.dueCustomerReminderCount}`}</div>
                  <div>{`商家提醒 ${reminderSummary.dueMerchantReminderCount}`}</div>
                  <div>{`爽约判定 ${reminderSummary.pendingNoShowCount}`}</div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {([
                { key: "rules", label: "预约规则" },
                { key: "reminders", label: "提醒通知" },
                { key: "reports", label: "报表" },
              ] as Array<{ key: WorkbenchMenuKey; label: string }>).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${getMenuButtonClass(activeMenu === item.key, darkMode)}`}
                  onClick={() => setActiveMenu(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {error ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-700 bg-rose-950/60 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className={`rounded-3xl border p-6 ${panelClassName}`}>正在加载工作台设置...</div>
            ) : null}

            {!loading && activeMenu === "rules" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="space-y-4">
                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">提前预约 / 截止规则</div>
                    <div className={`mt-1 text-sm ${mutedTextClassName}`}>至少提前多久才能预约，以及当天最晚接受预约到几点。</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-sm">最少提前分钟</span>
                        <input
                          type="number"
                          className={inputClassName}
                          value={draft.minAdvanceMinutes ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, minAdvanceMinutes: toNumberOrNull(event.target.value) }))
                          }
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
                    </div>
                  </section>

                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">周期性不可预约</div>
                    <div className={`mt-1 text-sm ${mutedTextClassName}`}>支持“每周一全天休息”或“每周三下午不接单”。时间段用英文逗号分隔。</div>
                    <div className="mt-4 space-y-3">
                      {weekdayLabels.map((label, weekday) => {
                        const currentRule = draft.recurringRules.find((item) => item.weekday === weekday) ?? null;
                        return (
                          <div
                            key={weekday}
                            className={`grid gap-3 rounded-2xl border p-3 md:grid-cols-[96px_auto_minmax(0,1fr)] ${softPanelClassName}`}
                          >
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
                </div>

                <div className="space-y-4">
                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">缓冲时间</div>
                    <div className={`mt-1 text-sm ${mutedTextClassName}`}>只有店铺和项目这两项内容都相同的预约，前后才需要按这个间隔错开。</div>
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

                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">爽约</div>
                    <div className={`mt-1 text-sm ${mutedTextClassName}`}>到预约时间后超过宽限分钟仍未完成或确认，系统会自动标记为未到店。</div>
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
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, noShowGraceMinutes: toNumberOrNull(event.target.value) }))
                          }
                          placeholder="宽限分钟，例如 30"
                          disabled={!draft.noShowEnabled}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            ) : null}

            {!loading && activeMenu === "reminders" ? (
              <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                <div className="text-base font-semibold">提醒通知</div>
                <div className={`mt-1 text-sm ${mutedTextClassName}`}>客户提醒走邮件，商家提醒走浏览器推送。预设可点，也可直接输入分钟。</div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className={`rounded-2xl border p-4 ${softPanelClassName}`}>
                    <div className="text-sm font-semibold">客户提醒</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {REMINDER_PRESETS.map((minutes) => {
                        const selected = draft.customerReminderOffsetsMinutes.includes(minutes);
                        return (
                          <button
                            key={`customer-${minutes}`}
                            type="button"
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ${selected ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : darkMode ? "border border-slate-700 bg-slate-900 text-slate-300" : "border border-slate-200 bg-white text-slate-600"}`}
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
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          customerReminderOffsetsMinutes: parseReminderInput(event.target.value),
                        }))
                      }
                      placeholder="例如 1440, 120, 30"
                    />
                  </div>

                  <div className={`rounded-2xl border p-4 ${softPanelClassName}`}>
                    <div className="text-sm font-semibold">商家提醒</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {REMINDER_PRESETS.map((minutes) => {
                        const selected = draft.merchantReminderOffsetsMinutes.includes(minutes);
                        return (
                          <button
                            key={`merchant-${minutes}`}
                            type="button"
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ${selected ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : darkMode ? "border border-slate-700 bg-slate-900 text-slate-300" : "border border-slate-200 bg-white text-slate-600"}`}
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
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          merchantReminderOffsetsMinutes: parseReminderInput(event.target.value),
                        }))
                      }
                      placeholder="例如 1440, 120, 30"
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {!loading && activeMenu === "reports" ? (
              <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                <div className="text-base font-semibold">报表</div>
                <div className={`mt-1 text-sm ${mutedTextClassName}`}>支持直接下载 ICS，也可生成订阅链接给 Google Calendar / Apple Calendar 使用。</div>
                <div className={`mt-4 rounded-2xl border p-4 ${softPanelClassName}`}>
                  <div className="text-sm">
                    {draft.calendarSyncToken
                      ? `已生成同步令牌${draft.calendarSyncTokenUpdatedAt ? `，更新时间 ${draft.calendarSyncTokenUpdatedAt}` : ""}`
                      : "当前还没有同步令牌"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                      onClick={() =>
                        void saveWorkbench({
                          applyServerDraft: true,
                          calendarSyncAction: draft.calendarSyncToken ? "reset" : "ensure",
                        })
                      }
                      disabled={saving}
                    >
                      {draft.calendarSyncToken ? "重置订阅链接" : "生成订阅链接"}
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                      onClick={() => void saveWorkbench({ applyServerDraft: true, calendarSyncAction: "disable" })}
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return overlay(content);
}
