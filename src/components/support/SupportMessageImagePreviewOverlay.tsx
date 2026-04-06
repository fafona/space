"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { normalizeSupportLinkHref } from "@/lib/supportMessageAttachments";

type ForwardAction = {
  label: string;
  onForward: () => Promise<void> | void;
};

type QueryForwardAction = {
  label: string;
  placeholder?: string;
  onForward: (query: string) => Promise<void> | void;
};

type SupportMessageImagePreviewOverlayProps = {
  open: boolean;
  imageUrl: string;
  linkUrl?: string;
  title?: string;
  onClose: () => void;
  onNotice?: (message: string) => void;
  currentForwardAction?: ForwardAction | null;
  queryForwardAction?: QueryForwardAction | null;
};

type BarcodeDetectorResultLike = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResultLike[]>;
};

type BarcodeDetectorConstructorLike = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type LoadedQrImageSource = ImageBitmap | HTMLImageElement;

type LoadedQrImage = {
  source: LoadedQrImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

type QrDecodeRegion = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

const LONG_PRESS_DELAY_MS = 420;

function sanitizeFileNamePart(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "").trim();
}

function buildDownloadFileName(imageUrl: string, title?: string) {
  const titleBase = sanitizeFileNamePart(String(title ?? ""));
  if (titleBase) return `${titleBase}.png`;
  try {
    const pathname = new URL(imageUrl).pathname.split("/").filter(Boolean);
    const lastSegment = sanitizeFileNamePart(pathname[pathname.length - 1] ?? "");
    if (lastSegment) return lastSegment;
  } catch {
    // Ignore URL parsing failures and fall back to a generic file name.
  }
  return `chat-image-${Date.now().toString(36)}.png`;
}

async function downloadImageToDevice(imageUrl: string, title?: string) {
  const response = await fetch(imageUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("保存失败，请稍后重试");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = buildDownloadFileName(imageUrl, title);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

async function loadImageElementFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.decoding = "async";
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("当前图片暂时无法识别二维码"));
      nextImage.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      cleanup: () => {
        URL.revokeObjectURL(objectUrl);
      },
    } satisfies LoadedQrImage;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadQrImageSource(blob: Blob): Promise<LoadedQrImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => {
        (bitmap as ImageBitmap & { close?: () => void }).close?.();
      },
    };
  }

  return loadImageElementFromBlob(blob);
}

async function detectQrWithBarcodeDetector(source: LoadedQrImageSource) {
  if (typeof window === "undefined") return "";
  const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
  if (typeof detectorCtor !== "function") return "";

  try {
    const detector = new detectorCtor({
      formats: ["qr_code"],
    });
    const results = await detector.detect(source);
    return String(results[0]?.rawValue ?? "").trim();
  } catch {
    return "";
  }
}

function buildQrDecodeRegions(width: number, height: number) {
  const regions: QrDecodeRegion[] = [];
  const seen = new Set<string>();

  const pushRegion = (sxRatio: number, syRatio: number, swRatio: number, shRatio: number) => {
    const sx = Math.max(0, Math.round(width * sxRatio));
    const sy = Math.max(0, Math.round(height * syRatio));
    const sw = Math.min(width - sx, Math.max(96, Math.round(width * swRatio)));
    const sh = Math.min(height - sy, Math.max(96, Math.round(height * shRatio)));
    if (sw < 96 || sh < 96) return;
    const key = `${sx}:${sy}:${sw}:${sh}`;
    if (seen.has(key)) return;
    seen.add(key);
    regions.push({ sx, sy, sw, sh });
  };

  pushRegion(0, 0, 1, 1);
  pushRegion(0.15, 0.15, 0.7, 0.7);
  pushRegion(0, 0, 0.72, 0.72);
  pushRegion(0.28, 0, 0.72, 0.72);
  pushRegion(0, 0.28, 0.72, 0.72);
  pushRegion(0.28, 0.28, 0.72, 0.72);
  pushRegion(0, 0, 0.5, 0.5);
  pushRegion(0.5, 0, 0.5, 0.5);
  pushRegion(0, 0.5, 0.5, 0.5);
  pushRegion(0.5, 0.5, 0.5, 0.5);
  pushRegion(0.45, 0.45, 0.55, 0.55);
  pushRegion(0.58, 0.58, 0.42, 0.42);

  return regions;
}

async function detectQrWithJsQr(source: LoadedQrImageSource, width: number, height: number) {
  if (typeof document === "undefined") return "";
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";

  const regions = buildQrDecodeRegions(width, height);
  for (const region of regions) {
    const longestEdge = Math.max(region.sw, region.sh);
    const targetLongestEdge = longestEdge >= 1200 ? longestEdge : Math.min(1800, longestEdge * 3);
    const scale = Math.max(1, targetLongestEdge / longestEdge);
    const targetWidth = Math.max(96, Math.round(region.sw * scale));
    const targetHeight = Math.max(96, Math.round(region.sh * scale));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, targetWidth, targetHeight);

    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const result = jsQR(imageData.data, targetWidth, targetHeight, {
      inversionAttempts: "attemptBoth",
    });
    const value = String(result?.data ?? "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

async function detectQrCodeValueFromImage(imageUrl: string, fallbackLinkUrl = "") {
  const normalizedFallbackLinkUrl = normalizeSupportLinkHref(fallbackLinkUrl);
  const response = await fetch(imageUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    if (normalizedFallbackLinkUrl) return normalizedFallbackLinkUrl;
    throw new Error("当前图片暂时无法识别二维码");
  }

  const blob = await response.blob();
  const loadedImage = await loadQrImageSource(blob);
  try {
    const barcodeDetectorValue = await detectQrWithBarcodeDetector(loadedImage.source);
    if (barcodeDetectorValue) return barcodeDetectorValue;

    const jsQrValue = await detectQrWithJsQr(loadedImage.source, loadedImage.width, loadedImage.height);
    if (jsQrValue) return jsQrValue;

    if (normalizedFallbackLinkUrl) return normalizedFallbackLinkUrl;
    throw new Error("这张图片里没有识别到二维码");
  } finally {
    loadedImage.cleanup();
  }
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("当前浏览器暂不支持复制");
  }
  await navigator.clipboard.writeText(value);
}

export default function SupportMessageImagePreviewOverlay({
  open,
  imageUrl,
  linkUrl = "",
  title = "聊天图片",
  onClose,
  onNotice,
  currentForwardAction,
  queryForwardAction,
}: SupportMessageImagePreviewOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrScanBusy, setQrScanBusy] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const longPressTimerRef = useRef<number | null>(null);

  const normalizedImageUrl = useMemo(() => normalizePublicAssetUrl(imageUrl), [imageUrl]);
  const normalizedLinkUrl = useMemo(() => normalizeSupportLinkHref(linkUrl), [linkUrl]);
  const hasActionSheet = Boolean(normalizedImageUrl);
  const canScanQrCode = Boolean(normalizedImageUrl);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setActionSheetOpen(false);
      setQueryDialogOpen(false);
      setQueryValue("");
      setBusy(false);
      setQrScanBusy(false);
      setQrValue("");
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, [open, normalizedImageUrl]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (queryDialogOpen) {
        setQueryDialogOpen(false);
        return;
      }
      if (actionSheetOpen) {
        setActionSheetOpen(false);
        return;
      }
      if (qrValue) {
        setQrValue("");
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionSheetOpen, onClose, open, qrValue, queryDialogOpen]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openActionSheet() {
    if (!hasActionSheet || busy || qrScanBusy) return;
    setActionSheetOpen(true);
  }

  function handleImageTouchStart() {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      openActionSheet();
    }, LONG_PRESS_DELAY_MS);
  }

  function handleImageTouchEnd() {
    clearLongPressTimer();
  }

  async function handleSaveImage() {
    setBusy(true);
    try {
      await downloadImageToDevice(normalizedImageUrl, title);
      onNotice?.("图片已开始下载");
      setActionSheetOpen(false);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleForwardCurrent() {
    if (!currentForwardAction) return;
    setBusy(true);
    try {
      await currentForwardAction.onForward();
      setActionSheetOpen(false);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "转发失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleForwardQuerySubmit() {
    const query = queryValue.trim();
    if (!query || !queryForwardAction) {
      onNotice?.("请输入完整的商户ID或邮箱");
      return;
    }

    setBusy(true);
    try {
      await queryForwardAction.onForward(query);
      setQueryDialogOpen(false);
      setActionSheetOpen(false);
      setQueryValue("");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "转发失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleScanQrCode() {
    if (!canScanQrCode) {
      onNotice?.("当前图片暂时无法识别二维码");
      return;
    }

    setQrScanBusy(true);
    try {
      const value = await detectQrCodeValueFromImage(normalizedImageUrl, normalizedLinkUrl);
      setQrValue(value);
      setActionSheetOpen(false);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "二维码识别失败，请稍后重试");
    } finally {
      setQrScanBusy(false);
    }
  }

  async function handleCopyQrValue() {
    try {
      await copyTextToClipboard(qrValue);
      onNotice?.("二维码内容已复制");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "复制失败，请稍后重试");
    }
  }

  function handleOpenQrValue() {
    const href = normalizeSupportLinkHref(qrValue);
    if (!href || typeof window === "undefined") return;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  if (!mounted || !open || !normalizedImageUrl || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[2147483490] bg-slate-950/92 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭图片预览"
      />

      <div className="fixed inset-0 z-[2147483491] flex min-h-0 flex-col">
        <div className="flex items-center justify-between px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white">
          <div className="min-w-0 truncate text-sm font-medium">{title}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur"
              onClick={openActionSheet}
            >
              更多
            </button>
            <button
              type="button"
              className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-5xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={normalizedImageUrl}
                alt={title}
                className="mx-auto max-h-[calc(100svh-10rem)] w-auto max-w-full rounded-[28px] bg-white object-contain shadow-[0_24px_80px_rgba(15,23,42,0.35)]"
                onTouchStart={handleImageTouchStart}
                onTouchEnd={handleImageTouchEnd}
                onTouchCancel={handleImageTouchEnd}
                onTouchMove={handleImageTouchEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openActionSheet();
                }}
              />
            </div>
          </div>
        </div>

        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] text-center text-xs text-white/70">
          长按图片可保存、转发或识别二维码
          {normalizedLinkUrl ? (
            <div className="mt-2 break-all text-[11px] text-white/60">{normalizedLinkUrl}</div>
          ) : null}
        </div>
      </div>

      {actionSheetOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483492] bg-slate-950/40"
            onClick={() => setActionSheetOpen(false)}
            aria-label="关闭图片操作菜单"
          />
          <div className="fixed inset-x-0 bottom-0 z-[2147483493] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div className="mx-auto w-full max-w-md rounded-[30px] bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
              <div className="px-3 pb-2 pt-1 text-sm font-semibold text-slate-900">图片操作</div>
              <div className="space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => {
                    void handleSaveImage();
                  }}
                  disabled={busy || qrScanBusy}
                >
                  <span>保存到相册</span>
                  <span className="text-xs text-slate-400">下载图片</span>
                </button>
                {currentForwardAction ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => {
                      void handleForwardCurrent();
                    }}
                    disabled={busy || qrScanBusy}
                  >
                    <span>{currentForwardAction.label}</span>
                    <span className="text-xs text-slate-400">直接转发</span>
                  </button>
                ) : null}
                {queryForwardAction ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => setQueryDialogOpen(true)}
                    disabled={busy || qrScanBusy}
                  >
                    <span>{queryForwardAction.label}</span>
                    <span className="text-xs text-slate-400">按 ID 或邮箱</span>
                  </button>
                ) : null}
                {canScanQrCode ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => {
                      void handleScanQrCode();
                    }}
                    disabled={busy || qrScanBusy}
                  >
                    <span>扫描二维码</span>
                    <span className="text-xs text-slate-400">{qrScanBusy ? "识别中..." : "识别图片里的码"}</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {queryDialogOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483494] bg-slate-950/40"
            onClick={() => setQueryDialogOpen(false)}
            aria-label="关闭转发输入框"
          />
          <div className="fixed inset-x-0 bottom-0 z-[2147483495] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div className="mx-auto w-full max-w-md rounded-[30px] bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
              <div className="text-sm font-semibold text-slate-900">转发给指定商户</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">请输入完整 8 位商户 ID 或完整邮箱。</div>
              <input
                type="text"
                className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                placeholder={queryForwardAction?.placeholder ?? "例如：10000000 或 owner@example.com"}
                value={queryValue}
                onChange={(event) => setQueryValue(event.target.value)}
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => setQueryDialogOpen(false)}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={() => {
                    void handleForwardQuerySubmit();
                  }}
                  disabled={busy}
                >
                  {busy ? "转发中..." : "确认转发"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {qrValue ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483496] bg-slate-950/40"
            onClick={() => setQrValue("")}
            aria-label="关闭二维码结果"
          />
          <div className="fixed inset-x-0 bottom-0 z-[2147483497] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <div className="mx-auto w-full max-w-md rounded-[30px] bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
              <div className="text-sm font-semibold text-slate-900">二维码识别结果</div>
              <div className="mt-3 max-h-40 overflow-auto rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                {qrValue}
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    void handleCopyQrValue();
                  }}
                >
                  复制内容
                </button>
                {normalizeSupportLinkHref(qrValue) ? (
                  <button
                    type="button"
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                    onClick={handleOpenQrValue}
                  >
                    打开链接
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>,
    document.body,
  );
}
