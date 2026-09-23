import type { MerchantBusinessCardAsset } from "./merchantBusinessCards";
import type { BusinessCardQrAppearance } from "./merchantBusinessCardQr";
import { normalizeBusinessCardQrDecoration } from "./merchantBusinessCardQrDecorations";
import { resolveBusinessCardScanTarget } from "./merchantBusinessCardDestination";

export type BusinessCardQrExportSession = {
  cardId: string;
  cardName: string;
  targetUrl: string;
  destinationLabel: string;
  disabledReason: string;
  appearance: BusinessCardQrAppearance;
};

// Deliberately exclude card coordinates/size and detach nested text settings.
// This is an export draft, not a business-card draft or a persistence payload.
export function copyBusinessCardQrAppearance(qr: BusinessCardQrAppearance): BusinessCardQrAppearance {
  return {
    ...normalizeBusinessCardQrDecoration(qr),
    style: qr.style,
    color: qr.color,
    backgroundColor: qr.backgroundColor,
    showCaption: qr.showCaption,
    caption: qr.caption,
    ...(qr.topText ? { topText: { ...qr.topText } } : {}),
    ...(qr.bottomText ? { bottomText: { ...qr.bottomText } } : {}),
  };
}

export function createBusinessCardQrExportSession(
  card: MerchantBusinessCardAsset,
  assignedWebsite: string,
  existingContactUrl: string,
): BusinessCardQrExportSession {
  const targetUrl = resolveBusinessCardScanTarget(card, card.targetUrl.trim() || assignedWebsite, existingContactUrl);
  return {
    cardId: card.id,
    cardName: card.name || "未命名名片",
    targetUrl,
    destinationLabel: card.mode === "link" ? "联系卡" : "网站地址",
    disabledReason: targetUrl ? "" : card.mode === "link"
      ? "这张名片尚无可用的联系卡链接，请先返回名片夹生成联系卡链接。"
      : "这张名片的网站地址无效，请先在名片中修正网址。",
    appearance: copyBusinessCardQrAppearance(card.qr),
  };
}
