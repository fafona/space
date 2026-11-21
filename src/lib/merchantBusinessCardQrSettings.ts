// Lightweight saved-setting normalization. Artwork belongs to deferred renderers.
import { BUSINESS_CARD_QR_FRAME_IDS, BUSINESS_CARD_QR_ICON_IDS } from "./merchantBusinessCardQrPresetIds";
import { normalizeBusinessCardQrImage } from "./merchantBusinessCardQrImage";
import type { BusinessCardQrDecoration, BusinessCardQrFrame, BusinessCardQrIcon } from "./merchantBusinessCardQrDecorations";
export type { BusinessCardQrDecoration, BusinessCardQrFrame, BusinessCardQrIcon } from "./merchantBusinessCardQrDecorations";

export const BUSINESS_CARD_QR_STYLES = [
  { id: "classic", label: "经典方格" },
  { id: "soft", label: "柔和方格" },
  { id: "rounded", label: "圆润方格" },
  { id: "dots", label: "圆点" },
  { id: "diamond", label: "菱形" },
  { id: "horizontal", label: "横向线条" },
  { id: "vertical", label: "纵向线条" },
  { id: "horizontal-pill", label: "横向胶囊" },
  { id: "vertical-pill", label: "纵向胶囊" },
  { id: "tiles", label: "精致方块" },
  { id: "finder-soft", label: "圆角定位·经典方格" },
  { id: "finder-rounded", label: "圆角定位·圆润方格" },
  { id: "finder-dots", label: "圆角定位·圆点" },
  { id: "finder-pill", label: "圆角定位·横向胶囊" },
  { id: "finder-soft-ring", label: "柔角定位·柔和方格" },
  { id: "finder-tiles", label: "圆角定位·精致方块" },
] as const;

export type BusinessCardQrStyle = (typeof BUSINESS_CARD_QR_STYLES)[number]["id"];
export const BUSINESS_CARD_QR_COLORS = ["#000000", "#0f172a", "#334155", "#1e3a8a", "#1d4ed8", "#075985", "#115e59", "#166534", "#713f12", "#9f1239", "#7e22ce", "#581c87"];
export const BUSINESS_CARD_QR_BACKGROUNDS = ["#ffffff", "#f8fafc", "#e2e8f0", "#eff6ff", "#dbeafe", "#ecfeff", "#f0fdfa", "#f0fdf4", "#fefce8", "#fff7ed", "#fff1f2", "#faf5ff"];
export const BUSINESS_CARD_QR_CAPTION_MAX_LENGTH = 24;

export function normalizeBusinessCardQrBackground(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#ffffff";
}

export function normalizeBusinessCardQrCaption(value: unknown): string {
  return Array.from(typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "扫码了解更多").slice(0, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH).join("");
}

export function normalizeBusinessCardQrStyle(value: unknown): BusinessCardQrStyle {
  return BUSINESS_CARD_QR_STYLES.find((style) => style.id === value)?.id ?? "classic";
}

export function normalizeBusinessCardQrColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
}

export const normalizeBusinessCardQrIcon = (v: unknown): BusinessCardQrIcon => BUSINESS_CARD_QR_ICON_IDS.find(id => id === v) ?? "none";
export const normalizeBusinessCardQrFrame = (v: unknown): BusinessCardQrFrame => BUSINESS_CARD_QR_FRAME_IDS.find(id => id === v) ?? "none";
const hex = (v: unknown, fallback: string) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
const bounded = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
export function normalizeBusinessCardQrDecoration(input: BusinessCardQrDecoration | null = {}): Required<Omit<BusinessCardQrDecoration, "iconImageDataUrl">> & Pick<BusinessCardQrDecoration, "iconImageDataUrl"> {
  const v = input && typeof input === "object" ? input : {};
  const image = normalizeBusinessCardQrImage(v.iconImageDataUrl);
  return { icon: normalizeBusinessCardQrIcon(v.icon), iconColor: hex(v.iconColor, "#000000"), iconFollowColor: v.iconFollowColor !== false,
    frame: normalizeBusinessCardQrFrame(v.frame), frameColor: hex(v.frameColor, "#1e3a8a"), frameBackgroundColor: hex(v.frameBackgroundColor, "#ffffff"),
    frameWidth: bounded(v.frameWidth, 2, 1, 4), framePadding: bounded(v.framePadding, 16, 8, 32),
    ...(image ? { iconImageDataUrl: image } : {}) };
}
