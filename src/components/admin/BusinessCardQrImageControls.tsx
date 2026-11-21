"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import type { BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";

export function BusinessCardQrImageControls({ image, onChange, onProcessingChange }: {
  image?: string;
  onChange: (patch: BusinessCardQrAppearance) => void;
  onProcessingChange: (busy: boolean) => void;
}) {
  const inputId = useId();
  const request = useRef(0);
  const notify = useRef(onProcessingChange);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { notify.current = onProcessingChange; }, [onProcessingChange]);
  useEffect(() => () => { request.current += 1; notify.current(false); }, []);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return; // Cancelling the native picker must leave the draft intact.
    const token = ++request.current;
    setProcessing(true); onProcessingChange(true); setMessage("");
    try {
      const { prepareBusinessCardQrImage } = await import("@/lib/merchantBusinessCardQrImage.client");
      const result = await prepareBusinessCardQrImage(file);
      if (request.current !== token) return;
      onChange({ icon: "none", iconImageDataUrl: result });
      setMessage("图片已加入二维码预览，原图比例和透明背景已保留。");
    } catch (error) {
      if (request.current === token) setMessage(error instanceof Error && /请选择|只支持|图片|浏览器/.test(error.message)
        ? error.message : "图片处理失败，请换一张 PNG、JPG 或 WebP 图片后重试。");
    } finally {
      if (request.current === token) { setProcessing(false); onProcessingChange(false); }
    }
  }
  return <section aria-label="二维码中心图片" className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
    <div className="flex items-center gap-3">
      {image && <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="已上传的二维码中心图片" className="h-full w-full object-contain" />
      </div>}
      <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-slate-900">中心图片</h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">可上传自己的 Logo 或图案，也可继续使用上方内置图形。</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className={`rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-blue-900 ${processing ? "opacity-50" : "cursor-pointer hover:bg-blue-50"}`}>
        {processing ? "正在处理…" : image ? "替换中心图片" : "上传中心图片"}
      </label>
      <input id={inputId} aria-label="上传二维码中心图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={processing} className="sr-only" onChange={event => void upload(event)} />
      {image && <button type="button" disabled={processing} onClick={() => { setMessage(""); onChange({ iconImageDataUrl: "", icon: "none" }); }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50">移除图片</button>}
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-500">PNG / JPG / WebP · 最大 8 MB，自动压缩。保留二维码识别区域，导出前仍会进行扫码校验。上传图片保持原色，不随色板变色。</p>
    {message && <p role="status" className="mt-2 text-xs leading-5 text-slate-700">{message}</p>}
  </section>;
}
