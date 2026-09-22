"use client";

import { useState } from "react";
import { ColorOrGradientPicker, ColorSwatchPalette } from "./ColorOrGradientPicker";
import { BusinessCardQrPresetSelector } from "./BusinessCardQrPresetSelector";
import { BusinessCardQrTextControls } from "./BusinessCardQrTextControls";
import { normalizeBusinessCardQrDecoration } from "@/lib/merchantBusinessCardQrDecorations";
import { BUSINESS_CARD_QR_COLORS, BUSINESS_CARD_QR_BACKGROUNDS, businessCardQrAspectRatio, isBusinessCardQrColorReadable, normalizeBusinessCardQrBackground, normalizeBusinessCardQrColor, normalizeBusinessCardQrStyle, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { businessCardQrColorPatch, businessCardQrTargetColor, businessCardQrBackgroundPatch, businessCardQrBackgroundTargetColor, type BusinessCardQrColorTarget, type BusinessCardQrBackgroundTarget } from "@/lib/merchantBusinessCardQrColorSelection";
import { businessCardQrPng, createBusinessCardQrSvg, verifyBusinessCardQrSvg } from "@/lib/merchantBusinessCardQrRender";

const TARGETS: { id: BusinessCardQrColorTarget; label: string }[] = [{ id: "qr", label: "二维码" }, { id: "icon", label: "图形" }, { id: "frame", label: "外框" }];
const BACKGROUND_TARGETS: { id: BusinessCardQrBackgroundTarget; label: string }[] = [{ id: "background", label: "二维码背景色" }, { id: "frameBackground", label: "外框底色" }];
const PALETTE = [...BUSINESS_CARD_QR_COLORS, "#b18054", "#c69b6b", "#448fbd", "#dc7d90", "#d6a653"];

export function BusinessCardQrEditorControls({ targetUrl, onChange, exportDisabledReason = "", ...options }: BusinessCardQrAppearance & {
  targetUrl: string;
  onChange: (patch: BusinessCardQrAppearance) => void;
  exportDisabledReason?: string;
}) {
  const decoration = normalizeBusinessCardQrDecoration(options);
  const value = { ...options, ...decoration, style: normalizeBusinessCardQrStyle(options.style), color: normalizeBusinessCardQrColor(options.color), backgroundColor: normalizeBusinessCardQrBackground(options.backgroundColor) };
  const [targets, setTargets] = useState<BusinessCardQrColorTarget[]>(["qr"]);
  const [backgroundTargets, setBackgroundTargets] = useState<BusinessCardQrBackgroundTarget[]>(["background"]);
  const [format, setFormat] = useState<"2048" | "4096" | "svg">("2048");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ratio = businessCardQrAspectRatio(value);
  const readable = isBusinessCardQrColorReadable(value.color, value.backgroundColor);
  const selectedColors = targets.map(t => businessCardQrTargetColor(value, t));
  const mixed = new Set(selectedColors).size > 1;
  const pickerColor = selectedColors[0] ?? value.color;
  const availableBackgroundTargets = BACKGROUND_TARGETS.filter(target => target.id === "background" || decoration.frame !== "none");
  const activeBackgroundTargets = backgroundTargets.filter(target => availableBackgroundTargets.some(item => item.id === target));
  const backgroundColors = activeBackgroundTargets.map(target => businessCardQrBackgroundTargetColor(value, target));
  const mixedBackgrounds = new Set(backgroundColors).size > 1;
  const backgroundPickerColor = backgroundColors[0] ?? value.backgroundColor;
  const pickColor = (color: string) => {
    const result = businessCardQrColorPatch(value, targets, color);
    if (result.error) { setMessage(result.error); return; }
    setMessage("");
    onChange(result.patch!);
  };
  const pickBackground = (color: string) => {
    const result = businessCardQrBackgroundPatch(value, activeBackgroundTargets, color);
    if (result.error) { setMessage(result.error); return; }
    setMessage(""); onChange(result.patch!);
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
    } catch (error) { setMessage(error instanceof Error && /字体/.test(error.message) ? error.message : "二维码导出失败，请重试或选择较小的 PNG 尺寸。"); }
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
    <section aria-label="背景共用色板" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-2 @min-[360px]:grid-cols-2">
        {availableBackgroundTargets.map(target => <label key={target.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${activeBackgroundTargets.includes(target.id) ? "border-blue-400 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
          <input type="checkbox" checked={activeBackgroundTargets.includes(target.id)} onChange={e => setBackgroundTargets(current => e.target.checked ? [...current, target.id] : current.filter(item => item !== target.id))} />
          <span>{target.label}</span><span aria-hidden="true" className="ml-auto h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: businessCardQrBackgroundTargetColor(value, target.id) }} />
        </label>)}
      </div>
      <fieldset disabled={!activeBackgroundTargets.length} className="space-y-3 disabled:opacity-40">
        <legend className="sr-only">为选中项目设置底色</legend>
        <div className="flex flex-wrap items-center gap-3"><ColorOrGradientPicker value={backgroundPickerColor} onChange={pickBackground} allowGradient={false} /><span className="text-xs text-slate-600">{!activeBackgroundTargets.length ? "请先选择应用对象" : mixedBackgrounds ? "已选项目当前颜色不同" : `应用于：${availableBackgroundTargets.filter(target => activeBackgroundTargets.includes(target.id)).map(target => target.label).join("、")}`}</span></div>
        <ColorSwatchPalette colors={BUSINESS_CARD_QR_BACKGROUNDS} selectedValue={mixedBackgrounds ? undefined : backgroundPickerColor} onPick={pickBackground} />
      </fieldset>
        {decoration.frame !== "none" &&
          <div className="grid grid-cols-1 gap-3 @min-[420px]:grid-cols-2">
            <label className="text-xs font-medium">边框粗细 · {decoration.frameWidth}<input aria-label="边框粗细" type="range" min="1" max="4" step="1" value={decoration.frameWidth} onChange={e => onChange({ frameWidth: Number(e.target.value) })} className="mt-2 w-full" /></label>
            <label className="text-xs font-medium">内部间距 · {decoration.framePadding}<input aria-label="内部间距" type="range" min="8" max="32" step="1" value={decoration.framePadding} onChange={e => onChange({ framePadding: Number(e.target.value) })} className="mt-2 w-full" /></label>
          </div>
        }
    </section>
    <BusinessCardQrTextControls value={value} onChange={onChange} />
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
      <label className="text-xs text-slate-600">导出格式<select aria-label="二维码导出格式" value={format} onChange={e => setFormat(e.target.value as typeof format)} disabled={busy} className="ml-2 rounded-lg border bg-white px-2 py-2 text-sm"><option value="2048">PNG · 2048 × {Math.round(2048 * ratio)}</option><option value="4096">PNG · 4096 × {Math.round(4096 * ratio)}</option><option value="svg">SVG · 矢量高清</option></select></label>
      <button type="button" disabled={busy || !targetUrl || !!exportDisabledReason || !readable} onClick={() => void download()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "正在导出…" : "导出二维码"}</button>
    </div>
    {(exportDisabledReason || !targetUrl || !readable) && <p className="text-xs text-amber-700">{exportDisabledReason || (!targetUrl ? "请先填写网址，再导出二维码。" : "二维码与背景对比度不足，请调整颜色后导出。")}</p>}
    {message && <p role="status" className="text-xs leading-5 text-slate-700">{message}</p>}
  </div>;
}
