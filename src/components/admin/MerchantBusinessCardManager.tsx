"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toJpeg } from "html-to-image";
import QRCode from "qrcode";
import {
  MERCHANT_BUSINESS_CARD_RATIO_OPTIONS,
  createDefaultMerchantBusinessCardDraft,
  getMerchantBusinessCardRequiredFields,
  normalizeMerchantBusinessCardDraft,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardDraft,
  type MerchantBusinessCardFieldKey,
  type MerchantBusinessCardProfileInput,
  type MerchantBusinessCardTypographyKey,
} from "@/lib/merchantBusinessCards";
import { buildMerchantDomain } from "@/lib/siteRouting";

type MerchantBusinessCardManagerProps = {
  siteBaseDomain: string;
  profile: MerchantBusinessCardProfileInput;
  cards: MerchantBusinessCardAsset[];
  onCardsChange: (cards: MerchantBusinessCardAsset[]) => void;
};

const CONTACT_FIELDS: Array<{ key: keyof MerchantBusinessCardDraft["contacts"]; label: string }> = [
  { key: "contactName", label: "联系人" },
  { key: "phone", label: "电话" },
  { key: "email", label: "邮箱" },
  { key: "address", label: "地址" },
  { key: "wechat", label: "微信" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "xiaohongshu", label: "小红书" },
];

const TEXT_LAYOUT_FIELDS: Array<{ key: MerchantBusinessCardFieldKey; label: string }> = [
  { key: "merchantName", label: "商户名称" },
  { key: "title", label: "职位" },
  { key: "website", label: "网站说明" },
  { key: "contactName", label: "联系人" },
  { key: "phone", label: "电话" },
  { key: "email", label: "邮箱" },
  { key: "address", label: "地址" },
  { key: "wechat", label: "微信" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "xiaohongshu", label: "小红书" },
];

const TYPOGRAPHY_FIELDS: Array<{ key: MerchantBusinessCardTypographyKey; label: string }> = [
  { key: "name", label: "名称" },
  { key: "title", label: "职位" },
  { key: "website", label: "网站" },
  { key: "info", label: "联系方式" },
];

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "默认" },
  { value: "Microsoft YaHei, SimHei, sans-serif", label: "微软雅黑" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, Times, serif", label: "Times New Roman" },
];

const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function typographyStyle(
  style: MerchantBusinessCardDraft["typography"][MerchantBusinessCardTypographyKey],
): CSSProperties {
  return {
    fontFamily: normalizeText(style.fontFamily) || undefined,
    fontSize: `${style.fontSize}px`,
    color: normalizeText(style.fontColor) || "#0f172a",
    fontWeight: normalizeText(style.fontWeight) || "normal",
    fontStyle: normalizeText(style.fontStyle) || "normal",
    textDecoration: normalizeText(style.textDecoration) || "none",
    lineHeight: 1.35,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

function CardSurface({
  draft,
  websiteUrl,
  qrCodeUrl,
  scale,
}: {
  draft: MerchantBusinessCardDraft;
  websiteUrl: string;
  qrCodeUrl: string;
  scale: number;
}) {
  const contacts = CONTACT_FIELDS.filter(({ key }) => normalizeText(draft.contacts[key]));
  return (
    <div style={{ width: `${draft.width * scale}px`, height: `${draft.height * scale}px` }}>
      <div
        style={{
          position: "relative",
          width: `${draft.width}px`,
          height: `${draft.height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          borderRadius: "28px",
          border: "1px solid rgba(15,23,42,.12)",
          background: draft.backgroundColor || "#f8fafc",
          boxShadow: "0 24px 60px rgba(15,23,42,.18)",
        }}
      >
        {draft.backgroundImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.backgroundImageUrl} alt={draft.name} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-white/12" />
        {TEXT_LAYOUT_FIELDS.filter(({ key }) => key === "merchantName" || (key === "title" && draft.title) || key === "website").map(({ key }) => {
          const value =
            key === "merchantName"
              ? draft.name
              : key === "title"
                ? draft.title
                : `${draft.websiteLabel || "扫码进入网站"}\n${websiteUrl.replace(/^https?:\/\//i, "")}`;
          const styleKey: MerchantBusinessCardTypographyKey =
            key === "merchantName" ? "name" : key === "title" ? "title" : "website";
          return (
            <div
              key={key}
              style={{
                position: "absolute",
                left: `${draft.textLayout[key].x}px`,
                top: `${draft.textLayout[key].y}px`,
                maxWidth: `${Math.max(160, draft.width - draft.textLayout[key].x - 36)}px`,
                ...typographyStyle(draft.typography[styleKey]),
              }}
            >
              {value}
            </div>
          );
        })}
        {contacts.map(({ key, label }) => (
          <div
            key={key}
            style={{
              position: "absolute",
              left: `${draft.textLayout[key].x}px`,
              top: `${draft.textLayout[key].y}px`,
              maxWidth: `${Math.max(160, draft.width - draft.textLayout[key].x - 36)}px`,
              ...typographyStyle(draft.typography.info),
            }}
          >
            {`${label}: ${draft.contacts[key]}`}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            left: `${draft.qr.x}px`,
            top: `${draft.qr.y}px`,
            width: `${draft.qr.size}px`,
            height: `${draft.qr.size}px`,
            padding: "10px",
            borderRadius: "18px",
            background: "#fff",
            boxShadow: "0 16px 36px rgba(15,23,42,.18)",
          }}
        >
          {qrCodeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrCodeUrl} alt="商户网站二维码" className="h-full w-full object-contain" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MerchantBusinessCardManager({ siteBaseDomain, profile, cards, onCardsChange }: MerchantBusinessCardManagerProps) {
  const [draft, setDraft] = useState(() => createDefaultMerchantBusinessCardDraft(profile));
  const [editorOpen, setEditorOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MerchantBusinessCardAsset | null>(null);
  const [tip, setTip] = useState("");
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const hiddenPreviewRef = useRef<HTMLDivElement | null>(null);

  const missingFields = useMemo(() => getMerchantBusinessCardRequiredFields(profile), [profile]);
  const canCreate = missingFields.length === 0;
  const websiteUrl = useMemo(
    () => buildMerchantDomain(siteBaseDomain, normalizeText(profile.domainPrefix), "https"),
    [siteBaseDomain, profile.domainPrefix],
  );
  const scale = useMemo(() => Math.min(1, 380 / Math.max(1, draft.width)), [draft.width]);
  const fullScale = useMemo(() => Math.min(1, 1000 / Math.max(1, draft.width)), [draft.width]);

  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(""), 2600);
    return () => window.clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    let cancelled = false;
    if (!websiteUrl) {
      setQrCodeUrl("");
      return;
    }
    void QRCode.toDataURL(websiteUrl, { width: clamp(draft.qr.size * 2, 96, 1200), margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [draft.qr.size, websiteUrl]);

  const applyDraft = (recipe: (current: MerchantBusinessCardDraft) => MerchantBusinessCardDraft) => {
    setDraft((current) => normalizeMerchantBusinessCardDraft(recipe(current)));
    setHasPreviewed(false);
  };

  const openEditor = () => {
    if (!canCreate) return;
    setDraft(createDefaultMerchantBusinessCardDraft(profile));
    setHasPreviewed(false);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setEditorOpen(true);
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      const imageUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      applyDraft((current) => ({ ...current, backgroundImageUrl: imageUrl }));
    } catch {
      setTip("背景图上传失败，请重试");
    } finally {
      event.target.value = "";
    }
  };

  const handleGenerate = async () => {
    const node = hiddenPreviewRef.current;
    if (!node || !websiteUrl || !qrCodeUrl || !hasPreviewed) return;
    setIsGenerating(true);
    try {
      const images = Array.from(node.querySelectorAll("img"));
      await Promise.all(images.map((image) => new Promise<void>((resolve) => {
        if (image.complete) return resolve();
        const done = () => resolve();
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
        window.setTimeout(done, 2200);
      })));
      if (typeof document.fonts?.ready?.then === "function") {
        await document.fonts.ready.catch(() => undefined);
      }
      const imageUrl = await toJpeg(node, { quality: 0.92, pixelRatio: 1, cacheBust: true, backgroundColor: "#ffffff" });
      const asset: MerchantBusinessCardAsset = {
        ...normalizeMerchantBusinessCardDraft(draft),
        id: createId("business-card"),
        createdAt: new Date().toISOString(),
        imageUrl,
      };
      onCardsChange([asset, ...cards]);
      setEditorOpen(false);
      setFolderOpen(true);
      setPreviewAsset(asset);
      setTip("名片已生成并保存到名片夹");
    } catch {
      setTip("名片生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">名片</div>
          <div className="text-xs text-slate-500">完善商户信息后可生成名片，二维码会自动跳转到商户网站。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={openEditor} disabled={!canCreate}>生成名片</button>
          <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={() => setFolderOpen(true)} disabled={cards.length === 0}>{`名片夹 (${cards.length})`}</button>
        </div>
      </div>
      {!canCreate ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{`需先完善以下商户信息后才能生成名片：${missingFields.join(" / ")}`}</div> : null}
      <div className="pointer-events-none fixed left-[-20000px] top-0"><div ref={hiddenPreviewRef}><CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={1} /></div></div>

      {editorOpen ? overlay(
        <div className="fixed inset-0 z-[2147482900] bg-black/45 p-4" onMouseDown={() => setEditorOpen(false)}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
              <div><div className="text-lg font-semibold text-slate-900">生成名片</div><div className="text-sm text-slate-500">先调整样式并预览，再生成图片保存到名片夹。</div></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewAsset(null); setHasPreviewed(true); setPreviewOpen(true); }}>预览</button>
                <button type="button" className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => { setHasPreviewed(true); void handleGenerate(); }} disabled={!websiteUrl || !qrCodeUrl || isGenerating || !hasPreviewed}>{isGenerating ? "生成中..." : "生成"}</button>
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setEditorOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,420px)]">
              <div className="min-h-0 overflow-y-auto px-5 py-5">
                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-900">基础设置</div>
                    <label className="block text-xs text-slate-600">名片名称<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.name} onChange={(event) => applyDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label className="block text-xs text-slate-600">职位<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.title} onChange={(event) => applyDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="block text-xs text-slate-600">比例<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.ratioMode} onChange={(event) => applyDraft((current) => ({ ...current, ratioMode: event.target.value as MerchantBusinessCardDraft["ratioMode"], ...(() => resolveRatioDimensions(event.target.value as MerchantBusinessCardDraft["ratioMode"], current.width, current.height))() }))}>{MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">自定义</option></select></label>
                      <label className="block text-xs text-slate-600">宽度<input type="number" min={320} max={1600} className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.width} onChange={(event) => handleSize(event.target.value, "width")} /></label>
                      <label className="block text-xs text-slate-600">高度<input type="number" min={180} max={1600} className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.height} onChange={(event) => handleSize(event.target.value, "height")} /></label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                      <label className="block text-xs text-slate-600">背景图<input type="file" accept="image/*" className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" onChange={(event) => void handleBackgroundUpload(event)} /></label>
                      <label className="block text-xs text-slate-600">背景色<input type="color" className="mt-1 h-[42px] w-full rounded border bg-white px-2 py-1" value={draft.backgroundColor} onChange={(event) => applyDraft((current) => ({ ...current, backgroundColor: event.target.value }))} /></label>
                    </div>
                    <label className="block text-xs text-slate-600">网站说明<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.websiteLabel} onChange={(event) => applyDraft((current) => ({ ...current, websiteLabel: event.target.value }))} /></label>
                    <div className="rounded border bg-white px-3 py-2 text-xs text-slate-500">{`当前二维码网址：${websiteUrl || "请先填写域名前缀"}`}</div>
                  </section>
                  <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-900">二维码</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {(["x", "y", "size"] as const).map((key) => <label key={key} className="block text-xs text-slate-600">{key === "size" ? "大小" : key.toUpperCase()}<input type="number" min={key === "size" ? 48 : 0} max={key === "size" ? 600 : 2000} className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.qr[key]} onChange={(event) => applyDraft((current) => ({ ...current, qr: { ...current.qr, [key]: clamp(Number(event.target.value) || 0, key === "size" ? 48 : 0, key === "size" ? 600 : 2000) } }))} /></label>)}
                    </div>
                    <div className="rounded-xl border bg-white p-4"><div className="mb-3 text-xs font-medium text-slate-500">二维码预览</div><div className="flex h-32 w-32 items-center justify-center rounded-xl border bg-slate-50 p-2">{qrCodeUrl ? <img src={qrCodeUrl} alt="二维码预览" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">暂无二维码</span>}</div></div>
                  </section>
                  <section className="space-y-3 rounded-xl border bg-slate-50 p-4 xl:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">联系方式</div>
                    <div className="grid gap-3 md:grid-cols-2">{CONTACT_FIELDS.map(({ key, label }) => <label key={key} className="block text-xs text-slate-600">{label}<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.contacts[key]} onChange={(event) => applyDraft((current) => ({ ...current, contacts: { ...current.contacts, [key]: event.target.value } }))} placeholder={`请输入${label}`} /></label>)}</div>
                  </section>
                  <section className="space-y-4 rounded-xl border bg-slate-50 p-4 xl:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">位置与字体样式</div>
                    <div className="grid gap-3 lg:grid-cols-2">{TYPOGRAPHY_FIELDS.map(({ key, label }) => <div key={key} className="space-y-3 rounded-xl border bg-white p-4"><div className="text-sm font-medium text-slate-900">{label}</div><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]"><label className="block text-xs text-slate-600">字体<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.typography[key].fontFamily || ""} onChange={(event) => updateTypography(key, { fontFamily: event.target.value })}>{FONT_FAMILY_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}</select></label><label className="block text-xs text-slate-600">字号<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.typography[key].fontSize} onChange={(event) => updateTypography(key, { fontSize: Number(event.target.value) })}>{FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div><div className="grid gap-3 md:grid-cols-[120px_repeat(3,minmax(0,1fr))]"><label className="block text-xs text-slate-600">颜色<input type="color" className="mt-1 h-[42px] w-full rounded border bg-white px-2 py-1" value={draft.typography[key].fontColor || "#0f172a"} onChange={(event) => updateTypography(key, { fontColor: event.target.value })} /></label><label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(draft.typography[key].fontWeight) === "bold"} onChange={(event) => updateTypography(key, { fontWeight: event.target.checked ? "bold" : "normal" })} />加粗</label><label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(draft.typography[key].fontStyle) === "italic"} onChange={(event) => updateTypography(key, { fontStyle: event.target.checked ? "italic" : "normal" })} />斜体</label><label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(draft.typography[key].textDecoration) === "underline"} onChange={(event) => updateTypography(key, { textDecoration: event.target.checked ? "underline" : "none" })} />下划线</label></div></div>)}</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{TEXT_LAYOUT_FIELDS.map(({ key, label }) => <div key={key} className="rounded-xl border bg-white p-3"><div className="mb-2 text-xs font-medium text-slate-700">{label}</div><div className="grid grid-cols-2 gap-2">{(["x", "y"] as const).map((axis) => <label key={axis} className="block text-xs text-slate-600">{axis.toUpperCase()}<input type="number" className="mt-1 w-full rounded border bg-white px-2 py-2 text-sm" value={draft.textLayout[key][axis]} onChange={(event) => applyDraft((current) => ({ ...current, textLayout: { ...current.textLayout, [key]: { ...current.textLayout[key], [axis]: clamp(Number(event.target.value) || 0, 0, 2000) } } }))} /></label>)}</div></div>)}</div>
                  </section>
                </div>
              </div>
              <aside className="min-h-0 overflow-y-auto border-l bg-slate-50 px-5 py-5"><div className="sticky top-0 space-y-4"><div><div className="text-sm font-semibold text-slate-900">实时预览</div><div className="text-xs text-slate-500">先点击“预览”确认样式，再点击“生成”。</div></div><div className="overflow-hidden rounded-2xl border bg-slate-900/5 p-4"><CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={scale} /></div>{!hasPreviewed ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">先点击“预览”，再生成名片。</div> : null}</div></aside>
            </div>
          </div>
        </div>,
      ) : null}

      {folderOpen ? overlay(
        <div className="fixed inset-0 z-[2147483000] bg-black/45 p-4" onMouseDown={() => setFolderOpen(false)}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4"><div><div className="text-lg font-semibold text-slate-900">名片夹</div><div className="text-sm text-slate-500">查看已生成的名片图片，可预览或复制。</div></div><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setFolderOpen(false)}>关闭</button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{cards.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map((card) => <article key={card.id} className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm"><div className="space-y-4 p-4"><div className="overflow-hidden rounded-2xl border bg-slate-100"><img src={card.imageUrl} alt={card.name} className="h-auto w-full object-cover" /></div><div><div className="text-base font-semibold text-slate-900">{card.name}</div><div className="text-xs text-slate-500">{new Date(card.createdAt).toLocaleString("zh-CN", { hour12: false })}</div></div><div className="flex gap-2"><button type="button" className="flex-1 rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewAsset(card); setPreviewOpen(true); }}>预览</button><button type="button" className="flex-1 rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800" onClick={() => void copyCard(card)}>复制</button></div></div></article>)}</div> : <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">还没有生成名片。先去点击“生成名片”制作一张。</div>}</div>
          </div>
        </div>,
      ) : null}

      {previewOpen ? overlay(
        <div className="fixed inset-0 z-[2147483100] bg-black/65 p-4" onMouseDown={() => { setPreviewOpen(false); setPreviewAsset(null); }}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4"><div className="text-base font-semibold text-slate-900">{previewAsset?.name || draft.name || "名片预览"}</div><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewOpen(false); setPreviewAsset(null); }}>关闭</button></div>
            <div className="flex-1 overflow-auto bg-black p-4"><div className="mx-auto flex min-h-full items-start justify-center">{previewAsset ? <img src={previewAsset.imageUrl} alt={previewAsset.name} className="h-auto max-w-full rounded-xl object-contain" /> : <CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={fullScale} />}</div></div>
          </div>
        </div>,
      ) : null}

      {tip ? overlay(<div className="pointer-events-none fixed inset-0 z-[2147483200] flex items-center justify-center p-4"><div className="rounded-lg bg-black/85 px-4 py-2 text-sm text-white shadow-lg">{tip}</div></div>) : null}
    </div>
  );

  function resolveRatioDimensions(
    ratioMode: MerchantBusinessCardDraft["ratioMode"],
    width: number,
    height: number,
  ) {
    if (ratioMode === "custom") return { width, height };
    const ratio = MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.find((item) => item.id === ratioMode);
    if (!ratio) return { width, height };
    return { width, height: Math.max(180, Math.round((width * ratio.height) / ratio.width)) };
  }

  function handleSize(raw: string, field: "width" | "height") {
    const nextValue = clamp(Number(raw) || 0, field === "width" ? 320 : 180, 1600);
    applyDraft((current) => {
      if (current.ratioMode === "custom") return { ...current, [field]: nextValue };
      const next = resolveRatioDimensions(
        current.ratioMode,
        field === "width" ? nextValue : current.width,
        field === "height" ? nextValue : current.height,
      );
      return { ...current, width: next.width, height: next.height };
    });
  }

  function updateTypography(
    key: MerchantBusinessCardTypographyKey,
    patch: Partial<MerchantBusinessCardDraft["typography"][MerchantBusinessCardTypographyKey]>,
  ) {
    applyDraft((current) => ({
      ...current,
      typography: {
        ...current.typography,
        [key]: {
          ...current.typography[key],
          ...patch,
        },
      },
    }));
  }

  async function copyCard(card: MerchantBusinessCardAsset) {
    try {
      const response = await fetch(card.imageUrl);
      const blob = await response.blob();
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function" &&
        typeof ClipboardItem !== "undefined"
      ) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/jpeg"]: blob })]);
        setTip("名片图片已复制到剪贴板");
        return;
      }
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(card.imageUrl);
        setTip("当前环境不支持复制图片，已复制图片地址");
        return;
      }
      setTip("当前环境不支持复制，请预览后长按保存");
    } catch {
      setTip("复制失败，请重试");
    }
  }
}
