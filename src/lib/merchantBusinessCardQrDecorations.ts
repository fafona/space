import { BUSINESS_CARD_QR_INDUSTRY_ICONS } from "./merchantBusinessCardQrIndustry";
import { BUSINESS_CARD_QR_CRAFTED_FRAMES, businessCardQrCraftedFrameGeometry, renderBusinessCardQrCraftedFrame } from "./merchantBusinessCardQrCraftedFrames";
import { BUSINESS_CARD_QR_EXPANDED_FRAMES, businessCardQrStudioFrameGeometry, renderBusinessCardQrExpandedFrame } from "./merchantBusinessCardQrExpandedFrames";
// Legacy IDs and their renderer stay stable. New artwork uses separate IDs.
const LEGACY_BUSINESS_CARD_QR_ICONS = [
  { id: "restaurant", label: "餐厅", group: "餐饮食品", path: "M5 3v6m3-6v6m-6-6v6q0 3 3 3v9M17 3v18m0-18q6 5 0 10" },
  { id: "coffee", label: "咖啡", group: "餐饮食品", path: "M3 9h14v7q0 4-7 4t-7-4ZM17 10h2a3 3 0 0 1 0 6h-2M6 3v3m4-3v3m4-3v3M2 22h17" },
  { id: "tea", label: "奶茶", group: "餐饮食品", path: "M5 7h14l-2 15H7ZM4 7h16M12 7l2-6h4M9 16h.1m4 2h.1m2-5h.1" },
  { id: "bakery", label: "烘焙", group: "餐饮食品", path: "M3 16Q0 10 6 8L9 4h6l3 4q6 2 3 8l-4-1-3 4h-4l-3-4ZM6 8l2 7m1-11 1 15m5-15-1 15m4-11-2 7" },
  { id: "bar", label: "酒吧", group: "餐饮食品", path: "M3 4h18l-9 10ZM12 14v7m-5 0h10M6 7h12" },
  { id: "produce", label: "生鲜", group: "餐饮食品", path: "M12 7C2 2 1 16 7 21q3 2 5 0 3 2 5 0C23 16 22 2 12 7ZM12 7q-2-5 4-6 0 5-4 6" },
  { id: "market", label: "超市", group: "零售购物", path: "M2 3h3l3 13h11l3-9H6M8 19h.1m10 0h.1M10 7v5m5-5v5" },
  { id: "clothing", label: "服装", group: "零售购物", path: "M8 3q4 4 8 0l6 5-4 4-2-2v12H8V10l-2 2-4-4Z" },
  { id: "bags", label: "鞋包", group: "零售购物", path: "M4 8h16l2 13H2ZM8 8V6a4 4 0 0 1 8 0v2M8 12h.1m8 0h.1" },
  { id: "jewelry", label: "珠宝", group: "零售购物", path: "M5 3h14l4 6-11 13L1 9ZM1 9h22M8 3 6 9l6 13 6-13-2-6M6 9h12" },
  { id: "florist", label: "花店", group: "零售购物", path: "M12 7C5-4 0 8 7 12-4 19 8 24 12 17c7 11 12-1 5-5 11-7-1-12-5-5ZM10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0" },
  { id: "optics", label: "眼镜", group: "零售购物", path: "M2 13a4 4 0 1 0 8 0 4 4 0 1 0-8 0m12 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0M10 13h4M2 13l2-8m18 8-2-8" },
  { id: "hair", label: "美发", group: "美业运动", path: "M3 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0m12 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M8 14 19 2M16 14 5 2" },
  { id: "nails", label: "美甲", group: "美业运动", path: "M9 2h6v7H9ZM6 10h12v11H6ZM9 13h6" },
  { id: "beauty", label: "美容", group: "美业运动", path: "M15 2C4 0 1 18 10 22M15 2q-5 8 2 11l-3 2v3l-4 2m4-10h1M18 2q7 10 1 18" },
  { id: "spa", label: "SPA", group: "美业运动", path: "M12 20Q1 17 2 7q6 0 10 13ZM12 20Q23 17 22 7q-6 0-10 13ZM12 20Q4 10 12 2q8 8 0 18" },
  { id: "fitness", label: "健身", group: "美业运动", path: "M2 8h4v8H2Zm4-3h4v14H6Zm8 0h4v14h-4Zm4 3h4v8h-4ZM10 12h4" },
  { id: "yoga", label: "瑜伽", group: "美业运动", path: "M10 4a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 9v7m0-6-6 5H2m10-5 6 5h4M12 16q-14-1-8 5h16q6-6-8-5" },
  { id: "pets", label: "宠物", group: "健康生活", path: "M7 15q5-8 10 0 8 9-5 5-13 4-5-5ZM3 7a2 3 0 1 0 4 0 2 3 0 1 0-4 0m5-3a2 3 0 1 0 4 0 2 3 0 1 0-4 0m5 0a2 3 0 1 0 4 0 2 3 0 1 0-4 0m4 3a2 3 0 1 0 4 0 2 3 0 1 0-4 0" },
  { id: "dental", label: "牙科", group: "健康生活", path: "M12 4C2-2 1 9 5 13q1 16 5 3 2-5 4 0 4 13 5-3 4-11-7-9ZM9 5l5 2" },
  { id: "pharmacy", label: "药房", group: "健康生活", path: "M2 10h20q-1 11-10 11T2 10ZM13 10l6-8 3 2-6 6M6 22h12" },
  { id: "clinic", label: "诊所", group: "健康生活", path: "M3 2v7a5 5 0 0 0 10 0V2M3 3h2m6 0h2M8 14v2q0 7 7 6 5 0 5-6v-2m-2-3a2 2 0 1 0 4 0 2 2 0 1 0-4 0" },
  { id: "baby", label: "母婴", group: "健康生活", path: "M10 2h4v4h3v4H7V6h3ZM7 10q-2 1-2 4v8h14v-8q0-3-2-4M6 15h4m-4 4h4" },
  { id: "care", label: "养老", group: "健康生活", path: "M12 10C0 4 9-3 12 3c3-6 12 1 0 7ZM2 12v6l7 5m13-11v6l-7 5M4 14l5 4h6l5-4M9 18l-3-6m9 6 3-6" },
  { id: "hotel", label: "酒店", group: "出行服务", path: "M2 5v17m20-10v10M2 18h20M3 12h18v6H3ZM5 8h6v4H5Zm8 0h6v4h-6Z" },
  { id: "homestay", label: "民宿", group: "出行服务", path: "M2 12 12 3l10 9M5 10v12h14V10M10 22v-7h4v7M19 2h.1" },
  { id: "travel", label: "旅游", group: "出行服务", path: "M5 6h14v14H5ZM9 6V2h6v4M8 9v8m8-8v8M7 20v2m10-2v2" },
  { id: "auto", label: "汽修", group: "出行服务", path: "M2 14 5 8h12l4 6v7H2ZM2 14h19M5 17h2m9 0h2M6 8V5h6M17 2l-3 3 3 3 4-4" },
  { id: "cleaning", label: "家政", group: "出行服务", path: "M18 2 10 14M7 11l7 5-4 6-8-5ZM6 16l-2 3m5-1-2 3M3 2v4M1 4h4m14 7v6m-3-3h6" },
  { id: "delivery", label: "物流", group: "出行服务", path: "M2 7 12 2l10 5v12l-10 4-10-4ZM2 7l10 5 10-5M12 12v11M7 4l10 5v4" },
  { id: "property", label: "房产", group: "商务文娱", path: "M2 11 12 2l10 9M5 9v13h14V9M9 13a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 16v5m0-2h3" },
  { id: "education", label: "教育", group: "商务文娱", path: "M1 8 12 3l11 5-11 5ZM5 10v8q7 5 14 0v-8M22 9v10" },
  { id: "photo", label: "摄影", group: "商务文娱", path: "M2 7h5l2-4h6l2 4h5v14H2ZM8 14a4 4 0 1 0 8 0 4 4 0 1 0-8 0M18 10h.1" },
  { id: "tech", label: "科技", group: "商务文娱", path: "M5 5h14v14H5Zm4 4h6v6H9ZM8 1v4m4-4v4m4-4v4M8 19v4m4-4v4m4-4v4M1 8h4m-4 4h4m-4 4h4m14-8h4m-4 4h4m-4 4h4" },
  { id: "consulting", label: "咨询", group: "商务文娱", path: "M2 3h16v12H8l-6 5ZM7 7h6m-6 4h4M18 8h4v14l-5-4h-6" },
  { id: "games", label: "娱乐", group: "商务文娱", path: "M7 6h10q5 0 6 13-1 5-7-2H8q-6 7-7 2Q2 6 7 6ZM7 9v6m-3-3h6m7-2h.1m2 4h.1" },
] as const;

export const BUSINESS_CARD_QR_ICONS = [...BUSINESS_CARD_QR_INDUSTRY_ICONS, ...LEGACY_BUSINESS_CARD_QR_ICONS];
const LEGACY_BUSINESS_CARD_QR_FRAMES = [
  { id: "thin", label: "细线方框", group: "简约通用" }, { id: "round", label: "圆角方框", group: "简约通用" },
  { id: "double", label: "双线边框", group: "简约通用" }, { id: "corners", label: "四角定位框", group: "简约通用" }, { id: "card", label: "无边线底卡", group: "简约通用" },
  { id: "business", label: "深色商务框", group: "商务质感" }, { id: "gold", label: "金色细边框", group: "商务质感" }, { id: "layers", label: "双层卡片框", group: "商务质感" }, { id: "tech", label: "切角科技框", group: "商务质感" }, { id: "stripe", label: "侧边品牌色框", group: "商务质感" },
  { id: "bottom", label: "底部文字条", group: "引导扫码" }, { id: "top", label: "顶部标题条", group: "引导扫码" }, { id: "both", label: "上下双文字条", group: "引导扫码" }, { id: "arrow", label: "向下箭头框", group: "引导扫码" }, { id: "ring", label: "环绕提示框", group: "引导扫码" },
  { id: "tag", label: "商品吊牌框", group: "标签标牌" }, { id: "plaque", label: "门牌框", group: "标签标牌" }, { id: "ticket", label: "票券齿口框", group: "标签标牌" }, { id: "stamp", label: "邮票边框", group: "标签标牌" }, { id: "ribbon", label: "丝带横幅框", group: "标签标牌" },
  { id: "circle", label: "圆形徽章框", group: "柔和趣味" }, { id: "oval", label: "椭圆徽章框", group: "柔和趣味" }, { id: "bubble", label: "对话气泡框", group: "柔和趣味" }, { id: "cloud", label: "云朵框", group: "柔和趣味" }, { id: "flower", label: "花瓣框", group: "柔和趣味" },
  { id: "coffee", label: "咖啡杯外框", group: "餐饮食品" }, { id: "tea", label: "奶茶杯外框", group: "餐饮食品" }, { id: "plate", label: "餐盘外框", group: "餐饮食品" }, { id: "bread", label: "面包外框", group: "餐饮食品" }, { id: "chef", label: "厨师帽外框", group: "餐饮食品" },
  { id: "house", label: "房屋外框", group: "行业特色" }, { id: "bag", label: "购物袋外框", group: "行业特色" }, { id: "phone", label: "手机外框", group: "行业特色" }, { id: "car", label: "汽车轮廓框", group: "行业特色" }, { id: "gift", label: "礼盒外框", group: "行业特色" },
  { id: "heart", label: "爱心外框", group: "活动情感" }, { id: "shield", label: "盾牌徽章框", group: "活动情感" }, { id: "medal", label: "奖章外框", group: "活动情感" }, { id: "polaroid", label: "拍立得相框", group: "活动情感" }, { id: "confetti", label: "节庆彩带框", group: "活动情感" },
] as const;
export const BUSINESS_CARD_QR_FRAMES = [...BUSINESS_CARD_QR_CRAFTED_FRAMES, ...BUSINESS_CARD_QR_EXPANDED_FRAMES, ...LEGACY_BUSINESS_CARD_QR_FRAMES];
export type BusinessCardQrIcon = "none" | (typeof BUSINESS_CARD_QR_ICONS)[number]["id"];
export type BusinessCardQrFrame = "none" | (typeof BUSINESS_CARD_QR_FRAMES)[number]["id"];
export type BusinessCardQrDecoration = {
  icon?: BusinessCardQrIcon; iconColor?: string; iconFollowColor?: boolean;
  frame?: BusinessCardQrFrame; frameColor?: string; frameBackgroundColor?: string;
  frameWidth?: number; framePadding?: number;
};
export const normalizeBusinessCardQrIcon = (v: unknown): BusinessCardQrIcon => BUSINESS_CARD_QR_ICONS.find(i => i.id === v)?.id ?? "none";
export const normalizeBusinessCardQrFrame = (v: unknown): BusinessCardQrFrame => BUSINESS_CARD_QR_FRAMES.find(i => i.id === v)?.id ?? "none";
const hex = (v: unknown, fallback: string) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
const bounded = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
export function normalizeBusinessCardQrDecoration(input: BusinessCardQrDecoration | null = {}): Required<BusinessCardQrDecoration> {
  const v = input && typeof input === "object" ? input : {};
  return { icon: normalizeBusinessCardQrIcon(v.icon), iconColor: hex(v.iconColor, "#000000"), iconFollowColor: v.iconFollowColor !== false,
    frame: normalizeBusinessCardQrFrame(v.frame), frameColor: hex(v.frameColor, "#1e3a8a"), frameBackgroundColor: hex(v.frameBackgroundColor, "#ffffff"),
    frameWidth: bounded(v.frameWidth, 2, 1, 4), framePadding: bounded(v.framePadding, 16, 8, 32) };
}

export function renderBusinessCardQrIcon(icon: BusinessCardQrIcon, color: string): string {
  const preset = BUSINESS_CARD_QR_ICONS.find(i => i.id === icon);
  if (preset && "body" in preset) return `<svg viewBox="0 0 ${preset.viewBox} ${preset.viewBox}" xmlns="http://www.w3.org/2000/svg" fill="${hex(color, "#000000")}" color="${hex(color, "#000000")}">${preset.body}</svg>`;
  return preset ? `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${preset.path}" fill="none" stroke="${hex(color, "#000000")}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "";
}

// All frames reserve the same full QR rectangle. Decorations never enter its quiet zone.
export function businessCardQrFrameGeometry(padding: number, frame = "none") {
  const crafted = businessCardQrCraftedFrameGeometry(frame, padding);
  if (crafted) return crafted;
  const studio = businessCardQrStudioFrameGeometry(frame, padding);
  if (studio) return studio;
  return { x: 172 + padding, y: 222 + padding, side: 656 - 2 * padding, width: 1000, height: 1140 };
}

export function renderBusinessCardQrFrame(options: Required<BusinessCardQrDecoration>): string {
  const { frame: f, frameColor: c, frameBackgroundColor: b, frameWidth } = options;
  const crafted = renderBusinessCardQrCraftedFrame(f, c, b, frameWidth);
  if (crafted !== null) return crafted;
  const expanded = renderBusinessCardQrExpandedFrame(f, c, b, frameWidth);
  if (expanded !== null) return expanded;
  const w = frameWidth * 3;
  const path = (d: string, fill = b, stroke = c) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const rect = (x = 150, y = 195, width = 700, height = 770, rx = 0, fill = b, stroke = c) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`;
  const ellipse = (rx = 470, ry = 500, fill = b) => `<ellipse cx="500" cy="550" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${c}" stroke-width="${w}"/>`;
  switch (f) {
    case "thin": return rect();
    case "round": return rect(150, 195, 700, 770, 64);
    case "double": return rect(125, 170, 750, 820, 12) + rect();
    case "corners": return path("M260 185H140V320M740 185H860V320M140 820V975H260M740 975H860V820", "none");
    case "card": return rect(130, 170, 740, 830, 64, b, "none");
    case "business": return rect(110, 140, 780, 890, 32, c);
    case "gold": return rect(128, 168, 744, 824, 4) + rect(145, 185, 710, 790, 4) + path("M105 160h55m-30-25v50M840 1000h55m-25-25v50", "none");
    case "layers": return rect(175, 220, 730, 815, 30, c) + rect(125, 155, 730, 815, 30);
    case "tech": return path("M205 150H795L885 235V925L815 1000H185L115 925V235Z") + path("M95 340V220l80-85M825 135l80 85v120M95 820v125l80 80M825 1025l80-80V820", "none");
    case "stripe": return rect(120, 160, 760, 850, 30) + rect(120, 160, 30, 850, 10, c);
    case "bottom": return rect() + rect(150, 890, 700, 75, 0, c);
    case "top": return rect(150, 110, 700, 855, 24) + rect(150, 110, 700, 85, 0, c);
    case "both": return rect(150, 110, 700, 855, 24) + rect(150, 110, 700, 85, 0, c) + rect(150, 890, 700, 75, 0, c);
    case "arrow": return rect(150, 210, 700, 775, 35) + path("M465 60h70v65h65L500 205 400 125h65Z", c);
    case "ring": return ellipse(485, 530) + ellipse(460, 505, "none");
    case "tag": return path("M150 215 420 60h160l270 155v780H150Z") + `<circle cx="500" cy="115" r="25" fill="none" stroke="${c}" stroke-width="${w}"/>`;
    case "plaque": return path("M150 200h700q0 80 110 80v590q-110 0-110 90H150q0-90-110-90V280q110 0 110-80Z") + `<g fill="${c}"><circle cx="90" cy="560" r="16"/><circle cx="910" cy="560" r="16"/></g>`;
    case "ticket": return path("M135 170h730v310q-85 70 0 140v380H135V620q85-70 0-140Z") + `<path d="M165 900h670" stroke="${c}" stroke-width="${w}" stroke-dasharray="12 12"/>`;
    case "stamp": { const teeth = Array.from({ length: 10 }, () => "q20 28 40 0q20-28 40 0").join(""); return path(`M100 150${teeth}v850H100Z`) + rect(140, 190, 720, 770) + `<path d="M110 145v860h790V145" fill="none" stroke="${c}" stroke-width="${w * 2}" stroke-dasharray="16 20"/>`; }
    case "ribbon": return rect() + path("M120 890H40l40 65-40 65h140v-85h640v85h140l-40-65 40-65H880v90H120Z", c) + rect(120, 890, 760, 90, 0, c);
    case "circle": return ellipse() + ellipse(454, 483, "none");
    case "oval": return ellipse(490, 475);
    case "bubble": return path("M195 160h610q85 0 85 85v610q0 70-70 70l40 130-170-100H195q-90 0-90-90V250q0-90 90-90Z");
    case "cloud": return path("M135 1000C-35 1010-30 610 80 540-50 350 65 140 220 175 220-30 480-40 520 110 700-60 875 75 830 210 1030 185 1050 430 920 510 1060 670 1010 1030 865 1020Z");
    case "flower": return path("M130 930Q-60 750 70 580-65 380 120 210 130 30 320 85 500-65 670 85 880 20 900 225 1080 400 930 580 1070 800 885 925 820 1120 640 1020 450 1180 300 1030 80 1100 130 930Z");
    case "coffee": return path("M840 330q240-20 90 440H840", "none") + path("M110 210H850V875q0 120-140 120H250q-140 0-140-120Z") + path("M360 150q-65-45 0-95m140 95q-65-45 0-95m140 95q-65-45 0-95", "none");
    case "tea": return path("M485 180 540 20h80l-60 160", "none") + path("M105 170H895L840 1030H160Z") + rect(95, 150, 810, 60, 20) + `<g fill="${c}">${[260, 380, 500, 620, 740].map(x => `<circle cx="${x}" cy="985" r="18"/>`).join("")}</g>`;
    case "plate": return ellipse(450, 480) + ellipse(428, 457, "none") + path("M20 220v180h35V220m-18 0v760M965 220q-40 100 0 260v500", "none");
    case "bread": return path("M120 420C-25 315 70 80 300 110h400c230-30 325 205 180 310v580H120Z");
    case "chef": return path("M125 410C-40 430 0 140 210 175 205-40 480-20 505 105 650-40 850 10 820 175 1015 70 1070 415 875 425v580H125Z") + path("M150 965h700", "none");
    case "house": return path("M110 970V270H30L500 25l470 245h-80v700Z") + path("M730 145V45h80v145", "none");
    case "bag": return path("M140 205H860l50 800H90Z") + path("M350 230V150a150 125 0 0 1 300 0v80", "none");
    case "phone": return rect(120, 55, 760, 1025, 85, c) + rect(150, 195, 700, 720, 4) + path("M410 130h180", "none", b) + `<circle cx="500" cy="1010" r="25" fill="${b}"/>`;
    case "car": return path("M100 370 200 120h600l100 250 65 40v590H35V410Z", c) + rect(140, 210, 720, 710, 25) + `<g fill="${b}"><circle cx="80" cy="600" r="25"/><circle cx="920" cy="600" r="25"/></g>` + rect(85, 1000, 150, 75, 20, c) + rect(765, 1000, 150, 75, 20, c);
    case "gift": return rect(130, 205, 740, 795, 12) + rect(95, 145, 810, 65, 10) + path("M500 145C190 170 250-85 500 145c250-230 310 25 0 0Z", "none");
    case "heart": return path("M500 135C180-130-90 140 65 580 95 830 100 990 500 1105 900 990 905 830 935 580 1090 140 820-130 500 135Z");
    case "shield": return path("M500 45Q300 180 85 135V730q0 265 415 365 415-100 415-365V135Q700 180 500 45Z");
    case "medal": return path("M290 885 190 1110l170-50 80 55 60-200 60 200 80-55 170 50-100-225Z", c) + ellipse(465, 500) + ellipse(442, 476, "none");
    case "polaroid": return rect(130, 170, 740, 860, 12) + rect(155, 205, 690, 685, 4);
    case "confetti": return rect(150, 195, 700, 770, 30) + path("M50 130q110-90 40 30t0 90M925 220q-90-40-40-95t0-55M50 900q110-40 40 50t0 90M950 900q-110-40-40 50t0 90", "none") + `<g fill="${c}">${[200, 350, 650, 800].map((x, i) => `<path d="M${x} ${70 + i % 2 * 20}l12 25 28 5-20 20 5 28-25-12-25 12 5-28-20-20 28-5Z"/>`).join("")}</g>`;
    default: return "";
  }
}
