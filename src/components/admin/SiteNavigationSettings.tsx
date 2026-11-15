"use client";

import { useState, type ChangeEvent } from "react";
import type { NavProps } from "@/data/homeBlocks";
import { toPlainRichText } from "@/lib/richTextSafety";
import { siteNavigationColor } from "@/lib/siteNavigation";

export default function SiteNavigationSettings({ value, onChange, upload, onAlert }: {
  value: NavProps;
  onChange: (patch: Partial<NavProps>) => void;
  upload: (file: File) => Promise<{ value: string; externalized: boolean }>;
  onAlert: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const branded = value.navLayout === "brand-header";
  const items = value.navItems ?? [];
  const children = value.navSubItems ?? [];
  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    try {
      const result = await upload(file);
      onChange({ navLogoUrl: result.value });
      if (!result.externalized) onAlert("Logo 已保存在草稿，发布前会再次尝试上传到存储。");
    } catch (error) { onAlert(error instanceof Error ? error.message : "Logo 上传失败，请重试"); }
    finally { setUploading(false); input.value = ""; }
  }
  return <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" data-site-navigation-settings>
    <legend className="px-1 font-semibold">导航布局与交互</legend>
    <label className="flex items-center gap-3">导航样式
      <select aria-label="导航样式" className="rounded border bg-white p-2" value={branded ? "brand-header" : "classic"}
        onChange={event => onChange(event.target.value === "brand-header" ? {
          navLayout: "brand-header", ...(value.navAccentColor ? {} : { bgColor: "#303136", fontColor: "#ffffff", navAccentColor: "#f5888e", navPanelColor: "#303136" }),
        } : { navLayout: "classic" })}>
        <option value="classic">经典模块</option><option value="brand-header">品牌官网导航（Logo／下拉／手机折叠）</option>
      </select>
    </label>
    {branded ? <>
      <p className="text-xs text-slate-600">使用现有页面，不增加页面数量。手机自动折叠；子菜单可展开选择。修改后可用“导航栏对齐”同步其他页面。</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded border bg-white px-3 py-2">{uploading ? "上传中…" : "上传导航 Logo"}
          <input aria-label="上传导航 Logo" type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" disabled={uploading} onChange={uploadLogo} />
        </label>
        {value.navLogoUrl ? <button type="button" className="rounded border bg-white px-3 py-2" onClick={() => onChange({ navLogoUrl: "" })}>移除 Logo</button> : null}
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.navSticky === true} onChange={event => onChange({ navSticky: event.target.checked })} />页面滚动时吸顶</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.navUtilitySpace === true} onChange={event => onChange({ navUtilitySpace: event.target.checked })} />为服务中心／语言按钮预留顶部空间</label>
      </div>
      <label className="block">Logo 替代文字<input aria-label="Logo 替代文字" className="mt-1 w-full rounded border bg-white p-2" value={value.navLogoAlt ?? ""} onChange={event => onChange({ navLogoAlt: event.target.value })} /></label>
      <div className="flex flex-wrap gap-4">
        {([['bgColor', '导航底色', '#303136'], ['fontColor', '文字颜色', '#ffffff'], ['navAccentColor', '强调／主按钮色', '#f5888e'], ['navPanelColor', '下拉底色', '#303136']] as const).map(([key, label, fallback]) =>
          <label className="flex items-center gap-2" key={key}>{label}<input aria-label={label} type="color" value={siteNavigationColor(value[key], fallback)} onChange={event => onChange({ [key]: event.target.value })} /></label>)}
      </div>
      <label className="block">突出显示的主按钮
        <select aria-label="突出显示的主按钮" className="ml-3 rounded border bg-white p-2" value={value.navCtaPageId ?? ""} onChange={event => onChange({ navCtaPageId: event.target.value })}>
          <option value="">无</option>{items.map(item => <option key={item.id} value={item.pageId}>{toPlainRichText(item.label)}</option>)}
        </select>
      </label>
      <div className="space-y-3">
        {items.filter(item => item.pageId !== value.navCtaPageId).map(parent => <div key={parent.id} className="space-y-2 rounded border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{toPlainRichText(parent.label)} · 子菜单</span>
            <button type="button" className="rounded border px-2 py-1 disabled:opacity-50" disabled={children.length >= 32}
              onClick={() => onChange({ navSubItems: [...children, { id: `nav-sub-${crypto.randomUUID()}`, parentPageId: parent.pageId, label: "子栏目", pageId: parent.pageId }] })}>添加子栏目</button></div>
          {children.filter(item => item.parentPageId === parent.pageId).map(child => <div key={child.id} className="flex flex-wrap gap-2">
            <input aria-label="子栏目名称" className="min-w-0 flex-1 rounded border p-2" value={child.label} onChange={event => onChange({ navSubItems: children.map(item => item.id === child.id ? { ...item, label: event.target.value } : item) })} />
            <select aria-label="子栏目目标页面" className="max-w-full rounded border p-2" value={child.pageId} onChange={event => onChange({ navSubItems: children.map(item => item.id === child.id ? { ...item, pageId: event.target.value } : item) })}>
              {items.map(item => <option key={item.id} value={item.pageId}>{toPlainRichText(item.label)}</option>)}
            </select>
            <button type="button" className="rounded border px-2" onClick={() => onChange({ navSubItems: children.filter(item => item.id !== child.id) })}>删除子栏目</button>
          </div>)}
        </div>)}
      </div>
    </> : null}
  </fieldset>;
}
