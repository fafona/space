import { isBusinessCardQrColorReadable, normalizeBusinessCardQrColor, type BusinessCardQrAppearance } from "./merchantBusinessCardQr";
import { normalizeBusinessCardQrDecoration } from "./merchantBusinessCardQrDecorations";

export type BusinessCardQrColorTarget = "qr" | "icon" | "frame";
export function businessCardQrTargetColor(value: BusinessCardQrAppearance, target: BusinessCardQrColorTarget): string {
  const decoration = normalizeBusinessCardQrDecoration(value);
  if (target === "frame") return decoration.frameColor;
  if (target === "icon" && !decoration.iconFollowColor) return decoration.iconColor;
  return normalizeBusinessCardQrColor(value.color);
}

// Palette changes are atomic and preserve unselected effective colors.
export function businessCardQrColorPatch(value: BusinessCardQrAppearance, targets: readonly BusinessCardQrColorTarget[], color: string): { patch: BusinessCardQrAppearance; error?: never } | { error: string; patch?: never } {
  if (!targets.length) return { error: "请先选择要设置颜色的项目。" };
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: "请选择有效的六位颜色值。" };
  const next = color.toLowerCase();
  if (targets.includes("qr") && !isBusinessCardQrColorReadable(next, value.backgroundColor)) return { error: "所选颜色与二维码背景对比度不足，本次选择的项目均未更改。请使用深色，或取消勾选二维码。" };
  const patch: BusinessCardQrAppearance = {};
  if (targets.includes("qr")) {
    patch.color = next;
    if (!targets.includes("icon") && normalizeBusinessCardQrDecoration(value).iconFollowColor) {
      patch.iconFollowColor = false;
      patch.iconColor = normalizeBusinessCardQrColor(value.color);
    }
  }
  if (targets.includes("icon")) { patch.iconColor = next; patch.iconFollowColor = false; }
  if (targets.includes("frame")) patch.frameColor = next;
  return { patch };
}
