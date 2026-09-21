"use client";

import { useEffect, useState } from "react";
import { ColorOrGradientPicker, ColorSwatchPalette } from "./ColorOrGradientPicker";
import { BusinessCardQrDecorationControls } from "./BusinessCardQrDecorationControls";
import { normalizeBusinessCardQrDecoration } from "@/lib/merchantBusinessCardQrDecorations";
import {
  BUSINESS_CARD_QR_COLORS, BUSINESS_CARD_QR_STYLES, isBusinessCardQrColorReadable,
  normalizeBusinessCardQrColor, normalizeBusinessCardQrStyle, renderBusinessCardQrSvg,
  BUSINESS_CARD_QR_BACKGROUNDS, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH, businessCardQrAspectRatio,
  normalizeBusinessCardQrBackground, normalizeBusinessCardQrCaption, type BusinessCardQrAppearance,
} from "@/lib/merchantBusinessCardQr";
import { businessCardQrPng, businessCardQrSvgDataUrl, createBusinessCardQrSvg, verifyBusinessCardQrSvg } from "@/lib/merchantBusinessCardQrRender";

export function BusinessCardQrControls({ targetUrl, style, color, backgroundColor, showCaption, caption, onChange, exportDisabledReason = "", ...decorationOptions }: BusinessCardQrAppearance & {
  targetUrl: string;
  onChange: (patch: BusinessCardQrAppearance) => void;
  exportDisabledReason?: string;
}) {
  const selectedStyle = normalizeBusinessCardQrStyle(style);
  const selectedColor = normalizeBusinessCardQrColor(color);
  const selectedBackground = normalizeBusinessCardQrBackground(backgroundColor);
  const captionValue = caption ?? "扫码了解更多";
  const decoration = normalizeBusinessCardQrDecoration(decorationOptions);
  const ratio = businessCardQrAspectRatio({ showCaption, caption, ...decoration });
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<"2048" | "4096" | "svg">("2048");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const readable = isBusinessCardQrColorReadable(selectedColor, selectedBackground);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Style samples always use the same short sample URL; the actual export uses targetUrl.
    void import("qrcode").then(({ default: QRCode }) => {
      const code = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" });
      const next = Object.fromEntries(BUSINESS_CARD_QR_STYLES.map((item) => [item.id,
        businessCardQrSvgDataUrl(renderBusinessCardQrSvg(code.modules, { style: item.id, color: selectedColor, backgroundColor: selectedBackground, size: 160 })),
      ]));
      if (!cancelled) setPreviews(next);
    }).catch(() => { if (!cancelled) setMessage("样式预览加载失败，请重新打开样式选择。"); });
    return () => { cancelled = true; };
  }, [open, selectedColor, selectedBackground]);

  const pickColor = (value: string) => {
    if (!isBusinessCardQrColorReadable(value, selectedBackground)) {
      setMessage("二维码与背景的对比度不足，请选择更深的二维码颜色或更浅的背景色。当前颜色未更改。");
      return;
    }
    setMessage("");
    onChange({ color: normalizeBusinessCardQrColor(value) });
  };

  const pickBackground = (value: string) => {
    if (!isBusinessCardQrColorReadable(selectedColor, value)) {
      setMessage("背景色与二维码的对比度不足，请选择更浅的背景色。当前背景未更改。");
      return;
    }
    setMessage("");
    onChange({ backgroundColor: normalizeBusinessCardQrBackground(value) });
  };

  const download = async () => {
    if (busy || !targetUrl || exportDisabledReason || !readable) return;
    setBusy(true);
    setMessage("");
    try {
      const size = format === "2048" ? 2048 : 4096;
      const svg = await createBusinessCardQrSvg(targetUrl, { style: selectedStyle, color: selectedColor, backgroundColor: selectedBackground, showCaption, caption, ...decoration, size });
      if ((decoration.icon !== "none" || decoration.frame !== "none") && !await verifyBusinessCardQrSvg(svg, targetUrl)) {
        setMessage("当前组合未通过扫码校验，请改用经典码点、调整颜色，或减少装饰后重试。未导出文件。");
        return;
      }
      const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" }) : await businessCardQrPng(svg, size);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `faolla-qr-${selectedStyle}-${decoration.icon}-${decoration.frame}-${format === "svg" ? "vector.svg" : `${size}.png`}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("已生成二维码文件；如浏览器未自动下载，请检查下载提示。印刷前请用手机试扫。");
    } catch {
      setMessage("二维码导出失败，请重试或选择较小的 PNG 尺寸。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          二维码样式 · {BUSINESS_CARD_QR_STYLES.find((item) => item.id === selectedStyle)?.label} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600">导出格式
            <select aria-label="二维码导出格式" value={format} onChange={(event) => setFormat(event.target.value as typeof format)} disabled={busy} className="ml-2 rounded-lg border bg-white px-2 py-2 text-sm">
              <option value="2048">PNG · 2048 × {Math.round(2048 * ratio)}</option>
              <option value="4096">PNG · 4096 × {Math.round(4096 * ratio)}</option>
              <option value="svg">SVG · 矢量高清</option>
            </select>
          </label>
          <button type="button" disabled={busy || !targetUrl || !!exportDisabledReason || !readable} onClick={() => void download()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "正在导出…" : "导出二维码"}
          </button>
        </div>
      </div>
      {open && (
        <div role="group" aria-label="二维码样式" className="@container rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2 @min-[380px]:grid-cols-3 @min-[540px]:grid-cols-5">
            {BUSINESS_CARD_QR_STYLES.map((item) => (
              <button type="button" key={item.id} aria-pressed={selectedStyle === item.id} onClick={() => onChange({ style: item.id })} className={`rounded-lg border p-2 text-xs transition ${selectedStyle === item.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-slate-400"}`}>
                {previews[item.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previews[item.id]} alt="" className="mx-auto aspect-square w-full max-w-24" />
                ) : <div className="mx-auto aspect-square w-full max-w-24 animate-pulse rounded bg-slate-100" />}
                <span className="mt-1 block font-medium">{item.label}{selectedStyle === item.id ? " ✓" : ""}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">以上为样式示意；实际二维码内容以名片实时预览和导出文件为准。</p>
        </div>
      )}
      <BusinessCardQrDecorationControls appearance={{ style: selectedStyle, color: selectedColor, backgroundColor: selectedBackground, ...decoration }} onChange={onChange} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold text-slate-700">二维码颜色</span><ColorOrGradientPicker value={selectedColor} onChange={pickColor} allowGradient={false} /></div>
        <ColorSwatchPalette colors={BUSINESS_CARD_QR_COLORS} selectedValue={selectedColor} onPick={pickColor} />
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold text-slate-700">二维码背景色</span><ColorOrGradientPicker value={selectedBackground} onChange={pickBackground} allowGradient={false} /></div>
        <ColorSwatchPalette colors={BUSINESS_CARD_QR_BACKGROUNDS} selectedValue={selectedBackground} onPick={pickBackground} />
        <p className="text-xs text-slate-500">采用深色码、浅色底，保留完整扫码留白。背景色会同步应用到预览和导出。</p>
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={showCaption === true} onChange={(event) => onChange({ showCaption: event.target.checked })} />{decoration.frame === "none" ? "在二维码下方显示文字" : "显示外框引导文字"}</label>
        {showCaption && <label className="block text-xs text-slate-600">二维码引导文字
          <input type="text" value={captionValue} onChange={(event) => onChange({ caption: Array.from(event.target.value).slice(0, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH).join("") })} onBlur={() => onChange({ caption: normalizeBusinessCardQrCaption(captionValue) })} placeholder="例如：扫码了解更多" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
          <span className="mt-1 block">最多 {BUSINESS_CARD_QR_CAPTION_MAX_LENGTH} 个字符；{decoration.frame === "none" ? "文字居中显示，颜色与二维码一致。" : "按外框设计放置文字，自动使用清晰的文字颜色。"}</span>
        </label>}
        <p className="text-xs text-slate-500">{decoration.frame === "none" ? "添加文字会向下增加图片高度，不缩小二维码；导出尺寸独立于名片显示大小。" : "外框内已预留文字位置；隐藏文字不会清空内容，也不会改变二维码大小。"}</p>
      </div>
      {(exportDisabledReason || !targetUrl || !readable) && <p className="text-xs text-amber-700">{exportDisabledReason || (!targetUrl ? "请先填写网址，再导出二维码。" : "二维码与背景对比度不足，请调整颜色后导出。")}</p>}
      {message && <p role="status" className="text-xs leading-5 text-slate-700">{message}</p>}
    </div>
  );
}
