"use client";

import { useState } from "react";
import { ColorOrGradientPicker, ColorSwatchPalette } from "./ColorOrGradientPicker";
import { BusinessCardQrPresetSelector } from "./BusinessCardQrPresetSelector";
import { normalizeBusinessCardQrDecoration } from "@/lib/merchantBusinessCardQrDecorations";
import { BUSINESS_CARD_QR_COLORS, BUSINESS_CARD_QR_BACKGROUNDS, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH, businessCardQrAspectRatio, isBusinessCardQrColorReadable, normalizeBusinessCardQrBackground, normalizeBusinessCardQrCaption, normalizeBusinessCardQrColor, normalizeBusinessCardQrStyle, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { businessCardQrColorPatch, businessCardQrTargetColor, type BusinessCardQrColorTarget } from "@/lib/merchantBusinessCardQrColorSelection";
import { businessCardQrPng, createBusinessCardQrSvg, verifyBusinessCardQrSvg } from "@/lib/merchantBusinessCardQrRender";

const TARGETS: { id: BusinessCardQrColorTarget; label: string }[] = [{ id: "qr", label: "二维码" }, { id: "icon", label: "图形" }, { id: "frame", label: "外框" }];
const PALETTE = [...BUSINESS_CARD_QR_COLORS, "#b18054", "#c69b6b", "#448fbd", "#dc7d90", "#d6a653"];

export function BusinessCardQrEditorControls({ targetUrl, onChange, exportDisabledReason = "", ...options }: BusinessCardQrAppearance & {
  targetUrl: string;
  onChange: (patch: BusinessCardQrAppearance) => void;
  exportDisabledReason?: string;
}) {
  const decoration = normalizeBusinessCardQrDecoration(options);
  const value = { ...options, ...decoration, style: normalizeBusinessCardQrStyle(options.style), color: normalizeBusinessCardQrColor(options.color), backgroundColor: normalizeBusinessCardQrBackground(options.backgroundColor) };
  const [targets, setTargets] = useState<BusinessCardQrColorTarget[]>(["qr"]);
  const [format, setFormat] = useState<"2048" | "4096" | "svg">("2048");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ratio = businessCardQrAspectRatio(value);
  const readable = isBusinessCardQrColorReadable(value.color, value.backgroundColor);
  const selectedColors = targets.map(t => businessCardQrTargetColor(value, t));
  const mixed = new Set(selectedColors).size > 1;
  const pickerColor = selectedColors[0] ?? value.color;
  const pickColor = (color: string) => {
    const result = businessCardQrColorPatch(value, targets, color);
    if (result.error) { setMessage(result.error); return; }
    setMessage("");
    onChange(result.patch!);
  };
  const pickBackground = (color: string) => {
    if (!isBusinessCardQrColorReadable(value.color, color)) { setMessage("背景色与二维码的对比度不足，背景未更改。请选择更浅的颜色。"); return; }
    setMessage(""); onChange({ backgroundColor: normalizeBusinessCardQrBackground(color) });
  };
  const download = async () => {
    if (busy || !targetUrl || exportDisabledReason || !readable) return;
    setBusy(true); setMessage("");
    try {
      const size = format === "2048" ? 2048 : 4096;
      const svg = await createBusinessCardQrSvg(targetUrl, { ...value, size });
      // Every style, including rounded finders, is checked in the actual browser.
      if (!await verifyBusinessCardQrSvg(svg, targetUrl)) { setMessage("当前组合未通过扫码校验，未导出文件。请调整样式、图形或颜色后重试。"); return; }
      const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" }) : await businessCardQrPng(svg, size);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `faolla-qr-${value.style}-${decoration.icon}-${decoration.frame}-${format === "svg" ? "vector.svg" : `${size}.png`}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("已生成二维码文件。印刷前请用手机在实际尺寸下试扫。");
    } catch { setMessage("二维码导出失败，请重试或选择较小的 PNG 尺寸。"); }
    finally { setBusy(false); }
  };

  return <div className="@container mt-3 space-y-4 border-t border-slate-200 pt-4">
    <BusinessCardQrPresetSelector appearance={value} onChange={onChange} />
    <section aria-label="共用色板" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-900">颜色</h4><span className="text-xs text-slate-500">选择应用对象 · 可多选</span></div>
      <div className="grid grid-cols-1 gap-2 @min-[360px]:grid-cols-3">
        {TARGETS.map(target => <label key={target.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${targets.includes(target.id) ? "border-blue-400 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
          <input type="checkbox" checked={targets.includes(target.id)} onChange={e => setTargets(current => e.target.checked ? [...current, target.id] : current.filter(t => t !== target.id))} />
          <span>{target.label}</span><span aria-hidden="true" className="ml-auto h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: businessCardQrTargetColor(value, target.id) }} />
        </label>)}
      </div>
      <fieldset disabled={!targets.length} className="space-y-3 disabled:opacity-40">
        <legend className="sr-only">为选中项目设置颜色</legend>
        <div className="flex flex-wrap items-center gap-3"><ColorOrGradientPicker value={pickerColor} onChange={pickColor} allowGradient={false} /><span className="text-xs text-slate-600">{!targets.length ? "请先选择应用对象" : mixed ? "已选项目当前颜色不同" : `应用于：${TARGETS.filter(t => targets.includes(t.id)).map(t => t.label).join("、")}`}</span></div>
        <ColorSwatchPalette colors={PALETTE} selectedValue={mixed ? undefined : pickerColor} onPick={pickColor} />
      </fieldset>
      <p className="text-xs leading-5 text-slate-500">只修改已勾选项目；勾选本身不会改变颜色。二维码需要保持深色，图形和外框可以使用更丰富的颜色。</p>
    </section>
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">背景与间距</summary>
      <div className="mt-3 space-y-4">
        <div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold">二维码背景色</span><ColorOrGradientPicker value={value.backgroundColor} onChange={pickBackground} allowGradient={false} /></div><ColorSwatchPalette colors={BUSINESS_CARD_QR_BACKGROUNDS} selectedValue={value.backgroundColor} onPick={pickBackground} /></div>
        {decoration.frame !== "none" && <>
          <div className="space-y-2"><div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold">外框底色</span><ColorOrGradientPicker value={decoration.frameBackgroundColor} onChange={color => onChange({ frameBackgroundColor: color })} allowGradient={false} /></div><ColorSwatchPalette colors={BUSINESS_CARD_QR_BACKGROUNDS} selectedValue={decoration.frameBackgroundColor} onPick={color => onChange({ frameBackgroundColor: color })} /></div>
          <div className="grid grid-cols-1 gap-3 @min-[420px]:grid-cols-2">
            <label className="text-xs font-medium">边框粗细 · {decoration.frameWidth}<input aria-label="边框粗细" type="range" min="1" max="4" step="1" value={decoration.frameWidth} onChange={e => onChange({ frameWidth: Number(e.target.value) })} className="mt-2 w-full" /></label>
            <label className="text-xs font-medium">内部间距 · {decoration.framePadding}<input aria-label="内部间距" type="range" min="8" max="32" step="1" value={decoration.framePadding} onChange={e => onChange({ framePadding: Number(e.target.value) })} className="mt-2 w-full" /></label>
          </div>
        </>}
        <p className="text-xs text-slate-500">保留完整扫码留白。造型外框内二维码较小，请按提示增大名片显示尺寸。</p>
      </div>
    </details>
    <section className="space-y-2 rounded-xl border border-slate-200 p-3" aria-label="二维码引导文字">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.showCaption === true} onChange={e => onChange({ showCaption: e.target.checked })} />显示引导文字</label>
      {value.showCaption && <label className="block text-xs text-slate-600">文字内容<input type="text" value={value.caption ?? "扫码了解更多"} onChange={e => onChange({ caption: Array.from(e.target.value).slice(0, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH).join("") })} onBlur={() => onChange({ caption: normalizeBusinessCardQrCaption(value.caption) })} placeholder="例如：扫码了解更多" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /><span className="mt-1 block">最多 {BUSINESS_CARD_QR_CAPTION_MAX_LENGTH} 个字符；隐藏文字不会清空内容。</span></label>}
    </section>
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
      <label className="text-xs text-slate-600">导出格式<select aria-label="二维码导出格式" value={format} onChange={e => setFormat(e.target.value as typeof format)} disabled={busy} className="ml-2 rounded-lg border bg-white px-2 py-2 text-sm"><option value="2048">PNG · 2048 × {Math.round(2048 * ratio)}</option><option value="4096">PNG · 4096 × {Math.round(4096 * ratio)}</option><option value="svg">SVG · 矢量高清</option></select></label>
      <button type="button" disabled={busy || !targetUrl || !!exportDisabledReason || !readable} onClick={() => void download()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "正在导出…" : "导出二维码"}</button>
    </div>
    {(exportDisabledReason || !targetUrl || !readable) && <p className="text-xs text-amber-700">{exportDisabledReason || (!targetUrl ? "请先填写网址，再导出二维码。" : "二维码与背景对比度不足，请调整颜色后导出。")}</p>}
    {message && <p role="status" className="text-xs leading-5 text-slate-700">{message}</p>}
  </div>;
}
