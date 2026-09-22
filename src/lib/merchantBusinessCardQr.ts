import { businessCardQrFrameGeometry, normalizeBusinessCardQrDecoration, normalizeBusinessCardQrFrame, renderBusinessCardQrFrame, renderBusinessCardQrIcon, type BusinessCardQrDecoration } from "./merchantBusinessCardQrDecorations";

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
export type BusinessCardQrAppearance = BusinessCardQrDecoration & { style?: BusinessCardQrStyle; color?: string; backgroundColor?: string; showCaption?: boolean; caption?: string };

export function normalizeBusinessCardQrBackground(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#ffffff";
}

export function normalizeBusinessCardQrCaption(value: unknown): string {
  return Array.from(typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim() : "扫码了解更多").slice(0, BUSINESS_CARD_QR_CAPTION_MAX_LENGTH).join("");
}

export function businessCardQrAspectRatio(options: BusinessCardQrAppearance): number {
  if (normalizeBusinessCardQrFrame(options.frame) !== "none") return 1.14;
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

// Small H-level logo badge, never covering a functional module (including central alignment).
// Dense versions may need a slight offset. Only a fixed built-in vector is permitted inside.
export function businessCardQrIconBox(matrix: BusinessCardQrMatrix, expanded = false): { row: number; col: number; size: number } | null {
  for (let size = Math.min(11, Math.floor(matrix.size * (expanded ? 0.25 : 0.18))) | 1; size >= 3; size -= 2) {
    let best: { row: number; col: number; size: number; distance: number } | undefined;
    const center = (matrix.size - size) / 2;
    const reach = Math.ceil(matrix.size * 0.2);
    for (let row = Math.max(8, Math.floor(center - reach)); row <= Math.min(matrix.size - size - 8, Math.ceil(center + reach)); row++) {
      for (let col = Math.max(8, Math.floor(center - reach)); col <= Math.min(matrix.size - size - 8, Math.ceil(center + reach)); col++) {
        const distance = (row - center) ** 2 + (col - center) ** 2;
        if (best && distance >= best.distance) continue;
        let safe = true;
        for (let y = row; y < row + size && safe; y++) for (let x = col; x < col + size; x++) if (matrix.isReserved(y, x)) { safe = false; break; }
        if (safe) best = { row, col, size, distance };
      }
    }
    if (best) return { row: best.row, col: best.col, size: best.size };
  }
  return null;
}

// Keep all structural modules intact, including finders, alignment, timing and format bits.
// Styling applies only to data modules; every output retains an opaque four-module quiet zone.
export function renderBusinessCardQrSvg(
  matrix: BusinessCardQrMatrix,
  options: BusinessCardQrAppearance & { size?: number } = {},
): string {
  const requestedStyle = normalizeBusinessCardQrStyle(options.style);
  const roundedFinder = requestedStyle.startsWith("finder-") && matrix.size >= 21;
  const style = ({ "finder-soft": "classic", "finder-rounded": "rounded", "finder-dots": "dots", "finder-pill": "horizontal-pill", "finder-soft-ring": "soft", "finder-tiles": "tiles" } as Record<string, string>)[requestedStyle] ?? requestedStyle;
  const decoration = normalizeBusinessCardQrDecoration(options);
  const color = normalizeBusinessCardQrColor(options.color);
  const background = normalizeBusinessCardQrBackground(options.backgroundColor);
  const caption = options.showCaption ? normalizeBusinessCardQrCaption(options.caption) : "";
  const ratio = businessCardQrAspectRatio({ ...options, frame: "none" });
  const size = Math.round(Math.max(64, Math.min(4096, options.size || 1024)));
  const extent = matrix.size + 8;
  const height = Math.round(size * ratio);
  const viewHeight = extent * height / size;
  const shapes: string[] = [];
  const squarePaths: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.get(row, col)) continue;
      if (roundedFinder && ((row < 7 && (col < 7 || col >= matrix.size - 7)) || (row >= matrix.size - 7 && col < 7))) continue;
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
  const expandedIcon = /^(studio|industry)-/.test(decoration.icon);
  const badge = decoration.icon !== "none" ? businessCardQrIconBox(matrix, expandedIcon) : null;
  const iconColor = decoration.iconFollowColor ? color : decoration.iconColor;
  const iconSvg = badge ? `<g data-qr-icon="${decoration.icon}"><rect x="${badge.col + 4}" y="${badge.row + 4}" width="${badge.size}" height="${badge.size}" fill="${background}"/>${renderBusinessCardQrIcon(decoration.icon, iconColor).replace('<svg ', `<svg x="${badge.col + 4.45}" y="${badge.row + 4.45}" width="${badge.size - 0.9}" height="${badge.size - 0.9}" `)}</g>` : "";
  const finderSvg = roundedFinder ? [[4, 4], [matrix.size - 3, 4], [4, matrix.size - 3]].map(([x, y]) => {
    const radius = requestedStyle === "finder-soft-ring" ? 0.8 : 1.7;
    return `<g data-qr-finder="rounded"><rect x="${x}" y="${y}" width="7" height="7" rx="${radius}" fill="${color}"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="${radius * 0.7}" fill="${background}"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${radius * 0.4}" fill="${color}"/></g>`;
  }).join("") : "";
  const modulesSvg = `<g fill="${color}"><path d="${squarePaths.join("")}"/>${shapes.join("")}</g>${finderSvg}${iconSvg}`;
  if (decoration.frame === "none") return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${extent} ${viewHeight}" preserveAspectRatio="none"><rect width="${extent}" height="${viewHeight}" fill="${background}"/>${modulesSvg}${captionSvg}</svg>`;
  const geometry = businessCardQrFrameGeometry(decoration.framePadding, decoration.frame);
  const frame = renderBusinessCardQrFrame(decoration);
  const frameFont = Math.min(36, ("captionWidth" in geometry ? geometry.captionWidth : 480) / Math.max(1, textUnits));
  const darkText = isBusinessCardQrColorReadable(decoration.frameColor, decoration.frameBackgroundColor) ? decoration.frameColor : luminance(decoration.frameBackgroundColor) > 0.4 ? "#000000" : "#ffffff";
  const barText = luminance(decoration.frameColor) > 0.4 ? "#000000" : "#ffffff";
  const text = (y: number, fill: string) => `<text x="500" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${frameFont}" fill="${fill}">${escapedCaption}</text>`;
  let frameCaption = "";
  if (caption) {
    if (decoration.frame === "ring") frameCaption = `<defs><path id="qr-caption-arc" d="M180 200Q500 10 820 200"/></defs><text font-family="Arial, Microsoft YaHei, sans-serif" font-size="${frameFont}" fill="${darkText}" text-anchor="middle"><textPath href="#qr-caption-arc" startOffset="50%">${escapedCaption}</textPath></text>`;
    else {
      if ("captionX" in geometry) frameCaption = `<text x="${geometry.captionX}" y="${geometry.captionY}" text-anchor="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${frameFont}" fill="${darkText}">${escapedCaption}</text>`;
      else {
        if (["top", "both"].includes(decoration.frame)) frameCaption += text(155, barText);
        if (decoration.frame !== "top") frameCaption += text(932, ["bottom", "both", "business", "ribbon", "car", "phone"].includes(decoration.frame) ? barText : darkText);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 1.14)}" viewBox="0 0 1000 1140" preserveAspectRatio="none"><rect width="1000" height="1140" fill="${background}"/>${frame}<svg x="${geometry.x}" y="${geometry.y}" width="${geometry.side}" height="${geometry.side}" viewBox="0 0 ${extent} ${extent}"><rect width="${extent}" height="${extent}" fill="${background}"/>${modulesSvg}</svg>${frameCaption}</svg>`;
}
