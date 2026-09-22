"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { BUSINESS_CARD_QR_STYLES, normalizeBusinessCardQrStyle, renderBusinessCardQrSvg, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { BUSINESS_CARD_QR_ICONS, BUSINESS_CARD_QR_FRAMES, normalizeBusinessCardQrDecoration, renderBusinessCardQrIcon } from "@/lib/merchantBusinessCardQrDecorations";
import { businessCardQrSvgDataUrl } from "@/lib/merchantBusinessCardQrRender";
import { BUSINESS_CARD_QR_CRAFTED_FRAMES, businessCardQrCraftedSelection } from "@/lib/merchantBusinessCardQrCraftedFrames";

const PAGE_SIZE = 12;
type Kind = "style" | "icon" | "frame";
const TITLES = { style: "样式", icon: "图形", frame: "外框" };
const CATALOGS = {
  style: BUSINESS_CARD_QR_STYLES.map(i => ({ ...i, group: i.id.startsWith("finder-") ? "圆角定位框" : "经典码点" })),
  icon: [{ id: "none", label: "无图形", group: "通用" }, ...BUSINESS_CARD_QR_ICONS],
  frame: [{ id: "none", label: "无外框", group: "通用" }, ...BUSINESS_CARD_QR_FRAMES],
};
const HISTORY_FRAMES = BUSINESS_CARD_QR_FRAMES.filter(f => !f.id.startsWith("crafted-"));

export function BusinessCardQrPresetSelector({ appearance, onChange }: { appearance: BusinessCardQrAppearance; onChange: (patch: BusinessCardQrAppearance) => void }) {
  const optionsId = useId();
  const value = normalizeBusinessCardQrDecoration(appearance);
  const selected = { style: normalizeBusinessCardQrStyle(appearance.style), icon: value.icon, frame: value.frame };
  const [open, setOpen] = useState<Kind | null>(null);
  const [group, setGroup] = useState("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState(false);
  const [samples, setSamples] = useState<{ key: string; values: Record<string, string> }>({ key: "", values: {} });
  const [error, setError] = useState("");
  const items = open === "frame" ? history ? HISTORY_FRAMES : BUSINESS_CARD_QR_CRAFTED_FRAMES : CATALOGS[open ?? "style"];
  const historicalSelection = selected.frame !== "none" && !selected.frame.startsWith("crafted-");
  const groups = ["全部", ...new Set(items.map(i => i.group))];
  const filtered = useMemo(() => items.filter(i => (group === "全部" || i.group === group) && `${i.label} ${i.group} ${i.id}`.toLowerCase().includes(search.trim().toLowerCase())), [items, group, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const sampleKey = JSON.stringify({ open, ids: visible.map(i => i.id), color: appearance.color, backgroundColor: appearance.backgroundColor, style: appearance.style, ...value });
  useEffect(() => {
    const options = JSON.parse(sampleKey) as BusinessCardQrAppearance & { open: Kind | null; ids: string[] };
    if (!options.open) return;
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => {
      const matrix = QRCode.create("https://faolla.com", { errorCorrectionLevel: "H" }).modules;
      const next = Object.fromEntries(options.ids.map(id => {
        const svg = options.open === "icon" && id !== "none"
          ? renderBusinessCardQrIcon(id, options.iconFollowColor ? options.color ?? "#000000" : options.iconColor ?? "#000000")
          : renderBusinessCardQrSvg(matrix, { ...options, ...(options.open === "frame" && options.frame !== id ? businessCardQrCraftedSelection(id) : {}), icon: "none", frame: options.open === "frame" ? id : "none", style: options.open === "style" ? normalizeBusinessCardQrStyle(id) : options.style, showCaption: false, size: 240 });
        return [id, businessCardQrSvgDataUrl(svg)];
      }));
      if (!cancelled) { setSamples({ key: sampleKey, values: next }); setError(""); }
    }).catch(() => { if (!cancelled) setError("预览加载失败，请关闭后重新打开选择器。"); });
    return () => { cancelled = true; };
  }, [sampleKey]);

  const toggle = (kind: Kind) => {
    setOpen(open === kind ? null : kind); setGroup("全部"); setSearch(""); setError(""); setHistory(false);
    const index = (kind === "frame" ? BUSINESS_CARD_QR_CRAFTED_FRAMES : CATALOGS[kind]).findIndex(i => i.id === selected[kind]);
    setPage(Math.floor(Math.max(0, index) / PAGE_SIZE));
  };
  return <section aria-label="二维码外观选择" className="space-y-3">
    <div className="grid grid-cols-1 gap-2 @min-[420px]:grid-cols-3">
      {(["style", "icon", "frame"] as const).map(kind => <button key={kind} type="button" aria-expanded={open === kind} aria-controls={optionsId} onClick={() => toggle(kind)} className={`min-w-0 rounded-xl border px-3 py-3 text-left ${open === kind ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300"}`}>
        <span className="flex justify-between gap-2 text-xs text-slate-500"><span>{TITLES[kind]} · {kind === "frame" ? `${BUSINESS_CARD_QR_CRAFTED_FRAMES.length} 款新版` : `${CATALOGS[kind].length - (kind === "style" ? 0 : 1)} 款`}</span><span aria-hidden="true">{open === kind ? "▴" : "▾"}</span></span>
        <span className="mt-1 block truncate text-sm font-semibold text-slate-900">{CATALOGS[kind].find(i => i.id === selected[kind])?.label}{kind === "frame" && historicalSelection ? " · 历史" : ""}</span>
      </button>)}
    </div>
    {open && <div id={optionsId} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {open === "frame" && <>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="外框版本">
          {[false, true].map(old => <button key={String(old)} type="button" aria-pressed={history === old} onClick={() => { setHistory(old); setGroup("全部"); setSearch(""); setPage(0); }} className={`rounded-lg border px-3 py-2 text-xs font-medium ${history === old ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{old ? `历史样式 · ${HISTORY_FRAMES.length}` : `新版造型 · ${BUSINESS_CARD_QR_CRAFTED_FRAMES.length}`}</button>)}
          <button type="button" aria-pressed={selected.frame === "none"} onClick={() => onChange({ frame: "none" })} className="ml-auto rounded-lg border bg-white px-3 py-2 text-xs">无外框</button>
        </div>
        {historicalSelection && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">当前名片使用历史外框。未选择新版前，原来的外观不会改变。</p>}
      </>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`${TITLES[open]}分类`} value={group} onChange={e => { setGroup(e.target.value); setPage(0); }} className="max-w-full rounded-lg border bg-white px-2 py-2 text-sm">{groups.map(g => <option key={g}>{g}</option>)}</select>
        <input aria-label={`搜索${TITLES[open]}`} placeholder="搜索名称、行业或关键词" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="min-w-32 flex-1 rounded-lg border bg-white px-3 py-2 text-sm" />
        <button type="button" onClick={() => setOpen(null)} className="rounded-lg border bg-white px-3 py-2 text-xs">收起</button>
      </div>
      <div role="group" aria-label={`${TITLES[open]}选项`} className="grid grid-cols-2 gap-2 @min-[380px]:grid-cols-3 @min-[620px]:grid-cols-4">
        {visible.map(item => {
          const active = selected[open] === item.id;
          const source = samples.key === sampleKey ? samples.values[item.id] : undefined;
          return <button type="button" key={item.id} aria-pressed={active} onClick={() => { if (!active) onChange(open === "style" ? { style: normalizeBusinessCardQrStyle(item.id) } : open === "icon" ? { icon: item.id } : businessCardQrCraftedSelection(item.id)); }} className={`min-w-0 rounded-lg border p-2 text-xs ${active ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300"}`}>
            <div className={`flex items-center justify-center ${open === "frame" ? "h-36" : "h-24"}`}>
              {item.id === "none" ? <span className="text-2xl text-slate-400" aria-hidden="true">∅</span> : source ?
                // eslint-disable-next-line @next/next/no-img-element
                <img src={source} alt="" className={open === "icon" ? "h-12 w-12" : `${open === "frame" ? "h-36" : "h-24"} w-full object-contain`} /> : <span className="h-16 w-16 animate-pulse rounded bg-slate-100" />}
            </div>
            <span className="mt-1 block leading-5 font-medium">{item.label}{active ? " ✓" : ""}</span>
          </button>;
        })}
      </div>
      {!filtered.length && <p className="py-4 text-center text-sm text-slate-500">没有匹配项，请更换关键词或分类。</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span role="status">{filtered.length} 款 · 第 {currentPage + 1} / {pageCount} 页</span>
        <div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">上一页</button><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">下一页</button></div>
      </div>
      {open === "frame" && <p className="text-xs leading-5 text-slate-500">{history ? "历史样式仅为兼容旧名片保留；新版独立造型请切换上方标签查看。" : "选择新版会应用该款推荐外框配色、线宽与留白，不改变二维码和中心图形颜色。之后可使用共用色板调整；已选款缩略图同步当前外框设置。"}</p>}
      {error && <p role="status" className="text-xs text-amber-700">{error}</p>}
    </div>}
  </section>;
}
