"use client";

import { useRef, type ReactNode } from "react";

type BookingDateTimeInputProps = {
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  disabled?: boolean;
  dateInputClassName?: string;
  timeInputClassName?: string;
  containerClassName?: string;
};

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function padSegment(value: number) {
  return String(value).padStart(2, "0");
}

function getMonthMaxDay(yearText: string, monthText: string) {
  const year = Number(yearText);
  const month = clampNumber(Number(monthText), 1, 12);
  if (!Number.isFinite(year) || String(yearText).length !== 4) {
    return month === 2 ? 29 : new Date(2000, month, 0).getDate();
  }
  return new Date(year, month, 0).getDate();
}

export function normalizeDateText(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  const year = digits.slice(0, 4);
  const monthDigits = digits.slice(4, 6);
  const normalizedMonth =
    monthDigits.length === 2 ? padSegment(clampNumber(Number(monthDigits), 1, 12)) : monthDigits;
  if (digits.length <= 6) return `${year}-${normalizedMonth}`;
  const dayDigits = digits.slice(6, 8);
  const normalizedDay =
    dayDigits.length === 2
      ? padSegment(clampNumber(Number(dayDigits), 1, getMonthMaxDay(year, normalizedMonth || monthDigits || "1")))
      : dayDigits;
  return `${year}-${normalizedMonth}-${normalizedDay}`;
}

export function normalizeTimeText(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  const hourDigits = digits.slice(0, 2);
  const minuteDigits = digits.slice(2, 4);
  const normalizedHour = hourDigits.length === 2 ? padSegment(clampNumber(Number(hourDigits), 0, 23)) : hourDigits;
  const normalizedMinute =
    minuteDigits.length === 2 ? padSegment(clampNumber(Number(minuteDigits), 0, 59)) : minuteDigits;
  return `${normalizedHour}:${normalizedMinute}`;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 2.75v2.5M14 2.75v2.5M3.75 7.25h12.5M5.5 4.5h9a1.75 1.75 0 0 1 1.75 1.75v8.25A1.75 1.75 0 0 1 14.5 16.25h-9A1.75 1.75 0 0 1 3.75 14.5V6.25A1.75 1.75 0 0 1 5.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PickerButton({
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="absolute inset-y-0 right-2 inline-flex items-center justify-center rounded-md px-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export default function BookingDateTimeInput({
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  disabled = false,
  dateInputClassName = "",
  timeInputClassName = "",
  containerClassName = "",
}: BookingDateTimeInputProps) {
  const dateTextInputRef = useRef<HTMLInputElement>(null);
  const timeTextInputRef = useRef<HTMLInputElement>(null);
  const dateNativeInputRef = useRef<HTMLInputElement>(null);
  const timeNativeInputRef = useRef<HTMLInputElement>(null);

  const openNativePicker = (input: HTMLInputElement | null, fallback: HTMLInputElement | null) => {
    if (!input || disabled) return;
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    try {
      pickerInput.focus({ preventScroll: true });
    } catch {
      pickerInput.focus();
    }
    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fallback to click/focus below when the browser blocks showPicker.
      }
    }
    try {
      pickerInput.click();
      return;
    } catch {
      // Fallback to the visible text field when native picker click is unavailable.
    }
    fallback?.focus();
  };

  return (
    <div className={`flex flex-wrap gap-2 ${containerClassName}`.trim()}>
      <div className="relative min-w-[180px] flex-1">
        <input
          ref={dateTextInputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          maxLength={10}
          className={`w-full ${dateInputClassName} pr-12`}
          value={dateValue}
          disabled={disabled}
          onChange={(event) => onDateChange(normalizeDateText(event.target.value))}
        />
        <PickerButton
          ariaLabel="选择日期"
          disabled={disabled}
          onClick={() => openNativePicker(dateNativeInputRef.current, dateTextInputRef.current)}
        >
          <CalendarIcon />
        </PickerButton>
        <input
          ref={dateNativeInputRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          value={/^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : ""}
          disabled={disabled}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </div>
      <div className="relative shrink-0">
        <input
          ref={timeTextInputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM"
          maxLength={5}
          className={`w-full ${timeInputClassName} pr-12`}
          value={timeValue}
          disabled={disabled}
          onChange={(event) => onTimeChange(normalizeTimeText(event.target.value))}
        />
        <PickerButton
          ariaLabel="选择时间"
          disabled={disabled}
          onClick={() => openNativePicker(timeNativeInputRef.current, timeTextInputRef.current)}
        >
          <ClockIcon />
        </PickerButton>
        <input
          ref={timeNativeInputRef}
          type="time"
          step={60}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          value={/^\d{2}:\d{2}$/.test(timeValue) ? timeValue : ""}
          disabled={disabled}
          onChange={(event) => onTimeChange(event.target.value)}
        />
      </div>
    </div>
  );
}
