export const BUSINESS_CARD_QR_TEXT_FONTS = [
  { id: "kuaile", label: "快乐体 · 活泼手绘", file: "ZCOOLKuaiLe-Regular.ttf" },
  { id: "huangyou", label: "黄油体 · 圆润海报", file: "ZCOOLQingKeHuangYou-Regular.ttf" },
  { id: "xiaowei", label: "小薇体 · 文艺宋体", file: "ZCOOLXiaoWei-Regular.ttf" },
  { id: "mashan", label: "马善政 · 毛笔书法", file: "MaShanZheng-Regular.ttf" },
  { id: "zhimang", label: "志莽行 · 飘逸行书", file: "ZhiMangXing-Regular.ttf" },
  { id: "pacifico", label: "Pacifico · 西文手写", file: "Pacifico-Regular.ttf" },
  { id: "lobster", label: "Lobster · 西文复古", file: "Lobster-Regular.ttf" },
  { id: "bangers", label: "Bangers · 西文漫画", file: "Bangers-Regular.ttf" },
  { id: "greatvibes", label: "Great Vibes · 西文花体", file: "GreatVibes-Regular.ttf" },
] as const;
export type BusinessCardQrTextFont = typeof BUSINESS_CARD_QR_TEXT_FONTS[number]["id"];
export type BusinessCardQrText = { enabled: boolean; text: string; font: BusinessCardQrTextFont; fontSize: number; color: string };
export type BusinessCardQrTextOptions = { topText?: BusinessCardQrText; bottomText?: BusinessCardQrText };

export function normalizeBusinessCardQrText(value: unknown, defaults: Partial<BusinessCardQrText> = {}): BusinessCardQrText {
  const source = value && typeof value === "object" ? value as Partial<BusinessCardQrText> : {};
  const fontSize = Number(source.fontSize ?? defaults.fontSize ?? 22);
  return {
    enabled: source.enabled === true,
    text: Array.from(String(source.text ?? defaults.text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ")).slice(0, 24).join(""),
    font: BUSINESS_CARD_QR_TEXT_FONTS.find(f => f.id === source.font)?.id ?? defaults.font ?? "kuaile",
    fontSize: Number.isFinite(fontSize) ? Math.max(12, Math.min(64, Math.round(fontSize))) : 22,
    color: typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color) ? source.color.toLowerCase() : defaults.color ?? "#000000",
  };
}

export function businessCardQrTextBand(value: BusinessCardQrText | undefined): number {
  const text = normalizeBusinessCardQrText(value);
  return text.enabled && text.text.trim() ? Math.ceil(text.fontSize * 1000 / 300 * 1.6 + 40) : 0;
}

export function hasBusinessCardQrText(options: BusinessCardQrTextOptions): boolean {
  return options.topText !== undefined || options.bottomText !== undefined;
}

// Existing cards retain their exact legacy renderer until the user edits a text control.
export function editableBusinessCardQrTexts(options: BusinessCardQrTextOptions & { showCaption?: boolean; caption?: string; color?: string }): Required<BusinessCardQrTextOptions> {
  return {
    topText: normalizeBusinessCardQrText(options.topText),
    bottomText: normalizeBusinessCardQrText(options.bottomText ?? { enabled: options.showCaption === true, text: options.caption ?? "扫码了解更多", color: options.color }),
  };
}

export function escapeBusinessCardQrText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
