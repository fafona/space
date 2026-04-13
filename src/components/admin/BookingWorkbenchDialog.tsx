"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEventHandler } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import { getMerchantBookingFieldText, getMerchantBookingStatusText } from "@/lib/merchantBookingLocale";
import { MERCHANT_BOOKING_STATUSES, type MerchantBookingRecord, type MerchantBookingStatus } from "@/lib/merchantBookings";
import {
  getMerchantBookingCustomerEmailDefaultStatusMessage,
  getMerchantBookingCustomerEmailLanguageOptions,
  resolveMerchantBookingCustomerEmailLocale,
} from "@/lib/merchantBookingCustomerEmail";
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
  siteCountryCode?: string;
  records: MerchantBookingRecord[];
  darkMode?: boolean;
  allowCustomerAutoEmail?: boolean;
  onClose: () => void;
  onSettingsSaved?: (settings: MerchantBookingWorkbenchSettings) => void;
};

type WorkbenchMenuKey = "rules" | "reminders";
type WorkbenchSectionView = "home" | WorkbenchMenuKey;
type SaveWorkbenchOptions = {
  applyServerDraft?: boolean;
  calendarSyncAction?: "keep" | "ensure" | "reset" | "disable";
  sourceDraft?: MerchantBookingWorkbenchSettings;
  sourceSerialized?: string;
};
type MetricTone = "amber" | "sky" | "emerald" | "rose" | "cyan";

const MOBILE_BREAKPOINT = 768;

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function formatReminderInput(value: number[]) {
  return value[0] ? String(value[0]) : "";
}

function parseReminderInput(value: string) {
  const numeric = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return [];
  return [numeric];
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumberOrNull(value: string) {
  const numeric = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return numeric;
}

function getReminderSummaryLabel(value: number[]) {
  return value[0] ? formatMerchantBookingReminderOffset(value[0]) : "未设置";
}

function buildCalendarSyncUrl(origin: string, siteId: string, token: string) {
  return `${origin}/api/bookings/calendar?siteId=${encodeURIComponent(siteId)}&token=${encodeURIComponent(token)}`;
}

function toWebcalUrl(url: string) {
  return trimText(url).replace(/^https?:\/\//i, "webcal://");
}

function buildGoogleCalendarSubscribeUrl(url: string) {
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(toWebcalUrl(url) || url)}`;
}

function buildOutlookCalendarSubscribeUrl(url: string, title: string) {
  const normalizedTitle = trimText(title) || "FAOLLA bookings";
  return `https://outlook.live.com/calendar/0/addcalendar?url=${encodeURIComponent(url)}&name=${encodeURIComponent(normalizedTitle)}`;
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
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
      <path d="M19 12H7M12 7l-5 5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WorkbenchSectionIcon({ section }: { section: WorkbenchMenuKey }) {
  if (section === "rules") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M7 6.8h10M7 12h10M7 17.2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4.8 6.8h.01M4.8 12h.01M4.8 17.2h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M12 4.5a4.5 4.5 0 0 0-4.5 4.5v2.1c0 .6-.2 1.2-.6 1.7L5.8 14a1 1 0 0 0 .8 1.6h10.8a1 1 0 0 0 .8-1.6l-1.1-1.2c-.4-.5-.6-1.1-.6-1.7V9A4.5 4.5 0 0 0 12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.3 18a1.9 1.9 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function getMetricRowClass(tone: MetricTone, darkMode: boolean) {
  if (darkMode) {
    switch (tone) {
      case "amber":
        return "border-amber-400/20 bg-amber-400/10";
      case "sky":
        return "border-sky-400/20 bg-sky-400/10";
      case "emerald":
        return "border-emerald-400/20 bg-emerald-400/10";
      case "rose":
        return "border-rose-400/20 bg-rose-400/10";
      case "cyan":
        return "border-cyan-400/20 bg-cyan-400/10";
      default:
        return "border-slate-700/80 bg-slate-900";
    }
  }

  switch (tone) {
    case "amber":
      return "border-amber-200 bg-amber-50/80";
    case "sky":
      return "border-sky-200 bg-sky-50/85";
    case "emerald":
      return "border-emerald-200 bg-emerald-50/85";
    case "rose":
      return "border-rose-200 bg-rose-50/85";
    case "cyan":
      return "border-cyan-200 bg-cyan-50/85";
    default:
      return "border-slate-200 bg-white";
  }
}

function getMetricValueClass(tone: MetricTone, darkMode: boolean) {
  if (darkMode) {
    switch (tone) {
      case "amber":
        return "bg-amber-300/16 text-amber-100 ring-1 ring-amber-300/18";
      case "sky":
        return "bg-sky-300/16 text-sky-100 ring-1 ring-sky-300/18";
      case "emerald":
        return "bg-emerald-300/16 text-emerald-100 ring-1 ring-emerald-300/18";
      case "rose":
        return "bg-rose-300/16 text-rose-100 ring-1 ring-rose-300/18";
      case "cyan":
        return "bg-cyan-300/16 text-cyan-100 ring-1 ring-cyan-300/18";
      default:
        return "bg-slate-800 text-slate-100 ring-1 ring-slate-700";
    }
  }

  switch (tone) {
    case "amber":
      return "bg-amber-100 text-amber-700 ring-1 ring-amber-200";
    case "sky":
      return "bg-sky-100 text-sky-700 ring-1 ring-sky-200";
    case "emerald":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
    case "rose":
      return "bg-rose-100 text-rose-700 ring-1 ring-rose-200";
    case "cyan":
      return "bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200";
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}

export default function BookingWorkbenchDialog({
  open,
  siteId,
  siteName,
  siteCountryCode = "",
  records,
  darkMode = false,
  allowCustomerAutoEmail = false,
  onClose,
  onSettingsSaved,
}: BookingWorkbenchDialogProps) {
  const { locale } = useI18n();
  const defaultCustomerEmailLocale = useMemo(
    () => resolveMerchantBookingCustomerEmailLocale("", siteCountryCode),
    [siteCountryCode],
  );
  const emailLanguageOptions = useMemo(() => getMerchantBookingCustomerEmailLanguageOptions(), []);
  const [draft, setDraft] = useState<MerchantBookingWorkbenchSettings>(() => createDefaultMerchantBookingWorkbenchSettings());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copySuccessNotice, setCopySuccessNotice] = useState("");
  const [sectionView, setSectionView] = useState<WorkbenchSectionView>("home");
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStateRef = useRef({
    tracking: false,
    startX: 0,
    startY: 0,
  });
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copySuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (copySuccessTimerRef.current) {
        clearTimeout(copySuccessTimerRef.current);
        copySuccessTimerRef.current = null;
      }
      setCopySuccessNotice("");
      return;
    }
    setSectionView("home");
    setSwipeOffset(0);
    setCopySuccessNotice("");
  }, [open]);

  useEffect(() => {
    if (!open || !siteId) return;
    let cancelled = false;
    hasLoadedRef.current = false;
    lastFailedDraftRef.current = "";
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
  }, [defaultCustomerEmailLocale, open, siteId, siteName]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
      if (copySuccessTimerRef.current) {
        clearTimeout(copySuccessTimerRef.current);
      }
    };
  }, []);

  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale || "zh-CN"), [locale]);
  const reminderSummary = useMemo(
    () =>
      buildMerchantBookingReminderSummary(records, {
        ...draft,
        customerAutoEmailEnabled: allowCustomerAutoEmail && draft.customerAutoEmailEnabled,
      }),
    [allowCustomerAutoEmail, draft, records],
  );
  const openBookingCount = useMemo(() => countOpenBookings(records), [records]);
  const todayBookingCount = useMemo(() => countTodayBookings(records), [records]);
  const upcomingWeekCount = useMemo(() => countUpcomingBookings(records, 7), [records]);
  const primaryMetrics = useMemo(
    () => [
      { label: "待处理预约", shortLabel: "待处理", value: openBookingCount, tone: "amber" as const },
      { label: "今日预约", shortLabel: "今日预约", value: todayBookingCount, tone: "sky" as const },
      { label: "7日内预约", shortLabel: "7日内预约", value: upcomingWeekCount, tone: "emerald" as const },
    ],
    [openBookingCount, todayBookingCount, upcomingWeekCount],
  );
  const autoMetrics = useMemo(
    () => [
      { label: "客户提醒", value: reminderSummary.dueCustomerReminderCount, tone: "sky" as const },
      { label: "商家提醒", value: reminderSummary.dueMerchantReminderCount, tone: "cyan" as const },
      { label: "爽约判定", value: reminderSummary.pendingNoShowCount, tone: "rose" as const },
    ],
    [reminderSummary.dueCustomerReminderCount, reminderSummary.dueMerchantReminderCount, reminderSummary.pendingNoShowCount],
  );
  const menuItems = useMemo(
    () =>
      [
        {
          key: "rules",
          label: getMerchantBookingFieldText("workbenchRules", locale),
          summary: "提前预约、截止时间、缓冲时间、周期性不可预约、爽约",
        },
        {
          key: "reminders",
          label: getMerchantBookingFieldText("workbenchReminders", locale),
          summary: draft.calendarSyncToken
            ? `客户 ${getReminderSummaryLabel(draft.customerReminderOffsetsMinutes)}、商家 ${getReminderSummaryLabel(draft.merchantReminderOffsetsMinutes)}，已开启日历同步`
            : `客户 ${getReminderSummaryLabel(draft.customerReminderOffsetsMinutes)}、商家 ${getReminderSummaryLabel(draft.merchantReminderOffsetsMinutes)}，可生成日历同步链接`,
        },
      ] satisfies Array<{ key: WorkbenchMenuKey; label: string; summary: string }>,
    [
      locale,
      draft.calendarSyncToken,
      draft.customerReminderOffsetsMinutes,
      draft.merchantReminderOffsetsMinutes,
    ],
  );
  const currentSectionLabel = useMemo(() => {
    if (sectionView === "home") return getMerchantBookingFieldText("workbenchTitle", locale);
    return menuItems.find((item) => item.key === sectionView)?.label ?? getMerchantBookingFieldText("workbenchTitle", locale);
  }, [locale, menuItems, sectionView]);
  const siteCalendarTitle = useMemo(() => {
    const normalizedSiteName = trimText(siteName);
    const normalizedSiteId = trimText(siteId);
    return normalizedSiteName || normalizedSiteId || "FAOLLA bookings";
  }, [siteId, siteName]);
  const calendarSyncUrl = useMemo(() => {
    if (!draft.calendarSyncToken || typeof window === "undefined") return "";
    return buildCalendarSyncUrl(window.location.origin, siteId, draft.calendarSyncToken);
  }, [draft.calendarSyncToken, siteId]);

  const handleBack = useCallback(() => {
    if (sectionView === "home") {
      onClose();
      return;
    }
    setSectionView("home");
  }, [onClose, sectionView]);

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

  const handleCustomerEmailLocaleChange = (nextLocale: string) => {
    setDraft((current) => {
      const resolvedNextLocale = resolveMerchantBookingCustomerEmailLocale(nextLocale, siteCountryCode);
      const previousLocale = current.customerEmailLocale || defaultCustomerEmailLocale;
      const nextMessageByStatus: Partial<Record<MerchantBookingStatus, string>> = {
        ...current.customerAutoEmailMessageByStatus,
      };
      MERCHANT_BOOKING_STATUSES.forEach((status) => {
        const currentMessage = trimText(nextMessageByStatus[status]);
        const previousDefault = getMerchantBookingCustomerEmailDefaultStatusMessage(status, previousLocale);
        if (!currentMessage || currentMessage === previousDefault) {
          nextMessageByStatus[status] = getMerchantBookingCustomerEmailDefaultStatusMessage(status, resolvedNextLocale);
        }
      });
      return {
        ...current,
        customerEmailLocale: resolvedNextLocale,
        customerAutoEmailMessageByStatus: nextMessageByStatus,
      };
    });
  };

  const toggleAutoEmailStatus = (status: MerchantBookingStatus) => {
    setDraft((current) => {
      const selected = current.customerAutoEmailStatuses.includes(status);
      const nextStatuses = selected
        ? current.customerAutoEmailStatuses.filter((item) => item !== status)
        : [...current.customerAutoEmailStatuses, status];
      const resolvedLocale = current.customerEmailLocale || defaultCustomerEmailLocale;
      return {
        ...current,
        customerAutoEmailStatuses: nextStatuses,
        customerAutoEmailMessageByStatus: {
          ...current.customerAutoEmailMessageByStatus,
          [status]:
            trimText(current.customerAutoEmailMessageByStatus[status]) ||
            getMerchantBookingCustomerEmailDefaultStatusMessage(status, resolvedLocale),
        },
      };
    });
  };

  const updateAutoEmailStatusMessage = (status: MerchantBookingStatus, value: string) => {
    setDraft((current) => ({
      ...current,
      customerAutoEmailMessageByStatus: {
        ...current.customerAutoEmailMessageByStatus,
        [status]: value,
      },
    }));
  };

  const saveWorkbench = useCallback(
    async ({
      applyServerDraft = false,
      calendarSyncAction = "keep",
      sourceDraft = draftRef.current,
      sourceSerialized = JSON.stringify(sourceDraft),
    }: SaveWorkbenchOptions = {}): Promise<MerchantBookingWorkbenchSettings | null> => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setSaving(true);
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
        onSettingsSaved?.(normalized);
        return normalized;
      } catch (saveError) {
        lastFailedDraftRef.current = sourceSerialized;
        setError(saveError instanceof Error ? saveError.message : "工作台设置保存失败");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [onSettingsSaved, siteId],
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

  const ensureCalendarSyncUrl = useCallback(async () => {
    if (typeof window === "undefined") return "";
    if (calendarSyncUrl) return calendarSyncUrl;
    const saved = await saveWorkbench({
      applyServerDraft: true,
      calendarSyncAction: "ensure",
    });
    if (!saved?.calendarSyncToken) return "";
    return buildCalendarSyncUrl(window.location.origin, siteId, saved.calendarSyncToken);
  }, [calendarSyncUrl, saveWorkbench, siteId]);

  const showCopySuccessNotice = useCallback(() => {
    setCopySuccessNotice("复制成功");
    if (copySuccessTimerRef.current) {
      clearTimeout(copySuccessTimerRef.current);
    }
    copySuccessTimerRef.current = setTimeout(() => {
      copySuccessTimerRef.current = null;
      setCopySuccessNotice("");
    }, 1800);
  }, []);

  const copyCalendarSyncUrl = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const syncUrl = await ensureCalendarSyncUrl();
    if (!syncUrl) return;
    try {
      await navigator.clipboard.writeText(syncUrl);
      showCopySuccessNotice();
    } catch {
      setError("订阅链接复制失败");
    }
  };

  const openCalendarTarget = useCallback(
    async (target: "apple" | "google" | "outlook" | "ics") => {
      if (typeof window === "undefined") return;
      if (target === "ics") {
        window.open(`/api/bookings/calendar?siteId=${encodeURIComponent(siteId)}&download=1`, "_blank", "noopener,noreferrer");
        return;
      }
      const syncUrl = await ensureCalendarSyncUrl();
      if (!syncUrl) return;
      if (target === "apple") {
        window.location.href = toWebcalUrl(syncUrl) || syncUrl;
        return;
      }
      const targetUrl =
        target === "google"
          ? buildGoogleCalendarSubscribeUrl(syncUrl)
          : buildOutlookCalendarSubscribeUrl(syncUrl, siteCalendarTitle);
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    },
    [ensureCalendarSyncUrl, siteCalendarTitle, siteId],
  );

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
      setSwipeOffset(0);
      swipeStateRef.current.tracking = false;
      handleBack();
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
    ? "block w-full min-w-0 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none"
    : "block w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const backButtonClassName = darkMode
    ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-100 transition hover:bg-slate-800/60 sm:h-auto sm:w-auto sm:gap-2 sm:border sm:border-slate-700 sm:bg-slate-900 sm:px-3 sm:py-2 sm:text-slate-100 sm:hover:border-slate-500 sm:hover:bg-slate-900"
    : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 transition hover:bg-slate-100 sm:h-auto sm:w-auto sm:gap-2 sm:border sm:border-slate-200 sm:bg-white sm:px-3 sm:py-2 sm:text-slate-700 sm:hover:bg-slate-50";
  const menuSectionClassName = darkMode
    ? "overflow-hidden rounded-[28px] border border-slate-700/80 bg-slate-900 shadow-[0_18px_40px_rgba(2,6,23,0.36)]"
    : "overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]";
  const menuIconClassName = darkMode
    ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-slate-100"
    : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700";
  const menuItemClassName = darkMode
    ? "flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-800/70"
    : "flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50";
  const menuDividerClassName = darkMode ? "divide-slate-800" : "divide-slate-100";
  const menuChevronClassName = darkMode ? "text-slate-500" : "text-slate-300";
  const pageContentBottomClassName = sectionView === "home" ? "pb-[calc(env(safe-area-inset-bottom)+7.5rem)]" : "pb-[calc(env(safe-area-inset-bottom)+6.25rem)]";
  const effectiveCustomerEmailLocale = draft.customerEmailLocale || defaultCustomerEmailLocale;
  const customerAutoEmailControlsDisabled = !allowCustomerAutoEmail || !draft.customerAutoEmailEnabled;

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
        <div className={`border-b px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.55rem)] sm:px-6 sm:py-3 ${darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
          <div className="flex items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              className={backButtonClassName}
              onClick={handleBack}
              aria-label={
                sectionView === "home"
                  ? getMerchantBookingFieldText("backToManagement", locale)
                  : getMerchantBookingFieldText("backToWorkbench", locale)
              }
            >
              <BackIcon />
              <span className="hidden sm:inline">
                {sectionView === "home"
                  ? getMerchantBookingFieldText("backToManagement", locale)
                  : getMerchantBookingFieldText("backToWorkbench", locale)}
              </span>
            </button>
            <div className="min-w-0 text-lg font-semibold tracking-tight sm:text-xl">{currentSectionLabel}</div>
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-6 sm:py-5 ${pageContentBottomClassName}`}>
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            {sectionView === "home" ? (
              <>
                <div className="space-y-2 md:hidden">
                  {primaryMetrics.map((item) => (
                    <div key={item.label} className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${getMetricRowClass(item.tone, darkMode)}`}>
                      <span className="text-sm font-medium">{item.shortLabel}</span>
                      <span className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-2.5 py-1 text-sm font-semibold ${getMetricValueClass(item.tone, darkMode)}`}>
                        {item.value}
                      </span>
                    </div>
                  ))}

                  {autoMetrics.map((item) => (
                    <div key={item.label} className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${getMetricRowClass(item.tone, darkMode)}`}>
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-2.5 py-1 text-sm font-semibold ${getMetricValueClass(item.tone, darkMode)}`}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="hidden gap-3 md:grid md:grid-cols-4">
                  {primaryMetrics.map((item) => (
                    <div key={item.label} className={`rounded-3xl border p-4 ${panelClassName}`}>
                      <div className={`text-xs ${mutedTextClassName}`}>{item.label}</div>
                      <div className="mt-2 text-2xl font-semibold">{item.value}</div>
                    </div>
                  ))}

                  <div className={`rounded-3xl border p-4 ${panelClassName}`}>
                    <div className="space-y-2 pt-1">
                      {autoMetrics.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate">{item.label}</span>
                          <span className={`inline-flex min-w-[2.4rem] items-center justify-center rounded-full px-2.5 py-1 text-sm font-semibold ${getMetricValueClass(item.tone, darkMode)}`}>
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {error ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-700 bg-rose-950/60 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className={`rounded-3xl border p-6 ${panelClassName}`}>正在加载工作台设置...</div>
            ) : null}

            {!loading && sectionView === "home" ? (
              <section className={menuSectionClassName}>
                <div className={`divide-y ${menuDividerClassName}`}>
                  {menuItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={menuItemClassName}
                      onClick={() => setSectionView(item.key)}
                    >
                      <span className={menuIconClassName}>
                        <WorkbenchSectionIcon section={item.key} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={darkMode ? "block text-sm font-semibold text-slate-100" : "block text-sm font-semibold text-slate-900"}>
                          {item.label}
                        </span>
                        <span className={`mt-1 block truncate text-xs leading-5 ${mutedTextClassName}`}>{item.summary}</span>
                      </span>
                      <span className={menuChevronClassName}>
                        <ChevronRightIcon />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {!loading && sectionView === "rules" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="space-y-4">
                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">提前预约 / 截止规则</div>
                    <div className={`mt-1 text-sm ${mutedTextClassName}`}>至少提前多久才能预约，以及当天最晚接受预约到几点。</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="min-w-0 space-y-1">
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
                      <label className="min-w-0 space-y-1 overflow-hidden">
                        <span className="text-sm">当天截止时间</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            className={`${inputClassName} max-w-full flex-1`}
                            value={draft.dailyCutoffTime}
                            onChange={(event) => setDraft((current) => ({ ...current, dailyCutoffTime: event.target.value }))}
                            style={{ minWidth: 0, maxWidth: "100%", colorScheme: darkMode ? "dark" : "light" }}
                          />
                          <button
                            type="button"
                            className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium transition ${
                              draft.dailyCutoffTime
                                ? darkMode
                                  ? "border border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-500"
                                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                : darkMode
                                  ? "border border-slate-800 bg-slate-950 text-slate-600"
                                  : "border border-slate-200 bg-slate-50 text-slate-300"
                            }`}
                            onClick={() => setDraft((current) => ({ ...current, dailyCutoffTime: "" }))}
                            disabled={!draft.dailyCutoffTime}
                          >
                            清除
                          </button>
                        </div>
                      </label>
                    </div>
                  </section>

                  <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                    <div className="text-base font-semibold">周期性不可预约</div>
                    <div className="mt-4 space-y-3">
                      {weekdayLabels.map((label, weekday) => {
                        const currentRule = draft.recurringRules.find((item) => item.weekday === weekday) ?? null;
                        return (
                          <div key={weekday} className={`rounded-2xl border p-3 ${softPanelClassName}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium">{label}</div>
                              <label className="flex shrink-0 items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={currentRule?.allDay === true}
                                  onChange={(event) => updateRecurringRule(weekday, { allDay: event.target.checked })}
                                />
                                全天停约
                              </label>
                            </div>
                            <input
                              type="text"
                              className={`${inputClassName} mt-3`}
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

            {!loading && sectionView === "reminders" ? (
              <div className="space-y-4">
                <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                  <div className="text-base font-semibold">日历同步</div>
                  <div className={`mt-1 text-sm ${mutedTextClassName}`}>可直接添加到 Apple Calendar、Google Calendar、Outlook，也保留 ICS 下载。</div>
                  <div className={`mt-4 rounded-2xl border p-4 ${softPanelClassName}`}>
                    <div className="text-sm">
                      {draft.calendarSyncToken
                        ? `已生成同步令牌${draft.calendarSyncTokenUpdatedAt ? `，更新时间 ${draft.calendarSyncTokenUpdatedAt}` : ""}`
                        : "当前还没有同步令牌"}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <button
                        type="button"
                        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                        onClick={() => void openCalendarTarget("apple")}
                        disabled={saving || loading}
                      >
                        Apple Calendar
                      </button>
                      <button
                        type="button"
                        className={`rounded-xl px-4 py-3 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                        onClick={() => void openCalendarTarget("google")}
                        disabled={saving || loading}
                      >
                        Google Calendar
                      </button>
                      <button
                        type="button"
                        className={`rounded-xl px-4 py-3 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                        onClick={() => void openCalendarTarget("outlook")}
                        disabled={saving || loading}
                      >
                        Outlook
                      </button>
                      <button
                        type="button"
                        className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        onClick={() => void openCalendarTarget("ics")}
                        disabled={saving || loading}
                      >
                        下载 ICS
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                        onClick={() => void copyCalendarSyncUrl()}
                        disabled={saving || loading}
                      >
                        复制订阅链接
                      </button>
                      {draft.calendarSyncToken ? (
                        <>
                          <button
                            type="button"
                            className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                            onClick={() =>
                              void saveWorkbench({
                                applyServerDraft: true,
                                calendarSyncAction: "reset",
                              })
                            }
                            disabled={saving}
                          >
                            重置订阅链接
                          </button>
                          <button
                            type="button"
                            className={`rounded-xl px-4 py-2 text-sm font-medium ${darkMode ? "border border-slate-700 bg-slate-900 text-slate-100" : "border border-slate-200 bg-white text-slate-700"}`}
                            onClick={() => void saveWorkbench({ applyServerDraft: true, calendarSyncAction: "disable" })}
                            disabled={saving}
                          >
                            停用订阅链接
                          </button>
                        </>
                      ) : null}
                    </div>
                    {calendarSyncUrl ? (
                      <div className={`mt-3 break-all rounded-xl px-3 py-2 text-xs ${darkMode ? "bg-slate-900 text-slate-300" : "bg-white text-slate-500"}`}>
                        {calendarSyncUrl}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className={`rounded-3xl border p-5 ${panelClassName}`}>
                  <div className="text-base font-semibold">提醒设置</div>
                  <div className={`mt-1 text-sm ${mutedTextClassName}`}>客户邮件和商家浏览器提醒分开设置，客户邮件语言以这里选定的语言为准。</div>
                  <div className="mt-4 space-y-4">
                    <div className={`rounded-2xl border p-4 ${softPanelClassName}`}>
                      <div className="text-sm font-semibold">客户邮件</div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-sm">邮件语言</span>
                          <select
                            className={inputClassName}
                            value={effectiveCustomerEmailLocale}
                            onChange={(event) => handleCustomerEmailLocaleChange(event.target.value)}
                          >
                            {emailLanguageOptions.map((option) => (
                              <option key={option.code} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm">发件人名称</span>
                          <input
                            type="text"
                            className={inputClassName}
                            value={draft.customerEmailSenderName}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                customerEmailSenderName: event.target.value,
                              }))
                            }
                            placeholder={trimText(siteName) || "商户名称"}
                          />
                        </label>
                      </div>
                      <div className={`mt-2 text-xs ${mutedTextClassName}`}>
                        留空时默认使用商户名称；这里的语言也会用于预约管理里的邮件按钮预填内容。
                      </div>

                      {!allowCustomerAutoEmail ? (
                        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                          当前预约权限未开通自动发邮件，只保留邮件语言设置。
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.customerAutoEmailEnabled}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                customerAutoEmailEnabled: event.target.checked,
                              }))
                            }
                            disabled={!allowCustomerAutoEmail}
                          />
                          开启自动发邮件
                        </label>
                        <span className={`text-xs ${mutedTextClassName}`}>关闭后，客户状态邮件和自动邮件提醒都不会发送。</span>
                      </div>

                      <div className="mt-4 space-y-3">
                        {MERCHANT_BOOKING_STATUSES.map((status) => {
                          const selected = draft.customerAutoEmailStatuses.includes(status);
                          return (
                            <div key={status} className={`rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-white"}`}>
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={!allowCustomerAutoEmail}
                                    onChange={() => toggleAutoEmailStatus(status)}
                                  />
                                  {getMerchantBookingStatusText(status, locale)}
                                </label>
                              </div>
                              <textarea
                                className={`${inputClassName} mt-3 min-h-[92px]`}
                                value={
                                  draft.customerAutoEmailMessageByStatus[status] ??
                                  getMerchantBookingCustomerEmailDefaultStatusMessage(status, effectiveCustomerEmailLocale)
                                }
                                disabled={customerAutoEmailControlsDisabled || !selected}
                                onChange={(event) => updateAutoEmailStatusMessage(status, event.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4">
                        <div className="text-sm font-medium">客户自动提醒时间</div>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className={`${inputClassName} mt-3`}
                          value={formatReminderInput(draft.customerReminderOffsetsMinutes)}
                          disabled={customerAutoEmailControlsDisabled}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              customerReminderOffsetsMinutes: parseReminderInput(event.target.value),
                            }))
                          }
                          placeholder="例如 30"
                        />
                      </div>
                    </div>

                    <div className={`rounded-2xl border p-4 ${softPanelClassName}`}>
                      <div className="text-sm font-semibold">商家提醒</div>
                      <div className={`mt-1 text-xs ${mutedTextClassName}`}>走浏览器推送，推给当前已开启系统通知的设备。</div>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className={`${inputClassName} mt-3`}
                        value={formatReminderInput(draft.merchantReminderOffsetsMinutes)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            merchantReminderOffsetsMinutes: parseReminderInput(event.target.value),
                          }))
                        }
                        placeholder="例如 30"
                      />
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {copySuccessNotice ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[2147483200] flex justify-center px-4"
          style={{ top: "max(1.25rem, env(safe-area-inset-top))" }}
        >
          <div className={`rounded-full px-4 py-2 text-sm font-medium shadow-2xl ${darkMode ? "bg-slate-100 text-slate-900" : "bg-slate-900 text-white"}`}>
            {copySuccessNotice}
          </div>
        </div>
      ) : null}
    </div>
  );

  return overlay(content);
}
