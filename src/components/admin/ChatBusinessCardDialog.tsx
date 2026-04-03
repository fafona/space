"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import jsQR from "jsqr";
import {
  buildMerchantBusinessCardShareUrl,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";
import { type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";

type ChatBusinessCardDialogProps = {
  open: boolean;
  merchantName: string;
  subtitle?: string;
  card: MerchantBusinessCardAsset | null;
  onClose: () => void;
};

type CardActionKind = "share" | "save" | "scan" | null;

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorConstructorLike = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_THRESHOLD_PX = 12;
const QR_SCAN_MAX_SIDE_PX = 1600;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCardShareContact(card: MerchantBusinessCardAsset): MerchantBusinessCardShareContact {
  return {
    displayName: normalizeText(card.contacts.contactName) || normalizeText(card.name),
    organization: normalizeText(card.name),
    title: normalizeText(card.title),
    phone: normalizeText(card.contacts.phone),
    phones: Array.isArray(card.contacts.phones) ? card.contacts.phones.filter(Boolean) : [],
    contactFieldOrder: card.contactFieldOrder,
    contactOnlyFields: card.contactOnlyFields,
    email: normalizeText(card.contacts.email),
    address: normalizeText(card.contacts.address),
    wechat: normalizeText(card.contacts.wechat),
    whatsapp: normalizeText(card.contacts.whatsapp),
    twitter: normalizeText(card.contacts.twitter),
    weibo: normalizeText(card.contacts.weibo),
    telegram: normalizeText(card.contacts.telegram),
    linkedin: normalizeText(card.contacts.linkedin),
    discord: normalizeText(card.contacts.discord),
    facebook: normalizeText(card.contacts.facebook),
    instagram: normalizeText(card.contacts.instagram),
    tiktok: normalizeText(card.contacts.tiktok),
    douyin: normalizeText(card.contacts.douyin),
    xiaohongshu: normalizeText(card.contacts.xiaohongshu),
    websiteUrl: normalizeText(card.targetUrl),
  };
}

function buildChatCardLink(card: MerchantBusinessCardAsset | null) {
  if (!card || card.mode !== "link") return "";
  const targetUrl = normalizeText(card.targetUrl);
  if (!targetUrl) return "";
  return buildMerchantBusinessCardShareUrl({
    origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
    shareKey: normalizeText(card.shareKey),
    name: normalizeText(card.name),
    imageUrl: normalizeText(card.shareImageUrl) || normalizeText(card.imageUrl),
    detailImageUrl: normalizeText(card.contactPagePublicImageUrl) || normalizeText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    targetUrl,
    contact: buildCardShareContact(card),
  });
}

function buildCardFileName(card: MerchantBusinessCardAsset) {
  const rawContactName = normalizeText(card.contacts.contactName) || normalizeText(card.name) || "business card";
  const normalizedContactName = rawContactName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const safeBaseName = normalizedContactName.replace(/[\\/:*?"<>|]+/g, "").trim() || "business card";
  return `${safeBaseName}'s card.png`;
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("clipboard_unavailable");
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-99999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("clipboard_unavailable");
  }
}

function buildCardActionTitle(card: MerchantBusinessCardAsset | null, merchantName: string) {
  return normalizeText(card?.name) || normalizeText(merchantName) || "名片";
}

function isLikelyUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function getBarcodeDetectorConstructor() {
  const detector = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructorLike }).BarcodeDetector;
  return typeof detector === "function" ? detector : null;
}

async function fetchCardImageBlob(imageUrl: string) {
  const response = await fetch(imageUrl, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("card_image_load_failed");
  }
  return response.blob();
}

async function loadImageElementFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("card_image_decode_failed"));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawImageToScanCanvas(image: HTMLImageElement) {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const scale = Math.min(1, QR_SCAN_MAX_SIDE_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("card_scan_unavailable");
  }
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, width, height };
}

async function decodeCardQrCode(imageUrl: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("card_scan_unavailable");
  }
  const blob = await fetchCardImageBlob(imageUrl);
  const image = await loadImageElementFromBlob(blob);
  const detector = getBarcodeDetectorConstructor();
  if (detector) {
    try {
      const instance = new detector({ formats: ["qr_code"] });
      const results = await instance.detect(image);
      const matched = normalizeText(results.find((item) => normalizeText(item.rawValue))?.rawValue);
      if (matched) return matched;
    } catch {
      // Fall through to jsQR for browsers with partial or unstable support.
    }
  }

  const { context, width, height } = drawImageToScanCanvas(image);
  const imageData = context.getImageData(0, 0, width, height);
  const matched = jsQR(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
  const rawValue = normalizeText(matched?.data);
  if (!rawValue) {
    throw new Error("card_qr_not_found");
  }
  return rawValue;
}

export default function ChatBusinessCardDialog({
  open,
  merchantName,
  subtitle = "",
  card,
  onClose,
}: ChatBusinessCardDialogProps) {
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<CardActionKind>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [qrResult, setQrResult] = useState("");
  const [qrResultOpen, setQrResultOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);

  const shareUrl = useMemo(() => buildChatCardLink(card), [card]);
  const cardActionTitle = useMemo(() => buildCardActionTitle(card, merchantName), [card, merchantName]);

  useEffect(() => {
    if (open) return;
    setImageViewerOpen(false);
    setActionSheetOpen(false);
    setActionBusy(null);
    setActionNotice("");
    setQrResult("");
    setQrResultOpen(false);
  }, [open]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  if (!open || typeof document === "undefined") return null;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const openActionSheet = () => {
    setActionNotice("");
    setActionSheetOpen(true);
  };

  const beginLongPress = (x: number, y: number) => {
    if (!card?.imageUrl) return;
    clearLongPressTimer();
    touchOriginRef.current = { x, y };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      suppressNextClickRef.current = true;
      openActionSheet();
    }, LONG_PRESS_DELAY_MS);
  };

  const cancelLongPressIfMoved = (x: number, y: number) => {
    const origin = touchOriginRef.current;
    if (!origin) return;
    if (Math.abs(origin.x - x) > LONG_PRESS_MOVE_THRESHOLD_PX || Math.abs(origin.y - y) > LONG_PRESS_MOVE_THRESHOLD_PX) {
      clearLongPressTimer();
    }
  };

  const endLongPress = () => {
    clearLongPressTimer();
    touchOriginRef.current = null;
  };

  const handleImageTouchStart = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    beginLongPress(touch.clientX, touch.clientY);
  };

  const handleImageTouchMove = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    cancelLongPressIfMoved(touch.clientX, touch.clientY);
  };

  const handleImageTouchEnd = () => {
    if (longPressTriggeredRef.current) {
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 350);
    }
    longPressTriggeredRef.current = false;
    endLongPress();
  };

  const handleImageTouchCancel = () => {
    endLongPress();
  };

  const handleImageClick = () => {
    if (!card?.imageUrl) return;
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setActionNotice("");
    setImageViewerOpen(true);
  };

  const handleImageContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!card?.imageUrl) return;
    event.preventDefault();
    openActionSheet();
  };

  const handleShareCard = async () => {
    if (!card || typeof navigator === "undefined") return;
    const systemNavigator = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    if (typeof systemNavigator.share !== "function") {
      setActionNotice("当前设备暂不支持系统分享。");
      return;
    }

    setActionBusy("share");
    setActionNotice("");
    try {
      const imageBlob = await fetchCardImageBlob(card.imageUrl);
      const imageFile = new File([imageBlob], buildCardFileName(card), {
        type: imageBlob.type || "image/png",
      });
      const preferredData: ShareData = {
        title: cardActionTitle,
        text: `${cardActionTitle} 名片`,
        files: [imageFile],
      };
      if (!systemNavigator.canShare || systemNavigator.canShare(preferredData)) {
        await systemNavigator.share(preferredData);
      } else {
        const fallbackUrl = shareUrl || normalizeText(card.targetUrl) || normalizeText(card.imageUrl);
        if (!fallbackUrl) {
          throw new Error("card_share_unavailable");
        }
        await systemNavigator.share({
          title: cardActionTitle,
          text: `${cardActionTitle} 名片`,
          url: fallbackUrl,
        });
      }
      setActionSheetOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setActionNotice("分享失败，请稍后重试。");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSaveCard = async () => {
    if (!card || typeof document === "undefined") return;
    setActionBusy("save");
    setActionNotice("");
    try {
      const imageBlob = await fetchCardImageBlob(card.imageUrl);
      const imageFile = new File([imageBlob], buildCardFileName(card), {
        type: imageBlob.type || "image/png",
      });
      const systemNavigator = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      const shareData: ShareData = {
        title: cardActionTitle,
        files: [imageFile],
      };
      if (typeof systemNavigator.share === "function" && (!systemNavigator.canShare || systemNavigator.canShare(shareData))) {
        await systemNavigator.share(shareData);
        setActionNotice("已打开系统保存面板，请选择“保存到照片”。");
      } else {
        const objectUrl = URL.createObjectURL(imageBlob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = buildCardFileName(card);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        setActionNotice("当前设备不支持直接调起保存面板，已改为浏览器保存。");
      }
      setActionSheetOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setActionNotice("保存失败，请稍后重试。");
    } finally {
      setActionBusy(null);
    }
  };

  const handleScanCardQr = async () => {
    if (!card?.imageUrl) return;
    setActionBusy("scan");
    setActionNotice("");
    try {
      const decodedValue = await decodeCardQrCode(card.imageUrl);
      setQrResult(decodedValue);
      setQrResultOpen(true);
      setActionSheetOpen(false);
    } catch (error) {
      if (error instanceof Error && error.message === "card_qr_not_found") {
        setActionNotice("这张名片图片里没有识别到二维码。");
      } else {
        setActionNotice("暂时无法识别图片中的二维码，请稍后重试。");
      }
    } finally {
      setActionBusy(null);
    }
  };

  const handleCopyQrResult = async () => {
    if (!qrResult) return;
    try {
      await copyTextToClipboard(qrResult);
      setActionNotice("二维码内容已复制。");
      setQrResultOpen(false);
    } catch {
      setActionNotice("复制失败，请稍后重试。");
    }
  };

  const handleOpenQrResult = () => {
    if (!qrResult || typeof window === "undefined") return;
    if (isLikelyUrl(qrResult)) {
      const opened = window.open(qrResult, "_blank", "noopener,noreferrer");
      if (!opened) {
        setActionNotice("浏览器拦截了新窗口，请允许弹窗后重试。");
        return;
      }
      setQrResultOpen(false);
      return;
    }
    void handleCopyQrResult();
  };

  const renderCardImage = (mode: "inline" | "viewer") => {
    if (!card?.imageUrl) return null;
    return (
      <button
        type="button"
        className={mode === "viewer" ? "block w-full touch-manipulation" : "block w-full touch-manipulation rounded-2xl"}
        onClick={mode === "viewer" ? undefined : handleImageClick}
        onTouchStart={handleImageTouchStart}
        onTouchMove={handleImageTouchMove}
        onTouchEnd={handleImageTouchEnd}
        onTouchCancel={handleImageTouchCancel}
        onContextMenu={handleImageContextMenu}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.imageUrl}
          alt={card.name}
          className={
            mode === "viewer"
              ? "mx-auto block h-auto max-h-[82vh] w-auto max-w-full rounded-[24px] bg-white object-contain shadow-2xl"
              : "mx-auto block h-auto max-h-[60vh] w-auto max-w-full bg-transparent object-contain"
          }
        />
      </button>
    );
  };

  return createPortal(
    <>
      {!imageViewerOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483400] bg-black/50"
            onClick={onClose}
            aria-label="关闭名片弹窗"
          />
          <div className="fixed inset-0 z-[2147483401] flex items-center justify-center p-4">
            <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-900">{merchantName || "名片"}</div>
                  {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto px-5 py-5">
                {card ? (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border bg-slate-50 p-4">
                      {renderCardImage("inline")}
                      <div className="mt-3 text-center text-[11px] leading-5 text-slate-500">
                        单击看大图，长按图片可分享、保存或识别二维码。
                      </div>
                    </div>
                    <div className="rounded-2xl border bg-slate-50 px-4 py-3">
                      <div className="text-sm font-medium text-slate-900">{card.name}</div>
                      {shareUrl ? (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-medium text-slate-600">名片链接</div>
                          <a
                            href={shareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all text-sm text-blue-600 underline underline-offset-4"
                          >
                            {shareUrl}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                    这个商户当前没有设置用于聊天展示的名片。
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {imageViewerOpen && card ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483402] bg-slate-950"
            onClick={() => setImageViewerOpen(false)}
            aria-label="关闭大图预览"
          />
          <div className="fixed inset-0 z-[2147483403] flex items-center justify-center p-3">
            <div className="w-full max-w-5xl">
              <div className="mb-3 flex items-center justify-between gap-3 text-white">
                <div className="min-w-0 truncate text-sm font-medium">{cardActionTitle}</div>
                <button
                  type="button"
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs text-white backdrop-blur"
                  onClick={() => setImageViewerOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="rounded-[28px] bg-white p-2 shadow-2xl">
                {renderCardImage("viewer")}
              </div>
              <div className="mt-3 text-center text-xs text-white/70">长按图片可分享、保存到照片或识别二维码。</div>
            </div>
          </div>
        </>
      ) : null}

      {actionSheetOpen && card ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483404] bg-black/45"
            onClick={() => setActionSheetOpen(false)}
            aria-label="关闭名片图片操作菜单"
          />
          <div className="fixed inset-x-0 bottom-0 z-[2147483405] p-3">
            <div className="mx-auto w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
              <div className="border-b px-5 py-4 text-center">
                <div className="text-sm font-semibold text-slate-900">{cardActionTitle}</div>
                <div className="mt-1 text-xs text-slate-500">长按图片操作</div>
              </div>
              <div className="p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void handleShareCard()}
                  disabled={actionBusy !== null}
                >
                  {actionBusy === "share" ? "正在打开分享..." : "分享给其他应用"}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void handleSaveCard()}
                  disabled={actionBusy !== null}
                >
                  {actionBusy === "save" ? "正在保存..." : "保存到照片"}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void handleScanCardQr()}
                  disabled={actionBusy !== null}
                >
                  {actionBusy === "scan" ? "正在识别二维码..." : "识别图片中的二维码"}
                </button>
              </div>
              {actionNotice ? <div className="px-5 pb-2 text-center text-xs leading-5 text-slate-500">{actionNotice}</div> : null}
              <div className="border-t p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-2xl px-4 py-4 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
                  onClick={() => setActionSheetOpen(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {qrResultOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[2147483406] bg-black/55"
            onClick={() => setQrResultOpen(false)}
            aria-label="关闭二维码识别结果"
          />
          <div className="fixed inset-0 z-[2147483407] flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
              <div className="text-base font-semibold text-slate-900">二维码识别结果</div>
              <div className="mt-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 break-all">
                {qrResult}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                  onClick={handleOpenQrResult}
                >
                  {isLikelyUrl(qrResult) ? "打开识别结果" : "复制识别结果"}
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={() => void handleCopyQrResult()}
                >
                  复制内容
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
                  onClick={() => setQrResultOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {actionNotice && !actionSheetOpen ? (
        <div className="fixed inset-x-0 bottom-6 z-[2147483408] flex justify-center px-4">
          <div className="max-w-md rounded-full bg-slate-950 px-4 py-2 text-center text-xs text-white shadow-2xl">
            {actionNotice}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
