import { BUSINESS_CARD_QR_INDUSTRY_ICONS } from "./merchantBusinessCardQrIndustry";
import { BUSINESS_CARD_QR_STUDIO_FRAMES } from "./merchantBusinessCardQrStudioAssets";

const GEOMETRIC_FRAMES = [
  { id: "rounded-corners", label: "圆边四角框", group: "圆角几何" },
  { id: "rounded-double", label: "圆边双线框", group: "圆角几何" },
  { id: "rounded-capsule", label: "圆边胶囊框", group: "圆角几何" },
  { id: "rounded-dashed", label: "圆边虚线框", group: "圆角几何" },
  { id: "rounded-offset", label: "圆边叠影框", group: "圆角几何" },
  { id: "rounded-tab", label: "圆边页签框", group: "圆角几何" },
  { id: "rounded-arch", label: "拱门圆边框", group: "圆角几何" },
  { id: "rounded-label", label: "圆边底签框", group: "圆角几何" },
] as const;

// Industry themes combine a distinct industry emblem with one of eight named layouts.
// They are not represented as 200 different silhouette geometries.
const layouts = ["铭牌", "拱门", "吊牌", "票券", "圆角", "双线", "徽章", "书签"];
export const BUSINESS_CARD_QR_THEME_FRAMES = BUSINESS_CARD_QR_INDUSTRY_ICONS.filter(i => i.id.startsWith("industry-")).map((icon, index) => ({
  id: `theme-${icon.id}`, label: `${icon.label}·${layouts[index % layouts.length]}框`, group: icon.group,
  icon: icon.id, layout: index % layouts.length,
}));
export const BUSINESS_CARD_QR_EXPANDED_FRAMES = [
  ...BUSINESS_CARD_QR_STUDIO_FRAMES.map(({ id, label, group }) => ({ id, label, group })),
  ...GEOMETRIC_FRAMES, ...BUSINESS_CARD_QR_THEME_FRAMES,
];

export function businessCardQrStudioFrameGeometry(frame: string, padding: number) {
  const studio = BUSINESS_CARD_QR_STUDIO_FRAMES.find(i => i.id === frame);
  if (!studio) return null;
  const inset = (padding - 16) * 2;
  return { x: studio.qr.x + inset, y: studio.qr.y + inset, side: studio.qr.side - inset * 2, width: 1000, height: 1140,
    captionX: studio.caption.x, captionY: studio.caption.y, captionWidth: 360 };
}

function blend(a: string, b: string, amount: number) {
  return "#" + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, "0")).join("");
}

export function renderBusinessCardQrExpandedFrame(frame: string, color: string, background: string, width: number): string | null {
  const studio = BUSINESS_CARD_QR_STUDIO_FRAMES.find(i => i.id === frame);
  if (studio) {
    const body = studio.body.replace(/#[0-9a-f]{3,6}\b/gi, raw => {
      const v = raw.length === 4 ? "#" + raw.slice(1).split("").map(c => c + c).join("") : raw;
      const brightness = [1, 3, 5].reduce((sum, i) => sum + parseInt(v.slice(i, i + 2), 16), 0) / 765;
      if (brightness > 0.98) return background;
      if (brightness > 0.88) return blend(color, background, 0.93);
      if (brightness > 0.73) return blend(color, background, 0.65);
      if (brightness > 0.6) return blend(color, background, 0.32);
      return color;
    }).replace(/stroke-width="([\d.]+)"/g, (_, n) => `stroke-width="${Number(n) * width / 2}"`);
    return `<g transform="translate(0 50) scale(2)">${body}</g>`;
  }
  const theme = BUSINESS_CARD_QR_THEME_FRAMES.find(i => i.id === frame);
  const geometric = GEOMETRIC_FRAMES.some(i => i.id === frame);
  if (!theme && !geometric) return null;
  const stroke = width * 4;
  const rect = (x: number, y: number, w: number, h: number, radius: number, fill = background) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${color}" stroke-width="${stroke}"/>`;
  const path = (d: string, fill = background) => `<path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (geometric) {
    switch (frame) {
      case "rounded-corners": return path("M280 170H195Q130 170 130 235V320M720 170H805Q870 170 870 235V320M130 850V940Q130 1000 195 1000H280M720 1000H805Q870 1000 870 940V850", "none");
      case "rounded-double": return rect(112, 155, 776, 865, 92) + rect(136, 179, 728, 817, 72);
      case "rounded-capsule": return rect(120, 125, 760, 920, 180);
      case "rounded-dashed": return `<g stroke-dasharray="28 20">${rect(130, 170, 740, 830, 85)}</g>`;
      case "rounded-offset": return rect(155, 200, 750, 835, 72, color) + rect(115, 155, 750, 835, 72);
      case "rounded-tab": return rect(120, 160, 760, 850, 80) + rect(370, 115, 260, 65, 32, color);
      case "rounded-arch": return path("M125 980V380Q125 60 500 60T875 380V980Q500 1030 125 980Z");
      default: return rect(130, 170, 740, 830, 88) + path("M265 1018H735", "none");
    }
  }
  const layout = theme!.layout;
  let shape = "";
  if (layout === 0) shape = rect(125, 145, 750, 875, 64) + path("M170 890H830", "none");
  if (layout === 1) shape = path("M120 1010V265Q120 60 500 60T880 265V1010Z");
  if (layout === 2) shape = path("M130 1010V225L300 65H700L870 225V1010Z");
  if (layout === 3) shape = path("M120 125H880V450Q810 510 880 570V1010H120V570Q190 510 120 450Z");
  if (layout === 4) shape = rect(120, 125, 760, 910, 120);
  if (layout === 5) shape = rect(105, 120, 790, 915, 44) + rect(130, 145, 740, 865, 30);
  if (layout === 6) shape = path("M500 45Q700 135 900 125V860Q900 1030 500 1100 100 1030 100 860V125Q300 135 500 45Z");
  if (layout === 7) shape = path("M140 100H860V1040L500 1010 140 1040Z");
  const icon = BUSINESS_CARD_QR_INDUSTRY_ICONS.find(i => i.id === theme!.icon)!;
  // Header emblem is outside the full QR rectangle, including its quiet zone.
  return shape + `<circle cx="500" cy="139" r="67" fill="${background}"/><svg x="453" y="92" width="94" height="94" viewBox="0 0 ${icon.viewBox} ${icon.viewBox}" fill="${color}" color="${color}">${icon.body}</svg>`;
}
