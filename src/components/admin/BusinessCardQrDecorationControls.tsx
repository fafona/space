"use client";

import { useEffect, useState } from "react";
import { ColorOrGradientPicker, ColorSwatchPalette } from "./ColorOrGradientPicker";
import { BUSINESS_CARD_QR_BACKGROUNDS, BUSINESS_CARD_QR_COLORS, renderBusinessCardQrSvg, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { BUSINESS_CARD_QR_ICONS, BUSINESS_CARD_QR_FRAMES, normalizeBusinessCardQrDecoration, renderBusinessCardQrIcon } from "@/lib/merchantBusinessCardQrDecorations";
import { businessCardQrSvgDataUrl } from "@/lib/merchantBusinessCardQrRender";

export function BusinessCardQrDecorationControls({ appearance, onChange }: { appearance: BusinessCardQrAppearance; onChange: (patch: BusinessCardQrAppearance) => void }) {
  const value = normalizeBusinessCardQrDecoration(appearance);
  const [open, setOpen] = useState<"icon" | "frame" | null>(null);
  const [group, setGroup] = useState("全部");
  const [search, setSearch] = useState("");
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const sampleKey = JSON.stringify({ color: appearance.color, backgroundColor: appearance.backgroundColor, style: appearance.style, ...value });
  useEffect(() => {
    if (open !== "frame") return;
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => {
      const code = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" });
      const options = JSON.parse(sampleKey) as BusinessCardQrAppearance;
      const next = Object.fromEntries(BUSINESS_CARD_QR_FRAMES.map(item => [item.id, businessCardQrSvgDataUrl(renderBusinessCardQrSvg(code.modules, { ...options, icon: "none", frame: item.id, showCaption: true, caption: "扫一扫", size: 160 }))]));
      if (!cancelled) { setSamples(next); setError(""); }
    }).catch(() => { if (!cancelled) setError("外框预览加载失败，请收起后重新打开。"); });
    return () => { cancelled = true; };
  }, [open, sampleKey]);
  const toggle = (kind: "icon" | "frame") => { setOpen(open === kind ? null : kind); setGroup("全部"); setSearch(""); };
  const items = open === "icon" ? BUSINESS_CARD_QR_ICONS : BUSINESS_CARD_QR_FRAMES;
  const groups = ["全部", ...new Set(items.map(item => item.group))];
  const buttonClass = (selected: boolean) => `rounded-lg border p-2 text-xs ${selected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-white hover:border-slate-400"}`;
  const colorPicker = (label: string, color: string, key: "iconColor" | "frameColor" | "frameBackgroundColor", backgrounds = false) => <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold text-slate-700">{label}</span><ColorOrGradientPicker value={color} onChange={c => onChange({ [key]: c })} allowGradient={false} /></div>
    <ColorSwatchPalette colors={backgrounds ? BUSINESS_CARD_QR_BACKGROUNDS : BUSINESS_CARD_QR_COLORS} selectedValue={color} onPick={c => onChange({ [key]: c })} />
  </div>;
  return <section aria-label="二维码图形与外框" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-expanded={open === "icon"} onClick={() => toggle("icon")} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">行业图形 · {BUSINESS_CARD_QR_ICONS.find(i => i.id === value.icon)?.label ?? "无图形"}（36 款）</button>
      <button type="button" aria-expanded={open === "frame"} onClick={() => toggle("frame")} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">二维码外框 · {BUSINESS_CARD_QR_FRAMES.find(i => i.id === value.frame)?.label ?? "无外框"}（40 款）</button>
    </div>
    {open && <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label={open === "icon" ? "行业图形分类" : "外框分类"} value={group} onChange={e => setGroup(e.target.value)} className="rounded-lg border bg-white p-2 text-sm">{groups.map(g => <option key={g}>{g}</option>)}</select>
        <input aria-label="搜索二维码装饰" placeholder="搜索名称或分类" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm" />
        <button type="button" aria-pressed={(open === "icon" ? value.icon : value.frame) === "none"} className={buttonClass((open === "icon" ? value.icon : value.frame) === "none")} onClick={() => onChange(open === "icon" ? { icon: "none" } : { frame: "none" })}>{open === "icon" ? "无图形" : "无外框"}</button>
      </div>
      <div role="group" aria-label={open === "icon" ? "行业图形选项" : "二维码外框选项"} className="@container max-h-96 overflow-y-auto p-1">
        <div className="grid grid-cols-2 gap-2 @min-[380px]:grid-cols-3 @min-[540px]:grid-cols-5">
          {items.filter(item => (group === "全部" || item.group === group) && `${item.label}${item.group}`.includes(search.trim())).map(item => {
            const selected = (open === "icon" ? value.icon : value.frame) === item.id;
            const index = items.findIndex(i => i.id === item.id) + 1;
            const source = open === "icon" ? businessCardQrSvgDataUrl(renderBusinessCardQrIcon(item.id as typeof value.icon, value.iconFollowColor ? appearance.color ?? "#000000" : value.iconColor)) : samples[item.id];
            return <button type="button" key={item.id} aria-pressed={selected} onClick={() => onChange(open === "icon" ? { icon: item.id as typeof value.icon } : { frame: item.id as typeof value.frame })} className={buttonClass(selected)}>
              {source ? <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={source} alt="" className={open === "icon" ? "mx-auto my-3 h-10 w-10" : "mx-auto h-28 w-full object-contain"} />
              </> : <div className="h-28 animate-pulse rounded bg-slate-100" />}
              <span className="mt-1 block font-medium">{String(index).padStart(2, "0")} {item.label}{selected ? " ✓" : ""}</span>
            </button>;
          })}
        </div>
        {!items.some(item => (group === "全部" || item.group === group) && `${item.label}${item.group}`.includes(search.trim())) && <p className="py-4 text-center text-sm text-slate-500">没有匹配的选项，请更换关键词或分类。</p>}
      </div>
      {error && <p role="status" className="text-xs text-amber-700">{error}</p>}
    </div>}
    {value.icon !== "none" && <div className="space-y-3 border-t pt-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.iconFollowColor} onChange={e => onChange({ iconFollowColor: e.target.checked })} />图形颜色跟随二维码</label>
      {!value.iconFollowColor && colorPicker("图形颜色", value.iconColor, "iconColor")}
      <p className="text-xs text-slate-500">图形大小受扫码安全限制；会避开结构码点，必要时微调位置。</p>
    </div>}
    {value.frame !== "none" && <div className="space-y-3 border-t pt-3">
      {colorPicker("外框颜色", value.frameColor, "frameColor")}
      {colorPicker("外框底色", value.frameBackgroundColor, "frameBackgroundColor", true)}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">边框粗细 · {value.frameWidth}<input aria-label="边框粗细" type="range" min="1" max="4" step="1" value={value.frameWidth} onChange={e => onChange({ frameWidth: Number(e.target.value) })} className="mt-2 w-full" /></label>
        <label className="text-xs font-medium">内部间距 · {value.framePadding}<input aria-label="内部间距" type="range" min="8" max="32" step="1" value={value.framePadding} onChange={e => onChange({ framePadding: Number(e.target.value) })} className="mt-2 w-full" /></label>
      </div>
      <p className="text-xs leading-5 text-slate-500">外框位于完整扫码留白之外。导出尺寸包含外框；在名片中使用外框时建议增大二维码显示尺寸，印刷前请用手机试扫。</p>
    </div>}
  </section>;
}
