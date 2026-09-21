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
] as const;

export type BusinessCardQrStyle = (typeof BUSINESS_CARD_QR_STYLES)[number]["id"];
export const BUSINESS_CARD_QR_COLORS = ["#000000", "#0f172a", "#334155", "#1e3a8a", "#1d4ed8", "#075985", "#115e59", "#166534", "#713f12", "#9f1239", "#7e22ce", "#581c87"];
export const BUSINESS_CARD_QR_BACKGROUNDS = ["#ffffff", "#f8fafc", "#e2e8f0", "#eff6ff", "#dbeafe", "#ecfeff", "#f0fdfa", "#f0fdf4", "#fefce8", "#fff7ed", "#fff1f2", "#faf5ff"];
export const BUSINESS_CARD_QR_CAPTION_MAX_LENGTH = 24;
export type BusinessCardQrAppearance = { style?: BusinessCardQrStyle; color?: string; backgroundColor?: string; showCaption?: boolean; caption?: string };

export function normalizeBusinessCardQrBackground(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#ffffff";
}

export function normalizeBusinessCardQrCaption(value: unknown): string {
  return Array.from(typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "扫码了解更多").slice(0, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH).join("");
}

export function businessCardQrAspectRatio(options: BusinessCardQrAppearance): number {
  return options.showCaption && normalizeBusinessCardQrCaption(options.caption) ? 1.16 : 1;
}

export function normalizeBusinessCardQrStyle(value: unknown): BusinessCardQrStyle {
  return BUSINESS_CARD_QR_STYLES.find((style) => style.id === value)?.id ?? "classic";
}

export function normalizeBusinessCardQrColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => {
    const channel = parseInt(color.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function isBusinessCardQrColorReadable(value: string, background?: string): boolean {
  // Require dark modules on a lighter background, not merely inverted contrast.
  return (luminance(normalizeBusinessCardQrBackground(background)) + 0.05) / (luminance(normalizeBusinessCardQrColor(value)) + 0.05) >= 4.5;
}

export type BusinessCardQrMatrix = {
  size: number;
  get: (row: number, col: number) => number;
  isReserved: (row: number, col: number) => number;
};

// Keep all structural modules intact, including finders, alignment, timing and format bits.
// Styling applies only to data modules; every output retains an opaque four-module quiet zone.
export function renderBusinessCardQrSvg(
  matrix: BusinessCardQrMatrix,
  options: BusinessCardQrAppearance & { size?: number } = {},
): string {
  const style = normalizeBusinessCardQrStyle(options.style);
  const color = normalizeBusinessCardQrColor(options.color);
  const background = normalizeBusinessCardQrBackground(options.backgroundColor);
  const caption = options.showCaption ? normalizeBusinessCardQrCaption(options.caption) : "";
  const ratio = businessCardQrAspectRatio(options);
  const size = Math.round(Math.max(64, Math.min(4096, options.size || 1024)));
  const extent = matrix.size + 8;
  const height = Math.round(size * ratio);
  const viewHeight = extent * height / size;
  const shapes: string[] = [];
  const squarePaths: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.get(row, col)) continue;
      const x = col + 4;
      const y = row + 4;
      const reserved = matrix.isReserved(row, col);
      const rect = (rx: number, dx = 0, dy = 0, width = 1, height = 1) =>
        `<rect x="${x + dx}" y="${y + dy}" width="${width}" height="${height}" rx="${rx}"/>`;
      // One compound path prevents antialiased seams between touching structural modules.
      if (reserved || style === "classic") squarePaths.push(`M${x} ${y}h1v1h-1Z`);
      else if (style === "soft") shapes.push(rect(0.16));
      else if (style === "rounded") shapes.push(rect(0.36));
      else if (style === "dots") shapes.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.5"/>`);
      else if (style === "diamond") shapes.push(`<path d="M${x + 0.5} ${y}l.5 .5-.5 .5-.5-.5Z"/>`);
      else if (style === "tiles") shapes.push(rect(0.05, 0.07, 0.07, 0.86, 0.86));
      else if (style === "horizontal") shapes.push(rect(0, 0, 0.1, 1, 0.8));
      else if (style === "vertical") shapes.push(rect(0, 0.1, 0, 0.8, 1));
      else if (style === "horizontal-pill") {
        let length = 1;
        while (col + length < matrix.size && matrix.get(row, col + length) && !matrix.isReserved(row, col + length)) length += 1;
        shapes.push(rect(0.4, 0, 0.1, length, 0.8));
        col += length - 1;
      } else if (style === "vertical-pill") {
        if (row > 0 && matrix.get(row - 1, col) && !matrix.isReserved(row - 1, col)) continue;
        let length = 1;
        while (row + length < matrix.size && matrix.get(row + length, col) && !matrix.isReserved(row + length, col)) length += 1;
        shapes.push(rect(0.4, 0.1, 0, 0.8, length));
      }
    }
  }
  const textUnits = Array.from(caption).reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? 1 : 0.65), 0);
  const fontSize = Math.min(extent * 0.055, (extent - 8) / Math.max(1, textUnits));
  const escapedCaption = caption.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  // Caption sits below the full four-module quiet zone; it never covers QR modules.
  const captionSvg = caption ? `<text x="${extent / 2}" y="${extent * 1.08}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${fontSize}" fill="${color}">${escapedCaption}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${extent} ${viewHeight}" preserveAspectRatio="none"><rect width="${extent}" height="${viewHeight}" fill="${background}"/><g fill="${color}"><path d="${squarePaths.join("")}"/>${shapes.join("")}</g>${captionSvg}</svg>`;
}
