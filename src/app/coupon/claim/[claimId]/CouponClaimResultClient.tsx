"use client";

import { useState } from "react";

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

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = src;
  });
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
  strokeStyle?: string,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
  if (strokeStyle) {
    context.strokeStyle = strokeStyle;
    context.lineWidth = 1;
    context.stroke();
  }
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const source = text.trim();
  if (!source) return [];
  const lines: string[] = [];
  let current = "";
  Array.from(source).forEach((char) => {
    const next = `${current}${char}`;
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current);
      current = char.trimStart();
      return;
    }
    current = next;
  });
  if (current) lines.push(current);
  return lines;
}

function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 8,
) {
  const lines = wrapCanvasText(context, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => {
    context.fillText(index === maxLines - 1 && wrapCanvasText(context, text, maxWidth).length > maxLines ? `${line}...` : line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

async function renderCouponPageImage(input: CouponClaimResultClientProps) {
  const pixelRatio = 2;
  const width = 450;
  const side = 16;
  const cardX = side;
  const cardY = side;
  const cardWidth = width - side * 2;
  const contentX = cardX + 20;
  const contentWidth = cardWidth - 40;
  const fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) throw new Error("canvas_context_unavailable");
  measureContext.font = `14px ${fontFamily}`;
  const descriptionLines = wrapCanvasText(measureContext, input.description, contentWidth).slice(0, 5);
  const codeBoxHeight = input.settlementType === "barcode" ? 230 : 390;
  const descriptionHeight = descriptionLines.length ? descriptionLines.length * 22 + 12 : 0;
  const cardHeight = 52 + 44 + 28 + descriptionHeight + codeBoxHeight + 96;
  const height = cardHeight + side * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_context_unavailable");
  context.scale(pixelRatio, pixelRatio);
  context.textBaseline = "top";
  context.fillStyle = "#f1f5f9";
  context.fillRect(0, 0, width, height);
  fillRoundedRect(context, cardX, cardY, cardWidth, cardHeight, 18, "#ffffff", "#e2e8f0");

  let y = cardY + 24;
  context.font = `700 18px ${fontFamily}`;
  context.fillStyle = "#0f172a";
  context.textAlign = "center";
  context.fillText(input.merchantName, width / 2, y);

  y += 42;
  context.textAlign = "left";
  context.font = `700 26px ${fontFamily}`;
  context.fillStyle = "#020617";
  context.fillText(input.title, contentX, y);

  y += 42;
  context.font = `700 16px ${fontFamily}`;
  context.fillStyle = "#e11d48";
  context.fillText(input.discount, contentX, y);

  y += 28;
  if (descriptionLines.length) {
    context.font = `14px ${fontFamily}`;
    context.fillStyle = "#475569";
    descriptionLines.forEach((line, index) => {
      context.fillText(line, contentX, y + index * 22);
    });
    y += descriptionLines.length * 22 + 12;
  }

  fillRoundedRect(context, contentX, y, contentWidth, codeBoxHeight, 18, "#f8fafc", "#e2e8f0");
  context.font = `700 15px ${fontFamily}`;
  context.fillStyle = "#334155";
  context.textAlign = "center";
  context.fillText(input.settlementType === "barcode" ? "核销条形码" : "核销二维码", width / 2, y + 18);

  const codeImage = await loadCanvasImage(input.codeImage);
  let codeTextY = y + 351;
  if (input.settlementType === "barcode") {
    const imageWidth = Math.min(contentWidth - 48, 320);
    const imageHeight = Math.max(96, Math.min(128, (codeImage.height / codeImage.width) * imageWidth || 128));
    context.drawImage(codeImage, contentX + (contentWidth - imageWidth) / 2, y + 54, imageWidth, imageHeight);
    const valueBoxY = y + 54 + imageHeight + 16;
    fillRoundedRect(context, contentX + 16, valueBoxY, contentWidth - 32, 34, 10, "#ffffff");
    codeTextY = valueBoxY + 10;
  } else {
    const imageSize = 280;
    fillRoundedRect(context, contentX + (contentWidth - imageSize) / 2, y + 50, imageSize, imageSize, 14, "#ffffff");
    context.drawImage(codeImage, contentX + (contentWidth - 244) / 2, y + 68, 244, 244);
    fillRoundedRect(context, contentX + 16, y + 342, contentWidth - 32, 34, 10, "#ffffff");
  }
  context.font = `12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  context.fillStyle = "#334155";
  context.textAlign = "left";
  drawWrappedCanvasText(
    context,
    input.settlementCode,
    contentX + 30,
    codeTextY,
    contentWidth - 60,
    14,
    2,
  );

  y += codeBoxHeight + 24;
  context.textAlign = "left";
  context.font = `14px ${fontFamily}`;
  context.fillStyle = "#64748b";
  context.fillText("领取时间", contentX, y);
  context.fillStyle = "#020617";
  context.textAlign = "right";
  context.fillText(input.claimedAtLabel, contentX + contentWidth, y);

  y += 32;
  context.textAlign = "left";
  context.fillStyle = "#64748b";
  context.fillText("有效期", contentX, y);
  context.fillStyle = "#020617";
  context.textAlign = "right";
  context.fillText(input.validUntilLabel, contentX + contentWidth, y);

  return canvas.toDataURL("image/png");
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
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveMessageTone, setSaveMessageTone] = useState<"ok" | "error">("ok");

  const showSaveMessage = (message: string, tone: "ok" | "error" = "ok") => {
    setSaveMessage(message);
    setSaveMessageTone(tone);
  };

  const saveCouponPage = async () => {
    if (saving) return;
    setSaving(true);
    setSaveMessage("");
    try {
      if (typeof document.fonts?.ready?.then === "function") {
        await document.fonts.ready.catch(() => undefined);
      }
      const fileName = buildFileName([merchantName, title, "优惠券"]);
      const dataUrl = await renderCouponPageImage({
        merchantName,
        title,
        description,
        discount,
        codeImage,
        settlementType,
        settlementCode,
        claimedAtLabel,
        validUntilLabel,
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
