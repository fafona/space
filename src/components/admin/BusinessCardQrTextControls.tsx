"use client";

import { ColorOrGradientPicker, ColorSwatchPalette } from "./ColorOrGradientPicker";
import { BUSINESS_CARD_QR_COLORS, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { BUSINESS_CARD_QR_TEXT_FONTS, editableBusinessCardQrTexts, type BusinessCardQrText } from "@/lib/merchantBusinessCardQrText";

export function BusinessCardQrTextControls({ value, onChange }: { value: BusinessCardQrAppearance; onChange: (patch: BusinessCardQrAppearance) => void }) {
  const texts = editableBusinessCardQrTexts(value);
  const update = (key: "topText" | "bottomText", patch: Partial<BusinessCardQrText>) => onChange({ ...texts, [key]: { ...texts[key], ...patch } });
  return <section aria-label="二维码引导文字" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">引导文字</h4><span className="text-xs text-slate-500">上下独立设置</span></div>
    <div className="grid gap-3 @min-[680px]:grid-cols-2">
      {([['topText', '上方文字'], ['bottomText', '下方文字']] as const).map(([key, label]) => {
        const text = texts[key];
        return <fieldset key={key} className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={text.enabled} onChange={e => update(key, { enabled: e.target.checked })} />显示{label}</label>
          {text.enabled && <>
            <label className="block text-xs text-slate-600">{label}内容<input type="text" value={text.text} placeholder={key === "topText" ? "例如：欢迎光临" : "例如：扫码了解更多"} onChange={e => update(key, { text: Array.from(e.target.value).slice(0, 24).join("") })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
              <label className="text-xs text-slate-600">{label}字体<select value={text.font} onChange={e => update(key, { font: e.target.value as BusinessCardQrText['font'] })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm">{BUSINESS_CARD_QR_TEXT_FONTS.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}</select></label>
              <label className="text-xs text-slate-600">{label}字号<select value={text.fontSize} onChange={e => update(key, { fontSize: Number(e.target.value) })} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm">{Array.from(new Set([12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, text.fontSize])).sort((a,b) => a-b).map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            </div>
            <div role="group" aria-label={`${label}位置`} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center justify-between"><span className="text-xs text-slate-600">文字位置</span><button type="button" onClick={() => update(key, { offsetX: 0, offsetY: 0 })} className="rounded border bg-white px-2 py-1 text-xs">位置复位</button></div>
              {([['offsetX', '水平 X', 120], ['offsetY', '垂直 Y', 300]] as const).map(([axis, title, limit]) => <label key={axis} className="grid grid-cols-[60px_minmax(0,1fr)_64px] items-center gap-2 text-xs text-slate-600">
                <span>{title}</span><input aria-label={`${label}${title}滑块`} type="range" min={-limit} max={limit} step={1} value={text[axis] ?? 0} onChange={e => update(key, { [axis]: Number(e.target.value) })} className="min-w-0 w-full" />
                <input aria-label={`${label}${title}`} type="number" min={-limit} max={limit} step={1} value={text[axis] ?? 0} onChange={e => update(key, { [axis]: Math.max(-limit, Math.min(limit, Number(e.target.value) || 0)) })} className="min-w-0 rounded border bg-white px-1 py-1" />
              </label>)}
              <p className="text-[11px] text-slate-500">负值向左／上，正值向右／下。请勿遮挡二维码。</p>
            </div>
            <div role="group" aria-label={`${label}颜色`} className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-600">文字颜色</span><ColorOrGradientPicker value={text.color} onChange={color => update(key, { color })} allowGradient={false} /></div><ColorSwatchPalette colors={[...BUSINESS_CARD_QR_COLORS, '#b18054', '#dc7d90']} selectedValue={text.color} onPick={color => update(key, { color })} /></div>
          </>}
        </fieldset>;
      })}
    </div>
    <p className="text-xs leading-5 text-slate-500">每处最多 24 个字符；隐藏不会清空。字号和位置以二维码宽 300px 为基准，随导出同比放大；长文字自动适配。首次选字体需要加载，西文字体中的中文使用快乐体补字。</p>
  </section>;
}
