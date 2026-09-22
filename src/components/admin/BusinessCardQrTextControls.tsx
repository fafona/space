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
            <div role="group" aria-label={`${label}颜色`} className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-600">文字颜色</span><ColorOrGradientPicker value={text.color} onChange={color => update(key, { color })} allowGradient={false} /></div><ColorSwatchPalette colors={[...BUSINESS_CARD_QR_COLORS, '#b18054', '#dc7d90']} selectedValue={text.color} onPick={color => update(key, { color })} /></div>
          </>}
        </fieldset>;
      })}
    </div>
    <p className="text-xs leading-5 text-slate-500">每处最多 24 个字符；隐藏不会清空。字号以二维码宽 300px 为基准，随导出同比放大；长文字自动适配。首次选字体需要加载，西文字体中的中文使用快乐体补字。新增文字位于完整外框之外，不遮挡二维码。</p>
  </section>;
}
