// Percent of the original center artwork, not the QR code's overall size.
export const BUSINESS_CARD_QR_CENTER_SCALE_MIN = 50;
export const BUSINESS_CARD_QR_CENTER_SCALE_MAX = 150;
export const BUSINESS_CARD_QR_UPLOADED_CENTER_SCALE = 130;

export function normalizeBusinessCardQrCenterScale(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(BUSINESS_CARD_QR_CENTER_SCALE_MIN, Math.min(BUSINESS_CARD_QR_CENTER_SCALE_MAX, Math.round(value)))
    : undefined;
}

export function businessCardQrCenterScale(value: unknown, uploaded = false): number {
  return normalizeBusinessCardQrCenterScale(value) ?? (uploaded ? BUSINESS_CARD_QR_UPLOADED_CENTER_SCALE : 100);
}
