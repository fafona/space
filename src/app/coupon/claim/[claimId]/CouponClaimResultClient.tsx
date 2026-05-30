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
  const [saveError, setSaveError] = useState("");

  const saveCouponPage = async () => {
    const node = captureRef.current;
    if (!node || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await waitForImages(node);
      if (typeof document.fonts?.ready?.then === "function") {
        await document.fonts.ready.catch(() => undefined);
      }
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      downloadDataUrl(dataUrl, buildFileName([merchantName, title, "优惠券"]));
    } catch {
      setSaveError("保存失败，请稍后重试。");
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
          {saving ? "正在生成图片" : "保存至相册"}
        </button>
        {saveError ? <div className="mt-2 text-center text-xs text-rose-600">{saveError}</div> : null}
      </div>
    </main>
  );
}
