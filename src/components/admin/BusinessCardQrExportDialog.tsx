"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BusinessCardQrControls } from "./BusinessCardQrControls";
import { useBusinessCardQrPreview } from "./useBusinessCardQrPreview";
import { businessCardQrAspectRatio, isBusinessCardQrColorReadable } from "@/lib/merchantBusinessCardQr";
import { copyBusinessCardQrAppearance, type BusinessCardQrExportSession } from "@/lib/merchantBusinessCardQrExport";

// No save callback: edits exist only for the lifetime of this dialog.
export function BusinessCardQrExportDialog({ session, onClose }: {
  session: BusinessCardQrExportSession;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [appearance, setAppearance] = useState(() => copyBusinessCardQrAppearance(session.appearance));
  const [error, setError] = useState("");
  const contrastError = isBusinessCardQrColorReadable(appearance.color || "#000000", appearance.backgroundColor)
    ? "" : "二维码与背景对比度不足，请调整颜色后预览和导出。";
  const previewKey = JSON.stringify([session.targetUrl, appearance]);
  const { display, currentUrl } = useBusinessCardQrPreview(previewKey, !session.disabledReason, session.cardId, setError);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483200] bg-slate-950/50 p-2 sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        className="mx-auto flex h-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key !== "Tab") return;
          // Keep keyboard traversal inside the dialog. Portalled color editors
          // retain their own input focus instead of being made inert by <dialog>.
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          )).filter(element => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-950">二维码样式与导出</h2>
            <p className="mt-1 truncate text-sm text-slate-600">{session.cardName}</p>
            <p id={descriptionId} className="mt-1 text-xs leading-5 text-blue-800">仅用于本次预览和导出，不修改名片内的二维码。关闭后不保存调整。</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">关闭</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
            <div className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:overflow-y-auto">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-medium text-slate-600">扫码去向 · {session.destinationLabel}（沿用这张名片）</div>
                <p className="mt-1 break-all text-sm text-slate-800">{session.targetUrl || "暂无可用地址"}</p>
              </div>
              <BusinessCardQrControls {...appearance} targetUrl={session.targetUrl} exportDisabledReason={session.disabledReason}
                onChange={patch => { setError(""); setAppearance(current => ({ ...current, ...patch })); }} />
            </div>
            <aside className="order-first shrink-0 border-b border-slate-200 bg-slate-50 p-4 sm:p-6 lg:order-last lg:w-[38%] lg:overflow-y-auto lg:border-b-0 lg:border-l">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">导出预览</h3>
                <button type="button" onClick={() => { setError(""); setAppearance(copyBusinessCardQrAppearance(session.appearance)); }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100">恢复名片样式</button>
              </div>
              <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-200/60 p-5 lg:min-h-[360px]">
                {display ? (
                  // A decoded previous preview stays visible during updates.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={display.url} alt="独立导出二维码预览" width={360} height={Math.round(360 * businessCardQrAspectRatio(display.appearance))}
                    className="block h-auto max-h-[48vh] w-auto max-w-full object-contain drop-shadow-lg" />
                ) : <p className="text-center text-sm text-slate-500">{session.disabledReason || contrastError || error || "正在生成二维码预览…"}</p>}
              </div>
              <p role="status" className="mt-3 min-h-5 text-xs leading-5 text-slate-600">{error || (currentUrl ? "预览已更新 · 支持高清 PNG / SVG 导出" : display ? "正在更新预览…" : "")}</p>
            </aside>
          </div>
        </div>
      </section>
    </div>, document.body,
  );
}
