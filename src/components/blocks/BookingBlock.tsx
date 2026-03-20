"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingProps } from "@/data/homeBlocks";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  createEmptyMerchantBookingInput,
  formatMerchantBookingDateTime,
  joinMerchantBookingDateTime,
  normalizeBookingOptionList,
  sanitizeMerchantBookingEditableInput,
  splitMerchantBookingDateTime,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type BookingBlockComponentProps = BookingProps & {
  runtimeSiteId?: string;
  runtimeSiteName?: string;
  interactive?: boolean;
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
  previous?: Partial<ReturnType<typeof createEmptyMerchantBookingInput>>,
) {
  const base = sanitizeMerchantBookingEditableInput(previous, createEmptyMerchantBookingInput());
  return {
    ...base,
    store: base.store || storeOptions[0] || "",
    item: base.item || itemOptions[0] || "",
    title: base.title || titleOptions[0] || "",
  };
}

function getFormFieldClass(disabled: boolean) {
  return `w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
    disabled ? "cursor-not-allowed bg-slate-100 text-slate-400" : ""
  }`;
}

const DATE_TIME_INPUT_STYLE = {
  fontFamily:
    '"PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif',
};

export default function BookingBlock({
  runtimeSiteId = "",
  runtimeSiteName = "",
  interactive = true,
  ...props
}: BookingBlockComponentProps) {
  const storeOptions = useMemo(
    () => normalizeBookingOptionList(props.bookingStoreOptions, buildDefaultBookingStoreOptions(runtimeSiteName)),
    [props.bookingStoreOptions, runtimeSiteName],
  );
  const itemOptions = useMemo(
    () => normalizeBookingOptionList(props.bookingItemOptions, buildDefaultBookingItemOptions()),
    [props.bookingItemOptions],
  );
  const titleOptions = useMemo(
    () => normalizeBookingOptionList(props.bookingTitleOptions, buildDefaultBookingTitleOptions()),
    [props.bookingTitleOptions],
  );
  const [draft, setDraft] = useState(() => buildInitialDraft(storeOptions, itemOptions, titleOptions));
  const [submittedState, setSubmittedState] = useState<SubmittedBookingState | null>(null);
  const [mode, setMode] = useState<"form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isLiveBooking = interactive && isMerchantNumericId(runtimeSiteId);
  const appointmentParts = useMemo(
    () => splitMerchantBookingDateTime(draft.appointmentAt),
    [draft.appointmentAt],
  );

  useEffect(() => {
    setDraft((current) => buildInitialDraft(storeOptions, itemOptions, titleOptions, current));
  }, [storeOptions, itemOptions, titleOptions]);

  const headingHtml = toRichHtml(props.heading, "在线预约");
  const textHtml = toRichHtml(props.text, "客户可选择店铺、项目、日期时间并填写预约信息。");
  const submitLabel = (props.bookingSubmitLabel ?? "").trim() || "提交预约";
  const updateLabel = (props.bookingUpdateLabel ?? "").trim() || "修改预约";
  const cancelLabel = (props.bookingCancelLabel ?? "").trim() || "取消预约";
  const successTitle = (props.bookingSuccessTitle ?? "").trim() || "预约提交成功";
  const successText = (props.bookingSuccessText ?? "").trim() || "我们已收到您的预约，可在此继续修改或取消。";
  const namePlaceholder = (props.bookingNamePlaceholder ?? "").trim() || "请输入称谓或姓名";
  const notePlaceholder = (props.bookingNotePlaceholder ?? "").trim() || "可填写备注或需求";
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
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submitBooking = async () => {
    if (!isLiveBooking) return;
    setSubmitting(true);
    setError("");
    try {
      const payload = sanitizeMerchantBookingEditableInput(draft);
      const response = await fetch("/api/bookings", {
        method: submittedState ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          submittedState
            ? {
                bookingId: submittedState.booking.id,
                editToken: submittedState.editToken,
                action: "update",
                updates: payload,
              }
            : {
                siteId: runtimeSiteId,
                siteName: runtimeSiteName,
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
            <div>{`预约店铺：${submittedState.booking.store}`}</div>
            <div>{`预约项目：${submittedState.booking.item}`}</div>
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
              <span>预约店铺</span>
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
              <span>项目或类型</span>
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
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${getFormFieldClass(!isLiveBooking)} min-w-[180px] flex-1`}
                  value={appointmentParts.date}
                  lang="zh-CN"
                  style={DATE_TIME_INPUT_STYLE}
                  placeholder="YYYY-MM-DD"
                  disabled={!isLiveBooking}
                  onChange={(event) =>
                    handleFieldChange(
                      "appointmentAt",
                      joinMerchantBookingDateTime(event.target.value, appointmentParts.time),
                    )
                  }
                />
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${getFormFieldClass(!isLiveBooking)} w-[112px] shrink-0`}
                  value={appointmentParts.time}
                  lang="zh-CN"
                  style={DATE_TIME_INPUT_STYLE}
                  placeholder="09:44"
                  disabled={!isLiveBooking}
                  onChange={(event) =>
                    handleFieldChange(
                      "appointmentAt",
                      joinMerchantBookingDateTime(appointmentParts.date, event.target.value),
                    )
                  }
                />
              </div>
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
              disabled={!isLiveBooking || submitting}
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
