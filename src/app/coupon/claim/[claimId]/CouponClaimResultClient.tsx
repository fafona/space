"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";

type CouponClaimResultClientProps = {
  merchantName: string;
  title: string;
  description: string;
  discount: string;
  codeImage: string;
  settlementType: "qr" | "barcode";
  settlementCode: string;
  claimedAtLabel: string;
  validUntilLabel: string;
};

type NativeGallerySaveResult = boolean | string | { ok?: unknown; success?: unknown; message?: unknown } | Promise<unknown>;

type NativeGalleryBridge = {
  saveImageToGallery?: (payloadJson: string) => NativeGallerySaveResult;
  saveImageToAlbum?: (payloadJson: string) => NativeGallerySaveResult;
  saveImage?: (payloadJson: string) => NativeGallerySaveResult;
};

type NativeGalleryWindow = Window & {
  FaollaNativeUpdates?: NativeGalleryBridge;
};

function buildFileName(parts: string[]) {
  return `${parts
    .map((part) => part.trim().replace(/[\\/:*?"<>|]+/g, "-"))
    .filter(Boolean)
    .join("-") || "coupon"}.png`;
}

async function waitForImages(node: HTMLElement) {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          window.setTimeout(done, 2200);
        }),
    ),
  );
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function parseNativeGallerySaveResult(result: unknown) {
  if (result === true || result === undefined || result === null) return { ok: true, message: "" };
  if (typeof result === "string") {
    const normalized = result.trim();
    if (!normalized) return { ok: true, message: "" };
    if (normalized === "true" || normalized === "ok" || normalized === "success") return { ok: true, message: "" };
    try {
      const parsed = JSON.parse(normalized) as { ok?: unknown; success?: unknown; message?: unknown };
      return {
        ok: parsed.ok === true || parsed.success === true,
        message: typeof parsed.message === "string" ? parsed.message : "",
      };
    } catch {
      return { ok: false, message: normalized };
    }
  }
  if (typeof result === "object") {
    const parsed = result as { ok?: unknown; success?: unknown; message?: unknown };
    return {
      ok: parsed.ok === true || parsed.success === true,
      message: typeof parsed.message === "string" ? parsed.message : "",
    };
  }
  return { ok: false, message: "" };
}

async function saveImageToNativeGallery(dataUrl: string, fileName: string) {
  const bridge = typeof window !== "undefined" ? (window as NativeGalleryWindow).FaollaNativeUpdates : undefined;
  const save =
    typeof bridge?.saveImageToGallery === "function"
      ? bridge.saveImageToGallery.bind(bridge)
      : typeof bridge?.saveImageToAlbum === "function"
        ? bridge.saveImageToAlbum.bind(bridge)
        : typeof bridge?.saveImage === "function"
          ? bridge.saveImage.bind(bridge)
          : null;

  if (!save) return { attempted: false, ok: false, message: "" };

  const result = await Promise.resolve(
    save(
      JSON.stringify({
        dataUrl,
        fileName,
        mimeType: "image/png",
        album: "Faolla",
      }),
    ),
  );
  const parsed = parseNativeGallerySaveResult(result);
  return { attempted: true, ...parsed };
}

export default function CouponClaimResultClient({
  merchantName,
  title,
  description,
  discount,
  codeImage,
  settlementType,
  settlementCode,
  claimedAtLabel,
  validUntilLabel,
}: CouponClaimResultClientProps) {
  const captureRef = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveMessageTone, setSaveMessageTone] = useState<"ok" | "error">("ok");

  const showSaveMessage = (message: string, tone: "ok" | "error" = "ok") => {
    setSaveMessage(message);
    setSaveMessageTone(tone);
  };

  const saveCouponPage = async () => {
    const node = captureRef.current;
    if (!node || saving) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await waitForImages(node);
      if (typeof document.fonts?.ready?.then === "function") {
        await document.fonts.ready.catch(() => undefined);
      }
      const fileName = buildFileName([merchantName, title, "优惠券"]);
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const nativeResult = await saveImageToNativeGallery(dataUrl, fileName);
      if (nativeResult.attempted && nativeResult.ok) {
        showSaveMessage("已保存至相册");
        return;
      }
      if (nativeResult.attempted && !nativeResult.ok) {
        showSaveMessage(nativeResult.message || "相册保存失败，已改为下载图片。", "error");
      }
      downloadDataUrl(dataUrl, fileName);
      if (!nativeResult.attempted) {
        showSaveMessage("当前浏览器不支持直接写入相册，已下载图片。");
      }
    } catch {
      showSaveMessage("保存失败，请稍后重试。", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <section
        ref={captureRef}
        className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        data-faolla-coupon-capture="true"
      >
        <div className="text-center text-lg font-bold text-slate-900">{merchantName}</div>
        <h1 className="mt-4 text-2xl font-bold">{title}</h1>
        <div className="mt-2 text-base font-semibold text-rose-600">{discount}</div>
        {description ? <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p> : null}

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <div className="text-sm font-semibold text-slate-700">{settlementType === "barcode" ? "核销条形码" : "核销二维码"}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mx-auto mt-3 max-h-[280px] max-w-full rounded-xl bg-white p-3" src={codeImage} alt="核销码" />
          <div className="mt-3 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-600">{settlementCode}</div>
        </div>

        <dl className="mt-5 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">领取时间</dt>
            <dd className="font-medium">{claimedAtLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">有效期</dt>
            <dd className="font-medium">{validUntilLabel}</dd>
          </div>
        </dl>
      </section>

      <div className="mx-auto mt-5 max-w-md">
        <button
          type="button"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70"
          onClick={() => void saveCouponPage()}
          disabled={saving}
        >
          {saving ? "正在保存" : "保存至相册"}
        </button>
        {saveMessage ? (
          <div className={`mt-2 text-center text-xs ${saveMessageTone === "ok" ? "text-emerald-700" : "text-rose-600"}`}>
            {saveMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}
