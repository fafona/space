"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BookingTokenState = {
  bookingId: string;
  editToken: string;
  download: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBookingCalendarState() {
  if (typeof window === "undefined") {
    return { bookingId: "", editToken: "", download: false };
  }
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const source = hashParams.get("bookingId") || hashParams.get("editToken") ? hashParams : url.searchParams;
  return {
    bookingId: trimText(source.get("bookingId")),
    editToken: trimText(source.get("editToken")),
    download: source.get("download") === "1",
  };
}

function scrubSensitiveUrlParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  ["bookingId", "editToken", "download"].forEach((key) => {
    url.searchParams.delete(key);
  });
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export default function BookingCalendarPage() {
  const initialState = useMemo<BookingTokenState>(() => readBookingCalendarState(), []);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [message, setMessage] = useState("正在准备日历文件...");

  const downloadCalendar = useCallback(async () => {
    if (!initialState.bookingId || !initialState.editToken) {
      setStatus("error");
      setMessage("预约日历链接已失效，请重新获取。");
      scrubSensitiveUrlParams();
      return;
    }

    setStatus("loading");
    setMessage("正在准备日历文件...");
    try {
      const response = await fetch("/api/bookings/customer-calendar", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          accept: "text/calendar,application/json",
        },
        body: JSON.stringify({
          bookingId: initialState.bookingId,
          editToken: initialState.editToken,
          download: initialState.download !== false,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
        throw new Error(
          trimText(payload?.message) || trimText(payload?.error) || "预约日历文件生成失败，请稍后重试。",
        );
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `booking-${initialState.bookingId}.ics`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
      scrubSensitiveUrlParams();
      setStatus("done");
      setMessage("日历文件已开始下载。");
    } catch (error) {
      scrubSensitiveUrlParams();
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "预约日历文件生成失败，请稍后重试。");
    }
  }, [initialState.bookingId, initialState.download, initialState.editToken]);

  useEffect(() => {
    void downloadCalendar();
  }, [downloadCalendar]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold">预约日历</div>
        <div className="mt-3 text-sm text-slate-600">{message}</div>
        {status !== "loading" ? (
          <button
            type="button"
            className="mt-5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              void downloadCalendar();
            }}
          >
            重新下载
          </button>
        ) : null}
      </div>
    </main>
  );
}
