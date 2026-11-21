// Small, self-contained raster only: no external requests or executable SVG in
// generated QR files. Old cards omit this optional field and stay byte-identical.
export const BUSINESS_CARD_QR_IMAGE_MAX_BYTES = 24 * 1024;
export const BUSINESS_CARD_QR_IMAGE_MAX_SIDE = 128;
export const BUSINESS_CARD_QR_IMAGE_FILE_MAX_BYTES = 8 * 1024 * 1024;

export function normalizeBusinessCardQrImage(value: unknown): string {
  if (typeof value !== "string") return "";
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix) || value.length > prefix.length + 4 * Math.ceil(BUSINESS_CARD_QR_IMAGE_MAX_BYTES / 3)) return "";
  const encoded = value.slice(prefix.length);
  if (encoded.length < 88 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  const bytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > BUSINESS_CARD_QR_IMAGE_MAX_BYTES) return "";
  try {
    const header = atob(encoded.slice(0, 44));
    if (header.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || header.slice(12, 16) !== "IHDR") return "";
    const dimension = (start: number) => Array.from(header.slice(start, start + 4)).reduce((n, c) => n * 256 + c.charCodeAt(0), 0);
    const width = dimension(16), height = dimension(20);
    if (width < 1 || height < 1 || width > BUSINESS_CARD_QR_IMAGE_MAX_SIDE || height > BUSINESS_CARD_QR_IMAGE_MAX_SIDE) return "";
    return value;
  } catch { return ""; }
}

export function isBusinessCardQrUploadRaster(bytes: Uint8Array) {
  return bytes.length >= 12 && (
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
  );
}
