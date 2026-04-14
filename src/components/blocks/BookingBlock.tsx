"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BookingProps } from "@/data/homeBlocks";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  createEmptyMerchantBookingInput,
  formatMerchantBookingDateTime,
  getMerchantBookingDateAvailabilityIssue,
  getMerchantBookingTimeAvailabilityIssue,
  joinMerchantBookingDateTime,
  normalizeMerchantBookingCustomerNameInput,
  normalizeMerchantBookingDateList,
  normalizeMerchantBookingNoteInput,
  resolveMerchantBookingTimeRangeSelection,
  normalizeBookingOptionList,
  normalizeMerchantBookingTimeSlotRules,
  sanitizeMerchantBookingEditableInput,
  splitMerchantBookingDateTime,
  type MerchantBookingEditableInput,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";
import {
  getMerchantBookingAdvanceIssue,
  getMerchantBookingRecurringIssue,
  type MerchantBookingWorkbenchPublicSettings,
} from "@/lib/merchantBookingWorkbench";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import type { MerchantBookingRuleViewport } from "@/lib/merchantBookingRules";
import { useI18n } from "@/components/I18nProvider";
import { localizeSystemDefaultText, resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type BookingBlockComponentProps = BookingProps & {
  runtimeSiteId?: string;
  runtimeSiteName?: string;
  interactive?: boolean;
  runtimeBlockId?: string;
  runtimeViewport?: MerchantBookingRuleViewport;
};

type SubmittedBookingState = {
  booking: MerchantBookingRecord;
  editToken: string;
};

const EDIT_TOKEN_STORAGE_KEY = "merchant-space:merchant-booking-tokens:v1";

function readEditTokenMap() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  try {
    const raw = window.localStorage.getItem(EDIT_TOKEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeEditTokenMap(next: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EDIT_TOKEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota failures for best-effort persistence.
  }
}

function persistEditToken(bookingId: string, editToken: string) {
  if (!bookingId || !editToken) return;
  const next = readEditTokenMap();
  next[bookingId] = editToken;
  writeEditTokenMap(next);
}

function buildInitialDraft(
  storeOptions: string[],
  itemOptions: string[],
  titleOptions: string[],
  previous?: Partial<MerchantBookingEditableInput>,
) {
  const base = sanitizeMerchantBookingEditableInput(previous, createEmptyMerchantBookingInput());
  const appointmentParts = splitMerchantBookingDateTime(base.appointmentAt);
  return {
    ...base,
    store: base.store || storeOptions[0] || "",
    item: base.item || itemOptions[0] || "",
    title: base.title || titleOptions[0] || "",
    appointmentDateInput: appointmentParts.date,
    appointmentTimeInput: appointmentParts.time,
  };
}

function getFormFieldClass(disabled: boolean) {
  return `w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
    disabled ? "cursor-not-allowed bg-slate-100 text-slate-400" : ""
  }`;
}

function buildCustomerCalendarHref(bookingId: string, editToken: string) {
  if (!bookingId || !editToken) return "";
  const params = new URLSearchParams({
    bookingId,
    editToken,
    download: "1",
  });
  return `/api/bookings/customer-calendar?${params.toString()}`;
}

export default function BookingBlock({
  runtimeSiteId = "",
  runtimeSiteName = "",
  interactive = true,
  runtimeBlockId = "",
  runtimeViewport = "desktop",
  ...props
}: BookingBlockComponentProps) {
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const storeOptions = useMemo(
    () =>
      normalizeBookingOptionList(props.bookingStoreOptions, buildDefaultBookingStoreOptions(runtimeSiteName)).map((item) =>
        localizeSystemDefaultText(item, locale),
      ),
    [locale, props.bookingStoreOptions, runtimeSiteName],
  );
  const itemOptions = useMemo(
    () => normalizeBookingOptionList(props.bookingItemOptions, buildDefaultBookingItemOptions()).map((item) => localizeSystemDefaultText(item, locale)),
    [locale, props.bookingItemOptions],
  );
  const titleOptions = useMemo(
    () => normalizeBookingOptionList(props.bookingTitleOptions, buildDefaultBookingTitleOptions()).map((item) => localizeSystemDefaultText(item, locale)),
    [locale, props.bookingTitleOptions],
  );
  const timeSlotRules = useMemo(
    () => normalizeMerchantBookingTimeSlotRules(props.bookingTimeSlotRules, props.bookingAvailableTimeRanges),
    [props.bookingAvailableTimeRanges, props.bookingTimeSlotRules],
  );
  const availableTimeRanges = useMemo(
    () => timeSlotRules.map((item) => item.timeRange),
    [timeSlotRules],
  );
  const blockedDates = useMemo(
    () => normalizeMerchantBookingDateList(props.bookingBlockedDates),
    [props.bookingBlockedDates],
  );
  const holidayDates = useMemo(
    () => normalizeMerchantBookingDateList(props.bookingHolidayDates),
    [props.bookingHolidayDates],
  );
  const [draft, setDraft] = useState(() => buildInitialDraft(storeOptions, itemOptions, titleOptions));
  const [workbenchSettings, setWorkbenchSettings] = useState<MerchantBookingWorkbenchPublicSettings | null>(null);
  const appointmentValue = useMemo(
    () => joinMerchantBookingDateTime(draft.appointmentDateInput, draft.appointmentTimeInput),
    [draft.appointmentDateInput, draft.appointmentTimeInput],
  );
  const appointmentDateIssue = useMemo(
    () => {
      const baseIssue = getMerchantBookingDateAvailabilityIssue(draft.appointmentDateInput, blockedDates, holidayDates);
      if (baseIssue) return baseIssue;
      return getMerchantBookingRecurringIssue(appointmentValue, workbenchSettings?.recurringRules);
    },
    [appointmentValue, blockedDates, draft.appointmentDateInput, holidayDates, workbenchSettings],
  );
  const appointmentTimeIssue = useMemo(
    () => getMerchantBookingTimeAvailabilityIssue(draft.appointmentTimeInput, availableTimeRanges),
    [availableTimeRanges, draft.appointmentTimeInput],
  );
  const appointmentWorkbenchIssue = useMemo(
    () => {
      if (appointmentDateIssue) return "";
      return getMerchantBookingAdvanceIssue(appointmentValue, workbenchSettings);
    },
    [appointmentDateIssue, appointmentValue, workbenchSettings],
  );
  const [submittedState, setSubmittedState] = useState<SubmittedBookingState | null>(null);
  const [mode, setMode] = useState<"form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isLiveBooking = interactive && isMerchantNumericId(runtimeSiteId);
  const restoredBookingId = searchParams?.get("bookingId")?.trim() ?? "";
  const restoredEditToken = searchParams?.get("editToken")?.trim() ?? "";
  const restoredBlockId = searchParams?.get("bookingBlockId")?.trim() ?? "";
  const restoredViewport = searchParams?.get("bookingViewport")?.trim() ?? "";

  useEffect(() => {
    setDraft((current) => buildInitialDraft(storeOptions, itemOptions, titleOptions, current));
  }, [storeOptions, itemOptions, titleOptions]);

  useEffect(() => {
    if (!isLiveBooking) {
      setWorkbenchSettings(null);
      return;
    }

    let cancelled = false;
    const loadWorkbenchSettings = async () => {
      try {
        const response = await fetch(
          `/api/bookings/workbench/public?siteId=${encodeURIComponent(runtimeSiteId)}`,
          { cache: "no-store" },
        );
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; settings?: MerchantBookingWorkbenchPublicSettings }
          | null;
        if (!response.ok || !json?.ok || !json.settings) {
          throw new Error("workbench_settings_unavailable");
        }
        if (!cancelled) {
          setWorkbenchSettings(json.settings);
        }
      } catch {
        if (!cancelled) {
          setWorkbenchSettings(null);
        }
      }
    };

    void loadWorkbenchSettings();
    return () => {
      cancelled = true;
    };
  }, [isLiveBooking, runtimeSiteId]);

  useEffect(() => {
    if (!isLiveBooking || !restoredBookingId || !restoredEditToken) return;
    if (restoredBlockId && runtimeBlockId && restoredBlockId !== runtimeBlockId) return;
    if (restoredViewport && runtimeViewport && restoredViewport !== runtimeViewport) return;
    if (submittedState?.booking.id === restoredBookingId && submittedState.editToken === restoredEditToken) return;

    let cancelled = false;
    const restoreBooking = async () => {
      try {
        const response = await fetch(
          `/api/bookings/self-service?bookingId=${encodeURIComponent(restoredBookingId)}&editToken=${encodeURIComponent(restoredEditToken)}`,
          { cache: "no-store" },
        );
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; booking?: MerchantBookingRecord; message?: string }
          | null;
        if (!response.ok || !json?.ok || !json.booking) {
          throw new Error(json?.message || "预约链接已失效，请重新获取");
        }
        const nextBooking = json.booking;
        if (
          (runtimeBlockId && nextBooking.bookingBlockId && nextBooking.bookingBlockId !== runtimeBlockId) ||
          (runtimeViewport && nextBooking.bookingViewport && nextBooking.bookingViewport !== runtimeViewport)
        ) {
          return;
        }
        if (cancelled) return;
        persistEditToken(nextBooking.id, restoredEditToken);
        setSubmittedState({
          booking: nextBooking,
          editToken: restoredEditToken,
        });
        setDraft(buildInitialDraft(storeOptions, itemOptions, titleOptions, nextBooking));
        setMode("success");
      } catch (restoreError) {
        if (!cancelled) {
          setError(restoreError instanceof Error ? restoreError.message : "预约链接已失效，请重新获取");
        }
      }
    };
    void restoreBooking();
    return () => {
      cancelled = true;
    };
  }, [
    isLiveBooking,
    itemOptions,
    restoredBlockId,
    restoredBookingId,
    restoredEditToken,
    restoredViewport,
    runtimeBlockId,
    runtimeViewport,
    storeOptions,
    submittedState,
    titleOptions,
  ]);

  const headingHtml = toRichHtml(props.heading, resolveLocalizedSystemDefaultText(props.heading, "在线预约", locale));
  const textHtml = toRichHtml(
    props.text,
    resolveLocalizedSystemDefaultText(props.text, "客户可选择店铺、项目、日期时间并填写预约信息。", locale),
  );
  const submitLabel = resolveLocalizedSystemDefaultText(props.bookingSubmitLabel, "提交预约", locale);
  const updateLabel = resolveLocalizedSystemDefaultText(props.bookingUpdateLabel, "修改预约", locale);
  const cancelLabel = resolveLocalizedSystemDefaultText(props.bookingCancelLabel, "取消预约", locale);
  const storeLabel = resolveLocalizedSystemDefaultText(props.bookingStoreLabel, "预约店铺", locale);
  const itemLabel = resolveLocalizedSystemDefaultText(props.bookingItemLabel, "项目或类型", locale);
  const successTitle = resolveLocalizedSystemDefaultText(props.bookingSuccessTitle, "预约提交成功", locale);
  const successText = resolveLocalizedSystemDefaultText(
    props.bookingSuccessText,
    "我们已收到您的预约，可在此继续修改或取消。",
    locale,
  );
  const namePlaceholder = resolveLocalizedSystemDefaultText(props.bookingNamePlaceholder, "请输入称谓或姓名", locale);
  const notePlaceholder = resolveLocalizedSystemDefaultText(props.bookingNotePlaceholder, "可填写备注或需求", locale);
  const cardStyle = getBackgroundStyle({
    imageUrl: props.bgImageUrl,
    fillMode: props.bgFillMode,
    position: props.bgPosition,
    color: props.bgColor,
    opacity: props.bgOpacity,
    imageOpacity: props.bgImageOpacity,
    colorOpacity: props.bgColorOpacity,
  });
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const blockWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
      ? Math.max(260, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(220, Math.round(props.blockHeight))
      : undefined;

  const handleFieldChange = (key: keyof typeof draft, value: string) => {
    const nextValue =
      key === "customerName"
        ? normalizeMerchantBookingCustomerNameInput(value)
        : key === "note"
          ? normalizeMerchantBookingNoteInput(value)
          : value;
    setDraft((current) => ({ ...current, [key]: nextValue }));
  };

  const handleAvailableTimeRangeSelect = (value: string) => {
    if (!isLiveBooking) return;
    const nextTime = resolveMerchantBookingTimeRangeSelection(value);
    if (!nextTime) return;
    handleFieldChange("appointmentTimeInput", nextTime);
  };

  const submitBooking = async () => {
    if (!isLiveBooking) return;
    setSubmitting(true);
    setError("");
    try {
      if (appointmentDateIssue) {
        throw new Error(appointmentDateIssue);
      }
      if (appointmentWorkbenchIssue) {
        throw new Error(appointmentWorkbenchIssue);
      }
      const currentAppointmentTimeIssue = getMerchantBookingTimeAvailabilityIssue(draft.appointmentTimeInput, availableTimeRanges);
      if (currentAppointmentTimeIssue) {
        throw new Error(currentAppointmentTimeIssue);
      }
      const payload = sanitizeMerchantBookingEditableInput({
        ...draft,
        appointmentAt: joinMerchantBookingDateTime(draft.appointmentDateInput, draft.appointmentTimeInput),
      });
      const response = await fetch("/api/bookings", {
        method: submittedState ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          submittedState
            ? {
                bookingId: submittedState.booking.id,
                editToken: submittedState.editToken,
                action: "update",
                bookingBlockId: runtimeBlockId,
                bookingViewport: runtimeViewport,
                updates: payload,
              }
            : {
                siteId: runtimeSiteId,
                siteName: runtimeSiteName,
                bookingBlockId: runtimeBlockId,
                bookingViewport: runtimeViewport,
                ...payload,
              },
        ),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; booking?: MerchantBookingRecord; editToken?: string }
        | null;
      if (!response.ok || !json?.ok || !json.booking) {
        throw new Error(json?.message || "预约提交失败，请稍后重试");
      }
      const nextState: SubmittedBookingState = {
        booking: json.booking,
        editToken: submittedState?.editToken ?? String(json.editToken ?? ""),
      };
      if (!submittedState?.editToken && nextState.editToken) {
        persistEditToken(nextState.booking.id, nextState.editToken);
      }
      setSubmittedState(nextState);
      setDraft(buildInitialDraft(storeOptions, itemOptions, titleOptions, json.booking));
      setMode("success");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "预约提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBooking = async () => {
    if (!submittedState || !isLiveBooking) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: submittedState.booking.id,
          editToken: submittedState.editToken,
          action: "cancel",
          bookingBlockId: runtimeBlockId,
          bookingViewport: runtimeViewport,
        }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; booking?: MerchantBookingRecord }
        | null;
      if (!response.ok || !json?.ok || !json.booking) {
        throw new Error(json?.message || "预约取消失败，请稍后重试");
      }
      setSubmittedState((current) => (current ? { ...current, booking: json.booking as MerchantBookingRecord } : current));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "预约取消失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className={`mx-auto max-w-6xl rounded-2xl p-6 shadow-sm ${borderClass}`}
      style={{
        ...cardStyle,
        ...borderInlineStyle,
        width: blockWidth ? `${blockWidth}px` : undefined,
        minHeight: blockHeight ? `${blockHeight}px` : undefined,
      }}
    >
      <div
        className="text-2xl font-bold text-slate-900 whitespace-pre-wrap break-words"
        dangerouslySetInnerHTML={{ __html: headingHtml }}
      />
      <div
        className="mt-2 text-sm text-slate-600 whitespace-pre-wrap break-words"
        dangerouslySetInnerHTML={{ __html: textHtml }}
      />

      {!isLiveBooking ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-500">
          预览模式下仅展示预约表单样式，发布到商户前台后可真实提交预约。
        </div>
      ) : null}

      {mode === "success" && submittedState ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">
            {submittedState.booking.status === "cancelled" ? "预约已取消" : successTitle}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            {submittedState.booking.status === "cancelled" ? "您可以继续修改并重新提交预约。" : successText}
          </div>
          <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <div>{`预约编号：${submittedState.booking.id}`}</div>
            <div>{`${storeLabel}：${submittedState.booking.store}`}</div>
            <div>{`${itemLabel}：${submittedState.booking.item}`}</div>
            <div>{`预约时间：${formatMerchantBookingDateTime(submittedState.booking.appointmentAt)}`}</div>
            <div>{`称谓/姓名：${submittedState.booking.title} ${submittedState.booking.customerName}`}</div>
            <div>{`邮箱：${submittedState.booking.email}`}</div>
            <div>{`电话：${submittedState.booking.phone}`}</div>
            {submittedState.booking.note ? <div className="md:col-span-2">{`备注：${submittedState.booking.note}`}</div> : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => setMode("form")}
            >
              {updateLabel}
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void cancelBooking()}
              disabled={submitting || submittedState.booking.status === "cancelled"}
            >
              {submitting ? "处理中..." : cancelLabel}
            </button>
            <a
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              href={buildCustomerCalendarHref(submittedState.booking.id, submittedState.editToken)}
            >
              加入日历
            </a>
          </div>
        </div>
      ) : null}

      {mode === "form" ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitBooking();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-700">
              <span>{storeLabel}</span>
              <select
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.store}
                disabled={!isLiveBooking}
                onChange={(event) => handleFieldChange("store", event.target.value)}
              >
                {storeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>{itemLabel}</span>
              <select
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.item}
                disabled={!isLiveBooking}
                onChange={(event) => handleFieldChange("item", event.target.value)}
              >
                {itemOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>预约日期时间</span>
              <BookingDateTimeInput
                dateValue={draft.appointmentDateInput}
                timeValue={draft.appointmentTimeInput}
                disabled={!isLiveBooking}
                dateInputClassName={`${getFormFieldClass(!isLiveBooking)} min-w-[180px] flex-1 ${
                  appointmentDateIssue ? "border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20" : ""
                }`}
                timeInputClassName={`${getFormFieldClass(!isLiveBooking)} w-[112px] shrink-0 ${
                  appointmentTimeIssue ? "border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20" : ""
                }`}
                onDateChange={(value) => handleFieldChange("appointmentDateInput", value)}
                onTimeChange={(value) => handleFieldChange("appointmentTimeInput", value)}
              />
              {appointmentDateIssue ? (
                <div className="pt-1 text-sm text-rose-600">{appointmentDateIssue}</div>
              ) : null}
              {availableTimeRanges.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {availableTimeRanges.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        resolveMerchantBookingTimeRangeSelection(item) === draft.appointmentTimeInput
                          ? "border-sky-300 bg-sky-100 text-sky-800"
                          : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      } ${!isLiveBooking ? "cursor-not-allowed opacity-60" : ""}`}
                      onClick={() => handleAvailableTimeRangeSelect(item)}
                      disabled={!isLiveBooking}
                      aria-label={`选择时间 ${item}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
              {appointmentTimeIssue ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {appointmentTimeIssue}
                </div>
              ) : null}
              {appointmentWorkbenchIssue ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {appointmentWorkbenchIssue}
                </div>
              ) : null}
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>称谓</span>
              <select
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.title}
                disabled={!isLiveBooking}
                onChange={(event) => handleFieldChange("title", event.target.value)}
              >
                {titleOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>姓名</span>
              <input
                type="text"
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.customerName}
                disabled={!isLiveBooking}
                placeholder={namePlaceholder}
                onChange={(event) => handleFieldChange("customerName", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>邮箱</span>
              <input
                type="email"
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.email}
                disabled={!isLiveBooking}
                onChange={(event) => handleFieldChange("email", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm text-slate-700">
              <span>电话</span>
              <input
                type="tel"
                className={getFormFieldClass(!isLiveBooking)}
                value={draft.phone}
                disabled={!isLiveBooking}
                onChange={(event) => handleFieldChange("phone", event.target.value)}
              />
            </label>
          </div>
          <label className="space-y-1 text-sm text-slate-700">
            <span>备注或需求</span>
            <textarea
              className={`${getFormFieldClass(!isLiveBooking)} min-h-[120px]`}
              value={draft.note}
              disabled={!isLiveBooking}
              placeholder={notePlaceholder}
              onChange={(event) => handleFieldChange("note", event.target.value)}
            />
          </label>
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !isLiveBooking ||
                submitting ||
                Boolean(appointmentDateIssue) ||
                Boolean(appointmentTimeIssue) ||
                Boolean(appointmentWorkbenchIssue)
              }
            >
              {submitting ? "提交中..." : submittedState ? updateLabel : submitLabel}
            </button>
            {submittedState ? (
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setMode("success")}
              >
                返回预约结果
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
